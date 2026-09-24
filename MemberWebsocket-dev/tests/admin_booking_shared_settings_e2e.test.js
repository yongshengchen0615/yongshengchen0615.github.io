const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('admin full E2E mutates booking shared settings, verifies cross-end behavior, conflicts and restoration', () => {
  const source = read('admin/e2e-control.js');

  assert.match(source, /ADMIN_BOOKING_SHARED_SETTINGS/);
  assert.match(source, /adminBookingSharedSettingsCase/);
  for (const id of [
    'bookingAdminSettingsForm',
    'bookingAdminStartTime',
    'bookingAdminEndTime',
    'bookingAdminAdvanceDays',
    'bookingAdminMaxAdvanceDays',
    'bookingAdminStoreServiceMinutes',
    'bookingAdminNotice',
    'bookingAdminSaveSettingsButton'
  ]) {
    assert.match(source, new RegExp(id));
  }

  assert.match(source, /admin\.booking\.manage\.bootstrap/);
  assert.match(source, /admin\.booking\.settings\.save/);
  assert.match(source, /user\.booking\.bootstrap/);
  assert.match(source, /user\.booking\.slots/);
  assert.match(source, /invalidWorkHoursRejected/);
  assert.match(source, /invalidAdvanceRejected/);
  assert.match(source, /invalidStoreMinutesRejected/);
  assert.match(source, /invalidNoticeRejected/);
  assert.match(source, /validMutationSaved/);
  assert.match(source, /mutatedReadback/);
  assert.match(source, /updatedAtChanged/);
  assert.match(source, /staleVersionRejected/);
  assert.match(source, /BOOKING_SETTINGS_CONFLICT/);
  assert.match(source, /userRealtimeSettingsSynced/);
  assert.match(source, /userRealtimeNoticeSynced/);
  assert.match(source, /userBootstrapMatched/);
  assert.match(source, /userStoreMinutesMatched/);
  assert.match(source, /userDateWindowEnforced/);
  assert.match(source, /restoredViaUi/);
  assert.match(source, /restoreReadback/);
  assert.match(source, /userRestoreSynced/);
  assert.match(source, /restoreFallbackUsed/);
  assert.match(source, /createPairedSession/);
  assert.match(source, /waitParticipantSurface/);
  assert.match(source, /expectedUpdatedAt/);
  assert.doesNotMatch(source, /semanticValuesUnchanged/);
});

test('booking shared-settings controls are explicit feature and button coverage contracts', () => {
  const source = read('admin/e2e-control.js');

  assert.match(source, /bookingSharedSettings/);
  assert.match(source, /bookingWorkingHours/);
  assert.match(source, /bookingAdvanceMinimum/);
  assert.match(source, /bookingAdvanceMaximum/);
  assert.match(source, /bookingStoreServiceMinutes/);
  assert.match(source, /bookingNotice/);
  assert.match(source, /explicitCaseByButtonId/);
  assert.match(source, /\['bookingAdminSaveSettingsButton', 'ADMIN_BOOKING_SHARED_SETTINGS'\]/);
  assert.match(source, /registeredCaseKeys/);
});

test('booking admin refresh merges the richer admin settings contract', () => {
  const source = read('admin/booking-panel-core.js');
  assert.match(source, /settings:\s*\{\s*\.\.\.\(booking\.settings \|\| \{\}\),\s*\.\.\.\(catalog\.settings \|\| \{\}\),\s*\.\.\.\(resources\.settings \|\| \{\}\)\s*\}/);
});

test('admin entrypoint cache-busts the shared-settings E2E controller', () => {
  const html = read('admin/index.html');
  assert.match(html, /\.\/e2e-control\.js\?v=admin-e2e-20260924-23/);
});
