const fs = require('node:fs');
const assert = require('node:assert/strict');

const edge = fs.readFileSync('MemberWebsocket-dev/supabase/functions/booking-admin-operations/index.ts', 'utf8');
const migration = fs.readFileSync('MemberWebsocket-dev/supabase/migrations/20260918161000_admin_booking_participant_technicians.sql', 'utf8');
const core = fs.readFileSync('MemberWebsocket-dev/admin/booking-panel-core.js', 'utf8');

assert.match(core, /修改此位技師/);
assert.match(core, /admin\.booking\.participants\.technicians\.update/);
assert.match(core, /expectedUpdatedAt:\s*booking\.updatedAt/);
assert.match(core, /至少一位預約人必須指定主要技師/);
assert.match(core, /同一筆多人預約不可重複指定同一位技師/);

assert.match(edge, /async function updateParticipantTechnicians/);
assert.match(edge, /admin_update_booking_participant_technicians_request/);
assert.match(edge, /BOOKING_PRIMARY_TECHNICIAN_REQUIRED/);
assert.match(edge, /DUPLICATE_PARTICIPANT_TECHNICIAN/);
assert.match(edge, /BOOKING_TECHNICIAN_DISABLED/);
assert.match(edge, /BOOKING_SLOT_TAKEN/);
assert.match(edge, /admin\.booking\.participants\.technicians\.update/);

assert.match(migration, /for update/);
assert.match(migration, /b\.updated_at <> p_expected_updated_at/);
assert.match(migration, /b\.status not in \('pending', 'confirmed'\)/);
assert.match(migration, /BOOKING_CANCELLATION_PENDING/);
assert.match(migration, /validate_group_booking_technicians\(p_participants\)/);
assert.match(migration, /delete from public\.booking_participant_reservations[\s\S]*where booking_id = b\.id/);
assert.ok(
  migration.indexOf('delete from public.booking_participant_reservations') < migration.indexOf('for person in'),
  'existing reservations must be cleared before rebuilding assignments so technician swaps do not self-conflict',
);
assert.match(migration, /when exclusion_violation/);
assert.match(migration, /BOOKING_SLOT_TAKEN/);
assert.match(migration, /BOOKING_PARTICIPANT_TECHNICIANS_UPDATED/);
assert.match(migration, /revoke execute on function public\.admin_update_booking_participant_technicians_request/);
assert.match(migration, /grant execute on function public\.admin_update_booking_participant_technicians_request[\s\S]*to service_role/);

console.log('booking participant technician update safety wiring OK');
