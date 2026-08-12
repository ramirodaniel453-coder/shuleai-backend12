const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');

test('required env config enforces core production secrets', () => {
  const file = fs.readFileSync(path.join(root, 'src/config/requiredEnv.js'), 'utf8');
  for (const key of ['JWT_SECRET', 'JWT_EXPIRE', 'SUPER_ADMIN_SECRET', 'PAYMENT_VAULT_KEY', 'DATABASE_URL', 'PUBLIC_API_BASE_URL']) {
    assert.match(file, new RegExp(key));
  }
});

test('media assets support durable external storage fields', () => {
  const model = fs.readFileSync(path.join(root, 'src/models/MediaAsset.js'), 'utf8');
  assert.match(model, /storageProvider/);
  assert.match(model, /externalUrl/);
  const service = fs.readFileSync(path.join(root, 'src/services/mediaAssetService.js'), 'utf8');
  assert.match(service, /uploadPersistentObject/);
});

test('frontend error monitoring is loaded when frontend is present', (t) => {
  const indexPath = path.join(root, '..', 'frontend/index.html');
  if (!fs.existsSync(indexPath)) {
    t.skip('frontend directory is not included in backend-only package');
    return;
  }
  const index = fs.readFileSync(indexPath, 'utf8');
  assert.match(index, /js\/error-monitoring\.js/);
});
