const crypto = require('crypto');

function models() {
  try { return require('../models'); } catch (_) { return {}; }
}

function normalizeAudience(audience = {}, schoolCode = null) {
  const arr = (value) => [...new Set((Array.isArray(value) ? value : value == null ? [] : [value]).filter(v => v !== '' && v != null).map(String))];
  return {
    school: audience.school !== false && Boolean(schoolCode),
    userIds: arr(audience.userIds),
    roles: arr(audience.roles),
    classIds: arr(audience.classIds),
    studentIds: arr(audience.studentIds),
    conversations: arr(audience.conversations),
    rooms: arr(audience.rooms)
  };
}

function buildEnvelope(rowLike) {
  const row = rowLike?.toJSON ? rowLike.toJSON() : rowLike;
  return {
    eventId: String(row.id || row.eventId || crypto.randomUUID()),
    type: row.eventType || row.type,
    schoolCode: row.schoolCode || null,
    entity: row.entityType ? { type: row.entityType, id: row.entityId || null, version: Number(row.recordVersion || 1) } : null,
    audience: normalizeAudience(row.audience || {}, row.schoolCode),
    data: row.payload || row.data || {},
    createdAt: row.createdAt || new Date().toISOString()
  };
}

function roomsForEnvelope(envelope) {
  const rooms = new Set();
  const audience = envelope.audience || {};
  if (audience.school && envelope.schoolCode) rooms.add(`school:${envelope.schoolCode}`);
  for (const id of audience.userIds || []) rooms.add(`user:${id}`);
  for (const role of audience.roles || []) rooms.add(`role:${envelope.schoolCode}:${role}`);
  for (const id of audience.classIds || []) rooms.add(`class:${envelope.schoolCode}:${id}`);
  for (const id of audience.studentIds || []) rooms.add(`student-context:${id}`);
  for (const key of audience.conversations || []) rooms.add(`conversation:${key}`);
  for (const room of audience.rooms || []) rooms.add(room);
  return [...rooms];
}

async function markEmission(rowId, success, error = null) {
  const { RealtimeEvent } = models();
  if (!RealtimeEvent || !rowId || String(rowId).includes('-')) return;
  await RealtimeEvent.update({
    status: success ? 'emitted' : 'pending',
    emittedAt: success ? new Date() : null,
    lastError: error ? String(error.message || error).slice(0, 2000) : null,
    attempts: require('sequelize').literal('COALESCE("attempts", 0) + 1')
  }, { where: { id: rowId }, hooks: false }).catch(() => null);
}

async function emitEventRow(rowLike) {
  const envelope = buildEnvelope(rowLike);
  if (!global.io || !envelope.type) return false;
  try {
    const rooms = roomsForEnvelope(envelope);
    const isChat = String(envelope.type || '').startsWith('chat:');
    const chatPayload = isChat ? {
      ...(envelope.data || {}),
      type: envelope.type,
      eventId: envelope.eventId,
      schoolCode: envelope.schoolCode,
      conversationKey: envelope.data?.conversationKey || envelope.data?.conversationId || envelope.data?.metadata?.conversationKey || null,
      conversationId: envelope.data?.conversationId || envelope.data?.conversationKey || envelope.data?.metadata?.conversationKey || null
    } : null;
    for (const room of rooms) {
      global.io.to(room).emit('realtime:event', envelope);
      global.io.to(room).emit(envelope.type, envelope);
      if (chatPayload) global.io.to(room).emit('chat:realtime', { type: envelope.type, envelope, data: chatPayload });
      // Temporary compatibility while active clients move to the canonical envelope.
      if (room.startsWith('school:')) global.io.to(room).emit('realtime:update', { type: envelope.type, schoolCode: envelope.schoolCode, eventId: envelope.eventId, ...envelope.data });
    }
    await markEmission(rowLike?.id, true);
    return true;
  } catch (error) {
    await markEmission(rowLike?.id, false, error);
    console.error('[RealtimeOutbox] emit failed:', envelope.type, error.message);
    return false;
  }
}

async function queueEvent({ eventType, schoolCode = null, audience = {}, entityType = null, entityId = null, recordVersion = 1, payload = {}, transaction = null }) {
  const { RealtimeEvent } = models();
  const record = {
    eventType,
    schoolCode: schoolCode ? String(schoolCode) : null,
    audience: normalizeAudience(audience, schoolCode),
    entityType,
    entityId: entityId == null ? null : String(entityId),
    recordVersion: Number(recordVersion || 1),
    payload: payload || {},
    status: 'pending'
  };

  if (!RealtimeEvent) {
    const fallback = { ...record, id: crypto.randomUUID(), createdAt: new Date().toISOString() };
    setImmediate(() => emitEventRow(fallback));
    return fallback;
  }

  let row;
  try {
    row = await RealtimeEvent.create(record, { transaction, hooks: false });
  } catch (error) {
    // When this event belongs to a business transaction, failure to persist the
    // outbox row must fail that transaction too. Swallowing the error would leave
    // PostgreSQL in an aborted transaction and could commit business data without
    // a recoverable realtime event.
    if (transaction) throw error;

    // A transient, non-transactional fallback is only used during process startup
    // before migrations are available. It is deliberately never used for an
    // atomic business write.
    const fallback = { ...record, id: crypto.randomUUID(), createdAt: new Date().toISOString() };
    console.warn('[RealtimeOutbox] DB queue unavailable; emitting non-transactional fallback:', error.message);
    setImmediate(() => emitEventRow(fallback));
    return fallback;
  }

  const schedule = () => setImmediate(() => emitEventRow(row));
  if (transaction && typeof transaction.afterCommit === 'function') transaction.afterCommit(schedule);
  else schedule();
  return row;
}

async function processPending(limit = 100) {
  const { RealtimeEvent } = models();
  if (!RealtimeEvent || !global.io) return 0;
  const rows = await RealtimeEvent.findAll({
    where: { status: 'pending' },
    order: [['id', 'ASC']],
    limit: Math.max(1, Math.min(Number(limit) || 100, 500)),
    hooks: false
  }).catch(() => []);
  let emitted = 0;
  for (const row of rows) if (await emitEventRow(row)) emitted += 1;
  return emitted;
}

module.exports = { queueEvent, processPending, emitEventRow, buildEnvelope, normalizeAudience, roomsForEnvelope };
