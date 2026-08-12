async function configureSocketRedisAdapter(io) {
  const url = process.env.REDIS_URL;
  if (!url) return false;
  try {
    const { createAdapter } = require('@socket.io/redis-adapter');
    const { createClient } = require('redis');
    const pubClient = createClient({ url });
    const subClient = pubClient.duplicate();
    await Promise.all([pubClient.connect(), subClient.connect()]);
    io.adapter(createAdapter(pubClient, subClient));
    console.log('✅ Socket.IO Redis adapter enabled');
    return true;
  } catch (error) {
    console.error('⚠️ Socket.IO Redis adapter unavailable:', error.message);
    return false;
  }
}
module.exports = { configureSocketRedisAdapter };
