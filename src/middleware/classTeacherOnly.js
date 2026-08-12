const schoolLinkageService = require('../services/schoolLinkageService');

module.exports = async function classTeacherOnly(req, res, next) {
  try {
    if (req.user?.role !== 'teacher') {
      return res.status(403).json({ success:false, message:'Class teacher access required.' });
    }
    const teacher = await schoolLinkageService.resolveTeacherProfile(req.user.id);
    if (!teacher) return res.status(403).json({ success:false, message:'Teacher profile not found.' });
    const classes = await schoolLinkageService.resolveTeacherAssignedClasses(req.user.id, req.user.schoolCode, { classTeacherOnly:true });
    if (!classes.length) {
      return res.status(403).json({ success:false, code:'CLASS_TEACHER_REQUIRED', message:'This section is available only to an assigned class teacher.' });
    }
    req.teacherProfile = teacher;
    req.classTeacherClasses = classes;
    req.classTeacherClassIds = classes.map(c => Number(c.id)).filter(Boolean);
    next();
  } catch (error) {
    console.error('Class teacher authorization error:', error);
    res.status(500).json({ success:false, message:'Class teacher assignment could not be verified.' });
  }
};
