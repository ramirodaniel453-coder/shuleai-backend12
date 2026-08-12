const { Parent, Teacher, User, Message, Student, Class, sequelize } = require('../models');
const { Op } = require('sequelize');
const { createAlert } = require('../services/notificationService');
const ownership = require('../services/parentOwnershipService');
const realtime = require('../services/realtimeService');
const { getCursorPagination, buildCursorResponse } = require('../utils/pagination');

function meta(message) {
  const raw = message?.toJSON ? message.toJSON() : (message || {});
  return raw.metadata || {};
}

function schoolMatches(message, schoolCode) {
  const m = meta(message);
  return !m.schoolCode || String(m.schoolCode) === String(schoolCode);
}

async function getParentProfile(userId) {
  return Parent.findOne({ where: { userId } });
}

function normalizePhone(value) { return String(value || '').replace(/\D/g, '').replace(/^0/, '254'); }

async function healParentStudentLink(parent, student) {
  if (!parent?.id || !student?.id) return;
  await sequelize.query(`
    INSERT INTO "StudentParents" ("studentId", "parentId", "createdAt", "updatedAt")
    VALUES (:studentId, :parentId, NOW(), NOW())
    ON CONFLICT ("studentId", "parentId") DO UPDATE SET "updatedAt" = EXCLUDED."updatedAt"`,
    { replacements: { studentId: student.id, parentId: parent.id }, type: sequelize.QueryTypes.INSERT }
  ).catch(() => null);
}


async function verifyParentChild(parent, student, user = null) {
  try {
    if (!parent || !student || !user) return false;
    return await ownership.ownsStudentId({
      parentUserId: user.id || parent.userId,
      parentId: parent.id,
      studentId: student.id
    });
  } catch (_) { return false; }
}

async function findStudentForParent({ parent, studentId, schoolCode, user }) {
  const rawId = Number(studentId) || 0;
  const student = await Student.findOne({
    where: { [Op.or]: [{ id: rawId }, { userId: rawId }] },
    include: [{ model: User, attributes:['id','name','email','profileImage','profilePicture','schoolCode'] }]
  });
  if (!student) return null;
  const ok = await verifyParentChild(parent, student, user || {});
  return ok ? student : null;
}

async function findClassTeacherForStudent(student, schoolCode) {
  // Strict linkage only: parent -> own child -> child.classId -> class teacher.
  // No grade/name fallback is allowed because it can route messages to the wrong teacher.
  const classId = Number(student?.classId || 0);
  if (!classId) return null;
  const rows = await sequelize.query(
    `SELECT t."id" AS "teacherId", u."id" AS "userId", u."name", u."email", c."id" AS "classId", c."name" AS "className", c."grade"
       FROM "Classes" c
       LEFT JOIN "TeacherSubjectAssignments" tsa ON tsa."classId" = c."id" AND COALESCE(tsa."isClassTeacher", false) = true
       JOIN "Teachers" t ON (t."id" = c."teacherId" OR t."classId" = c."id" OR t."id" = tsa."teacherId")
       JOIN "Users" u ON u."id" = t."userId"
      WHERE c."schoolCode" = :schoolCode
        AND c."id" = :classId
        AND COALESCE(c."isActive", true) = true
        AND u."schoolCode" = :schoolCode
        AND u."role" = 'teacher'
        AND COALESCE(u."isActive", true) = true
      ORDER BY CASE WHEN t."id" = c."teacherId" THEN 0 WHEN t."id" = tsa."teacherId" THEN 1 ELSE 2 END
      LIMIT 1`,
    { replacements: { schoolCode, classId }, type: sequelize.QueryTypes.SELECT }
  ).catch(() => []);
  return rows[0] || null;
}

async function findSchoolAdmin(schoolCode) {
  return User.findOne({ where: { role: 'admin', schoolCode, isActive: true }, order: [['createdAt', 'ASC']] });
}

function buildConversationKey({ type, schoolCode, parentUserId, studentId, classId, receiverId }) {
  // Canonical parent messaging conversation key. It is intentionally tied to the
  // actual child + actual resolved recipient so a parent cannot message a random teacher.
  return [type || 'parent_message', schoolCode || 'school', studentId || 'student', parentUserId || 'parent', receiverId || 'receiver'].join(':');
}

function classTeacherPayload(row) {
  if (!row?.userId) return { available: false, reason: 'This child’s class does not have an assigned class teacher yet.' };
  return {
    available: true,
    teacherUserId: Number(row.userId),
    userId: Number(row.userId),
    teacherId: row.teacherId ? Number(row.teacherId) : null,
    name: row.name || 'Class Teacher',
    email: row.email || null,
    classId: row.classId ? Number(row.classId) : null,
    className: row.className || row.grade || 'Class',
    relationship: 'class_teacher_of_child'
  };
}


exports.getMessageTargets = async (req, res) => {
  try {
    const studentId = req.query.studentId || req.query.childId;
    if (!studentId) return res.status(400).json({ success: false, message: 'studentId is required' });
    const parent = await getParentProfile(req.user.id);
    if (!parent) return res.status(404).json({ success: false, message: 'Parent profile not found' });
    const student = await findStudentForParent({ parent, studentId, user: req.user });
    if (!student) return res.status(403).json({ success: false, message: 'This child is not linked to your parent account.' });
    const schoolCode = student.User?.schoolCode;
    const classTeacher = await findClassTeacherForStudent(student, schoolCode);
    const admin = await findSchoolAdmin(schoolCode);
    const payload = {
      studentId: student.id,
      studentName: student.User?.name || student.name || 'Student',
      classId: student.classId || null,
      className: student.className || student.grade || null,
      classTeacher: classTeacherPayload(classTeacher),
      admin: admin ? { available: true, userId: admin.id, name: admin.name || 'School Administrator', relationship: 'school_admin' } : { available: false, reason: 'School administrator is not available right now.' }
    };
    return res.json({ success: true, data: payload });
  } catch (error) {
    console.error('Get parent message targets error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Message targets could not be loaded.' });
  }
};

exports.sendMessage = async (req, res) => {
  try {
    const { studentId, message, recipientType, attachment, clientMessageId } = req.body || {};
    const cleanMessage = String(message || '').trim();
    const attachmentMeta = attachment && typeof attachment === 'object' ? attachment : null;
    if (!studentId) return res.status(400).json({ success: false, message: 'Student is required' });
    if (!cleanMessage && !attachmentMeta) return res.status(400).json({ success: false, message: 'Message or attachment is required' });

    const parent = await getParentProfile(req.user.id);
    if (!parent) return res.status(404).json({ success: false, message: 'Parent not found' });

    const student = await findStudentForParent({ parent, studentId, user: req.user });
    if (!student) return res.status(403).json({ success: false, message: 'This child is not linked to your parent account' });
    const schoolCode = student.User?.schoolCode;

    let recipientId = null;
    let recipientRole = null;
    let recipientName = null;
    let conversationType = null;
    let classId = student.classId || null;
    let classTeacher = null;

    if (recipientType === 'teacher') {
      classTeacher = await findClassTeacherForStudent(student, schoolCode);
      if (!classTeacher?.userId) {
        return res.status(404).json({ success: false, message: 'Class teacher has not been assigned yet. Please message the school admin.', fallbackTarget: 'admin' });
      }
      recipientId = classTeacher.userId;
      recipientRole = 'teacher';
      recipientName = classTeacher.name;
      conversationType = 'parent_class_teacher';
      classId = classTeacher.classId || classId;
    } else if (recipientType === 'admin') {
      const admin = await findSchoolAdmin(schoolCode);
      if (!admin) return res.status(404).json({ success: false, message: 'School admin not found' });
      recipientId = admin.id;
      recipientRole = 'admin';
      recipientName = admin.name;
      conversationType = 'parent_admin';
    } else {
      return res.status(400).json({ success: false, message: 'Invalid recipient type' });
    }

    const conversationKey = buildConversationKey({ type: conversationType, schoolCode, parentUserId: req.user.id, studentId: student.id, classId, receiverId: recipientId });
    if (clientMessageId) {
      const recentSent = await Message.findAll({ where:{ senderId:req.user.id, receiverId:recipientId }, order:[['createdAt','DESC']], limit:50 });
      const duplicate = recentSent.find(item => meta(item).clientMessageId === String(clientMessageId));
      if (duplicate) return res.status(200).json({ success:true, data:{ ...duplicate.toJSON(), conversationKey }, reconciled:true });
    }
    const newMessage = await Message.create({
      senderId: req.user.id,
      receiverId: recipientId,
      schoolCode,
      conversationId: conversationKey,
      content: cleanMessage,
      metadata: {
        schoolCode,
        conversationType,
        conversationKey,
        parentUserId: req.user.id,
        parentProfileId: parent.id,
        studentId: student.id,
        studentName: student.User?.name || student.name || 'Student',
        studentGrade: student.grade,
        classId,
        className: classTeacher?.className || student.className || student.grade || null,
        classTeacherUserId: conversationType === 'parent_class_teacher' ? recipientId : null,
        adminUserId: conversationType === 'parent_admin' ? recipientId : null,
        recipientType,
        actualRecipientType: recipientRole,
        attachment: attachmentMeta,
        senderRole: 'parent',
        senderName: req.user.name,
        parentName: req.user.name,
        clientMessageId: clientMessageId ? String(clientMessageId) : null
      }
    });

    await createAlert({
      userId: recipientId,
      role: recipientRole,
      type: 'message',
      severity: 'info',
      title: `Message from parent of ${student.User?.name || 'student'}`,
      message: (cleanMessage || attachmentMeta?.originalName || attachmentMeta?.filename || 'Attachment').substring(0, 100) + ((cleanMessage || '').length > 100 ? '...' : ''),
      data: { schoolCode, scope: 'user', targetUserIds: [recipientId], conversationType, conversationKey, studentId: student.id, classId, messageId: newMessage.id }
    });

    const canonicalMessage = { ...newMessage.toJSON(), messageId:newMessage.id, conversationId:conversationKey, conversationKey, senderId:req.user.id, senderRole:'parent', senderName:req.user.name,senderProfileImage:req.user.profileImage||req.user.profilePicture||null,receiverId:recipientId, receiverRole:recipientRole, body:cleanMessage, content:cleanMessage, attachment:attachmentMeta, clientMessageId:clientMessageId?String(clientMessageId):null, createdAt:newMessage.createdAt, deliveryStatus:'sent', metadata:{ ...newMessage.metadata, conversationKey, conversationType, studentId:student.id, classId } };
    await realtime.emit({ type:'chat:message_created', schoolCode, audience:{ school:false, userIds:[req.user.id,recipientId], conversations:[conversationKey] }, entityType:'Message', entityId:newMessage.id, version:1, data:canonicalMessage }).catch(error=>console.error('[parent chat realtime]',error.message));
    res.status(201).json({ success: true, message: 'Message sent successfully', data: { ...canonicalMessage, recipient: recipientName, recipientType: recipientRole, requestedRecipientType: recipientType, recipientId, sentAt: newMessage.createdAt, Sender:{ id:req.user.id, name:req.user.name, role:'parent' } } });
  } catch (error) {
    console.error('Send parent message error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

function groupConversation(messages, currentUserId) {
  const conversations = {};
  for (const msg of messages) {
    const m = meta(msg);
    const otherUserId = Number(msg.senderId) === Number(currentUserId) ? msg.receiverId : msg.senderId;
    const otherUser = Number(msg.senderId) === Number(currentUserId) ? msg.Receiver : msg.Sender;
    const key = m.conversationKey || `${m.schoolCode || ''}:${m.conversationType || 'direct'}:${otherUserId}:${m.studentId || ''}`;
    if (!conversations[key]) {
      conversations[key] = { conversationKey: key, userId: otherUserId, userName: otherUser?.name || 'Unknown', userRole:otherUser?.role||'unknown',profileImage:otherUser?.profileImage||otherUser?.profilePicture||null,profilePicture:otherUser?.profilePicture||otherUser?.profileImage||null,conversationType: m.conversationType || 'direct', studentId: m.studentId || null, studentName: m.studentName || null, studentGrade: m.studentGrade || null, classId: m.classId || null, className: m.className || null, lastMessage: msg.content, lastMessageTime: msg.createdAt, unreadCount: 0, messages: [] };
    }
    if (Number(msg.receiverId) === Number(currentUserId) && !msg.isRead) conversations[key].unreadCount += 1;
    conversations[key].messages.push(msg);
  }
  return Object.values(conversations).sort((a, b) => new Date(b.lastMessageTime) - new Date(a.lastMessageTime));
}

exports.getConversations = async (req, res) => {
  try {
    const messages = await Message.findAll({
      where: { [Op.or]: [{ senderId: req.user.id }, { receiverId: req.user.id }] },
      include: [{ model: User, as: 'Sender', attributes:['id','name','role','profileImage','profilePicture'] }, { model: User, as: 'Receiver', attributes:['id','name','role','profileImage','profilePicture'] }],
      order: [['createdAt', 'DESC']]
    });
    const requestedStudentId = req.query.studentId || req.query.childId || null;
    const scoped = messages.filter(m => {
      const md = meta(m);
      if (!['parent_class_teacher', 'parent_admin'].includes(md.conversationType)) return false;
      if (requestedStudentId && String(md.studentId || '') !== String(requestedStudentId)) return false;
      return true;
    });
    res.json({ success: true, data: groupConversation(scoped, req.user.id) });
  } catch (error) {
    console.error('Get parent conversations error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getMessages = async (req, res) => {
  try {
    const { otherUserId } = req.params;
    const { limit, before } = getCursorPagination(req.query, { defaultLimit: 50, maxLimit: 100 });
    const where = { [Op.or]: [{ senderId: req.user.id, receiverId: otherUserId }, { senderId: otherUserId, receiverId: req.user.id }] };
    if (before) where.createdAt = { [Op.lt]: new Date(before) };
    const messages = await Message.findAll({
      where,
      include: [{ model: User, as: 'Sender', attributes:['id','name','role','profileImage','profilePicture'] }, { model: User, as: 'Receiver', attributes:['id','name','role','profileImage','profilePicture'] }],
      limit,
      order: [['createdAt', 'DESC']]
    });
    const requestedStudentId = req.query.studentId || req.query.childId || null;
    const requestedType = String(req.query.recipientType || req.query.type || '').toLowerCase();
    const wantedConversation = requestedType === 'admin' ? 'parent_admin' : requestedType === 'teacher' ? 'parent_class_teacher' : null;
    const scoped = messages.filter(m => {
      const md = meta(m);
      if (!['parent_class_teacher', 'parent_admin'].includes(md.conversationType)) return false;
      if (wantedConversation && md.conversationType !== wantedConversation) return false;
      if (requestedStudentId && String(md.studentId || '') !== String(requestedStudentId)) return false;
      return true;
    }).reverse();
    const scopedIds = scoped.filter(message => Number(message.senderId) === Number(otherUserId) && !message.isRead).map(message => message.id);
    if (scopedIds.length) await Message.update({ isRead: true, readAt: new Date() }, { where: { id: { [Op.in]: scopedIds }, receiverId: req.user.id, isRead: false } });
    res.json({ success: true, ...buildCursorResponse({ rows: scoped, limit, cursorPosition: 'first' }) });
  } catch (error) {
    console.error('Get parent messages error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.replyToParent = async (req, res) => {
  try {
    const { parentId, message, originalMessageId, clientMessageId } = req.body || {};
    const cleanMessage = String(message || '').trim();
    if (!parentId || !cleanMessage) return res.status(400).json({ success: false, message: 'Parent ID and message are required' });
    const original = originalMessageId ? await Message.findByPk(originalMessageId).catch(() => null) : null;
    const originalMeta = meta(original);
    const reply = await Message.create({
      senderId: req.user.id,
      receiverId: parentId,
      content: cleanMessage,
      metadata: { ...originalMeta, schoolCode: req.user.schoolCode, inReplyTo: originalMessageId || null, senderRole: req.user.role, senderName:req.user.name, clientMessageId:clientMessageId?String(clientMessageId):null, type: `${req.user.role}_reply` }
    });
    await createAlert({ userId: parentId, role: 'parent', type: 'message', severity: 'info', title: `Reply from ${req.user.name}`, message: cleanMessage.substring(0, 100), data: { schoolCode: req.user.schoolCode, scope: 'user', targetUserIds: [parentId], conversationType: originalMeta.conversationType || 'parent_reply', conversationKey: originalMeta.conversationKey || null, messageId: reply.id } });
    const conversationKey = originalMeta.conversationKey || buildConversationKey({ type:originalMeta.conversationType||'parent_reply', schoolCode:req.user.schoolCode, parentUserId:parentId, studentId:originalMeta.studentId, classId:originalMeta.classId, receiverId:req.user.id });
    const canonicalReply = { ...reply.toJSON(), messageId:reply.id, conversationId:conversationKey, conversationKey, senderId:req.user.id, senderRole:req.user.role, senderName:req.user.name,senderProfileImage:req.user.profileImage||req.user.profilePicture||null,receiverId:Number(parentId), receiverRole:'parent', body:cleanMessage, content:cleanMessage, clientMessageId:clientMessageId?String(clientMessageId):null, createdAt:reply.createdAt, deliveryStatus:'sent', metadata:{ ...reply.metadata, conversationKey } };
    await realtime.emit({ type:'chat:message_created', schoolCode:req.user.schoolCode, audience:{ school:false, userIds:[req.user.id,Number(parentId)], conversations:[conversationKey] }, entityType:'Message', entityId:reply.id, version:1, data:canonicalReply }).catch(error=>console.error('[parent teacher reply realtime]',error.message));
    res.status(201).json({ success: true, message: 'Reply sent successfully', data: canonicalReply });
  } catch (error) {
    console.error('Reply error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getAdminConversations = async (req, res) => {
  try {
    const messages = await Message.findAll({
      where: { [Op.or]: [{ senderId: req.user.id }, { receiverId: req.user.id }] },
      include: [{ model: User, as: 'Sender', attributes:['id','name','role','profileImage','profilePicture'] }, { model: User, as: 'Receiver', attributes:['id','name','role','profileImage','profilePicture'] }],
      order: [['createdAt', 'DESC']]
    });
    const scoped = messages.filter(m => schoolMatches(m, req.user.schoolCode) && meta(m).conversationType === 'parent_admin' && Number(meta(m).adminUserId || req.user.id) === Number(req.user.id));
    res.json({ success: true, data: groupConversation(scoped, req.user.id) });
  } catch (error) {
    console.error('Get admin parent conversations error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getAdminMessages = async (req, res) => {
  try {
    const { parentId } = req.params;
    const { limit, before } = getCursorPagination(req.query, { defaultLimit: 50, maxLimit: 100 });
    const where = { [Op.or]: [{ senderId: req.user.id, receiverId: parentId }, { senderId: parentId, receiverId: req.user.id }] };
    if (before) where.createdAt = { [Op.lt]: new Date(before) };
    const messages = await Message.findAll({
      where,
      include: [{ model: User, as: 'Sender', attributes:['id','name','role','profileImage','profilePicture'] }, { model: User, as: 'Receiver', attributes:['id','name','role','profileImage','profilePicture'] }],
      limit,
      order: [['createdAt', 'DESC']]
    });
    const scoped = messages.filter(m => schoolMatches(m, req.user.schoolCode) && meta(m).conversationType === 'parent_admin' && Number(meta(m).adminUserId || req.user.id) === Number(req.user.id)).reverse();
    await Message.update({ isRead: true, readAt: new Date() }, { where: { senderId: parentId, receiverId: req.user.id, isRead: false } });
    res.json({ success: true, ...buildCursorResponse({ rows: scoped, limit, cursorPosition: 'first' }) });
  } catch (error) {
    console.error('Get admin parent messages error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.adminReplyToParent = async (req, res) => {
  try {
    const { parentId, message, originalMessageId, clientMessageId } = req.body || {};
    const cleanMessage = String(message || '').trim();
    if (!parentId || !cleanMessage) return res.status(400).json({ success: false, message: 'Parent ID and message are required' });
    let baseMessage = originalMessageId ? await Message.findByPk(originalMessageId).catch(() => null) : null;
    if (!baseMessage) {
      const recent = await Message.findAll({ where: { [Op.or]: [{ senderId: req.user.id, receiverId: parentId }, { senderId: parentId, receiverId: req.user.id }] }, order: [['createdAt', 'DESC']], limit: 20 });
      baseMessage = recent.find(m => schoolMatches(m, req.user.schoolCode) && meta(m).conversationType === 'parent_admin') || null;
    }
    if (!baseMessage) return res.status(403).json({ success: false, message: 'This parent-admin conversation does not belong to this school admin.' });
    const baseMeta = meta(baseMessage);
    const reply = await Message.create({ senderId: req.user.id, receiverId: parentId, content: cleanMessage, metadata: { ...baseMeta, schoolCode: req.user.schoolCode, inReplyTo: originalMessageId || baseMessage.id, type: 'admin_reply', adminUserId: req.user.id, senderRole:'admin', senderName:req.user.name, clientMessageId:clientMessageId?String(clientMessageId):null } });
    await createAlert({ userId: parentId, role: 'parent', type: 'message', severity: 'info', title: `Reply from ${req.user.name}`, message: cleanMessage.substring(0,100), data: { schoolCode: req.user.schoolCode, scope: 'user', targetUserIds: [parentId], conversationType: 'parent_admin', conversationKey: baseMeta.conversationKey, messageId: reply.id } });
    const conversationKey = baseMeta.conversationKey || buildConversationKey({ type:'parent_admin', schoolCode:req.user.schoolCode, parentUserId:parentId, studentId:baseMeta.studentId, classId:baseMeta.classId, receiverId:req.user.id });
    const canonicalReply = { ...reply.toJSON(), messageId:reply.id, conversationId:conversationKey, conversationKey, senderId:req.user.id, senderRole:'admin', senderName:req.user.name,senderProfileImage:req.user.profileImage||req.user.profilePicture||null,receiverId:Number(parentId), receiverRole:'parent', body:cleanMessage, content:cleanMessage, clientMessageId:clientMessageId?String(clientMessageId):null, createdAt:reply.createdAt, deliveryStatus:'sent', metadata:{ ...reply.metadata, conversationKey } };
    await realtime.emit({ type:'chat:message_created', schoolCode:req.user.schoolCode, audience:{ school:false, userIds:[req.user.id,Number(parentId)], conversations:[conversationKey] }, entityType:'Message', entityId:reply.id, version:1, data:canonicalReply }).catch(error=>console.error('[parent admin reply realtime]',error.message));
    res.status(201).json({ success: true, data: canonicalReply, message: 'Reply sent successfully' });
  } catch (error) {
    console.error('Admin reply to parent error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};
