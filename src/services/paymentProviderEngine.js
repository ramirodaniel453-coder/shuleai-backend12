const https = require('https');
const crypto = require('crypto');
const { Op } = require('sequelize');
const { sequelize, Payment, PaymentEvent, Fee, Student, Parent, User, School, SchoolPaymentSetting, PlatformPaymentSetting, SubscriptionPayment, Subscription, SubscriptionPlan } = require('../models');
const financeLedger = require('./financeLedgerService');
const subscriptionController = require('../controllers/subscriptionController');
const daraja = require('./darajaService');
const vault = require('./paymentVaultService');
const realtimeSync = require('./realtimeSyncService');
const financialSystem = require('./financialSystemService');
const webhookVerifier = require('./webhookVerificationService');
const { transactionId } = require('../utils/businessIds');

const PROVIDERS = ['manual','bank','cash','card','mpesa','paystack','flutterwave','pesapal','stripe'];
const PAYMENT_METHODS = ['mobile_money','card','bank','cash','manual'];
// Use the existing DB/ledger value for student fee payments. Incoming 'school_fee' is normalized to this value.
const SCHOOL_FEE = 'fee';
const PLATFORM = 'platform';
const FINAL_PAID = ['paid','completed','success','successful','approved'];
const FINAL_FAILED = ['failed','cancelled','canceled','expired','abandoned','reversed'];
const SECRET_FIELDS = ['secretKey','secret_key','apiKey','api_key','privateKey','private_key','consumerKey','consumer_key','consumerSecret','consumer_secret','passkey','pass_key','clientSecret','client_secret','webhookSecret','webhook_secret','secretHash','secret_hash','encryptionKey','encryption_key','accessToken','access_token'];
const PARENT_STK_PAYMENT_MODE = 'active_provider_managed';
const NON_STK_PARENT_PROVIDERS = new Set(['stripe','manual','bank','cash','card']);
const HOSTED_CHECKOUT_PROVIDERS = new Set(['stripe','pesapal']);

function positiveIntegerEnv(name, fallback, minimum = 1) {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value >= minimum ? value : fallback;
}

const PROVIDER_HTTP_TIMEOUT_MS = positiveIntegerEnv('PAYMENT_PROVIDER_TIMEOUT_MS', 15000, 3000);
const PROVIDER_MAX_RESPONSE_BYTES = positiveIntegerEnv('PAYMENT_PROVIDER_MAX_RESPONSE_BYTES', 2 * 1024 * 1024, 65536);
const PAYMENT_MAX_AMOUNT = positiveIntegerEnv('PAYMENT_MAX_AMOUNT', 100000000, 1);

function cleanAmount(v) {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < 1) throw new Error('Payment amount must be a whole number of at least 1');
  if (n > PAYMENT_MAX_AMOUNT) throw new Error(`Payment amount exceeds the allowed maximum of ${PAYMENT_MAX_AMOUNT}`);
  return n;
}

function normalizeProvider(v, options = {}) {
  const allowEmpty = options.allowEmpty === true;
  let p = String(v || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!p) {
    if (allowEmpty) return '';
    throw new Error('Payment provider is required');
  }
  if (['mpesa','m_pesa','mpesa_stk','stk','safaricom','safaricom_daraja','daraja'].includes(p)) p = 'mpesa';
  if (['manual_mpesa','manual_m_pesa','mpesa_manual','manual_verification'].includes(p)) p = 'manual';
  if (['bank_transfer','bank_deposit'].includes(p)) p = 'bank';
  if (['card_pos','pos'].includes(p)) p = 'card';
  if (!PROVIDERS.includes(p)) throw new Error(`Unsupported payment provider: ${v}`);
  return p;
}

function normalizeProviderIfPossible(v) {
  try { return normalizeProvider(v, { allowEmpty: true }); } catch (_) { return ''; }
}

function normalizePaymentMethod(v, fallback = '') {
  let m = String(v || fallback || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!m) return '';
  if (['mpesa','m_pesa','mpesa_stk','stk','daraja','mobile','mobile_money','mobile_money_stk'].includes(m)) return 'mobile_money';
  if (['visa','mastercard','card_payment','cards','card_pos','pos','stripe'].includes(m)) return 'card';
  if (['bank_transfer','bank_deposit','paybill_bank'].includes(m)) return 'bank';
  if (['cash_payment','office_cash'].includes(m)) return 'cash';
  if (['manual_mpesa','manual_verification','manual_payment','reference'].includes(m)) return 'manual';
  return PAYMENT_METHODS.includes(m) ? m : '';
}

function normalizePaymentType(v) {
  const t = String(v || '').trim().toLowerCase();
  if (['fee','school_fee','school-fee','fees'].includes(t)) return SCHOOL_FEE;
  if (['platform','subscription','name_change','sms_bundle','ai_package','child_subscription','school_subscription'].includes(t)) return PLATFORM;
  return t || SCHOOL_FEE;
}

function ref(prefix) {
  return transactionId(prefix);
}

function cleanManualReference(value) {
  const reference = String(value || '').trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9._/-]{4,99}$/.test(reference)) throw new Error('Enter a valid payment reference between 5 and 100 characters');
  return reference;
}

function appendAudit(entries, entry, max = 250) {
  const current = Array.isArray(entries) ? entries : [];
  return [...current.slice(-(max - 1)), entry];
}

function canonicalPublicApiBase() {
  const base = String(process.env.PUBLIC_API_BASE_URL || '').trim().replace(/\/$/, '');
  if (!base) {
    if (process.env.NODE_ENV === 'production') throw new Error('PUBLIC_API_BASE_URL is required for public payment callback/IPN URLs. Do not use the Render fallback domain.');
    return 'https://api.shuleai.live';
  }
  if (!/^https:\/\//i.test(base)) throw new Error('PUBLIC_API_BASE_URL must be a public HTTPS URL for payment callbacks.');
  if (/shuleaibackend-32h1\.onrender\.com/i.test(base)) throw new Error('PUBLIC_API_BASE_URL must use https://api.shuleai.live, not the old Render domain.');
  return base;
}

function publicUrl(path) {
  const safePath = String(path || '').startsWith('/') ? String(path || '') : '/' + String(path || '');
  if (/^\/api\/payments\//i.test(safePath)) return canonicalPublicApiBase() + safePath;
  const base = canonicalPublicApiBase();
  return base + safePath;
}

function providerWebsiteDomain() {
  try { return new URL(canonicalPublicApiBase()).hostname; } catch (_) { return 'api.shuleai.live'; }
}

function providerCallbackUrls(provider) {
  provider = normalizeProvider(provider);
  const webhook = providerNotificationUrl(provider);
  const out = { provider, websiteDomain: providerWebsiteDomain(), notificationUrl: webhook, webhookUrl: webhook, callbackUrl: webhook };
  if (provider === 'mpesa') {
    out.stkCallbackUrl = providerNotificationUrl('mpesa');
    out.validationUrl = providerValidationUrl('mpesa');
    out.confirmationUrl = providerConfirmationUrl('mpesa');
    out.notificationUrl = out.stkCallbackUrl;
    out.callbackUrl = out.stkCallbackUrl;
    out.webhookUrl = out.stkCallbackUrl;
  }
  return out;
}

function providerNotificationUrl(provider) {
  provider = normalizeProvider(provider);
  if (provider === 'mpesa') return publicUrl('/api/payments/mpesa/callback');
  return publicUrl(`/api/payments/webhook/${provider}`);
}

function providerValidationUrl(provider) {
  provider = normalizeProvider(provider);
  if (provider === 'mpesa') return publicUrl('/api/payments/mpesa/validation');
  return providerNotificationUrl(provider);
}

function providerConfirmationUrl(provider) {
  provider = normalizeProvider(provider);
  if (provider === 'mpesa') return publicUrl('/api/payments/mpesa/confirmation');
  return providerNotificationUrl(provider);
}

function providerConfigIdFor({ scope = 'school', schoolCode = 'platform', provider = 'manual' } = {}) {
  return `${scope}:${schoolCode || 'platform'}:${normalizeProvider(provider, { allowEmpty: true }) || 'manual'}`;
}

function pesapalEndpoint(config = {}) {
  const explicit = config.apiBaseUrl || config.baseUrl || config.endpoint || '';
  if (explicit) {
    try {
      const u = new URL(String(explicit));
      if (u.protocol !== 'https:' || !['pay.pesapal.com', 'cybqa.pesapal.com'].includes(u.hostname.toLowerCase())) {
        throw new Error('PesaPal API endpoint must use an official HTTPS PesaPal host');
      }
      return { hostname: u.hostname, pathBase: (u.pathname || '').replace(/\/$/, '') || (u.hostname.includes('cybqa') ? '/pesapalv3/api' : '/v3/api') };
    } catch (error) {
      if (error.message.includes('official HTTPS PesaPal host')) throw error;
      throw new Error('PesaPal API endpoint is invalid');
    }
  }
  const env = String(config.environment || config.mode || process.env.PESAPAL_ENV || '').toLowerCase();
  const sandbox = env.includes('sandbox') || env.includes('test') || env.includes('demo');
  return sandbox ? { hostname: 'cybqa.pesapal.com', pathBase: '/pesapalv3/api' } : { hostname: 'pay.pesapal.com', pathBase: '/v3/api' };
}

function pesapalNameParts(name = '') {
  const parts = String(name || 'ShuleAI payer').trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] || 'ShuleAI', lastName: parts.slice(1).join(' ') || 'Payer' };
}


async function getPesapalToken(config = {}) {
  const consumerKey = config.consumerKey || config.consumer_key || process.env.PESAPAL_CONSUMER_KEY;
  const consumerSecret = config.consumerSecret || config.consumer_secret || process.env.PESAPAL_CONSUMER_SECRET;
  if (!consumerKey || !consumerSecret) throw new Error('Pesapal consumer key and consumer secret are required');
  const endpoint = pesapalEndpoint(config);
  const tokenData = await requestJson({ hostname: endpoint.hostname, path: endpoint.pathBase + '/Auth/RequestToken', headers: { Accept: 'application/json' }, body: { consumer_key: consumerKey, consumer_secret: consumerSecret } });
  const token = tokenData?.token || tokenData?.data?.token;
  if (!token) throw new Error(tokenData?.error?.message || tokenData?.message || 'Pesapal did not return an access token');
  return { token, endpoint, tokenData };
}

async function listPesapalIpns(config = {}) {
  const { token, endpoint } = await getPesapalToken(config);
  const data = await requestJson({ method: 'GET', hostname: endpoint.hostname, path: endpoint.pathBase + '/URLSetup/GetIpnList', headers: { Accept: 'application/json', Authorization: 'Bearer ' + token } });
  const list = Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : (Array.isArray(data?.ipn_list) ? data.ipn_list : []));
  return { list, gatewayResponse: data };
}

function ipnUrlFromRow(row = {}) {
  return row.url || row.ipn_url || row.notification_url || row.ipnUrl || row.notificationUrl || row.IPNURL || row.Url || row.URL || '';
}

function ipnIdFromRow(row = {}) {
  return row.ipn_id || row.notification_id || row.id || row.ipnId || row.notificationId || row.IPNID || row.NotificationId || '';
}

async function registerPesapalIpn(config = {}) {
  const { token, endpoint } = await getPesapalToken(config);
  const ipnUrl = config.ipnUrl || config.notificationUrl || config.webhookUrl || process.env.PESAPAL_IPN_URL || providerNotificationUrl('pesapal');
  if (!ipnUrl || !/^https:\/\//i.test(String(ipnUrl))) throw new Error('Pesapal IPN URL must be a public HTTPS URL');

  // First check if the exact URL was already registered in this Pesapal account.
  try {
    const existing = await listPesapalIpns(config);
    const match = existing.list.find(row => String(ipnUrlFromRow(row)).replace(/\/$/, '') === String(ipnUrl).replace(/\/$/, ''));
    const existingId = match ? ipnIdFromRow(match) : '';
    if (existingId) return { notificationId: existingId, ipnUrl, alreadyRegistered: true, gatewayResponse: existing.gatewayResponse };
  } catch (_) {}

  const registerPayload = {
    url: ipnUrl,
    ipn_notification_type: config.ipnNotificationType || config.notificationType || 'GET'
  };
  const data = await requestJson({ hostname: endpoint.hostname, path: endpoint.pathBase + '/URLSetup/RegisterIPN', headers: { Accept: 'application/json', Authorization: 'Bearer ' + token }, body: registerPayload });
  const notificationId = data?.ipn_id || data?.notification_id || data?.id || data?.data?.ipn_id || data?.data?.notification_id;
  if (!notificationId) throw new Error(data?.error?.message || data?.message || 'Pesapal registered/replied but did not return an IPN ID');
  return { notificationId, ipnUrl, alreadyRegistered: false, gatewayResponse: data };
}

async function createPesapalCheckout({ payment, phone, email, name, config, internalOnly = false }) {
  const consumerKey = config.consumerKey || config.consumer_key || process.env.PESAPAL_CONSUMER_KEY;
  const consumerSecret = config.consumerSecret || config.consumer_secret || process.env.PESAPAL_CONSUMER_SECRET;
  const notificationId = config.ipnId || config.notificationId || config.notification_id || process.env.PESAPAL_IPN_ID;
  if (!consumerKey || !consumerSecret) throw new Error('Pesapal consumer key and consumer secret are required');
  let finalNotificationId = notificationId;
  let endpoint, token;
  if (!finalNotificationId) {
    const registered = await registerPesapalIpn(config);
    finalNotificationId = registered.notificationId;
    config.ipnId = finalNotificationId;
  }
  ({ token, endpoint } = await getPesapalToken(config));
  const payer = pesapalNameParts(name);
  const callbackUrl = config.callbackUrl || config.returnUrl || publicUrl('/payment-return.html');
  const order = {
    id: payment.reference,
    currency: payment.currency || 'KES',
    amount: cleanAmount(payment.amount),
    description: payment.paymentType === SCHOOL_FEE ? 'School fees' : 'ShuleAI platform payment',
    callback_url: callbackUrl,
    notification_id: finalNotificationId,
    billing_address: {
      email_address: email || config.fallbackEmail || 'payments@shuleai.local',
      phone_number: phone || config.fallbackPhone || '',
      country_code: config.countryCode || 'KE',
      first_name: payer.firstName,
      last_name: payer.lastName
    }
  };
  const checkout = await requestJson({ hostname: endpoint.hostname, path: endpoint.pathBase + '/Transactions/SubmitOrderRequest', headers: { Accept: 'application/json', Authorization: 'Bearer ' + token }, body: order });
  const checkoutUrl = checkout?.redirect_url || checkout?.redirectUrl || checkout?.data?.redirect_url;
  const providerReference = checkout?.order_tracking_id || checkout?.OrderTrackingId || checkout?.data?.order_tracking_id || payment.reference;
  if (!checkoutUrl) throw new Error(checkout?.error?.message || checkout?.message || 'Pesapal did not return a checkout URL');
  return { status: 'prompt_sent', promptType: internalOnly ? 'provider_managed' : 'checkout_url', checkoutUrl: internalOnly ? null : checkoutUrl, providerReference, gatewayResponse: { ...checkout, checkoutUrlCreatedInternally: internalOnly ? true : false, internalCheckoutUrl: internalOnly ? checkoutUrl : undefined }, message: internalOnly ? 'PesaPal payment request created. Fees update after IPN/status confirmation.' : 'Open Pesapal checkout to complete payment.' };
}

async function queryPesapalTransactionStatus({ trackingId, merchantReference, config = {} }) {
  const lookup = trackingId || merchantReference;
  if (!lookup) throw new Error('Pesapal tracking ID or merchant reference is required for status check');
  const { token, endpoint } = await getPesapalToken(config);
  const path = endpoint.pathBase + '/Transactions/GetTransactionStatus?' + new URLSearchParams({ orderTrackingId: lookup }).toString();
  const data = await requestJson({ method: 'GET', hostname: endpoint.hostname, path, headers: { Accept: 'application/json', Authorization: 'Bearer ' + token } });
  const rawStatus = String(
    data?.payment_status_description ||
    data?.payment_status ||
    data?.status ||
    data?.status_code ||
    data?.data?.payment_status_description ||
    data?.data?.payment_status ||
    ''
  ).toLowerCase();
  let status = 'pending';
  if (['completed', 'complete', 'paid', 'success', 'successful', '1'].includes(rawStatus) || rawStatus.includes('completed')) status = 'paid';
  if (['failed', 'invalid', 'reversed', 'cancelled', 'canceled', 'expired', '2', '3'].includes(rawStatus) || rawStatus.includes('failed') || rawStatus.includes('cancel')) status = 'failed';
  return {
    status,
    providerReference: data?.order_tracking_id || data?.OrderTrackingId || trackingId,
    merchantReference: data?.merchant_reference || data?.order_merchant_reference || merchantReference,
    amount: data?.amount || data?.data?.amount,
    currency: data?.currency || data?.data?.currency || 'KES',
    receiptNumber: data?.confirmation_code || data?.payment_account || data?.data?.confirmation_code,
    gatewayResponse: data
  };
}

function requestJson({ method = 'POST', hostname, path, headers = {}, body = {} }) {
  return new Promise((resolve, reject) => {
    const hasBody = method !== 'GET' && method !== 'HEAD';
    const payload = hasBody ? JSON.stringify(body || {}) : '';
    const requestHeaders = hasBody ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), ...headers } : { ...headers };
    const req = https.request({ method, hostname, path, headers: requestHeaders, timeout: PROVIDER_HTTP_TIMEOUT_MS }, res => {
      let raw = '';
      let received = 0;
      res.on('data', chunk => {
        received += chunk.length;
        if (received > PROVIDER_MAX_RESPONSE_BYTES) return req.destroy(new Error('Payment provider response exceeded the safe size limit'));
        raw += chunk;
      });
      res.on('end', () => {
        let data = raw;
        try { data = raw ? JSON.parse(raw) : {}; } catch (_) {}
        if (res.statusCode >= 400) return reject(new Error(typeof data === 'object' ? (data.message || data.error || JSON.stringify(data)) : raw));
        resolve(data);
      });
    });
    req.on('timeout', () => req.destroy(new Error('Payment provider request timed out')));
    req.on('error', reject);
    if (hasBody) req.write(payload);
    req.end();
  });
}

function requestFormUrlEncoded({ method = 'POST', hostname, path, headers = {}, body = new URLSearchParams() }) {
  return new Promise((resolve, reject) => {
    const payload = body instanceof URLSearchParams ? body.toString() : String(body || '');
    const req = https.request({ method, hostname, path, timeout: PROVIDER_HTTP_TIMEOUT_MS, headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(payload), ...headers } }, res => {
      let raw = '';
      let received = 0;
      res.on('data', chunk => {
        received += chunk.length;
        if (received > PROVIDER_MAX_RESPONSE_BYTES) return req.destroy(new Error('Payment provider response exceeded the safe size limit'));
        raw += chunk;
      });
      res.on('end', () => {
        let data = {};
        try { data = raw ? JSON.parse(raw) : {}; } catch (_) { data = { raw }; }
        if (res.statusCode >= 400) return reject(new Error(data?.error?.message || data?.message || raw));
        resolve(data);
      });
    });
    req.on('timeout', () => req.destroy(new Error('Payment provider request timed out')));
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function decryptProvider(provider = {}) {
  const out = { ...provider };
  Object.keys(out).forEach(k => {
    if (/secret|key|pass|token/i.test(k) && typeof out[k] === 'string') out[k] = vault.decrypt(out[k]);
  });
  return out;
}

async function getSchoolRow(schoolCode, options = {}) {
  if (!schoolCode) throw new Error('School code is required');
  const transaction = options.transaction;
  let row = await SchoolPaymentSetting.findOne({ where: { schoolCode }, transaction, lock: options.lock && transaction ? transaction.LOCK.UPDATE : undefined }).catch(() => null);
  if (!row) {
    try {
      row = await SchoolPaymentSetting.create({ schoolCode, paymentMode: 'manual', metadata: { paymentProviders: {}, providerLock: 'one_active_provider' }, enabledProviders: [] }, { transaction });
    } catch (error) {
      if (error?.name !== 'SequelizeUniqueConstraintError') throw error;
      row = await SchoolPaymentSetting.findOne({ where: { schoolCode }, transaction, lock: options.lock && transaction ? transaction.LOCK.UPDATE : undefined });
    }
  }
  return row;
}

async function getPlatformRow(options = {}) {
  const transaction = options.transaction;
  let row = await PlatformPaymentSetting.findOne({ order: [['id', 'ASC']], transaction, lock: options.lock && transaction ? transaction.LOCK.UPDATE : undefined }).catch(() => null);
  if (!row) {
    try {
      row = await PlatformPaymentSetting.create({ businessName: 'Shule AI', paymentMode: 'manual', metadata: { paymentProviders: {}, providerLock: 'one_active_provider' }, enabledProviders: [] }, { transaction });
    } catch (error) {
      if (error?.name !== 'SequelizeUniqueConstraintError') throw error;
      row = await PlatformPaymentSetting.findOne({ order: [['id', 'ASC']], transaction, lock: options.lock && transaction ? transaction.LOCK.UPDATE : undefined });
    }
  }
  return row;
}

function providerMap(row) {
  const map = row?.metadata?.paymentProviders && typeof row.metadata.paymentProviders === 'object' ? { ...row.metadata.paymentProviders } : {};
  if (!row) return map;
  const legacyMpesaConfigured = row.darajaEnabled === true || ['daraja','mpesa','stk'].includes(String(row.paymentMode || '').toLowerCase()) || row.darajaConsumerKey || row.darajaShortcode || row.businessShortCode;
  if (!map.mpesa && legacyMpesaConfigured) map.mpesa = {
    provider: 'mpesa', enabled: row.isActive !== false,
    consumerKey: row.darajaConsumerKey, consumerSecret: row.darajaConsumerSecret,
    passkey: row.darajaPasskey, shortcode: row.darajaShortcode || row.businessShortCode,
    businessShortcode: row.businessShortCode || row.darajaShortcode,
    environment: row.darajaEnvironment, callbackUrl: row.callbackUrl,
    connectionVerifiedAt: row.metadata?.connectionVerifiedAt || row.metadata?.lastVerifiedAt,
    lastVerifiedAt: row.metadata?.lastVerifiedAt,
    supportsStkPush: row.metadata?.supportsStkPush === true,
    lastStkTestStatus: row.metadata?.lastStkTestStatus,
    notificationStatus: row.metadata?.notificationStatus || (row.callbackUrl ? 'callback_attached_per_payment' : '')
  };
  if (!map.bank && String(row.paymentMode || '').toLowerCase() === 'bank') map.bank = { provider:'bank', enabled:row.isActive !== false, bankName:row.bankName, accountName:row.bankAccountName, accountNumber:row.bankAccountNumber, branch:row.bankBranch };
  if (!map.manual && String(row.paymentMode || '').toLowerCase() === 'manual') map.manual = { provider:'manual', enabled:row.isActive !== false, paybillNumber:row.paybillNumber, tillNumber:row.tillNumber, shortcode:row.businessShortCode, accountNumber:row.accountNumber };
  return map;
}

function providerConfigFromMap(map = {}, provider = '') {
  return map[provider] || (provider === 'mpesa' ? map.daraja : null) || (provider === 'daraja' ? map.mpesa : null) || {};
}

function rawEnabledProviders(row) {
  const fromColumn = Array.isArray(row?.enabledProviders) ? row.enabledProviders : [];
  const fromMeta = Array.isArray(row?.metadata?.enabledProviders) ? row.metadata.enabledProviders : [];
  const mapEnabled = Object.entries(providerMap(row)).filter(([, cfg]) => cfg?.enabled === true).map(([p]) => p);
  return [...new Set([...fromColumn, ...fromMeta, ...mapEnabled].filter(Boolean).map(v => normalizeProviderIfPossible(v)).filter(Boolean))];
}

function activeProviderFromRow(row) {
  if (!row || row.isActive === false) return '';
  const direct = normalizeProviderIfPossible(row?.defaultProvider || row?.metadata?.defaultProvider || row?.metadata?.activeProvider);
  if (direct) return direct;
  const enabled = rawEnabledProviders(row);
  if (enabled[0]) return enabled[0];
  const legacyMode = String(row.paymentMode || '').toLowerCase();
  if (row.darajaEnabled === true || ['daraja','mpesa','stk'].includes(legacyMode)) return 'mpesa';
  if (legacyMode === 'bank') return 'bank';
  if (legacyMode === 'manual') return 'manual';
  return '';
}

function providerDefaultMethods(provider) {
  if (provider === 'mpesa') return ['mobile_money'];
  if (provider === 'stripe') return ['card'];
  if (provider === 'pesapal') return ['card'];
  if (provider === 'paystack' || provider === 'flutterwave') return ['mobile_money', 'card'];
  if (provider === 'bank') return ['bank'];
  if (provider === 'cash') return ['cash'];
  if (provider === 'card') return ['card'];
  if (provider === 'manual') return ['manual'];
  return ['manual'];
}

function sanitizeMethods(methods, provider) {
  const list = Array.isArray(methods) ? methods : (typeof methods === 'string' ? methods.split(',') : []);
  const normalized = list.map(v => normalizePaymentMethod(v)).filter(Boolean);
  const source = normalized.length ? normalized : providerDefaultMethods(provider);
  return [...new Set(source)].filter(m => PAYMENT_METHODS.includes(m));
}

function providerSupportsMethod(provider, method, config = {}) {
  if (!method) return true;
  return providerDefaultMethods(provider).includes(method);
}


function hasAny(config = {}, fields = []) {
  return fields.some(field => config[field] || config[field.replace(/[A-Z]/g, m => '_' + m.toLowerCase())]);
}

function hasUsableCredential(config = {}, fields = []) {
  return fields.some(field => {
    const value = config[field] || config[field.replace(/[A-Z]/g, m => '_' + m.toLowerCase())];
    if (!value) return false;
    return !String(value).startsWith('vault:v1:') || !!vault.decrypt(value, { silent: true });
  });
}

function providerReadiness(provider, config = {}, active = '') {
  const enabled = provider === active && config?.enabled !== false;
  const notificationStatus = config.notificationStatus || config.status || '';
  if (!enabled) return { status: 'disabled', ready: false, visibleToParent: false, notificationStatus, message: 'Provider is not active for this scope.' };
  if (['manual','bank','cash','card'].includes(provider)) return { status: 'ready', ready: true, visibleToParent: true, notificationStatus: 'not_required', message: `${providerLabel(provider)} is ready for finance verification.` };
  if (notificationStatus === 'error') return { status: 'error', ready: false, visibleToParent: false, notificationStatus, message: config.lastError || `${providerLabel(provider)} notification setup has an error.` };
  if (provider === 'mpesa') {
    const missing = [];
    if (!hasUsableCredential(config, ['consumerKey'])) missing.push('consumerKey');
    if (!hasUsableCredential(config, ['consumerSecret'])) missing.push('consumerSecret');
    if (!hasAny(config, ['shortcode','businessShortCode'])) missing.push('shortcode');
    if (!hasUsableCredential(config, ['passkey'])) missing.push('passkey');
    if (missing.length) return { status: 'needs_credentials', ready: false, visibleToParent: false, notificationStatus, message: `Missing M-Pesa ${missing.join(', ')}.` };
    if (process.env.NODE_ENV === 'production' && !config.callbackIpAllowlist && !process.env.MPESA_CALLBACK_IP_ALLOWLIST && !process.env.SAFARICOM_CALLBACK_IP_ALLOWLIST) {
      return { status: 'needs_callback_allowlist', ready: false, visibleToParent: false, notificationStatus, message: 'Configure the Safaricom callback IP allowlist before accepting parent payments.' };
    }
    if (!config.connectionVerifiedAt && !config.lastVerifiedAt) return { status: 'needs_connection_test', ready: false, visibleToParent: false, notificationStatus, message: 'Run the M-Pesa connection/setup test before accepting parent payments.' };
    return { status: 'ready', ready: true, visibleToParent: true, notificationStatus: notificationStatus || 'callback_attached_per_payment', message: 'M-Pesa credentials were verified. STK callback is attached to each payment request.' };
  }
  if (provider === 'pesapal') {
    const missing = [];
    if (!hasUsableCredential(config, ['consumerKey'])) missing.push('consumerKey');
    if (!hasUsableCredential(config, ['consumerSecret'])) missing.push('consumerSecret');
    if (!hasAny(config, ['ipnId','notificationId'])) missing.push('ipnId/notificationId');
    if (missing.length) return { status: 'needs_credentials', ready: false, visibleToParent: false, notificationStatus, message: `Missing PesaPal ${missing.join(', ')}.` };
    if (!config.connectionVerifiedAt && !config.lastVerifiedAt) return { status: 'needs_connection_test', ready: false, visibleToParent: false, notificationStatus, message: 'Run the PesaPal connection/setup test before accepting parent payments.' };
    if (!['registered','registered_automatically','verified'].includes(String(notificationStatus).toLowerCase())) return { status: 'needs_dashboard_setup', ready: false, visibleToParent: false, notificationStatus, message: 'Run PesaPal IPN setup before accepting parent payments.' };
    return { status: 'ready', ready: true, visibleToParent: true, notificationStatus: notificationStatus || 'registered', message: 'PesaPal credentials and IPN notification ID were verified.' };
  }
  if (provider === 'paystack') {
    if (!hasUsableCredential(config, ['secretKey'])) return { status: 'needs_credentials', ready: false, visibleToParent: false, notificationStatus, message: 'Missing or unreadable Paystack secret key.' };
    if (!config.connectionVerifiedAt && !config.lastVerifiedAt) return { status: 'needs_connection_test', ready: false, visibleToParent: false, notificationStatus, message: 'Run the Paystack connection/setup test before accepting parent payments.' };
    const needsDashboard = String(notificationStatus).toLowerCase() !== 'verified' || !config.webhookVerifiedAt;
    return { status: needsDashboard ? 'needs_dashboard_setup' : 'ready', ready: !needsDashboard, visibleToParent: !needsDashboard, notificationStatus: notificationStatus || 'dashboard_setup_required', message: needsDashboard ? 'Paste the webhook URL in Paystack, then run a test webhook.' : 'Paystack credentials are present and notification setup is verified/accepted.' };
  }
  if (provider === 'flutterwave') {
    if (!hasUsableCredential(config, ['secretKey'])) return { status: 'needs_credentials', ready: false, visibleToParent: false, notificationStatus, message: 'Missing or unreadable Flutterwave secret key.' };
    const hasSecretHash = hasUsableCredential(config, ['webhookSecret','secretHash','encryptionKey']);
    const needsDashboard = String(notificationStatus).toLowerCase() !== 'verified' || !config.webhookVerifiedAt;
    if (!hasSecretHash) return { status: 'needs_credentials', ready: false, visibleToParent: false, notificationStatus, message: 'Missing Flutterwave webhook secret/hash.' };
    if (!config.connectionVerifiedAt && !config.lastVerifiedAt) return { status: 'needs_connection_test', ready: false, visibleToParent: false, notificationStatus, message: 'Run the Flutterwave connection/setup test before accepting parent payments.' };
    return { status: needsDashboard ? 'needs_dashboard_setup' : 'ready', ready: !needsDashboard, visibleToParent: !needsDashboard, notificationStatus: notificationStatus || 'dashboard_setup_required', message: needsDashboard ? 'Paste the webhook URL and secret/hash in Flutterwave, then run a test webhook.' : 'Flutterwave credentials and webhook hash are present.' };
  }
  if (provider === 'stripe') {
    if (!hasUsableCredential(config, ['secretKey'])) return { status: 'needs_credentials', ready: false, visibleToParent: false, notificationStatus, message: 'Missing or unreadable Stripe secret key.' };
    if (!hasUsableCredential(config, ['webhookSecret'])) return { status: 'needs_dashboard_setup', ready: false, visibleToParent: false, notificationStatus, message: 'Missing or unreadable Stripe webhook signing secret.' };
    if (!config.connectionVerifiedAt && !config.lastVerifiedAt) return { status: 'needs_connection_test', ready: false, visibleToParent: false, notificationStatus, message: 'Run the Stripe connection/setup test before accepting parent payments.' };
    if (!['registered','registered_automatically','verified'].includes(String(notificationStatus).toLowerCase())) return { status: 'needs_dashboard_setup', ready: false, visibleToParent: false, notificationStatus, message: 'Run Stripe webhook setup before accepting parent payments.' };
    return { status: 'ready', ready: true, visibleToParent: true, notificationStatus: notificationStatus || 'registered', message: 'Stripe credentials and webhook signing secret are present.' };
  }
  return { status: enabled ? 'ready' : 'disabled', ready: enabled, visibleToParent: enabled, notificationStatus, message: enabled ? `${providerLabel(provider)} is ready.` : `${providerLabel(provider)} is disabled.` };
}

function publicProviders(row) {
  const active = activeProviderFromRow(row);
  const map = providerMap(row);
  const providers = [...new Set([...PROVIDERS, ...Object.keys(map).map(k => normalizeProviderIfPossible(k) || k)])];
  return Object.fromEntries(providers.map((provider) => {
    const cfg = providerConfigFromMap(map, provider) || {};
    const readiness = providerReadiness(provider, cfg, active);
    const urls = providerCallbackUrls(provider);
    const stkReady = parentReadyForStk(provider, cfg, active);
    return [provider, {
      ...vault.publicProvider(cfg),
      provider,
      enabled: provider === active,
      readiness: readiness.status,
      ready: readiness.ready,
      supportsStkPush: stkReady.supportsStkPush,
      supportsHostedCheckout: stkReady.supportsHostedCheckout,
      parentReady: stkReady.parentReady,
      visibleToParent: stkReady.visibleToParent,
      notificationStatus: readiness.notificationStatus,
      statusMessage: stkReady.message,
      websiteDomain: urls.websiteDomain,
      notificationUrl: cfg.notificationUrl || cfg.webhookUrl || cfg.callbackUrl || urls.notificationUrl,
      webhookUrl: cfg.webhookUrl || urls.webhookUrl,
      callbackUrl: cfg.callbackUrl || urls.callbackUrl,
      stkCallbackUrl: cfg.stkCallbackUrl || urls.stkCallbackUrl || urls.callbackUrl,
      validationUrl: cfg.validationUrl || urls.validationUrl || null,
      confirmationUrl: cfg.confirmationUrl || urls.confirmationUrl || null,
      testLink: cfg.testLink || null,
      lastStkTestStatus: cfg.lastStkTestStatus || null,
      lastStkTestAt: cfg.lastStkTestAt || null,
      parentAvailability: stkReady.parentReady ? 'visible' : 'hidden_until_stk_ready',
      lastVerifiedAt: cfg.lastVerifiedAt || cfg.webhookVerifiedAt || null,
      lastError: cfg.lastError || null
    }];
  }));
}

function providerLabel(p) {
  return ({ manual:'Manual verification', bank:'Bank transfer', cash:'Cash office payment', card:'Card/POS', mpesa:'M-Pesa', paystack:'Paystack', flutterwave:'Flutterwave', pesapal:'PesaPal', stripe:'Stripe' })[p] || p;
}

function methodLabel(m) {
  return ({ mobile_money:'Mobile Money', card:'Card Payments', bank:'Bank Transfer', cash:'Cash at Office', manual:'Manual Reference' })[m] || m;
}

function providerPromptType(p) {
  if (HOSTED_CHECKOUT_PROVIDERS.has(p)) return 'hosted_checkout';
  return ['paystack','flutterwave','mpesa'].includes(p) ? 'phone_prompt' : 'manual_instructions';
}

function isParentSchoolFeeFlow(payment = {}) {
  return payment.paymentType === SCHOOL_FEE && (payment.metadata?.parentInternalPaymentFlow === true || payment.source === 'parent');
}

function safeParentPromptMessage(provider, fallback = '') {
  const label = providerLabel(provider);
  if (provider === 'mpesa') return fallback || 'STK Push sent. Check your phone and enter your M-Pesa PIN.';
  if (provider === 'manual' || provider === 'bank' || provider === 'cash') return fallback || 'Payment reference submitted for school finance verification.';
  if (provider === 'stripe') return fallback || 'Secure provider payment request created. Fees update only after provider confirmation.';
  return fallback || `${label} payment request created securely. Fees update only after provider confirmation.`;
}

function parentManagedPrompt({ provider, providerReference, gatewayResponse, checkoutUrl = null, message, providerAction = 'provider_managed_payment' }) {
  const hosted = HOSTED_CHECKOUT_PROVIDERS.has(provider);
  return {
    status: 'prompt_sent',
    promptType: hosted ? 'hosted_checkout' : 'phone_prompt',
    checkoutUrl: hosted ? checkoutUrl : null,
    providerReference,
    gatewayResponse: { ...(gatewayResponse || {}), parentFlow: 'internal_no_checkout_url', providerAction },
    message: safeParentPromptMessage(provider, message)
  };
}

function supportsStkPush(provider, config = {}) {
  provider = normalizeProvider(provider, { allowEmpty: true });
  if (provider === 'mpesa') return config.supportsStkPush === true && String(config.lastStkTestStatus || '').toLowerCase() === 'success';
  if (NON_STK_PARENT_PROVIDERS.has(provider)) return false;
  if (provider === 'flutterwave' || provider === 'paystack' || provider === 'pesapal') {
    return config.supportsStkPush === true && String(config.lastStkTestStatus || '').toLowerCase() === 'success' && ['verified','registered_automatically','callback_attached_per_payment'].includes(String(config.notificationStatus || '').toLowerCase());
  }
  return false;
}

function parentReadyForStk(provider, config = {}, active = '') {
  const readiness = providerReadiness(provider, config, active);
  const stk = supportsStkPush(provider, config);
  const hosted = HOSTED_CHECKOUT_PROVIDERS.has(provider);
  const manual = ['manual','bank','cash','card'].includes(provider);
  return {
    ...readiness,
    supportsStkPush: stk,
    supportsHostedCheckout: hosted,
    parentReady: readiness.ready && (stk || hosted || manual),
    visibleToParent: readiness.ready && (stk || hosted || manual),
    message: readiness.ready && !stk && !hosted && !manual ? `${providerLabel(provider)} is configured but is not verified for parent phone prompts.` : readiness.message
  };
}

function paymentModeForProvider(provider) {
  if (provider === 'mpesa') return 'daraja';
  if (provider === 'bank') return 'bank';
  return 'manual';
}

function serializeSettings(row) {
  const active = activeProviderFromRow(row);
  const map = providerMap(row);
  const activeCfg = active ? providerConfigFromMap(map, active) : {};
  const methods = active ? sanitizeMethods(activeCfg.methods, active).map(method => ({
    method,
    provider: active,
    label: methodLabel(method),
    providerLabel: providerLabel(active),
    prompt: providerPromptType(active),
    description: `${methodLabel(method)} through ${providerLabel(active)}`
  })) : [];
  return {
    id: row.id,
    schoolCode: row.schoolCode || null,
    activeProvider: active || null,
    defaultProvider: active || null,
    enabledProviders: active ? [active] : [],
    disabledProviders: PROVIDERS.filter(p => p !== active),
    paymentMode: row.paymentMode,
    providerSelectionRule: 'one_active_provider_per_scope',
    providers: publicProviders(row),
    providerStatuses: Object.values(publicProviders(row)).map(p => ({ provider:p.provider, label:providerLabel(p.provider), status:p.readiness, ready:p.ready, enabled:p.enabled, message:p.statusMessage, visibleToParent:p.visibleToParent })),
    readyProviders: Object.values(publicProviders(row)).filter(p => p.ready && p.enabled).map(p => p.provider),
    parentStkProviders: Object.values(publicProviders(row)).filter(p => p.parentReady && p.enabled).map(p => p.provider),
    parentPaymentMode: PARENT_STK_PAYMENT_MODE,
    publicMethods: methods.filter(m => (publicProviders(row)[m.provider] || {}).parentReady === true || m.method === 'manual'),
    methods,
    linkingRule: row.metadata?.linkingRule || row.accountReferenceFormat || 'elimuid',
    matchingRules: row.metadata?.matchingRules || { autoMatchElimuId: true, autoMatchInvoiceNumber: true, requireExactAmount: true },
    notifications: row.metadata?.notifications || { parentPaymentReceived: true, financeInvoicePaid: true, paymentFailed: true }
  };
}

function buildIncomingProvider({ provider, body, existingProvider = {}, user }) {
  const suppliedConfig = {
    ...(body.credentials || {}),
    ...(body.config?.credentials || {}),
    ...(body.config || {})
  };
  delete suppliedConfig.credentials;
  const incoming = {
    ...suppliedConfig,
    provider,
    enabled: body.enabled === true || body.isDefault === true || body.active === true,
    methods: sanitizeMethods(body.methods || body.config?.methods, provider),
    publicKey: body.publicKey || body.config?.publicKey || undefined,
    shortcode: body.shortcode || body.config?.shortcode || undefined,
    callbackUrl: providerCallbackUrls(provider).callbackUrl,
    notificationUrl: providerCallbackUrls(provider).notificationUrl,
    webhookUrl: providerCallbackUrls(provider).webhookUrl,
    websiteDomain: providerWebsiteDomain(),
    stkCallbackUrl: providerCallbackUrls(provider).stkCallbackUrl || undefined,
    validationUrl: providerCallbackUrls(provider).validationUrl || undefined,
    confirmationUrl: providerCallbackUrls(provider).confirmationUrl || undefined,
    updatedBy: user?.id || null,
    updatedAt: new Date().toISOString()
  };
  const merged = vault.mergeEncryptedCredentials(existingProvider || {}, incoming, SECRET_FIELDS);
  const suppliedSecrets = Object.entries(suppliedConfig).filter(([field, value]) => {
    const text = String(value ?? '');
    if (!text || text.includes('••••')) return false;
    return SECRET_FIELDS.includes(field) || (!/^(public|publishable)/i.test(field) && /secret|private.?key|pass(key|word)?|access.?token|api.?key|consumer.?key|credential/i.test(field));
  });
  if (suppliedSecrets.length && !['manual','bank','cash','card'].includes(provider)) {
    delete merged.connectionVerifiedAt;
    merged.lastConnectionTestStatus = 'not_tested';
    merged.supportsStkPush = false;
    merged.lastStkTestStatus = 'not_tested';
    merged.lastError = '';
    if (['paystack','flutterwave','stripe'].includes(provider)) {
      delete merged.webhookVerifiedAt;
      merged.notificationStatus = 'needs_dashboard_setup';
    }
    if (provider === 'pesapal') {
      const changedConsumerCredentials = suppliedSecrets.some(([field]) => /consumer.?key|consumer.?secret/i.test(field));
      const suppliedIpnId = suppliedConfig.ipnId || suppliedConfig.notificationId || suppliedConfig.notification_id;
      if (changedConsumerCredentials && !suppliedIpnId) {
        delete merged.ipnId;
        delete merged.notificationId;
        delete merged.notification_id;
      }
      merged.notificationStatus = 'not_configured';
    }
  }
  return merged;
}

function lockedProviderMap(existing, selectedProvider, selectedConfig, enabled) {
  const next = {};
  for (const provider of PROVIDERS) {
    const current = providerConfigFromMap(existing, provider);
    if (current) next[provider] = { ...current, provider, enabled: false };
  }
  next[selectedProvider] = { ...(next[selectedProvider] || {}), ...(selectedConfig || {}), provider: selectedProvider, enabled: enabled === true };
  if (selectedProvider === 'mpesa') delete next.daraja;
  if (selectedProvider === 'daraja') { next.mpesa = { ...(next.mpesa || {}), ...(next.daraja || {}), provider: 'mpesa', enabled: enabled === true }; delete next.daraja; }
  return next;
}

async function saveSchoolProviderSettings({ user, schoolCode, body }) {
  if (!schoolCode) throw new Error('School code is required');
  const provider = normalizeProvider(body.provider || body.defaultProvider || body.activeProvider || 'manual');
  const enabled = body.enabled === true || body.isDefault === true || body.active === true;
  const data = await sequelize.transaction(async transaction => {
    const row = await getSchoolRow(schoolCode, { transaction, lock: true });
    const existing = providerMap(row);
    const merged = buildIncomingProvider({ provider, body: { ...body, enabled }, existingProvider: providerConfigFromMap(existing, provider), user });
    const metadata = {
      ...(row.metadata || {}),
      providerLock: 'one_active_provider',
      activeProvider: enabled ? provider : null,
      defaultProvider: enabled ? provider : null,
      enabledProviders: enabled ? [provider] : [],
      paymentProviders: lockedProviderMap(existing, provider, merged, enabled),
      linkingRule: body.linkingRule || body.studentLinkRule || body.accountReferenceFormat || row.metadata?.linkingRule || row.accountReferenceFormat || 'elimuid',
      matchingRules: body.matchingRules || row.metadata?.matchingRules || { autoMatchElimuId: true, autoMatchInvoiceNumber: true, requireExactAmount: true },
      notifications: body.notifications || row.metadata?.notifications || { parentPaymentReceived: true, financeInvoicePaid: true, paymentFailed: true },
      auditTrail: appendAudit(row.metadata?.auditTrail, { action: enabled ? 'provider_activated_exclusive' : 'provider_disabled_exclusive', provider, actorUserId: user?.id || null, at: new Date().toISOString() })
    };
    await row.update({
      metadata,
      enabledProviders: enabled ? [provider] : [],
      defaultProvider: enabled ? provider : null,
      accountReferenceFormat: metadata.linkingRule,
      paymentMode: enabled ? paymentModeForProvider(provider) : 'manual'
    }, { transaction });
    return serializeSettings(await row.reload({ transaction }));
  });
  await financialSystem.auditProviderCredentials({ schoolCode, scope: 'school', provider, action: enabled ? 'provider_activated_exclusive' : 'provider_disabled_exclusive', actorUserId: user?.id || null, changedFields: Object.keys(body.config || body || {}).filter(k => !/secret|key|pass|token/i.test(k)), metadata: { finalLock: 'v200_2_one_active_provider', credentialsEncrypted: true, disabledOtherProviders: true } });
  return data;
}

async function savePlatformProviderSettings({ user, body }) {
  const provider = normalizeProvider(body.provider || body.defaultProvider || body.activeProvider || 'manual');
  const enabled = body.enabled === true || body.isDefault === true || body.active === true;
  const data = await sequelize.transaction(async transaction => {
    const row = await getPlatformRow({ transaction, lock: true });
    const existing = providerMap(row);
    const merged = buildIncomingProvider({ provider, body: { ...body, enabled }, existingProvider: providerConfigFromMap(existing, provider), user });
    const metadata = {
      ...(row.metadata || {}),
      providerLock: 'one_active_provider',
      activeProvider: enabled ? provider : null,
      defaultProvider: enabled ? provider : null,
      enabledProviders: enabled ? [provider] : [],
      paymentProviders: lockedProviderMap(existing, provider, merged, enabled),
      notifications: body.notifications || row.metadata?.notifications || { platformPaymentReceived: true, paymentFailed: true },
      auditTrail: appendAudit(row.metadata?.auditTrail, { action: enabled ? 'platform_provider_activated_exclusive' : 'platform_provider_disabled_exclusive', provider, actorUserId: user?.id || null, at: new Date().toISOString() })
    };
    await row.update({ metadata, enabledProviders: enabled ? [provider] : [], defaultProvider: enabled ? provider : null, paymentMode: enabled ? paymentModeForProvider(provider) : 'manual' }, { transaction });
    return serializeSettings(await row.reload({ transaction }));
  });
  await financialSystem.auditProviderCredentials({ schoolCode: 'platform', scope: 'platform', provider, action: enabled ? 'provider_activated_exclusive' : 'provider_disabled_exclusive', actorUserId: user?.id || null, changedFields: Object.keys(body.config || body || {}).filter(k => !/secret|key|pass|token/i.test(k)), metadata: { finalLock: 'v200_2_one_active_provider', credentialsEncrypted: true, disabledOtherProviders: true } });
  return data;
}

async function getSettings({ scope, schoolCode }) {
  return serializeSettings(scope === 'platform' ? await getPlatformRow() : await getSchoolRow(schoolCode));
}

async function rowForPaymentType(paymentType, schoolCode) {
  if (paymentType === PLATFORM) return getPlatformRow();
  return getSchoolRow(schoolCode);
}

async function resolvePaymentProvider({ paymentType, schoolCode, requestedProvider = '', method = '' }) {
  const row = await rowForPaymentType(paymentType, schoolCode);
  const active = activeProviderFromRow(row);
  if (!active) throw new Error(paymentType === PLATFORM ? 'No active platform payment provider has been configured by Super Admin.' : 'No active school payment provider has been configured by Finance Officer.');
  const requested = normalizeProviderIfPossible(requestedProvider);
  if (requested && requested !== active) throw new Error(`${providerLabel(requested)} is disabled for this ${paymentType === PLATFORM ? 'platform' : 'school'} payment. Active provider is ${providerLabel(active)}.`);
  const map = providerMap(row);
  const cfg = providerConfigFromMap(map, active) || {};
  if (cfg.enabled !== true && !rawEnabledProviders(row).includes(active)) throw new Error(`${providerLabel(active)} is configured but not enabled.`);
  const selectedMethod = normalizePaymentMethod(method) || providerDefaultMethods(active)[0] || '';
  if (selectedMethod && !providerSupportsMethod(active, selectedMethod, cfg)) throw new Error(`${methodLabel(selectedMethod)} is not enabled for ${providerLabel(active)}.`);
  return { row, provider: active, method: selectedMethod, linkingRule: row.metadata?.linkingRule || row.accountReferenceFormat || 'elimuid', providerConfigId: providerConfigIdFor({ scope: paymentType === PLATFORM ? 'platform' : 'school', schoolCode: row.schoolCode || schoolCode || 'platform', provider: active }) };
}

async function getProviderConfig({ paymentType, schoolCode, provider }) {
  const row = await rowForPaymentType(paymentType, schoolCode);
  const active = activeProviderFromRow(row);
  provider = normalizeProvider(provider || active);
  if (provider !== active) throw new Error(`${providerLabel(provider)} is disabled. Active provider is ${providerLabel(active)}.`);
  const map = providerMap(row);
  const cfg = decryptProvider(providerConfigFromMap(map, provider) || {});
  if (provider === 'mpesa') {
    return { ...cfg, consumerKey: cfg.consumerKey || row.darajaConsumerKey, consumerSecret: cfg.consumerSecret || row.darajaConsumerSecret, passkey: cfg.passkey || row.darajaPasskey, shortcode: cfg.shortcode || row.darajaShortcode, callbackUrl: cfg.callbackUrl || cfg.notificationUrl || row.callbackUrl || providerNotificationUrl('mpesa'), validationUrl: cfg.validationUrl || providerValidationUrl('mpesa'), confirmationUrl: cfg.confirmationUrl || providerConfirmationUrl('mpesa'), mode: cfg.environment || row.darajaEnvironment || process.env.DARAJA_ENV || 'sandbox' };
  }
  return cfg;
}

function manualMessageForMethod(method) {
  if (method === 'bank') return 'Bank payment instructions shown. Balance updates after finance verifies the bank reference.';
  if (method === 'cash') return 'Cash office payment instructions shown. Balance updates after finance verifies the receipt.';
  if (method === 'card') return 'Card/POS instructions shown. Balance updates after finance verifies the receipt.';
  return 'Manual payment instructions shown. Balance updates after finance verification.';
}


async function createPaystackMobileMoneyPrompt({ payment, phone, email, name, config }) {
  if (!config.secretKey) throw new Error('Paystack secret key is not configured for this payment destination');
  if (!phone) throw new Error('Phone number is required for Paystack mobile-money payment.');
  const amount = cleanAmount(payment.amount);
  const reference = payment.reference;
  const payload = {
    email: email || config.fallbackEmail || 'payments@shuleai.local',
    amount: amount * 100,
    currency: payment.currency || 'KES',
    reference,
    mobile_money: { phone, provider: config.mobileMoneyProvider || config.mpesaProvider || 'mpesa' },
    metadata: { paymentId: payment.id, paymentType: payment.paymentType, schoolCode: payment.schoolCode, parentFlow: 'internal_no_checkout_url' }
  };
  const data = await requestJson({ hostname: 'api.paystack.co', path: '/charge', headers: { Authorization: `Bearer ${config.secretKey}`, Accept: 'application/json' }, body: payload });
  const providerReference = data?.data?.reference || data?.data?.id || reference;
  const message = data?.data?.display_text || data?.message || 'Paystack mobile-money request started. Complete the prompt if it appears on your phone.';
  return parentManagedPrompt({ provider: 'paystack', providerReference, gatewayResponse: data, message, providerAction: 'paystack_mobile_money_charge' });
}

async function createFlutterwaveMpesaPrompt({ payment, phone, email, name, config }) {
  if (!config.secretKey) throw new Error('Flutterwave secret key is not configured for this payment destination');
  if (!phone) throw new Error('Phone number is required for Flutterwave M-Pesa payment.');
  const amount = cleanAmount(payment.amount);
  const reference = payment.reference;
  const payload = {
    tx_ref: reference,
    amount,
    currency: payment.currency || 'KES',
    email: email || config.fallbackEmail || 'payments@shuleai.local',
    phone_number: phone,
    fullname: name || 'ShuleAI payer',
    redirect_url: config.returnUrl || publicUrl('/payment-return.html'),
    meta: { paymentId: payment.id, paymentType: payment.paymentType, schoolCode: payment.schoolCode, parentFlow: 'internal_no_checkout_url' }
  };
  const data = await requestJson({ hostname: 'api.flutterwave.com', path: '/v3/charges?type=mpesa', headers: { Authorization: `Bearer ${config.secretKey}`, Accept: 'application/json' }, body: payload });
  const providerReference = data?.data?.id ? String(data.data.id) : (data?.data?.flw_ref || data?.data?.tx_ref || reference);
  const message = data?.meta?.authorization?.note || data?.message || 'Flutterwave M-Pesa request started. Complete the phone prompt if it appears.';
  return parentManagedPrompt({ provider: 'flutterwave', providerReference, gatewayResponse: data, message, providerAction: 'flutterwave_mpesa_charge' });
}

async function createPesapalManagedPrompt({ payment, phone, email, name, config }) {
  const prompt = await createPesapalCheckout({ payment, phone, email, name, config, internalOnly: false });
  return parentManagedPrompt({ provider: 'pesapal', providerReference: prompt.providerReference || payment.reference, checkoutUrl: prompt.checkoutUrl, gatewayResponse: { ...(prompt.gatewayResponse || {}), checkoutUrlCreatedInternally: !!prompt.checkoutUrl }, message: 'PesaPal checkout is ready. Continue securely to complete payment; fees update after IPN/status confirmation.', providerAction: 'pesapal_hosted_checkout' });
}

async function createStripeManagedPrompt({ payment, phone, email, name, config }) {
  if (!config.secretKey) throw new Error('Stripe secret key is not configured for this payment destination');
  const amount = cleanAmount(payment.amount);
  const currency = payment.currency || 'KES';
  const body = new URLSearchParams();
  body.set('mode', 'payment');
  body.set('success_url', config.successUrl || publicUrl('/payment-success.html'));
  body.set('cancel_url', config.cancelUrl || publicUrl('/payment-cancelled.html'));
  body.set('client_reference_id', payment.reference);
  body.set('line_items[0][price_data][currency]', String(currency).toLowerCase());
  body.set('line_items[0][price_data][product_data][name]', payment.paymentType === SCHOOL_FEE ? 'School fees' : 'ShuleAI platform payment');
  body.set('line_items[0][price_data][unit_amount]', String(amount * 100));
  body.set('line_items[0][quantity]', '1');
  body.set('metadata[paymentId]', String(payment.id));
  body.set('metadata[reference]', payment.reference);
  body.set('metadata[parentFlow]', 'internal_no_checkout_url');
  const data = await requestFormUrlEncoded({ hostname:'api.stripe.com', path:'/v1/checkout/sessions', headers:{ Authorization:`Bearer ${config.secretKey}` }, body });
  if (!data.url) throw new Error('Stripe did not return a checkout URL');
  return parentManagedPrompt({ provider: 'stripe', providerReference: data.id || payment.reference, checkoutUrl: data.url, gatewayResponse: { id: data.id, urlCreatedInternally: true }, message: 'Stripe checkout is ready. Continue securely to complete payment; fees update only after Stripe webhook confirmation.', providerAction: 'stripe_hosted_checkout' });
}

async function createProviderPrompt({ provider, payment, phone, email, name, config, method }) {
  const amount = cleanAmount(payment.amount);
  const currency = payment.currency || 'KES';
  const reference = payment.reference;
  const parentSchoolFee = isParentSchoolFeeFlow(payment);

  // Parent school-fee payments are simple inside ShuleAI: child -> amount -> phone -> Pay.
  // The parent never receives provider/callback/checkout URLs. The active provider adapter runs server-side.
  if (parentSchoolFee) {
    if (['manual','bank','cash'].includes(method)) {
      return { status: 'prompt_sent', promptType: 'manual_instructions', checkoutUrl: null, providerReference: reference, message: manualMessageForMethod(method) };
    }
    if (provider === 'mpesa') {
      if (!phone) throw new Error('Phone number is required for the school fee payment prompt.');
      const stk = await daraja.initiateSTKPush({ phone, amount, accountReference: payment.accountReference || reference, transactionDesc: 'School fees', callbackUrl: config.callbackUrl || publicUrl('/api/payments/mpesa/callback'), credentials: config, metadata: { reference, paymentId: payment.id, paymentType: payment.paymentType, schoolCode: payment.schoolCode, parentFlow: 'internal_no_checkout_url' } });
      return { status: 'prompt_sent', promptType: 'phone_prompt', checkoutUrl: null, providerReference: stk.CheckoutRequestID, checkoutRequestId: stk.CheckoutRequestID, merchantRequestId: stk.MerchantRequestID, gatewayResponse: stk, message: stk.CustomerMessage || 'STK Push sent. Check your phone and enter your M-Pesa PIN.' };
    }
    if (provider === 'paystack') return createPaystackMobileMoneyPrompt({ payment, phone, email, name, config });
    if (provider === 'flutterwave') return createFlutterwaveMpesaPrompt({ payment, phone, email, name, config });
    if (provider === 'pesapal') return createPesapalManagedPrompt({ payment, phone, email, name, config });
    if (provider === 'stripe') return createStripeManagedPrompt({ payment, phone, email, name, config });
    return { status: 'prompt_sent', promptType: 'manual_instructions', checkoutUrl: null, providerReference: reference, message: manualMessageForMethod(method || provider) };
  }

  // Bank transfer, cash, manual M-Pesa/reference, and offline card/POS must always work.
  // They create a pending verification record instead of trying to call disabled providers.
  if (['manual','bank','cash'].includes(method) || provider === 'manual' || provider === 'bank' || provider === 'cash' || (method === 'card' && ['mpesa','manual','bank','cash','card'].includes(provider))) {
    return { status: 'prompt_sent', promptType: 'manual_instructions', checkoutUrl: null, providerReference: reference, message: manualMessageForMethod(method || provider) };
  }

  if (provider === 'mpesa') {
    if (method && method !== 'mobile_money') return { status: 'prompt_sent', promptType: 'manual_instructions', checkoutUrl: null, providerReference: reference, message: manualMessageForMethod(method) };
    if (!phone) throw new Error('Phone number is required for M-Pesa STK prompt');
    const stk = await daraja.initiateSTKPush({ phone, amount, accountReference: payment.accountReference || reference, transactionDesc: payment.paymentType === SCHOOL_FEE ? 'School fees' : 'ShuleAI platform payment', callbackUrl: config.callbackUrl || publicUrl('/api/payments/mpesa/callback'), credentials: config, metadata: { reference, paymentId: payment.id, paymentType: payment.paymentType, schoolCode: payment.schoolCode } });
    return { status: 'prompt_sent', promptType: 'phone_prompt', checkoutUrl: null, providerReference: stk.CheckoutRequestID, checkoutRequestId: stk.CheckoutRequestID, merchantRequestId: stk.MerchantRequestID, gatewayResponse: stk, message: stk.CustomerMessage || 'M-Pesa prompt sent.' };
  }

  if (provider === 'paystack') {
    if (!config.secretKey) throw new Error('Paystack secret key is not configured for this payment destination');
    const data = await requestJson({ hostname: 'api.paystack.co', path: '/transaction/initialize', headers: { Authorization: `Bearer ${config.secretKey}` }, body: { email: email || config.fallbackEmail || 'payments@shuleai.local', amount: amount * 100, currency, reference, callback_url: config.returnUrl || publicUrl('/payment-return.html'), metadata: { paymentId: payment.id, paymentType: payment.paymentType, schoolCode: payment.schoolCode, method } } });
    if (!data?.data?.authorization_url) throw new Error(data?.message || 'Paystack did not return a checkout URL');
    return { status: 'prompt_sent', promptType: 'checkout_url', checkoutUrl: data.data.authorization_url, providerReference: data?.data?.reference || reference, gatewayResponse: data, message: 'Open Paystack checkout to complete payment.' };
  }

  if (provider === 'flutterwave') {
    if (!config.secretKey) throw new Error('Flutterwave secret key is not configured for this payment destination');
    const data = await requestJson({ hostname: 'api.flutterwave.com', path: '/v3/payments', headers: { Authorization: `Bearer ${config.secretKey}` }, body: { tx_ref: reference, amount, currency, redirect_url: config.returnUrl || publicUrl('/payment-return.html'), customer: { email: email || config.fallbackEmail || 'payments@shuleai.local', phonenumber: phone || '', name: name || 'ShuleAI payer' }, customizations: { title: config.title || 'ShuleAI Payment' }, meta: { paymentId: payment.id, paymentType: payment.paymentType, schoolCode: payment.schoolCode, method } } });
    if (!data?.data?.link) throw new Error(data?.message || 'Flutterwave did not return a checkout URL');
    return { status: 'prompt_sent', promptType: 'checkout_url', checkoutUrl: data.data.link, providerReference: data?.data?.id ? String(data.data.id) : reference, gatewayResponse: data, message: 'Open Flutterwave checkout to complete payment.' };
  }

  if (provider === 'stripe') {
    if (!config.secretKey) throw new Error('Stripe secret key is not configured for this payment destination');
    const amount = cleanAmount(payment.amount);
    const body = new URLSearchParams();
    body.set('mode', 'payment');
    body.set('success_url', config.successUrl || publicUrl('/payment-success.html'));
    body.set('cancel_url', config.cancelUrl || publicUrl('/payment-cancelled.html'));
    body.set('client_reference_id', reference);
    body.set('line_items[0][price_data][currency]', String(currency).toLowerCase());
    body.set('line_items[0][price_data][product_data][name]', payment.paymentType === SCHOOL_FEE ? 'School fees' : 'ShuleAI platform payment');
    body.set('line_items[0][price_data][unit_amount]', String(amount * 100));
    body.set('line_items[0][quantity]', '1');
    body.set('metadata[paymentId]', String(payment.id));
    body.set('metadata[reference]', reference);
    body.set('metadata[method]', method || 'card');
    const data = await requestFormUrlEncoded({ hostname:'api.stripe.com', path:'/v1/checkout/sessions', headers:{ Authorization:`Bearer ${config.secretKey}` }, body });
    if (!data.url) throw new Error('Stripe did not return a checkout URL');
    return { status: 'prompt_sent', promptType: 'checkout_url', checkoutUrl: data.url, providerReference: data.id, gatewayResponse: data, message: 'Open Stripe checkout to complete payment.' };
  }

  if (provider === 'pesapal') return createPesapalCheckout({ payment, phone, email, name, config });
  throw new Error(`No prompt handler exists for ${providerLabel(provider)}`);
}

function studentReferenceByRule({ student, parent, fee, rule, fallback }) {
  const normalized = String(rule || '').trim().toLowerCase();
  if (normalized === 'elimuid' || normalized === 'elimu_id') return student?.elimuid || student?.elimuId || fallback;
  if (normalized === 'admissionnumber' || normalized === 'admission_number') return student?.admissionNumber || fallback;
  if (normalized === 'assessmentnumber' || normalized === 'assessment_number') return student?.assessmentNumber || student?.assessmentNo || fallback;
  if (normalized === 'studentname' || normalized === 'student_name') return student?.User?.name || student?.name || fallback;
  if (normalized === 'parentphone' || normalized === 'parent_phone') return parent?.phone || parent?.User?.phone || fallback;
  if (normalized === 'invoice' || normalized === 'invoicenumber' || normalized === 'invoice_number') return fee?.invoiceNumber || fallback;
  if (normalized === 'term') return [student?.elimuid || student?.admissionNumber || student?.id, fee?.term, fee?.year].filter(Boolean).join('-') || fallback;
  return student?.elimuid || student?.admissionNumber || fallback;
}


function normalizeBillingCycle(value) {
  const cycle = String(value || 'monthly').trim().toLowerCase();
  return ['monthly', 'termly', 'yearly', 'custom'].includes(cycle) ? cycle : 'monthly';
}

function normalizeOwnerTypeForPlatform(body = {}, user = {}) {
  const explicit = String(body.ownerType || body.subscriptionOwnerType || '').trim().toLowerCase();
  if (['child', 'school'].includes(explicit)) return explicit;
  const purpose = String(body.platformPurpose || body.purpose || body.transactionType || '').toLowerCase();
  if (purpose.includes('child')) return 'child';
  if (purpose.includes('school')) return 'school';
  if (body.studentId) return 'child';
  if (['admin', 'finance_officer', 'super_admin'].includes(String(user?.role || '').toLowerCase())) return 'school';
  return 'child';
}

function subscriptionPaymentMethod(method, provider) {
  if (method === 'mobile_money' || provider === 'mpesa') return 'mpesa';
  if (method === 'card' || provider === 'stripe') return 'card';
  if (method === 'bank') return 'bank';
  return 'manual';
}

async function ensurePlatformSubscriptionContext({ user, body, schoolCode, amount, provider, method, reference, transaction }) {
  const purpose = String(body.platformPurpose || body.purpose || body.transactionType || '').toLowerCase();
  const ownerType = normalizeOwnerTypeForPlatform(body, user);
  const shouldPrepare = purpose.includes('subscription') || !!body.plan || !!body.planCode;
  if (!shouldPrepare) return {};

  const billingCycle = normalizeBillingCycle(body.billingCycle || body.billingPeriod);
  const planCode = body.planCode || body.plan || (ownerType === 'school' ? 'school_growth' : 'child_basic');
  const plan = await subscriptionController.getPlanByCode(planCode, ownerType).catch(() => null);
  if (!plan) throw new Error(ownerType === 'school' ? 'School subscription plan not found' : 'Child subscription plan not found');
  const planName = plan.displayName || plan.name || plan.code || planCode;
  const cleanPlanAmount = cleanAmount(subscriptionController.planAmount(plan, billingCycle));
  if (cleanAmount(amount) !== cleanPlanAmount) {
    const error = new Error(`Subscription price changed. Refresh and pay the current ${billingCycle} amount of KES ${cleanPlanAmount}.`);
    error.statusCode = 409;
    error.data = { expectedAmount: cleanPlanAmount, billingCycle, planCode: plan.code || planCode };
    throw error;
  }

  if (ownerType === 'child') {
    if (!body.studentId) throw new Error('studentId is required for child subscription payments');
    const { parent, student } = await financeLedger.assertParentOwnsStudent({ parentUserId: user?.id, studentId: Number(body.studentId), transaction });
    const resolvedSchoolCode = student.schoolCode || student.User?.schoolCode;
    const [subscription] = await Subscription.findOrCreate({
      where: { ownerType: 'child', studentId: student.id },
      defaults: { ownerType: 'child', schoolCode: resolvedSchoolCode, parentId: parent.id, studentId: student.id, planId: plan.id, planCode: plan.code || plan.name, planName, billingCycle, status: 'pending', features: plan.features || [], limits: plan.limits || {} },
      transaction
    });
    await subscription.update({ planId: plan.id, planCode: plan.code || plan.name, planName, billingCycle, status: 'pending', features: plan.features || [], limits: plan.limits || {} }, { transaction });
    const subscriptionPayment = await SubscriptionPayment.create({
      subscriptionId: subscription.id,
      ownerType: 'child',
      schoolCode: resolvedSchoolCode,
      parentId: parent.id,
      studentId: student.id,
      planId: plan.id,
      planCode: plan.code || plan.name,
      planName,
      billingCycle,
      amount: cleanPlanAmount,
      currency: body.currency || 'KES',
      paymentMethod: subscriptionPaymentMethod(method, provider),
      status: 'pending',
      metadata: { reference, provider, method, source: 'locked-platform-provider-engine' },
      auditTrail: [{ action: 'child_subscription_payment_created', provider, method, reference, at: new Date().toISOString(), actorUserId: user?.id || null }]
    }, { transaction });
    return { ownerType, student, parent, subscription, subscriptionPayment, subscriptionId: subscription.id, subscriptionPaymentId: subscriptionPayment.id, planId: plan.id, planCode: plan.code || plan.name, planName, billingCycle };
  }

  const lookup = String(body.schoolCode || schoolCode || user?.schoolCode || '').trim();
  if (!lookup || lookup === 'platform') throw new Error('schoolCode is required for school subscription payments');
  const school = await School.findOne({ where: { [Op.or]: [{ schoolId: lookup }, { shortCode: lookup }] }, transaction }).catch(() => null);
  if (!school) throw new Error('School not found for subscription payment');
  const [subscription] = await Subscription.findOrCreate({
    where: { ownerType: 'school', schoolCode: school.schoolId },
    defaults: { ownerType: 'school', schoolId: school.id, schoolCode: school.schoolId, planId: plan.id, planCode: plan.code || plan.name, planName, billingCycle, status: 'pending', features: plan.features || [], limits: plan.limits || {} },
    transaction
  });
  await subscription.update({ schoolId: school.id, planId: plan.id, planCode: plan.code || plan.name, planName, billingCycle, status: 'pending', features: plan.features || [], limits: plan.limits || {} }, { transaction });
  const subscriptionPayment = await SubscriptionPayment.create({
    subscriptionId: subscription.id,
    ownerType: 'school',
    schoolId: school.id,
    schoolCode: school.schoolId,
    planId: plan.id,
    planCode: plan.code || plan.name,
    planName,
    billingCycle,
    amount: cleanPlanAmount,
    currency: body.currency || 'KES',
    paymentMethod: subscriptionPaymentMethod(method, provider),
    status: 'pending',
    metadata: { reference, provider, method, source: 'locked-platform-provider-engine' },
    auditTrail: [{ action: 'school_subscription_payment_created', provider, method, reference, at: new Date().toISOString(), actorUserId: user?.id || null }]
  }, { transaction });
  return { ownerType, school, subscription, subscriptionPayment, subscriptionId: subscription.id, subscriptionPaymentId: subscriptionPayment.id, planId: plan.id, planCode: plan.code || plan.name, planName, billingCycle, schoolCode: school.schoolId };
}

async function finalizeSubscriptionSideEffects({ payment, status, providerReference, rawPayload, transaction }) {
  const normalized = String(status || '').toLowerCase();
  const paid = normalized === 'paid';
  const failed = normalized === 'failed';
  if (!payment?.subscriptionPaymentId || (!paid && !failed)) return null;
  const subscriptionPayment = await SubscriptionPayment.findByPk(payment.subscriptionPaymentId, { transaction }).catch(() => null);
  if (!subscriptionPayment) return null;
  const trail = Array.isArray(subscriptionPayment.auditTrail) ? subscriptionPayment.auditTrail : [];
  trail.push({ action: paid ? 'provider_confirmed_subscription_paid' : 'provider_confirmed_subscription_failed', provider: payment.paymentGateway, at: new Date().toISOString(), providerReference });
  await subscriptionPayment.update({
    status: paid ? 'success' : 'failed',
    paidAt: paid ? new Date() : subscriptionPayment.paidAt,
    checkoutRequestId: payment.checkoutRequestId || subscriptionPayment.checkoutRequestId,
    merchantRequestId: payment.merchantRequestId || subscriptionPayment.merchantRequestId,
    mpesaReceiptNumber: payment.mpesaReceiptNumber || payment.receiptNumber || subscriptionPayment.mpesaReceiptNumber,
    rawCallback: rawPayload || subscriptionPayment.rawCallback,
    auditTrail: trail
  }, { transaction });
  if (paid) {
    const plan = await SubscriptionPlan.findByPk(subscriptionPayment.planId, { transaction }).catch(() => null) || await subscriptionController.getPlanByCode(subscriptionPayment.planCode, subscriptionPayment.ownerType === 'school' ? 'school' : 'child');
    const subscription = await Subscription.findByPk(subscriptionPayment.subscriptionId, { transaction }).catch(() => null);
    if (plan && subscription) await subscriptionController.renewSubscription(subscription, plan, subscriptionPayment.billingCycle, payment.id,{transaction});
  }
  return subscriptionPayment;
}

async function initiatePayment({ user, body }) {
  const paymentType = normalizePaymentType(body.paymentType || body.type);
  const requestedProvider = normalizeProviderIfPossible(body.provider || body.paymentProvider || '');
  const paymentMethod = normalizePaymentMethod(body.paymentMethod || body.method || body.channel || body.provider || '');
  const amount = cleanAmount(body.amount);
  const currency = body.currency || 'KES';
  const phone = body.phone || body.payerPhone || user?.phone || '';
  let student = null, parent = null, fee = null, schoolCode = body.schoolCode || user?.schoolCode || 'platform';

  return sequelize.transaction(async (transaction) => {
    if (paymentType === SCHOOL_FEE) {
      if (!body.studentId) throw new Error('studentId is required for school fee payments');
      schoolCode = user?.schoolCode || body.schoolCode;
      if (user?.role === 'parent') {
        ({ parent, student } = await financeLedger.assertParentOwnsStudent({ parentUserId: user.id, studentId: body.studentId, transaction }));
        schoolCode = student.schoolCode || student.User?.schoolCode;
      } else {
        student = await financeLedger.findStudentInSchool({ schoolCode, studentId: body.studentId, transaction });
      }
      if (!student) throw new Error('Student not found for this school');

      const requestedFeeId = body.feeId || body.invoiceId || body.feeAccountId || null;
      if (requestedFeeId) {
        fee = await Fee.findOne({ where: { id: requestedFeeId, studentId: student.id, schoolCode }, transaction });
      } else {
        const feeRows = await Fee.findAll({
          where: { studentId: student.id, schoolCode },
          order: [['year', 'DESC'], ['createdAt', 'DESC']],
          transaction
        });
        fee = feeRows.find(row => Math.max(0, Number(row.totalAmount || 0) - Number((row.parentPaidAmount ?? row.paidAmount) || 0) - Number(row.creditAmount || 0)) > 0) || feeRows[0] || null;
      }
      if (!fee) throw new Error('Fee account not found for this student');
      var invoice = await financialSystem.ensureInvoiceForFee({ feeId: fee.id, transaction });
      const balance = invoice ? Number(invoice.balanceAmount || 0) : Math.max(0, Number(fee.totalAmount || 0) - Number((fee.parentPaidAmount ?? fee.paidAmount) || 0) - Number(fee.creditAmount || 0));
      if (balance <= 0 && body.allowOverpay !== true) throw new Error('This fee account has no outstanding balance');
      if (amount > balance && body.allowOverpay !== true) {
        const err = new Error(`Amount exceeds outstanding balance. Balance is ${balance}`);
        err.data = { balance, feeId: fee.id, studentId: student.id };
        throw err;
      }
    }

    const resolved = await resolvePaymentProvider({ paymentType, schoolCode, requestedProvider, method: paymentMethod });
    const provider = resolved.provider;
    const method = resolved.method || paymentMethod || provider;
    const reference = ['manual','bank','cash'].includes(paymentMethod) && body.reference
      ? cleanManualReference(body.reference)
      : String(body.reference || ref(paymentType === SCHOOL_FEE ? 'FEE' : 'PLATFORM')).toUpperCase();
    const duplicate = await Payment.findOne({ where: { reference }, transaction });
    if (duplicate) {
      const err = new Error('This payment reference/code has already been submitted. Use a unique M-Pesa code, bank reference, or provider reference.');
      err.statusCode = 409;
      throw err;
    }

    const platformSubscription = paymentType === PLATFORM
      ? await ensurePlatformSubscriptionContext({ user, body, schoolCode, amount, provider, method, reference, transaction })
      : {};
    if (platformSubscription.schoolCode) schoolCode = platformSubscription.schoolCode;
    if (platformSubscription.student) student = platformSubscription.student;
    if (platformSubscription.parent) parent = platformSubscription.parent;

    const accountReference = body.accountReference || (paymentType === SCHOOL_FEE ? studentReferenceByRule({ student, parent, fee, rule: resolved.linkingRule, fallback: reference }) : reference);
    const payment = await Payment.create({
      schoolCode,
      studentId: student?.id || body.studentId || null,
      parentId: parent?.id || body.parentId || null,
      feeId: fee?.id || body.feeId || body.invoiceId || null,
      amount,
      currency,
      reference,
      method,
      paymentGateway: provider,
      paymentType,
      paymentDestination: paymentType === SCHOOL_FEE ? 'school' : 'platform',
      paidTo: paymentType === SCHOOL_FEE ? 'school' : 'platform',
      accountReference,
      status: 'pending',
      promptStatus: 'created',
      transactionType: paymentType === SCHOOL_FEE ? 'payment' : (body.platformPurpose || body.purpose || 'subscription'),
      source: user?.role || 'system',
      payerPhone: phone || null,
      plan: platformSubscription.planCode || body.plan || body.planCode || null,
      planCode: platformSubscription.planCode || body.planCode || body.plan || null,
      planName: platformSubscription.planName || body.planName || null,
      billingCycle: platformSubscription.billingCycle || body.billingCycle || body.billingPeriod || null,
      ownerType: platformSubscription.ownerType || body.ownerType || (body.studentId ? 'child' : null),
      subscriptionPaymentId: platformSubscription.subscriptionPaymentId || body.subscriptionPaymentId || null,
      subscriptionId: platformSubscription.subscriptionId || body.subscriptionId || null,
      metadata: { ...(body.metadata || {}), purpose: body.purpose || body.platformPurpose || paymentType, parentInternalPaymentFlow: body.parentInternalPaymentFlow === true || body.metadata?.parentInternalPaymentFlow === true, noParentCheckoutUrl: body.parentInternalPaymentFlow === true || body.metadata?.noParentCheckoutUrl === true || false, studentName: student?.User?.name || null, feeId: fee?.id || null, amountSource: body.feeId || body.invoiceId ? 'selected_fee_account' : (paymentType === SCHOOL_FEE ? 'auto_selected_outstanding_fee_account' : 'provided_amount'), initiatedBy: user?.id || null, selectedMethod: method, activeProvider: provider, providerConfigId: resolved.providerConfigId, providerSelectionRule: 'one_active_provider_per_scope', linkingRule: resolved.linkingRule, planCode: platformSubscription.planCode || body.planCode || body.plan || null, planName: platformSubscription.planName || body.planName || null, billingCycle: platformSubscription.billingCycle || body.billingCycle || body.billingPeriod || null, ownerType: platformSubscription.ownerType || body.ownerType || null, subscriptionPaymentId: platformSubscription.subscriptionPaymentId || body.subscriptionPaymentId || null, subscriptionId: platformSubscription.subscriptionId || body.subscriptionId || null },
      auditTrail: [{ action: 'payment_created_before_provider_call', actorUserId: user?.id || null, actorRole: user?.role || null, at: new Date().toISOString(), provider, method, paymentType, providerSelectionRule: 'one_active_provider_per_scope' }],
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24)
    }, { transaction });

    await financialSystem.mirrorLegacyPayment({ payment, invoiceId: typeof invoice !== 'undefined' ? invoice?.id || null : null, transaction });

    try {
      const config = await getProviderConfig({ paymentType, schoolCode, provider });
      const prompt = await createProviderPrompt({ provider, payment, phone, email: user?.email || body.email, name: user?.name || body.name, config, method });
      const nextStatus = prompt.promptType === 'manual_instructions'
        ? 'pending_verification'
        : (['checkout_url','hosted_checkout'].includes(prompt.promptType) ? 'pending_customer_action' : 'pending_provider_confirmation');
      await payment.update({ status: nextStatus, promptStatus: prompt.status, promptType: prompt.promptType, checkoutUrl: prompt.checkoutUrl || null, providerReference: prompt.providerReference || null, transactionId: prompt.checkoutRequestId || prompt.providerReference || payment.transactionId, checkoutRequestId: prompt.checkoutRequestId || payment.checkoutRequestId, merchantRequestId: prompt.merchantRequestId || payment.merchantRequestId, gatewayResponse: prompt.gatewayResponse || {}, metadata: { ...(payment.metadata || {}), promptMessage: prompt.message, backendExecution: 'provider_prompt_created_server_side', backendFinalizationRule: 'ui_never_marks_paid_provider_or_admin_must_confirm' } }, { transaction });
      await financialSystem.mirrorLegacyPayment({ payment: await payment.reload({ transaction }), invoiceId: typeof invoice !== 'undefined' ? invoice?.id || null : null, transaction });
      return payment.reload({ transaction });
    } catch (error) {
      await payment.update({ status: 'pending_provider_error', promptStatus: 'provider_error', providerStatus: 'provider_error', notes: error.message, metadata: { ...(payment.metadata || {}), providerError: error.message } }, { transaction });
      await financialSystem.mirrorLegacyPayment({ payment: await payment.reload({ transaction }), invoiceId: typeof invoice !== 'undefined' ? invoice?.id || null : null, transaction });
      return payment.reload({ transaction });
    }
  });
}

function parseDarajaWebhookPayload(payload = {}) {
  try { return daraja.parseCallback(payload); } catch (_) { return {}; }
}

function normalizeProviderStatus(provider, payload = {}) {
  if (provider === 'mpesa') {
    const parsed = parseDarajaWebhookPayload(payload);
    if (parsed.resultCode !== undefined && parsed.resultCode !== null) return Number(parsed.resultCode) === 0 ? 'paid' : 'failed';
  }
  let status = payload.status || payload.event || payload.data?.status || payload.data?.attributes?.status || '';
  if (provider === 'paystack') status = payload.data?.status || payload.event;
  if (provider === 'flutterwave') status = payload.status || payload.data?.status || payload.event;
  if (provider === 'stripe') status = payload.type === 'checkout.session.completed' ? 'paid' : (payload.data?.object?.payment_status || payload.data?.object?.status);
  status = String(status || '').toLowerCase();
  if (FINAL_PAID.includes(status) || status.includes('charge.success') || status.includes('checkout.session.completed')) return 'paid';
  if (FINAL_FAILED.includes(status)) return 'failed';
  return 'pending';
}

function extractWebhook(provider, payload = {}) {
  if (provider === 'mpesa') {
    const parsed = parseDarajaWebhookPayload(payload);
    const checkout = parsed.checkoutRequestId || payload.CheckoutRequestID || payload.checkoutRequestId || payload.providerReference;
    return { reference: payload.reference || payload.internalReference || payload.metadata?.reference || '', providerReference: checkout, amount: parsed.amount || payload.amount, currency: payload.currency || 'KES', schoolCode:payload.schoolCode||payload.metadata?.schoolCode||null, eventId: checkout || parsed.merchantRequestId || payload.eventId, receiptNumber: parsed.mpesaReceiptNumber, rawParsed: parsed };
  }
  if (provider === 'paystack') return { reference: payload.data?.reference, providerReference: payload.data?.reference, amount: payload.data?.amount ? Math.round(Number(payload.data.amount) / 100) : null, currency: payload.data?.currency, schoolCode:payload.data?.metadata?.schoolCode||null, eventId: payload.data?.id ? String(payload.data.id) : payload.event };
  if (provider === 'flutterwave') return { reference: payload.tx_ref || payload.data?.tx_ref, providerReference: payload.transaction_id || payload.data?.id || payload.data?.flw_ref, amount: payload.amount || payload.data?.amount, currency: payload.currency || payload.data?.currency, schoolCode:payload.meta?.schoolCode||payload.data?.meta?.schoolCode||null, eventId: payload.id || payload.data?.id || payload.event };
  if (provider === 'stripe') return { reference: payload.data?.object?.client_reference_id || payload.data?.object?.metadata?.reference, providerReference: payload.data?.object?.id, amount: payload.data?.object?.amount_total ? Math.round(Number(payload.data.object.amount_total) / 100) : null, currency: String(payload.data?.object?.currency || '').toUpperCase(), schoolCode:payload.data?.object?.metadata?.schoolCode||null, eventId: payload.id };
  if (provider === 'pesapal') return { reference: payload.OrderMerchantReference || payload.order_merchant_reference || payload.merchant_reference || payload.reference, providerReference: payload.OrderTrackingId || payload.order_tracking_id || payload.providerReference, amount: payload.amount || payload.Amount, currency: payload.currency || payload.Currency || 'KES', schoolCode:payload.schoolCode||payload.metadata?.schoolCode||null, eventId: payload.OrderTrackingId || payload.order_tracking_id || payload.eventId };
  return { reference: payload.reference || payload.internalReference || payload.CheckoutRequestID, providerReference: payload.providerReference || payload.CheckoutRequestID, amount: payload.amount, currency: payload.currency || 'KES', schoolCode:payload.schoolCode||payload.metadata?.schoolCode||null, eventId: payload.id || payload.eventId || payload.CheckoutRequestID };
}

async function verifyProviderTransaction({ provider, extracted, config }) {
  if (provider === 'paystack') {
    if (!config.secretKey || !extracted.reference) throw new Error('Paystack verification requires the secret key and transaction reference');
    const data = await requestJson({ method: 'GET', hostname: 'api.paystack.co', path: `/transaction/verify/${encodeURIComponent(extracted.reference)}`, headers: { Authorization: `Bearer ${config.secretKey}`, Accept: 'application/json' } });
    const row = data?.data || {};
    return { status: FINAL_PAID.includes(String(row.status || '').toLowerCase()) ? 'paid' : (FINAL_FAILED.includes(String(row.status || '').toLowerCase()) ? 'failed' : 'pending'), providerReference: row.reference || extracted.providerReference, amount: row.amount ? Math.round(Number(row.amount) / 100) : null, currency: row.currency, receiptNumber: row.reference, gatewayResponse: data };
  }
  if (provider === 'flutterwave') {
    if (!config.secretKey || !extracted.providerReference) throw new Error('Flutterwave verification requires the secret key and transaction ID');
    const data = await requestJson({ method: 'GET', hostname: 'api.flutterwave.com', path: `/v3/transactions/${encodeURIComponent(extracted.providerReference)}/verify`, headers: { Authorization: `Bearer ${config.secretKey}`, Accept: 'application/json' } });
    const row = data?.data || {};
    return { status: FINAL_PAID.includes(String(row.status || '').toLowerCase()) ? 'paid' : (FINAL_FAILED.includes(String(row.status || '').toLowerCase()) ? 'failed' : 'pending'), providerReference: row.id ? String(row.id) : (row.flw_ref || extracted.providerReference), amount: row.amount, currency: row.currency, receiptNumber: row.flw_ref || String(row.id || ''), gatewayResponse: data };
  }
  if (provider === 'stripe') {
    if (!config.secretKey || !extracted.providerReference) throw new Error('Stripe verification requires the secret key and Checkout Session ID');
    const data = await requestJson({ method: 'GET', hostname: 'api.stripe.com', path: `/v1/checkout/sessions/${encodeURIComponent(extracted.providerReference)}`, headers: { Authorization: `Bearer ${config.secretKey}`, Accept: 'application/json' } });
    const paid = String(data?.payment_status || '').toLowerCase() === 'paid';
    const failed = ['expired','unpaid'].includes(String(data?.status || data?.payment_status || '').toLowerCase());
    return { status: paid ? 'paid' : (failed ? 'failed' : 'pending'), providerReference: data?.id || extracted.providerReference, amount: data?.amount_total ? Math.round(Number(data.amount_total) / 100) : null, currency: String(data?.currency || '').toUpperCase(), receiptNumber: data?.payment_intent || data?.id, gatewayResponse: data };
  }
  return null;
}


function currencyMatches(expected, actual) {
  const e = String(expected || 'KES').toUpperCase();
  const a = String(actual || e).toUpperCase();
  return e === a;
}

function nullableCleanAmount(value) {
  if (value === undefined || value === null || value === '') return null;
  return cleanAmount(value);
}

function certificationDecision({payment,provider,status,amount,currency,schoolCode,now=new Date()}) {
  const expectedProvider=normalizeProviderIfPossible(payment?.paymentGateway);
  const receivedProvider=normalizeProviderIfPossible(provider);
  if(expectedProvider&&receivedProvider&&expectedProvider!==receivedProvider)return {action:'reject',reason:'provider_mismatch'};
  if(schoolCode&&String(schoolCode)!==String(payment?.schoolCode))return {action:'reject',reason:'school_mismatch'};
  if(status==='failed')return {action:'fail',reason:'provider_confirmed_failure'};
  if(status!=='paid')return {action:'pending',reason:'provider_not_final'};
  let confirmedAmount=null;
  try{confirmedAmount=nullableCleanAmount(amount);}catch(_){return {action:'hold',reason:'invalid_confirmed_amount'};}
  if(!confirmedAmount)return {action:'hold',reason:'missing_confirmed_amount'};
  if(confirmedAmount!==cleanAmount(payment.amount))return {action:'hold',reason:'amount_mismatch'};
  if(!currencyMatches(payment.currency,currency))return {action:'hold',reason:'currency_mismatch'};
  if(payment.expiresAt&&new Date(payment.expiresAt)<new Date(now))return {action:'hold',reason:'late_provider_confirmation'};
  return {action:'complete',reason:'certified',confirmedAmount};
}

async function holdPaymentForManualReview({ locked, event, reason, provider, providerReference, amount, currency, rawPayload, transaction }) {
  const trail = Array.isArray(locked.auditTrail) ? locked.auditTrail : [];
  trail.push({ action: 'provider_confirmation_held_for_manual_review', provider, at: new Date().toISOString(), providerReference, amount, currency, reason });
  let confirmedAmount = null;
  try { confirmedAmount = nullableCleanAmount(amount); } catch (_) { confirmedAmount = null; }
  await locked.update({
    status: 'pending_manual_review',
    providerStatus: 'verification_hold',
    providerReference: providerReference || locked.providerReference,
    confirmedAmount: confirmedAmount || locked.confirmedAmount,
    confirmedCurrency: currency || locked.confirmedCurrency,
    reconciliationStatus: 'manual_review_required',
    gatewayResponse: rawPayload || locked.gatewayResponse,
    auditTrail: trail,
    metadata: { ...(locked.metadata || {}), paymentHold: { reason, provider, providerReference, amount, currency, at: new Date().toISOString() }, lastProviderPayload: rawPayload || {} }
  }, { transaction });
  if (event) await event.update({ processed: true, paymentId: locked.id, schoolCode: locked.schoolCode, processingError: reason }, { transaction });
}

async function createPaymentEventSafely({ provider, providerEventId, eventType = 'webhook', extracted, payload, headers, sourceIp }) {
  try {
    return await PaymentEvent.create({
      provider,
      providerEventId,
      eventType,
      internalReference: extracted.reference || null,
      providerReference: extracted.providerReference || null,
      verified: false,
      rawPayload: payload || {},
      sourceIp: sourceIp || null,
      metadata: { headers: webhookVerifier.sanitizeHeaders(headers), sourceIp: sourceIp || null, rawPayloadHash: crypto.createHash('sha256').update(JSON.stringify(payload || {})).digest('hex'), verification: { status: 'not_checked' } }
    });
  } catch (error) {
    if (error && (error.name === 'SequelizeUniqueConstraintError' || error.name === 'SequelizeDatabaseError')) {
      const existing = await PaymentEvent.findOne({ where: { provider, providerEventId } }).catch(() => null);
      if (existing) return existing;
    }
    throw error;
  }
}

async function processConfirmedPayment({ payment, status, provider, providerReference, amount, currency, rawPayload, event, receiptNumber, completionAuthority='verified_provider_callback' }) {
  const beforeStatus = payment.status;
  const paid = status === 'paid';
  const failed = status === 'failed';
  if ((paid && FINAL_PAID.includes(String(beforeStatus).toLowerCase())) || (failed && FINAL_FAILED.includes(String(beforeStatus).toLowerCase()))) return payment;

  await sequelize.transaction(async (transaction) => {
    const locked = await Payment.findByPk(payment.id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!locked) throw new Error('Payment disappeared during processing');
    if (normalizeProviderIfPossible(locked.paymentGateway) && normalizeProviderIfPossible(locked.paymentGateway) !== provider) {
      if (event) await event.update({ processingError: `Provider mismatch: payment expects ${locked.paymentGateway}, webhook came from ${provider}`, processed: false, paymentId: locked.id, schoolCode: locked.schoolCode }, { transaction });
      return;
    }

    if (locked.paymentType === 'provider_stk_test' || locked.metadata?.isProviderStkTest === true) {
      const testStatus = paid ? 'success' : (failed ? 'failed' : 'pending');
      const testTrail = Array.isArray(locked.auditTrail) ? locked.auditTrail : [];
      testTrail.push({ action: 'provider_stk_test_callback', provider, testStatus, at: new Date().toISOString(), providerReference, amount, currency });
      await locked.update({
        status: paid ? 'test_success' : (failed ? 'test_failed' : 'test_pending'),
        providerStatus: status,
        providerReference: providerReference || locked.providerReference,
        confirmedAmount: nullableCleanAmount(amount) || locked.confirmedAmount,
        confirmedCurrency: currency || locked.confirmedCurrency,
        completedAt: paid ? new Date() : locked.completedAt,
        failedAt: failed ? new Date() : locked.failedAt,
        receiptNumber: receiptNumber || providerReference || locked.receiptNumber,
        mpesaReceiptNumber: receiptNumber || locked.mpesaReceiptNumber,
        gatewayResponse: rawPayload || locked.gatewayResponse,
        auditTrail: testTrail,
        metadata: { ...(locked.metadata || {}), applyToFees: false, lastProviderPayload: rawPayload || {}, stkTestResult: testStatus }
      }, { transaction });
      await updateProviderConfigPatch({ scope: locked.schoolCode === 'platform' ? 'platform' : 'school', schoolCode: locked.schoolCode, provider, patch: { supportsStkPush: paid, lastStkTestStatus: testStatus, lastStkTestAt: new Date().toISOString(), lastError: failed ? String(rawPayload?.notificationPayload?.Body?.stkCallback?.ResultDesc || rawPayload?.resultDesc || 'STK test failed') : '' } }).catch(() => null);
      if (event) await event.update({ processed: paid || failed, paymentId: locked.id, schoolCode: locked.schoolCode, processingError: failed ? 'Provider STK test failed' : null }, { transaction });
      return;
    }

    if ((paid && FINAL_PAID.includes(String(locked.status).toLowerCase())) || (failed && FINAL_FAILED.includes(String(locked.status).toLowerCase()))) {
      if (event) await event.update({ processed: true, paymentId: locked.id, schoolCode: locked.schoolCode, processingError: null }, { transaction });
      return;
    }

    const decision=certificationDecision({payment:locked,provider,status,amount,currency,now:new Date()});
    let confirmedAmount=null;
    try{confirmedAmount=nullableCleanAmount(amount);}catch(_){confirmedAmount=null;}
    if (paid) {
      const expectedAmount = cleanAmount(locked.amount);
      if (!confirmedAmount) {
        await holdPaymentForManualReview({ locked, event, reason: 'Provider reported success without a confirmed amount.', provider, providerReference, amount, currency, rawPayload, transaction });
        return;
      }
      if (confirmedAmount !== expectedAmount) {
        await holdPaymentForManualReview({ locked, event, reason: `Confirmed amount ${confirmedAmount} does not exactly match expected amount ${expectedAmount}.`, provider, providerReference, amount, currency, rawPayload, transaction });
        return;
      }
      if (!currencyMatches(locked.currency, currency)) {
        await holdPaymentForManualReview({ locked, event, reason: `Currency mismatch. Expected ${locked.currency || 'KES'}, got ${currency || 'missing'}.`, provider, providerReference, amount, currency, rawPayload, transaction });
        return;
      }
      if(decision.action==='hold'){
        const messages={late_provider_confirmation:'Provider confirmed payment after the request expiry time.',invalid_confirmed_amount:'Provider returned an invalid confirmed amount.'};
        await holdPaymentForManualReview({locked,event,reason:messages[decision.reason]||`Payment certification hold: ${decision.reason}.`,provider,providerReference,amount,currency,rawPayload,transaction});
        return;
      }
    }

    const trail = Array.isArray(locked.auditTrail) ? locked.auditTrail : [];
    trail.push({ action: paid ? 'provider_confirmed_paid' : (failed ? 'provider_confirmed_failed' : 'provider_pending'), provider, at: new Date().toISOString(), providerReference, amount: confirmedAmount || amount, currency });
    await locked.update({
      status: paid ? 'completed' : (failed ? 'failed' : 'processing'),
      providerStatus: status,
      providerReference: providerReference || locked.providerReference,
      confirmedAmount: confirmedAmount || locked.confirmedAmount,
      confirmedCurrency: currency || locked.confirmedCurrency,
      completedAt: paid ? new Date() : locked.completedAt,
      paymentDate: paid ? new Date() : locked.paymentDate,
      failedAt: failed ? new Date() : locked.failedAt,
      reconciledAt: paid || failed ? new Date() : locked.reconciledAt,
      reconciliationStatus: paid || failed ? 'reconciled' : 'pending',
      receiptNumber: receiptNumber || providerReference || locked.receiptNumber,
      mpesaReceiptNumber: receiptNumber || locked.mpesaReceiptNumber,
      gatewayResponse: rawPayload || locked.gatewayResponse,
      auditTrail: trail,
      metadata: { ...(locked.metadata || {}), lastProviderPayload: rawPayload || {} },
      completionAuthority:paid?completionAuthority:locked.completionAuthority,
      completionEvidence:paid?{provider,providerReference:providerReference||null,eventId:event?.providerEventId||null,verificationMethod:event?.verificationMethod||null,amount:confirmedAmount,currency:currency||locked.currency,schoolCode:locked.schoolCode}:locked.completionEvidence,
      completionCertifiedAt:paid?new Date():locked.completionCertifiedAt
    }, { transaction, paymentCertification:paid?completionAuthority:undefined });

    await financialSystem.finalizeConfirmedPayment({ legacyPayment: locked, status, provider, providerReference, amount: confirmedAmount || amount, currency, rawPayload, event, transaction });
    await finalizeSubscriptionSideEffects({ payment: await locked.reload({ transaction }), status, providerReference, rawPayload, transaction }).catch(err => { throw err; });
    if (paid && locked.paymentType === SCHOOL_FEE && locked.feeId) await financeLedger.recalculateFeeAccount(locked.feeId, { transaction }).catch(() => null);
    if (event) await event.update({ processed: true, paymentId: locked.id, schoolCode: locked.schoolCode, processingError: null }, { transaction });
  });
  realtimeSync.emitPaymentUpdate(payment.schoolCode, { paymentId: payment.id, studentId: payment.studentId, feeId: payment.feeId, status: status === 'paid' ? 'completed' : status, action: 'payment_provider_confirmation', provider });
  return Payment.findByPk(payment.id);
}

async function handleWebhook({ provider, payload, headers = {}, rawBody = null, sourceIp = '' }) {
  provider = normalizeProvider(provider);
  const extracted = extractWebhook(provider, payload);
  const status = normalizeProviderStatus(provider, payload);
  const providerEventId = extracted.eventId ? String(extracted.eventId) : `${provider}:${extracted.reference || extracted.providerReference || crypto.createHash('sha256').update(JSON.stringify(payload || {})).digest('hex')}`;
  const eventSourceIp = webhookVerifier.sourceIp(headers, sourceIp);
  const event = await createPaymentEventSafely({ provider, providerEventId, extracted, payload, headers, sourceIp: eventSourceIp });
  if (event?.processed) return { accepted: true, duplicate: true };
  // Reprocess an existing unprocessed event. A previous attempt may have arrived
  // before the payment/config existed or failed during a provider status query.
  // Payment row locks and final-state checks keep this retry idempotent.

  const payment = await Payment.findOne({
    where: {
      [Op.or]: [
        { reference: extracted.reference || '' },
        { providerReference: extracted.providerReference || '' },
        { transactionId: extracted.providerReference || '' },
        { checkoutRequestId: extracted.providerReference || '' },
        { merchantRequestId: extracted.rawParsed?.merchantRequestId || extracted.providerReference || '' }
      ]
    }
  });

  if (!payment) {
    await event.update({ processingError: 'Payment not found yet; no money record changed.', processed: false, metadata: { ...(event.metadata || {}), verification: { status: 'not_checked_no_matching_payment' } } });
    return { accepted: true, pending: true };
  }
  await payment.update({callbackAttempts:Number(payment.callbackAttempts||0)+1,lastCallbackAt:new Date()},{hooks:false});

  if (normalizeProviderIfPossible(payment.paymentGateway) && normalizeProviderIfPossible(payment.paymentGateway) !== provider) {
    await event.update({ processingError: `Provider mismatch: payment expects ${payment.paymentGateway}, webhook came from ${provider}`, processed: false, paymentId: payment.id, schoolCode: payment.schoolCode });
    return { accepted: true, ignored: true, reason: 'provider_mismatch' };
  }
  let config = {};
  try {
    config = await getProviderConfig({ paymentType: payment.paymentType, schoolCode: payment.schoolCode, provider });
  } catch (err) {
    await event.update({ processingError: 'Provider config unavailable: ' + err.message, processed: false, paymentId: payment.id, schoolCode: payment.schoolCode });
    return { accepted: true, ignored: true, reason: 'provider_config_unavailable' };
  }

  const verification = webhookVerifier.verifyWebhook({ provider, rawBody, payload, headers, config, sourceIp: eventSourceIp });
  if (!verification.verified) {
    await event.update({
      verified: false,
      verificationMethod: verification.method || null,
      sourceIp: eventSourceIp || null,
      processed: false,
      paymentId: payment.id,
      schoolCode: payment.schoolCode,
      processingError: verification.reason || 'webhook_verification_failed',
      metadata: { ...(event.metadata || {}), verification }
    });
    return { accepted: true, rejected: true, reason: verification.reason || 'webhook_verification_failed' };
  }

  await event.update({
    verified: true,
    verificationMethod: verification.method || null,
    sourceIp: eventSourceIp || null,
    paymentId: payment.id,
    schoolCode: payment.schoolCode,
    metadata: { ...(event.metadata || {}), verification, providerConfigId: payment.metadata?.providerConfigId || providerConfigIdFor({ scope: payment.paymentType === PLATFORM ? 'platform' : 'school', schoolCode: payment.schoolCode, provider }), headers: webhookVerifier.sanitizeHeaders(headers), sourceIp: eventSourceIp }
  });
  await markProviderWebhookVerified({ payment, provider });
  if(extracted.schoolCode&&String(extracted.schoolCode)!==String(payment.schoolCode)){
    await event.update({processingError:`School mismatch: payment belongs to ${payment.schoolCode}, verified callback supplied ${extracted.schoolCode}`,processed:true,paymentId:payment.id,schoolCode:payment.schoolCode});
    return {accepted:true,rejected:true,reason:'school_mismatch'};
  }

  let finalStatus = status;
  let finalProviderReference = extracted.providerReference;
  let finalAmount = extracted.amount;
  let finalCurrency = extracted.currency;
  let finalReceiptNumber = extracted.receiptNumber;
  let finalPayload = payload;
  let completionAuthority='verified_provider_callback';

  // M-Pesa callbacks are not finalized just because ResultCode is 0. When possible,
  // query Daraja using the original CheckoutRequestID and merge the verified status.
  if (provider === 'mpesa' && status === 'paid' && extracted.providerReference) {
    try {
      const checked = await daraja.querySTKStatus(extracted.providerReference, config);
      finalPayload = { notificationPayload: payload, statusCheck: checked };
      completionAuthority='verified_provider_status_query';
      if (checked?.ResultCode !== undefined && checked?.ResultCode !== null) {
        finalStatus = Number(checked.ResultCode) === 0 ? 'paid' : 'failed';
      } else {
        await event.update({ processingError: 'M-Pesa callback accepted, but Daraja status query did not return a final ResultCode.', processed: false, paymentId: payment.id, schoolCode: payment.schoolCode });
        return { accepted: true, paymentId: payment.id, status: 'pending_status_check', warning: 'Daraja status query did not return a final ResultCode' };
      }
    } catch (err) {
      await event.update({ processingError: 'M-Pesa callback accepted, but Daraja status query failed: ' + err.message, processed: false, paymentId: payment.id, schoolCode: payment.schoolCode });
      return { accepted: true, paymentId: payment.id, status: 'pending_status_check', warning: err.message };
    }
  }

  // PesaPal IPN/callback payloads are treated only as a notification.
  // The backend must query PesaPal for the real transaction status before marking anything paid.
  if (provider === 'pesapal' && (extracted.providerReference || extracted.reference)) {
    try {
      const checked = await queryPesapalTransactionStatus({ trackingId: extracted.providerReference, merchantReference: extracted.reference || payment.reference, config });
      finalStatus = checked.status;
      finalProviderReference = checked.providerReference || finalProviderReference;
      finalAmount = checked.amount || finalAmount;
      finalCurrency = checked.currency || finalCurrency;
      finalReceiptNumber = checked.receiptNumber || finalReceiptNumber;
      finalPayload = { notificationPayload: payload, statusCheck: checked.gatewayResponse };
      completionAuthority='verified_provider_status_query';
    } catch (err) {
      await event.update({ processingError: 'Pesapal notification accepted, but status check failed: ' + err.message, processed: false, paymentId: payment.id, schoolCode: payment.schoolCode });
      return { accepted: true, paymentId: payment.id, status: 'pending_status_check', warning: err.message };
    }
  }

  // Signed notifications are still notifications. Re-query the provider before
  // granting value so amount, currency, reference, and final status come from
  // the provider API rather than only from the incoming webhook payload.
  if (['paystack','flutterwave','stripe'].includes(provider) && status === 'paid') {
    try {
      const checked = await verifyProviderTransaction({ provider, extracted, config });
      finalStatus = checked.status;
      finalProviderReference = checked.providerReference || finalProviderReference;
      finalAmount = checked.amount;
      finalCurrency = checked.currency;
      finalReceiptNumber = checked.receiptNumber || finalReceiptNumber;
      finalPayload = { notificationPayload: payload, statusCheck: checked.gatewayResponse };
      completionAuthority='verified_provider_status_query';
    } catch (err) {
      await event.update({ processingError: `${providerLabel(provider)} notification accepted, but transaction verification failed: ${err.message}`, processed: false, paymentId: payment.id, schoolCode: payment.schoolCode });
      return { accepted: true, paymentId: payment.id, status: 'pending_status_check', warning: err.message };
    }
  }

  await processConfirmedPayment({ payment, status: finalStatus, provider, providerReference: finalProviderReference, amount: finalAmount, currency: finalCurrency, rawPayload: finalPayload, event, receiptNumber: finalReceiptNumber, completionAuthority });
  return { accepted: true, paymentId: payment.id, status: finalStatus };
}

async function assertPaymentAccess(payment, user) {
  if (!payment || !user) throw new Error('Payment not found');
  if (user.role === 'super_admin') return payment;
  if (user.role === 'parent') {
    const parent = await Parent.findOne({ where: { userId: user.id } });
    if (!parent || Number(payment.parentId) !== Number(parent.id)) {
      const err = new Error('Payment not found');
      err.statusCode = 404;
      throw err;
    }
    if (payment.studentId) await financeLedger.assertParentOwnsStudent({ parentUserId: user.id, studentId: payment.studentId, schoolCode: payment.schoolCode });
    return payment;
  }
  if (['admin','finance_officer'].includes(user.role) && payment.schoolCode === user.schoolCode) return payment;
  if (Number(payment.metadata?.initiatedBy) === Number(user.id) && payment.schoolCode === user.schoolCode) return payment;
  const err = new Error('Payment not found');
  err.statusCode = 404;
  throw err;
}

async function findAccessiblePayment({ reference, user, anyReference = false }) {
  const key = String(reference || '').trim();
  if (!key) throw new Error('Payment reference is required');
  const where = anyReference
    ? { [Op.or]: [{ reference: key }, { checkoutRequestId: key }, { transactionId: key }, { providerReference: key }] }
    : { reference: key };
  const payment = await Payment.findOne({ where });
  if (!payment) throw new Error('Payment not found');
  return assertPaymentAccess(payment, user);
}

function safeHostedCheckoutUrl(payment) {
  if (!payment?.checkoutUrl) throw new Error('Secure checkout is not available for this payment');
  const provider = normalizeProviderIfPossible(payment.paymentGateway);
  const allowedHosts = {
    stripe: new Set(['checkout.stripe.com']),
    pesapal: new Set(['pay.pesapal.com', 'cybqa.pesapal.com'])
  };
  const parsed = new URL(payment.checkoutUrl);
  if (parsed.protocol !== 'https:' || !allowedHosts[provider]?.has(parsed.hostname.toLowerCase())) {
    throw new Error('Payment provider returned an untrusted checkout address');
  }
  return parsed.toString();
}

async function getPaymentContinuation({ reference, user }) {
  const payment = await findAccessiblePayment({ reference, user });
  if (!['pending_customer_action','pending_provider_confirmation'].includes(payment.status)) throw new Error('This payment is not awaiting customer checkout');
  if (!['checkout_url','hosted_checkout'].includes(payment.promptType)) throw new Error('This payment does not use hosted checkout');
  return { reference: payment.reference, status: payment.status, provider: payment.paymentGateway, redirectUrl: safeHostedCheckoutUrl(payment) };
}

async function getPaymentStatus({ reference, user, anyReference = false }) {
  const payment = await findAccessiblePayment({ reference, user, anyReference });
  const hosted = payment.status === 'pending_customer_action' && ['checkout_url','hosted_checkout'].includes(payment.promptType) && !!payment.checkoutUrl;
  return { reference: payment.reference, status: payment.status, provider: payment.paymentGateway, method: payment.method, paymentType: payment.paymentType, amount: payment.amount, currency: payment.currency, checkoutUrl: null, action: hosted ? { type: 'redirect', continueEndpoint: `/api/payments/${encodeURIComponent(payment.reference)}/continue` } : null, promptType: payment.promptType, promptStatus: payment.promptStatus, feeId: payment.feeId, studentId: payment.studentId };
}

async function queryStoredProviderStatus(payment){
  const provider=normalizeProvider(payment.paymentGateway);
  if(['manual','bank','cash','card'].includes(provider))return {status:'pending',providerReference:payment.providerReference,amount:null,currency:payment.currency,gatewayResponse:{reason:'manual_review_required'}};
  const config=await getProviderConfig({paymentType:payment.paymentType,schoolCode:payment.schoolCode,provider});
  if(provider==='mpesa'){
    const checkoutId=payment.checkoutRequestId||payment.providerReference||payment.transactionId;
    if(!checkoutId)throw new Error('M-Pesa status query requires the original CheckoutRequestID');
    const checked=await daraja.querySTKStatus(checkoutId,config);
    const hasFinal=checked?.ResultCode!==undefined&&checked?.ResultCode!==null;
    return {status:hasFinal?(Number(checked.ResultCode)===0?'paid':'failed'):'pending',providerReference:checkoutId,amount:hasFinal&&Number(checked.ResultCode)===0?payment.amount:null,currency:payment.currency||'KES',receiptNumber:checked?.MpesaReceiptNumber||payment.mpesaReceiptNumber,gatewayResponse:checked};
  }
  if(provider==='pesapal')return queryPesapalTransactionStatus({trackingId:payment.providerReference||payment.transactionId,merchantReference:payment.reference,config});
  if(['paystack','flutterwave','stripe'].includes(provider))return verifyProviderTransaction({provider,extracted:{reference:payment.reference,providerReference:payment.providerReference||payment.transactionId},config});
  return {status:'pending',providerReference:payment.providerReference,amount:null,currency:payment.currency,gatewayResponse:{reason:'provider_status_query_not_supported'}};
}

async function reconcilePayment({ reference, user }) {
  const payment = await findAccessiblePayment({ reference, user });
  if (FINAL_PAID.includes(String(payment.status).toLowerCase())) {
    const invoice = payment.feeId ? await financialSystem.ensureInvoiceForFee({ feeId: payment.feeId }) : null;
    const tx = await financialSystem.mirrorLegacyPayment({ payment, invoiceId: invoice?.id || null });
    if (payment.paymentType === SCHOOL_FEE && invoice) await financialSystem.recalculateInvoice(invoice.id);
    if (payment.paymentType === SCHOOL_FEE && payment.feeId) await financeLedger.recalculateFeeAccount(payment.feeId).catch(() => null);
    await financialSystem.recordReconciliation({ legacyPayment: payment, transactionRow: tx, result: 'already_paid', message: 'Payment was already final; balances recalculated.' });
    return getPaymentStatus({ reference, user });
  }
  let checked;
  try{checked=await queryStoredProviderStatus(payment);}catch(error){
    await payment.update({lastStatusQueryAt:new Date(),reconciliationStatus:'pending',metadata:{...(payment.metadata||{}),lastReconcileMessage:`Provider status query failed: ${error.message}`}});
    const tx=await financialSystem.mirrorLegacyPayment({payment});
    await financialSystem.recordReconciliation({legacyPayment:payment,transactionRow:tx,result:'pending',message:'Provider status query failed; payment remained pending.'});
    return getPaymentStatus({reference,user});
  }
  await payment.update({lastStatusQueryAt:new Date()},{hooks:false});
  if(['paid','failed'].includes(checked.status))await processConfirmedPayment({payment,status:checked.status,provider:normalizeProvider(payment.paymentGateway),providerReference:checked.providerReference||payment.providerReference,amount:checked.amount,currency:checked.currency||payment.currency,rawPayload:{statusCheck:checked.gatewayResponse||checked},event:null,receiptNumber:checked.receiptNumber,completionAuthority:'verified_provider_status_query'});
  else {
    await payment.update({reconciliationStatus:'pending',metadata:{...(payment.metadata||{}),lastReconcileMessage:'Provider status is not final; payment left pending safely.'}});
    const tx=await financialSystem.mirrorLegacyPayment({payment});
    await financialSystem.recordReconciliation({legacyPayment:payment,transactionRow:tx,result:'pending',message:'Provider status is not final; payment left pending safely.'});
  }
  return getPaymentStatus({ reference, user });
}

async function persistProviderConfig({ scope, schoolCode, provider, patch = {} }) {
  const row = scope === 'platform' ? await getPlatformRow() : await getSchoolRow(schoolCode);
  provider = normalizeProvider(provider || activeProviderFromRow(row));
  const existing = providerMap(row);
  const current = providerConfigFromMap(existing, provider) || {};
  const merged = vault.mergeEncryptedCredentials(current, { ...patch, provider, enabled: true, updatedAt: new Date().toISOString() }, SECRET_FIELDS);
  const metadata = { ...(row.metadata || {}), paymentProviders: lockedProviderMap(existing, provider, merged, true), activeProvider: provider, defaultProvider: provider, enabledProviders: [provider], providerLock: 'one_active_provider' };
  await row.update({ metadata, enabledProviders: [provider], defaultProvider: provider, paymentMode: paymentModeForProvider(provider) });
  return serializeSettings(await row.reload());
}


async function updateProviderConfigPatch({ scope = 'school', schoolCode, provider, patch = {}, user = null }) {
  provider = normalizeProvider(provider);
  const row = scope === 'platform' ? await getPlatformRow() : await getSchoolRow(schoolCode);
  const existing = providerMap(row);
  const current = providerConfigFromMap(existing, provider) || {};
  const merged = vault.mergeEncryptedCredentials(current, { ...patch, provider, updatedBy: user?.id || current.updatedBy || null, updatedAt: new Date().toISOString() }, SECRET_FIELDS);
  const metadata = {
    ...(row.metadata || {}),
    paymentProviders: { ...existing, [provider]: merged },
    auditTrail: appendAudit(row.metadata?.auditTrail, { action: 'provider_config_patch', provider, scope, actorUserId: user?.id || null, at: new Date().toISOString(), changedFields: Object.keys(patch).filter(k => !/secret|key|pass|token/i.test(k)) })
  };
  await row.update({ metadata });
  return serializeSettings(await row.reload());
}

async function createStripeWebhookEndpoint(config = {}) {
  if (!config.secretKey) throw new Error('Stripe secret key is missing.');
  const webhookUrl = config.webhookUrl || config.notificationUrl || providerNotificationUrl('stripe');
  const body = new URLSearchParams();
  body.set('url', webhookUrl);
  const events = config.webhookEvents || ['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed', 'payment_intent.succeeded', 'payment_intent.payment_failed'];
  events.forEach((eventName, idx) => body.set(`enabled_events[${idx}]`, eventName));
  const data = await requestFormUrlEncoded({ hostname: 'api.stripe.com', path: '/v1/webhook_endpoints', headers: { Authorization: `Bearer ${config.secretKey}` }, body });
  const secret = data.secret || data.signing_secret || data.webhook_secret;
  return { webhookUrl, endpointId: data.id || null, webhookSecret: secret || '', gatewayResponse: data };
}

async function verifyPaystackCredentials(config = {}) {
  if (!config.secretKey) throw new Error('Paystack secret key is missing.');
  const data = await requestJson({ method: 'GET', hostname: 'api.paystack.co', path: '/bank?country=kenya&perPage=1', headers: { Authorization: `Bearer ${config.secretKey}`, Accept: 'application/json' } });
  return { ok: true, gatewayResponse: data };
}

async function verifyFlutterwaveCredentials(config = {}) {
  if (!config.secretKey) throw new Error('Flutterwave secret key is missing.');
  const data = await requestJson({ method: 'GET', hostname: 'api.flutterwave.com', path: '/v3/banks/KE', headers: { Authorization: `Bearer ${config.secretKey}`, Accept: 'application/json' } });
  return { ok: true, gatewayResponse: data };
}

async function setupProviderNotifications({ scope = 'school', schoolCode, provider, user = null }) {
  provider = normalizeProvider(provider);
  const row = scope === 'platform' ? await getPlatformRow() : await getSchoolRow(schoolCode);
  const active = activeProviderFromRow(row);
  if (active && active !== provider) throw new Error(`${providerLabel(provider)} is not the active provider for this ${scope}. Save it as active before setting up notifications.`);
  const config = await getProviderConfig({ paymentType: scope === 'platform' ? PLATFORM : SCHOOL_FEE, schoolCode: schoolCode || row.schoolCode, provider });
  const now = new Date().toISOString();
  const urls = providerCallbackUrls(provider);
  let patch = { ...urls, notificationStatus: 'verified', lastVerifiedAt: now, lastError: '', checkoutUrl: '' };
  let message = `${providerLabel(provider)} notification URL verified.`;
  let details = { provider, providerConfigId: providerConfigIdFor({ scope, schoolCode: schoolCode || row.schoolCode || 'platform', provider }), ...urls };

  try {
    if (provider === 'pesapal') {
      const registered = await registerPesapalIpn({ ...config, ipnUrl: providerNotificationUrl('pesapal') });
      patch = { ...patch, ipnId: registered.notificationId, notificationId: registered.notificationId, ipnUrl: registered.ipnUrl, notificationUrl: registered.ipnUrl, webhookUrl: registered.ipnUrl, notificationStatus: 'registered_automatically', lastVerifiedAt: now };
      message = registered.alreadyRegistered ? 'PesaPal IPN already existed and was saved for this school/account.' : 'PesaPal IPN registered automatically and saved.';
      details = { ...details, ipnId: registered.notificationId, notificationUrl: registered.ipnUrl, alreadyRegistered: !!registered.alreadyRegistered };
    } else if (provider === 'stripe') {
      if (config.webhookSecret && config.webhookEndpointId) {
        patch = { ...patch, webhookEndpointId: config.webhookEndpointId, notificationStatus: 'registered_automatically', lastVerifiedAt: now };
        message = 'Stripe webhook endpoint and signing secret are already saved.';
        details = { ...details, webhookEndpointId: config.webhookEndpointId, alreadyRegistered: true };
      } else {
        const created = await createStripeWebhookEndpoint({ ...config, webhookUrl: providerNotificationUrl('stripe') });
        if (!created.webhookSecret) throw new Error('Stripe created/returned webhook data without a signing secret. Create it in Stripe Dashboard and paste the signing secret.');
        patch = { ...patch, webhookEndpointId: created.endpointId, webhookSecret: created.webhookSecret, notificationStatus: 'registered_automatically', lastVerifiedAt: now };
        message = 'Stripe webhook endpoint created and signing secret saved.';
        details = { ...details, webhookEndpointId: created.endpointId };
      }
    } else if (provider === 'mpesa') {
      await daraja.getAccessToken(config);
      const validationUrl = providerValidationUrl('mpesa');
      const confirmationUrl = providerConfirmationUrl('mpesa');
      patch = { ...patch, callbackUrl: providerNotificationUrl('mpesa'), stkCallbackUrl: providerNotificationUrl('mpesa'), validationUrl, confirmationUrl, supportsStkPush: true, notificationStatus: 'callback_attached_per_payment', lastVerifiedAt: now };
      message = 'M-Pesa/Daraja credentials verified. STK callback URL will be attached to each payment request.';
      details = { ...details, callbackUrl: providerNotificationUrl('mpesa'), validationUrl, confirmationUrl };
    } else if (provider === 'paystack') {
      await verifyPaystackCredentials(config);
      patch = { ...patch, notificationStatus: config.webhookVerifiedAt ? 'verified' : 'needs_dashboard_setup', lastVerifiedAt: now };
      message = 'Paystack credentials verified. Paste the webhook URL in Paystack dashboard, then run/send a test webhook to mark it fully ready.';
      details = { ...details, needsDashboardSetup: true };
    } else if (provider === 'flutterwave') {
      await verifyFlutterwaveCredentials(config);
      const hasSecretHash = hasAny(config, ['webhookSecret','secretHash','encryptionKey']);
      patch = { ...patch, notificationStatus: (hasSecretHash && config.webhookVerifiedAt) ? 'verified' : 'needs_dashboard_setup', lastVerifiedAt: now };
      message = hasSecretHash ? 'Flutterwave credentials verified. Paste the webhook URL in Flutterwave dashboard, then run/send a test webhook to mark it fully ready.' : 'Flutterwave credentials verified, but webhook secret/hash is required for safe webhook verification.';
      details = { ...details, needsDashboardSetup: true, webhookSecretRequired: !hasSecretHash };
    } else if (['manual','bank','cash','card'].includes(provider)) {
      patch = { ...patch, notificationStatus: 'not_required', lastVerifiedAt: now };
      message = `${providerLabel(provider)} does not require provider webhooks. Finance verification remains manual.`;
    } else {
      patch = { ...patch, notificationStatus: 'needs_dashboard_setup', lastVerifiedAt: now };
      message = `${providerLabel(provider)} notification URL is ready to copy into the provider dashboard.`;
    }
  } catch (error) {
    const failedPatch = { ...providerCallbackUrls(provider), notificationStatus: 'error', lastError: error.message, lastVerifiedAt: now, checkoutUrl: '' };
    await updateProviderConfigPatch({ scope, schoolCode: schoolCode || row.schoolCode, provider, patch: failedPatch, user });
    throw error;
  }

  const settings = await updateProviderConfigPatch({ scope, schoolCode: schoolCode || row.schoolCode, provider, patch, user });
  return { provider, scope, message, details, settings };
}

async function markProviderWebhookVerified({ payment, provider }) {
  if (!payment) return;
  const scope = payment.paymentType === PLATFORM ? 'platform' : 'school';
  await updateProviderConfigPatch({ scope, schoolCode: payment.schoolCode, provider, patch: { notificationStatus: 'verified', webhookVerifiedAt: new Date().toISOString(), lastError: '' } }).catch(() => null);
}

async function getParentAvailableMethods({ user, studentId }) {
  let schoolCode = user?.schoolCode;
  let student = null;
  if (studentId) {
    const parent = await Parent.findOne({ where: { userId: user.id } });
    if (!parent) throw new Error('Parent profile not found');
    student = await Student.findByPk(studentId, { include: [{ model: User, attributes: ['id','name','schoolCode','role'] }] });
    if (!student) throw new Error('Student not found');
    if (parent.hasStudent) {
      const ok = await parent.hasStudent(student).catch(() => false);
      if (!ok) throw new Error('Student is not linked to this parent');
    }
    schoolCode = student.schoolCode || student.User?.schoolCode || schoolCode;
  }
  const row = await getSchoolRow(schoolCode);
  const settings = serializeSettings(row);
  const activePublicConfig = settings.providers?.[settings.activeProvider] || {};
  const publicMethods = (settings.publicMethods || []).filter(m => settings.providers?.[m.provider]?.ready && settings.providers?.[m.provider]?.visibleToParent !== false);
  const parentProviders = Object.fromEntries(Object.entries(settings.providers || {})
    .filter(([, provider]) => provider.ready && provider.visibleToParent !== false && provider.enabled)
    .map(([key, provider]) => [key, {
      provider: key,
      enabled: true,
      ready: true,
      readiness: provider.readiness,
      parentReady: provider.parentReady,
      supportsStkPush: provider.supportsStkPush,
      supportsHostedCheckout: provider.supportsHostedCheckout,
      prompt: providerPromptType(key),
      statusMessage: provider.statusMessage
    }]));
  return {
    schoolCode,
    studentId: student?.id || studentId || null,
    activeProvider: settings.activeProvider,
    defaultProvider: settings.defaultProvider,
    enabledProviders: settings.enabledProviders,
    readyProviders: settings.readyProviders,
    providers: parentProviders,
    methods: publicMethods,
    paymentInstructions: settings.activeProvider && ['manual','bank','cash','card'].includes(settings.activeProvider) ? {
      method: settings.activeProvider,
      paybill: activePublicConfig.paybill || activePublicConfig.paybillNumber || activePublicConfig.shortcode || activePublicConfig.businessShortcode || '',
      till: activePublicConfig.till || activePublicConfig.tillNumber || '',
      bankName: activePublicConfig.bankName || '',
      accountName: activePublicConfig.accountName || '',
      accountNumber: activePublicConfig.accountNumber || activePublicConfig.bankAccount || '',
      branch: activePublicConfig.branch || '',
      instructions: activePublicConfig.manualInstructions || activePublicConfig.offlineInstructions || ''
    } : null
  };
}


async function getProviderSetupInfo({ scope = 'school', schoolCode, provider }) {
  provider = normalizeProvider(provider);
  const row = scope === 'platform' ? await getPlatformRow() : await getSchoolRow(schoolCode);
  const map = providerMap(row);
  const cfg = providerConfigFromMap(map, provider) || {};
  const urls = providerCallbackUrls(provider);
  const active = activeProviderFromRow(row);
  const readiness = parentReadyForStk(provider, cfg, active);
  return {
    scope,
    provider,
    providerConfigId: providerConfigIdFor({ scope, schoolCode: schoolCode || row.schoolCode || 'platform', provider }),
    activeProvider: active,
    websiteDomain: urls.websiteDomain,
    notificationUrl: urls.notificationUrl,
    webhookUrl: urls.webhookUrl,
    callbackUrl: urls.callbackUrl,
    stkCallbackUrl: urls.stkCallbackUrl || null,
    validationUrl: urls.validationUrl || null,
    confirmationUrl: urls.confirmationUrl || null,
    ipnId: cfg.ipnId || cfg.notificationId || '',
    notificationStatus: cfg.notificationStatus || readiness.notificationStatus || 'not_configured',
    status: readiness.status,
    statusMessage: readiness.message,
    supportsStkPush: readiness.supportsStkPush,
    parentReady: readiness.parentReady,
    lastVerifiedAt: cfg.lastVerifiedAt || cfg.webhookVerifiedAt || null,
    lastStkTestStatus: cfg.lastStkTestStatus || null,
    lastStkTestAt: cfg.lastStkTestAt || null,
    lastError: cfg.lastError || null,
    testLink: cfg.testLink || null,
    parentFacingUrls: false
  };
}

async function testProviderStk({ scope = 'school', schoolCode, provider, phone, amount = 1, user = null }) {
  provider = normalizeProvider(provider);
  const now = new Date().toISOString();
  const row = scope === 'platform' ? await getPlatformRow() : await getSchoolRow(schoolCode);
  const active = activeProviderFromRow(row);
  if (active && active !== provider) throw new Error(`${providerLabel(provider)} is not active for this ${scope}. Save it as active before testing the parent payment flow.`);
  const config = await getProviderConfig({ paymentType: scope === 'platform' ? PLATFORM : SCHOOL_FEE, schoolCode: schoolCode || row.schoolCode, provider });
  if (!phone && !['manual','bank','cash','card'].includes(provider) && !HOSTED_CHECKOUT_PROVIDERS.has(provider)) throw new Error('Test phone number is required for provider payment testing.');
  const reference = ref('PAYTEST');
  const payment = await Payment.create({
    schoolCode: scope === 'platform' ? 'platform' : (schoolCode || row.schoolCode),
    amount: cleanAmount(amount || 1),
    currency: 'KES',
    reference,
    method: ['manual','bank','cash','card'].includes(provider) ? provider : 'mobile_money',
    paymentGateway: provider,
    paymentType: 'provider_stk_test',
    paymentDestination: 'test',
    paidTo: 'test',
    accountReference: reference,
    status: 'test_pending',
    promptStatus: 'created',
    transactionType: 'provider_stk_test',
    source: user?.role || 'system',
    payerPhone: phone,
    metadata: { isProviderStkTest: true, applyToFees: false, provider, scope, actorUserId: user?.id || null, parentInternalPaymentFlow: true, noParentCheckoutUrl: true },
    auditTrail: [{ action: 'provider_payment_test_created', actorUserId: user?.id || null, at: now, provider }],
    expiresAt: new Date(Date.now() + 1000 * 60 * 30)
  });
  try {
    const prompt = await createProviderPrompt({ provider, payment, phone, email: user?.email || config.fallbackEmail, name: user?.name || 'ShuleAI test payer', config, method: payment.method });
    const hostedCheckout = ['checkout_url','hosted_checkout'].includes(prompt.promptType) && !!prompt.checkoutUrl;
    const nextStatus = prompt.promptType === 'manual_instructions' ? 'test_pending_verification' : (hostedCheckout ? 'test_pending_customer_action' : 'test_pending_provider_confirmation');
    await payment.update({
      status: nextStatus,
      promptStatus: prompt.status,
      promptType: prompt.promptType,
      checkoutUrl: hostedCheckout ? prompt.checkoutUrl : null,
      providerReference: prompt.providerReference || null,
      checkoutRequestId: prompt.checkoutRequestId || payment.checkoutRequestId,
      merchantRequestId: prompt.merchantRequestId || payment.merchantRequestId,
      transactionId: prompt.checkoutRequestId || prompt.providerReference || payment.transactionId,
      gatewayResponse: prompt.gatewayResponse || {},
      metadata: { ...(payment.metadata || {}), testMessage: prompt.message || 'Provider test payment request created.', providerAction: prompt.gatewayResponse?.providerAction || prompt.gatewayResponse?.parentFlow || null }
    });
    await updateProviderConfigPatch({ scope, schoolCode: schoolCode || row.schoolCode, provider, patch: { supportsStkPush: true, lastStkTestStatus: 'pending', lastStkTestAt: now, lastStkTestReference: reference, lastStkCheckoutRequestId: prompt.checkoutRequestId || null, lastError: '', notificationStatus: provider === 'mpesa' ? 'callback_attached_per_payment' : (config.notificationStatus || 'verified'), stkCallbackUrl: provider === 'mpesa' ? providerNotificationUrl('mpesa') : undefined }, user });
    const savedPayment = await payment.reload();
    return { provider, status: 'pending', testId: payment.id, reference, checkoutRequestId: prompt.checkoutRequestId || null, action: hostedCheckout ? { type: 'redirect', redirectUrl: safeHostedCheckoutUrl(savedPayment) } : null, message: (prompt.message || 'Provider test payment request created.') + ' This test will not update student balances.' };
  } catch (error) {
    await payment.update({ status: 'test_failed', promptStatus: 'provider_error', notes: error.message, metadata: { ...(payment.metadata || {}), providerError: error.message } }).catch(() => null);
    await updateProviderConfigPatch({ scope, schoolCode: schoolCode || row.schoolCode, provider, patch: { supportsStkPush: false, lastStkTestStatus: 'failed', lastStkTestAt: now, lastError: error.message }, user }).catch(() => null);
    throw error;
  }
}

async function getProviderTestStatus({ scope = 'school', schoolCode, provider, testId }) {
  provider = normalizeProvider(provider);
  const where = { id: testId, paymentGateway: provider, paymentType: 'provider_stk_test' };
  if (scope !== 'platform') where.schoolCode = schoolCode;
  const payment = await Payment.findOne({ where });
  if (!payment) throw new Error('Provider STK test not found for this scope.');
  const hostedCheckout = ['checkout_url','hosted_checkout'].includes(payment.promptType) && !!payment.checkoutUrl && payment.status === 'test_pending_customer_action';
  return { id: payment.id, provider, reference: payment.reference, status: payment.status, promptStatus: payment.promptStatus, checkoutRequestId: payment.checkoutRequestId, action: hostedCheckout ? { type: 'redirect', redirectUrl: safeHostedCheckoutUrl(payment) } : null, message: payment.metadata?.testMessage || payment.notes || '' };
}

async function initiateParentStkPayment({ user, body }) {
  const studentId = body.studentId;
  if (!studentId) throw new Error('studentId is required for parent school fee payment.');
  const { student } = await financeLedger.assertParentOwnsStudent({ parentUserId: user.id, studentId });
  const schoolCode = student.schoolCode || student.User?.schoolCode || user.schoolCode;
  const row = await getSchoolRow(schoolCode);
  const active = activeProviderFromRow(row);
  if (!active) throw new Error('No school payment provider is active for this child. Ask the school finance office to activate one provider.');
  if (['manual','bank','cash','card'].includes(active)) {
    const error = new Error('The school active method requires a payment reference, not an STK/online payment request.');
    error.statusCode = 409;
    throw error;
  }
  const map = providerMap(row);
  const cfg = providerConfigFromMap(map, active) || {};
  const readiness = parentReadyForStk(active, cfg, active);
  if (!readiness.parentReady) {
    throw new Error(`${providerLabel(active)} is not ready for parent payments: ${readiness.message || 'provider setup is incomplete'}`);
  }
  const method = active === 'stripe' || active === 'pesapal' ? 'card' : 'mobile_money';
  return initiatePayment({
    user,
    body: {
      studentId: Number(studentId),
      feeId: body.feeId || body.invoiceId || undefined,
      amount: body.amount,
      phone: body.phone || body.payerPhone || user?.phone || '',
      paymentType: 'school_fee',
      purpose: 'school_fee',
      paymentMethod: method,
      schoolCode,
      parentInternalPaymentFlow: true,
      metadata: { parentInternalPaymentFlow: true, noParentCheckoutUrl: true }
    }
  });
}

async function initiateParentManualPayment({ user, body }) {
  const studentId = Number(body.studentId);
  if (!studentId) throw new Error('studentId is required for parent school fee payment.');
  const { student } = await financeLedger.assertParentOwnsStudent({ parentUserId: user.id, studentId });
  const schoolCode = student.schoolCode || student.User?.schoolCode || user.schoolCode;
  const providerRow = await getSchoolRow(schoolCode);
  const activeProvider = activeProviderFromRow(providerRow);
  if (!['manual','bank','cash','card'].includes(activeProvider)) {
    const error = new Error('Manual reference submission is disabled. Use the school active online payment method.');
    error.statusCode = 409;
    throw error;
  }
  const reference = cleanManualReference(body.reference || body.mpesaCode || body.transactionCode);
  return initiatePayment({
    user,
    body: {
      studentId,
      feeId: body.feeId || body.invoiceId || undefined,
      amount: body.amount,
      phone: body.phone || body.payerPhone || user?.phone || '',
      reference,
      paymentType: 'school_fee',
      purpose: 'school_fee_manual_reference',
      paymentMethod: activeProvider === 'manual' ? 'manual' : activeProvider,
      schoolCode,
      parentInternalPaymentFlow: true,
      metadata: { parentInternalPaymentFlow: true, noParentCheckoutUrl: true, manualReferenceSubmitted: true }
    }
  });
}

async function testProviderConnection({ scope = 'school', schoolCode, user }) {
  const row = scope === 'platform' ? await getPlatformRow() : await getSchoolRow(schoolCode);
  const provider = activeProviderFromRow(row);
  if (!provider) throw new Error(scope === 'platform' ? 'No active platform provider configured.' : 'No active school provider configured.');
  const config = await getProviderConfig({ paymentType: scope === 'platform' ? PLATFORM : SCHOOL_FEE, schoolCode: schoolCode || row.schoolCode, provider });
  const verifiedAt = new Date().toISOString();
  const finish = async result => {
    await updateProviderConfigPatch({
      scope,
      schoolCode: schoolCode || row.schoolCode,
      provider,
      patch: { connectionVerifiedAt: verifiedAt, lastConnectionTestStatus: 'success', lastConnectionTestAt: verifiedAt, lastError: '' },
      user
    });
    return result;
  };

  try {
    if (provider === 'mpesa') {
      const token = await daraja.getAccessToken(config);
      return finish({ provider, ok: true, message: 'M-Pesa/Daraja credentials are valid. STK Push can be initiated.', details: { tokenReceived: !!token, mode: config.mode || config.environment || 'sandbox', callbackUrl: config.callbackUrl || publicUrl('/api/payments/mpesa/callback') } });
    }
    if (provider === 'pesapal') {
      let notificationId = config.ipnId || config.notificationId || config.notification_id || process.env.PESAPAL_IPN_ID;
      let registered = null;
      if (!notificationId) {
        registered = await registerPesapalIpn({ ...config, ipnUrl: config.ipnUrl || config.webhookUrl || publicUrl('/api/payments/webhook/pesapal') });
        notificationId = registered.notificationId;
        await persistProviderConfig({ scope, schoolCode, provider, patch: { ipnId: notificationId, notificationId, ipnUrl: registered.ipnUrl, webhookUrl: registered.ipnUrl } });
      } else {
        await getPesapalToken(config);
      }
      return finish({ provider, ok: true, message: registered ? 'PesaPal connected. IPN was registered and saved automatically.' : 'PesaPal connected. Consumer credentials and IPN ID are valid.', details: { ipnId: notificationId, ipnUrl: registered?.ipnUrl || config.ipnUrl || config.webhookUrl || publicUrl('/api/payments/webhook/pesapal') } });
    }
    if (provider === 'paystack') {
      await verifyPaystackCredentials(config);
      return finish({ provider, ok: true, message: 'Paystack credentials were verified with Paystack.' });
    }
    if (provider === 'flutterwave') {
      await verifyFlutterwaveCredentials(config);
      return finish({ provider, ok: true, message: 'Flutterwave credentials were verified with Flutterwave.' });
    }
    if (provider === 'stripe') {
      if (!config.secretKey) throw new Error('Stripe secret key is missing.');
      const account = await requestJson({ method: 'GET', hostname: 'api.stripe.com', path: '/v1/account', headers: { Authorization: `Bearer ${config.secretKey}`, Accept: 'application/json' } });
      return finish({ provider, ok: true, message: 'Stripe credentials were verified with Stripe.', details: { accountId: account?.id || null, liveMode: account?.livemode === true } });
    }
    if (['manual','bank','cash','card'].includes(provider)) {
      return finish({ provider, ok: true, message: `${providerLabel(provider)} is enabled. Payments will enter the verification queue.` });
    }
    return finish({ provider, ok: true, message: `${providerLabel(provider)} is configured.` });
  } catch (error) {
    await updateProviderConfigPatch({
      scope,
      schoolCode: schoolCode || row.schoolCode,
      provider,
      patch: { lastConnectionTestStatus: 'failed', lastConnectionTestAt: verifiedAt, lastError: error.message },
      user
    }).catch(() => null);
    throw error;
  }
}

module.exports = {
  PROVIDERS,
  PAYMENT_METHODS,
  SCHOOL_FEE,
  PLATFORM,
  getSettings,
  saveSchoolProviderSettings,
  savePlatformProviderSettings,
  initiatePayment,
  handleWebhook,
  getPaymentStatus,
  getPaymentContinuation,
  findAccessiblePayment,
  initiateParentStkPayment,
  initiateParentManualPayment,
  reconcilePayment,
  testProviderConnection,
  testProviderStk,
  getProviderTestStatus,
  getProviderSetupInfo,
  setupProviderNotifications,
  getParentAvailableMethods,
  updateProviderConfigPatch,
  queryPesapalTransactionStatus,
  listPesapalIpns,
  registerPesapalIpn,
  normalizeProvider,
  normalizePaymentType,
  normalizePaymentMethod,
  providerReadiness,
  providerNotificationUrl,
  providerValidationUrl,
  providerConfirmationUrl,
  providerConfigIdFor,
  certificationDecision
};
