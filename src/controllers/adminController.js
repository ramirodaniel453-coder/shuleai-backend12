const crypto = require('crypto');
const { Op } = require('sequelize');
const { resolveClassStudents, resolveStudentClass } = require('../services/schoolLinkageService');
const { User, UserRoleAssignment, Teacher, Student, Parent, School, Alert, Class, TeacherSubjectAssignment } = require('../models');
const { createAlert } = require('../services/notificationService');
const { getPagination, buildPaginatedResponse } = require('../utils/pagination');
const cache = require('../services/cacheService');
const { findStudentInSchool } = require('../services/studentScopeService');
const studentProfileIntegrity = require('../services/studentProfileIntegrityService');


// Helper for curriculum names
const getCurriculumName = (curriculum) => {
  const names = { cbc: 'CBC', '844': '8-4-4', british: 'British', american: 'American' };
  return names[curriculum] || curriculum;
};

// ============ DASHBOARD ============
exports.getDashboardStats = async (req, res) => {
  try {
    const schoolCode = req.user.schoolCode;
    const integrity = await studentProfileIntegrity.reconcileSchool(schoolCode, req.user.id);
    if (integrity.created || integrity.reactivatedClasses) cache.flushSchoolCache(schoolCode);
    const cacheKey = cache.getCacheKey(['school', schoolCode, 'admin-dashboard-stats']);
    const cached = cache.get(cacheKey);
    if (cached) return res.json({ success: true, cached: true, data: cached });

    const sevenDaysAgo = new Date(Date.now() - 7*24*60*60*1000);
    const [teachers, students, parents, classes, activeClasses, inactiveClasses, pendingApprovals, recentAlerts] = await Promise.all([
      Teacher.count({ include: [{ model: User, where: { schoolCode, role: 'teacher' }, attributes: [] }] }),
      Student.count({ include: [{ model: User, where: { schoolCode, role: 'student' }, attributes: [] }] }),
      Parent.count({ include: [{ model: User, where: { schoolCode, role: 'parent' }, attributes: [] }] }),
      Class.count({ where: { schoolCode } }),
      Class.count({ where: { schoolCode, isActive: true } }),
      Class.count({ where: { schoolCode, isActive: false } }),
      Teacher.count({
        include: [{ model: User, where: { schoolCode, role: 'teacher' }, attributes: [] }],
        where: { approvalStatus: 'pending' }
      }),
      Alert.count({ where: { role: 'admin', createdAt: { [Op.gte]: sevenDaysAgo } } })
    ]);

    const stats = { teachers, students, parents, classes, activeClasses, inactiveClasses, repairedStudentProfiles: integrity.created, pendingApprovals, recentAlerts };
    cache.set(cacheKey, stats, 45);
    res.json({ success: true, cached: false, data: stats });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============ TEACHER MANAGEMENT ============
exports.getAllTeachers = async (req, res) => {
  try {
    const { page, limit, offset } = getPagination(req.query, { defaultLimit: 50, maxLimit: 200 });
    const include = [
      { model: User, where: { schoolCode: req.user.schoolCode }, attributes: ['id','name','email','phone','profileImage','profilePicture','createdAt'] },
      { model: TeacherSubjectAssignment, required: false, attributes: ['id','classId','subject','isClassTeacher'], include: [{ model: Class, required: false, attributes: ['id','name','grade','stream','isActive','schoolCode'] }] }
    ];
    const result = await Teacher.findAndCountAll({
      include,
      distinct: true,
      limit,
      offset,
      order: [['createdAt', 'DESC']]
    });
    const teachers = result.rows;
    const teacherIds = teachers.map(t => Number(t.id)).filter(Boolean);
    const legacyClassIds = teachers.map(t => Number(t.classId)).filter(Boolean);
    let classes = [];
    if (teacherIds.length || legacyClassIds.length) {
      const clauses = [];
      if (teacherIds.length) clauses.push({ teacherId: { [Op.in]: teacherIds } });
      if (legacyClassIds.length) clauses.push({ id: { [Op.in]: legacyClassIds } });
      classes = await Class.findAll({ where: { schoolCode: req.user.schoolCode, isActive: true, [Op.or]: clauses }, attributes: ['id','name','grade','stream','teacherId','isActive'] });
    }
    const data = teachers.map(row => {
      const teacher = row.toJSON ? row.toJSON() : row;
      teacher.TeacherSubjectAssignments = (teacher.TeacherSubjectAssignments || []).filter(a => !a.Class || a.Class.schoolCode === req.user.schoolCode);
      teacher.Classes = classes.filter(c => Number(c.teacherId) === Number(teacher.id) || Number(c.id) === Number(teacher.classId)).map(c => c.toJSON ? c.toJSON() : c);
      teacher.Class = teacher.Classes[0] || null;
      return teacher;
    });
    res.json({ success: true, ...buildPaginatedResponse({ rows: data, count: result.count, page, limit }) });
  } catch (error) {
    console.error('Get teachers error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateTeacher = async (req, res) => {
  try {
    const { teacherId } = req.params;
    const { name, email, phone, department, qualification, employeeId, specialization, approvalStatus, dateJoined, gender, dateOfBirth, location, notes, tscNumber, roles } = req.body || {};
    const teacher = await Teacher.findOne({ where: { id: teacherId }, include: [{ model: User, where: { schoolCode: req.user.schoolCode } }] });
    if (!teacher) return res.status(404).json({ success: false, message: 'Teacher not found in this school' });
    const userPatch = {};
    if (name !== undefined && String(name).trim()) userPatch.name = String(name).trim();
    if (email !== undefined && String(email).trim()) userPatch.email = String(email).trim();
    if (phone !== undefined) userPatch.phone = phone || null;
    if (Object.keys(userPatch).length) await teacher.User.update(userPatch);
    const teacherFields = {};
    if (department !== undefined) teacherFields.department = department || null;
    if (qualification !== undefined) teacherFields.qualification = qualification || null;
    if (specialization !== undefined) teacherFields.specialization = specialization || null;
    if (approvalStatus !== undefined) teacherFields.approvalStatus = approvalStatus;
    if (dateJoined !== undefined && dateJoined !== '') teacherFields.dateJoined = dateJoined;
    if (employeeId !== undefined && employeeId !== '') teacherFields.employeeId = employeeId;
    const existingDuties = teacher.duties && typeof teacher.duties === 'object' ? teacher.duties : {};
    teacherFields.duties = { ...(Array.isArray(existingDuties) ? { list: existingDuties } : existingDuties), profile: { gender: gender ?? existingDuties?.profile?.gender ?? null, dateOfBirth: dateOfBirth ?? existingDuties?.profile?.dateOfBirth ?? null, location: location ?? existingDuties?.profile?.location ?? null, notes: notes ?? existingDuties?.profile?.notes ?? null, tscNumber: tscNumber ?? existingDuties?.profile?.tscNumber ?? null, roles: roles ?? existingDuties?.profile?.roles ?? [] } };
    await teacher.update(teacherFields);
    cache.flushSchoolCache(req.user.schoolCode);
    res.json({ success: true, message: 'Teacher profile updated. Class and subject assignments were preserved.', data: teacher });
  } catch (error) {
    console.error('Update teacher error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.deleteTeacher = async (req, res) => {
  try {
    const { teacherId } = req.params;
    const teacher = await Teacher.findOne({ where: { id: teacherId }, include: [{ model: User, where: { schoolCode: req.user.schoolCode } }] });
    if (!teacher) return res.status(404).json({ success: false, message: 'Teacher not found in this school' });
    const userName = teacher.User?.name || 'Teacher';
    const existingDuties = teacher.duties && typeof teacher.duties === 'object' ? teacher.duties : {};
    await teacher.User.update({ isActive: false });
    await teacher.update({
      approvalStatus: 'suspended',
      duties: { ...(Array.isArray(existingDuties) ? { list: existingDuties } : existingDuties), deactivatedAt: new Date().toISOString(), deactivatedBy: req.user.id }
    });
    cache.flushSchoolCache(req.user.schoolCode);
    res.json({ success: true, message: `${userName} deactivated. Class, subject, academic and audit history were preserved.` });
  } catch (error) {
    console.error('Deactivate teacher error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============ STUDENT MANAGEMENT ============
exports.getAllStudents = async (req, res) => {
  try {
    const integrity = await studentProfileIntegrity.reconcileSchool(req.user.schoolCode, req.user.id);
    if (integrity.created || integrity.reactivatedClasses) cache.flushSchoolCache(req.user.schoolCode);
    const { page, limit, offset } = getPagination(req.query, { defaultLimit: 50, maxLimit: 200 });
    const result = await Student.findAndCountAll({
      include: [{
        model: User,
        where: { schoolCode: req.user.schoolCode },
        attributes: ['id','name','email','phone','profileImage','profilePicture','createdAt']
      }],
      distinct: true,
      limit,
      offset,
      order: [['createdAt', 'DESC']]
    });
    res.json({ success: true, integrity, ...buildPaginatedResponse({ rows: result.rows, count: result.count, page, limit }) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getStudentDetails = async (req, res) => {
  try {
    const student = await Student.findByPk(req.params.studentId, {
      include: [{ model: User, attributes: ['id', 'name', 'email', 'phone', 'schoolCode'] }]
    });
    
    if (!student) return res.status(404).json({ success: false, message: 'Student not found' });
    if (student.User.schoolCode !== req.user.schoolCode) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }
    
    const userData = { ...student.User.toJSON() };
    delete userData.schoolCode;
    
    res.json({ success: true, data: { ...student.toJSON(), User: userData } });
  } catch (error) {
    console.error('Get student details error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Superseded duplicate export removed: updateStudent.

exports.deleteStudent = async (req, res) => {
  try {
    const { studentId } = req.params;
    const student = await findStudentInSchool(studentId, req.user.schoolCode);
    if (!student) return res.status(404).json({ success: false, message: 'Student not found in this school' });
    
    const userName = student.User.name;
    await student.destroy();
    res.json({ success: true, message: `Student ${userName} deleted successfully` });
  } catch (error) {
    console.error('Delete student error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.suspendStudent = async (req, res) => {
  try {
    const { studentId } = req.params;
    const { reason } = req.body;
    if (!reason) return res.status(400).json({ success: false, message: 'Suspension reason is required' });
    
    const student = await findStudentInSchool(studentId, req.user.schoolCode);
    if (!student) return res.status(404).json({ success: false, message: 'Student not found in this school' });
    
    student.status = 'suspended';
    student.User.isActive = false;
    await student.save();
    await student.User.save();
    
    const parents = await student.getParents({ include: [{ model: User }] });
    for (const parent of parents) {
      await createAlert({
        userId: parent.userId, role: 'parent', type: 'system', severity: 'critical',
        title: 'Student Suspension', message: `Student ${student.User.name} has been suspended. Reason: ${reason}`
      });
    }
    
    const teacher = await Teacher.findOne({ where: { classTeacher: student.grade }, include: [{ model: User, required: true, where: { schoolCode: req.user.schoolCode } }] });
    if (teacher) {
      await createAlert({
        userId: teacher.userId, role: 'teacher', type: 'system', severity: 'critical',
        title: 'Student Suspension', message: `Student ${student.User.name} has been suspended. Reason: ${reason}`
      });
    }
    
    res.json({ success: true, message: 'Student suspended successfully' });
  } catch (error) {
    console.error('Suspend student error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.reactivateStudent = async (req, res) => {
  try {
    const { studentId } = req.params;
    const student = await findStudentInSchool(studentId, req.user.schoolCode);
    if (!student) return res.status(404).json({ success: false, message: 'Student not found in this school' });
    
    student.status = 'active';
    student.User.isActive = true;
    await student.save();
    await student.User.save();
    
    res.json({ success: true, message: 'Student reactivated successfully' });
  } catch (error) {
    console.error('Reactivate student error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============ PARENT MANAGEMENT ============
exports.getAllParents = async (req, res) => {
  try {
    const parents = await Parent.findAll({
      include: [{ model: User, where: { schoolCode: req.user.schoolCode }, attributes: ['id','name','email','phone','profileImage','profilePicture','createdAt'] }],
      order: [['createdAt', 'DESC']]
    });
    res.json({ success: true, data: parents });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============ SCHOOL SETTINGS ============
// Superseded duplicate export removed: getSchoolSettings.

// Superseded duplicate export removed: updateSchoolSettings.

// ============ CLASS MANAGEMENT ============
exports.getClasses = async (req, res) => {
  try {
    const status = String(req.query.status || 'all').toLowerCase();
    const where = { schoolCode: req.user.schoolCode };
    if (status === 'active') where.isActive = true;
    if (status === 'inactive') where.isActive = false;
    const classes = await Class.findAll({
      where,
      include: [{ model: Teacher, include: [{ model: User, attributes: ['id', 'name', 'email'] }] }],
      order: [['grade', 'ASC'], ['name', 'ASC']]
    });
    res.json({ success: true, data: classes, meta: { status, total: classes.length, active: classes.filter(item => item.isActive === true).length, inactive: classes.filter(item => item.isActive === false).length } });
  } catch (error) {
    console.error('Get classes error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};




exports.getClassStudents = async (req, res) => {
  try {
    const { id } = req.params;
    const classItem = await Class.findOne({ where: { id, schoolCode: req.user.schoolCode, isActive: true } });
    if (!classItem) return res.status(404).json({ success: false, message: 'Class not found' });
    let students = await resolveClassStudents([classItem], req.user.schoolCode, { order:[['createdAt','DESC']] });
    const studentIds = students.map(st => st.id);
    if (studentIds.length) {
      const hydrated = await Student.findAll({
        where:{ id:{ [Op.in]:studentIds } },
        include:[
          { model: User, attributes:['id','name','email','phone','profileImage','profilePicture','schoolCode'], where:{ schoolCode:req.user.schoolCode }, required:true },
          { model: Parent, as:'parents', include:[{ model: User, attributes:['id','name','email','phone','profileImage','profilePicture'] }] },
          { model: Class, required:false, attributes:['id','name','grade','stream'] }
        ],
        order:[['createdAt','DESC']]
      });
      const position = new Map(studentIds.map((sid, i) => [Number(sid), i]));
      students = hydrated.sort((a,b)=>(position.get(Number(a.id))??0)-(position.get(Number(b.id))??0));
    }
    res.json({ success: true, data: students });
  } catch (error) {
    console.error('Get class students error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getClassDetails = async (req, res) => {
  try {
    const { id } = req.params;
    const classItem = await Class.findOne({
      where: { id, schoolCode: req.user.schoolCode, isActive: true },
      include: [{ model: Teacher, include: [{ model: User, attributes: ['id', 'name', 'email'] }] }]
    });

    if (!classItem) {
      return res.status(404).json({ success: false, message: 'Class not found' });
    }

    res.json({ success: true, data: classItem });
  } catch (error) {
    console.error('Get class details error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};


// Removed superseded duplicate export: createClass. The canonical implementation is defined later in this controller.

// Removed superseded duplicate export: updateClass. The canonical implementation is defined later in this controller.

exports.deleteClass = async (req, res) => {
  try {
    const { id } = req.params;
    const classItem = await Class.findOne({ where: { id, schoolCode: req.user.schoolCode } });
    if (!classItem) return res.status(404).json({ success: false, message: 'Class not found' });
    
    await classItem.update({ isActive: false });
    res.json({ success: true, message: 'Class deleted successfully' });
  } catch (error) {
    console.error('Delete class error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getAvailableTeachers = async (req, res) => {
  try {
    const teachers = await Teacher.findAll({
      where: { approvalStatus: 'approved' },
      include: [
        { model: User, where: { schoolCode: req.user.schoolCode }, attributes: ['id','name','email','phone','profileImage','profilePicture'] },
        { model: TeacherSubjectAssignment, required: false, attributes: ['id','classId','subject','isClassTeacher'], include: [{ model: Class, required: false, attributes: ['id','name','grade','stream','isActive','schoolCode'] }] }
      ],
      order: [['createdAt', 'DESC']]
    });
    const teacherIds = teachers.map(t => Number(t.id)).filter(Boolean);
    const legacyClassIds = teachers.map(t => Number(t.classId)).filter(Boolean);
    const clauses = [];
    if (teacherIds.length) clauses.push({ teacherId: { [Op.in]: teacherIds } });
    if (legacyClassIds.length) clauses.push({ id: { [Op.in]: legacyClassIds } });
    const classes = clauses.length ? await Class.findAll({ where: { schoolCode:req.user.schoolCode, isActive:true, [Op.or]:clauses }, attributes:['id','name','grade','stream','teacherId','isActive'] }) : [];
    const data = teachers.map(row => {
      const teacher = row.toJSON ? row.toJSON() : row;
      teacher.TeacherSubjectAssignments = (teacher.TeacherSubjectAssignments || []).filter(a => !a.Class || a.Class.schoolCode === req.user.schoolCode);
      teacher.Classes = classes.filter(c => Number(c.teacherId) === Number(teacher.id) || Number(c.id) === Number(teacher.classId)).map(c => c.toJSON ? c.toJSON() : c);
      teacher.Class = teacher.Classes[0] || null;
      return teacher;
    });
    data.sort((a,b) => String(a.User?.name || '').localeCompare(String(b.User?.name || '')));
    res.json({ success: true, data });
  } catch (error) {
    console.error('Get available teachers error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// In adminController.js
// Replace the existing assignTeacherToClass with:
// Removed superseded duplicate export: assignTeacherToClass. The canonical implementation is defined later in this controller.

// Add batch subject assignment
// Removed superseded duplicate export: batchAssignSubjects. The canonical implementation is defined later in this controller.

exports.removeTeacherFromClass = async (req, res) => {
  try {
    const { id } = req.params;
    const classItem = await Class.findOne({ where: { id, schoolCode: req.user.schoolCode } });
    if (!classItem) return res.status(404).json({ success: false, message: 'Class not found' });
    const teacherId = classItem.teacherId;
    if (teacherId) {
      const teacher = await Teacher.findOne({ where: { id: teacherId }, include: [{ model: User, required: true, where: { schoolCode: req.user.schoolCode }, attributes: ['id', 'schoolCode'] }] });
      if (teacher) {
        teacher.classId = null;
        teacher.classTeacher = null;
        await teacher.save();
      }
      // Remove this teacher from all subjectTeachers arrays in this school
      const allClasses = await Class.findAll({ where: { schoolCode: req.user.schoolCode } });
      for (const cls of allClasses) {
        if (cls.subjectTeachers && cls.subjectTeachers.some(st => st.teacherId === teacherId)) {
          const newSubjectTeachers = cls.subjectTeachers.filter(st => st.teacherId !== teacherId);
          await cls.update({ subjectTeachers: newSubjectTeachers });
        }
      }
    }
    await classItem.update({ teacherId: null });
    res.json({ success: true, message: `Teacher removed from ${classItem.name}` });
  } catch (error) {
    console.error('Remove teacher from class error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============ SUBJECT ASSIGNMENT ============
// Removed superseded duplicate export: assignTeacherToSubject. The canonical implementation is defined later in this controller.

exports.removeSubjectAssignment = async (req, res) => {
  try {
    const { assignmentId } = req.params;
    const classes = await Class.findAll({ where: { schoolCode: req.user.schoolCode } });
    
    let found = false;
    for (const classItem of classes) {
      const subjectTeachers = classItem.subjectTeachers || [];
      const newSubjectTeachers = subjectTeachers.filter(st => st.id !== assignmentId);
      if (newSubjectTeachers.length !== subjectTeachers.length) {
        await classItem.update({ subjectTeachers: newSubjectTeachers });
        found = true;
        break;
      }
    }
    
    if (!found) return res.status(404).json({ success: false, message: 'Assignment not found' });
    res.json({ success: true, message: 'Teacher removed from subject successfully' });
  } catch (error) {
    console.error('Remove subject assignment error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Removed superseded duplicate export: getClassSubjectAssignments. The canonical implementation is defined later in this controller.

// ============ ANALYTICS ============
exports.getStudentGrades = async (req, res) => {
  try {
    const { AcademicRecord, Student } = require('../models');
    const grades = await AcademicRecord.findAll({
      where: { schoolCode: req.user.schoolCode },
      include: [{ model: Student, attributes: ['grade'] }]
    });
    
    const gradeStats = {};
    grades.forEach(g => {
      const grade = g.Student?.grade || 'Unknown';
      if (!gradeStats[grade]) gradeStats[grade] = { count: 0, total: 0 };
      gradeStats[grade].count++;
      gradeStats[grade].total += g.score;
    });
    
    const result = Object.entries(gradeStats).map(([grade, stats]) => ({
      grade, average: stats.count ? Math.round(stats.total / stats.count) : 0, count: stats.count
    }));
    
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Get student grades error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getAttendanceStats = async (req, res) => {
  try {
    const { Attendance, Student } = require('../models');
    const attendance = await Attendance.findAll({
      where: { schoolCode: req.user.schoolCode },
      include: [{ model: Student, attributes: ['grade'] }]
    });
    
    const attendanceStats = {};
    attendance.forEach(a => {
      const grade = a.Student?.grade || 'Unknown';
      if (!attendanceStats[grade]) attendanceStats[grade] = { present: 0, absent: 0, total: 0 };
      attendanceStats[grade].total++;
      if (a.status === 'present') attendanceStats[grade].present++;
      else if (a.status === 'absent') attendanceStats[grade].absent++;
    });
    
    const result = Object.entries(attendanceStats).map(([grade, stats]) => ({
      grade, rate: stats.total ? Math.round((stats.present / stats.total) * 100) : 0,
      present: stats.present, absent: stats.absent, total: stats.total
    }));
    
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Get attendance stats error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Removed superseded duplicate export: batchAssignSubjects. The canonical implementation is defined later in this controller.

// ============ V3 OVERRIDES: class teacher, subject teacher, extended student fields ============
async function v3SchoolTeacher(teacherId, schoolCode) {
  return Teacher.findOne({ where: { id: parseInt(teacherId,10) }, include: [{ model: User, where: { schoolCode }, attributes: ['id','name','email','phone','profileImage','profilePicture'] }] });
}
async function v3Class(classId, schoolCode) { return Class.findOne({ where: { id: parseInt(classId,10), schoolCode, isActive: true } }); }
async function v3SaveSubjectAssignment({ classItem, teacher, subject, isClassTeacher, adminId }) {
  let list = Array.isArray(classItem.subjectTeachers) ? classItem.subjectTeachers : [];
  list = list.filter(a => String(a.subject).toLowerCase() !== String(subject).toLowerCase());
  const row = { id: `${classItem.id}-${teacher.id}-${String(subject).toLowerCase().replace(/\s+/g,'-')}`, teacherId: teacher.id, teacherName: teacher.User?.name || 'Unknown', subject, isClassTeacher: !!isClassTeacher, assignedAt: new Date().toISOString(), assignedBy: adminId };
  list.push(row);
  await classItem.update({ subjectTeachers: list });
  if (typeof TeacherSubjectAssignment !== 'undefined') {
    await TeacherSubjectAssignment.destroy({ where: { classId: classItem.id, subject } }).catch(() => null);
    await TeacherSubjectAssignment.create({ teacherId: teacher.id, classId: classItem.id, subject, isClassTeacher: !!isClassTeacher, academicYear: classItem.academicYear || String(new Date().getFullYear()) }).catch(() => null);
  }
  await teacher.update({ subjects: Array.from(new Set([...(teacher.subjects || []), subject])) });
  return row;
}
// Removed superseded duplicate export: assignTeacherToClass. The canonical implementation is defined later in this controller.
// Removed superseded duplicate export: assignTeacherToSubject. The canonical implementation is defined later in this controller.
// Removed superseded duplicate export: batchAssignSubjects. The canonical implementation is defined later in this controller.
exports.updateStudent = async (req, res) => {
  try {
    const student = await Student.findByPk(req.params.studentId, { include: [{ model: User }] });
    if (!student) return res.status(404).json({ success:false, message:'Student not found' });
    if (student.User.schoolCode !== req.user.schoolCode) return res.status(403).json({ success:false, message:'Forbidden' });
    const userFields={}; ['name','email','phone'].forEach(k => { if (req.body[k] !== undefined) userFields[k] = req.body[k] || null; });
    if (Object.keys(userFields).length) await student.User.update(userFields);
    const allowed=['grade','status','isPrefect','assessmentNumber','nemisNumber','location','parentName','parentEmail','parentPhone','parentRelationship','dateOfBirth','gender'];
    const studentFields={}; allowed.forEach(k => { if (req.body[k] !== undefined) studentFields[k] = typeof req.body[k] === 'string' ? req.body[k].trim() : req.body[k]; });
    if (Object.keys(studentFields).length) await student.update(studentFields);
    await student.reload({ include: [{ model: User }] });
    res.json({ success:true, message:'Student updated successfully', data:student });
  } catch(error) { console.error('V3 update student error:', error); res.status(500).json({ success:false, message:error.message }); }
};

// ============ V102 LOCKED ACCESS + CURRICULUM STRUCTURE ENGINE ============
const curriculumEngine = require('../services/curriculumStructureEngine');
const classGeneration = require('../services/classGenerationService');
const { listStudentSubjectSelections, replaceStudentSubjectSelections } = require('../services/studentSubjectSelectionService');
const { sequelize } = require('../models');
const TeacherSubjectAssignmentModel = require('../models').TeacherSubjectAssignment;

async function v102GetSchool(schoolCode) {
  const value = String(schoolCode || '').trim();
  if (!value) return null;
  return School.findOne({
    where: {
      [Op.or]: [
        { schoolId: value },
        { shortCode: value },
        { lookupCodes: { [Op.contains]: [value] } }
      ]
    }
  });
}

function v102BuildCurriculumSettings(school, patch = {}) {
  const currentSettings = school.settings || {};
  const currentEngine = currentSettings.curriculumEngine || {};
  const curriculum = curriculumEngine.normalizeCurriculum(patch.curriculum || currentEngine.curriculum || school.system || 'cbc');
  const structureType = patch.structureType || patch.schoolStructure || currentEngine.structureType || school.schoolStructure || currentSettings.schoolLevel || 'mixed';
  const rawLevels = Array.isArray(patch.enabledLevels) ? [...patch.enabledLevels] : (Array.isArray(currentEngine.enabledLevels) ? [...currentEngine.enabledLevels] : []);
  const rawGroups = Array.isArray(patch.enabledLevelGroups) ? [...patch.enabledLevelGroups] : (Array.isArray(currentEngine.enabledLevelGroups) ? [...currentEngine.enabledLevelGroups] : []);
  if (!rawLevels.length && !rawGroups.length && structureType !== 'custom') {
    const presetStructure = ['primary_only','secondary_only','mixed','full_school','junior_only','senior_only'].includes(structureType)
      ? structureType
      : 'mixed';
    const syntheticSchool = {
      system: curriculum,
      schoolStructure: presetStructure,
      enabledLevels: [],
      settings: { curriculumEngine: { curriculum, structureType: presetStructure, enabledLevels: [], enabledLevelGroups: [] } }
    };
    rawLevels.push(...curriculumEngine.getCurriculumConfig(syntheticSchool).enabledLevels);
  }
  const enabledLevels = curriculumEngine.expandEnabledLevelCodes(curriculum, [...rawGroups, ...rawLevels]);
  const enabledLevelGroups = curriculumEngine.groupsFromEnabledLevels(curriculum, enabledLevels);
  const schoolSubjects = Array.isArray(patch.schoolSubjects) ? patch.schoolSubjects : (Array.isArray(currentEngine.schoolSubjects) ? currentEngine.schoolSubjects : []);
  const assessmentSettings = Array.isArray(patch.assessmentSettings) ? patch.assessmentSettings : (Array.isArray(currentEngine.assessmentSettings) ? currentEngine.assessmentSettings : curriculumEngine.defaultAssessmentSettings());
  const classGenerationConfig = classGeneration.normalizeConfigPatch(school, patch.classGeneration || {}, patch.updatedBy || null);
  if (!enabledLevels.length && !classGenerationConfig.customClasses.length) {
    const error = new Error('Select at least one grade/class level or add at least one custom class name.');
    error.statusCode = 400;
    error.code = 'CLASS_STRUCTURE_REQUIRED';
    throw error;
  }
  return {
    ...currentSettings,
    schoolStructure: structureType,
    curriculum,
    classGeneration: classGenerationConfig,
    curriculumEngine: {
      ...currentEngine,
      curriculum,
      structureType,
      enabledLevels,
      enabledLevelGroups,
      schoolSubjects,
      assessmentSettings,
      seniorSettings: patch.seniorSettings || currentEngine.seniorSettings || {},
      gradingSettings: patch.gradingSettings || currentEngine.gradingSettings || currentSettings.gradingScale || null,
      updatedAt: new Date().toISOString()
    }
  };
}


async function v130SyncClassesForEnabledLevels(school, actorUserId, options = {}) {
  if (options.mode === 'preview') return classGeneration.preview(school);
  if (options.mode === 'apply') return classGeneration.apply(school, actorUserId, options.previewToken);
  // Safe metadata refresh only. Never create, reactivate, deactivate, rename, or delete classes here.
  return classGeneration.refreshExistingClassMetadata(school);
}

function v102ClassMeta(school, gradeOrName) {
  const config = curriculumEngine.getCurriculumConfig(school);
  const validation = curriculumEngine.validateClassLevel(school, gradeOrName);
  const level = validation.level || (validation.levelCode ? curriculumEngine.getLevelByCode(config.curriculum, validation.levelCode) : null);
  return { config, validation, level };
}

async function v102ClassWithScope(classId, schoolCode) {
  return Class.findOne({ where: { id: parseInt(classId, 10), schoolCode, isActive: true } });
}

async function v102TeacherWithScope(teacherId, schoolCode) {
  return Teacher.findOne({ where: { id: parseInt(teacherId, 10) }, include: [{ model: User, where: { schoolCode }, attributes: ['id','name','email','phone','profileImage','profilePicture'] }] });
}

function v102SubjectAllowed(school, classItem, subjectName) {
  const eligible = curriculumEngine.getEligibleSubjectsForClass(school, classItem);
  const found = eligible.find(s => String(s.name).toLowerCase() === String(subjectName || '').trim().toLowerCase());
  if (found) return { ok: true, subject: found, eligible };
  const cfg = curriculumEngine.getCurriculumConfig(school);
  const needsSetup = !cfg.schoolSubjects.length;
  return {
    ok: false,
    eligible,
    message: needsSetup
      ? 'No live school subjects have been saved yet. Open Add Subjects, tick the subjects this school offers under the selected curriculum/structure, then assign subject teachers.'
      : `${subjectName} is not enabled for ${classItem.name} under this school's curriculum/structure.`
  };
}

exports.getSchoolSettings = async (req, res) => {
  try {
    const school = await v102GetSchool(req.user.schoolCode);
    if (!school) return res.status(404).json({ success: false, message: 'School not found' });
    const schoolData = school.toJSON();
    schoolData.curriculum = curriculumEngine.normalizeCurriculum(school.system || schoolData.curriculum || 'cbc');
    schoolData.curriculumSetup = {
      config: curriculumEngine.getCurriculumConfig(school),
      enabledLevels: curriculumEngine.getAllowedLevelsForSchool(school),
      subjectCount: curriculumEngine.getSubjectBankForSchool(school).length
    };
    schoolData.classGeneration = classGeneration.getConfig(school);
    res.json({ success: true, data: schoolData });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateSchoolSettings = async (req, res) => {
  try {
    const school = await v102GetSchool(req.user.schoolCode);
    if (!school) return res.status(404).json({ success: false, message: 'School not found' });
    const before = school.toJSON();
    const patch = req.body || {};
    const protectedCurriculumFields=['curriculum','system','countryIsoCode','curriculumPackId','activeCurriculumPackId','enabledLevels','enabledLevelGroups','schoolSubjects','gradingScale','gradingProfile','classGeneration','structureType','schoolStructure'];
    const attemptedCurriculumFields=protectedCurriculumFields.filter(field=>Object.prototype.hasOwnProperty.call(patch,field));
    if(attemptedCurriculumFields.length)return res.status(409).json({success:false,code:'USE_CANONICAL_CURRICULUM_WORKFLOW',message:'Country, curriculum, grading, subjects, levels, and class-generation rules must be changed through the versioned curriculum workflow.',data:{fields:attemptedCurriculumFields}});
    const newSettings = v102BuildCurriculumSettings(school, { ...patch, updatedBy: req.user.id });
    const nextCurriculum = curriculumEngine.normalizeCurriculum(patch.curriculum || school.system);
    if (patch.curriculum && nextCurriculum !== school.system) {
      newSettings.curriculumHistory = [
        ...(Array.isArray((school.settings || {}).curriculumHistory) ? school.settings.curriculumHistory : []),
        { from: school.system, to: nextCurriculum, changedBy: req.user.id, changedAt: new Date().toISOString(), note: patch.changeReason || 'Curriculum changed by school admin' }
      ];
      school.system = nextCurriculum;
    }
    if (patch.schoolName) school.name = patch.schoolName;
    school.schoolStructure = newSettings.curriculumEngine.structureType;
    school.enabledLevels = newSettings.curriculumEngine.enabledLevels;
    school.settings = { ...newSettings, customSubjects: patch.customSubjects || newSettings.customSubjects || [] };
    await school.save();
    // Saving school settings is non-destructive. Existing Class rows and assignments
    // are not mutated here; the admin must review and confirm the generation preview.
    const sync = { preserved: true, updatedClassIds: [], createdClassIds: [], deactivatedClassIds: [] };
    const generationPreview = await classGeneration.preview(school);
    await sequelize.query(`INSERT INTO "PlatformAuditEvents" ("schoolCode","actorUserId","eventType","payload","createdAt","updatedAt") VALUES (:schoolCode,:actorUserId,'school_settings_updated',:payload,NOW(),NOW())`, {
      replacements: { schoolCode: school.schoolId, actorUserId: req.user.id, payload: JSON.stringify({ before: { system: before.system, settings: before.settings }, after: { system: school.system, settings: school.settings }, sync }) }
    }).catch(() => null);
    if (global.io) global.io.to(`school-${school.schoolId}`).emit('curriculum-updated', { curriculum: school.system, timestamp: new Date() });
    res.json({ success: true, message: 'School settings saved. Existing classes were preserved; review the class-generation preview before creating missing classes.', data: { ...school.toJSON(), curriculum: school.system, curriculumSetup: curriculumEngine.getCurriculumConfig(school), classGeneration: classGeneration.getConfig(school), classSync: sync, classGenerationPreview: generationPreview } });
  } catch (error) {
    console.error('V130 update school settings error:', error);
    res.status(error.statusCode || 500).json({ success: false, code:error.code, message: error.message });
  }
};

exports.getCurriculumSetup = async (req, res) => {
  try {
    const school = await v102GetSchool(req.user.schoolCode);
    if (!school) return res.status(404).json({ success:false, message:'School not found' });
    res.json({ success:true, data:{
      school: { id: school.id, name: school.name, schoolId: school.schoolId, curriculum: school.system, structure: school.schoolStructure },
      config: curriculumEngine.getCurriculumConfig(school),
      levels: curriculumEngine.getAllowedLevelsForSchool(school),
      subjectBank: curriculumEngine.getSubjectBankForSchool(school),
      gradingProfile: curriculumEngine.getGradingProfile(school.system, null),
      levelGroups: curriculumEngine.getLevelGroups(school.system),
      assessmentSettings: curriculumEngine.getCurriculumConfig(school).assessmentSettings
    }});
  } catch(error) { res.status(500).json({ success:false, message:error.message }); }
};

exports.updateCurriculumSetup = async (req, res) => {
  return res.status(410).json({success:false,code:'USE_CANONICAL_CURRICULUM_WORKFLOW',message:'This legacy curriculum update endpoint is closed. Use PUT /api/admin/curriculum/workflow.'});
};


exports.syncCurriculumClasses = async (req, res) => {
  try {
    const school = await v102GetSchool(req.user.schoolCode);
    if (!school) return res.status(404).json({ success:false, message:'School not found' });
    if (req.body?.confirm === true) {
      const result = await v130SyncClassesForEnabledLevels(school, req.user.id, { mode:'apply', previewToken:req.body.previewToken });
      return res.status(201).json({ success:true, message:`${result.createdCount} missing class(es) created. Existing classes and assignments were preserved.`, data:result });
    }
    const result = await v130SyncClassesForEnabledLevels(school, req.user.id, { mode:'preview' });
    return res.json({ success:true, message:`Preview ready: ${result.createCount} class(es) can be added and ${result.skipCount} existing class(es) will be skipped.`, data:result });
  } catch(error) {
    console.error('Class generation error:', error);
    res.status(error.statusCode || 500).json({ success:false, code:error.code, message:error.message, data:error.preview || undefined });
  }
};

exports.previewClassGeneration = async (req, res) => {
  try {
    const school = await v102GetSchool(req.user.schoolCode);
    if (!school) return res.status(404).json({ success:false, message:'School not found' });
    const result = await classGeneration.preview(school);
    res.json({ success:true, data:result });
  } catch(error) { res.status(500).json({ success:false, message:error.message }); }
};

exports.generateClassesFromSettings = async (req, res) => {
  try {
    const school = await v102GetSchool(req.user.schoolCode);
    if (!school) return res.status(404).json({ success:false, message:'School not found' });
    const result = await classGeneration.apply(school, req.user.id, req.body?.previewToken, req.user.role);
    res.status(201).json({ success:true, message:`${result.createdCount} missing class(es) created safely.`, data:result });
  } catch(error) {
    res.status(error.statusCode || 500).json({ success:false, code:error.code, message:error.message, data:error.preview || undefined });
  }
};

exports.getCurriculumLevels = async (req, res) => {
  try {
    const school = await v102GetSchool(req.user.schoolCode);
    if (!school) return res.status(404).json({ success:false, message:'School not found' });
    const cfg = curriculumEngine.getCurriculumConfig(school);
    const allLevels = curriculumEngine.getBank(cfg.curriculum).levels;
    res.json({ success:true, data:{ curriculum:cfg.curriculum, structureType:cfg.structureType, enabledLevels:cfg.enabledLevels, enabledLevelGroups:cfg.enabledLevelGroups, levelGroups:cfg.levelGroups, levels:allLevels, allowedLevels:curriculumEngine.getAllowedLevelsForSchool(school) } });
  } catch(error) { res.status(500).json({ success:false, message:error.message }); }
};

exports.getCurriculumSubjectBank = async (req, res) => {
  try {
    const school = await v102GetSchool(req.user.schoolCode);
    if (!school) return res.status(404).json({ success:false, message:'School not found' });
    res.json({ success:true, data:{ config:curriculumEngine.getCurriculumConfig(school), subjects:curriculumEngine.getSubjectBankForSchool(school) } });
  } catch(error) { res.status(500).json({ success:false, message:error.message }); }
};

exports.saveSchoolSubjects = async (req, res) => {
  try {
    const school = await v102GetSchool(req.user.schoolCode);
    if (!school) return res.status(404).json({ success:false, message:'School not found' });
    const selected = Array.isArray(req.body.subjects) ? req.body.subjects : [];
    const bank = curriculumEngine.getSubjectBankForSchool(school);
    const byId = new Map(bank.map(s => [s.id, s]));
    const allowedLevels = new Set(curriculumEngine.getAllowedLevelsForSchool(school).map(l => l.code));
    const schoolSubjects = selected.map(item => {
      const subject = byId.get(item.subjectId || item.id) || item;
      const originalLevels = Array.isArray(item.levelCodes) && item.levelCodes.length ? item.levelCodes : (subject.levelCodes || []);
      const levelCodes = originalLevels.filter(code => allowedLevels.has(code));
      const isCustom = !!(item.isCustom || item.source === 'custom' || item.scope || item.classIds);
      if (!isCustom && !levelCodes.length) return null;
      return {
        subjectId: subject.id || item.subjectId || item.id || (isCustom ? `custom_${String(item.name || item.subjectName || '').toLowerCase().replace(/[^a-z0-9]+/g, '_')}` : null),
        name: subject.name || item.name || item.subjectName,
        category: subject.category || item.category || (isCustom ? 'custom' : 'school_subject'),
        levelCodes: levelCodes.length ? levelCodes : originalLevels,
        classIds: Array.isArray(item.classIds) ? item.classIds.map(Number).filter(Boolean) : [],
        scope: item.scope || (Array.isArray(item.classIds) && item.classIds.length ? 'class' : 'school'),
        pathway: subject.pathway || item.pathway || null,
        track: subject.track || item.track || null,
        isCore: !!(subject.isCore || item.isCore),
        isOptional: item.isOptional !== undefined ? !!item.isOptional : !!(subject.isOptional || isCustom),
        isCustom,
        countsInFinalByDefault: item.countsInFinalByDefault !== undefined ? !!item.countsInFinalByDefault : subject.countsInFinalByDefault !== false,
        isOffered: item.isOffered !== false,
        savedAt: new Date().toISOString(),
        savedBy: req.user.id
      };
    }).filter(s => s && s.name);
    const settings = v102BuildCurriculumSettings(school, { schoolSubjects });
    school.settings = settings;
    school.enabledLevels = settings.curriculumEngine.enabledLevels;
    await school.save();
    const sync = await v130SyncClassesForEnabledLevels(school, req.user.id);
    res.json({ success:true, message:`${schoolSubjects.length} school subject(s) saved and class subjects synced`, data:{ schoolSubjects, classSync:sync } });
  } catch(error) { console.error('V130 save school subjects error:', error); res.status(500).json({ success:false, message:error.message }); }
};

exports.getSchoolSubjects = async (req, res) => {
  try {
    const school = await v102GetSchool(req.user.schoolCode);
    if (!school) return res.status(404).json({ success:false, message:'School not found' });
    const cfg = curriculumEngine.getCurriculumConfig(school);
    res.json({ success:true, data:{ subjects:cfg.schoolSubjects, config:cfg } });
  } catch(error) { res.status(500).json({ success:false, message:error.message }); }
};

exports.getEligibleSubjectsForClass = async (req, res) => {
  try {
    const school = await v102GetSchool(req.user.schoolCode);
    const classItem = await v102ClassWithScope(req.params.classId, req.user.schoolCode);
    if (!school || !classItem) return res.status(404).json({ success:false, message:'School or class not found' });
    const subjects = curriculumEngine.getEligibleSubjectsForClass(school, classItem);
    res.json({ success:true, data:subjects, meta:{ classId:classItem.id, className:classItem.name, grade:classItem.grade, curriculum:school.system, levelCode:classItem.levelCode || classItem.curriculumLevel || classItem.settings?.curriculumMeta?.levelCode || curriculumEngine.levelCodeFromGrade(school.system, classItem.grade || classItem.name), subjectCount:subjects.length } });
  } catch(error) { res.status(500).json({ success:false, message:error.message }); }
};

exports.createClass = async (req, res) => {
  try {
    const school = await v102GetSchool(req.user.schoolCode);
    if (!school) return res.status(404).json({ success:false, message:'School not found' });
    const { name, grade, stream, teacherId } = req.body;
    const gradeLabel = grade || name;
    const { config, validation, level } = v102ClassMeta(school, gradeLabel);
    if (!validation.ok) return res.status(400).json({ success:false, message:validation.message, data:{ allowedLevels:curriculumEngine.getAllowedLevelsForSchool(school) } });
    const eligibleSubjects = curriculumEngine.getEligibleSubjectsForClass(school, { grade: gradeLabel, name: name || gradeLabel, subjectTeachers: [] });
    const newClass = await Class.create({
      name: name || [level?.label || gradeLabel, stream].filter(Boolean).join(' '),
      grade: gradeLabel,
      stream: stream || null,
      schoolCode: req.user.schoolCode,
      teacherId: teacherId || null,
      curriculum: config.curriculum,
      levelCode: validation.levelCode,
      levelLabel: level?.label || gradeLabel,
      curriculumLevel: level?.group || null,
      settings: { ...(req.body.settings || {}), curriculumMeta:{ curriculum:config.curriculum, structureType:config.structureType, levelCode:validation.levelCode, levelLabel:level?.label || gradeLabel, curriculumLevel:level?.group || null }, subjects: eligibleSubjects.map(s => ({ id:s.id, name:s.name, category:s.category, isCore:s.isCore, countsInFinalByDefault:s.countsInFinalByDefault })) }
    });
    res.status(201).json({ success:true, data:newClass });
  } catch(error) { console.error('V102 create class error:', error); res.status(500).json({ success:false, message:error.message }); }
};

exports.updateClass = async (req, res) => {
  try {
    const school = await v102GetSchool(req.user.schoolCode);
    const classItem = await v102ClassWithScope(req.params.id, req.user.schoolCode);
    if (!school || !classItem) return res.status(404).json({ success:false, message:'School or class not found' });
    const { name, grade, stream, teacherId } = req.body;
    const gradeLabel = grade || classItem.grade || name || classItem.name;
    const { config, validation, level } = v102ClassMeta(school, gradeLabel);
    if (!validation.ok) return res.status(400).json({ success:false, message:validation.message, data:{ allowedLevels:curriculumEngine.getAllowedLevelsForSchool(school) } });
    const fakeClass = { ...classItem.toJSON(), grade:gradeLabel, name:name || classItem.name };
    const eligibleSubjects = curriculumEngine.getEligibleSubjectsForClass(school, fakeClass);
    await classItem.update({
      name: name !== undefined ? name : classItem.name,
      grade: gradeLabel,
      stream: stream !== undefined ? stream : classItem.stream,
      teacherId: teacherId !== undefined ? (teacherId || null) : classItem.teacherId,
      curriculum: config.curriculum,
      levelCode: validation.levelCode,
      levelLabel: level?.label || gradeLabel,
      curriculumLevel: level?.group || null,
      settings: { ...(classItem.settings || {}), ...(req.body.settings || {}), curriculumMeta:{ curriculum:config.curriculum, structureType:config.structureType, levelCode:validation.levelCode, levelLabel:level?.label || gradeLabel, curriculumLevel:level?.group || null }, subjects: eligibleSubjects.map(s => ({ id:s.id, name:s.name, category:s.category, isCore:s.isCore, countsInFinalByDefault:s.countsInFinalByDefault })) }
    });
    res.json({ success:true, data:classItem });
  } catch(error) { console.error('V102 update class error:', error); res.status(500).json({ success:false, message:error.message }); }
};

exports.assignTeacherToClass = async (req, res) => {
  try {
    const classItem = await v102ClassWithScope(req.params.id, req.user.schoolCode);
    if (!classItem) return res.status(404).json({ success:false, message:'Class not found' });
    const teacher = await v102TeacherWithScope(req.body.teacherId, req.user.schoolCode);
    if (!teacher) return res.status(404).json({ success:false, message:'Teacher not found in this school' });
    if (classItem.teacherId && Number(classItem.teacherId) !== Number(teacher.id)) {
      const old = await Teacher.findByPk(classItem.teacherId);
      if (old) await old.update({ classId:null, classTeacher:null });
    }
    const previous = await Class.findOne({ where: { teacherId: teacher.id, schoolCode: req.user.schoolCode, isActive: true } });
    if (previous && previous.id !== classItem.id) await previous.update({ teacherId: null });
    await classItem.update({ teacherId: teacher.id });
    await teacher.update({ classId: classItem.id, classTeacher: classItem.name });
    res.json({ success:true, message:`${teacher.User.name} is now class teacher for ${classItem.name}`, data:{ classTeacherLabel:{ teacherId:teacher.id, teacherName:teacher.User.name, assignedClass:classItem.name, classId:classItem.id, curriculum:classItem.curriculum || null, level:classItem.curriculumLevel || classItem.levelLabel || classItem.grade }, class:classItem, teacher } });
  } catch(error) { console.error('V102 assign class teacher error:', error); res.status(500).json({ success:false, message:error.message }); }
};

async function v102SaveSubjectAssignment({ school, classItem, teacher, subject, isClassTeacher, adminId }) {
  const allowed = v102SubjectAllowed(school, classItem, subject);
  if (!allowed.ok) throw new Error(allowed.message);
  let list = Array.isArray(classItem.subjectTeachers) ? classItem.subjectTeachers : [];
  list = list.filter(a => String(a.subject).toLowerCase() !== String(subject).toLowerCase());
  const row = {
    id: `${classItem.id}-${teacher.id}-${String(subject).toLowerCase().replace(/\s+/g,'-')}`,
    teacherId: teacher.id,
    teacherName: teacher.User?.name || 'Unknown',
    subject,
    schoolSubjectId: allowed.subject.id || null,
    curriculum: school.system,
    levelCode: classItem.levelCode || curriculumEngine.levelCodeFromGrade(school.system, classItem.grade || classItem.name),
    isClassTeacher: !!isClassTeacher,
    assignedAt: new Date().toISOString(),
    assignedBy: adminId
  };
  list.push(row);
  await classItem.update({ subjectTeachers: list });
  await TeacherSubjectAssignmentModel.destroy({ where: { classId: classItem.id, subject } }).catch(() => null);
  await TeacherSubjectAssignmentModel.create({ teacherId: teacher.id, classId: classItem.id, subject, isClassTeacher: !!isClassTeacher, academicYear: classItem.academicYear || String(new Date().getFullYear()), schoolSubjectId: row.schoolSubjectId, curriculum: row.curriculum, levelCode: row.levelCode }).catch(() => null);
  await teacher.update({ subjects: Array.from(new Set([...(teacher.subjects || []), subject])) });
  return row;
}

exports.assignTeacherToSubject = async (req, res) => {
  try {
    const { classId, teacherId, subject, isClassTeacher=false } = req.body;
    if (!classId || !teacherId || !subject) return res.status(400).json({ success:false, message:'classId, teacherId and subject are required' });
    const school = await v102GetSchool(req.user.schoolCode);
    const classItem = await v102ClassWithScope(classId, req.user.schoolCode);
    const teacher = await v102TeacherWithScope(teacherId, req.user.schoolCode);
    if (!school || !classItem) return res.status(404).json({ success:false, message:'School or class not found' });
    if (!teacher) return res.status(404).json({ success:false, message:'Teacher not found in this school' });
    const row = await v102SaveSubjectAssignment({ school, classItem, teacher, subject, isClassTeacher, adminId:req.user.id });
    if (isClassTeacher) { await classItem.update({ teacherId: teacher.id }); await teacher.update({ classId: classItem.id, classTeacher: classItem.name }); }
    res.json({ success:true, message:`${teacher.User.name} assigned to ${subject} in ${classItem.name}`, data:row });
  } catch(error) { console.error('V102 assign subject error:', error); res.status(500).json({ success:false, message:error.message }); }
};

exports.batchAssignSubjects = async (req, res) => {
  try {
    const school = await v102GetSchool(req.user.schoolCode);
    const classItem = await v102ClassWithScope(req.body.classId, req.user.schoolCode);
    if (!school || !classItem) return res.status(404).json({ success:false, message:'School or class not found' });
    const saved=[], errors=[];
    for (const item of (req.body.assignments || [])) {
      try {
        if (!item.teacherId || !item.subject) continue;
        const teacher = await v102TeacherWithScope(item.teacherId, req.user.schoolCode);
        if (!teacher) throw new Error('Teacher not found in this school');
        const row = await v102SaveSubjectAssignment({ school, classItem, teacher, subject:item.subject, isClassTeacher:item.isClassTeacher, adminId:req.user.id });
        saved.push(row);
        if (item.isClassTeacher) { await classItem.update({ teacherId: teacher.id }); await teacher.update({ classId: classItem.id, classTeacher: classItem.name }); }
      } catch(err) { errors.push({ item, error:err.message }); }
    }
    res.json({ success: errors.length === 0, message:`${saved.length} assignment(s) saved${errors.length ? `, ${errors.length} failed` : ''}`, data:saved, meta:{ errors } });
  } catch(error) { console.error('V102 batch subject error:', error); res.status(500).json({ success:false, message:error.message }); }
};

exports.getClassSubjectAssignments = async (req, res) => {
  try {
    const school = await v102GetSchool(req.user.schoolCode);
    const classItem = await v102ClassWithScope(req.params.classId, req.user.schoolCode);
    if (!school || !classItem) return res.status(404).json({ success:false, message:'School or class not found' });
    res.json({ success:true, data: classItem.subjectTeachers || [], meta:{ eligibleSubjects: curriculumEngine.getEligibleSubjectsForClass(school, classItem), classTeacherLabel: classItem.teacherId ? { teacherId: classItem.teacherId, assignedClass: classItem.name, curriculum: classItem.curriculum, level: classItem.curriculumLevel || classItem.levelLabel } : null } });
  } catch(error) { console.error('V102 get subject assignments error:', error); res.status(500).json({ success:false, message:error.message }); }
};

exports.getStudentSubjectSelection = async (req, res) => {
  try {
    const student = await Student.findByPk(req.params.studentId, { include:[{ model: User, attributes:['id','name','schoolCode'] }] });
    if (!student || student.User?.schoolCode !== req.user.schoolCode) return res.status(404).json({ success:false, message:'Student not found in this school' });
    const classItem = student.classId ? await v102ClassWithScope(student.classId, req.user.schoolCode) : await resolveStudentClass(student, req.user.schoolCode);
    const school = await v102GetSchool(req.user.schoolCode);
    const eligibleSubjects = classItem ? curriculumEngine.getEligibleSubjectsForClass(school, classItem) : [];
    const selections = await listStudentSubjectSelections({ schoolCode:req.user.schoolCode, studentId:student.id, classId:classItem?.id || null });
    res.json({ success:true, data:{ student, class:classItem, eligibleSubjects, selections } });
  } catch(error) { res.status(500).json({ success:false, message:error.message }); }
};

exports.saveStudentSubjectSelection = async (req, res) => {
  try {
    const student = await Student.findByPk(req.params.studentId, { include:[{ model: User, attributes:['id','name','schoolCode'] }] });
    if (!student || student.User?.schoolCode !== req.user.schoolCode) return res.status(404).json({ success:false, message:'Student not found in this school' });
    const classId = req.body.classId || student.classId || null;
    const school = await v102GetSchool(req.user.schoolCode);
    const classItem = classId ? await v102ClassWithScope(classId, req.user.schoolCode) : null;
    const eligible = classItem ? curriculumEngine.getEligibleSubjectsForClass(school, classItem) : [];
    const eligibleNames = new Set(eligible.map(s => s.name.toLowerCase()));
    const subjects = (req.body.subjects || []).filter(s => eligibleNames.has(String(s.subjectName || s.name || s.subject).toLowerCase()));
    const invalid = (req.body.subjects || []).filter(s => !eligibleNames.has(String(s.subjectName || s.name || s.subject).toLowerCase()));
    if (invalid.length) return res.status(400).json({ success:false, message:'Some selected subjects are not valid for this student class/curriculum', data:{ invalid, eligibleSubjects:eligible } });
    const rows = await replaceStudentSubjectSelections({ schoolCode:req.user.schoolCode, studentId:student.id, classId, pathway:req.body.pathway, track:req.body.track, subjects, actorUserId:req.user.id });
    res.json({ success:true, message:'Student subject selection saved', data:{ selections:rows } });
  } catch(error) { console.error('V102 save student subject selection error:', error); res.status(500).json({ success:false, message:error.message }); }
};


exports.getAssessmentSettings = async (req, res) => {
  try {
    const school = await v102GetSchool(req.user.schoolCode);
    if (!school) return res.status(404).json({ success:false, message:'School not found' });
    const cfg = curriculumEngine.getCurriculumConfig(school);
    res.json({ success:true, data:{ assessmentSettings: cfg.assessmentSettings, config: cfg, reportCardSettings: school.settings?.reportCardSettings || school.reportCardSettings || {} } });
  } catch(error) { res.status(500).json({ success:false, message:error.message }); }
};

exports.updateAssessmentSettings = async (req, res) => {
  try {
    const school = await v102GetSchool(req.user.schoolCode);
    if (!school) return res.status(404).json({ success:false, message:'School not found' });
    const incoming = Array.isArray(req.body.assessmentSettings) ? req.body.assessmentSettings : [];
    const defaults = curriculumEngine.defaultAssessmentSettings();
    const safeKey = (value, idx) => String(value || `custom_${idx+1}`).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || `custom_${idx+1}`;
    const sanitized = incoming.map((row, idx) => {
      const label = String(row.label || row.displayName || row.name || row.assessmentName || row.assessmentType || `Assessment ${idx+1}`).trim();
      const type = String(row.type || row.assessmentType || label || 'Custom').trim();
      return {
        key: safeKey(row.key || `${type}_${label}`, idx),
        name: label, label, displayName: label,
        assessmentType: type, type,
        curriculum: row.curriculum || 'any',
        classLevel: row.classLevel || row.level || 'all',
        showOnReport: row.showOnReport !== false,
        countInFinal: row.countInFinal !== false,
        weight: Number(row.weight ?? row.weightPercent ?? 0),
        weightPercent: Number(row.weightPercent ?? row.weight ?? 0),
        displayOrder: Number(row.displayOrder || idx + 1),
        maxScore: Number(row.maxScore || 100),
        gradingScale: row.gradingScale || null,
        isActive: row.isActive !== false
      };
    }).filter(x => x.label && x.isActive !== false);
    const existingReportSettings = school.settings?.reportCardSettings || school.reportCardSettings || {};
    const incomingReportSettings = req.body && typeof req.body.reportCardSettings === 'object' && !Array.isArray(req.body.reportCardSettings) ? req.body.reportCardSettings : {};
    const bool = (value, fallback=true) => value === undefined ? fallback : value === true || value === 'true' || value === 'on' || value === 1 || value === '1';
    const cleanText = (value, max=240) => String(value || '').trim().slice(0, max);
    const allowedLogoFallback = ['school_initials','shuleai_logo'];
    const allowedWatermark = ['school_logo','school_initials','school_name','shuleai_logo','none'];
    const reportCardSettings = {
      ...existingReportSettings,
      logoFallback: allowedLogoFallback.includes(incomingReportSettings.logoFallback) ? incomingReportSettings.logoFallback : (existingReportSettings.logoFallback || 'school_initials'),
      headerLogoSource: allowedLogoFallback.includes(incomingReportSettings.headerLogoSource) ? incomingReportSettings.headerLogoSource : (existingReportSettings.headerLogoSource || 'school_initials'),
      watermarkType: allowedWatermark.includes(incomingReportSettings.watermarkType) ? incomingReportSettings.watermarkType : (existingReportSettings.watermarkType || 'school_logo'),
      motto: cleanText(incomingReportSettings.motto ?? existingReportSettings.motto, 180),
      registrationNumber: cleanText(incomingReportSettings.registrationNumber ?? existingReportSettings.registrationNumber, 80),
      postalAddress: cleanText(incomingReportSettings.postalAddress ?? existingReportSettings.postalAddress, 180),
      physicalAddress: cleanText(incomingReportSettings.physicalAddress ?? existingReportSettings.physicalAddress, 180),
      county: cleanText(incomingReportSettings.county ?? existingReportSettings.county, 80),
      phone: cleanText(incomingReportSettings.phone ?? existingReportSettings.phone, 60),
      email: cleanText(incomingReportSettings.email ?? existingReportSettings.email, 120),
      website: cleanText(incomingReportSettings.website ?? existingReportSettings.website, 160),
      curriculumLabel: cleanText(incomingReportSettings.curriculumLabel ?? existingReportSettings.curriculumLabel, 80),
      reportTypeLabel: cleanText(incomingReportSettings.reportTypeLabel ?? existingReportSettings.reportTypeLabel, 80) || 'End Term Report',
      verifyUrl: cleanText(incomingReportSettings.verifyUrl ?? existingReportSettings.verifyUrl, 160) || 'verify.shuleai.com',
      defaultPromotionStatus: cleanText(incomingReportSettings.defaultPromotionStatus ?? existingReportSettings.defaultPromotionStatus, 120),
      closingDate: cleanText(incomingReportSettings.closingDate ?? existingReportSettings.closingDate, 80),
      opensNextTerm: cleanText(incomingReportSettings.opensNextTerm ?? existingReportSettings.opensNextTerm, 80),
      feeBalance: cleanText(incomingReportSettings.feeBalance ?? existingReportSettings.feeBalance, 80),
      showMotto: bool(incomingReportSettings.showMotto, existingReportSettings.showMotto !== false),
      showRegistrationNumber: bool(incomingReportSettings.showRegistrationNumber, existingReportSettings.showRegistrationNumber !== false),
      showPostalAddress: bool(incomingReportSettings.showPostalAddress, existingReportSettings.showPostalAddress !== false),
      showPhysicalAddress: bool(incomingReportSettings.showPhysicalAddress, existingReportSettings.showPhysicalAddress !== false),
      showPhone: bool(incomingReportSettings.showPhone, existingReportSettings.showPhone !== false),
      showEmail: bool(incomingReportSettings.showEmail, existingReportSettings.showEmail !== false),
      showWebsite: bool(incomingReportSettings.showWebsite, existingReportSettings.showWebsite === true),
      showCurriculum: bool(incomingReportSettings.showCurriculum, existingReportSettings.showCurriculum !== false),
      showStudentPhoto: bool(incomingReportSettings.showStudentPhoto, existingReportSettings.showStudentPhoto !== false),
      showPromotionStatus: bool(incomingReportSettings.showPromotionStatus, existingReportSettings.showPromotionStatus !== false),
      showAttendance: bool(incomingReportSettings.showAttendance, existingReportSettings.showAttendance !== false),
      showCoreValues: bool(incomingReportSettings.showCoreValues, existingReportSettings.showCoreValues !== false),
      showTeacherFeedback: bool(incomingReportSettings.showTeacherFeedback, existingReportSettings.showTeacherFeedback !== false),
      showTermInformation: bool(incomingReportSettings.showTermInformation, existingReportSettings.showTermInformation !== false),
      showBehaviour: bool(incomingReportSettings.showBehaviour, existingReportSettings.showBehaviour !== false),
      showAIInsights: bool(incomingReportSettings.showAIInsights, existingReportSettings.showAIInsights !== false),
      showTeacherComment: bool(incomingReportSettings.showTeacherComment, existingReportSettings.showTeacherComment !== false),
      showHeadteacherComment: bool(incomingReportSettings.showHeadteacherComment, existingReportSettings.showHeadteacherComment !== false),
      showSignatures: bool(incomingReportSettings.showSignatures, existingReportSettings.showSignatures !== false),
      showStamp: bool(incomingReportSettings.showStamp, existingReportSettings.showStamp !== false),
      showVerificationCode: bool(incomingReportSettings.showVerificationCode, existingReportSettings.showVerificationCode !== false),
      showClassPosition: bool(incomingReportSettings.showClassPosition, existingReportSettings.showClassPosition === true),
      showStreamPosition: bool(incomingReportSettings.showStreamPosition, existingReportSettings.showStreamPosition === true)
    };
    const settings = v102BuildCurriculumSettings(school, { assessmentSettings: sanitized.length ? sanitized : defaults });
    settings.reportCardSettings = reportCardSettings;
    school.settings = settings;
    school.reportCardSettings = reportCardSettings;
    await school.save();
    res.json({ success:true, message:'Assessment/report settings saved', data:{ assessmentSettings: settings.curriculumEngine.assessmentSettings, reportCardSettings } });
  } catch(error) { console.error('V130 assessment settings error:', error); res.status(500).json({ success:false, message:error.message }); }
};

exports.submitSchoolPaymentConfirmation = async (req, res) => {
  try {
    const school = await v102GetSchool(req.user.schoolCode);
    if (!school) return res.status(404).json({ success:false, message:'School not found' });
    const { amount, method='mpesa', reference, paidAt, notes, proofUrl, requestedPlan='growth' } = req.body;
    const [rows] = await sequelize.query(`
      INSERT INTO "SchoolPaymentRequests" ("schoolCode","submittedBy","amount","method","reference","paidAt","notes","proofUrl","requestedPlan","status","createdAt","updatedAt")
      VALUES (:schoolCode,:submittedBy,:amount,:method,:reference,:paidAt,:notes,:proofUrl,:requestedPlan,'pending',NOW(),NOW())
      RETURNING *
    `, { replacements:{ schoolCode:req.user.schoolCode, submittedBy:req.user.id, amount:Number(amount || 0), method, reference:reference || null, paidAt:paidAt || new Date(), notes:notes || null, proofUrl:proofUrl || null, requestedPlan } });
    res.status(201).json({ success:true, message:'Payment confirmation submitted for super admin review', data:rows[0] });
  } catch(error) { console.error('V102 payment confirmation error:', error); res.status(500).json({ success:false, message:error.message }); }
};


// ============ FINANCE STAFF WORKSPACE ============
const FINANCE_PERMISSIONS = ['overview','fee_structures','invoices','payments','verification','balances','defaulters','receipts','bursaries','expenses','reconciliation','analytics','reports','settings','alerts','audit'];
const FINANCE_ROLE_DEFAULTS = {
  'Bursar':['overview','fee_structures','invoices','payments','verification','balances','defaulters','receipts','bursaries','reports','settings','analytics','alerts'],
  'Accountant':['overview','payments','verification','expenses','reconciliation','reports','settings','alerts'],
  'Finance Officer':['overview','fee_structures','invoices','payments','verification','balances','defaulters','receipts','bursaries','expenses','reconciliation','reports','settings','alerts']
};

function normalizeFinanceTitle(value) {
  return ['Finance Officer','Bursar','Accountant'].includes(String(value || '')) ? String(value) : 'Finance Officer';
}

function normalizeFinancePermissions(input, title) {
  const allowed = new Set(FINANCE_PERMISSIONS);
  const requested = Array.isArray(input) ? input.map(String).filter(x => allowed.has(x)) : [];
  return requested.length ? [...new Set(requested)] : (FINANCE_ROLE_DEFAULTS[title] || FINANCE_ROLE_DEFAULTS['Finance Officer']);
}

async function getActiveFinanceAssignment(userId, schoolCode) {
  if (!UserRoleAssignment) return null;
  return UserRoleAssignment.findOne({ where: { userId: Number(userId), schoolCode, role: 'finance_officer', status: 'active' } }).catch(() => null);
}

async function userHasFinanceRole(user, schoolCode) {
  if (!user) return false;
  if (user.role === 'finance_officer') return true;
  return Boolean(await getActiveFinanceAssignment(user.id, schoolCode || user.schoolCode));
}

async function financePublicUser(user, schoolCode) {
  const assignment = user.role === 'finance_officer' ? null : await getActiveFinanceAssignment(user.id, schoolCode || user.schoolCode);
  const f = assignment?.metadata || user?.preferences?.finance || {};
  return {
    id:user.id,
    name:user.name,
    email:user.email,
    phone:user.phone,
    isActive:user.isActive,
    lastLogin:user.lastLogin,
    createdAt:user.createdAt,
    primaryRole:user.role,
    title:f.title||'Finance Officer',
    permissions:Array.isArray(f.permissions)?f.permissions:[],
    isAdditionalRole:user.role!=='finance_officer'
  };
}

async function assignFinanceRole(user, schoolCode, actorUserId, { title, permissions }) {
  if (user.role === 'finance_officer') {
    const preferences = { ...(user.preferences || {}) };
    delete preferences.additionalRoles;
    preferences.finance = { ...(preferences.finance || {}), title, permissions, assignedBy: actorUserId, assignedAt: preferences.finance?.assignedAt || new Date().toISOString(), updatedBy: actorUserId, updatedAt: new Date().toISOString() };
    await user.update({ preferences, isActive: true });
    return null;
  }
  const [assignment] = await UserRoleAssignment.findOrCreate({
    where: { userId: user.id, schoolCode, role: 'finance_officer' },
    defaults: { status: 'active', assignedBy: actorUserId, assignedAt: new Date(), metadata: { title, permissions } }
  });
  await assignment.update({ status: 'active', revokedBy: null, revokedAt: null, assignedBy: actorUserId, assignedAt: assignment.assignedAt || new Date(), metadata: { ...(assignment.metadata || {}), title, permissions, updatedBy: actorUserId, updatedAt: new Date().toISOString() } });
  const preferences = { ...(user.preferences || {}) };
  delete preferences.additionalRoles;
  preferences.finance = { title, permissions, assignedBy: actorUserId, assignedAt: preferences.finance?.assignedAt || new Date().toISOString(), updatedBy: actorUserId, updatedAt: new Date().toISOString() };
  await user.update({ preferences, isActive: true });
  return assignment;
}

exports.getFinanceStaff = async (req, res) => {
  try {
    const schoolCode = req.user.schoolCode;
    const users = await User.findAll({ where:{ schoolCode, isActive:{[Op.in]:[true,false]} }, attributes:['id','name','email','phone','role','isActive','lastLogin','createdAt','preferences','schoolCode'], order:[['name','ASC']] });
    const assignments = UserRoleAssignment ? await UserRoleAssignment.findAll({ where:{ schoolCode, role:'finance_officer', status:'active' }, attributes:['userId'] }).catch(()=>[]) : [];
    const assignedIds = new Set(assignments.map(a => Number(a.userId)));
    const financeUsers = users.filter(u => u.role === 'finance_officer' || assignedIds.has(Number(u.id)));
    const data = [];
    for (const user of financeUsers) data.push(await financePublicUser(user, schoolCode));
    res.json({ success:true, data });
  } catch(e) { res.status(500).json({success:false,message:e.message}); }
};

exports.createFinanceStaff = async (req,res) => {
  try {
    const name=String(req.body.name||'').trim(), email=String(req.body.email||'').trim().toLowerCase(), phone=String(req.body.phone||'').trim()||null, password=String(req.body.password||''), title=normalizeFinanceTitle(req.body.title);
    const permissions = normalizeFinancePermissions(req.body.permissions, title);
    const schoolCode = req.user.schoolCode;
    if(!email||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return res.status(400).json({success:false,message:'A valid finance staff email is required.'});
    const existing=await User.findOne({where:{email}});
    if(existing){
      if(String(existing.schoolCode||'')!==String(schoolCode||''))return res.status(409).json({success:false,code:'EMAIL_REGISTERED_OTHER_SCHOOL',message:'This email is already registered under another school and cannot be assigned here.'});
      if(existing.role==='super_admin')return res.status(403).json({success:false,code:'PROTECTED_ACCOUNT',message:'This protected platform account cannot be assigned to a school Finance Team.'});
      if(['student','parent'].includes(existing.role))return res.status(409).json({success:false,code:'ACCOUNT_NOT_ELIGIBLE',message:'This existing account is not eligible for a staff finance role. Use a school staff email instead.'});
      if(await userHasFinanceRole(existing, schoolCode))return res.json({success:true,message:'This user already has Finance Team access.',data:await financePublicUser(existing, schoolCode)});
      if(req.body.assignExisting!==true)return res.status(409).json({success:false,code:'EXISTING_SAME_SCHOOL_USER',message:'An account with this email already exists in this school. You can assign this person to the Finance Team.',data:{id:existing.id,name:existing.name,email:existing.email,role:existing.role}});
      await assignFinanceRole(existing, schoolCode, req.user.id, { title, permissions });
      await createAlert({userId:existing.id,role:existing.role,type:'system',severity:'info',title:'Finance Team access assigned',message:`You can now sign in using the Finance Staff role as ${title}.`,categoryLabel:'Finance',sourceType:'finance_team',sourceLabel:'School Administration',dedupeKey:`finance-role:${existing.id}:${schoolCode}`,data:{schoolCode,targetRoles:['finance_officer'],financeTitle:title}}).catch(()=>null);
      return res.json({success:true,message:'Existing school user assigned to the Finance Team.',data:await financePublicUser(existing, schoolCode)});
    }
    if(name.length<2)return res.status(400).json({success:false,message:'Finance staff name is required.'});
    if(password.length<12)return res.status(400).json({success:false,message:'Temporary password must be at least 12 characters.'});
    const user=await User.create({name,email,phone,password,role:'finance_officer',schoolCode,isActive:true,firstLogin:true,mustChangePassword:true,passwordIssuedAt:new Date(),preferences:{notifications:{email:true,sms:false,push:true},theme:'light',finance:{title,permissions,assignedBy:req.user.id,assignedAt:new Date().toISOString()}}});
    res.status(201).json({success:true,message:'Finance staff account created.',data:await financePublicUser(user, schoolCode)});
  } catch(e) { console.error(e); res.status(500).json({success:false,message:e.message}); }
};

exports.updateFinanceStaff = async (req,res) => {
  try {
    const schoolCode = req.user.schoolCode;
    const user=await User.findOne({where:{id:Number(req.params.userId),schoolCode}});
    if(!user || !(await userHasFinanceRole(user, schoolCode)))return res.status(404).json({success:false,message:'Finance staff account not found.'});
    const preferences={...(user.preferences||{})};
    delete preferences.additionalRoles;
    const f={...(preferences.finance||{})};
    if(req.body.title!==undefined)f.title=normalizeFinanceTitle(req.body.title);
    const title=f.title||'Finance Officer';
    if(Array.isArray(req.body.permissions)){
      const list=normalizeFinancePermissions(req.body.permissions,title);
      if(!list.length)return res.status(400).json({success:false,message:'Select at least one valid finance permission.'});
      f.permissions=list;
    } else if (!Array.isArray(f.permissions)) {
      f.permissions = normalizeFinancePermissions([], title);
    }
    f.updatedBy=req.user.id;f.updatedAt=new Date().toISOString();preferences.finance=f;
    if(req.body.removeFinanceRole===true){
      if(user.role==='finance_officer'){
        await user.update({isActive:false,preferences:{...preferences,finance:{...f,removedAt:new Date().toISOString(),removedBy:req.user.id}}});
        return res.json({success:true,message:'Finance account deactivated.',data:await financePublicUser(user, schoolCode)});
      }
      const assignment = await getActiveFinanceAssignment(user.id, schoolCode);
      if (assignment) await assignment.update({ status:'revoked', revokedBy:req.user.id, revokedAt:new Date(), metadata:{...(assignment.metadata||{}), removedBy:req.user.id, removedAt:new Date().toISOString()} });
      await user.update({preferences});
      return res.json({success:true,message:'Finance Team role removed. The original user account remains active.',data:{id:user.id,removed:true}});
    }
    if (user.role !== 'finance_officer') await assignFinanceRole(user, schoolCode, req.user.id, { title, permissions:f.permissions });
    const updates={preferences};
    for(const k of['name','phone','isActive'])if(req.body[k]!==undefined)updates[k]=req.body[k];
    if(req.body.password){if(String(req.body.password).length<12)return res.status(400).json({success:false,message:'Password must be at least 12 characters.'});updates.password=String(req.body.password);updates.mustChangePassword=true;updates.passwordIssuedAt=new Date();}
    await user.update(updates);
    res.json({success:true,message:'Finance Team member updated.',data:await financePublicUser(user, schoolCode)});
  } catch(e) { res.status(500).json({success:false,message:e.message}); }
};
// ============ SCHOOL-SCOPED CUSTOM SUBJECTS ============
exports.getCustomSubjects=async(req,res)=>{try{const school=await v102GetSchool(req.user.schoolCode);if(!school)return res.status(404).json({success:false,message:'School not found'});const cfg=curriculumEngine.getCurriculumConfig(school);res.json({success:true,data:(cfg.schoolSubjects||[]).filter(x=>x.isCustom)});}catch(e){res.status(500).json({success:false,message:e.message});}};
exports.createCustomSubject=async(req,res)=>{try{const school=await v102GetSchool(req.user.schoolCode);if(!school)return res.status(404).json({success:false,message:'School not found'});const name=String(req.body.name||'').trim(),code=String(req.body.code||name).trim().toUpperCase().replace(/[^A-Z0-9_-]+/g,'_').slice(0,40),scope=req.body.scope==='class'?'class':'school',classIds=scope==='class'&&Array.isArray(req.body.classIds)?[...new Set(req.body.classIds.map(Number).filter(Boolean))]:[],levelCodes=Array.isArray(req.body.levelCodes)?[...new Set(req.body.levelCodes.map(String).filter(Boolean))]:[];if(name.length<2)return res.status(400).json({success:false,message:'Custom subject name is required.'});if(scope==='class'&&!classIds.length)return res.status(400).json({success:false,message:'Select at least one class for a class-scoped subject.'});if(classIds.length){const count=await Class.count({where:{id:{[Op.in]:classIds},schoolCode:req.user.schoolCode,isActive:true}});if(count!==classIds.length)return res.status(400).json({success:false,message:'One or more selected classes do not belong to this school.'});}const cfg=curriculumEngine.getCurriculumConfig(school),current=Array.isArray(cfg.schoolSubjects)?cfg.schoolSubjects:[],duplicate=current.find(x=>String(x.name||'').trim().toLowerCase()===name.toLowerCase()||String(x.code||'').trim().toUpperCase()===code);if(duplicate)return res.status(409).json({success:false,code:'CUSTOM_SUBJECT_EXISTS',message:'A subject with this name or code already exists in this school.',data:duplicate});const subject={subjectId:`custom_${crypto.randomUUID()}`,name,code,category:'custom',isCustom:true,isOptional:req.body.isOptional!==false,countsInFinalByDefault:req.body.countsInFinalByDefault!==false,isOffered:true,scope,classIds,levelCodes,gradingMethod:String(req.body.gradingMethod||'school_default'),savedAt:new Date().toISOString(),savedBy:req.user.id};const settings=v102BuildCurriculumSettings(school,{schoolSubjects:[...current,subject]});school.settings=settings;school.enabledLevels=settings.curriculumEngine.enabledLevels;await school.save();const sync=await v130SyncClassesForEnabledLevels(school,req.user.id);if(global.io)global.io.to(`school-${school.schoolId}`).emit('curriculum:updated',{schoolCode:school.schoolId,customSubject:subject});res.status(201).json({success:true,message:`${name} added and synced to assignments, marks, reports, analytics and timetable options.`,data:{subject,classSync:sync}});}catch(e){console.error(e);res.status(500).json({success:false,message:e.message});}};
exports.deleteCustomSubject=async(req,res)=>{try{const school=await v102GetSchool(req.user.schoolCode);if(!school)return res.status(404).json({success:false,message:'School not found'});const cfg=curriculumEngine.getCurriculumConfig(school),current=Array.isArray(cfg.schoolSubjects)?cfg.schoolSubjects:[],target=current.find(x=>x.isCustom&&String(x.subjectId)===String(req.params.subjectId));if(!target)return res.status(404).json({success:false,message:'Custom subject not found.'});const settings=v102BuildCurriculumSettings(school,{schoolSubjects:current.filter(x=>String(x.subjectId)!==String(req.params.subjectId))});school.settings=settings;await school.save();await v130SyncClassesForEnabledLevels(school,req.user.id);res.json({success:true,message:`${target.name} removed.`,data:{subjectId:target.subjectId}});}catch(e){res.status(500).json({success:false,message:e.message});}};


// Public duty sharing is private-by-default. Admins explicitly enable it and receive a revocable opaque token.
exports.getPublicDutySharing = async (req, res) => {
  try {
    const school = await School.findOne({ where: { schoolId: req.user.schoolCode } });
    if (!school) return res.status(404).json({ success: false, message: 'School not found' });
    const cfg = school.settings?.publicDutySharing || {};
    return res.json({ success: true, data: { enabled: cfg.enabled === true, showTeacherNames: cfg.showTeacherNames === true, shareToken: cfg.token || null } });
  } catch (error) { return res.status(500).json({ success: false, message: error.message }); }
};

exports.updatePublicDutySharing = async (req, res) => {
  try {
    const school = await School.findOne({ where: { schoolId: req.user.schoolCode } });
    if (!school) return res.status(404).json({ success: false, message: 'School not found' });
    const current = school.settings || {};
    const existing = current.publicDutySharing || {};
    const rotate = req.body.rotateToken === true || !existing.token;
    const token = rotate ? crypto.randomBytes(24).toString('base64url') : existing.token;
    const publicDutySharing = {
      enabled: req.body.enabled === true,
      showTeacherNames: req.body.showTeacherNames === true,
      token,
      updatedBy: req.user.id,
      updatedAt: new Date().toISOString()
    };
    await school.update({ settings: { ...current, publicDutySharing } });
    return res.json({ success: true, data: { ...publicDutySharing, shareUrl: `/api/public/duty/today?schoolId=${encodeURIComponent(school.schoolId)}&shareToken=${encodeURIComponent(token)}` } });
  } catch (error) { return res.status(500).json({ success: false, message: error.message }); }
};
