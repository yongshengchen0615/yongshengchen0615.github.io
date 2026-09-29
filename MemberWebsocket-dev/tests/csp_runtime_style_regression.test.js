const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (relative) => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');

test('booking calendar and cancellation sync do not inject runtime style elements', () => {
  const calendar = read('booking/calendar-flow.js');
  const cancellation = read('admin/booking-cancellation-sync.js');
  assert.doesNotMatch(calendar, /createElement\(['"]style['"]\)/);
  assert.doesNotMatch(cancellation, /createElement\(['"]style['"]\)/);
  assert.doesNotMatch(cancellation, /textarea\.style\./);
  assert.match(read('booking/calendar-flow.css'), /CSP-safe holiday styles/);
  assert.match(read('admin/booking-panel.css'), /CSP-safe cancellation review styles/);
});

test('admin CSP permits the already-trusted jsDelivr origin for Leaflet source maps without unsafe-inline styles', () => {
  const html = read('admin/index.html');
  const meta = html.split('\n').find((line) => line.includes('Content-Security-Policy')) || '';
  assert.match(meta, /connect-src[^;]*https:\/\/cdn\.jsdelivr\.net/);
  assert.doesNotMatch(meta, /style-src[^;]*'unsafe-inline'/);
});
