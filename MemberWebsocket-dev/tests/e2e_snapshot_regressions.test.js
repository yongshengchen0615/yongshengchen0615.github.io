const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('booking refresh is last-request-wins so stale realtime responses cannot overwrite newer state', () => {
  const app = read('booking/app.js');
  assert.match(app, /refreshSequence: 0/);
  assert.match(app, /const refreshSequence = \+\+state\.refreshSequence/);
  assert.match(app, /if \(refreshSequence !== state\.refreshSequence\) return false/);
  assert.match(app, /較舊的 Bootstrap 回應覆蓋較新的預約狀態/);
});

test('event lottery history renders from the normalized ticket type', () => {
  const app = read('event/app.js');
  assert.match(app, /history && claim && ticket\.ticketType === 'lottery' && claim\.result/);
  assert.match(app, /renderRedeemedResult\(\{ \.\.\.claim, ticketType: 'lottery' \}\)/);
  assert.doesNotMatch(app, /history && claim && claim\.ticketType === 'lottery'/);
});

test('required booking Human E2E searches multiple enabled dates before failing', () => {
  const runner = read('user-test-control.js');
  assert.match(runner, /function firstEnabledBookingDate\(offset = 0\)/);
  assert.match(runner, /const maxDateAttempts = Math\.max\(1, Math\.min\(5,/);
  assert.match(runner, /openBookingForSafeDate\(attempt\)/);
  assert.match(runner, /已嘗試多個可預約日期，仍找不到可供真人 E2E 的預約時段/);
});

test('booking edit lifecycle falls back to an available slot when the original slot is not restored', () => {
  const runner = read('user-test-control.js');
  assert.match(runner, /let editableSlot = await waitFor/);
  assert.match(runner, /editableSlot = await chooseAvailableSlot\(\)/);
  assert.match(runner, /actual\.editSlotRestored = Boolean\(editableSlot\)/);
});

test('group booking Human E2E searches multiple dates and keeps a safely mutable quantity', () => {
  const runner = read('user-test-control.js');
  assert.match(runner, /for \(let attempt = 0; attempt < maxDateAttempts && !slot; attempt \+= 1\)/);
  assert.match(runner, /openBookingForSafeDate\(attempt\)/);
  assert.match(runner, /actual\.firstQuantityTwo = actual\.firstQuantityTwo \|\| Boolean/);
  assert.match(runner, /已嘗試多個可預約日期，仍找不到可容納兩位的安全時段/);
  assert.match(runner, /attemptedDates: maxDateAttempts/);
});

test('required Human E2E coverage reports missing execution without duplicating case failures', () => {
  const runner = read('user-test-control.js');
  assert.match(runner, /const missingHumanCases = requiredHumanCases\.filter/);
  assert.match(runner, /const failedHumanCases = requiredHumanCases\.filter/);
  assert.match(runner, /const blockedHumanCases = requiredHumanCases\.filter/);
  assert.match(runner, /Coverage 僅彙總，不重複製造第二個 failure/);
  assert.match(runner, /\.\.\.skip\('真人操作案例已有各自的失敗或環境阻擋結果/);
});

test('admin E2E refreshes stale test roster and waits for member write completion', () => {
  const runner = read('admin/e2e-control.js');
  assert.match(runner, /search\.value = memberCode/);
  assert.match(runner, /search\.dispatchEvent\(new Event\('input', \{ bubbles: true \}\)\)/);
  assert.match(runner, /await waitFor\(\(\) => !button\.disabled, 10000\)/);
});

test('deep point-card E2E recovers the persisted card id from the rendered admin list', () => {
  const runner = read('admin/e2e-control.js');
  assert.match(runner, /#cardListItems \[data-card-id\]/);
  assert.match(runner, /savedCard\?\.dataset\.cardId/);
  assert.match(runner, /await waitAdminWriteSettled\('saveCardButton'\)/);
});

test('admin booking controls and CRUD wait for authoritative panel state between mutations', () => {
  const runner = read('admin/e2e-control.js');
  assert.match(runner, /actual\.servicesReady = Boolean\(await waitBookingAdminReady\(15000\)\)/);
  assert.match(runner, /bookingAdminTypeList'\)\?\.children\.length > 0/);
  assert.match(runner, /if \(actual\.typeCreated\) \{ await waitBookingAdminReady\(15000\); await wait\(120\); \}/);
  assert.match(runner, /if \(actual\.serviceUpdated\) \{ await waitBookingAdminReady\(15000\); await wait\(120\); \}/);
});


test('admin E2E delay helper is defined for CRUD and deep realtime call sites', () => {
  const runner = read('admin/e2e-control.js');
  assert.match(runner, /function wait\(ms\) \{\s*return sleep\(ms\);\s*\}/);
});

test('event lottery history waits for asynchronous result rendering', () => {
  const runner = read('user-test-control.js');
  assert.match(
    runner,
    /lotteryHistoryResultVisible = Boolean\(await waitFor\(\(\) => \{[\s\S]*#ticketModalResult \.lottery-result strong[\s\S]*actual\.lotteryPrizeTitle[\s\S]*\}, 4000, 100\)\)/
  );
});

test('booking admin refreshes coalesce instead of dropping updates', () => {
  const core = read('admin/booking-panel-core.js');
  const cancellation = read('admin/booking-cancellation-sync.js');
  assert.match(core, /state\.refreshQueued = true/);
  assert.match(core, /window\.setTimeout\(\(\) => \{ refreshAll\(queuedShowSuccess\); \}, 0\)/);
  assert.match(cancellation, /refreshQueuedIncludeBookings = refreshQueuedIncludeBookings \|\| Boolean\(includeBookings\)/);
  assert.match(cancellation, /document\.visibilityState === 'hidden' && !isBackgroundE2ERunner\(\)/);
});

test('booking admin actions do not cascade one item-mutation failure into technician and completion failures', () => {
  const runner = read('admin/e2e-control.js');
  assert.match(runner, /caseDef\(prefix \+ 'MODIFY_TECHNICIAN'[\s\S]*if \(!actual\.confirmed\?\.ok\)/);
  assert.doesNotMatch(runner, /caseDef\(prefix \+ 'MODIFY_TECHNICIAN'[\s\S]{0,500}!actual\.modified\?\.ok/);
  assert.match(runner, /caseDef\(prefix \+ 'COMPLETE'[\s\S]*if \(!actual\.confirmed\?\.ok\)/);
  assert.match(runner, /expectedRealtimeChecks/);
  assert.match(runner, /realtimeRows\.length >= expectedRealtimeChecks/);
});

test('group booking item mutation has a non-expanding fallback for assigned technicians', () => {
  const runner = read('admin/e2e-control.js');
  assert.match(runner, /mutationMode = 'remove-item'/);
  assert.match(runner, /safeMutation: removingItem\s*\? 'remove-existing-item'/);
  assert.match(runner, /const afterQuantity = removingItem \? 0/);
});

test('dynamic test-history buttons expose stable metadata for coverage classification', () => {
  const client = read('admin/test-control.js');
  assert.match(client, /button\.dataset\.testRunId\s*=\s*String\(run\.id\s*\|\|\s*''\)/);
});

test('all affected entrypoints bust caches for the fixed controllers', () => {
  for (const surface of ['member','points','event','calendar','booking']) {
    assert.match(read(surface + '/index.html'), /user-test-control\.js\?v=human-e2e-20260928-\d+/);
  }
  assert.match(read('booking/index.html'), /app\.js\?v=booking-overnight-20260928-1/);
  assert.match(read('event/index.html'), /app\.js\?v=event-result-hidden-20260929-2/);
  assert.match(read('admin/index.html'), /test-control\.js\?v=test-control-[A-Za-z0-9._-]+/);
  assert.match(read('admin/index.html'), /e2e-control\.js\?v=event-coupon-location-20260928-1/);
});
