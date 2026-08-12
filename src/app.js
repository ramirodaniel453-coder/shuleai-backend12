const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const fileUpload = require('express-fileupload');
const path = require('path');
const fs = require('fs');
const { assertRequiredEnv } = require('./config/requiredEnv');

// Routes
const authRoutes = require('./routes/authRoutes');
const adminRoutes = require('./routes/adminRoutes');
const dutyRoutes = require('./routes/dutyRoutes');
const publicRoutes = require('./routes/publicRoutes');
const superAdminRoutes = require('./routes/superAdminRoutes');
const teacherRoutes = require('./routes/teacherRoutes');
const parentRoutes = require('./routes/parentRoutes');
const studentRoutes = require('./routes/studentRoutes');
const analyticsRoutes = require('./routes/analyticsRoutes');
const subscriptionRoutes = require('./routes/subscriptionRoutes');
const uploadRoutes = require('./routes/uploadRoutes');
const schoolRoutes = require('./routes/schoolRoutes');
const parentMessageRoutes = require('./routes/parentMessageRoutes');
const helpRoutes = require('./routes/helpRoutes');
const userRoutes = require('./routes/userRoutes');
const mediaRoutes = require('./routes/mediaRoutes');
const taskRoutes = require('./routes/taskRoutes');
const alertRoutes = require('./routes/alertRoutes');
const competencyRoutes = require('./routes/competencyRoutes');
const homeTaskRoutes = require('./routes/homeTaskRoutes');
const consentRoutes = require('./routes/consentRoutes'); // <-- ADDED
const searchRoutes = require('./routes/searchRoutes');
const calendarRoutes = require('./routes/calendarRoutes');
const timetableRoutes = require('./routes/timetableRoutes');
const homeworkRoutes = require('./routes/homeworkRoutes');
const publicHomeworkFileController = require('./controllers/homeworkController');
const gamificationRoutes = require('./routes/gamificationRoutes');
const chatV9Routes = require('./routes/chatV9Routes');
const paymentRoutes = require('./routes/paymentRoutes');
const financeRoutes = require('./routes/financeRoutes');
const financialSystemRoutes = require('./routes/financialSystemRoutes');
const nationalRolloutRoutes = require('./routes/nationalRolloutRoutes');
const scaleRoutes = require('./routes/scaleRoutes');
const jobRoutes = require('./routes/jobRoutes');
const tutorRoutes = require('./routes/tutorRoutes');
const learnFeedRoutes = require('./routes/learnFeedRoutes');
const reportRoutes = require('./routes/reportRoutes');
const smsRoutes = require('./routes/smsRoutes');
const feeStructureRoutes = require('./routes/feeStructureRoutes');
const ownerHardeningRoutes = require('./routes/ownerHardeningRoutes');
const realtimeRoutes = require('./routes/realtimeRoutes');
const attendanceLifecycleRoutes = require('./routes/attendanceLifecycleRoutes');
const reportHistoryRoutes = require('./routes/reportHistoryRoutes');
const studentLifecycleRoutes = require('./routes/studentLifecycleRoutes');
const advancedAnalyticsRoutes = require('./routes/advancedAnalyticsRoutes');
const birthdayRoutes = require('./routes/birthdayRoutes');
const monitoringRoutes = require('./routes/monitoringRoutes');
const { routeAwareApiLimiter } = require('./middleware/productionRateLimits');
const { requestContext, productionErrorHandler } = require('./middleware/requestContext');
const { requireFeature } = require('./middleware/featureGate');
const { protect, authorize } = require('./middleware/auth');
const { applyLoadBalancingMiddleware, loadBalancingConfig } = require('./config/loadBalancing');
const { getStorageHealth } = require('./services/objectStorageService');
const { getMonitoringHealth } = require('./services/errorMonitorService');
const { isAllowedOrigin } = require('./config/corsOrigins');
const { enforceMaintenanceMode } = require('./middleware/platformControls');

assertRequiredEnv();

const app = express();
if (process.env.NODE_ENV === 'production') {
  const configuredProxyHops = Number(process.env.TRUST_PROXY_HOPS || 1);
  const trustedProxyHops = Number.isInteger(configuredProxyHops) && configuredProxyHops >= 1 ? configuredProxyHops : 1;
  app.set('trust proxy', trustedProxyHops);
}
applyLoadBalancingMiddleware(app);

// ============ MIDDLEWARE ============
app.use((req, res, next) => { req._startAt = Date.now(); next(); });
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      objectSrc: ["'none'"],
      frameSrc: ["'none'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
      imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
      fontSrc: ["'self'", 'data:'],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      scriptSrcAttr: ["'none'"],
      connectSrc: [
        "'self'",
        'https://api.shuleai.live',
        'wss://api.shuleai.live'
      ],
      workerSrc: ["'self'"],
      manifestSrc: ["'self'"]
    }
  }
}));

// CORS must run before all /api routes and before rate limits.
// Do not rely only on FRONTEND_URL because production may use shuleai.live, www,
// GitHub Pages preview domains, or local dev during emergency testing.
const corsOptions = {
  origin: (origin, callback) => {
    if (isAllowedOrigin(origin)) return callback(null, true);
    console.warn(`[CORS] Blocked origin: ${origin}`);
    return callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin', 'Stripe-Signature', 'X-Paystack-Signature', 'verif-hash', 'flutterwave-signature'],
  optionsSuccessStatus: 204
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(requestContext);

// Route-aware limits: strict for auth/uploads/writes, generous for dashboard reads.
app.use('/api', routeAwareApiLimiter);

function isPaymentWebhookPath(req) {
  const url = String(req.originalUrl || req.url || '');
  return /\/api\/payments\/(webhook|mpesa\/callback|daraja\/callback|callback)/i.test(url);
}

app.use(express.json({
  limit: process.env.API_JSON_LIMIT || '2mb',
  verify: (req, res, buf) => {
    if (isPaymentWebhookPath(req)) req.rawBody = Buffer.from(buf);
  }
}));
app.use(express.urlencoded({
  extended: true,
  limit: process.env.API_FORM_LIMIT || '2mb',
  verify: (req, res, buf) => {
    if (isPaymentWebhookPath(req)) req.rawBody = Buffer.from(buf);
  }
}));
app.use(cookieParser());
app.use(compression());

app.use(fileUpload({
  limits: { fileSize: process.env.MAX_FILE_SIZE || 50 * 1024 * 1024 },
  useTempFiles: true,
  tempFileDir: process.env.UPLOAD_TMP_DIR || path.join(process.cwd(), 'uploads', 'tmp'),
  createParentPath: true
}));

if (process.env.NODE_ENV === 'development') {
  app.use((req, res, next) => {
    const started = Date.now();
    res.on('finish', () => {
      const method = String(req.method || '').replace(/[\r\n]/g, '');
      const route = String(req.originalUrl || req.url || '').replace(/[\r\n]/g, '').slice(0, 500);
      console.log(`[http] ${method} ${route} ${res.statusCode} ${Date.now() - started}ms`);
    });
    next();
  });
}

// Authentication is stateless JWT-based; no in-memory session store is used in production.

const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}
app.use('/uploads', (req, res, next) => {
  if (/\.(?:svg|svgz|html?|xhtml|xml)$/i.test(String(req.path || ''))) {
    return res.status(415).json({ success:false, message:'Active document uploads are not served.' });
  }
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Render's local /uploads directory is ephemeral. Older saved profile/signature
  // URLs can point to files that vanished after redeploy. Do not return 404 for
  // those legacy image requests; the frontend/report card will use its clean
  // fallback line/avatar instead of showing a broken image icon.
  const requestPath = String(req.path || '');
  if (/\/(profiles|signatures)\//i.test(requestPath)) {
    const absolutePath = path.join(uploadDir, requestPath.replace(/^\/+/, ''));
    if (!fs.existsSync(absolutePath)) {
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'no-store');
      return res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=', 'base64'));
    }
  }
  next();
}, express.static(uploadDir));

// Public homework file route used by dashboard View/Download buttons.
// Kept outside /api so browser navigation/downloads do not fail when Authorization headers are unavailable.
app.get('/homework-files/:filename', publicHomeworkFileController.serveHomeworkAttachment);

// ============ TEST ENDPOINT ============
function healthPayload(req, extra = {}) {
  return {
    success: true,
    version: require('../package.json').version,
    build: 'v2045-academic-payment-completion-lock',
    instanceId: req.app.locals.shuleAiInstanceId || loadBalancingConfig.instanceId,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    ...extra
  };
}

app.get('/health', (req, res) => {
  res.json(healthPayload(req, { status: req.app.locals.shuleAiReady ? 'ready' : 'starting' }));
});
app.get('/api/health', (req, res) => {
  res.json(healthPayload(req, { status: req.app.locals.shuleAiReady ? 'ready' : 'starting' }));
});
app.get(['/health/live', '/api/health/live'], (req, res) => {
  res.json(healthPayload(req, { status: 'live' }));
});
app.get(['/health/ready', '/api/health/ready'], async (req, res) => {
  if (req.app.locals.shuleAiShuttingDown) {
    return res.status(503).json(healthPayload(req, { success: false, status: 'shutting_down' }));
  }
  try {
    const { sequelize } = require('./models');
    await sequelize.query('SELECT 1');
    req.app.locals.shuleAiReady = true;
    return res.json(healthPayload(req, { status: 'ready', checks: { database: { ok: true } } }));
  } catch (error) {
    req.app.locals.shuleAiReady = false;
    return res.status(503).json(healthPayload(req, { success: false, status: 'not_ready', checks: { database: { ok: false, error: 'Database readiness check failed' } } }));
  }
});

app.get('/api/health/detailed', protect, (req, res, next) => authorize('super_admin')(req, res, next), async (req, res) => {
  const started = Date.now();
  const checks = { database: { ok: false }, daraja: { ok: false }, aiTutor: { ok: false }, storage: { ok: false } };
  try {
    const { sequelize } = require('./models');
    await sequelize.query('SELECT 1');
    checks.database = { ok: true };
  } catch (e) { checks.database = { ok: false, error: e.message }; }
  try {
    checks.daraja = {
      ok: Boolean(process.env.DARAJA_CONSUMER_KEY && process.env.DARAJA_CONSUMER_SECRET && process.env.DARAJA_PASSKEY && process.env.DARAJA_SHORTCODE),
      configured: Boolean(process.env.DARAJA_CONSUMER_KEY && process.env.DARAJA_CONSUMER_SECRET && process.env.DARAJA_PASSKEY && process.env.DARAJA_SHORTCODE),
      env: process.env.DARAJA_ENV || 'sandbox'
    };
  } catch (e) { checks.daraja = { ok: false, error: e.message }; }
  try {
    const provider = String(process.env.AI_PROVIDER || 'deepseek').toLowerCase().trim();
    const deepseekConfigured = Boolean(process.env.DEEPSEEK_API_KEY);
    const anthropicConfigured = Boolean(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY);
    checks.aiTutor = {
      ok: provider === 'deepseek' ? deepseekConfigured : anthropicConfigured,
      configured: provider === 'deepseek' ? deepseekConfigured : anthropicConfigured,
      provider,
      model: provider === 'deepseek'
        ? (process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash')
        : (process.env.ANTHROPIC_MODEL || process.env.CLAUDE_MODEL || 'claude-haiku-4-5'),
      baseUrl: provider === 'deepseek' ? (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com') : undefined
    };
  } catch (e) { checks.aiTutor = { ok: false, error: e.message }; }
  try {
    const storageHealth = getStorageHealth();
    const tmp = path.join(uploadDir, `.health-${Date.now()}.tmp`);
    fs.writeFileSync(tmp, 'ok'); fs.unlinkSync(tmp);
    checks.storage = { ok: storageHealth.durable, uploadDir, ...storageHealth };
  } catch (e) { checks.storage = { ok: false, error: e.message, uploadDir, ...getStorageHealth() }; }
  try {
    checks.monitoring = { ok: true, ...getMonitoringHealth() };
  } catch (e) { checks.monitoring = { ok: false, error: e.message }; }
  const ok = Object.values(checks).every(x => x.ok);
  res.status(ok ? 200 : 503).json({ success: ok, status: ok ? 'ready' : 'degraded', uptime: process.uptime(), latencyMs: Date.now() - started, timestamp: new Date().toISOString(), checks });
});


// Database schema ownership is migration-only in v2044. Runtime HTTP traffic never executes DDL.
// Readiness fails when required schema is unavailable; run `npm run migrate` before starting the service.

// Maintenance mode is persisted in PlatformSettings and enforced before application routes.
app.use('/api', enforceMaintenanceMode);

// ============ MOUNT ROUTES ============
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/duty', protect, dutyRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/super-admin', superAdminRoutes);
app.use('/api/teacher', teacherRoutes);
app.use('/api/parent', parentRoutes);
app.use('/api/student', studentRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/subscription', subscriptionRoutes);
// v126: backwards-compatible plural alias used by consolidated frontend fallback paths.
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/school', schoolRoutes);
app.use('/api/parent-messages', parentMessageRoutes);
app.use('/api/help', helpRoutes);
app.use('/api/media', mediaRoutes);
app.use('/api/user', userRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/alerts', alertRoutes);
app.use('/api/cbe', competencyRoutes);
app.use('/api/home-tasks', homeTaskRoutes);
app.use('/api/consent', consentRoutes);   // <-- ADDED
app.use('/api/search', searchRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/sms', smsRoutes);
app.use('/api/calendar', protect, calendarRoutes);
app.use('/api/timetable', protect, timetableRoutes);
app.use('/api/homework', protect, homeworkRoutes);
app.use('/api/gamification', gamificationRoutes);
app.use('/api/chat-v9', chatV9Routes);
app.use('/api/scale', scaleRoutes);
app.use('/api/jobs', jobRoutes);
app.use('/api/tutor', tutorRoutes);
app.use('/api/learnfeed', learnFeedRoutes);
// Payment routes must be mounted BEFORE nationalRolloutRoutes.
// nationalRolloutRoutes intentionally disables legacy/fake payment endpoints, but real Daraja STK
// endpoints such as /api/payments/parent/subscription/stk must remain reachable.
app.use('/api/payments', paymentRoutes);
app.use('/api/finance', financeRoutes);
app.use('/api/finance-system', financialSystemRoutes);
app.use('/api/owner', ownerHardeningRoutes);
app.use('/api/fee-structures', feeStructureRoutes);
app.use('/api/fees/structures', feeStructureRoutes);
// V143 canonical real-time cursor recovery and locked attendance lifecycle.
app.use('/api/realtime', realtimeRoutes);
app.use('/api/attendance', attendanceLifecycleRoutes);
app.use('/api/report-cards', reportHistoryRoutes);
app.use('/api/lifecycle/birthdays', birthdayRoutes);
app.use('/api/lifecycle', studentLifecycleRoutes);
app.use('/api/analytics/advanced', advancedAnalyticsRoutes);
app.use('/api/monitoring', monitoringRoutes);

// Broad compatibility routes must be last. Mounting this authenticated router
// before specific /api routes intercepts public monitoring and can shadow newer
// fee, realtime, attendance and lifecycle endpoints.
app.use('/api', nationalRolloutRoutes);

// ============ 404 HANDLER ============
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Route not found' });
});

// ============ ERROR HANDLER ============
app.use(productionErrorHandler);

module.exports = app;
