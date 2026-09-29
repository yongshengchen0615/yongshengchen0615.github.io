const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migration = fs.readFileSync(
  path.join(__dirname, '../supabase/migrations/20260929103000_preserve_membership_legal_records_on_one_click_clear.sql'),
  'utf8'
);

test('one-click clear preserves real membership identity and legal consent records', () => {
  assert.match(migration, /create or replace function maintenance\.clear_non_admin_data/i);
  assert.match(migration, /public\.admin_delete_test_accounts\(v_test_member_ids\)/i);
  assert.match(
    migration,
    /tablename in \('admins', 'members', 'membership_terms', 'membership_consents'\)/i
  );
  assert.match(migration, /maintenance\.ensure_required_system_baseline\(\)/i);
  assert.match(migration, /PRESERVED_MEMBERSHIP_CONSENT_INTEGRITY_FAILED/);
  assert.doesNotMatch(migration, /truncate[^;]*cascade/i);
});

test('postgres-only full reset remains a separate explicit maintenance path', () => {
  assert.doesNotMatch(
    migration,
    /create or replace function maintenance\.clear_public_data/i
  );
});
