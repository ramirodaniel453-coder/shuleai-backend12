'use strict';

const { Op } = require('sequelize');
const {
  sequelize, Student, User, Parent, Class, School, Teacher, TeacherSubjectAssignment
} = require('../models');
const curriculumEngine = require('../services/curriculumStructureEngine');
const { listStudentSubjectSelections, replaceStudentSubjectSelections } = require('../services/studentSubjectSelectionService');
const { createAlert } = require('../services/notificationService');

function schoolCodeOf(user) { return user?.schoolCode || user?.schoolId || null; }
function norm(v) { return String(v || '').trim().toLowerCase(); }
function subjectName(s) { return s?.subjectName || s?.name || s?.subject || ''; }
function isSeniorClass(cls, student) {
  const text = [cls?.levelCode, cls?.levelLabel, cls?.curriculumLevel, cls?.grade, cls?.name, student?.grade].filter(Boolean).join(' ').toLowerCase();
  return /(^|\D)(grade\s*)?(10|11|12)(\D|$)|senior|senior secondary|g10|g11|g12/.test(text);
}
async function getSchool(schoolCode) {
  return School.findOne({ where: { schoolId: schoolCode } });
}
async function getStudentClass(student, schoolCode) {
  if (student?.classId) {
    const cls = await Class.findOne({ where: { id: student.classId, schoolCode } }).catch(() => null);
    if (cls) return cls;
  }
  return Class.findOne({ where: { schoolCode, isActive: true, [Op.or]: [{ name: student.grade }, { grade: student.grade }] } }).catch(() => null);
}
async function getContext(student, schoolCode) {
  const school = await getSchool(schoolCode);
  const classItem = await getStudentClass(student, schoolCode);
  const eligibleSubjects = classItem ? curriculumEngine.getEligibleSubjectsForClass(school, classItem) : [];
  return { school, classItem, eligibleSubjects, senior: isSeniorClass(classItem, student) };
}
function validateSubjects(rawSubjects, eligibleSubjects) {
  const eligibleByName = new Map((eligibleSubjects || []).map(s => [norm(subjectName(s)), s]));
  const valid = [];
  const invalid = [];
  for (const incoming of rawSubjects || []) {
    const name = subjectName(incoming);
    const match = eligibleByName.get(norm(name));
    if (!match) { invalid.push(incoming); continue; }
    valid.push({
      ...match,
      ...incoming,
      subjectId: incoming.subjectId || incoming.id || match.subjectId || match.id || null,
      subjectName: subjectName(incoming) || subjectName(match),
      isCompulsory: !!(incoming.isCompulsory || match.isCompulsory),
      isElective: incoming.isElective === undefined ? !match.isCompulsory : !!incoming.isElective
    });
  }
  return { valid, invalid };
}
async function findStudentForCurrentUser(user) {
  return Student.findOne({ where: { userId: user.id }, include: [{ model: User, attributes: ['id','name','schoolCode'] }] });
}
async function assertParentChild(user, studentId) {
  const parent = await Parent.findOne({ where: { userId: user.id }, include: [{ model: Student, as: 'students', where: { id: studentId }, required: true, include: [{ model: User, attributes: ['id','name','schoolCode'] }] }] });
  return parent?.students?.[0] || null;
}
async function notify({ schoolCode, student, classItem, selections, actor, source = 'student' }) {
  try {
    const studentName = student?.User?.name || student?.name || `Student #${student?.id}`;
    const subjects = (selections || []).map(s => s.subjectName).filter(Boolean);
    const title = 'Senior subject choices submitted';
    const message = `${studentName} submitted ${subjects.length} Grade 10–12 subject choice(s): ${subjects.join(', ') || 'none yet'}.`;
    const recipients = new Map();
    const admins = await User.findAll({ where: { schoolCode, role: 'admin', isActive: true }, limit: 50 }).catch(() => []);
    admins.forEach(u => recipients.set(u.id, u));
    if (classItem?.teacherId) {
      const ct = await Teacher.findByPk(classItem.teacherId, { include: [{ model: User, attributes: ['id','role','schoolCode','name'] }] }).catch(() => null);
      if (ct?.User?.id) recipients.set(ct.User.id, ct.User);
    }
    const assignments = await TeacherSubjectAssignment.findAll({ where: { schoolCode: schoolCode } }).catch(() => []);
    const classAssignments = await TeacherSubjectAssignment.findAll({ where: { classId: classItem?.id || -1 } }).catch(() => []);
    const allAssignments = [...assignments, ...classAssignments];
    const selectionNames = new Set(subjects.map(norm));
    for (const ass of allAssignments) {
      if (selectionNames.has(norm(ass.subject))) {
        const teacher = await Teacher.findByPk(ass.teacherId, { include: [{ model: User, attributes: ['id','role','schoolCode','name'] }] }).catch(() => null);
        if (teacher?.User?.id && teacher.User.schoolCode === schoolCode) recipients.set(teacher.User.id, teacher.User);
      }
    }
    for (const user of recipients.values()) {
      const dedupeKey = [schoolCode, user.id, 'subject-selection', student.id, subjects.slice().sort().join('|')].join(':');
      const payload = {
        userId: user.id,
        role: user.role,
        type: 'academic',
        severity: 'info',
        title,
        message,
        categoryLabel: 'Subject Selection',
        sourceType: 'subject_selection',
        sourceLabel: 'Grade 10–12 Subject Choices',
        targetRole: user.role,
        targetUserId: user.id,
        dedupeKey,
        actionUrl: user.role === 'teacher' ? '#subject-requests' : '#student-subject-selection',
        actionLabel: 'Review choices',
        data: { studentId: student.id, classId: classItem?.id || null, source, subjects, actorUserId: actor?.id || null }
      };
      await createAlert({ ...payload, data:{ ...payload.data, schoolCode } });
    }
  } catch (err) {
    console.warn('Subject-selection notification failed:', err.message);
  }
}
async function renderGetForStudent(student, schoolCode) {
  const { school, classItem, eligibleSubjects, senior } = await getContext(student, schoolCode);
  const selections = await listStudentSubjectSelections({ schoolCode, studentId: student.id, classId: classItem?.id || null });
  return { school: school ? { schoolId: school.schoolId, name: school.name, system: school.system } : null, student, class: classItem, eligibleSubjects, senior, selections };
}

exports.getStudentOwnSelection = async (req, res) => {
  try {
    const schoolCode = schoolCodeOf(req.user);
    const student = await findStudentForCurrentUser(req.user);
    if (!student || student.User?.schoolCode !== schoolCode) return res.status(404).json({ success:false, message:'Student profile not found' });
    res.json({ success:true, data: await renderGetForStudent(student, schoolCode) });
  } catch (e) { res.status(500).json({ success:false, message:e.message }); }
};

exports.saveStudentOwnSelection = async (req, res) => {
  try {
    const schoolCode = schoolCodeOf(req.user);
    const student = await findStudentForCurrentUser(req.user);
    if (!student || student.User?.schoolCode !== schoolCode) return res.status(404).json({ success:false, message:'Student profile not found' });
    const ctx = await getContext(student, schoolCode);
    if (!ctx.senior) return res.status(400).json({ success:false, message:'Subject choice is only available for Grade 10, 11 and 12 students. Other classes continue using curriculum defaults.' });
    const { valid, invalid } = validateSubjects(req.body.subjects || [], ctx.eligibleSubjects);
    if (invalid.length) return res.status(400).json({ success:false, message:'Some selected subjects are not valid for this class/curriculum', data:{ invalid, eligibleSubjects:ctx.eligibleSubjects } });
    const rows = await replaceStudentSubjectSelections({ schoolCode, studentId:student.id, classId:ctx.classItem?.id || null, pathway:req.body.pathway, track:req.body.track, subjects:valid, actorUserId:req.user.id, requestedBy:req.user.id, defaultStatus:'requested', metadata:{ submittedByRole:'student', submittedAt:new Date().toISOString() } });
    await notify({ schoolCode, student, classItem:ctx.classItem, selections:rows, actor:req.user, source:'student' });
    res.json({ success:true, message:'Subject choices submitted for teacher/admin verification', data:{ selections:rows } });
  } catch (e) { res.status(500).json({ success:false, message:e.message }); }
};

exports.getParentChildSelection = async (req, res) => {
  try {
    const schoolCode = schoolCodeOf(req.user);
    const student = await assertParentChild(req.user, req.params.studentId);
    if (!student || student.User?.schoolCode !== schoolCode) return res.status(404).json({ success:false, message:'Child not found under your account' });
    res.json({ success:true, data: await renderGetForStudent(student, schoolCode) });
  } catch (e) { res.status(500).json({ success:false, message:e.message }); }
};

exports.saveParentChildSelection = async (req, res) => {
  try {
    const schoolCode = schoolCodeOf(req.user);
    const student = await assertParentChild(req.user, req.params.studentId);
    if (!student || student.User?.schoolCode !== schoolCode) return res.status(404).json({ success:false, message:'Child not found under your account' });
    const ctx = await getContext(student, schoolCode);
    if (!ctx.senior) return res.status(400).json({ success:false, message:'Parent subject help is only needed for Grade 10, 11 and 12.' });
    const { valid, invalid } = validateSubjects(req.body.subjects || [], ctx.eligibleSubjects);
    if (invalid.length) return res.status(400).json({ success:false, message:'Some selected subjects are not valid for this child class/curriculum', data:{ invalid, eligibleSubjects:ctx.eligibleSubjects } });
    const rows = await replaceStudentSubjectSelections({ schoolCode, studentId:student.id, classId:ctx.classItem?.id || null, pathway:req.body.pathway, track:req.body.track, subjects:valid, actorUserId:req.user.id, requestedBy:req.user.id, defaultStatus:'parent_supported', metadata:{ submittedByRole:'parent', parentUserId:req.user.id, submittedAt:new Date().toISOString() } });
    await notify({ schoolCode, student, classItem:ctx.classItem, selections:rows, actor:req.user, source:'parent' });
    res.json({ success:true, message:'Subject choices saved and sent for school verification', data:{ selections:rows } });
  } catch (e) { res.status(500).json({ success:false, message:e.message }); }
};

exports.listTeacherSubjectRequests = async (req, res) => {
  try {
    const schoolCode = schoolCodeOf(req.user);
    const teacher = await Teacher.findOne({ where: { userId:req.user.id } });
    if (!teacher) return res.status(404).json({ success:false, message:'Teacher profile not found' });
    const assignments=await TeacherSubjectAssignment.findAll({where:{teacherId:teacher.id}}).catch(()=>[]);const assignedClassIds=[...new Set([teacher.classId,...assignments.map(a=>a.classId)].filter(Boolean).map(Number))],assignedClasses=assignedClassIds.length?await Class.findAll({where:{id:{[Op.in]:assignedClassIds},schoolCode,isActive:true}}):[],seniorClassIds=assignedClasses.filter(c=>isSeniorClass(c)).map(c=>Number(c.id));if(!seniorClassIds.length)return res.json({success:true,data:{requests:[],summary:{},subjects:[],classIds:[],seniorOnly:true}});const subjects=[...new Set([...(teacher.subjects||[]),...assignments.filter(a=>seniorClassIds.includes(Number(a.classId))).map(a=>a.subject)].filter(Boolean).map(norm))];const replacements={schoolCode,classIds:seniorClassIds};
    const [rows] = await sequelize.query(`
      SELECT sss.*, su."name" AS "studentName", st."elimuid", st."grade", c."name" AS "className"
      FROM "StudentSubjectSelections" sss
      JOIN "Students" st ON st."id" = sss."studentId"
      LEFT JOIN "Users" su ON su."id" = st."userId"
      LEFT JOIN "Classes" c ON c."id" = sss."classId"
      WHERE sss."schoolCode" = :schoolCode
        AND sss."classId" IN (:classIds)
      ORDER BY sss."updatedAt" DESC, sss."subjectName" ASC
    `, { replacements }).catch(() => [[]]);
    const summary = {};
    for (const row of rows || []) summary[row.subjectName] = (summary[row.subjectName] || 0) + 1;
    res.json({ success:true, data:{requests:rows||[],summary,subjects,classIds:seniorClassIds,seniorOnly:true} });
  } catch (e) { res.status(500).json({ success:false, message:e.message }); }
};

exports.reviewTeacherSubjectRequest = async (req, res) => {
  try {
    const action = norm(req.body.action || req.body.status);
    const status = ['reject','rejected','deny','denied'].includes(action) ? 'rejected' : 'accepted_by_teacher';
    const note = req.body.note || req.body.reason || null;
    const [rows] = await sequelize.query(`
      UPDATE "StudentSubjectSelections"
      SET "status" = :status,
          "metadata" = COALESCE("metadata", '{}'::jsonb) || :metadata::jsonb,
          "updatedAt" = NOW()
      WHERE "id" = :id AND "schoolCode" = :schoolCode
      RETURNING *
    `, { replacements:{ id:req.params.selectionId, schoolCode:schoolCodeOf(req.user), status, metadata:JSON.stringify({ teacherReview:{ status, note, reviewedBy:req.user.id, reviewedAt:new Date().toISOString() } }) } });
    if (!rows.length) return res.status(404).json({ success:false, message:'Subject selection request not found' });
    res.json({ success:true, message:`Student subject entry ${status === 'rejected' ? 'rejected' : 'accepted'} by teacher`, data:rows[0] });
  } catch (e) { res.status(500).json({ success:false, message:e.message }); }
};

exports.verifyAdminStudentSelection = async (req, res) => {
  try {
    const student = await Student.findByPk(req.params.studentId, { include:[{ model: User, attributes:['id','name','schoolCode'] }] });
    if (!student || student.User?.schoolCode !== schoolCodeOf(req.user)) return res.status(404).json({ success:false, message:'Student not found in this school' });
    const classItem = await getStudentClass(student, schoolCodeOf(req.user));
    const [rows] = await sequelize.query(`
      UPDATE "StudentSubjectSelections"
      SET "status" = :status,
          "approvedBy" = :approvedBy,
          "approvedAt" = NOW(),
          "metadata" = COALESCE("metadata", '{}'::jsonb) || :metadata::jsonb,
          "updatedAt" = NOW()
      WHERE "schoolCode" = :schoolCode AND "studentId" = :studentId AND (:classId::int IS NULL OR "classId" = :classId)
      RETURNING *
    `, { replacements:{ schoolCode:schoolCodeOf(req.user), studentId:student.id, classId:classItem?.id || null, status:req.body.status || 'verified_by_admin', approvedBy:req.user.id, metadata:JSON.stringify({ adminVerification:{ status:req.body.status || 'verified_by_admin', note:req.body.note || null, verifiedBy:req.user.id, verifiedAt:new Date().toISOString() } }) } });
    res.json({ success:true, message:'Student subject choices verified', data:{ selections:rows } });
  } catch (e) { res.status(500).json({ success:false, message:e.message }); }
};
