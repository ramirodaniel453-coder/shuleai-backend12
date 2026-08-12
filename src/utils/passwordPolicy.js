'use strict';

const COMMON_FRAGMENTS = [
  'password', 'passw0rd', 'qwerty', 'letmein', 'welcome', 'admin123',
  'student123', 'teacher123', 'shuleai123', '12345678'
];

function passwordPolicyErrors(value, userInputs = []) {
  const password = String(value || '');
  const errors = [];
  if (password.length < 12 || password.length > 128) errors.push('must be 12–128 characters');
  if (!/[a-z]/.test(password)) errors.push('must include a lowercase letter');
  if (!/[A-Z]/.test(password)) errors.push('must include an uppercase letter');
  if (!/[0-9]/.test(password)) errors.push('must include a number');
  if (!/[^A-Za-z0-9\s]/.test(password)) errors.push('must include a symbol');
  if (/\s{3,}/.test(password)) errors.push('must not contain long whitespace runs');
  if (/(.)\1{3,}/i.test(password)) errors.push('must not repeat one character four or more times');

  const normalized = password.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (COMMON_FRAGMENTS.some(fragment => normalized.includes(fragment.replace(/[^a-z0-9]/g, '')))) {
    errors.push('is too common or predictable');
  }
  for (const input of userInputs) {
    const candidate = String(input || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (candidate.length >= 4 && normalized.includes(candidate)) {
      errors.push('must not contain your name, email, phone, or identifier');
      break;
    }
  }
  return [...new Set(errors)];
}

function assertStrongPassword(value, userInputs = []) {
  const errors = passwordPolicyErrors(value, userInputs);
  if (errors.length) {
    const error = new Error(`Password ${errors.join('; ')}.`);
    error.code = 'WEAK_PASSWORD';
    error.status = 400;
    error.details = errors;
    throw error;
  }
  return true;
}

module.exports = { passwordPolicyErrors, assertStrongPassword };
