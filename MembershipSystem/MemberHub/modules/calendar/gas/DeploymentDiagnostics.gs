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

/** Signed live probe for the Membership access gate. Never sends the raw service secret. */
function probeCalendarMembershipGate() {
  const properties = PropertiesService.getScriptProperties();
  const endpoint = String(properties.getProperty('MEMBERHUB_ACCESS_GATE_URL') || '').trim();
  const secret = String(properties.getProperty('MEMBERHUB_CALENDAR_ACCESS_GATE_SECRET') || '').trim();
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(endpoint) || secret.length < 32) {
    return calendarDeploymentProbeResult_('configuration-error');
  }

  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = Utilities.getUuid().replace(/-/g, '').toLowerCase();
  const lineUserId = 'memberhub-deployment-probe-calendar';
  const signature = memberAccessGateSignature_(secret, 'calendar', timestamp, nonce, lineUserId);
  let response;
  try {
    response = UrlFetchApp.fetch(endpoint, {
      method: 'post',
      payload: {
        action: 'internal.member-access.check',
        serviceId: 'calendar',
        timestamp: timestamp,
        nonce: nonce,
        signature: signature,
        lineUserId: lineUserId
      },
      followRedirects: true,
      muteHttpExceptions: true
    });
  } catch (_) {
    return calendarDeploymentProbeResult_('unavailable');
  }

  let result = null;
  try { result = JSON.parse(response.getContentText() || '{}'); }
  catch (_) { result = null; }
  if (response.getResponseCode() !== 200 || !result) {
    return calendarDeploymentProbeResult_('invalid-response');
  }
  if (result.ok !== true || !result.data || result.data.allowed !== false ||
      result.data.membershipStatus !== 'unregistered') {
    return calendarDeploymentProbeResult_('rejected');
  }
  const expectedProof = memberAccessGateProbeResponseSignature_(
    secret, 'calendar', timestamp, nonce, lineUserId, false, 'unregistered'
  );
  if (!deploymentProbeSignatureEquals_(result.data.probeSignature, expectedProof)) {
    return calendarDeploymentProbeResult_('unverified-response');
  }
  return calendarDeploymentProbeResult_('ready');
}

function memberAccessGateProbeResponseSignature_(secret, serviceId, timestamp, nonce, lineUserId, allowed, status) {
  const message = [
    'memberhub-access-gate-probe-response-v1', serviceId, timestamp, nonce,
    lineUserId, String(allowed), status
  ].join('\n');
  const digest = Utilities.computeHmacSha256Signature(message, secret, Utilities.Charset.UTF_8);
  return digest.map(function (byte) {
    return ('0' + ((byte + 256) % 256).toString(16)).slice(-2);
  }).join('');
}

function deploymentProbeSignatureEquals_(left, right) {
  const a = String(left || '');
  const b = String(right || '');
  let mismatch = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    mismatch |= (a.charCodeAt(index % (a.length || 1)) || 0) ^
      (b.charCodeAt(index % (b.length || 1)) || 0);
  }
  return mismatch === 0;
}

function calendarDeploymentProbeResult_(status) {
  return Object.freeze({
    service: 'calendar',
    version: CALENDAR_API_VERSION_,
    reachable: status === 'ready',
    status: status
  });
}
