const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('member booking formatter applies the first participant service format to every participant card', () => {
  const formatter = read('booking/member-booking-format.js');

  assert.match(formatter, /participantCardObserver\.observe\(participantCardList, \{ childList: true, subtree: true \}\)/);
  assert.match(formatter, /#participantCardList \.service-picker-fieldset > \.service-picker/);
  assert.match(formatter, /#participantCardList \.selected-service-fieldset > \.selected-service-list/);
  assert.match(formatter, /pickerContainers\.forEach\(\(container\) => groupServiceContainer\(container, '\.service-choice', true\)\)/);
  assert.match(formatter, /selectedContainers\.forEach\(\(container\) => groupServiceContainer\(container, '\.selected-service-item', false\)\)/);
});

test('participant format parity formatter has valid JavaScript syntax', () => {
  execFileSync(process.execPath, ['--check', path.join(root, 'booking/member-booking-format.js')], { stdio: 'pipe' });
});

test('member booking entrypoint cache-busts participant format parity', () => {
  const html = read('booking/index.html');
  assert.match(html, /member-booking-format\.js\?v=booking-participant-format-parity-20260918-1/);
});
