const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('paired admin booking E2E covers every admin booking action using user-created bookings', () => {
  const e2e = read('admin/e2e-control.js');

  assert.match(e2e, /recordResultRows/);
  assert.match(e2e, /pairedAdminBookingFollowupCase/);
  assert.match(e2e, /PAIRED_' \+ participant\.index \+ '_ADMIN_BOOKING_FOLLOWUP/);
  assert.match(e2e, /QA HUMAN E2E/);
  assert.match(e2e, /修改此位項目/);
  assert.match(e2e, /修改服務項目/);
  assert.match(e2e, /修改此位技師/);
  assert.match(e2e, /data-participant-technician/);
  assert.match(e2e, /確認預約/);
  assert.match(e2e, /不通過/);
  assert.match(e2e, /確認服務完成/);
  assert.match(e2e, /取消預約/);
  assert.match(e2e, /reject-cancellation/);
  assert.match(e2e, /保留預約/);
  assert.match(e2e, /approve-cancellation/);
  assert.match(e2e, /確認取消/);
  assert.match(e2e, /requestDetectedCancellationFromClient/);
  assert.match(e2e, /expectedStatus === 'completed'/);
  assert.match(e2e, /separatePendingBooking/);
  assert.match(e2e, /participant\.account\?\.memberId/);

  assert.match(e2e, /waitForLivePairedBookingTarget\(participant, 'any'\)/);
  assert.match(e2e, /let adminChain = Promise\.resolve\(\)/);
  assert.match(e2e, /Promise\.all\(\[\.\.\.clientTasks, \.\.\.liveAdminTasks\]\)/);
  assert.doesNotMatch(e2e, /Promise\.all\(\[adminTask, \.\.\.clientTasks\]\)/);
});


test('standalone admin booking queue E2E actively mutates pending and cancellation-request states for test members only', () => {
  const e2e = read('admin/e2e-control.js');
  const adminIndex = read('admin/index.html');

  assert.match(e2e, /runBookingPendingE2EButton/);
  assert.match(e2e, /runBookingCancellationE2EButton/);
  assert.match(e2e, /runAdminBookingQueueE2E\('pending'\)/);
  assert.match(e2e, /runAdminBookingQueueE2E\('cancellation'\)/);
  assert.match(e2e, /prepareAdminBookingQueueScenario/);
  assert.match(e2e, /prepareTestAccounts\(1\)/);
  assert.match(e2e, /user\.qa\.usage-state\.prepare/);
  assert.match(e2e, /testSessionToken/);
  assert.match(e2e, /waitStandaloneBookingRows/);
  assert.match(e2e, /String\(booking\?\.memberId \|\| ''\) === String\(memberId \|\| ''\)/);

  assert.match(e2e, /ADMIN_BOOKING_PENDING_CONFIRM/);
  assert.match(e2e, /ADMIN_BOOKING_PENDING_REJECT/);
  assert.match(e2e, /確認預約/);
  assert.match(e2e, /不通過/);

  assert.match(e2e, /ADMIN_BOOKING_CANCELLATION_KEEP/);
  assert.match(e2e, /ADMIN_BOOKING_CANCELLATION_APPROVE/);
  assert.match(e2e, /保留預約/);
  assert.match(e2e, /確認取消/);
  assert.match(e2e, /requestDetectedCancellationWithTestSession/);
  assert.match(e2e, /user\.booking\.cancel/);

  assert.match(e2e, /runBookingPending:/);
  assert.match(e2e, /runBookingCancellation:/);
  assert.match(adminIndex, /e2e-control\.js\?v=admin-e2e-20260923-5/);
});

test('admin full E2E covers standalone lottery ticket and event lottery ticket persistence', () => {
  const e2e = read('admin/e2e-control.js');

  assert.match(e2e, /ADMIN_LOTTERY_TICKET_CRUD/);
  assert.match(e2e, /adminLotteryTicketCrudCase/);
  assert.match(e2e, /configureLotteryPrizeEditor/);
  assert.match(e2e, /setField\(typeId, 'lottery'\)/);
  assert.match(e2e, /configureLotteryPrizeEditor\('ticket'/);
  assert.match(e2e, /configureLotteryPrizeEditor\('event'/);
  assert.match(e2e, /eventTicketType/);
  assert.match(e2e, /ticketPrizeRows/);
  assert.match(e2e, /eventTicketPrizeRows/);
  assert.match(e2e, /probability100/);
  assert.match(e2e, /persistedAndReloaded/);
});

test('point-card E2E links a lottery ticket and deep paired flow verifies the draw result', () => {
  const e2e = read('admin/e2e-control.js');

  assert.match(e2e, /E2E QA 集點卡抽獎券/);
  assert.match(e2e, /ticketType: 'lottery'/);
  assert.match(e2e, /lotteryTicketLinked/);
  assert.match(e2e, /lotteryRewardReloaded/);
  assert.match(e2e, /E2E QA 深度集點抽獎券/);
  assert.match(e2e, /redeemDeepTicketInChild\(child, ctx\.ticketTitle, true\)/);
  assert.match(e2e, /lotteryResultVisible/);
  assert.match(e2e, /抽中：/);
});
