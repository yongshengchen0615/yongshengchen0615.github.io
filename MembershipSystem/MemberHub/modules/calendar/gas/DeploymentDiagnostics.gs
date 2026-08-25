'use strict';

/** Read-only Apps Script editor diagnostic. Never returns property values. */
function inspectCalendarDeployment() {
  const properties = PropertiesService.getScriptProperties();
  const value = function (name) { return String(properties.getProperty(name) || '').trim(); };
  const userChannel = value('CALENDAR_USER_LINE_CHANNEL_ID');
  const adminChannel = value('CALENDAR_ADMIN_LINE_CHANNEL_ID');
  const checks = {
    spreadsheetConfigured: Boolean(value('CALENDAR_SYSTEM_V2_SPREADSHEET_ID')),
    userLineChannelConfigured: /^\d{6,20}$/.test(userChannel),
    adminLineChannelConfigured: /^\d{6,20}$/.test(adminChannel),
    lineChannelsSeparated: Boolean(userChannel && adminChannel && userChannel !== adminChannel),
    membershipGateUrlConfigured: /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(
      value('MEMBERHUB_ACCESS_GATE_URL')
    ),
    serviceSecretConfigured: value('MEMBERHUB_CALENDAR_ACCESS_GATE_SECRET').length >= 32,
    crossServiceSecretAbsent: !value('MEMBERHUB_POINTS_ACCESS_GATE_SECRET'),
    legacySharedSecretAbsent: !value('MEMBERHUB_ACCESS_GATE_SECRET')
  };
  const missing = Object.keys(checks).filter(function (name) { return !checks[name]; });
  return Object.freeze({
    service: 'calendar',
    version: CALENDAR_API_VERSION_,
    ready: missing.length === 0,
    checks: Object.freeze(checks),
    missing: Object.freeze(missing)
  });
}
