'use strict';

const crypto = require('crypto');

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomCode(length = 12) {
  if (!Number.isInteger(length) || length < 4 || length > 64) throw new Error('Invalid code length');
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

function yearlyBusinessId(prefix, length = 12) {
  return `${prefix}-${new Date().getFullYear()}-${randomCode(length)}`;
}

function transactionId(prefix = 'TXN') {
  return `${prefix}-${crypto.randomUUID().toUpperCase()}`;
}

module.exports = { randomCode, yearlyBusinessId, transactionId };
