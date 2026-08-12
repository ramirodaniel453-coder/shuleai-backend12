const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');

test('student set-first-password route is protected before use', () => {
  const file = fs.readFileSync(path.join(root, 'src/routes/studentRoutes.js'), 'utf8');
  const idxRoute = file.indexOf("set-first-password");
  assert.notEqual(idxRoute, -1, 'set-first-password route must exist');
  const idxProtect = file.lastIndexOf('protect', idxRoute);
  assert.ok(idxProtect !== -1 && idxProtect < idxRoute, 'protect middleware must appear before set-first-password route');
});

test('runtime schema mutation is removed and migrations are the sole authority', () => {
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  const schemaSafety = fs.readFileSync(path.join(root, 'src/utils/schemaSafety.js'), 'utf8');
  const accessGuard = fs.readFileSync(path.join(root, 'src/utils/accessSchemaGuard.js'), 'utf8');
  assert.doesNotMatch(server, /sequelize\.sync\(|ALTER TABLE|CREATE TABLE/);
  assert.doesNotMatch(schemaSafety, /ALTER TABLE|CREATE TABLE|ADD COLUMN|CREATE INDEX/);
  assert.doesNotMatch(accessGuard, /ALTER TABLE|CREATE TABLE|ADD COLUMN|CREATE INDEX/);
  assert.match(server, /Schema mutations are migration-only/);
});

test('legacy final report mockup override no longer replaces report renderer when frontend is present', (t) => {
  const overridePath = path.join(root, '..', 'frontend/js/final-locked-overrides.js');
  if (!fs.existsSync(overridePath)) {
    t.skip('frontend directory is not included in backend-only package');
    return;
  }
  const file = fs.readFileSync(overridePath, 'utf8');
  assert.doesNotMatch(file, /renderFinalReportCardMockup\s*=/);
});
