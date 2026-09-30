const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const migration = read('supabase/migrations/20260930120500_member_session_access_control.sql');
const authContract = read('supabase/functions/_shared/auth-contract.ts');

test('session revocation schema and RPC are server-side and service-role only', () => {
  assert.match(migration, /add column if not exists session_revoked_before timestamptz/i);
  assert.match(migration, /create or replace function public\.admin_force_logout_member/i);
  assert.match(migration, /security definer/i);
  assert.match(migration, /ADMIN_FORCE_LOGOUT_ADMIN_FORBIDDEN/);
  assert.match(migration, /update public\.test_login_sessions[\s\S]*revoked_at/i);
  assert.match(migration, /update public\.member_presence_sessions[\s\S]*offline_reason = 'admin_force_logout'/i);
  assert.match(migration, /'admin\.member\.force_logout'/i);
  assert.match(migration, /revoke all on function public\.admin_force_logout_member\(text, text\) from anon/i);
  assert.match(migration, /grant execute on function public\.admin_force_logout_member\(text, text\) to service_role/i);
});

test('maintenance transition revokes non-admin sessions and never restores revoked credentials', () => {
  assert.match(migration, /create or replace function public\.enforce_maintenance_session_policy/i);
  assert.match(migration, /new\.maintenance_enabled is true[\s\S]*session_revoked_before = v_now/i);
  assert.match(migration, /from public\.admins a[\s\S]*a\.role = 'admin'[\s\S]*a\.status = 'active'/i);
  assert.match(migration, /offline_reason = 'maintenance'/i);
  assert.match(migration, /'admin\.maintenance\.enable'/i);
  assert.match(migration, /'admin\.maintenance\.disable'/i);
  assert.match(migration, /'sessionsRestored', false/i);
  assert.doesNotMatch(migration, /set\s+session_revoked_before\s*=\s*null/i);
});

test('LINE token contract requires issued-at and rejects stale credentials server-side', () => {
  assert.match(authContract, /const iat = Number\(payload\.iat \|\| 0\)/);
  assert.match(authContract, /issuedAt: iat/);
  assert.match(authContract, /requireMemberAccessContract/);
  assert.match(authContract, /maintenance_enabled,maintenance_message/);
  assert.match(authContract, /SYSTEM_MAINTENANCE/);
  assert.match(authContract, /SESSION_REVOKED/);
  assert.match(authContract, /issuedAtMs <= revokedBefore/);
});

test('every member-facing direct Edge Function has the shared access gate', () => {
  const files = [
    'supabase/functions/api/index.ts',
    'supabase/functions/member-profile-api/index.ts',
    'supabase/functions/booking-api/index.ts',
    'supabase/functions/booking-calendar-api/index.ts',
    'supabase/functions/booking-contact-api/index.ts',
    'supabase/functions/booking-group-api/index.ts',
    'supabase/functions/booking-group-slots-api/index.ts',
    'supabase/functions/event-ticket-links/index.ts',
  ];
  for (const file of files) assert.match(read(file), /requireMemberAccessContract/, file);
});

test('admin and clients expose force-logout and terminate revoked local sessions', () => {
  const api = read('supabase/functions/api/index.ts');
  const admin = read('admin/app.js');
  const maintenanceUi = read('admin/test-mode.js');
  const memberSystem = read('member-system.js');
  const booking = read('booking/common.js');

  assert.match(api, /admin\.member\.force-logout/);
  assert.match(api, /admin_force_logout_member/);
  assert.match(admin, /dataset\.action === 'force-logout'/);
  assert.match(admin, /確定強制下線此會員/);
  assert.match(maintenanceUi, /確定開啟系統維護/);
  assert.match(maintenanceUi, /不會自動恢復/);
  for (const source of [memberSystem, booking]) {
    assert.match(source, /SESSION_REVOKED/);
    assert.match(source, /SYSTEM_MAINTENANCE/);
    assert.match(source, /clearSession/);
    assert.match(source, /liff[\s\S]*logout/);
  }
});
