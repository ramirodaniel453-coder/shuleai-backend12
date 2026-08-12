const crypto = require('crypto');

function rawBuffer(rawBody, payload) {
  if (Buffer.isBuffer(rawBody)) return rawBody;
  if (typeof rawBody === 'string') return Buffer.from(rawBody, 'utf8');
  if (rawBody && Buffer.isBuffer(rawBody.body)) return rawBody.body;
  return Buffer.from(JSON.stringify(payload || {}), 'utf8');
}

function header(headers = {}, name) {
  const wanted = String(name).toLowerCase();
  for (const [key, value] of Object.entries(headers || {})) {
    if (String(key).toLowerCase() === wanted) return Array.isArray(value) ? value[0] : value;
  }
  return '';
}

function safeCompare(a, b) {
  const left = Buffer.from(String(a || ''), 'utf8');
  const right = Buffer.from(String(b || ''), 'utf8');
  if (!left.length || !right.length || left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function hmacHex(algo, secret, body) {
  return crypto.createHmac(algo, String(secret)).update(body).digest('hex');
}

function safeToleranceSeconds(value, fallback = 300) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 30 ? Math.floor(number) : fallback;
}

function parseStripeSignature(sig = '') {
  const parts = {};
  String(sig || '').split(',').forEach(part => {
    const [k, v] = part.split('=');
    if (!k || !v) return;
    if (!parts[k]) parts[k] = [];
    parts[k].push(v);
  });
  return parts;
}

function verifyStripe({ rawBody, payload, headers, config }) {
  const secret = config.webhookSecret || process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return { verified: false, reason: 'missing_stripe_webhook_secret', method: 'stripe_signature' };
  const sig = header(headers, 'stripe-signature');
  if (!sig) return { verified: false, reason: 'missing_stripe_signature', method: 'stripe_signature' };
  const parts = parseStripeSignature(sig);
  const timestamp = parts.t?.[0];
  const signatures = parts.v1 || [];
  if (!timestamp || !signatures.length) return { verified: false, reason: 'malformed_stripe_signature', method: 'stripe_signature' };
  const toleranceSeconds = safeToleranceSeconds(config.webhookToleranceSeconds || process.env.STRIPE_WEBHOOK_TOLERANCE_SECONDS, 300);
  const ageSeconds = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(ageSeconds) || ageSeconds > toleranceSeconds) return { verified: false, reason: 'stale_stripe_signature', method: 'stripe_signature' };
  const body = rawBuffer(rawBody, payload);
  const expected = hmacHex('sha256', secret, Buffer.concat([Buffer.from(`${timestamp}.`, 'utf8'), body]));
  const ok = signatures.some(v => safeCompare(v, expected));
  return ok ? { verified: true, method: 'stripe_signature' } : { verified: false, reason: 'invalid_stripe_signature', method: 'stripe_signature' };
}

function verifyPaystack({ rawBody, payload, headers, config }) {
  const secret = config.secretKey || process.env.PAYSTACK_SECRET_KEY;
  if (!secret) return { verified: false, reason: 'missing_paystack_secret_key', method: 'paystack_hmac_sha512' };
  const sig = header(headers, 'x-paystack-signature');
  if (!sig) return { verified: false, reason: 'missing_paystack_signature', method: 'paystack_hmac_sha512' };
  const expected = hmacHex('sha512', secret, rawBuffer(rawBody, payload));
  return safeCompare(sig, expected) ? { verified: true, method: 'paystack_hmac_sha512' } : { verified: false, reason: 'invalid_paystack_signature', method: 'paystack_hmac_sha512' };
}

function verifyFlutterwave({ rawBody, payload, headers, config }) {
  const secretHash = config.webhookSecret || config.secretHash || config.encryptionKey || process.env.FLUTTERWAVE_SECRET_HASH || process.env.FLW_SECRET_HASH;
  const signatureSecret = config.webhookSecret || process.env.FLUTTERWAVE_WEBHOOK_SECRET || secretHash;
  const modernSig = header(headers, 'flutterwave-signature');
  if (modernSig && signatureSecret) {
    const expected = crypto.createHmac('sha256', String(signatureSecret)).update(rawBuffer(rawBody, payload)).digest('base64');
    if (safeCompare(modernSig, expected)) return { verified: true, method: 'flutterwave_hmac_sha256' };
    return { verified: false, reason: 'invalid_flutterwave_signature', method: 'flutterwave_hmac_sha256' };
  }
  const legacyHash = header(headers, 'verif-hash');
  if (!secretHash) return { verified: false, reason: 'missing_flutterwave_webhook_secret_hash', method: 'flutterwave_verif_hash' };
  if (!legacyHash) return { verified: false, reason: 'missing_flutterwave_signature_or_verif_hash', method: 'flutterwave_verif_hash' };
  return safeCompare(legacyHash, secretHash) ? { verified: true, method: 'flutterwave_verif_hash' } : { verified: false, reason: 'invalid_flutterwave_verif_hash', method: 'flutterwave_verif_hash' };
}

function normalizeIp(ip = '') {
  return String(ip || '').split(',')[0].trim().replace(/^::ffff:/, '');
}

function ipv4ToInt(ip) {
  const parts = normalizeIp(ip).split('.').map(Number);
  if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return (((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3]) >>> 0;
}

function ipMatchesRange(ip, range) {
  const normalizedRange = String(range || '').trim();
  if (!normalizedRange) return false;
  const ipInt = ipv4ToInt(ip);
  if (ipInt === null) return false;
  if (!normalizedRange.includes('/')) return normalizeIp(ip) === normalizedRange;
  const [base, bitsRaw] = normalizedRange.split('/');
  const baseInt = ipv4ToInt(base);
  const bits = Number(bitsRaw);
  if (baseInt === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

function sourceIp(headers = {}, explicitIp = '') {
  return normalizeIp(explicitIp || header(headers, 'x-forwarded-for') || header(headers, 'x-real-ip') || header(headers, 'cf-connecting-ip') || '');
}

function verifyMpesa({ headers, sourceIp: explicitIp, config }) {
  const ip = sourceIp(headers, explicitIp);
  const allowlist = String(config.callbackIpAllowlist || process.env.MPESA_CALLBACK_IP_ALLOWLIST || process.env.SAFARICOM_CALLBACK_IP_ALLOWLIST || '')
    .split(',')
    .map(v => v.trim())
    .filter(Boolean);
  const requireIp = process.env.NODE_ENV === 'production' && process.env.MPESA_SKIP_IP_ALLOWLIST !== 'true' && config.skipIpAllowlist !== true;
  if (!allowlist.length) {
    return requireIp
      ? { verified: false, reason: 'missing_mpesa_callback_ip_allowlist', method: 'mpesa_ip_allowlist', sourceIp: ip }
      : { verified: true, method: 'mpesa_ip_allowlist_dev_bypass', sourceIp: ip };
  }
  const ok = allowlist.some(range => ipMatchesRange(ip, range));
  return ok ? { verified: true, method: 'mpesa_ip_allowlist', sourceIp: ip } : { verified: false, reason: 'mpesa_source_ip_not_allowed', method: 'mpesa_ip_allowlist', sourceIp: ip };
}

function verifyPesapal() {
  // Pesapal IPNs are only notifications in this codebase. The engine must query
  // Pesapal's API with stored credentials before it can mark any payment paid.
  return { verified: true, method: 'pesapal_status_query_required' };
}

function sanitizeHeaders(headers = {}) {
  const safe = {};
  for (const [k, v] of Object.entries(headers || {})) {
    const key = String(k).toLowerCase();
    if (/authorization|cookie|secret|token/i.test(key)) continue;
    safe[key] = Array.isArray(v) ? v.join(',') : String(v || '').slice(0, 500);
  }
  return safe;
}

function verifyWebhook({ provider, rawBody, payload, headers = {}, config = {}, sourceIp: ip }) {
  switch (provider) {
    case 'stripe': return verifyStripe({ rawBody, payload, headers, config });
    case 'paystack': return verifyPaystack({ rawBody, payload, headers, config });
    case 'flutterwave': return verifyFlutterwave({ rawBody, payload, headers, config });
    case 'mpesa': return verifyMpesa({ headers, sourceIp: ip, config });
    case 'pesapal': return verifyPesapal({ headers, sourceIp: ip, config });
    default: return { verified: false, reason: `unsupported_webhook_provider_${provider}`, method: 'unsupported' };
  }
}

module.exports = { verifyWebhook, sanitizeHeaders, sourceIp, rawBuffer, safeCompare };
