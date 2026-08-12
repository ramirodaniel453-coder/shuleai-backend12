const { sequelize, Badge, StudentBadge, Reward, StudentReward, Student, Parent, User, AcademicRecord, Attendance, Class, HomeTaskAssignment, HomeTask, AchievementEvent } = require('../models');
const { Op } = require('sequelize');


function normalizeScore(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function getCurrentStudent(req) {
  return Student.findOne({
    where: { userId: req.user.id },
    include: [{ model: User, required: true, where: { schoolCode: req.user.schoolCode }, attributes: ['id', 'name', 'email', 'schoolCode'] }]
  });
}

async function getSchoolStudent(studentId, schoolCode, transaction) {
  return Student.findOne({
    where: { id: Number(studentId) },
    include: [{ model: User, required: true, where: { schoolCode }, attributes: ['id', 'name', 'schoolCode'] }],
    transaction
  });
}

async function canViewStudent(req, student) {
  if (['admin', 'super_admin', 'teacher', 'finance_officer'].includes(req.user.role)) return true;
  if (req.user.role === 'student') return Number(student.userId) === Number(req.user.id);
  if (req.user.role === 'parent') {
    const parent = await Parent.findOne({ where: { userId: req.user.id } });
    return Boolean(parent && await parent.hasStudent(student));
  }
  return false;
}

function badgeStatus(earned, labelWhenEarned, labelWhenLocked) {
  return earned ? { earned: true, label: labelWhenEarned } : { earned: false, label: labelWhenLocked };
}

exports.getMyRewardsSummary = async (req, res) => {
  try {
    if (req.user.role !== 'student') {
      return res.status(403).json({ success: false, message: 'Only students can view personal rewards' });
    }

    const student = await getCurrentStudent(req);
    if (!student) return res.status(404).json({ success: false, message: 'Student profile not found' });

    const since30 = new Date();
    since30.setDate(since30.getDate() - 30);

    const [attendanceRows, homeworkRows, gradeRows, achievementRows] = await Promise.all([
      Attendance.findAll({
        where: { studentId: student.id, schoolCode: req.user.schoolCode, date: { [Op.gte]: since30 } },
        order: [['date', 'DESC']],
        limit: 60
      }).catch(() => []),
      HomeTaskAssignment.findAll({
        where: { studentId: student.id },
        include: [{ model: HomeTask, required: false }],
        order: [['createdAt', 'DESC']],
        limit: 80
      }).catch(() => []),
      AcademicRecord.findAll({
        where: {
          studentId: student.id,
          schoolCode: req.user.schoolCode,
          [Op.or]: [{ isPublished: true }, { status: 'published' }]
        },
        order: [['year', 'DESC'], ['createdAt', 'DESC']],
        limit: 120
      }).catch(() => []),
      AchievementEvent.findAll({
        where: { studentId: student.id },
        order: [['createdAt', 'DESC']],
        limit: 30
      }).catch(() => [])
    ]);

    const attendanceMarked = attendanceRows.length;
    const presentCount = attendanceRows.filter(a => ['present', 'late'].includes(String(a.status || '').toLowerCase())).length;
    const attendanceRate = attendanceMarked ? Math.round((presentCount / attendanceMarked) * 100) : null;

    const homeworkTotal = homeworkRows.length;
    const homeworkDone = homeworkRows.filter(h => ['completed', 'submitted', 'graded'].includes(String(h.status || '').toLowerCase())).length;
    const homeworkRate = homeworkTotal ? Math.round((homeworkDone / homeworkTotal) * 100) : null;

    const scored = gradeRows.map(g => normalizeScore(g.score)).filter(v => v !== null);
    const averageScore = scored.length ? Math.round(scored.reduce((a, b) => a + b, 0) / scored.length) : null;

    const bySubject = new Map();
    for (const row of gradeRows) {
      const score = normalizeScore(row.score);
      if (score === null) continue;
      const subject = row.subject || 'General';
      if (!bySubject.has(subject)) bySubject.set(subject, []);
      bySubject.get(subject).push({ score, date: row.date || row.createdAt });
    }
    let improvedSubjects = 0;
    for (const scores of bySubject.values()) {
      if (scores.length >= 2 && scores[0].score > scores[scores.length - 1].score) improvedSubjects += 1;
    }

    const teacherPoints = achievementRows.reduce((sum, e) => sum + (Number(e.points) || 0), 0);
    const storedPoints = Number(student.points) || 0;
    const totalPoints = Math.max(storedPoints, teacherPoints);

    const badges = [
      {
        key: 'attendance_star',
        icon: '⭐',
        title: 'Attendance Star',
        description: attendanceRate === null ? 'Attendance badge appears after attendance is marked.' : `${attendanceRate}% attendance in the last 30 days.`,
        category: 'Attendance',
        points: attendanceRate !== null && attendanceRate >= 95 ? 25 : 0,
        ...badgeStatus(attendanceRate !== null && attendanceRate >= 95, 'Earned', attendanceRate === null ? 'Waiting for records' : 'Reach 95%')
      },
      {
        key: 'homework_hero',
        icon: '📚',
        title: 'Homework Hero',
        description: homeworkRate === null ? 'Homework badge appears after assignments are issued.' : `${homeworkRate}% homework completion.`,
        category: 'Homework',
        points: homeworkRate !== null && homeworkRate >= 90 ? 25 : 0,
        ...badgeStatus(homeworkRate !== null && homeworkRate >= 90, 'Earned', homeworkRate === null ? 'Waiting for assignments' : 'Reach 90%')
      },
      {
        key: 'performance_badge',
        icon: '🏆',
        title: 'Performance Badge',
        description: averageScore === null ? 'Performance badge appears after marks are published.' : `Current published average is ${averageScore}%.`,
        category: 'Academics',
        points: averageScore !== null && averageScore >= 75 ? 30 : 0,
        ...badgeStatus(averageScore !== null && averageScore >= 75, 'Earned', averageScore === null ? 'Waiting for marks' : 'Reach 75% average')
      },
      {
        key: 'most_improved',
        icon: '📈',
        title: 'Most Improved',
        description: scored.length < 2 ? 'Improvement badge appears after more than one assessment.' : `${improvedSubjects} subject${improvedSubjects === 1 ? '' : 's'} improving.`,
        category: 'Improvement',
        points: improvedSubjects > 0 ? 20 : 0,
        ...badgeStatus(improvedSubjects > 0, 'Earned', scored.length < 2 ? 'Need more marks' : 'Improve next test')
      },
      {
        key: 'participation_points',
        icon: '💬',
        title: 'Participation Points',
        description: achievementRows.length ? `${achievementRows.length} teacher-awarded achievement event${achievementRows.length === 1 ? '' : 's'}.` : 'Teacher-awarded study participation will appear here.',
        category: 'Participation',
        points: teacherPoints,
        ...badgeStatus(teacherPoints > 0, 'Earned', 'Join study discussions')
      }
    ];

    const actions = [];
    if (attendanceRate !== null && attendanceRate < 95) actions.push('Improve attendance consistency to unlock Attendance Star.');
    if (homeworkRate !== null && homeworkRate < 90) actions.push('Submit pending homework on time to unlock Homework Hero.');
    if (averageScore !== null && averageScore < 75) actions.push('Raise your average score to 75% for the Performance Badge.');
    if (teacherPoints <= 0) actions.push('Participate in study discussions so teachers can award points.');
    if (actions.length === 0 && badges.some(b => b.earned)) actions.push('Great progress. Keep the streak going.');

    res.json({
      success: true,
      data: {
        student: { id: student.id, name: student.User?.name || 'Student', grade: student.grade, classId: student.classId },
        summary: {
          totalPoints,
          earnedBadges: badges.filter(b => b.earned).length,
          availableBadges: badges.length,
          attendanceRate,
          homeworkRate,
          averageScore,
          participationEvents: achievementRows.length
        },
        badges,
        recentEvents: achievementRows.slice(0, 8).map(e => ({
          id: e.id,
          title: e.title || 'Achievement',
          note: e.note || '',
          points: Number(e.points) || 0,
          createdAt: e.createdAt
        })),
        actions
      }
    });
  } catch (error) {
    console.error('getMyRewardsSummary error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Leaderboard for a class (points)
exports.getClassLeaderboard = async (req, res) => {
  try {
    const { classId } = req.params;
    const classItem = await Class.findOne({ where: { id: Number(classId), schoolCode: req.user.schoolCode } });
    if (!classItem) return res.status(404).json({ success: false, message: 'Class not found' });

    const students = await Student.findAll({
      where: { classId: classItem.id },
      include: [{ model: User, required: true, where: { schoolCode: req.user.schoolCode }, attributes: ['name'] }],
      order: [['points', 'DESC']],
      limit: 20
    });

    const leaderboard = students.map((s, index) => ({
      rank: index + 1,
      studentId: s.id,
      name: s.User.name,
      points: s.points
    }));

    res.json({ success: true, data: leaderboard });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get student badges
exports.getStudentBadges = async (req, res) => {
  try {
    const { studentId } = req.params;
    const student = await getSchoolStudent(studentId, req.user.schoolCode);
    if (!student) return res.status(404).json({ success: false, message: 'Student not found in your school' });
    if (!(await canViewStudent(req, student))) return res.status(403).json({ success: false, message: 'You cannot view this student\'s badges' });
    const badges = await StudentBadge.findAll({
      where: { studentId },
      include: [{ model: Badge, required: true, where: { schoolId: req.user.schoolCode } }]
    });
    res.json({ success: true, data: badges });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Admin: create badge
exports.createBadge = async (req, res) => {
  try {
    const { name, description, icon, category, requiredPoints } = req.body;
    const badge = await Badge.create({
      name, description, icon, category, requiredPoints,
      schoolId: req.user.schoolCode
    });
    res.status(201).json({ success: true, data: badge });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Admin: award badge to student
exports.awardBadge = async (req, res) => {
  try {
    const { studentId, badgeId } = req.body;
    const [student, badge] = await Promise.all([
      getSchoolStudent(studentId, req.user.schoolCode),
      Badge.findOne({ where: { id: Number(badgeId), schoolId: req.user.schoolCode } })
    ]);
    if (!student) return res.status(404).json({ success: false, message: 'Student not found in your school' });
    if (!badge) return res.status(404).json({ success: false, message: 'Badge not found in your school' });
    await StudentBadge.findOrCreate({ where: { studentId: Number(studentId), badgeId: Number(badgeId) } });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Rewards store. This is now a real store only; no fake default rewards are returned.
exports.getRewards = async (req, res) => {
  try {
    const rewards = await Reward.findAll({
      where: { schoolId: req.user.schoolCode, isActive: true },
      order: [['pointsCost', 'ASC']]
    });
    res.json({ success: true, data: rewards || [] });
  } catch (error) {
    console.error('getRewards error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.redeemReward = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { rewardId } = req.body;
    const student = await Student.findOne({ where: { userId: req.user.id }, transaction, lock: transaction.LOCK.UPDATE });
    const reward = await Reward.findOne({ where: { id: Number(rewardId), schoolId: req.user.schoolCode, isActive: true }, transaction, lock: transaction.LOCK.UPDATE });
    if (!student) { await transaction.rollback(); return res.status(404).json({ success: false, message: 'Student profile not found' }); }
    if (!reward) { await transaction.rollback(); return res.status(404).json({ success: false, message: 'Reward not found in your school' }); }
    if (student.points < reward.pointsCost) {
      await transaction.rollback();
      return res.status(400).json({ success: false, message: 'Insufficient points' });
    }
    if (Number(reward.quantity) === 0) {
      await transaction.rollback();
      return res.status(409).json({ success: false, message: 'Reward is out of stock' });
    }
    // Deduct points
    student.points -= reward.pointsCost;
    await student.save({ transaction });
    // Create redemption record
    await StudentReward.create({
      studentId: student.id,
      rewardId: reward.id,
      pointsSpent: reward.pointsCost
    }, { transaction });
    // If quantity limited, reduce
    if (reward.quantity > 0) {
      reward.quantity -= 1;
      await reward.save({ transaction });
    }
    await transaction.commit();
    res.json({ success: true, message: 'Reward redeemed', pointsRemaining: student.points });
  } catch (error) {
    if (!transaction.finished) await transaction.rollback();
    res.status(500).json({ success: false, message: error.message });
  }
};
