const crypto = require('crypto');
const { Alert, User } = require('../models');
const realtime = require('./realtimeService');

const TYPE_MAP = new Set(['academic','attendance','fee','system','improvement','duty','approval','message','career']);
function dbType(value) {
  const raw = String(value || 'system').toLowerCase();
  if (TYPE_MAP.has(raw)) return raw;
  if (/payment|finance|balance|subscription/.test(raw)) return 'fee';
  if (/chat|announce|notice/.test(raw)) return 'message';
  return 'system';
}
function roleValue(value) {
  const role = String(value || 'admin').toLowerCase().replace('-', '_');
  return role === 'superadmin' ? 'super_admin' : role;
}
function semanticKey({ userId, type, title, message, data = {}, dedupeKey }) {
  if (dedupeKey) return String(dedupeKey).slice(0, 250);
  const identity = data.eventId || data.sourceId || data.messageId || data.paymentId || data.reportId || data.attendanceId || data.releaseId || data.timetableId || data.homeworkId || data.studentId || data.classId || '';
  const context = data.eventDate || data.date || data.term || data.year || data.assessmentKey || data.version || data.status || '';
  // Entity-backed alerts use a stable key so retries, reconnects and repeated workers cannot
  // create duplicates. Unscoped informational notices use a short bucket so a genuinely new
  // notice with the same wording can still be sent later.
  const bucket = identity || context ? '' : Math.floor(Date.now() / 30000);
  return `auto:${crypto.createHash('sha256').update(JSON.stringify([Number(userId),dbType(type),String(title||'').trim(),String(message||'').trim(),String(identity),String(context),bucket])).digest('hex')}`;
}

async function createAlert({ userId, role, type, severity = 'info', title, message, data = {}, dedupeKey, sourceType, sourceLabel, categoryLabel, studentId, classId, actionUrl, actionLabel, transaction }) {
  try {
    const uid = Number(userId);
    if (!uid) return null;
    let finalRole = roleValue(role);
    let user = null;
    if (!role || !data?.schoolCode) user = await User.findByPk(uid, { transaction }).catch(() => null);
    if (!role && user?.role) finalRole = roleValue(user.role);
    const schoolCode = data?.schoolCode || user?.schoolCode || null;
    const finalData = {
      ...(data || {}),
      schoolCode,
      scope: data?.scope || 'user',
      targetUserIds: Array.isArray(data?.targetUserIds) ? data.targetUserIds : [uid],
      targetRoles: Array.isArray(data?.targetRoles) ? data.targetRoles : (finalRole ? [finalRole] : [])
    };
    const key = semanticKey({ userId:uid, type, title, message, data:finalData, dedupeKey });
    const payload = {
      userId: uid,
      role: finalRole,
      type: dbType(type),
      severity: ['critical','warning','info','success'].includes(String(severity)) ? String(severity) : 'info',
      title: title || 'Notification',
      message: message || '',
      categoryLabel: categoryLabel || data?.category || type || 'System',
      sourceType: sourceType || data?.sourceType || 'system_auto',
      sourceLabel: sourceLabel || data?.sourceLabel || 'Shule AI system',
      targetUserId: uid,
      targetRole: finalRole,
      studentId: studentId || data?.studentId || null,
      classId: classId || data?.classId || null,
      actionUrl: actionUrl || data?.actionUrl || null,
      actionLabel: actionLabel || data?.actionLabel || null,
      dedupeKey: key,
      data: finalData,
      isRead: false,
      readAt: null
    };
    let alert = await Alert.findOne({ where:{ userId:uid, dedupeKey:key }, transaction }).catch(() => null);
    if (alert) {
      // Do not insert or re-emit the same alert. Updating it to unread caused duplicate
      // visual notifications on reconnect in earlier builds.
      return alert;
    }
    alert = await Alert.create(payload, { transaction, realtimeHandled:true });
    const emit = () => realtime.emitToUser(uid, 'alert:created', alert.toJSON(), { schoolCode, entityType:'Alert', entityId:alert.id, version:1 });
    if (transaction?.afterCommit) transaction.afterCommit(() => emit().catch(e => console.error('[alert realtime]', e.message)));
    else await emit().catch(e => console.error('[alert realtime]', e.message));
    return alert;
  } catch (error) {
    if (error?.name === 'SequelizeUniqueConstraintError') return Alert.findOne({ where:{ userId:Number(userId), dedupeKey:semanticKey({userId,type,title,message,data,dedupeKey}) } }).catch(() => null);
    console.error('Alert creation error:', error);
    return null;
  }
}

async function createBulkAlerts(alerts = []) {
  const rows = [];
  for (const item of alerts) {
    const row = await createAlert(item);
    if (row) rows.push(row);
  }
  return { success:true, count:rows.length, data:rows };
}

module.exports = { createAlert, createBulkAlerts };
