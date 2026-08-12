const { HomeTask, HomeTaskAssignment, Student, Competency, LearningOutcome, StudentCompetencyProgress, AcademicRecord, Parent, User } = require('../models');
const { Op } = require('sequelize');
const ownership = require('../services/parentOwnershipService');

// Get today's recommendations for a student (parent view)
exports.getTodayTasks = async (req, res) => {
  try {
    const { studentId } = req.query;
    if (!studentId) return res.status(400).json({ success: false, message: 'Student ID required' });

    const student = await (Student.unscoped ? Student.unscoped() : Student).findOne({
      where: { id: Number(studentId) },
      include: [{ model: User, required: true, where: { schoolCode: req.user.schoolCode }, attributes: ['id','name','schoolCode'] }]
    });
    if (!student) return res.status(404).json({ success: false, message: 'Student not found in this school' });

    if (req.user.role === 'parent') {
      await ownership.assertParentOwnsStudent({ parentUserId: req.user.id, studentId: student.id, schoolCode: req.user.schoolCode });
    }

    // First return teacher-assigned pending homework if available.
    try {
      const assignments = await HomeTaskAssignment.findAll({
        where: { studentId, status: { [Op.in]: ['pending', 'assigned'] } },
        include: [{ model: HomeTask }],
        order: [['assignedAt', 'DESC']],
        limit: 10
      });

      const assignedTasks = assignments
        .filter(a => a.HomeTask)
        .map(a => ({
          ...a.HomeTask.toJSON(),
          assignmentId: a.id,
          status: a.status,
          assignedAt: a.assignedAt,
          source: 'teacher-assigned'
        }));

      if (assignedTasks.length > 0) {
        return res.json({ success: true, data: assignedTasks });
      }
    } catch (assignmentError) {
      console.warn('Could not load assigned home tasks; falling back to recommendations:', assignmentError.message);
    }

    // 1. Get weak competencies (AE/BE)
    const progress = await StudentCompetencyProgress.findAll({
      where: { studentId, level: { [Op.in]: ['AE', 'BE'] } },
      include: [{ model: LearningOutcome, include: [{ model: Competency }] }]
    });
    const weakCompetencyIds = [...new Set(progress.map(p => p.LearningOutcome.competencyId))];

    // 2. Get weak subjects (average < 50)
    const records = await AcademicRecord.findAll({ where: { studentId } });
    const subjectScores = {};
    records.forEach(r => {
      if (!subjectScores[r.subject]) subjectScores[r.subject] = { total: 0, count: 0 };
      subjectScores[r.subject].total += r.score;
      subjectScores[r.subject].count++;
    });
    const weakSubjects = Object.entries(subjectScores)
      .filter(([_, data]) => (data.total / data.count) < 50)
      .map(([subject]) => subject);

    // 3. Get recently assigned tasks to exclude
    const assignedTasks = await HomeTaskAssignment.findAll({
      where: { studentId, assignedAt: { [Op.gte]: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
      attributes: ['taskId']
    });
    const excludedTaskIds = assignedTasks.map(a => a.taskId);

    // Helper: get random tasks
    const getRandomTasks = async (whereClause, limit) => {
      const tasks = await HomeTask.findAll({ where: whereClause });
      return tasks.sort(() => 0.5 - Math.random()).slice(0, limit);
    };

    const selectedTasks = [];

    // From weak competencies
    for (const compId of weakCompetencyIds.slice(0, 2)) {
      const tasks = await getRandomTasks({
        gradeLevel: student.grade,
        competencyId: compId,
        difficulty: { [Op.in]: ['Easy', 'Medium'] },
        id: { [Op.notIn]: excludedTaskIds },
        isActive: true
      }, 1);
      if (tasks.length) selectedTasks.push(tasks[0]);
    }

    // Fill up to 5 tasks with variety
    if (selectedTasks.length < 5) {
      const types = ['Practice', 'Application', 'Reflection'];
      for (const type of types) {
        if (selectedTasks.length >= 5) break;
        const tasks = await getRandomTasks({
          gradeLevel: student.grade,
          type,
          id: { [Op.notIn]: excludedTaskIds },
          isActive: true
        }, 1);
        if (tasks.length && !selectedTasks.some(t => t.id === tasks[0].id)) {
          selectedTasks.push(tasks[0]);
        }
      }
    }

    // If still less than 5, grab any active tasks
    if (selectedTasks.length < 5) {
      const remaining = await getRandomTasks({
        gradeLevel: student.grade,
        id: { [Op.notIn]: excludedTaskIds },
        isActive: true
      }, 5 - selectedTasks.length);
      for (const task of remaining) {
        if (!selectedTasks.some(t => t.id === task.id)) {
          selectedTasks.push(task);
        }
      }
    }

    res.json({ success: true, data: selectedTasks.slice(0, 5) });
  } catch (error) {
    console.error('Get today tasks error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.completeTask = async (req, res) => {
  try {
    const { id } = req.params;
    const { parentFeedback, studentFeedback, studentId: requestedStudentId } = req.body;

    const parent = await Parent.findOne({ where: { userId: req.user.id } });
    if (!parent) return res.status(404).json({ success: false, message: 'Parent not found' });

    let assignment = await HomeTaskAssignment.findByPk(id, {
      include: [{ model: HomeTask }, { model: Student, include: [{ model: require('../models').User, attributes: ['id','schoolCode','name'] }] }]
    });

    // Some older frontend cards passed HomeTask.id instead of HomeTaskAssignment.id.
    // Resolve it safely only for this parent's linked children.
    if (!assignment) {
      const linkedIds = await ownership.listOwnedStudentIds({ parentUserId: req.user.id, schoolCode: req.user.schoolCode });
      assignment = await HomeTaskAssignment.findOne({
        where: { taskId: id, studentId: { [Op.in]: linkedIds.length ? linkedIds : [-1] } },
        include: [{ model: HomeTask }, { model: Student, include: [{ model: require('../models').User, attributes: ['id','schoolCode','name'] }] }],
        order: [['assignedAt', 'DESC']]
      });
    }

    if (!assignment) {
      return res.status(404).json({ success: false, message: 'Task assignment not found for this child.' });
    }

    const task = assignment.HomeTask;
    const student = assignment.Student;
    const hasChild = await ownership.ownsStudentId({ parentUserId: req.user.id, parentId: parent.id, studentId: student.id, schoolCode: req.user.schoolCode });
    if (!hasChild) return res.status(403).json({ success: false, message: 'You cannot update this task because it is not assigned to your child.' });

    assignment.status = 'completed';
    assignment.completedAt = new Date();
    assignment.parentFeedback = parentFeedback || {};
    assignment.studentFeedback = studentFeedback || {};
    assignment.pointsEarned = task.points;
    await assignment.save();

    // Award points to student
    student.points = (student.points || 0) + task.points;
    await student.save();

    res.json({
      success: true,
      data: {
        assignment,
        studentPoints: student.points
      }
    });
  } catch (error) {
    console.error('Complete task error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};
