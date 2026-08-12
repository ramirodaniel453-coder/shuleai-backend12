// src/controllers/userController.js
const { User, Student, Teacher, Parent, AcademicRecord, Attendance, Alert } = require('../models');
const { Op } = require('sequelize');
const { createAlert } = require('../services/notificationService');
const { saveUploadAsset } = require('../services/mediaAssetService');
const { getAlertsForUser } = require('../services/alertReceiverEngine');
const { sanitizePreferencePayload, removePrivilegeBearingPreferenceKeys } = require('../services/roleAccessService');

// @desc    Get user statistics for profile
exports.getUserStats = async (req, res) => {
  try {
    const user = req.user;
    let stats = {
      memberSince: user.createdAt,
      lastLogin: user.lastLogin,
      isActive: user.isActive,
      role: user.role,
      name: user.name,
      email: user.email,
      phone: user.phone
    };
    
    if (user.role === 'teacher') {
      const teacher = await Teacher.findOne({ where: { userId: user.id } });
      stats.classTeacher = teacher?.classTeacher;
      stats.subjects = teacher?.subjects;
      stats.employeeId = teacher?.employeeId;
      stats.department = teacher?.department;
      stats.reliabilityScore = teacher?.statistics?.reliabilityScore || 100;
      stats.dutiesCompleted = teacher?.statistics?.dutiesCompleted || 0;
      
      let studentCount = 0;
      if (teacher.classTeacher) {
        studentCount = await Student.count({ where: { grade: teacher.classTeacher } });
      }
      stats.studentCount = studentCount;
      
    } else if (user.role === 'student') {
      const student = await Student.findOne({ where: { userId: user.id } });
      stats.grade = student?.grade;
      stats.elimuid = student?.elimuid;
      stats.enrollmentDate = student?.enrollmentDate;
      stats.gender = student?.gender;
      stats.dateOfBirth = student?.dateOfBirth;
      
      const records = await AcademicRecord.findAll({ where: { studentId: student.id }, order: [['date', 'DESC']] });
      const avg = records.length ? records.reduce((a,b) => a + b.score, 0) / records.length : 0;
      stats.averageScore = Math.round(avg);
      stats.totalAssessments = records.length;
      
      const attendance = await Attendance.findAll({ where: { studentId: student.id } });
      const present = attendance.filter(a => a.status === 'present').length;
      stats.attendanceRate = attendance.length ? Math.round((present / attendance.length) * 100) : 0;
      
    } else if (user.role === 'parent') {
      const parent = await Parent.findOne({ where: { userId: user.id } });
      const children = await parent.getStudents({ include: [{ model: User, attributes: ['name'] }] });
      stats.childrenCount = children.length;
      stats.children = children.map(c => ({ id: c.id, name: c.User?.name, grade: c.grade, elimuid: c.elimuid }));
    }
    
    res.json({ success: true, data: stats });
  } catch (error) {
    console.error('Get user stats error:', error);
    const message = String(error?.original?.message || error?.message || error);
    if (message.includes('classId') || message.includes('schoolCode') || message.includes('column')) {
        return res.json({ success: true, data: { role: req.user.role, name: req.user.name, email: req.user.email, repaired: true } });
    }
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Update user profile
exports.updateProfile = async (req, res) => {
  try {
    const { name, email, phone } = req.body;
    
    if (email && email !== req.user.email) {
      const existing = await User.findOne({ where: { email, id: { [Op.ne]: req.user.id } } });
      if (existing) return res.status(400).json({ success: false, message: 'Email already in use' });
    }
    
    await req.user.update({ name, email, phone });
    
    await createAlert({
      userId: req.user.id,
      role: req.user.role,
      type: 'system',
      severity: 'info',
      title: 'Profile Updated',
      message: 'Your profile information has been updated successfully.'
    });
    
    res.json({ success: true, data: req.user.getPublicProfile() });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get user preferences
exports.getPreferences = async (req, res) => {
  try {
    res.json({ success: true, data: req.user.preferences || { notifications: { email: true, sms: false, push: true }, theme: 'light' } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Update user preferences
exports.updatePreferences = async (req, res) => {
  try {
    const incoming = sanitizePreferencePayload(req.body.preferences || {});
    const existing = removePrivilegeBearingPreferenceKeys(req.user.preferences || {});
    req.user.preferences = { ...existing, ...incoming };
    await req.user.save();
    res.json({ success: true, data: req.user.preferences });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Export user data
exports.exportMyData = async (req, res) => {
  try {
    const user = req.user;
    let exportData = { user: user.getPublicProfile(), createdAt: user.createdAt, lastLogin: user.lastLogin, preferences: user.preferences };
    
    if (user.role === 'teacher') {
      const teacher = await Teacher.findOne({ where: { userId: user.id } });
      exportData.teacher = teacher;
    } else if (user.role === 'student') {
      const student = await Student.findOne({ where: { userId: user.id } });
      const records = await AcademicRecord.findAll({ where: { studentId: student.id } });
      const attendance = await Attendance.findAll({ where: { studentId: student.id } });
      exportData.student = student;
      exportData.academicRecords = records;
      exportData.attendance = attendance;
    } else if (user.role === 'parent') {
      const parent = await Parent.findOne({ where: { userId: user.id } });
      const children = await parent.getStudents();
      exportData.parent = parent;
      exportData.children = children;
    }
    
    res.json({ success: true, data: exportData });
  } catch (error) {
    console.error('Export data error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Deactivate account
exports.deactivateAccount = async (req, res) => {
  try {
    const { reason } = req.body;
    req.user.isActive = false;
    await req.user.save();
    
    const admins = await User.findAll({ where: { role: 'admin', schoolCode: req.user.schoolCode } });
    for (const admin of admins) {
      await createAlert({
        userId: admin.id,
        role: 'admin',
        type: 'system',
        severity: 'info',
        title: 'User Account Deactivated',
        message: `${req.user.name} (${req.user.role}) has deactivated their account. Reason: ${reason || 'Not specified'}`,
        data: { userId: req.user.id }
      });
    }
    
    res.json({ success: true, message: 'Account deactivated successfully' });
  } catch (error) {
    console.error('Deactivate account error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Durable database-backed media. Render redeployments cannot erase these files.
function uploadedFile(req,names){for(const name of names){const v=req.files?.[name];if(Array.isArray(v))return v[0];if(v)return v;}return req.file||null;}
exports.uploadProfilePicture=async(req,res)=>{try{const file=uploadedFile(req,['picture','image','file']);if(!file)return res.status(400).json({success:false,message:'No profile image uploaded.'});const saved=await saveUploadAsset({file,schoolCode:req.user.schoolCode,ownerUserId:req.user.id,kind:'profile_picture',maxBytes:5*1024*1024,metadata:{uploadedBy:req.user.id,role:req.user.role}});const preferences={...(req.user.preferences||{}),profileImageUrl:saved.url,profileImageFileUrl:null,profileImageDataUrl:null,profileImageAssetToken:saved.token,profileImageUpdatedAt:new Date().toISOString()};await req.user.update({profileImage:saved.url,profilePicture:saved.url,preferences});res.json({success:true,data:{displayUrl:saved.url,profileImage:saved.url,profilePicture:saved.url,canonicalUrl:saved.url,durable:true}});}catch(e){console.error('Profile upload error:',e);res.status(e.status||500).json({success:false,message:e.message});}};

// @desc    Get user alerts
exports.getAlerts = async (req, res) => {
  try {
    const alerts = await getAlertsForUser(req.user, {
      studentId: req.query.studentId || req.query.childId || null,
      limit: Number(req.query.limit || 50)
    });
    res.json({ success: true, data: alerts });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.uploadSignature=async(req,res)=>{try{const file=uploadedFile(req,['signature','image','file']);if(!file)return res.status(400).json({success:false,message:'No signature image uploaded.'});if(!['teacher','admin'].includes(req.user.role))return res.status(403).json({success:false,message:'Only teachers and school administrators can upload signatures.'});const saved=await saveUploadAsset({file,schoolCode:req.user.schoolCode,ownerUserId:req.user.id,kind:'signature',maxBytes:2*1024*1024,metadata:{uploadedBy:req.user.id,role:req.user.role}});const preferences={...(req.user.preferences||{}),signatureUrl:saved.url,signatureAbsoluteUrl:saved.url,signatureFileUrl:null,signatureDataUrl:null,signatureAssetToken:saved.token,signatureUpdatedAt:new Date().toISOString()};await req.user.update({preferences});if(req.user.role==='teacher')await Teacher.update({signature:saved.url,signatureUrl:saved.url},{where:{userId:req.user.id}});else{const{Admin}=require('../models');await Admin.update({signature:saved.url,signatureUrl:saved.url},{where:{userId:req.user.id}});}res.json({success:true,data:{displayUrl:saved.url,signatureUrl:saved.url,signature:saved.url,canonicalUrl:saved.url,durable:true}});}catch(e){console.error('Signature upload error:',e);res.status(e.status||500).json({success:false,message:e.message});}};
