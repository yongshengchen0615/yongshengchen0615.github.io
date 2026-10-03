const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

const app = read('admin/app.js');
const core = read('admin/booking-panel-core.js');
const accessibleAdmin = read('admin/booking-accessible-admin.js');
const migration = read('supabase/migrations/20261003211500_accessible_free_time_and_reward_service_guard.sql');

test('reward-node booking service choices exclude the internal store service', () => {
  assert.match(app, /const STORE_SERVICE_ID = '00000000-0000-4000-8000-000000000010'/);
  assert.match(app, /service\.serviceId !== STORE_SERVICE_ID/);
  assert.match(migration, /bs\.id <> '00000000-0000-4000-8000-000000000010'::uuid/);
});

test('reward-node booking service choices receive live booking catalog updates', () => {
  assert.match(core, /member-admin:booking-services-updated/);
  assert.match(core, /detail: \{ services: nextCatalog\.services \}/);
  assert.match(app, /member-admin:booking-services-updated/);
  assert.match(app, /handleBookingServicesUpdated/);
  assert.match(app, /querySelectorAll\('\[data-reward-required-service-ids\]'\)/);
  assert.match(core, /booking\.db\.booking_services\./);
  assert.match(core, /if \(catalogInvalidation\) refreshAll\(false, false\)/);
  assert.match(core, /else refreshAll\(false, true\)/);
});

test('accessible receipt registration accepts minute-level start times independent of slot interval', () => {
  assert.match(accessibleAdmin, /id="accessibleAdminTime" type="time" step="60"/);
  const start = migration.indexOf('create or replace function public.register_accessible_receipt_request');
  const end = migration.indexOf('create or replace function public.save_point_card_service_items', start);
  const section = migration.slice(start, end);
  assert.match(section, /extract\(second from p_start_time\)<>0/);
  assert.doesNotMatch(section, /extract\(minute from p_start_time\).*%5/);
  assert.doesNotMatch(section, /slot_interval/i);
});
