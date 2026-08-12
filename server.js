require('dotenv').config();
const app = require('./src/app');
const http = require('http');
const socketio = require('socket.io');
const { sequelize, ChatMessage, Message, ChatGroupMember } = require('./src/models');
const socketAuthMiddleware = require('./src/middleware/socketAuthMiddleware');
const socketRoomService = require('./src/services/socketRoomService');
const realtimeService = require('./src/services/realtimeService');
const { configureSocketRedisAdapter } = require('./src/config/socketRedisAdapter');
const birthdayService = require('./src/services/birthdayService');
const studentLifecycleController = require('./src/controllers/studentLifecycleController');
const subscriptionEnforcement = require('./src/services/subscriptionEnforcementService');
const { loadBalancingConfig } = require('./src/config/loadBalancing');
const { isAllowedOrigin } = require('./src/config/corsOrigins');

const PORT = process.env.PORT || 5000;
const server = http.createServer(app);
server.requestTimeout = loadBalancingConfig.requestTimeoutMs;
server.headersTimeout = loadBalancingConfig.headersTimeoutMs;
server.keepAliveTimeout = loadBalancingConfig.keepAliveTimeoutMs;
if (loadBalancingConfig.maxRequestsPerSocket > 0) {
  server.maxRequestsPerSocket = loadBalancingConfig.maxRequestsPerSocket;
}

const io = socketio(server, {
  cors: {
    origin: (origin, callback) => {
      if (isAllowedOrigin(origin)) return callback(null, true);
      console.warn(`[Socket.IO CORS] Blocked origin: ${origin}`);
      return callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST']
  },
  transports: ['websocket', 'polling'],
  pingTimeout: 30000,
  pingInterval: 20000
});
global.io = io;

io.use(socketAuthMiddleware);

function messageSchoolCode(message){ return message?.schoolCode || message?.metadata?.schoolCode || null; }
async function findRealtimeMessage(messageId){
  const id=Number(messageId); if(!id)return null;
  const chat=await ChatMessage.findByPk(id).catch(()=>null); if(chat)return { message:chat, kind:'ChatMessage' };
  const direct=await Message.findByPk(id).catch(()=>null); return direct ? { message:direct, kind:'Message' } : null;
}
async function canAcknowledgeMessage(socket, message) {
  if (!message || String(messageSchoolCode(message)) !== String(socket.schoolCode)) return false;
  if (message.groupId) {
    if (Number(message.senderId) === Number(socket.userId)) return false;
    if (['admin','super_admin'].includes(socket.userRole)) return true;
    return Boolean(await ChatGroupMember.findOne({ where: { groupId: message.groupId, userId: socket.userId } }));
  }
  return Number(message.receiverId) === Number(socket.userId);
}

io.on('connection', async (socket) => {
  try {
    await socketRoomService.joinBaseRooms(socket);
    console.log(`✅ WebSocket connected: user ${socket.userId} (${socket.userRole})`);
  } catch (error) {
    console.error('[Socket.IO] base room join failed:', error.message);
  }

  socket.on('realtime:join', async (room, ack = () => {}) => {
    try {
      const allowed = await socketRoomService.canJoinRoom(socket, room);
      if (!allowed) return ack({ success:false, message:'Room access denied' });
      await socket.join(room);
      ack({ success:true, room });
    } catch (error) { ack({ success:false, message:error.message }); }
  });

  socket.on('realtime:leave', async (room, ack = () => {}) => {
    await socket.leave(String(room || ''));
    ack({ success:true, room });
  });

  socket.on('chat:join_conversation', async (conversationKey, ack = () => {}) => {
    const room = `conversation:${conversationKey}`;
    try {
      if (!(await socketRoomService.canJoinRoom(socket, room))) return ack({ success:false, message:'Conversation access denied' });
      for (const joined of socket.rooms) if (joined.startsWith('conversation:') && joined !== room) await socket.leave(joined);
      await socket.join(room);
      ack({ success:true, room });
    } catch (error) { ack({ success:false, message:error.message }); }
  });

  socket.on('chat:leave_conversation', async (conversationKey, ack = () => {}) => {
    const room = `conversation:${conversationKey}`;
    await socket.leave(room);
    ack({ success:true, room });
  });

  socket.on('chat:typing_started', async ({ conversationKey } = {}) => {
    const room = `conversation:${conversationKey}`;
    if (await socketRoomService.canJoinRoom(socket, room)) socket.to(room).emit('chat:typing_started', { conversationKey, userId:socket.userId, name:socket.user?.name || 'User' });
  });

  socket.on('chat:typing_stopped', async ({ conversationKey } = {}) => {
    const room = `conversation:${conversationKey}`;
    if (await socketRoomService.canJoinRoom(socket, room)) socket.to(room).emit('chat:typing_stopped', { conversationKey, userId:socket.userId });
  });

  socket.on('chat:message_delivered', async ({ messageId } = {}, ack = () => {}) => {
    try {
      const found = await findRealtimeMessage(messageId); const message=found?.message;
      if (!(await canAcknowledgeMessage(socket, message))) return ack({ success:false, message:'Message access denied' });
      const now = new Date(); const md=message.metadata||{};
      if(found.kind==='ChatMessage') await message.update({ deliveredAt:message.deliveredAt||now, deliveryStatus:'delivered', version:Number(message.version || 1) + 1 }, { hooks:false });
      else await message.update({ metadata:{...md,deliveryStatus:'delivered',deliveredAt:md.deliveredAt||now.toISOString()} }, { hooks:false });
      const key = message.conversationKey || md.conversationKey || (message.groupId ? realtimeService.groupConversationKey(message.groupId) : realtimeService.directConversationKey(message.senderId, message.receiverId));
      await realtimeService.emitToConversation(messageSchoolCode(message), key, 'chat:message_delivered', { messageId:message.id, conversationKey:key, deliveredAt:message.deliveredAt || md.deliveredAt || now }, { entityType:found.kind, entityId:message.id, version:Number(message.version||message.updatedAt?.getTime?.()||Date.now()), audience:{ userIds:[message.senderId, message.receiverId].filter(Boolean) } });
      ack({ success:true });
    } catch (error) { ack({ success:false, message:error.message }); }
  });

  socket.on('chat:message_read', async ({ messageId } = {}, ack = () => {}) => {
    try {
      const found = await findRealtimeMessage(messageId); const message=found?.message;
      if (!(await canAcknowledgeMessage(socket, message))) return ack({ success:false, message:'Message access denied' });
      const now = new Date();
      const metadata = message.metadata || {};
      const readBy = [...new Set([...(Array.isArray(metadata.readBy) ? metadata.readBy : []), socket.userId].map(Number))];
      if(found.kind==='ChatMessage') await message.update({ isRead:true, readAt:now, deliveryStatus:'read', version:Number(message.version || 1) + 1, metadata:{ ...metadata, readBy } }, { hooks:false });
      else await message.update({ isRead:true, readAt:now, metadata:{ ...metadata, readBy, deliveryStatus:'read' } }, { hooks:false });
      const key = message.conversationKey || metadata.conversationKey || (message.groupId ? realtimeService.groupConversationKey(message.groupId) : realtimeService.directConversationKey(message.senderId, message.receiverId));
      await realtimeService.emitToConversation(messageSchoolCode(message), key, 'chat:message_read', { messageId:message.id, conversationKey:key, readAt:now, readBy }, { entityType:found.kind, entityId:message.id, version:Number(message.version||message.updatedAt?.getTime?.()||Date.now()), audience:{ userIds:[message.senderId, message.receiverId].filter(Boolean) } });
      ack({ success:true });
    } catch (error) { ack({ success:false, message:error.message }); }
  });

  // Compatibility joins. The server still validates ownership; clients cannot choose arbitrary rooms.
  socket.on('join', async (userId) => { if (String(userId) === String(socket.userId)) await socket.join(`user-${userId}`); });
  socket.on('join-school', async (schoolCode) => { if (String(schoolCode) === String(socket.schoolCode)) await socket.join(`school-${schoolCode}`); });

  socket.on('disconnect', (reason) => console.log(`WebSocket disconnected: user ${socket.userId} (${reason})`));
});

async function start() {
  try {
    await sequelize.authenticate();
    console.log('✅ Database connection test SUCCESSFUL');
    console.log('✅ Schema mutations are migration-only; startup performs no runtime DDL.');
    const redisAdapterEnabled = await configureSocketRedisAdapter(io);
    if (!redisAdapterEnabled && process.env.NODE_ENV === 'production') {
      console.warn('⚠️ Socket.IO Redis adapter is not enabled. Multi-instance WebSocket broadcasts require REDIS_URL.');
    }
    await realtimeService.processPending(250).catch(() => 0);
    const timer = setInterval(() => realtimeService.processPending(100).catch(() => 0), Number(process.env.REALTIME_OUTBOX_INTERVAL_MS || 3000));
    timer.unref?.();

    const runScheduledLifecycleJobs = async () => {
      await birthdayService.processAllSchools().catch(error => console.error('[Birthday scheduler]', error.message));
      await studentLifecycleController.applyDueSystem().catch(error => console.error('[Promotion scheduler]', error.message));
      await studentLifecycleController.applyDueTransfersSystem().catch(error => console.error('[Class transfer scheduler]', error.message));
      await subscriptionEnforcement.processAllSchools().catch(error => console.error('[Subscription scheduler]', error.message));
    };
    if (loadBalancingConfig.runScheduledJobs) {
      setTimeout(runScheduledLifecycleJobs, 5000).unref?.();
      const lifecycleTimer = setInterval(runScheduledLifecycleJobs, Number(process.env.LIFECYCLE_JOB_INTERVAL_MS || 60 * 60 * 1000));
      lifecycleTimer.unref?.();
      console.log('✅ Scheduled lifecycle jobs enabled on this instance');
    } else {
      console.log('ℹ️ Scheduled lifecycle jobs disabled on this web instance');
    }

    app.locals.shuleAiReady = true;
    server.listen(PORT, () => console.log(`✅ Server running on port ${PORT} [instance ${loadBalancingConfig.instanceId}]`));
  } catch (err) {
    console.error('❌ Database or startup error:', err);
    process.exit(1);
  }
}

start();

async function gracefulShutdown(signal) {
  if (app.locals.shuleAiShuttingDown) return;
  app.locals.shuleAiShuttingDown = true;
  app.locals.shuleAiReady = false;
  console.log(`🛑 ${signal} received. Draining HTTP/WebSocket connections...`);

  const forceTimer = setTimeout(() => {
    console.error('❌ Graceful shutdown timed out. Forcing exit.');
    process.exit(1);
  }, loadBalancingConfig.gracefulShutdownMs);
  forceTimer.unref?.();

  try {
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => io.close(resolve));
    await sequelize.close().catch(() => null);
    clearTimeout(forceTimer);
    console.log('✅ Graceful shutdown complete');
    process.exit(0);
  } catch (error) {
    console.error('❌ Graceful shutdown error:', error);
    process.exit(1);
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  gracefulShutdown('unhandledRejection').catch(() => process.exit(1));
});
process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught Exception:', err);
  gracefulShutdown('uncaughtException').catch(() => process.exit(1));
});
