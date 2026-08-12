const { Op } = require('sequelize');
const { Alert, User, Student, Parent, Teacher, Class, SchoolCalendar, sequelize } = require('../models');
const ownership = require('./parentOwnershipService');

function normalizeRole(role) {
  const r = String(role || '').toLowerCase().replace('-', '_');
  return r === 'superadmin' ? 'super_admin' : r;
}

function normalizeScope(scope) {
  const s = String(scope || '').toLowerCase();
  if (['platform', 'school', 'user'].includes(s)) return s;
  return 'user';
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === '') return [];
  return [value];
}

function alertData(alert) {
  const raw = alert?.toJSON ? alert.toJSON() : (alert || {});
  return raw.data || {};
}

function dataArray(data, ...keys) {
  for (const key of keys) {
    const value = data?.[key];
    if (Array.isArray(value)) return value.map(String);
    if (value !== undefined && value !== null && value !== '') return [String(value)];
  }
  return [];
}

function dataBool(data, ...keys) {
  for (const key of keys) {
    if (data?.[key] === true || String(data?.[key]).toLowerCase() === 'true') return true;
  }
  return false;
}

function dataDate(data, alert, ...keys) {
  for (const key of keys) {
    const value = data?.[key] || alert?.[key];
    if (value) return value;
  }
  return null;
}

async function parentCanViewStudent(userId, studentId, schoolCode) {
  if (!studentId) return true;
  return ownership.ownsStudentId({ parentUserId: userId, studentId, schoolCode });
}

async function teacherCanViewStudent(userId, studentId, schoolCode) {
  if (!studentId) return true;
  const rows = await sequelize.query(
    `SELECT 1
       FROM "Teachers" t
       JOIN "Students" s ON s."id" = :studentId
       JOIN "Users" su ON su."id" = s."userId"
       LEFT JOIN "Classes" c ON c."id" = s."classId"
      WHERE t."userId" = :userId
        AND su."schoolCode" = :schoolCode
        AND (
          t."classId" = s."classId"
          OR c."teacherId" = t."id"
          OR EXISTS (
            SELECT 1 FROM "TeacherSubjectAssignments" tsa
             WHERE tsa."teacherId" = t."id"
               AND tsa."classId" = s."classId"
          )
        )
      LIMIT 1`,
    { replacements: { userId, studentId, schoolCode }, type: sequelize.QueryTypes.SELECT }
  ).catch(() => []);
  return rows.length > 0;
}

async function userMatchesAlert(user, alert, options = {}) {
  if (!user || !alert) return false;
  const raw = alert.toJSON ? alert.toJSON() : alert;
  const data = alertData(raw);
  const role = normalizeRole(user.role);
  const schoolCode = user.schoolCode;
  const scope = normalizeScope(data.scope || raw.scope || (data.platformAlert ? 'platform' : 'user'));

  if (raw.expiresAt && new Date(raw.expiresAt) < new Date()) return false;
  if (data.status && !['active', 'sent', 'published'].includes(String(data.status).toLowerCase())) return false;

  if (scope !== 'platform') {
    const alertSchool = data.schoolCode || raw.schoolCode || raw.data?.schoolCode || null;
    if (alertSchool && schoolCode && String(alertSchool) !== String(schoolCode)) return false;
  }

  const targetUserIds = dataArray(data, 'targetUserIds', 'receiverUserIds', 'userIds');
  if (raw.userId && Number(raw.userId) !== Number(user.id)) return false;
  if (raw.targetUserId && Number(raw.targetUserId) !== Number(user.id)) return false;
  if (targetUserIds.length && !targetUserIds.includes(String(user.id))) return false;

  const allowedRoles = new Set(['student', 'parent', 'teacher', 'admin', 'finance_officer', 'super_admin']);
  const targetRoles = dataArray(data, 'targetRoles', 'receiverRoles', 'roles', 'audienceRoles');
  const singleRole = raw.targetRole || data.targetRole || data.role || raw.role || null;
  const allSchoolRoles = ['student', 'parent', 'teacher', 'admin', 'finance_officer'];
  const expandedTargetRoles = targetRoles.some(r => ['all', 'whole_school', 'school'].includes(String(r).toLowerCase())) ? allSchoolRoles : targetRoles;
  const roleSet = new Set([...expandedTargetRoles, ...(singleRole ? [singleRole] : [])].map(normalizeRole).filter(r => allowedRoles.has(r)));
  if (roleSet.size && !roleSet.has(role)) return false;

  const requestedStudentId = options.studentId ? Number(options.studentId) : null;
  const studentId = Number(raw.studentId || data.studentId || data.student_id || 0) || null;
  const targetStudentIds = dataArray(data, 'targetStudentIds', 'studentIds').map(Number).filter(n => Number.isInteger(n) && n > 0);
  if (requestedStudentId && studentId && Number(studentId) !== requestedStudentId) return false;
  if (requestedStudentId && targetStudentIds.length && !targetStudentIds.includes(requestedStudentId)) return false;

  if (studentId) {
    if (role === 'student') {
      const student = await Student.findOne({ where: { id: studentId, userId: user.id } }).catch(() => null);
      if (!student) return false;
    }
    if (role === 'parent' && !(await parentCanViewStudent(user.id, studentId, schoolCode))) return false;
    if (role === 'teacher' && !(await teacherCanViewStudent(user.id, studentId, schoolCode))) return false;
  }

  if (targetStudentIds.length) {
    const idsToCheck = requestedStudentId ? [requestedStudentId] : targetStudentIds;
    if (role === 'student') {
      const student = await Student.findOne({ where: { id: { [Op.in]: idsToCheck }, userId: user.id } }).catch(() => null);
      if (!student) return false;
    }
    if (role === 'parent') {
      let allowed = false;
      for (const sid of idsToCheck) { if (await parentCanViewStudent(user.id, sid, schoolCode)) { allowed = true; break; } }
      if (!allowed) return false;
    }
    if (role === 'teacher') {
      let allowed = false;
      for (const sid of idsToCheck) { if (await teacherCanViewStudent(user.id, sid, schoolCode)) { allowed = true; break; } }
      if (!allowed) return false;
    }
  }

  const classIds = dataArray(data, 'targetClassIds', 'classIds');
  const classId = raw.classId || data.classId;
  const effectiveClassIds = new Set([...classIds, ...(classId ? [String(classId)] : [])]);
  if (effectiveClassIds.size) {
    if (role === 'student') {
      const student = await Student.findOne({ where: { userId: user.id } }).catch(() => null);
      if (!student || !effectiveClassIds.has(String(student.classId))) return false;
    }
    if (role === 'parent') {
      const parent = await Parent.findOne({ where: { userId: user.id } }).catch(() => null);
      if (!parent) return false;
      const children = await parent.getStudents().catch(() => []);
      if (!children.some(s => effectiveClassIds.has(String(s.classId)))) return false;
    }
    if (role === 'teacher') {
      const teacher = await Teacher.findOne({ where: { userId: user.id } }).catch(() => null);
      if (!teacher) return false;
      const classTeacherMatch = teacher.classId && effectiveClassIds.has(String(teacher.classId));
      const owned = await Class.findOne({ where: { teacherId: teacher.id, id: { [Op.in]: [...effectiveClassIds] } } }).catch(() => null);
      const assigned = await sequelize.query(
        `SELECT 1 FROM "TeacherSubjectAssignments" WHERE "teacherId" = :teacherId AND "classId" IN (:classIds) LIMIT 1`,
        { replacements: { teacherId: teacher.id, classIds: [...effectiveClassIds] }, type: sequelize.QueryTypes.SELECT }
      ).catch(() => []);
      if (!classTeacherMatch && !owned && !assigned.length) return false;
    }
  }

  const createdBy = Number(data.createdBy || data.createdByUserId || 0) || null;
  const hasDirectTarget = !!raw.userId || !!raw.targetUserId || targetUserIds.length > 0;
  const hasRoleTarget = roleSet.size > 0;
  const hasStudentTarget = !!studentId || targetStudentIds.length > 0;
  const hasClassTarget = effectiveClassIds.size > 0;
  if (!hasDirectTarget && !hasRoleTarget && !hasStudentTarget && !hasClassTarget) {
    if (createdBy) return Number(createdBy) === Number(user.id) || role === 'super_admin';
    if (scope === 'platform') return role === 'super_admin';
    if (scope === 'school') return role === 'admin' || role === 'super_admin';
    return false;
  }

  return true;
}

async function getAlertsForUser(user, { studentId = null, limit = 120, calendarOnly = false, upcomingOnly = false } = {}) {
  if (!user) return [];
  const role = normalizeRole(user.role);
  const schoolCode = user.schoolCode || null;
  const safeLimit = Math.min(Number(limit || 120), 500);

  // Fetch a bounded candidate set for this user/school/platform, then apply the
  // single receiver engine below. This prevents dashboard leakage while still
  // allowing user-specific, school-specific and platform-specific alerts to load
  // after refresh even when older rows stored their targeting only in data JSON.
  const or = [
    { userId: user.id },
    { targetUserId: user.id },
    sequelize.literal(`COALESCE("Alert"."data", '{}'::jsonb) @> '{"targetUserIds":[${Number(user.id)}]}'::jsonb`),
    sequelize.literal(`COALESCE("Alert"."data", '{}'::jsonb) @> '{"receiverUserIds":[${Number(user.id)}]}'::jsonb`),
    sequelize.literal(`COALESCE("Alert"."data", '{}'::jsonb) @> '{"targetRoles":["${role}"]}'::jsonb`),
    sequelize.literal(`COALESCE("Alert"."data", '{}'::jsonb) @> '{"receiverRoles":["${role}"]}'::jsonb`),
    { targetRole: role },
    { role }
  ];
  if (schoolCode) {
    or.push(sequelize.literal(`COALESCE("Alert"."data"->>'schoolCode', '') = ${sequelize.escape(String(schoolCode))}`));
  }
  or.push(sequelize.literal(`COALESCE("Alert"."data"->>'scope', '') = 'platform'`));

  const rows = await Alert.findAll({
    where: { [Op.or]: or },
    order: [['createdAt', 'DESC']],
    limit: safeLimit * 4
  }).catch(async () => Alert.findAll({ where: { userId: user.id }, order: [['createdAt', 'DESC']], limit: safeLimit }));

  const safe = [];
  const seen = new Set();
  for (const row of rows) {
    if (!row || seen.has(row.id)) continue;
    seen.add(row.id);
    const data = alertData(row);
    if (data.hiddenByV97) continue;
    if (calendarOnly && !dataBool(data, 'showInCalendar')) continue;
    if (upcomingOnly && !dataBool(data, 'showInUpcomingEvents')) continue;
    if (await userMatchesAlert(user, row, { studentId })) safe.push(row);
    if (safe.length >= safeLimit) break;
  }
  return safe;
}

function alertToCalendarEvent(alert) {
  const raw = alert?.toJSON ? alert.toJSON() : (alert || {});
  const data = raw.data || {};
  const date = dataDate(data, raw, 'eventDate', 'date', 'startDate', 'dueDate', 'scheduledAt') || raw.createdAt;
  return {
    id: `alert-${raw.id}`,
    alertId: raw.id,
    title: raw.title || 'Alert',
    eventName: raw.title || 'Alert',
    description: raw.message || '',
    startDate: date,
    endDate: data.endDate || date,
    date,
    type: raw.type || data.category || 'alert',
    eventType: raw.type || 'alert',
    audience: data.scope || 'user',
    isAlertEvent: true,
    priority: raw.priority || raw.severity || 'info'
  };
}

module.exports = {
  normalizeRole,
  getAlertsForUser,
  userMatchesAlert,
  alertToCalendarEvent
};
