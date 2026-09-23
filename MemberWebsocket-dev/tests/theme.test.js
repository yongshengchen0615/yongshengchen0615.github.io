const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const entries = ['admin', 'member', 'points', 'event', 'calendar', 'booking'];

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('all admin and member surfaces load the shared theme controller and stylesheet', () => {
  for (const entry of entries) {
    const html = read(path.join(entry, 'index.html'));
    assert.match(html, /\.\.\/theme\.css\?v=theme-toggle-20260924-1/, entry + ' should load theme.css');
    assert.match(html, /\.\.\/theme\.js\?v=theme-toggle-20260924-1/, entry + ' should load theme.js');
  }
});

test('theme controller persists preference and synchronizes browser tabs', () => {
  const source = read('theme.js');
  assert.match(source, /lumen-color-theme-v1/);
  assert.match(source, /localStorage\.setItem\(STORAGE_KEY/);
  assert.match(source, /addEventListener\('storage'/);
  assert.match(source, /prefers-color-scheme: dark/);
  assert.match(source, /id = 'themeToggleButton'/);
  assert.match(source, /dataset\.uiThemeControl = 'true'/);
});

test('dark theme styles and E2E button coverage are wired', () => {
  const css = read('theme.css');
  const qa = read('user-test-control.js');
  assert.match(css, /html\[data-theme="dark"\]/);
  assert.match(css, /\.theme-toggle-button/);
  assert.match(qa, /button\.dataset\?\.uiThemeControl === 'true'/);
});
