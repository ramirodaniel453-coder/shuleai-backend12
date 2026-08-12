const { Op } = require('sequelize');
const { sequelize, FeeStructure, Fee, Student, Class, User, Payment, AuditLog } = require('../models');
const ledger = require('./financeLedgerService');

function amount(value) {
  const n = Math.round(Number(value || 0));
  if (!Number.isFinite(n) || n < 0) throw new Error('Amounts must be valid non-negative numbers');
  return n;
}

function normalizeItems(items = []) {
  if (!Array.isArray(items) || !items.length) throw new Error('At least one fee item is required');
  return items.map((item, index) => {
    const name = String(item.name || item.label || item.itemName || '').trim();
    if (!name) throw new Error(`Fee item ${index + 1} requires a name`);
    return {
      id: item.id || `item_${index + 1}`,
      name,
      amount: amount(item.amount),
      category: item.category || 'general',
      required: item.required !== false
    };
  });
}

function totalFromItems(items = []) {
  return normalizeItems(items).filter(i => i.required !== false).reduce((sum, i) => sum + i.amount, 0);
}

function audit(action, user, extra = {}) {
  return { action, actorUserId: user?.id || null, actorRole: user?.role || null, at: new Date().toISOString(), ...extra };
}

async function writeAudit({ schoolCode, user, module = 'fees', action, entityType, entityId, before, after, metadata }) {
  try {
    if (!AuditLog) return;
    await AuditLog.create({ schoolCode, actorUserId: user?.id || null, actorRole: user?.role || null, module, action, entityType, entityId: String(entityId || ''), before, after, metadata });
  } catch (e) {
    console.error('Fee audit failed:', e.message);
  }
}

function uniqueNumbers(values = []) {
  return [...new Set(values.map(v => Number(v)).filter(v => Number.isInteger(v) && v > 0))];
}

async function resolveClasses({ schoolCode, payload, existingStructure = null, transaction = null }) {
  let ids = uniqueNumbers(payload.classIds || payload.classes || payload.selectedClassIds || []);
  if (payload.classId) ids.push(Number(payload.classId));
  ids = uniqueNumbers(ids);

  let classes = [];
  if (ids.length) {
    classes = await Class.findAll({ where: { schoolCode, id: ids }, order: [['grade', 'ASC'], ['name', 'ASC']], transaction });
  } else if (existingStructure?.classIds?.length) {
    classes = await Class.findAll({ where: { schoolCode, id: existingStructure.classIds }, order: [['grade', 'ASC'], ['name', 'ASC']], transaction });
  } else if (existingStructure?.classId) {
    classes = await Class.findAll({ where: { schoolCode, id: existingStructure.classId }, transaction });
  } else if (payload.className || payload.gradeLevel) {
    const name = String(payload.className || payload.gradeLevel).trim();
    classes = await Class.findAll({ where: { schoolCode, [Op.or]: [{ name }, { grade: name }] }, order: [['grade', 'ASC'], ['name', 'ASC']], transaction });
  }

  const assignedClasses = classes.map(c => ({ id: c.id, name: c.name, grade: c.grade, stream: c.stream }));
  const classIds = classes.map(c => c.id);
  const className = assignedClasses.length
    ? assignedClasses.map(c => c.name || c.grade).join(', ')
    : String(payload.className || payload.gradeLevel || existingStructure?.className || 'Selected Classes').trim();

  return { classIds, assignedClasses, className, classId: classIds[0] || payload.classId || existingStructure?.classId || null };
}

function buildGroupKey({ schoolCode, name, term, year, curriculum }) {
  return [schoolCode, name, term, year, curriculum || 'CBC'].map(v => String(v || '').trim().toLowerCase()).join(':');
}

async function createOrUpdateStructure({ user, id, payload }) {
  const schoolCode = user.schoolCode || payload.schoolCode;
  if (!schoolCode) throw new Error('schoolCode is required');
  const items = normalizeItems(payload.items);
  const totalAmount = totalFromItems(items);
  const existingStructure = id ? await FeeStructure.findOne({ where: { id, schoolCode } }) : null;
  if (id && !existingStructure) throw new Error('Fee structure not found');
  if (existingStructure?.status === 'locked') throw new Error('Locked fee structures cannot be edited. Create an adjustment instead.');

  const resolved = await resolveClasses({ schoolCode, payload, existingStructure });
  if (!resolved.className) throw new Error('Select at least one class or provide a class name');
  if (!payload.term) throw new Error('term is required');

  const year = Number(payload.year || existingStructure?.year || new Date().getFullYear());
  const curriculum = payload.curriculum || existingStructure?.curriculum || 'CBC';
  const name = payload.name || existingStructure?.name || `${resolved.className} ${payload.term} ${year}`;
  const groupKey = buildGroupKey({ schoolCode, name, term: payload.term, year, curriculum });
  const data = {
    schoolCode,
    classId: resolved.classId,
    classIds: resolved.classIds,
    assignedClasses: resolved.assignedClasses,
    className: resolved.className,
    gradeLevel: payload.gradeLevel || resolved.className,
    curriculum,
    term: payload.term,
    year,
    name,
    groupKey,
    description: payload.description || null,
    currency: payload.currency || 'KES',
    items,
    optionalItems: Array.isArray(payload.optionalItems) ? payload.optionalItems.map((i, idx) => ({ id: i.id || `optional_${idx + 1}`, name: String(i.name || '').trim(), amount: amount(i.amount), category: i.category || 'optional' })).filter(i => i.name) : [],
    discounts: Array.isArray(payload.discounts) ? payload.discounts : [],
    totalAmount,
    dueDate: payload.dueDate || null,
    effectiveFrom: payload.effectiveFrom || null,
    updatedBy: user.id || null
  };

  if (id) {
    const before = existingStructure.toJSON();
    const trail = Array.isArray(existingStructure.auditTrail) ? existingStructure.auditTrail : [];
    trail.push(audit('updated', user, { totalAmount, classIds: resolved.classIds }));
    await existingStructure.update({ ...data, auditTrail: trail });
    await writeAudit({ schoolCode, user, action: 'fee_structure_updated', entityType: 'FeeStructure', entityId: existingStructure.id, before, after: existingStructure.toJSON() });
    return existingStructure;
  }

  // Prevent duplicate grouped structures. If the same school/name/term/year/curriculum exists,
  // update it rather than creating another card.
  const duplicate = await FeeStructure.findOne({ where: { schoolCode, groupKey } });
  if (duplicate) {
    const before = duplicate.toJSON();
    const mergedClassIds = uniqueNumbers([...(duplicate.classIds || []), ...resolved.classIds]);
    const classMap = new Map([...(duplicate.assignedClasses || []), ...resolved.assignedClasses].map(c => [String(c.id || c.name), c]));
    const assignedClasses = [...classMap.values()];
    const trail = Array.isArray(duplicate.auditTrail) ? duplicate.auditTrail : [];
    trail.push(audit('merged_duplicate_structure_request', user, { classIds: mergedClassIds }));
    await duplicate.update({ ...data, classIds: mergedClassIds, assignedClasses, className: assignedClasses.map(c => c.name || c.grade).join(', ') || data.className, auditTrail: trail });
    await writeAudit({ schoolCode, user, action: 'fee_structure_merged_duplicate', entityType: 'FeeStructure', entityId: duplicate.id, before, after: duplicate.toJSON() });
    return duplicate;
  }

  const structure = await FeeStructure.create({ ...data, createdBy: user.id || null, auditTrail: [audit('created', user, { totalAmount, classIds: resolved.classIds })] });
  await writeAudit({ schoolCode, user, action: 'fee_structure_created', entityType: 'FeeStructure', entityId: structure.id, after: structure.toJSON() });
  return structure;
}

async function activateStructure({ user, id }) {
  const schoolCode = user.schoolCode;
  const structure = await FeeStructure.findOne({ where: { id, schoolCode } });
  if (!structure) throw new Error('Fee structure not found');
  const before = structure.toJSON();
  const trail = Array.isArray(structure.auditTrail) ? structure.auditTrail : [];
  trail.push(audit('activated', user));
  await structure.update({ status: 'active', auditTrail: trail, updatedBy: user.id });
  const assignment = await assignStructureToStudents({ user, structureId: structure.id, studentIds: [], classId: null, overwrite: false });
  await writeAudit({ schoolCode, user, action: 'fee_structure_activated', entityType: 'FeeStructure', entityId: id, before, after: structure.toJSON(), metadata: { assignedAccounts: assignment.results?.length || 0 } });
  return { structure: await structure.reload(), assignment };
}

async function lockStructure({ user, id }) {
  const schoolCode = user.schoolCode;
  const structure = await FeeStructure.findOne({ where: { id, schoolCode } });
  if (!structure) throw new Error('Fee structure not found');
  const before = structure.toJSON();
  const trail = Array.isArray(structure.auditTrail) ? structure.auditTrail : [];
  trail.push(audit('locked', user));
  await structure.update({ status: 'locked', lockedAt: new Date(), lockedBy: user.id, auditTrail: trail });
  await writeAudit({ schoolCode, user, action: 'fee_structure_locked', entityType: 'FeeStructure', entityId: id, before, after: structure.toJSON() });
  return structure;
}

async function studentsForStructure({ schoolCode, structure, studentIds = [], classId = null, transaction }) {
  const where = {};
  const selectedIds = uniqueNumbers(studentIds);
  if (selectedIds.length) where.id = selectedIds;
  else {
    const classIds = uniqueNumbers([classId, ...(structure.classIds || []), structure.classId]);
    if (classIds.length) where.classId = classIds;
    else if (structure.className) where.grade = structure.className;
  }
  return Student.findAll({
    where,
    include: [{ model: User, where: { schoolCode, role: 'student' }, attributes: ['id', 'name', 'schoolCode'] }],
    transaction
  });
}

async function assignStructureToStudents({ user, structureId, studentIds = [], classId = null, overwrite = false }) {
  const schoolCode = user.schoolCode;
  const structure = await FeeStructure.findOne({ where: { id: structureId, schoolCode } });
  if (!structure) throw new Error('Fee structure not found');

  return sequelize.transaction(async (transaction) => {
    if (!['active', 'locked'].includes(String(structure.status || '').toLowerCase())) {
      const trail = Array.isArray(structure.auditTrail) ? structure.auditTrail : [];
      trail.push(audit('auto_activated_before_assignment', user));
      await structure.update({ status: 'active', auditTrail: trail, updatedBy: user.id || null }, { transaction });
    }

    const students = await studentsForStructure({ schoolCode, structure, studentIds, classId, transaction });
    const results = [];
    for (const student of students) {
      const existing = await Fee.findOne({
        where: { studentId: student.id, schoolCode, feeStructureId: Number(structure.id), term: structure.term, year: structure.year },
        transaction
      });
      if (existing && !overwrite) {
        results.push({ studentId: student.id, status: 'skipped_existing', feeId: existing.id });
        continue;
      }
      const previousParentPaid = Number(existing?.parentPaidAmount ?? existing?.paidAmount ?? 0);
      const previousCredit = Number(existing?.creditAmount || 0);
      const payload = {
        studentId: student.id,
        schoolCode,
        term: structure.term,
        year: structure.year,
        totalAmount: structure.totalAmount,
        parentPaidAmount: previousParentPaid,
        creditAmount: previousCredit,
        paidAmount: Math.min(Number(structure.totalAmount || 0), previousParentPaid + previousCredit),
        status: (previousParentPaid + previousCredit) >= Number(structure.totalAmount || 0) ? 'paid' : ((previousParentPaid + previousCredit) > 0 ? 'partial' : 'unpaid'),
        dueDate: structure.dueDate,
        feeStructureId: Number(structure.id),
        classId: student.classId || structure.classId || null,
        currency: structure.currency,
        locked: structure.status === 'locked',
        auditTrail: [audit(existing ? 'fee_reassigned_from_structure' : 'fee_assigned_from_structure', user, { structureId: structure.id, totalAmount: structure.totalAmount })]
      };
      const fee = existing ? await existing.update(payload, { transaction }) : await Fee.create(payload, { transaction });
      await ledger.recalculateFeeAccount(fee.id, { transaction });
      results.push({ studentId: student.id, status: existing ? 'updated' : 'created', feeId: fee.id });
    }
    const assignedCount = await Fee.count({ where: { schoolCode, feeStructureId: Number(structure.id) }, transaction });
    await structure.update({ studentsAssigned: assignedCount }, { transaction });
    await writeAudit({ schoolCode, user, action: 'fee_structure_assigned', entityType: 'FeeStructure', entityId: structure.id, after: { count: results.length, results }, metadata: { overwrite } });
    return { structure: await structure.reload({ transaction }), results };
  });
}



async function deleteOrArchiveStructure({ user, id }) {
  const schoolCode = user.schoolCode;
  const structure = await FeeStructure.findOne({ where: { id, schoolCode } });
  if (!structure) throw new Error('Fee structure not found');
  const before = structure.toJSON();
  const feeCount = await Fee.count({ where: { schoolCode, feeStructureId: Number(structure.id) } });
  const paymentCount = await Payment.count({ where: { schoolCode, feeStructureId: Number(structure.id) } }).catch(() => 0);
  if (feeCount > 0 || paymentCount > 0) {
    const trail = Array.isArray(structure.auditTrail) ? structure.auditTrail : [];
    trail.push(audit('archived_instead_of_deleted', user, { feeCount, paymentCount }));
    await structure.update({ status: 'archived', auditTrail: trail, updatedBy: user.id || null });
    await writeAudit({ schoolCode, user, action: 'fee_structure_archived', entityType: 'FeeStructure', entityId: id, before, after: structure.toJSON(), metadata: { feeCount, paymentCount } });
    return { action: 'archived', structure };
  }
  await structure.destroy();
  await writeAudit({ schoolCode, user, action: 'fee_structure_deleted', entityType: 'FeeStructure', entityId: id, before, metadata: { feeCount, paymentCount } });
  return { action: 'deleted', structure: before };
}

async function adjustStudentFee({ user, feeId, amount: deltaAmount, reason, type = 'manual_adjustment' }) {
  const schoolCode = user.schoolCode;
  if (!reason || String(reason).trim().length < 3) throw new Error('Adjustment reason is required');
  const fee = await Fee.findOne({ where: { id: feeId, schoolCode } });
  if (!fee) throw new Error('Student fee account not found');
  const before = fee.toJSON();
  const delta = Math.round(Number(deltaAmount));
  if (!Number.isFinite(delta)) throw new Error('Adjustment amount must be a valid number');
  const newTotal = Math.max(0, Number(fee.totalAmount || 0) + delta);
  const paid = Number(fee.parentPaidAmount ?? fee.paidAmount ?? 0) + Number(fee.creditAmount || 0);
  const status = paid >= newTotal ? 'paid' : paid > 0 ? 'partial' : 'unpaid';
  const adjustments = Array.isArray(fee.adjustments) ? fee.adjustments : [];
  adjustments.push({ type, amount: delta, reason, actorUserId: user.id, actorRole: user.role, at: new Date().toISOString(), beforeTotal: fee.totalAmount, afterTotal: newTotal });
  const trail = Array.isArray(fee.auditTrail) ? fee.auditTrail : [];
  trail.push(audit('fee_adjusted', user, { amount: delta, reason, beforeTotal: fee.totalAmount, afterTotal: newTotal }));
  await fee.update({ totalAmount: newTotal, status, adjustments, auditTrail: trail });
  await writeAudit({ schoolCode, user, action: 'student_fee_adjusted', entityType: 'Fee', entityId: fee.id, before, after: fee.toJSON(), metadata: { reason, delta } });
  return fee;
}

module.exports = { createOrUpdateStructure, activateStructure, lockStructure, assignStructureToStudents, adjustStudentFee, deleteOrArchiveStructure };
