// V87 timetable logic helpers: free lessons, P.E., double lessons, breaks/lunch, conflict validation
function v87NormalizeLessonType(value) {
  const raw = String(value || 'normal').toLowerCase().trim();
  if (['free','free_lesson','free lesson'].includes(raw)) return 'free';
  if (['pe','p.e','p.e.','physical education','sports'].includes(raw)) return 'pe';
  if (['double','double_lesson','double lesson'].includes(raw)) return 'double';
  if (['break','lunch','tea'].includes(raw)) return raw === 'lunch' ? 'lunch' : 'break';
  return 'normal';
}
function v87ValidateTimetableSlot(slot, existingSlots = []) {
  const type = v87NormalizeLessonType(slot.lessonType || slot.type || slot.subject);
  if (type === 'break' || type === 'lunch' || type === 'free') return { ok:true, type };
  const sameTime = existingSlots.filter(x => String(x.day || '').toLowerCase() === String(slot.day || '').toLowerCase() && String(x.startTime || x.start || '') === String(slot.startTime || slot.start || ''));
  if (slot.teacherId && sameTime.some(x => Number(x.teacherId) === Number(slot.teacherId))) return { ok:false, message:'Teacher is already assigned in this time slot.' };
  if (slot.classId && sameTime.some(x => Number(x.classId) === Number(slot.classId))) return { ok:false, message:'Class already has a lesson in this time slot.' };
  return { ok:true, type };
}

const { Timetable, Class, Teacher, User, Student, Parent, TeacherSubjectAssignment, sequelize } = require('../models');
const realtime = require('../services/realtimeService');
const moment = require('moment');
const { Op } = require('sequelize');
const schoolLinkageService = require('../services/schoolLinkageService');

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
async function ensureTimetableRuntimeReady() { return true; }

function isTransientDbError(error) {
  const text = `${error?.name || ''} ${error?.message || ''} ${error?.original?.message || ''} ${error?.parent?.message || ''}`;
  return /connection terminated|connection reset|econnreset|etimedout|timeout|terminating connection|server closed the connection|Connection terminated unexpectedly|Client has encountered a connection error|SequelizeConnection|ConnectionAcquireTimeout/i.test(text);
}

async function resetTimetableDbPool(label, error) {
  // Render/Postgres can leave a dead client in Sequelize's pool after "Connection terminated unexpectedly".
  // A normal authenticate() may reuse that dead client, so for timetable writes we force the pool closed
  // before retrying. The next query opens a fresh connection. This is safer than keeping asking schools to retry.
  console.warn(`[timetable] ${label} resetting DB pool after transient error`, { message: error?.message });
  try {
    if (sequelize?.connectionManager?.close) await sequelize.connectionManager.close();
  } catch (closeError) {
    console.warn('[timetable] DB pool close skipped/failed:', closeError?.message || closeError);
  }
}

async function withTimetableRetry(label, operation) {
  let lastError;
  const attempts = Number(process.env.TIMETABLE_DB_WRITE_ATTEMPTS || 4);
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      if (attempt > 1) await sequelize.query('SELECT 1');
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (!isTransientDbError(error) || attempt >= attempts) throw error;
      await resetTimetableDbPool(label, error);
      await new Promise(resolve => setTimeout(resolve, 350 * attempt));
    }
  }
  throw lastError;
}

async function safeRollback(transaction) {
  try { if (transaction && !transaction.finished) await transaction.rollback(); } catch (error) { console.warn('[timetable] rollback failed:', error.message); }
}

const DEFAULT_PERIODS = [
  { label: 'Period 1', startTime: '08:00', endTime: '08:40', type: 'lesson' },
  { label: 'Period 2', startTime: '08:40', endTime: '09:20', type: 'lesson' },
  { label: 'Period 3', startTime: '09:20', endTime: '10:00', type: 'lesson' },
  { label: 'Break', startTime: '10:00', endTime: '10:30', type: 'break', break: true },
  { label: 'Period 4', startTime: '10:30', endTime: '11:10', type: 'lesson' },
  { label: 'Period 5', startTime: '11:10', endTime: '11:50', type: 'lesson' },
  { label: 'Period 6', startTime: '11:50', endTime: '12:30', type: 'lesson' },
  { label: 'Lunch', startTime: '12:30', endTime: '14:00', type: 'break', break: true },
  { label: 'Period 7', startTime: '14:00', endTime: '14:40', type: 'lesson' },
  { label: 'Period 8', startTime: '14:40', endTime: '15:20', type: 'lesson' },
  { label: 'Period 9', startTime: '15:20', endTime: '16:00', type: 'lesson' }
];

function parseMaybeJson(value, fallback) {
  if (value == null) return fallback;
  if (Array.isArray(value) || typeof value === 'object') return value;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch (_) { return fallback; }
  }
  return fallback;
}
function norm(v) { return String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function sameText(a, b) { return norm(a) && norm(a) === norm(b); }
function cleanPeriod(p = {}, idx = 0) {
  const label = String(p.label || p.name || `Period ${idx + 1}`).trim();
  const rawType = String(p.type || (p.break ? 'break' : 'lesson')).toLowerCase();
  const isBreak = rawType === 'break' || /break|lunch|assembly|games|club/i.test(label);
  return {
    id: p.id || `period-${idx + 1}`,
    label,
    startTime: String(p.startTime || p.start || '08:00').slice(0, 5),
    endTime: String(p.endTime || p.end || '08:40').slice(0, 5),
    type: isBreak ? 'break' : 'lesson',
    break: isBreak,
    classes: Array.isArray(p.classes) ? p.classes : []
  };
}
function getPeriods(periods) {
  const parsed = parseMaybeJson(periods, []);
  return (Array.isArray(parsed) && parsed.length ? parsed : DEFAULT_PERIODS).map(cleanPeriod);
}
function shell(periods = DEFAULT_PERIODS) {
  const clean = getPeriods(periods);
  return DAYS.map(day => ({ day, periods: clean.map((p, idx) => ({ ...cleanPeriod(p, idx), classes: [] })) }));
}
function startOfWeek() { return moment().startOf('isoWeek').format('YYYY-MM-DD'); }
function subjectWeight(subject) {
  const s = norm(subject);
  if (/math|english|kiswahili|science|literacy|language/.test(s)) return 4;
  if (/biology|chemistry|physics|social|history|geography|cre|ire/.test(s)) return 3;
  return 2;
}
function defaultSubjectsForClass(cls = {}) {
  const settings = parseMaybeJson(cls.settings, {}) || {};
  const candidates = [settings.subjects, settings.curriculumSubjects, settings.learningAreas, settings.subjectList];
  for (const list of candidates) {
    if (Array.isArray(list) && list.length) {
      return [...new Set(list.map(s => typeof s === 'string' ? s : (s.subject || s.name || s.learningArea || s.title)).filter(Boolean))];
    }
  }
  const label = norm(`${cls.grade || ''} ${cls.name || ''}`);
  if (/pp|pre primary|nursery|kindergarten/.test(label)) return ['Literacy', 'Numeracy', 'Kiswahili', 'Environmental Activities', 'Creative Activities', 'Religious Education'];
  if (/grade|primary|class|std|standard/.test(label)) return ['Mathematics', 'English', 'Kiswahili', 'Science', 'Social Studies', 'Creative Arts', 'CRE', 'Agriculture'];
  return ['Mathematics', 'English', 'Kiswahili', 'Biology', 'Chemistry', 'Physics', 'Geography', 'History', 'CRE', 'Business Studies'];
}
function teacherName(t) { return t?.User?.name || t?.name || t?.fullName || 'Unassigned Teacher'; }
function teacherSubjects(t) { return parseMaybeJson(t?.subjects, []) || []; }
function normalizeAssignment(raw = {}, cls = null) {
  if (!raw) return null;
  const subject = raw.subject || raw.subjectName || raw.name || raw.learningArea || raw.title;
  if (!subject) return null;
  const teacherId = raw.teacherId || raw.TeacherId || raw.teacher_id || raw.id || raw.teacher?.id || null;
  return {
    subject: String(subject).trim(),
    teacherId: teacherId ? Number(teacherId) : null,
    teacherName: raw.teacherName || raw.teacher || raw.name || '',
    classId: cls?.id || raw.classId || null,
    room: raw.room || raw.classroom || ''
  };
}
function classAssignments(cls, teachers = [], subjectAssignments = []) {
  const list = [];
  (subjectAssignments || []).filter(a => String(a.classId) === String(cls.id)).forEach(a => {
    const n = normalizeAssignment({ subject: a.subject || a.subjectName, teacherId: a.teacherId, teacherName: a.Teacher?.User?.name || a.teacherName || '', classId: cls.id }, cls);
    if (n) list.push(n);
  });
  const direct = parseMaybeJson(cls.subjectTeachers, []) || [];
  if (Array.isArray(direct)) direct.forEach(a => { const n = normalizeAssignment(a, cls); if (n) list.push(n); });
  const settings = parseMaybeJson(cls.settings, {}) || {};
  ['subjects', 'curriculumSubjects', 'learningAreas', 'subjectTeachers'].forEach(key => {
    const arr = parseMaybeJson(settings[key], []) || [];
    if (Array.isArray(arr)) arr.forEach(item => {
      const n = typeof item === 'string' ? normalizeAssignment({ subject: item }, cls) : normalizeAssignment(item, cls);
      if (n) list.push(n);
    });
  });
  // Teachers directly assigned to this class also contribute their subject arrays.
  teachers.forEach(t => {
    const assignedToClass = String(t.classId || '') === String(cls.id) || sameText(t.classTeacher, cls.name) || sameText(t.classTeacher, `${cls.grade || ''} ${cls.stream || ''}`);
    if (!assignedToClass) return;
    teacherSubjects(t).forEach(subject => list.push({ subject, teacherId: Number(t.id), teacherName: teacherName(t), classId: cls.id }));
  });
  if (!list.length) {
    defaultSubjectsForClass(cls).forEach(subject => list.push({ subject, teacherId: null, teacherName: '', classId: cls.id, fallback: true }));
  }
  // Fill missing teacher by matching teacher subject first, then class teacher, then any teacher.
  const deduped = [];
  const seen = new Set();
  list.forEach(a => {
    const subject = String(a.subject || '').trim(); if (!subject) return;
    let teacher = a.teacherId ? teachers.find(t => Number(t.id) === Number(a.teacherId)) : null;
    if (!teacher) teacher = teachers.find(t => teacherSubjects(t).some(s => sameText(s, subject)));
    if (!teacher) teacher = teachers.find(t => String(t.classId || '') === String(cls.id) || sameText(t.classTeacher, cls.name));
    const key = norm(subject);
    if (seen.has(key)) return;
    seen.add(key);
    deduped.push({ ...a, subject, teacherId: teacher ? Number(teacher.id) : null, teacherName: teacher ? teacherName(teacher) : (a.teacherName || 'Unassigned Teacher') });
  });
  return deduped;
}
async function loadSchoolData(schoolId) {
  const classes = await Class.findAll({
    where: { schoolCode: schoolId, [Op.or]: [{ isActive: true }, { isActive: null }] },
    order: [['grade', 'ASC'], ['name', 'ASC']]
  });
  const teachers = await Teacher.findAll({
    include: [{ model: User, where: { schoolCode: schoolId, role: 'teacher' }, required: true, attributes: ['id', 'name', 'email', 'schoolCode'] }],
    order: [['id', 'ASC']]
  });
  const classIds = classes.map(c => c.id).filter(Boolean);
  const subjectAssignments = classIds.length ? await TeacherSubjectAssignment.findAll({
    where: { classId: { [Op.in]: classIds } },
    include: [{ model: Teacher, required: false, include: [{ model: User, required: false, attributes: ['id','name','email'] }] }]
  }).catch(() => []) : [];
  return { classes, teachers, subjectAssignments };
}
async function generateBalanced(schoolId, opts = {}) {
  const periods = getPeriods(opts.periods || DEFAULT_PERIODS);
  const lessonPeriodIndexes = periods.map((p, idx) => ({ p, idx })).filter(x => !x.p.break);
  const slots = shell(periods);
  const classResults = [];
  const teacherBusy = new Map();
  const classBusy = new Map();
  const warnings = [];
  const { classes, teachers, subjectAssignments } = await loadSchoolData(schoolId);

  for (const cls of classes) {
    const classPeriods = getPeriods((opts.classPeriodOverrides || {})[String(cls.id)] || periods);
    const classSlots = shell(classPeriods);
    const classLessonIndexes = classPeriods.map((p, idx) => ({ p, idx })).filter(x => !x.p.break);
    const assignments = classAssignments(cls, teachers, subjectAssignments);
    if (!assignments.length) {
      warnings.push({ classId: cls.id, className: cls.name, message: 'No subjects found for this class.' });
      classResults.push({ classId: cls.id, className: cls.name, grade: cls.grade, stream: cls.stream, periods: classPeriods, timetable: classSlots, lessonCount: 0 });
      continue;
    }
    let queue = [];
    assignments.forEach(a => {
      const repeat = Math.max(1, Math.min(subjectWeight(a.subject), classLessonIndexes.length));
      for (let i = 0; i < repeat; i++) queue.push({ ...a });
    });
    // Ensure at least one pass of every subject before repeats dominate.
    queue = [...assignments, ...queue].filter((a, idx, arr) => idx < assignments.length || arr.length < classLessonIndexes.length * DAYS.length);
    let cursor = 0;
    let placedCount = 0;
    for (const item of queue) {
      let placed = false;
      for (let attempt = 0; attempt < DAYS.length * classLessonIndexes.length; attempt++) {
        const day = DAYS[Math.floor(cursor / classLessonIndexes.length) % DAYS.length];
        const periodInfo = classLessonIndexes[cursor % classLessonIndexes.length];
        cursor++;
        const period = periodInfo.p;
        const pi = periodInfo.idx;
        const busyKey = `${day}:${period.startTime}:${period.endTime}`;
        const tBusy = teacherBusy.get(busyKey) || new Set();
        const cBusy = classBusy.get(busyKey) || new Set();
        if (cBusy.has(Number(cls.id))) continue;
        if (item.teacherId && tBusy.has(Number(item.teacherId))) continue;
        const lesson = {
          classId: cls.id,
          className: cls.name,
          grade: cls.grade,
          stream: cls.stream,
          subject: item.subject,
          teacherId: item.teacherId || null,
          teacherName: item.teacherName || 'Unassigned Teacher',
          room: item.room || '',
          startTime: period.startTime,
          endTime: period.endTime,
          term: opts.term,
          year: opts.year,
          scope: opts.scope || 'term'
        };
        const gDay = slots.find(d => d.day === day);
        if (gDay && gDay.periods[pi]) gDay.periods[pi].classes.push(lesson);
        const cDay = classSlots.find(d => d.day === day);
        if (cDay && cDay.periods[pi]) cDay.periods[pi].classes.push(lesson);
        cBusy.add(Number(cls.id)); classBusy.set(busyKey, cBusy);
        if (item.teacherId) { tBusy.add(Number(item.teacherId)); teacherBusy.set(busyKey, tBusy); }
        placedCount++;
        placed = true;
        break;
      }
      if (!placed) warnings.push({ classId: cls.id, className: cls.name, subject: item.subject, message: 'Could not place lesson without conflict.' });
    }
    classResults.push({ classId: cls.id, className: cls.name, grade: cls.grade, stream: cls.stream, periods: classPeriods, timetable: classSlots, lessonCount: placedCount, subjects: assignments.map(a => a.subject) });
  }
  return { slots, classes: classResults, warnings, periods };
}
function normalizeDay(d) { return String(d || '').toLowerCase(); }
function findActiveTimetable(schoolId, query = {}) {
  const where = { schoolId };
  if (query.weekStart || query.weekStartDate) where.weekStartDate = query.weekStart || query.weekStartDate;
  if (query.term) where.term = query.term;
  if (query.year) where.year = Number(query.year);
  if (query.includeDrafts) where.status = { [Op.ne]:'archived' };
  else where.isPublished = true;
  return Timetable.findOne({ where, order: query.includeDrafts ? [['isPublished','ASC'],['version','DESC'],['updatedAt','DESC']] : [['publishedAt','DESC'],['updatedAt','DESC']] })
    .then(tt => tt || (query.includeDrafts ? Timetable.findOne({ where:{ schoolId, status:{ [Op.ne]:'archived' } }, order:[['isPublished','ASC'],['version','DESC'],['updatedAt','DESC']] }) : Timetable.findOne({ where:{ schoolId, isPublished:true }, order:[['publishedAt','DESC'],['updatedAt','DESC']] })));
}
function resolveClassForStudent(student, classes) {
  if (!student || !classes) return null;
  const g = norm(student.grade || student.className || student.currentClass);
  return classes.find(c => String(c.id) === String(student.classId)) || classes.find(c => sameText(c.name, g) || sameText(c.grade, g) || norm(c.name).includes(g) || g.includes(norm(c.name)));
}
function findClassBlock(tt, cls) {
  if (!tt || !cls) return null;
  const blocks = Array.isArray(tt.classes) ? tt.classes : [];
  return blocks.find(c => String(c.classId ?? c.id ?? '') === String(cls.id)) || blocks.find(c => sameText(c.className || c.name, cls.name)) || blocks.find(c => sameText(c.grade, cls.grade));
}

function findUsableClassBlock(tt, cls) {
  const stored = findClassBlock(tt, cls);
  if (stored && Array.isArray(stored.timetable) && stored.timetable.length) return stored;
  const fromSlots = classBlockFromGlobalSlots(tt, cls);
  return fromSlots || stored || null;
}
function filterClassTimetable(block, periodsOverride) {
  if (!block) return [];
  const basePeriods = getPeriods(periodsOverride || block.periods || DEFAULT_PERIODS);
  const base = shell(basePeriods);
  const source = Array.isArray(block.timetable) ? block.timetable : [];
  return base.map(dayBlock => {
    const srcDay = source.find(d => normalizeDay(d.day) === dayBlock.day);
    if (!srcDay) return dayBlock;
    return { ...dayBlock, periods: dayBlock.periods.map((basePeriod, idx) => {
      const src = (srcDay.periods || [])[idx] || {};
      return { ...basePeriod, ...cleanPeriod({ ...basePeriod, ...src }, idx), classes: Array.isArray(src.classes) ? src.classes : [] };
    }) };
  });
}
function classBlockFromGlobalSlots(tt, cls) {
  if (!tt || !cls || !Array.isArray(tt.slots)) return null;
  const periods = getPeriods((tt.slots[0] && tt.slots[0].periods) || DEFAULT_PERIODS);
  const block = { classId: cls.id, className: cls.name, grade: cls.grade, stream: cls.stream, periods, timetable: shell(periods) };
  let count = 0;
  tt.slots.forEach(dayBlock => {
    const day = normalizeDay(dayBlock.day);
    (dayBlock.periods || []).forEach((period, pi) => {
      const matches = (period.classes || []).filter(l => String(l.classId ?? '') === String(cls.id) || sameText(l.className, cls.name) || sameText(l.grade, cls.grade));
      if (!matches.length) return;
      const d = block.timetable.find(x => x.day === day);
      if (!d || !d.periods[pi]) return;
      d.periods[pi] = { ...cleanPeriod(period, pi), classes: matches.map(l => ({ ...l, startTime: period.startTime, endTime: period.endTime, day })) };
      count += matches.length;
    });
  });
  return count ? block : null;
}

function compactLesson(lesson = {}, period = {}, day = '') {
  const subject = String(lesson.subject || lesson.subjectName || lesson.learningArea || lesson.schoolSubjectName || lesson.name || '').trim();
  const out = {
    classId: lesson.classId == null || lesson.classId === '' ? null : Number(lesson.classId),
    className: String(lesson.className || lesson.name || '').trim(),
    grade: String(lesson.grade || '').trim(),
    stream: String(lesson.stream || '').trim(),
    subject,
    subjectName: subject,
    teacherId: lesson.teacherId == null || lesson.teacherId === '' ? null : Number(lesson.teacherId),
    teacherName: String(lesson.teacherName || lesson.teacher || '').trim() || 'Unassigned Teacher',
    room: String(lesson.room || '').trim(),
    startTime: String(lesson.startTime || period.startTime || '').slice(0, 5),
    endTime: String(lesson.endTime || period.endTime || '').slice(0, 5),
    day: normalizeDay(day || lesson.day)
  };
  Object.keys(out).forEach(key => {
    if (out[key] === '' || Number.isNaN(out[key])) delete out[key];
  });
  return subject ? out : null;
}

function compactSlotsForStorage(slots = []) {
  return (Array.isArray(slots) ? slots : []).map((dayBlock) => {
    const day = normalizeDay(dayBlock.day || dayBlock.dayOfWeek);
    return {
      day,
      periods: (Array.isArray(dayBlock.periods) ? dayBlock.periods : []).map((period, idx) => {
        const clean = cleanPeriod(period, idx);
        const lessons = (Array.isArray(period.classes) ? period.classes : [])
          .map(lesson => compactLesson(lesson, clean, day))
          .filter(Boolean);
        return {
          id: clean.id,
          label: clean.label,
          startTime: clean.startTime,
          endTime: clean.endTime,
          type: clean.type,
          break: !!clean.break,
          classes: clean.break ? [] : lessons
        };
      })
    };
  });
}

function summarizeClassBlocksFromSlots(slots = [], classBlocks = []) {
  const byClass = new Map();
  (Array.isArray(classBlocks) ? classBlocks : []).forEach(block => {
    const key = String(block.classId ?? block.id ?? block.className ?? block.name ?? '').trim();
    if (!key) return;
    byClass.set(key, {
      classId: block.classId ?? block.id ?? null,
      className: block.className || block.name || 'Class',
      grade: block.grade || '',
      stream: block.stream || '',
      lessonCount: Number(block.lessonCount || 0),
      subjects: Array.isArray(block.subjects) ? [...new Set(block.subjects.filter(Boolean))] : []
    });
  });
  (Array.isArray(slots) ? slots : []).forEach(day => (day.periods || []).forEach(period => {
    if (period.break) return;
    (period.classes || []).forEach(lesson => {
      if (!String(lesson.subject || '').trim()) return;
      const key = String(lesson.classId ?? lesson.className ?? lesson.grade ?? '').trim();
      if (!key) return;
      if (!byClass.has(key)) byClass.set(key, {
        classId: lesson.classId ?? null,
        className: lesson.className || lesson.grade || 'Class',
        grade: lesson.grade || '',
        stream: lesson.stream || '',
        lessonCount: 0,
        subjects: []
      });
      const row = byClass.get(key);
      row.lessonCount += 1;
      if (lesson.subject && !row.subjects.includes(lesson.subject)) row.subjects.push(lesson.subject);
    });
  }));
  return Array.from(byClass.values());
}

function responseTimetable(row, slotsOverride = null, classesOverride = null) {
  const json = row?.toJSON ? row.toJSON() : (row || {});
  const slots = Array.isArray(slotsOverride) ? slotsOverride : (Array.isArray(json.slots) ? json.slots : []);
  const classes = Array.isArray(classesOverride) ? classesOverride : (Array.isArray(json.classes) ? json.classes : []);
  return { ...json, slots, classes, lessonCount: countLessonsFromSlots(slots) };
}

function validateTimetablePayload(slots = []) {
  const errors = [];
  const teacherBusy = new Map();
  const classBusy = new Map();
  const roomBusy = new Map();
  for (const dayBlock of slots || []) {
    const day = normalizeDay(dayBlock.day);
    for (const period of dayBlock.periods || []) {
      const start = String(period.startTime || '').slice(0,5);
      const end = String(period.endTime || '').slice(0,5);
      if (start && end && start >= end) errors.push({ type:'invalid_time', day, start, end, message:`${day}: period end time must be after start time.` });
      if (period.break) continue;
      for (const lesson of period.classes || []) {
        if (!String(lesson.subject || '').trim()) continue;
        const slotKey = `${day}|${start}|${end}`;
        const teacherId = Number(lesson.teacherId || 0) || null;
        const classId = String(lesson.classId || lesson.className || lesson.grade || '').trim();
        const room = norm(lesson.room || '');
        if (teacherId) {
          const key = `${slotKey}|${teacherId}`;
          if (teacherBusy.has(key)) errors.push({ type:'teacher_conflict', teacherId, day, start, message:`${lesson.teacherName || 'Teacher'} is assigned to two classes at ${start} on ${day}.` });
          teacherBusy.set(key, true);
        }
        if (classId) {
          const key = `${slotKey}|${classId}`;
          if (classBusy.has(key)) errors.push({ type:'class_conflict', classId, day, start, message:`${lesson.className || lesson.grade || 'Class'} has two lessons at ${start} on ${day}.` });
          classBusy.set(key, true);
        }
        if (room) {
          const key = `${slotKey}|${room}`;
          if (roomBusy.has(key)) errors.push({ type:'room_conflict', room:lesson.room, day, start, message:`Room ${lesson.room} is assigned twice at ${start} on ${day}.` });
          roomBusy.set(key, true);
        }
      }
    }
  }
  return errors;
}

function countLessonsFromSlots(slots = []) {
  let total = 0;
  (slots || []).forEach(day => (day.periods || []).forEach(p => {
    if (p.break) return;
    (p.classes || []).forEach(l => { if (String(l.subject || '').trim() && !/^(free|break|lunch|assembly|games|club|remedial)$/i.test(String(l.subject))) total++; });
  }));
  return total;
}

function enrichTimetableSlots(slots = []) {
  return (Array.isArray(slots) ? slots : []).map(day => ({
    ...day,
    periods: (day.periods || []).map(period => ({
      ...period,
      classes: (period.classes || []).map(lesson => {
        const subject = String(lesson.subjectName || lesson.subject || lesson.learningArea || lesson.name || '').trim();
        return { ...lesson, subject, subjectName: subject || 'Free', teacherName: lesson.teacherName || lesson.teacher || 'Unassigned Teacher', room: lesson.room || lesson.classroom || '' };
      })
    }))
  }));
}
function timetableStatusPayload(slots = []) {
  const now = new Date();
  const today = now.toLocaleDateString('en-US', { weekday:'long' }).toLowerCase();
  const time = now.toTimeString().slice(0,5);
  const day = (slots || []).find(d => normalizeDay(d.day) === today) || null;
  const lessons = [];
  (day?.periods || []).forEach(p => {
    if (p.break) return;
    (p.classes || []).forEach(l => { if (String(l.subject || l.subjectName || '').trim()) lessons.push({ ...l, startTime:p.startTime, endTime:p.endTime, day:day.day }); });
  });
  const currentLesson = lessons.find(l => l.startTime <= time && l.endTime > time) || null;
  const nextLesson = lessons.find(l => l.startTime > time) || null;
  return { todayLessons:lessons, currentLesson, nextLesson };
}

function studyUpdates(slots) {
  const now = new Date();
  const day = now.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
  const time = now.toTimeString().slice(0, 5);
  const dayBlock = (slots || []).find(s => String(s.day || '').toLowerCase() === day);
  if (!dayBlock) return [];
  return (dayBlock.periods || []).filter(p => !p.break && String(p.endTime || '00:00') <= time).flatMap(p => (p.classes || []).map(l => ({ subject: l.subject, teacherName: l.teacherName || l.teacher || 'Teacher', room: l.room || '', startTime: p.startTime, endTime: p.endTime }))).slice(-8);
}

exports.generate = async (req, res) => {
  try {
    await ensureTimetableRuntimeReady();
    const result = await withTimetableRetry('generate', async () => {
      const schoolId = String(req.user?.schoolCode || '').trim();
      if (!schoolId) return { status: 403, body: { success:false, message:'School scope is missing for this user.' } };

      const { weekStartDate, term='Term 1', year=new Date().getFullYear(), scope='term', periods, classPeriodOverrides={} } = req.body || {};
      const weekStart = weekStartDate || startOfWeek();
      const safeScope = ['term','year','week'].includes(scope) ? scope : 'term';
      const numericYear = Number(year) || new Date().getFullYear();

      const generated = await generateBalanced(schoolId, { term, year:numericYear, scope:safeScope, periods, classPeriodOverrides });
      const payload = {
        schoolId,
        weekStartDate: weekStart,
        term,
        year: numericYear,
        scope: safeScope,
        slots: compactSlotsForStorage(Array.isArray(generated.slots) ? generated.slots : []),
        classes: summarizeClassBlocksFromSlots(generated.slots || [], generated.classes || []),
        warnings: Array.isArray(generated.warnings) ? generated.warnings : [],
        isPublished: false,
        status: 'draft'
      };

      let tt = await Timetable.findOne({
        where:{ schoolId, weekStartDate:weekStart, term, year:numericYear, scope:safeScope, isPublished:false, status:{[Op.ne]:'archived'} },
        order:[['version','DESC'],['updatedAt','DESC']]
      });

      if (tt) {
        await tt.update(payload, { realtimeHandled:true });
      } else {
        const previous = await Timetable.findOne({
          where:{ schoolId, term, year:numericYear, scope:safeScope, isPublished:true },
          order:[['version','DESC'],['publishedAt','DESC']]
        });
        tt = await Timetable.create({
          ...payload,
          version: Number(previous?.version || 0) + 1,
          supersedesId: previous?.id || null
        }, { realtimeHandled:true });
      }

      await realtime.emitToRole(schoolId, 'admin', 'timetable:draft_updated', {
        timetableId: tt.id,
        term,
        year: numericYear,
        scope: safeScope,
        lessonCount: countLessonsFromSlots(payload.slots)
      }, { entityType:'Timetable', entityId:tt.id, version:tt.version || 1 }).catch(error => console.warn('[timetable] generate realtime skipped:', error.message));

      return { status: 200, body: {
        success:true,
        message:`Draft generated for ${payload.classes.length} class(es) with ${countLessonsFromSlots(payload.slots)} lesson(s)`,
        data:{ ...responseTimetable(tt, payload.slots, payload.classes), visibility:'draft', requiresPublish:true }
      } };
    });
    return res.status(result.status || 200).json(result.body);
  } catch (error) {
    console.error('[timetable] generate error:', { message:error.message, stack:error.stack, userId:req.user?.id, schoolCode:req.user?.schoolCode });
    return res.status(500).json({
      success:false,
      message:isTransientDbError(error)
        ? 'Database connection was interrupted while generating the timetable. Please retry once; your login session is still valid.'
        : (error.message || 'Timetable draft could not be generated.')
    });
  }
};
exports.getClasses = async (req, res) => { try {   await ensureTimetableRuntimeReady();
const classes = await Class.findAll({ where: { schoolCode: req.user.schoolCode, [Op.or]: [{ isActive: true }, { isActive: null }] }, order: [['grade', 'ASC'], ['name', 'ASC']] }); res.json({ success: true, data: classes }); } catch (error) { res.status(500).json({ success: false, message: error.message }); } };
exports.manualUpdate = async (req, res) => {
  try {
    await ensureTimetableRuntimeReady();
    const result = await withTimetableRetry('manualUpdate', async () => {
      const schoolId = String(req.user?.schoolCode || '').trim();
      const timetableId = Number(req.params.id);
      if (!schoolId) return { status: 403, body: { success:false, message:'School scope is missing for this user.' } };
      if (!timetableId) return { status: 400, body: { success:false, message:'Invalid timetable id.' } };

      let tt = await Timetable.findOne({ where:{ id:timetableId, schoolId } });
      if (!tt) {
        console.warn('[timetable] manualUpdate not found', { timetableId, schoolId, userId:req.user?.id, role:req.user?.role });
        return { status: 404, body: { success:false, message:'Timetable not found for this school.' } };
      }

      const sourceWasPublished = !!tt.isPublished;
      if (sourceWasPublished) {
        const existingDraft = await Timetable.findOne({
          where:{ schoolId, supersedesId:tt.id, isPublished:false, status:'draft' },
          order:[['updatedAt','DESC']]
        }).catch(() => null);
        tt = existingDraft || await Timetable.create({
          schoolId: tt.schoolId,
          weekStartDate: tt.weekStartDate || startOfWeek(),
          term: req.body.term || tt.term || 'Term 1',
          year: req.body.year ? Number(req.body.year) : (tt.year || new Date().getFullYear()),
          scope: req.body.scope || tt.scope || 'term',
          slots: compactSlotsForStorage(Array.isArray(tt.slots) ? tt.slots : []),
          classes: summarizeClassBlocksFromSlots(Array.isArray(tt.slots) ? tt.slots : [], Array.isArray(tt.classes) ? tt.classes : []),
          warnings: Array.isArray(tt.warnings) ? tt.warnings : [],
          isPublished: false,
          status: 'draft',
          version: Number(tt.version || 1) + 1,
          supersedesId: tt.id
        }, { realtimeHandled:true });
      }

      const slots = compactSlotsForStorage(Array.isArray(req.body.slots) ? req.body.slots : (Array.isArray(tt.slots) ? tt.slots : []));
      const classes = summarizeClassBlocksFromSlots(slots, Array.isArray(req.body.classes) ? req.body.classes : (Array.isArray(tt.classes) ? tt.classes : []));
      const conflicts = validateTimetablePayload(slots);
      if (conflicts.length) return { status: 400, body: { success:false, message:'Resolve timetable conflicts before saving.', data:{ conflicts } } };

      await tt.update({
        slots,
        classes,
        warnings: Array.isArray(req.body.warnings) ? req.body.warnings : (Array.isArray(tt.warnings) ? tt.warnings : []),
        term: req.body.term || tt.term || 'Term 1',
        year: req.body.year ? Number(req.body.year) : (tt.year || new Date().getFullYear()),
        scope: req.body.scope || tt.scope || 'term',
        status: 'draft',
        isPublished: false
      }, { realtimeHandled:true });

      await realtime.emitToRole(schoolId, 'admin', 'timetable:draft_updated', {
        timetableId: tt.id,
        liveTimetableId: tt.supersedesId || null,
        term: tt.term,
        year: tt.year,
        scope: tt.scope,
        requiresPublish: true
      }, { entityType:'Timetable', entityId:tt.id, version:tt.version || 1 }).catch(error => console.warn('[timetable] draft realtime skipped:', error.message));

      return { status: 200, body: {
        success:true,
        data:{ ...responseTimetable(tt, slots, classes), visibility:'draft', requiresPublish:true, liveTimetableId:tt.supersedesId || null, createdFromPublished:sourceWasPublished },
        message: sourceWasPublished ? 'Edits saved as a draft. Publish changes for teachers, students and parents to see them.' : 'Timetable draft saved. Publish changes for users to see them.'
      } };
    });
    return res.status(result.status || 200).json(result.body);
  } catch (error) {
    console.error('[timetable] manualUpdate error:', { message:error.message, stack:error.stack, userId:req.user?.id, schoolCode:req.user?.schoolCode, timetableId:req.params?.id });
    return res.status(500).json({ success:false, message:isTransientDbError(error) ? 'Database connection was interrupted while saving the timetable. Please retry once; your login session is still valid.' : (error.message || 'Timetable draft could not be saved.') });
  }
};

exports.publish = async (req, res) => {
  try {
    await ensureTimetableRuntimeReady();
    const result = await withTimetableRetry('publish', async () => {
      const schoolId = String(req.user?.schoolCode || '').trim();
      const timetableId = Number(req.params.id);
      if (!schoolId) return { status: 403, body: { success:false, message:'School scope is missing for this user.' } };
      if (!timetableId) return { status: 400, body: { success:false, message:'Invalid timetable id.' } };

      const transaction = await sequelize.transaction();
      try {
        const tt = await Timetable.findOne({
          where:{ id:timetableId, schoolId },
          transaction,
          lock: transaction.LOCK?.UPDATE || true
        });
        if (!tt) {
          await safeRollback(transaction);
          console.warn('[timetable] publish not found', { timetableId, schoolId, userId:req.user?.id, role:req.user?.role });
          return { status: 404, body: { success:false, message:'Timetable not found for this school.' } };
        }

        const scope = req.body.scope || tt.scope || 'term';
        const term = req.body.term || tt.term || 'Term 1';
        const year = req.body.year ? Number(req.body.year) : (tt.year || new Date().getFullYear());
        const slots = compactSlotsForStorage(Array.isArray(tt.slots) ? tt.slots : []);
        const lessonCount = countLessonsFromSlots(slots);
        if (!lessonCount) {
          await safeRollback(transaction);
          return { status: 400, body: { success:false, message:'Add at least one lesson before publishing the timetable.' } };
        }

        const conflicts = validateTimetablePayload(slots);
        if (conflicts.length) {
          await safeRollback(transaction);
          return { status: 400, body: { success:false, message:'Resolve timetable conflicts before publishing.', data:{ conflicts } } };
        }

        await Timetable.update(
          { isPublished:false, status:'archived' },
          { where:{ schoolId, scope, term, year, isPublished:true, id:{ [Op.ne]:tt.id } }, transaction, realtimeHandled:true }
        );
        const classes = summarizeClassBlocksFromSlots(slots, Array.isArray(tt.classes) ? tt.classes : []);
        await tt.update(
          { slots, classes, isPublished:true, status:'published', scope, term, year, publishedAt:new Date(), publishedBy:req.user.id },
          { transaction, realtimeHandled:true }
        );
        await transaction.commit();

        await realtime.emitToSchool(schoolId, 'timetable:published', {
          timetableId: tt.id,
          term,
          year,
          scope,
          version: tt.version || 1,
          publishedAt: tt.publishedAt,
          viewersUpdated: true
        }, { entityType:'Timetable', entityId:tt.id, version:tt.version || 1 }).catch(error => console.warn('[timetable] publish realtime skipped:', error.message));

        return { status: 200, body: { success:true, data:{ ...responseTimetable(tt, slots, classes), visibility:'published', requiresPublish:false, viewersUpdated:true }, message:'Timetable published. Teachers, students and parents can now see the latest changes.' } };
      } catch (error) {
        await safeRollback(transaction);
        throw error;
      }
    });
    return res.status(result.status || 200).json(result.body);
  } catch (error) {
    console.error('[timetable] publish error:', { message:error.message, stack:error.stack, userId:req.user?.id, schoolCode:req.user?.schoolCode, timetableId:req.params?.id });
    return res.status(500).json({ success:false, message:isTransientDbError(error) ? 'Database connection was interrupted while publishing the timetable. Please retry once; your login session is still valid.' : (error.message || 'Timetable could not be published.') });
  }
};
exports.getForClass = async (req, res) => { try {
  const tt = await findActiveTimetable(req.user.schoolCode, req.query);
  if (!tt) return res.json({ success: true, data: [], meta: { published: false } });
  const cls = await Class.findOne({ where: { id: req.params.classId, schoolCode: req.user.schoolCode, [Op.or]: [{ isActive: true }, { isActive: null }] } });
  const found = findUsableClassBlock(tt, cls);
  const data = found ? filterClassTimetable(found) : [];
  res.json({ success: true, data, meta: { term: tt.term, year: tt.year, scope: tt.scope, published: !!tt.isPublished, classInfo: found || cls || null, lessonCount: countLessonsFromSlots(data) } });
} catch (error) { res.status(500).json({ success: false, message: error.message }); } };
exports.getForTeacher = async (req,res)=>{ try{
  let teacher;
  if(req.user.role==='teacher') teacher=await Teacher.findOne({where:{userId:req.user.id},include:[{model:User,where:{schoolCode:req.user.schoolCode},required:true,attributes:['id','name','schoolCode']}]});
  else {
    const requested=Number(req.params.teacherId);
    teacher=await Teacher.findOne({where:{[Op.or]:[{id:requested||0},{userId:requested||0}]},include:[{model:User,where:{schoolCode:req.user.schoolCode},required:true,attributes:['id','name','schoolCode']}]});
  }
  if(!teacher)return res.status(404).json({success:false,message:'Teacher profile not found in this school'});
  const tt=await findActiveTimetable(req.user.schoolCode,req.query);
  if(!tt)return res.json({success:true,data:[],meta:{published:false,message:'The school has not published a timetable yet.'}});
  const teacherId=Number(teacher.id);
  const data=(tt.slots||[]).map(d=>({day:d.day,periods:(d.periods||[]).map(p=>({...p,classes:(p.classes||[]).filter(c=>Number(c.teacherId)===teacherId)})).filter(p=>p.break||p.classes.length)})).filter(d=>d.periods.length);
  res.json({success:true,data,meta:{term:tt.term,year:tt.year,scope:tt.scope,published:true,teacherId,version:tt.version}});
}catch(error){res.status(500).json({success:false,message:error.message});} };
exports.getByWeek = async (req, res) => { try {
  let tt = await findActiveTimetable(req.user.schoolCode, { ...req.query, includeDrafts: true, weekStartDate: req.query.weekStartDate || req.query.weekStart || startOfWeek() });
  if (!tt) tt = await findActiveTimetable(req.user.schoolCode, { ...req.query, includeDrafts: true });
  let live = null;
  if (tt) {
    live = await Timetable.findOne({
      where:{schoolId:req.user.schoolCode,term:tt.term,year:tt.year,scope:tt.scope,isPublished:true,status:'published'},
      order:[['publishedAt','DESC'],['updatedAt','DESC']]
    });
  }
  const classLessonCounts = {};
  if (tt) (tt.classes || []).forEach(block => {
    const key = String(block.classId ?? block.id ?? block.className);
    classLessonCounts[key] = block.lessonCount != null ? Number(block.lessonCount) : countLessonsFromSlots(filterClassTimetable(block));
  });
  const total = tt ? (countLessonsFromSlots(tt.slots || []) || Object.values(classLessonCounts).reduce((a,b)=>a+b,0)) : 0;
  res.json({ success: true, data: tt ? {
    ...tt.toJSON(), lessonCount: total, classLessonCounts,
    liveTimetableId: live?.id || null,
    liveVersion: live?.version || null,
    hasUnpublishedChanges: !!tt && !tt.isPublished,
    visibleToUsers: !!tt?.isPublished,
    visibility: tt?.isPublished ? 'published' : 'draft',
    requiresPublish: !!tt && !tt.isPublished
  } : null });
} catch (error) { res.status(500).json({ success: false, message: error.message }); } };
exports.getForStudentMe = async (req, res) => { try {
  const student = await Student.unscoped().findOne({ where: { userId: req.user.id }, include: [{ model: User, attributes: ['id', 'name', 'email', 'phone', 'schoolCode'] }] });
  if (!student) return res.status(404).json({ success: false, message: 'Student profile not found' });
  const schoolId = student.User?.schoolCode || req.user.schoolCode;
  const classes = await Class.findAll({ where: { schoolCode: schoolId, [Op.or]: [{ isActive: true }, { isActive: null }] } }); const cls = await schoolLinkageService.resolveStudentClass(student, schoolId) || resolveClassForStudent(student, classes);
  const tt = await findActiveTimetable(schoolId, req.query);
  const block = findUsableClassBlock(tt, cls); const slots = enrichTimetableSlots(block ? filterClassTimetable(block) : []); const status = timetableStatusPayload(slots);
  res.json({ success: true, data: { student, classInfo: cls, timetable: slots, updates: studyUpdates(slots), todayLessons:status.todayLessons, currentLesson:status.currentLesson, nextLesson:status.nextLesson, term: tt?.term, year: tt?.year, scope: tt?.scope, published: !!tt?.isPublished } });
} catch (error) { res.status(500).json({ success: false, message: error.message }); } };
exports.getForParentChild = async (req, res) => { try {
  const parent = await Parent.findOne({ where: { userId: req.user.id } }); if (!parent) return res.status(404).json({ success: false, message: 'Parent profile not found' });
  const student = await Student.unscoped().findOne({ where: { id: req.params.studentId }, include: [{ model: User, attributes: ['id', 'name', 'email', 'phone', 'schoolCode'] }] });
  if (!student) return res.status(404).json({ success: false, message: 'Student not found' });
  if (parent.hasStudent) { const ok = await parent.hasStudent(student); if (!ok) return res.status(403).json({ success: false, message: 'Child not linked to this parent' }); }
  const schoolId = student.User?.schoolCode || req.user.schoolCode;
  const classes = await Class.findAll({ where: { schoolCode: schoolId, [Op.or]: [{ isActive: true }, { isActive: null }] } }); const cls = await schoolLinkageService.resolveStudentClass(student, schoolId) || resolveClassForStudent(student, classes);
  const tt = await findActiveTimetable(schoolId, req.query);
  const block = findUsableClassBlock(tt, cls); const slots = enrichTimetableSlots(block ? filterClassTimetable(block) : []); const status = timetableStatusPayload(slots);
  res.json({ success: true, data: { child: student, classInfo: cls, timetable: slots, updates: studyUpdates(slots), todayLessons:status.todayLessons, currentLesson:status.currentLesson, nextLesson:status.nextLesson, term: tt?.term, year: tt?.year, scope: tt?.scope, published: !!tt?.isPublished, premiumStatusPreview: true } });
} catch (error) { res.status(500).json({ success: false, message: error.message }); } };
