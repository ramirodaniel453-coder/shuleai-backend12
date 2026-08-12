const { User, Teacher, Message, Student, Parent, Class, TeacherSubjectAssignment, sequelize } = require('../models');
const { Op } = require('sequelize');
const { createAlert } = require('../services/notificationService');
const { literal } = require('sequelize'); // Add at top of file


// @desc    Get staff members in same school
// @route   GET /api/teacher/staff-members
// @access  Private/Teacher
exports.getStaffMembers = async (req, res) => {
    try {
        const teachers = await Teacher.findAll({
            include: [{
                model: User,
                where: { schoolCode: req.user.schoolCode, isActive: true },
                attributes: ['id', 'name', 'email', 'role']
            }]
        });
        
        const staff = teachers.map(t => ({
            id: t.User.id,
            name: t.User.name,
            role: t.User.role,
            isOnline: false,
            teacherId: t.id,
            subjects: t.subjects,
            isClassTeacher: t.classTeacher !== null
        }));
        
        // Private staff contacts are intentionally teachers-only.
        // Admin/parent messaging is handled in the dedicated admin/parent flows, not in teacher private chat.
        
        res.json({ success: true, data: staff });
    } catch (error) {
        console.error('Get staff members error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Send group message to all staff
// @route   POST /api/teacher/group-message
// @access  Private/Teacher
exports.sendGroupMessage = async (req, res) => {
  try {
    const { content, replyToId } = req.body;
    const teachers = await Teacher.findAll({
      include: [{ model: User, where: { schoolCode: req.user.schoolCode, isActive: true }, attributes: ['id'] }]
    });
    const admins = await User.findAll({
      where: { schoolCode: req.user.schoolCode, role: 'admin', isActive: true },
      attributes: ['id']
    });
    const recipients = [...teachers.map(t => t.User.id), ...admins.map(a => a.id)].filter(id => id !== req.user.id);
    const messages = recipients.map(recipientId => ({
      senderId: req.user.id,
      receiverId: recipientId,
      content,
      metadata: { type: 'group_message', senderName: req.user.name, replyToId, schoolCode: req.user.schoolCode, conversationKey: require('../services/realtimeService').directConversationKey(req.user.id, recipientId) },
      replyToMessageId: replyToId || null
    }));
    await Message.bulkCreate(messages, { individualHooks: true });
    if (global.io) {
      recipients.forEach(recipientId => {
        global.io.to(`user-${recipientId}`).emit('new-group-message', {
          from: req.user.id,
          fromName: req.user.name,
          content,
          replyToId,
          timestamp: new Date()
        });
      });
    }
    res.status(201).json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Superseded duplicate export removed: sendPrivateMessage.

exports.getMessage = async (req, res) => {
  try {
    const { id } = req.params;
    const message = await Message.findByPk(id, {
      include: [{ model: User, as: 'Sender', attributes: ['id', 'name'] }]
    });
    res.json({ success: true, data: message });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Send private message to specific staff
// @route   POST /api/teacher/private-message
// @access  Private/Teacher
exports.sendPrivateMessage = async (req, res) => {
    try {
        const { receiverId, content } = req.body;
        
        const receiver = await User.findOne({
            where: { id: receiverId, schoolCode: req.user.schoolCode, isActive: true }
        });
        
        if (!receiver) {
            return res.status(404).json({ success: false, message: 'Recipient not found' });
        }
        if (receiver.role !== 'teacher') {
            return res.status(403).json({ success: false, message: 'Teacher private messages are limited to fellow teachers only.' });
        }
        
        const message = await Message.create({
            senderId: req.user.id,
            receiverId: receiverId,
            content: content,
            metadata: { type: 'private_message', senderName: req.user.name }
        });
        
        if (global.io) {
            global.io.to(`user-${receiverId}`).emit('new-private-message', {
                from: req.user.id,
                fromName: req.user.name,
                content: content,
                timestamp: new Date(),
                type: 'private'
            });
        }
        
        await createAlert({
            userId: receiverId,
            role: receiver.role,
            type: 'message',
            severity: 'info',
            title: `New message from ${req.user.name}`,
            message: content.substring(0, 100)
        });
        
        res.status(201).json({ success: true, data: message });
    } catch (error) {
        console.error('Send private message error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Get messages with specific user
// @route   GET /api/teacher/messages/:otherUserId
// @access  Private/Teacher
exports.getMessages = async (req, res) => {
    try {
        const { otherUserId } = req.params;
        
        const messages = await Message.findAll({
            where: {
                [Op.or]: [
                    { senderId: req.user.id, receiverId: otherUserId },
                    { senderId: otherUserId, receiverId: req.user.id }
                ]
            },
            include: [
                { model: User, as: 'Sender', attributes: ['id', 'name', 'role'] },
                { model: User, as: 'Receiver', attributes: ['id', 'name', 'role'] }
            ],
            order: [['createdAt', 'ASC']]
        });
        
        await Message.update(
            { isRead: true, readAt: new Date() },
            {
                where: {
                    senderId: otherUserId,
                    receiverId: req.user.id,
                    isRead: false
                }
            }
        );
        
        res.json({ success: true, data: messages });
    } catch (error) {
        console.error('Get messages error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Get all conversations for teacher
// @route   GET /api/teacher/conversations
// @access  Private/Teacher
exports.getConversations = async (req, res) => {
    try {
        const messages = await Message.findAll({
            where: {
                [Op.or]: [
                    { senderId: req.user.id },
                    { receiverId: req.user.id }
                ]
            },
            include: [
                { model: User, as: 'Sender', attributes: ['id', 'name', 'role'] },
                { model: User, as: 'Receiver', attributes: ['id', 'name', 'role'] }
            ],
            order: [['createdAt', 'DESC']]
        });
        
        const conversations = {};
        messages.forEach(msg => {
            const otherUserId = msg.senderId === req.user.id ? msg.receiverId : msg.senderId;
            const otherUser = msg.senderId === req.user.id ? msg.Receiver : msg.Sender;
            
            if (!conversations[otherUserId]) {
                conversations[otherUserId] = {
                    userId: otherUserId,
                    userName: otherUser?.name || 'Unknown',
                    userRole: otherUser?.role || 'unknown',
                    lastMessage: msg.content,
                    lastMessageTime: msg.createdAt,
                    unreadCount: msg.receiverId === req.user.id && !msg.isRead ? 1 : 0,
                    messages: []
                };
            }
            
            conversations[otherUserId].messages.push(msg);
            
            if (msg.receiverId === req.user.id && !msg.isRead) {
                conversations[otherUserId].unreadCount++;
            }
        });
        
        res.json({ success: true, data: Object.values(conversations) });
    } catch (error) {
        console.error('Get conversations error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Get group messages (messages sent to all staff)
// @route   GET /api/teacher/group-messages
// @access  Private/Teacher
exports.getGroupMessages = async (req, res) => {
  try {
    const messages = await Message.findAll({
      where: {
        [Op.or]: [
          { receiverId: null },
          { metadata: { [Op.contains]: { type: 'group_message' } } }
        ]
      },
      include: [
        { model: User, as: 'Sender', attributes: ['id', 'name', 'role'] }
      ],
      order: [['createdAt', 'ASC']]
    });
    res.json({ success: true, data: messages });
  } catch (error) {
    console.error('Get group messages error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get private messages between two users
// @route   GET /api/teacher/private-messages/:otherUserId
// @access  Private/Teacher
exports.getPrivateMessages = async (req, res) => {
  try {
    const { otherUserId } = req.params;
    const messages = await Message.findAll({
      where: {
        [Op.or]: [
          { senderId: req.user.id, receiverId: otherUserId },
          { senderId: otherUserId, receiverId: req.user.id }
        ]
      },
      include: [
        { model: User, as: 'Sender', attributes: ['id', 'name', 'role'] }
      ],
      order: [['createdAt', 'ASC']]
    });
    res.json({ success: true, data: messages });
  } catch (error) {
    console.error('Get private messages error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get conversations with parents only
// @route   GET /api/teacher/parent-conversations
// @access  Private/Teacher
exports.getParentConversations = async (req, res) => {
  try {
    const teacher = await Teacher.findOne({ where: { userId: req.user.id } });
    if (!teacher) return res.json({ success: true, data: [] });

    let classIds = Array.isArray(req.classTeacherClassIds) ? req.classTeacherClassIds.map(Number).filter(Boolean) : [];
    if (!classIds.length) {
      const classWhere = {
        schoolCode: req.user.schoolCode,
        isActive: true,
        [Op.or]: [
          { teacherId: teacher.id },
          { id: teacher.classId || 0 },
          ...(teacher.classTeacher ? [{ name: teacher.classTeacher }] : [])
        ]
      };
      const directClasses = await Class.findAll({ where: classWhere, attributes: ['id','name','grade'] }).catch(() => []);
      const assignmentRows = await TeacherSubjectAssignment.findAll({ where: { teacherId: teacher.id, isClassTeacher: true }, attributes: ['classId'] }).catch(() => []);
      classIds = [...new Set([...directClasses.map(c => c.id), ...assignmentRows.map(a => a.classId)].filter(Boolean).map(Number))];
    }
    const classes = classIds.length ? await Class.findAll({ where: { id: { [Op.in]: classIds }, schoolCode: req.user.schoolCode, isActive: true }, attributes: ['id','name','grade'] }).catch(() => []) : [];
    if (!classIds.length) return res.json({ success: true, data: [] });

    const messages = await Message.findAll({
      where: { [Op.or]: [{ receiverId: req.user.id }, { senderId: req.user.id }] },
      include: [
        {model:User,as:'Sender',attributes:['id','name','role','profileImage','profilePicture']},{model:User,as:'Receiver',attributes:['id','name','role','profileImage','profilePicture']}
      ],
      order: [['createdAt', 'DESC']]
    });

    const conversations = {};
    const keyFor = (parentUserId, studentId, classId) => `parent_class_teacher:${req.user.schoolCode}:${studentId || 'student'}:${parentUserId}:${req.user.id}`;

    // First list all parents linked to students in this class teacher's actual class.
    const parentRows = await sequelize.query(
      `SELECT DISTINCT pu."id" AS "userId", pu."name" AS "userName", pu."profileImage", pu."profilePicture", p."id" AS "parentProfileId",
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
          AND s."classId" IN (:classIds)
          AND COALESCE(sp."status", 'active') IN ('active','approved','verified','linked')
        ORDER BY pu."name" ASC, "studentName" ASC`,
      { replacements: { schoolCode: req.user.schoolCode, classIds }, type: sequelize.QueryTypes.SELECT }
    ).catch(() => []);

    for (const row of parentRows) {
      const key = keyFor(row.userId, row.studentId, row.classId);
      conversations[key] = {
        conversationKey: key,
        userId: row.userId,
        userName: row.userName || 'Parent',
        userRole:'parent',profileImage:row.profileImage||row.profilePicture||null,profilePicture:row.profilePicture||row.profileImage||null,
        conversationType: 'parent_class_teacher',
        studentId: row.studentId || null,
        studentName: row.studentName || null,
        studentGrade: row.studentGrade || null,
        classId: row.classId || null,
        className: row.className || null,
        lastMessage: '',
        lastMessageTime: null,
        unreadCount: 0,
        hasHistory: false
      };
    }

    // Then overlay real conversations/history on top of the parent list.
    for (const msg of messages) {
      const md = msg.metadata || {};
      if (md.schoolCode && String(md.schoolCode) !== String(req.user.schoolCode)) continue;
      if (md.conversationType !== 'parent_class_teacher') continue;
      if (Number(md.classTeacherUserId) !== Number(req.user.id)) continue;
      if (md.classId && !classIds.includes(Number(md.classId))) continue;

      const parentUserId = Number(md.parentUserId || (Number(msg.senderId) === Number(req.user.id) ? msg.receiverId : msg.senderId));
      const parentUser = Number(msg.senderId) === Number(req.user.id) ? msg.Receiver : msg.Sender;
      const key = md.conversationKey || keyFor(parentUserId, md.studentId, md.classId);
      if (!conversations[key]) {
        conversations[key] = {
          conversationKey: key,
          userId: parentUserId,
          userName: parentUser?.name || md.parentName || 'Parent',
          userRole: 'parent',
          conversationType: 'parent_class_teacher',
          studentId: md.studentId || null,
          studentName: md.studentName || null,
          studentGrade: md.studentGrade || null,
          classId: md.classId || null,
          className: md.className || null,
          lastMessage: '',
          lastMessageTime: null,
          unreadCount: 0,
          hasHistory: false
        };
      }
      const conv = conversations[key];
      if (!conv.lastMessageTime || new Date(msg.createdAt) > new Date(conv.lastMessageTime)) {
        conv.lastMessage = msg.content;
        conv.lastMessageTime = msg.createdAt;
      }
      conv.hasHistory = true;
      if (Number(msg.receiverId) === Number(req.user.id) && !msg.isRead) conv.unreadCount += 1;
    }

    res.json({ success: true, data: Object.values(conversations).sort((a, b) => {
      const at = a.lastMessageTime ? new Date(a.lastMessageTime).getTime() : 0;
      const bt = b.lastMessageTime ? new Date(b.lastMessageTime).getTime() : 0;
      return bt - at || String(a.userName || '').localeCompare(String(b.userName || ''));
    }) });
  } catch (error) {
    console.error('Get parent conversations error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};
