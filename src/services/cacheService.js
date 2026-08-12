const DEFAULT_TTL_SECONDS = Math.max(1, parseInt(process.env.CACHE_DEFAULT_TTL_SECONDS || '60', 10));
const MAX_KEYS = Math.max(100, parseInt(process.env.CACHE_MAX_KEYS || '5000', 10));
const DISABLED = process.env.CACHE_DISABLED === 'true';

const store = new Map();

function now() {
  return Date.now();
}

function normalizeKey(parts) {
  if (Array.isArray(parts)) return parts.filter((part) => part !== undefined && part !== null && part !== '').map(String).join(':');
  return String(parts || '');
}

function sweepExpired() {
  const t = now();
  for (const [key, entry] of store.entries()) {
    if (entry.expiresAt <= t) store.delete(key);
  }
  if (store.size <= MAX_KEYS) return;
  const overflow = store.size - MAX_KEYS;
  const keys = Array.from(store.keys()).slice(0, overflow);
  keys.forEach((key) => store.delete(key));
}

function get(key) {
  if (DISABLED) return null;
  const normalized = normalizeKey(key);
  const entry = store.get(normalized);
  if (!entry) return null;
  if (entry.expiresAt <= now()) {
    store.delete(normalized);
    return null;
  }
  return entry.value;
}

function set(key, value, ttlSeconds = DEFAULT_TTL_SECONDS) {
  if (DISABLED) return false;
  const normalized = normalizeKey(key);
  const ttl = Math.max(1, parseInt(ttlSeconds, 10) || DEFAULT_TTL_SECONDS);
  store.set(normalized, { value, expiresAt: now() + ttl * 1000 });
  if (store.size > MAX_KEYS) sweepExpired();
  return true;
}

function del(key) {
  return store.delete(normalizeKey(key));
}

function flushPrefix(prefix) {
  const normalized = normalizeKey(prefix);
  let removed = 0;
  for (const key of store.keys()) {
    if (key.startsWith(normalized)) {
      store.delete(key);
      removed += 1;
    }
  }
  return removed;
}

function flushSchoolCache(schoolCodeOrId) {
  if (!schoolCodeOrId) return 0;
  return flushPrefix(['school', schoolCodeOrId]);
}

function wrapJsonWithCache(res, { key, ttlSeconds, payload }) {
  set(key, payload, ttlSeconds);
  return res.json({ ...payload, cached: false });
}

setInterval(sweepExpired, Math.max(30, DEFAULT_TTL_SECONDS) * 1000).unref?.();

module.exports = {
  get,
  set,
  del,
  flushPrefix,
  flushSchoolCache,
  getCacheKey: normalizeKey,
  wrapJsonWithCache
};
