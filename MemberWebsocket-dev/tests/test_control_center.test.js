const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('admin exposes the visible automated test control center', () => {
  const html = read('admin/index.html');
  const client = read('admin/test-control.js');
  const css = read('admin/test-control.css');

  assert.match(html, /test-control\.css\?v=test-control-20260921-1/);
  assert.match(html, /test-control\.js\?v=test-control-20260922-\d+/);
  assert.match(html, /id="automationTestTitle"/);
  assert.match(html, /id="runQuickAutomationTestButton"/);
  assert.match(html, /id="runFullAutomationTestButton"/);
  assert.match(html, /id="automationTestCaseList"/);
  assert.match(html, /id="automationTestHistoryList"/);
  assert.match(html, /Expected/);
  assert.match(html, /Actual/);
  assert.match(css, /\.test-control-data-grid/);

  assert.match(client, /\/functions\/v1\/test-control-api/);
  assert.match(client, /admin\.test-control\.create/);
  assert.match(client, /admin\.test-control\.execute/);
  assert.match(client, /admin\.test-control\.status/);
  assert.match(client, /window\.setInterval\(tick, 900\)/);
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
