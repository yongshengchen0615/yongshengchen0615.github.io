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
    assert.match(html, /\.\.\/theme\.css\?v=theme-contrast-20260924-4/, entry + ' should load theme.css');
    assert.match(html, /\.\.\/theme\.js\?v=theme-contrast-20260924-4/, entry + ' should load theme.js');
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


test('optimized theme avoids expensive theme paint effects and redundant DOM writes', () => {
  const css = read('theme.css');
  const source = read('theme.js');

  assert.match(css, /background-image:\s*none/);
  assert.match(css, /backdrop-filter:\s*none/);
  assert.match(css, /-webkit-backdrop-filter:\s*none/);
  assert.doesNotMatch(css, /color-mix\(/);
  assert.match(css, /@media \(hover: none\)/);
  assert.match(css, /animation:\s*none !important/);

  assert.match(source, /const changed = currentTheme !== next \|\| root\.dataset\.theme !== next/);
  assert.match(source, /themeMeta\.content !== next/);
  assert.match(source, /window\.localStorage\.getItem\(STORAGE_KEY\) !== theme/);
});


function luminance(hex) {
  const value = hex.replace('#', '');
  const rgb = [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16) / 255);
  const linear = rgb.map((channel) => channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4);
  return (0.2126 * linear[0]) + (0.7152 * linear[1]) + (0.0722 * linear[2]);
}

function contrastRatio(foreground, background) {
  const high = Math.max(luminance(foreground), luminance(background));
  const low = Math.min(luminance(foreground), luminance(background));
  return (high + 0.05) / (low + 0.05);
}

test('semantic text palette keeps readable contrast in light and dark modes', () => {
  const lightBackground = '#f3f5f2';
  const darkBackground = '#0d1411';

  const lightText = ['#18241f', '#627168', '#65736c', '#a94834', '#276947', '#765817', '#9c3d31'];
  const darkText = ['#f0f4f1', '#b6c1bb', '#9eaca5', '#ff9a78', '#8bd7ad', '#e5c675', '#ff9f90'];

  for (const color of lightText) {
    assert.ok(contrastRatio(color, lightBackground) >= 4.5, color + ' should meet AA on the light theme background');
  }
  for (const color of darkText) {
    assert.ok(contrastRatio(color, darkBackground) >= 4.5, color + ' should meet AA on the dark theme background');
  }

  const css = read('theme.css');
  assert.match(css, /--theme-text-subtle:\s*#65736c/);
  assert.match(css, /--theme-text-subtle:\s*#9eaca5/);
  assert.match(css, /--theme-positive-text:\s*#8bd7ad/);
  assert.match(css, /--theme-warning-text:\s*#e5c675/);
  assert.match(css, /--theme-danger-text:\s*#ff9f90/);
  assert.match(css, /#bookingPanel \.booking-admin-service-row/);
  assert.match(css, /\.test-control-step-heading strong/);
  assert.match(css, /\.booking-contact-option strong/);
});
