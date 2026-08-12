const { Op } = require('sequelize');
const { BirthdayEvent, Student, User, Class, Teacher, School, TeacherSubjectAssignment } = require('../models');
const birthdayService = require('../services/birthdayService');
const schoolLinkageService = require('../services/schoolLinkageService');

const DEFAULT_SETTINGS = {
  enabled: true,
  timezone: 'Africa/Nairobi',
  advanceDays:[7,1],sameDayEnabled:true,
  audience:{admin:true,classTeacher:true,subjectTeacher:false,parent:true,student:true},
  announceToClass: false,
  requireVerifiedDateOfBirth: false,
  suppressedStudentIds: []
};

function schoolCode(req) { return req.user?.schoolCode; }
function dateOnlyInZone(date, timeZone='Africa/Nairobi') {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year:'numeric', month:'2-digit', day:'2-digit' }).format(date);
}
function nextBirthday(dateOfBirth, now=new Date(), timeZone='Africa/Nairobi') {
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return null;
  const year = Number(new Intl.DateTimeFormat('en-US', { timeZone, year:'numeric' }).format(now));
  let candidate = new Date(Date.UTC(year, dob.getUTCMonth(), dob.getUTCDate(), 12));
  if (dateOnlyInZone(candidate, timeZone) < dateOnlyInZone(now, timeZone)) {
    candidate = new Date(Date.UTC(year + 1, dob.getUTCMonth(), dob.getUTCDate(), 12));
  }
  return candidate;
}
function ageTurning(dateOfBirth, birthday) {
  const dob = new Date(dateOfBirth);
  return birthday.getUTCFullYear() - dob.getUTCFullYear();
}
function normalizeSettings(value={}) {
  const days = Array.isArray(value.advanceDays) ? value.advanceDays.map(Number).filter(n => Number.isFinite(n) && n >= 0 && n <= 90) : DEFAULT_SETTINGS.advanceDays;
  return {
    ...DEFAULT_SETTINGS,
    ...value,
    advanceDays: [...new Set(days)].sort((a,b)=>b-a),
    audience: { ...DEFAULT_SETTINGS.audience, ...(value.audience || {}) },
    suppressedStudentIds: Array.isArray(value.suppressedStudentIds) ? [...new Set(value.suppressedStudentIds.map(Number).filter(Boolean))] : []
  };
}
async function getSchoolSettings(code) {
  const school = await School.findOne({ where:{ schoolId:code } });
  return { school, settings:normalizeSettings(school?.settings?.birthdayNotifications || {}) };
}
async function teacherClassIds(req) {
  if (req.user.role !== 'teacher') return null;
  const classes = await schoolLinkageService.resolveTeacherAssignedClasses(req.user.id, schoolCode(req), { classTeacherOnly:true });
  return classes.map(c => Number(c.id)).filter(Boolean);
}

exports.settings = async (req,res) => {
  try {
    const { settings } = await getSchoolSettings(schoolCode(req));
    res.json({ success:true, data:settings });
  } catch (error) { res.status(500).json({ success:false, message:error.message }); }
};

exports.updateSettings = async (req,res) => {
  try {
    const { school, settings:current } = await getSchoolSettings(schoolCode(req));
    if (!school) return res.status(404).json({ success:false, message:'School not found' });
    const next = normalizeSettings({ ...current, ...(req.body || {}), audience:{ ...current.audience, ...(req.body?.audience || {}) } });
    await school.update({ settings:{ ...(school.settings || {}), birthdayNotifications:next } });
    res.json({ success:true, message:'Birthday reminder settings saved.', data:next });
  } catch (error) { res.status(500).json({ success:false, message:error.message }); }
};

exports.updateStudentPrivacy = async (req,res) => {
  try {
    const student = await (Student.unscoped ? Student.unscoped() : Student).findOne({
      where:{ id:Number(req.params.studentId) },
      include:[{ model:User, where:{ schoolCode:schoolCode(req), role:'student' }, attributes:['id','name'] }]
    });
    if (!student) return res.status(404).json({ success:false, message:'Student not found' });
    const current = student.birthdayPrivacy || {};
    const birthdayPrivacy = {
      enabled: req.body.enabled !== false,
      notifyParent: req.body.notifyParent !== false,
      notifyTeacher: req.body.notifyTeacher !== false,
      notifyStudent: req.body.notifyStudent !== false,
      announceToClass: req.body.announceToClass === true
    };
    await student.update({
      birthdayPrivacy:{ ...current, ...birthdayPrivacy },
      ...(req.body.dateOfBirthVerified !== undefined ? { dateOfBirthVerified:req.body.dateOfBirthVerified === true } : {})
    });
    const { school, settings } = await getSchoolSettings(schoolCode(req));
    if (school) {
      const suppressed = new Set(settings.suppressedStudentIds || []);
      if (birthdayPrivacy.enabled) suppressed.delete(student.id); else suppressed.add(student.id);
      const updated = normalizeSettings({ ...settings, suppressedStudentIds:[...suppressed] });
      await school.update({ settings:{ ...(school.settings || {}), birthdayNotifications:updated } });
    }
    res.json({ success:true, message:'Birthday privacy updated.', data:{ studentId:student.id, birthdayPrivacy:student.birthdayPrivacy, dateOfBirthVerified:student.dateOfBirthVerified } });
  } catch (error) { res.status(500).json({ success:false, message:error.message }); }
};

exports.process = async (req,res) => {
  try {
    res.json({ success:true, message:'Birthday reminders processed with duplicate prevention.', data:await birthdayService.processSchool(schoolCode(req),{createdBy:req.user.id}) });
  } catch (error) { res.status(500).json({ success:false, message:error.message }); }
};

exports.upcoming = async (req,res) => {
  try {
    const { settings } = await getSchoolSettings(schoolCode(req));
    const timeZone = settings.timezone || 'Africa/Nairobi';
    const days = Math.min(Math.max(Number(req.query.days || 60), 1), 366);
    const now = new Date();
    const today = dateOnlyInZone(now, timeZone);
    const classIds = await teacherClassIds(req);
    let students;
    if (classIds) {
      const classes = classIds.length ? await Class.findAll({ where:{ id:{ [Op.in]:classIds }, schoolCode:schoolCode(req), [Op.or]:[{ isActive:true }, { isActive:null }] } }).catch(()=>[]) : [];
      students = await schoolLinkageService.resolveClassStudents(classes, schoolCode(req), { userAttributes:['id','name','profileImage','profilePicture'] });
      students = students.filter(st => st.dateOfBirth);
    } else {
      const studentWhere = { status:'active', dateOfBirth:{ [Op.ne]:null } };
      students = await (Student.unscoped ? Student.unscoped() : Student).findAll({
        where:studentWhere,
        include:[
          { model:User, where:{ schoolCode:schoolCode(req), role:'student', isActive:true }, attributes:['id','name','profileImage','profilePicture'] },
          { model:Class, required:false, attributes:['id','name','grade','stream'] }
        ],
        order:[[User,'name','ASC']]
      });
    }
    const end = new Date(now.getTime() + days * 86400000);
    const eventRows = await BirthdayEvent.findAll({
      where:{ schoolCode:schoolCode(req), eventDate:{ [Op.between]:[today,dateOnlyInZone(end,timeZone)] } },
      order:[['eventDate','ASC']]
    });
    const eventMap = new Map(eventRows.map(row => [`${row.studentId}:${row.eventDate}`, row]));
    const suppressed = new Set((settings.suppressedStudentIds || []).map(Number));
    const rows = students.map(student => {
      const birthday = nextBirthday(student.dateOfBirth, now, timeZone);
      if (!birthday || birthday > end) return null;
      const birthdayDate = dateOnlyInZone(birthday,timeZone);
      const todayNoon = new Date(`${today}T12:00:00Z`);
      const birthdayNoon = new Date(`${birthdayDate}T12:00:00Z`);
      const daysUntil = Math.max(0, Math.round((birthdayNoon - todayNoon) / 86400000));
      const privacy = { enabled:true, notifyParent:true, notifyTeacher:true, notifyStudent:true, announceToClass:false, ...(student.birthdayPrivacy || {}) };
      const enabled = privacy.enabled !== false && !suppressed.has(student.id);
      const event = eventMap.get(`${student.id}:${birthdayDate}`);
      return {
        studentId:student.id,
        studentName:student.User?.name || student.elimuid,
        profileImage:student.User?.profileImage || null,
        classId:student.classId || null,
        className:student.Class?.name || student.grade || 'Unassigned',
        stream:student.Class?.stream || null,
        dateOfBirth:student.dateOfBirth,
        dateOfBirthVerified:student.dateOfBirthVerified === true,
        birthdayDate,
        daysUntil,
        ageTurning:ageTurning(student.dateOfBirth,birthday),
        enabled,
        privacy,
        reminderStatus:event?.status || 'not_created',
        reminderEventType:event?.eventType || null,
        reminderSentAt:event?.updatedAt || null
      };
    }).filter(Boolean).sort((a,b)=>a.daysUntil-b.daysUntil || a.studentName.localeCompare(b.studentName));
    const missingDobCount = await (Student.unscoped ? Student.unscoped() : Student).count({ where:{ status:'active', [Op.or]:[{dateOfBirth:null}] }, include:[{ model:User, where:{ schoolCode:schoolCode(req), role:'student', isActive:true }, attributes:['id'] }] }).catch(()=>0);
    res.json({ success:true, data:{ today, days, settings, birthdays:rows, reminders:eventRows, missingDobCount } });
  } catch (error) { res.status(500).json({ success:false, message:error.message }); }
};
