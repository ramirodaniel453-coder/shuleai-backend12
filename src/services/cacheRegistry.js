const clearers = new Map();

function registerCache(name, clearFn) {
  if (!name || typeof clearFn !== 'function') throw new Error('Cache registration requires a name and clear function.');
  clearers.set(String(name), clearFn);
}

async function clearRegisteredCaches() {
  const results = [];
  for (const [name, clearFn] of clearers.entries()) {
    try { const cleared = await clearFn(); results.push({ name, ok: true, cleared: Number(cleared || 0) }); }
    catch (error) { results.push({ name, ok: false, cleared: 0, error: error.message }); }
  }
  let redisCleared = 0;
  if (process.env.REDIS_URL) {
    const { createClient } = require('redis');
    const client = createClient({ url: process.env.REDIS_URL });
    try {
      await client.connect();
      for await (const key of client.scanIterator({ MATCH: 'shuleai:cache:*', COUNT: 200 })) redisCleared += await client.del(key);
      results.push({ name: 'redis:shuleai:cache:*', ok: true, cleared: redisCleared });
    } catch (error) { results.push({ name: 'redis:shuleai:cache:*', ok: false, cleared: 0, error: error.message }); }
    finally { if (client.isOpen) await client.quit().catch(() => null); }
  }
  return { results, cleared: results.reduce((n, item) => n + Number(item.cleared || 0), 0), failed: results.filter(item => !item.ok).length };
}

module.exports = { registerCache, clearRegisteredCaches };
