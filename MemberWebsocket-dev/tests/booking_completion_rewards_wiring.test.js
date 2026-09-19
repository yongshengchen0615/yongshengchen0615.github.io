const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

test('booking service type UI exposes completion reward settings', () => {
  const source = read('admin/booking-panel-core.js');
  assert.match(source, /data-type-reward-enabled/);
  assert.match(source, /data-type-reward-minutes/);
  assert.match(source, /data-type-reward-card/);
  assert.match(source, /店內服務時間不計入/);
  assert.match(source, /自動累積服務時間、依項目類型發放集點並發送 LINE 通知/);
});

test('booking admin API persists service type reward settings server-side', () => {
  const source = read('supabase/functions/booking-admin-api/index.ts');
  assert.match(source, /booking_service_type_rewards/);
  assert.match(source, /save_booking_service_type/);
  assert.match(source, /rewardMinutesPerPoint/);
  assert.match(source, /rewardPointCardId/);
});

test('booking completion uses one transactional database settlement', () => {
  const source = read('supabase/functions/booking-admin-operations/index.ts');
  assert.match(source, /complete_booking_with_rewards_request/);
  assert.doesNotMatch(source, /status:\s*"completed"[\s\S]*\.from\("bookings"\)\.update/);
});

test('completed LINE notifications include settlement results', () => {
  const source = read('supabase/functions/booking-line-notifications/index.ts');
  assert.match(source, /booking_completion_settlements/);
  assert.match(source, /完成服務時間/);
  assert.match(source, /獲得集點/);
});

test('migration excludes store service and protects idempotency', () => {
  const source = read('supabase/migrations/20260919084927_booking_service_type_completion_rewards.sql');
  assert.match(source, /00000000-0000-4000-8000-000000000010/);
  assert.match(source, /booking_completion_settlements/);
  assert.match(source, /booking-complete:/);
  assert.match(source, /on conflict \(request_id, member_id, point_card_id\)/i);
  assert.match(source, /on conflict \(request_id, member_id\)/i);
  assert.match(source, /revoke all on function public\.complete_booking_with_rewards_request/);
});
