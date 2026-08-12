const rateLimit = require('express-rate-limit');

function positiveLimit(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function makeLimiter({ windowMs, max, message }) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: false,
    keyGenerator: (req) => {
      const userKey = req.user?.id ? `user:${req.user.id}` : `ip:${req.ip}`;
      return `${userKey}:${req.baseUrl || ''}:${req.path || ''}`;
    },
    message: { success: false, message }
  });
}

const authLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000,
  max: positiveLimit('AUTH_RATE_LIMIT_MAX', 40),
  message: 'Too many login/auth attempts. Please wait and try again.'
});

const writeLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000,
  max: positiveLimit('WRITE_RATE_LIMIT_MAX', 300),
  message: 'Too many save/update requests. Please slow down and try again.'
});

const readLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000,
  max: positiveLimit('READ_RATE_LIMIT_MAX', 1500),
  message: 'Too many dashboard requests. Please wait briefly and try again.'
});

const uploadLimiter = makeLimiter({
  windowMs: 60 * 60 * 1000,
  max: positiveLimit('UPLOAD_RATE_LIMIT_MAX', 60),
  message: 'Too many upload/import requests. Please wait and try again.'
});

const paymentLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000,
  max: positiveLimit('PAYMENT_RATE_LIMIT_MAX', 60),
  message: 'Too many payment attempts. Please wait before trying again.'
});

const paymentWebhookLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000,
  max: positiveLimit('PAYMENT_WEBHOOK_RATE_LIMIT_MAX', 1200),
  message: 'Payment notification rate limit exceeded.'
});

function routeAwareApiLimiter(req, res, next) {
  if (req.path.startsWith('/auth')) return authLimiter(req, res, next);
  if (req.path.startsWith('/upload')) return uploadLimiter(req, res, next);
  if (/^\/payments\/(webhook\/|mpesa\/(callback|validation|confirmation)|daraja\/callback|callback)/i.test(req.path)) return paymentWebhookLimiter(req, res, next);
  if (req.path.startsWith('/payments') && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return paymentLimiter(req, res, next);
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return writeLimiter(req, res, next);
  return readLimiter(req, res, next);
}

module.exports = { routeAwareApiLimiter, authLimiter, writeLimiter, readLimiter, uploadLimiter, paymentLimiter, paymentWebhookLimiter };
