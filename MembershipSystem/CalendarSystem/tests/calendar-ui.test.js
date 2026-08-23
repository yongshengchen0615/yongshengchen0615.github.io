'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('admin is calendar-first and opens a date editor modal', () => {
  const html = read('admin/index.html');
  assert.match(html, /id="calendarGrid"/);
  assert.match(html, /id="dayModal"/);
  assert.match(html, /role="dialog"/);
  assert.match(html, /id="itemForm"/);
  assert.match(html, /id="color" type="color"/);
});

test('admin calendar supports date click, modal editing, and color rendering without HTML injection APIs', () => {
  const app = read('admin/app.js');
  assert.match(app, /openDayModal/);
  assert.match(app, /itemsForDate/);
  assert.match(app, /safeColor/);
  assert.match(app, /backgroundColor/);
  assert.doesNotMatch(app, /\.innerHTML\s*=/);
  assert.doesNotMatch(app, /insertAdjacentHTML/);
});

test('user Selected day is a modal instead of a persistent card', () => {
  const html = read('user/index.html');
  const app = read('user/app.js');
  assert.match(html, /id="selectedDayModal"/);
  assert.match(html, /role="dialog"/);
  assert.match(html, /aria-modal="true"/);
  assert.match(html, /id="closeSelectedDayButton"/);
  assert.doesNotMatch(html, /class="agenda-card"/);
  assert.match(app, /openSelectedDayModal/);
  assert.match(app, /closeSelectedDayModal/);
  assert.match(app, /event\.key === 'Escape'/);
  assert.doesNotMatch(app, /\.innerHTML\s*=/);
  assert.doesNotMatch(app, /insertAdjacentHTML/);
});

test('user and admin headers show LINE avatars while logout controls are not visible', () => {
  ['user/index.html', 'admin/index.html'].forEach((relativePath) => {
    const html = read(relativePath);
    assert.match(html, /id="profileAvatar"/);
    assert.match(html, /id="profileAvatarFallback"/);
    assert.match(html, /shared\/line-profile\.js/);
    assert.match(html, /id="logoutButton"[^>]*hidden/);
  });

  const profile = read('shared/line-profile.js');
  assert.match(profile, /logoutButton\.remove\(\)/);
});

test('LINE avatar loader accepts HTTPS images only and does not persist profile data', () => {
  const profile = read('shared/line-profile.js');
  assert.match(profile, /window\.liff\.getProfile\(\)/);
  assert.match(profile, /new URL\(value\)/);
  assert.match(profile, /url\.protocol === 'https:'/);
  assert.doesNotMatch(profile, /localStorage/);
  assert.doesNotMatch(profile, /sessionStorage/);
  assert.doesNotMatch(profile, /console\./);
});

test('calendar color is server validated and returned by the API', () => {
  const service = read('gas/CalendarService.gs');
  assert.match(service, /COLOR_PATTERN_\s*=\s*\/\^#\[0-9A-Fa-f\]\{6\}\$\//);
  assert.match(service, /INVALID_COLOR/);
  assert.match(service, /color:\s*item\.color/);
  assert.match(service, /color:\s*color/);
});

test('CalendarItems schema migration is append-only for the color column', () => {
  const storage = read('gas/StorageBootstrap.gs');
  assert.match(storage, /'updated_at', 'color'/);
  assert.match(storage, /migrateLegacyCalendarItemsSchema_/);
  assert.match(storage, /headers\.slice\(0, -1\)/);
  assert.match(storage, /setValue\('color'\)/);
});

test('user client treats stored color as untrusted and validates it before applying style', () => {
  const app = read('user/app.js');
  assert.match(app, /safeColor/);
  assert.match(app, /\^#\[0-9A-F\]\{6\}\$/);
  assert.doesNotMatch(app, /style\.cssText/);
});
