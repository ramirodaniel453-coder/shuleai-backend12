const { Op } = require('sequelize');
const { User, Teacher, School, ApprovalRequest } = require('../models');
const QRCode = require('qrcode');
const { createAlert } = require('../services/notificationService');

exports.teacherSignup = async (req, res) => {
  try {
    const { name, email, password, phone, schoolCode, qualification, subjects, classTeacher } = req.body;

    // Find school by short code or schoolId
    const school = await School.findOne({ 
      where: {
        [Op.or]: [
          { shortCode: schoolCode },
          { schoolId: schoolCode },
          { lookupCodes: { [Op.contains]: [schoolCode] } }
        ]
      }
    });
    
    if (!school) {
      return res.status(404).json({ success: false, message: 'Invalid school code' });
    }

    if (school.status && school.status !== 'active') {
      return res.status(403).json({ success: false, message: 'School is not yet approved' });
    }

    const schoolSettings = school.settings || {};
    const requestsExplicitlyClosed = schoolSettings.teacherSignupMode === 'closed' || schoolSettings.allowTeacherRequests === false;
    if (requestsExplicitlyClosed) {
      return res.status(403).json({ success: false, message: 'Teacher signup requests are currently disabled for this school' });
    }

    const existing = await User.findOne({ where: { email } });
    if (existing) {
      return res.status(400).json({ success: false, message: 'Email already exists' });
    }

    const emailDomain = email.split('@')[1];
    const autoApprove = schoolSettings.autoApproveDomains?.includes(emailDomain) || false;

    const user = await User.create({
      name, 
      email, 
      password, 
      role: 'teacher', 
      phone,
      schoolCode: school.schoolId, // Using schoolId, not code
      isActive: autoApprove
    });

    const teacher = await Teacher.create({
      userId: user.id,
      subjects: subjects || [],
      classTeacher: classTeacher || null,
      qualification,
      approvalStatus: autoApprove ? 'approved' : 'pending',
      approvedAt: autoApprove ? new Date() : null
    });

    if (!autoApprove) {
      await ApprovalRequest.create({
        schoolId: school.schoolId, // Using schoolId, not code
        userId: user.id,
        role: 'teacher',
        data: { name, email, phone, qualification, subjects, classTeacher },
        metadata: { ipAddress: req.ip, userAgent: req.headers['user-agent'] }
      });

      school.stats = school.stats || {};
      school.stats.pendingApprovals = (school.stats.pendingApprovals || 0) + 1;
      await school.save();

      // Notify admins - using school.schoolId
      const admins = await User.findAll({ 
        where: { 
          role: 'admin', 
          schoolCode: school.schoolId // Using schoolId, not code
        } 
      });
      
      for (const admin of admins) {
        await createAlert({
          userId: admin.id,
          role: 'admin',
          type: 'approval',
          severity: 'info',
          title: 'New Teacher Signup',
          message: `${name} requested to join.`,
          data: { schoolCode: school.schoolId, teacherId: teacher.id }
        });
      }
    }

    const qrData = { teacherId: teacher.id, name, school: school.name };
    const qrCode = await QRCode.toDataURL(JSON.stringify(qrData));

    res.status(201).json({
      success: true,
      message: autoApprove ? 'Signup successful' : 'Pending approval',
      data: { 
        userId: user.id, 
        name, 
        email, 
        school: school.name, 
        status: teacher.approvalStatus, 
        qrCode 
      }
    });
  } catch (error) {
    console.error('Teacher signup error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.verifySchoolCode = async (req, res) => {
  try {
    const { schoolCode } = req.body;
    
    const school = await School.findOne({
      where: {
        [Op.or]: [
          { shortCode: schoolCode },
          { schoolId: schoolCode },
          { lookupCodes: { [Op.contains]: [schoolCode] } }
        ]
      }
    });
    
    if (!school) {
      return res.status(404).json({ success: false, message: 'Invalid school code' });
    }

    // Check if school is active
    if (school.status !== 'active') {
      return res.status(403).json({ 
        success: false, 
        message: 'School is pending approval. Please try again later.' 
      });
    }

    res.json({
      success: true,
      data: {
        schoolName: school.name,
        schoolId: school.schoolId,
        shortCode: school.shortCode,
        requiresApproval: school.settings.requireApproval,
        autoApproveDomains: school.settings.autoApproveDomains || []
      }
    });
  } catch (error) {
    console.error('Verify school code error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.approveTeacher = async (req, res) => {
  try {
    const { teacherId } = req.params;
    const { action, rejectionReason } = req.body;

    const teacher = await Teacher.findByPk(teacherId, { 
      include: [{ model: User }] 
    });
    
    if (!teacher) {
      return res.status(404).json({ success: false, message: 'Teacher not found' });
    }

    // Find school using schoolId from user
    const school = await School.findOne({ 
      where: { schoolId: teacher.User.schoolCode } 
    });

    if (!school) {
      return res.status(404).json({ success: false, message: 'School not found' });
    }

    if (action === 'approve') {
      teacher.approvalStatus = 'approved';
      teacher.approvedBy = req.user.id;
      teacher.approvedAt = new Date();
      teacher.User.isActive = true;
      await teacher.User.save();

      school.stats.pendingApprovals = Math.max(0, (school.stats.pendingApprovals || 0) - 1);
      school.stats.teachers = (school.stats.teachers || 0) + 1;
      await school.save();

      await ApprovalRequest.update(
        { status: 'approved', reviewedBy: req.user.id, reviewedAt: new Date() },
        { where: { userId: teacher.User.id } }
      );

      await createAlert({
        userId: teacher.User.id,
        role: 'teacher',
        type: 'system',
        severity: 'success',
        title: 'Account Approved',
        message: `Your account has been approved. Your Employee ID is: ${teacher.employeeId}`,
        data: { schoolCode: school.schoolId, employeeId: teacher.employeeId }
      });
    } else {
      teacher.approvalStatus = 'rejected';
      teacher.rejectionReason = rejectionReason;
      teacher.User.isActive = false;
      await teacher.User.save();

      school.stats.pendingApprovals = Math.max(0, (school.stats.pendingApprovals || 0) - 1);
      await school.save();

      await ApprovalRequest.update(
        { status: 'rejected', reviewedBy: req.user.id, reviewedAt: new Date(), rejectionReason },
        { where: { userId: teacher.User.id } }
      );

      await createAlert({
        userId: teacher.User.id,
        role: 'teacher',
        type: 'system',
        severity: 'warning',
        title: 'Account Rejected',
        message: `Your account was rejected. Reason: ${rejectionReason || 'Not specified'}`,
        data: { schoolCode: school.schoolId, teacherId: teacher.id }
      });
    }
    
    await teacher.save();

    res.json({ 
      success: true, 
      message: `Teacher ${action}d`,
      data: { 
        employeeId: teacher.employeeId,
        approvalStatus: teacher.approvalStatus 
      }
    });
  } catch (error) {
    console.error('Approve teacher error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getPendingApprovals = async (req, res) => {
  try {
    // Find the school using the admin's schoolCode (which is actually schoolId)
    const school = await School.findOne({ 
      where: { schoolId: req.user.schoolCode } 
    });
    
    if (!school) {
      return res.status(404).json({ success: false, message: 'School not found' });
    }

    // Find all pending teachers for this school
    const pending = await Teacher.findAll({
      where: { approvalStatus: 'pending' },
      include: [{ 
        model: User, 
        where: { schoolCode: school.schoolId }, // Using school.schoolId
        attributes: ['id', 'name', 'email', 'phone', 'createdAt'] 
      }]
    });

    res.json({ 
      success: true, 
      data: { 
        teachers: pending, 
        total: pending.length 
      } 
    });
  } catch (error) {
    console.error('Get pending approvals error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};
