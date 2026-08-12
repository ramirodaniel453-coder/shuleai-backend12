const { Teacher, Class, Student, User, AcademicRecord, Attendance, StudentCompetencyProgress, Competency, LearningOutcome } = require('../models');
const { Op } = require('sequelize');

exports.getClassAnalytics = async (req, res) => {
  try {
    const teacher = await Teacher.findOne({ where: { userId: req.user.id } });
    if (!teacher) return res.status(403).json({ success: false, message: 'No teacher profile found' });
    const classItem = await Class.findOne({ where:{ schoolCode:req.user.schoolCode, isActive:true, [Op.or]:[{ teacherId:teacher.id }, { id:teacher.classId || 0 }] } });
    if (!classItem) return res.status(403).json({ success:false, message:'No active class-teacher assignment found' });
    const students = await Student.unscoped().findAll({
      where: { status:{ [Op.ne]:'inactive' }, [Op.or]:[{ classId:classItem.id }, { [Op.and]:[{ classId:null }, { grade:classItem.name }] }] },
      include: [{ model: User, attributes: ['name'], where:{ schoolCode:req.user.schoolCode }, required:true }]
    });
    const studentIds = students.map(s => s.id);
    // Overall average
    const records = await AcademicRecord.findAll({ where: { studentId: { [Op.in]: studentIds } } });
    let totalScore = 0, totalCount = 0;
    records.forEach(r => { totalScore += r.score; totalCount++; });
    const classAverage = totalCount ? Math.round(totalScore / totalCount) : 0;
    // Attendance today
    const today = new Date().toISOString().split('T')[0];
    const attendanceToday = await Attendance.findAll({ where: { studentId: { [Op.in]: studentIds }, date: today } });
    const presentCount = attendanceToday.filter(a => a.status === 'present').length;
    // Competency heatmap
    const competencies = await Competency.findAll();
    const outcomes = await LearningOutcome.findAll({ where: { gradeLevel: classItem.grade } });
    const progress = await StudentCompetencyProgress.findAll({
      where: { studentId: { [Op.in]: studentIds }, learningOutcomeId: { [Op.in]: outcomes.map(o => o.id) } }
    });
    const heatmap = students.map(s => ({
      studentName: s.User.name,
      competencies: competencies.map(c => {
        const outcome = outcomes.find(o => o.competencyId === c.id);
        if (!outcome) return { competency: c.code, level: 'N/A' };
        const p = progress.find(p => p.studentId === s.id && p.learningOutcomeId === outcome.id);
        return { competency: c.code, level: p ? p.level : 'BE' };
      })
    }));
    res.json({
      success: true,
      data: { classAverage, attendanceRate: `${presentCount}/${students.length}`, students, heatmap, classItem }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
