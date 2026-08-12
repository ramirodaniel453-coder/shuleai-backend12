const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const backend = path.join(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(backend, relative), 'utf8');

test('homework downloads require signed, expiring, school-scoped links', () => {
  const source = read('src/controllers/homeworkController.js');
  assert.match(source, /createHmac\('sha256'/);
  assert.match(source, /timingSafeEqual/);
  assert.match(source, /where: \{ schoolCode, attachments:/);
  assert.match(source, /where: \{ schoolCode, studentFeedback:/);
  assert.match(source, /Homework file link is invalid or expired/);
});

test('gamification endpoints enforce school ownership', () => {
  const source = read('src/controllers/gamificationController.js');
  assert.match(source, /Class\.findOne\(\{ where: \{ id: Number\(classId\), schoolCode: req\.user\.schoolCode \}/);
  assert.match(source, /Badge\.findOne\(\{ where: \{ id: Number\(badgeId\), schoolId: req\.user\.schoolCode \}/);
  assert.match(source, /Reward\.findOne\(\{ where: \{ id: Number\(rewardId\), schoolId: req\.user\.schoolCode, isActive: true \}/);
  assert.match(source, /parent\.hasStudent\(student\)/);
});

test('specific upload template route is declared before dynamic template route', () => {
  const source = read('src/routes/uploadRoutes.js');
  assert.ok(source.indexOf("'/template/marks'") < source.indexOf("'/template/:type'"));
});

test('critical finance migration reconciles canonical models without replaying obsolete migrations', () => {
  const source = read('src/migrations/20260722000000-v2037-critical-finance-schema-verification.js');
  assert.match(source, /reconcileModels/);
  assert.doesNotMatch(source, /paymentSchema|financialSchema|202606260/);
  assert.doesNotMatch(source, /f\."invoiceNumber"/);
  assert.match(source, /Critical finance schema verification failed/);
});

test('final migration repairs and verifies every registered model table and column', () => {
  const source = read('src/migrations/20260722010000-v2037-full-model-schema-verification.js');
  assert.match(source, /modelManager\.models/);
  assert.match(source, /reconcileModels/);
});

test('curriculum comparison is implemented and no longer returns 501', () => {
  const source = read('src/controllers/analyticsController.js');
  assert.doesNotMatch(source, /res\.status\(501\)/);
  assert.match(source, /currentCurriculum/);
  assert.match(source, /comparisons/);
});

test('parent message targets require parent authentication', () => {
  const source = read('src/routes/parentMessageRoutes.js');
  assert.match(source, /get\('\/message-targets', protect, authorize\('parent'\)/);
});

test('message deletion and class-teacher removal are tenant scoped', () => {
  assert.match(read('src/controllers/teacherController.js'), /Message\.findOne\(\{ where: \{ id: messageId, schoolCode: req\.user\.schoolCode \}/);
  assert.match(read('src/controllers/adminController.js'), /required: true, where: \{ schoolCode: req\.user\.schoolCode \}/);
});

test('deployment and seeding logs never print database URLs or super-admin secrets', () => {
  assert.doesNotMatch(read('src/utils/seedSuperAdmin.js'), /console\.log\([^\n]*SUPER_ADMIN_SECRET/);
  assert.doesNotMatch(read('runMigrations.js'), /DATABASE_URL\.substring/);
});
