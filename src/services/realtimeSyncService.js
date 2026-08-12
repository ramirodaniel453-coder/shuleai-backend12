// realtimeSyncService.js
// Central DB-driven realtime dashboard sync layer.
// Database stays the source of truth; sockets only tell dashboards which sections to refetch.

function normalizeSchoolCode(value) {
  if (!value) return null;
  return String(value).trim();
}

function safeEmit(room, event, payload) {
  try {
    if (!global.io || !room || !event) return false;
    global.io.to(room).emit(event, payload);
    return true;
  } catch (error) {
    console.error('[RealtimeSync] emit failed:', event, error.message);
    return false;
  }
}

function emitSchoolUpdate(schoolCode, type, payload = {}) {
  const code = normalizeSchoolCode(schoolCode || payload.schoolCode || payload.schoolId);
  if (!code || !type) return false;

  const body = {
    type,
    schoolCode: code,
    schoolId: code,
    timestamp: new Date().toISOString(),
    ...payload
  };

  // One generic event for the global frontend sync layer.
  safeEmit(`school-${code}`, 'realtime:update', body);

  // Backward-compatible specific events for older listeners.
  const aliases = Array.isArray(payload.aliases) ? payload.aliases : [];
  for (const alias of aliases) safeEmit(`school-${code}`, alias, body);

  return true;
}

function emitUserUpdate(userId, type, payload = {}) {
  if (!userId || !type) return false;
  const body = { type, userId, timestamp: new Date().toISOString(), ...payload };
  safeEmit(`user-${userId}`, 'realtime:update', body);
  return true;
}

function emitPaymentUpdate(schoolCode, payload = {}) {
  return emitSchoolUpdate(schoolCode, payload.status === 'pending' ? 'payment:pending' : 'payment:updated', {
    section: 'finance',
    aliases: ['payment:updated', 'fees:updated', 'analytics:updated'],
    ...payload
  });
}

function emitMarksUpdate(schoolCode, payload = {}) {
  return emitSchoolUpdate(schoolCode, 'marks:updated', {
    section: 'grades',
    aliases: ['grades:updated', 'reports:updated', 'analytics:updated'],
    ...payload
  });
}

function emitAttendanceUpdate(schoolCode, payload = {}) {
  return emitSchoolUpdate(schoolCode, 'attendance:updated', {
    section: 'attendance',
    aliases: ['attendance-updated', 'analytics:updated'],
    ...payload
  });
}

function emitHomeworkUpdate(schoolCode, payload = {}) {
  return emitSchoolUpdate(schoolCode, 'homework:updated', {
    section: 'homework',
    aliases: ['homework:updated', 'analytics:updated'],
    ...payload
  });
}

module.exports = {
  emitSchoolUpdate,
  emitUserUpdate,
  emitPaymentUpdate,
  emitMarksUpdate,
  emitAttendanceUpdate,
  emitHomeworkUpdate
};
