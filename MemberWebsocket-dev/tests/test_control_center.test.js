const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('admin test control center is a result surface for the unified full E2E', () => {
  const html = read('admin/index.html');
  const client = read('admin/test-control.js');
  const e2e = read('admin/e2e-control.js');
  const css = read('admin/test-control.css');

  assert.match(html, /test-control\.css\?v=test-control-20260923-4/);
  assert.match(html, /test-control\.js\?v=test-control-20260923-4/);
  assert.match(html, /id="automationTestTitle"/);
  assert.doesNotMatch(html, /id="runQuickAutomationTestButton"/);
  assert.doesNotMatch(html, /id="runFullAutomationTestButton"/);
  assert.match(html, /id="automationTestCaseList"/);
  assert.match(html, /id="automationTestHistoryList"/);
  assert.match(html, /後端完整 QA 已整合/);
  assert.match(html, /Expected/);
  assert.match(html, /Actual/);
  assert.match(css, /\.test-control-data-grid/);
  const workspace = read('admin/test-workspace-tabs.js');
  const workspaceCss = read('admin/test-workspace-tabs.css');
  for (const key of ['environment', 'accounts', 'runner', 'history']) {
    assert.match(workspace, new RegExp("key: '" + key + "'"));
  }
  assert.match(workspace, /環境設定/);
  assert.match(workspace, /測試帳號/);
  assert.match(workspace, /E2E 執行/);
  assert.match(workspace, /測試紀錄/);
  assert.match(workspace, /settingsCard/);
  assert.match(workspace, /accountsCard/);
  assert.match(workspaceCss, /grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(workspaceCss, /test-workspace-panel--accounts/);

  assert.match(client, /\/functions\/v1\/test-control-api/);
  assert.match(client, /admin\.test-control\.create/);
  assert.match(client, /admin\.test-control\.execute/);
  assert.match(client, /admin\.test-control\.status/);
  assert.match(client, /window\.MemberAdminTestControl = Object\.freeze/);
  assert.match(client, /runFull: \(\) => startRun\('full', \{ rethrow: true \}\)/);
  assert.match(client, /window\.setInterval\(tick, 900\)/);
  assert.match(e2e, /runUnifiedServerFullPhase/);
  assert.match(e2e, /window\.MemberAdminTestControl/);
  assert.match(e2e, /await control\.runFull\(\)/);
  assert.doesNotMatch(client, /service[_-]?role/i);
});

test('test control API requires admin identity and records observable cases', () => {
  const api = read('supabase/functions/test-control-api/index.ts');

  assert.match(api, /verifyAdminIdentity/);
  assert.match(api, /authorizeAdmin/);
  assert.match(api, /LINE_ADMIN_CHANNEL_ID/);
  assert.match(api, /automation_test_runs/);
  assert.match(api, /automation_test_cases/);
  assert.match(api, /automation_test_steps/);
  assert.match(api, /ENVIRONMENT_ACCESS/);
  assert.match(api, /TEST_ACCOUNT_INTEGRITY/);
  assert.match(api, /SESSION_SECURITY/);
  assert.match(api, /POINTS_INTEGRITY/);
  assert.match(api, /FIXED_TICKET_INTEGRITY/);
  assert.match(api, /LINE_SUPPRESSION/);
  assert.match(api, /BOOKING_INTEGRITY/);
  assert.match(api, /PRESENCE_INTEGRITY/);
  assert.match(api, /settingsRowPresent/);
  assert.match(api, /settingsFlagsValid/);
  assert.match(api, /activeTestAccountsAtLeast: 1/);
  assert.doesNotMatch(api, /const ok = actual\.maintenanceEnabled && actual\.pcLoginEnabled/);
  assert.match(api, /維護模式與裝置測試登入開關可為關閉/);
  assert.match(api, /automation_test_notification_snapshot/);
  assert.match(api, /derivedBalanceMismatches/);
  assert.match(api, /effectiveActivePresenceSessions/);
  assert.match(api, /staleStorageRows/);
  assert.match(api, /activeThresholdMs = 90 \* 1000/);
  assert.doesNotMatch(api, /STALE_PRESENCE_SESSION/);
  assert.match(api, /overlappingTechnicianReservations/);
  assert.doesNotMatch(api, /actual:\s*\{[^}]*token_hash/s);
});

test('test control persistence is service-role only with RLS enabled', () => {
  const schema = read('supabase/migrations/20260921012651_automation_test_control_center.sql');
  const notification = read('supabase/migrations/20260921012739_automation_test_notification_snapshot.sql');

  for (const table of ['automation_test_runs', 'automation_test_cases', 'automation_test_steps']) {
    assert.match(schema, new RegExp('alter table public\\.' + table + ' enable row level security'));
    assert.match(schema, new RegExp('revoke all on table public\\.' + table + ' from public, anon, authenticated'));
    assert.match(schema, new RegExp('grant select, insert, update, delete on table public\\.' + table + ' to service_role'));
  }

  assert.match(notification, /security invoker/);
  assert.match(notification, /booking_notifications\.outbox/);
  assert.match(notification, /m\.is_test_account = true/);
  assert.match(notification, /revoke all on function public\.automation_test_notification_snapshot\(\)/);
  assert.match(notification, /grant execute on function public\.automation_test_notification_snapshot\(\)[\s\S]*to service_role/);
  assert.doesNotMatch(notification, /security definer/);
});
