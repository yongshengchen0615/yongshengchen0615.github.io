const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migration = fs.readFileSync(
  path.join(__dirname, '../supabase/migrations/20260929111500_restore_one_click_clear_scope.sql'),
  'utf8'
);

test('one-click clear preserves only administrators and rebuilds system defaults', () => {
  assert.match(migration, /create or replace function maintenance\.clear_non_admin_data/i);
  assert.match(migration, /tablename = 'admins'/i);
  assert.match(migration, /maintenance\.ensure_required_system_baseline\(\)/i);
  assert.match(migration, /ADMIN_PRESERVATION_FAILED/);
  assert.doesNotMatch(migration, /membership_terms['")]?\s*,?\s*'membership_consents/i);
  assert.doesNotMatch(migration, /tablename in \([^)]*members/i);
  assert.doesNotMatch(migration, /truncate[^;]*cascade/i);
});

test('one-click clear explicitly covers both public and booking notification data', () => {
  assert.match(migration, /schemaname in \('public', 'booking_notifications'\)/i);
  assert.match(migration, /RESTART IDENTITY/i);
});
