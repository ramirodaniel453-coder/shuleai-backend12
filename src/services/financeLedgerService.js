const { Op } = require('sequelize');
const { sequelize, Payment, Fee, Student, Parent, User, Class, AuditLog, UserRoleAssignment } = require('../models');
const realtimeSync = require('./realtimeSyncService');
const { createAlert } = require('./notificationService');
const { transactionId } = require('../utils/businessIds');

const APPROVED = new Set(['completed', 'success', 'successful', 'approved', 'paid']);
const PENDING = new Set(['pending', 'processing', 'pending_verification']);
const REJECTED = new Set(['failed', 'rejected', 'refunded']);
const CREDIT_TYPES = new Set(['bursary', 'waiver', 'discount', 'adjustment', 'correction', 'scholarship', 'credit']);

function asInt(value, fallback = 0) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? n : fallback;
}
function cleanAmount(value) {
  const n = asInt(value, NaN);
  if (!Number.isFinite(n) || n <= 0) throw new Error('Amount must be greater than zero');
  return n;
}
function normalizeStatus(status) {
  const s = String(status || 'pending').trim().toLowerCase();
  if (['approved', 'successful', 'success', 'completed', 'paid'].includes(s)) return 'completed';
  if (['pending', 'processing', 'pending_verification', 'manual'].includes(s)) return 'pending';
  if (['rejected', 'failed', 'cancelled', 'canceled'].includes(s)) return s === 'rejected' ? 'rejected' : 'failed';
  if (s === 'reversed' || s === 'refunded') return s;
  return s;
}
function normalizeMethod(method) {
  const s = String(method || 'manual_mpesa').trim().toLowerCase().replace(/\s+/g, '_').replace(/-/g, '_');
  if (s === 'mpesa' || s === 'm_pesa') return 'manual_mpesa';
  if (s === 'stk' || s === 'mpesa_stk') return 'mpesa_stk';
  if (s === 'bank_transfer') return 'bank';
  if (s === 'admin') return 'admin_adjustment';
  return s;
}
function normalizeTransactionType(value, method) {
  const s = String(value || '').trim().toLowerCase().replace(/\s+/g, '_').replace(/-/g, '_');
  if (s) return s;
  const m = normalizeMethod(method);
  if (['bursary', 'waiver', 'discount', 'admin_adjustment', 'correction', 'scholarship'].includes(m)) return m === 'admin_adjustment' ? 'adjustment' : m;
  return 'payment';
}
function isApproved(status) { return APPROVED.has(normalizeStatus(status)); }
function isCreditType(type) { return CREDIT_TYPES.has(String(type || '').toLowerCase()); }
function feeBalance(fee) {
  return Math.max(0, asInt(fee.totalAmount) - asInt(fee.parentPaidAmount ?? fee.paidAmount) - asInt(fee.creditAmount));
}
function feeStatus(fee) {
  const balance = feeBalance(fee);
  const total = asInt(fee.totalAmount);
  const covered = asInt(fee.parentPaidAmount ?? fee.paidAmount) + asInt(fee.creditAmount);
  if (balance <= 0 && total > 0) return 'paid';
  if (covered > 0) return 'partial';
  if (fee.dueDate && new Date(fee.dueDate) < new Date()) return 'overdue';
  return 'unpaid';
}
function studentName(student) { return student?.User?.name || student?.name || `Student #${student?.id || ''}`.trim(); }
function className(student, fee) { return student?.Class?.name || student?.grade || fee?.metadata?.className || fee?.className || 'Unassigned'; }

async function writeAudit({ schoolCode, user, action, entityType = 'Payment', entityId, before, after, metadata }) {
  try {
    if (!AuditLog) return;
    await AuditLog.create({
      schoolCode,
      actorUserId: user?.id || null,
      actorRole: user?.role || null,
      module: 'finance',
      action,
      entityType,
      entityId: entityId ? String(entityId) : null,
      before,
      after,
      metadata
    });
  } catch (e) {
    console.error('[FinanceLedger] audit failed:', e.message);
  }
}

async function createAlertForUser({userId,role,title,message,severity='info',data={},actionUrl=null,dedupeKey=null,transaction}){if(!userId)return null;return createAlert({userId,role,type:'fee',severity,title,message,data,actionUrl,dedupeKey,categoryLabel:'Finance',sourceType:'finance',sourceLabel:'School Finance',transaction});}

async function createFinanceAlerts({ schoolCode, student, parentId, payment, action, transaction }) {
  const name = studentName(student);
  const amount = Number(payment.amount || 0).toLocaleString();
  const status = normalizeStatus(payment.status);
  const txType = payment.transactionType || 'payment';
  const parent = parentId ? await Parent.findByPk(parentId, { include: [{ model: User, attributes: ['id', 'name'] }], transaction }) : null;
  let parentTitle = 'Payment update';
  let parentMessage = `${name}: KES ${amount} ${txType} is ${status}.`;
  let severity = 'info';
  if (status === 'completed') { parentTitle = isCreditType(txType) ? 'Bursary/Credit approved' : 'Payment approved'; severity = 'success'; }
  if (status === 'pending') { parentTitle = isCreditType(txType) ? 'Bursary/Credit pending' : 'Payment pending approval'; severity = 'info'; }
  if (status === 'failed' || status === 'rejected') { parentTitle = isCreditType(txType) ? 'Bursary/Credit rejected' : 'Payment failed/rejected'; severity = 'warning'; }

  await createAlertForUser({
    userId: parent?.userId,
    role: 'parent',
    title: parentTitle,
    message: parentMessage,
    severity,
    data: { studentId: student.id, paymentId: payment.id, feeId: payment.feeId, schoolCode, action },
    actionUrl: '#payments',
    transaction
  });

  const schoolUsers=await User.findAll({where:{schoolCode,isActive:true},attributes:['id','role','preferences'],transaction});const activeAssignments=UserRoleAssignment?await UserRoleAssignment.findAll({where:{schoolCode,role:'finance_officer',status:'active'},attributes:['userId'],transaction}).catch(()=>[]):[];const assignedFinanceIds=new Set(activeAssignments.map(a=>Number(a.userId)));const admins=schoolUsers.filter(u=>u.role==='admin'),financeUsers=schoolUsers.filter(u=>u.role==='finance_officer'||assignedFinanceIds.has(Number(u.id)));await Promise.all([...admins.map(a=>createAlertForUser({userId:a.id,role:'admin',title:`Finance update: ${name}`,message:`${name}: KES ${amount} ${txType} via ${payment.method} is ${status}.`,severity,data:{studentId:student.id,paymentId:payment.id,feeId:payment.feeId,schoolCode,action},actionUrl:'#finance-fees',dedupeKey:`finance-admin:${payment.id}:${status}:${a.id}`,transaction})),...financeUsers.map(f=>createAlertForUser({userId:f.id,role:'finance_officer',title:status==='pending'?`Payment confirmation awaiting review: ${name}`:`Finance update: ${name}`,message:`${name}: KES ${amount} ${txType} via ${payment.method} is ${status}.`,severity,data:{studentId:student.id,paymentId:payment.id,feeId:payment.feeId,schoolCode,action,targetRoles:['finance_officer']},actionUrl:'#finance-fees',dedupeKey:`finance-staff:${payment.id}:${status}:${f.id}`,transaction}))]);
}

async function findStudentInSchool({ schoolCode, studentId, transaction }) {
  const userWhere = { role: 'student' };
  if (schoolCode) userWhere.schoolCode = schoolCode;
  return Student.findOne({
    where: { id: studentId },
    include: [
      { model: User, where: userWhere, attributes: ['id', 'name', 'email', 'phone', 'schoolCode'] },
      { model: Class, attributes: ['id', 'name', 'grade', 'stream'], required: false }
    ],
    transaction
  });
}

async function assertParentOwnsStudent({ parentUserId, studentId, schoolCode, transaction }) {
  const parent = await Parent.findOne({ where: { userId: parentUserId }, transaction });
  if (!parent) throw new Error('Parent profile not found');
  const student = await findStudentInSchool({ schoolCode, studentId, transaction });
  if (!student) throw new Error('Student not found');
  if (parent.hasStudent) {
    const ok = await parent.hasStudent(student, { transaction }).catch(() => false);
    if (!ok) throw new Error('Student is not linked to this parent');
  }
  return { parent, student };
}

async function recalculateFeeAccount(feeId, { transaction } = {}) {
  if (!feeId) return null;
  const fee = await Fee.findByPk(feeId, { transaction });
  if (!fee) return null;
  const rows = await Payment.findAll({
    where: { feeId, schoolCode: fee.schoolCode, paymentType: { [Op.in]: ['fee', 'school_fee'] } },
    order: [['createdAt', 'ASC']],
    transaction
  });

  let parentPaid = 0;
  let credits = 0;
  const ledger = [];
  for (const row of rows) {
    const status = normalizeStatus(row.status);
    const type = normalizeTransactionType(row.transactionType, row.method);
    const amt = asInt(row.amount);
    const signed = type === 'reversal' || status === 'reversed' ? -amt : amt;
    ledger.push({ paymentId: row.id, amount: row.amount, status, transactionType: type, method: row.method, reference: row.reference, at: row.paymentDate || row.completedAt || row.createdAt });
    if (!isApproved(status) && status !== 'reversed') continue;
    if (isCreditType(type)) credits += signed;
    else if (type !== 'subscription') parentPaid += signed;
  }
  parentPaid = Math.max(0, parentPaid);
  credits = Math.max(0, credits);
  const covered = Math.min(asInt(fee.totalAmount), parentPaid + credits);
  const next = {
    parentPaidAmount: Math.min(parentPaid, asInt(fee.totalAmount)),
    creditAmount: Math.min(credits, Math.max(0, asInt(fee.totalAmount) - Math.min(parentPaid, asInt(fee.totalAmount)))),
    paidAmount: covered,
    payments: ledger,
    sourceBreakdown: { parentPaidAmount: parentPaid, creditAmount: credits, coveredAmount: covered },
    status: feeStatus({ ...fee.toJSON(), parentPaidAmount: parentPaid, creditAmount: credits }),
    lastReconciledAt: new Date(),
    lastTransactionAt: rows.length ? rows[rows.length - 1].createdAt : fee.lastTransactionAt
  };
  await fee.update(next, { transaction });
  return fee.reload({ transaction });
}

async function recordTransaction({ user, schoolCode, studentId, feeId, amount, method, transactionType, status = 'pending', reference, source = 'admin', parentId = null, notes = null, processedBy = null, approvedBy = null, paymentDate = null, receiptUrl = null, metadata = {}, transaction }) {
  const payAmount = cleanAmount(amount);
  const fee = await Fee.findOne({ where: { id: feeId, studentId, schoolCode }, transaction });
  if (!fee) throw new Error('Fee account not found for this student');
  const student = await findStudentInSchool({ schoolCode, studentId, transaction });
  if (!student) throw new Error('Student not found in this school');
  const normMethod = normalizeMethod(method);
  const normType = normalizeTransactionType(transactionType, normMethod);
  const normStatus = normalizeStatus(status);
  if(isApproved(normStatus))throw new Error('Manual payment creation cannot start as completed; create it pending and use authorized review.');
  const ref = String(reference || transactionId(normMethod.toUpperCase())).trim().toUpperCase();
  const duplicate = await Payment.findOne({ where: { schoolCode, reference: ref }, transaction });
  if (duplicate) throw new Error('This payment/reference already exists. Use a unique reference number.');
  const trail = [{ action: 'finance_transaction_created', actorUserId: user?.id || null, actorRole: user?.role || null, at: new Date().toISOString(), status: normStatus, method: normMethod, transactionType: normType }];
  const payment = await Payment.create({
    schoolCode,
    studentId,
    parentId,
    feeId,
    feeStructureId: fee.feeStructureId ? Number(fee.feeStructureId) : null,
    amount: payAmount,
    method: normMethod,
    transactionType: normType,
    status: normStatus,
    reference: ref,
    source,
    processedBy: processedBy || user?.id || null,
    verifiedBy: isApproved(normStatus) ? (approvedBy || user?.id || null) : null,
    approvedBy: isApproved(normStatus) ? (approvedBy || user?.id || null) : null,
    verifiedAt: isApproved(normStatus) ? new Date() : null,
    completedAt: isApproved(normStatus) ? new Date() : null,
    paymentDate: paymentDate ? new Date(paymentDate) : new Date(),
    receiptUrl,
    notes,
    paymentType: 'fee',
    paidTo: 'school',
    paymentGateway: normMethod,
    currency: 'KES',
    metadata: { ...metadata, studentName: studentName(student), className: className(student, fee), term: fee.term, year: fee.year },
    auditTrail: trail,
    locked: true,
    transactionId: transactionId(normMethod.toUpperCase())
  }, { transaction });
  if (isApproved(normStatus) || normStatus === 'reversed') await recalculateFeeAccount(fee.id, { transaction });
  await createFinanceAlerts({ schoolCode, student, parentId, payment, action: 'created', transaction });
  await writeAudit({ schoolCode, user, action: 'finance_transaction_created', entityId: payment.id, after: payment.toJSON(), metadata: { studentId, feeId, method: normMethod, transactionType: normType } });
  realtimeSync.emitPaymentUpdate(schoolCode, { paymentId: payment.id, studentId, feeId, status: normStatus, action: 'finance_transaction_created' });
  return payment;
}

async function updateTransactionStatus({ user, schoolCode, paymentId, status, notes = null, manualReviewOnly = false }) {
  return sequelize.transaction(async (transaction) => {
    const where = { id: paymentId, schoolCode, paymentType: { [Op.in]: ['fee', 'school_fee'] }, paidTo: 'school' };
    if (manualReviewOnly) {
      where.status = { [Op.in]: ['pending', 'pending_verification'] };
      where[Op.or] = [
        { promptType: 'manual_instructions' },
        { paymentGateway: { [Op.in]: ['manual', 'cash', 'bank', 'card', 'manual_mpesa', 'admin_adjustment', 'bursary', 'scholarship', 'waiver', 'discount', 'adjustment'] } }
      ];
    }
    const payment = await Payment.findOne({ where, transaction });
    if (!payment) throw new Error('Payment not found');
    const before = payment.toJSON();
    const normStatus = normalizeStatus(status);
    if(isApproved(normStatus)&&!manualReviewOnly)throw new Error('Payment completion requires the authorized manual-review workflow.');
    const trail = Array.isArray(payment.auditTrail) ? payment.auditTrail : [];
    trail.push({ action: `finance_transaction_${normStatus}`, actorUserId: user?.id || null, actorRole: user?.role || null, at: new Date().toISOString(), notes });
    await payment.update({
      status: normStatus,
      notes: notes || payment.notes,
      verifiedBy: isApproved(normStatus) ? user?.id || null : payment.verifiedBy,
      approvedBy: isApproved(normStatus) ? user?.id || null : payment.approvedBy,
      verifiedAt: isApproved(normStatus) ? new Date() : payment.verifiedAt,
      completedAt: isApproved(normStatus) ? new Date() : payment.completedAt,
      completionAuthority:isApproved(normStatus)?'authorized_manual_review':payment.completionAuthority,
      completionEvidence:isApproved(normStatus)?{reviewedBy:user?.id||null,reviewerRole:user?.role||null,schoolCode,notes:notes||null,reference:payment.reference}:payment.completionEvidence,
      completionCertifiedAt:isApproved(normStatus)?new Date():payment.completionCertifiedAt,
      auditTrail: trail
    }, { transaction, paymentCertification:isApproved(normStatus)?'authorized_manual_review':undefined });
    const fee = await recalculateFeeAccount(payment.feeId, { transaction });
    const student = await findStudentInSchool({ schoolCode, studentId: payment.studentId, transaction });
    if (student) await createFinanceAlerts({ schoolCode, student, parentId: payment.parentId, payment, action: normStatus, transaction });
    await writeAudit({ schoolCode, user, action: `finance_transaction_${normStatus}`, entityId: payment.id, before, after: payment.toJSON() });
    realtimeSync.emitPaymentUpdate(schoolCode, { paymentId: payment.id, studentId: payment.studentId, feeId: payment.feeId, status: normStatus, action: `finance_transaction_${normStatus}` });
    return { payment, fee };
  });
}

function decorateFeeAccount(fee, student = null) {
  const row = fee.toJSON ? fee.toJSON() : fee;
  const parentPaidAmount = asInt(row.parentPaidAmount ?? row.paidAmount);
  const creditAmount = asInt(row.creditAmount);
  const totalAmount = asInt(row.totalAmount);
  const balance = Math.max(0, totalAmount - parentPaidAmount - creditAmount);
  return {
    ...row,
    totalAmount,
    parentPaidAmount,
    creditAmount,
    paidAmount: parentPaidAmount + creditAmount,
    balance,
    displayStatus: balance <= 0 ? 'Paid' : (parentPaidAmount || creditAmount ? 'Partially Paid' : 'Unpaid'),
    studentName: studentName(student || row.Student),
    className: className(student || row.Student, row)
  };
}

function decoratePayment(payment) {
  const row = payment.toJSON ? payment.toJSON() : payment;
  const txType = normalizeTransactionType(row.transactionType, row.method);
  return {
    ...row,
    statusLabel: row.status === 'completed' ? 'Approved / Successful' : row.status,
    transactionTypeLabel: isCreditType(txType) ? 'Bursary / Credit' : txType,
    studentName: studentName(row.Student),
    parentName: row.Parent?.User?.name || row.metadata?.parentName || null,
    className: className(row.Student, row.Fee),
    feeTerm: row.Fee?.term || row.metadata?.term || null,
    feeYear: row.Fee?.year || row.metadata?.year || null,
    feeTotalAmount: asInt(row.Fee?.totalAmount),
    feeParentPaidAmount: asInt(row.Fee?.parentPaidAmount ?? row.Fee?.paidAmount),
    feeCreditAmount: asInt(row.Fee?.creditAmount),
    feePaidAmount: asInt(row.Fee?.paidAmount),
    feeBalance: row.Fee ? feeBalance(row.Fee) : 0
  };
}

async function getStudentFinance({ schoolCode, studentId, parentUserId = null }) {
  let parent = null;
  let student = null;
  if (parentUserId) {
    ({ parent, student } = await assertParentOwnsStudent({ parentUserId, studentId }));
    schoolCode = student.schoolCode || student.User?.schoolCode;
  }
  else student = await findStudentInSchool({ schoolCode, studentId });
  if (!student) throw new Error('Student not found');
  const accounts = await Fee.findAll({ where: { schoolCode, studentId }, include: [{ model: Student, include: [{ model: User, attributes: ['id', 'name', 'schoolCode'] }, { model: Class, required: false }] }], order: [['year', 'DESC'], ['term', 'DESC'], ['createdAt', 'DESC']] });
  const decoratedAccounts = accounts.map(a => decorateFeeAccount(a, student));
  const totals = decoratedAccounts.reduce((acc, a) => {
    acc.totalExpected += a.totalAmount;
    acc.parentPaidAmount += a.parentPaidAmount;
    acc.creditAmount += a.creditAmount;
    acc.totalCovered += a.parentPaidAmount + a.creditAmount;
    acc.balance += a.balance;
    return acc;
  }, { totalExpected: 0, parentPaidAmount: 0, creditAmount: 0, totalCovered: 0, balance: 0 });
  return { student: { id: student.id, name: studentName(student), className: className(student), elimuid: student.elimuid, admissionNumber: student.admissionNumber }, parentId: parent?.id || null, accounts: decoratedAccounts, totals };
}

async function getStudentHistory({ schoolCode, studentId, parentUserId = null, status = 'all', transactionType = 'all', method = 'all', feeId = null }) {
  if (parentUserId) {
    const owned = await assertParentOwnsStudent({ parentUserId, studentId });
    schoolCode = owned.student.schoolCode || owned.student.User?.schoolCode;
  }
  const where = { schoolCode, studentId, paymentType: { [Op.in]: ['fee', 'school_fee'] }, paidTo: 'school' };
  if (feeId) where.feeId = feeId;
  const rows = await Payment.findAll({
    where,
    include: [
      { model: Student, include: [{ model: User, attributes: ['id', 'name', 'schoolCode'] }, { model: Class, required: false }] },
      { model: Parent, include: [{ model: User, attributes: ['id', 'name', 'email', 'phone'] }], required: false },
      { model: Fee, required: false }
    ],
    order: [['createdAt', 'DESC']],
    limit: 500
  });
  return rows.map(decoratePayment).filter(row => {
    const s = String(status || 'all').toLowerCase();
    const t = String(transactionType || 'all').toLowerCase();
    const m = String(method || 'all').toLowerCase();
    if (s !== 'all') {
      if (s === 'successful' || s === 'approved') { if (!isApproved(row.status)) return false; }
      else if (String(row.status).toLowerCase() !== s) return false;
    }
    if (t !== 'all') {
      if (t === 'credits' || t === 'bursaries') { if (!isCreditType(row.transactionType)) return false; }
      else if (String(row.transactionType || '').toLowerCase() !== t) return false;
    }
    if (m !== 'all' && String(row.method || '').toLowerCase() !== m) return false;
    return true;
  });
}

async function getAdminSummary({ schoolCode }) {
  const accounts = await Fee.findAll({ where: { schoolCode }, include: [{ model: Student, include: [{ model: User, attributes: ['id', 'name'] }, { model: Class, required: false }] }] });
  const rows = accounts.map(a => decorateFeeAccount(a, a.Student));
  const summary = rows.reduce((acc, a) => {
    acc.totalExpected += a.totalAmount;
    acc.parentPaidAmount += a.parentPaidAmount;
    acc.creditAmount += a.creditAmount;
    acc.totalCovered += a.parentPaidAmount + a.creditAmount;
    acc.outstanding += a.balance;
    if (a.balance > 0) acc.defaulters += 1;
    return acc;
  }, { totalExpected: 0, parentPaidAmount: 0, creditAmount: 0, totalCovered: 0, outstanding: 0, defaulters: 0 });
  const pendingPayments = await Payment.count({ where: { schoolCode, paymentType: { [Op.in]: ['fee', 'school_fee'] }, paidTo: 'school', status: { [Op.in]: ['pending', 'pending_verification', 'pending_customer_action', 'pending_provider_confirmation'] } } });
  const failedPayments = await Payment.count({ where: { schoolCode, paymentType: { [Op.in]: ['fee', 'school_fee'] }, paidTo: 'school', status: { [Op.in]: ['failed', 'rejected', 'pending_provider_error'] } } });
  return { ...summary, pendingPayments, failedPayments, studentsWithBalances: rows.filter(a => a.balance > 0), accounts: rows };
}

module.exports = {
  APPROVED,
  CREDIT_TYPES,
  cleanAmount,
  normalizeStatus,
  normalizeMethod,
  normalizeTransactionType,
  isApproved,
  isCreditType,
  feeBalance,
  recalculateFeeAccount,
  recordTransaction,
  updateTransactionStatus,
  assertParentOwnsStudent,
  findStudentInSchool,
  getStudentFinance,
  getStudentHistory,
  getAdminSummary,
  decorateFeeAccount,
  decoratePayment
};
