const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const vm = require('node:vm');

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
  assert.match(groupBooking, /section\.className = `service-info service-type-group service-type-color-\$\{colorSlot\}`/);
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

test('selection summary sync scripts have valid JavaScript syntax', () => {
  execFileSync(process.execPath, ['--check', path.join(root, 'booking/app.js')], { stdio: 'pipe' });
  execFileSync(process.execPath, ['--check', path.join(root, 'booking/group-booking.js')], { stdio: 'pipe' });
});

test('member booking entrypoint cache-busts participant format parity', () => {
  const html = read('booking/index.html');
  assert.match(html, /member-booking-format\.js\?v=booking-history-dedupe-services-20260918-1/);
  assert.match(html, /group-booking\.js\?v=booking-history-dedupe-final-20260918-1/);
});


test('member group booking shows an amount for every participant surface', () => {
  const groupBooking = read('booking/group-booking.js');
  const html = read('booking/index.html');

  assert.match(groupBooking, /node\.textContent = .*金額.*formatMoney\(amount\)/s);
  assert.match(groupBooking, /amount\.textContent = `金額：\$\{formatMoney\(metric\.amount\)\}`/);
  assert.match(groupBooking, /amountLine\.textContent = `金額：\$\{formatMoney\(metric\.amount\)\}`/);
  assert.match(groupBooking, /storedParticipantAmount\(participant\)/);
  assert.match(groupBooking, /item\?\.subtotalAmount/);
  assert.match(html, /group-booking\.js\?v=booking-history-dedupe-final-20260918-1/);
});


test('selection summary shows the assigned technician for every participant', () => {
  const groupBooking = read('booking/group-booking.js');

  assert.match(groupBooking, /technician\.textContent = `預約技師：\$\{technicianLabel\(state\.participantTechnicians\[index\]\)\}`/);
  assert.match(groupBooking, /block\.append\(heading, services, duration, amount, technician\)/);
});

test('calendar date selection exits edit mode and clears grouped edit state', () => {
  const app = read('booking/app.js');
  const groupBooking = read('booking/group-booking.js');

  assert.match(app, /window\.addEventListener\('booking:date-selected', beginNewBookingFromDateSelection\)/);
  assert.match(app, /function beginNewBookingFromDateSelection\(\) \{\s*if \(state\.editing\) endEditing\(\);\s*else updateEditingLabel\(\);\s*\}/);
  assert.match(groupBooking, /window\.addEventListener\('booking:date-selected', \(\) => \{[\s\S]*?if \(!state\.editingBookingId\) return;[\s\S]*?state\.editingBookingId = '';[\s\S]*?resetGroupSelection\(\);[\s\S]*?\}\);/);
});

test('primary participant summary follows add/remove selection state without waiting for slot API', () => {
  const app = read('booking/app.js');
  const groupBooking = read('booking/group-booking.js');

  assert.match(app, /notifySelectionChanged\(\);\n\s*els\.slotHint\.textContent = '正在計算整段服務時間可使用的時段…'/);
  assert.match(app, /window\.dispatchEvent\(new CustomEvent\('booking:selection-changed'/);
  assert.match(app, /detail: \{ items: selectedItems\(\) \}/);

  assert.match(groupBooking, /window\.addEventListener\('booking:selection-changed'/);
  assert.match(groupBooking, /syncPrimaryItems\(event\?\.detail\?\.items\)/);
  assert.match(groupBooking, /function syncPrimaryItems\(items\)/);
  assert.match(groupBooking, /syncPrimaryItems\(primaryItems\)/);
  assert.match(groupBooking, /root\.replaceChildren\(\);\n\s*root\.classList\.add\('hidden'\)/);
});


test('service type blocks use stable distinct colors across all participant pickers', () => {
  const formatter = read('booking/member-booking-format.js');
  const css = read('booking/member-booking-format.css');
  const html = read('booking/index.html');

  assert.match(formatter, /window\.BookingServiceTypeColor\.slot\(label\)/);
  assert.match(formatter, /decorateServiceTypeGroups\(\)/);
  assert.match(formatter, /section\.className = 'service-info service-type-group'/);
  assert.match(formatter, /section\.dataset\.serviceTypeColor = String\(slot\)/);
  assert.match(formatter, /section\.classList\.add\(\`service-type-color-\$\{slot\}\`\)/);
  assert.match(formatter, /#participantCardList \.service-picker > \.service-info/);
  assert.match(formatter, /#participantCardList \.selected-service-list > \.service-info/);

  for (let index = 0; index < 12; index += 1) {
    assert.match(css, new RegExp('service-type-color-' + index + ' \\{'));
  }
  assert.doesNotMatch(css, /rgb\(var\(--service-type-rgb\)/);
  assert.match(css, /service-type-color-0 \.service-choice/);
  assert.match(css, /service-type-color-11 \.selected-service-item/);
  assert.match(css, /service-info\.service-type-group > strong::before/);
  assert.match(css, /@media \(max-width: 620px\)[\s\S]*border-left-width: 5px/);
  assert.match(html, /member-booking-format\.css\?v=booking-service-type-colors-webview-20260918-2/);
  assert.match(html, /member-booking-format\.js\?v=booking-history-dedupe-services-20260918-1/);
});


test('every participant renderer assigns service type colors before DOM insertion', () => {
  const groupBooking = read('booking/group-booking.js');
  const formatter = read('booking/member-booking-format.js');

  assert.match(groupBooking, /const colorSlot = window\.BookingServiceTypeColor\.slot\(group\.label\)/);
  assert.match(groupBooking, /section\.className = `service-info service-type-group service-type-color-\$\{colorSlot\}`/);
  assert.match(groupBooking, /section\.dataset\.serviceTypeColor = String\(colorSlot\)/);

  assert.match(formatter, /const slot = window\.BookingServiceTypeColor\.slot\(label\)/);
  assert.match(formatter, /section\.classList\.add\(`service-type-color-\$\{slot\}`\)/);
});


test('same service type keeps the same color across different participants', () => {
  const html = read('booking/index.html');
  const groupBooking = read('booking/group-booking.js');
  const formatter = read('booking/member-booking-format.js');
  const colorSource = read('booking/service-type-color.js');

  const context = { window: {} };
  vm.runInNewContext(colorSource, context);
  const colorMap = context.window.BookingServiceTypeColor;

  assert.equal(colorMap.slot('按摩'), colorMap.slot('按摩'));
  assert.equal(colorMap.slot('按摩'), colorMap.slot(' 按摩 '));
  assert.equal(colorMap.normalize(' 按摩 '), '按摩');

  assert.match(groupBooking, /window\.BookingServiceTypeColor\.slot\(group\.label\)/);
  assert.match(formatter, /window\.BookingServiceTypeColor\.slot\(label\)/);

  const sharedIndex = html.indexOf('service-type-color.js?v=booking-shared-type-color-map-20260918-4');
  const groupIndex = html.indexOf('group-booking.js?v=booking-history-dedupe-final-20260918-1');
  const formatterIndex = html.indexOf('member-booking-format.js?v=booking-history-dedupe-services-20260918-1');
  assert.ok(sharedIndex >= 0 && sharedIndex < groupIndex);
  assert.ok(sharedIndex < formatterIndex);
});

test('shared service type color map has valid JavaScript syntax', () => {
  execFileSync(process.execPath, ['--check', path.join(root, 'booking/service-type-color.js')], { stdio: 'pipe' });
});
