const { randomUUID } = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');
const { captureException } = require('../services/errorMonitorService');
const { isAllowedOrigin } = require('../config/corsOrigins');

const requestStore = new AsyncLocalStorage();

function setCorsHeaders(req, res) {
  const origin = req.headers.origin;

  // Direct browser navigation, Render health checks, curl, and server-to-server
  // requests usually do not send an Origin header. Never set
  // Access-Control-Allow-Origin to undefined; Node rejects that header value and
  // turns safe health checks into 500 Internal Server Error responses.
  if (!origin) return;

  if (!isAllowedOrigin(origin)) return;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Requested-With,Accept,Origin,Stripe-Signature,X-Paystack-Signature,verif-hash,flutterwave-signature');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function requestContext(req, res, next) {
  setCorsHeaders(req, res);
  const context = { requestId: req.headers['x-request-id'] || randomUUID(), user: null };
  req.requestId = context.requestId;
  res.setHeader('X-Request-Id', context.requestId);
  requestStore.run(context, () => next());
}

function setTenantUser(user) {
  const store = requestStore.getStore();
  if (store) store.user = user;
}

function getTenantContext() {
  return requestStore.getStore() || {};
}

function productionErrorHandler(err, req, res, next) {
  setCorsHeaders(req, res);
  const status = err.status || err.statusCode || 500;
  const safeMessage = status >= 500 && process.env.NODE_ENV === 'production'
    ? 'Internal server error'
    : (err.message || 'Internal server error');
  console.error(`[${req.requestId || 'no-request-id'}]`, err.stack || err);
  captureException(err, { requestId: req.requestId, request: { method: req.method, url: req.originalUrl || req.url, headers: req.headers }, user: req.user, tags: { status } });
  if (res.headersSent) return next(err);
  res.status(status).json({ success: false, message: safeMessage, requestId: req.requestId });
}

module.exports = { requestContext, productionErrorHandler, setTenantUser, getTenantContext, setCorsHeaders };
