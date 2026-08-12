const os = require('os');
const crypto = require('crypto');

function boolEnv(name, fallback = false) {
  const value = process.env[name];
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function intEnv(name, fallback) {
  const value = parseInt(process.env[name], 10);
  return Number.isFinite(value) ? value : fallback;
}

const INSTANCE_ID = process.env.RENDER_INSTANCE_ID
  || process.env.INSTANCE_ID
  || `${os.hostname()}-${process.pid}-${crypto.randomBytes(3).toString('hex')}`;

const loadBalancingConfig = {
  instanceId: INSTANCE_ID,
  trustProxy: boolEnv('TRUST_PROXY', process.env.NODE_ENV === 'production'),
  exposeInstanceHeader: boolEnv('EXPOSE_INSTANCE_HEADER', false),
  gracefulShutdownMs: intEnv('GRACEFUL_SHUTDOWN_MS', 25000),
  requestTimeoutMs: intEnv('HTTP_REQUEST_TIMEOUT_MS', 120000),
  headersTimeoutMs: intEnv('HTTP_HEADERS_TIMEOUT_MS', 65000),
  keepAliveTimeoutMs: intEnv('HTTP_KEEP_ALIVE_TIMEOUT_MS', 61000),
  maxRequestsPerSocket: intEnv('HTTP_MAX_REQUESTS_PER_SOCKET', 0),
  runScheduledJobs: !boolEnv('DISABLE_SCHEDULED_JOBS', false) && boolEnv('RUN_SCHEDULED_JOBS', true)
};

function applyLoadBalancingMiddleware(app) {
  if (loadBalancingConfig.trustProxy) {
    // Required behind Render/Cloudflare/Nginx so req.ip, HTTPS detection,
    // secure cookies, and rate-limit keys use the original client correctly.
    app.set('trust proxy', 1);
  }

  app.locals.shuleAiInstanceId = loadBalancingConfig.instanceId;
  app.locals.shuleAiReady = false;
  app.locals.shuleAiShuttingDown = false;

  app.use((req, res, next) => {
    if (loadBalancingConfig.exposeInstanceHeader) {
      res.setHeader('X-ShuleAI-Instance', loadBalancingConfig.instanceId);
    }
    next();
  });
}

module.exports = {
  boolEnv,
  intEnv,
  loadBalancingConfig,
  applyLoadBalancingMiddleware
};
