'use strict';

/** Read-only Apps Script editor diagnostic. Never returns property values. */
function inspectPointsDeployment() {
  const properties = PropertiesService.getScriptProperties();
  const value = function (name) { return String(properties.getProperty(name) || '').trim(); };
  const checks = {
    spreadsheetConfigured: Boolean(value('POINTS_CARD_SPREADSHEET_ID')),
    lineChannelConfigured: /^\d{6,20}$/.test(value('LINE_LOGIN_CHANNEL_ID')),
    membershipGateUrlConfigured: /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(
      value('MEMBERHUB_ACCESS_GATE_URL')
    ),
    serviceSecretConfigured: value('MEMBERHUB_POINTS_ACCESS_GATE_SECRET').length >= 32,
    crossServiceSecretAbsent: !value('MEMBERHUB_CALENDAR_ACCESS_GATE_SECRET'),
    legacySharedSecretAbsent: !value('MEMBERHUB_ACCESS_GATE_SECRET'),
    lineMessagingConfigured: Boolean(value('LINE_MESSAGING_CHANNEL_ACCESS_TOKEN'))
  };
  const missing = Object.keys(checks).filter(function (name) { return !checks[name]; });
  return Object.freeze({
    service: 'points',
    version: POINTS_CARD_SERVICE.version,
    ready: missing.length === 0,
    checks: Object.freeze(checks),
    missing: Object.freeze(missing)
  });
}
