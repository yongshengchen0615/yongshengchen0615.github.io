'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('admin is calendar-first and opens a date editor modal', () => {
  const html = read('admin/index.html');
  assert.match(html, /id="calendarGrid"/);
  assert.match(html, /id="dayModal"/);
  assert.match(html, /role="dialog"/);
  assert.match(html, /id="itemForm"/);
  assert.match(html, /id="color" type="color"/);
});

test('admin calendar supports date click, modal editing, and safe color rendering', () => {
  const app = read('admin/app.js');
  assert.match(app, /openDayModal/);
  assert.match(app, /itemsForDate/);
  assert.match(app, /safeColor/);
  assert.match(app, /backgroundColor/);
  assert.doesNotMatch(app, /\.innerHTML\s*=/);
  assert.doesNotMatch(app, /insertAdjacentHTML/);
});

test('user selected day is a modal instead of a persistent card', () => {
  const html = read('user/index.html');
  const app = read('user/app.js');
  assert.match(html, /id="selectedDayModal"/);
  assert.match(html, /role="dialog"/);
  assert.match(html, /aria-modal="true"/);
  assert.match(html, /id="closeSelectedDayButton"/);
  assert.match(app, /openSelectedDayModal/);
  assert.match(app, /closeSelectedDayModal/);
  assert.match(app, /event\.key === 'Escape'/);
  assert.doesNotMatch(app, /\.innerHTML\s*=/);
});

test('user calendar supports mobile horizontal swipe while preserving vertical scrolling', () => {
  const app = read('user/app.js');
  const css = read('user/styles.css');
  assert.match(app, /SWIPE_MIN_DISTANCE_PX/);
  assert.match(app, /SWIPE_MAX_DURATION_MS/);
  assert.match(app, /SWIPE_HORIZONTAL_DOMINANCE/);
  assert.match(app, /calendarGrid\.addEventListener\('touchstart'/);
  assert.match(app, /calendarGrid\.addEventListener\('touchend'/);
  assert.match(app, /changeMonth\(deltaX < 0 \? 1 : -1\)/);
  assert.match(app, /suppressCalendarClickUntil/);
  assert.match(css, /\.calendar-grid\s*\{[^}]*touch-action:\s*pan-y;/s);
  assert.doesNotMatch(css, /touch-action:\s*none/);
});

test('user calendar animates month navigation and supports desktop mouse-wheel paging', () => {
  const html = read('user/index.html');
  const navigation = read('user/month-navigation-ui.js');
  const css = read('user/styles.css');
  assert.match(html, /month-navigation-ui\.js/);
  assert.match(navigation, /calendarGrid\.addEventListener\('wheel'/);
  assert.match(navigation, /event\.preventDefault\(\)/);
  assert.match(navigation, /nextMonthButton\.click\(\)/);
  assert.match(navigation, /prevMonthButton\.click\(\)/);
  assert.match(navigation, /MutationObserver/);
  assert.match(css, /@keyframes\s+calendar-page-enter-next/);
  assert.match(css, /@keyframes\s+calendar-page-enter-prev/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
});

test('user and admin headers show LINE avatars while logout controls are hidden', () => {
  ['user/index.html', 'admin/index.html'].forEach((file) => {
    const html = read(file);
    assert.match(html, /id="profileAvatar"/);
    assert.match(html, /id="profileAvatarFallback"/);
    assert.match(html, /shared\/line-profile\.js/);
    assert.match(html, /id="logoutButton"[^>]*hidden/);
  });
});

test('LINE avatar loader accepts HTTPS images only and does not persist profile data', () => {
  const profile = read('shared/line-profile.js');
  assert.match(profile, /window\.liff\.getProfile\(\)/);
  assert.match(profile, /new URL\(value\)/);
  assert.match(profile, /url\.protocol === 'https:'/);
  assert.doesNotMatch(profile, /localStorage|sessionStorage|console\./);
});

test('calendar color is constrained in PostgreSQL and treated as untrusted by clients', () => {
  const sql = read('supabase/migrations/001_calendar_system.sql');
  const user = read('user/app.js');
  const admin = read('admin/app.js');
  assert.match(sql, /color ~ '\^#\[0-9A-Fa-f\]\{6\}\$'/);
  assert.match(user, /safeColor/);
  assert.match(admin, /safeColor/);
  assert.doesNotMatch(user, /style\.cssText/);
  assert.doesNotMatch(admin, /style\.cssText/);
});
