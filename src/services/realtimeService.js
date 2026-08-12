const outbox = require('./realtimeOutboxService');

function emit({ type, schoolCode, audience, entityType, entityId, version, data, transaction }) {
  if (!type) throw new Error('Realtime event type is required');
  return outbox.queueEvent({
    eventType: type,
    schoolCode,
    audience,
    entityType,
    entityId,
    recordVersion: version || 1,
    payload: data || {},
    transaction
  });
}

const emitToSchool = (schoolCode, type, data = {}, options = {}) => emit({ type, schoolCode, audience: { school: true, ...(options.audience || {}) }, data, ...options });
const emitToUser = (userId, type, data = {}, options = {}) => emit({ type, schoolCode: options.schoolCode || data.schoolCode || null, audience: { school: false, userIds: [userId], ...(options.audience || {}) }, data, ...options });
const emitToUsers = (userIds, type, data = {}, options = {}) => emit({ type, schoolCode: options.schoolCode || data.schoolCode || null, audience: { school: false, userIds, ...(options.audience || {}) }, data, ...options });
const emitToClass = (schoolCode, classId, type, data = {}, options = {}) => emit({ type, schoolCode, audience: { school: false, classIds: [classId], ...(options.audience || {}) }, data, ...options });
const emitToConversation = (schoolCode, conversationKey, type, data = {}, options = {}) => emit({ type, schoolCode, audience: { school: false, conversations: [conversationKey], ...(options.audience || {}) }, data, ...options });
const emitToStudentContext = (schoolCode, studentId, type, data = {}, options = {}) => emit({ type, schoolCode, audience: { school: false, studentIds: [studentId], ...(options.audience || {}) }, data, ...options });
const emitToRole = (schoolCode, role, type, data = {}, options = {}) => emit({ type, schoolCode, audience: { school: false, roles: [role], ...(options.audience || {}) }, data, ...options });

function directConversationKey(a, b) {
  const ids = [Number(a), Number(b)].sort((x, y) => x - y);
  return `direct:${ids[0]}:${ids[1]}`;
}
const groupConversationKey = (id) => `group:${Number(id)}`;
const threadConversationKey = (id) => `thread:${Number(id)}`;

module.exports = {
  emit,
  emitToSchool,
  emitToUser,
  emitToUsers,
  emitToClass,
  emitToConversation,
  emitToStudentContext,
  emitToRole,
  directConversationKey,
  groupConversationKey,
  threadConversationKey,
  processPending: outbox.processPending
};
