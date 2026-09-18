const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('participant-aware booking copy formatter is valid and wired', () => {
  const source = fs.readFileSync(path.join(root, 'booking-copy-format.js'), 'utf8');
  const loader = fs.readFileSync(path.join(root, 'admin/index.html'), 'utf8');

  assert.doesNotThrow(() => new Function(source));
  assert.match(loader, /booking-copy-format\.js/);
  assert.match(source, /booking-group-details-api/);
  assert.match(source, /預約人數：\$\{partySize\} 位/);
  assert.match(source, /預約項目：\$\{participantItems\(participant\.items\)\}/);
  assert.match(source, /預約技師：/);
  assert.match(source, /return `\$\{month\}\/\$\{day\}（\$\{weekday\}）`/);
  assert.match(source, /return lines\.join\('\\n'\)/);
});

test('LINE notification enablement is committed as a migration', () => {
  const migration = fs.readFileSync(
    path.join(root, 'supabase/migrations/20260917151950_enable_booking_line_notifications.sql'),
    'utf8',
  );
  assert.match(migration, /update booking_notifications\.config/);
  assert.match(migration, /set enabled = true/);
});


test('booking notifications use participant details and profile contact fallback', () => {
  const migration = fs.readFileSync(
    path.join(root, 'supabase/migrations/20260918101500_booking_participant_notification_details.sql'),
    'utf8',
  );
  const contactApi = fs.readFileSync(
    path.join(root, 'supabase/functions/booking-contact-api/booking.ts'),
    'utf8',
  );
  const delivery = fs.readFileSync(
    path.join(root, 'supabase/functions/booking-line-notifications/delivery.ts'),
    'utf8',
  );

  assert.match(migration, /booking_participants/);
  assert.match(migration, /booking_participant_items/);
  assert.match(migration, /預約技師：/);
  assert.match(migration, /member_record\.surname/);
  assert.doesNotMatch(migration, /member_record\.display_name/);
  assert.match(contactApi, /members\(surname,salutation,phone\)/);
  assert.match(contactApi, /source === "member"/);
  assert.match(delivery, /participantsCard/);
  assert.match(delivery, /每位預約明細/);
});
