const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const backend = path.join(__dirname, '..', '..');
const root = path.join(backend, '..');
const readBackend = relative => fs.readFileSync(path.join(backend, relative), 'utf8');
const readRoot = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('detailed diagnostics require super-admin and runtime schema repair endpoint is removed', () => {
  const app = readBackend('src/app.js');
  assert.match(app, /app\.get\('\/api\/health\/detailed', protect,[\s\S]{0,120}authorize\('super_admin'\)/);
  assert.doesNotMatch(app, /\/api\/system\/repair-schema/);
});

test('development seed refuses production, requires opt-in, and never mutates schema', () => {
  const seed = readBackend('src/utils/seed.js');
  assert.match(seed, /NODE_ENV === 'production'/);
  assert.match(seed, /ALLOW_DESTRUCTIVE_SEED/);
  assert.doesNotMatch(seed, /sequelize\.sync\(|ALTER TABLE|CREATE TABLE/);
  assert.match(seed, /sequelize\.authenticate/);
});

test('background jobs use PostgreSQL storage and implemented handlers', () => {
  const model = readBackend('src/models/BackgroundJob.js');
  const queue = readBackend('src/services/jobQueue.js');
  const worker = readBackend('src/workers/jobWorker.js');
  const migration = readBackend('src/migrations/20260728000000-v2043-durable-background-jobs.js');
  assert.match(model, /tableName: 'BackgroundJobs'/);
  assert.match(queue, /transaction\.LOCK\.UPDATE/);
  assert.match(queue, /skipLocked: true/);
  assert.doesNotMatch(queue, /job-queue\.json|writeFileSync/);
  assert.match(worker, /processStudentUpload/);
  assert.match(worker, /processMarksUpload/);
  assert.match(worker, /createPublishedVersion/);
  assert.match(migration, /createTable\('BackgroundJobs'/);
});

test('LearnFeed completion has real persistence and no exposed 501 stubs', () => {
  const controller = readBackend('src/controllers/learnFeedController.js');
  assert.doesNotMatch(controller, /FEATURE_NOT_IMPLEMENTED|unavailableFeature|status\(501\)/);
  assert.match(controller, /LearnFeedWalletTransaction/);
  assert.match(controller, /callStudentTutorAI/);
  assert.match(controller, /sourceVideoId/);
  assert.match(controller, /kind: 'live_chat'/);
  assert.match(controller, /pending_review/);
  assert.match(controller, /saveUploadAsset/);
  assert.match(controller, /allowedMimePrefixes: \['video\/'\]/);
  assert.match(controller, /mediaAssetToken/);
});

test('request history is database-backed and broken app download is not advertised', () => {
  const routes = readBackend('src/routes/nationalRolloutRoutes.js');
  const html = readRoot('frontend/index.html');
  assert.match(routes, /SchoolNameRequest\.findAll/);
  assert.match(routes, /ApprovalRequest\.findAll/);
  assert.doesNotMatch(routes, /requests\/history'[\s\S]{0,100}ok\(res, \[\]\)/);
  assert.doesNotMatch(html, /downloads\/shule-ai-learnfeed-mobile-app\.zip/);
  assert.match(html, /Mobile Build Pending Verification/);
});

test('dependency lock has the hardened archive overrides', () => {
  const pkg = JSON.parse(readBackend('package.json'));
  assert.equal(pkg.version, '2.1.545');
  assert.equal(pkg.overrides['socket.io-parser'], '4.2.7');
  assert.equal(pkg.overrides['brace-expansion'], '5.0.9');
  assert.match(pkg.overrides.archiver, /^(\^)?8\./);
  assert.match(pkg.overrides['readdir-glob'], /^(\^)?3\./);
  assert.equal(Object.hasOwn(pkg.dependencies, 'multer'), false);
});
