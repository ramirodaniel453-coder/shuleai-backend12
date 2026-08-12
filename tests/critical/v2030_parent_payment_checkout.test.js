const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const routeFile = path.join(root, 'backend/src/routes/paymentRoutes.js');
const lockedController = path.join(root, 'backend/src/controllers/lockedPaymentController.js');
const engineFile = path.join(root, 'backend/src/services/paymentProviderEngine.js');
const apiFile = path.join(root, 'frontend/js/api.js');
const parentDashboard = path.join(root, 'frontend/js/parent-dashboard.js');

test('v2030 parent fee checkout route and API exist', () => {
  const routes = fs.readFileSync(routeFile, 'utf8');
  const controller = fs.readFileSync(lockedController, 'utf8');
  const api = fs.readFileSync(apiFile, 'utf8');
  assert.match(routes, /router\.post\('\/parent\/initiate',[\s\S]*locked\.initiateParentFeePayment\)/);
  assert.match(controller, /exports\.initiateParentFeePayment/);
  assert.match(api, /initiateParentFee:\s*\(data\)\s*=>\s*apiRequest\('\/api\/payments\/parent\/initiate'/);
});

test('v2030 parent dashboard has visible amount input and summary', () => {
  const ui = fs.readFileSync(parentDashboard, 'utf8');
  assert.match(ui, /id="payment-amount"[^>]*placeholder="Enter amount to pay"/);
  assert.match(ui, /setParentFeeAmountMode\('full'\)/);
  assert.match(ui, /setParentFeeAmountMode\('custom'\)/);
  assert.match(ui, /parent-pay-amount-label/);
  assert.match(ui, /processSchoolFeeProviderPayment/);
});

test('v2030 backend validates parent fee amount against selected outstanding balance', () => {
  const engine = fs.readFileSync(engineFile, 'utf8');
  assert.match(engine, /Payment amount must be a whole number of at least 1/);
  assert.match(engine, /Amount exceeds outstanding balance/);
  assert.match(engine, /assertParentOwnsStudent/);
  assert.match(engine, /This fee account has no outstanding balance/);
});
