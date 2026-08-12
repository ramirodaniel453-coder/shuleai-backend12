const crypto = require('crypto');

const ALGO = 'aes-256-gcm';

function key() {
  const raw = process.env.PAYMENT_VAULT_KEY;
  if (!raw) {
    throw new Error('PAYMENT_VAULT_KEY is required before payment provider credentials can be encrypted/decrypted.');
  }
  return crypto.createHash('sha256').update(String(raw)).digest();
}

function encrypt(value) {
  if (value === undefined || value === null || value === '') return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key(), iv);
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `vault:v1:${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

function decrypt(value, options = {}) {
  if (!value) return '';
  const raw = String(value);
  if (!raw.startsWith('vault:v1:')) return raw;
  try {
    const [, , ivB64, tagB64, dataB64] = raw.split(':');
    const decipher = crypto.createDecipheriv(ALGO, key(), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
  } catch (error) {
    if (options.silent !== true) console.error('[payment-vault] decrypt failed:', error.message);
    return '';
  }
}

function mask(value) {
  const text = String(value || '');
  if (!text) return '';
  if (text.startsWith('vault:v1:')) return '••••••••';
  if (text.length <= 6) return '••••';
  return `${text.slice(0, 3)}••••${text.slice(-3)}`;
}

function publicProvider(provider = {}) {
  const copy = { ...provider };
  const safePublicFields = new Set(['provider','enabled','methods','publicKey','publishableKey','shortcode','environment','mode','callbackUrl','returnUrl','successUrl','cancelUrl','checkoutUrl','ipnId','updatedAt','updatedBy']);
  Object.keys(copy).forEach(k => {
    if (k !== 'credentials' && copy[k] && !safePublicFields.has(k) && /secret|key|pass|token|credential/i.test(k)) copy[k] = mask(copy[k]);
  });
  if (copy.credentials && typeof copy.credentials === 'object' && !Array.isArray(copy.credentials)) {
    copy.credentials = Object.fromEntries(Object.entries(copy.credentials).map(([k,v]) =>
      /secret|key|pass|token|credential/i.test(k) ? [k, mask(v)] : [k, v]
    ));
  } else if (copy.credentials) {
    copy.credentials = mask(copy.credentials);
  }
  return copy;
}

function mergeEncryptedCredentials(existing = {}, incoming = {}, secretFields = []) {
  const next = { ...existing };
  Object.entries(incoming || {}).forEach(([field, value]) => {
    if (value === undefined || value === null) return;
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    if (text === '' || text.includes('••••')) return;
    const sensitive = secretFields.includes(field) || (!/^(public|publishable)/i.test(field) && /secret|private.?key|pass(key|word)?|access.?token|api.?key|consumer.?key|credential/i.test(field));
    if (sensitive) {
      next[field] = text.startsWith('vault:v1:') ? text : encrypt(text);
      return;
    }
    next[field] = value;
  });
  return next;
}

module.exports = { encrypt, decrypt, mask, publicProvider, mergeEncryptedCredentials };
