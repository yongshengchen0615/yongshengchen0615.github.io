const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('member booking routes group slot requests without global fetch monkey patching', () => {
  const groupBooking = read('booking/group-booking.js');
  const confirmation = read('booking/booking-confirm-details.js');

  assert.match(groupBooking, /action === 'user\.booking\.group\.slots' \? 'booking-group-slots-api' : 'booking-group-api'/);
  assert.match(groupBooking, /\/functions\/v1\/\$\{functionName\}/);
  assert.doesNotMatch(confirmation, /window\.fetch\s*=/);
  assert.doesNotMatch(confirmation, /system\.request\s*=/);
});

test('member booking runtime extension scripts have valid JavaScript syntax', () => {
  for (const relativePath of ['booking/group-booking.js', 'booking/booking-confirm-details.js', 'booking/member-ui.js', 'booking/member-booking-format.js', 'booking/app.js']) {
    execFileSync(process.execPath, ['--check', path.join(root, relativePath)], { stdio: 'pipe' });
  }
});

test('member booking entrypoint cache-busts the stabilized runtime scripts', () => {
  const html = read('booking/index.html');
  assert.match(html, /group-booking\.js\?v=booking-history-dedupe-final-20260918-1/);
  assert.match(html, /booking-confirm-details\.js\?v=booking-confirm-note-20260918-1/);
  assert.match(html, /group-booking\.css\?v=booking-participant-colors-20260918-1/);
  assert.match(html, /member-ui\.js\?v=booking-history-accordion-20260918-1/);
  assert.match(html, /app\.js\?v=booking-history-dedupe-services-20260918-1/);
  assert.match(html, /member-booking-format\.js\?v=booking-history-dedupe-services-20260918-1/);
});

test('member booking history is finalized synchronously in the primary render pass', () => {
  const app = read('booking/app.js');
  const memberUi = read('booking/member-ui.js');
  const memberFormat = read('booking/member-booking-format.js');

  assert.match(memberFormat, /window\.BookingMemberFormat = Object\.freeze\(\{[\s\S]*formatHistory\(\)/);
  assert.match(memberUi, /window\.BookingMemberUI = Object\.freeze\(\{[\s\S]*organizeBookingHistory/);

  const formatCall = app.indexOf('window.BookingMemberFormat.formatHistory()');
  const groupCall = app.indexOf('window.BookingMemberUI.organizeBookingHistory()');
  assert.ok(formatCall > 0, 'primary renderer should format member booking cards synchronously');
  assert.ok(groupCall > formatCall, 'primary renderer should group already-formatted cards before paint');
});


test('member booking participant cards have distinct mobile-identification colors', () => {
  const css = read('booking/group-booking.css');
  for (let index = 0; index < 10; index += 1) {
    assert.match(css, new RegExp('participant-card\\[data-participant-index="' + index + '"\\]\\{--participant-rgb:'));
  }
  assert.match(css, /border-left:4px solid rgb\(var\(--participant-rgb\) \/ \.78\)/);
  assert.match(css, /participant-heading>strong::before/);
  assert.match(css, /@media\(max-width:680px\).*\.participant-card\{border-left-width:5px\}/s);
});


test('member booking history omits duplicate top-level services when participant details exist', () => {
  const app = read('booking/app.js');
  const formatter = read('booking/member-booking-format.js');

  assert.match(app, /const hasParticipantDetails = Array\.isArray\(booking\.participants\) && booking\.participants\.length > 0/);
  assert.match(app, /item\.dataset\.participantDetails = hasParticipantDetails \? '1' : '0'/);
  assert.match(app, /if \(!hasParticipantDetails && \(visibleItems\.length \|\| storeItem\)\)/);

  assert.match(formatter, /const hasParticipantDetails = card\.dataset\.participantDetails === '1'/);
  assert.match(formatter, /if \(!hasParticipantDetails\) \{/);
  assert.match(formatter, /serviceList\?\.remove\(\)/);
  assert.match(formatter, /if \(hasParticipantDetails\) \{\s*top\.after\(totals\)/s);
});


test('group history decoration removes stale top-level service section after participant data is available', () => {
  const groupBooking = read('booking/group-booking.js');

  assert.match(groupBooking, /function removeDuplicateHistoryServices\(node\)/);
  assert.match(groupBooking, /child\.classList\?\.contains\('member-booking-format-services-label'\)/);
  assert.match(groupBooking, /child\.classList\?\.contains\('booking-service-items'\)/);
  assert.match(groupBooking, /const group = state\.bookingGroups\.get\(id\);\s*if \(!group\) return;\s*removeDuplicateHistoryServices\(node\);/s);
});


test('member booking history cards collapse to the four-field summary and keep only one card open', () => {
  const memberUi = read('booking/member-ui.js');
  const css = read('booking/booking-history.css');
  const html = read('booking/index.html');

  assert.match(memberUi, /let expandedBookingId = ''/);
  assert.match(memberUi, /function applyBookingCardAccordionState\(card, expanded\)/);
  assert.match(memberUi, /card\.classList\.toggle\('is-expanded', expanded\)/);
  assert.match(memberUi, /top\.setAttribute\('aria-expanded', expanded \? 'true' : 'false'\)/);
  assert.match(memberUi, /const shouldExpand = !card\.classList\.contains\('is-expanded'\)/);
  assert.match(memberUi, /bookingList\.querySelectorAll\('\.booking-item\[data-booking-id\]'\)\.forEach/);
  assert.match(memberUi, /bookingList\.addEventListener\('click', handleBookingHistoryClick\)/);
  assert.match(memberUi, /bookingList\.addEventListener\('keydown', handleBookingHistoryKeydown\)/);
  assert.match(memberUi, /event\.key !== 'Enter' && event\.key !== ' '/);

  assert.match(css, /booking-history-collapsible:not\(\.is-expanded\)>:not\(\.booking-item-top\):not\(\.member-booking-format-totals\)\{display:none!important\}/);
  assert.match(css, /booking-history-collapsible:not\(\.is-expanded\)>\.booking-item-top>\.status-badge\{display:none!important\}/);
  assert.match(css, /booking-history-collapsible\.is-expanded/);
  assert.match(html, /booking-history\.css\?v=booking-history-accordion-20260918-1/);
  assert.match(html, /member-ui\.js\?v=booking-history-accordion-20260918-1/);
});
