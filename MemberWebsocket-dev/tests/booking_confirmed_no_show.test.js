const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const core = fs.readFileSync(path.join(root, 'admin/booking-panel-core.js'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261014083000_allow_confirmed_booking_no_show.sql'), 'utf8');

test('pending and confirmed regular bookings share the no-show button and retain distinct follow-up actions', () => {
  assert.match(core, /if \(booking\.status === 'pending' \|\| booking\.status === 'confirmed'\) \{\s*const reason = noShowUnavailableReason\(booking\)/);
  assert.match(core, /if \(booking\.status === 'pending'\) \{\s*actions\.append\(\s*actionButton\('不通過'/);
  assert.match(core, /actionButton\('確認服務完成', 'button button-dark'/);
  assert.match(core, /if \(!\['pending', 'confirmed'\]\.includes\(booking\.status\)\)/);
  assert.match(core, /booking\.receiptSubmissionId \|\| String\(booking\.requestId/);
  assert.match(core, /booking\.cancellationRequestedAt && !booking\.cancellationReviewedAt/);
  assert.match(core, /服務結束後才能標記無故未到/);
  assert.doesNotMatch(core, /我已人工核對，確認這筆仍待確認的預約無故未到/);
});

test('server-side no-show transition remains privileged, time-gated and audited', () => {
  assert.match(migration, /if b\.status not in \('pending','confirmed'\) then raise exception 'BOOKING_NO_SHOW_NOT_ALLOWED'/);
  assert.match(migration, /role='admin' and status='active'/);
  assert.match(migration, /b\.receipt_submission_id is not null/);
  assert.match(migration, /b\.cancellation_requested_at is not null and b\.cancellation_reviewed_at is null/);
  assert.match(migration, /b\.updated_at<>p_expected_updated_at/);
  assert.match(migration, /b\.end_at>=\(clock_timestamp\(\) at time zone 'Asia\/Taipei'\)/);
  assert.match(migration, /insert into public\.booking_audit_events/);
  assert.match(migration, /revoke all on function public\.admin_mark_booking_no_show/);
  assert.match(migration, /grant execute on function public\.admin_mark_booking_no_show\(text,uuid,timestamptz,text\) to service_role/);
});
