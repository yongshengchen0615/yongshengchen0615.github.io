const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

test('admin loads dedicated browser E2E controls', () => {
  const html = read('admin/index.html');
  const runner = read('admin/e2e-control.js');
  assert.match(html, /e2e-control\.css\?v=admin-e2e-20260923-\d+/);
  assert.match(html, /e2e-control\.js\?v=admin-e2e-20260923-\d+/);
  assert.match(runner, /runAdminQuickE2EButton/);
  assert.match(runner, /runAdminFullE2EButton/);
  assert.match(runner, /runPairedFullE2EButton/);
  assert.match(runner, /stopAdminE2EButton/);
  assert.match(runner, /requestStop/);
  assert.match(runner, /ADMIN_TEST_MEMBER_PROFILE_EDIT/);
  assert.match(runner, /ADMIN_POINT_CARD_CRUD/);
  assert.match(runner, /ADMIN_EVENT_TICKET_CRUD/);
  assert.match(runner, /ADMIN_CALENDAR_CRUD/);
  assert.match(runner, /ADMIN_BOOKING_CRUD/);
  assert.match(runner, /ADMIN_BUTTON_COVERAGE/);
});

test('paired runner covers every member-facing surface and verifies admin record sync', () => {
  const runner = read('admin/e2e-control.js');
  for (const surface of ['member', 'points', 'event', 'calendar', 'booking']) {
    assert.match(runner, new RegExp("\\['" + surface + "',"));
  }
  assert.match(runner, /MemberUserTestControl/);
  assert.match(runner, /runFull\(\)/);
  assert.match(runner, /runParticipantSurfaces/);
  assert.match(runner, /Promise\.all\(\[adminTask, \.\.\.clientTasks\]\)/);
  assert.match(runner, /_ADMIN_RECORD_SYNC/);
  assert.match(runner, /data-record-filter="testAutomation"/);
  assert.match(runner, /member-test-session-v1/);
  assert.match(runner, /MAX_PAIRED_PARTICIPANTS = 10/);
  assert.match(runner, /window\.open\('about:blank'/);
  assert.match(runner, /pairedE2EAccountCount/);
  const e2eCss = read('admin/e2e-control.css');
  assert.match(e2eCss, /\.admin-e2e-paired-config\s*\{[\s\S]*display:\s*grid/);
  assert.match(e2eCss, /grid-template-columns:\s*minmax\(190px, max-content\) minmax\(0, 1fr\)/);
  assert.match(e2eCss, /\.admin-e2e-paired-config small\s*\{[\s\S]*overflow-wrap:\s*anywhere/);
  assert.match(e2eCss, /@media \(max-width: 860px\)[\s\S]*\.admin-e2e-paired-config\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(runner, /admin\.test-mode\.bootstrap/);
  assert.match(runner, /admin\.test-mode\.save/);
  assert.match(runner, /E2E_REAL_MEMBER_BLOCKED/);
  assert.match(runner, /memberIsTestAccount/);
  assert.doesNotMatch(runner, /<iframe|adminBrowserE2EFrame|state\.frame|state\.viewport/);
  assert.doesNotMatch(runner, /service_role|SUPABASE_SERVICE_ROLE_KEY/);
});

test('paired E2E account pool is server-filtered to test users and real-user mutation is blocked', () => {
  const runner = read('admin/e2e-control.js');
  const testModeApi = read('supabase/functions/test-mode-api/index.ts');
  assert.match(testModeApi, /\.eq\("is_test_account", true\)/);
  assert.match(runner, /E2E_TEST_ROSTER_REQUIRED/);
  assert.match(runner, /E2E_REAL_MEMBER_BLOCKED/);
  assert.match(runner, /memberIsTestAccount/);
  assert.match(runner, /prepareTestAccounts\(participantCount\)/);
});

test('user E2E returns structured results to the paired admin runner', () => {
  const runner = read('user-test-control.js');
  assert.match(runner, /const VERSION = '2026-09-23\.\d+'/);
  assert.match(runner, /browserRun: state\.browserRun \|\| null/);
  assert.match(runner, /stop: \(\) => requestStop\(\)/);
  assert.match(runner, /pairedLaneIndex/);
  assert.match(runner, /bookingLaneDayCount/);
  assert.match(runner, /slotLane = Math\.floor\(pairedLaneIndex\(\) \/ dayCount\)/);
  assert.match(runner, /summary: \{/);
  assert.match(runner, /results: state\.results\.map/);
});

test('test control API records browser results only behind admin authorization', () => {
  const api = read('supabase/functions/test-control-api/index.ts');
  const authIndex = api.indexOf('await authorizeAdmin(supabase, identity)');
  const actionIndex = api.indexOf('if (action === "admin.test-control.record-browser-run")', authIndex);
  assert.ok(authIndex >= 0 && actionIndex > authIndex);
  assert.match(api, /\["admin-browser", "paired-browser"\]\.includes\(runnerKind\)/);
  assert.match(api, /const runnerKind = asText\(body\.runnerKind, 40\)/);
  assert.match(api, /is_test_account !== true/);
  assert.match(api, /BROWSER_E2E_FAILED/);
  assert.match(api, /automation_test_runs/);
  assert.match(api, /automation_test_cases/);
  assert.match(api, /automation_test_steps/);
});


test('test data is retained until an admin manually purges it', () => {
  const html = read('admin/index.html');
  const control = read('admin/test-control.js');
  const api = read('supabase/functions/test-control-api/index.ts');
  const userRunner = read('user-test-control.js');
  const adminRunner = read('admin/e2e-control.js');
  const migration = read('supabase/migrations/20260922055500_preserve_test_data_manual_purge.sql');

  assert.match(html, /id="purgeTestDataButton"/);
  assert.match(html, /測試資料會保留/);
  assert.match(control, /admin\.test-control\.purge-test-data/);
  assert.match(control, /測試帳號與測試模式環境設定會保留/);
  assert.match(api, /action === "admin\.test-control\.purge-test-data"/);
  assert.match(api, /await authorizeAdmin\(supabase, identity\)/);
  assert.match(api, /admin_purge_test_data/);

  assert.doesNotMatch(userRunner, /user\.qa\.fixture\.cleanup/);
  assert.doesNotMatch(userRunner, /mutationQaCase\('POINT_TICKET_WRITE'\)/);
  assert.doesNotMatch(userRunner, /mutationQaCase\('EVENT_TICKET_WRITE'\)/);
  assert.doesNotMatch(userRunner, /mutationQaCase\('BOOKING_WRITE'\)/);
  assert.doesNotMatch(userRunner, /mutationQaCase\('BOOKING_GROUP_WRITE'\)/);
  assert.match(adminRunner, /PAIRED_DEEP_RETENTION/);
  assert.match(adminRunner, /postTestAutoCleanupSkipped: true/);

  assert.match(migration, /create or replace function public\.admin_purge_test_data\(\)/);
  assert.match(migration, /where is_test_account = true/);
  assert.match(migration, /delete from public\.automation_test_runs/);
  assert.doesNotMatch(migration, /delete from public\.members/);
  assert.match(migration, /grant execute on function public\.admin_purge_test_data\(\)\s+to service_role/);
});


test('paired E2E creates complex admin fixtures before randomized user clients start', () => {
  const runner = read('admin/e2e-control.js');
  const migration = read('supabase/migrations/20260922063942_enhance_e2e_fixture_and_test_surface_sessions_v2.sql');

  const fixtureCall = runner.indexOf('await prepareComplexE2EFixtures()');
  const accountCall = runner.indexOf('await prepareTestAccounts(participantCount)');
  const clientStart = runner.indexOf('runParticipantSurfaces(participant)');
  assert.ok(fixtureCall >= 0 && accountCall > fixtureCall && clientStart > fixtureCall);

  assert.match(runner, /shuffled\(PAIRED_SURFACES\)/);
  assert.match(runner, /randomInt\(80, 1200\)/);
  assert.match(runner, /createPairedSession\(participant\.account, surface\)/);
  assert.match(runner, /admin\.test-control\.prepare-e2e-fixtures/);

  assert.match(migration, /admin_prepare_complex_e2e_fixtures/);
  assert.match(migration, /birthday_month/);
  assert.match(migration, /yearly/);
  assert.match(migration, /monthly/);
  assert.match(migration, /weekly/);
  assert.match(migration, /month_end/);
  assert.match(migration, /week_end/);
  assert.match(migration, /days_after_issue/);
  assert.match(migration, /fixed_date/);
  assert.match(migration, /array\['general','silver','gold','platinum'\]/);
  assert.match(migration, /jsonb_build_array\(2,3,5,8,13,21\)/);
  assert.match(migration, /requires_companion_service/);
});


test('paired booking E2E requires a configured primary technician before clients start', () => {
  const runner = read('admin/e2e-control.js');
  const migration = read('supabase/migrations/20260922072102_fix_e2e_booking_primary_technician.sql');

  assert.match(runner, /primaryTechnicianId/);
  assert.match(runner, /maxPartySize >= 2/);
  assert.match(runner, /primaryTechnicianConfigured: true/);
  assert.match(runner, /maxPartySizeAtLeast: 2/);
  assert.match(runner, /E2E_SURFACE_TIMEOUT/);
  assert.match(runner, /control\.stop\?\.\(\)/);

  assert.match(migration, /E2E QA 技師甲/);
  assert.match(migration, /primary_technician_id = v_primary_technician_id/);
  assert.match(migration, /max_party_size = greatest\(max_party_size,2\)/);
  assert.match(migration, /'primaryTechnicianId'/);
  assert.match(migration, /'maxPartySize'/);
});

test('browser E2E recording stays bounded as case detail grows', () => {
  const runner = read('admin/e2e-control.js');
  const api = read('supabase/functions/test-control-api/index.ts');
  assert.match(runner, /compactRecordSnapshot/);
  assert.match(runner, /bytes > 320000/);
  assert.match(api, /MAX_REQUEST_BYTES = 384_000/);
  assert.match(api, /STANDARD_REQUEST_BYTES = 20_000/);
  assert.match(api, /action !== "admin\.test-control\.record-browser-run"/);
});
