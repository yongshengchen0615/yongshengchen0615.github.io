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
  assert.match(html, /group-booking\.js\?v=booking-request-stability-20260917-1/);
  assert.match(html, /booking-confirm-details\.js\?v=booking-confirm-details-20260917-4/);
});
