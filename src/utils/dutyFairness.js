const { Op } = require('sequelize');
const { Teacher, DutyRoster, Alert, User } = require('../models');
const moment = require('moment');
const { createAlert } = require('../services/notificationService');
const { DUTY_AREAS, DUTY_TIME_SLOTS } = require('../config/constants');

/**
 * Check if a teacher has timetable conflict
 */
const hasTimetableConflict = (teacher, dayOfWeek, dutyType) => {
  const dutyTime = DUTY_TIME_SLOTS[dutyType]?.start;
  if (!dutyTime) return false;
  
  const timetable = teacher.timetable || {};
  const daySchedule = timetable[dayOfWeek] || [];
  
  const [dutyHour, dutyMinute] = dutyTime.split(':').map(Number);
  const dutyMinutes = dutyHour * 60 + dutyMinute;
  
  return daySchedule.some(period => {
    const [startHour, startMinute] = (period.start || '00:00').split(':').map(Number);
    const [endHour, endMinute] = (period.end || '00:00').split(':').map(Number);
    const startMinutes = startHour * 60 + startMinute;
    const endMinutes = endHour * 60 + endMinute;
    return dutyMinutes >= startMinutes && dutyMinutes <= endMinutes;
  });
};

const getTeachersByFairness = async (schoolCode, date, excludeTeacherIds = []) => {
  const startOfMonth = moment().startOf('month').format('YYYY-MM-DD');
  const endOfMonth = moment().endOf('month').format('YYYY-MM-DD');
  
  // Get all approved teachers
  const teachers = await Teacher.findAll({
    where: { approvalStatus: 'approved' },
    include: [{ 
      model: User, 
      where: { 
        schoolCode,
        id: { [Op.notIn]: excludeTeacherIds }
      } 
    }]
  });

  // Get duty counts for this month
  const rosters = await DutyRoster.findAll({
    where: {
      schoolId: schoolCode,
      date: { [Op.between]: [startOfMonth, endOfMonth] }
    }
  });

  // Calculate duty counts per teacher
  const teacherDutyCounts = {};
  rosters.forEach(roster => {
    roster.duties.forEach(duty => {
      teacherDutyCounts[duty.teacherId] = (teacherDutyCounts[duty.teacherId] || 0) + 1;
    });
  });

  // Add count to teachers and sort
  const teachersWithCount = teachers.map(teacher => ({
    ...teacher.toJSON(),
    dutyCount: teacherDutyCounts[teacher.id] || 0,
    monthlyDutyCount: teacher.statistics?.monthlyDutyCount || 0
  }));

  // Sort by: monthly count (ascending) > total duties (ascending) > reliability (descending)
  return teachersWithCount.sort((a, b) => {
    if (a.monthlyDutyCount !== b.monthlyDutyCount) {
      return a.monthlyDutyCount - b.monthlyDutyCount;
    }
    if (a.dutyCount !== b.dutyCount) {
      return a.dutyCount - b.dutyCount;
    }
    return (b.statistics?.reliabilityScore || 0) - (a.statistics?.reliabilityScore || 0);
  });
};

/**
 * Check for understaffed areas
 */
const checkUnderstaffedAreas = async (schoolCode, date) => {
  const requiredPerArea = {
    morning: 2,
    lunch: 3,
    afternoon: 2,
    whole_day: 1
  };

  const roster = await DutyRoster.findOne({
    where: { schoolId: schoolCode, date }
  });

  if (!roster) {
    return Object.entries(requiredPerArea).map(([area, required]) => ({
      area,
      current: 0,
      required,
      status: 'understaffed'
    }));
  }

  const areaCount = {};
  roster.duties.forEach(d => {
    areaCount[d.type] = (areaCount[d.type] || 0) + 1;
  });

  const understaffed = [];
  Object.entries(requiredPerArea).forEach(([area, required]) => {
    const current = areaCount[area] || 0;
    if (current < required) {
      understaffed.push({
        area,
        current,
        required,
        status: 'understaffed',
        shortage: required - current
      });
    }
  });

  return understaffed;
};

/**
 * Auto-assign duty with fairness and conflict checking
 */
const assignDutyFairly = async (schoolCode, date, dutyType, requiredCount = 1) => {
  const dayOfWeek = moment(date).format('dddd').toLowerCase();
  const teachers = await getTeachersByFairness(schoolCode, date);
  
  const assigned = [];
  const conflicts = [];

  for (const teacher of teachers) {
    if (assigned.length >= requiredCount) break;

    // Check blackout dates
    if (teacher.dutyPreferences?.blackoutDates?.includes(date)) {
      conflicts.push({ teacherId: teacher.id, reason: 'blackout' });
      continue;
    }

    // Check timetable conflict
    if (hasTimetableConflict(teacher, dayOfWeek, dutyType)) {
      conflicts.push({ teacherId: teacher.id, reason: 'timetable' });
      continue;
    }

    // Check max duties per week
    const weeklyCount = teacher.statistics?.weeklyDutyCount || 0;
    if (weeklyCount >= (teacher.dutyPreferences?.maxDutiesPerWeek || 3)) {
      conflicts.push({ teacherId: teacher.id, reason: 'max_weekly_reached' });
      continue;
    }

    assigned.push(teacher);
  }

  return { assigned, conflicts, shortage: requiredCount - assigned.length };
};

/**
 * Update teacher statistics after duty assignment
 */
const updateTeacherDutyStats = async (teacherId, action, dutyType = null) => {
  const teacher = await Teacher.findByPk(teacherId);
  if (!teacher) return;
  const stats = teacher.statistics || {};
  const pointsMap = { morning: 10, lunch: 15, afternoon: 12, whole_day: 25 };
  if (action === 'assign' && dutyType) {
    stats.points = (stats.points || 0) + (pointsMap[dutyType] || 10);
    stats.monthlyDutyCount = (stats.monthlyDutyCount || 0) + 1;
    stats.weeklyDutyCount = (stats.weeklyDutyCount || 0) + 1;
    stats.totalDutiesAssigned = (stats.totalDutiesAssigned || 0) + 1;
    stats.lastDutyDate = new Date();
  } else if (action === 'complete') {
    stats.dutiesCompleted = (stats.dutiesCompleted || 0) + 1;
  } else if (action === 'miss') {
    stats.dutiesMissed = (stats.dutiesMissed || 0) + 1;
  }
  teacher.statistics = stats;
  await teacher.save();
};

module.exports = {
  hasTimetableConflict,
  getTeachersByFairness,
  checkUnderstaffedAreas,
  assignDutyFairly,
  updateTeacherDutyStats
};
