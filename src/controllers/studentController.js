// src/controllers/studentController.js
const { sequelize, Student, AcademicRecord, Attendance, Message, User, Class, Teacher, Parent, School, Alert, TeacherSubjectAssignment } = require('../models');
const { Op } = require('sequelize');
const schoolFeatureService = require('../services/schoolFeatureService');
const { resolveStudentClass, resolveClassStudents } = require('../services/schoolLinkageService');
const gradingEngine = require('../services/gradingEngine');

// @desc    Get student's own dashboard data
// @route   GET /api/student/dashboard
// @access  Private/Student
exports.getDashboard = async (req, res) => {
  try {
    const student = await Student.findOne({ where: { userId: req.user.id } });
    if (!student) return res.status(404).json({ success: false, message: 'Student profile not found' });

    // Only show published marks
    const records = await AcademicRecord.findAll({
        where: { studentId: student.id, isPublished: true },
        order: [['date', 'DESC']],
        limit: 10
    });
    const attendance = await Attendance.findAll({
        where: { studentId: student.id },
        order: [['date', 'DESC']],
        limit: 20
    });

    const classItem = await Class.findOne({
        where: { name: student.grade, schoolCode: req.user.schoolCode }
    });

    // Fetch school settings for curriculum / grading
    const school = await School.findOne({ where: { schoolId: req.user.schoolCode } });
    const curriculum = school ? school.system : 'cbc';
    const schoolLevel = school?.settings?.schoolLevel || 'secondary';
    const accessInfo = school ? await schoolFeatureService.getSchoolFeatures(school.schoolId).catch(() => null) : null;

    const avg = records.length ? (records.reduce((a, b) => a + b.score, 0) / records.length).toFixed(1) : 0;

    res.json({
      success: true,
      data: {
        student: {
          ...req.user.getPublicProfile(),
          studentId: student.id,
          grade: student.grade,
          classId: student.classId || classItem?.id || null,
          curriculum: student.curriculum || curriculum,
          academicStatus: student.academicStatus,
          admissionNumber: student.admissionNumber,
          assessmentNumber: student.assessmentNumber
        },
        averageScore: parseFloat(avg),
        stats: {
            averageScore: parseFloat(avg),
            attendanceRate: attendance.length ? Math.round((attendance.filter(a => a.status === 'present').length / attendance.length) * 100) : 0
        },
        recentRecords: records.map(r => ({
            ...r.toJSON(),
            grade: gradingEngine.storedGrade(r)
        })),
        recentAttendance: attendance,
        paymentStatus: student.paymentStatus,
        classId: classItem?.id || null,
        school: {
            name: school?.name || null,
            schoolName: school?.name || null,
            schoolCode: req.user.schoolCode,
            curriculum,
            system: curriculum,
            schoolLevel,
            logo: school?.settings?.branding?.logoDataUrl || school?.settings?.branding?.logoUrl || school?.settings?.branding?.logo || school?.settings?.logo || null,
            branding: school?.settings?.branding || {},
            access: accessInfo?.access || null,
            featureList: accessInfo?.featureList || [],
            fullAccess: !!accessInfo?.fullAccess,
            planCode: accessInfo?.planCode || null,
            brandingAllowed: !!accessInfo?.brandingAllowed
        }
      }
    });
  } catch (error) {
    console.error('Student dashboard error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get grade-aware learning materials generated from school curriculum and student performance
// @route   GET /api/student/materials
// @access  Private/Student
exports.getMaterials = async (req, res) => {
  try {
    const student = await Student.findOne({ where: { userId: req.user.id } });
    if (!student) return res.status(404).json({ success: false, message: 'Student not found' });

    const school = await School.findOne({ where: { schoolId: req.user.schoolCode } });
    const curriculum = school?.system || 'cbc';
    const schoolLevel = school?.settings?.schoolLevel || 'both';
    const curriculumHelper = require('../utils/curriculumHelper');
    const subjects = curriculumHelper.getSubjectsForCurriculum(curriculum, schoolLevel) || ['Mathematics','English','Kiswahili','Science'];
    const records = await AcademicRecord.findAll({ where: { studentId: student.id, schoolCode: req.user.schoolCode, isPublished: true } });

    const avgBySubject = {};
    for (const subject of subjects) {
      const rows = records.filter(r => String(r.subject).toLowerCase() === String(subject).toLowerCase());
      avgBySubject[subject] = rows.length ? Math.round(rows.reduce((sum, r) => sum + Number(r.score || 0), 0) / rows.length) : null;
    }

    const materials = subjects.slice(0, 12).map((subject, idx) => {
      const avg = avgBySubject[subject];
      const level = avg === null ? 'starter' : avg < 40 ? 'foundation' : avg < 60 ? 'practice' : avg < 80 ? 'mastery' : 'extension';
      return {
        id: `${student.id}-${idx + 1}`,
        title: `${subject} ${level.charAt(0).toUpperCase() + level.slice(1)} Pack`,
        subject,
        grade: student.grade,
        curriculum,
        type: 'guided-study',
        level,
        performanceAverage: avg,
        activities: [
          `Review today’s ${subject} class notes`,
          `Complete 5 ${level} questions`,
          `Explain one ${subject} idea to a parent or study partner`,
          `Write one question to ask your teacher`
        ],
        estimatedMinutes: level === 'foundation' ? 25 : 15
      };
    });

    res.json({ success: true, data: materials });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};



function normalizeAssessmentName(row) {
  return row.assessmentName || row.assessmentType || 'Assessment';
}

function buildStudentRecommendations(records, filter = {}) {
  const rows = (records || []).map(r => r.toJSON ? r.toJSON() : r).filter(Boolean);
  const selected = rows.filter(row => {
    const yearOk = !filter.year || String(row.year) === String(filter.year);
    const termOk = !filter.term || String(row.term) === String(filter.term);
    const assessmentValue = normalizeAssessmentName(row);
    const assessmentOk = !filter.assessment || String(assessmentValue) === String(filter.assessment) || String(row.assessmentType) === String(filter.assessment);
    return yearOk && termOk && assessmentOk;
  });

  if (!rows.length) {
    return [{ type: 'empty', priority: 'info', title: 'No recommendations yet', detail: 'Recommendations will appear after your teacher publishes marks.' }];
  }
  if (!selected.length) {
    return [{ type: 'empty-selection', priority: 'info', title: 'No data for this selection', detail: 'Choose a year, term, and assessment that already has published marks.' }];
  }

  const bySubject = {};
  selected.forEach(row => {
    const subject = row.subject || 'Subject';
    if (!bySubject[subject]) bySubject[subject] = [];
    bySubject[subject].push(Number(row.score || row.percentage || 0));
  });
  const subjectAverages = Object.entries(bySubject).map(([subject, scores]) => ({
    subject,
    average: Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length),
    count: scores.length
  })).sort((a, b) => a.average - b.average);

  const items = [];
  const weak = subjectAverages.filter(item => item.average < 60).slice(0, 2);
  weak.forEach(item => {
    const level = item.average < 40 ? 'foundation' : item.average < 50 ? 'urgent' : 'practice';
    items.push({
      type: 'weak-subject',
      priority: item.average < 40 ? 'high' : 'medium',
      subject: item.subject,
      title: `Focus on ${item.subject}`,
      detail: item.average < 40
        ? `${item.subject} is at ${item.average}%. Start with teacher notes, basic examples, then 10 short practice questions.`
        : `${item.subject} is at ${item.average}%. Revise the missed areas and do extra practice before the next assessment.`,
      action: level === 'foundation' ? 'Revise basics + ask teacher for support' : 'Practice weak topics'
    });
  });

  const strong = [...subjectAverages].reverse().find(item => item.average >= 70) || [...subjectAverages].reverse()[0];
  if (strong) {
    items.push({
      type: 'strength',
      priority: 'positive',
      subject: strong.subject,
      title: `Maintain ${strong.subject}`,
      detail: `${strong.subject} is currently your strongest area at ${strong.average}%. Keep revising it while giving more time to weaker subjects.`,
      action: 'Keep momentum'
    });
  }

  const overallAverage = Math.round(selected.reduce((sum, row) => sum + Number(row.score || row.percentage || 0), 0) / selected.length);
  if (overallAverage < 50) {
    items.unshift({
      type: 'overall-risk',
      priority: 'high',
      title: 'Create a daily revision routine',
      detail: `Your average for this selection is ${overallAverage}%. Use 30 minutes daily: 15 minutes notes, 10 minutes questions, 5 minutes corrections.`,
      action: 'Start daily revision'
    });
  } else if (overallAverage >= 75) {
    items.push({
      type: 'extension',
      priority: 'positive',
      title: 'Try advanced practice',
      detail: `Your average is ${overallAverage}%. Use challenge questions to protect your performance and prepare for harder exams.`,
      action: 'Attempt advanced questions'
    });
  }

  return items.slice(0, 3);
}

// @desc    Get own grades (only published)
// @route   GET /api/student/grades
// @access  Private/Student
exports.getGrades = async (req, res) => {
  try {
    const student = await Student.findOne({ where: { userId: req.user.id } });
    if (!student) return res.status(404).json({ success: false, message: 'Student not found' });

    const school = await School.findOne({ where: { schoolId: req.user.schoolCode } });
    const curriculum = school ? school.system : 'cbc';
    const schoolLevel = school?.settings?.schoolLevel || 'secondary';

    const records = await AcademicRecord.findAll({
        where: {
          studentId: student.id,
          schoolCode: req.user.schoolCode,
          [Op.or]: [{ isPublished: true }, { status: 'published' }]
        },
        include: [{
          model: Teacher,
          required: false,
          include: [{ model: User, attributes: ['id','name','profileImage','profilePicture'], required: false }]
        }],
        order: [['year', 'DESC'], ['term', 'DESC'], ['date', 'DESC'], ['subject', 'ASC']]
    });

    const enriched = records.map(r => {
        const row = r.toJSON();
        const score = Number(row.score || 0);
        return {
          id: row.id,
          studentId: row.studentId,
          schoolCode: row.schoolCode,
          year: row.year,
          term: row.term,
          subject: row.subject,
          assessmentType: row.assessmentType,
          assessmentName: row.assessmentName || row.assessmentType || 'Assessment',
          score,
          totalMarks: 100,
          percentage: score,
          grade: gradingEngine.storedGrade(row),
          remark: row.remarks || '',
          remarks: row.remarks || '',
          teacherName: row.Teacher?.User?.name || 'Not assigned',
          date: row.date,
          publishedAt: row.publishedAt || null
        };
    });

    const recommendations = buildStudentRecommendations(records, req.query || {});

    res.json({ success: true, data: enriched, recommendations });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};


// @desc    Get own grade recommendations from real published marks
// @route   GET /api/student/recommendations
// @access  Private/Student
exports.getGradeRecommendations = async (req, res) => {
  try {
    const student = await Student.findOne({ where: { userId: req.user.id } });
    if (!student) return res.status(404).json({ success: false, message: 'Student not found' });

    const records = await AcademicRecord.findAll({
      where: {
        studentId: student.id,
        schoolCode: req.user.schoolCode,
        [Op.or]: [{ isPublished: true }, { status: 'published' }]
      },
      order: [['year', 'DESC'], ['term', 'DESC'], ['date', 'DESC'], ['subject', 'ASC']]
    });

    res.json({
      success: true,
      data: buildStudentRecommendations(records, req.query || {}),
      meta: {
        studentId: student.id,
        grade: student.grade,
        year: req.query.year || null,
        term: req.query.term || null,
        assessment: req.query.assessment || null
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get own attendance
// @route   GET /api/student/attendance
// @access  Private/Student
exports.getAttendance = async (req, res) => {
  try {
    const student = await Student.findOne({ where: { userId: req.user.id } });
    if (!student) return res.status(404).json({ success: false, message: 'Student profile not found' });
    const attendance = await Attendance.findAll({ where: { studentId: student.id }, order: [['date', 'DESC']] });
    res.json({ success: true, data: attendance });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Send a message to another user (internal chat)
// @route   POST /api/student/message
// @access  Private/Student
exports.sendMessage = async (req, res) => {
  try {
    const { receiverId, content } = req.body;
    const message = await Message.create({
      senderId: req.user.id,
      receiverId,
      content
    });

    if (global.io) {
      global.io.to(`user-${receiverId}`).emit('private-message', {
        from: req.user.id,
        message: content,
        timestamp: new Date()
      });
    }

    res.status(201).json({ success: true, data: message });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get messages (conversation with a specific user)
// @route   GET /api/student/messages/:otherUserId
// @access  Private/Student
exports.getMessages = async (req, res) => {
  try {
    const { otherUserId } = req.params;
    const me = await Student.findOne({ where:{ userId:req.user.id, status:'active' } });
    const other = await Student.findOne({
      where:{ userId:Number(otherUserId), status:'active' },
      include:[{ model:User, attributes:['id'], where:{ schoolCode:req.user.schoolCode, role:'student', isActive:true }, required:true }]
    });
    if (!me || !other) return res.status(404).json({ success:false, message:'Classmate not found' });
    const sameClass = me.classId && other.classId
      ? Number(me.classId) === Number(other.classId)
      : !me.classId && !other.classId && String(me.grade || '').trim().toLowerCase() === String(other.grade || '').trim().toLowerCase();
    if (!sameClass) return res.status(403).json({ success:false, message:'Student direct messages are limited to current classmates' });
    const messages = await Message.findAll({
      where: {
        [Op.or]: [
          { senderId: req.user.id, receiverId: otherUserId },
          { senderId: otherUserId, receiverId: req.user.id }
        ]
      },
      order: [['createdAt', 'ASC']]
    });
    res.json({ success: true, data: messages });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Send group message to classmates
// @route   POST /api/student/group-message
// @access  Private/Student
exports.sendGroupMessage = async (req, res) => {
  try {
    const { content, replyToId } = req.body;
    const student = await Student.findOne({ where: { userId: req.user.id } });
    if (!student) return res.status(404).json({ success: false, message: 'Student not found' });
    const currentClass = await resolveStudentClass(student, req.user.schoolCode);
    if (!currentClass) return res.status(400).json({ success:false, message:'Your class is not assigned yet.' });
    const classmates = (await resolveClassStudents([currentClass], req.user.schoolCode, { userAttributes:['id'] })).filter(s => Number(s.id) !== Number(student.id));
    const recipients = classmates.map(s => s.userId);
    const messages = recipients.map(receiverId => ({
      senderId: req.user.id,
      receiverId,
      content,
      replyToMessageId: replyToId || null,
      metadata: { type: 'student_group', studentName: req.user.name, schoolCode: req.user.schoolCode, conversationKey: require('../services/realtimeService').directConversationKey(req.user.id, receiverId) }
    }));
    await Message.bulkCreate(messages, { individualHooks: true });
    if (global.io) {
      recipients.forEach(recipientId => {
        global.io.to(`user-${recipientId}`).emit('new-student-message', { from: req.user.id, content, replyToId });
      });
    }
    res.status(201).json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get group messages for student's class
// @route   GET /api/student/group-messages
// @access  Private/Student
exports.getGroupMessages = async (req, res) => {
  try {
    const student = await Student.findOne({ where: { userId: req.user.id } });
    if (!student) return res.status(404).json({ success: false });
    const currentClass = await resolveStudentClass(student, req.user.schoolCode);
    if (!currentClass) return res.json({ success:true, data:[] });
    const classmates = (await resolveClassStudents([currentClass], req.user.schoolCode)).filter(s => Number(s.id) !== Number(student.id));
    const classmateUserIds = classmates.map(s => s.User.id);
    const messages = await Message.findAll({
      where: {
        [Op.or]: [
          { senderId: req.user.id, receiverId: { [Op.in]: classmateUserIds } },
          { senderId: { [Op.in]: classmateUserIds }, receiverId: req.user.id }
        ]
      },
      include: [{ model: User, as: 'Sender', attributes: ['id','name','profileImage','profilePicture'] }],
      order: [['createdAt', 'ASC']]
    });
    res.json({ success: true, data: messages });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============ NEW: Comprehensive Student Details ============

// @desc    Get comprehensive student details (for unified modal)
// @route   GET /api/students/:studentId/details
// @access  Private (with ownership check)
exports.getStudentFullDetails = async (req, res) => {
    try {
        const { studentId } = req.params;
        // V87: callers sometimes pass a Student.id and sometimes a linked User.id.
        // Students do not have schoolCode; tenant ownership is checked through linked User.schoolCode.
        const student = await Student.findOne({
            where: { [Op.or]: [{ id: Number(studentId) || 0 }, { userId: Number(studentId) || 0 }] },
            include: [
                { model: User, attributes: ['id', 'name', 'email', 'phone', 'profileImage', 'isActive', 'schoolCode'], required: true }
            ]
        });

        if (!student || (req.user.role !== 'super_admin' && student.User?.schoolCode !== req.user.schoolCode)) {
            return res.status(404).json({ success: false, message: 'Student not found' });
        }

        // Authorization
        const user = req.user;
        let authorized = false;
        if (['admin', 'super_admin'].includes(user.role)) {
            authorized = true;
        } else if (user.role === 'teacher') {
            const teacher = await Teacher.findOne({ where: { userId: user.id } });
            if (teacher) {
                let currentClass = null;
                if (student.classId) currentClass = await Class.findOne({ where:{ id:student.classId, schoolCode:user.schoolCode, isActive:true } });
                if (!currentClass && !student.classId && student.grade) currentClass = await Class.findOne({ where:{ schoolCode:user.schoolCode, isActive:true, [Op.or]:[{ name:student.grade }, { grade:student.grade }] }, order:[['id','ASC']] });
                if (currentClass) {
                    const tableAssignment = await TeacherSubjectAssignment.findOne({ where:{ teacherId:teacher.id, classId:currentClass.id } }).catch(() => null);
                    authorized = Number(currentClass.teacherId) === Number(teacher.id)
                      || Number(teacher.classId) === Number(currentClass.id)
                      || !!tableAssignment
                      || (Array.isArray(currentClass.subjectTeachers) && currentClass.subjectTeachers.some(st => Number(st.teacherId) === Number(teacher.id)));
                }
            }
        } else if (user.role === 'parent') {
            const parent = await Parent.findOne({ where: { userId: user.id } });
            if (parent) {
                try {
                    if (typeof parent.hasStudent === 'function' && await parent.hasStudent(student)) authorized = true;
                } catch (_) {}
                if (!authorized) {
                    const linked = await sequelize.query(
                        'SELECT 1 FROM "StudentParents" WHERE "parentId" = :parentId AND "studentId" = :studentId LIMIT 1',
                        { replacements: { parentId: parent.id, studentId: student.id }, type: sequelize.QueryTypes.SELECT }
                    ).catch(() => []);
                    authorized = linked.length > 0;
                }
            }
        } else if (user.role === 'student') {
            if (student.userId === user.id) {
                authorized = true;
            }
        }

        if (!authorized) {
            return res.status(403).json({ success: false, message: 'Forbidden' });
        }

        // School curriculum
        const school = await School.findOne({ where: { schoolId: student.User?.schoolCode || user.schoolCode } });
        const curriculum = school ? (school.system || school.curriculum || 'cbc') : 'cbc';
        const schoolLevel = school?.settings?.schoolLevel || 'secondary';
        const gradingScale = school?.settings?.gradingScale || null;

        // Parents
        const parents = await student.getParents({
            include: [{ model: User, attributes: ['id','name','email','phone','profileImage','profilePicture'] }]
        });
        const parentList = parents.map(p => ({
            id: p.id,
            name: p.User.name,
            phone: p.User.phone,
            email: p.User.email,
            relationship: p.relationship
        }));

        // Class teacher
        let classTeacher = null;
        let studentClass = student.classId
            ? await Class.findOne({ where:{ id:student.classId, schoolCode:student.User?.schoolCode || user.schoolCode } })
            : null;
        if (!studentClass && !student.classId && student.grade) {
            studentClass = await Class.findOne({ where:{ schoolCode:student.User?.schoolCode || user.schoolCode, [Op.or]:[{ name:student.grade }, { grade:student.grade }] }, order:[['id','ASC']] });
        }
        if (studentClass?.teacherId) {
            classTeacher = await Teacher.findByPk(studentClass.teacherId, { include: [{ model: User, attributes: ['id','name','email','phone','profileImage','profilePicture'] }] });
        }
        if (!classTeacher && !student.classId) {
            classTeacher = await Teacher.findOne({
                where: { classTeacher: student.grade },
                include: [{ model: User, attributes: ['id','name','email','phone','profileImage','profilePicture'] }]
            });
        }

        // Academic records (only published)
        const records = await AcademicRecord.findAll({
            where: { studentId: student.id, schoolCode: student.User?.schoolCode || user.schoolCode, [Op.or]: [{ isPublished: true }, { status: 'published' }] },
            order: [['year', 'DESC'], ['term', 'DESC'], ['date', 'DESC']]
        });
        const overallAverage = records.length
            ? Math.round(records.reduce((s, r) => s + r.score, 0) / records.length)
            : 0;

        // Subject averages with curriculum grading
        const subjectMap = {};
        records.forEach(r => {
            if (!subjectMap[r.subject]) subjectMap[r.subject] = { total: 0, count: 0, records:[] };
            subjectMap[r.subject].total += r.score;
            subjectMap[r.subject].count++;
            subjectMap[r.subject].records.push(r);
        });
        const subjects = Object.entries(subjectMap).map(([subject, data]) => ({
            subject,
            average: Math.round(data.total / data.count),
            grade: gradingEngine.gradeValueForRecords(Math.round(data.total / data.count),data.records)
        }));

        // Term averages
        const termAverages = [];
        const terms = ['Term 1', 'Term 2', 'Term 3'];
        const currentYear = new Date().getFullYear();
        for (let year = currentYear - 1; year <= currentYear; year++) {
            for (const term of terms) {
                const termRecords = records.filter(r => r.term === term && r.year === year);
                if (termRecords.length) {
                    const avg = Math.round(termRecords.reduce((s, r) => s + r.score, 0) / termRecords.length);
                    termAverages.push({ term: `${term} ${year}`, average: avg });
                }
            }
        }

        // Attendance summary
        const attendance = await Attendance.findAll({ where: { studentId: student.id, schoolCode: student.User?.schoolCode || user.schoolCode } });
        const present = attendance.filter(a => a.status === 'present').length;
        const absent = attendance.filter(a => a.status === 'absent').length;
        const late = attendance.filter(a => a.status === 'late').length;
        const attendanceRate = attendance.length
            ? Math.round((present / attendance.length) * 100)
            : 0;

        // Recent assessments
        const recentAssessments = records.slice(0, 5).map(r => ({
            subject: r.subject,
            assessment: r.assessmentName,
            score: r.score,
            grade: gradingEngine.storedGrade(r),
            term: r.term,
            year: r.year,
            date: r.date
        }));

        const address = student.address || 'Not provided';
        const isPrefect = student.isPrefect || false;

        res.json({
            success: true,
            data: {
                student: {
                    id: student.id,
                    elimuid: student.elimuid,
                    grade: student.grade,
                    status: student.status,
                    enrollmentDate: student.enrollmentDate,
                    dateOfBirth: student.dateOfBirth,
                    gender: student.gender,
                    isPrefect,
                    photo: student.User.profileImage
                },
                user: {
                    name: student.User.name,
                    email: student.User.email,
                    phone: student.User.phone
                },
                parents: parentList,
                classTeacher: classTeacher ? {
                    name: classTeacher.User.name,
                    email: classTeacher.User.email,
                    phone: classTeacher.User.phone
                } : null,
                academicSummary: {
                    overallAverage,
                    termAverages,
                    subjects
                },
                attendanceSummary: {
                    rate: attendanceRate,
                    present,
                    absent,
                    late
                },
                recentAssessments,
                address,
                school: {
                    name: school?.name || null,
                    schoolName: school?.name || null,
                    schoolCode: student.User?.schoolCode || user.schoolCode,
                    curriculum,
                    system: curriculum,
                    schoolLevel,
                    logo: school?.settings?.branding?.logoDataUrl || school?.settings?.branding?.logoUrl || school?.settings?.branding?.logo || school?.settings?.logo || null,
                    branding: school?.settings?.branding || {}
                }
            }
        });
    } catch (error) {
        console.error('Get student full details error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};


// ============ V87 CAREER PATH GUIDANCE ============
const V87_CAREERS = [
  'Accountant','Actor','Agronomist','Architect','Artist','Astronaut','Athlete','Banker','Biomedical Engineer','Business Owner','Carpenter','Chef','Civil Engineer','Clinical Officer','Computer Scientist','Data Analyst','Data Scientist','Dentist','Designer','Doctor','Economist','Electrician','Entrepreneur','Fashion Designer','Film Producer','Financial Analyst','Graphic Designer','Journalist','Judge','Lawyer','Lecturer','Mechanic','Medicine Researcher','Musician','Nurse','Nutritionist','Pharmacist','Photographer','Physiotherapist','Pilot','Police Officer','Project Manager','Psychologist','Radiographer','Software Engineer','Teacher','Veterinarian','Web Developer','Writer'
];
const V87_CAREER_SUBJECTS = {
  Doctor:['Science','Biology','Chemistry','Mathematics','English'], Nurse:['Science','Biology','English'], Pharmacist:['Chemistry','Biology','Mathematics'],
  'Software Engineer':['Mathematics','Computer Studies','Physics','English'], 'Data Scientist':['Mathematics','Computer Studies','Statistics','English'], Pilot:['Mathematics','Physics','Geography','English'],
  Lawyer:['English','History','CRE/IRE','Social Studies'], Teacher:['English','Mathematics','Education','Social Studies'], Chef:['Agriculture and Nutrition','Home Science','Business Studies'],
  Architect:['Mathematics','Physics','Art & Design'], Engineer:['Mathematics','Physics','Chemistry'], 'Civil Engineer':['Mathematics','Physics','Geography'],
  Accountant:['Mathematics','Business Studies','Economics'], 'Business Owner':['Business Studies','Mathematics','English'], Journalist:['English','History','Social Studies'],
  Artist:['Creative Arts','Art & Design','English'], Designer:['Creative Arts','Art & Design','Computer Studies'], Mechanic:['Physics','Pre-Technical and Pre-Career Education','Mathematics'],
  Electrician:['Physics','Mathematics','Pre-Technical and Pre-Career Education'], Agronomist:['Agriculture','Biology','Chemistry'], Veterinarian:['Biology','Chemistry','Agriculture']
};
function v87CareerSubjects(name){ return V87_CAREER_SUBJECTS[name] || ['Mathematics','English','Science']; }
function v87CareerCategories(name){
  const n=String(name||'').toLowerCase();
  if(/doctor|nurse|pharmac|dentist|clinical|health|veter/.test(n)) return ['Health & Medicine'];
  if(/software|computer|data|web|engineer/.test(n)) return ['Technology & Engineering'];
  if(/law|judge|police/.test(n)) return ['Law & Public Service'];
  if(/artist|designer|music|actor|film|photo|writer/.test(n)) return ['Creative Arts & Media'];
  if(/account|business|bank|econom|finance|entrepreneur/.test(n)) return ['Business & Finance'];
  if(/teacher|lecturer/.test(n)) return ['Education'];
  return ['General Career'];
}
async function v87StudentForReq(req){ return Student.findOne({ where:{ userId:req.user.id }, include:[{model:User, attributes:['id','name','schoolCode'], required:true, where:{schoolCode:req.user.schoolCode}}] }); }

function v101CareerJoin(items, fallback='career subjects'){
  const clean=[...new Set((items||[]).map(x=>String(x||'').trim()).filter(Boolean))];
  if(!clean.length) return fallback;
  if(clean.length===1) return clean[0];
  if(clean.length===2) return `${clean[0]} and ${clean[1]}`;
  return `${clean.slice(0,-1).join(', ')} and ${clean[clean.length-1]}`;
}
function v101CareerAlertCopy({ role='student', studentName='the learner', careerName='this career path', subjects=[], strengths=[], focus=[] }){
  const subjectBridge=v101CareerJoin(subjects.slice(0,3), 'the subjects connected to this dream');
  const focusBridge=v101CareerJoin(focus.slice(0,3), subjectBridge);
  const strengthBridge=v101CareerJoin(strengths.slice(0,2), 'the progress already visible');
  const career=String(careerName || 'this career path').trim() || 'this career path';
  const learner=String(studentName || 'the learner').trim() || 'the learner';
  if(role === 'parent'){
    return {
      title:'AI Career Compass',
      message:`${learner} is exploring ${career}. Shule AI recommends a light support plan: encourage curiosity, celebrate effort, and support steady practice in ${subjectBridge}. The goal is guidance, not pressure.`,
      categoryLabel:'AI Career Guide',
      sourceLabel:'Shule AI Career Coach',
      actionLabel:'View Child Progress'
    };
  }
  if(role === 'teacher'){
    return {
      title:'AI Career Coaching Nudge',
      message:`${learner} is exploring ${career}. A short class example, project idea, or encouraging word around ${subjectBridge} can help this path feel real and reachable.`,
      categoryLabel:'AI Career Guide',
      sourceLabel:'Shule AI Career Coach',
      actionLabel:'View Student Progress'
    };
  }
  return {
    title:'AI Career Compass',
    message:`You are exploring ${career}. Shule AI is turning that dream into simple next steps: grow ${focusBridge} and keep building ${strengthBridge}. This is not a final decision — it is a path you can keep shaping.`,
    categoryLabel:'AI Career Guide',
    sourceLabel:'Shule AI Career Coach',
    actionLabel:'Open Career Compass'
  };
}
exports.getCareerOptions = async (req,res) => {
  try{
    const q=String(req.query.q||'').toLowerCase().trim();
    const rows=V87_CAREERS.filter(c=>!q || c.toLowerCase().includes(q)).sort().map((name,idx)=>({ id:name.toLowerCase().replace(/[^a-z0-9]+/g,'-'), name, categories:v87CareerCategories(name), recommendedSubjects:v87CareerSubjects(name) }));
    res.json({success:true,data:rows});
  }catch(error){res.status(500).json({success:false,message:error.message});}
};
exports.getCareerInterests = async (req,res) => {
  try{
    const student=await v87StudentForReq(req); if(!student) return res.status(404).json({success:false,message:'Student profile not found'});
    const [rows]=await sequelize.query('SELECT * FROM "StudentCareerInterests" WHERE "studentId"=:studentId AND "schoolCode"=:schoolCode AND "isActive"=true ORDER BY "selectedAt" DESC', { replacements:{studentId:student.id, schoolCode:req.user.schoolCode} });
    res.json({success:true,data:{studentId:student.id, careers:rows}});
  }catch(error){res.status(500).json({success:false,message:error.message});}
};
exports.saveCareerInterests = async (req,res) => {
  try{
    const student=await v87StudentForReq(req); if(!student) return res.status(404).json({success:false,message:'Student profile not found'});
    const careers=Array.isArray(req.body.careers)?req.body.careers:[];
    await sequelize.query('UPDATE "StudentCareerInterests" SET "isActive"=false, "updatedAt"=NOW() WHERE "studentId"=:studentId AND "schoolCode"=:schoolCode', { replacements:{studentId:student.id, schoolCode:req.user.schoolCode} });
    for(const c of careers.slice(0,8)){
      const name=String(c.name||c.careerName||c).trim(); if(!name) continue;
      const careerId=String(c.id||name.toLowerCase().replace(/[^a-z0-9]+/g,'-'));
      await sequelize.query(`INSERT INTO "StudentCareerInterests" ("schoolCode","studentId","careerId","careerName","interestLevel","isActive","selectedAt","createdAt","updatedAt") VALUES (:schoolCode,:studentId,:careerId,:careerName,:interestLevel,true,NOW(),NOW(),NOW()) ON CONFLICT ("schoolCode","studentId","careerId") DO UPDATE SET "careerName"=EXCLUDED."careerName", "interestLevel"=EXCLUDED."interestLevel", "isActive"=true, "selectedAt"=NOW(), "updatedAt"=NOW()`, { replacements:{schoolCode:req.user.schoolCode, studentId:student.id, careerId, careerName:name, interestLevel:c.interestLevel||'interested'} });
    }
    const [rows]=await sequelize.query('SELECT * FROM "StudentCareerInterests" WHERE "studentId"=:studentId AND "schoolCode"=:schoolCode AND "isActive"=true ORDER BY "selectedAt" DESC', { replacements:{studentId:student.id, schoolCode:req.user.schoolCode} });
    res.json({success:true,message:'Career interests saved. Shule AI will start aligning insights to these careers.',data:{careers:rows}});
  }catch(error){res.status(500).json({success:false,message:error.message});}
};
exports.generateCareerInsights = async (req,res) => {
  try{
    const student=await v87StudentForReq(req); if(!student) return res.status(404).json({success:false,message:'Student profile not found'});
    const [careers]=await sequelize.query('SELECT * FROM "StudentCareerInterests" WHERE "studentId"=:studentId AND "schoolCode"=:schoolCode AND "isActive"=true ORDER BY "selectedAt" DESC', { replacements:{studentId:student.id, schoolCode:req.user.schoolCode} });
    if(!careers.length) return res.json({success:true,message:'No career interests selected yet.',data:[]});
    const records=await AcademicRecord.findAll({ where:{studentId:student.id, schoolCode:req.user.schoolCode}, order:[['createdAt','DESC']], limit:30 }).catch(()=>[]);
    const avgBySubject={}; records.forEach(r=>{ const key=r.subject||'General'; if(!avgBySubject[key]) avgBySubject[key]=[]; avgBySubject[key].push(Number(r.score||0)); });
    const alerts=[];
    for(const c of careers.slice(0,4)){
      const subjects=v87CareerSubjects(c.careerName); const strengths=[]; const focus=[];
      subjects.forEach(sub=>{ const rows=avgBySubject[sub]||[]; const avg=rows.length?Math.round(rows.reduce((a,b)=>a+b,0)/rows.length):null; if(avg===null) focus.push(sub); else if(avg>=70) strengths.push(sub); else focus.push(sub); });
      const studentCopy=v101CareerAlertCopy({ role:'student', studentName:student.User?.name || 'You', careerName:c.careerName, subjects, strengths, focus });
      const dedupeKey=`career:${student.id}:${c.careerId}:${new Date().toISOString().slice(0,10)}`;
      const [alert]=await Alert.findOrCreate({ where:{ userId:req.user.id, dedupeKey }, defaults:{ userId:req.user.id, role:'student', type:'career', severity:'info', title:studentCopy.title, message:studentCopy.message, categoryLabel:studentCopy.categoryLabel, sourceType:'ai_career_compass', sourceLabel:studentCopy.sourceLabel, targetRole:'student', targetUserId:req.user.id, studentId:student.id, priority:'normal', dedupeKey, actionLabel:studentCopy.actionLabel, actionUrl:'#career-path', data:{career:c.careerName, subjects, focusSubjects:focus, strengthSubjects:strengths, aiTone:'career_compass_v101'} } });
      alerts.push(alert);
      // Also notify linked parents with a parent-friendly version, without mixing siblings.
      const [parents]=await sequelize.query('SELECT p."userId" FROM "StudentParents" sp JOIN "Parents" p ON p."id"=sp."parentId" WHERE sp."studentId"=:studentId', { replacements:{ studentId:student.id } });
      for (const pr of parents || []) {
        if (!pr.userId) continue;
        const parentKey=`parent:${dedupeKey}:${pr.userId}`;
        const parentCopy=v101CareerAlertCopy({ role:'parent', studentName:student.User?.name || 'Your child', careerName:c.careerName, subjects, strengths, focus });
        await Alert.findOrCreate({ where:{ userId:pr.userId, dedupeKey:parentKey }, defaults:{ userId:pr.userId, role:'parent', type:'career', severity:'info', title:parentCopy.title, message:parentCopy.message, categoryLabel:parentCopy.categoryLabel, sourceType:'ai_career_compass', sourceLabel:parentCopy.sourceLabel, targetRole:'parent', targetUserId:pr.userId, studentId:student.id, priority:'normal', dedupeKey:parentKey, actionLabel:parentCopy.actionLabel, actionUrl:'#progress', data:{career:c.careerName, subjects, focusSubjects:focus, strengthSubjects:strengths, studentId:student.id, aiTone:'career_compass_v101'} } });
      }
      // V97: Notify ONLY teachers who teach one of the career-required subjects in this student's class.
      // Do NOT notify admins, unrelated teachers, or general class viewers for child-specific career choices.
      let teacherRows = [];
      if (student.classId && subjects.length) {
        const replacements = { schoolCode: req.user.schoolCode, classId: student.classId };
        const subjectChecks = subjects.map((sub, idx) => {
          replacements[`sub${idx}`] = String(sub || '').trim().toLowerCase();
          replacements[`like${idx}`] = `%${String(sub || '').trim().toLowerCase()}%`;
          return `(LOWER(COALESCE(tsa."subject"::text,'')) = :sub${idx} OR LOWER(COALESCE(t."subjects"::text,'')) LIKE :like${idx})`;
        }).join(' OR ');
        teacherRows = await sequelize.query(`
          SELECT DISTINCT u."id" AS "userId", u."name" AS "name", t."id" AS "teacherId"
            FROM "Teachers" t
            JOIN "Users" u ON u."id" = t."userId"
            LEFT JOIN "TeacherSubjectAssignments" tsa ON tsa."teacherId" = t."id" AND tsa."classId" = :classId
           WHERE u."schoolCode" = :schoolCode
             AND u."role" = 'teacher'
             AND COALESCE(u."isActive", true) = true
             AND (t."classId" = :classId OR tsa."classId" = :classId)
             AND (${subjectChecks || 'FALSE'})
        `, { replacements, type: sequelize.QueryTypes.SELECT }).catch(() => []);
      }
      for (const t of teacherRows || []) {
        if (!t.userId) continue;
        const teacherKey=`teacher:${dedupeKey}:${t.userId}`;
        const teacherCopy=v101CareerAlertCopy({ role:'teacher', studentName:student.User?.name || 'A student', careerName:c.careerName, subjects, strengths, focus });
        await Alert.findOrCreate({ where:{ userId:t.userId, dedupeKey:teacherKey }, defaults:{ userId:t.userId, role:'teacher', type:'career', severity:'info', title:teacherCopy.title, message:teacherCopy.message, categoryLabel:teacherCopy.categoryLabel, sourceType:'ai_career_compass', sourceLabel:teacherCopy.sourceLabel, targetRole:'teacher', targetUserId:t.userId, studentId:student.id, priority:'normal', dedupeKey:teacherKey, actionLabel:teacherCopy.actionLabel, actionUrl:'#my-students', data:{career:c.careerName, subjects, focusSubjects:focus, strengthSubjects:strengths, studentId:student.id, classId:student.classId, teacherScope:'career_subject_teacher_only', aiTone:'career_compass_v101'} } });
      }
    }
    res.json({success:true,message:'Career insights generated.',data:alerts});
  }catch(error){res.status(500).json({success:false,message:error.message});}
};
