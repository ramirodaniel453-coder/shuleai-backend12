const crypto = require('crypto');

function parseDsn(raw) {
  const dsn = String(raw || process.env.SENTRY_DSN || process.env.ERROR_MONITORING_DSN || '').trim();
  if (!dsn) return null;
  try {
    const url = new URL(dsn);
    const projectId = url.pathname.replace(/^\//, '').split('/').filter(Boolean).pop();
    if (!url.username || !projectId) return null;
    return { publicKey: url.username, host: url.host, projectId, protocol: url.protocol || 'https:' };
  } catch (_) { return null; }
}

function eventId() { return crypto.randomBytes(16).toString('hex'); }

async function postSentryEvent(event) {
  const parsed = parseDsn();
  if (!parsed || typeof fetch !== 'function') return false;
  const endpoint = `${parsed.protocol}//${parsed.host}/api/${encodeURIComponent(parsed.projectId)}/store/?sentry_key=${encodeURIComponent(parsed.publicKey)}&sentry_version=7`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event)
  });
  return response.ok;
}

function buildExceptionEvent(error, context = {}) {
  return {
    event_id: eventId(),
    timestamp: new Date().toISOString(),
    platform: 'node',
    logger: 'shuleai-backend',
    level: 'error',
    release: process.env.RELEASE || process.env.SHULE_AI_VERSION || require('../../package.json').version,
    environment: process.env.NODE_ENV || 'development',
    exception: {
      values: [{
        type: error?.name || 'Error',
        value: error?.message || String(error || 'Unknown error'),
        stacktrace: { frames: [] }
      }]
    },
    request: context.request ? {
      method: context.request.method,
      url: context.request.url,
      headers: context.request.headers ? {
        'user-agent': context.request.headers['user-agent'],
        referer: context.request.headers.referer,
        origin: context.request.headers.origin
      } : undefined
    } : undefined,
    user: context.user ? { id: String(context.user.id || ''), role: context.user.role, schoolCode: context.user.schoolCode } : undefined,
    tags: { service: 'shuleai-backend', requestId: context.requestId, ...(context.tags || {}) },
    extra: { stack: error?.stack, ...(context.extra || {}) }
  };
}

function sanitizeFrontendPayload(payload = {}) {
  return {
    event_id: eventId(),
    timestamp: new Date().toISOString(),
    platform: 'javascript',
    logger: 'shuleai-frontend',
    level: payload.level || 'error',
    release: payload.release || process.env.RELEASE || process.env.SHULE_AI_VERSION || require('../../package.json').version,
    environment: process.env.NODE_ENV || 'production',
    message: String(payload.message || 'Frontend error').slice(0, 1000),
    exception: { values: [{ type: String(payload.name || 'FrontendError'), value: String(payload.message || 'Frontend error').slice(0, 1000) }] },
    request: { url: String(payload.url || '').slice(0, 1000), headers: { 'user-agent': String(payload.userAgent || '').slice(0, 500) } },
    tags: { service: 'shuleai-frontend', build: String(payload.build || '') },
    extra: { stack: String(payload.stack || '').slice(0, 8000), source: String(payload.source || '').slice(0, 500), line: payload.line, column: payload.column }
  };
}

function captureException(error, context = {}) {
  if (!parseDsn()) return false;
  postSentryEvent(buildExceptionEvent(error, context)).catch(err => console.warn('[error-monitor] capture failed:', err.message));
  return true;
}

function captureFrontendError(payload) {
  if (!parseDsn()) return false;
  postSentryEvent(sanitizeFrontendPayload(payload)).catch(err => console.warn('[error-monitor] frontend capture failed:', err.message));
  return true;
}

function getMonitoringHealth() {
  return { configured: Boolean(parseDsn()), provider: parseDsn() ? 'sentry-compatible' : 'none' };
}

module.exports = { captureException, captureFrontendError, getMonitoringHealth, parseDsn };
