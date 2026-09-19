const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('normal realtime surfaces do not expose redundant manual refresh controls', () => {
  const bookingHtml = read('booking/index.html');
  const bookingApp = read('booking/app.js');
  const pointsHtml = read('points/index.html');
  const pointsApp = read('points/app.js');
  const bookingAdmin = read('admin/booking-panel-core.js');

  assert.doesNotMatch(bookingHtml, /id="refreshButton"/);
  assert.doesNotMatch(bookingApp, /els\.refreshButton/);
  assert.doesNotMatch(pointsHtml, /id="refreshButton"/);
  assert.doesNotMatch(pointsApp, /els\.refreshButton/);
  assert.doesNotMatch(bookingAdmin, /bookingAdminRefreshButton/);
});

test('admin refresh remains recovery-only for uncertain writes', () => {
  const adminHtml = read('admin/index.html');
  const adminApp = read('admin/app.js');

  assert.match(
    adminHtml,
    /id="refreshButton" class="button button-outline hidden"[^>]*>重新整理確認<\/button>/
  );
  assert.match(adminApp, /els\.refreshButton\.classList\.remove\('hidden'\)/);
  assert.match(adminApp, /state\.writeConfirmationRequired[^\n]*window\.location\.reload/);
});

test('booking realtime no longer drives admin refresh through a button click', () => {
  const common = read('booking/common.js');

  assert.doesNotMatch(common, /refreshAdminFromRealtime/);
  assert.doesNotMatch(common, /waitForAdminRefreshCycle/);
  assert.doesNotMatch(common, /refreshButton\.click\(\)/);
  assert.match(common, /table: 'realtime_events'/);
});

test('booking child tables have statement-level realtime invalidation triggers', () => {
  const migration = read('supabase/migrations/20260919143000_booking_child_realtime_invalidation.sql');
  for (const table of [
    'booking_items',
    'booking_technicians',
    'booking_participants',
    'booking_participant_items',
    'booking_participant_reservations',
  ]) {
    assert.match(migration, new RegExp(`on public\\.${table}\\nfor each statement execute function public\\.notify_booking_realtime_change\\(\\);`));
  }
});
