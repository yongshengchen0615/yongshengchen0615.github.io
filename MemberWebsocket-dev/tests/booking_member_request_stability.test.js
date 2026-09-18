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
  for (const relativePath of ['booking/group-booking.js', 'booking/booking-confirm-details.js']) {
    execFileSync(process.execPath, ['--check', path.join(root, relativePath)], { stdio: 'pipe' });
  }
});

test('member booking entrypoint cache-busts the stabilized runtime scripts', () => {
  const html = read('booking/index.html');
  assert.match(html, /group-booking\.js\?v=booking-shared-type-color-map-20260918-4/);
  assert.match(html, /booking-confirm-details\.js\?v=booking-confirm-note-20260918-1/);
  assert.match(html, /group-booking\.css\?v=booking-participant-colors-20260918-1/);
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
