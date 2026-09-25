const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

const core = read('admin/booking-panel-core.js');
const loader = read('admin/booking-panel.js');
const html = read('admin/index.html');

test('booking nav badge starts syncing after admin session without opening booking page', () => {
  const mountStart = core.indexOf('function mount()');
  const mountEnd = core.indexOf('function cacheElements()', mountStart);
  const mount = core.slice(mountStart, mountEnd);
  assert.match(mount, /startBookingBadgeSync\(\)/);
  assert.match(core, /member-admin-session-ready/);
  assert.match(core, /function startBookingBadgeSync\(/);
  assert.match(core, /await context\(\)/);
  assert.match(core, /await refreshBookingBadge\(\)/);
});

test('background badge sync is lightweight and does not load booking detail dependencies', () => {
  const start = core.indexOf('async function refreshBookingBadge()');
  const end = core.indexOf('function startBookingBadgeSync()', start);
  const section = core.slice(start, end);
  assert.match(section, /bookingRequest\('admin\.booking\.bootstrap'\)/);
  assert.doesNotMatch(section, /manageRequest|resourceRequest|contactRequest|groupDetailsRequest/);
});

test('booking badge renders pending count and accessible label', () => {
  const start = core.indexOf('function renderBookingPendingBadge');
  const end = core.indexOf('async function refreshBookingBadge', start);
  const section = core.slice(start, end);
  assert.match(section, /bookingTab\.dataset\.pendingCount/);
  assert.match(section, /bookingAdminPendingCount\.textContent/);
  assert.match(section, /bookingAdminQueueSubtabCount\.textContent/);
  assert.match(section, /setAttribute\('aria-label'/);
  assert.match(section, /筆新預約待確認/);
});

test('booking realtime refreshes only the badge while booking panel is hidden', () => {
  const start = core.indexOf('function setupRealtime()');
  const end = core.indexOf('function teardownRealtime()', start);
  const section = core.slice(start, end);
  assert.match(section, /bookingPanel\?\.classList\.contains\('hidden'\)/);
  assert.match(section, /refreshBookingBadge\(\)/);
  assert.match(section, /else refreshAll\(false\)/);
});

test('current booking loader cache-busts the live badge implementation', () => {
  assert.match(loader, /booking-panel-core\.js', 'booking-nav-live-badge-20260925-1'/);
  assert.match(html, /booking-panel\.js\?v=booking-nav-live-badge-20260925-1/);
});
