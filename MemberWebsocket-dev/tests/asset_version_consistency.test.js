const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const responsiveVersion = '20260914-line-form-1';
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const entryPages = [
  'index.html',
  'admin/index.html',
  'member/index.html',
  'points/index.html',
  'event/index.html',
  'calendar/index.html',
  'booking/index.html',
  'booking/admin/index.html',
];

test('all application entry pages reference the current shared responsive asset', () => {
  for (const relativePath of entryPages) {
    const html = read(relativePath);
    assert.ok(html.includes('responsive.css?v=' + responsiveVersion), relativePath);
  }
});

test('admin entry references current booking assets', () => {
  const html = read('admin/index.html');
  assert.ok(html.includes('calendar-responsive.css?v=calendar-responsive-20260914-mobile-fit-2'));
  assert.ok(html.includes('calendar-date-fix.css?v=20260914-line-date-1'));
  assert.ok(html.includes('../member-system.js?v=test-mode-20260920-1'));
  assert.ok(html.includes('admin-session.js?v=admin-session-20260919-1'));
  assert.ok(html.includes('app.js?v=test-mode-20260920-1'));
  assert.ok(html.includes('booking-panel.css?v=booking-settings-layout-20260918-1'));
  assert.ok(html.includes('booking-panel.js?v=booking-technician-disable-action-20260920-1'));
  assert.equal((html.match(/booking-panel\.js/g) || []).length, 1);
  assert.ok(html.includes('fixed-ticket-admin.js?v=fixed-ticket-unified-session-20260919-1'));
  assert.ok(html.includes('pointcard-redemption-limit.js?v=pointcard-unified-session-20260919-1'));
  assert.ok(html.includes('../booking-copy-format.js?v=booking-single-renderer-copy-20260918-1'));
});

test('member booking entry loads only the current single render pipeline', () => {
  const html = read('booking/index.html');
  const group = read('booking/group-booking.js');
  const app = read('booking/app.js');
  const loader = read('admin/booking-panel.js');

  assert.ok(html.includes('styles.css?v=booking-addon-notice-modal-20260919-1'));
  assert.ok(html.includes('common.js?v=test-mode-20260920-1'));
  assert.ok(html.includes('group-booking.css?v=booking-participant-colors-20260918-1'));
  assert.ok(html.includes('booking-history.css?v=booking-history-accordion-20260918-1'));
  assert.ok(html.includes('member-booking-format.css?v=booking-service-type-colors-webview-20260918-2'));
  assert.ok(html.includes('service-type-color.js?v=booking-shared-type-color-map-20260918-4'));
  assert.ok(html.includes('group-booking.js?v=test-mode-20260920-1'));
  assert.ok(html.includes('member-ui.js?v=test-mode-20260920-1'));
  assert.ok(html.includes('app.js?v=test-mode-20260920-1'));
  assert.ok(html.includes('contact-details.js?v=test-mode-20260920-1'));
  assert.ok(html.includes('calendar-flow.js?v=test-mode-20260920-1'));

  assert.ok(!html.includes('member-booking-format.js'));
  assert.ok(!html.includes('booking-confirm-details.js'));
  assert.ok(!html.includes('booking-notice-dedupe.js'));

  assert.ok(group.includes('window.BookingGroupUI = Object.freeze'));
  assert.ok(app.includes('window.BookingMemberUI?.organizeBookingHistory?.()'));
  assert.ok(loader.includes("loadStyle('../booking-admin-group-details.css'"));
  assert.ok(!loader.includes('booking-admin-group-details.js'));
});

test('legacy standalone booking admin redirects to the current admin booking workspace', () => {
  const html = read('booking/admin/index.html');
  assert.ok(html.includes('url=../../admin/#booking'));
  assert.ok(html.includes('href="../../admin/#booking"'));
  assert.equal(fs.existsSync(path.join(root, 'booking/admin/app.js')), false);
  assert.equal(fs.existsSync(path.join(root, 'booking/admin/resources.js')), false);
  assert.equal(fs.existsSync(path.join(root, 'booking/admin/subtabs.js')), false);
  assert.equal(fs.existsSync(path.join(root, 'booking-admin-group-details.js')), false);
});

test('admin booking technician settings remount after dynamic panel creation', () => {
  const resources = read('admin/booking-resources.js');
  assert.ok(resources.includes('initialized: false'));
  assert.ok(resources.includes('function startWhenReady()'));
  assert.ok(resources.includes('new MutationObserver'));
  assert.ok(resources.includes("observer.observe(document.documentElement, { childList: true, subtree: true })"));
  assert.ok(resources.includes('if (!mount()) return false'));
});

test('calendar date fix keeps native date inputs shrinkable in LINE WebView', () => {
  const css = read('admin/calendar-date-fix.css');
  assert.ok(css.includes('#calendarEditorModal input[type="date"]'));
  assert.ok(css.includes('min-inline-size: 0 !important'));
  assert.ok(css.includes('::-webkit-calendar-picker-indicator'));
});
