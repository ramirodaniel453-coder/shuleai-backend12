const { Op } = require('sequelize');
const crypto = require('crypto');
const QRCode = require('qrcode');

function v87IsValidISODate(value) {
  if (!value || typeof value !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value + 'T00:00:00Z');
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0,10) === value;
}

const { User, Teacher, School, DutyRoster } = require('../models');
const moment = require('moment');
const { DUTY_AREAS, DUTY_TIME_SLOTS } = require('../config/constants');
const { createAlert, createBulkAlerts } = require('../services/notificationService');
const realtime = require('../services/realtimeService');
const dutyFairness = require('../utils/dutyFairness');

// ============ HELPER FUNCTIONS ============

async function checkUnderstaffedDays(schoolId, startDate, endDate) {
  const rosters = await DutyRoster.findAll({
    where: { schoolId, date: { [Op.between]: [startDate, endDate] } }
  });
  const requiredPerArea = { morning: 2, lunch: 3, afternoon: 2 };
  const understaffedDays = [];
  rosters.forEach(roster => {
    const areaCount = {};
    roster.duties.forEach(d => { areaCount[d.type] = (areaCount[d.type] || 0) + 1; });
    const missing = [];
    Object.entries(requiredPerArea).forEach(([area, required]) => {
      if ((areaCount[area] || 0) < required) missing.push(area);
    });
    if (missing.length > 0) understaffedDays.push({ date: roster.date, missingAreas: missing });
  });
  return understaffedDays;
}

function generateRecommendations(teacherStats, departmentStats) {
  const recommendations = [];
  const avgDuties = teacherStats.reduce((a, b) => a + b.scheduled, 0) / teacherStats.length || 0;
  const overworked = teacherStats.filter(t => t.scheduled > avgDuties * 1.5);
  if (overworked.length > 0) {
    recommendations.push({
      type: 'workload_balance',
      message: `${overworked.length} teachers have above-average duty load`,
      teachers: overworked.map(t => t.teacherName)
    });
  }
  Object.entries(departmentStats).forEach(([dept, stats]) => {
    const deptAvg = stats.totalDuties / stats.teachers;
    if (deptAvg > 10) {
      recommendations.push({
        type: 'department_overload',
        department: dept,
        message: `${dept} department has high duty load (${deptAvg.toFixed(1)} per teacher)`
      });
    }
  });
  return recommendations;
}


// ============ V9.3 SMART DUTY VERIFICATION HELPERS ============
function toRad(value) {
  return (Number(value) * Math.PI) / 180;
}

function distanceMeters(aLat, aLng, bLat, bLng) {
  if ([aLat, aLng, bLat, bLng].some(v => v === undefined || v === null || Number.isNaN(Number(v)))) return null;
  const R = 6371000;
  const dLat = toRad(Number(bLat) - Number(aLat));
  const dLng = toRad(Number(bLng) - Number(aLng));
  const lat1 = toRad(Number(aLat));
  const lat2 = toRad(Number(bLat));
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

function getDutyVerificationSettings(school) {
  const duty = school?.settings?.dutyManagement || {};
  const geo = duty.geoFence || {};
  const location = geo.center || duty.schoolLocation || school.address?.location || {};
  // v17: GPS should be optional unless the school admin explicitly requires it.
  // Earlier builds defaulted requireGps to true, which caused normal teacher dashboard
  // check-in buttons to fail with 'GPS location is required'.
  return {
    enabled: geo.enabled === true,
    requireGps: geo.requireGps === true,
    requireQr: geo.requireQr === true,
    radiusMeters: Number(geo.radiusMeters || duty.allowedRadiusMeters || 150),
    schoolLat: Number(location.lat || location.latitude || process.env.SCHOOL_LATITUDE || 0) || null,
    schoolLng: Number(location.lng || location.longitude || process.env.SCHOOL_LONGITUDE || 0) || null,
    reportingTime: duty.reportingTime || '07:00',
    dutyGraceMinutes: Number(duty.dutyGraceMinutes || duty.checkInWindow || 15),
    checkInWindow: Number(duty.checkInWindow || duty.dutyGraceMinutes || 15),
    studentReportingTime: duty.studentReportingTime || '07:30',
    studentGraceMinutes: Number(duty.studentGraceMinutes || 10),
    dutyPoints: Array.isArray(duty.dutyPoints) ? duty.dutyPoints.filter(p => p && p.active !== false) : [],
    dutySlots: Array.isArray(duty.dutySlots) ? duty.dutySlots.filter(slot => slot && slot.active !== false) : []
  };
}

function expectedDutyStart(duty, date) {
  const raw = duty.startTime || duty.timeStart || duty.time || duty.slotStart || null;
  const time = raw && String(raw).match(/\d{1,2}:\d{2}/) ? String(raw).match(/\d{1,2}:\d{2}/)[0] : null;
  return moment(`${date} ${time || '07:00'}`, 'YYYY-MM-DD HH:mm');
}

function checkLateStatus(expectedMoment, actualMoment, graceMinutes) {
  const lateAfter = expectedMoment.clone().add(Number(graceMinutes || 0), 'minutes');
  const lateMinutes = Math.max(0, actualMoment.diff(lateAfter, 'minutes'));
  return {
    expectedAt: expectedMoment.toISOString(),
    graceUntil: lateAfter.toISOString(),
    isLate: lateMinutes > 0,
    lateMinutes
  };
}

function dutyQrSecret() {
  return process.env.DUTY_QR_SECRET || process.env.JWT_SECRET || 'shule-ai-duty-development-secret';
}
function buildDutyQrToken(schoolCode, date, dutyIdOrType) {
  const point = String(dutyIdOrType || 'ALL');
  const payload = `${schoolCode}|${date}|${point}`;
  const signature = crypto.createHmac('sha256', dutyQrSecret()).update(payload).digest('hex').slice(0, 24);
  return Buffer.from(JSON.stringify({ schoolCode:String(schoolCode), date:String(date), point, signature })).toString('base64url');
}
function verifyQrToken(token, schoolCode, date, dutyIdOrType) {
  if (!token) return false;
  try {
    const decoded = JSON.parse(Buffer.from(String(token).trim(), 'base64url').toString('utf8'));
    if (String(decoded.schoolCode) !== String(schoolCode) || String(decoded.date) !== String(date)) return false;
    const requested = String(dutyIdOrType || 'ALL');
    if (![requested, 'ALL'].includes(String(decoded.point))) return false;
    const expected = buildDutyQrToken(schoolCode, date, decoded.point);
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(token).trim()));
  } catch (_) { return false; }
}

function verifyGeo(settings, gps) {
  if (!settings.requireGps) return { accepted: true, distanceMeters: null, reason: 'GPS not required' };
  if (!gps || gps.latitude === undefined || gps.longitude === undefined) {
    return { accepted: false, distanceMeters: null, reason: 'GPS location is required' };
  }
  if (!settings.schoolLat || !settings.schoolLng) {
    return { accepted: true, distanceMeters: null, reason: 'School GPS not configured - accepted but flagged', flagged: true };
  }
  const dist = distanceMeters(settings.schoolLat, settings.schoolLng, gps.latitude, gps.longitude);
  const accepted = dist !== null && dist <= settings.radiusMeters;
  return {
    accepted,
    distanceMeters: dist,
    radiusMeters: settings.radiusMeters,
    reason: accepted ? 'Inside school geofence' : `Outside school geofence (${dist}m away)`
  };
}

// ============ MAIN CONTROLLER FUNCTIONS ============

exports.getDutyStats = async (req, res) => {
  try {
    const school = await School.findOne({ where: { schoolId: req.user.schoolCode } });
    if (!school) return res.status(404).json({ success: false, message: 'School not found' });

    const startOfMonth = moment().startOf('month');
    const endOfMonth = moment().endOf('month');
    const rosters = await DutyRoster.findAll({
      where: { schoolId: school.schoolId, date: { [Op.between]: [startOfMonth.format('YYYY-MM-DD'), endOfMonth.format('YYYY-MM-DD')] } }
    });

    const teachers = await Teacher.findAll({
      include: [{ model: User, where: { schoolCode: school.schoolId } }]
    });

    const stats = {
      totalDuties: rosters.reduce((acc, r) => acc + r.duties.length, 0),
      completedDuties: rosters.reduce((acc, r) => acc + r.duties.filter(d => d.status === 'completed').length, 0),
      missedDuties: rosters.reduce((acc, r) => acc + r.duties.filter(d => d.status === 'missed').length, 0),
      teacherPerformance: teachers.map(t => {
        const teacherDuties = rosters.flatMap(r => r.duties.filter(d => d.teacherId === t.id));
        const completed = teacherDuties.filter(d => d.status === 'completed').length;
        return {
          teacherName: t.User?.name || 'Unknown',
          assigned: teacherDuties.length,
          completed,
          rate: teacherDuties.length ? (completed / teacherDuties.length * 100).toFixed(1) : 0
        };
      })
    };
    res.json({ success: true, data: stats });
  } catch (error) {
    console.error('Get duty stats error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.generateDutyRoster = async (req, res) => {
  try {
    const { startDate, endDate, type = 'auto' } = req.body;
    const school = await School.findOne({ where: { schoolId: req.user.schoolCode } });
    if (!school) return res.status(404).json({ success: false, message: 'School not found' });
    
    const normalizedStart = startDate ? String(startDate).slice(0, 10) : moment().format('YYYY-MM-DD');
    const normalizedEnd = endDate ? String(endDate).slice(0, 10) : moment(normalizedStart).add(7, 'days').format('YYYY-MM-DD');
    if (!v87IsValidISODate(normalizedStart) || !v87IsValidISODate(normalizedEnd)) {
      return res.status(400).json({ success:false, message:'Choose valid roster start and end dates.' });
    }
    const start = moment(normalizedStart, 'YYYY-MM-DD', true);
    const end = moment(normalizedEnd, 'YYYY-MM-DD', true);
    const days = end.diff(start, 'days') + 1;
    if (days < 1 || days > 31) {
      return res.status(400).json({ success:false, message:'Duty rosters can cover between 1 and 31 days.' });
    }
    const dutySettings = getDutyVerificationSettings(school);
    const configuredSlots = dutySettings.dutySlots.length ? dutySettings.dutySlots : [
      { id:'morning', label:'Morning Duty', start:'07:00', end:'08:00', teachersPerSlot:2, pointId:dutySettings.dutyPoints[0]?.id || 'main-gate' },
      { id:'lunch', label:'Lunch Duty', start:'12:30', end:'14:00', teachersPerSlot:3, pointId:dutySettings.dutyPoints[1]?.id || dutySettings.dutyPoints[0]?.id || 'dining-area' },
      { id:'afternoon', label:'Afternoon Duty', start:'15:30', end:'16:30', teachersPerSlot:2, pointId:dutySettings.dutyPoints[2]?.id || dutySettings.dutyPoints[0]?.id || 'school-compound' }
    ];
    const configuredPoints = new Map(dutySettings.dutyPoints.map(point => [String(point.id), point]));
    const rosters = [];
    const alerts = [];
    const understaffedAlerts = [];

    if (moment().day() === 1) {
      const teachers = await Teacher.findAll({ where: { approvalStatus: 'approved' }, include:[{ model:User, where:{ schoolCode:school.schoolId, role:'teacher' }, required:true, attributes:['id','name','schoolCode'] }] });
      for (const teacher of teachers) {
        teacher.statistics = { ...teacher.statistics, weeklyDutyCount: 0 };
        await teacher.save();
      }
    }

    for (let i = 0; i < days; i++) {
      const currentDate = moment(start).add(i, 'days');
      if (currentDate.day() === 0) continue;
      const dateStr = currentDate.format('YYYY-MM-DD');
      const existing = await DutyRoster.findOne({ where: { schoolId: school.schoolId, date: dateStr } });
      if (existing) {
        rosters.push(existing);
        continue;
      }
      const dayDuties = [];

      for (const slotConfig of configuredSlots) {
        const slot = String(slotConfig.id || slotConfig.label || 'duty').toLowerCase().replace(/[^a-z0-9]+/g,'-');
        const required = Math.max(1, Number(slotConfig.teachersPerSlot || 1));
        const point = configuredPoints.get(String(slotConfig.pointId)) || { id:slotConfig.pointId || slot, name:slotConfig.pointName || slotConfig.label || 'Duty Point' };
        const { assigned, conflicts, shortage } = await dutyFairness.assignDutyFairly(school.schoolId, dateStr, slot, required);

        assigned.forEach(teacher => {
          dayDuties.push({
            teacherId: teacher.id,
            teacherName: teacher.User?.name || 'Unknown',
            type: slot,
            area: point.name || slotConfig.label || 'Duty Point',
            pointId: point.id || slotConfig.pointId || slot,
            timeSlot: { start:String(slotConfig.start || slotConfig.startTime || '07:00').slice(0,5), end:String(slotConfig.end || slotConfig.endTime || '08:00').slice(0,5) },
            status: 'scheduled'
          });
          dutyFairness.updateTeacherDutyStats(teacher.id, 'assign', slot);
          alerts.push({
            userId: teacher.User?.id,
            role: 'teacher',
            type: 'duty',
            severity: 'info',
            title: 'Duty Assignment',
            message: `You are assigned to ${point.name || slotConfig.label || slot} on ${currentDate.format('MMM Do')} from ${slotConfig.start || '07:00'} to ${slotConfig.end || '08:00'}`,
            data: { date: dateStr, dutyType: slot, area: point.name || slotConfig.label, pointId: point.id, startTime:slotConfig.start, endTime:slotConfig.end }
          });
        });

        if (shortage > 0) {
          understaffedAlerts.push({ date: dateStr, slot, required, assigned: assigned.length, shortage });
        }
      }

      if (dayDuties.length) {
        const roster = await DutyRoster.create({
          schoolId: school.schoolId,
          date: dateStr,
          duties: dayDuties,
          createdBy: req.user.id,
          metadata: { generationMethod: type, generatedAt: new Date() }
        });
        rosters.push(roster);
      }
    }

    if (alerts.length > 0) await createBulkAlerts(alerts.map(a => ({ ...a, data:{ ...(a.data||{}), schoolCode:school.schoolId, sourceType:'duty_engine', sourceLabel:'Duty management' } })));

    const understaffed = await dutyFairness.checkUnderstaffedAreas(school.schoolId, moment().format('YYYY-MM-DD'));
    if (understaffed.length > 0) {
      const admins = await User.findAll({ where: { role: 'admin', schoolCode: school.schoolId } });
      for (const admin of admins) {
        await createAlert({
          userId: admin.id, role: 'admin', type: 'duty', severity: 'warning',
          title: 'Understaffed Areas Detected',
          message: `${understaffed.length} areas need more teachers`,
          data: { understaffed }
        });
      }
    }

    await realtime.emitToSchool(school.schoolId, 'duty:roster_updated', {
      message:'New duty roster generated', count:rosters.length, startDate:start.format('YYYY-MM-DD'), endDate:end.format('YYYY-MM-DD')
    }, { entityType:'DutyRoster', entityId:String(rosters[0]?.id || ''), version:1 }).catch(e => console.error('[duty realtime]', e.message));

    res.json({ success: true, message: `Generated ${rosters.length} rosters`, data: { rosters, understaffed: understaffedAlerts, stats: { totalDuties: rosters.reduce((acc, r) => acc + r.duties.length, 0), totalAlerts: alerts.length, understaffedCount: understaffedAlerts.length } } });
  } catch (error) {
    console.error('Duty generation error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getFairnessReport = async (req, res) => {
  try {
    const school = await School.findOne({ where: { schoolId: req.user.schoolCode } });
    if (!school) return res.status(404).json({ success: false, message: 'School not found' });

    const teachers = await Teacher.findAll({
      where: { approvalStatus: 'approved' },
      include: [{ model: User, where: { schoolCode: school.schoolId }, attributes: ['name', 'email'] }]
    });

    const startOfMonth = moment().startOf('month').format('YYYY-MM-DD');
    const endOfMonth = moment().endOf('month').format('YYYY-MM-DD');
    const rosters = await DutyRoster.findAll({
      where: { schoolId: school.schoolId, date: { [Op.between]: [startOfMonth, endOfMonth] } }
    });

    const teacherStats = teachers.map(teacher => {
      const teacherDuties = rosters.flatMap(r => r.duties.filter(d => d.teacherId === teacher.id));
      const completed = teacherDuties.filter(d => d.status === 'completed').length;
      const missed = teacherDuties.filter(d => d.status === 'missed').length;
      const scheduled = teacherDuties.length;
      return {
        teacherId: teacher.id,
        teacherName: teacher.User?.name || 'Unknown',
        department: teacher.department || 'general',
        scheduled,
        completed,
        missed,
        completionRate: scheduled ? ((completed / scheduled) * 100).toFixed(1) : 0,
        monthlyDutyCount: teacher.statistics?.monthlyDutyCount || 0,
        reliabilityScore: teacher.statistics?.reliabilityScore || 100,
        points: teacher.statistics?.points || 0,
        preferences: teacher.dutyPreferences
      };
    });

    const departmentStats = {};
    teacherStats.forEach(stat => {
      const dept = stat.department;
      if (!departmentStats[dept]) departmentStats[dept] = { teachers: 0, totalDuties: 0, completedDuties: 0, missedDuties: 0 };
      departmentStats[dept].teachers++;
      departmentStats[dept].totalDuties += stat.scheduled;
      departmentStats[dept].completedDuties += stat.completed;
      departmentStats[dept].missedDuties += stat.missed;
    });

    const dutyCounts = teacherStats.map(t => t.scheduled);
    const mean = dutyCounts.reduce((a, b) => a + b, 0) / dutyCounts.length || 0;
    const variance = dutyCounts.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / dutyCounts.length;
    const stdDev = Math.sqrt(variance);
    const fairnessScore = Math.max(0, Math.min(100, 100 - (stdDev / mean * 100) || 100));

    res.json({
      success: true,
      data: {
        period: { month: moment().format('MMMM YYYY'), start: startOfMonth, end: endOfMonth },
        summary: {
          totalTeachers: teachers.length,
          totalDuties: rosters.reduce((acc, r) => acc + r.duties.length, 0),
          fairnessScore: fairnessScore.toFixed(1),
          understaffedDays: await checkUnderstaffedDays(school.schoolId, startOfMonth, endOfMonth)
        },
        departmentStats,
        teacherStats: teacherStats.sort((a, b) => a.scheduled - b.scheduled),
        recommendations: generateRecommendations(teacherStats, departmentStats)
      }
    });
  } catch (error) {
    console.error('Fairness report error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.manualAdjustDuty = async (req, res) => {
  try {
    const { date, teacherId, newTeacherId, dutyType, reason } = req.body;
    if (!v87IsValidISODate(String(date || '').slice(0, 10))) return res.status(400).json({ success:false, message:'Choose a valid duty date.' });
    if (!String(reason || '').trim()) return res.status(400).json({ success:false, message:'Enter the reason for this duty adjustment.' });
    const school = await School.findOne({ where: { schoolId: req.user.schoolCode } });
    if (!school) return res.status(404).json({ success: false, message: 'School not found' });

    const roster = await DutyRoster.findOne({ where: { schoolId: school.schoolId, date } });
    if (!roster) return res.status(404).json({ success: false, message: 'Roster not found' });

    const dutyIndex = roster.duties.findIndex(d => d.teacherId === parseInt(teacherId) && d.type === dutyType);
    if (dutyIndex === -1) return res.status(404).json({ success: false, message: 'Duty not found' });

    const oldTeacherId = Number(roster.duties[dutyIndex].teacherId);
    const replacementTeacher = await Teacher.findOne({ where:{ id:Number(newTeacherId) }, include:[{ model:User, where:{ schoolCode:school.schoolId, role:'teacher' }, required:true, attributes:['id','name','schoolCode'] }] });
    if (!replacementTeacher) return res.status(404).json({ success:false, message:'Replacement teacher not found in this school' });
    const previousTeacher = await Teacher.findOne({ where:{ id:oldTeacherId }, include:[{ model:User, where:{ schoolCode:school.schoolId, role:'teacher' }, required:true, attributes:['id','name','schoolCode'] }] }).catch(()=>null);
    roster.duties[dutyIndex].teacherId = replacementTeacher.id;
    roster.duties[dutyIndex].teacherName = replacementTeacher.User?.name || req.body.newTeacherName || 'Teacher';
    roster.duties[dutyIndex].adjustedBy = req.user.id;
    roster.duties[dutyIndex].adjustedAt = new Date();
    roster.duties[dutyIndex].adjustmentReason = reason || 'Administrative adjustment';
    roster.changed('duties', true);
    await roster.save();

    await dutyFairness.updateTeacherDutyStats(oldTeacherId, 'unassign');
    await dutyFairness.updateTeacherDutyStats(replacementTeacher.id, 'assign', dutyType);

    await createBulkAlerts([
      previousTeacher?.User?.id ? { userId:previousTeacher.User.id, role:'teacher', type:'duty', severity:'info', title:'Duty adjustment', message:`Your duty on ${moment(date).format('MMM Do')} has been reassigned.`, dedupeKey:`duty-adjusted:${roster.id}:${oldTeacherId}:${replacementTeacher.id}`, data:{schoolCode:school.schoolId,rosterId:roster.id,date,dutyType} } : null,
      { userId:replacementTeacher.User.id, role:'teacher', type:'duty', severity:'info', title:'New duty assignment', message:`You have been assigned to ${dutyType} duty on ${moment(date).format('MMM Do')}.`, dedupeKey:`duty-assigned:${roster.id}:${replacementTeacher.id}:${dutyType}`, data:{schoolCode:school.schoolId,rosterId:roster.id,date,dutyType} }
    ].filter(Boolean));
    await realtime.emitToSchool(school.schoolId,'duty:roster_updated',{rosterId:roster.id,date,duty:roster.duties[dutyIndex]},{entityType:'DutyRoster',entityId:roster.id,version:Number(roster.updatedAt?.getTime?.()||Date.now())}).catch(()=>{});

    res.json({ success: true, message: 'Duty adjusted successfully', data: roster.duties[dutyIndex] });
  } catch (error) {
    console.error('Manual adjust error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getUnderstaffedAreas = async (req, res) => {
  try {
    const school = await School.findOne({ where: { schoolId: req.user.schoolCode } });
    if (!school) return res.status(404).json({ success: false, message: 'School not found' });

    const today = moment().format('YYYY-MM-DD');
    const nextWeek = moment().add(7, 'days');
    const understaffed = [];
    for (let date = moment(today); date.isBefore(nextWeek); date.add(1, 'day')) {
      if (date.day() === 0) continue;
      const result = await dutyFairness.checkUnderstaffedAreas(school.schoolId, date.format('YYYY-MM-DD'));
      if (result.length > 0) understaffed.push({ date: date.format('YYYY-MM-DD'), areas: result });
    }
    res.json({ success: true, data: understaffed });
  } catch (error) {
    console.error('Understaffed areas error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getTeacherWorkload = async (req, res) => {
  try {
    const school = await School.findOne({ where: { schoolId: req.user.schoolCode } });
    if (!school) return res.status(404).json({ success: false, message: 'School not found' });

    const teachers = await Teacher.findAll({
      where: { approvalStatus: 'approved' },
      include: [{ model: User, where: { schoolCode: school.schoolId }, attributes: ['name', 'email'] }]
    });

    const workload = teachers.map(teacher => ({
      teacherId: teacher.id,
      teacherName: teacher.User?.name || 'Unknown',
      department: teacher.department || 'general',
      monthlyDutyCount: teacher.statistics?.monthlyDutyCount || 0,
      weeklyDutyCount: teacher.statistics?.weeklyDutyCount || 0,
      reliabilityScore: teacher.statistics?.reliabilityScore || 100,
      points: teacher.statistics?.points || 0,
      preferences: teacher.dutyPreferences,
      status: teacher.statistics?.monthlyDutyCount > 10 ? 'overworked' : teacher.statistics?.monthlyDutyCount < 3 ? 'underworked' : 'balanced'
    }));

    res.json({ success: true, data: workload.sort((a, b) => b.monthlyDutyCount - a.monthlyDutyCount) });
  } catch (error) {
    console.error('Teacher workload error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getTodayDuty = async (req, res) => {
  try {
    const school = await School.findOne({ where:{ schoolId:req.user.schoolCode } });
    if (!school) return res.status(404).json({ success:false, message:'School not found' });
    const today = moment().format('YYYY-MM-DD');
    const roster = await DutyRoster.findOne({ where:{ schoolId:school.schoolId, date:today } });
    let teacher = null;
    if (req.user.role === 'teacher') teacher = await Teacher.findOne({ where:{ userId:req.user.id } });
    const all = Array.isArray(roster?.duties) ? roster.duties : [];
    const duties = req.user.role === 'teacher'
      ? all.filter(d => Number(d.teacherId) === Number(teacher?.id)).map(d => ({ ...d, isOnDuty:true, checkedIn:!!d.checkedIn, checkedOut:!!d.checkedOut }))
      : all.map(d => ({ ...d, isOnDuty:false, checkedIn:!!d.checkedIn, checkedOut:!!d.checkedOut }));
    const duty = duties[0] || null;
    return res.json({ success:true, data:{ date:today, duty, duties, hasDuty:!!duty, message:duty ? null : 'No duty assigned today' } });
  } catch (error) {
    console.error('Get today duty error:', error);
    res.status(500).json({ success:false, message:error.message });
  }
};

exports.getWeeklyDuty = async (req, res) => {
  try {
    const school = await School.findOne({ where:{ schoolId:req.user.schoolCode } });
    if (!school) return res.status(404).json({ success:false, message:'School not found' });
    const startOfWeek = moment().startOf('isoWeek');
    const endOfWeek = moment().endOf('isoWeek');
    const rosters = await DutyRoster.findAll({ where:{ schoolId:school.schoolId, date:{ [Op.between]:[startOfWeek.format('YYYY-MM-DD'),endOfWeek.format('YYYY-MM-DD')] } }, order:[['date','ASC']] });
    let teacher = null;
    if (req.user.role === 'teacher') teacher = await Teacher.findOne({ where:{ userId:req.user.id } });
    const weekly = [];
    for (let i=0;i<7;i++) {
      const day=startOfWeek.clone().add(i,'days');
      const dayRoster=rosters.find(r => String(r.date) === day.format('YYYY-MM-DD'));
      let duties=Array.isArray(dayRoster?.duties)?dayRoster.duties:[];
      if (req.user.role === 'teacher') duties=duties.filter(d => Number(d.teacherId)===Number(teacher?.id));
      weekly.push({ date:day.format('YYYY-MM-DD'), dayName:day.format('dddd'), isToday:day.isSame(moment(),'day'), duties });
    }
    res.json({ success:true, data:weekly });
  } catch (error) {
    console.error('Get weekly duty error:', error);
    res.status(500).json({ success:false, message:error.message });
  }
};

exports.checkInDuty = async (req, res) => {
  try {
    const { location, notes } = req.body;
    const teacher = await Teacher.findOne({ where:{ userId:req.user.id }, include:[{ model:User, attributes:['id','name','schoolCode'] }] });
    if (!teacher) return res.status(404).json({ success: false, message: 'Teacher not found' });

    const school = await School.findOne({ where: { schoolId: req.user.schoolCode } });
    if (!school) return res.status(404).json({ success: false, message: 'School not found' });
    const verification = getDutyVerificationSettings(school);
    if (verification.requireGps || verification.requireQr) {
      return res.status(400).json({ success:false, code:'DUTY_VERIFICATION_REQUIRED', message:'This school requires verified duty check-in. Use the verified check-in button.' });
    }

    const today = moment().format('YYYY-MM-DD');
    const roster = await DutyRoster.findOne({ where: { schoolId: school.schoolId, date: today } });
    if (!roster) return res.status(404).json({ success: false, message: 'No duty today' });

    const dutyIndex = roster.duties.findIndex(d => Number(d.teacherId) === Number(teacher.id) || Number(d.teacherId) === Number(req.user.id));
    if (dutyIndex === -1) return res.status(403).json({ success: false, message: 'Not on duty today' });
    if (roster.duties[dutyIndex].checkedIn) return res.json({ success:true, message:'You are already checked in.', data:roster.duties[dutyIndex] });

    const currentTime = moment();
    const slot = roster.duties[dutyIndex].timeSlot || {};
    const start = moment(slot.start || roster.duties[dutyIndex].startTime || '07:00', 'HH:mm');
    const window = school.settings?.dutyManagement?.checkInWindow || 15;
    const enforceWindow = school.settings?.dutyManagement?.enforceCheckInWindow === true;
    if (enforceWindow && !currentTime.isBetween(start.clone().subtract(window, 'minutes'), start.clone().add(window, 'minutes'))) {
      return res.status(400).json({ success: false, message: `Check-in only allowed within ${window} minutes of duty time`, data: { allowed:false, enforceWindow, dutyStart: start.format('HH:mm'), windowMinutes: window } });
    }

    roster.duties[dutyIndex].checkedIn = { at: new Date(), by: req.user.id, location: location || 'School' };
    roster.duties[dutyIndex].status = 'checked_in';
    roster.duties[dutyIndex].notes = notes || '';
    roster.changed('duties', true);
    await roster.save();
    await realtime.emitToSchool(school.schoolId, 'duty:checked_in', { rosterId:roster.id, date:today, teacherId:teacher.id, userId:req.user.id, duty:roster.duties[dutyIndex] }, { entityType:'DutyRoster', entityId:roster.id, version:Number(roster.updatedAt?.getTime?.() || Date.now()) }).catch(()=>{});

    const teacherDuty = (teacher.duties || []).find(d => moment(d.date).isSame(moment(), 'day'));
    if (teacherDuty) {
      teacherDuty.status = 'checked_in';
      teacherDuty.checkedInAt = new Date();
      teacherDuty.checkedIn = { at: new Date(), location };
      const stats = { ...(teacher.statistics || {}) };
      stats.dutiesCheckedIn = (stats.dutiesCheckedIn || 0) + 1;
      teacher.statistics = stats;
      if (typeof teacher.updateReliabilityScore === 'function') teacher.updateReliabilityScore();
      await teacher.save();
    }

    const admins = await User.findAll({ where: { role: 'admin', schoolCode: school.schoolId } });
    for (const admin of admins) {
      await createAlert({
        userId: admin.id, role: 'admin', type: 'duty', severity: 'info',
        title:'Teacher Checked In', message:`${teacher.User?.name || 'Teacher'} checked in for ${roster.duties[dutyIndex].type} duty.`,
        data:{ schoolCode:school.schoolId, teacherId:teacher.id, rosterId:roster.id, sourceType:'duty_engine', sourceLabel:'Duty management' }
      });
    }
    res.json({ success: true, message: 'Checked in successfully' });
  } catch (error) {
    console.error('Check in error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.checkOutDuty = async (req, res) => {
  try {
    const { location, notes } = req.body;
    const teacher = await Teacher.findOne({ where:{ userId:req.user.id }, include:[{ model:User, attributes:['id','name','schoolCode'] }] });
    if (!teacher) return res.status(404).json({ success:false, message:'Teacher not found' });
    const school = await School.findOne({ where: { schoolId: req.user.schoolCode } });
    if (!school) return res.status(404).json({ success: false, message: 'School not found' });
    const verification = getDutyVerificationSettings(school);
    if (verification.requireGps || verification.requireQr) {
      return res.status(400).json({ success:false, code:'DUTY_VERIFICATION_REQUIRED', message:'This school requires verified duty check-out. Use the verified check-out button.' });
    }

    const today = moment().format('YYYY-MM-DD');
    const roster = await DutyRoster.findOne({ where: { schoolId: school.schoolId, date: today } });
    if (!roster) return res.status(404).json({ success: false, message: 'No duty today' });

    const dutyIndex = roster.duties.findIndex(d => Number(d.teacherId) === Number(teacher.id) || Number(d.teacherId) === Number(req.user.id));
    if (dutyIndex === -1) return res.status(403).json({ success: false, message: 'Not on duty today' });

    if (!roster.duties[dutyIndex].checkedIn) return res.status(400).json({ success:false, message:'Check in before checking out.' });
    if (roster.duties[dutyIndex].checkedOut) return res.json({ success:true, message:'You are already checked out.', data:roster.duties[dutyIndex] });
    roster.duties[dutyIndex].checkedOut = { at:new Date(), by:req.user.id, location:location || 'School', notes:notes || '' };
    roster.duties[dutyIndex].status = 'completed';
    roster.changed('duties', true);
    await roster.save();
    await realtime.emitToSchool(school.schoolId, 'duty:checked_out', { rosterId:roster.id, date:today, teacherId:teacher.id, userId:req.user.id, duty:roster.duties[dutyIndex] }, { entityType:'DutyRoster', entityId:roster.id, version:Number(roster.updatedAt?.getTime?.() || Date.now()) }).catch(()=>{});
    res.json({ success: true, message: 'Checked out successfully' });
  } catch (error) {
    console.error('Check out error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateDutyPreferences = async (req, res) => {
  try {
    const teacher = await Teacher.findOne({ where:{ userId:req.user.id }, include:[{ model:User, attributes:['id','name','schoolCode'] }] });
    if (!teacher) return res.status(404).json({ success: false, message: 'Teacher not found' });

    teacher.dutyPreferences = { ...teacher.dutyPreferences, ...req.body };
    await teacher.save();
    res.json({ success: true, data: teacher.dutyPreferences });
  } catch (error) {
    console.error('Update preferences error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.requestDutySwap = async (req, res) => {
  try {
    const rawDutyDate = req.body.dutyDate || req.body.date || req.body.swapDate || req.body.selectedDate;
    const dutyDate = String(rawDutyDate || '').slice(0, 10);
    const { reason, targetTeacherId } = req.body;
    if (!v87IsValidISODate(dutyDate)) return res.status(400).json({ success:false, message:'Please select a valid duty date.' });
    const teacher = await Teacher.findOne({ where:{ userId:req.user.id }, include:[{ model:User, attributes:['id','name','schoolCode'] }] });
    if (!teacher) return res.status(404).json({ success: false, message: 'Teacher not found' });

    const school = await School.findOne({ where: { schoolId: req.user.schoolCode } });
    if (!school) return res.status(404).json({ success: false, message: 'School not found' });

    const roster = await DutyRoster.findOne({ where: { schoolId: school.schoolId, date: moment(dutyDate).format('YYYY-MM-DD') } });
    if (!roster) return res.status(404).json({ success: false, message: 'No duty on that date' });

    const duty = roster.duties.find(d => d.teacherId === teacher.id);
    if (!duty) return res.status(403).json({ success: false, message: 'You are not on duty that day' });

    const swapRequest = {
      id: crypto.randomUUID(),
      teacherId: teacher.id,
      teacherName: teacher.User?.name,
      targetTeacherId: targetTeacherId || null,
      date: dutyDate,
      dutyType: duty.type,
      reason,
      status: 'pending',
      createdAt: new Date()
    };

    const settings = school.settings || {};
    const dutyManagement = settings.dutyManagement || {};
    const swapRequests = Array.isArray(dutyManagement.swapRequests) ? dutyManagement.swapRequests.slice() : [];
    swapRequests.push(swapRequest);
    await school.update({
      settings: {
        ...settings,
        dutyManagement: {
          ...dutyManagement,
          swapRequests
        }
      }
    });

    const admins = await User.findAll({ where: { role: 'admin', schoolCode: school.schoolId } });
    for (const admin of admins) {
      await createAlert({
        userId: admin.id, role: 'admin', type: 'duty', severity: 'info',
        title: 'Duty Swap Request',
        message: `${teacher.User?.name} requests to swap duty on ${moment(dutyDate).format('MMM Do')}. Reason: ${reason}`,
        data:{ swapRequest, schoolCode:school.schoolId, sourceType:'duty_engine', sourceLabel:'Duty management' }
      });
    }
    res.json({ success: true, message: 'Swap request sent to admin', data: swapRequest });
  } catch (error) {
    console.error('Request swap error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getAvailableSwaps = async (req, res) => {
  try {
    const teacher = await Teacher.findOne({ where:{ userId:req.user.id }, include:[{ model:User, attributes:['id','name','schoolCode'] }] });
    if (!teacher) return res.status(404).json({ success: false, message: 'Teacher not found' });

    const school = await School.findOne({ where: { schoolId: req.user.schoolCode } });
    const swapRequests = school?.settings?.dutyManagement?.swapRequests || [];
    if (!Array.isArray(swapRequests) || !swapRequests.length) return res.json({ success: true, data: [] });

    const available = swapRequests.filter(req => req.status === 'pending' && req.teacherId !== teacher.id && (!req.targetTeacherId || req.targetTeacherId === teacher.id));
    const enriched = await Promise.all(available.map(async req => {
      const requestingTeacher = await Teacher.findByPk(req.teacherId, { include: [{ model: User, attributes: ['name'] }] });
      return { ...req, teacherName: requestingTeacher?.User?.name || 'Unknown', dutyDate: req.date, dutyType: req.dutyType };
    }));
    res.json({ success: true, data: enriched });
  } catch (error) {
    console.error('Get available swaps error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getTeacherPoints = async (req, res) => {
  try {
    const teacher = await Teacher.findOne({ where:{ userId:req.user.id }, include:[{ model:User, attributes:['id','name','schoolCode'] }] });
    res.json({ success: true, data: { points: teacher.statistics?.points || 0 } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateTeacherPoints = async (req, res) => {
  try {
    const { points, reason } = req.body;
    const teacher = await Teacher.findOne({ where:{ userId:req.user.id }, include:[{ model:User, attributes:['id','name','schoolCode'] }] });
    if (!teacher) return res.status(404).json({ success: false });
    const stats = teacher.statistics || {};
    stats.points = (stats.points || 0) + points;
    teacher.statistics = stats;
    await teacher.save();
    res.json({ success: true, data: { points: stats.points } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};


// ============ V9.3 SMART DUTY VERIFICATION ENDPOINTS ============
exports.getDutyVerificationConfig = async (req, res) => {
  try {
    const school = await School.findOne({ where: { schoolId: req.user.schoolCode } });
    if (!school) return res.status(404).json({ success: false, message: 'School not found' });
    const settings = getDutyVerificationSettings(school);
    const today = moment().format('YYYY-MM-DD');
    const todayQrToken = buildDutyQrToken(school.schoolId, today, 'ALL');
    const todayQrDataUrl = settings.requireQr ? await QRCode.toDataURL(todayQrToken, { errorCorrectionLevel:'M', margin:1, width:320 }) : null;
    res.json({ success:true, data:{ settings, todayQrToken, todayQrDataUrl, serverTime:new Date().toISOString() } });
  } catch (error) {
    console.error('getDutyVerificationConfig error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateDutyVerificationConfig = async (req, res) => {
  try {
    const school = await School.findOne({ where: { schoolId: req.user.schoolCode } });
    if (!school) return res.status(404).json({ success: false, message: 'School not found' });

    const current = school.settings || {};
    const duty = current.dutyManagement || {};
    const geoFence = duty.geoFence || {};

    const nextGeoFence = {
      ...geoFence,
      enabled: req.body.enabled !== undefined ? !!req.body.enabled : geoFence.enabled !== false,
      requireGps: req.body.requireGps !== undefined ? !!req.body.requireGps : geoFence.requireGps === true,
      requireQr: req.body.requireQr !== undefined ? !!req.body.requireQr : geoFence.requireQr === true,
      radiusMeters: Number(req.body.radiusMeters || geoFence.radiusMeters || 150),
      center: {
        lat: Number(req.body.schoolLat ?? geoFence.center?.lat ?? 0),
        lng: Number(req.body.schoolLng ?? geoFence.center?.lng ?? 0)
      }
    };

    school.settings = {
      ...current,
      dutyManagement: {
        ...duty,
        reportingTime: req.body.reportingTime || duty.reportingTime || '07:00',
        dutyGraceMinutes: Number(req.body.dutyGraceMinutes || duty.dutyGraceMinutes || duty.checkInWindow || 15),
        studentReportingTime: req.body.studentReportingTime || duty.studentReportingTime || '07:30',
        studentGraceMinutes: Number(req.body.studentGraceMinutes || duty.studentGraceMinutes || 10),
        dutyPoints: Array.isArray(req.body.dutyPoints) ? req.body.dutyPoints.map((point,index)=>({ id:String(point.id || `point-${index+1}`), name:String(point.name || '').trim(), description:String(point.description || '').trim(), latitude:point.latitude==null?null:Number(point.latitude), longitude:point.longitude==null?null:Number(point.longitude), active:point.active !== false })).filter(point=>point.name) : (duty.dutyPoints || []),
        dutySlots: Array.isArray(req.body.dutySlots) ? req.body.dutySlots.map((slot,index)=>({ id:String(slot.id || `slot-${index+1}`), label:String(slot.label || '').trim(), pointId:String(slot.pointId || ''), start:String(slot.start || slot.startTime || '07:00').slice(0,5), end:String(slot.end || slot.endTime || '08:00').slice(0,5), teachersPerSlot:Math.max(1,Number(slot.teachersPerSlot || 1)), active:slot.active !== false })).filter(slot=>slot.label && slot.pointId) : (duty.dutySlots || []),
        geoFence: nextGeoFence
      }
    };
    await school.save();

    res.json({ success: true, data: getDutyVerificationSettings(school), message: 'Duty verification settings updated' });
  } catch (error) {
    console.error('updateDutyVerificationConfig error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.verifiedCheckInDuty = async (req, res) => {
  try {
    const { gps, qrToken, notes, deviceInfo } = req.body;
    const teacher = await Teacher.findOne({ where:{ userId:req.user.id }, include:[{ model:User, attributes:['id','name','schoolCode'] }] });
    if (!teacher) return res.status(404).json({ success: false, message: 'Teacher not found' });

    const school = await School.findOne({ where: { schoolId: req.user.schoolCode } });
    if (!school) return res.status(404).json({ success: false, message: 'School not found' });

    const today = moment().format('YYYY-MM-DD');
    const roster = await DutyRoster.findOne({ where: { schoolId: school.schoolId, date: today } });
    if (!roster) return res.status(404).json({ success: false, message: 'No duty today' });

    const dutyIndex = roster.duties.findIndex(d => Number(d.teacherId) === Number(teacher.id));
    if (dutyIndex === -1) return res.status(403).json({ success: false, message: 'Not on duty today' });

    const duty = roster.duties[dutyIndex];
    if (duty.checkedIn?.accepted === true || ['checked_in','late','completed'].includes(duty.status)) return res.json({ success:true, message:'You are already checked in.', data:duty.checkedIn || duty });
    const settings = getDutyVerificationSettings(school);
    const geo = verifyGeo(settings, gps);
    const qrOk = !settings.requireQr || verifyQrToken(qrToken, school.schoolId, today, duty.id || duty.type || duty.area);
    const now = moment();
    const late = checkLateStatus(expectedDutyStart(duty, today), now, settings.dutyGraceMinutes);
    const accepted = geo.accepted && qrOk;

    const verification = {
      method: 'gps_qr_timestamp',
      accepted,
      status: accepted ? (late.isLate ? 'late_verified' : 'verified') : 'rejected',
      checkedAt: new Date().toISOString(),
      serverTimestamp: new Date().toISOString(),
      gps: gps || null,
      geo,
      qr: { required: settings.requireQr, accepted: qrOk, tokenUsed: qrToken || null },
      late,
      notes: notes || '',
      deviceInfo: deviceInfo || {},
      checkedBy: req.user.id
    };

    duty.checkedIn = verification;
    duty.status = accepted ? (late.isLate ? 'late' : 'checked_in') : 'rejected';
    duty.verification = verification;
    roster.duties[dutyIndex] = duty;
    roster.changed('duties', true);
    await roster.save();
    await realtime.emitToSchool(school.schoolId, 'duty:checked_in', { rosterId:roster.id, date:today, teacherId:teacher.id, userId:req.user.id, duty }, { entityType:'DutyRoster', entityId:roster.id, version:Number(roster.updatedAt?.getTime?.() || Date.now()) }).catch(()=>{});

    if (!accepted) {
      return res.status(400).json({ success:false, message:!qrOk?'The duty QR token is invalid.':(verification.geo.reason||'Duty check-in rejected'), data:verification });
    }

    res.json({ success: true, message: late.isLate ? `Checked in late by ${late.lateMinutes} min` : 'Verified check-in successful', data: verification });
  } catch (error) {
    console.error('verifiedCheckInDuty error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.verifiedCheckOutDuty = async (req, res) => {
  try {
    const { gps, qrToken, notes, deviceInfo } = req.body;
    const teacher = await Teacher.findOne({ where:{ userId:req.user.id }, include:[{ model:User, attributes:['id','name','schoolCode'] }] });
    if (!teacher) return res.status(404).json({ success: false, message: 'Teacher not found' });

    const school = await School.findOne({ where: { schoolId: req.user.schoolCode } });
    if (!school) return res.status(404).json({ success: false, message: 'School not found' });

    const today = moment().format('YYYY-MM-DD');
    const roster = await DutyRoster.findOne({ where: { schoolId: school.schoolId, date: today } });
    if (!roster) return res.status(404).json({ success: false, message: 'No duty today' });

    const dutyIndex = roster.duties.findIndex(d => Number(d.teacherId) === Number(teacher.id));
    if (dutyIndex === -1) return res.status(403).json({ success: false, message: 'Not on duty today' });

    const duty = roster.duties[dutyIndex];
    if (!duty.checkedIn || duty.checkedIn?.accepted === false || duty.status === 'rejected') return res.status(400).json({ success:false, message:'Check in successfully before checking out.' });
    if (duty.checkedOut?.accepted === true || duty.status === 'completed') return res.json({ success:true, message:'You are already checked out.', data:duty.checkedOut || duty });
    const settings = getDutyVerificationSettings(school);
    const geo = verifyGeo(settings, gps);
    const qrOk = !settings.requireQr || verifyQrToken(qrToken, school.schoolId, today, duty.id || duty.type || duty.area);
    const accepted = geo.accepted && qrOk;

    const verification = {
      method: 'gps_qr_timestamp',
      accepted,
      status: accepted ? 'checked_out_verified' : 'checkout_rejected',
      checkedOutAt: new Date().toISOString(),
      serverTimestamp: new Date().toISOString(),
      gps: gps || null,
      geo,
      qr: { required: settings.requireQr, accepted: qrOk, tokenUsed: qrToken || null },
      notes: notes || '',
      deviceInfo: deviceInfo || {},
      checkedBy: req.user.id
    };

    duty.checkedOut = verification;
    duty.status = accepted ? 'completed' : (duty.status || 'checked_in');
    duty.checkOutVerification = verification;
    roster.duties[dutyIndex] = duty;
    roster.changed('duties', true);
    await roster.save();
    await realtime.emitToSchool(school.schoolId, 'duty:checked_out', { rosterId:roster.id, date:today, teacherId:teacher.id, userId:req.user.id, duty }, { entityType:'DutyRoster', entityId:roster.id, version:Number(roster.updatedAt?.getTime?.() || Date.now()) }).catch(()=>{});

    if (!accepted) {
      return res.status(400).json({ success:false, message:!qrOk?'The duty QR token is invalid.':(verification.geo.reason||'Duty check-out rejected'), data:verification });
    }

    res.json({ success: true, message: 'Verified check-out successful', data: verification });
  } catch (error) {
    console.error('verifiedCheckOutDuty error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getDutyComplianceReport = async (req, res) => {
  try {
    const school = await School.findOne({ where: { schoolId: req.user.schoolCode } });
    if (!school) return res.status(404).json({ success: false, message: 'School not found' });

    const date = req.query.date || moment().format('YYYY-MM-DD');
    const roster = await DutyRoster.findOne({ where: { schoolId: school.schoolId, date } });
    const duties = roster?.duties || [];

    const summary = {
      date,
      total: duties.length,
      checkedIn: duties.filter(d => !!d.checkedIn && d.status !== 'rejected').length,
      completed: duties.filter(d => !!d.checkedOut || d.status === 'completed').length,
      verified: duties.filter(d => d.checkedIn?.accepted === true).length,
      late: duties.filter(d => d.checkedIn?.late?.isLate || d.status === 'late').length,
      rejected: duties.filter(d => d.checkedIn?.accepted === false || d.status === 'rejected').length,
      notCheckedIn: duties.filter(d => !d.checkedIn).length,
      outsideGeoFence: duties.filter(d => d.checkedIn?.geo?.accepted === false).length
    };

    res.json({ success: true, data: { summary, duties } });
  } catch (error) {
    console.error('getDutyComplianceReport error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getLateArrivalReport = async (req, res) => {
  try {
    const school = await School.findOne({ where: { schoolId: req.user.schoolCode } });
    if (!school) return res.status(404).json({ success: false, message: 'School not found' });

    const date = req.query.date || moment().format('YYYY-MM-DD');
    const roster = await DutyRoster.findOne({ where: { schoolId: school.schoolId, date } });
    const duties = roster?.duties || [];

    const lateTeachers = duties
      .filter(d => d.checkedIn?.late?.isLate || d.status === 'late')
      .map(d => ({
        teacherId: d.teacherId,
        teacherName: d.teacherName,
        duty: d.area || d.type,
        checkedAt: d.checkedIn?.checkedAt,
        lateMinutes: d.checkedIn?.late?.lateMinutes || 0,
        geo: d.checkedIn?.geo || null
      }));

    // Student late arrivals are exposed as a structure now.
    // It is ready for gate scan/manual attendance integration without breaking existing attendance.
    const lateStudents = [];

    res.json({
      success: true,
      data: {
        date,
        lateTeachers,
        lateStudents,
        counts: { teachers: lateTeachers.length, students: lateStudents.length }
      }
    });
  } catch (error) {
    console.error('getLateArrivalReport error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};
