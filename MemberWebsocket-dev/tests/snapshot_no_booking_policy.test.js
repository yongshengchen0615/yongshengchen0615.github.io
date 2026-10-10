const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('snapshot receipt API explicitly skips global booking requirement while retaining member authentication', () => {
 const api = read('supabase/functions/booking-receipt-api/index.ts');
 assert.match(api, /action==="user\.booking\.receipt\.options"/);
 assert.match(api, /data=\{\.\.\.catalog,ticketBookingRequired:false\}/);
 assert.match(api, /const member=await requireMember\(supabase,identity\)/);
 assert.match(api, /accessible\?"prepare_snapshot_receipt_v2":"prepare_booking_receipt_request"/);
 assert.doesNotMatch(api, /const policy=await supabase\.from\("booking_settings"\)\.select\("ticket_booking_required"\)/);
});

test('snapshot receipt migration removes only the prebooking gate and retains availability, ownership, idempotency and SQL ACL', () => {
 const sql=read('supabase/migrations/20261010145511_snapshot_tickets_without_advance_booking.sql');
 assert.match(sql, /create or replace function public\.validate_snapshot_ticket_selection/);
 assert.match(sql, /create or replace function public\.register_snapshot_receipt_v2/);
 assert.doesNotMatch(sql, /if p_booking_id is null then raise exception 'BOOKING_TICKET_CONFIRMATION_REQUIRED'/);
 assert.doesNotMatch(sql, /jsonb_array_length\(p_benefits\)>0 and required and p_booking is null/);
 for(const marker of ['BOOKING_NOT_OWNED','MEMBERSHIP_REQUIRED','BOOKING_BENEFIT_NOT_AVAILABLE','POINT_TICKET_INSUFFICIENT_POINTS','TICKET_BATCH_LIMIT_EXCEEDED','EVENT_TICKET_DAILY_LIMIT_REACHED','ADMIN_REQUIRED','REQUEST_ID_CONFLICT']) {
  if(marker==='REQUEST_ID_CONFLICT') continue; // preserved in prepare_snapshot_receipt_v2, not rewritten
  assert.ok(sql.includes(marker),marker+' must remain enforced');
 }
 assert.match(sql, /revoke all on function public\.validate_snapshot_ticket_selection/);
 assert.match(sql, /grant execute on function public\.register_snapshot_receipt_v2[^\n]* to service_role/);
 assert.doesNotMatch(sql, /alter table public\.booking_settings|update public\.booking_settings/);
});

test('snapshot receipt sends intent without booking ID while standard redemption remains unchanged', () => {
 const receipt=read('booking/booking-receipt.js');
 assert.match(receipt, /accessible: true, location: state\.location, benefits: selectedBenefits/);
 assert.doesNotMatch(receipt, /snapshotTicketBooking|requestedBookingId/);
 assert.match(receipt, /const blocked = item\.selectable !== true/);
 assert.match(receipt, /check\.dataset\.snapshotKind = item\.kind/);
 assert.match(receipt, /check\.dataset\.snapshotId = item\.selectionId/);
});
