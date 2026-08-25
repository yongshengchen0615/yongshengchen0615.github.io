'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

function runDiagnostic(relative, functionName, values, globals) {
  const requested = [];
  const context = Object.assign({
    Object, String,
    PropertiesService: { getScriptProperties: () => ({
      getProperty(name) {
        requested.push(name);
        return Object.prototype.hasOwnProperty.call(values, name) ? values[name] : '';
      }
    }) }
  }, globals || {});
  vm.createContext(context);
  vm.runInContext(read(relative) + '\n;globalThis.__inspect = ' + functionName + ';', context);
  return { result: JSON.parse(JSON.stringify(context.__inspect())), requested };
}

test('deployment diagnostics report readiness without returning secret values', () => {
  const pointsSecret = 'p'.repeat(32);
  const calendarSecret = 'c'.repeat(32);
  const membership = runDiagnostic(
    'modules/membership/gas/DeploymentDiagnostics.gs', 'inspectMembershipDeployment',
    {
      SPREADSHEET_ID: 'membership-sheet',
      MEMBERHUB_POINTS_ACCESS_GATE_SECRET: pointsSecret,
      MEMBERHUB_CALENDAR_ACCESS_GATE_SECRET: calendarSecret
    }
  );
  const points = runDiagnostic(
    'modules/points/gas/DeploymentDiagnostics.gs', 'inspectPointsDeployment',
    {
      POINTS_CARD_SPREADSHEET_ID: 'points-sheet',
      LINE_LOGIN_CHANNEL_ID: '2010787602',
      MEMBERHUB_ACCESS_GATE_URL: 'https://script.google.com/macros/s/MEMBERSHIP_DEPLOYMENT/exec',
      MEMBERHUB_POINTS_ACCESS_GATE_SECRET: pointsSecret,
      LINE_MESSAGING_CHANNEL_ACCESS_TOKEN: 'messaging-token'
    },
    { POINTS_CARD_SERVICE: { version: '2.3.7' } }
  );
  const calendar = runDiagnostic(
    'modules/calendar/gas/DeploymentDiagnostics.gs', 'inspectCalendarDeployment',
    {
      CALENDAR_SYSTEM_V2_SPREADSHEET_ID: 'calendar-sheet',
      CALENDAR_USER_LINE_CHANNEL_ID: '2010787603',
      CALENDAR_ADMIN_LINE_CHANNEL_ID: '2010787604',
      MEMBERHUB_ACCESS_GATE_URL: 'https://script.google.com/macros/s/MEMBERSHIP_DEPLOYMENT/exec',
      MEMBERHUB_CALENDAR_ACCESS_GATE_SECRET: calendarSecret
    },
    { CALENDAR_API_VERSION_: '2.3.3' }
  );

  for (const diagnostic of [membership, points, calendar]) {
    assert.equal(diagnostic.result.ready, true);
    assert.deepEqual(diagnostic.result.missing, []);
    const serialized = JSON.stringify(diagnostic.result);
    assert.doesNotMatch(serialized, new RegExp(pointsSecret + '|' + calendarSecret + '|messaging-token'));
  }
});

test('deployment diagnostics fail closed for shared, crossed, or incomplete configuration', () => {
  const sharedSecret = 's'.repeat(32);
  const membership = runDiagnostic(
    'modules/membership/gas/DeploymentDiagnostics.gs', 'inspectMembershipDeployment',
    {
      SPREADSHEET_ID: 'membership-sheet',
      MEMBERHUB_POINTS_ACCESS_GATE_SECRET: sharedSecret,
      MEMBERHUB_CALENDAR_ACCESS_GATE_SECRET: sharedSecret,
      MEMBERHUB_ACCESS_GATE_SECRET: 'legacy'
    }
  ).result;
  assert.equal(membership.ready, false);
  assert.ok(membership.missing.includes('serviceSecretsSeparated'));
  assert.ok(membership.missing.includes('legacySharedSecretAbsent'));

  const points = runDiagnostic(
    'modules/points/gas/DeploymentDiagnostics.gs', 'inspectPointsDeployment',
    { MEMBERHUB_CALENDAR_ACCESS_GATE_SECRET: sharedSecret },
    { POINTS_CARD_SERVICE: { version: '2.3.7' } }
  ).result;
  assert.equal(points.ready, false);
  assert.ok(points.missing.includes('crossServiceSecretAbsent'));
  assert.ok(points.missing.includes('serviceSecretConfigured'));

  const calendar = runDiagnostic(
    'modules/calendar/gas/DeploymentDiagnostics.gs', 'inspectCalendarDeployment',
    {
      CALENDAR_USER_LINE_CHANNEL_ID: '2010787603',
      CALENDAR_ADMIN_LINE_CHANNEL_ID: '2010787603',
      MEMBERHUB_POINTS_ACCESS_GATE_SECRET: sharedSecret
    },
    { CALENDAR_API_VERSION_: '2.3.3' }
  ).result;
  assert.equal(calendar.ready, false);
  assert.ok(calendar.missing.includes('lineChannelsSeparated'));
  assert.ok(calendar.missing.includes('crossServiceSecretAbsent'));
});

test('checked-in frontend configuration keeps user and admin LIFF separated', () => {
  for (const relative of [
    'modules/membership/shared/config.json',
    'modules/points/shared/config.json'
  ]) {
    const config = JSON.parse(read(relative));
    assert.match(config.USER_LIFF_ID, /^\d{6,20}-[A-Za-z0-9]+$/);
    assert.match(config.ADMIN_LIFF_ID, /^\d{6,20}-[A-Za-z0-9]+$/);
    assert.notEqual(config.USER_LIFF_ID, config.ADMIN_LIFF_ID);
    assert.match(config.GAS_WEB_APP_URL, /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/);
  }

  const calendarConfig = JSON.parse(read('modules/calendar/config.json'));
  assert.match(calendarConfig.userLiffId, /^\d{6,20}-[A-Za-z0-9]+$/);
  assert.match(calendarConfig.adminLiffId, /^\d{6,20}-[A-Za-z0-9]+$/);
  assert.notEqual(calendarConfig.userLiffId, calendarConfig.adminLiffId);
  assert.match(calendarConfig.gasWebAppUrl, /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/);

  assert.match(read('modules/calendar/user/app.js'), /clientType:\s*'user'/);
  assert.match(read('modules/calendar/admin/app.js'), /clientType:\s*'admin'/);
});
