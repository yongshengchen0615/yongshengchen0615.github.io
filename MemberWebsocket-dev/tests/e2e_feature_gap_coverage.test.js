const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('user full E2E covers non-button feature contracts and new experience controls', () => {
  const source = read('user-test-control.js');

  for (const key of [
    'COMMON_THEME_TOGGLE',
    'COMMON_MEMBERSHIP_MILESTONE',
    'COMMON_FEATURE_CONTRACT_COVERAGE',
    'POINTS_HISTORY_DISCLOSURE',
    'EVENT_HISTORY_DISCLOSURE',
    'BOOKING_FLOW_STEPPER'
  ]) {
    assert.match(source, new RegExp(key));
  }

  assert.match(source, /themeToggleCase/);
  assert.match(source, /membershipMilestoneCase/);
  assert.match(source, /featureContractCoverageCase/);
  assert.match(source, /pointsHistoryDisclosureCase/);
  assert.match(source, /eventHistoryDisclosureCase/);
  assert.match(source, /bookingFlowStepperCase/);
  assert.match(source, /todayButton/);
});

test('admin full E2E covers directory, test-account lifecycle, presets, batch calendar and feature contracts', () => {
  const source = read('admin/e2e-control.js');

  for (const key of [
    'ADMIN_THEME_TOGGLE',
    'ADMIN_MEMBER_DIRECTORY_CONTROLS',
    'ADMIN_MESSAGE_PRESET_EDITOR',
    'ADMIN_CALENDAR_BATCH_CONTROLS',
    'ADMIN_TEST_ACCOUNT_LIFECYCLE',
    'ADMIN_BOOKING_SHARED_SETTINGS',
    'ADMIN_FEATURE_CONTRACT_COVERAGE',
    'ADMIN_BUTTON_COVERAGE'
  ]) {
    assert.match(source, new RegExp(key));
  }

  assert.match(source, /systemMaintenanceEnabled/);
  assert.match(source, /testModeSelectAllAccounts/);
  assert.match(source, /deleteSelectedTestAccountsButton/);
  assert.match(source, /data-record-filter/);
  assert.match(source, /admin\.test-mode\.delete-accounts/);
  assert.match(source, /adminBookingSharedSettingsCase/);
  assert.match(source, /bookingAdminSaveSettingsButton/);
  assert.match(source, /bookingAdminStoreServiceMinutes/);
  assert.match(source, /bookingAdminNotice/);
  assert.match(source, /bookingSharedSettings/);
  assert.match(source, /explicitCaseByButtonId/);
  assert.doesNotMatch(source, /waitFor\(async \(\) =>/);
});

test('all member clients and admin load the latest expanded E2E controllers', () => {
  for (const entry of ['member', 'points', 'event', 'calendar', 'booking']) {
    const html = read(entry + '/index.html');
    assert.match(html, /\.\.\/user-test-control\.js\?v=human-e2e-20260924-10/);
  }
  const admin = read('admin/index.html');
  assert.match(admin, /\.\/e2e-control\.js\?v=admin-e2e-20260924-27/);
});
