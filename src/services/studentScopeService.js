const { Student, User, Teacher, Class } = require('../models');

async function findStudentInSchool(studentId, schoolCode, options = {}) {
  const Model = Student.unscoped ? Student.unscoped() : Student;
  return Model.findOne({
    where: { id: Number(studentId) },
    include: [{
      model: User,
      required: true,
      where: { schoolCode },
      attributes: options.userAttributes || ['id', 'name', 'email', 'phone', 'schoolCode', 'isActive', 'role']
    }],
    transaction: options.transaction,
    lock: options.lock
  });
}

async function findTeacherInSchool(userId, schoolCode, options = {}) {
  return Teacher.findOne({
    where: { userId: Number(userId) },
    include: [{ model: User, required: true, where: { schoolCode }, attributes: ['id','name','email','schoolCode','role'] }],
    transaction: options.transaction,
    lock: options.lock
  });
}

async function teacherCanAccessStudentClass(teacher, student, schoolCode) {
  if (!teacher || !student) return false;
  if (student.classId && Number(student.classId) === Number(teacher.classId)) return true;
  if (teacher.classTeacher && student.grade && String(student.grade).toLowerCase() === String(teacher.classTeacher).toLowerCase()) {
    const cls = await Class.findOne({ where: { schoolCode, name: student.grade, isActive: true } }).catch(() => null);
    if (cls && (Number(cls.teacherId) === Number(teacher.id) || Number(cls.id) === Number(teacher.classId))) return true;
  }
  return false;
}

module.exports = {
  findStudentInSchool,
  findTeacherInSchool,
  teacherCanAccessStudentClass
};
