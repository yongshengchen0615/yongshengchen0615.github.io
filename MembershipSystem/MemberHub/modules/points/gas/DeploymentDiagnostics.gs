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

/** Signed live probe for the Membership access gate. Never sends the raw service secret. */
function probePointsMembershipGate() {
  const properties = PropertiesService.getScriptProperties();
  const endpoint = String(properties.getProperty('MEMBERHUB_ACCESS_GATE_URL') || '').trim();
  const secret = String(properties.getProperty('MEMBERHUB_POINTS_ACCESS_GATE_SECRET') || '').trim();
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(endpoint) || secret.length < 32) {
    return pointsDeploymentProbeResult_('configuration-error');
  }

  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = randomHex_(16);
  const lineUserId = 'memberhub-deployment-probe-points';
  const signature = memberAccessGateSignature_(secret, 'points', timestamp, nonce, lineUserId);
  let response;
  try {
    response = UrlFetchApp.fetch(endpoint, {
      method: 'post',
      payload: {
        action: 'internal.member-access.check',
        serviceId: 'points',
        timestamp: timestamp,
        nonce: nonce,
        signature: signature,
        lineUserId: lineUserId
      },
      followRedirects: true,
      muteHttpExceptions: true
    });
  } catch (_) {
    return pointsDeploymentProbeResult_('unavailable');
  }

  let result = null;
  try { result = JSON.parse(response.getContentText() || '{}'); }
  catch (_) { result = null; }
  if (response.getResponseCode() !== 200 || !result) {
    return pointsDeploymentProbeResult_('invalid-response');
  }
  if (result.ok !== true || !result.data || result.data.allowed !== false ||
      result.data.membershipStatus !== 'unregistered') {
    return pointsDeploymentProbeResult_('rejected');
  }
  const expectedProof = memberAccessGateProbeResponseSignature_(
    secret, 'points', timestamp, nonce, lineUserId, false, 'unregistered'
  );
  if (!deploymentProbeSignatureEquals_(result.data.probeSignature, expectedProof)) {
    return pointsDeploymentProbeResult_('unverified-response');
  }
  return pointsDeploymentProbeResult_('ready');
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

function pointsDeploymentProbeResult_(status) {
  return Object.freeze({
    service: 'points',
    version: POINTS_CARD_SERVICE.version,
    reachable: status === 'ready',
    status: status
  });
}
