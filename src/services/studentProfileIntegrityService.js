'use strict';

const { sequelize, User, Student, AuditLog } = require('../models');

function generatedElimuId(userId) {
  return `ELI-AUTO-${String(userId).padStart(6, '0')}`;
}

async function reconcileSchool(schoolCode, actorUserId = null) {
  if (!schoolCode) return { scanned: 0, created: 0, skipped: 0, reactivatedClasses: 0 };
  const reactivated = await sequelize.transaction(async transaction => {
    const [rows] = await sequelize.query(`
      UPDATE "Classes" c
       SET "isActive" = true, "updatedAt" = NOW()
     WHERE c."schoolCode" = :schoolCode
       AND c."isActive" = false
       AND EXISTS (
         SELECT 1
           FROM "Students" s
           JOIN "Users" u ON u.id = s."userId"
          WHERE s."classId" = c.id
            AND COALESCE(s.status::text, 'active') = 'active'
            AND COALESCE(u."isActive", true) = true
       )
      RETURNING c.id
    `, { replacements: { schoolCode }, transaction });
    if (rows.length) await AuditLog.bulkCreate(rows.map(row => ({
      schoolCode,
      actorUserId,
      actorRole: actorUserId ? 'admin' : 'system',
      module: 'class_integrity',
      action: 'class_with_active_students_reactivated',
      entityType: 'Class',
      entityId: String(row.id),
      before: { isActive: false },
      after: { isActive: true },
      reason: 'An inactive class contained active student accounts',
      metadata: { automatic: true, studentDataPreserved: true }
    })), { transaction });
    return rows;
  });
  const [candidates] = await sequelize.query(`
    SELECT u.id
      FROM "Users" u
      LEFT JOIN "Students" s ON s."userId" = u.id
     WHERE u.role = 'student'
       AND u."schoolCode" = :schoolCode
       AND s.id IS NULL
     ORDER BY u.id
  `, { replacements: { schoolCode } });

  let created = 0;
  let skipped = 0;
  for (const candidate of candidates) {
    await sequelize.transaction(async transaction => {
      const userId = Number(candidate.id);
      await sequelize.query('SELECT pg_advisory_xact_lock(2041, :userId)', { replacements: { userId }, transaction });
      const existing = await Student.findOne({ where: { userId }, transaction });
      if (existing) { skipped += 1; return; }
      const user = await User.findOne({ where: { id: userId, role: 'student', schoolCode }, transaction, lock: transaction.LOCK.UPDATE });
      if (!user) { skipped += 1; return; }
      const student = await Student.create({
        userId,
        schoolCode,
        elimuid: generatedElimuId(userId),
        grade: 'Not Assigned',
        classId: null,
        status: 'active',
        approvalStatus: 'approved'
      }, { transaction });
      await AuditLog.create({
        schoolCode,
        actorUserId,
        actorRole: actorUserId ? 'admin' : 'system',
        module: 'student_integrity',
        action: 'missing_profile_repaired',
        entityType: 'Student',
        entityId: String(student.id),
        after: { userId, studentId: student.id, grade: student.grade, classId: null },
        reason: 'Student-role user had no Student profile',
        metadata: { automatic: true, reversible: true }
      }, { transaction });
      created += 1;
    });
  }
  return { scanned: candidates.length, created, skipped, reactivatedClasses: reactivated.length };
}

module.exports = { reconcileSchool, generatedElimuId };
