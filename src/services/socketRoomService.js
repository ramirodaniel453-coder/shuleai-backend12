const { Op } = require('sequelize');
const { User, Teacher, Student, Parent, StudentParent, Class, ChatGroup, ChatGroupMember, ClassroomThread, TeacherSubjectAssignment } = require('../models');

function roomParts(room) { return String(room || '').split(':'); }
function sameSchool(socket, schoolCode) { return Boolean(socket.schoolCode && schoolCode && String(socket.schoolCode) === String(schoolCode)); }

async function teacherClassIds(userId) {
  const teacher = await Teacher.findOne({ where: { userId } });
  if (!teacher) return [];
  const direct = [teacher.classId].filter(Boolean).map(Number);
  const assignmentRows = await TeacherSubjectAssignment.findAll({ where:{ teacherId:teacher.id, isClassTeacher:true }, attributes:['classId'] }).catch(() => []);
  const assignmentIds = assignmentRows.map(row => Number(row.classId)).filter(Boolean);
  const classes = await Class.findAll({ where: { [Op.or]: [
    { teacherId: teacher.id },
    { id: { [Op.in]: [...direct, ...assignmentIds].length ? [...direct, ...assignmentIds] : [-1] } },
    teacher.classTeacher ? { name: teacher.classTeacher } : { id: -1 }
  ] }, attributes: ['id'] }).catch(() => []);
  return [...new Set([...direct, ...assignmentIds, ...classes.map(c => Number(c.id))].filter(Boolean))];
}

async function canJoinClass(socket, schoolCode, classId) {
  if (!sameSchool(socket, schoolCode)) return false;
  if (['admin','super_admin'].includes(socket.userRole)) return true;
  if (socket.userRole === 'teacher') return (await teacherClassIds(socket.userId)).includes(Number(classId));
  if (socket.userRole === 'student') {
    const student = await Student.findOne({ where: { userId: socket.userId } });
    return Number(student?.classId) === Number(classId);
  }
  if (socket.userRole === 'parent') {
    const parent = await Parent.findOne({ where: { userId: socket.userId } });
    if (!parent) return false;
    const links = await StudentParent.findAll({ where: { parentId: parent.id } });
    const students = await Student.findAll({ where: { id: { [Op.in]: links.map(x => x.studentId) }, classId: Number(classId) } });
    return students.length > 0;
  }
  return false;
}

async function canJoinStudentContext(socket, studentId) {
  const student = await Student.findByPk(Number(studentId), { include: [{ model: User, attributes: ['schoolCode'] }] });
  if (!student || !sameSchool(socket, student.User?.schoolCode || student.schoolCode || socket.schoolCode)) return false;
  if (['admin','super_admin'].includes(socket.userRole)) return true;
  if (socket.userRole === 'student') return Number(student.userId) === Number(socket.userId);
  if (socket.userRole === 'teacher') return (await teacherClassIds(socket.userId)).includes(Number(student.classId));
  if (socket.userRole === 'parent') {
    const parent = await Parent.findOne({ where: { userId: socket.userId } });
    return Boolean(parent && await StudentParent.findOne({ where: { parentId: parent.id, studentId: student.id } }));
  }
  return false;
}


async function parentClassIds(parentUserId, schoolCode) {
  const parent = await Parent.findOne({ where:{ userId:parentUserId } });
  if (!parent) return [];
  const links = await StudentParent.findAll({ where:{ parentId:parent.id }, attributes:['studentId'] });
  if (!links.length) return [];
  const students = await Student.findAll({ where:{ id:{ [Op.in]:links.map(link=>link.studentId) }, status:'active' }, include:[{ model:User, where:{ schoolCode, role:'student', isActive:true }, attributes:['id'] }], attributes:['id','classId','grade'] });
  const direct = students.map(student=>Number(student.classId)).filter(Boolean);
  if (direct.length) return [...new Set(direct)];
  const grades = [...new Set(students.map(student=>String(student.grade||'').trim()).filter(Boolean))];
  if (!grades.length) return [];
  const classes = await Class.findAll({ where:{ schoolCode, isActive:true, [Op.or]:[{name:{[Op.in]:grades}},{grade:{[Op.in]:grades}}] }, attributes:['id'] });
  return [...new Set(classes.map(cls=>Number(cls.id)))];
}

async function isParentClassTeacherPair(parentUserId, teacherUserId, schoolCode) {
  const classIds = await parentClassIds(parentUserId, schoolCode);
  if (!classIds.length) return false;
  const teacher = await Teacher.findOne({ where:{ userId:teacherUserId }, attributes:['id','classId'] });
  if (!teacher) return false;
  if (teacher.classId && classIds.includes(Number(teacher.classId))) return true;
  return Boolean(await Class.findOne({ where:{ id:{[Op.in]:classIds}, schoolCode, isActive:true, teacherId:teacher.id }, attributes:['id'] }));
}

async function directPairAllowed(first, second, schoolCode) {
  const roles = [first.role, second.role];
  if (roles.includes('student')) {
    if (roles[0] !== 'student' || roles[1] !== 'student') return false;
    const profiles = await Student.findAll({ where:{ userId:{[Op.in]:[first.id,second.id]}, status:'active' }, attributes:['userId','classId','grade'] });
    if (profiles.length !== 2) return false;
    if (profiles[0].classId && profiles[1].classId) return Number(profiles[0].classId) === Number(profiles[1].classId);
    const grades=profiles.map(profile=>String(profile.grade||'').trim().toLowerCase());
    return Boolean(grades[0] && grades[0]===grades[1]);
  }
  const parent = first.role==='parent'?first:second.role==='parent'?second:null;
  const other = parent && Number(parent.id)===Number(first.id)?second:first;
  if (parent) {
    if (other.role==='admin') return true;
    if (other.role==='teacher') return isParentClassTeacherPair(parent.id,other.id,schoolCode);
    return false;
  }
  if (roles.includes('teacher') && roles.includes('student')) return false;
  return roles.every(role=>['teacher','admin','super_admin'].includes(role));
}

async function canJoinConversation(socket, key) {
  const raw = String(key || '');
  const parts = raw.split(':');
  // Parent conversations use a school-scoped canonical key:
  // schoolCode:parent_class_teacher|parent_admin:parentUserId:studentId:classId:receiverUserId
  if (['parent_class_teacher','parent_admin'].includes(parts[1])) {
    const [schoolCode,type,parentUserId,studentId,classId,receiverUserId] = [parts[0],parts[1],parts[2],parts[3],parts[4],parts[5]];
    if (!sameSchool(socket, schoolCode)) return false;
    if (![String(parentUserId), String(receiverUserId)].includes(String(socket.userId))) return false;
    const parentUser = await User.findOne({ where:{ id:Number(parentUserId), role:'parent', schoolCode, isActive:true }, attributes:['id'] });
    if (!parentUser) return false;
    if (String(socket.userId) === String(parentUserId)) {
      const parent = await Parent.findOne({ where:{ userId:Number(parentUserId) } });
      if (!parent) return false;
      const where={ id:Number(studentId), status:'active' };
      if(type==='parent_class_teacher' && Number(classId)) where.classId=Number(classId);
      const student = await Student.findOne({ where, include:[{model:User,where:{schoolCode},attributes:['id']}] }).catch(()=>null);
      return Boolean(student && await StudentParent.findOne({ where:{ parentId:parent.id, studentId:student.id } }));
    }
    const receiver = await User.findOne({ where:{ id:Number(receiverUserId), schoolCode, isActive:true }, attributes:['id','role'] });
    if (!receiver || Number(receiver.id)!==Number(socket.userId)) return false;
    if (type === 'parent_admin') return receiver.role === 'admin';
    if (receiver.role !== 'teacher') return false;
    return isParentClassTeacherPair(Number(parentUserId), Number(receiverUserId), schoolCode);
  }
  const [kind, a, b] = parts;
  if (kind === 'direct') {
    if (![String(a), String(b)].includes(String(socket.userId))) return false;
    const participants = await User.findAll({ where:{ id:{ [Op.in]:[Number(a),Number(b)] }, schoolCode:socket.schoolCode, isActive:true }, attributes:['id','role','schoolCode'] });
    if (participants.length !== 2) return false;
    return directPairAllowed(participants[0], participants[1], socket.schoolCode);
  }
  if (kind === 'group') {
    const group = await ChatGroup.findOne({ where: { id: Number(a), schoolCode: socket.schoolCode, isActive: true } });
    if (!group) return false;
    if (['admin','super_admin'].includes(socket.userRole)) return true;
    return Boolean(await ChatGroupMember.findOne({ where: { groupId: group.id, userId: socket.userId } }));
  }
  if (kind === 'thread') {
    const thread = await ClassroomThread.findOne({ where: { id: Number(a), schoolCode: socket.schoolCode } });
    if (!thread) return false;
    if (!thread.classId) return ['teacher','admin','super_admin'].includes(socket.userRole);
    return canJoinClass(socket, socket.schoolCode, thread.classId);
  }
  return false;
}

async function canJoinRoom(socket, room) {
  const parts = roomParts(room);
  const kind = parts[0];
  if (kind === 'user') return String(parts[1]) === String(socket.userId);
  if (kind === 'school') return sameSchool(socket, parts[1]);
  if (kind === 'role') return sameSchool(socket, parts[1]) && String(parts[2]) === String(socket.userRole);
  if (kind === 'class') return canJoinClass(socket, parts[1], parts[2]);
  if (kind === 'student-context') return canJoinStudentContext(socket, parts[1]);
  if (kind === 'conversation') return canJoinConversation(socket, parts.slice(1).join(':'));
  return false;
}

async function joinBaseRooms(socket) {
  const rooms = [`user:${socket.userId}`, `role:${socket.schoolCode}:${socket.userRole}`];
  if (socket.schoolCode) rooms.push(`school:${socket.schoolCode}`);
  for (const room of rooms) if (await canJoinRoom(socket, room)) await socket.join(room);
  // Legacy rooms remain joined only for compatibility with old notification code.
  await socket.join(`user-${socket.userId}`);
  if (socket.schoolCode) await socket.join(`school-${socket.schoolCode}`);
  return rooms;
}

module.exports = { canJoinRoom, canJoinConversation, canJoinClass, canJoinStudentContext, joinBaseRooms };
