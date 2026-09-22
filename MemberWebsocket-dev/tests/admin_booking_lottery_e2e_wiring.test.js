const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('paired admin booking E2E takes over user-created booking data after client runs', () => {
  const e2e = read('admin/e2e-control.js');

  assert.match(e2e, /recordResultRows/);
  assert.match(e2e, /pairedAdminBookingFollowupCase/);
  assert.match(e2e, /PAIRED_' \+ participant\.index \+ '_ADMIN_BOOKING_FOLLOWUP/);
  assert.match(e2e, /QA HUMAN E2E/);
  assert.match(e2e, /修改此位項目/);
  assert.match(e2e, /修改服務項目/);
  assert.match(e2e, /確認預約/);
  assert.match(e2e, /不通過/);
  assert.match(e2e, /bookingCancellationRequestFilter/);
  assert.match(e2e, /reject-cancellation/);
  assert.match(e2e, /participant\.account\?\.memberId/);

  const clientJoin = e2e.indexOf('await Promise.all([adminTask, ...clientTasks]);');
  const followup = e2e.indexOf("'_ADMIN_BOOKING_FOLLOWUP'");
  assert.ok(clientJoin >= 0 && followup > clientJoin, 'admin booking follow-up must execute only after all user surfaces finish');
});

test('admin full E2E covers lottery ticket and lottery event ticket persistence', () => {
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
  assert.match(e2e, /機率合計/);
  assert.match(e2e, /probability100/);
  assert.match(e2e, /persistedAndReloaded/);
});
