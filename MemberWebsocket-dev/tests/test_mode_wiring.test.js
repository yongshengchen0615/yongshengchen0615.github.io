const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('admin exposes a dedicated test mode workspace', () => {
  const html = read('admin/index.html');
  const app = read('admin/app.js');
  const testMode = read('admin/test-mode.js');

  assert.match(html, /id="testModeTab"/);
  assert.match(html, /id="testModePanel"/);
  assert.match(html, /id="testModeEnabled"/);
  assert.match(html, /id="testModeAdminLoginEnabled"/);
  assert.match(html, /id="testModeMaintenanceMessage"/);
  assert.match(html, /id="testModeAddAccountCount"/);
  assert.match(html, /test-mode\.js\?v=test-mode-ui-20260920-2/);
  assert.match(html, /test-mode\.css\?v=test-mode-ui-20260920-2/);
  assert.match(app, /switchPanel\('testMode'\)/);
  assert.match(testMode, /admin\.test-mode\.save/);
  assert.match(testMode, /admin\.test-mode\.bootstrap/);
  assert.match(html, /id="testModeStatusBadge"/);
  assert.match(html, /data-test-account-count="5"/);
  assert.match(testMode, /updateStatusBadge/);
  assert.match(testMode, /test-account-avatar/);
});

test('all member-facing surfaces load the shared test-mode client before their app logic', () => {
  for (const entry of [
    'member/index.html',
    'points/index.html',
    'event/index.html',
    'calendar/index.html',
    'booking/index.html',
  ]) {
    const html = read(entry);
    assert.match(html, /test-mode-client\.js\?v=test-mode-20260920-1/, entry);
    assert.match(html, /test-mode\.css\?v=test-mode-20260920-1/, entry);
  }

  const core = read('member-system.js');
  assert.match(core, /TestModeClient\.prepare/);
  assert.match(core, /TestModeClient\.payload/);
  assert.match(core, /TestModeClient\.clearSession/);
});

test('test sessions are short-lived, hashed at rest and restricted to test members', () => {
  const api = read('supabase/functions/test-mode-api/index.ts');
  const auth = read('supabase/functions/_shared/test-mode-auth.ts');
  const schema = read('supabase/migrations/20260920054312_test_mode_virtual_accounts.sql');

  assert.match(api, /const TEST_SESSION_HOURS = 2/);
  assert.match(api, /token_hash: tokenHash/);
  assert.match(api, /sha256Hex\(token\)/);
  assert.doesNotMatch(api, /test_login_sessions"\)\.insert\(\{[^}]*\btoken:/s);

  assert.match(auth, /member\.is_test_account !== true/);
  assert.match(auth, /admin\.role !== "admin"/);
  assert.match(auth, /admin\.status !== "active"/);
  assert.match(auth, /SYSTEM_MAINTENANCE/);

  assert.match(schema, /is_test_account boolean not null default false/);
  assert.match(schema, /test_login_sessions/);
  assert.match(schema, /token_hash text not null unique/);
  assert.match(schema, /revoke all on table public\.test_login_sessions from public, anon, authenticated/);
  assert.match(schema, /grant select, insert, update, delete on table public\.test_login_sessions to service_role/);
});

test('test members stay out of formal member lists and KPI counts', () => {
  const coreApi = read('supabase/functions/api/index.ts');
  assert.match(coreApi, /from\("members"\)\.select\("\*",\{ count:"exact" \}\)\.eq\("is_test_account",false\)/);
  assert.match(coreApi, /from\("members"\)\.select\("\*",\{ count:"exact",head:true \}\)\.eq\("is_test_account",false\)/);
});

test('all user-side direct APIs enforce the same maintenance-aware test identity', () => {
  for (const relative of [
    'supabase/functions/pointcard-extension-api/index.ts',
    'supabase/functions/member-profile-api/index.ts',
    'supabase/functions/booking-contact-api/index.ts',
    'supabase/functions/booking-group-api/index.ts',
    'supabase/functions/booking-group-slots-api/index.ts',
    'supabase/functions/booking-cancellation-api/index.ts',
    'supabase/functions/booking-calendar-api/index.ts',
  ]) {
    assert.match(read(relative), /resolveUserTestIdentity/, relative);
  }
});

test('all browser bypass APIs forward the selected test session', () => {
  for (const relative of [
    'points/pointcard-ticket-overview.js',
    'member/profile-extension.js',
    'member/profile-birthday-edit.js',
    'booking/common.js',
    'booking/group-booking.js',
    'booking/contact-details.js',
    'booking/member-ui.js',
    'booking/calendar-flow.js',
  ]) {
    assert.match(read(relative), /TestModeClient/, relative);
  }
});

test('test account creation is transactional and service-role only', () => {
  const rpc = read('supabase/migrations/20260920054446_test_mode_admin_save_rpc.sql');
  assert.match(rpc, /create or replace function public\.admin_save_test_mode/);
  assert.match(rpc, /v_existing \+ v_count > 200/);
  assert.match(rpc, /is_test_account,/);
  assert.match(rpc, /revoke all on function public\.admin_save_test_mode/);
  assert.match(rpc, /from public, anon, authenticated/);
  assert.match(rpc, /grant execute on function public\.admin_save_test_mode/);
  assert.match(rpc, /to service_role/);
});
