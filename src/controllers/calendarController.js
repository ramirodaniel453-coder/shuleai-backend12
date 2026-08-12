const { SchoolCalendar, User, Student } = require('../models');
const { Op } = require('sequelize');
const { getAlertsForUser, alertToCalendarEvent } = require('../services/alertReceiverEngine');
const { createAlert } = require('../services/notificationService');

function getSchoolId(req) {
  return req.user?.schoolCode || req.body?.schoolId || req.query?.schoolId || 'default';
}

function normalizeEvent(body, user) {
  const startDate = body.startDate || body.date;
  const endDate = body.endDate || body.date || startDate;
  const rawAudience = body.audience || body.broadcastTo || 'whole_school';
  const rawType = body.eventType || body.type || 'other';
  const ownEvent = body.isPublic === false || body.personal === true || body.scope === 'personal' || rawType === 'own_event' || rawAudience === 'admin_private';
  const metadata = {
    ...(body.metadata || {}),
    visibility: ownEvent ? 'private' : 'school',
    ownerUserId: user.id || null
  };
  return {
    schoolId: user.schoolCode || body.schoolId || 'default',
    eventType: rawType,
    eventName: body.eventName || body.title || 'Untitled Event',
    description: body.description || '',
    startDate,
    endDate,
    time: body.time || null,
    location: body.location || null,
    audience: ownEvent ? 'admin' : rawAudience,
    term: body.term || null,
    year: body.year || (startDate ? new Date(startDate).getFullYear() : new Date().getFullYear()),
    classId: body.classId || null,
    createdByUserId: user.id || null,
    metadata,
    isPublic: !ownEvent
  };
}


async function createCalendarBroadcastAlerts({ event, schoolId, actor }) {
  try {
    const audience = String(event.audience || 'whole_school').toLowerCase();
    const where = { schoolCode: schoolId, isActive: true };
    if (audience === 'teachers') where.role = 'teacher';
    else if (audience === 'parents') where.role = 'parent';
    else if (audience === 'students') where.role = 'student';
    else if (audience === 'admins') where.role = 'admin';
    else if (audience === 'whole_school') where.role = ['admin', 'teacher', 'parent', 'student'];
    else where.role = ['admin', 'teacher', 'parent', 'student'];

    let recipients = await User.findAll({ where, limit: 3000 }).catch(() => []);
    if (event.classId && ['students','parents','class','specific_class'].includes(audience)) {
      const students = await Student.findAll({ where: { classId: event.classId }, include: [{ model: User, attributes: ['id','role','schoolCode'] }] }).catch(() => []);
      const ids = new Set(students.map(s => s.User?.id).filter(Boolean));
      recipients = recipients.filter(u => ids.has(u.id));
    }
    const title = `Academic Calendar: ${event.title || event.eventName || 'School Event'}`;
    const message = [event.description, event.date || event.startDate, event.time, event.location].filter(Boolean).join(' • ') || 'A new school calendar event has been added.';
    const created = [];
    for (const user of recipients) {
      const dedupeKey = [schoolId, user.id, 'calendar-event', event.id].join(':');
      const payload = {
        userId: user.id,
        role: user.role === 'superadmin' ? 'super_admin' : user.role,
        type: 'academic',
        severity: 'info',
        title,
        message,
        categoryLabel: 'Academic Calendar',
        sourceType: 'calendar_broadcast',
        sourceLabel: 'Academic Calendar',
        targetRole: user.role,
        targetUserId: user.id,
        dedupeKey,
        actionUrl: '#calendar',
        actionLabel: 'View Calendar',
        data: { eventId: event.id, eventDate: event.date || event.startDate, audience, createdBy: actor?.id || null }
      };
      const alert = await createAlert({ ...payload, data:{ ...payload.data, schoolCode:schoolId } });
      if (alert) created.push(alert);
    }
    return created.length;
  } catch (e) {
    console.warn('Calendar broadcast alert creation failed:', e.message);
    return 0;
  }
}

function frontendEvent(event) {
  const raw = event?.toJSON ? event.toJSON() : (event || {});
  return {
    ...raw,
    title: raw.eventName,
    date: raw.startDate,
    type: raw.eventType,
    broadcastTo: raw.audience || 'whole_school'
  };
}

exports.getCalendarEvents = async (req, res) => {
  try {
    const schoolId = getSchoolId(req);
    const role = String(req.user?.role || '').toLowerCase().replace('-', '_');
    const where = { schoolId, [Op.or]: [{ isPublic: true }, { isPublic: false, createdByUserId: req.user?.id || null }] };
    if (req.query.year) where.year = Number(req.query.year);
    if (req.query.term) where.term = req.query.term;

    const events = await SchoolCalendar.findAll({
      where,
      order: [['startDate', 'ASC'], ['createdAt', 'ASC']]
    });

    const allowedAudiences = new Set(['whole_school', 'all', role, `${role}s`]);
    if (role === 'admin') allowedAudiences.add('admins');
    if (role === 'teacher') allowedAudiences.add('teachers');
    if (role === 'parent') allowedAudiences.add('parents');
    if (role === 'student') allowedAudiences.add('students');
    const calendarEvents = events
      .map(frontendEvent)
      .filter(e => {
        if (e.isPublic === false) return Number(e.createdByUserId || e.metadata?.ownerUserId || 0) === Number(req.user?.id || -1);
        return allowedAudiences.has(String(e.audience || e.broadcastTo || 'whole_school').toLowerCase());
      });

    const alertEvents = (await getAlertsForUser(req.user, {
      studentId: req.query.studentId || req.query.childId || null,
      limit: 200,
      calendarOnly: req.query.upcomingOnly === 'true' ? false : true,
      upcomingOnly: req.query.upcomingOnly === 'true'
    })).map(alertToCalendarEvent);

    const out = [...calendarEvents, ...alertEvents].sort((a, b) => new Date(a.startDate || a.date || 0) - new Date(b.startDate || b.date || 0));
    res.json({ success: true, data: out, events: out });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.createEvent = async (req, res) => {
  try {
    const payload = normalizeEvent(req.body, req.user || {});
    if (!payload.startDate) return res.status(400).json({ success: false, message: 'Event start date is required' });
    if (!payload.schoolId) return res.status(400).json({ success: false, message: 'School ID is required' });

    const event = await SchoolCalendar.create(payload);
    const out = frontendEvent(event);
    const alertCount = payload.isPublic === false ? 0 : await createCalendarBroadcastAlerts({ event: out, schoolId: payload.schoolId, actor: req.user || {} });
    if (global.io && payload.schoolId) {
      if (payload.isPublic === false) {
        global.io.to(`user-${req.user.id}`).emit('school-calendar:event-created', out);
        global.io.to(`user-${req.user.id}`).emit('school-calendar:changed', { action: 'created', event: out });
      } else {
        global.io.to(`school-${payload.schoolId}`).emit('school-calendar:event-created', out);
        global.io.to(`school-${payload.schoolId}`).emit('school-calendar:changed', { action: 'created', event: out });
        global.io.to(`school-${payload.schoolId}`).emit('alerts:updated', { type: 'calendar:event-created', schoolCode: payload.schoolId, event: out });
      }
    }
    res.status(201).json({ success: true, data: out, events: [out], alertCount, message: payload.isPublic === false ? 'Personal admin event saved privately' : `Academic calendar event saved and broadcasted to ${alertCount || 'the selected audience'} user(s)` });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateEvent = async (req, res) => {
  try {
    const { id } = req.params;
    const schoolId = getSchoolId(req);
    const payload = normalizeEvent(req.body, req.user || {});
    delete payload.schoolId;
    await SchoolCalendar.update(payload, { where: { id, schoolId } });
    const event = await SchoolCalendar.findOne({ where: { id, schoolId } });
    if (!event) return res.status(404).json({ success: false, message: 'Event not found' });
    const out = frontendEvent(event);
    if (global.io && schoolId) {
      global.io.to(`school-${schoolId}`).emit('school-calendar:event-updated', out);
      global.io.to(`school-${schoolId}`).emit('school-calendar:changed', { action: 'updated', event: out });
    }
    res.json({ success: true, data: out });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.deleteEvent = async (req, res) => {
  try {
    const { id } = req.params;
    const schoolId = getSchoolId(req);
    await SchoolCalendar.destroy({ where: { id, schoolId } });
    if (global.io && schoolId) {
      global.io.to(`school-${schoolId}`).emit('school-calendar:event-deleted', { id: String(id) });
      global.io.to(`school-${schoolId}`).emit('school-calendar:changed', { action: 'deleted', id: String(id) });
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
