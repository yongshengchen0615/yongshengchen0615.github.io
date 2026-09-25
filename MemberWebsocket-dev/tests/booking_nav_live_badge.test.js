const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

const core = read('admin/booking-panel-core.js');
const loader = read('admin/booking-panel.js');
const html = read('admin/index.html');
const api = read('supabase/functions/booking-api/index.ts');

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

test('background badge sync uses the count-only booking summary endpoint', () => {
  const start = core.indexOf('async function refreshBookingBadge()');
  const end = core.indexOf('function startBookingBadgeSync()', start);
  const section = core.slice(start, end);
  assert.match(section, /bookingRequest\('admin\.booking\.summary'\)/);
  assert.doesNotMatch(section, /admin\.booking\.bootstrap|manageRequest|resourceRequest|contactRequest|groupDetailsRequest/);
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


test('booking summary endpoint counts pending rows only after admin authorization', () => {
  const auth = api.indexOf('await authorizeAdmin(supabase, identity);');
  const route = api.indexOf('action === "admin.booking.summary"', auth);
  assert.ok(auth >= 0 && route > auth);
  const start = api.indexOf('async function adminBookingSummary');
  const end = api.indexOf('async function adminBootstrap', start);
  const section = api.slice(start, end);
  assert.match(section, /select\("id", \{ count: "exact", head: true \}\)/);
  assert.match(section, /\.eq\("status", "pending"\)/);
  assert.match(section, /pendingCount/);
  assert.doesNotMatch(section, /members\(|hydrateBookings|booking_items/);
});
