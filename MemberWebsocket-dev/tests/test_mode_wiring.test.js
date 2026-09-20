const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('admin exposes only maintenance and device login controls', () => {
  const html = read('admin/index.html');
  const app = read('admin/app.js');
  const testMode = read('admin/test-mode.js');

  assert.match(html, /id="testModeTab"/);
  assert.match(html, /id="testModePanel"/);
  assert.match(html, /id="systemMaintenanceEnabled"/);
  assert.doesNotMatch(html, /id="testModeEnabled"/);
  assert.match(html, /id="testModePcLoginEnabled"/);
  assert.match(html, /id="testModeMobileLoginEnabled"/);
  assert.doesNotMatch(html, /id="testModeAdminLoginEnabled"/);
  assert.doesNotMatch(html, /允許管理員登入用戶端/);
  assert.match(html, /id="systemMaintenanceBadge"/);
  assert.match(html, /id="testModePcLoginBadge"/);
  assert.match(html, /id="testModeMobileLoginBadge"/);
  assert.match(html, /id="testModeMaintenanceMessage"/);
  assert.match(html, /id="testModeAddAccountCount"/);
  assert.match(html, /test-mode\.js\?v=maintenance-device-login-20260920-2/);
  assert.match(html, /test-mode\.css\?v=test-mode-ui-20260920-2/);
  assert.match(app, /switchPanel\('testMode'\)/);
  assert.match(testMode, /admin\.test-mode\.save/);
  assert.match(testMode, /admin\.test-mode\.bootstrap/);
  assert.doesNotMatch(testMode, /allowAdminUserLogin|testModeAdminLogin/);
  assert.match(testMode, /PC 測試登入：可用/);
  assert.match(testMode, /行動裝置測試登入：可用/);
  assert.match(testMode, /allowPcTestLogin/);
  assert.match(testMode, /allowMobileTestLogin/);
  assert.match(testMode, /maintenanceEnabled/);
  assert.doesNotMatch(testMode, /testModeEnabled|settings\.enabled|enabled: els\.testModeEnabled/);
  assert.match(html, /data-test-account-count="5"/);
  assert.match(testMode, /test-account-avatar/);
});

test('all member-facing surfaces load the direct test-account client before app logic', () => {
  for (const entry of [
    'member/index.html',
    'points/index.html',
    'event/index.html',
    'calendar/index.html',
    'booking/index.html',
  ]) {
    const html = read(entry);
    assert.match(html, /test-mode-client\.js\?v=maintenance-device-login-20260920-2/, entry);
    assert.match(html, /test-mode\.css\?v=test-mode-20260920-1/, entry);
  }

  const client = read('test-mode-client.js');
  const core = read('member-system.js');
  assert.match(client, /action: 'test-mode\.accounts'/);
  assert.match(client, /action: 'test-mode\.login'/);
  assert.doesNotMatch(client, /allowAdminUserLogin|ADMIN_REQUIRED/);
  assert.match(client, /if \(!mode\.maintenanceEnabled\)/);
  assert.doesNotMatch(client, /mode\.enabled/);
  assert.match(client, /mode\.allowMobileTestLogin/);
  assert.match(client, /mode\.allowPcTestLogin/);
  assert.match(client, /isMobileDevice\(\)/);
  assert.match(client, /selector\(accounts\)/);
  assert.doesNotMatch(client, /selector\(accounts, mode\.maintenanceMessage\)/);
  assert.match(core, /TestModeClient\.prepare/);
  assert.match(core, /TestModeClient\.payload/);
  assert.match(core, /TestModeClient\.clearSession/);
});

test('direct test login is server-side restricted to active test accounts', () => {
  const api = read('supabase/functions/test-mode-api/index.ts');
  const auth = read('supabase/functions/_shared/test-mode-auth.ts');

  const adminAuthCall = api.indexOf('const identity = await verifyLineIdToken');
  assert.ok(api.indexOf('if (action === "test-mode.accounts")') < adminAuthCall);
  assert.ok(api.indexOf('if (action === "test-mode.login")') < adminAuthCall);
  assert.match(api, /requireTestLoginEnabled\(supabase, request\)/);
  assert.match(api, /deviceClassForRequest\(request\)/);
  assert.match(api, /allow_pc_test_login/);
  assert.match(api, /allow_mobile_test_login/);
  assert.match(api, /maintenance_enabled/);
  assert.match(api, /member\.is_test_account !== true/);
  assert.match(api, /member\.status !== "active"/);
  assert.match(api, /member\.membership_status !== "active"/);
  assert.doesNotMatch(api, /TEST_ADMIN_LOGIN_DISABLED/);
  assert.doesNotMatch(auth, /allow_admin_user_login|admin\.role|admin\.status/);
});

test('test sessions are short-lived, hashed at rest and support direct sessions', () => {
  const api = read('supabase/functions/test-mode-api/index.ts');
  const auth = read('supabase/functions/_shared/test-mode-auth.ts');
  const schema = read('supabase/migrations/20260920054312_test_mode_virtual_accounts.sql');
  const directMigration = read('supabase/migrations/20260920081507_test_mode_direct_login_sessions.sql');
  const deviceMigration = read('supabase/migrations/20260920092340_bind_test_sessions_to_device_class.sql');

  assert.match(api, /const TEST_SESSION_HOURS = 2/);
  assert.match(api, /token_hash: tokenHash/);
  assert.match(api, /sha256Hex\(token\)/);
  assert.doesNotMatch(api, /test_login_sessions"\)\.insert\(\{[^}]*\btoken:/s);
  assert.doesNotMatch(api, /admin_line_user_id: identity\.lineUserId/);
  assert.match(api, /device_class: deviceClass/);

  assert.match(auth, /member\.is_test_account !== true/);
  assert.match(auth, /SYSTEM_MAINTENANCE/);
  assert.match(auth, /maintenance_enabled/);
  assert.match(auth, /allow_pc_test_login/);
  assert.match(auth, /allow_mobile_test_login/);
  assert.match(auth, /device_class/);
  assert.doesNotMatch(auth, /admin_line_user_id|ADMIN_REQUIRED|TEST_ADMIN_DISABLED/);

  assert.match(schema, /is_test_account boolean not null default false/);
  assert.match(schema, /token_hash text not null unique/);
  assert.match(schema, /revoke all on table public\.test_login_sessions from public, anon, authenticated/);
  assert.match(schema, /grant select, insert, update, delete on table public\.test_login_sessions to service_role/);
  assert.match(directMigration, /alter column admin_line_user_id drop not null/);
  assert.match(deviceMigration, /add column if not exists device_class text/);
  assert.match(deviceMigration, /device_class in \('pc', 'mobile'\)/);
});

test('test members stay out of formal member lists and KPI counts', () => {
  const coreApi = read('supabase/functions/api/index.ts');
  assert.match(coreApi, /from\("members"\)\.select\("\*",\{ count:"exact" \}\)\.eq\("is_test_account",false\)/);
  assert.match(coreApi, /from\("members"\)\.select\("\*",\{ count:"exact",head:true \}\)\.eq\("is_test_account",false\)/);
});

test('booking API uses the shared direct test-session verifier', () => {
  const bookingApi = read('supabase/functions/booking-api/index.ts');
  const auth = read('supabase/functions/_shared/test-mode-auth.ts');
  assert.match(bookingApi, /resolveTestSession/);
  assert.match(bookingApi, /testSessionToken/);
  assert.doesNotMatch(auth, /TEST_ADMIN_DISABLED|admin_line_user_id|allow_admin_user_login/);
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

test('test account creation remains admin-only and transactional', () => {
  const rpc = read('supabase/migrations/20260920054446_test_mode_admin_save_rpc.sql');
  const api = read('supabase/functions/test-mode-api/index.ts');
  const auth = read('supabase/functions/_shared/test-mode-auth.ts');
  assert.match(rpc, /create or replace function public\.admin_save_test_mode/);
  assert.match(rpc, /v_existing \+ v_count > 200/);
  assert.match(rpc, /is_test_account,/);
  assert.match(rpc, /revoke all on function public\.admin_save_test_mode/);
  assert.match(rpc, /from public, anon, authenticated/);
  assert.match(rpc, /grant execute on function public\.admin_save_test_mode/);
  assert.match(rpc, /to service_role/);
  assert.match(api, /admin_save_maintenance_test_access/);
  assert.doesNotMatch(api, /p_test_mode_enabled|body\.enabled|row\.enabled/);
  assert.match(api, /p_maintenance_enabled: asBoolean\(body\.maintenanceEnabled\)/);
  assert.match(api, /p_allow_pc_test_login: asBoolean\(body\.allowPcTestLogin\)/);
  assert.match(api, /p_allow_mobile_test_login: asBoolean\(body\.allowMobileTestLogin\)/);
  assert.doesNotMatch(auth, /settingsResult\.data\?\.enabled/);
  assert.match(api, /authorizeAdmin\(supabase, identity\)/);
});
