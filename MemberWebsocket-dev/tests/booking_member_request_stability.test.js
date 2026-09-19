const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('member booking routes group requests without global fetch monkey patching', () => {
  const groupBooking = read('booking/group-booking.js');
  assert.ok(groupBooking.includes("action === 'user.booking.group.slots' ? 'booking-group-slots-api' : 'booking-group-api'"));
  assert.ok(groupBooking.includes('/functions/v1/'));
  assert.ok(!groupBooking.includes('window.fetch ='));
});

test('current member booking runtime scripts have valid JavaScript syntax', () => {
  for (const relativePath of [
    'booking/group-booking.js',
    'booking/member-ui.js',
    'booking/app.js',
    'booking/contact-details.js',
    'booking/calendar-flow.js',
    'booking/service-type-color.js',
  ]) {
    execFileSync(process.execPath, ['--check', path.join(root, relativePath)], { stdio: 'pipe' });
  }
});

test('member booking entrypoint loads the single render pipeline only', () => {
  const html = read('booking/index.html');
  for (const asset of [
    'group-booking.js?v=booking-addon-rules-20260919-1',
    'member-ui.js?v=booking-single-render-20260919-1',
    'app.js?v=booking-addon-rules-20260919-1',
    'contact-details.js?v=booking-single-render-20260919-1',
    'calendar-flow.js?v=booking-single-render-20260919-1',
  ]) assert.ok(html.includes(asset), asset);

  assert.ok(!html.includes('booking-confirm-details.js'));
  assert.ok(!html.includes('member-booking-format.js'));
  assert.ok(!html.includes('booking-notice-dedupe.js'));
});

test('booking history is finalized synchronously in the primary render pass', () => {
  const app = read('booking/app.js');
  const memberUi = read('booking/member-ui.js');
  const group = read('booking/group-booking.js');

  assert.ok(group.includes('window.BookingGroupUI = Object.freeze'));
  assert.ok(group.includes('renderBookingHistoryCard'));
  assert.ok(memberUi.includes('window.BookingMemberUI = Object.freeze'));
  assert.ok(memberUi.includes('organizeBookingHistory'));
  assert.ok(app.includes('window.BookingGroupUI?.renderBookingHistoryCard?.(item, booking)'));
  assert.ok(app.includes('window.BookingMemberUI?.organizeBookingHistory?.()'));

  assert.ok(!app.includes('MutationObserver'));
  assert.ok(!group.includes('MutationObserver'));
  assert.ok(!memberUi.includes('MutationObserver'));
});

test('member booking history cards collapse to the four-field summary and keep only one card open', () => {
  const app = read('booking/app.js');
  const memberUi = read('booking/member-ui.js');
  const css = read('booking/booking-history.css');

  for (const label of ['日期', '時間', '總服務時間', '總金額']) {
    assert.ok(app.includes("summaryRow('" + label + "'"));
  }
  assert.ok(memberUi.includes("let expandedBookingId = ''"));
  assert.ok(memberUi.includes('function applyBookingCardAccordionState(card, expanded)'));
  assert.ok(memberUi.includes("bookingList.addEventListener('click', handleBookingHistoryClick)"));
  assert.ok(memberUi.includes("bookingList.addEventListener('keydown', handleBookingHistoryKeydown)"));
  assert.ok(css.includes('booking-history-collapsible:not(.is-expanded)>:not(.booking-item-top):not(.member-booking-format-totals)'));
});

test('legacy booking post-renderer files are removed', () => {
  for (const relativePath of [
    'booking/booking-confirm-details.js',
    'booking/member-booking-format.js',
    'booking/booking-notice-dedupe.js',
  ]) assert.equal(fs.existsSync(path.join(root, relativePath)), false, relativePath);
});
