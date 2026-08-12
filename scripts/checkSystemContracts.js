const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const routesDir = path.join(root, 'backend', 'src', 'routes');
const frontendDir = path.join(root, 'frontend');
const appSource = fs.readFileSync(path.join(root, 'backend', 'src', 'app.js'), 'utf8');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
}

function normalizeRoute(value) {
  return String(value || '').split('?')[0]
    .replace(/\$\{[^}]+\}/g, ':value')
    .replace(/:[A-Za-z0-9_]+/g, ':value')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '') || '/';
}

function routeRegex(route) {
  return new RegExp(`^${route.split('/').map(part => part === ':value' ? '[^/]+' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('/')}$`);
}

function callSnippet(source, start) {
  const open = source.indexOf('(', start);
  if (open < 0) return '';
  let depth = 0; let quote = ''; let escaped = false;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === "'" || char === '"' || char === '`') { quote = char; continue; }
    if (char === '(') depth += 1;
    if (char === ')' && --depth === 0) return source.slice(start, index + 1);
  }
  return source.slice(start, start + 1000);
}

const imports = new Map();
for (const match of appSource.matchAll(/const\s+([A-Za-z0-9_]+)\s*=\s*require\(['"]\.\/routes\/([^'"]+)['"]\)/g)) imports.set(match[1], `${match[2]}.js`);
const mounts = new Map();
for (const match of appSource.matchAll(/app\.use\(\s*['"]([^'"]+)['"]\s*,(?:\s*[A-Za-z0-9_]+\s*,)*\s*([A-Za-z0-9_]+)\s*\)/g)) {
  if (imports.has(match[2])) {
    const filename = imports.get(match[2]);
    if (!mounts.has(filename)) mounts.set(filename, []);
    mounts.get(filename).push(match[1]);
  }
}

const routes = [];
const failures = [];
for (const filename of fs.readdirSync(routesDir).filter(name => name.endsWith('.js')).sort()) {
  const source = fs.readFileSync(path.join(routesDir, filename), 'utf8');
  const fileMounts = mounts.get(filename) || [];
  if (!fileMounts.length) failures.push(`Route file is not mounted in app.js: ${filename}`);
  const localEntries = [];
  for (const match of source.matchAll(/(?:router|r)\.(get|post|put|patch|delete)\(\s*['"]([^'"]+)['"]/g)) {
    const before = source.slice(0, match.index);
    localEntries.push({ file: filename, method: match[1].toUpperCase(), localPath: match[2], line: before.split('\n').length });
  }
  if (!localEntries.length) failures.push(`No route declarations detected: ${filename}`);
  const seen = new Map();
  for (const entry of localEntries) {
    const key = `${entry.method} ${entry.localPath}`;
    if (seen.has(key)) failures.push(`Duplicate route ${key} in ${filename}:${seen.get(key)} and ${entry.line}`);
    seen.set(key, entry.line);
  }
  for (let i = 0; i < localEntries.length; i += 1) {
    for (let j = i + 1; j < localEntries.length; j += 1) {
      const earlier = localEntries[i]; const later = localEntries[j];
      if (earlier.method !== later.method || earlier.localPath === later.localPath) continue;
      const a = earlier.localPath.split('/'); const b = later.localPath.split('/');
      if (a.length === b.length && a.every((part, index) => part.startsWith(':') || part === b[index])) failures.push(`Shadowed route ${later.method} ${later.localPath} at ${filename}:${later.line}; captured by ${earlier.localPath} at line ${earlier.line}`);
    }
  }
  for (const mount of fileMounts) routes.push(...localEntries.map(entry => ({ ...entry, path: normalizeRoute(`${mount}${entry.localPath}`) })));
}

const apiCalls = [];
for (const file of walk(frontendDir).filter(name => /\.(js|html)$/.test(name))) {
  const source = fs.readFileSync(file, 'utf8');
  for (const match of source.matchAll(/(?:apiRequest|uploadFile)\(\s*([`'"])(\/api\/[^`'"]+)\1/g)) {
    let raw = match[2].replace(/\$\{[^}]+\}/g, ':value');
    raw = raw.replace(/\$\{.*$/, '');
    const normalized = normalizeRoute(raw);
    if (!normalized.startsWith('/api/')) continue;
    const snippet = callSnippet(source, match.index);
    const explicitMethod = snippet.match(/\bmethod\s*:\s*['"](GET|POST|PUT|PATCH|DELETE)['"]/i)?.[1]?.toUpperCase();
    const method = source.slice(match.index, match.index + 10).startsWith('uploadFile') ? 'POST' : explicitMethod || 'GET';
    apiCalls.push({ file: path.relative(root, file), method, path: raw, normalized });
  }
}

for (const call of apiCalls) {
  if (!routes.some(route => route.method === call.method && routeRegex(route.path).test(call.normalized))) failures.push(`Frontend API has no backend route: ${call.file} -> ${call.method} ${call.path}`);
}

if (!routes.some(route => route.file === 'financeRoutes.js')) failures.push('financeRoutes.js is absent from the route inventory');
if (/res\.status\(501\)/.test(fs.readFileSync(path.join(root, 'backend', 'src', 'controllers', 'analyticsController.js'), 'utf8'))) failures.push('analyticsController still contains an exposed 501 implementation');

if (process.argv.includes('--write')) {
  fs.writeFileSync(path.join(root, 'backend', 'ROUTE_MANIFEST.json'), `${JSON.stringify({ build: '2045-academic-payment-completion-lock', count: routes.length, routes }, null, 2)}\n`);
  fs.writeFileSync(path.join(root, 'frontend', 'API_CALL_MANIFEST.json'), `${JSON.stringify({ build: '2045-academic-payment-completion-lock', count: apiCalls.length, apiCalls }, null, 2)}\n`);
}

if (failures.length) {
  failures.forEach(message => console.error(`[system-contract] ${message}`));
  process.exit(1);
}
console.log(`[system-contract] OK: ${routes.length} mounted route paths across ${mounts.size} route files; ${apiCalls.length} frontend API references matched`);
