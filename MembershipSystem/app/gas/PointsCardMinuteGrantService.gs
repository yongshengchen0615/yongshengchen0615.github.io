'use strict';

// PointsCard uses a separate GAS deployment and spreadsheet.  The shared LINE
// user ID is therefore the only cross-system member key; this service signs a
// narrowly scoped, idempotent request instead of exposing either deployment's
// credentials to the browser.
const MINUTE_GRANT_POINTS_SYNC = Object.freeze({
  webAppUrlProperty: 'POINTS_CARD_MINUTE_GRANT_WEB_APP_URL',
  integrationSecretProperty: 'POINTS_CARD_MINUTE_GRANT_INTEGRATION_SECRET',
  action: 'integration.minutes.grant-points',
  cardsAction: 'integration.minutes.cards.list',
  requestSource: 'MembershipSystem'
});

function minuteGrantPointRequestId_(grant) {
  return hashUsageCode_('membership-minute-grant-points:' + grant.grantId);
}

function minuteGrantPointReason_(grant) {
  const prefix = '服務分鐘回饋：';
  return prefix + String(grant.reason || '').slice(0, 200 - prefix.length);
}

function hmacSha256Hex_(value, secret) {
  const signature = Utilities.computeHmacSha256Signature(String(value), String(secret));
  return signature.map(function (byte) {
    return ('0' + ((Number(byte) + 256) % 256).toString(16)).slice(-2);
  }).join('');
}

function minuteGrantPointSyncErrorCode_(value, fallback) {
  const code = String(value || '').trim().toUpperCase();
  return /^[A-Z0-9_]{2,80}$/.test(code) ? code : fallback;
}

function minuteGrantPointResponseText_(value, maxLength) {
  const text = String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return text.length <= maxLength ? text : '';
}

function minuteGrantPointsSyncConfig_() {
  const properties = PropertiesService.getScriptProperties();
  const webAppUrl = String(properties.getProperty(MINUTE_GRANT_POINTS_SYNC.webAppUrlProperty) || '').trim();
  const secret = String(properties.getProperty(MINUTE_GRANT_POINTS_SYNC.integrationSecretProperty) || '').trim();
  if (!webAppUrl || secret.length < 32) {
    return { ok: false, status: 'not_configured', errorCode: 'POINTS_CARD_NOT_CONFIGURED' };
  }
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec(?:\?.*)?$/.test(webAppUrl)) {
    return { ok: false, status: 'failed', errorCode: 'POINTS_CARD_URL_INVALID' };
  }
  return { ok: true, webAppUrl: webAppUrl, secret: secret };
}

function postPointsCardMinuteIntegration_(action, payload) {
  const config = minuteGrantPointsSyncConfig_();
  if (!config.ok) return config;
  const payloadText = JSON.stringify(payload);
  let response;
  try {
    response = UrlFetchApp.fetch(config.webAppUrl, {
      method: 'post',
      payload: {
        action: action,
        payload: payloadText,
        integrationSignature: hmacSha256Hex_(payloadText, config.secret)
      },
      muteHttpExceptions: true
    });
  } catch (_) {
    return { ok: false, status: 'failed', errorCode: 'POINTS_CARD_UNAVAILABLE' };
  }

  let body = {};
  try { body = JSON.parse(response.getContentText()); }
  catch (_) { return { ok: false, status: 'failed', errorCode: 'POINTS_CARD_INVALID_RESPONSE' }; }
  if (response.getResponseCode() !== 200 || !body || body.ok !== true || !body.data) {
    return {
      ok: false,
      status: 'failed',
      errorCode: minuteGrantPointSyncErrorCode_(body && body.error && body.error.code, 'POINTS_CARD_REQUEST_FAILED')
    };
  }
  return { ok: true, body: body };
}

function callPointsCardMinuteGrant_(grant) {
  const payload = {
    source: MINUTE_GRANT_POINTS_SYNC.requestSource,
    sourceGrantId: grant.grantId,
    requestId: minuteGrantPointRequestId_(grant),
    memberLineUserId: grant.memberLineUserId,
    memberDisplayName: grant.memberDisplayName,
    grantedByLineUserId: grant.grantedByLineUserId,
    serviceMinutes: grant.minutes,
    pointsPerServiceMinutes: grant.pointsPerServiceMinutes,
    stampCount: grant.pointsGranted,
    cardId: grant.pointsCardId,
    reason: minuteGrantPointReason_(grant),
    issuedAt: new Date().toISOString()
  };
  const response = postPointsCardMinuteIntegration_(MINUTE_GRANT_POINTS_SYNC.action, payload);
  if (!response.ok) return response;
  const body = response.body;
  const grantId = minuteGrantPointResponseText_(body.data.grantId, 40);
  const cardId = minuteGrantPointResponseText_(body.data.cardId, 64);
  if (!grantId || !cardId) {
    return { ok: false, status: 'failed', errorCode: 'POINTS_CARD_INVALID_RESPONSE' };
  }
  return {
    ok: true,
    grantId: grantId,
    cardId: cardId,
    cardName: minuteGrantPointResponseText_(body.data.cardName, 80),
    rewardMessage: minuteGrantPointResponseText_(body.data.rewardMessage, 300)
  };
}

function callPointsCardMinuteGrantCards_() {
  const response = postPointsCardMinuteIntegration_(MINUTE_GRANT_POINTS_SYNC.cardsAction, {
    source: MINUTE_GRANT_POINTS_SYNC.requestSource,
    issuedAt: new Date().toISOString()
  });
  if (!response.ok) return response;
  const cards = Array.isArray(response.body.data.cards) ? response.body.data.cards : [];
  const safeCards = cards.map(function (card) {
    const cardId = minuteGrantPointResponseText_(card && card.cardId, 64).toUpperCase();
    const name = minuteGrantPointResponseText_(card && card.name, 80);
    return /^CARD-[A-Z0-9-]{2,58}$/.test(cardId) && name ? { cardId: cardId, name: name } : null;
  }).filter(Boolean);
  if (safeCards.length !== cards.length || safeCards.length > 100) {
    return { ok: false, status: 'failed', errorCode: 'POINTS_CARD_INVALID_RESPONSE' };
  }
  return { ok: true, cards: safeCards };
}

function adminMinuteGrantPointCardsList_() {
  const result = callPointsCardMinuteGrantCards_();
  if (!result.ok) {
    fail_(result.errorCode || 'POINTS_CARD_REQUEST_FAILED', '目前無法讀取可發放的集點卡，請稍後再試。');
  }
  return { cards: result.cards };
}

function attemptMinuteGrantPointsSync_(grantId) {
  const match = findMinuteGrantByFieldWithRow_('grantId', cleanText_(grantId, 40, true));
  if (!match) fail_('GRANT_NOT_FOUND', '找不到指定分鐘發放紀錄。');
  const grant = match.grant;
  if (grant.status !== 'recorded') fail_('GRANT_NOT_READY', '此筆分鐘尚未完成發放。');
  if (!grant.pointsGranted || !grant.pointsPerServiceMinutes) {
    return { status: 'not_requested', errorCode: '' };
  }
  if (grant.pointGrantStatus === 'recorded') return { status: 'recorded', errorCode: '' };

  const result = callPointsCardMinuteGrant_(grant);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    return { status: grant.pointGrantStatus || 'pending', errorCode: 'BUSY' };
  }
  try {
    const latest = findMinuteGrantByFieldWithRow_('grantId', grant.grantId);
    if (!latest) return { status: 'failed', errorCode: 'GRANT_NOT_FOUND' };
    const updated = latest.grant;
    if (updated.pointGrantStatus === 'recorded') return { status: 'recorded', errorCode: '' };
    const now = new Date().toISOString();
    updated.pointGrantAttemptedAt = now;
    updated.updatedAt = now;
    if (result.ok) {
      updated.pointsCardId = result.cardId;
      updated.pointsCardName = result.cardName;
      updated.pointGrantId = result.grantId;
      updated.pointGrantStatus = 'recorded';
      updated.pointGrantErrorCode = '';
      updated.pointsGrantedAt = now;
      updated.pointRewardMessage = result.rewardMessage;
      audit_(updated.grantedByLineUserId, 'admin', 'MEMBER_MINUTES_POINTS_GRANTED', updated.memberLineUserId, 'success', {
        grantId: updated.grantId,
        pointsGrantId: updated.pointGrantId,
        pointsCardId: updated.pointsCardId,
        pointsGranted: updated.pointsGranted,
        pointsPerServiceMinutes: updated.pointsPerServiceMinutes
      });
    } else {
      updated.pointGrantStatus = result.status || 'failed';
      updated.pointGrantErrorCode = result.errorCode || 'POINTS_CARD_REQUEST_FAILED';
      audit_(updated.grantedByLineUserId, 'admin', 'MEMBER_MINUTES_POINTS_GRANT_FAILED', updated.memberLineUserId, 'failed', {
        grantId: updated.grantId,
        pointsGranted: updated.pointsGranted,
        errorCode: updated.pointGrantErrorCode
      });
    }
    writeMinuteGrantRow_(latest.row, updated);
    return { status: updated.pointGrantStatus, errorCode: updated.pointGrantErrorCode };
  } finally {
    lock.releaseLock();
  }
}
