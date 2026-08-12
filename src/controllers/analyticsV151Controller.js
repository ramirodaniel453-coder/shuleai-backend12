const { Op } = require('sequelize');
const { sequelize, User, Student, Parent, Teacher, Class, StudentEnrollment, School } = require('../models');
const linkage = require('../services/schoolLinkageService');
const { getAlertsForUser } = require('../services/alertReceiverEngine');

function num(v, fallback = 0) { const n = Number(v); return Number.isFinite(n) ? n : fallback; }
function pct(part, total) { return total ? Math.round((num(part) / num(total)) * 1000) / 10 : 0; }
function money(v) { return Math.round(num(v)); }
function safeText(v, fallback = '') { return String(v ?? fallback).trim(); }
function nowIso() { return new Date().toISOString(); }
function startDate(days = 30) { const d = new Date(); d.setDate(d.getDate() - days); return d.toISOString().slice(0, 10); }
function currentYear(q = {}) { const y = Number(q.year || new Date().getFullYear()); return Number.isInteger(y) ? y : new Date().getFullYear(); }
function currentTerm(q = {}) { return ['Term 1','Term 2','Term 3'].includes(q.term) ? q.term : null; }
function completedStatusSql(alias = '') { const col = alias ? `${alias}.status` : 'status'; return `LOWER(COALESCE(${col},'')) IN ('completed','successful','approved','paid','success')`; }
function avgScore(rows) { const vals = (rows || []).map(r => num(r.score)).filter(v => Number.isFinite(v)); return vals.length ? Math.round(vals.reduce((a,b)=>a+b,0) / vals.length) : 0; }
function grade(score) { score = num(score); if (score >= 80) return 'A'; if (score >= 70) return 'B'; if (score >= 60) return 'C'; if (score >= 50) return 'D'; return score > 0 ? 'E' : '—'; }
function kpi(label, value, icon, tone = 'teal', hint = '', sub = '') { return { label, value, icon, tone, hint, sub }; }
function insight(title, message, tone = 'info', time = 'Updated now', icon = 'info') { return { title, message, tone, time, icon }; }

async function q(sql, replacements = {}) {
  return sequelize.query(sql, { replacements, type: sequelize.QueryTypes.SELECT });
}
async function scalar(sql, replacements = {}, field = 'value') {
  const rows = await q(sql, replacements).catch(() => []);
  return num(rows?.[0]?.[field] ?? rows?.[0]?.count ?? rows?.[0]?.total ?? rows?.[0]?.value, 0);
}
async function findSchool(schoolCode) {
  if (!schoolCode) return null;
  return School.findOne({ where: { schoolId: schoolCode } }).catch(() => null);
}
async function countRole(schoolCode, role) {
  return scalar('SELECT COUNT(*)::int AS value FROM "Users" WHERE "schoolCode" = :schoolCode AND role = :role AND COALESCE("isActive", true)=true', { schoolCode, role });
}
async function countStudents(schoolCode) {
  return scalar('SELECT COUNT(*)::int AS value FROM "Students" s JOIN "Users" u ON u.id=s."userId" WHERE u."schoolCode"=:schoolCode AND u.role=\'student\' AND COALESCE(u."isActive", true)=true AND COALESCE(s.status,\'active\') <> \'inactive\'', { schoolCode });
}
async function classIdsForTeacher(req) {
  const classes = await linkage.resolveTeacherAssignedClasses(req.user.id, req.user.schoolCode).catch(() => []);
  return { classes, classIds: classes.map(c => Number(c.id)).filter(Boolean) };
}
async function studentsForClassIds(classIds = [], schoolCode) {
  if (!classIds.length || !schoolCode) return [];
  return linkage.resolveClassStudents(classIds, schoolCode, { limit: 5000 }).catch(() => []);
}
async function studentForUser(userId) {
  return Student.findOne({ where: { userId }, include: [{ model: User }] }).catch(() => null);
}
async function parentChild(req, requestedChildId) {
  const parent = await Parent.findOne({ where: { userId: req.user.id } }).catch(() => null);
  if (!parent) return null;
  const linked = await linkage.resolveParentLinkedStudents(req.user.id, req.user.schoolCode).catch(() => []);
  if (!linked.length) return null;
  return linked.find(s => String(s.id) === String(requestedChildId || '')) || linked[0];
}
async function activeClassOfStudent(student, schoolCode) {
  if (!student) return null;
  return linkage.resolveStudentClass(student, schoolCode).catch(() => null);
}
async function recordsForStudents(studentIds = [], schoolCode, filters = {}) {
  const ids = studentIds.map(Number).filter(Boolean);
  if (!ids.length) return [];
  const where = ['ar."studentId" IN (:studentIds)', 'ar."schoolCode" = :schoolCode'];
  const replacements = { studentIds: ids, schoolCode };
  if (filters.year) { where.push('ar.year = :year'); replacements.year = Number(filters.year); }
  if (filters.term) { where.push('ar.term = :term'); replacements.term = filters.term; }
  if (filters.publishedOnly) where.push('COALESCE(ar."isPublished", false)=true');
  return q(`SELECT ar.* FROM "AcademicRecords" ar WHERE ${where.join(' AND ')} ORDER BY ar.date DESC, ar."createdAt" DESC LIMIT 5000`, replacements).catch(() => []);
}
async function attendanceForStudents(studentIds = [], schoolCode, days = 90) {
  const ids = studentIds.map(Number).filter(Boolean);
  if (!ids.length) return [];
  return q(`SELECT * FROM "Attendances" WHERE "schoolCode"=:schoolCode AND "studentId" IN (:studentIds) AND date >= :from ORDER BY date ASC`, { schoolCode, studentIds: ids, from: startDate(days) }).catch(() => []);
}
function attendanceRate(rows = []) { const valid = rows.filter(r => !['holiday'].includes(String(r.status || '').toLowerCase())); const present = valid.filter(r => ['present','late'].includes(String(r.status || '').toLowerCase())).length; return pct(present, valid.length); }
function trendByMonth(rows = [], dateKey = 'createdAt', valueFn = () => 1, months = 7) {
  const labels = [];
  const values = [];
  const now = new Date();
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    labels.push(d.toLocaleString('en-US', { month: 'short' }));
    values.push(rows.filter(r => String(r[dateKey] || r.date || '').slice(0,7) === key).reduce((sum,r)=>sum + num(valueFn(r)),0));
  }
  return { labels, values };
}
function attendanceMonthly(rows = []) {
  const months = [];
  const values = [];
  const now = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    const set = rows.filter(r => String(r.date || '').slice(0,7) === key);
    months.push(d.toLocaleString('en-US', { month: 'short' }));
    values.push(attendanceRate(set));
  }
  return { labels: months, values };
}
function subjectAverages(records = []) {
  const map = new Map();
  for (const r of records) {
    const subject = safeText(r.subject, 'Unknown');
    const row = map.get(subject) || { subject, total: 0, count: 0 };
    row.total += num(r.score); row.count += 1; map.set(subject, row);
  }
  return [...map.values()].map(x => ({ subject: x.subject, average: x.count ? Math.round(x.total / x.count) : 0, score: x.count ? Math.round(x.total / x.count) : 0 })).sort((a,b)=>b.average-a.average);
}
async function feeSummary(schoolCode, filters = {}) {
  const where = ['"schoolCode"=:schoolCode']; const repl = { schoolCode };
  if (filters.year) { where.push('year=:year'); repl.year = Number(filters.year); }
  if (filters.term) { where.push('term=:term'); repl.term = filters.term; }
  const rows = await q(`SELECT COALESCE(SUM("totalAmount"),0)::float AS expected, COALESCE(SUM(COALESCE("parentPaidAmount","paidAmount",0)),0)::float AS paid, COALESCE(SUM(COALESCE("creditAmount",0)),0)::float AS credits FROM "Fees" WHERE ${where.join(' AND ')}`, repl).catch(() => [{ expected:0, paid:0, credits:0 }]);
  const expected = money(rows[0]?.expected); const paid = money(rows[0]?.paid); const credits = money(rows[0]?.credits); const outstanding = Math.max(0, expected - paid - credits);
  return { expected, paid, credits, outstanding, collectionRate: pct(paid + credits, expected) };
}
async function reportCount(schoolCode, filters = {}) {
  const where = ['"schoolCode"=:schoolCode', 'status=\'published\'']; const repl = { schoolCode };
  if (filters.year) { where.push('year=:year'); repl.year = Number(filters.year); }
  if (filters.term) { where.push('term=:term'); repl.term = filters.term; }
  return scalar(`SELECT COUNT(*)::int AS value FROM "ReportSnapshots" WHERE ${where.join(' AND ')}`, repl);
}
async function alertsForUser(user, limit = 4) {
  return getAlertsForUser(user, { limit }).catch(() => []);
}
async function childFeeBalance(studentId, schoolCode) {
  const rows = await q('SELECT COALESCE(SUM("totalAmount" - COALESCE("parentPaidAmount","paidAmount",0) - COALESCE("creditAmount",0)),0)::float AS value FROM "Fees" WHERE "schoolCode"=:schoolCode AND "studentId"=:studentId', { schoolCode, studentId }).catch(()=>[{ value:0 }]);
  return Math.max(0, money(rows[0]?.value));
}
async function taskCompletion(studentIds = [], schoolCode) {
  const ids = studentIds.map(Number).filter(Boolean); if (!ids.length) return { completed:0, total:0, rate:0, pending:0, overdue:0 };
  const rows = await q(`SELECT hta.status, ht."dueDate" FROM "HomeTaskAssignments" hta LEFT JOIN "HomeTasks" ht ON ht.id=hta."taskId" WHERE (hta."schoolCode"=:schoolCode OR ht."schoolCode"=:schoolCode) AND hta."studentId" IN (:studentIds)`, { schoolCode, studentIds: ids }).catch(()=>[]);
  const completed = rows.filter(r => ['completed','submitted','reviewed'].includes(String(r.status||'').toLowerCase())).length;
  const pending = rows.filter(r => ['pending','assigned'].includes(String(r.status||'').toLowerCase())).length;
  const overdue = rows.filter(r => r.dueDate && new Date(r.dueDate) < new Date() && !['completed','submitted','reviewed'].includes(String(r.status||'').toLowerCase())).length;
  return { completed, total: rows.length, rate: pct(completed, rows.length), pending, overdue };
}

async function platformAnalytics(req) {
  const totalSchools = await scalar('SELECT COUNT(*)::int AS value FROM "Schools"');
  const activeSchools = await scalar("SELECT COUNT(*)::int AS value FROM \"Schools\" WHERE status='active'");
  const totalStudents = await scalar("SELECT COUNT(*)::int AS value FROM \"Users\" WHERE role='student' AND COALESCE(\"isActive\", true)=true");
  const totalTeachers = await scalar("SELECT COUNT(*)::int AS value FROM \"Users\" WHERE role='teacher' AND COALESCE(\"isActive\", true)=true");
  const totalParents = await scalar("SELECT COUNT(*)::int AS value FROM \"Users\" WHERE role='parent' AND COALESCE(\"isActive\", true)=true");
  const activeSubscriptions = await scalar("SELECT COUNT(*)::int AS value FROM \"Subscriptions\" WHERE status IN ('active','trial')").catch(()=>0);
  const schoolRows = await q('SELECT name, "createdAt", status, COALESCE("subscriptionPlan",\'free\') AS plan, COALESCE("schoolStructure",\'mixed\') AS structure, COALESCE(address->>\'county\', address->>\'city\', address->>\'region\', \'Unknown\') AS region FROM "Schools" ORDER BY "createdAt" ASC').catch(()=>[]);
  const growth = trendByMonth(schoolRows, 'createdAt', () => 1, 7);
  let running = 0; growth.values = growth.values.map(v => (running += v));
  const planMap = {}; schoolRows.forEach(s => { const p = s.plan || 'free'; planMap[p] = (planMap[p] || 0) + 1; });
  const regionMap = {}; schoolRows.forEach(s => { const r = s.region || 'Unknown'; regionMap[r] = (regionMap[r] || 0) + 1; });
  const engagementRows = await q(`SELECT role, COUNT(*) FILTER (WHERE "lastLogin" >= NOW() - INTERVAL '30 days')::int AS active, COUNT(*)::int AS total FROM "Users" WHERE role IN ('student','teacher','parent','admin') GROUP BY role`).catch(()=>[]);
  const engagement = engagementRows.map(r => ({ label: r.role, value: pct(r.active, r.total), total: num(r.total) }));
  const topSchools = await q(`SELECT s.name, COALESCE(s.address->>'county', s.address->>'city', 'Unknown') AS location, COUNT(u.id)::int AS users FROM "Schools" s LEFT JOIN "Users" u ON u."schoolCode"=s."schoolId" GROUP BY s.id ORDER BY users DESC LIMIT 5`).catch(()=>[]);
  return { variant:'platform', title:'Platform Analytics', subtitle:'Cross-school performance, growth, operations and subscription overview', kpis:[kpi('Total Schools', totalSchools, 'building-2'), kpi('Active Schools', activeSchools, 'shield-check','green'), kpi('Total Students', totalStudents, 'users'), kpi('Total Teachers', totalTeachers, 'user','purple'), kpi('Total Parents', totalParents, 'users','orange'), kpi('Active Subscriptions', activeSubscriptions, 'credit-card','blue')], charts:{ growth, planDistribution:{ labels:Object.keys(planMap), values:Object.values(planMap) }, engagement:{ labels:engagement.map(x=>x.label), values:engagement.map(x=>x.value) }, geographic:{ labels:Object.keys(regionMap).slice(0,6), values:Object.values(regionMap).slice(0,6) } }, lists:{ topSchools: topSchools.map((s,i)=>({ rank:i+1, name:s.name, location:s.location, score: Math.min(100, Math.round(num(s.users) / Math.max(1,totalStudents) * 1000)), growth:'+ real' })), insights:[insight('Platform data is live', `${activeSchools} active schools out of ${totalSchools}.`, 'success'), insight('Subscription overview', `${activeSubscriptions} subscriptions currently active or trial.`, 'info')] }, updatedAt: nowIso() };
}

async function schoolAnalytics(req) {
  const schoolCode = req.user.schoolCode;
  const filters = { year: currentYear(req.query), term: currentTerm(req.query) };
  const school = await findSchool(schoolCode);
  const totalStudents = await countStudents(schoolCode);
  const totalTeachers = await countRole(schoolCode, 'teacher');
  const totalClasses = await scalar('SELECT COUNT(*)::int AS value FROM "Classes" WHERE "schoolCode"=:schoolCode AND COALESCE("isActive", true)=true', { schoolCode });
  const attRows = await q('SELECT * FROM "Attendances" WHERE "schoolCode"=:schoolCode AND date >= :from', { schoolCode, from: startDate(210) }).catch(()=>[]);
  const attRate = attendanceRate(attRows);
  const fees = await feeSummary(schoolCode, filters);
  const publishedReports = await reportCount(schoolCode, filters);
  const classPerf = await q(`WITH record_classes AS (SELECT COALESCE(ar."classId", s."classId", se."classId") AS "classId", ar.score FROM "AcademicRecords" ar JOIN "Students" s ON s.id=ar."studentId" JOIN "Users" u ON u.id=s."userId" LEFT JOIN "StudentEnrollments" se ON se."studentId"=s.id AND se.status='active' WHERE u."schoolCode"=:schoolCode AND ar."schoolCode"=:schoolCode AND (:term::text IS NULL OR ar.term=:term) AND (:year::int IS NULL OR ar.year=:year)) SELECT c.id, c.name, ROUND(AVG(rc.score))::int AS average, COUNT(rc.score)::int AS count FROM "Classes" c LEFT JOIN record_classes rc ON rc."classId"=c.id WHERE c."schoolCode"=:schoolCode AND COALESCE(c."isActive", true)=true GROUP BY c.id ORDER BY average DESC NULLS LAST LIMIT 8`, { schoolCode, term: filters.term, year: filters.year }).catch(()=>[]);
  const subjectPerf = await q('SELECT subject, ROUND(AVG(score))::int AS average FROM "AcademicRecords" WHERE "schoolCode"=:schoolCode AND (:term::text IS NULL OR term=:term) AND (:year::int IS NULL OR year=:year) GROUP BY subject ORDER BY average DESC LIMIT 8', { schoolCode, term: filters.term, year: filters.year }).catch(()=>[]);
  const alerts = await alertsForUser(req.user, 4);
  return { variant:'school', title:'School Analytics', subtitle:'Whole-school performance and operations overview', school:{ name: school?.name || 'School', schoolCode }, filters, kpis:[kpi('Total Students', totalStudents, 'users'), kpi('Teachers', totalTeachers, 'user'), kpi('Attendance Rate', `${attRate}%`, 'calendar-check','green'), kpi('Fees Collected', `KSh ${money(fees.paid).toLocaleString()}`, 'wallet','green'), kpi('Published Reports', publishedReports, 'file-text','blue'), kpi('Active Classes', totalClasses, 'users','orange')], charts:{ attendanceTrend: attendanceMonthly(attRows), classPerformance:{ labels:classPerf.map(c=>c.name), values:classPerf.map(c=>num(c.average)) }, feeSplit:{ labels:['Paid','Outstanding','Credits'], values:[fees.paid, fees.outstanding, fees.credits] }, subjectPerformance:{ labels:subjectPerf.map(s=>s.subject), values:subjectPerf.map(s=>num(s.average)) } }, lists:{ topClasses: classPerf.slice(0,3).map(c=>({ name:c.name, value:num(c.average), meta:`${c.count} marks` })), atRiskClasses: [...classPerf].reverse().slice(0,3).map(c=>({ name:c.name, value:num(c.average), meta:num(c.average)<60?'Needs support':'Monitor' })), insights: alerts.length ? alerts.map(a=>insight(a.title || 'School alert', a.message || 'Review update', a.severity || 'info', new Date(a.createdAt).toLocaleString(), a.type)) : [insight('Analytics connected', 'School data is scoped to your school only.', 'success'), insight('Fee collection', `Collection rate is ${fees.collectionRate}%.`, 'info')] }, finance: fees, updatedAt: nowIso() };
}

async function financeAnalytics(req) {
  const schoolCode = req.user.schoolCode;
  const filters = { year: currentYear(req.query), term: currentTerm(req.query) };
  const fees = await feeSummary(schoolCode, filters);
  const verifiedPayments = await scalar(`SELECT COUNT(*)::int AS value FROM "Payments" WHERE "schoolCode"=:schoolCode AND ${completedStatusSql()}`, { schoolCode });
  const pending = await scalar("SELECT COALESCE(SUM(amount),0)::float AS value FROM \"Payments\" WHERE \"schoolCode\"=:schoolCode AND LOWER(COALESCE(status,''))='pending'", { schoolCode });
  const defaulters = await scalar('SELECT COUNT(*)::int AS value FROM "Fees" WHERE "schoolCode"=:schoolCode AND ("totalAmount" - COALESCE("parentPaidAmount","paidAmount",0) - COALESCE("creditAmount",0)) > 0', { schoolCode });
  const payments = await q(`SELECT amount, COALESCE(method,"paymentGateway",'manual') AS method, COALESCE("paymentDate","transactionDate","createdAt") AS date FROM "Payments" WHERE "schoolCode"=:schoolCode AND ${completedStatusSql()} ORDER BY COALESCE("paymentDate","transactionDate","createdAt") DESC LIMIT 1000`, { schoolCode }).catch(()=>[]);
  const methodMap = {}; payments.forEach(p=>{ const m=p.method || 'manual'; methodMap[m]=(methodMap[m]||0)+num(p.amount); });
  const debtorClasses = await q(`SELECT COALESCE(c.name, s.grade, 'Unassigned') AS class_name, SUM(f."totalAmount" - COALESCE(f."parentPaidAmount",f."paidAmount",0) - COALESCE(f."creditAmount",0))::float AS outstanding, COUNT(DISTINCT f."studentId")::int AS students FROM "Fees" f LEFT JOIN "Students" s ON s.id=f."studentId" LEFT JOIN "Classes" c ON c.id=COALESCE(f."classId",s."classId") WHERE f."schoolCode"=:schoolCode GROUP BY class_name HAVING SUM(f."totalAmount" - COALESCE(f."parentPaidAmount",f."paidAmount",0) - COALESCE(f."creditAmount",0)) > 0 ORDER BY outstanding DESC LIMIT 5`, { schoolCode }).catch(()=>[]);
  return { variant:'finance', title:'Finance Analytics', subtitle:'Monitor collections, balances, verification and fee performance', filters, kpis:[kpi('Total Expected Fees', `KSh ${fees.expected.toLocaleString()}`, 'wallet'), kpi('Total Collected', `KSh ${fees.paid.toLocaleString()}`, 'banknote','green'), kpi('Outstanding Balance', `KSh ${fees.outstanding.toLocaleString()}`, 'users','orange'), kpi('Pending Verifications', `KSh ${money(pending).toLocaleString()}`, 'file-text','blue'), kpi('Defaulters', defaulters, 'user-x','red'), kpi('Verified Payments', verifiedPayments, 'check','purple')], charts:{ collectionTrend: trendByMonth(payments, 'date', r=>r.amount, 7), feeSplit:{ labels:['Paid','Outstanding','Credits'], values:[fees.paid, fees.outstanding, fees.credits] }, paymentMethods:{ labels:Object.keys(methodMap), values:Object.values(methodMap) } }, lists:{ debtorClasses: debtorClasses.map(x=>({ className:x.class_name, outstanding:money(x.outstanding), students:num(x.students) })), classCollection: [], insights:[insight(`${defaulters} students are in fee arrears.`, 'Follow up with parents to avoid default.', defaulters ? 'warning':'success'), insight(`KSh ${money(pending).toLocaleString()} in payments pending verification.`, 'Verify payments to update balances.', pending ? 'warning':'info')] }, finance: fees, updatedAt: nowIso() };
}

async function teacherAnalytics(req) {
  const schoolCode = req.user.schoolCode;
  const filters = { year: currentYear(req.query), term: currentTerm(req.query) };
  const { classes, classIds } = await classIdsForTeacher(req);
  const selectedClassId = Number(req.query.classId || 0);
  const scopeClassIds = selectedClassId && classIds.includes(selectedClassId) ? [selectedClassId] : classIds;
  const students = await studentsForClassIds(scopeClassIds, schoolCode);
  const studentIds = students.map(s=>Number(s.id)).filter(Boolean);
  const records = await recordsForStudents(studentIds, schoolCode, filters);
  const attRows = await attendanceForStudents(studentIds, schoolCode, 90);
  const tasks = await taskCompletion(studentIds, schoolCode);
  const avg = avgScore(records);
  const byStudent = new Map(); records.forEach(r=>{ const row=byStudent.get(r.studentId)||[]; row.push(r); byStudent.set(r.studentId,row); });
  const performance = students.map(s=>({ name:s.User?.name || `Student ${s.id}`, id:s.id, average:avgScore(byStudent.get(s.id)||[]) })).sort((a,b)=>b.average-a.average);
  const risks = performance.filter(x=>x.average && x.average < 60).slice(0,5);
  const reportsReady = await reportCount(schoolCode, filters);
  return { variant:'class', title:'Class Analytics', subtitle:'Track learner performance, attendance, tasks and report readiness', filters:{...filters, classes:classes.map(c=>({id:c.id,name:c.name,stream:c.stream})), selectedClassId:selectedClassId||null}, kpis:[kpi('Students in Class', students.length, 'users'), kpi('Attendance Rate', `${attendanceRate(attRows)}%`, 'calendar-check','green'), kpi('Assignment Completion', `${tasks.rate}%`, 'clipboard-check','blue'), kpi('Average Score', `${avg}%`, 'award','orange'), kpi('At-Risk Learners', risks.length, 'user-x','red'), kpi('Reports Ready', reportsReady, 'file-text','purple')], charts:{ attendanceTrend: attendanceMonthly(attRows), subjectPerformance:{ labels:subjectAverages(records).slice(0,6).map(s=>s.subject), values:subjectAverages(records).slice(0,6).map(s=>s.average) }, homeworkSplit:{ labels:['Completed','Pending','Overdue'], values:[tasks.completed,tasks.pending,tasks.overdue] } }, lists:{ topStudents: performance.slice(0,5), riskStudents: risks, reportStatus:{ published:reportsReady, total:students.length }, insights:[insight('Class data is live', `${students.length} learners are in your assigned class scope.`, 'success'), risks.length ? insight('Learners need support', `${risks.length} learners are below 60% average.`, 'warning') : insight('No major academic risk detected', 'No learner is below 60% in the current marks scope.', 'success')] }, updatedAt: nowIso() };
}

async function childAnalytics(req, forcedStudent = null) {
  const role = req.user.role;
  let student = forcedStudent;
  if (!student && role === 'student') student = await studentForUser(req.user.id);
  if (!student && role === 'parent') student = await parentChild(req, req.query.childId);
  if (!student) throw Object.assign(new Error('Student not found'), { status: 404 });
  const schoolCode = student.User?.schoolCode || req.user.schoolCode;
  if (schoolCode !== req.user.schoolCode && role !== 'super_admin') throw Object.assign(new Error('Student not found in your school'), { status: 404 });
  const filters = { year: currentYear(req.query), term: currentTerm(req.query) };
  const classItem = await activeClassOfStudent(student, schoolCode);
  const records = await recordsForStudents([student.id], schoolCode, { ...filters, publishedOnly: ['student','parent'].includes(role) });
  const attRows = await attendanceForStudents([student.id], schoolCode, 210);
  const tasks = await taskCompletion([student.id], schoolCode);
  const avg = avgScore(records);
  const subjects = subjectAverages(records);
  const feeBalance = role === 'parent' ? await childFeeBalance(student.id, schoolCode) : 0;
  const classStudents = classItem ? await studentsForClassIds([classItem.id], schoolCode) : [];
  let classRank = null;
  if (classStudents.length) {
    const ids = classStudents.map(s=>s.id); const all = await recordsForStudents(ids, schoolCode, filters);
    const ranked = classStudents.map(s => ({ id:s.id, average: avgScore(all.filter(r=>Number(r.studentId)===Number(s.id))) })).sort((a,b)=>b.average-a.average);
    const idx = ranked.findIndex(x=>Number(x.id)===Number(student.id)); if (idx>=0) classRank = idx + 1;
  }
  const badges = await scalar('SELECT COUNT(*)::int AS value FROM "StudentBadges" WHERE "studentId"=:studentId', { studentId: student.id }).catch(()=>0);
  const variant = role === 'parent' ? 'child' : 'student';
  return { variant, title: role === 'parent' ? 'Child Analytics' : 'My Analytics', subtitle: role === 'parent' ? "Follow your child's attendance, progress, strengths and support areas" : 'Track your learning progress, attendance, goals and achievements', filters, student:{ id:student.id, name:student.User?.name, elimuid:student.elimuid, grade:student.grade, className:classItem?.name || student.grade, photo:student.User?.profileImage || student.User?.profilePicture }, kpis:[kpi('Attendance', `${attendanceRate(attRows)}%`, 'calendar-check','green'), kpi(role==='parent'?'Average Performance':'Average Score', `${avg}%`, 'star','purple'), kpi(role==='parent'?'Homework Completion':'Assignments Completed', role==='parent'?`${tasks.rate}%`:`${tasks.completed} / ${tasks.total}`, 'book-open','green'), ...(role==='parent'?[kpi('Current Fee Balance', `KSh ${feeBalance.toLocaleString()}`, 'wallet','blue')]:[kpi('Learning Streak', `${Math.min(12, tasks.completed || 0)} days`, 'flame','green')]), kpi(role==='parent'?'Active Alerts':'Badges Earned', role==='parent'?0:badges, role==='parent'?'bell':'award','orange'), kpi(role==='parent'?'Timetable Adherence':'Class Rank', role==='parent'?`${attendanceRate(attRows)}%`:(classRank?`${classRank} / ${classStudents.length}`:'—'), 'bar-chart-2','blue')], charts:{ performanceTrend:{ labels:subjects.map(s=>s.subject), values:subjects.map(s=>s.average) }, attendanceTrend:attendanceMonthly(attRows), strengthsSplit:{ labels:['Strengths','Needs Support'], values:[subjects.filter(s=>s.average>=70).length, subjects.filter(s=>s.average<60).length] }, weeklyStudy:{ labels:['Mon','Tue','Wed','Thu','Fri','Sat','Sun'], values:[0,0,0,0,0,0,0] } }, lists:{ subjectPerformance:subjects, recommendations:[...(subjects.filter(s=>s.average<60).slice(0,2).map(s=>insight(`Practice ${s.subject}`, `Current average is ${s.average}%. Focused practice can improve it.`, 'warning'))), ...(subjects.filter(s=>s.average>=80).slice(0,1).map(s=>insight(`Maintain strong ${s.subject}`, `Great progress at ${s.average}%. Keep it up.`, 'success')))], leaderboard:[], insights:[insight('Analytics connected', 'This view only uses your own child/student data.', 'success'), tasks.overdue ? insight('Homework overdue', `${tasks.overdue} task(s) are overdue.`, 'warning') : insight('Homework status', `${tasks.completed} task(s) completed.`, 'info')] }, updatedAt: nowIso() };
}

exports.getDashboardAnalytics = async (req, res) => {
  try {
    const role = String(req.user?.role || '').toLowerCase();
    let data;
    if (role === 'super_admin' || role === 'superadmin') data = await platformAnalytics(req);
    else if (role === 'admin') data = await schoolAnalytics(req);
    else if (role === 'finance_officer') data = await financeAnalytics(req);
    else if (role === 'teacher') data = await teacherAnalytics(req);
    else if (role === 'parent' || role === 'student') data = await childAnalytics(req);
    else return res.status(403).json({ success:false, message:'Analytics not available for this role.' });
    return res.json({ success:true, data:{ ...data, role, realData:true, tenantScoped: role === 'super_admin' || role === 'superadmin' ? 'platform' : req.user.schoolCode } });
  } catch (error) {
    console.error('[v151 analytics]', error);
    return res.status(error.status || 500).json({ success:false, message:error.message || 'Analytics could not be loaded.' });
  }
};
