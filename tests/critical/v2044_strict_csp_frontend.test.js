'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const acorn = require('acorn');
const { JSDOM } = require('jsdom');

const frontend = path.join(__dirname, '../../../frontend');
const eventNames = 'click|change|input|submit|load|error|mouseover|keydown|keyup|focus|blur|dblclick|contextmenu';

function filesUnder(directory) {
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'vendor') continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...filesUnder(absolute));
    else if (/\.(?:html|js)$/.test(entry.name)) result.push(absolute);
  }
  return result;
}

function symbolicHandler(source) {
  let output = '';
  for (let index = 0; index < source.length;) {
    if (source[index] !== '$' || source[index + 1] !== '{') {
      output += source[index++];
      continue;
    }
    let depth = 1;
    let cursor = index + 2;
    let quote = null;
    let escaped = false;
    for (; cursor < source.length && depth; cursor += 1) {
      const character = source[cursor];
      if (quote) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === quote) quote = null;
        continue;
      }
      if (character === '"' || character === "'" || character === '`') quote = character;
      else if (character === '{') depth += 1;
      else if (character === '}') depth -= 1;
    }
    output += '1';
    index = cursor;
  }
  return output
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&#x0*27;/gi, "'")
    .replace(/&amp;/g, '&')
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'");
}

function sourceHandlers() {
  const handlers = [];
  const expression = new RegExp(`data-shule-on(${eventNames})\\s*=\\s*(["'])([\\s\\S]*?)\\2`, 'g');
  for (const file of filesUnder(frontend)) {
    const source = fs.readFileSync(file, 'utf8');
    let match;
    while ((match = expression.exec(source))) {
      handlers.push({ file, line: source.slice(0, match.index).split('\n').length, event: match[1], source: match[3] });
    }
  }
  return handlers;
}

test('v2044 frontend enforces same-origin scripts and contains no executable inline event attributes', () => {
  const index = fs.readFileSync(path.join(frontend, 'index.html'), 'utf8');
  assert.match(index, /script-src 'self';/);
  assert.match(index, /script-src-attr 'none';/);
  assert.doesNotMatch(index, /script-src[^;]*(?:'unsafe-inline'|'unsafe-eval'|https?:)/);
  assert.doesNotMatch(index, /<script(?![^>]*\bsrc=)/i);
  assert.doesNotMatch(index, /<script[^>]+src=["']https?:/i);
  assert.doesNotMatch(index, /shule-ai-backend-old|onrender\.com/i);

  const inlineAttribute = new RegExp(`(?:\\s|<)on(?:${eventNames})\\s*=`, 'i');
  for (const file of filesUnder(frontend)) {
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), inlineAttribute, `inline event attribute remains in ${file}`);
  }
});

test('legacy onclick selectors cannot silently bypass the strict CSP action attributes', () => {
  const staleSelector = /getAttribute\(\s*['"]onclick['"]\s*\)|querySelector(?:All)?\([^\n)]*\[onclick|\[onclick(?:[*^$|~]?=|\])/;
  for (const file of filesUnder(frontend)) {
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), staleSelector, `legacy onclick selector remains in ${file}`);
  }
});

test('all shipped CSP data actions parse as JavaScript without eval', () => {
  const handlers = sourceHandlers();
  assert.ok(handlers.length >= 800, `expected complete action inventory, found ${handlers.length}`);
  const failures = [];
  for (const handler of handlers) {
    try {
      acorn.parse(symbolicHandler(handler.source), { ecmaVersion: 2022, allowReturnOutsideFunction: true });
    } catch (error) {
      failures.push(`${path.relative(frontend, handler.file)}:${handler.line} ${error.message}`);
    }
  }
  assert.deepEqual(failures, []);

  const bridge = fs.readFileSync(path.join(frontend, 'js/csp-events.js'), 'utf8');
  assert.doesNotMatch(bridge, /\beval\s*\(|\bnew\s+Function\b/);
});

test('CSP event bridge dispatches data actions and honors return false', () => {
  const dom = new JSDOM('<!doctype html><button id="action" data-id="7" data-value="safe" data-shule-onclick="testAction(Number(this.dataset.id), this.dataset.value); return false">Run</button>', {
    runScripts: 'outside-only',
    url: 'https://shuleai.live/'
  });
  const { window } = dom;
  window.acorn = acorn;
  let received = null;
  window.testAction = (id, value) => { received = { id, value }; };
  window.eval(fs.readFileSync(path.join(frontend, 'js/csp-events.js'), 'utf8'));

  const event = new window.MouseEvent('click', { bubbles: true, cancelable: true });
  const dispatchResult = window.document.getElementById('action').dispatchEvent(event);
  assert.deepEqual(received, { id: 7, value: 'safe' });
  assert.equal(dispatchResult, false);
  assert.equal(event.defaultPrevented, true);
  dom.window.close();
});

test('PWA shell contains every local production script and generated stylesheet', () => {
  const index = fs.readFileSync(path.join(frontend, 'index.html'), 'utf8');
  const worker = fs.readFileSync(path.join(frontend, 'service-worker.js'), 'utf8');
  const paths = [];
  for (const match of index.matchAll(/<(?:script[^>]+src|link[^>]+href)=["']([^"']+)["']/g)) {
    const clean = match[1].split('?')[0];
    if (!/^(?:https?:|#)/.test(clean) && /\.(?:js|css)$/.test(clean)) paths.push(`/${clean.replace(/^\//, '')}`);
  }
  for (const resource of paths) {
    assert.ok(fs.existsSync(path.join(frontend, resource)), `missing local resource ${resource}`);
    assert.ok(worker.includes(JSON.stringify(resource)), `service worker does not precache ${resource}`);
  }
  assert.ok(fs.statSync(path.join(frontend, 'css/tailwind.generated.css')).size > 40_000, 'compiled Tailwind CSS is unexpectedly small');
});
