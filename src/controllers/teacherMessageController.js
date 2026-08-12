// src/controllers/teacherMessageController.js
const { Op } = require('sequelize');
const { Message, User, Teacher, Student, Parent, Class, TeacherSubjectAssignment, sequelize } = require('../models');
const {createAlert}=require('../services/notificationService');
const realtime=require('../services/realtimeService');
const { getCursorPagination, buildCursorResponse } = require('../utils/pagination');

function messageMeta(message) { return (message?.toJSON ? message.toJSON() : (message || {})).metadata || {}; }
function isTeacherParentConversation(message, user) {
  const md = messageMeta(message);
  return (!md.schoolCode || String(md.schoolCode) === String(user.schoolCode))
    && md.conversationType === 'parent_class_teacher'
    && Number(md.classTeacherUserId) === Number(user.id);
}

async function resolveClassTeacherParentContext(req, parentUserId) {
  const teacher = await Teacher.findOne({ where: { userId: req.user.id } });
  if (!teacher) return null;
  let classIds = Array.isArray(req.classTeacherClassIds) ? req.classTeacherClassIds.map(Number).filter(Boolean) : [];
  if (!classIds.length) {
    const classes = await Class.findAll({
      where: {
        schoolCode: req.user.schoolCode,
        isActive: true,
        [Op.or]: [
          { teacherId: teacher.id },
          { id: teacher.classId || 0 },
          ...(teacher.classTeacher ? [{ name: teacher.classTeacher }] : [])
        ]
      },
      attributes: ['id','name','grade']
    }).catch(() => []);
    const rows = await TeacherSubjectAssignment.findAll({ where: { teacherId: teacher.id, isClassTeacher: true }, attributes:['classId'] }).catch(() => []);
    classIds = [...new Set([...classes.map(c => c.id), ...rows.map(a => a.classId)].filter(Boolean).map(Number))];
  }
  if (!classIds.length) return null;

  const rows = await sequelize.query(
    `SELECT pu."id" AS "parentUserId", pu."name" AS "parentName", p."id" AS "parentProfileId",
            s."id" AS "studentId", su."name" AS "studentName",
            s."grade" AS "studentGrade", s."classId" AS "classId", c."name" AS "className"
       FROM "Students" s
       JOIN "Users" su ON su."id" = s."userId"
       JOIN "StudentParents" sp ON sp."studentId" = s."id"
       JOIN "Parents" p ON p."id" = sp."parentId"
       JOIN "Users" pu ON pu."id" = p."userId"
       LEFT JOIN "Classes" c ON c."id" = s."classId"
      WHERE su."schoolCode" = :schoolCode
        AND pu."schoolCode" = :schoolCode
        AND pu."role" = 'parent'
        AND pu."isActive" = true
        AND pu."id" = :parentUserId
        AND s."classId" IN (:classIds)
        AND COALESCE(sp."status", 'active') IN ('active','approved','verified','linked')
      ORDER BY s."id" ASC
      LIMIT 1`,
    { replacements: { schoolCode: req.user.schoolCode, parentUserId, classIds }, type: sequelize.QueryTypes.SELECT }
  ).catch(() => []);
  const row = rows[0];
  if (!row) return null;
  const conversationKey = [req.user.schoolCode, 'parent_class_teacher', row.parentUserId, row.studentId || 'student', row.classId || 'class', req.user.id].join(':');
  return {
    schoolCode: req.user.schoolCode,
    conversationType: 'parent_class_teacher',
    conversationKey,
    parentUserId: Number(row.parentUserId),
    parentProfileId: row.parentProfileId || null,
    parentName: row.parentName || 'Parent',
    studentId: row.studentId || null,
    studentName: row.studentName || null,
    studentGrade: row.studentGrade || null,
    classId: row.classId || null,
    className: row.className || null,
    classTeacherUserId: req.user.id,
    actualRecipientType: 'parent',
    senderRole: req.user.role
  };
}

// @desc    Get all conversations for teacher
// @route   GET /api/teacher/conversations
// @access  Private/Teacher
exports.getConversations = async (req, res) => {
  try {
    const messages = await Message.findAll({
      where: { [Op.or]: [{ receiverId: req.user.id }, { senderId: req.user.id }] },
      include: [
        { model: User, as: 'Sender', attributes:['id','name','role','email','profileImage','profilePicture'] },
        { model: User, as: 'Receiver', attributes:['id','name','role','email','profileImage','profilePicture'] }
      ],
      order: [['createdAt', 'DESC']]
    });

    const conversations = {};
    for (const msg of messages) {
      const md = messageMeta(msg);
      if (md.schoolCode && String(md.schoolCode) !== String(req.user.schoolCode)) continue;
      const otherUserId = Number(msg.senderId) === Number(req.user.id) ? msg.receiverId : msg.senderId;
      const otherUser = Number(msg.senderId) === Number(req.user.id) ? msg.Receiver : msg.Sender;
      if (!otherUser) continue;

      // v119: teacher private chats are fellow teachers only; parent chats live in the Parents tab.
      if (otherUser.role !== 'teacher') continue;
      const key = String(otherUserId);
      if (!conversations[key]) {
        conversations[key] = {
          userId: otherUserId,
          userName: otherUser.name || 'Teacher',
          userRole:'teacher',profileImage:otherUser.profileImage||otherUser.profilePicture||null,profilePicture:otherUser.profilePicture||otherUser.profileImage||null,
          lastMessage: msg.content,
          lastMessageTime: msg.createdAt,
          unreadCount: Number(msg.receiverId) === Number(req.user.id) && !msg.isRead ? 1 : 0,
          messages: []
        };
      } else if (Number(msg.receiverId) === Number(req.user.id) && !msg.isRead) {
        conversations[key].unreadCount += 1;
      }
      conversations[key].messages.push(msg);
    }
    res.json({ success: true, data: Object.values(conversations) });
  } catch (error) {
    console.error('Get conversations error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get messages with specific parent
// @route   GET /api/teacher/messages/:parentId
// @access  Private/Teacher
exports.getMessages = async (req, res) => {
    try {
        const { parentId } = req.params;
        const { limit, before } = getCursorPagination(req.query, { defaultLimit: 50, maxLimit: 100 });
        const where = {
            [Op.or]: [
                { senderId: req.user.id, receiverId: parentId },
                { senderId: parentId, receiverId: req.user.id }
            ]
        };
        if (before) where.createdAt = { [Op.lt]: new Date(before) };

        const rawMessages = await Message.findAll({
            where,
            include: [
                { model: User, as: 'Sender', attributes:['id','name','role','profileImage','profilePicture'] },
                { model: User, as: 'Receiver', attributes:['id','name','role','profileImage','profilePicture'] }
            ],
            limit,
            order: [['createdAt', 'DESC']]
        });

        const scoped = rawMessages.filter(message => isTeacherParentConversation(message, req.user)).reverse();

        const scopedIds = scoped.filter(message => Number(message.senderId) === Number(parentId) && !message.isRead).map(message => message.id);
        if (scopedIds.length) await Message.update(
            { isRead: true, readAt: new Date() },
            { where: { id: { [Op.in]: scopedIds }, receiverId: req.user.id, isRead: false } }
        );

        res.json({ success: true, ...buildCursorResponse({ rows: scoped, limit, cursorPosition: 'first' }) });
    } catch (error) {
        console.error('Get messages error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Mark messages as read for a conversation
// @route   PUT /api/teacher/messages/read/:conversationId
// @access  Private/Teacher
exports.markMessagesAsRead = async (req, res) => {
    try {
        const { conversationId } = req.params;
        
        const updated = await Message.update(
            { isRead: true, readAt: new Date() },
            {
                where: {
                    senderId: conversationId,
                    receiverId: req.user.id,
                    isRead: false
                }
            }
        );
        
        res.json({ success: true, message: 'Messages marked as read', count: updated[0] });
    } catch (error) {
        console.error('Mark as read error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Reply to parent message
// @route   POST /api/teacher/reply
// @access  Private/Teacher
exports.replyToParent = async (req, res) => {
    try {
        const { parentId, message, originalMessageId, clientMessageId } = req.body;

        if (!parentId || !String(message || '').trim()) {
            return res.status(400).json({ success: false, message: 'Parent ID and message are required' });
        }

        let baseMessage = null;
        if (originalMessageId) {
            baseMessage = await Message.findByPk(originalMessageId).catch(() => null);
        }
        if (!baseMessage) {
            const recent = await Message.findAll({
                where: {
                    [Op.or]: [
                        { senderId: req.user.id, receiverId: parentId },
                        { senderId: parentId, receiverId: req.user.id }
                    ]
                },
                order: [['createdAt', 'DESC']],
                limit: 20
            });
            baseMessage = recent.find(m => isTeacherParentConversation(m, req.user)) || null;
        }
        let baseMeta = baseMessage ? messageMeta(baseMessage) : null;
        if (!baseMeta || baseMeta.conversationType !== 'parent_class_teacher') {
            baseMeta = await resolveClassTeacherParentContext(req, parentId);
        }
        if (!baseMeta) {
            return res.status(403).json({ success: false, message: 'This parent is not linked to a student in your class teacher class.' });
        }

        if (clientMessageId) {
            const recentSent = await Message.findAll({ where: { senderId:req.user.id, receiverId:parentId }, order:[['createdAt','DESC']], limit:50 });
            const duplicate = recentSent.find(item => messageMeta(item).clientMessageId === String(clientMessageId));
            if (duplicate) return res.status(200).json({ success:true, data:duplicate, reconciled:true });
        }

        const reply = await Message.create({
            senderId: req.user.id,
            receiverId: parentId,
            content: String(message).trim(),
            metadata: {
                ...baseMeta,
                schoolCode: req.user.schoolCode,
                inReplyTo: originalMessageId || baseMessage?.id || null,
                type: 'teacher_reply',
                teacherName: req.user.name,
                teacherId: req.user.id,
                senderRole: 'teacher',
                senderName: req.user.name,
                clientMessageId: clientMessageId ? String(clientMessageId) : null
            }
        });

        await createAlert({
            userId: parentId,
            role: 'parent',
            type: 'message',
            severity: 'info',
            title: `Reply from ${req.user.name}`,
            message: String(message).substring(0, 100) + (String(message).length > 100 ? '...' : ''),
            data: { schoolCode: req.user.schoolCode, scope: 'user', targetUserIds: [parentId], conversationType: baseMeta.conversationType, conversationKey: baseMeta.conversationKey, messageId: reply.id }
        });

        const conversationKey=baseMeta.conversationKey;const canonicalReply={...reply.toJSON(),messageId:reply.id,conversationId:conversationKey,conversationKey,senderId:req.user.id,senderRole:'teacher',senderName:req.user.name,senderProfileImage:req.user.profileImage||req.user.profilePicture||null,receiverId:Number(parentId),receiverRole:'parent',body:String(message).trim(),content:String(message).trim(),clientMessageId:clientMessageId?String(clientMessageId):null,createdAt:reply.createdAt,deliveryStatus:'sent',metadata:{...reply.metadata,conversationKey}};await realtime.emit({type:'chat:message_created',schoolCode:req.user.schoolCode,audience:{school:false,userIds:[req.user.id,Number(parentId)],conversations:[conversationKey]},entityType:'Message',entityId:reply.id,version:1,data:canonicalReply}).catch(e=>console.error(e.message));res.status(201).json({success:true,message:'Reply sent successfully',data:canonicalReply});
    } catch (error) {
        console.error('Reply error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};
