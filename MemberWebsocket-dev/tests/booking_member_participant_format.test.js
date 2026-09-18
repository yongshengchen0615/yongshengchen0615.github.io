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



test('later participants render the same final service picker and selected-item structure as the first participant', () => {
  const groupBooking = read('booking/group-booking.js');

  assert.match(groupBooking, /picker\.className = 'service-picker-fieldset'/);
  assert.match(groupBooking, /selectedFieldset\.className = 'selected-service-fieldset'/);
  assert.match(groupBooking, /choices\.className = 'service-picker'/);
  assert.match(groupBooking, /selectedList\.className = 'selected-service-list'/);
  assert.match(groupBooking, /section\.className = 'service-info'/);
  assert.match(groupBooking, /heading\.textContent = `\$\{group\.label\}（\$\{group\.entries\.length\}）`/);
  assert.match(groupBooking, /list\.className = listClass/);
  assert.match(groupBooking, /row\.className = 'service-choice'/);
  assert.match(groupBooking, /row\.className = 'selected-service-item'/);
  assert.match(groupBooking, /meta\.textContent = `服務 \$\{Number\(service\.durationMinutes \|\| 0\)\} 分鐘 · \$\{formatServiceMoney\(service\.priceAmount\)\}`/);
  assert.match(groupBooking, /!selections\.some\(\(selection\) => selection\.serviceId === service\.serviceId\)/);
  assert.match(groupBooking, /createCompactEmptyState\('可選項目已全部加入目前選擇'\)/);
  assert.doesNotMatch(groupBooking, /participant-service-stack/);
  assert.doesNotMatch(groupBooking, /participant-service-picker-fieldset/);
  assert.doesNotMatch(groupBooking, /participant-selected-service-fieldset/);
});

test('later participants use the same duplicate item and same-type warning rules as the first participant', () => {
  const app = read('booking/app.js');
  const groupBooking = read('booking/group-booking.js');

  const sharedMessages = [
    '${service.title} 已加入兩次，無法再重複加入。',
    '${service.title} 已有選擇。',
    '目前已選擇相同類型「${serviceType}」的項目：${names}。',
    '仍要加入這個預約項目嗎？',
  ];

  for (const source of [app, groupBooking]) {
    sharedMessages.forEach((message) => assert.ok(source.includes(message), message));
  }

  assert.match(groupBooking, /formatServiceMoney\(service\.priceAmount\)/);
  assert.match(groupBooking, /clearParticipantFormMessage\(\)/);
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
  assert.match(html, /group-booking\.js\?v=booking-participant-amounts-20260918-1/);
});


test('member group booking shows an amount for every participant surface', () => {
  const groupBooking = read('booking/group-booking.js');
  const html = read('booking/index.html');

  assert.match(groupBooking, /node\.textContent = .*金額.*formatMoney\(amount\)/s);
  assert.match(groupBooking, /amount\.textContent = `金額：\$\{formatMoney\(metric\.amount\)\}`/);
  assert.match(groupBooking, /amountLine\.textContent = `金額：\$\{formatMoney\(metric\.amount\)\}`/);
  assert.match(groupBooking, /storedParticipantAmount\(participant\)/);
  assert.match(groupBooking, /item\?\.subtotalAmount/);
  assert.match(html, /group-booking\.js\?v=booking-participant-amounts-20260918-1/);
});
