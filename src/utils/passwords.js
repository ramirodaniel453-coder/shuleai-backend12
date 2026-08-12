const crypto = require('crypto');

function generateTemporaryPassword(length = 14) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) out += alphabet[bytes[i] % alphabet.length];
  if (!/[A-Z]/.test(out)) out = 'A' + out.slice(1);
  if (!/[a-z]/.test(out)) out = out.slice(0, 1) + 'a' + out.slice(2);
  if (!/[0-9]/.test(out)) out = out.slice(0, 2) + '7' + out.slice(3);
  if (!/[!@#$%]/.test(out)) out = out.slice(0, 3) + '!' + out.slice(4);
  return out;
}

module.exports = { generateTemporaryPassword };
