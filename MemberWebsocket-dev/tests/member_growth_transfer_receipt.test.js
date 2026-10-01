const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('member growth API keeps referral and point transfer writes behind server RPC boundaries', () => {
  const api = read('supabase/functions/member-growth-api/index.ts');
  const referral = read('supabase/migrations/20260930150500_member_referral_rewards.sql');
  const transfer = read('supabase/migrations/20260930151500_point_transfer_atomic.sql');

  assert.match(api, /verifyLineIdTokenContract/);
  assert.match(api, /resolveUserTestIdentity/);
  assert.match(api, /hasCurrentTermsConsent/);
  assert.match(api, /consume_api_rate_limit/);
  assert.match(api, /bind_member_referral/);
  assert.match(api, /transfer_member_points/);

  assert.match(referral, /unique references public\.members\(id\)/);
  assert.match(referral, /SELF_REFERRAL_NOT_ALLOWED/);
  assert.match(referral, /REFERRAL_CYCLE_NOT_ALLOWED/);
  assert.match(referral, /rewardCount',2/);

  assert.match(transfer, /for update/);
  assert.match(transfer, /REQUEST_ID_CONFLICT/);
  assert.match(transfer, /transfer_out/);
  assert.match(transfer, /transfer_in/);
  assert.match(transfer, /point_transfers_sender_request_unique/);
});

test('booking receipt completion requires a private upload and canonical settlement', () => {
  const edge = read('supabase/functions/booking-receipt-api/index.ts');
  const migration = read('supabase/migrations/20260930152500_booking_receipt_completion.sql');
  const memberUi = read('booking/booking-receipt.js');
  const adminUi = read('admin/booking-receipt-admin.js');

  assert.match(migration, /'booking-receipts'/);
  assert.match(migration, /values\(\s*'booking-receipts',\s*'booking-receipts',\s*false,/);
  assert.match(migration, /BOOKING_NOT_OWNED/);
  assert.match(migration, /BOOKING_NOT_FINISHED_YET/);
  assert.match(migration, /complete_booking_with_rewards_request/);
  assert.match(migration, /status='bound'/);

  assert.match(edge, /createSignedUploadUrl/);
  assert.match(edge, /sniffMime/);
  assert.match(edge, /fileSha256Hex/);
  assert.match(edge, /createSignedUrl\(String\(result\.data\.object_path\),120\)/);

  assert.match(memberUi, /capture="environment"/);
  assert.match(memberUi, /uploadToSignedUrl/);
  assert.match(memberUi, /user\.booking\.receipt\.finalize/);
  assert.match(adminUi, /admin\.booking\.receipt\.url/);
  assert.match(adminUi, /由會員拍攝收據完成/);
});

test('today usable count is server-derived and rendered separately from claim inventory', () => {
  const migration = read('supabase/migrations/20260930153500_today_usable_event_ticket_count.sql');
  const ui = read('event/today-usable.js');

  assert.match(migration, /Asia\/Taipei/);
  assert.match(migration, /c\.status='claimed'/);
  assert.match(migration, /current_tier_key/);
  assert.match(ui, /今日可使用/);
  assert.match(ui, /暫時無法取得/);
});
