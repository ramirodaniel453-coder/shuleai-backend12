// src/controllers/teacherController.js - COMPLETE FIXED VERSION
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const { Op } = require('sequelize');
const { Teacher, Student, AcademicRecord, Attendance, User, Parent, Class, Message, DutyRoster, School, Task, TeacherSubjectAssignment, ReportSnapshot, Admin, Fee, StudentEnrollment } = require('../models');
const reportCommentsController = require('./reportCommentsController');
const reportSnapshotService = require('../services/reportSnapshotService');
const gradingEngine = require('../services/gradingEngine');
const { getGradeFromScore } = gradingEngine;
const { createAlert } = require('../services/notificationService');
const realtime = require('../services/realtimeService');
const moment = require('moment');
const crypto = require('crypto');
const sequelize = require('../config/database');
const { generateTemporaryPassword } = require('../utils/passwords');
const cache = require('../services/cacheService');
const { findStudentInSchool, findTeacherInSchool, teacherCanAccessStudentClass } = require('../services/studentScopeService');
const { validateCsvUpload } = require('../services/mediaAssetService');



function safeTempCsvPath(originalName) {
  const safe = path.basename(String(originalName || 'students.csv')).replace(/[^a-zA-Z0-9._-]/g, '_');
  const dir = process.env.UPLOAD_TMP_DIR || path.join(process.cwd(), 'uploads', 'tmp');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${Date.now()}-${safe}`);
}


function normalizeClassTextV1509(value){ return String(value||'').trim().toLowerCase().replace(/\s+/g,' '); }
function gradeVariantsV1509(value){
  const raw=normalizeClassTextV1509(value); if(!raw)return [];
  const out=new Set([raw, raw.replace(/\s+/g,'')]);
  const spaced=raw.replace(/^(pp|grade|form)(\d+)/i,'$1 $2').replace(/(\d+)([a-z])$/i,'$1 $2');
  out.add(spaced); out.add(spaced.replace(/\s+/g,''));
  const m=raw.match(/^(?:grade\s*)?(\d{1,2})([a-z])$/i); if(m){out.add(`grade ${m[1]} ${m[2]}`); out.add(`grade ${m[1]}${m[2]}`);}
  return [...out];
}
async function resolveSafeClassForNewStudent({ schoolCode, grade, classId }) {
  const where={ schoolCode, isActive:true };
  const classes=await Class.findAll({ where, order:[['id','ASC']] }).catch(()=>[]);
  if(classId){ const cls=classes.find(c=>Number(c.id)===Number(classId)); if(cls)return cls; }
  const variants=gradeVariantsV1509(grade); if(!variants.length)return null;
  let matches=classes.filter(c=>variants.includes(normalizeClassTextV1509(c.name))||variants.includes(String(c.name||'').toLowerCase().replace(/\s+/g,'')));
  if(matches.length===1)return matches[0];
  matches=classes.filter(c=>c.stream&&variants.includes(normalizeClassTextV1509(`${c.grade||''} ${c.stream||''}`)));
  if(matches.length===1)return matches[0];
  matches=classes.filter(c=>variants.includes(normalizeClassTextV1509(c.grade))||variants.includes(String(c.grade||'').toLowerCase().replace(/\s+/g,'')));
  if(matches.length===1)return matches[0];
  return null;
}
async function createEnrollmentForNewStudent({ student, classItem, schoolCode, actorId, transaction=null }) {
  if(!student || !classItem) return null;
  const year=Number(classItem.academicYear)||new Date().getFullYear();
  const effectiveFrom=student.enrollmentDate ? new Date(student.enrollmentDate).toISOString().slice(0,10) : new Date().toISOString().slice(0,10);
  const enrollment=await StudentEnrollment.create({
    schoolCode,
    studentId: student.id,
    classId: classItem.id,
    stream: classItem.stream || null,
    academicYear: year,
    status: 'active',
    effectiveFrom,
    startTerm: 'Term 1',
    createdBy: actorId || null,
    classTeacherIdAtStart: classItem.teacherId || null,
    movementType: 'admission',
    movementReason: 'Created during teacher/manual admission',
    metadata: { source:'teacher_manual_or_csv_v1509' }
  }, { transaction });
  await student.update({ classId:classItem.id, grade:classItem.name, activeEnrollmentId:enrollment.id }, { transaction, hooks:false });
  return enrollment;
}

async function linkParentToStudentSafely(parentId, studentId) {
  const now = new Date();
  await sequelize.query(`
    INSERT INTO "StudentParents" ("studentId", "parentId", "createdAt", "updatedAt")
    VALUES (:studentId, :parentId, :createdAt, :updatedAt)
    ON CONFLICT ("studentId", "parentId") DO UPDATE
      SET "updatedAt" = EXCLUDED."updatedAt"
  `, {
    replacements: { studentId, parentId, createdAt: now, updatedAt: now },
    type: sequelize.QueryTypes.INSERT
  });
}

// ============ EXISTING FUNCTIONS (keep your existing ones, they work) ============

// @desc    Get teacher's dashboard
// @route   GET /api/teacher/dashboard
// @access  Private/Teacher
exports.getDashboard = async (req, res) => {
  try {
    const teacher = await Teacher.findOne({ where: { userId: req.user.id } });
    if (!teacher) {
      return res.status(404).json({ success: false, message: 'Teacher profile not found' });
    }

    const classTeacherClasses = await v66AssignedClassesForTeacher(teacher, req.user.schoolCode, { classTeacherOnly: true });
    const students = await v66CurrentStudentsForClasses(classTeacherClasses, req.user.schoolCode);

    const todayDuty = await exports.getTodayDuty(req.user.id);
    const unreadCount = await Message.count({
      where: { receiverId: req.user.id, isRead: false }
    });

    res.json({
      success: true,
      data: {
        teacher: {
          id: teacher.id,
          employeeId: teacher.employeeId,
          subjects: teacher.subjects,
          classTeacher: teacher.classTeacher,
          department: teacher.department
        },
        user: req.user.getPublicProfile(),
        students: students,
        todayDuty: todayDuty,
        unreadMessages: unreadCount,
        stats: {
          totalStudents: students.length,
          totalClasses: classTeacherClasses.length
        }
      }
    });
  } catch (error) {
    console.error('Get dashboard error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get teacher's students with subject matrix
// @route   GET /api/teacher/students
// @access  Private/Teacher
exports.getMyStudents = async (req, res) => {
  try {
    const teacher = await Teacher.findOne({ where: { userId: req.user.id } });
    if (!teacher) {
      return res.status(404).json({ success: false, message: 'Teacher profile not found' });
    }

    const assignmentState = await v66JTeacherAssignments(teacher, req.user.schoolCode);
    const classTeacherClasses = req.classTeacherClasses?.length ? req.classTeacherClasses : (assignmentState.classTeacherClasses || []);
    const classItem = classTeacherClasses[0] || null;
    const subjectAssignments = assignmentState.subjectAssignments || [];
    const assignedClasses = await v66AssignedClassesForTeacher(teacher, req.user.schoolCode);
    const classScope = classItem ? classTeacherClasses : assignedClasses;
    const classNames = classScope.map(cls => cls.name);

    if (!classScope.length) {
      return res.json({ success: true, data: { students: [], isClassTeacher: false, subjects: [], classNames: [] } });
    }

    // My Students must be class-first: class teachers see only their assigned class,
    // even if they also teach subjects in other classes.
    const students = await v66CurrentStudentsForClasses(classScope, req.user.schoolCode);

    const studentIds = students.map(s => s.id);

    // Get ALL academic records for these students (not filtered by term/year)
    const academicRecords = await AcademicRecord.findAll({
      where: { studentId: { [Op.in]: studentIds } }
    });
    
    const attendanceRecords = await Attendance.findAll({
      where: { studentId: { [Op.in]: studentIds } }
    });

    // Determine subjects to display
    const school = await School.findOne({ where: { schoolId: req.user.schoolCode } });
    const curriculum = school?.system || 'cbc';
    const curriculumHelper = require('../utils/curriculumHelper');
    const allSubjects = new Set();
    
    if (classItem) {
      const curriculumSubjects = curriculumHelper.getSubjectsForCurriculum(curriculum, school?.settings?.schoolLevel || 'both');
      curriculumSubjects.forEach(s => allSubjects.add(s));
      const customSubjects = school?.settings?.customSubjects || [];
      customSubjects.forEach(s => allSubjects.add(s));
    }

    const displaySubjects = classItem ? Array.from(allSubjects) : subjectAssignments.map(a => a.subject);

    // Build student data with subject scores
    const studentData = students.map(student => {
      const user = student.User;
      const studentRecords = academicRecords.filter(r => r.studentId === student.id);
      const studentAttendance = attendanceRecords.filter(a => a.studentId === student.id);
      
      const present = studentAttendance.filter(a => a.status === 'present').length;
      const attendanceRate = studentAttendance.length ? Math.round((present / studentAttendance.length) * 100) : 100;

      const subjectScores = {};
      const subjectGrades = {};
      if (classItem) {
        for (const subject of allSubjects) {
          const subjectRecords = studentRecords.filter(r => r.subject === subject);
          const avg = subjectRecords.length
            ? Math.round(subjectRecords.reduce((sum, r) => sum + r.score, 0) / subjectRecords.length)
            : null;
          subjectScores[subject] = avg;
          subjectGrades[subject] = avg===null?null:gradingEngine.gradeValueForRecords(avg,subjectRecords);
        }
      } else {
        for (const assignment of subjectAssignments) {
          const subjectRecords = studentRecords.filter(r => r.subject === assignment.subject);
          const avg = subjectRecords.length
            ? Math.round(subjectRecords.reduce((sum, r) => sum + r.score, 0) / subjectRecords.length)
            : null;
          subjectScores[assignment.subject] = avg;
          subjectGrades[assignment.subject] = avg===null?null:gradingEngine.gradeValueForRecords(avg,subjectRecords);
        }
      }

      const allScores = Object.values(subjectScores).filter(s => s !== null);
      const overallAvg = allScores.length
        ? Math.round(allScores.reduce((a, b) => a + b, 0) / allScores.length)
        : null;

      return {
        id: student.id,
        userId: user.id,
        name: user.name,
        email: user.email,
        elimuid: student.elimuid,
        grade: student.grade,
        status: student.status,
        attendance: attendanceRate,
        subjectScores,
        subjectGrades,
        overallAverage: overallAvg
      };
    });

    res.json({
      success: true,
      data: {
        students: studentData,
        isClassTeacher: !!classItem,
        subjects: displaySubjects,
        classNames,
        classId: classItem?.id || null,
        class: classItem ? { id: classItem.id, name: classItem.name, grade: classItem.grade, stream: classItem.stream } : null,
        teacherName: req.user.name
      }
    });
  } catch (error) {
    console.error('Get my students error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Add a new student with default password
// @route   POST /api/teacher/students
// @access  Private/Teacher
exports.addStudent = async (req, res) => {
  try {
    const { name, grade, parentEmail, dateOfBirth, gender, classId } = req.body;
    
    if (!name || !grade) {
      return res.status(400).json({ success: false, message: 'Student name and grade are required' });
    }

    const defaultPassword = generateTemporaryPassword();

    const user = await User.create({
      name,
      email: null,
      password: defaultPassword,
      role: 'student',
      schoolCode: req.user.schoolCode,
      isActive: true,
      firstLogin: true
    });

    const classItem = await resolveSafeClassForNewStudent({ schoolCode:req.user.schoolCode, grade, classId });
    const student = await Student.create({
      userId: user.id,
      schoolCode: req.user.schoolCode,
      grade: classItem?.name || grade,
      classId: classItem?.id || null,
      dateOfBirth: dateOfBirth,
      gender: gender
    });
    if (classItem) await createEnrollmentForNewStudent({ student, classItem, schoolCode:req.user.schoolCode, actorId:req.user.id });

    if (parentEmail) {
      try {
        let parentUser = await User.findOne({ 
          where: { email: parentEmail, role: 'parent' }
        });

        let parent;
        
        if (!parentUser) {
          parentUser = await User.create({
            name: `Parent of ${name}`,
            email: parentEmail,
            password: defaultPassword,
            role: 'parent',
            schoolCode: req.user.schoolCode,
            isActive: true
          });

          parent = await Parent.create({
            userId: parentUser.id,
            relationship: 'guardian'
          });
        } else {
          parent = await Parent.findOne({ where: { userId: parentUser.id } });
        }

        if (parent) {
          await linkParentToStudentSafely(parent.id, student.id);
        }
      } catch (parentError) {
        console.error('Error linking parent:', parentError);
      }
    }

    cache.flushSchoolCache(req.user.schoolCode);
    res.status(201).json({
      success: true,
      message: 'Student added successfully',
      data: {
        id: student.id,
        elimuid: student.elimuid,
        name: user.name,
        grade: student.grade,
        defaultPassword: defaultPassword
      }
    });
  } catch (error) {
    console.error('Add student error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to add student' });
  }
};

// @desc    Enter marks for a student
// @route   POST /api/teacher/marks
// @access  Private/Teacher
// Superseded duplicate export removed: enterMarks.

// @desc    Take attendance
// @route   POST /api/teacher/attendance
// @access  Private/Teacher
exports.takeAttendance = require('./attendanceLifecycleController').saveSingleDraft;
exports.addComment = async (req, res) => {
  try {
    const { studentId, comment } = req.body;
    const teacher = await findTeacherInSchool(req.user.id, req.user.schoolCode);
    if (!teacher) return res.status(404).json({ success: false, message: 'Teacher not found in this school' });

    const student = await findStudentInSchool(studentId, req.user.schoolCode, { userAttributes: ['id','name','profileImage','profilePicture','schoolCode'] });
    if (!student) return res.status(404).json({ success: false, message: 'Student not found in this school' });
    if (!(await teacherCanAccessStudentClass(teacher, student, req.user.schoolCode))) {
      return res.status(403).json({ success: false, message: 'This student is not assigned to your class' });
    }

    const parents = await student.getParents({ 
      include: [{ model: User, attributes: ['id','name','profileImage','profilePicture'] }] 
    });
    
    for (const parent of parents) {
      await createAlert({
        userId: parent.userId,
        role: 'parent',
        type: 'system',
        severity: 'info',
        title: `Teacher Comment: ${student.User.name}`,
        message: comment
      });
    }

    res.json({ success: true, message: 'Comment sent to parents' });
  } catch (error) {
    console.error('Add comment error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Upload CSV of marks
// @route   POST /api/teacher/upload/marks
// @access  Private/Teacher
exports.uploadMarksCSV = async (req, res) => {
  if (!req.files || !req.files.file) {
    return res.status(400).json({ success: false, message: 'No file uploaded' });
  }

  const file = req.files.file;
  const filePath = safeTempCsvPath(file.name);
  
  try {
    await validateCsvUpload(file);
    await file.mv(filePath);

    const results = [];
    const errors = [];

    const teacher = await Teacher.findOne({ where: { userId: req.user.id } });
    if (!teacher) {
      return res.status(404).json({ success: false, message: 'Teacher not found' });
    }

    const readStream = fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (data) => results.push(data))
      .on('end', async () => {
        for (const row of results) {
          try {
            const student = await Student.findOne({
              where: {
                [Op.or]: [
                  { id: row.studentId },
                  { elimuid: row.elimuid }
                ]
              }
            });

            if (!student) {
              errors.push({ row, error: 'Student not found' });
              continue;
            }

            await AcademicRecord.create({
              studentId: student.id,
              schoolCode: req.user.schoolCode,
              term: row.term || 'Term 1',
              year: row.year || new Date().getFullYear(),
              subject: row.subject,
              assessmentType: row.assessmentType || 'test',
              assessmentName: row.assessmentName || `${row.subject} ${row.assessmentType || 'test'}`,
              assessmentKey: v1508AssessmentKey(row.assessmentType || 'test', row.assessmentName || `${row.subject} ${row.assessmentType || 'test'}`),
              assessmentCategory: v1508AssessmentCategory(row.assessmentType || 'test'),
              maxScore: Number(row.maxScore || 100),
              score: parseInt(row.score),
              teacherId: teacher.id,
              date: row.date || new Date(),
              isPublished: true
            });
          } catch (err) {
            errors.push({ row, error: err.message });
          }
        }

        fs.unlinkSync(filePath);

        res.json({
          success: true,
          message: `Processed ${results.length} records with ${errors.length} errors`,
          data: {
            total: results.length,
            successful: results.length - errors.length,
            errors: errors
          }
        });
      });

    readStream.on('error', (error) => {
      console.error('CSV read error:', error);
      fs.unlinkSync(filePath);
      res.status(500).json({ success: false, message: 'Error reading CSV file' });
    });

  } catch (error) {
    console.error('Upload marks CSV error:', error);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============ MESSAGE FUNCTIONS ============

exports.getConversations = async (req, res) => {
    try {
        const messages = await Message.findAll({
            where: {
                [Op.or]: [
                    { receiverId: req.user.id },
                    { senderId: req.user.id }
                ]
            },
            include: [
                { model: User, as: 'Sender', attributes: ['id','name','role','profileImage','profilePicture'] },
                { model: User, as: 'Receiver', attributes: ['id','name','role','profileImage','profilePicture'] }
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
                    studentName: msg.metadata?.studentName,
                    studentGrade: msg.metadata?.studentGrade,
                    messages: []
                };
            } else {
                if (msg.receiverId === req.user.id && !msg.isRead) {
                    conversations[otherUserId].unreadCount++;
                }
            }
            
            conversations[otherUserId].messages.push(msg);
        });
        
        res.json({ success: true, data: Object.values(conversations) });
    } catch (error) {
        console.error('Get conversations error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

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
                { model: User, as: 'Sender', attributes: ['id','name','role','profileImage','profilePicture'] },
                { model: User, as: 'Receiver', attributes: ['id','name','role','profileImage','profilePicture'] }
            ],
            order: [['createdAt', 'ASC']]
        });
        
        res.json({ success: true, data: messages });
    } catch (error) {
        console.error('Get messages error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.markMessagesAsRead = async (req, res) => {
    try {
        const { conversationId } = req.params;
        
        await Message.update(
            { isRead: true, readAt: new Date() },
            {
                where: {
                    senderId: conversationId,
                    receiverId: req.user.id,
                    isRead: false
                }
            }
        );
        
        res.json({ success: true, message: 'Messages marked as read' });
    } catch (error) {
        console.error('Mark as read error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.deleteMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    const { deleteFor } = req.body;

    const message = await Message.findOne({ where: { id: messageId, schoolCode: req.user.schoolCode } });

    if (!message) {
      return res.status(404).json({ success: false, message: 'Message not found' });
    }

    if (message.senderId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    if (deleteFor === 'everyone') {
      message.content = '[This message was deleted]';
      message.metadata = { ...message.metadata, deleted: true, deletedBy: req.user.id, deletedAt: new Date() };
      await message.save();
    } else {
      const deletedFor = message.metadata?.deletedFor || [];
      if (!deletedFor.includes(req.user.id)) {
        deletedFor.push(req.user.id);
        message.metadata = { ...message.metadata, deletedFor };
        await message.save();
      }
    }

    const md = message.metadata || {};
    const userIds = deleteFor === 'everyone' ? [message.senderId, message.receiverId] : [req.user.id];
    await realtime.emit({
      type:'chat:message_deleted',
      schoolCode:md.schoolCode || req.user.schoolCode,
      audience:{ school:false, userIds, conversationIds:md.conversationKey ? [md.conversationKey] : [] },
      entityType:'Message', entityId:message.id, version:Number(message.updatedAt?.getTime?.() || Date.now()),
      data:{ ...message.toJSON(), messageId:message.id, conversationId:md.conversationKey || null, conversationKey:md.conversationKey || null, deleteFor }
    }).catch(()=>{});

    res.json({ success: true, message: 'Message deleted' });
  } catch (error) {
    console.error('Delete message error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.replyToParent = async (req, res) => {
    try {
        const { parentId, message, originalMessageId } = req.body;
        
        const reply = await Message.create({
            senderId: req.user.id,
            receiverId: parentId,
            content: message,
            metadata: {
                inReplyTo: originalMessageId,
                type: 'teacher_reply',
                teacherName: req.user.name
            }
        });
        
        await createAlert({
            userId: parentId,
            role: 'parent',
            type: 'message',
            severity: 'info',
            title: `📬 Reply from ${req.user.name}`,
            message: message.substring(0, 100) + (message.length > 100 ? '...' : ''),
            data: {
                teacherId: req.user.id,
                teacherName: req.user.name,
                messageId: reply.id
            }
        });
        
        if (global.io) {
            global.io.to(`user-${parentId}`).emit('new-message', {
                from: req.user.id,
                fromName: req.user.name,
                fromRole: 'teacher',
                content: message,
                timestamp: new Date()
            });
        }
        
        res.status(201).json({
            success: true,
            message: 'Reply sent successfully',
            data: reply
        });
        
    } catch (error) {
        console.error('Reply error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.getTodayDuty = async (userId) => {
  try {
    const teacher = await Teacher.findOne({ where: { userId } });
    if (!teacher) return null;

    const school = await School.findOne({ where: { schoolId: teacher.User?.schoolCode } });
    if (!school) return null;

    const today = new Date().toISOString().split('T')[0];
    
    const roster = await DutyRoster.findOne({
      where: { schoolId: school.schoolId, date: today }
    });

    if (roster && roster.duties) {
      const duty = roster.duties.find(d => d.teacherId === teacher.id);
      return duty || null;
    }
    return null;
  } catch (error) {
    console.error('Error getting today duty:', error);
    return null;
  }
};

exports.deleteStudent = async (req, res) => {
  try {
    const { studentId } = req.params;
    
    const teacher = await findTeacherInSchool(req.user.id, req.user.schoolCode);
    if (!teacher) {
      return res.status(404).json({ success: false, message: 'Teacher not found in this school' });
    }
    
    const student = await findStudentInSchool(studentId, req.user.schoolCode);
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found in this school' });
    }
    
    if (!(await teacherCanAccessStudentClass(teacher, student, req.user.schoolCode))) {
      return res.status(403).json({ success: false, message: 'This student is not assigned to your class' });
    }
    
    const studentName = student.User.name;
    
    await student.destroy();
    
    const admins = await User.findAll({ 
      where: { role: 'admin', schoolCode: req.user.schoolCode } 
    });
    
    for (const admin of admins) {
      await createAlert({
        userId: admin.id,
        role: 'admin',
        type: 'system',
        severity: 'info',
        title: 'Student Deleted',
        message: `Teacher ${req.user.name} removed student ${studentName} from class`,
        data: { teacherId: teacher.id, studentId }
      });
    }
    
    res.json({ success: true, message: 'Student removed from class successfully' });
  } catch (error) {
    console.error('Delete student error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============ NEW FUNCTIONS - FIXED ============

// @desc    Get teacher's assigned class
// @route   GET /api/teacher/my-class
// @access  Private/Teacher
exports.getMyClass = async (req, res) => {
  try {
    const teacher = await Teacher.findOne({ where: { userId: req.user.id } });
    if (!teacher) return res.status(404).json({ success: false, message: 'Teacher not found' });

    const classItem = await Class.findOne({
      where: { teacherId: teacher.id, schoolCode: req.user.schoolCode, isActive: true }
    });

    if (!classItem) {
      return res.json({ success: true, data: null });
    }

    const studentCount = await Student.unscoped().count({ where: { status:{ [Op.ne]:'inactive' }, ...v66StudentClassWhere(classItem) }, include: [{ model: User, where: { schoolCode: req.user.schoolCode }, attributes: [] }] });
    const classData = classItem.toJSON();
    classData.studentCount = studentCount;

    res.json({ success: true, data: classData });
  } catch (error) {
    console.error('Get my class error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};


// @desc    Get teacher's assigned subjects
// @route   GET /api/teacher/my-subjects
// @access  Private/Teacher
exports.getMySubjects = async (req, res) => {
  try {
    const teacher = await Teacher.findOne({ where: { userId: req.user.id } });
    if (!teacher) return res.status(404).json({ success: false, message: 'Teacher not found' });

    const assignments = await TeacherSubjectAssignment.findAll({
      where: { teacherId: teacher.id },
      include: [{ model: Class, required: false }],
      order: [['subject', 'ASC']]
    });

    const bySubject = new Map();
    for (const a of assignments) {
      const cls = a.Class;
      if (cls && cls.schoolCode !== req.user.schoolCode) continue;
      const subject = a.subject || 'General';
      if (!bySubject.has(subject)) bySubject.set(subject, { name: subject, classes: [] });
      bySubject.get(subject).classes.push({
        id: a.classId,
        name: cls?.name || `Class ${a.classId}`,
        grade: cls?.grade || '',
        stream: cls?.stream || '',
        isClassTeacher: !!a.isClassTeacher
      });
    }

    // Include the exact class-teacher assignment from the live class table.
    const classTeacherClasses = await Class.findAll({
      where: { schoolCode: req.user.schoolCode, isActive: true, [Op.or]: [{ teacherId: teacher.id }, { id: teacher.classId || 0 }] }
    });
    if (classTeacherClasses.length && !bySubject.has('Class Teacher')) bySubject.set('Class Teacher', { name: 'Class Teacher', classes: [] });
    for (const cls of classTeacherClasses) {
      bySubject.get('Class Teacher').classes.push({ id: cls.id, name: cls.name, grade: cls.grade, stream: cls.stream, isClassTeacher: true });
    }

    res.json({ success: true, data: Array.from(bySubject.values()) });
  } catch (error) {
    console.error('Get my subjects error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get teacher stats
// @route   GET /api/teacher/stats
// @access  Private/Teacher
exports.getTeacherStats = async (req, res) => {
  try {
    const teacher = await Teacher.findOne({ where: { userId: req.user.id } });
    if (!teacher) return res.status(404).json({ success: false, message: 'Teacher not found' });

    const assignedClasses = await v66AssignedClassesForTeacher(teacher, req.user.schoolCode);
    const students = await v66CurrentStudentsForClasses(assignedClasses, req.user.schoolCode, {
      userAttributes: ['id','name','profileImage','profilePicture']
    });

    const today = new Date().toISOString().split('T')[0];
    const attendanceToday = await Attendance.findAll({
      where: { studentId: { [Op.in]: students.map(s => s.id) }, date: today }
    });
    const presentToday = attendanceToday.filter(a => a.status === 'present').length;
    const attendanceTodayStr = `${presentToday}/${students.length}`;

    const pendingTasks = await Task.count({
      where: { userId: req.user.id, status: { [Op.ne]: 'completed' } }
    });

    let totalScore = 0, scoreCount = 0;
    for (const student of students) {
      const records = await AcademicRecord.findAll({ where: { studentId: student.id } });
      const avg = records.length ? records.reduce((a,b) => a + b.score, 0) / records.length : 0;
      totalScore += avg;
      scoreCount++;
    }
    const classAverage = scoreCount ? Math.round(totalScore / scoreCount) : 0;

    res.json({
      success: true,
      data: { studentCount: students.length, classAverage, attendanceToday: attendanceTodayStr, pendingTasks }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get students for a specific class (for marks entry)
// @route   GET /api/teacher/classes/:classId/students
// @access  Private/Teacher
exports.getClassStudents = async (req, res) => {
  try {
    const { Op } = require('sequelize');
    const { classId } = req.params;
    const teacher = await Teacher.findOne({ where: { userId: req.user.id } });
    if (!teacher) return res.status(404).json({ success: false, message: 'Teacher not found' });

    const classItem = await Class.findOne({ where: { id: classId, schoolCode: req.user.schoolCode, isActive: true } });
    if (!classItem) return res.status(404).json({ success: false, message: 'Class not found' });

    const subjectTeachers = Array.isArray(classItem.subjectTeachers) ? classItem.subjectTeachers : [];
    const isClassTeacher = String(classItem.teacherId) === String(teacher.id) || String(teacher.classTeacher || '').toLowerCase() === String(classItem.name || '').toLowerCase();
    const isSubjectTeacher = subjectTeachers.some(st => String(st.teacherId) === String(teacher.id));
    if (!isClassTeacher && !isSubjectTeacher) return res.status(403).json({ success: false, message: 'You do not have access to this class' });

    const userInclude = { model: User, attributes: ['id', 'name', 'email', 'phone', 'schoolCode'], where: { schoolCode: req.user.schoolCode }, required: true };
    const scoped = Student.unscoped ? Student.unscoped() : Student;
    const students = await scoped.findAll({
      where: {
        status: { [Op.ne]: 'inactive' },
        ...v66StudentClassWhere(classItem)
      },
      include: [userInclude],
      order: [['createdAt', 'ASC']],
      limit: 1000
    });

    res.json({
      success: true,
      data: students,
      meta: { classId: classItem.id, className: classItem.name, grade: classItem.grade, stream: classItem.stream, count: students.length }
    });
  } catch (error) {
    console.error('Get class students error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};


// @desc    Get one student visible to the teacher
// @route   GET /api/teacher/students/:studentId
// @access  Private/Teacher
exports.getTeacherStudentDetails = async (req, res) => {
  try {
    const teacher = await Teacher.findOne({ where: { userId: req.user.id } });
    if (!teacher) return res.status(404).json({ success: false, message: 'Teacher not found' });
    const student = await Student.findOne({
      where: { id: req.params.studentId, status: { [Op.ne]: 'inactive' } },
      include: [{ model: User, attributes: ['id','name','email','phone','profileImage','profilePicture','schoolCode'], where: { schoolCode: req.user.schoolCode }, required: true }]
    });
    if (!student) return res.status(404).json({ success: false, message: 'Student not found' });

    let classItem = null;
    if (student.classId) {
      classItem = await Class.findOne({ where: { id: student.classId, schoolCode: req.user.schoolCode, isActive: true } });
    } else if (student.grade) {
      classItem = await Class.findOne({
        where: {
          schoolCode: req.user.schoolCode,
          isActive: true,
          [Op.or]: [{ name: student.grade }, { grade: student.grade }]
        },
        order: [['id', 'ASC']]
      });
    }
    if (!classItem) return res.status(409).json({ success: false, message: 'This learner is not currently assigned to an active class' });

    const access = await v66CanEnterMarks(teacher, classItem, null, { allowAnyAssignedSubject: true });
    if (!access.allowed) {
      return res.status(403).json({ success: false, message: 'You can only view learners in your currently assigned classes' });
    }
    const isCurrentMember = await v66StudentIsActiveInClass(student.id, classItem, req.user.schoolCode);
    if (!isCurrentMember) {
      return res.status(409).json({ success: false, message: 'This learner is no longer active in that class. Historical records remain available through the authorised history view.' });
    }
    res.json({ success: true, data: student, meta: { classId: classItem.id, className: classItem.name } });
  } catch (error) {
    console.error('Get teacher student details error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Bulk upload students via CSV
// @route   POST /api/teacher/students/upload
// @access  Private/Teacher
// Superseded duplicate export removed: uploadStudentsCSV.

// @desc    Bulk save marks
// @route   POST /api/teacher/marks/bulk
// @access  Private/Teacher
// Superseded duplicate export removed: saveBulkMarks.

// @desc    Get teacher's assignments
// @route   GET /api/teacher/my-assignments
// @access  Private/Teacher

// @desc    Get students for a specific class and subject
// @route   GET /api/teacher/class-students
// @access  Private/Teacher
// Removed superseded duplicate export: getClassStudentsForSubject. The canonical implementation is defined later in this controller.

// @desc    Get teacher's subject performance and attendance trend
// @route   GET /api/teacher/performance
// @access  Private/Teacher
// Inside teacherController.js, add or update this method:

exports.getPerformanceData = async (req, res) => {
  try {
    const teacher = await Teacher.findOne({ where: { userId: req.user.id } });
    if (!teacher) return res.status(404).json({ success: false, message: 'Teacher not found' });

    const assignedClasses = await v66AssignedClassesForTeacher(teacher, req.user.schoolCode);
    if (!assignedClasses.length) {
      return res.json({ success: true, data: { subjectAverages: [], attendanceTrend: [] } });
    }

    const students = await v66CurrentStudentsForClasses(assignedClasses, req.user.schoolCode, { userAttributes:['id'] });
    const studentIds = students.map(s => s.id);

    const records = await AcademicRecord.findAll({ where: { studentId: { [Op.in]: studentIds } } });
    const subjectScores = {};
    records.forEach(rec => {
      if (!subjectScores[rec.subject]) subjectScores[rec.subject] = { total: 0, count: 0 };
      subjectScores[rec.subject].total += rec.score;
      subjectScores[rec.subject].count++;
    });
    const subjectAverages = Object.entries(subjectScores).map(([subject, data]) => ({ subject, average: Math.round(data.total / data.count) }));

    const startDate = moment().subtract(6, 'days').format('YYYY-MM-DD');
    const attendanceRecords = await Attendance.findAll({
      where: { studentId: { [Op.in]: studentIds }, date: { [Op.gte]: startDate } }
    });
    const dailyStats = {};
    for (let i = 0; i < 7; i++) {
      const date = moment().subtract(6 - i, 'days').format('YYYY-MM-DD');
      dailyStats[date] = { present: 0, total: 0 };
    }
    attendanceRecords.forEach(att => {
      if (dailyStats[att.date]) {
        dailyStats[att.date].total++;
        if (att.status === 'present') dailyStats[att.date].present++;
      }
    });
    const attendanceTrend = Object.entries(dailyStats).map(([date, stats]) => ({ date, rate: stats.total ? Math.round((stats.present / stats.total) * 100) : 0 }));

    res.json({ success: true, data: { subjectAverages, attendanceTrend } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Update a mark
// @route   PUT /api/teacher/marks/:recordId
// Superseded duplicate export removed: updateMark.

// @desc    Delete a mark
// @route   DELETE /api/teacher/marks/:recordId
exports.deleteMark = async (req, res) => {
  try {
    const { recordId } = req.params;
    const record = await AcademicRecord.findByPk(recordId);
    if (!record) return res.status(404).json({ success: false, message: 'Record not found' });
    if (record.schoolCode !== req.user.schoolCode) return res.status(403).json({ success:false, message:'Forbidden' });
    if (record.isPublished || ['published','locked'].includes(record.status)) return res.status(409).json({ success:false, message:'Published or locked marks cannot be deleted' });
    const teacher = await v3Teacher(req.user.id);
    if (!teacher) return res.status(404).json({ success:false, message:'Teacher not found' });
    const cls = record.classId ? await Class.findOne({ where:{ id:record.classId, schoolCode:req.user.schoolCode, isActive:true } }) : null;
    if (!cls) return res.status(404).json({ success:false, message:'Class not found for this mark' });
    const access = await v66CanEnterMarks(teacher, cls, record.subject);
    if (!access.isClassTeacher && Number(record.teacherId) !== Number(teacher.id)) return res.status(403).json({ success:false, message:'Only the original subject teacher or current class teacher can delete this draft mark' });
    if (!(await v66StudentIsActiveInClass(record.studentId, cls, req.user.schoolCode))) {
      return res.status(409).json({ success:false, message:'The learner has moved to another class. Historical marks are read-only and cannot be deleted.' });
    }
    await record.destroy();
    res.json({ success: true, message: 'Draft mark deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Download marks CSV template
// @route   GET /api/teacher/marks-template
exports.downloadMarksTemplate = (req, res) => {
  const template = `name,elimuid,subject,score,assessmentType,date,term,year,assessmentName\nJohn Doe,ELI-2024-001,Mathematics,85,exam,2024-03-15,Term 1,2024,Math Mid-Term`;
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=marks_template.csv');
  res.send(template);
};

// @desc    Get gradebook for teacher's class (all students with subject scores)
// @route   GET /api/teacher/gradebook
// @access  Private/Teacher
// Removed superseded duplicate export: getClassGradebook. The canonical implementation is defined later in this controller.

// @desc    Get attendance for a specific date
// @route   GET /api/teacher/attendance/:date
exports.getAttendanceForDate = async (req, res) => {
  try {
    const { date } = req.params;
    const teacher = await Teacher.findOne({ where: { userId: req.user.id } });
    if (!teacher) return res.status(404).json({ success: false, message: 'Teacher not found' });

    // Attendance management belongs to the currently assigned class teacher.
    const classes = await v66AssignedClassesForTeacher(teacher, req.user.schoolCode, { classTeacherOnly:true });
    const students = await v66CurrentStudentsForClasses(classes, req.user.schoolCode, { userAttributes:['id'] });
    const studentIds = students.map(s => s.id);

    const attendance = await Attendance.findAll({
      where: { studentId: { [Op.in]: studentIds }, date }
    });
    res.json({ success: true, data: attendance });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Add this method to teacherController.js
// Superseded duplicate export removed: publishMarks.

// ============ V3 OVERRIDES: role-correct students, CSV upload, draft/publish marks ============
async function v3Teacher(userId) { return Teacher.findOne({ where:{ userId }, include:[{ model:User, attributes:['id','name','email','phone','schoolCode'] }] }); }
function v3Access(teacher, cls, subject) { const isClassTeacher = Number(cls.teacherId) === Number(teacher.id); const isSubjectTeacher = (cls.subjectTeachers || []).some(a => Number(a.teacherId) === Number(teacher.id) && (!subject || String(a.subject).toLowerCase() === String(subject).toLowerCase())); return { isClassTeacher, isSubjectTeacher, allowed:isClassTeacher || isSubjectTeacher }; }
exports.uploadStudentsCSV = async (req,res) => {
  try {
    if (!req.files || !req.files.file) return res.status(400).json({ success:false, message:'No file uploaded' });
    const teacher = await v3Teacher(req.user.id); if (!teacher) return res.status(404).json({ success:false, message:'Teacher not found' });
    const classItem = await Class.findOne({ where:{ teacherId: teacher.id, schoolCode:req.user.schoolCode, isActive:true } });
    if (!classItem) return res.status(403).json({ success:false, message:'Only the assigned class teacher can upload students for that class' });
    await validateCsvUpload(req.files.file);
    const filePath = safeTempCsvPath(req.files.file.name); await req.files.file.mv(filePath);
    const rows=[], errors=[], elimuids=[];
    fs.createReadStream(filePath).pipe(csv()).on('data', r => rows.push(r)).on('end', async () => {
      let successCount=0;
      for (const row of rows) { try {
        const name = row.name || row.fullName || row.studentName; if (!name) { errors.push({ row, error:'Missing name' }); continue; }
        const user = await User.create({ name, email: row.email || null, phone: row.phone || null, password: generateTemporaryPassword(), role:'student', schoolCode:req.user.schoolCode, isActive:true, firstLogin:true });
        const student = await Student.create({ userId:user.id, schoolCode:req.user.schoolCode, classId:classItem.id, grade:classItem.name, dateOfBirth: row.dob || row.dateOfBirth || null, gender: row.gender || null, assessmentNumber: row.assessmentNumber || row.assessment_number || null, nemisNumber: row.nemisNumber || row.nemis_number || null, location: row.location || null, parentName: row.parentName || row.parent_name || null, parentEmail: row.parentEmail || row.parent_email || null, parentPhone: row.parentPhone || row.parent_phone || null, parentRelationship: row.parentRelationship || row.relationship || 'guardian', isPrefect: String(row.isPrefect || '').toLowerCase() === 'true' });
        await createEnrollmentForNewStudent({ student, classItem, schoolCode:req.user.schoolCode, actorId:req.user.id });
        elimuids.push({ name, elimuid:student.elimuid, assessmentNumber:student.assessmentNumber }); successCount++;
      } catch(err) { errors.push({ row, error:err.message }); } }
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      cache.flushSchoolCache(req.user.schoolCode);
      res.json({ success:true, message:`Class ${classItem.name}: success ${successCount}, failed ${errors.length}`, data:{ classId:classItem.id, className:classItem.name, successCount, failedCount:errors.length, elimuids, errors:errors.slice(0,20) } });
    }).on('error', err => { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); res.status(500).json({ success:false, message:err.message }); });
  } catch(error) { console.error('V3 CSV upload error:', error); res.status(500).json({ success:false, message:error.message }); }
};
// Superseded duplicate export removed: saveBulkMarks.
// Superseded duplicate export removed: publishMarks.


// ============ V66 STAGE 4F: CURRICULUM-SAFE MARKS + REPORT CARD ROLE LOGIC ============
async function v66SchoolMeta(schoolCode) {
  const school = await School.findOne({ where: { schoolId: schoolCode } });
  const system = school?.system || school?.curriculum || 'cbc';
  const level = school?.settings?.schoolLevel || 'secondary';
  const gradingScale = school?.settings?.gradingScale || null;
  return { school, system, level, gradingScale };
}
function v66LegacyClassNames(cls) {
  return [...new Set([
    cls?.name,
    cls?.grade,
    [cls?.grade, cls?.stream].filter(Boolean).join(' '),
    [cls?.name, cls?.stream].filter(Boolean).join(' ')
  ].map(value => String(value || '').trim()).filter(Boolean))];
}
function v66StudentClassWhere(cls) {
  const legacyNames = v66LegacyClassNames(cls);
  const clauses = [{ classId: cls.id }];
  // Legacy fallback is deliberately limited to rows that have never been linked
  // to a canonical class. A learner with classId set must never leak into another
  // stream merely because the old grade text happens to match.
  if (legacyNames.length) {
    clauses.push({
      [Op.and]: [
        { classId: null },
        { grade: { [Op.in]: legacyNames } }
      ]
    });
  }
  return { [Op.or]: clauses };
}
async function v66StudentIsActiveInClass(studentId, cls, schoolCode) {
  const scoped = Student.unscoped ? Student.unscoped() : Student;
  return !!(await scoped.findOne({
    where: {
      id: Number(studentId),
      status: { [Op.ne]: 'inactive' },
      ...v66StudentClassWhere(cls)
    },
    include: [{
      model: User,
      attributes: [],
      where: { schoolCode },
      required: true
    }],
    attributes: ['id']
  }));
}
async function v66AssignedClassesForTeacher(teacher, schoolCode, { classTeacherOnly = false } = {}) {
  const assignmentState = await v66JTeacherAssignments(teacher, schoolCode);
  const ids = new Set((assignmentState.classTeacherClasses || []).map(cls => Number(cls.id)));
  if (!classTeacherOnly) {
    for (const assignment of assignmentState.subjectAssignments || []) ids.add(Number(assignment.classId));
  }
  const classIds = [...ids].filter(Number.isInteger);
  if (!classIds.length) return [];
  return Class.findAll({ where: { id: { [Op.in]: classIds }, schoolCode, isActive: true }, order: [['name', 'ASC']] });
}
async function v66CurrentStudentsForClasses(classes, schoolCode, options = {}) {
  if (!Array.isArray(classes) || !classes.length) return [];
  const scoped = Student.unscoped ? Student.unscoped() : Student;
  return scoped.findAll({
    where: {
      status: { [Op.ne]: 'inactive' },
      [Op.or]: classes.map(cls => v66StudentClassWhere(cls))
    },
    include: [{
      model: User,
      attributes: options.userAttributes || ['id','name','email','phone','profileImage','profilePicture'],
      where: { schoolCode },
      required: true
    }],
    order: options.order || [['createdAt', 'ASC']],
    limit: options.limit || 2000
  });
}
function v66SubjectListForClass(cls) {
  const out = [];
  const add = (x) => { if (x && !out.some(v => String(v).toLowerCase() === String(x).toLowerCase())) out.push(String(x)); };
  (cls.subjectTeachers || []).forEach(st => add(st.subject));
  const settings = cls.settings || {};
  (settings.subjects || settings.subjectList || []).forEach(s => add(typeof s === 'string' ? s : s?.name || s?.subject));
  return out;
}
// Canonical marks permission helper is defined below after assignment resolution.


function v1508AssessmentKey(type, name) {
  return String(name || type || 'assessment').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'assessment';
}
function v1508AssessmentCategory(type) {
  const t = String(type || 'test').trim();
  return t || 'test';
}

exports.enterMarks = async (req, res) => {
  try {
    if(Object.prototype.hasOwnProperty.call(req.body||{},'gradingScale'))return res.status(400).json({success:false,code:'TEACHER_GRADING_SCALE_FORBIDDEN',message:'Teachers submit marks, competency evidence, and comments only. Grading profiles are admin-controlled.'});
    const { studentId, classId, subject, score, assessmentType='test', assessmentName, date, term='Term 1', year=new Date().getFullYear(), remarks='' } = req.body;
    const requestedStatus = ['submitted','draft'].includes(String(req.body.status || '').toLowerCase()) ? String(req.body.status).toLowerCase() : 'draft';
    if (!studentId || !subject) return res.status(400).json({ success:false, message:'studentId and subject are required' });
    const numericScore = Number(score);
    const maxScore=Number(req.body.maxScore || 100);
    if (!Number.isFinite(numericScore) || !Number.isFinite(maxScore) || maxScore <= 0 || maxScore > 100 || numericScore < 0 || numericScore > maxScore) return res.status(400).json({ success:false, message:'Score must be between 0 and the assessment maximum (up to 100)' });

    const teacher = await v3Teacher(req.user.id); if (!teacher) return res.status(404).json({ success:false, message:'Teacher not found' });
    const student = await Student.unscoped().findOne({ where:{ id: studentId }, include:[{ model:User, attributes:['id','name','schoolCode'] }] });
    if (!student || (student.User?.schoolCode && student.User.schoolCode !== req.user.schoolCode)) return res.status(404).json({ success:false, message:'Student not found in this school' });

    let cls = null;
    if (classId) cls = await Class.findOne({ where:{ id:classId, schoolCode:req.user.schoolCode, isActive:true } });
    if (!cls && student.classId) cls = await Class.findOne({ where:{ id:student.classId, schoolCode:req.user.schoolCode, isActive:true } });
    if (!cls && !student.classId && student.grade) cls = await Class.findOne({ where:{ schoolCode:req.user.schoolCode, isActive:true, [Op.or]: [{ name: student.grade }, { grade: student.grade }] }, order:[['id','ASC']] });
    if (!cls) return res.status(404).json({ success:false, message:'Class not found for this student' });
    if (!(await v66StudentIsActiveInClass(student.id, cls, req.user.schoolCode))) {
      return res.status(409).json({ success:false, message:'This learner is no longer active in the selected class. Refresh the class list before entering marks.' });
    }

    const access = await v66CanEnterMarks(teacher, cls, subject);
    if (!access.allowed) return res.status(403).json({ success:false, message:'You can only enter marks for your assigned subject/class' });

    const meta = await v66SchoolMeta(req.user.schoolCode);
    const normalizedAssessmentName = assessmentName || `${subject} ${assessmentType}`;
    const assessmentKey = req.body.assessmentKey || v1508AssessmentKey(assessmentType, normalizedAssessmentName);
    const assessmentCategory = req.body.assessmentCategory || v1508AssessmentCategory(assessmentType);
    const where = { studentId, schoolCode:req.user.schoolCode, subject, assessmentKey, term, year:Number(year) };
    let graded=await gradingEngine.gradeNewAssessment({studentId,classId:cls.id,subject,assessmentType,rawMark:numericScore,maxScore,competencyEvidence:req.body.competencyEvidence||null,assessmentDate:date||new Date()});
    let grade=graded.result.grade;
    const [record, created] = await AcademicRecord.findOrCreate({
      where,
      defaults: {
        ...where,
        assessmentType,
        assessmentName: normalizedAssessmentName,
        assessmentCategory,
        maxScore,
        assessmentWeight: req.body.assessmentWeight == null ? null : Number(req.body.assessmentWeight),
        showOnReport: req.body.showOnReport !== false,
        countInFinal: req.body.countInFinal !== false,
        displayOrder: Number(req.body.displayOrder || 0),
        score: numericScore,
        grade,
        remarks,
        teacherId: teacher.id,
        date: date || new Date(),
        classId: cls.id,
        curriculum: meta.system,
        ...graded.persistence,
        status: requestedStatus,
        isPublished: false
      }
    });
    if (!created) {
      if (record.isPublished || record.status === 'published' || record.status === 'locked') return res.status(409).json({ success:false, message:'Published marks cannot be edited. Ask admin/class teacher for correction workflow.' });
      graded=await gradingEngine.gradeDraftUpdate({record,rawMark:numericScore,maxScore,competencyEvidence:req.body.competencyEvidence||record.competencyEvidence});
      grade=graded.result.grade;
      await record.update({ score:numericScore, ...graded.persistence, remarks, teacherId:teacher.id, date:date || record.date, classId:cls.id, assessmentType, assessmentName:normalizedAssessmentName, assessmentCategory, maxScore, assessmentWeight:req.body.assessmentWeight == null ? record.assessmentWeight : Number(req.body.assessmentWeight), showOnReport:req.body.showOnReport !== false, countInFinal:req.body.countInFinal !== false, displayOrder:Number(req.body.displayOrder || record.displayOrder || 0), status: requestedStatus });
    }
    res.status(created ? 201 : 200).json({ success:true, data:record, meta:{ curriculumPackId:record.curriculumPackId, curriculumVersion:record.curriculumPackVersion, gradingProfileCode:record.gradingProfileCode, grade, isClassTeacher:access.isClassTeacher, isSubjectTeacher:access.isSubjectTeacher } });
  } catch (error) {
    console.error('V66 enter marks error:', error);
    res.status(error.statusCode||500).json({ success:false, message:error.message, code:error.code||'MARK_ENTRY_FAILED' });
  }
};

exports.saveBulkMarks = async (req,res) => {
  try {
    if(Object.prototype.hasOwnProperty.call(req.body||{},'gradingScale'))return res.status(400).json({success:false,code:'TEACHER_GRADING_SCALE_FORBIDDEN',message:'Teachers cannot submit a grading scale.'});
    const { classId, subject, assessmentType='test', assessmentName, date, marks=[], term='Term 1', year=new Date().getFullYear() } = req.body;
    const requestedStatus = ['submitted','draft'].includes(String(req.body.status || '').toLowerCase()) ? String(req.body.status).toLowerCase() : 'draft';
    const teacher = await v3Teacher(req.user.id); if (!teacher) return res.status(404).json({ success:false, message:'Teacher not found' });
    const cls = await Class.findOne({ where:{ id:classId, schoolCode:req.user.schoolCode, isActive:true } }); if (!cls) return res.status(404).json({ success:false, message:'Class not found' });
    const access = await v66CanEnterMarks(teacher, cls, subject); if (!access.allowed) return res.status(403).json({ success:false, message:'You can only enter marks for your assigned subject/class' });
    const meta = await v66SchoolMeta(req.user.schoolCode);
    const normalizedAssessmentName = assessmentName || `${subject} ${assessmentType}`;
    const assessmentKey = req.body.assessmentKey || v1508AssessmentKey(assessmentType, normalizedAssessmentName);
    const assessmentCategory = req.body.assessmentCategory || v1508AssessmentCategory(assessmentType);
    const requestedStudentIds = [...new Set((marks || []).map(mark => Number(mark.studentId)).filter(Number.isInteger))];
    const scoped = Student.unscoped ? Student.unscoped() : Student;
    const currentStudents = requestedStudentIds.length ? await scoped.findAll({
      where: {
        id: { [Op.in]: requestedStudentIds },
        status: { [Op.ne]: 'inactive' },
        ...v66StudentClassWhere(cls)
      },
      include: [{ model: User, attributes: [], where: { schoolCode: req.user.schoolCode }, required: true }],
      attributes: ['id']
    }) : [];
    const currentStudentIds = new Set(currentStudents.map(student => Number(student.id)));
    let saved=0, failed=0; const results=[];
    for (const m of marks) {
      try {
        if (!currentStudentIds.has(Number(m.studentId))) throw new Error('Student is no longer active in this class. Refresh the class list.');
        const score=Number(m.score),maxScore=Number(req.body.maxScore||100); if (!Number.isFinite(score)||!Number.isFinite(maxScore)||maxScore<=0||maxScore>100||score<0||score>maxScore) throw new Error('Score must be between 0 and the assessment maximum (up to 100)');
        const where = { studentId:m.studentId, schoolCode:req.user.schoolCode, subject, assessmentKey, term, year:Number(year) };
        let graded=await gradingEngine.gradeNewAssessment({studentId:m.studentId,classId:cls.id,subject,assessmentType,rawMark:score,maxScore,competencyEvidence:m.competencyEvidence||null,assessmentDate:date||new Date()});
        let grade=graded.result.grade;
        const [record,created]=await AcademicRecord.findOrCreate({ where, defaults:{ ...where, assessmentType, assessmentName:normalizedAssessmentName, assessmentCategory, maxScore, assessmentWeight:req.body.assessmentWeight == null ? null : Number(req.body.assessmentWeight), showOnReport:req.body.showOnReport !== false, countInFinal:req.body.countInFinal !== false, displayOrder:Number(req.body.displayOrder || 0), score, grade, ...graded.persistence, remarks:m.remarks || '', teacherId:teacher.id, date:date||new Date(), classId:cls.id, status:requestedStatus, isPublished:false } });
        if (!created) { if (record.isPublished || record.status === 'published' || record.status === 'locked') throw new Error('Published marks cannot be edited'); graded=await gradingEngine.gradeDraftUpdate({record,rawMark:score,maxScore,competencyEvidence:m.competencyEvidence||record.competencyEvidence}); grade=graded.result.grade; await record.update({ score, ...graded.persistence, remarks:m.remarks || record.remarks || '', teacherId:teacher.id, date:date||record.date, classId:cls.id, assessmentType, assessmentName:normalizedAssessmentName, assessmentCategory, maxScore, assessmentWeight:req.body.assessmentWeight == null ? record.assessmentWeight : Number(req.body.assessmentWeight), showOnReport:req.body.showOnReport !== false, countInFinal:req.body.countInFinal !== false, displayOrder:Number(req.body.displayOrder || record.displayOrder || 0), status: requestedStatus }); }
        saved++; results.push({ studentId:m.studentId, success:true, recordId:record.id, grade });
      } catch(err){ failed++; results.push({ studentId:m.studentId, success:false, error:err.message }); }
    }
    res.json({ success:true, message:`Saved ${saved} draft mark(s). Class teacher publishes final report-card marks.`, data:{ saved, failed, results, curriculum:meta.system, schoolLevel:meta.level } });
  } catch(error) { console.error('V66 save bulk marks error:', error); res.status(500).json({ success:false, message:error.message }); }
};

// Superseded duplicate export removed: publishMarks.


// Removed superseded duplicate export: getClassGradebook. The canonical implementation is defined later in this controller.


// ============ V66_STAGE_4J_ASSIGNMENT_MARKS_WORKFLOW_FIX ============
function v66JNorm(x) { return String(x || '').trim().toLowerCase(); }
function v66JSame(a,b) { return v66JNorm(a) === v66JNorm(b); }
function v66JUnique(arr, key = x => String(x || '').toLowerCase()) {
  const seen = new Set(); const out = [];
  for (const item of arr || []) { const k = key(item); if (!k || seen.has(k)) continue; seen.add(k); out.push(item); }
  return out;
}
async function v66JTeacherAssignments(teacher, schoolCode) {
  const classes = await Class.findAll({ where: { schoolCode, isActive: true }, order: [['name', 'ASC']] });
  const rows = await TeacherSubjectAssignment.findAll({
    where: { teacherId: teacher.id },
    include: [{ model: Class, required: false }]
  }).catch(() => []);
  const tableAssignments = rows
    .filter(a => !a.Class || a.Class.schoolCode === schoolCode)
    .map(a => ({ classId: Number(a.classId), subject: a.subject, isClassTeacher: !!a.isClassTeacher, source: 'TeacherSubjectAssignments' }));

  const jsonAssignments = [];
  for (const cls of classes) {
    for (const st of (Array.isArray(cls.subjectTeachers) ? cls.subjectTeachers : [])) {
      if (Number(st.teacherId) === Number(teacher.id)) {
        jsonAssignments.push({ classId: Number(cls.id), subject: st.subject, isClassTeacher: !!st.isClassTeacher, source: 'Class.subjectTeachers' });
      }
    }
  }

  // Class-teacher assignment can come from several historical sources:
  // Class.teacherId, Teacher.classId/classTeacher, TeacherSubjectAssignments.isClassTeacher,
  // or Class.subjectTeachers entries flagged as isClassTeacher. Keep all of them aligned so
  // My Students, inline marks, attendance, and publish use the exact same class scope.
  const classTeacherIds = new Set();
  classes.forEach(cls => {
    if (Number(cls.teacherId) === Number(teacher.id)) classTeacherIds.add(Number(cls.id));
    if (Number(cls.id) === Number(teacher.classId || 0)) classTeacherIds.add(Number(cls.id));
    if (v66JSame(cls.name, teacher.classTeacher)) classTeacherIds.add(Number(cls.id));
  });
  tableAssignments.filter(a => a.isClassTeacher).forEach(a => classTeacherIds.add(Number(a.classId)));
  jsonAssignments.filter(a => a.isClassTeacher).forEach(a => classTeacherIds.add(Number(a.classId)));
  const classTeacherClasses = classes.filter(cls => classTeacherIds.has(Number(cls.id)));

  const subjectAssignments = v66JUnique([...tableAssignments, ...jsonAssignments], a => `${a.classId}:${v66JNorm(a.subject)}`)
    .map(a => {
      const cls = classes.find(c => Number(c.id) === Number(a.classId));
      return cls ? { ...a, classId: cls.id, className: cls.name, grade: cls.grade, stream: cls.stream } : null;
    })
    .filter(Boolean);

  return { classes, subjectAssignments, classTeacherClasses };
}

// Replace assignment feed so assigned subjects/classes reflect correctly in teacher dashboard.
exports.getMyAssignments = async (req, res) => {
  try {
    const teacher = await v3Teacher(req.user.id);
    if (!teacher) return res.status(404).json({ success:false, message:'Teacher not found' });
    const { subjectAssignments, classTeacherClasses } = await v66JTeacherAssignments(teacher, req.user.schoolCode);
    const byClass = new Map();
    const classTeacher = classTeacherClasses[0] || null;

    for (const cls of classTeacherClasses) {
      byClass.set(String(cls.id), { id:cls.id, name:cls.name, grade:cls.grade, stream:cls.stream, role:'class_teacher', subjects:v66SubjectListForClass(cls) });
    }
    for (const a of subjectAssignments) {
      if (!byClass.has(String(a.classId))) byClass.set(String(a.classId), { id:a.classId, name:a.className, grade:a.grade, stream:a.stream, role:'subject_teacher', subjects:[] });
      const row = byClass.get(String(a.classId));
      if (a.subject && !row.subjects.some(s => v66JSame(s, a.subject))) row.subjects.push(a.subject);
    }

    const subjects = subjectAssignments.map(a => ({
      classId:a.classId,
      className:a.className,
      grade:a.grade,
      stream:a.stream,
      subject:a.subject,
      role:'subject_teacher',
      isClassTeacher: classTeacherClasses.some(c => Number(c.id) === Number(a.classId))
    }));

    res.json({ success:true, data:{
      teacherId: teacher.id,
      teacherName: teacher.User?.name,
      department: teacher.department || '',
      role: classTeacher ? 'class_teacher' : 'subject_teacher',
      classTeacher: classTeacher ? { id:classTeacher.id, name:classTeacher.name, grade:classTeacher.grade, stream:classTeacher.stream, subjects:v66SubjectListForClass(classTeacher) } : null,
      classes:[...byClass.values()],
      subjects
    }});
  } catch(error) { console.error('V66J get assignments error:', error); res.status(500).json({ success:false, message:error.message }); }
};

// Canonical marks permission: class teachers own class-wide actions; subject teachers are limited to explicit assigned subjects.
const v66CanEnterMarks = async (teacher, cls, subject, options = {}) => {
  const { subjectAssignments, classTeacherClasses } = await v66JTeacherAssignments(teacher, cls.schoolCode || teacher.User?.schoolCode);
  const isClassTeacher = classTeacherClasses.some(c => Number(c.id) === Number(cls.id));
  const assignedSubjects = subjectAssignments
    .filter(a => Number(a.classId) === Number(cls.id))
    .map(a => String(a.subject || '').trim())
    .filter(Boolean);
  const isSubjectTeacher = Boolean(subject) && assignedSubjects.some(s => v66JSame(s, subject));
  const hasClassAssignment = assignedSubjects.length > 0;
  const allowed = isClassTeacher || isSubjectTeacher || (options.allowAnyAssignedSubject === true && hasClassAssignment);
  return { allowed, isClassTeacher, isSubjectTeacher, hasClassAssignment, assignedSubjects };
};

// Class gradebook now returns editable record IDs and recalculated values.
// Removed superseded duplicate export: getClassGradebook. The canonical implementation is defined later in this controller.

// Class teacher can edit unpublished marks before publishing; subject teacher can edit their own unpublished marks.
exports.updateMark = async (req, res) => {
  try {
    const { recordId } = req.params;
    const { score, remarks } = req.body;
    if(Object.prototype.hasOwnProperty.call(req.body||{},'gradingScale'))return res.status(400).json({success:false,code:'TEACHER_GRADING_SCALE_FORBIDDEN',message:'Teachers cannot submit a grading scale.'});
    const record = await AcademicRecord.unscoped().findByPk(recordId);
    if (!record) return res.status(404).json({ success:false, message:'Record not found' });
    if (record.schoolCode !== req.user.schoolCode) return res.status(403).json({ success:false, message:'Forbidden' });
    if (record.isPublished || record.status === 'published' || record.status === 'locked') return res.status(409).json({ success:false, message:'Published marks cannot be edited here' });
    const teacher = await v3Teacher(req.user.id); if (!teacher) return res.status(404).json({ success:false, message:'Teacher not found' });
    const cls = record.classId ? await Class.findOne({ where:{ id:record.classId, schoolCode:req.user.schoolCode, isActive:true } }) : null;
    if (!cls) return res.status(404).json({ success:false, message:'Class not found for this mark' });
    const access = await v66CanEnterMarks(teacher, cls, record.subject);
    if (!access.isClassTeacher && Number(record.teacherId) !== Number(teacher.id)) return res.status(403).json({ success:false, message:'Only the original subject teacher or class teacher can edit this mark before publish' });
    if (!(await v66StudentIsActiveInClass(record.studentId, cls, req.user.schoolCode))) {
      return res.status(409).json({ success:false, message:'The learner has moved to another class. This mark is now historical and read-only; use the audited admin correction workflow if a correction is required.' });
    }
    const numericScore = Number(score);
    if (!Number.isFinite(numericScore) || numericScore < 0 || numericScore > 100) return res.status(400).json({ success:false, message:'Score must be between 0 and 100' });
    const graded=await gradingEngine.gradeDraftUpdate({record,rawMark:numericScore,maxScore:req.body.maxScore||record.maxScore||100,competencyEvidence:req.body.competencyEvidence||record.competencyEvidence});
    await record.update({ score:numericScore, ...graded.persistence, remarks: remarks !== undefined ? remarks : record.remarks, status:'submitted' });
    res.json({ success:true, data:record, meta:{ grade:graded.result.grade, gradingProfileCode:record.gradingProfileCode, curriculumVersion:record.curriculumPackVersion } });
  } catch(error) { console.error('V66J update mark error:', error); res.status(error.statusCode||500).json({ success:false, message:error.message, code:error.code||'MARK_UPDATE_FAILED' }); }
};

// Superseded duplicate export removed: publishMarks.


// ============ V66_STAGE_4K_REPORT_ARCHIVE_AND_SAFE_TEACHER_CHAT_FIX ============
function v66KChecksum(obj) {
  return crypto.createHash('sha256').update(JSON.stringify(obj || {})).digest('hex');
}
async function v66KBuildStudentTermReportSnapshot({ student, records, meta, cls, term, year }) {
  const bySubject = {};
  for (const rec of records || []) {
    const subject = rec.subject || 'Subject';
    if (!bySubject[subject]) bySubject[subject] = [];
    bySubject[subject].push(rec);
  }
  const subjects = Object.entries(bySubject).map(([subject, rows]) => {
    const avg = rows.length ? Math.round(rows.reduce((sum, r) => sum + Number(r.score || 0), 0) / rows.length) : null;
    return {
      subject,
      average: avg,
      grade: avg == null ? null : getGradeFromScore(avg, meta.system, meta.level, meta.gradingScale),
      status: rows.some(r => r.status === 'published' || r.isPublished) ? 'published' : 'submitted',
      assessments: rows.map(r => ({
        id: r.id,
        assessmentType: r.assessmentType,
        assessmentName: r.assessmentName,
        score: Number(r.score || 0),
        grade: r.grade || getGradeFromScore(Number(r.score || 0), meta.system, meta.level, meta.gradingScale),
        remarks: r.remarks || '',
        teacherId: r.teacherId,
        date: r.date,
        status: r.status || (r.isPublished ? 'published' : 'draft')
      }))
    };
  }).sort((a, b) => a.subject.localeCompare(b.subject));
  const vals = subjects.map(s => s.average).filter(v => v !== null && Number.isFinite(Number(v)));
  const overallAverage = vals.length ? Math.round(vals.reduce((a, b) => a + Number(b), 0) / vals.length) : null;
  return {
    student: {
      id: student.id,
      name: student.User?.name || student.name || 'Student',
      elimuid: student.elimuid || null,
      admissionNumber: student.admissionNumber || null,
      grade: student.grade || cls?.name || null,
      classId: cls?.id || student.classId || null,
      className: cls?.name || student.grade || null
    },
    class: cls ? { id: cls.id, name: cls.name, grade: cls.grade, stream: cls.stream } : null,
    term,
    year: Number(year),
    curriculum: meta.system,
    schoolLevel: meta.level,
    subjects,
    overallAverage,
    overallGrade: overallAverage == null ? null : getGradeFromScore(overallAverage, meta.system, meta.level, meta.gradingScale),
    generatedAt: new Date().toISOString(),
    analyticsReady: true
  };
}

// Final publisher: publishes marks AND saves locked term report snapshots for later dropdown/history/analytics use.
// Superseded duplicate export removed: publishMarks.

// Saved reports for class-teacher dropdown/history.
exports.listClassReportSnapshots = async (req, res) => {
  try {
    const { classId, term, year } = req.query;
    const teacher = await v3Teacher(req.user.id); if (!teacher) return res.status(404).json({ success:false, message:'Teacher not found' });
    const numericClassId = Number(classId);
    if (!Number.isInteger(numericClassId) || numericClassId <= 0) return res.status(400).json({ success:false, message:'classId is required before loading saved class reports.' });
    const cls = await Class.findOne({ where:{ id:numericClassId, schoolCode:req.user.schoolCode, [Op.or]:[{ isActive:true }, { isActive:null }] } }); if (!cls) return res.status(404).json({ success:false, message:'Class not found' });
    const access = await v66CanEnterMarks(teacher, cls, null);
    if (!access.isClassTeacher) return res.status(403).json({ success:false, message:'Only the class teacher can view saved reports for this class' });
    const students = await Student.unscoped().findAll({ where:v66StudentClassWhere(cls), attributes:['id'] });
    const where = { schoolCode:req.user.schoolCode, studentId:{ [Op.in]:students.map(s=>s.id) }, reportType:'academic', status:'published' };
    if (term) where.term = term;
    if (year) where.year = Number(year);
    const rows = await ReportSnapshot.findAll({ where, order:[['year','DESC'],['term','DESC'],['updatedAt','DESC']], limit:300 });
    res.json({ success:true, data: rows.map(r => ({ id:r.id, studentId:r.studentId, term:r.term, year:r.year, curriculum:r.curriculum, publishedAt:r.publishedAt, classId:r.classId || r.metadata?.classId, className:r.metadata?.className, overallAverage:r.snapshot?.overallAverage, overallGrade:r.snapshot?.overallGrade, studentName:r.snapshot?.student?.name })) });
  } catch(error) { console.error('V66K list class reports error:', error); res.status(500).json({ success:false, message:error.message }); }
};

// ============ V102 LOCKED CURRICULUM-AWARE GRADING + REPORT-CARD ROWS ============
const v102CurriculumEngine = require('../services/curriculumStructureEngine');
const v102StudentSubjectSelectionService = require('../services/studentSubjectSelectionService');

async function v102School(schoolCode) {
  return School.findOne({ where: { schoolId: schoolCode } });
}

async function v102SelectionsForStudents({ schoolCode, studentIds, classId }) {
  if (!studentIds.length) return [];
  const [rows] = await sequelize.query(`
    SELECT * FROM "StudentSubjectSelections"
     WHERE "schoolCode" = :schoolCode
       AND "studentId" IN (:studentIds)
       AND (:classId::int IS NULL OR "classId" = :classId)
  `, { replacements:{ schoolCode, studentIds, classId: classId || null } }).catch(() => [[]]);
  return rows || [];
}

function v102ShouldShowStudentForSubject({ subject, subjectMeta, selections }) {
  if (!subject) return true;
  const match = (selections || []).find(s => String(s.subjectName || '').toLowerCase() === String(subject).toLowerCase());
  if (match) return !['not_taken','exempted','not_offered','pending_rejected'].includes(String(match.status || '').toLowerCase());
  // Strict V103 rule: core/compulsory subjects apply to all students by default; electives/pathway subjects require explicit student selection.
  return !!subjectMeta?.isCore;
}

exports.getClassStudentsForSubject = async (req, res) => {
  try {
    const { classId, subject } = req.query;
    const teacher = await v3Teacher(req.user.id);
    if (!teacher) return res.status(404).json({ success:false, message:'Teacher not found' });
    const classItem = await Class.findOne({ where:{ id:classId, schoolCode:req.user.schoolCode, isActive:true } });
    if (!classItem) return res.status(404).json({ success:false, message:'Class not found' });
    const access = await v66CanEnterMarks(teacher, classItem, subject);
    if (!access.allowed) return res.status(403).json({ success:false, message:'You are not assigned to teach this subject in this class' });
    const school = await v102School(req.user.schoolCode);
    const eligibleSubjects = school ? v102CurriculumEngine.getEligibleSubjectsForClass(school, classItem) : [];
    const subjectMeta = eligibleSubjects.find(s => String(s.name).toLowerCase() === String(subject || '').toLowerCase()) || null;
    const students = await Student.unscoped().findAll({ where:v66StudentClassWhere(classItem), include:[{ model:User, attributes:['id','name','email'] }], order:[[User,'name','ASC']] });
    const selections = await v102SelectionsForStudents({ schoolCode:req.user.schoolCode, studentIds:students.map(s => s.id), classId:classItem.id });
    const anySelectionsForClass = selections.length > 0;
    const byStudent = new Map();
    for (const sel of selections) { const key=String(sel.studentId); if (!byStudent.has(key)) byStudent.set(key, []); byStudent.get(key).push(sel); }
    const formattedStudents = students
      .filter(s => v102ShouldShowStudentForSubject({ subject, subjectMeta, selections:byStudent.get(String(s.id)) || [] }))
      .map(s => ({ id:s.id, userId:s.userId, name:s.User?.name || 'Unknown', elimuid:s.elimuid, grade:s.grade, classId:s.classId, subjectStatus:(byStudent.get(String(s.id)) || []).find(x => String(x.subjectName).toLowerCase() === String(subject || '').toLowerCase())?.status || (subjectMeta?.isCore ? 'taking_core' : 'not_selected') }));
    res.json({ success:true, data:{ classId:classItem.id, className:classItem.name, grade:classItem.grade, subject, subjectMeta, students:formattedStudents, studentCount:formattedStudents.length, selectionMode:'curriculum_strict' } });
  } catch(error) { console.error('V102 class students for subject error:', error); res.status(500).json({ success:false, message:error.message }); }
};

exports.getClassGradebook = async (req, res) => {
  try {
    const { classId, term='Term 1', year=new Date().getFullYear(), assessmentType, assessmentName } = req.query;
    const teacher = await v3Teacher(req.user.id); if (!teacher) return res.status(404).json({ success:false, message:'Teacher not found' });
    const cls = classId ? await Class.findOne({ where:{ id:classId, schoolCode:req.user.schoolCode, isActive:true } }) : null;
    if (!cls) return res.status(404).json({ success:false, message:'Class not found' });
    const access = await v66CanEnterMarks(teacher, cls, null);
    if (!access.isClassTeacher) return res.status(403).json({ success:false, message:'Only the class teacher can review the full class report' });
    const meta = await v66SchoolMeta(req.user.schoolCode);
    const school = await v102School(req.user.schoolCode);
    const students = await Student.unscoped().findAll({ where:v66StudentClassWhere(cls), include:[{ model:User, attributes:['id','name','profileImage'] }], order:[['createdAt','ASC']] });
    const ids = students.map(s => s.id);
    const where = { schoolCode:req.user.schoolCode, studentId:{ [Op.in]:ids }, term, year:Number(year) };
    if (assessmentType) where.assessmentType = assessmentType;
    if (assessmentName) where.assessmentName = assessmentName;
    const records = await AcademicRecord.findAll({ where, order:[['subject','ASC'],['assessmentName','ASC'],['createdAt','DESC']] });
    const eligibleSubjects = school ? v102CurriculumEngine.getEligibleSubjectsForClass(school, cls) : [];
    const subjects = eligibleSubjects.sort((a,b) => (a.order||99)-(b.order||99) || a.name.localeCompare(b.name));
    const selections = await v102SelectionsForStudents({ schoolCode:req.user.schoolCode, studentIds:ids, classId:cls.id });
    const byStudentSel = new Map();
    for (const sel of selections) { const key=String(sel.studentId); if (!byStudentSel.has(key)) byStudentSel.set(key, []); byStudentSel.get(key).push(sel); }
    const data = students.map(st => {
      const recs = records.filter(r => Number(r.studentId) === Number(st.id));
      const reportRows = v102CurriculumEngine.buildSubjectRowsForReport({ school, classItem:cls, student:st, records:recs, studentSubjectSelections:byStudentSel.get(String(st.id)) || [] });
      const rowByName = new Map(reportRows.map(r => [String(r.subject).toLowerCase(), r]));
      const scores = {}; const recordIds = {}; const grades = {}; const statuses = {}; const counted = {};
      subjects.forEach(sub => {
        const rows = recs.filter(r => v66JSame(r.subject, sub.name));
        const rr = rowByName.get(String(sub.name).toLowerCase());
        scores[sub.name] = rr ? rr.score : (rows.length ? Math.round(rows.reduce((a,b)=>a+Number(b.score||0),0)/rows.length) : null);
        recordIds[sub.name] = rows[0]?.id || null;
        grades[sub.name] = scores[sub.name] == null ? null : getGradeFromScore(scores[sub.name], meta.system, meta.level, meta.gradingScale);
        statuses[sub.name] = rr?.status || (rows.length ? (rows[0].status || 'submitted') : 'Pending');
        counted[sub.name] = !!rr?.counted;
      });
      const summary = v102CurriculumEngine.summarizeReportRows(reportRows);
      const finalGrade = summary.average == null ? null : getGradeFromScore(summary.average, meta.system, meta.level, meta.gradingScale);
      return { id:st.id, name:st.User?.name || 'Student', elimuid:st.elimuid, admissionNumber:st.admissionNumber, scores, recordIds, grades, statuses, counted, overallAverage:summary.average, finalGrade, reportRows, missingSubjects:reportRows.filter(r => r.status === 'Pending').map(r => r.subject), notTakenSubjects:reportRows.filter(r => r.status === 'Not Taken').map(r => r.subject) };
    });
    res.json({ success:true, data:{ classId:cls.id, className:cls.name, subjects:subjects.map(s => s.name), subjectMeta:subjects, students:data, canPublish:true, curriculum:meta.system, schoolLevel:meta.level, gradingProfile:v102CurriculumEngine.getGradingProfile(meta.system, cls.levelCode || v102CurriculumEngine.levelCodeFromGrade(meta.system, cls.grade || cls.name)), term, year:Number(year) } });
  } catch(error) { console.error('V102 gradebook error:', error); res.status(500).json({ success:false, message:error.message }); }
};

async function v102BuildStudentTermReportSnapshot({ student, records, meta, cls, term, year }) {
  const school = await v102School(cls.schoolCode || meta.school?.schoolId);
  const selections = await v102StudentSubjectSelectionService.listStudentSubjectSelections({ schoolCode: cls.schoolCode || meta.school?.schoolId, studentId: student.id, classId: cls.id }).catch(() => []);
  const reportRows = v102CurriculumEngine.buildSubjectRowsForReport({ school, classItem: cls, student, records, studentSubjectSelections: selections });
  const subjects = reportRows.map(row => {
    const avg = row.score;
    return {
      subject: row.subject,
      average: avg,
      grade: avg == null ? null : getGradeFromScore(avg, meta.system, meta.level, meta.gradingScale),
      status: row.status,
      counted: row.counted,
      category: row.category,
      pathway: row.pathway,
      track: row.track,
      assessments: (row.assessments || []).map(r => ({ id:r.id, assessmentType:r.assessmentType, assessmentName:r.assessmentName, score:Number(r.score || 0), grade:r.grade || getGradeFromScore(Number(r.score || 0), meta.system, meta.level, meta.gradingScale), remarks:r.remarks || '', teacherId:r.teacherId, date:r.date, status:r.status || (r.isPublished ? 'published' : 'draft') }))
    };
  });
  const summary = v102CurriculumEngine.summarizeReportRows(reportRows);
  const classTeacher = cls?.teacherId ? await Teacher.findByPk(cls.teacherId, { include:[{ model:User, attributes:['id','name','preferences'] }] }).catch(() => null) : null;
  const adminSigner = await Admin.findOne({ include:[{ model:User, attributes:['id','name','preferences'], where:{ schoolCode:cls.schoolCode, role:'admin', isActive:true }, required:true }], order:[['updatedAt','DESC']] }).catch(() => null);
  const safeSignature = (profile, user) => user?.preferences?.signatureDataUrl || profile?.signatureUrl || profile?.signature || user?.preferences?.signatureUrl || '';
  const attendance = await Attendance.findAll({ where:{ schoolCode:cls.schoolCode, studentId:student.id }, attributes:['status'] }).catch(() => []);
  const present = attendance.filter(row => row.status === 'present').length;
  const absent = attendance.filter(row => row.status === 'absent').length;
  const late = attendance.filter(row => row.status === 'late').length;
  const fee = await Fee.findOne({ where:{ studentId:student.id, status:{ [Op.ne]:'paid' } }, order:[['updatedAt','DESC']] }).catch(() => null);
  const branding = school?.settings?.branding || {};
  const schoolLogo = branding.logoDataUrl || branding.logoUrl || branding.logo || school?.settings?.logo || null;
  const studentPhoto = student.User?.profileImage || student.profileImage || student.photo || null;
  let snapshot = {
    student: { id:student.id, name:student.User?.name || student.name || 'Student', elimuid:student.elimuid || null, admissionNumber:student.admissionNumber || null, grade:student.grade || cls?.name || null, classId:cls?.id || student.classId || null, className:cls?.name || student.grade || null, photo:studentPhoto, dateOfBirth:student.dateOfBirth || null },
    class: cls ? { id:cls.id, name:cls.name, grade:cls.grade, stream:cls.stream, curriculum:cls.curriculum, levelCode:cls.levelCode, curriculumLevel:cls.curriculumLevel } : null,
    school: { name:school?.name || school?.schoolName || null, schoolCode:cls.schoolCode, logo:schoolLogo, branding, reportCardSettings:school?.settings?.reportCardSettings || school?.reportCardSettings || {} },
    signatures: { classTeacher:{ name:classTeacher?.User?.name || null, image:safeSignature(classTeacher,classTeacher?.User) }, headteacher:{ name:adminSigner?.User?.name || null, image:safeSignature(adminSigner,adminSigner?.User) } },
    attendance: { present, absent, late, total:attendance.length, rate:attendance.length ? Math.round((present / attendance.length) * 100) : 0 },
    feeBalance: fee ? Math.max(0, Number(fee.totalAmount || 0) - Number(fee.paidAmount || 0)) : null,
    comments: { classTeacher: records.find(r => r.teacherComment)?.teacherComment || null, general: records.find(r => r.remarks)?.remarks || null },
    term, year:Number(year), curriculum:meta.system, schoolLevel:meta.level, gradingProfile:v102CurriculumEngine.getGradingProfile(meta.system, cls.levelCode || v102CurriculumEngine.levelCodeFromGrade(meta.system, cls.grade || cls.name)), subjects, reportRows, totalMarks:summary.totalMarks, countedSubjects:summary.countedSubjects, pendingSubjects:summary.pendingSubjects, notTakenSubjects:summary.notTakenSubjects, overallAverage:summary.average, overallGrade:summary.average == null ? null : getGradeFromScore(summary.average, meta.system, meta.level, meta.gradingScale), generatedAt:new Date().toISOString(), analyticsReady:true, calculationRule:'Only valid completed subjects the student is taking are counted. Pending/null, Not Taken, Not Offered, and Exempted subjects are not counted.'
  };
  snapshot = await reportCommentsController.mergeDraftCommentsIntoSnapshot({ schoolCode: cls.schoolCode, studentId: student.id, term, year:Number(year), snapshot }).catch(() => snapshot);
  return snapshot;
}


// Class-teacher-only draft report-card preview. This intentionally includes draft/submitted
// marks for the selected term/year so the class teacher can verify the report card before
// publishing. Parent/student report routes remain published-only.
exports.getClassTeacherReportPreviewDetails = async (req, res) => {
  try {
    const { studentId } = req.params;
    const { classId, term='Term 1', year=new Date().getFullYear(), assessmentType, assessmentName } = req.query;
    const teacher = await v3Teacher(req.user.id);
    if (!teacher) return res.status(404).json({ success:false, message:'Teacher not found' });

    const student = await Student.unscoped().findOne({
      where:{ id: Number(studentId) || 0, status:{ [Op.ne]:'inactive' } },
      include:[{ model:User, attributes:['id','name','email','phone','profileImage','profilePicture','schoolCode'], required:true }]
    });
    if (!student || student.User?.schoolCode !== req.user.schoolCode) {
      return res.status(404).json({ success:false, message:'Student not found in your school' });
    }

    let cls = null;
    if (classId) cls = await Class.findOne({ where:{ id:classId, schoolCode:req.user.schoolCode, isActive:true } });
    if (!cls && student.classId) cls = await Class.findOne({ where:{ id:student.classId, schoolCode:req.user.schoolCode, isActive:true } });
    if (!cls && !student.classId && student.grade) cls = await Class.findOne({ where:{ schoolCode:req.user.schoolCode, isActive:true, [Op.or]:[{ name:student.grade }, { grade:student.grade }] }, order:[['id','ASC']] });
    if (!cls) return res.status(404).json({ success:false, message:'Class not found for this student' });

    const access = await v66CanEnterMarks(teacher, cls, null);
    const studentBelongs = await v66StudentIsActiveInClass(student.id, cls, req.user.schoolCode);
    if (!access.isClassTeacher || !studentBelongs) {
      return res.status(403).json({ success:false, message:'Only this student’s class teacher can preview the draft report card before publishing' });
    }

    const school = await v102School(req.user.schoolCode);
    const meta = await v66SchoolMeta(req.user.schoolCode);
    const schoolLevel = school?.settings?.schoolLevel || meta.level || 'secondary';
    const where = { schoolCode:req.user.schoolCode, studentId:student.id, term, year:Number(year), status:{ [Op.ne]:'locked' } };
    if (assessmentType) where.assessmentType = assessmentType;
    if (assessmentName) where.assessmentName = assessmentName;
    const records = await AcademicRecord.findAll({ where, order:[['subject','ASC'], ['assessmentName','ASC'], ['date','DESC']] });

    const selections = await v102StudentSubjectSelectionService.listStudentSubjectSelections({ schoolCode:req.user.schoolCode, studentId:student.id, classId:cls.id }).catch(() => []);
    const reportRows = school ? v102CurriculumEngine.buildSubjectRowsForReport({ school, classItem:cls, student, records, studentSubjectSelections:selections }) : [];
    const summary = school ? v102CurriculumEngine.summarizeReportRows(reportRows) : { average:null, totalMarks:0, countedSubjects:0, pendingSubjects:0, notTakenSubjects:0 };

    const gradeFromScore = (score) => getGradeFromScore(Number(score || 0), meta.system, schoolLevel, meta.gradingScale);
    const subjects = reportRows.length ? reportRows.map(row => ({
      subject: row.subject,
      average: row.score,
      grade: row.score == null ? '-' : gradeFromScore(row.score),
      status: row.status,
      counted: row.counted,
      components: (row.assessments || []).map(r => ({ subject:r.subject, assessment:r.assessmentName || r.assessmentType || r.assessment, score:r.score, grade:r.grade || gradeFromScore(r.score), term:r.term, year:r.year, date:r.date, status:r.status || (r.isPublished ? 'published' : 'draft') }))
    })) : Object.entries(records.reduce((acc,r)=>{ const subject=r.subject || 'Subject'; (acc[subject]=acc[subject]||[]).push(r); return acc; },{})).map(([subject, rows]) => {
      const avg = rows.length ? Math.round(rows.reduce((sum,r)=>sum+Number(r.score || 0),0)/rows.length) : null;
      return { subject, average:avg, grade:avg == null ? '-' : gradeFromScore(avg), status: rows.some(r => r.status === 'published' || r.isPublished) ? 'published' : 'draft', counted:true, components: rows.map(r => ({ subject:r.subject, assessment:r.assessmentName || r.assessmentType || r.assessment, score:r.score, grade:r.grade || gradeFromScore(r.score), term:r.term, year:r.year, date:r.date, status:r.status || (r.isPublished ? 'published' : 'draft') })) };
    });

    const attendance = await Attendance.findAll({ where:{ studentId:student.id, schoolCode:req.user.schoolCode }, order:[['date','DESC']] }).catch(() => []);
    const present = attendance.filter(a => a.status === 'present').length;
    const absent = attendance.filter(a => a.status === 'absent').length;
    const late = attendance.filter(a => a.status === 'late').length;
    const rate = attendance.length ? Math.round((present / attendance.length) * 100) : 0;
    const classTeacher = await Teacher.findByPk(teacher.id, { include:[{ model:User, attributes:['id','name','email','phone','preferences'] }] }).catch(() => null);
    const adminSigner = await Admin.findOne({ include:[{ model:User, attributes:['id','name','email','phone','preferences'], where:{ schoolCode:req.user.schoolCode, role:'admin' }, required:true }], order:[['updatedAt','DESC']] }).catch(() => null);
    const safeSig = (model, user) => user?.preferences?.signatureDataUrl || model?.signatureUrl || model?.signature || user?.preferences?.signatureUrl || user?.preferences?.signatureAbsoluteUrl || '';
    const fee = await Fee.findOne({ where:{ studentId:student.id, status:{ [Op.ne]:'paid' } }, order:[['updatedAt','DESC']] }).catch(() => null);
    const feeBalance = fee ? Math.max(0, Number(fee.totalAmount || 0) - Number(fee.paidAmount || 0)) : null;

    const overallAverage = summary.average ?? (subjects.length ? Math.round(subjects.map(s=>Number(s.average)).filter(Number.isFinite).reduce((a,b)=>a+b,0) / Math.max(1, subjects.map(s=>Number(s.average)).filter(Number.isFinite).length)) : 0);
    res.json({ success:true, data:{
      draftPreview:true,
      visibility:'class_teacher_preview',
      message:'Class teacher draft preview only. Parent/student dashboards see the report card only after publishing.',
      student:{ id:student.id, elimuid:student.elimuid, grade:student.grade || cls.name, status:student.status, classId:student.classId || cls.id, photo:student.User?.profileImage || student.profileImage || student.photo, curriculum:meta.system },
      user:{ name:student.User?.name, email:student.User?.email, phone:student.User?.phone },
      classTeacher: classTeacher?.User ? { name:classTeacher.User.name, email:classTeacher.User.email, phone:classTeacher.User.phone, signature:safeSig(classTeacher, classTeacher.User), signatureUrl:safeSig(classTeacher, classTeacher.User) } : null,
      headteacher: adminSigner?.User ? { name:adminSigner.User.name, email:adminSigner.User.email, phone:adminSigner.User.phone, signature:safeSig(adminSigner, adminSigner.User), signatureUrl:safeSig(adminSigner, adminSigner.User) } : null,
      principal: adminSigner?.User ? { name:adminSigner.User.name, email:adminSigner.User.email, phone:adminSigner.User.phone, signature:safeSig(adminSigner, adminSigner.User), signatureUrl:safeSig(adminSigner, adminSigner.User) } : null,
      reportSignatures:{ classTeacher:safeSig(classTeacher, classTeacher?.User), headteacher:safeSig(adminSigner, adminSigner?.User), principal:safeSig(adminSigner, adminSigner?.User) },
      academicSummary:{ overallAverage: overallAverage || 0, subjects, totalMarks:summary.totalMarks, countedSubjects:summary.countedSubjects, pendingSubjects:summary.pendingSubjects, notTakenSubjects:summary.notTakenSubjects },
      attendanceSummary:{ rate, present, absent, late },
      feeBalance,
      ranking:{ classPosition:null, classSize:null, streamPosition:null, streamSize:null, showClassPosition:false, showStreamPosition:false },
      recentAssessments:records.slice(0, 12).map(r => ({ subject:r.subject, assessment:r.assessmentName || r.assessmentType || r.assessment, score:r.score, grade:r.grade || gradeFromScore(r.score), term:r.term, year:r.year, date:r.date, status:r.status || (r.isPublished ? 'published' : 'draft') })),
      comments:(await reportCommentsController.mergeDraftCommentsIntoSnapshot({ schoolCode:req.user.schoolCode, studentId:student.id, term, year:Number(year), snapshot:{} }).catch(()=>({comments:{}}))).comments || {},
      school:{ name:school?.name || null, schoolName:school?.name || null, schoolCode:req.user.schoolCode, curriculum:meta.system, system:meta.system, schoolLevel, logo:school?.settings?.branding?.logoDataUrl || school?.settings?.branding?.logoUrl || school?.settings?.branding?.logo || school?.settings?.logo || null, branding:school?.settings?.branding || {}, reportCardSettings:school?.settings?.reportCardSettings || school?.reportCardSettings || {} }
    }});
  } catch(error) {
    console.error('Class teacher report preview error:', error);
    res.status(500).json({ success:false, message:error.message });
  }
};

exports.publishMarks = async (req,res) => {
  try {
    const { classId, term='Term 1', year=new Date().getFullYear(), assessmentType, assessmentName, publishAnyway=false, issueSummary=null } = req.body;
    const teacher = await v3Teacher(req.user.id); if (!teacher) return res.status(404).json({ success:false, message:'Teacher not found' });
    const cls = await Class.findOne({ where:{ id:classId, schoolCode:req.user.schoolCode, isActive:true } }); if (!cls) return res.status(404).json({ success:false, message:'Class not found' });
    const access = await v66CanEnterMarks(teacher, cls, null);
    if (!access.isClassTeacher) return res.status(403).json({ success:false, message:'Only the class teacher can publish final marks for this class' });
    const students = await Student.unscoped().findAll({ where:v66StudentClassWhere(cls), include:[{ model:User, attributes:['id','name','profileImage'] }], order:[['createdAt','ASC']] });
    const ids = students.map(s=>s.id);
    const where = { schoolCode:req.user.schoolCode, studentId:{ [Op.in]:ids }, term, year:Number(year), status:{ [Op.ne]:'locked' } };
    if (assessmentType) where.assessmentType = assessmentType;
    if (assessmentName) where.assessmentName = assessmentName;
    const now = new Date();
    const [count] = await AcademicRecord.update({ isPublished:true, status:'published', publishedAt:now, publishedBy:req.user.id }, { where });
    const meta = await v66SchoolMeta(req.user.schoolCode);
    let snapshots = 0;
    for (const st of students) {
      const studentRecords = await AcademicRecord.findAll({ where:{ ...where, studentId:st.id }, order:[['subject','ASC'],['assessmentName','ASC']] });
      const snapshot = await v102BuildStudentTermReportSnapshot({ student:st, records:studentRecords, meta, cls, term, year:Number(year) });
      const sourceRecordIds = studentRecords.map(r => r.id);
      const checksum = v66KChecksum(snapshot);
      const saved = await reportSnapshotService.createPublishedVersion({
        schoolCode:req.user.schoolCode, studentId:st.id, classId:cls.id, term, year:Number(year),
        curriculum:meta.system, reportType:'academic', generatedBy:req.user.id, publishedBy:req.user.id,
        publishedAt:now, snapshot, sourceRecordIds, checksum,
        assessmentType:assessmentType || null, assessmentName:assessmentName || null,
        metadata:{ classId:cls.id, className:cls.name, assessmentType:assessmentType || null, assessmentName:assessmentName || null, engine:'v1506_dynamic_assessment_report_lock', publishAnyway:!!publishAnyway, issueSummary:issueSummary || null }
      });
      if (saved.created || saved.unchanged) snapshots++;
    }
    res.json({ success:true, message:`${count} mark(s) published for ${cls.name}. ${snapshots} curriculum-aware report card(s) saved.${publishAnyway ? ' Published with unresolved-warning confirmation.' : ''}`, data:{ count, snapshots, classId:cls.id, term, year:Number(year), publishAnyway:!!publishAnyway, issueSummary:issueSummary || null, engine:'v1506_dynamic_assessment_report_lock' } });
  } catch(error) { console.error('V102 publish marks error:', error); res.status(500).json({ success:false, message:error.message }); }
};
