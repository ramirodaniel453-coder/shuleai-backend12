'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const appRoot = path.resolve(root, '..');
const readBackend = file => fs.readFileSync(path.join(root, file), 'utf8');
const readApp = file => fs.readFileSync(path.join(appRoot, file), 'utf8');

test('teacher report workflow exposes the gradebook API method it calls', () => {
  assert.match(readApp('frontend/js/api.js'), /getClassGradebook:\s*\(params/);
  assert.match(readApp('frontend/js/teacher-dashboard.js'), /api\.teacher\.getClassGradebook/);
});

test('API wrapper refreshes once on 401 and consent failures remain closed', () => {
  const api = readApp('frontend/js/api.js');
  assert.match(api, /response\.status === 401[\s\S]*refreshAuthToken\(\)[\s\S]*_authRetried: true/);
  const dashboard = readApp('frontend/js/dashboard-controller.js');
  assert.doesNotMatch(dashboard, /Consent check error:[\s\S]{0,180}return true/);
});

test('parental consent requires parent role and verified child ownership', () => {
  assert.match(readBackend('src/routes/consentRoutes.js'), /parental-consent', authorize\('parent'\)/);
  assert.match(readBackend('src/controllers/consentController.js'), /assertParentOwnsStudent\(\{ parentUserId: req\.user\.id, studentId \}\)/);
});

test('messages have first-class tenant and conversation columns with backfill migration', () => {
  const model = readBackend('src/models/Message.js');
  assert.match(model, /schoolCode:/);
  assert.match(model, /conversationId:/);
  const migration = readBackend('src/migrations/20260722020000-v2038-message-tenant-conversation-lock.js');
  assert.match(migration, /metadata"->>'schoolCode'/);
  assert.match(migration, /idx_messages_conversation_unread/);
});

test('conversation reads update only already-authorized scoped message IDs', () => {
  for (const file of ['src/controllers/parentMessageController.js', 'src/controllers/teacherMessageController.js']) {
    const source = readBackend(file);
    assert.match(source, /scopedIds/);
    assert.match(source, /id:\s*\{ \[Op\.in\]: scopedIds \}/);
  }
});

test('LearnFeed and worker operations are implemented without fake success', () => {
  const feed = readBackend('src/controllers/learnFeedController.js');
  assert.doesNotMatch(feed, /FEATURE_NOT_IMPLEMENTED|unavailableFeature/);
  for (const operation of ['remixVideo', 'likeComment', 'liveChat', 'liveGift', 'useSound', 'askAi', 'withdraw']) {
    assert.match(feed, new RegExp(`exports\\.${operation}\\s*=\\s*async`));
  }
  assert.match(feed, /LearnFeedWalletTransaction/);
  const worker = readBackend('src/workers/jobWorker.js');
  assert.doesNotMatch(worker, /accepted: true|handler is not implemented/);
  assert.match(worker, /processStudentUpload/);
  assert.match(worker, /processMarksUpload/);
  assert.match(worker, /createPublishedVersion/);
  const queue = readBackend('src/services/jobQueue.js');
  assert.match(queue, /BackgroundJob/);
  assert.match(queue, /skipLocked:\s*true/);
});

test('production migrations avoid describeTable timeout loops and use explicit DDL limits', () => {
  const runner = readBackend('runMigrations.js');
  const addColumnBlock = runner.slice(runner.indexOf('safe.addColumn'), runner.indexOf('safe.removeColumn'));
  assert.doesNotMatch(addColumnBlock, /describeTable/);
  assert.match(addColumnBlock, /columnExists/);
  assert.match(runner, /SET statement_timeout = '10min'/);
  assert.match(runner, /SET lock_timeout = '90s'/);
  const finance = readBackend('src/migrations/20260722000000-v2037-critical-finance-schema-verification.js');
  const full = readBackend('src/migrations/20260722010000-v2037-full-model-schema-verification.js');
  assert.doesNotMatch(finance, /describeTable/);
  assert.doesNotMatch(full, /describeTable/);
  assert.match(finance, /readSchema/);
  assert.match(full, /reconcileModels/);
  const reconciler = readBackend('src/migrations/lib/canonical-model-reconciler.js');
  assert.match(reconciler, /information_schema\.columns/);
});

test('every shipped frontend JavaScript file parses completely', () => {
  const directory = path.join(appRoot, 'frontend/js');
  for (const filename of fs.readdirSync(directory).filter(name => name.endsWith('.js'))) {
    const source = fs.readFileSync(path.join(directory, filename), 'utf8');
    assert.doesNotThrow(() => new vm.Script(source, { filename }), `${filename} must contain complete valid JavaScript`);
  }
});

test('specific API routers are mounted before the broad authenticated compatibility router', () => {
  const app = readBackend('src/app.js');
  const broad = app.indexOf("app.use('/api', nationalRolloutRoutes)");
  for (const mount of ["app.use('/api/fee-structures'", "app.use('/api/realtime'", "app.use('/api/monitoring'"]) {
    assert.ok(app.indexOf(mount) > -1 && app.indexOf(mount) < broad, `${mount} must precede the broad /api router`);
  }
});

test('admin management exposes complete database state while operational class selectors stay active-only', () => {
  const admin = readBackend('src/controllers/adminController.js');
  assert.match(admin, /const status = String\(req\.query\.status \|\| 'all'\)/);
  assert.match(admin, /Class\.count\(\{ where: \{ schoolCode \} \}\)/);
  assert.match(admin, /activeClasses/);
  assert.match(admin, /inactiveClasses/);
  const api = readApp('frontend/js/api.js');
  assert.match(api, /getActiveClasses: \(\) => apiRequest\('\/api\/admin\/classes\?status=active'\)/);
});

test('missing student profiles are repaired transactionally and audited', () => {
  const service = readBackend('src/services/studentProfileIntegrityService.js');
  assert.match(service, /pg_advisory_xact_lock/);
  assert.match(service, /LEFT JOIN "Students"/);
  assert.match(service, /Student\.create/);
  assert.match(service, /AuditLog\.create/);
  assert.match(service, /grade: 'Not Assigned'/);
  assert.match(service, /class_with_active_students_reactivated/);
  assert.match(service, /COALESCE\(s\.status::text, 'active'\) = 'active'/);
  const admin = readBackend('src/controllers/adminController.js');
  assert.match(admin, /studentProfileIntegrity\.reconcileSchool/);
});
