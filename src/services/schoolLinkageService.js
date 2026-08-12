const { Op } = require('sequelize');
const { User, Student, Parent, Teacher, Class, StudentParent, TeacherSubjectAssignment, StudentEnrollment } = require('../models');

function activeOrNull() { return { [Op.or]: [{ isActive: true }, { isActive: null }] }; }
function activeStudentFilter() { return { [Op.or]: [{ status: 'active' }, { status: null }] }; }
function norm(value) { return String(value || '').trim().toLowerCase().replace(/\s+/g, ' '); }
function same(a, b) { return !!a && !!b && norm(a) === norm(b); }
function uniqNums(values = []) { return [...new Set(values.map(Number).filter(Boolean))]; }
function userStudentInclude(schoolCode, attrs) {
  return { model: User, required: true, where: { schoolCode, role: 'student', isActive: true }, attributes: attrs || ['id', 'name', 'email', 'phone', 'profileImage', 'profilePicture', 'schoolCode'] };
}

function gradeVariants(value) {
  const raw = String(value || '').trim();
  const n = norm(raw);
  const compact = n.replace(/\s+/g, '');
  const spaced = n.replace(/^(pp|grade|form)(\d+)/i, '$1 $2').replace(/(\d+)([a-z])$/i, '$1 $2');
  const out = new Set([raw, n, compact, spaced, spaced.replace(/\s+/g, '')].map(v => String(v || '').trim().toLowerCase()).filter(Boolean));
  const m = n.match(/^(?:grade\s*)?(\d{1,2})([a-z])$/i);
  if (m) { out.add(`grade ${m[1]} ${m[2]}`); out.add(`grade ${m[1]}${m[2]}`); }
  const m2 = n.match(/^grade\s*(\d{1,2})([a-z])$/i);
  if (m2) { out.add(`${m2[1]}${m2[2]}`); out.add(`${m2[1]} ${m2[2]}`); }
  return [...out];
}
function classTokens(cls = {}) {
  return [...new Set([
    cls.name,
    cls.grade,
    [cls.grade, cls.stream].filter(Boolean).join(' '),
    [cls.name, cls.stream].filter(Boolean).join(' '),
    String(cls.name || '').replace(/\s+/g, ''),
    String(cls.grade || '').replace(/\s+/g, '')
  ].map(v => String(v || '').trim().toLowerCase()).filter(Boolean))];
}
async function resolveClassByStudentGrade(schoolCode, grade, options = {}) {
  if (!schoolCode || !grade) return null;
  const variants = gradeVariants(grade);
  const classes = await Class.findAll({ where: { schoolCode, ...activeOrNull() }, order: [['isActive','DESC'], ['id','ASC']], transaction: options.transaction }).catch(() => []);
  if (!classes.length) return null;
  // Highest confidence: exact class name match, e.g. PP2 NORTH, Grade 6 EAST.
  let matches = classes.filter(cls => variants.includes(norm(cls.name)) || variants.includes(String(cls.name || '').trim().toLowerCase().replace(/\s+/g, '')));
  if (matches.length === 1) return matches[0];
  // Next: exact grade + stream match.
  matches = classes.filter(cls => cls.stream && variants.includes(norm(`${cls.grade || ''} ${cls.stream || ''}`)));
  if (matches.length === 1) return matches[0];
  // Last safe fallback: grade-only only if one active class exists for that grade in the school.
  matches = classes.filter(cls => variants.includes(norm(cls.grade)) || variants.includes(String(cls.grade || '').trim().toLowerCase().replace(/\s+/g, '')));
  if (matches.length === 1) return matches[0];
  return null;
}

function legacyClassNames(cls = {}) {
  return [...new Set([
    cls.name,
    cls.grade,
    cls.stream ? `${cls.grade || ''} ${cls.stream}` : '',
    cls.stream ? `${cls.name || ''} ${cls.stream}` : ''
  ].map(v => String(v || '').trim()).filter(Boolean))];
}
function studentClassWhereForClasses(classes = []) {
  const clauses = [];
  const ids = classes.map(c => Number(c.id)).filter(Boolean);
  if (ids.length) clauses.push({ classId: { [Op.in]: ids } });
  const names = [...new Set(classes.flatMap(legacyClassNames))];
  if (names.length) clauses.push({ [Op.and]: [{ classId: null }, { grade: { [Op.in]: names } }] });
  return clauses.length ? { [Op.or]: clauses } : { id: -1 };
}
function classStudentWhere(classes = []) {
  return { [Op.and]: [studentClassWhereForClasses(classes), activeStudentFilter()] };
}
async function resolveTeacherProfile(userId) {
  return Teacher.findOne({ where: { userId } }).catch(() => null);
}
async function resolveTeacherAssignedClasses(userId, schoolCode, options = {}) {
  const teacher = await resolveTeacherProfile(userId);
  if (!teacher || !schoolCode) return [];
  const allClasses = await Class.findAll({
    where: { schoolCode, ...activeOrNull() },
    order: [['grade', 'ASC'], ['name', 'ASC'], ['stream', 'ASC']]
  }).catch(() => []);
  const ids = new Set();
  for (const cls of allClasses) {
    if (Number(cls.teacherId) === Number(teacher.id)) ids.add(Number(cls.id));
    if (teacher.classId && Number(cls.id) === Number(teacher.classId)) ids.add(Number(cls.id));
    if (teacher.classTeacher && (same(cls.name, teacher.classTeacher) || same(cls.grade, teacher.classTeacher) || same(`${cls.grade || ''} ${cls.stream || ''}`, teacher.classTeacher))) ids.add(Number(cls.id));
    const subjectTeachers = Array.isArray(cls.subjectTeachers) ? cls.subjectTeachers : [];
    for (const st of subjectTeachers) {
      if (Number(st.teacherId) === Number(teacher.id) && (!options.classTeacherOnly || st.isClassTeacher === true)) ids.add(Number(cls.id));
    }
  }
  const assignmentWhere = { teacherId: teacher.id };
  if (options.classTeacherOnly) assignmentWhere.isClassTeacher = true;
  const rows = await TeacherSubjectAssignment.findAll({ where: assignmentWhere, attributes: ['classId', 'isClassTeacher'] }).catch(() => []);
  for (const row of rows) if (row.classId && (!options.classTeacherOnly || row.isClassTeacher === true)) ids.add(Number(row.classId));
  return allClasses.filter(cls => ids.has(Number(cls.id)));
}
async function activeEnrollmentClassIdsForStudents(studentIds = [], schoolCode) {
  const ids = uniqNums(studentIds);
  if (!ids.length || !schoolCode) return new Map();
  const rows = await StudentEnrollment.findAll({ where: { schoolCode, studentId: { [Op.in]: ids }, status: 'active' }, attributes: ['studentId', 'classId', 'stream', 'academicYear'] }).catch(() => []);
  const map = new Map();
  for (const row of rows) if (row.studentId && row.classId && !map.has(Number(row.studentId))) map.set(Number(row.studentId), row);
  return map;
}
async function resolveClassStudents(classesOrIds, schoolCode, options = {}) {
  const rawList = Array.isArray(classesOrIds) ? classesOrIds : [];
  const rawIds = rawList.map(x => Number(x?.id || x)).filter(Boolean);
  if (!rawIds.length || !schoolCode) return [];
  const classes = await Class.findAll({ where: { id: { [Op.in]: rawIds }, schoolCode, ...activeOrNull() } }).catch(() => []);
  if (!classes.length) return [];
  const direct = await (Student.unscoped ? Student.unscoped() : Student).findAll({
    where: classStudentWhere(classes),
    include: [userStudentInclude(schoolCode, options.userAttributes), { model: Class, required: false, attributes: ['id', 'name', 'grade', 'stream'] }],
    order: options.order || [[User, 'name', 'ASC']],
    limit: options.limit || 2000
  }).catch(() => []);
  const seen = new Map(direct.map(s => [Number(s.id), s]));
  const enrollments = await StudentEnrollment.findAll({ where: { schoolCode, classId: { [Op.in]: classes.map(c => c.id) }, status: 'active' }, attributes: ['studentId', 'classId', 'stream'] }).catch(() => []);
  const missingIds = [...new Set(enrollments.map(e => Number(e.studentId)).filter(id => id && !seen.has(id)))];
  if (missingIds.length) {
    const extra = await (Student.unscoped ? Student.unscoped() : Student).findAll({
      where: { [Op.and]: [{ id: { [Op.in]: missingIds } }, activeStudentFilter()] },
      include: [userStudentInclude(schoolCode, options.userAttributes), { model: Class, required: false, attributes: ['id', 'name', 'grade', 'stream'] }],
      order: options.order || [[User, 'name', 'ASC']],
      limit: options.limit || 2000
    }).catch(() => []);
    const enrollmentByStudent = new Map(enrollments.map(e => [Number(e.studentId), e]));
    const classById = new Map(classes.map(c => [Number(c.id), c]));
    for (const s of extra) {
      const enr = enrollmentByStudent.get(Number(s.id));
      if (enr && !s.Class) s.Class = classById.get(Number(enr.classId)) || null;
      if (enr && !s.classId) s.classId = enr.classId;
      seen.set(Number(s.id), s);
    }
  }
  return [...seen.values()];
}
async function resolveStudentClass(studentOrId, schoolCode) {
  const student = typeof studentOrId === 'object' ? studentOrId : await (Student.unscoped ? Student.unscoped() : Student).findByPk(Number(studentOrId)).catch(() => null);
  if (!student || !schoolCode) return null;
  if (student.classId) {
    const cls = await Class.findOne({ where: { id: Number(student.classId), schoolCode, ...activeOrNull() } }).catch(() => null);
    if (cls) return cls;
  }
  const enrollment = await StudentEnrollment.findOne({ where: { schoolCode, studentId: Number(student.id), status: 'active' }, order: [['effectiveFrom', 'DESC'], ['id', 'DESC']] }).catch(() => null);
  if (enrollment?.classId) {
    const cls = await Class.findOne({ where: { id: Number(enrollment.classId), schoolCode, ...activeOrNull() } }).catch(() => null);
    if (cls) return cls;
  }
  return resolveClassByStudentGrade(schoolCode, student.grade || student.className || student.currentClass);
}
async function resolveParentLinkedStudents(parentUserId, schoolCode) {
  const parent = await Parent.findOne({ where: { userId: parentUserId } }).catch(() => null);
  if (!parent) return [];
  const links = await StudentParent.findAll({ where: { parentId: parent.id, [Op.or]: [{ status: 'active' }, { status: null }] }, attributes: ['studentId', 'parentId', 'relationship'] }).catch(() => []);
  if (!links.length) return [];
  return (Student.unscoped ? Student.unscoped() : Student).findAll({
    where: { [Op.and]: [{ id: { [Op.in]: links.map(l => l.studentId) } }, activeStudentFilter()] },
    include: [userStudentInclude(schoolCode), { model: Class, required: false, attributes: ['id', 'name', 'grade', 'stream'] }]
  }).catch(() => []);
}
async function resolveTeacherClassParents(teacherUserId, schoolCode) {
  const classes = await resolveTeacherAssignedClasses(teacherUserId, schoolCode, { classTeacherOnly: true });
  const students = await resolveClassStudents(classes, schoolCode);
  if (!students.length) return { classes, students: [], rows: [] };
  const links = await StudentParent.findAll({
    where: { studentId: { [Op.in]: students.map(s => s.id) }, [Op.or]: [{ status: 'active' }, { status: null }] },
    include: [{ model: Parent, required: false, include: [{ model: User, required: false, where: { schoolCode, role: 'parent', isActive: true }, attributes: ['id', 'name', 'email', 'phone', 'profileImage', 'profilePicture', 'schoolCode'] }] }]
  }).catch(() => []);
  const byStudent = new Map();
  for (const link of links) {
    const p = link.Parent; const u = p?.User; if (!p || !u) continue;
    const arr = byStudent.get(Number(link.studentId)) || [];
    arr.push({ parentId: p.id, userId: u.id, name: u.name || p.name || 'Parent', email: u.email || p.email || '', phone: u.phone || p.phone || '', relation: link.relationship || p.relationship || 'Guardian', profilePhoto: u.profileImage || u.profilePicture || p.profileImage || null });
    byStudent.set(Number(link.studentId), arr);
  }
  const classById = new Map(classes.map(c => [Number(c.id), c]));
  const rows = students.map(st => {
    const cls = st.Class || classById.get(Number(st.classId)) || null;
    return {
      studentId: st.id,
      userId: st.User?.id,
      studentName: st.User?.name || st.name || st.elimuid || 'Student',
      elimuId: st.elimuid || st.admissionNumber || '',
      classId: st.classId || cls?.id || null,
      className: cls?.name || st.grade || 'Unassigned',
      grade: cls?.grade || st.grade || '',
      stream: cls?.stream || '',
      profilePhoto: st.User?.profileImage || st.User?.profilePicture || st.profileImage || null,
      parents: byStudent.get(Number(st.id)) || []
    };
  });
  return { classes, students, rows };
}
module.exports = { activeOrNull, legacyClassNames, studentClassWhereForClasses, resolveClassByStudentGrade, resolveTeacherProfile, resolveTeacherAssignedClasses, resolveClassStudents, resolveStudentClass, resolveParentLinkedStudents, resolveTeacherClassParents };
