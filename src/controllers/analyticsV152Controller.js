const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const { sequelize, School, Student, Parent, Teacher, User } = require('../models');
const linkage = require('../services/schoolLinkageService');
const { getAlertsForUser } = require('../services/alertReceiverEngine');
const curriculumHelper = require('../utils/curriculumHelper');
const gradingEngine = require('../services/gradingEngine');

const { QueryTypes } = require('sequelize');

function num(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function pct(part, total) { return total ? Math.round((num(part) / num(total)) * 1000) / 10 : 0; }
function round(value, digits = 0) { const p = 10 ** digits; return Math.round(num(value) * p) / p; }
function text(value, fallback = '') { return String(value ?? fallback).trim(); }
function currentYear(query = {}) { const year = Number(query.year || new Date().getFullYear()); return Number.isInteger(year) ? year : new Date().getFullYear(); }
function currentTerm(query = {}) { return ['Term 1', 'Term 2', 'Term 3'].includes(query.term) ? query.term : null; }
function isoDate(value, fallback) { const d = value ? new Date(value) : null; return d && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : fallback; }
function startOfDays(days) { const d = new Date(); d.setDate(d.getDate() - days); return d.toISOString().slice(0, 10); }
function safeName(value, fallback = 'analytics') { return text(value, fallback).replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || fallback; }
function gradeForScore(score, context = {}) {
  const n = num(score, NaN);
  if (!Number.isFinite(n)) return '—';
  const curriculum = context.curriculum || context.system || 'cbc';
  const level = context.level || context.schoolLevel || context.classLevel || 'primary';
  const customScale = context.customScale || context.gradingScale || null;
  return gradingEngine.getGradeFromScore(n, curriculum, level, customScale) || '—';
}
function normalizeSubjectName(value) { return text(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function resolveSchoolLevel(school, scope, options) {
  const settings = school?.settings || {};
  const scopedClass = (options?.classes || []).find(c => Number(c.id) === Number(scope?.classIds?.[0]));
  return scopedClass?.curriculumLevel || settings.schoolLevel || settings.level || school?.schoolLevel || 'primary';
}
function resolveCurriculumContext(school, scope, options) {
  const settings = school?.settings || {};
  const scopedClass = (options?.classes || []).find(c => Number(c.id) === Number(scope?.classIds?.[0]));
  const curriculum = curriculumHelper.normalizeCurriculumKey(scopedClass?.curriculum || school?.system || settings.curriculum || settings.curriculumType || 'cbc');
  const level = resolveSchoolLevel(school, scope, options);
  const customScale = settings.gradingScale || settings.gradeScale || settings.assessmentSettings || null;
  const expectedSubjects = curriculumHelper.getSubjectsForCurriculum(curriculum, level);
  return { curriculum, level, customScale, expectedSubjects };
}
function kpi(label, value, icon, tone = 'teal', hint = '') { return { label, value, icon, tone, hint }; }
function insight(title, message, tone = 'info', time = 'Updated now', icon = 'info') { return { title, message, tone, time, icon }; }
function analyticsFinanceAlertOnly(alert) {
  const row = alert?.toJSON ? alert.toJSON() : (alert || {});
  const data = row.data || {};
  const haystack = [row.type, row.categoryLabel, row.sourceType, row.sourceLabel, row.title, row.message, data.category, data.sourceType].join(' ').toLowerCase();
  return /fee|payment|finance|invoice|receipt|bursar|bursary|credit|defaulter|expense|reconcil|mpesa|m-pesa|balance|subscription/.test(haystack) || row.targetRole === 'finance_officer' || data.targetRole === 'finance_officer' || (Array.isArray(data.targetRoles) && data.targetRoles.includes('finance_officer'));
}
function alertInsightRow(alert) {
  const row = alert?.toJSON ? alert.toJSON() : (alert || {});
  return insight(row.title || 'School alert', row.message || '', row.severity || 'info', new Date(row.createdAt || Date.now()).toLocaleString(), row.type || 'info');
}
function uniqueNumbers(values = []) { return [...new Set(values.map(Number).filter(Boolean))]; }
function average(values = []) { const valid = values.map(Number).filter(Number.isFinite); return valid.length ? round(valid.reduce((a, b) => a + b, 0) / valid.length, 1) : 0; }
function statusComplete(status) { return ['completed', 'successful', 'approved', 'paid', 'success', 'verified'].includes(text(status).toLowerCase()); }

async function query(sql, replacements = {}) {
  return sequelize.query(sql, { replacements, type: QueryTypes.SELECT });
}
async function safeQuery(sql, replacements = {}) {
  try { return await query(sql, replacements); } catch (error) { console.warn('[v152 analytics query skipped]', error.message); return []; }
}
async function scalar(sql, replacements = {}) {
  const rows = await safeQuery(sql, replacements);
  const first = rows[0] || {};
  return num(first.value ?? first.count ?? first.total ?? Object.values(first)[0], 0);
}
function filtersFrom(req) {
  return {
    year: currentYear(req.query || req.body || {}),
    term: currentTerm(req.query || req.body || {}),
    dateFrom: isoDate((req.query || req.body || {}).dateFrom, startOfDays(210)),
    dateTo: isoDate((req.query || req.body || {}).dateTo, new Date().toISOString().slice(0, 10)),
    scopeType: text((req.query || req.body || {}).scopeType, 'school').toLowerCase(),
    scopeId: text((req.query || req.body || {}).scopeId),
    analyticsType: text((req.query || req.body || {}).analyticsType, 'overview').toLowerCase()
  };
}

async function getSchool(schoolCode) {
  return School.findOne({ where: { schoolId: schoolCode } }).catch(() => null);
}
async function getSchoolStudents(schoolCode) {
  return safeQuery(`
    SELECT s.id, s.elimuid, s.grade, s."userId", u.name, u.email, u.phone,
           COALESCE(s."classId", se."classId") AS "classId",
           c.name AS "className", c.grade AS "classGrade", c.stream,
           u."profileImage", u."profilePicture"
    FROM "Students" s
    JOIN "Users" u ON u.id = s."userId" AND u."schoolCode" = :schoolCode AND u.role = 'student'
    LEFT JOIN LATERAL (
      SELECT e."classId" FROM "StudentEnrollments" e
      WHERE e."studentId" = s.id AND e."schoolCode" = :schoolCode AND e.status = 'active'
      ORDER BY e."effectiveFrom" DESC, e.id DESC LIMIT 1
    ) se ON TRUE
    LEFT JOIN "Classes" c ON c.id = COALESCE(s."classId", se."classId") AND c."schoolCode" = :schoolCode
    WHERE COALESCE(u."isActive", true) = true AND COALESCE(s.status, 'active') <> 'inactive'
    ORDER BY u.name ASC
  `, { schoolCode });
}
async function getSchoolOptions(schoolCode) {
  const [classes, students, teachers, subjectRows] = await Promise.all([
    safeQuery(`SELECT id, name, grade, stream, "teacherId", curriculum, "curriculumLevel"
               FROM "Classes"
               WHERE "schoolCode"=:schoolCode AND COALESCE("isActive",true)=true
               ORDER BY grade,name,stream`, { schoolCode }),
    getSchoolStudents(schoolCode),
    safeQuery(`SELECT t.id AS "teacherId", u.id AS "userId", u.name, u.email, t.department, t.subjects FROM "Teachers" t JOIN "Users" u ON u.id=t."userId" WHERE u."schoolCode"=:schoolCode AND u.role='teacher' AND COALESCE(u."isActive",true)=true ORDER BY u.name`, { schoolCode }),
    safeQuery(`SELECT subject FROM "AcademicRecords" WHERE "schoolCode"=:schoolCode AND NULLIF(TRIM(subject),'') IS NOT NULL UNION SELECT subject FROM "TeacherSubjectAssignments" tsa JOIN "Teachers" t ON t.id=tsa."teacherId" JOIN "Users" u ON u.id=t."userId" WHERE u."schoolCode"=:schoolCode ORDER BY subject`, { schoolCode })
  ]);
  const streams = [...new Set(classes.map(c => text(c.stream)).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  return {
    classes: classes.map(c => ({ id: c.id, name: c.name, grade: c.grade, stream: c.stream || '', curriculum: c.curriculum || '', curriculumLevel: c.curriculumLevel || '' })),
    streams: streams.map(s => ({ id: s, name: s })),
    students: students.map(s => ({ id: s.id, name: s.name, elimuid: s.elimuid, classId: s.classId, className: s.className || s.grade })),
    teachers: teachers.map(t => ({ id: t.userId, teacherId: t.teacherId, name: t.name, department: t.department || '' })),
    subjects: subjectRows.map(s => ({ id: s.subject, name: s.subject }))
  };
}

async function resolveSchoolScope(req, options, filters) {
  const role = text(req.user.role).toLowerCase();
  const schoolCode = req.user.schoolCode;
  const allowedAdmin = ['school', 'stream', 'class', 'student', 'teacher', 'subject'];
  const allowedFinance = ['school', 'stream', 'class', 'student'];
  const allowedTeacher = ['class', 'student', 'subject'];
  let scopeType = filters.scopeType || 'school';
  let scopeId = filters.scopeId;
  let studentIds = options.students.map(s => Number(s.id));
  let classIds = options.classes.map(c => Number(c.id));
  let subject = null;
  let teacherId = null;
  let label = 'Whole School';

  if (role === 'admin') {
    if (!allowedAdmin.includes(scopeType)) scopeType = 'school';
  } else if (role === 'finance_officer') {
    if (!allowedFinance.includes(scopeType)) scopeType = 'school';
  } else if (role === 'teacher') {
    if (!allowedTeacher.includes(scopeType)) scopeType = 'class';
    const assigned = await linkage.resolveTeacherAssignedClasses(req.user.id, schoolCode).catch(() => []);
    const assignedIds = assigned.map(c => Number(c.id)).filter(Boolean);
    classIds = assignedIds;
    const assignedStudents = assignedIds.length ? await linkage.resolveClassStudents(assignedIds, schoolCode, { limit: 5000 }).catch(() => []) : [];
    studentIds = assignedStudents.map(s => Number(s.id));
    const teacherProfile = await Teacher.findOne({ where: { userId: req.user.id } }).catch(() => null);
    teacherId = teacherProfile?.id || null;
    if (!scopeId && assignedIds.length) scopeId = String(assignedIds[0]);
  } else {
    scopeType = 'school';
  }

  if (scopeType === 'stream') {
    const matched = options.classes.filter(c => text(c.stream).toLowerCase() === text(scopeId).toLowerCase());
    if (!matched.length) {
      // Recover from stale browser filters without crossing tenant boundaries.
      scopeType = role === 'teacher' ? 'class' : 'school';
      scopeId = role === 'teacher' && classIds.length ? String(classIds[0]) : '';
      label = role === 'teacher' ? 'Assigned Classes' : 'Whole School';
    } else {
      classIds = matched.map(c => Number(c.id));
      studentIds = options.students.filter(s => classIds.includes(Number(s.classId))).map(s => Number(s.id));
      label = `Stream ${matched[0].stream}`;
    }
  } else if (scopeType === 'class') {
    let selected = options.classes.find(c => Number(c.id) === Number(scopeId));
    if (!selected || (role === 'teacher' && !classIds.includes(Number(selected.id)))) {
      if (role === 'teacher' && classIds.length) selected = options.classes.find(c => Number(c.id) === Number(classIds[0]));
      if (selected) {
        scopeId = String(selected.id);
      } else {
        scopeType = role === 'teacher' ? 'class' : 'school';
        scopeId = '';
        label = role === 'teacher' ? 'Assigned Classes' : 'Whole School';
        if (role !== 'teacher') {
          classIds = options.classes.map(c => Number(c.id));
          studentIds = options.students.map(s => Number(s.id));
        }
      }
    }
    if (selected) {
      classIds = [Number(selected.id)];
      studentIds = options.students.filter(s => Number(s.classId) === Number(selected.id)).map(s => Number(s.id));
      label = selected.name;
    }
  } else if (scopeType === 'student') {
    let selected = options.students.find(s => Number(s.id) === Number(scopeId));
    if (!selected || (role === 'teacher' && !studentIds.includes(Number(selected.id)))) {
      selected = role === 'teacher' ? options.students.find(s => studentIds.includes(Number(s.id))) : null;
      if (!selected) {
        scopeType = role === 'teacher' ? 'class' : 'school';
        scopeId = '';
        label = role === 'teacher' ? 'Assigned Classes' : 'Whole School';
        if (role !== 'teacher') {
          classIds = options.classes.map(c => Number(c.id));
          studentIds = options.students.map(s => Number(s.id));
        }
      }
    }
    if (selected) {
      studentIds = [Number(selected.id)];
      classIds = selected.classId ? [Number(selected.classId)] : [];
      scopeId = String(selected.id);
      label = `${selected.name} (${selected.elimuid || 'Student'})`;
    }
  } else if (scopeType === 'teacher') {
    if (role !== 'admin') throw Object.assign(new Error('Teacher analytics scope is available to school administrators only.'), { status: 403 });
    const selected = options.teachers.find(t => Number(t.id) === Number(scopeId));
    if (!selected) throw Object.assign(new Error('Selected teacher is not in your school.'), { status: 404 });
    const assigned = await linkage.resolveTeacherAssignedClasses(selected.id, schoolCode).catch(() => []);
    classIds = assigned.map(c => Number(c.id)).filter(Boolean);
    studentIds = options.students.filter(s => classIds.includes(Number(s.classId))).map(s => Number(s.id));
    teacherId = Number(selected.teacherId);
    label = selected.name;
  } else if (scopeType === 'subject') {
    const selected = options.subjects.find(s => text(s.id).toLowerCase() === text(scopeId).toLowerCase());
    if (!selected) throw Object.assign(new Error('Selected subject is not available in your school data.'), { status: 404 });
    subject = selected.name;
    label = selected.name;
  } else {
    scopeType = 'school';
    scopeId = '';
  }

  return { schoolCode, role, scopeType, scopeId, label, studentIds: uniqueNumbers(studentIds), classIds: uniqueNumbers(classIds), subject, teacherId };
}

function whereForStudentIds(alias, studentIds, replacements, where) {
  if (studentIds.length) { where.push(`${alias}."studentId" IN (:studentIds)`); replacements.studentIds = studentIds; }
  else where.push('1=0');
}
async function academicRecords(scope, filters, publishedOnly = false) {
  const where = ['ar."schoolCode"=:schoolCode'];
  const replacements = { schoolCode: scope.schoolCode };
  whereForStudentIds('ar', scope.studentIds, replacements, where);
  if (filters.year) { where.push('ar.year=:year'); replacements.year = filters.year; }
  if (filters.term) { where.push('ar.term=:term'); replacements.term = filters.term; }
  if (filters.dateFrom) { where.push('ar.date::date>=:dateFrom'); replacements.dateFrom = filters.dateFrom; }
  if (filters.dateTo) { where.push('ar.date::date<=:dateTo'); replacements.dateTo = filters.dateTo; }
  if (scope.subject) { where.push('LOWER(ar.subject)=LOWER(:subject)'); replacements.subject = scope.subject; }
  if (scope.teacherId) { where.push('ar."teacherId"=:teacherId'); replacements.teacherId = scope.teacherId; }
  if (publishedOnly) where.push('COALESCE(ar."isPublished",false)=true');
  return safeQuery(`SELECT ar.* FROM "AcademicRecords" ar WHERE ${where.join(' AND ')} ORDER BY ar.date ASC, ar.id ASC`, replacements);
}
async function attendanceRecords(scope, filters) {
  const where = ['a."schoolCode"=:schoolCode']; const replacements = { schoolCode: scope.schoolCode };
  whereForStudentIds('a', scope.studentIds, replacements, where);
  if (filters.dateFrom) { where.push('a.date>=:dateFrom'); replacements.dateFrom = filters.dateFrom; }
  if (filters.dateTo) { where.push('a.date<=:dateTo'); replacements.dateTo = filters.dateTo; }
  return safeQuery(`SELECT a.* FROM "Attendances" a WHERE ${where.join(' AND ')} ORDER BY a.date ASC`, replacements);
}
async function feeRecords(scope, filters) {
  const where = ['f."schoolCode"=:schoolCode']; const replacements = { schoolCode: scope.schoolCode };
  whereForStudentIds('f', scope.studentIds, replacements, where);
  if (filters.year) { where.push('f.year=:year'); replacements.year = filters.year; }
  if (filters.term) { where.push('f.term=:term'); replacements.term = filters.term; }
  return safeQuery(`SELECT f.* FROM "Fees" f WHERE ${where.join(' AND ')}`, replacements);
}
async function reportRows(scope, filters) {
  const where = ['r."schoolCode"=:schoolCode']; const replacements = { schoolCode: scope.schoolCode };
  whereForStudentIds('r', scope.studentIds, replacements, where);
  if (filters.year) { where.push('r.year=:year'); replacements.year = filters.year; }
  if (filters.term) { where.push('r.term=:term'); replacements.term = filters.term; }
  return safeQuery(`SELECT r.id,r."studentId",r."classId",r.status,r.term,r.year,r."publishedAt",r.version FROM "ReportSnapshots" r WHERE ${where.join(' AND ')}`, replacements);
}
async function taskRows(scope) {
  if (!scope.studentIds.length) return [];
  return safeQuery(`SELECT hta.*, ht.title, ht.subject, ht."dueDate", ht."estimatedMinutes" FROM "HomeTaskAssignments" hta LEFT JOIN "HomeTasks" ht ON ht.id=hta."taskId" WHERE (hta."schoolCode"=:schoolCode OR ht."schoolCode"=:schoolCode) AND hta."studentId" IN (:studentIds)`, { schoolCode: scope.schoolCode, studentIds: scope.studentIds });
}
async function paymentRows(scope, filters) {
  const where = ['p."schoolCode"=:schoolCode']; const replacements = { schoolCode: scope.schoolCode };
  if (scope.studentIds.length) { where.push('(p."studentId" IN (:studentIds) OR p."feeId" IN (SELECT id FROM "Fees" WHERE "studentId" IN (:studentIds) AND "schoolCode"=:schoolCode))'); replacements.studentIds = scope.studentIds; }
  if (filters.dateFrom) { where.push('COALESCE(p."paymentDate",p."transactionDate",p."createdAt")::date>=:dateFrom'); replacements.dateFrom = filters.dateFrom; }
  if (filters.dateTo) { where.push('COALESCE(p."paymentDate",p."transactionDate",p."createdAt")::date<=:dateTo'); replacements.dateTo = filters.dateTo; }
  return safeQuery(`SELECT p.* FROM "Payments" p WHERE ${where.join(' AND ')} ORDER BY COALESCE(p."paymentDate",p."transactionDate",p."createdAt") ASC`, replacements);
}
function attendanceRate(rows) { const valid = rows.filter(r => text(r.status).toLowerCase() !== 'holiday'); const present = valid.filter(r => ['present', 'late'].includes(text(r.status).toLowerCase())).length; return pct(present, valid.length); }
function groupAverage(rows, keyFn, valueFn = r => r.score) {
  const map = new Map();
  rows.forEach(r => { const key = text(keyFn(r), 'Unknown'); const entry = map.get(key) || { name: key, values: [] }; const value = num(valueFn(r), NaN); if (Number.isFinite(value)) entry.values.push(value); map.set(key, entry); });
  return [...map.values()].map(x => ({ name: x.name, average: average(x.values), count: x.values.length })).sort((a, b) => b.average - a.average);
}
function monthlyTrend(rows, dateKey, valueFn, aggregator = 'sum', months = 7) {
  const labels = []; const values = []; const now = new Date();
  for (let i = months - 1; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const set = rows.filter(r => text(r[dateKey] || r.date || r.createdAt).slice(0, 7) === key);
    labels.push(d.toLocaleString('en-US', { month: 'short' }));
    if (aggregator === 'average') values.push(average(set.map(valueFn)));
    else if (aggregator === 'attendance') values.push(attendanceRate(set));
    else values.push(round(set.reduce((sum, r) => sum + num(valueFn(r)), 0), 1));
  }
  return { labels, values };
}
function feeSummary(rows) {
  const expected = rows.reduce((s, r) => s + num(r.totalAmount), 0);
  const paid = rows.reduce((s, r) => s + Math.max(num(r.parentPaidAmount), num(r.paidAmount)), 0);
  const credits = rows.reduce((s, r) => s + num(r.creditAmount), 0);
  const outstanding = Math.max(0, expected - paid - credits);
  return { expected: round(expected), paid: round(paid), credits: round(credits), outstanding: round(outstanding), collectionRate: pct(paid + credits, expected) };
}
function taskSummary(rows) {
  const completed = rows.filter(r => ['completed', 'submitted', 'reviewed'].includes(text(r.status).toLowerCase())).length;
  const overdue = rows.filter(r => r.dueDate && new Date(r.dueDate) < new Date() && !['completed', 'submitted', 'reviewed'].includes(text(r.status).toLowerCase())).length;
  const pending = Math.max(0, rows.length - completed - overdue);
  return { total: rows.length, completed, pending, overdue, rate: pct(completed, rows.length) };
}
function attendanceHeatmap(rows) {
  const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  const weeks = [];
  for (let i = 3; i >= 0; i -= 1) {
    const end = new Date(); end.setDate(end.getDate() - (i * 7));
    const start = new Date(end); start.setDate(start.getDate() - 6);
    const cells = weekdays.map((_, index) => {
      const day = new Date(start); day.setDate(start.getDate() + index);
      const key = day.toISOString().slice(0, 10);
      return attendanceRate(rows.filter(r => text(r.date).slice(0, 10) === key));
    });
    weeks.push({ label: `Week ${4 - i}`, cells });
  }
  return { weekdays, weeks };
}
function consecutiveAttendanceStreak(rows) {
  const presentDates = [...new Set(rows.filter(r => ['present', 'late'].includes(text(r.status).toLowerCase())).map(r => text(r.date).slice(0, 10)))].sort().reverse();
  if (!presentDates.length) return 0;
  let streak = 1;
  for (let i = 1; i < presentDates.length; i += 1) {
    const prev = new Date(presentDates[i - 1]); const cur = new Date(presentDates[i]);
    const diff = Math.round((prev - cur) / 86400000);
    if (diff <= 3) streak += 1; else break;
  }
  return streak;
}


function profileValue(obj, ...keys) {
  for (const key of keys) {
    const v = key.split('.').reduce((acc, part) => acc && acc[part], obj);
    if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  }
  return '';
}
function buildKemisReadiness({ school, options, attendance, academicContext }) {
  const students = options.students || [];
  const classes = options.classes || [];
  const count = students.length || 0;
  const missingUpi = students.filter(s => !text(s.upi || s.UPI || s.elimuid)).length;
  const missingGender = students.filter(s => !text(s.gender)).length;
  const missingClass = students.filter(s => !s.classId && !text(s.className || s.grade)).length;
  const byGender = students.reduce((map, s) => { const key=text(s.gender,'Unspecified'); map.set(key, num(map.get(key))+1); return map; }, new Map());
  const byClass = students.reduce((map, s) => { const key=text(s.className || s.grade,'Unassigned'); map.set(key, num(map.get(key))+1); return map; }, new Map());
  const sneRows = students.filter(s => s.sneStatus || s.specialNeeds || s.specialNeedsStatus);
  const schoolProfileMissing = [];
  if (!profileValue(school, 'registrationNumber', 'settings.registrationNumber', 'settings.reportCardSettings.registrationNumber')) schoolProfileMissing.push('School registration number');
  if (!profileValue(school, 'address.county', 'settings.county', 'county')) schoolProfileMissing.push('County');
  if (!profileValue(school, 'system', 'settings.curriculum', 'settings.curriculumType')) schoolProfileMissing.push('Curriculum');
  if (!profileValue(school, 'settings.capitationAccount', 'settings.bankAccount', 'bankAccount')) schoolProfileMissing.push('Capitation/bank details');
  const checks = [
    { key:'upi', label:'UPI / learner identifier coverage', passed: count - missingUpi, total: count, missing: missingUpi },
    { key:'gender', label:'Gender completeness', passed: count - missingGender, total: count, missing: missingGender },
    { key:'class', label:'Class placement completeness', passed: count - missingClass, total: count, missing: missingClass },
    { key:'schoolProfile', label:'School profile completeness', passed: Math.max(0, 4 - schoolProfileMissing.length), total: 4, missing: schoolProfileMissing.length }
  ];
  const score = checks.length ? Math.round(checks.reduce((sum, c) => sum + pct(c.passed, c.total || 1), 0) / checks.length) : 0;
  return {
    score,
    status: score >= 85 ? 'Ready for review' : score >= 65 ? 'Needs cleanup' : 'Incomplete',
    missing: [
      ...(missingUpi ? [`${missingUpi} learner(s) missing UPI/identifier`] : []),
      ...(missingGender ? [`${missingGender} learner(s) missing gender`] : []),
      ...(missingClass ? [`${missingClass} learner(s) missing class placement`] : []),
      ...schoolProfileMissing.map(x => `${x} missing`)
    ],
    enrollmentByGender: [...byGender.entries()].map(([name,value]) => ({ name, value })),
    enrollmentByClass: [...byClass.entries()].map(([name,value]) => ({ name, value })),
    sneCount: sneRows.length,
    capitationEligible: Math.max(0, count - missingUpi - missingClass),
    attendanceSupported: attendanceRate(attendance) >= 1 ? Math.max(0, count - missingUpi - missingClass) : 0,
    curriculum: academicContext?.curriculum || 'cbc',
    expectedSubjects: academicContext?.expectedSubjects || [],
    checks
  };
}

async function buildSchoolAnalytics(req) {
  const filters = filtersFrom(req);
  const schoolCode = req.user.schoolCode;
  const [school, options] = await Promise.all([getSchool(schoolCode), getSchoolOptions(schoolCode)]);
  const scope = await resolveSchoolScope(req, options, filters);
  const academicContext = resolveCurriculumContext(school, scope, options);
  const [records, attendance, feesRows, reports, tasks, payments, alerts, expenses] = await Promise.all([
    academicRecords(scope, filters), attendanceRecords(scope, filters), feeRecords(scope, filters), reportRows(scope, filters), taskRows(scope), paymentRows(scope, filters),
    getAlertsForUser(req.user, { limit: 8 }).catch(() => []),
    safeQuery(`SELECT category,amount,status,"expenseDate" FROM "FinanceExpenses" WHERE "schoolCode"=:schoolCode AND "expenseDate">=:dateFrom AND "expenseDate"<=:dateTo ORDER BY "expenseDate" ASC`, { schoolCode, dateFrom: filters.dateFrom, dateTo: filters.dateTo })
  ]);
  const studentById = new Map(options.students.map(s => [Number(s.id), s]));
  const classById = new Map(options.classes.map(c => [Number(c.id), c]));
  const teacherById = new Map(options.teachers.map(t => [Number(t.teacherId), t]));
  const recordByClass = new Map();
  records.forEach(r => {
    const sid = Number(r.studentId); const cid = Number(r.classId || studentById.get(sid)?.classId || 0); if (!cid) return;
    const arr = recordByClass.get(cid) || []; arr.push(r); recordByClass.set(cid, arr);
  });
  const classPerformance = [...recordByClass.entries()].map(([id, rows]) => ({ id, name: classById.get(id)?.name || `Class ${id}`, stream: classById.get(id)?.stream || '', average: average(rows.map(r => r.score)), marks: rows.length })).sort((a, b) => b.average - a.average);
  const subjectPerformance = groupAverage(records, r => r.subject);
  const assessmentPerformance = groupAverage(records, r => r.assessmentName || r.assessmentKey || r.assessmentType);
  const studentPerformance = groupAverage(records, r => studentById.get(Number(r.studentId))?.name || `Student ${r.studentId}`).map(x => ({ ...x, student: x.name, id: options.students.find(s => s.name === x.name)?.id })).sort((a, b) => b.average - a.average);
  const teacherPerformance = groupAverage(records, r => teacherById.get(Number(r.teacherId))?.name || `Teacher ${r.teacherId}`).map(x => ({ ...x, teacher: x.name }));
  const streamMap = new Map();
  classPerformance.forEach(c => { const key = c.stream || 'No Stream'; const row = streamMap.get(key) || { name: key, weighted: 0, marks: 0 }; row.weighted += c.average * c.marks; row.marks += c.marks; streamMap.set(key, row); });
  const streamPerformance = [...streamMap.values()].map(x => ({ name: x.name, average: x.marks ? round(x.weighted / x.marks, 1) : 0 }));
  const fee = feeSummary(feesRows);
  const task = taskSummary(tasks);
  const published = reports.filter(r => r.status === 'published').length;
  const draft = reports.filter(r => r.status === 'draft').length;
  const archived = reports.filter(r => r.status === 'archived').length;
  const populatedClassIds = uniqueNumbers(options.students.filter(s => scope.studentIds.includes(Number(s.id))).map(s => s.classId));
  const configuredClassIds = uniqueNumbers(scope.scopeType === 'school' || scope.scopeType === 'subject' ? options.classes.map(c => c.id) : scope.classIds);
  const activeClasses = (scope.scopeType === 'school' || scope.scopeType === 'subject') ? populatedClassIds.length : Math.max(1, scope.classIds.length);
  const configuredClasses = configuredClassIds.length;
  const paymentMethods = new Map(); payments.filter(p => statusComplete(p.status)).forEach(p => { const method = text(p.method || p.paymentGateway, 'Other'); paymentMethods.set(method, num(paymentMethods.get(method)) + num(p.amount)); });
  const expenseCategories = new Map(); expenses.forEach(e => { const category=text(e.category,'Other'); expenseCategories.set(category,num(expenseCategories.get(category))+num(e.amount)); });
  const classFeeMap = new Map(); feesRows.forEach(f => { const student=studentById.get(Number(f.studentId)); const name=student?.className||student?.grade||'Unassigned'; const row=classFeeMap.get(name)||{name,expected:0,paid:0,credits:0,students:new Set()}; row.expected+=num(f.totalAmount); row.paid+=Math.max(num(f.parentPaidAmount),num(f.paidAmount)); row.credits+=num(f.creditAmount); row.students.add(Number(f.studentId)); classFeeMap.set(name,row); });
  const classFeePerformance=[...classFeeMap.values()].map(r=>({name:r.name,expected:round(r.expected),paid:round(r.paid),credits:round(r.credits),outstanding:Math.max(0,round(r.expected-r.paid-r.credits)),collectionRate:pct(r.paid+r.credits,r.expected),students:r.students.size})).sort((a,b)=>b.collectionRate-a.collectionRate);
  const defaulterStudentIds=new Set(feesRows.filter(f=>num(f.totalAmount)-Math.max(num(f.parentPaidAmount),num(f.paidAmount))-num(f.creditAmount)>0).map(f=>Number(f.studentId)));
  const present = attendance.filter(r => ['present', 'late'].includes(text(r.status).toLowerCase())).length;
  const absent = attendance.filter(r => ['absent', 'sick'].includes(text(r.status).toLowerCase())).length;
  const atRiskStudents = studentPerformance.filter(s => s.average > 0 && s.average < 60);
  const attendanceByStudent = new Map(); attendance.forEach(a => { const arr = attendanceByStudent.get(Number(a.studentId)) || []; arr.push(a); attendanceByStudent.set(Number(a.studentId), arr); });
  options.students.filter(s => scope.studentIds.includes(Number(s.id))).forEach(s => {
    const rows = attendanceByStudent.get(Number(s.id)) || [];
    const rate = attendanceRate(rows);
    if (rows.length && rate < 75 && !atRiskStudents.some(r => Number(r.id) === Number(s.id))) atRiskStudents.push({ id: s.id, name: s.name, student: s.name, average: studentPerformance.find(p => p.name === s.name)?.average || 0, attendance: rate });
  });
  const attendanceClassIds = activeClasses ? populatedClassIds : scope.classIds;
  const kemisReadiness = buildKemisReadiness({ school, options, attendance, academicContext });
  const operational = [
    { label: 'Average Class Size', value: activeClasses ? round(scope.studentIds.length / activeClasses, 1) : 0 },
    { label: 'Student–Teacher Ratio', value: options.teachers.length ? round(scope.studentIds.length / options.teachers.length, 1) : 0 },
    { label: 'Populated Classes', value: activeClasses },
    { label: 'Configured Classes', value: configuredClasses },
    { label: 'Empty / Unused Classes', value: Math.max(0, configuredClasses - activeClasses) },
    { label: 'Classes Below 70% Attendance', value: attendanceClassIds.filter(id => attendance.filter(a => Number(a.classId || studentById.get(Number(a.studentId))?.classId) === Number(id)).length && attendanceRate(attendance.filter(a => Number(a.classId || studentById.get(Number(a.studentId))?.classId) === Number(id))) < 70).length },
    { label: 'Overdue Fee Balance', value: fee.outstanding },
    { label: 'Reports Pending', value: draft }
  ];
  const response = {
    variant: req.user.role === 'finance_officer' ? 'finance' : 'school',
    title: req.user.role === 'finance_officer' ? 'Finance Officer Analytics' : 'School Analytics',
    subtitle: req.user.role === 'finance_officer' ? 'Real-time overview of school finances, collections and performance' : 'Comprehensive performance and operations analytics',
    school: { name: school?.name || 'School', schoolCode }, filters, scope: { type: scope.scopeType, id: scope.scopeId, label: scope.label }, options, academicContext, operationalContext: { configuredClasses, activeClasses, populatedClasses: activeClasses, emptyClasses: Math.max(0, configuredClasses - activeClasses), studentCount: scope.studentIds.length },
    kpis: req.user.role === 'finance_officer' ? [
      kpi('Expected Fees', `KSh ${fee.expected.toLocaleString()}`, 'wallet'), kpi('Collected Fees', `KSh ${fee.paid.toLocaleString()}`, 'banknote', 'green'), kpi('Outstanding Balance', `KSh ${fee.outstanding.toLocaleString()}`, 'users', 'orange'), kpi('Collection Rate', `${fee.collectionRate}%`, 'percent', 'purple'), kpi('Defaulter Count', defaulterStudentIds.size, 'user-x', 'red'), kpi('Expenses', `KSh ${round(expenses.reduce((sum,row)=>sum+num(row.amount),0)).toLocaleString()}`, 'receipt', 'blue')
    ] : [
      kpi('Total Students', scope.studentIds.length, 'users'), kpi('Teachers', scope.scopeType === 'teacher' ? 1 : options.teachers.length, 'user', 'purple'), kpi('Attendance Rate', `${attendanceRate(attendance)}%`, 'calendar-check', 'green'), kpi('Fees Collected', `KSh ${fee.paid.toLocaleString()}`, 'wallet', 'green'), kpi('Published Reports', published, 'file-text', 'blue'), kpi('Active Classes', activeClasses, 'users', 'orange')
    ],
    charts: {
      attendanceTrend: monthlyTrend(attendance, 'date', () => 1, 'attendance'),
      performanceTrend: monthlyTrend(records, 'date', r => r.score, 'average'),
      classPerformance: { labels: classPerformance.slice(0, 12).map(x => x.name), values: classPerformance.slice(0, 12).map(x => x.average) },
      subjectPerformance: { labels: subjectPerformance.slice(0, 12).map(x => x.name), values: subjectPerformance.slice(0, 12).map(x => x.average) },
      streamPerformance: { labels: streamPerformance.map(x => x.name), values: streamPerformance.map(x => x.average) },
      teacherPerformance: { labels: teacherPerformance.slice(0, 10).map(x => x.name), values: teacherPerformance.slice(0, 10).map(x => x.average) },
      assessmentBreakdown: { labels: assessmentPerformance.slice(0, 10).map(x => x.name), values: assessmentPerformance.slice(0, 10).map(x => x.average) },
      feeSplit: { labels: ['Paid', 'Outstanding', 'Credits'], values: [fee.paid, fee.outstanding, fee.credits] },
      collectionTrend: monthlyTrend(payments.filter(p => statusComplete(p.status)), 'paymentDate', p => p.amount, 'sum'),
      paymentMethods: { labels: [...paymentMethods.keys()], values: [...paymentMethods.values()] },
      expenseCategories: { labels: [...expenseCategories.keys()], values: [...expenseCategories.values()] },
      attendancePattern: { labels: ['Present/Late', 'Absent/Sick'], values: [present, absent] },
      reportStatus: { labels: ['Published', 'Draft', 'Archived'], values: [published, draft, archived] },
      homeworkSplit: { labels: ['Completed', 'Pending', 'Overdue'], values: [task.completed, task.pending, task.overdue] },
      attendanceHeatmap: attendanceHeatmap(attendance)
    },
    lists: {
      topClasses: classPerformance.slice(0, 5), atRiskClasses: [...classPerformance].filter(x => x.average > 0).sort((a, b) => a.average - b.average).slice(0, 5),
      topStudents: studentPerformance.slice(0, 8), riskStudents: atRiskStudents.slice(0, 10), topTeachers: teacherPerformance.slice(0, 8), topSubjects: subjectPerformance.slice(0, 8),
      assessmentPerformance: assessmentPerformance.slice(0, 10), streamPerformance, operational, classFeePerformance, expenseCategories:[...expenseCategories.entries()].map(([name,value])=>({name,value})), reconciliation:[{name:'Verified / completed payments',value:payments.filter(p=>statusComplete(p.status)).length},{name:'Pending payments',value:payments.filter(p=>text(p.status).toLowerCase()==='pending').length},{name:'Failed / reversed payments',value:payments.filter(p=>['failed','reversed','cancelled'].includes(text(p.status).toLowerCase())).length}], bursarySummary:[{name:'Credits / bursaries applied',value:fee.credits},{name:'Students with credit',value:new Set(feesRows.filter(f=>num(f.creditAmount)>0).map(f=>Number(f.studentId))).size}],
      alerts: (req.user.role === 'finance_officer' ? alerts.filter(analyticsFinanceAlertOnly) : alerts).map(alertInsightRow),
      defaulters: feesRows.filter(f => num(f.totalAmount) - Math.max(num(f.parentPaidAmount), num(f.paidAmount)) - num(f.creditAmount) > 0).map(f => { const student = studentById.get(Number(f.studentId)); return { student: student?.name || `Student ${f.studentId}`, className: student?.className || student?.grade || 'Unassigned', outstanding: Math.max(0, num(f.totalAmount) - Math.max(num(f.parentPaidAmount), num(f.paidAmount)) - num(f.creditAmount)), dueDate: f.dueDate }; }).sort((a, b) => b.outstanding - a.outstanding).slice(0, 20),
      kemisReadiness: [
        { name:'KEMIS readiness score', value:`${kemisReadiness.score}%`, status:kemisReadiness.status },
        { name:'Learners missing UPI/identifier', value:kemisReadiness.missing.filter(x=>x.toLowerCase().includes('upi')).length ? kemisReadiness.missing.find(x=>x.toLowerCase().includes('upi')) : '0' },
        { name:'Capitation eligible learners', value:kemisReadiness.capitationEligible },
        { name:'SNE learners', value:kemisReadiness.sneCount },
        { name:'Curriculum', value:kemisReadiness.curriculum }
      ],
      enrollmentByGender: kemisReadiness.enrollmentByGender,
      enrollmentByClass: kemisReadiness.enrollmentByClass,
      complianceMissing: kemisReadiness.missing.map(x => ({ title:'Compliance missing data', message:x, tone:'warning', icon:'triangle-alert' }))
    },
    finance: fee, taskSummary: task, updatedAt: new Date().toISOString(), realData: true, tenantScoped: schoolCode
  };
  response.exportSections = exportSectionsFor(response);
  return response;
}

async function buildTeacherAnalytics(req) {
  const filters = filtersFrom(req);
  const schoolCode = req.user.schoolCode;
  const options = await getSchoolOptions(schoolCode);
  const assigned = await linkage.resolveTeacherAssignedClasses(req.user.id, schoolCode).catch(() => []);
  const assignedIds = assigned.map(c => Number(c.id));
  options.classes = options.classes.filter(c => assignedIds.includes(Number(c.id)));
  options.students = options.students.filter(s => assignedIds.includes(Number(s.classId)));
  const teacher = await Teacher.findOne({ where: { userId: req.user.id } }).catch(() => null);
  options.subjects = options.subjects.filter(s => !teacher?.subjects?.length || teacher.subjects.some(subject => text(subject).toLowerCase() === text(s.name).toLowerCase()));
  const scope = await resolveSchoolScope(req, options, filters);
  const [records, attendance, tasks, reports] = await Promise.all([academicRecords(scope, filters), attendanceRecords(scope, filters), taskRows(scope), reportRows(scope, filters)]);
  const studentById = new Map(options.students.map(s => [Number(s.id), s]));
  const studentPerf = groupAverage(records, r => studentById.get(Number(r.studentId))?.name || `Student ${r.studentId}`).map(x => ({ ...x, student: x.name }));
  const subjectPerf = groupAverage(records, r => r.subject);
  const assessments = groupAverage(records, r => r.assessmentName || r.assessmentKey || r.assessmentType);
  const task = taskSummary(tasks);
  const published = reports.filter(r => r.status === 'published').length;
  const response = {
    variant: 'class', title: 'Class Teacher Analytics', subtitle: 'Track class performance, student progress and teaching impact', filters, scope: { type: scope.scopeType, id: scope.scopeId, label: scope.label }, options,
    kpis: [kpi('Students Taught', scope.studentIds.length, 'users'), kpi('Mean Score', `${average(records.map(r => r.score))}%`, 'award', 'green'), kpi('Attendance Rate', `${attendanceRate(attendance)}%`, 'calendar-check', 'blue'), kpi('Assignments Completed', `${task.rate}%`, 'clipboard-check', 'blue'), kpi('Published Reports', `${published} / ${scope.studentIds.length}`, 'file-text', 'purple'), kpi('At-Risk Learners', studentPerf.filter(x => x.average > 0 && x.average < 60).length, 'user-x', 'red')],
    charts: { performanceTrend: monthlyTrend(records, 'date', r => r.score, 'average'), subjectPerformance: { labels: subjectPerf.map(x => x.name), values: subjectPerf.map(x => x.average) }, assessmentBreakdown: { labels: assessments.map(x => x.name), values: assessments.map(x => x.average) }, attendancePattern: { labels: ['Present/Late', 'Absent/Sick'], values: [attendance.filter(r => ['present','late'].includes(text(r.status).toLowerCase())).length, attendance.filter(r => ['absent','sick'].includes(text(r.status).toLowerCase())).length] }, homeworkSplit: { labels: ['Completed','Pending','Overdue'], values: [task.completed,task.pending,task.overdue] }, reportStatus: { labels: ['Published','Not Published'], values: [published,Math.max(0,scope.studentIds.length-published)] } },
    lists: { topStudents: studentPerf.slice(0, 8), riskStudents: studentPerf.filter(x => x.average > 0 && x.average < 60).sort((a,b)=>a.average-b.average).slice(0,8), assessmentPerformance: assessments, upcomingAssessments: [], actionableInsights: [studentPerf.some(x=>x.average>0&&x.average<60)?insight('Learners need support', `${studentPerf.filter(x=>x.average>0&&x.average<60).length} learner(s) are below 60%.`, 'warning'):insight('Academic risk', 'No learner is below 60% in the selected scope.', 'success'), insight('Attendance', `Current attendance rate is ${attendanceRate(attendance)}%.`, attendanceRate(attendance)<80?'warning':'success'), task.overdue?insight('Homework review', `${task.overdue} homework assignment(s) are overdue.`, 'warning'):insight('Homework review', 'No overdue homework in the selected scope.', 'success')] },
    taskSummary: task, updatedAt: new Date().toISOString(), realData: true, tenantScoped: schoolCode
  };
  response.exportSections = exportSectionsFor(response);
  return response;
}

async function buildChildStudentAnalytics(req) {
  const role = text(req.user.role).toLowerCase();
  const filters = filtersFrom(req);
  let student;
  if (role === 'student') student = await Student.findOne({ where: { userId: req.user.id }, include: [{ model: User }] }).catch(() => null);
  else {
    const parent = await Parent.findOne({ where: { userId: req.user.id } }).catch(() => null);
    const linked = parent ? await linkage.resolveParentLinkedStudents(req.user.id, req.user.schoolCode).catch(() => []) : [];
    student = linked.find(s => Number(s.id) === Number(req.query.childId || req.body?.childId || (filters.scopeType === 'student' ? filters.scopeId : null))) || linked[0];
  }
  if (!student) throw Object.assign(new Error('Student not found in your authorized account.'), { status: 404 });
  const schoolCode = student.User?.schoolCode || req.user.schoolCode;
  if (schoolCode !== req.user.schoolCode) throw Object.assign(new Error('Student is outside your school account.'), { status: 403 });
  const cls = await linkage.resolveStudentClass(student, schoolCode).catch(() => null);
  const [school, options] = await Promise.all([getSchool(schoolCode), getSchoolOptions(schoolCode)]);
  const scope = { schoolCode, studentIds: [Number(student.id)], classIds: cls ? [Number(cls.id)] : [], scopeType: 'student', scopeId: String(student.id), label: student.User?.name || 'Student', subject: filters.scopeType === 'subject' ? filters.scopeId : null, teacherId: null };
  const academicContext = resolveCurriculumContext(school, { classIds: cls?.id ? [cls.id] : [], studentIds: [student.id] }, options);
  const [records, attendance, tasks, reports, badges, achievements, alerts, timetableRows] = await Promise.all([
    academicRecords(scope, filters, true), attendanceRecords(scope, filters), taskRows(scope), reportRows(scope, filters),
    safeQuery(`SELECT sb."awardedAt", b.name, b.description, b.icon FROM "StudentBadges" sb JOIN "Badges" b ON b.id=sb."badgeId" WHERE sb."studentId"=:studentId ORDER BY sb."awardedAt" DESC`, { studentId: student.id }),
    safeQuery(`SELECT title,note,points,"streakDelta","createdAt" FROM "AchievementEvents" WHERE "schoolCode"=:schoolCode AND ("studentId"=:studentId OR "userId"=:userId) ORDER BY "createdAt" DESC LIMIT 20`, { schoolCode, studentId: student.id, userId: student.userId }),
    getAlertsForUser(req.user, { studentId: student.id, limit: 10 }).catch(() => []),
    safeQuery(`SELECT slots,classes,term,year,"publishedAt" FROM "Timetables" WHERE "schoolId"=:schoolCode AND "isPublished"=true AND (:term::text IS NULL OR term=:term) AND (:year::int IS NULL OR year=:year) ORDER BY version DESC LIMIT 1`, { schoolCode, term: filters.term, year: filters.year })
  ]);
  const subjectPerf = groupAverage(records, r => r.subject);
  const recentAssessments = [...records].sort((a,b)=>new Date(b.date)-new Date(a.date)).slice(0,8).map(r => ({ subject:r.subject, assessment:r.assessmentName||r.assessmentKey||r.assessmentType, score:num(r.score), grade:r.grade||gradeForScore(r.score, academicContext), date:r.date }));
  const task = taskSummary(tasks);
  const classStudents = cls ? await linkage.resolveClassStudents([cls.id], schoolCode, { limit: 5000 }).catch(() => []) : [];
  const classIds = classStudents.map(s => Number(s.id));
  const classRecords = classIds.length ? await academicRecords({ ...scope, studentIds: classIds, subject: null }, filters, true) : [];
  const leaderboard = classStudents.map(s => ({ id:s.id, name:s.User?.name || `Student ${s.id}`, average:average(classRecords.filter(r=>Number(r.studentId)===Number(s.id)).map(r=>r.score)) })).sort((a,b)=>b.average-a.average).slice(0,10);
  const rank = leaderboard.findIndex(x=>Number(x.id)===Number(student.id));
  const timetable = timetableRows[0];
  const rawSlots = Array.isArray(timetable?.slots) ? timetable.slots : [];
  const className = cls?.name || student.grade;
  const slots = rawSlots.filter(slot => Number(slot.classId) === Number(cls?.id) || text(slot.className || slot.class).toLowerCase() === text(className).toLowerCase()).slice(0,12);
  const lastReport = [...reports].filter(r=>r.status==='published').sort((a,b)=>new Date(b.publishedAt||0)-new Date(a.publishedAt||0))[0] || null;
  const avg = average(records.map(r=>r.score));
  const response = {
    variant: role === 'parent' ? 'child' : 'student', title: role === 'parent' ? 'Child Progress Analytics' : 'My Analytics', subtitle: role === 'parent' ? "Monitor your child's learning progress, attendance and wellbeing" : 'Your learning insights. Track your progress and keep improving every day.', filters, scope:{type:'student',id:String(student.id),label:student.User?.name||'Student'}, academicContext,
    student:{id:student.id,name:student.User?.name,elimuid:student.elimuid,grade:student.grade,className,photo:student.User?.profileImage||student.User?.profilePicture},
    options:{ children: role==='parent' ? (await linkage.resolveParentLinkedStudents(req.user.id, schoolCode).catch(()=>[])).map(s=>({id:s.id,name:s.User?.name||`Student ${s.id}`})) : [], subjects:subjectPerf.map(s=>({id:s.name,name:s.name})) },
    kpis:[kpi('Average Score',`${avg}%`,'star','purple'),kpi('Attendance',`${attendanceRate(attendance)}%`,'calendar-check','teal'),kpi('Homework Completion',`${task.rate}%`,'clipboard-check','blue'),kpi('Badges Earned',badges.length,'award','orange'),kpi('Progress Score',`${round((avg+attendanceRate(attendance)+task.rate)/3)} / 100`,'gauge','green'),kpi(role==='parent'?'Active Alerts':'Class Rank',role==='parent'?alerts.length:(rank>=0?`${rank+1} / ${classStudents.length}`:'—'),role==='parent'?'bell':'bar-chart-2','red')],
    charts:{ performanceTrend:{labels:subjectPerf.map(s=>s.name),values:subjectPerf.map(s=>s.average)}, attendanceTrend:monthlyTrend(attendance,'date',()=>1,'attendance'), strengthsSplit:{labels:['Strengths','Needs Support'],values:[subjectPerf.filter(s=>s.average>=70).length,subjectPerf.filter(s=>s.average>0&&s.average<60).length]}, homeworkSplit:{labels:['Completed','Pending','Overdue'],values:[task.completed,task.pending,task.overdue]} },
    lists:{ subjectPerformance:subjectPerf,recentAssessments,badges,achievements,leaderboard,tasks:tasks.slice(0,10).map(t=>({title:t.title,subject:t.subject,status:t.status,dueDate:t.dueDate})),timetable:slots,recentAlerts:alerts.map(alertInsightRow),recommendations:[...subjectPerf.filter(s=>s.average>0&&s.average<60).slice(0,3).map(s=>insight(`Focus on ${s.name}`,`Current average is ${s.average}%. Review recent assessments and practise this subject.`,'warning','', 'book-open')),...subjectPerf.filter(s=>s.average>=80).slice(0,2).map(s=>insight(`Strong performance in ${s.name}`,`Current average is ${s.average}%. Keep building on this strength.`,'success','', 'trending-up'))],reportSummary:lastReport?{status:lastReport.status,term:lastReport.term,year:lastReport.year,version:lastReport.version,publishedAt:lastReport.publishedAt,average:avg,grade:gradeForScore(avg, academicContext)}:null,learningStreak:consecutiveAttendanceStreak(attendance) },
    taskSummary:task,updatedAt:new Date().toISOString(),realData:true,tenantScoped:schoolCode
  };
  response.exportSections = exportSectionsFor(response);
  return response;
}

async function buildPlatformAnalytics(req) {
  const filters = filtersFrom(req);
  const [schools, userCounts, subscriptions, payments, approvals] = await Promise.all([
    safeQuery(`SELECT s.*, COALESCE(s.address->>'county',s.address->>'city',s.address->>'region','Unknown') AS region FROM "Schools" s ORDER BY s."createdAt" ASC`),
    safeQuery(`SELECT "schoolCode",role,COUNT(*)::int AS count,COUNT(*) FILTER (WHERE "lastLogin">=NOW()-INTERVAL '30 days')::int AS active FROM "Users" GROUP BY "schoolCode",role`),
    safeQuery(`SELECT "schoolCode",status,"planName","planCode","createdAt","nextDueDate" FROM "Subscriptions" WHERE "ownerType"='school'`),
    safeQuery(`SELECT "schoolCode",amount,status,COALESCE("paymentDate","transactionDate","createdAt") AS date FROM "Payments" WHERE "paidTo"='platform' OR "paymentType"='subscription'`),
    safeQuery(`SELECT COALESCE(data->>'type', role, 'approval') AS type,status,"createdAt" FROM "ApprovalRequests" ORDER BY "createdAt" DESC`)
  ]);
  const totalStudents = userCounts.filter(r=>r.role==='student').reduce((s,r)=>s+num(r.count),0);
  const totalTeachers = userCounts.filter(r=>r.role==='teacher').reduce((s,r)=>s+num(r.count),0);
  const totalParents = userCounts.filter(r=>r.role==='parent').reduce((s,r)=>s+num(r.count),0);
  const activeSubscriptions = subscriptions.filter(s=>['active','trial'].includes(text(s.status).toLowerCase())).length;
  const revenue = payments.filter(p=>statusComplete(p.status)).reduce((s,p)=>s+num(p.amount),0);
  const planMap = new Map(); subscriptions.forEach(s=>{const key=text(s.planName||s.planCode,'Unspecified');planMap.set(key,num(planMap.get(key))+1);});
  const regionMap = new Map(); schools.forEach(s=>regionMap.set(s.region,num(regionMap.get(s.region))+1));
  const growth = monthlyTrend(schools,'createdAt',()=>1,'sum',12); let running=0; growth.values=growth.values.map(v=>(running+=v));
  const engagement = ['student','teacher','parent','admin'].map(role=>{const rows=userCounts.filter(r=>r.role===role);const total=rows.reduce((s,r)=>s+num(r.count),0);const active=rows.reduce((s,r)=>s+num(r.active),0);return {name:role,average:pct(active,total),count:total};});
  const schoolStats = schools.map(s=>{const rows=userCounts.filter(u=>u.schoolCode===s.schoolId);const students=rows.filter(r=>r.role==='student').reduce((a,r)=>a+num(r.count),0);const teachers=rows.filter(r=>r.role==='teacher').reduce((a,r)=>a+num(r.count),0);const parents=rows.filter(r=>r.role==='parent').reduce((a,r)=>a+num(r.count),0);const active=rows.reduce((a,r)=>a+num(r.active),0);const total=rows.reduce((a,r)=>a+num(r.count),0);const sub=subscriptions.find(x=>x.schoolCode===s.schoolId);const rev=payments.filter(p=>p.schoolCode===s.schoolId&&statusComplete(p.status)).reduce((a,p)=>a+num(p.amount),0);return {id:s.schoolId,name:s.name,region:s.region,status:s.status,plan:sub?.planName||sub?.planCode||s.subscriptionPlan||'Unspecified',students,teachers,parents,revenue:rev,engagement:pct(active,total),createdAt:s.createdAt};}).sort((a,b)=>b.students-a.students);
  const response={variant:'platform',title:'Platform Analytics',subtitle:'Real-time platform performance, growth and operations overview',filters,scope:{type:'platform',id:'platform',label:'All Schools'},options:{regions:[...regionMap.keys()].map(x=>({id:x,name:x})),plans:[...planMap.keys()].map(x=>({id:x,name:x}))},kpis:[kpi('Total Schools',schools.length,'building-2'),kpi('Total Students',totalStudents,'users','green'),kpi('Total Teachers',totalTeachers,'user','purple'),kpi('Active Parents',totalParents,'users','orange'),kpi('Platform Revenue',`KSh ${round(revenue).toLocaleString()}`,'circle-dollar-sign','green'),kpi('Pending Approvals',approvals.filter(a=>text(a.status).toLowerCase()==='pending').length,'shield-check','blue')],charts:{growth,planDistribution:{labels:[...planMap.keys()],values:[...planMap.values()]},revenueTrend:monthlyTrend(payments.filter(p=>statusComplete(p.status)),'date',p=>p.amount,'sum',12),engagement:{labels:engagement.map(x=>x.name),values:engagement.map(x=>x.average)},geographic:{labels:[...regionMap.keys()],values:[...regionMap.values()]}},lists:{topSchools:schoolStats.slice(0,10),atRiskSchools:schoolStats.filter(s=>s.status!=='active'||s.engagement<20).sort((a,b)=>a.engagement-b.engagement).slice(0,10),schoolComparison:schoolStats,approvals:approvals.slice(0,10),usage:engagement,insights:[insight('Active subscriptions',`${activeSubscriptions} school subscription(s) are active or trial.`,'info'),insight('Platform engagement',`${userCounts.reduce((s,r)=>s+num(r.active),0)} users logged in during the last 30 days.`,'success')]},updatedAt:new Date().toISOString(),realData:true,tenantScoped:'platform'};
  response.exportSections=exportSectionsFor(response);return response;
}

const EXPORT_SECTION_LABELS = {
  kpis: 'KPI Summary',
  'chart:attendanceTrend': 'Attendance Trend',
  'chart:attendancePattern': 'Attendance Pattern',
  'chart:attendanceHeatmap': 'Attendance Heatmap',
  'chart:classPerformance': 'Class Performance',
  'chart:subjectPerformance': 'Subject Performance',
  'chart:performanceTrend': 'Performance Trend',
  'chart:assessmentBreakdown': 'Assessment Breakdown',
  'chart:teacherPerformance': 'Teacher Performance',
  'chart:reportStatus': 'Report Status',
  'chart:collectionTrend': 'Collection Trend',
  'chart:paymentMethods': 'Payment Methods',
  'chart:feeSplit': 'Paid vs Outstanding',
  'chart:expenseCategories': 'Expense Categories',
  'chart:growth': 'Growth Overview',
  'chart:planDistribution': 'Plan Distribution',
  'chart:revenueTrend': 'Revenue Trend',
  'chart:geographic': 'Region Distribution',
  'chart:strengthsSplit': 'Strengths vs Support Areas',
  'chart:homeworkSplit': 'Homework Completion',
  'list:defaulters': 'Defaulters List',
  'list:classFeePerformance': 'Fee Performance by Class',
  'list:bursarySummary': 'Bursary / Credit Summary',
  'list:reconciliation': 'Reconciliation Status',
  'list:topClasses': 'Top Classes',
  'list:atRiskClasses': 'At-Risk Classes',
  'list:topTeachers': 'Top Teachers',
  'list:topSubjects': 'Top Subjects',
  'list:topStudents': 'Top Students',
  'list:riskStudents': 'Risk Students',
  'list:streamPerformance': 'Stream Performance',
  'list:subjectPerformance': 'Subject Performance',
  'list:recentAssessments': 'Recent Assessments',
  'list:recommendations': 'Recommendations',
  'list:tasks': 'Tasks',
  'list:badges': 'Badges',
  'list:achievements': 'Achievements',
  'list:leaderboard': 'Leaderboard',
  'list:assessmentPerformance': 'Assessment Performance',
  'list:operational': 'Operational Notes',
  'list:alerts': 'Alerts & Insights',
  'list:recentAlerts': 'Recent Alerts',
  'list:actionableInsights': 'Actionable Insights',
  'list:timetable': 'Timetable Summary',
  'list:topSchools': 'Top Performing Schools',
  'list:atRiskSchools': 'At-Risk Schools',
  'list:usage': 'Platform Usage',
  'list:approvals': 'Approval Summary',
  'list:insights': 'Platform Insights',
  'list:schoolComparison': 'School Comparison',
  'list:dataQualityWarnings': 'Data Quality Warnings',
  'list:recommendedActions': 'Recommended Actions',
  'list:kemisReadiness': 'KEMIS Readiness',
  'list:enrollmentByGender': 'Enrollment by Gender',
  'list:enrollmentByClass': 'Enrollment by Class',
  'list:complianceMissing': 'Compliance Missing Data'
};
const EXPORT_SECTION_CATEGORIES = {
  kpis: 'overview',
  'chart:attendanceTrend':'attendance','chart:attendancePattern':'attendance','chart:attendanceHeatmap':'attendance',
  'chart:collectionTrend':'finance','chart:paymentMethods':'finance','chart:feeSplit':'finance','chart:expenseCategories':'finance','chart:revenueTrend':'finance','chart:planDistribution':'finance',
  'list:defaulters':'finance','list:classFeePerformance':'finance','list:bursarySummary':'finance','list:reconciliation':'finance',
  'chart:teacherPerformance':'teachers','list:topTeachers':'teachers',
  'chart:reportStatus':'reports','list:timetable':'reports',
  'chart:classPerformance':'academic','chart:subjectPerformance':'academic','chart:performanceTrend':'academic','chart:assessmentBreakdown':'academic','chart:strengthsSplit':'academic','chart:homeworkSplit':'academic',
  'list:topClasses':'academic','list:atRiskClasses':'academic','list:topSubjects':'academic','list:topStudents':'academic','list:riskStudents':'academic','list:streamPerformance':'academic','list:subjectPerformance':'academic','list:recentAssessments':'academic','list:recommendations':'academic','list:tasks':'academic','list:badges':'academic','list:achievements':'academic','list:leaderboard':'academic','list:assessmentPerformance':'academic',
  'chart:growth':'overview','chart:geographic':'overview','list:operational':'overview','list:alerts':'overview','list:recentAlerts':'overview','list:actionableInsights':'overview','list:topSchools':'overview','list:atRiskSchools':'overview','list:usage':'overview','list:approvals':'overview','list:insights':'overview','list:schoolComparison':'overview','list:dataQualityWarnings':'overview','list:recommendedActions':'overview','list:kemisReadiness':'compliance','list:enrollmentByGender':'compliance','list:enrollmentByClass':'compliance','list:complianceMissing':'compliance'
};
function sectionLabel(key) { return EXPORT_SECTION_LABELS[key] || key.replace(/^(chart:|list:)/,'').replace(/([A-Z])/g,' $1').replace(/^./,m=>m.toUpperCase()); }
function sectionCategory(key) { return EXPORT_SECTION_CATEGORIES[key] || 'overview'; }
function exportSectionsFor(data) {
  const sections = [{ key:'kpis', label:sectionLabel('kpis'), category:'overview', count:(data.kpis||[]).length }];
  Object.entries(data.charts || {}).forEach(([key,value]) => {
    const sectionKey = `chart:${key}`;
    if (value && ((value.labels||[]).length || (value.weeks||[]).length)) sections.push({key:sectionKey,label:sectionLabel(sectionKey),category:sectionCategory(sectionKey),count:(value.labels||value.weeks||[]).length});
  });
  Object.entries(data.lists || {}).forEach(([key,value]) => {
    const sectionKey = `list:${key}`;
    if (Array.isArray(value) && value.length) sections.push({key:sectionKey,label:sectionLabel(sectionKey),category:sectionCategory(sectionKey),count:value.length});
    else if (value && typeof value==='object') sections.push({key:sectionKey,label:sectionLabel(sectionKey),category:sectionCategory(sectionKey),count:Object.keys(value).length});
  });
  return sections;
}

function stripBadText(value) {
  return text(value).replace(/[\uFFFD\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').trim();
}
function numericKpi(data, label) {
  const row = (data.kpis || []).find(k => text(k.label).toLowerCase() === text(label).toLowerCase());
  return row ? num(String(row.value).replace(/[^0-9.-]/g, '')) : 0;
}
function valuesAllZero(chart) {
  const values = Array.isArray(chart?.values) ? chart.values : [];
  return values.length > 0 && values.every(v => num(v) === 0);
}
function addWarn(list, severity, title, message, action, source = 'analytics') {
  list.push({ severity, title, message, action, source });
}
function buildDataQualityWarnings(data) {
  const warnings = [];
  const students = numericKpi(data, 'Total Students') || numericKpi(data, 'Students Taught');
  const classes = numericKpi(data, 'Active Classes');
  const teachers = numericKpi(data, 'Teachers') || numericKpi(data, 'Teachers Taught');
  const configuredClasses = num(data.operationalContext?.configuredClasses || 0);
  const populatedClasses = num(data.operationalContext?.populatedClasses || classes || 0);
  const emptyClasses = num(data.operationalContext?.emptyClasses || Math.max(0, configuredClasses - populatedClasses));
  if (configuredClasses && students && configuredClasses > students) addWarn(warnings, 'high', 'Class setup looks suspicious', `${configuredClasses} configured classes are recorded for ${students} students. This usually means duplicate or empty classes exist.`, 'Clean duplicate/empty classes before trusting class-size analytics.', 'classes');
  if (emptyClasses > 0) addWarn(warnings, emptyClasses > 10 ? 'high' : 'medium', 'Unused classes detected', `${emptyClasses} configured class(es) have no active students in this scope.`, 'Deactivate duplicates/empty classes or move students into the correct classes.', 'classes');
  if (populatedClasses && students && students / populatedClasses < 3) addWarn(warnings, 'medium', 'Average class size is too low', `Average populated class size is ${round(students/populatedClasses,1)} students per class.`, 'Review class creation/import history and deactivate unused classes.', 'classes');
  if (valuesAllZero(data.charts?.performanceTrend)) addWarn(warnings, 'medium', 'No valid monthly performance trend yet', 'The performance trend exists but all monthly values are zero.', 'Enter dated academic records or filter to a term/year that has marks.', 'academic');
  const expectedSubjects = (data.academicContext?.expectedSubjects || []).map(normalizeSubjectName).filter(Boolean);
  const seenSubjects = (data.lists?.topSubjects || data.lists?.subjectPerformance || []).map(s => normalizeSubjectName(s.name || s.subject)).filter(Boolean);
  const offCurriculum = expectedSubjects.length ? seenSubjects.filter(s => s && !expectedSubjects.includes(s)) : [];
  if (offCurriculum.length) addWarn(warnings, 'low', 'Subject names need curriculum review', `${offCurriculum.slice(0, 5).join(', ')} do not exactly match the ${data.academicContext?.curriculum || 'school'} subject bank.`, 'Review custom subjects or rename imported subjects so analytics can group them correctly.', 'curriculum');
  if (valuesAllZero(data.charts?.collectionTrend) && (data.finance?.paid || numericKpi(data, 'Fees Collected'))) addWarn(warnings, 'medium', 'Collection trend is not dated', 'Collected fees exist, but monthly collection trend is all zero.', 'Make sure payments have paymentDate/transactionDate so monthly finance trend can be calculated.', 'finance');
  if (data.finance) {
    const paid = num(data.finance.paid), outstanding = num(data.finance.outstanding);
    if (paid > 0 && outstanding > 0 && Math.abs(paid - outstanding) <= 1) addWarn(warnings, 'medium', 'Paid and outstanding are equal', `Paid and outstanding are both around KSh ${Math.round(paid).toLocaleString()}.`, 'Review fee structure, invoices, and reconciliation rules.', 'finance');
  }
  const alerts = data.lists?.alerts || data.lists?.recentAlerts || [];
  alerts.forEach((a, idx) => { const combined = [a.title, a.message].join(' '); if (/�|Ø=|Ü|Ë|\uFFFD/.test(combined)) addWarn(warnings, 'low', 'Corrupted alert text detected', `One alert contains unusual characters near row ${idx + 1}.`, 'Sanitize or recreate the source alert message.', 'alerts'); });
  return warnings;
}
function trendDirection(values = []) {
  const clean = (values || []).map(Number).filter(Number.isFinite);
  if (clean.length < 2) return 'Not enough data';
  const first = clean.find(v => v !== 0) ?? clean[0];
  const last = clean[clean.length - 1];
  if (last > first) return 'Improving';
  if (last < first) return 'Declining';
  return 'Stable';
}
function buildRecommendedActions(data, warnings = []) {
  const actions = [];
  warnings.slice(0,5).forEach(w => actions.push({ priority: w.severity === 'high' ? 'High' : w.severity === 'medium' ? 'Medium' : 'Low', action: w.action, reason: w.title }));
  const attendance = numericKpi(data, 'Attendance Rate') || numericKpi(data, 'Attendance');
  if (attendance && attendance < 90) actions.push({ priority:'Medium', action:'Follow up learners with repeated absences and late arrivals.', reason:`Attendance is ${attendance}%.` });
  if ((data.lists?.riskStudents || []).length) actions.push({ priority:'High', action:'Create intervention list for learners at academic/attendance/fee risk.', reason:`${data.lists.riskStudents.length} risk student rows detected.` });
  if (!(data.lists?.recommendedActions || []).length && actions.length === 0) actions.push({ priority:'Normal', action:'Continue entering attendance, marks, reports and payments to improve analytics confidence.', reason:'No urgent exception was detected.' });
  return actions;
}
function buildExecutiveSummary(data, warnings = [], actions = []) {
  const attendance = numericKpi(data, 'Attendance Rate') || numericKpi(data, 'Attendance');
  const reportCount = numericKpi(data, 'Published Reports');
  const financePaid = data.finance?.paid || numericKpi(data, 'Fees Collected');
  const academicAverage = average([...(data.charts?.classPerformance?.values || []), ...(data.charts?.subjectPerformance?.values || [])].filter(v => num(v) > 0));
  let score = 100;
  warnings.forEach(w => { score -= w.severity === 'high' ? 18 : w.severity === 'medium' ? 10 : 4; });
  if (attendance && attendance < 80) score -= 12;
  if (!academicAverage) score -= 10;
  score = Math.max(20, Math.min(100, Math.round(score)));
  const strongest = attendance >= 90 ? 'Attendance is a current strength.' : academicAverage >= 70 ? 'Academic performance is currently the strongest signal.' : financePaid > 0 ? 'Finance records are active.' : 'The system has started collecting operational data.';
  const mainConcern = warnings[0]?.title || (academicAverage ? 'No major data-quality concern detected.' : 'Academic analytics need more valid marks.');
  const trend = trendDirection(data.charts?.attendanceTrend?.values || data.charts?.performanceTrend?.values || []);
  return { healthScore: score, status: score >= 80 ? 'Healthy' : score >= 60 ? 'Needs attention' : 'At risk', strongestArea: strongest, mainConcern, trend, topAction: actions[0]?.action || 'Keep adding current school data.', confidence: warnings.length ? 'Medium' : 'High' };
}
function enrichAnalyticsData(data) {
  if (!data || typeof data !== 'object') return data;
  // Sanitize alert/insight text before display/export.
  ['alerts','recentAlerts','insights','actionableInsights','recommendations'].forEach(key => {
    if (Array.isArray(data.lists?.[key])) data.lists[key] = data.lists[key].map(row => ({ ...row, title: stripBadText(row.title || row.name || ''), message: stripBadText(row.message || row.note || row.action || '') }));
  });
  const warnings = buildDataQualityWarnings(data);
  const actions = buildRecommendedActions(data, warnings);
  data.lists = data.lists || {};
  const variant = String(data.variant || '').toLowerCase();
  data.lists.dataQualityWarnings = ['platform','school'].includes(variant) ? warnings : [];
  data.lists.recommendedActions = ['platform','school'].includes(variant) ? actions : [];
  data.intelligence = ['platform','school'].includes(variant) ? buildExecutiveSummary(data, warnings, actions) : null;
  data.showIntelligencePanel = ['platform','school'].includes(variant);
  data.subtitle = data.subtitle || 'Analytics intelligence from live school data';
  data.exportSections = exportSectionsFor(data);
  return data;
}

async function dataForRequest(req) {
  const role = text(req.user?.role).toLowerCase();
  let data;
  if (['super_admin','superadmin'].includes(role)) data = await buildPlatformAnalytics(req);
  else if (role === 'teacher') data = await buildTeacherAnalytics(req);
  else if (['parent','student'].includes(role)) data = await buildChildStudentAnalytics(req);
  else if (['admin','finance_officer'].includes(role)) data = await buildSchoolAnalytics(req);
  else throw Object.assign(new Error('Analytics are not available for this role.'), { status: 403 });
  return enrichAnalyticsData(data);
}

function selectedSections(data, include, analyticsType = 'overview') {
  const allowed = new Set((data.exportSections || []).map(s=>s.key));
  const requestedRaw = Array.isArray(include) ? include.map(String).filter(Boolean) : null;
  if (requestedRaw && !requestedRaw.length) throw Object.assign(new Error('Select at least one analytics section to export.'), { status: 400 });
  if (requestedRaw) {
    const invalid = requestedRaw.filter(x => !allowed.has(x));
    if (invalid.length) throw Object.assign(new Error(`Invalid or unavailable analytics section: ${invalid[0]}`), { status: 400 });
    return [...new Set(requestedRaw)];
  }
  const type = text(analyticsType, 'overview').toLowerCase();
  const keys = (data.exportSections || []).filter(s => type === 'overview' || s.key === 'kpis' || sectionCategory(s.key) === type).map(s=>s.key);
  if (!keys.length) throw Object.assign(new Error('No exportable analytics sections are available for this selection.'), { status: 400 });
  return [...new Set(keys)];
}
function rowsForSection(data, key) {
  if (key === 'kpis') return (data.kpis || []).map(x=>({Metric:x.label,Value:x.value,Note:x.hint||''}));
  if (key.startsWith('chart:')) { const name=key.slice(6); const chart=data.charts?.[name]||{}; if (chart.weeks) return chart.weeks.map(w=>({Week:w.label,...Object.fromEntries((chart.weekdays||[]).map((d,i)=>[d,w.cells?.[i]??0]))})); return (chart.labels||[]).map((label,i)=>({Label:label,Value:chart.values?.[i]??0})); }
  if (key.startsWith('list:')) { const value=data.lists?.[key.slice(5)]; if (Array.isArray(value)) return value.map(item=>typeof item==='object'?item:{Value:item}); if (value&&typeof value==='object') return Object.entries(value).map(([Metric,Value])=>({Metric,Value})); }
  return [];
}
function humanSection(key) { return sectionLabel(key); }
function csvEscape(value) {
  let s = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
}
function normalizeRows(rows = []) {
  return rows.map(row => (row && typeof row === 'object' && !Array.isArray(row)) ? row : { Value: row });
}
function rowColumns(rows = []) {
  const cols = [...new Set(normalizeRows(rows).flatMap(r => Object.keys(r)))];
  return cols.length ? cols : ['Status'];
}
function buildCsv(data, sections) {
  const scopeLabel = data.scope?.label || data.tenantScoped || data.variant || 'Analytics';
  if (sections.length === 1) {
    const key = sections[0], rows = normalizeRows(rowsForSection(data, key));
    const cols = rowColumns(rows.length ? rows : [{ Status: 'No data available' }]);
    const lines = [cols.map(csvEscape).join(',')];
    (rows.length ? rows : [{ Status: 'No data available' }]).forEach(row => lines.push(cols.map(c => csvEscape(row[c])).join(',')));
    return lines.join('\n');
  }
  const lines = [];
  lines.push(['Shule AI Analytics Export'].map(csvEscape).join(','));
  lines.push(['Scope', scopeLabel, 'Generated', new Date().toISOString()].map(csvEscape).join(','));
  lines.push([]);
  sections.forEach(key => {
    const rows = normalizeRows(rowsForSection(data, key));
    const cols = rowColumns(rows.length ? rows : [{ Status: 'No data available' }]);
    lines.push([humanSection(key)].map(csvEscape).join(','));
    lines.push(cols.map(csvEscape).join(','));
    (rows.length ? rows : [{ Status: 'No data available' }]).forEach(row => lines.push(cols.map(c => csvEscape(row[c])).join(',')));
    lines.push([]);
  });
  return lines.join('\n');
}
function htmlEscape(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function buildPrintHtml(data, sections){
  const kpiCards=(data.kpis||[]).slice(0,8).map(k=>`<article><small>${htmlEscape(k.label)}</small><strong>${htmlEscape(k.value)}</strong><em>${htmlEscape(k.hint||'')}</em></article>`).join('');
  const intel=data.intelligence||{};
  const intelHtml=`<section class="intel"><h2>Executive School Intelligence</h2><div class="score"><strong>${htmlEscape(intel.healthScore||'—')}<small>/100</small></strong><span>${htmlEscape(intel.status||'Current status')}</span></div><div class="intel-grid"><p><b>Strongest area</b>${htmlEscape(intel.strongestArea||'—')}</p><p><b>Main concern</b>${htmlEscape(intel.mainConcern||'—')}</p><p><b>Trend</b>${htmlEscape(intel.trend||'—')}</p><p><b>Top action</b>${htmlEscape(intel.topAction||'—')}</p></div></section>`;
  const blocks=sections.filter(key=>key!=='kpis').map(key=>{const rows=normalizeRows(rowsForSection(data,key));const display=rows.length?rows:[{Status:'No data available'}];const cols=rowColumns(display);return `<section><h2>${htmlEscape(humanSection(key))}</h2><table><thead><tr>${cols.map(c=>`<th>${htmlEscape(c)}</th>`).join('')}</tr></thead><tbody>${display.slice(0,80).map(r=>`<tr>${cols.map(c=>`<td>${htmlEscape(typeof r[c]==='object'?JSON.stringify(r[c]):r[c])}</td>`).join('')}</tr>`).join('')}</tbody></table></section>`;}).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${htmlEscape(data.title||'Analytics Report')}</title><style>body{font-family:Inter,Arial,sans-serif;color:#0f172a;margin:0;background:#f8fafc}header{background:linear-gradient(135deg,#083A85,#11B5B1);color:white;padding:32px 42px}h1{margin:0;font-size:28px}header p{margin:8px 0 0;opacity:.9}.meta{font-size:12px;margin-top:12px;opacity:.86}.wrap{padding:28px 42px}.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px}.kpis article,.intel,section{background:white;border:1px solid #dbe4ee;border-radius:14px;padding:14px;box-shadow:0 8px 24px rgba(15,23,42,.06)}.kpis small{display:block;color:#64748b;font-weight:800}.kpis strong{display:block;margin-top:5px;font-size:20px;color:#083A85}.kpis em{display:block;margin-top:4px;font-style:normal;color:#11B5B1;font-size:11px}.intel{margin:0 0 20px}.score{display:flex;align-items:end;gap:12px}.score strong{font-size:42px;color:#083A85}.score small{font-size:16px;color:#64748b}.score span{font-weight:900;color:#11B5B1}.intel-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-top:12px}.intel-grid p{border-left:4px solid #11B5B1;background:#f8fafc;padding:10px;margin:0}.intel-grid b{display:block;color:#083A85}section{margin:18px 0;page-break-inside:avoid}h2{margin:0 0 12px;color:#083A85;font-size:18px}table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #dbe4ee;padding:8px;text-align:left;vertical-align:top}th{background:#083A85;color:white}button{position:fixed;right:24px;bottom:24px;border:0;background:#11B5B1;color:white;border-radius:999px;padding:12px 18px;font-weight:800}@media print{button{display:none}body{background:white}.wrap{padding:18px}.kpis{grid-template-columns:repeat(2,1fr)}}@media(max-width:800px){.kpis,.intel-grid{grid-template-columns:1fr}}</style></head><body><header><h1>${htmlEscape(data.title||'Analytics Report')}</h1><p>${htmlEscape(data.subtitle||'')}</p><div class="meta">Scope: ${htmlEscape(data.scope?.label||data.tenantScoped||'Current scope')} · Generated ${new Date().toLocaleString()} · Year: ${htmlEscape(data.filters?.year||'All')} · Term: ${htmlEscape(data.filters?.term||'All')}</div></header><main class="wrap"><div class="kpis">${kpiCards}</div>${intelHtml}${blocks}</main><button onclick="window.print()">Print report</button></body></html>`;
}
async function buildWorkbook(data, sections){
  const workbook=new ExcelJS.Workbook();workbook.creator='Shule AI';workbook.created=new Date();
  const summary=workbook.addWorksheet('Summary');
  summary.columns=[{width:26},{width:45},{width:22},{width:28}];
  summary.addRow(['Shule AI Analytics Report']);summary.mergeCells('A1:D1');summary.getCell('A1').font={bold:true,size:18,color:{argb:'FFFFFFFF'}};summary.getCell('A1').fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF083A85'}};
  summary.addRow(['Title', data.title||'Analytics Report']);summary.addRow(['Scope', data.scope?.label||data.tenantScoped||'Current scope']);summary.addRow(['Generated', new Date().toISOString()]);summary.addRow(['Year', data.filters?.year||'All']);summary.addRow(['Term', data.filters?.term||'All']);summary.addRow([]);summary.addRow(['KPI','Value','Note']);
  const headerRow=summary.lastRow;headerRow.font={bold:true,color:{argb:'FFFFFFFF'}};headerRow.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF11B5B1'}};
  (data.kpis||[]).forEach(k=>summary.addRow([k.label,k.value,k.hint||'']));
  for(const key of sections){const rows=normalizeRows(rowsForSection(data,key));const display=rows.length?rows:[{Status:'No data available'}];const title=humanSection(key).slice(0,31).replace(/[\\/*?:\[\]]/g,' ').trim()||'Analytics';const sheet=workbook.addWorksheet(title);const cols=rowColumns(display);sheet.columns=cols.map(c=>({header:c,key:c,width:Math.min(48,Math.max(14,String(c).length+6))}));display.forEach(row=>sheet.addRow(row));sheet.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};sheet.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF083A85'}};sheet.views=[{state:'frozen',ySplit:1}];sheet.autoFilter={from:{row:1,column:1},to:{row:Math.max(1,sheet.rowCount),column:cols.length}};}
  return workbook.xlsx.writeBuffer();
}
function ensurePdfSpace(doc, needed = 80) { if (doc.y + needed > 760) doc.addPage(); }
function pdfTable(doc,title,rows,options={}){
  const display=normalizeRows(rows.length?rows:[]);
  if(!display.length) return;
  ensurePdfSpace(doc, 75);
  doc.moveDown(.7).fontSize(14).fillColor('#083A85').text(title,{continued:false});doc.moveDown(.3);
  const cols=rowColumns(display).slice(0, options.maxCols || 6);
  const widths=cols.map(()=>Math.max(70,Math.floor(500/cols.length)));
  let y=doc.y;
  doc.rect(50,y,500,20).fill('#083A85');
  let x=50;cols.forEach((c,i)=>{doc.fillColor('#ffffff').fontSize(8).text(c,x+4,y+6,{width:widths[i]-8,height:12});x+=widths[i];});
  y+=20;
  display.slice(0, options.maxRows || 35).forEach((row,index)=>{if(y>748){doc.addPage();y=50;doc.rect(50,y,500,20).fill('#083A85');x=50;cols.forEach((c,i)=>{doc.fillColor('#ffffff').fontSize(8).text(c,x+4,y+6,{width:widths[i]-8,height:12});x+=widths[i];});y+=20;}doc.rect(50,y,500,22).fill(index%2?'#F8FAFC':'#FFFFFF');x=50;cols.forEach((c,i)=>{const value=typeof row[c]==='object'?JSON.stringify(row[c]):row[c];doc.fillColor('#0F172A').fontSize(8).text(text(value,'—').slice(0,95),x+4,y+6,{width:widths[i]-8,height:12});x+=widths[i];});y+=22;});
  doc.y=y;
}
function pdfInsightBox(doc, label, value, x, y, w, tone='#11B5B1') { doc.roundedRect(x,y,w,64,10).fill('#F8FAFC').stroke('#DBE4EE'); doc.fillColor('#64748B').fontSize(7).text(label,x+10,y+10,{width:w-20}); doc.fillColor(tone).fontSize(16).text(String(value||'—'),x+10,y+26,{width:w-20}); }
function buildPdf(data,sections){return new Promise((resolve,reject)=>{const doc=new PDFDocument({size:'A4',margin:50,bufferPages:true});const chunks=[];doc.on('data',c=>chunks.push(c));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);
  const intel=data.intelligence||{};
  doc.rect(0,0,595,126).fill('#083A85');doc.fillColor('#FFFFFF').fontSize(24).text(data.title||'Analytics Report',50,30,{width:495});doc.fontSize(10).text(`${data.subtitle||''}\nScope: ${data.scope?.label||data.tenantScoped||''}`,50,66,{width:495});doc.fillColor('#0F172A').fontSize(9).text(`Generated: ${new Date().toLocaleString()} | Year: ${data.filters?.year||'All'} | Term: ${data.filters?.term||'All'}`,50,142);doc.y=166;
  doc.fontSize(16).fillColor('#083A85').text('Executive School Intelligence');doc.moveDown(.4);
  const y0=doc.y;pdfInsightBox(doc,'School Health Score',`${intel.healthScore||'—'} / 100`,50,y0,118,'#083A85');pdfInsightBox(doc,'Status',intel.status||'—',178,y0,118,'#11B5B1');pdfInsightBox(doc,'Trend',intel.trend||'—',306,y0,118,'#2F80ED');pdfInsightBox(doc,'Confidence',intel.confidence||'—',434,y0,118,'#F59E0B');doc.y=y0+78;
  [['Strongest Area',intel.strongestArea],['Main Concern',intel.mainConcern],['Recommended Action',intel.topAction]].forEach(([label,value])=>{ensurePdfSpace(doc,40);doc.fillColor('#083A85').fontSize(10).text(label,{continued:false});doc.fillColor('#0F172A').fontSize(9).text(String(value||'—'),{width:495});doc.moveDown(.35);});
  const kpis=(data.kpis||[]).slice(0,6);if(kpis.length){ensurePdfSpace(doc,95);doc.fontSize(14).fillColor('#083A85').text('KPI Summary');doc.moveDown(.4);let x=50,y=doc.y;kpis.forEach((k,i)=>{if(i&&i%3===0){x=50;y+=56;}doc.roundedRect(x,y,160,44,8).fill('#F8FAFC').stroke('#DBE4EE');doc.fillColor('#64748B').fontSize(7).text(k.label,x+10,y+8,{width:140});doc.fillColor('#083A85').fontSize(12).text(String(k.value),x+10,y+22,{width:140});x+=170;});doc.y=y+62;}
  const ordered=[...new Set(['list:dataQualityWarnings','list:recommendedActions',...sections.filter(k=>k!=='kpis')])];
  ordered.forEach(key=>pdfTable(doc,humanSection(key),rowsForSection(data,key),{maxRows:key.includes('Warnings')||key.includes('Actions')?12:35}));
  const range=doc.bufferedPageRange();for(let i=0;i<range.count;i++){doc.switchToPage(i);doc.fontSize(8).fillColor('#64748b').text(`Shule AI analytics · Page ${i+1} of ${range.count}`,50,810,{align:'center',width:495});}doc.end();});}


exports.getDashboardAnalytics = async (req,res)=>{try{const data=await dataForRequest(req);return res.json({success:true,data});}catch(error){console.error('[v152 analytics]',error);return res.status(error.status||500).json({success:false,message:error.message||'Analytics could not be loaded.'});}};

exports.getAnalyticsTables = async (req, res) => {
  try {
    const data = await dataForRequest(req);
    const tables = {};
    Object.entries(data.lists || {}).forEach(([key, value]) => {
      if (Array.isArray(value)) tables[key] = value;
      else if (value && typeof value === 'object') tables[key] = Object.entries(value).map(([name, val]) => ({ name, value: val }));
    });
    return res.json({ success: true, data: { variant: data.variant, scope: data.scope, filters: data.filters, tables, updatedAt: data.updatedAt, realData: true, tenantScoped: data.tenantScoped } });
  } catch (error) {
    console.error('[v152 analytics tables]', error);
    return res.status(error.status || 500).json({ success: false, message: error.message || 'Analytics tables could not be loaded.' });
  }
};

exports.getAnalyticsTable = async (req, res) => {
  try {
    const data = await dataForRequest(req);
    const key = text(req.params.section);
    const value = data.lists?.[key];
    if (value === undefined) return res.status(404).json({ success: false, message: `Analytics table '${key}' is not available for this scope.` });
    const rows = Array.isArray(value) ? value : (value && typeof value === 'object' ? Object.entries(value).map(([name, val]) => ({ name, value: val })) : []);
    return res.json({ success: true, data: { key, rows, scope: data.scope, filters: data.filters, updatedAt: data.updatedAt, realData: true, tenantScoped: data.tenantScoped } });
  } catch (error) {
    console.error('[v152 analytics table]', error);
    return res.status(error.status || 500).json({ success: false, message: error.message || 'Analytics table could not be loaded.' });
  }
};

exports.exportAnalytics = async (req,res)=>{
  try{
    const body = req.body || {};
    req.query={...(req.query||{}),...(body.filters||{}),scopeType:body.scopeType||body.filters?.scopeType,scopeId:body.scopeId||body.filters?.scopeId,childId:body.childId||body.filters?.childId,analyticsType:body.analyticsType||body.filters?.analyticsType};
    const data=await dataForRequest(req);
    const sections=selectedSections(data,body.include,body.analyticsType||body.filters?.analyticsType||data.filters?.analyticsType);
    const format=text(body.format,'pdf').toLowerCase();
    const base=`shule-ai-${safeName(data.variant)}-${safeName(data.scope?.label||data.tenantScoped)}-${new Date().toISOString().slice(0,10)}`;
    if(format==='xlsx'||format==='excel'){
      const buffer=await buildWorkbook(data,sections);
      res.set({'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename="${base}.xlsx"`});
      return res.send(Buffer.from(buffer));
    }
    if(format==='csv'){
      res.set({'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="${base}.csv"`});
      return res.send(buildCsv(data,sections));
    }
    if(format==='print'||format==='html'){
      res.set({'Content-Type':'text/html; charset=utf-8','Content-Disposition':`inline; filename="${base}.html"`});
      return res.send(buildPrintHtml(data,sections));
    }
    const pdf=await buildPdf(data,sections);
    res.set({'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="${base}.pdf"`});
    return res.send(pdf);
  }catch(error){
    console.error('[v152 analytics export]',error);
    return res.status(error.status||500).json({success:false,message:error.message||'Analytics export failed.'});
  }
};
