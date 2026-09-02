'use strict';

// The MembershipSystem GAS signs minute-grant integration requests with a secret kept
// in both deployments' Script Properties.  This endpoint deliberately runs
// before LIFF token verification because it is server-to-server, not browser
// callable; its HMAC, short timestamp window, and remote idempotency key are
// the authorization and replay boundary.
const POINTS_CARD_MINUTE_GRANT_INTEGRATION = Object.freeze({
  source: 'MembershipSystem',
  maxClockSkewMs: 10 * 60 * 1000,
  maxPointsPerGrant: 100
});

function minuteGrantIntegrationHmacHex_(value, secret) {
  const signature = Utilities.computeHmacSha256Signature(String(value), String(secret));
  return signature.map(function (byte) {
    return ('0' + ((Number(byte) + 256) % 256).toString(16)).slice(-2);
  }).join('');
}

function minuteGrantIntegrationSignatureMatches_(rawPayload, suppliedSignature, secret) {
  const expected = minuteGrantIntegrationHmacHex_(rawPayload, secret);
  const actual = String(suppliedSignature || '').trim().toLowerCase();
  let mismatch = expected.length ^ actual.length;
  const length = Math.max(expected.length, actual.length);
  for (let index = 0; index < length; index += 1) {
    mismatch |= (expected.charCodeAt(index) || 0) ^ (actual.charCodeAt(index) || 0);
  }
  return mismatch === 0;
}

function verifiedMinuteGrantIntegrationPayload_(event) {
  const parameter = event && event.parameter || {};
  const rawPayload = String(parameter.payload || '');
  if (!rawPayload || rawPayload.length > 6000) fail_('INVALID_PAYLOAD', '整合請求內容不正確。');
  const properties = PropertiesService.getScriptProperties();
  const secret = String(properties.getProperty(POINTS_CARD_SERVICE.minuteGrantIntegrationSecretProperty) || '').trim();
  if (secret.length < 32) fail_('CONFIGURATION_ERROR', '分鐘同步集點尚未完成安全設定。');
  if (!minuteGrantIntegrationSignatureMatches_(rawPayload, parameter.integrationSignature, secret)) {
    fail_('FORBIDDEN', '整合請求簽章不正確。');
  }
  const payload = parsePayload_(rawPayload);
  if (cleanText_(payload.source, 40, true) !== POINTS_CARD_MINUTE_GRANT_INTEGRATION.source) {
    fail_('FORBIDDEN', '不允許的整合來源。');
  }
  const issuedAt = new Date(cleanText_(payload.issuedAt, 40, true)).getTime();
  if (!Number.isFinite(issuedAt) || Math.abs(Date.now() - issuedAt) > POINTS_CARD_MINUTE_GRANT_INTEGRATION.maxClockSkewMs) {
    fail_('INTEGRATION_REQUEST_EXPIRED', '整合請求已過期，請重新同步。');
  }
  return payload;
}

function readMinuteGrantIntegrationInput_(payload) {
  const sourceGrantId = cleanText_(payload.sourceGrantId, 40, true);
  if (!/^MG-\d{6}-[A-F0-9]{12}$/.test(sourceGrantId)) {
    fail_('INVALID_INTEGRATION_GRANT', '分鐘發放識別碼格式不正確。');
  }
  const requestId = cleanText_(payload.requestId, 64, true).toLowerCase();
  if (!/^[a-f0-9]{32,64}$/.test(requestId)) {
    fail_('INVALID_REQUEST_ID', '集點請求識別碼格式不正確。');
  }
  const memberLineUserId = cleanText_(payload.memberLineUserId, 80, true);
  const memberDisplayName = cleanText_(payload.memberDisplayName || 'LINE 會員', 80, false) || 'LINE 會員';
  const grantedByLineUserId = cleanText_(payload.grantedByLineUserId, 80, true);
  const serviceMinutes = strictInt_(
    payload.serviceMinutes,
    1,
    60000,
    'INVALID_MINUTES',
    '服務分鐘必須是 1 到 60000 的整數。'
  );
  const pointsPerServiceMinutes = strictInt_(
    payload.pointsPerServiceMinutes,
    1,
    60000,
    'INVALID_POINTS_RATE',
    '每點服務時間必須是 1 到 60000 的整數。'
  );
  const stampCount = strictInt_(
    payload.stampCount,
    1,
    POINTS_CARD_MINUTE_GRANT_INTEGRATION.maxPointsPerGrant,
    'INVALID_STAMP_COUNT',
    '同步集點必須是 1 到 100 的整數。'
  );
  if (Math.floor(serviceMinutes / pointsPerServiceMinutes) !== stampCount) {
    fail_('INVALID_POINTS_RATE', '服務分鐘與同步點數換算不一致。');
  }
  const cardId = validMultiCardId_(payload.cardId, true);
  const reason = cleanText_(payload.reason, 200, true);
  return {
    sourceGrantId: sourceGrantId,
    requestId: requestId,
    memberLineUserId: memberLineUserId,
    memberDisplayName: memberDisplayName,
    grantedByLineUserId: grantedByLineUserId,
    serviceMinutes: serviceMinutes,
    pointsPerServiceMinutes: pointsPerServiceMinutes,
    stampCount: stampCount,
    cardId: cardId,
    reason: reason
  };
}

function ensureMinuteGrantIntegrationMember_(integration, memberSheet) {
  const now = new Date().toISOString();
  const member = {
    lineUserId: integration.targetMemberLineUserId,
    memberNo: nextMemberNo_(memberSheet),
    displayName: cleanText_(integration.memberDisplayName || 'LINE 會員', 80, false) || 'LINE 會員',
    pictureUrl: '',
    membershipStatus: 'active',
    totalStamps: 0,
    redeemedRewards: 0,
    joinedAt: now,
    note: '',
    createdAt: now,
    updatedAt: now,
    canManagePoints: false
  };
  if (!audit_(integration.grantedByLineUserId, 'integration', 'MEMBER_CREATE_REQUESTED', member.lineUserId, 'pending', {
    memberNo: member.memberNo,
    sourceGrantId: integration.sourceGrantId
  })) {
    fail_('AUDIT_UNAVAILABLE', '稽核紀錄暫時無法寫入，集點會員尚未建立。');
  }
  appendObject_(memberSheet, member);
  audit_(integration.grantedByLineUserId, 'integration', 'MEMBER_CREATED', member.lineUserId, 'success', {
    memberNo: member.memberNo,
    sourceGrantId: integration.sourceGrantId
  });
  return normalizeMember_(member);
}

function minuteGrantPointsIntegration_(event) {
  const input = readMinuteGrantIntegrationInput_(verifiedMinuteGrantIntegrationPayload_(event));
  rateLimit_('minute-grant-integration:' + input.sourceGrantId, 12, 60);
  const result = adminPointGrantMultiCard_(
    { identity: { sub: input.grantedByLineUserId }, adminMember: null },
    {
      targetMemberNo: '',
      cardId: input.cardId,
      stampCount: input.stampCount,
      reason: input.reason,
      requestId: input.requestId
    },
    {
      source: 'minute-grant',
      sourceGrantId: input.sourceGrantId,
      targetMemberLineUserId: input.memberLineUserId,
      memberDisplayName: input.memberDisplayName,
      grantedByLineUserId: input.grantedByLineUserId
    }
  );
  return {
    duplicate: Boolean(result.duplicate),
    grantId: result.grantId,
    cardId: result.cardId,
    cardName: result.cardName,
    rewardMessage: result.rewardMessage || ''
  };
}

function minuteGrantCardsListIntegration_(event) {
  verifiedMinuteGrantIntegrationPayload_(event);
  rateLimit_('minute-grant-integration-cards', 30, 60);
  ensureMultiCardStorage_();
  return {
    cards: allMultiCards_().filter(function (card) { return card.available; }).map(function (card) {
      return { cardId: card.cardId, name: card.name };
    })
  };
}
