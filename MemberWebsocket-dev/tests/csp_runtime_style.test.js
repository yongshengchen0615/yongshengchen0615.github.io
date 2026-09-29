const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

test('CSP keeps unsafe inline styles disabled while externalized booking styles remain allowed', () => {
  for (const surface of ['member', 'points', 'event', 'calendar', 'booking']) {
    const html = read(surface + '/index.html');
    assert.match(html, /style-src 'self';/);
    assert.match(html, /connect-src[^"]*https:\/\/cdn\.jsdelivr\.net;/);
    assert.doesNotMatch(html, /unsafe-inline/);
  }

  const admin = read('admin/index.html');
  assert.match(admin, /style-src 'self' https:\/\/cdn\.jsdelivr\.net;/);
  assert.match(admin, /connect-src[^"]*https:\/\/nominatim\.openstreetmap\.org https:\/\/cdn\.jsdelivr\.net;/);
  assert.doesNotMatch(admin, /unsafe-inline/);
});

test('booking holiday and cancellation review no longer inject style elements at runtime', () => {
  const holiday = read('booking/calendar-flow.js');
  const cancellation = read('admin/booking-cancellation-sync.js');
  assert.doesNotMatch(holiday, /createElement\(['"]style['"]\)/);
  assert.doesNotMatch(holiday, /bookingHolidayStyles/);
  assert.doesNotMatch(cancellation, /createElement\(['"]style['"]\)/);
  assert.doesNotMatch(cancellation, /bookingCancellationReviewStyles|function injectStyles/);

  const holidayCss = read('booking/calendar-holiday-theme.css');
  const bookingCss = read('admin/booking-panel.css');
  assert.match(holidayCss, /\.booking-holiday-date/);
  assert.match(holidayCss, /\.calendar-legend \.holiday-dot/);
  assert.match(bookingCss, /\.booking-admin-cancellation-review\.hidden/);
});

test('CSP fixes are cache-busted on deployed entry points', () => {
  const booking = read('booking/index.html');
  assert.match(booking, /calendar-holiday-theme\.css\?v=booking-csp-20260929-1/);
  assert.match(booking, /calendar-flow\.js\?v=booking-csp-20260929-1/);
  assert.match(booking, /user-test-control\.js\?v=qa-e2e-20260929-6/);

  const admin = read('admin/index.html');
  assert.match(admin, /booking-panel\.css\?v=booking-csp-20260929-1/);
  assert.match(admin, /booking-panel\.js\?v=booking-csp-20260929-1/);
  assert.match(admin, /e2e-control\.js\?v=qa-e2e-20260929-8/);

  const loader = read('admin/booking-panel.js');
  assert.match(loader, /booking-cancellation-sync\.js', 'booking-csp-20260929-1'/);
});
