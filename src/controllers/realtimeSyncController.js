const { Op } = require('sequelize');
const { RealtimeEvent } = require('../models');
const roomService = require('../services/socketRoomService');
const outbox = require('../services/realtimeOutboxService');

async function visibleToUser(req, row) {
  const audience = row.audience || {};
  const userIds = (audience.userIds || []).map(String);
  const roles = (audience.roles || []).map(String);
  if (req.user.role === 'super_admin') {
    return !row.schoolCode || userIds.includes(String(req.user.id)) || roles.includes('super_admin');
  }
  if (row.schoolCode && String(row.schoolCode) !== String(req.user.schoolCode)) return false;
  if (audience.school) return true;
  if (userIds.includes(String(req.user.id))) return true;
  if (roles.includes(String(req.user.role))) return true;
  for (const classId of audience.classIds || []) {
    const fakeSocket = { userId:req.user.id, userRole:req.user.role, schoolCode:req.user.schoolCode };
    if (await roomService.canJoinClass(fakeSocket, req.user.schoolCode, classId)) return true;
  }
  for (const studentId of audience.studentIds || []) {
    const fakeSocket = { userId:req.user.id, userRole:req.user.role, schoolCode:req.user.schoolCode };
    if (await roomService.canJoinStudentContext(fakeSocket, studentId)) return true;
  }
  for (const conversation of audience.conversations || []) {
    const fakeSocket = { userId:req.user.id, userRole:req.user.role, schoolCode:req.user.schoolCode };
    if (await roomService.canJoinConversation(fakeSocket, conversation)) return true;
  }
  return false;
}

exports.sync = async (req, res) => {
  try {
    const after = Math.max(0, Number(req.query.after || 0));
    const limit = Math.max(1, Math.min(Number(req.query.limit || 200), 500));
    const where = { id: { [Op.gt]: after } };
    if (req.user.role !== 'super_admin') where[Op.or] = [{ schoolCode: req.user.schoolCode }, { schoolCode: null }];
    const rows = await RealtimeEvent.findAll({ where, order: [['id','ASC']], limit, hooks:false });
    const visible = [];
    for (const row of rows) if (await visibleToUser(req, row)) visible.push(outbox.buildEnvelope(row));
    // Advance by the last scanned row, not the last visible row. Otherwise a user can loop forever
    // on private events addressed to somebody else and never reach later authorised events.
    const lastScannedId = rows.length ? String(rows[rows.length - 1].id) : String(after);
    res.json({ success:true, data:visible, meta:{ after, lastEventId:lastScannedId, hasMore: rows.length === limit } });
  } catch (error) {
    // A freshly deployed server can temporarily run before migrations finish. Return an empty sync instead of breaking dashboards.
    if (/RealtimeEvents|does not exist/i.test(error.message || '')) return res.json({ success:true, data:[], meta:{ after:Number(req.query.after||0), lastEventId:String(req.query.after||0), hasMore:false, migrationPending:true } });
    res.status(500).json({ success:false, message:error.message });
  }
};
