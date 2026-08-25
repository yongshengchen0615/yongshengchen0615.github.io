'use strict';

/** Read-only Apps Script editor diagnostic. Never returns property values. */
function inspectMembershipDeployment() {
  const properties = PropertiesService.getScriptProperties();
  const pointsSecret = String(properties.getProperty('MEMBERHUB_POINTS_ACCESS_GATE_SECRET') || '').trim();
  const calendarSecret = String(properties.getProperty('MEMBERHUB_CALENDAR_ACCESS_GATE_SECRET') || '').trim();
  const checks = {
    spreadsheetConfigured: Boolean(String(properties.getProperty('SPREADSHEET_ID') || '').trim()),
    pointsSecretConfigured: pointsSecret.length >= 32,
    calendarSecretConfigured: calendarSecret.length >= 32,
    serviceSecretsSeparated: pointsSecret.length >= 32 && calendarSecret.length >= 32 &&
      pointsSecret !== calendarSecret,
    legacySharedSecretAbsent: !String(properties.getProperty('MEMBERHUB_ACCESS_GATE_SECRET') || '').trim()
  };
  return membershipDeploymentResult_(checks);
}

function membershipDeploymentResult_(checks) {
  const missing = Object.keys(checks).filter(function (name) { return !checks[name]; });
  return Object.freeze({
    service: 'membership',
    version: '1.10.4',
    ready: missing.length === 0,
    checks: Object.freeze(checks),
    missing: Object.freeze(missing)
  });
}
