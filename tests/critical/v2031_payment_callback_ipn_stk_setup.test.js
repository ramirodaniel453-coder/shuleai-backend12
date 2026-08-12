const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const service = fs.readFileSync(path.join(root, 'src/services/paymentProviderEngine.js'), 'utf8');
const routes = fs.readFileSync(path.join(root, 'src/routes/paymentRoutes.js'), 'utf8');
const frontendApi = fs.readFileSync(path.resolve(root, '../frontend/js/api.js'), 'utf8');
const parentDash = fs.readFileSync(path.resolve(root, '../frontend/js/parent-dashboard.js'), 'utf8');
const finance = fs.readFileSync(path.resolve(root, '../frontend/js/finance-fees.js'), 'utf8');

test('v2031 canonical callback URLs use PUBLIC_API_BASE_URL and reject old Render domain', () => {
  assert.match(service, /canonicalPublicApiBase/);
  assert.match(service, /PUBLIC_API_BASE_URL is required/);
  assert.match(service, /shuleaibackend-32h1\\\.onrender\\\.com|shuleaibackend-32h1\.onrender\.com/);
  assert.match(service, /providerCallbackUrls/);
});

test('v2031 setup info, setup notification, test STK, and parent STK routes exist', () => {
  assert.match(routes, /\/admin\/providers\/:provider\/setup-info/);
  assert.match(routes, /\/admin\/providers\/:provider\/setup-notifications/);
  assert.match(routes, /\/admin\/providers\/:provider\/test-stk/);
  assert.match(routes, /\/parent\/stk\/initiate/);
  assert.match(frontendApi, /getSchoolProviderSetupInfo/);
  assert.match(frontendApi, /testSchoolProviderStk/);
  assert.match(frontendApi, /initiateParentStk/);
});

test('v2031 parent school-fee payment follows the active provider plus manual fallback', () => {
  assert.match(parentDash, /initiateParentStk/);
  assert.match(parentDash, /Send Phone Prompt/);
  assert.match(parentDash, /Continue to Secure Checkout/);
  assert.match(parentDash, /continueCheckout/);
  assert.match(parentDash, /Manual Verification/);
  assert.doesNotMatch(parentDash, /Backend opened checkout/);
});

test('v2031 provider card shows generated URLs and STK test state instead of checkout test URL field', () => {
  assert.match(finance, /Website Domain/);
  assert.match(finance, /Notification \/ Callback URL/);
  assert.match(finance, /Test Secure Checkout/);
  assert.match(finance, /Test Phone Prompt/);
  assert.doesNotMatch(finance, /Checkout URL \/ test link/);
});
