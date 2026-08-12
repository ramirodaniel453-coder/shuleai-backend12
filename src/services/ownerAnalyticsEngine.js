const { sequelize } = require('../models');
const { QueryTypes } = require('sequelize');

async function q(sql, replacements = {}) {
  return sequelize.query(sql, { replacements, type: QueryTypes.SELECT });
}

async function scalar(sql, replacements = {}, key = 'value') {
  try {
    const rows = await q(sql, replacements);
    const row = rows[0] || {};
    return Number(row[key] ?? row.count ?? row.total ?? row.value ?? 0) || 0;
  } catch (_) { return 0; }
}

function monthLabels(count = 6) {
  const out = [];
  const now = new Date();
  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(d.toLocaleString('en-US', { month: 'short' }));
  }
  return out;
}

function asChart(type, title, labels = [], datasets = [], extra = {}) {
  return { type, title, labels, datasets, ...extra };
}

function oneDataset(label, data, extra = {}) {
  return { label, data: data.map(v => Number(v || 0)), ...extra };
}

async function schoolFilterForRole(user, params = {}) {
  const role = user?.role;
  if (role === 'super_admin' || role === 'superadmin') return { allSchools: true, schoolCode: params.schoolCode || null };
  return { allSchools: false, schoolCode: user?.schoolCode };
}

async function getEnrollmentTrend({ schoolCode, allSchools }) {
  const labels = monthLabels(6);
  const replacements = { schoolCode };
  const schoolClause = allSchools || !schoolCode ? '' : 'AND u."schoolCode" = :schoolCode';
  const rows = await q(`
    SELECT TO_CHAR(DATE_TRUNC('month', s."createdAt"), 'Mon') AS month, COUNT(*)::int AS count
    FROM "Students" s
    JOIN "Users" u ON u.id = s."userId"
    WHERE s."createdAt" >= DATE_TRUNC('month', NOW()) - INTERVAL '5 months' ${schoolClause}
    GROUP BY 1, DATE_TRUNC('month', s."createdAt")
    ORDER BY DATE_TRUNC('month', s."createdAt") ASC
  `, replacements).catch(() => []);
  const map = Object.fromEntries(rows.map(r => [r.month, Number(r.count || 0)]));
  return asChart('line', 'Enrollment Trend', labels, [oneDataset('Students', labels.map(m => map[m] || 0))]);
}

async function getGradeDistribution({ schoolCode, allSchools, classIds = null, studentId = null }) {
  const repl = { schoolCode, classIds, studentId };
  const schoolClause = allSchools || !schoolCode ? '' : 'AND u."schoolCode" = :schoolCode';
  const classClause = Array.isArray(classIds) && classIds.length ? 'AND s."classId" IN (:classIds)' : '';
  const studentClause = studentId ? 'AND s."id" = :studentId' : '';
  const rows = await q(`
    SELECT COALESCE(NULLIF(s.grade,''), c."name", 'Unassigned') AS label, COUNT(*)::int AS count
    FROM "Students" s
    JOIN "Users" u ON u.id = s."userId"
    LEFT JOIN "Classes" c ON c."id" = s."classId"
    WHERE COALESCE(s.status, 'active') = 'active' ${schoolClause} ${classClause} ${studentClause}
    GROUP BY 1 ORDER BY 1 ASC
  `, repl).catch(() => []);
  return asChart('doughnut', 'Grade / Class Distribution', rows.map(r => r.label), [oneDataset('Students', rows.map(r => r.count))], { cutout: '70%' });
}

async function getAttendanceTrend({ schoolCode, allSchools, classIds = null, studentId = null }) {
  const labels = ['Week 1', 'Week 2', 'Week 3', 'Week 4'];
  let where = 'WHERE a.date >= CURRENT_DATE - INTERVAL \'28 days\'';
  const repl = { schoolCode, studentId, classIds };
  if (!allSchools && schoolCode) where += ' AND a."schoolCode" = :schoolCode';
  if (studentId) where += ' AND a."studentId" = :studentId';
  if (Array.isArray(classIds) && classIds.length) where += ' AND a."classId" IN (:classIds)';
  const rows = await q(`
    SELECT CEIL(EXTRACT(DAY FROM (CURRENT_DATE - a.date)) / 7.0)::int AS bucket,
           LOWER(a.status) AS status, COUNT(*)::int AS count
    FROM "Attendances" a ${where}
    GROUP BY 1, 2
  `, repl).catch(() => []);
  const present = [0,0,0,0], absent = [0,0,0,0];
  rows.forEach(r => {
    const idx = Math.max(0, Math.min(3, 3 - Number(r.bucket || 0)));
    if (String(r.status).includes('present')) present[idx] += Number(r.count || 0);
    if (String(r.status).includes('absent')) absent[idx] += Number(r.count || 0);
  });
  return asChart('stackedBar', 'Monthly Attendance Trends', labels, [oneDataset('Present', present), oneDataset('Absent', absent)]);
}

async function getSubjectPerformance({ schoolCode, allSchools, classIds = null, studentId = null }) {
  let where = 'WHERE 1=1';
  const repl = { schoolCode, classIds, studentId };
  if (!allSchools && schoolCode) where += ' AND ar."schoolCode" = :schoolCode';
  if (studentId) where += ' AND ar."studentId" = :studentId';
  if (Array.isArray(classIds) && classIds.length) where += ' AND ar."classId" IN (:classIds)';
  const rows = await q(`
    SELECT COALESCE(NULLIF(ar.subject,''),'General') AS subject, ROUND(AVG(COALESCE(ar.score,0)))::int AS average
    FROM "AcademicRecords" ar ${where}
    GROUP BY 1 ORDER BY average DESC LIMIT 12
  `, repl).catch(() => []);
  const labels = rows.map(r => r.subject);
  const values = rows.map(r => r.average);
  return {
    bar: asChart('bar', 'Subject-wise Performance', labels, [oneDataset('Average Score', values)]),
    radar: asChart('radar', 'Grade Performance Distribution', labels.slice(0, 8), [oneDataset('Average Score', values.slice(0, 8))])
  };
}

async function getFeeStatus({ schoolCode, allSchools, classIds = null, studentId = null }) {
  const repl = { schoolCode, classIds, studentId };
  let where = 'WHERE 1=1';
  if (!allSchools && schoolCode) where += ' AND f."schoolCode" = :schoolCode';
  if (studentId) where += ' AND f."studentId" = :studentId';
  if (Array.isArray(classIds) && classIds.length) where += ' AND (f."classId" IN (:classIds) OR f."studentId" IN (SELECT id FROM "Students" WHERE "classId" IN (:classIds)))';
  const rows = await q(`SELECT COALESCE(NULLIF(f.status,''),'unpaid') AS status, COUNT(*)::int AS count FROM "Fees" f ${where} GROUP BY 1`, repl).catch(() => []);
  const map = { paid: 0, partial: 0, unpaid: 0, pending: 0 };
  rows.forEach(r => { map[String(r.status).toLowerCase()] = Number(r.count || 0); });
  return asChart('doughnut', 'Fee Status Distribution', Object.keys(map), [oneDataset('Accounts', Object.values(map))], { cutout: '70%' });
}

async function getHomeworkSubmission({ schoolCode, allSchools, classIds = null, studentId = null }) {
  const repl = { schoolCode, classIds, studentId };
  let where = 'WHERE hta.status IS NOT NULL';
  if (studentId) where += ' AND hta."studentId" = :studentId';
  if (!allSchools && schoolCode) where += ' AND ht."schoolCode" = :schoolCode';
  if (Array.isArray(classIds) && classIds.length) where += ' AND ht."classId" IN (:classIds)';
  const rows = await q(`
    SELECT CASE WHEN hta."completedAt" IS NOT NULL AND ht."dueDate" IS NOT NULL AND hta."completedAt" <= ht."dueDate" THEN 'On Time' ELSE 'Late / Pending' END AS label,
           COUNT(*)::int AS count
    FROM "HomeTaskAssignments" hta
    JOIN "HomeTasks" ht ON ht.id = hta."taskId"
    ${where}
    GROUP BY 1
  `, repl).catch(() => []);
  const map = { 'On Time': 0, 'Late / Pending': 0 };
  rows.forEach(r => { map[r.label] = Number(r.count || 0); });
  return asChart('doughnut', 'Homework Submission Pattern', Object.keys(map), [oneDataset('Submissions', Object.values(map))], { cutout: '70%' });
}

async function getTutorUsage({ schoolCode, allSchools, studentId = null }) {
  const repl = { schoolCode, studentId };
  let where = 'WHERE tu."createdAt" >= NOW() - INTERVAL \'30 days\'';
  if (!allSchools && schoolCode) where += ' AND tu."schoolCode" = :schoolCode';
  if (studentId) where += ' AND tu."studentId" = :studentId';
  const rows = await q(`
    SELECT TO_CHAR(tu."createdAt", 'Mon DD') AS label, COUNT(*)::int AS count
    FROM "TutorUsages" tu ${where}
    GROUP BY 1, DATE_TRUNC('day', tu."createdAt")
    ORDER BY DATE_TRUNC('day', tu."createdAt") ASC LIMIT 14
  `, repl).catch(() => []);
  return asChart('bar', 'AI Tutor Usage', rows.map(r => r.label), [oneDataset('Tutor Questions', rows.map(r => r.count))]);
}

async function getCareerDistribution({ schoolCode, allSchools, studentId = null }) {
  const repl = { schoolCode, studentId };
  let where = 'WHERE COALESCE(sci."isActive", true) = true';
  if (!allSchools && schoolCode) where += ' AND sci."schoolCode" = :schoolCode';
  if (studentId) where += ' AND sci."studentId" = :studentId';
  const rows = await q(`
    SELECT COALESCE(NULLIF(sci."careerName",''),'Career Interest') AS career, COUNT(*)::int AS count
    FROM "StudentCareerInterests" sci ${where}
    GROUP BY 1 ORDER BY count DESC LIMIT 10
  `, repl).catch(() => []);
  return asChart('doughnut', 'Career Interest Distribution', rows.map(r => r.career), [oneDataset('Students', rows.map(r => r.count))], { cutout: '70%' });
}

async function getOverview({ schoolCode, allSchools, classIds = null, studentId = null }) {
  const repl = { schoolCode, studentId, classIds };
  const userSchoolJoin = allSchools || !schoolCode ? '' : 'AND u."schoolCode" = :schoolCode';
  const classClause = Array.isArray(classIds) && classIds.length ? 'AND s."classId" IN (:classIds)' : '';
  const studentClause = studentId ? 'AND s.id = :studentId' : '';
  const totalStudents = await scalar(`SELECT COUNT(*)::int AS value FROM "Students" s JOIN "Users" u ON u.id=s."userId" WHERE s.status='active' ${userSchoolJoin} ${classClause} ${studentClause}`, repl);
  const totalTeachers = studentId
    ? await scalar(`SELECT COUNT(DISTINCT t.id)::int AS value FROM "Teachers" t JOIN "Users" u ON u.id=t."userId" JOIN "Students" s ON s."id"=:studentId LEFT JOIN "TeacherSubjectAssignments" tsa ON tsa."teacherId"=t.id AND tsa."classId"=s."classId" WHERE u.role='teacher' ${allSchools || !schoolCode ? '' : 'AND u."schoolCode"=:schoolCode'} AND (t."classId"=s."classId" OR tsa."classId"=s."classId")`, repl)
    : Array.isArray(classIds) && classIds.length
      ? await scalar(`SELECT COUNT(DISTINCT t.id)::int AS value FROM "Teachers" t JOIN "Users" u ON u.id=t."userId" LEFT JOIN "TeacherSubjectAssignments" tsa ON tsa."teacherId"=t.id WHERE u.role='teacher' ${allSchools || !schoolCode ? '' : 'AND u."schoolCode"=:schoolCode'} AND (t."classId" IN (:classIds) OR tsa."classId" IN (:classIds))`, repl)
      : await scalar(`SELECT COUNT(*)::int AS value FROM "Teachers" t JOIN "Users" u ON u.id=t."userId" WHERE u.role='teacher' ${allSchools || !schoolCode ? '' : 'AND u."schoolCode"=:schoolCode'}`, repl);
  const totalClasses = studentId
    ? await scalar(`SELECT COUNT(DISTINCT s."classId")::int AS value FROM "Students" s JOIN "Users" u ON u.id=s."userId" WHERE s.id=:studentId ${allSchools || !schoolCode ? '' : 'AND u."schoolCode"=:schoolCode'}`, repl)
    : Array.isArray(classIds) && classIds.length
      ? classIds.length
      : await scalar(`SELECT COUNT(*)::int AS value FROM "Classes" c WHERE COALESCE(c."isActive", true)=true ${allSchools || !schoolCode ? '' : 'AND c."schoolCode"=:schoolCode'}`, repl);
  const totalFees = await scalar(`SELECT COALESCE(SUM("totalAmount"),0)::numeric AS value FROM "Fees" WHERE 1=1 ${allSchools || !schoolCode ? '' : 'AND "schoolCode"=:schoolCode'} ${studentId ? 'AND "studentId"=:studentId' : ''}`, repl);
  const paidFees = await scalar(`SELECT COALESCE(SUM("paidAmount"),0)::numeric AS value FROM "Fees" WHERE 1=1 ${allSchools || !schoolCode ? '' : 'AND "schoolCode"=:schoolCode'} ${studentId ? 'AND "studentId"=:studentId' : ''}`, repl);
  const attendanceRows = await q(`SELECT status, COUNT(*)::int AS count FROM "Attendances" WHERE date >= CURRENT_DATE - INTERVAL '30 days' ${allSchools || !schoolCode ? '' : 'AND "schoolCode"=:schoolCode'} ${studentId ? 'AND "studentId"=:studentId' : ''} GROUP BY status`, repl).catch(() => []);
  const attTotal = attendanceRows.reduce((s, r) => s + Number(r.count || 0), 0);
  const present = attendanceRows.filter(r => String(r.status).toLowerCase().includes('present')).reduce((s, r) => s + Number(r.count || 0), 0);
  return {
    totalStudents,
    totalTeachers,
    totalClasses,
    totalExpectedFees: totalFees,
    totalPaidFees: paidFees,
    feeCollectionRate: totalFees ? Math.round((paidFees / totalFees) * 100) : 0,
    attendanceRate: attTotal ? Math.round((present / attTotal) * 100) : 0
  };
}

async function getAssignedClassIds(user) {
  if (!user || user.role !== 'teacher') return null;
  const rows = await q(`
    SELECT DISTINCT COALESCE(t."classId", tsa."classId") AS "classId"
    FROM "Teachers" t
    LEFT JOIN "TeacherSubjectAssignments" tsa ON tsa."teacherId" = t.id
    WHERE t."userId" = :userId
  `, { userId: user.id }).catch(() => []);
  return rows.map(r => r.classId).filter(Boolean);
}

async function getParentStudentId(user, requestedStudentId) {
  if (!user || user.role !== 'parent') return requestedStudentId || null;
  const rows = await q(`
    SELECT sp."studentId"
    FROM "Parents" p
    JOIN "StudentParents" sp ON sp."parentId" = p.id
    JOIN "Students" s ON s.id = sp."studentId"
    JOIN "Users" u ON u.id = s."userId"
    WHERE p."userId" = :userId AND u."schoolCode" = :schoolCode
    ORDER BY sp."createdAt" ASC
  `, { userId: user.id, schoolCode: user.schoolCode }).catch(() => []);
  const ids = rows.map(r => Number(r.studentId));
  const reqId = Number(requestedStudentId || 0);
  if (reqId && ids.includes(reqId)) return reqId;
  return ids[0] || null;
}

async function getStudentSelfId(user) {
  if (!user || user.role !== 'student') return null;
  const rows = await q('SELECT id FROM "Students" WHERE "userId" = :userId LIMIT 1', { userId: user.id }).catch(() => []);
  return rows[0]?.id || null;
}

async function getRoleAnalytics(user, params = {}) {
  const role = user?.role === 'superadmin' ? 'super_admin' : user?.role;
  const baseScope = await schoolFilterForRole(user, params);
  let scope = { ...baseScope };
  if (role === 'teacher') scope.classIds = await getAssignedClassIds(user);
  if (role === 'parent') scope.studentId = await getParentStudentId(user, params.studentId);
  if (role === 'student') scope.studentId = await getStudentSelfId(user);

  const subject = await getSubjectPerformance(scope);
  const charts = {
    enrollmentTrend: await getEnrollmentTrend(scope),
    gradeDistribution: await getGradeDistribution(scope),
    monthlyAttendanceTrend: await getAttendanceTrend(scope),
    subjectPerformance: subject.bar,
    performanceRadar: subject.radar,
    feeStatus: await getFeeStatus(scope),
    homeworkSubmission: await getHomeworkSubmission(scope),
    aiTutorUsage: await getTutorUsage(scope),
    careerDistribution: await getCareerDistribution(scope)
  };
  return {
    success: true,
    role,
    scope: { schoolCode: scope.schoolCode || 'all', studentId: scope.studentId || null, classIds: scope.classIds || null },
    overview: await getOverview(scope),
    charts,
    generatedAt: new Date().toISOString(),
    note: 'Charts are generated from Shule AI backend data with strict role/tenant scope.'
  };
}

module.exports = { getRoleAnalytics };
