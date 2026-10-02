const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('booking benefit selector is inside appointment form above member note', () => {
  const html = read('booking/index.html');
  const benefit = html.indexOf('id="bookingBenefits"');
  const note = html.indexOf('id="memberNote"');
  const formStart = html.indexOf('id="bookingForm"');
  const formEnd = html.indexOf('</form>', formStart);
  assert.ok(formStart >= 0 && benefit > formStart && benefit < formEnd);
  assert.ok(benefit < note);
  assert.match(html, /本次可使用優惠/);
});

test('member create/update paths persist exact benefit intent', () => {
  const app = read('booking/app.js');
  const bookingApi = read('supabase/functions/booking-api/index.ts');
  const groupApi = read('supabase/functions/booking-group-api/index.ts');
  assert.match(app, /BookingBenefits\?\.selectionPayload/);
  assert.match(app, /benefits:\s*window\.BookingBenefits/);
  assert.match(app, /setSelection\?\.\(booking\.benefits/);
  assert.match(bookingApi, /create_booking_bundle_with_benefits_request/);
  assert.match(bookingApi, /update_booking_bundle_with_benefits_request/);
  assert.match(groupApi, /create_group_booking_with_benefits_request_v2/);
  assert.match(groupApi, /update_group_booking_with_benefits_request_v2/);
  assert.match(groupApi, /booking_benefit_selections/);
});

test('completion uses one database transaction to redeem and settle', () => {
  const migration = read('supabase/migrations/20261002093000_booking_benefit_selection_redemption.sql');
  const adminOps = read('supabase/functions/booking-admin-operations/index.ts');
  assert.match(migration, /create table if not exists public\.booking_benefit_selections/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on table public\.booking_benefit_selections from anon, authenticated/);
  assert.match(migration, /public\.redeem_point_tickets\(/);
  assert.match(migration, /public\.redeem_event_tickets_with_location\(/);
  assert.match(migration, /public\.complete_booking_with_rewards_request\(/);
  assert.match(migration, /admin_confirm_booking_receipt_request[\s\S]*complete_booking_with_benefits_request/);
  assert.match(migration, /booking_benefit_selections_terminal_status/);
  assert.match(adminOps, /complete_booking_with_benefits_request/);
  assert.match(adminOps, /EVENT_TICKET_DAILY_LIMIT_REACHED/);
});

test('location-restricted tickets cannot use booking auto-redemption', () => {
  const source = read('supabase/functions/_shared/booking-benefits.ts');
  const migration = read('supabase/migrations/20261002093000_booking_benefit_selection_redemption.sql');
  assert.match(source, /!offer\.requiresLocation/);
  assert.match(source, /需於票券頁完成定位核銷/);
  assert.match(migration, /BOOKING_BENEFIT_LOCATION_REQUIRED/);
});
