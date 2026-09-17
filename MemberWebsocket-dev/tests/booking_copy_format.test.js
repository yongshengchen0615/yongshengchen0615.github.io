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
