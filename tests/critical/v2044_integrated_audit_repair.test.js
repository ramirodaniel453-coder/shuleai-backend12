const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const backend = path.join(__dirname, '..', '..');
const root = path.join(backend, '..');
const read = relative => fs.readFileSync(path.join(backend, relative), 'utf8');
const readRoot = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('v2044 platform settings persist and backup no longer fabricates success', () => {
  const controller = read('src/controllers/superAdminController.js');
  const settings = read('src/services/platformSettingsService.js');
  const backup = read('src/services/platformBackupService.js');
  assert.match(settings, /PlatformSetting\.findOrCreate/);
  assert.match(controller, /enqueueJob\('database-backup'/);
  assert.match(backup, /pg_dump/);
  assert.match(backup, /pg_restore/);
  assert.match(backup, /sha256/i);
  assert.doesNotMatch(controller, /size:\s*['"]?0\s*MB/i);
});

test('v2044 full export explicitly excludes credentials', () => {
  const controller = read('src/controllers/superAdminController.js');
  assert.match(controller, /exclude:\s*\[[^\]]*['"]password['"]/);
  assert.match(controller, /passwordIssuedAt/);
});

test('v2044 parent absence reporting cannot directly mutate attendance', () => {
  const controller = read('src/controllers/parentController.js');
  const start = controller.indexOf('exports.reportAbsence');
  const end = controller.indexOf('\nexports.', start + 10);
  const body = controller.slice(start, end > start ? end : controller.length);
  assert.match(body, /AbsenceReport\.create/);
  assert.doesNotMatch(body, /Attendance\.(create|update|upsert|findOrCreate)/);
});

test('v2044 LearnFeed public signup cannot self-verify as teacher', () => {
  const controller = read('src/controllers/learnFeedController.js');
  const model = read('src/models/LearnFeedUser.js');
  assert.match(controller, /role:\s*'student'/);
  assert.match(controller, /verificationStatus:\s*requestedRole\s*===\s*'teacher'\s*\?\s*'pending'/);
  assert.match(model, /verificationStatus === 'verified'/);
  assert.match(model, /yearlyBusinessId\('LF'/);
});

test('v2044 migration owns schema changes and quarantines invalid fee structure IDs', () => {
  const migration = read('src/migrations/20260807000000-v2044-integrated-audit-repair.js');
  const server = read('server.js');
  assert.match(migration, /SchemaRepairQuarantine/);
  assert.match(migration, /feeStructureId/);
  assert.match(migration, /addFkIfClean/);
  assert.doesNotMatch(server, /sequelize\.sync\(/);
});

test('v2044 security sources contain safe DOM helpers, CSV neutralization, and hardened media checks', () => {
  const security = readRoot('frontend/js/security.js');
  const helpers = readRoot('frontend/js/helpers.js');
  const media = read('src/services/mediaAssetService.js');
  assert.match(security, /html/);
  assert.match(security, /url/);
  assert.ok(helpers.includes('/^[=+\\-@\\t\\r]/'), 'CSV cells beginning with formula operators must be neutralized');
  assert.match(media, /detectMimeFromBuffer/);
  assert.match(media, /svg/i);
});

test('v2044 active frontend scripts have one top-level owner per shared function name', () => {
  const index = readRoot('frontend/index.html');
  const scriptNames = [...index.matchAll(/<script[^>]+src=["']([^"']+\.js)(?:\?[^"']*)?["']/g)].map(m => m[1]).filter(x => !/^https?:/.test(x));
  const seen = new Map();
  const duplicates = [];
  for (const name of scriptNames) {
    const src = readRoot('frontend/' + name);
    for (const m of src.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm)) {
      if (seen.has(m[1])) duplicates.push([m[1], seen.get(m[1]), name]); else seen.set(m[1], name);
    }
  }
  assert.deepEqual(duplicates, []);
});

test('v2044 PWA icon metadata points to real-sized generated assets', () => {
  const manifest = JSON.parse(readRoot('frontend/manifest.json'));
  assert.match(manifest.icons[0].src, /\/?assets\/icon-192\.png$/);
  assert.equal(manifest.icons[0].sizes, '192x192');
  assert.match(manifest.icons[1].src, /\/?assets\/icon-512\.png$/);
  assert.equal(manifest.icons[1].sizes, '512x512');
});

test('v2044 final closure preserves rows and forward-repairs already-recorded installations', () => {
  const migrationsDir = path.join(backend, 'src/migrations');
  const sources = fs.readdirSync(migrationsDir)
    .filter(name => name.endsWith('.js'))
    .map(name => fs.readFileSync(path.join(migrationsDir, name), 'utf8'));
  assert.equal(sources.some(source => /\bDELETE\s+FROM\b/i.test(source)), false, 'migration deletes production rows');
  const closure = read('src/migrations/20260810000000-v2044-final-integrity-closure.js');
  assert.match(closure, /canonicalRepair\.up/);
  assert.match(closure, /countsBefore|const before = await counts/);
  assert.match(closure, /SchemaRepairQuarantine/);
  assert.match(closure, /reviewedByUserId/);
  assert.match(closure, /failedAt/);
  assert.match(closure, /forward-only/i);
});

test('v2044 canonical absence review and backup failure fields match their migrations', () => {
  const absence = read('src/models/AbsenceReport.js');
  const backup = read('src/models/PlatformBackup.js');
  const migration = read('src/migrations/20260807000000-v2044-integrated-audit-repair.js');
  assert.match(absence, /reviewedBy:\{type:DataTypes\.INTEGER/);
  assert.match(migration, /reviewedBy:\s*\{ type: Sequelize\.INTEGER/);
  assert.match(backup, /failedAt/);
  assert.match(migration, /failedAt/);
});

test('v2044 HTTP headers and Socket.IO use the same exact CORS authority', () => {
  const context = read('src/middleware/requestContext.js');
  const app = read('src/app.js');
  const server = read('server.js');
  assert.match(context, /require\(['"]\.\.\/config\/corsOrigins['"]\)/);
  assert.match(context, /isAllowedOrigin\(origin\)/);
  assert.doesNotMatch(context, /github\\\.io|originAllowed/);
  assert.match(app, /isAllowedOrigin\(origin\)/);
  assert.match(server, /isAllowedOrigin\(origin\)/);
});

test('v2044 production cannot invoke demo seeding and startup does not auto-migrate', () => {
  const owner = read('src/controllers/ownerHardeningController.js');
  const pkg = JSON.parse(read('package.json'));
  assert.match(owner, /NODE_ENV === 'production'[\s\S]{0,160}Demo seeding is disabled/);
  assert.match(owner, /sequelize\.query\('SELECT 1'\)/);
  assert.equal(pkg.scripts.prestart, undefined);
  assert.equal(pkg.scripts['render:predeploy'], undefined);
  assert.equal(pkg.scripts.migrate, 'node runMigrations.js');
  assert.equal(fs.existsSync(path.join(backend, 'scripts/prestartMigrate.js')), false);
});

test('v2044 every CSV export neutralizes spreadsheet formula prefixes', () => {
  for (const file of [
    readRoot('frontend/js/helpers.js'),
    readRoot('frontend/js/finance-fees.js'),
    read('src/controllers/advancedAnalyticsController.js'),
    read('src/controllers/analyticsV152Controller.js')
  ]) assert.ok(file.includes('/^[=+\\-@\\t\\r]/'), 'CSV formula neutralization missing');
});

test('v2044 strict password policy is reusable and rejects weak credentials', () => {
  const { passwordPolicyErrors } = require('../../src/utils/passwordPolicy');
  assert.ok(passwordPolicyErrors('Password123!').length > 0);
  assert.deepEqual(passwordPolicyErrors('N7!qX2#vL9@p'), []);
});

test('v2044 feeStructureId remains an integer across models, migrations, and service writes', () => {
  const roots = ['src/models', 'src/migrations', 'src/services', 'src/controllers'];
  for (const directory of roots) {
    const files = [];
    const visit = current => {
      for (const entry of fs.readdirSync(path.join(backend, current), { withFileTypes: true })) {
        const relative = path.join(current, entry.name);
        if (entry.isDirectory()) visit(relative);
        else if (entry.name.endsWith('.js')) files.push(relative);
      }
    };
    visit(directory);
    for (const file of files) {
      const source = read(file);
      assert.doesNotMatch(source, /feeStructureId\s*:\s*\{[^}]*DataTypes\.STRING/s, `${file} defines feeStructureId as STRING`);
      assert.doesNotMatch(source, /feeStructureId[^\n]{0,80}(?:String\(|\.toString\()/, `${file} writes feeStructureId as text`);
    }
  }
});
