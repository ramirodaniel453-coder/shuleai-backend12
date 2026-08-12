const { Competency, LearningOutcome, StudentCompetencyProgress, Student, Teacher, Class, User } = require('../models');
const { Op } = require('sequelize');

async function currentClassTeacherContext(req) {
  const teacher = await Teacher.findOne({ where:{ userId:req.user.id } });
  if (!teacher) return { teacher:null, classItem:null, students:[] };
  const classItem = await Class.findOne({ where:{ schoolCode:req.user.schoolCode, isActive:true, [Op.or]:[{ teacherId:teacher.id }, { id:teacher.classId || 0 }] } });
  if (!classItem) return { teacher, classItem:null, students:[] };
  const students = await Student.unscoped().findAll({
    where:{ status:{ [Op.ne]:'inactive' }, [Op.or]:[{ classId:classItem.id }, { [Op.and]:[{ classId:null }, { grade:classItem.name }] }] },
    include:[{ model:User, attributes:['id','name'], where:{ schoolCode:req.user.schoolCode }, required:true }]
  });
  return { teacher, classItem, students };
}

// ============ COMPETENCIES ============
exports.getCompetencies = async (req, res) => {
  try {
    const competencies = await Competency.findAll({
      where: { curriculum: req.user.school?.system || 'cbc' },
      include: [{ model: LearningOutcome }]
    });
    res.json({ success: true, data: competencies });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.createCompetency = async (req, res) => {
  try {
    const { code, name, description, category } = req.body;
    const competency = await Competency.create({
      code, name, description, category,
      curriculum: req.user.school?.system || 'cbc'
    });
    res.status(201).json({ success: true, data: competency });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============ LEARNING OUTCOMES ============
exports.getLearningOutcomes = async (req, res) => {
  try {
    const { subject, gradeLevel } = req.query;
    const where = { curriculum: req.user.school?.system || 'cbc' };
    if (subject) where.subject = subject;
    if (gradeLevel) where.gradeLevel = gradeLevel;
    const outcomes = await LearningOutcome.findAll({
      where,
      include: [{ model: Competency }]
    });
    res.json({ success: true, data: outcomes });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.createLearningOutcome = async (req, res) => {
  try {
    const { code, description, subject, gradeLevel, competencyId } = req.body;
    const outcome = await LearningOutcome.create({
      code, description, subject, gradeLevel, competencyId,
      curriculum: req.user.school?.system || 'cbc'
    });
    res.status(201).json({ success: true, data: outcome });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============ STUDENT COMPETENCY PROGRESS ============
exports.getStudentProgress = async (req, res) => {
  try {
    const { studentId } = req.params;
    const progress = await StudentCompetencyProgress.findAll({
      where: { studentId },
      include: [{ model: LearningOutcome, include: [{ model: Competency }] }]
    });
    res.json({ success: true, data: progress });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateStudentProgress = async (req, res) => {
  try {
    const { studentId, learningOutcomeId, level, evidence, notes } = req.body;
    const [progress, created] = await StudentCompetencyProgress.upsert({
      studentId,
      learningOutcomeId,
      level,
      evidence: evidence || [],
      notes,
      lastUpdated: new Date()
    });
    res.json({ success: true, data: progress });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============ TEACHER DASHBOARD DATA ============
exports.getClassCompetencyHeatmap = async (req, res) => {
  try {
    const { teacher, classItem, students } = await currentClassTeacherContext(req);
    if (!teacher || !classItem) return res.status(403).json({ success:false, message:'No active class-teacher assignment found' });
    const studentIds = students.map(s => s.id);
    const outcomes = await LearningOutcome.findAll({
      where: { gradeLevel: classItem.grade, curriculum: req.user.school?.system || 'cbc' },
      include: [{ model: Competency }]
    });
    const progress = await StudentCompetencyProgress.findAll({
      where: { studentId: { [Op.in]: studentIds }, learningOutcomeId: { [Op.in]: outcomes.map(o => o.id) } }
    });
    // Build heatmap: rows = students, columns = outcomes, value = level
    const heatmap = students.map(student => ({
      studentId: student.id,
      studentName: student.User?.name,
      outcomes: outcomes.map(outcome => {
        const record = progress.find(p => p.studentId === student.id && p.learningOutcomeId === outcome.id);
        return { outcomeId: outcome.id, outcomeCode: outcome.code, level: record?.level || 'BE' };
      })
    }));
    res.json({ success: true, data: { heatmap, outcomes, students: students.map(s => ({ id: s.id, name: s.User?.name })) } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getBelowExpectationStudents = async (req, res) => {
  try {
    const { teacher, classItem, students } = await currentClassTeacherContext(req);
    if (!teacher || !classItem) return res.status(403).json({ success:false, message:'No active class-teacher assignment found' });
    const studentIds = students.map(s => s.id);
    const belowExpectation = await StudentCompetencyProgress.findAll({
      where: { studentId: { [Op.in]: studentIds }, level: { [Op.in]: ['AE', 'BE'] } },
      include: [{ model: LearningOutcome, include: [{ model: Competency }] }]
    });
    // Group by student and competency
    const grouped = {};
    belowExpectation.forEach(record => {
      if (!grouped[record.studentId]) grouped[record.studentId] = [];
      grouped[record.studentId].push({
        competency: record.LearningOutcome.Competency.name,
        outcome: record.LearningOutcome.description,
        level: record.level
      });
    });
    const result = students.map(student => ({
      studentId: student.id,
      studentName: student.User?.name,
      weakAreas: grouped[student.id] || []
    })).filter(s => s.weakAreas.length > 0);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getAutoInsights = async (req, res) => {
  try {
    const { teacher, classItem, students } = await currentClassTeacherContext(req);
    if (!teacher || !classItem) return res.status(403).json({ success:false, message:'No active class-teacher assignment found' });
    const studentIds = students.map(s => s.id);
    const progress = await StudentCompetencyProgress.findAll({
      where: { studentId: { [Op.in]: studentIds } },
      include: [{ model: LearningOutcome, include: [{ model: Competency }] }]
    });
    // Count per competency how many students are below expectation (AE/BE)
    const competencyStats = {};
    progress.forEach(p => {
      const compName = p.LearningOutcome.Competency.name;
      if (!competencyStats[compName]) competencyStats[compName] = { total: 0, below: 0 };
      competencyStats[compName].total++;
      if (p.level === 'AE' || p.level === 'BE') competencyStats[compName].below++;
    });
    const insights = Object.entries(competencyStats).map(([comp, stats]) => ({
      competency: comp,
      percentBelow: Math.round((stats.below / stats.total) * 100),
      message: `${stats.below} out of ${stats.total} students below expectation in ${comp}.`
    })).filter(i => i.percentBelow > 50);
    res.json({ success: true, data: insights });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// AI suggestion (rule‑based)
exports.getAISuggestion = async (req, res) => {
  try {
    const { studentId, subject, competencyId } = req.body;
    // Simplified rule engine
    const suggestions = [];
    if (subject === 'Mathematics') suggestions.push('Practice basic arithmetic daily.');
    if (competencyId === 'CC2') suggestions.push('Solve one word problem each day.');
    res.json({ success: true, data: { suggestions, message: 'AI generated recommendations.' } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
