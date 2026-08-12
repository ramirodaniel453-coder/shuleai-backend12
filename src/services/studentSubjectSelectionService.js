'use strict';

const { sequelize } = require('../models');

async function listStudentSubjectSelections({ schoolCode, studentId, classId = null }) {
  const where = ['"schoolCode" = :schoolCode', '"studentId" = :studentId'];
  const replacements = { schoolCode, studentId };
  if (classId) { where.push('"classId" = :classId'); replacements.classId = classId; }
  const [rows] = await sequelize.query(`SELECT * FROM "StudentSubjectSelections" WHERE ${where.join(' AND ')} ORDER BY "subjectName" ASC`, { replacements });
  return rows || [];
}

async function replaceStudentSubjectSelections({
  schoolCode,
  studentId,
  classId,
  pathway = null,
  track = null,
  subjects = [],
  actorUserId = null,
  requestedBy = null,
  approvedBy = null,
  defaultStatus = 'taking',
  metadata = {}
}) {
  const now = new Date();
  await sequelize.query(
    'DELETE FROM "StudentSubjectSelections" WHERE "schoolCode" = :schoolCode AND "studentId" = :studentId AND (:classId::int IS NULL OR "classId" = :classId)',
    { replacements: { schoolCode, studentId, classId: classId || null } }
  );

  for (const subject of subjects || []) {
    const subjectMeta = { ...(metadata || {}), ...(subject.metadata || {}) };
    const finalStatus = subject.status || defaultStatus || 'taking';
    const finalApprovedBy = subject.approvedBy || approvedBy || (finalStatus === 'taking' ? actorUserId : null);
    await sequelize.query(`
      INSERT INTO "StudentSubjectSelections"
        ("schoolCode","studentId","classId","subjectId","subjectName","status","pathway","track","isCompulsory","isElective","requestedBy","approvedBy","approvedAt","metadata","createdAt","updatedAt")
      VALUES
        (:schoolCode,:studentId,:classId,:subjectId,:subjectName,:status,:pathway,:track,:isCompulsory,:isElective,:requestedBy,:approvedBy,:approvedAt,:metadata::jsonb,:createdAt,:updatedAt)
    `, { replacements: {
      schoolCode, studentId, classId: classId || null,
      subjectId: subject.subjectId || subject.id || null,
      subjectName: subject.subjectName || subject.name || subject.subject,
      status: finalStatus,
      pathway: subject.pathway || pathway || null,
      track: subject.track || track || null,
      isCompulsory: !!subject.isCompulsory,
      isElective: subject.isElective === undefined ? !subject.isCompulsory : !!subject.isElective,
      requestedBy: subject.requestedBy || requestedBy || actorUserId || null,
      approvedBy: finalApprovedBy || null,
      approvedAt: finalApprovedBy ? now : null,
      metadata: JSON.stringify(subjectMeta),
      createdAt: now,
      updatedAt: now
    }});
  }
  return listStudentSubjectSelections({ schoolCode, studentId, classId });
}

module.exports = { listStudentSubjectSelections, replaceStudentSubjectSelections };
