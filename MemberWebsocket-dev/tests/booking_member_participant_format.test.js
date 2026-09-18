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


test('later participants use the same duplicate item and same-type warning rules as the first participant', () => {
  const app = read('booking/app.js');
  const groupBooking = read('booking/group-booking.js');

  const duplicateLimit = /${service\.title} 已加入兩次，無法再重複加入。/;
  const duplicateExisting = /${service\.title} 已有選擇。/;
  const sameType = /目前已選擇相同類型「${serviceType}」的項目：${names}。/;
  const confirmText = /仍要加入這個預約項目嗎？/;

  for (const source of [app, groupBooking]) {
    assert.match(source, duplicateLimit);
    assert.match(source, duplicateExisting);
    assert.match(source, sameType);
    assert.match(source, confirmText);
  }

  assert.match(groupBooking, /state\.extras\[extraIndex\] = selections/);
  assert.match(groupBooking, /extraSelectionsToItems\(state\.extras\[index\]\)/);
  assert.match(groupBooking, /participantSelections\(participant\)/);
  assert.doesNotMatch(groupBooking, /state\.extras\.push\(new Set\(\)\)/);
});

test('participant format parity formatter has valid JavaScript syntax', () => {
  execFileSync(process.execPath, ['--check', path.join(root, 'booking/member-booking-format.js')], { stdio: 'pipe' });
});

test('member booking entrypoint cache-busts participant format parity', () => {
  const html = read('booking/index.html');
  assert.match(html, /member-booking-format\.js\?v=booking-participant-format-parity-20260918-1/);
});
