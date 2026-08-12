const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const verifier = require(path.join(root, 'src/services/webhookVerificationService.js'));
const vault = require(path.join(root, 'src/services/paymentVaultService.js'));
const service = fs.readFileSync(path.join(root, 'src/services/paymentProviderEngine.js'), 'utf8');
const lockedController = fs.readFileSync(path.join(root, 'src/controllers/lockedPaymentController.js'), 'utf8');
const paymentController = fs.readFileSync(path.join(root, 'src/controllers/paymentController.js'), 'utf8');
const financeLedger = fs.readFileSync(path.join(root, 'src/services/financeLedgerService.js'), 'utf8');
const routes = fs.readFileSync(path.join(root, 'src/routes/paymentRoutes.js'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'src/migrations/20260720000000-v2033-payment-production-hardening.js'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'src/app.js'), 'utf8');
const parentDash = fs.readFileSync(path.resolve(root, '../frontend/js/parent-dashboard.js'), 'utf8');
const financeUi = fs.readFileSync(path.resolve(root, '../frontend/js/finance-fees.js'), 'utf8');
const adminDash = fs.readFileSync(path.resolve(root, '../frontend/js/admin-dashboard.js'), 'utf8');
const frontendIndex = fs.readFileSync(path.resolve(root, '../frontend/index.html'), 'utf8');
const serviceWorker = fs.readFileSync(path.resolve(root, '../frontend/service-worker.js'), 'utf8');

test('v2033 verifies Flutterwave modern webhook HMAC as base64 SHA-256', () => {
  const rawBody = Buffer.from(JSON.stringify({ id: 123, status: 'successful' }));
  const secret = 'test-flutterwave-webhook-secret';
  const signature = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
  const result = verifier.verifyWebhook({ provider: 'flutterwave', rawBody, headers: { 'flutterwave-signature': signature }, config: { webhookSecret: secret } });
  assert.equal(result.verified, true);
  assert.equal(result.method, 'flutterwave_hmac_sha256');
});

test('v2033 accepts current Stripe signatures and rejects replayed stale signatures', () => {
  const rawBody = Buffer.from(JSON.stringify({ id: 'evt_test' }));
  const secret = 'whsec_test';
  const current = Math.floor(Date.now() / 1000);
  const sign = timestamp => crypto.createHmac('sha256', secret).update(Buffer.concat([Buffer.from(`${timestamp}.`), rawBody])).digest('hex');
  const valid = verifier.verifyWebhook({ provider: 'stripe', rawBody, headers: { 'stripe-signature': `t=${current},v1=${sign(current)}` }, config: { webhookSecret: secret } });
  const stale = current - 3600;
  const replayed = verifier.verifyWebhook({ provider: 'stripe', rawBody, headers: { 'stripe-signature': `t=${stale},v1=${sign(stale)}` }, config: { webhookSecret: secret, webhookToleranceSeconds: 300 } });
  assert.equal(valid.verified, true);
  assert.equal(replayed.verified, false);
  assert.equal(replayed.reason, 'stale_stripe_signature');
});

test('v2033 locks one settings row/provider and protects continuation and status access', () => {
  assert.match(migration, /school_payment_settings_school_unique_v2033/);
  assert.match(migration, /platform_payment_settings_singleton_unique_v2033/);
  assert.match(migration, /jsonb_array_length/);
  assert.match(routes, /\/:reference\/continue[\s\S]*protect[\s\S]*locked\.getPaymentContinuation/);
  assert.match(routes, /\/:reference\/status[\s\S]*protect[\s\S]*locked\.getPaymentStatus/);
  assert.match(service, /assertPaymentAccess/);
  assert.match(service, /assertParentOwnsStudent/);
  assert.match(service, /needs_connection_test/);
  assert.match(service, /connectionVerifiedAt/);
  assert.match(service, /lastConnectionTestStatus = 'not_tested'/);
  assert.match(service, /supportsStkPush = false/);
  assert.match(service, /needs_callback_allowlist/);
  assert.match(appSource, /app\.set\('trust proxy', trustedProxyHops\)/);
});

test('v2033 parent checkout payload is whitelisted and hosted URL is fetched through protected continuation', () => {
  assert.match(service, /initiateParentStkPayment/);
  assert.match(service, /studentId: Number\(studentId\)/);
  assert.match(service, /safeHostedCheckoutUrl/);
  assert.match(service, /official HTTPS PesaPal host/);
  assert.doesNotMatch(service, /mode: 'static_checkout_url'/);
  assert.match(parentDash, /continueCheckout\(response\.data\.reference\)/);
  assert.doesNotMatch(parentDash, /provider: normalizedProvider \|\| undefined/);
  assert.doesNotMatch(service, /return \{ accepted: true, duplicateInProgress: true \}/);
  assert.match(service, /verificationMethod: verification\.method[\s\S]*processed: false/);
});

test('v2033 encrypts credential fields, preserves structured config, and masks nested credentials', () => {
  const previous = process.env.PAYMENT_VAULT_KEY;
  process.env.PAYMENT_VAULT_KEY = 'v2033-test-vault-key';
  try {
    const merged = vault.mergeEncryptedCredentials({}, {
      consumerKey: 'consumer-key',
      secretHash: 'webhook-hash',
      publicKey: 'pk_test_public',
      methods: ['card', 'mobile_money'],
      webhookEvents: ['checkout.session.completed']
    }, []);
    assert.match(merged.consumerKey, /^vault:v1:/);
    assert.match(merged.secretHash, /^vault:v1:/);
    assert.equal(vault.decrypt(merged.consumerKey), 'consumer-key');
    assert.deepEqual(merged.methods, ['card', 'mobile_money']);
    assert.deepEqual(merged.webhookEvents, ['checkout.session.completed']);
    assert.equal(merged.publicKey, 'pk_test_public');
    const publicConfig = vault.publicProvider({ credentials: { secretKey: 'hidden-secret', account: 'merchant-1' } });
    assert.notEqual(publicConfig.credentials.secretKey, 'hidden-secret');
    assert.equal(publicConfig.credentials.account, 'merchant-1');
  } finally {
    if (previous === undefined) delete process.env.PAYMENT_VAULT_KEY;
    else process.env.PAYMENT_VAULT_KEY = previous;
  }
});

test('v2033 exports every payment engine function called by the locked controller', () => {
  const called = [...lockedController.matchAll(/engine\.([A-Za-z0-9_]+)/g)].map(match => match[1]);
  const exportsBlock = service.slice(service.lastIndexOf('module.exports ='));
  for (const method of new Set(called)) {
    assert.match(exportsBlock, new RegExp(`\\b${method}\\b`), `payment engine must export ${method}`);
  }
  assert.match(exportsBlock, /\btestProviderStk\b/);
  assert.match(exportsBlock, /\bgetProviderTestStatus\b/);
  assert.match(exportsBlock, /\bgetProviderSetupInfo\b/);
});

test('v2033 saves provider credentials before live tests and invalidates the v2032 browser cache', () => {
  assert.match(financeUi, /financeV31TestConnection[\s\S]*await saveProviderAgentDraft\(provider\)/);
  assert.match(financeUi, /financeV31SetupProviderNotifications[\s\S]*await saveProviderAgentDraft\(provider\)/);
  assert.match(financeUi, /financeV31TestStk[\s\S]*await saveProviderAgentDraft\(provider\)/);
  assert.match(frontendIndex, /v2045-academic-payment-completion-lock/);
  assert.doesNotMatch(frontendIndex, /2032-single-active-provider-parent-payment-lock/);
  assert.match(serviceWorker, /shule-ai-v2045-academic-payment-completion-lock/);
});

test('parent school-fee UI and API keep online prompts separate from manual references', () => {
  assert.match(parentDash, /const payableFees = fees\.filter\(f => feeBalance\(f\) > 0\)/);
  assert.match(parentDash, /This child has no unpaid invoice/);
  assert.doesNotMatch(parentDash, /if \(!rows\.some\(row => row\.method === 'manual'\)\)/);
  assert.doesNotMatch(parentDash, /manualPaybill \|\| parentPaymentMethods\?\.paybill \|\| '123456'/);
  assert.match(parentDash, /\^\[A-Z0-9\]\[A-Z0-9\._\/-\]\{4,99\}\$/);
  assert.match(service, /Manual reference submission is disabled\. Use the school active online payment method\./);
  assert.match(service, /requires a payment reference, not an STK\/online payment request/);
  assert.match(service, /paymentInstructions:/);
});

test('subscription payments use role-safe endpoints and automatic platform-provider resolution', () => {
  assert.match(parentDash, /api\.payments\.parentSubscriptionSTK\(/);
  assert.doesNotMatch(parentDash, /initiateChildPlatformSubscriptionPayment[\s\S]{0,500}api\.payments\.initiate\(/);
  assert.match(adminDash, /api\.payments\.schoolSubscriptionSTK\(/);
  assert.doesNotMatch(adminDash, /submitSchoolSubscriptionSTK[\s\S]{0,900}api\.payments\.initiate\(/);
  assert.match(routes, /\/platform\/method[\s\S]*authorize\('parent', 'admin', 'super_admin'\)/);
  assert.match(service, /legacyMpesaConfigured/);
  assert.match(service, /resolvedSchoolCode = student\.schoolCode \|\| student\.User\?\.schoolCode/);
  assert.match(service, /if \(provider === 'manual'\) return \['manual'\]/);
  assert.match(service, /selectedMethod = normalizePaymentMethod\(method\) \|\| providerDefaultMethods\(active\)\[0\]/);
  assert.doesNotMatch(financeUi, /data-provider-method="manual" checked/);
  assert.doesNotMatch(financeUi, /\|\| '123456'/);
  assert.doesNotMatch(fs.readFileSync(path.resolve(root, '../frontend/js/superadmin-dashboard.js'), 'utf8'), /data-platform-provider-method="manual" checked/);
  assert.match(service, /cleanPlanAmount = cleanAmount\(subscriptionController\.planAmount\(plan, billingCycle\)\)/);
  assert.match(service, /Subscription price changed/);
  assert.match(financeLedger, /if \(schoolCode\) userWhere\.schoolCode = schoolCode/);
  assert.match(financeLedger, /schoolCode = student\.schoolCode \|\| student\.User\?\.schoolCode/);
  assert.match(paymentController, /status: \{ \[Op\.in\]: \['pending', 'pending_verification'\] \}/);
});

test('manual finance entry cannot be completed by the browser or approve an online provider payment', () => {
  assert.doesNotMatch(financeUi, /finance-tx-status|Approved \/ Successful now/);
  assert.doesNotMatch(financeUi, /const payload=\{[^}]*\bstatus\b/);
  assert.match(financeUi, /pending verification/);
  assert.match(paymentController, /const status = 'pending_verification'/);
  assert.match(paymentController, /transactionType: 'payment'/);
  assert.match(paymentController, /manualReviewOnly: true/);
  assert.match(financeLedger, /manualReviewOnly[\s\S]*where\.status = \{ \[Op\.in\]: \['pending', 'pending_verification'\] \}/);
  assert.match(financeLedger, /promptType: 'manual_instructions'/);
  assert.match(financeLedger, /paymentGateway: \{ \[Op\.in\]: \['manual', 'cash', 'bank'/);
});
