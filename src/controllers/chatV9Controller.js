const { Op } = require('sequelize');
const path = require('path');
const fs = require('fs');
const { saveUploadAsset } = require('../services/mediaAssetService');
const realtime = require('../services/realtimeService');
const schoolLinkageService = require('../services/schoolLinkageService');
const {
  User, Teacher, Student, Parent, StudentParent, Class,
  Department, DepartmentMember, TeacherSubjectAssignment,
  ChatGroup, ChatGroupMember, ChatMessage,
  ClassroomThread, ThreadReply, AchievementEvent
} = require('../models');

function schoolCodeOf(req) {
  return req.user?.schoolCode;
}

async function getTeacherProfile(userId) {
  return Teacher.findOne({ where: { userId } });
}

async function findTeacherInCurrentSchool(req, teacherId) {
  const id = Number(teacherId);
  if (!id) return null;
  return Teacher.findOne({
    where: { id },
    include: [{ model: User, required: true, where: { schoolCode: schoolCodeOf(req), role: 'teacher', isActive: true }, attributes: ['id','name','email','role','schoolCode'] }]
  }).catch(() => null);
}

async function getStudentProfile(userId) {
  return Student.unscoped ? Student.unscoped().findOne({ where: { userId } }) : Student.findOne({ where: { userId } });
}

async function getClassStudyParticipants({ schoolCode, classId }) {
  if (!classId) return [];
  const students = await (Student.unscoped ? Student.unscoped() : Student).findAll({
    where: { classId, status: 'active' },
    include: [{ model: User, attributes: ['id','name','role','profileImage'], where: { schoolCode, role: 'student', isActive: true } }],
    order: [[User, 'name', 'ASC']],
    limit: 120
  });
  return students.map(s => ({
    id: s.User?.id,
    studentId: s.id,
    name: s.User?.name || s.name || 'Student',
    role: 'student',
    profileImage: s.User?.profileImage || null,
    admissionNumber: s.admissionNumber || null
  })).filter(x => x.id);
}


async function resolveStudentClassContext(req) {
  const student = await getStudentProfile(req.user.id);
  let classId = student?.classId || req.user?.classId || req.user?.student?.classId || req.user?.Student?.classId || null;
  let grade = student?.grade || req.user?.grade || req.user?.student?.grade || req.user?.Student?.grade || req.user?.className || null;
  let classRecord = null;

  if (classId) {
    classRecord = await Class.findOne({ where: { id: Number(classId), schoolCode: schoolCodeOf(req) } }).catch(() => null);
  }

  if (!classRecord && grade) {
    const cleanGrade = String(grade).trim();
    classRecord = await Class.findOne({
      where: {
        schoolCode: schoolCodeOf(req),
        [Op.or]: [
          { name: cleanGrade },
          { grade: cleanGrade },
          { stream: cleanGrade }
        ]
      }
    }).catch(() => null);
    if (classRecord?.id) classId = classRecord.id;
  }

  return { student, classId: classId ? Number(classId) : null, grade, classRecord };
}

function threadMatchesStudentContext(thread, ctx) {
  if (!thread) return false;
  if (!thread.classId) return true;
  if (ctx.classId && Number(thread.classId) === Number(ctx.classId)) return true;
  const meta = thread.metadata || {};
  const possibleNames = [ctx.grade, ctx.classRecord?.name, ctx.classRecord?.grade, ctx.classRecord?.stream].filter(Boolean).map(v => String(v).toLowerCase().trim());
  const threadNames = [meta.className, meta.grade, meta.stream].filter(Boolean).map(v => String(v).toLowerCase().trim());
  return possibleNames.some(name => threadNames.includes(name));
}

async function buildStudyMeta(req, threads, student, studentCtx = null) {
  const schoolCode = schoolCodeOf(req);
  const classIds = [...new Set([studentCtx?.classId, student?.classId, ...threads.map(t => t.classId)].filter(Boolean).map(Number))];
  const classes = classIds.length ? await Class.findAll({ where: { id: { [Op.in]: classIds }, schoolCode } }) : [];
  const classMap = new Map(classes.map(c => [Number(c.id), c]));
  const participantsByClass = {};
  for (const classId of classIds) {
    participantsByClass[classId] = await getClassStudyParticipants({ schoolCode, classId });
  }

  // If the student has a grade/class name but no linked classId yet, still return
  // same-grade classmates so private peer chats and the members panel do not appear empty.
  if (!classIds.length && req.user?.role === 'student') {
    const grade = studentCtx?.grade || student?.grade || req.user?.grade || req.user?.className || null;
    if (grade) {
      const cleanGrade = String(grade).trim();
      const students = await (Student.unscoped ? Student.unscoped() : Student).findAll({
        where: { schoolCode, status: 'active', [Op.or]: [{ grade: cleanGrade }, { className: cleanGrade }] },
        include: [{ model: User, attributes: ['id','name','role','profileImage'], where: { schoolCode, role: 'student', isActive: true } }],
        order: [[User, 'name', 'ASC']],
        limit: 120
      }).catch(() => []);
      participantsByClass[0] = students.map(s => ({
        id: s.User?.id,
        studentId: s.id,
        name: s.User?.name || s.name || 'Student',
        role: 'student',
        profileImage: s.User?.profileImage || null,
        admissionNumber: s.admissionNumber || null
      })).filter(x => x.id);
      return {
        groups: [{ id: 'class-0', classId: null, name: cleanGrade || 'My Study Group', grade: cleanGrade, stream: '', type: 'class-study-group', participantCount: participantsByClass[0].length, participants: participantsByClass[0] }],
        participantsByClass
      };
    }
  }

  const groups = classIds.map(classId => {
    const c = classMap.get(Number(classId));
    const participants = participantsByClass[classId] || [];
    return {
      id: `class-${classId}`,
      classId,
      name: c?.name || c?.grade || studentCtx?.grade || 'My Class Study Group',
      grade: c?.grade || studentCtx?.grade || '',
      stream: c?.stream || '',
      type: 'class-study-group',
      participantCount: participants.length,
      participants
    };
  });
  return { groups, participantsByClass };
}

function canManageSchool(req) {
  return ['admin', 'super_admin'].includes(req.user?.role);
}

function canManageChatGroup(req) {
  return ['teacher', 'admin', 'super_admin'].includes(req.user?.role);
}

async function getTeacherAllowedClassIds(userId) {
  const teacher = await getTeacherProfile(userId);
  if (!teacher) return [];
  const ids = new Set();
  if (teacher.classId) ids.add(Number(teacher.classId));
  const assignments = await TeacherSubjectAssignment.findAll({ where: { teacherId: teacher.id }, attributes: ['classId'] }).catch(() => []);
  for (const item of assignments || []) {
    if (item.classId) ids.add(Number(item.classId));
  }
  return [...ids].filter(Boolean);
}


async function getClassTeacherClassIds(userId, schoolCode) {
  const teacher = await getTeacherProfile(userId);
  if (!teacher) return [];
  const or = [];
  if (teacher.classId) or.push({ id: Number(teacher.classId) });
  if (teacher.classTeacher) or.push({ name: String(teacher.classTeacher).trim() });
  // Most deployed Shule AI builds store the class teacher on Classes.teacherId.
  // Keep this as the strongest source, then fall back to teacher.classId/classTeacher.
  or.push({ teacherId: teacher.id });
  const classes = await Class.findAll({
    where: { schoolCode, isActive: true, [Op.or]: or },
    attributes: ['id']
  }).catch(() => []);
  return [...new Set((classes || []).map(c => Number(c.id)).filter(Boolean))];
}

async function canTeacherModerateThread(req, thread) {
  if (!thread || req.user?.role !== 'teacher') return false;
  if (Number(thread.createdBy) === Number(req.user.id)) return true;
  const classTeacherClassIds = await getClassTeacherClassIds(req.user.id, schoolCodeOf(req));
  return Boolean(thread.classId && classTeacherClassIds.includes(Number(thread.classId)));
}

async function canTeacherViewStudyThread(req, thread) {
  if (!thread || req.user?.role !== 'teacher') return false;
  // Official rollout rule:
  // - Every teacher sees study threads they personally created.
  // - Class teachers also monitor the official class study group/threads for their class.
  // - Subject teachers do not browse all school/class study rooms.
  return canTeacherModerateThread(req, thread);
}

async function hydrateChatMessage(message) {
  if (!message) return null;
  return ChatMessage.findByPk(message.id, {
    include: [{ model: User, as: 'Sender', attributes: ['id','name','role','profileImage'] }]
  });
}

function directConversationKey(a,b) { return realtime.directConversationKey(a,b); }
async function chatAudience(message) {
  const row = message?.toJSON ? message.toJSON() : message;
  if (row.groupId) {
    const members = await ChatGroupMember.findAll({ where:{ groupId:row.groupId }, attributes:['userId'] });
    return { key:realtime.groupConversationKey(row.groupId), userIds:[...new Set([row.senderId,...members.map(m=>m.userId)].filter(Boolean).map(Number))] };
  }
  return { key:directConversationKey(row.senderId,row.receiverId), userIds:[...new Set([row.senderId,row.receiverId].filter(Boolean).map(Number))] };
}
async function emitChatMessage(type, message, extra = {}) {
  const hydrated = message?.Sender ? message : await hydrateChatMessage(message);
  const audience = await chatAudience(hydrated || message);
  const row = presentChatMessage(hydrated || message, null);
  await realtime.emit({ type, schoolCode:row.schoolCode, audience:{ school:false, userIds:audience.userIds, conversations:[audience.key] }, entityType:'ChatMessage', entityId:row.id, version:Number(row.version||1), data:{ ...row, conversationId:audience.key, ...extra } });
  return hydrated || message;
}
async function emitThreadEvent(type, thread, reply = null, extra = {}) {
  const users = [];
  if (thread.createdBy) users.push(Number(thread.createdBy));
  const participants = thread.classId ? await getClassStudyParticipants({ schoolCode:thread.schoolCode, classId:thread.classId }) : [];
  users.push(...participants.map(p=>Number(p.id)).filter(Boolean));
  if (!thread.classId) {
    const staff = await User.findAll({ where:{ schoolCode:thread.schoolCode, role:{ [Op.in]:['teacher','admin'] }, isActive:true }, attributes:['id'] });
    users.push(...staff.map(person=>Number(person.id)).filter(Boolean));
  }
  const key = realtime.threadConversationKey(thread.id);
  const row = reply ? presentThreadReply(reply,null) : (thread.toJSON ? thread.toJSON() : thread);
  await realtime.emit({ type, schoolCode:thread.schoolCode, audience:{ school:false, userIds:[...new Set(users)], classIds:thread.classId?[thread.classId]:[], conversations:[key] }, entityType:reply?'ThreadReply':'ClassroomThread', entityId:row.id, version:Number(row.version||1), data:{ ...row, threadId:thread.id, conversationId:key, ...extra } });
}
async function existingClientMessage(schoolCode,senderId,clientMessageId) {
  if (!clientMessageId) return null;
  return ChatMessage.findOne({ where:{ schoolCode,senderId,clientMessageId }, include:[{model:User,as:'Sender',attributes:['id','name','role','profileImage']}] });
}

function chatMessageVisibleToUser(message, userId) {
  const metadata = message?.metadata || {};
  const deletedFor = Array.isArray(metadata.deletedFor) ? metadata.deletedFor.map(Number) : [];
  return !deletedFor.includes(Number(userId));
}

function presentChatMessage(message, userId) {
  if (!message) return message;
  const row = typeof message.toJSON === 'function' ? message.toJSON() : { ...message };
  const metadata = row.metadata || {};
  if (metadata.deletedForEveryone) {
    row.content = 'This message was deleted';
    row.attachmentUrl = null;
    row.messageType = 'deleted';
    row.metadata = { ...metadata, reactions: metadata.reactions || {}, deletedForEveryone: true };
  }
  return row;
}

function presentThreadReply(reply, userId) {
  if (!reply) return reply;
  const row = typeof reply.toJSON === 'function' ? reply.toJSON() : { ...reply };
  const metadata = row.metadata || {};
  const deletedFor = Array.isArray(metadata.deletedFor) ? metadata.deletedFor.map(Number) : [];
  if (deletedFor.includes(Number(userId))) return null;
  if (metadata.deletedForEveryone) {
    row.content = 'This reply was deleted';
    row.metadata = { ...metadata, attachmentUrl: null, deletedForEveryone: true };
  }
  return row;
}

async function buildReplyPreview(messageId, schoolCode) {
  if (!messageId) return null;
  const original = await ChatMessage.findOne({
    where: { id: Number(messageId), schoolCode },
    include: [{ model: User, as: 'Sender', attributes: ['id','name','role','profileImage'] }]
  }).catch(() => null);
  if (!original) return null;
  const metadata = original.metadata || {};
  return {
    id: original.id,
    senderId: original.senderId,
    senderName: original.Sender?.name || 'User',
    content: metadata.deletedForEveryone ? 'This message was deleted' : String(original.content || '').slice(0, 160)
  };
}

async function buildThreadReplyPreview(replyId) {
  if (!replyId) return null;
  const original = await ThreadReply.findByPk(Number(replyId), {
    include: [{ model: User, as: 'Author', attributes: ['id','name','role','profileImage'] }]
  }).catch(() => null);
  if (!original) return null;
  const metadata = original.metadata || {};
  return {
    id: original.id,
    userId: original.userId,
    authorName: original.Author?.name || 'User',
    content: metadata.deletedForEveryone ? 'This reply was deleted' : String(original.content || '').slice(0, 160)
  };
}

function canEditOrDeleteOwn(user, ownerId) {
  return Number(user?.id) === Number(ownerId);
}

function canDeleteForEveryone(user, ownerId) {
  return Number(user?.id) === Number(ownerId) || ['admin', 'super_admin'].includes(user?.role);
}

async function ensureChatGroupManager(req, groupId) {
  const member = await ChatGroupMember.findOne({ where: { groupId, userId: req.user.id } });
  if (canManageSchool(req)) return member || true;
  if (req.user.role !== 'teacher') return null;
  return ['owner','admin'].includes(member?.role) ? member : null;
}

async function ensureTeacherCanAddUsers(req, userIds) {
  if (canManageSchool(req)) return true;
  if (req.user.role !== 'teacher') return false;
  const requestedIds = [...new Set((userIds || []).map(Number).filter(Boolean))];
  if (!requestedIds.length) return true;
  const users = await User.findAll({ where: { id: { [Op.in]: requestedIds }, schoolCode: schoolCodeOf(req), isActive: true }, attributes: ['id','role'] });
  const allowedClassIds = await getTeacherAllowedClassIds(req.user.id);
  for (const user of users) {
    if (user.role === 'teacher') continue;
    if (user.role !== 'student') return false;
    if (!allowedClassIds.length) return false;
    const student = await getStudentProfile(user.id);
    if (!student?.classId || !allowedClassIds.includes(Number(student.classId))) return false;
  }
  return true;
}

async function ensureUserMayUseThread(req, thread) {
  if (!thread || thread.schoolCode !== schoolCodeOf(req)) return false;
  if (['admin','super_admin'].includes(req.user.role)) return true;
  if (req.user.role === 'teacher') return canTeacherViewStudyThread(req, thread);
  if (req.user.role !== 'student') return false;
  const student = await getStudentProfile(req.user.id);
  if (!student) return false;
  const ctx = await resolveStudentClassContext(req);
  if (threadMatchesStudentContext(thread, ctx)) return true;

  // Legacy safeguard: older threads may have missing/wrong classId because student/class
  // data used grade names before classId existed. Let active students in the same school
  // reply to approved, open study threads instead of hard-failing with 403.
  const meta = thread.metadata || {};
  const approvalStatus = String(meta.approvalStatus || 'approved').toLowerCase();
  return approvalStatus === 'approved';
}

async function ensureStaffRoom(req) {
  const schoolCode = schoolCodeOf(req);
  let group = await ChatGroup.findOne({ where: { schoolCode, type: 'staff', name: 'Staff Room' } });
  if (!group) {
    group = await ChatGroup.create({
      schoolCode,
      name: 'Staff Room',
      type: 'staff',
      description: 'General teacher-to-teacher staff room',
      createdBy: req.user.id
    });
  }

  const teachers = await User.findAll({ where: { schoolCode, role: 'teacher', isActive: true } });
  for (const teacher of teachers) {
    await ChatGroupMember.findOrCreate({
      where: { groupId: group.id, userId: teacher.id },
      defaults: { role: 'member' }
    });
  }
  return group;
}

exports.listDepartments = async (req, res) => {
  try {
    const departments = await Department.findAll({
      where: { schoolCode: schoolCodeOf(req), isActive: true },
      include: [{ model: DepartmentMember, include: [{ model: Teacher, include: [{ model: User, attributes: ['id','name','email','role'] }] }] }],
      order: [['name', 'ASC']]
    });
    res.json({ success: true, data: departments });
  } catch (error) {
    console.error('listDepartments error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.createDepartment = async (req, res) => {
  try {
    if (!canManageSchool(req)) return res.status(403).json({ success: false, message: 'Only admin can create departments' });
    const { name, description, teacherIds = [] } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'Department name is required' });

    const requestedTeacherIds = Array.isArray(teacherIds) ? [...new Set(teacherIds.map(Number).filter(Boolean))] : [];
    const validTeachers = [];
    for (const teacherId of requestedTeacherIds) {
      const teacher = await findTeacherInCurrentSchool(req, teacherId);
      if (teacher) validTeachers.push(teacher);
    }
    const headTeacherId = validTeachers[0]?.id || null;

    const department = await Department.create({ schoolCode: schoolCodeOf(req), name, description, headTeacherId });
    const group = await ChatGroup.create({
      schoolCode: schoolCodeOf(req),
      name: `${name} Department`,
      type: 'department',
      description: description || `${name} department group`,
      createdBy: req.user.id,
      departmentId: department.id
    });

    for (const teacher of validTeachers) {
      const isHead = Number(teacher.id) === Number(headTeacherId);
      await DepartmentMember.findOrCreate({ where: { departmentId: department.id, teacherId: teacher.id }, defaults: { role: isHead ? 'head' : 'member' } });
      await ChatGroupMember.findOrCreate({ where: { groupId: group.id, userId: teacher.userId }, defaults: { role: isHead ? 'admin' : 'member' } });
    }

    res.status(201).json({ success: true, data: { department, group } });
  } catch (error) {
    console.error('createDepartment error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.listTeacherDirectory = async (req, res) => {
  try {
    // Official rollout safety rule:
    // private/direct chat must never expose teacher <-> student 1:1 messaging.
    // Teacher-student communication stays in classroom, study-room, and homework threads.
    if (req.user.role === 'student') {
      const ctx = await resolveStudentClassContext(req);
      let classmates = [];
      if (ctx.classId) {
        classmates = await getClassStudyParticipants({ schoolCode: schoolCodeOf(req), classId: ctx.classId });
      }

      // Some older student rows are linked by grade/className instead of classId.
      // Use a same-grade fallback so the student private participant list does not go empty.
      if (!classmates.length) {
        const grade = ctx.grade || ctx.student?.grade || ctx.student?.className || req.user?.grade || req.user?.className || null;
        if (grade) {
          const cleanGrade = String(grade).trim();
          const students = await (Student.unscoped ? Student.unscoped() : Student).findAll({
            where: {
              schoolCode: schoolCodeOf(req),
              status: 'active',
              [Op.or]: [{ grade: cleanGrade }, { className: cleanGrade }]
            },
            include: [{ model: User, attributes: ['id','name','role','profileImage'], where: { schoolCode: schoolCodeOf(req), role: 'student', isActive: true } }],
            order: [[User, 'name', 'ASC']],
            limit: 120
          }).catch(() => []);
          classmates = students.map(st => ({
            id: st.User?.id,
            studentId: st.id,
            name: st.User?.name || st.name || 'Student',
            role: 'student',
            profileImage: st.User?.profileImage || null,
            admissionNumber: st.admissionNumber || null
          })).filter(x => x.id);
        }
      }

      classmates = classmates.filter(p => Number(p.id) !== Number(req.user.id));
      return res.json({ success: true, data: classmates });
    }

    let roleFilter = ['teacher'];
    // Private teacher chat is strictly teacher-to-teacher.
    // Parent communication is loaded in the dedicated Parents tab for class teachers only.
    if (req.user.role === 'teacher') {
      const meTeacher = await Teacher.findOne({ where: { userId: req.user.id } }).catch(() => null);
      let isClassTeacher = false;
      if (meTeacher) {
        const classCount = await Class.count({
          where: {
            schoolCode: schoolCodeOf(req),
            isActive: true,
            [Op.or]: [
              { teacherId: meTeacher.id },
              { id: meTeacher.classId || 0 },
              ...(meTeacher.classTeacher ? [{ name: meTeacher.classTeacher }] : [])
            ]
          }
        }).catch(() => 0);
        isClassTeacher = classCount > 0;
      }
      roleFilter = ['teacher'];
    }
    else if (req.user.role === 'parent') roleFilter = ['teacher', 'admin'];
    else if (['admin', 'super_admin'].includes(req.user.role)) roleFilter = ['teacher', 'admin', 'parent'];

    const users = await User.findAll({
      where: {
        schoolCode: schoolCodeOf(req),
        role: { [Op.in]: roleFilter },
        isActive: true,
        id: { [Op.ne]: req.user.id }
      },
      attributes: ['id','name','email','phone','role','profileImage'],
      include: [
        { model: Teacher, required: false, attributes: ['id','classId','subjects'] },
        { model: Student, required: false, attributes: ['id','classId','grade'] }
      ],
      order: [['role','ASC'], ['name','ASC']]
    });

    let visibleUsers = users;
    if (req.user.role === 'parent') {
      const classIds = await parentLinkedClassIds(req.user.id, schoolCodeOf(req));
      const allowedTeacherIds = new Set(await classTeacherUserIdsForClasses(classIds, schoolCodeOf(req)));
      visibleUsers = users.filter(user => user.role === 'admin' || (user.role === 'teacher' && allowedTeacherIds.has(Number(user.id))));
    }
    res.json({ success: true, data: visibleUsers });
  } catch (error) {
    console.error('listTeacherDirectory error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};


async function resolveTeacherClassIdsForMessages(userId, schoolCode) {
  const classes = await schoolLinkageService.resolveTeacherAssignedClasses(userId, schoolCode, { classTeacherOnly: true });
  return classes.map(c => Number(c.id)).filter(Boolean);
}

exports.listTeacherClassParents = async (req, res) => {
  try {
    if (req.user.role !== 'teacher') return res.status(403).json({ success:false, message:'Only teachers can load linked class parents.' });
    const schoolCode = schoolCodeOf(req);
    const result = await schoolLinkageService.resolveTeacherClassParents(req.user.id, schoolCode);
    res.json({
      success:true,
      data: result.rows,
      classIds: (result.classes || []).map(c => Number(c.id)).filter(Boolean),
      classes: (result.classes || []).map(c => ({ id:c.id, name:c.name, grade:c.grade, stream:c.stream }))
    });
  } catch (error) {
    console.error('listTeacherClassParents error:', error);
    res.status(500).json({ success:false, message:error.message });
  }
};

exports.listTeacherGroups = async (req, res) => {
  try {
    await ensureStaffRoom(req);

    const memberships = await ChatGroupMember.findAll({
      where: { userId: req.user.id },
      include: [{ model: ChatGroup, where: { schoolCode: schoolCodeOf(req), isActive: true } }],
      order: [[ChatGroup, 'updatedAt', 'DESC']]
    });

    const groups = [];
    for (const m of memberships) {
      const group = { ...m.ChatGroup.toJSON(), membershipRole: m.role, muted: m.muted };
      if (group.departmentId) {
        const dept = await Department.findByPk(group.departmentId, {
          include: [{ model: DepartmentMember, where: { role: 'head' }, required: false, include: [{ model: Teacher, include: [{ model: User, attributes: ['id','name','email','profileImage'] }] }] }]
        });
        group.departmentName = dept?.name || group.name;
        group.headName = dept?.DepartmentMembers?.[0]?.Teacher?.User?.name || 'Not assigned';
        group.headUserId = dept?.DepartmentMembers?.[0]?.Teacher?.User?.id || null;
      }
      groups.push(group);
    }
    res.json({ success: true, data: groups });
  } catch (error) {
    console.error('listTeacherGroups error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.createTeacherGroup = async (req, res) => {
  try {
    if (!canManageChatGroup(req)) return res.status(403).json({ success: false, message: 'Only teachers/admins can create groups' });
    const { name, description, type = 'project', memberUserIds = [] } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'Group name is required' });

    const group = await ChatGroup.create({ schoolCode: schoolCodeOf(req), name, description, type, createdBy: req.user.id });
    await ChatGroupMember.create({ groupId: group.id, userId: req.user.id, role: 'owner' });
    if (!(await ensureTeacherCanAddUsers(req, memberUserIds))) {
      return res.status(403).json({ success: false, message: 'Teachers can only add teachers and students from their assigned class/subject' });
    }
    for (const userId of memberUserIds) {
      const user = await User.findOne({ where: { id: userId, schoolCode: schoolCodeOf(req), isActive: true, role: { [Op.in]: ['teacher','student'] } } });
      if (user) await ChatGroupMember.findOrCreate({ where: { groupId: group.id, userId }, defaults: { role: user.role === 'teacher' ? 'member' : 'student' } });
    }
    res.status(201).json({ success: true, data: group });
  } catch (error) {
    console.error('createTeacherGroup error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

async function canStudentDirectMessage(req, otherUser) {
  if (!otherUser || req.user.role !== 'student') return false;
  if (otherUser.schoolCode !== schoolCodeOf(req)) return false;
  if (otherUser.role !== 'student') return false;
  if (Number(otherUser.id) === Number(req.user.id)) return false;

  const meStudent = await getStudentProfile(req.user.id);
  const otherStudent = await getStudentProfile(otherUser.id);
  if (!meStudent || !otherStudent) return false;

  if (meStudent.classId && otherStudent.classId && Number(meStudent.classId) === Number(otherStudent.classId)) return true;

  const meGrade = String(meStudent.grade || meStudent.className || req.user?.grade || req.user?.className || '').trim().toLowerCase();
  const otherGrade = String(otherStudent.grade || otherStudent.className || '').trim().toLowerCase();
  return Boolean(meGrade && otherGrade && meGrade === otherGrade);
}


async function parentLinkedClassIds(parentUserId, schoolCode) {
  const parent = await Parent.findOne({ where:{ userId:parentUserId } });
  if (!parent) return [];
  const links = await StudentParent.findAll({ where:{ parentId:parent.id }, attributes:['studentId'] });
  if (!links.length) return [];
  const students = await (Student.unscoped ? Student.unscoped() : Student).findAll({ where:{ id:{ [Op.in]:links.map(link=>link.studentId) }, status:'active' }, include:[{ model:User, where:{ schoolCode, role:'student', isActive:true }, attributes:['id'] }], attributes:['id','classId','grade'] });
  const ids = students.map(student=>Number(student.classId)).filter(Boolean);
  if (ids.length) return [...new Set(ids)];
  const grades = [...new Set(students.map(student=>String(student.grade||'').trim()).filter(Boolean))];
  if (!grades.length) return [];
  const classes = await Class.findAll({ where:{ schoolCode, isActive:true, [Op.or]:[{ name:{ [Op.in]:grades } }, { grade:{ [Op.in]:grades } }] }, attributes:['id'] });
  return [...new Set(classes.map(cls=>Number(cls.id)))];
}

async function classTeacherUserIdsForClasses(classIds, schoolCode) {
  if (!classIds.length) return [];
  const classes = await Class.findAll({ where:{ id:{ [Op.in]:classIds }, schoolCode, isActive:true }, attributes:['id','teacherId'] });
  const teacherIds = classes.map(cls=>Number(cls.teacherId)).filter(Boolean);
  const teachers = teacherIds.length ? await Teacher.findAll({ where:{ id:{ [Op.in]:teacherIds } }, attributes:['userId'] }) : [];
  return [...new Set(teachers.map(teacher=>Number(teacher.userId)).filter(Boolean))];
}

async function parentCanContactTeacher(parentUserId, teacherUserId, schoolCode) {
  const classIds = await parentLinkedClassIds(parentUserId, schoolCode);
  const teacherUserIds = await classTeacherUserIdsForClasses(classIds, schoolCode);
  return teacherUserIds.includes(Number(teacherUserId));
}

async function teacherCanContactParent(teacherUserId, parentUserId, schoolCode) {
  return parentCanContactTeacher(parentUserId, teacherUserId, schoolCode);
}

async function canDirectMessage(req, otherUser) {
  if (!otherUser || otherUser.schoolCode !== schoolCodeOf(req)) return false;
  if (Number(otherUser.id) === Number(req.user.id)) return false;

  // Official rollout safety rule:
  // No private 1:1 teacher <-> student messages.
  // Teacher-student interaction is allowed only in auditable group/class/study/homework spaces.
  if (req.user.role === 'teacher') {
    if (['teacher','admin'].includes(otherUser.role)) return true;
    if (otherUser.role === 'parent') return teacherCanContactParent(req.user.id, otherUser.id, schoolCodeOf(req));
    return false;
  }

  if (req.user.role === 'student') {
    if (otherUser.role !== 'student') return false;
    const meStudent = await getStudentProfile(req.user.id);
    const otherStudent = await getStudentProfile(otherUser.id);
    if (meStudent?.classId && otherStudent?.classId) return Number(meStudent.classId) === Number(otherStudent.classId);
    const mine = String(meStudent?.grade || meStudent?.className || '').trim().toLowerCase();
    const theirs = String(otherStudent?.grade || otherStudent?.className || '').trim().toLowerCase();
    return Boolean(mine && theirs && mine === theirs);
  }

  if (req.user.role === 'parent') {
    if (otherUser.role === 'admin') return true;
    if (otherUser.role === 'teacher') return parentCanContactTeacher(req.user.id, otherUser.id, schoolCodeOf(req));
    return false;
  }

  if (['admin', 'super_admin'].includes(req.user.role)) {
    return ['teacher', 'admin', 'parent'].includes(otherUser.role);
  }

  return false;
}

exports.getDirectMessages = async (req, res) => {
  try {
    const otherId = Number(req.params.userId);
    const other = await User.findOne({ where: { id: otherId, schoolCode: schoolCodeOf(req), isActive: true } });
    if (!(await canDirectMessage(req, other))) return res.status(404).json({ success: false, message: 'Contact not found or not allowed' });

    const messages = await ChatMessage.findAll({
      where: {
        schoolCode: schoolCodeOf(req),
        groupId: null,
        [Op.or]: [
          { senderId: req.user.id, receiverId: otherId },
          { senderId: otherId, receiverId: req.user.id }
        ]
      },
      include: [{ model: User, as: 'Sender', attributes: ['id','name','role','profileImage'] }],
      order: [['createdAt', 'ASC']],
      limit: 100
    });
    res.json({ success: true, data: messages.filter(m => chatMessageVisibleToUser(m, req.user.id)).map(m => presentChatMessage(m, req.user.id)) });
  } catch (error) {
    console.error('getDirectMessages error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.sendDirectMessage = async (req, res) => {
  try {
    const { receiverId, content, attachmentUrl, attachment, replyToMessageId, clientMessageId } = req.body;
    const cleanContent=String(content||'').trim();
    if (!receiverId || (!cleanContent && !attachmentUrl)) return res.status(400).json({ success:false, message:'receiverId and a message or attachment are required' });
    const other=await User.findOne({where:{id:Number(receiverId),schoolCode:schoolCodeOf(req),isActive:true}});
    if (!(await canDirectMessage(req,other))) return res.status(404).json({success:false,message:'Contact not found or not allowed'});
    const duplicate=await existingClientMessage(schoolCodeOf(req),req.user.id,clientMessageId);
    if(duplicate)return res.status(200).json({success:true,data:presentChatMessage(duplicate,req.user.id),reconciled:true});
    const key=directConversationKey(req.user.id,receiverId);
    const message=await ChatMessage.create({schoolCode:schoolCodeOf(req),senderId:req.user.id,receiverId:Number(receiverId),content:cleanContent||'Shared an attachment',attachmentUrl:attachmentUrl||null,messageType:attachmentUrl?'file':'text',clientMessageId:clientMessageId||null,conversationKey:key,deliveryStatus:'sent',metadata:{...(attachment?{attachmentName:attachment.name,attachmentType:attachment.mimeType,attachmentSize:attachment.size}:{}),replyTo:await buildReplyPreview(replyToMessageId,schoolCodeOf(req))}});
    const hydrated=await emitChatMessage('chat:message_created',message);
    res.status(201).json({success:true,data:presentChatMessage(hydrated,req.user.id)});
  } catch(error){
    console.error('sendDirectMessage error:',error);
    if(error.name==='SequelizeUniqueConstraintError'&&req.body?.clientMessageId){
      const duplicate=await existingClientMessage(schoolCodeOf(req),req.user.id,req.body.clientMessageId).catch(()=>null);
      if(duplicate)return res.status(200).json({success:true,data:presentChatMessage(duplicate,req.user.id),reconciled:true});
    }
    res.status(500).json({success:false,message:error.message});
  }
};

exports.getGroupMessages = async (req, res) => {
  try {
    const groupId = Number(req.params.groupId);
    const member = await ChatGroupMember.findOne({ where: { groupId, userId: req.user.id } });
    if (!member && !canManageSchool(req)) return res.status(403).json({ success: false, message: 'Not a group member' });

    const messages = await ChatMessage.findAll({
      where: { schoolCode: schoolCodeOf(req), groupId },
      include: [{ model: User, as: 'Sender', attributes: ['id','name','role','profileImage'] }],
      order: [['createdAt', 'ASC']],
      limit: 100
    });
    res.json({ success: true, data: messages.filter(m => chatMessageVisibleToUser(m, req.user.id)).map(m => presentChatMessage(m, req.user.id)) });
  } catch (error) {
    console.error('getGroupMessages error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.sendGroupMessage = async (req, res) => {
  try {
    const groupId=Number(req.params.groupId); const {content,attachmentUrl,attachment,replyToMessageId,clientMessageId}=req.body; const clean=String(content||'').trim();
    if(!clean&&!attachmentUrl)return res.status(400).json({success:false,message:'A message or attachment is required'});
    const group=await ChatGroup.findOne({where:{id:groupId,schoolCode:schoolCodeOf(req),isActive:true}}); if(!group)return res.status(404).json({success:false,message:'Group not found'});
    const member=await ChatGroupMember.findOne({where:{groupId,userId:req.user.id}}); if(!member&&!canManageSchool(req))return res.status(403).json({success:false,message:'Not a group member'});
    if(group.onlyAdminsCanSend&&!['owner','admin'].includes(member?.role)&&!canManageSchool(req))return res.status(403).json({success:false,message:'Only group admins can send messages'});
    const duplicate=await existingClientMessage(schoolCodeOf(req),req.user.id,clientMessageId); if(duplicate)return res.json({success:true,data:presentChatMessage(duplicate,req.user.id),reconciled:true});
    const key=realtime.groupConversationKey(groupId);
    const message=await ChatMessage.create({schoolCode:schoolCodeOf(req),senderId:req.user.id,groupId,content:clean||'Shared an attachment',attachmentUrl:attachmentUrl||null,messageType:attachmentUrl?'file':'text',clientMessageId:clientMessageId||null,conversationKey:key,deliveryStatus:'sent',metadata:{...(attachment?{attachmentName:attachment.name,attachmentType:attachment.mimeType,attachmentSize:attachment.size}:{}),replyTo:await buildReplyPreview(replyToMessageId,schoolCodeOf(req))}});
    const hydrated=await emitChatMessage('chat:message_created',message); res.status(201).json({success:true,data:presentChatMessage(hydrated,req.user.id)});
  }catch(error){
    console.error('sendGroupMessage error:',error);
    if(error.name==='SequelizeUniqueConstraintError'&&req.body?.clientMessageId){
      const duplicate=await existingClientMessage(schoolCodeOf(req),req.user.id,req.body.clientMessageId).catch(()=>null);
      if(duplicate)return res.status(200).json({success:true,data:presentChatMessage(duplicate,req.user.id),reconciled:true});
    }
    res.status(500).json({success:false,message:error.message});
  }
};

exports.listClassroomThreads = async (req, res) => {
  try {
    const where = { schoolCode: schoolCodeOf(req) };
    const studentCtx = req.user.role === 'student' ? await resolveStudentClassContext(req) : null;
    const student = studentCtx?.student || null;

    // Do not add where.classId for students here. Older study-room threads may have
    // null/wrong classId from the pre-classId versions, and filtering in SQL hides
    // previous group chats completely. Load school threads, then apply safe visibility below.
    let threads = await ClassroomThread.findAll({
      where,
      include: [
        { model: User, as: 'Creator', attributes: ['id','name','role','profileImage'] },
        { model: Class, attributes: ['id','name','grade','stream'] },
        { model: ThreadReply, include: [{ model: User, as: 'Author', attributes: ['id','name','role','profileImage'] }] }
      ],
      order: [['isPinned', 'DESC'], ['updatedAt', 'DESC']],
      limit: 80
    });

    if (req.user.role === 'teacher') {
      const visible = [];
      for (const t of threads) {
        if (await canTeacherViewStudyThread(req, t)) visible.push(t);
      }
      threads = visible;
    }

    if (req.user.role === 'student') {
      threads = threads.filter(t => {
        if (threadMatchesStudentContext(t, studentCtx || {})) return true;
        const meta = t.metadata || {};
        const approvalStatus = String(meta.approvalStatus || 'approved').toLowerCase();
        // Legacy rollout safeguard: keep old approved study-room threads visible
        // when classId was not saved correctly, instead of making the chat look empty.
        return approvalStatus === 'approved' && (!t.classId || !studentCtx?.classId || Number(t.classId) !== Number(studentCtx.classId));
      });
    }

    const meta = await buildStudyMeta(req, threads, student, studentCtx);
    const defaultClassId = studentCtx?.classId || student?.classId || null;
    const defaultClassName = studentCtx?.classRecord?.name || studentCtx?.grade || 'Class Study Group';

    const json = threads.map(t => {
      const row = t.toJSON();
      const effectiveClassId = row.classId || defaultClassId || 0;
      row.classId = effectiveClassId || row.classId || null;
      row.className = row.Class?.name || row.metadata?.className || defaultClassName;
      row.studentCount = row.metadata?.studentCount || undefined;
      const participants = meta.participantsByClass?.[Number(effectiveClassId)] || meta.participantsByClass?.[0] || [];
      row.participants = participants;
      row.studentCount = participants.length || row.studentCount || '—';
      row.ThreadReplies = (row.ThreadReplies || []).map(r => presentThreadReply(r, req.user.id)).filter(Boolean);
      row.replies = row.ThreadReplies;
      row.metadata = { ...(row.metadata || {}), participantsCount: participants.length, className: row.className, legacyClassResolved: !t.classId && Boolean(defaultClassId) };
      return row;
    });

    res.json({ success: true, data: json, meta });
  } catch (error) {
    console.error('listClassroomThreads error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.createClassroomThread = async (req, res) => {
  try {
    if (!['teacher','student','admin','super_admin'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Not allowed to create study threads' });
    const { classId, subject, topic, content, isPinned = false, metadata = {} } = req.body;
    if (!subject || !topic || !content) return res.status(400).json({ success: false, message: 'subject, topic and content are required' });

    const teacher = req.user.role === 'teacher' ? await getTeacherProfile(req.user.id) : null;
    const student = req.user.role === 'student' ? await getStudentProfile(req.user.id) : null;
    const approvalStatus = req.user.role === 'student' ? 'pending' : (metadata.approvalStatus || 'approved');
    let targetClassId = classId || student?.classId || null;
    if (!targetClassId && req.user.role === 'teacher') {
      const allowedClassIds = await getTeacherAllowedClassIds(req.user.id);
      targetClassId = allowedClassIds[0] || null;
    }
    const thread = await ClassroomThread.create({
      schoolCode: schoolCodeOf(req),
      classId: targetClassId,
      subject,
      topic,
      content,
      teacherId: teacher?.id || null,
      createdBy: req.user.id,
      isPinned: req.user.role === 'student' ? false : Boolean(isPinned),
      metadata: { ...(metadata || {}), approvalRequired: true, approvalStatus, createdByRole: req.user.role }
    });
    res.status(201).json({ success: true, data: thread });
  } catch (error) {
    console.error('createClassroomThread error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateClassroomThread = async (req, res) => {
  try {
    if (!['teacher','admin','super_admin'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Only teachers/admins can update study threads' });
    const threadId = Number(req.params.threadId);
    const thread = await ClassroomThread.findOne({ where: { id: threadId, schoolCode: schoolCodeOf(req) } });
    if (!thread) return res.status(404).json({ success: false, message: 'Thread not found' });
    if (req.user.role === 'teacher' && !(await canTeacherModerateThread(req, thread))) {
      return res.status(403).json({ success: false, message: 'Teachers can only moderate study threads they created or official class-study threads for their own class' });
    }

    const { approvalStatus, isClosed, isPinned, topic, subject, content, metadata = {} } = req.body || {};
    if (topic !== undefined) thread.topic = topic;
    if (subject !== undefined) thread.subject = subject;
    if (content !== undefined) thread.content = content;
    if (isClosed !== undefined) thread.isClosed = Boolean(isClosed);
    if (isPinned !== undefined) thread.isPinned = Boolean(isPinned);
    thread.metadata = { ...(thread.metadata || {}), ...(metadata || {}) };
    if (approvalStatus) thread.metadata = { ...(thread.metadata || {}), approvalStatus };
    await thread.save();
    res.json({ success: true, data: thread });
  } catch (error) {
    console.error('updateClassroomThread error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.replyToThread = async (req,res)=>{
  try{
    const threadId=Number(req.params.threadId); const {content,parentReplyId,attachmentUrl,attachment,clientMessageId}=req.body; const clean=String(content||'').trim();
    if(!clean&&!attachmentUrl)return res.status(400).json({success:false,message:'A reply or attachment is required'});
    const thread=await ClassroomThread.findOne({where:{id:threadId,schoolCode:schoolCodeOf(req),isClosed:false}}); if(!thread)return res.status(404).json({success:false,message:'Thread not found'});
    if(!(await ensureUserMayUseThread(req,thread)))return res.status(403).json({success:false,message:'Not allowed in this study room'});
    if(clientMessageId){const old=await ThreadReply.findOne({where:{threadId,userId:req.user.id,clientMessageId},include:[{model:User,as:'Author',attributes:['id','name','role','profileImage']}]});if(old)return res.json({success:true,data:old,reconciled:true});}
    const reply=await ThreadReply.create({threadId,userId:req.user.id,parentReplyId:parentReplyId||null,content:clean||'Shared an attachment',clientMessageId:clientMessageId||null,metadata:{...(attachmentUrl?{attachmentUrl,attachmentName:attachment?.name,attachmentType:attachment?.mimeType,attachmentSize:attachment?.size}:{}),replyTo:await buildThreadReplyPreview(parentReplyId)}});
    await thread.update({updatedAt:new Date()},{silent:false});
    const hydrated=await ThreadReply.findByPk(reply.id,{include:[{model:User,as:'Author',attributes:['id','name','role','profileImage']}]});
    await emitThreadEvent('chat:message_created',thread,hydrated||reply); res.status(201).json({success:true,data:hydrated||reply});
  }catch(error){
    console.error('replyToThread error:',error);
    if(error.name==='SequelizeUniqueConstraintError'&&req.body?.clientMessageId){
      const duplicate=await ThreadReply.findOne({where:{threadId:Number(req.params.threadId),userId:req.user.id,clientMessageId:req.body.clientMessageId},include:[{model:User,as:'Author',attributes:['id','name','role','profileImage']}]}).catch(()=>null);
      if(duplicate)return res.status(200).json({success:true,data:duplicate,reconciled:true});
    }
    res.status(500).json({success:false,message:error.message});
  }
};

async function awardToUser({ req, recipientUserId, sourceType, sourceId, points, streakDelta, note }) {
  const recipient = await User.findOne({ where: { id: recipientUserId, schoolCode: schoolCodeOf(req) } });
  if (!recipient) throw new Error('Recipient not found');
  const student = recipient.role === 'student' ? await Student.findOne({ where: { userId: recipient.id } }) : null;
  if (!student) {
    const error = new Error('Stars and streaks can only be awarded to students. Use emoji reactions for teachers.');
    error.statusCode = 400;
    throw error;
  }

  return AchievementEvent.create({
    schoolCode: schoolCodeOf(req),
    studentId: student?.id || null,
    userId: recipient.id,
    awardedBy: req.user.id,
    sourceType,
    sourceId,
    points: Number(points || 0),
    streakDelta: Number(streakDelta || 0),
    title: points > 0 ? 'Star Points Awarded' : 'Streak Awarded',
    note: note || null
  });
}

exports.awardThreadReply = async (req, res) => {
  try {
    if (!['teacher','admin','super_admin'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Only teachers/admins can award points' });
    const reply = await ThreadReply.findByPk(req.params.replyId);
    if (!reply) return res.status(404).json({ success: false, message: 'Reply not found' });
    const thread = await ClassroomThread.findOne({ where: { id: reply.threadId, schoolCode: schoolCodeOf(req) } });
    if (!thread) return res.status(404).json({ success: false, message: 'Reply not found in this school' });
    const { points = 0, streakDelta = 0, note } = req.body;

    reply.pointsAwarded = (reply.pointsAwarded || 0) + Number(points || 0);
    reply.streakAwarded = (reply.streakAwarded || 0) + Number(streakDelta || 0);
    await reply.save();

    const event = await awardToUser({ req, recipientUserId: reply.userId, sourceType: 'thread_reply', sourceId: reply.id, points, streakDelta, note });
    res.json({ success: true, data: { reply, achievement: event } });
  } catch (error) {
    console.error('awardThreadReply error:', error);
    res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

exports.awardChatMessage = async (req, res) => {
  try {
    if (!['teacher','admin','super_admin'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Only teachers/admins can award points' });
    const message = await ChatMessage.findOne({ where: { id: Number(req.params.messageId), schoolCode: schoolCodeOf(req) } });
    if (!message) return res.status(404).json({ success: false, message: 'Message not found in this school' });
    const { points = 0, streakDelta = 0, note } = req.body;

    message.pointsAwarded = (message.pointsAwarded || 0) + Number(points || 0);
    message.streakAwarded = (message.streakAwarded || 0) + Number(streakDelta || 0);
    await message.save();

    const event = await awardToUser({ req, recipientUserId: message.senderId, sourceType: 'chat_message', sourceId: message.id, points, streakDelta, note });
    res.json({ success: true, data: { message, achievement: event } });
  } catch (error) {
    console.error('awardChatMessage error:', error);
    res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

exports.reactToMessage = async (req, res) => {
  try {
    if (!['teacher','admin','super_admin'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Only staff can react to messages' });
    const message = await ChatMessage.findOne({ where: { id: req.params.messageId, schoolCode: schoolCodeOf(req) }, include: [{ model: User, as: 'Sender', attributes: ['id','name','role','profileImage','profilePicture'] }] });
    if (!message) return res.status(404).json({ success: false, message: 'Message not found' });
    const emoji = String(req.body?.emoji || '👍').slice(0, 8);
    const metadata = message.metadata || {};
    const reactions = metadata.reactions || {};
    const list = Array.isArray(reactions[emoji]) ? reactions[emoji] : [];
    const uid = Number(req.user.id);
    reactions[emoji] = list.includes(uid) ? list.filter(id => Number(id) !== uid) : [...list, uid];
    message.metadata = { ...metadata, reactions };
    await message.save();
    res.json({ success: true, data: message });
  } catch (error) {
    console.error('reactToMessage error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.listGroupMembers = async (req, res) => {
  try {
    const groupId = Number(req.params.groupId);
    const member = await ChatGroupMember.findOne({ where: { groupId, userId: req.user.id } });
    if (!member && !canManageSchool(req)) return res.status(403).json({ success: false, message: 'Not a group member' });
    const members = await ChatGroupMember.findAll({ where: { groupId }, include: [{ model: User, attributes: ['id','name','email','role','profileImage'] }], order: [['role','ASC'], ['createdAt','ASC']] });
    res.json({ success: true, data: members });
  } catch (error) {
    console.error('listGroupMembers error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.listAvailableMembers = async (req, res) => {
  try {
    const where = { schoolCode: schoolCodeOf(req), isActive: true, role: { [Op.in]: ['teacher','student'] } };
    let users = await User.findAll({ where, attributes: ['id','name','email','role','profileImage'], include: [{ model: Student, required: false, attributes: ['id','classId','grade'] }, { model: Teacher, required: false, attributes: ['id','classId','subjects'] }], order: [['role','ASC'], ['name','ASC']] });

    if (req.user.role === 'student') {
      const ctx = await resolveStudentClassContext(req);
      users = users.filter(u => {
        if (Number(u.id) === Number(req.user.id)) return false;
        if (u.role !== 'student') return false;
        if (ctx.classId && u.Student?.classId) return Number(u.Student.classId) === Number(ctx.classId);
        const myGrade = String(ctx.grade || '').trim().toLowerCase();
        const otherGrade = String(u.Student?.grade || '').trim().toLowerCase();
        return Boolean(myGrade && otherGrade && myGrade === otherGrade);
      });
    }

    if (req.user.role === 'teacher' && !canManageSchool(req)) {
      const allowedClassIds = await getTeacherAllowedClassIds(req.user.id);
      users = users.filter(u => {
        if (Number(u.id) === Number(req.user.id)) return true;
        if (u.role === 'teacher') return true;
        const classId = u.Student?.classId;
        return Boolean(classId && allowedClassIds.includes(Number(classId)));
      });
    }

    const classIds = [...new Set(users.map(u => u.Student?.classId || u.Teacher?.classId).filter(Boolean).map(Number))];
    const classes = classIds.length ? await Class.findAll({ where: { id: { [Op.in]: classIds }, schoolCode: schoolCodeOf(req) }, attributes: ['id','name','grade','stream'] }) : [];
    const classMap = new Map(classes.map(c => [Number(c.id), c]));

    res.json({ success: true, data: users.map(u => {
      const row = u.toJSON();
      const classId = row.Student?.classId || row.Teacher?.classId || null;
      const c = classId ? classMap.get(Number(classId)) : null;
      row.classId = classId;
      row.className = c?.name || c?.grade || row.Student?.grade || '';
      delete row.Student;
      delete row.Teacher;
      return row;
    }) });
  } catch (error) {
    console.error('listAvailableMembers error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateGroupMembers = async (req, res) => {
  try {
    const groupId = Number(req.params.groupId);
    const group = await ChatGroup.findOne({ where: { id: groupId, schoolCode: schoolCodeOf(req), isActive: true } });
    if (!group) return res.status(404).json({ success: false, message: 'Group not found' });
    const manager = await ensureChatGroupManager(req, groupId);
    if (!manager) return res.status(403).json({ success: false, message: 'Only teacher/admin group managers can manage members' });
    const memberUserIds = Array.isArray(req.body?.memberUserIds) ? req.body.memberUserIds.map(Number).filter(Boolean) : [];
    const keep = new Set([Number(group.createdBy), Number(req.user.id), ...memberUserIds]);
    if (!(await ensureTeacherCanAddUsers(req, [...keep]))) {
      return res.status(403).json({ success: false, message: 'Teachers can only manage teachers and students from their assigned class/subject' });
    }
    const users = await User.findAll({ where: { id: { [Op.in]: [...keep] }, schoolCode: schoolCodeOf(req), isActive: true, role: { [Op.in]: ['teacher','student'] } }, attributes: ['id','role'] });
    await ChatGroupMember.destroy({ where: { groupId, userId: { [Op.notIn]: users.map(u => u.id) } } });
    for (const u of users) {
      await ChatGroupMember.findOrCreate({ where: { groupId, userId: u.id }, defaults: { role: u.id === group.createdBy ? 'owner' : u.role } });
    }
    const members = await ChatGroupMember.findAll({ where: { groupId }, include: [{ model: User, attributes: ['id','name','email','role','profileImage'] }] });
    res.json({ success: true, data: members });
  } catch (error) {
    console.error('updateGroupMembers error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};



exports.editChatMessage = async (req,res)=>{
  try{const message=await ChatMessage.findOne({where:{id:Number(req.params.messageId),schoolCode:schoolCodeOf(req)}});if(!message)return res.status(404).json({success:false,message:'Message not found'});if(!canEditOrDeleteOwn(req.user,message.senderId))return res.status(403).json({success:false,message:'You can only edit your own message'});const content=String(req.body?.content||'').trim();if(!content)return res.status(400).json({success:false,message:'content is required'});const metadata=message.metadata||{};if(metadata.deletedForEveryone)return res.status(400).json({success:false,message:'Deleted messages cannot be edited'});const previousContent=message.content;await message.update({content,version:Number(message.version||1)+1,metadata:{...metadata,edited:true,editedAt:new Date().toISOString(),editHistory:[...(Array.isArray(metadata.editHistory)?metadata.editHistory:[]),{content:previousContent,editedAt:new Date().toISOString(),editedBy:req.user.id}].slice(-10)}});const hydrated=await emitChatMessage('chat:message_edited',message);res.json({success:true,data:presentChatMessage(hydrated,req.user.id)});}catch(error){console.error('editChatMessage error:',error);res.status(500).json({success:false,message:error.message});}
};

exports.deleteChatMessage = async (req,res)=>{
  try{const message=await ChatMessage.findOne({where:{id:Number(req.params.messageId),schoolCode:schoolCodeOf(req)}});if(!message)return res.status(404).json({success:false,message:'Message not found'});const mode=String(req.body?.mode||'me').toLowerCase();const metadata=message.metadata||{};if(mode==='everyone'){if(!canDeleteForEveryone(req.user,message.senderId))return res.status(403).json({success:false,message:'You can only delete your own message for everyone'});message.content='This message was deleted';message.attachmentUrl=null;message.messageType='deleted';message.metadata={...metadata,deletedForEveryone:true,deletedBy:req.user.id,deletedAt:new Date().toISOString(),attachmentName:null,attachmentType:null,attachmentSize:null};}else{const deletedFor=new Set([...(Array.isArray(metadata.deletedFor)?metadata.deletedFor:[]),req.user.id].map(Number));message.metadata={...metadata,deletedFor:[...deletedFor],deletedForMeAt:new Date().toISOString()};}message.version=Number(message.version||1)+1;await message.save();await emitChatMessage('chat:message_deleted',message,{mode,deletedBy:req.user.id});res.json({success:true,data:mode==='me'?null:presentChatMessage(message,req.user.id),mode,messageId:message.id});}catch(error){console.error('deleteChatMessage error:',error);res.status(500).json({success:false,message:error.message});}
};

exports.editThreadReply = async (req,res)=>{
  try{const reply=await ThreadReply.findByPk(Number(req.params.replyId),{include:[{model:User,as:'Author',attributes:['id','name','role','profileImage']}]});if(!reply)return res.status(404).json({success:false,message:'Reply not found'});const thread=await ClassroomThread.findOne({where:{id:reply.threadId,schoolCode:schoolCodeOf(req)}});if(!thread)return res.status(404).json({success:false,message:'Thread not found'});if(!canEditOrDeleteOwn(req.user,reply.userId))return res.status(403).json({success:false,message:'You can only edit your own reply'});const content=String(req.body?.content||'').trim();if(!content)return res.status(400).json({success:false,message:'content is required'});const metadata=reply.metadata||{};if(metadata.deletedForEveryone)return res.status(400).json({success:false,message:'Deleted replies cannot be edited'});await reply.update({content,version:Number(reply.version||1)+1,metadata:{...metadata,edited:true,editedAt:new Date().toISOString()}});await emitThreadEvent('chat:message_edited',thread,reply);res.json({success:true,data:presentThreadReply(reply,req.user.id)});}catch(error){console.error('editThreadReply error:',error);res.status(500).json({success:false,message:error.message});}
};

exports.deleteThreadReply = async (req,res)=>{
  try{const reply=await ThreadReply.findByPk(Number(req.params.replyId),{include:[{model:User,as:'Author',attributes:['id','name','role','profileImage']}]});if(!reply)return res.status(404).json({success:false,message:'Reply not found'});const thread=await ClassroomThread.findOne({where:{id:reply.threadId,schoolCode:schoolCodeOf(req)}});if(!thread)return res.status(404).json({success:false,message:'Thread not found'});const mode=String(req.body?.mode||'me').toLowerCase();const metadata=reply.metadata||{};if(mode==='everyone'){if(!canDeleteForEveryone(req.user,reply.userId))return res.status(403).json({success:false,message:'You can only delete your own reply for everyone'});reply.content='This reply was deleted';reply.metadata={...metadata,attachmentUrl:null,attachmentName:null,attachmentType:null,attachmentSize:null,deletedForEveryone:true,deletedBy:req.user.id,deletedAt:new Date().toISOString()};}else{const deletedFor=new Set([...(Array.isArray(metadata.deletedFor)?metadata.deletedFor:[]),req.user.id].map(Number));reply.metadata={...metadata,deletedFor:[...deletedFor],deletedForMeAt:new Date().toISOString()};}reply.version=Number(reply.version||1)+1;await reply.save();await emitThreadEvent('chat:message_deleted',thread,reply,{mode,deletedBy:req.user.id});res.json({success:true,data:mode==='me'?null:presentThreadReply(reply,req.user.id),mode,replyId:reply.id,threadId:reply.threadId});}catch(error){console.error('deleteThreadReply error:',error);res.status(500).json({success:false,message:error.message});}
};

exports.pinThreadReply = async (req,res)=>{
  try{if(!['teacher','admin','super_admin'].includes(req.user.role))return res.status(403).json({success:false,message:'Only teachers/admins can pin replies'});const reply=await ThreadReply.findByPk(req.params.replyId,{include:[{model:User,as:'Author',attributes:['id','name','role','profileImage']}]});if(!reply)return res.status(404).json({success:false,message:'Reply not found'});const thread=await ClassroomThread.findOne({where:{id:reply.threadId,schoolCode:schoolCodeOf(req)}});if(!thread)return res.status(404).json({success:false,message:'Thread not found'});if(req.user.role==='teacher'&&!(await canTeacherModerateThread(req,thread)))return res.status(403).json({success:false,message:'Only the thread teacher or assigned class teacher can pin replies'});const metadata=reply.metadata||{};const isPinned=req.body?.isPinned===undefined?!metadata.isPinned:Boolean(req.body.isPinned);await reply.update({version:Number(reply.version||1)+1,metadata:{...metadata,isPinned,pinnedBy:req.user.id,pinnedAt:new Date().toISOString()}});await emitThreadEvent(isPinned?'chat:message_pinned':'chat:message_unpinned',thread,reply);res.json({success:true,data:reply});}catch(error){console.error('pinThreadReply error:',error);res.status(500).json({success:false,message:error.message});}
};

exports.uploadAttachment = async (req, res) => {
  try {
    let file = req.file || null;
    if (!file && req.files) {
      file = req.files.file || req.files.attachment || req.files.upload || null;
      if (Array.isArray(file)) file = file[0];
    }
    if (Array.isArray(req.files) && req.files.length) file = req.files[0];
    if (!file) return res.status(400).json({ success: false, message: 'No file uploaded' });

    const originalName = file.originalname || file.name || file.filename || 'attachment';
    const saved = await saveUploadAsset({
      file,
      schoolCode: schoolCodeOf(req),
      ownerUserId: req.user.id,
      kind: 'chat_attachment',
      maxBytes: Number(process.env.CHAT_ATTACHMENT_MAX_BYTES || 25 * 1024 * 1024),
      allowAnyMime: true,
      deactivatePrevious: false,
      metadata: { uploadedBy: req.user.id, role: req.user.role, module: 'chat' }
    });

    const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
    const safeProto = req.get('host')?.includes('onrender.com') ? 'https' : proto;
    const absoluteUrl = /^https?:\/\//i.test(saved.url) ? saved.url : `${safeProto}://${req.get('host')}${saved.url}`;
    res.status(201).json({ success: true, data: {
      url: saved.url,
      secureUrl: absoluteUrl,
      name: originalName,
      mimeType: saved.mimeType || file.mimetype || file.type || 'application/octet-stream',
      size: saved.byteSize || file.size || 0,
      storageProvider: saved.storageProvider,
      durable: true
    } });
  } catch (error) {
    console.error('uploadAttachment error:', error);
    res.status(error.status || 500).json({ success: false, message: error.message || 'Attachment upload failed' });
  }
};
exports.myAchievements = async (req, res) => {
  try {
    const events = await AchievementEvent.findAll({
      where: { schoolCode: schoolCodeOf(req), userId: req.user.id },
      order: [['createdAt', 'DESC']],
      limit: 50
    });
    const totals = events.reduce((acc, e) => {
      acc.points += e.points || 0;
      acc.streak += e.streakDelta || 0;
      return acc;
    }, { points: 0, streak: 0 });
    res.json({ success: true, data: { totals, events } });
  } catch (error) {
    console.error('myAchievements error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};


exports.updateDepartment = async (req, res) => {
  try {
    if (!canManageSchool(req)) return res.status(403).json({ success: false, message: 'Only admin can update departments' });
    const departmentId = Number(req.params.departmentId);
    const { name, description, headTeacherId = null, teacherIds = [] } = req.body;

    const department = await Department.findOne({ where: { id: departmentId, schoolCode: schoolCodeOf(req) } });
    if (!department) return res.status(404).json({ success: false, message: 'Department not found' });

    if (name) department.name = name;
    if (description !== undefined) department.description = description;

    let validTeachers = [];
    if (Array.isArray(teacherIds)) {
      const requestedTeacherIds = [...new Set(teacherIds.map(Number).filter(Boolean))];
      for (const teacherId of requestedTeacherIds) {
        const teacher = await findTeacherInCurrentSchool(req, teacherId);
        if (teacher) validTeachers.push(teacher);
      }
      const validIds = new Set(validTeachers.map(t => Number(t.id)));
      department.headTeacherId = validIds.has(Number(headTeacherId)) ? Number(headTeacherId) : (validTeachers[0]?.id || null);
    } else {
      department.headTeacherId = null;
    }
    await department.save();

    if (Array.isArray(teacherIds)) {
      await DepartmentMember.destroy({ where: { departmentId } });
      const group = await ChatGroup.findOne({ where: { departmentId: department.id, schoolCode: schoolCodeOf(req), type: 'department' } });

      if (group) {
        group.name = `${department.name} Department`;
        group.description = department.description || `${department.name} department group`;
        await group.save();
        await ChatGroupMember.destroy({ where: { groupId: group.id } });
      }

      for (const teacher of validTeachers) {
        const isHead = Number(teacher.id) === Number(department.headTeacherId);
        await DepartmentMember.create({ departmentId, teacherId: teacher.id, role: isHead ? 'head' : 'member' });
        if (group) await ChatGroupMember.create({ groupId: group.id, userId: teacher.userId, role: isHead ? 'admin' : 'member' });
      }
    }

    res.json({ success: true, data: department });
  } catch (error) {
    console.error('updateDepartment error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.deleteDepartment = async (req, res) => {
  try {
    if (!canManageSchool(req)) return res.status(403).json({ success: false, message: 'Only admin can delete departments' });
    const departmentId = Number(req.params.departmentId);
    const department = await Department.findOne({ where: { id: departmentId, schoolCode: schoolCodeOf(req) } });
    if (!department) return res.status(404).json({ success: false, message: 'Department not found' });
    department.isActive = false;
    await department.save();

    await ChatGroup.update({ isActive: false }, { where: { departmentId: department.id, type: 'department' } });
    res.json({ success: true, message: 'Department archived' });
  } catch (error) {
    console.error('deleteDepartment error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};


exports.getDepartmentGroup = async (req, res) => {
  try {
    if (!canManageSchool(req)) return res.status(403).json({ success: false, message: 'Only admin can view department groups' });
    const departmentId = Number(req.params.departmentId);
    const department = await Department.findOne({ where: { id: departmentId, schoolCode: schoolCodeOf(req), isActive: true } });
    if (!department) return res.status(404).json({ success: false, message: 'Department not found' });

    const group = await ChatGroup.findOne({ where: { departmentId, schoolCode: schoolCodeOf(req), type: 'department', isActive: true } });
    if (!group) return res.status(404).json({ success: false, message: 'Department group chat not found' });

    const messages = await ChatMessage.findAll({
      where: { schoolCode: schoolCodeOf(req), groupId: group.id },
      include: [{ model: User, as: 'Sender', attributes: ['id','name','role','profileImage'] }],
      order: [['createdAt', 'ASC']],
      limit: 150
    });

    const members = await ChatGroupMember.findAll({
      where: { groupId: group.id },
      include: [{ model: User, attributes: ['id','name','role','profileImage','email'] }]
    });

    const head = await DepartmentMember.findOne({
      where: { departmentId, role: 'head' },
      include: [{ model: Teacher, include: [{ model: User, attributes: ['id','name','email','profileImage'] }] }]
    });

    res.json({ success: true, data: { department, group: { ...group.toJSON(), headName: head?.Teacher?.User?.name || 'Not assigned' }, members, messages } });
  } catch (error) {
    console.error('getDepartmentGroup error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};


exports.getStudentDirectMessages = async (req, res) => {
  try {
    if (req.user.role !== 'student') {
      return res.status(403).json({ success: false, message: 'Student private chat is only for students' });
    }
    const otherId = Number(req.params.userId);
    const other = await User.findOne({ where: { id: otherId, schoolCode: schoolCodeOf(req), isActive: true, role: 'student' } });
    if (!(await canStudentDirectMessage(req, other))) {
      return res.status(404).json({ success: false, message: 'Classmate not found or not allowed' });
    }

    const messages = await ChatMessage.findAll({
      where: {
        schoolCode: schoolCodeOf(req),
        groupId: null,
        [Op.or]: [
          { senderId: req.user.id, receiverId: otherId },
          { senderId: otherId, receiverId: req.user.id }
        ]
      },
      include: [{ model: User, as: 'Sender', attributes: ['id','name','role','profileImage'] }],
      order: [['createdAt', 'ASC']],
      limit: 100
    });
    res.json({ success: true, data: messages.filter(m => chatMessageVisibleToUser(m, req.user.id)).map(m => presentChatMessage(m, req.user.id)) });
  } catch (error) {
    console.error('getStudentDirectMessages error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.sendStudentDirectMessage = async (req,res)=>{
  try{if(req.user.role!=='student')return res.status(403).json({success:false,message:'Student private chat is only for students'});const {receiverId,content,attachmentUrl,attachment,replyToMessageId,clientMessageId}=req.body;const clean=String(content||'').trim();if(!receiverId||(!clean&&!attachmentUrl))return res.status(400).json({success:false,message:'receiverId and a message or attachment are required'});const other=await User.findOne({where:{id:Number(receiverId),schoolCode:schoolCodeOf(req),isActive:true,role:'student'}});if(!(await canStudentDirectMessage(req,other)))return res.status(404).json({success:false,message:'Classmate not found or not allowed'});const duplicate=await existingClientMessage(schoolCodeOf(req),req.user.id,clientMessageId);if(duplicate)return res.json({success:true,data:presentChatMessage(duplicate,req.user.id),reconciled:true});const key=directConversationKey(req.user.id,receiverId);const message=await ChatMessage.create({schoolCode:schoolCodeOf(req),senderId:req.user.id,receiverId:Number(receiverId),content:clean||'Shared an attachment',attachmentUrl:attachmentUrl||null,messageType:attachmentUrl?'file':'text',clientMessageId:clientMessageId||null,conversationKey:key,deliveryStatus:'sent',metadata:{...(attachment?{attachmentName:attachment.name,attachmentType:attachment.mimeType,attachmentSize:attachment.size}:{}),replyTo:await buildReplyPreview(replyToMessageId,schoolCodeOf(req))}});const hydrated=await emitChatMessage('chat:message_created',message);res.status(201).json({success:true,data:presentChatMessage(hydrated,req.user.id)});}catch(error){console.error('sendStudentDirectMessage error:',error);res.status(error.name==='SequelizeUniqueConstraintError'?409:500).json({success:false,message:error.message});}
};


exports.toggleHelpfulThreadReply = async (req, res) => {
  const sequelize = ThreadReply.sequelize;
  try {
    const replyId = Number(req.params.replyId);
    if (!replyId) return res.status(400).json({ success: false, message: 'Invalid reply id' });
    const result = await sequelize.transaction(async transaction => {
      const reply = await ThreadReply.findByPk(replyId, { transaction, lock: transaction.LOCK.UPDATE });
      if (!reply) return { status: 404, body: { success: false, message: 'Reply not found' } };
      const thread = await ClassroomThread.findOne({ where: { id: reply.threadId, schoolCode: schoolCodeOf(req) }, transaction });
      if (!thread) return { status: 404, body: { success: false, message: 'Thread not found' } };
      if (Number(reply.userId) === Number(req.user.id)) {
        return { status: 400, body: { success: false, message: 'You cannot mark your own reply as helpful' } };
      }
      const metadata = reply.metadata || {};
      const helpfulBy = new Set((Array.isArray(metadata.helpfulBy) ? metadata.helpfulBy : []).map(Number).filter(Boolean));
      const uid = Number(req.user.id);
      let helpful;
      if (helpfulBy.has(uid)) { helpfulBy.delete(uid); helpful = false; }
      else { helpfulBy.add(uid); helpful = true; }
      reply.helpfulCount = helpfulBy.size;
      reply.metadata = { ...metadata, helpfulBy: [...helpfulBy], helpfulUpdatedAt: new Date().toISOString() };
      await reply.save({ transaction });
      return { status: 200, body: { success: true, data: { replyId: reply.id, helpful, helpfulCount: reply.helpfulCount } } };
    });
    return res.status(result.status).json(result.body);
  } catch (error) {
    console.error('toggleHelpfulThreadReply error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};
