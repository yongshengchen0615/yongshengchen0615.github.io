'use strict';

const LINE_ID_TOKEN_VERIFY_URL_ = 'https://api.line.me/oauth2/v2.1/verify';
const LINE_ID_TOKEN_ISSUER_ = 'https://access.line.me';
const USER_CHANNEL_PROPERTY_ = 'CALENDAR_USER_LINE_CHANNEL_ID';
const ADMIN_CHANNEL_PROPERTY_ = 'CALENDAR_ADMIN_LINE_CHANNEL_ID';
const LINE_VERIFY_CACHE_MAX_SECONDS_ = 300;
const LINE_VERIFY_EXPIRY_SKEW_SECONDS_ = 15;
const LINE_VERIFY_RETRY_DELAY_MS_ = 180;

function authenticateLine_(idToken, clientType) {
  if (typeof idToken !== 'string' || idToken.length < 20 || idToken.length > 8192) {
    throw new ApiError(401, 'AUTH_INVALID', 'LINE ID token 不合法。');
  }

  const propertyName = clientType === 'admin' ? ADMIN_CHANNEL_PROPERTY_ : USER_CHANNEL_PROPERTY_;
  const expectedChannelId = String(PropertiesService.getScriptProperties().getProperty(propertyName) || '').trim();
  if (!expectedChannelId) {
    throw new ApiError(503, 'CONFIG_MISSING', 'GAS 尚未設定對應的 LINE Channel ID。');
  }

  const cacheKey = lineIdentityCacheKey_(idToken, expectedChannelId);
  const cachedIdentity = readVerifiedLineIdentity_(cacheKey, clientType);
  if (cachedIdentity) return cachedIdentity;

  const verifyResponse = fetchLineVerification_(idToken, expectedChannelId);
  const verifyCode = verifyResponse.getResponseCode();
  const verifyData = parseLineJson_(verifyResponse);
  if (verifyCode !== 200) {
    throwLineVerificationError_(verifyData, expectedChannelId);
  }
  if (!verifyData) {
    throw new ApiError(401, 'AUTH_INVALID', 'LINE ID token 驗證回應格式不合法。');
  }

  const expiresAt = Number(verifyData.exp || 0) * 1000;
  if (!expiresAt || expiresAt <= Date.now()) {
    throw new ApiError(401, 'AUTH_EXPIRED', 'LINE ID token 已過期。');
  }
  if (String(verifyData.aud || '') !== expectedChannelId) {
    throw new ApiError(401, 'AUTH_CHANNEL_MISMATCH', 'LINE token 的 Channel ID 與 GAS 設定不一致。', {
      expectedChannelId: expectedChannelId
    });
  }
  if (String(verifyData.iss || '') !== LINE_ID_TOKEN_ISSUER_) {
    throw new ApiError(401, 'AUTH_INVALID', 'LINE ID token issuer 不合法。');
  }

  const lineUserId = String(verifyData.sub || '').trim();
  const displayName = String(verifyData.name || '').trim().substring(0, 100);
  if (!lineUserId || lineUserId.length > 80) {
    throw new ApiError(401, 'AUTH_INVALID', 'LINE 使用者識別碼不合法。');
  }

  const identity = {
    lineUserId: lineUserId,
    displayName: displayName || 'LINE 使用者',
    clientType: clientType
  };
  cacheVerifiedLineIdentity_(cacheKey, identity, expiresAt);
  return Object.freeze(identity);
}

function throwLineVerificationError_(verifyData, expectedChannelId) {
  const description = String(verifyData && verifyData.error_description || '').trim();

  if (description === 'Invalid IdToken Audience.') {
    throw new ApiError(401, 'AUTH_CHANNEL_MISMATCH', 'LINE token 的 Channel ID 與 GAS 設定不一致。', {
      expectedChannelId: expectedChannelId
    });
  }
  if (description === 'IdToken expired.') {
    throw new ApiError(401, 'AUTH_EXPIRED', 'LINE ID token 已過期。');
  }
  if (description === 'Invalid IdToken Issuer.') {
    throw new ApiError(401, 'AUTH_INVALID', 'LINE ID token issuer 不合法。');
  }

  throw new ApiError(401, 'AUTH_INVALID', 'LINE ID token 驗證失敗。');
}

function fetchLineVerification_(idToken, expectedChannelId) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let response;
    try {
      response = UrlFetchApp.fetch(LINE_ID_TOKEN_VERIFY_URL_, {
        method: 'post',
        contentType: 'application/x-www-form-urlencoded',
        payload: {
          id_token: idToken,
          client_id: expectedChannelId
        },
        muteHttpExceptions: true,
        followRedirects: true
      });
    } catch (error) {
      if (attempt === 0) {
        Utilities.sleep(LINE_VERIFY_RETRY_DELAY_MS_);
        continue;
      }
      throw new ApiError(503, 'LINE_UNAVAILABLE', 'LINE 身分驗證服務暫時無法使用。');
    }

    const code = response.getResponseCode();
    const transient = code === 429 || code >= 500;
    if (transient && attempt === 0) {
      Utilities.sleep(LINE_VERIFY_RETRY_DELAY_MS_);
      continue;
    }
    if (transient) {
      throw new ApiError(503, 'LINE_UNAVAILABLE', 'LINE 身分驗證服務暫時無法使用。');
    }
    return response;
  }

  throw new ApiError(503, 'LINE_UNAVAILABLE', 'LINE 身分驗證服務暫時無法使用。');
}

function lineIdentityCacheKey_(idToken, expectedChannelId) {
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    idToken + ':' + expectedChannelId,
    Utilities.Charset.UTF_8
  ).map(function(byte) {
    const value = byte < 0 ? byte + 256 : byte;
    return ('0' + value.toString(16)).slice(-2);
  }).join('');
  return 'line-id:v1:' + digest.substring(0, 48);
}

function readVerifiedLineIdentity_(cacheKey, clientType) {
  try {
    const raw = CacheService.getScriptCache().get(cacheKey);
    if (!raw) return null;
    const cached = JSON.parse(raw);
    if (!cached || cached.clientType !== clientType || Number(cached.expiresAt || 0) <= Date.now()) {
      return null;
    }
    const lineUserId = String(cached.lineUserId || '').trim();
    const displayName = String(cached.displayName || '').trim().substring(0, 100);
    if (!lineUserId || lineUserId.length > 80) return null;
    return Object.freeze({
      lineUserId: lineUserId,
      displayName: displayName || 'LINE 使用者',
      clientType: clientType
    });
  } catch (error) {
    return null;
  }
}

function cacheVerifiedLineIdentity_(cacheKey, identity, expiresAt) {
  const remainingSeconds = Math.floor((expiresAt - Date.now()) / 1000) - LINE_VERIFY_EXPIRY_SKEW_SECONDS_;
  const ttl = Math.min(LINE_VERIFY_CACHE_MAX_SECONDS_, remainingSeconds);
  if (ttl < 1) return;

  try {
    CacheService.getScriptCache().put(cacheKey, JSON.stringify({
      lineUserId: identity.lineUserId,
      displayName: identity.displayName,
      clientType: identity.clientType,
      expiresAt: expiresAt
    }), ttl);
  } catch (error) {
    // Cache is an optimization only. Authentication still succeeds from the live LINE verification.
  }
}

function authorizeAdmin_(identity) {
  return withDataLock_(function() {
    const now = nowIso_();
    const match = findRecordWithRow_('Admins', 'line_user_id', identity.lineUserId);

    if (!match) {
      appendRecord_('Admins', {
        line_user_id: identity.lineUserId,
        display_name: identity.displayName,
        role: 'none',
        status: 'pending',
        first_seen_at: now,
        updated_at: now
      });
      appendAuditRecord_({
        audit_id: Utilities.getUuid(),
        actor_line_user_id: identity.lineUserId,
        actor_role: 'none',
        action: 'ADMIN_ACCESS_PENDING',
        target_type: 'admin_access',
        target_id: identity.lineUserId,
        result: 'denied',
        detail: 'First admin LIFF login recorded as pending',
        created_at: now
      });
      throw new ApiError(403, 'ADMIN_PENDING', '此 LINE 帳號尚未完成管理權限授權。', {
        lineUserId: identity.lineUserId
      });
    }

    const admin = match.record;
    const role = String(admin.role || '').trim().toLowerCase();
    const status = String(admin.status || '').trim().toLowerCase();

    if (String(admin.display_name || '') !== identity.displayName) {
      admin.display_name = identity.displayName;
      admin.updated_at = now;
      updateRecordAtRow_('Admins', match.rowNumber, admin);
    }

    if (status === 'pending') {
      throw new ApiError(403, 'ADMIN_PENDING', '此 LINE 帳號尚未完成管理權限授權。', {
        lineUserId: identity.lineUserId
      });
    }

    if (status !== 'active' || role !== 'admin') {
      throw new ApiError(403, 'ADMIN_FORBIDDEN', '此 LINE 帳號沒有管理端權限。');
    }

    return Object.freeze({ role: 'admin', status: 'active' });
  });
}

function parseLineJson_(response) {
  try {
    return JSON.parse(response.getContentText() || '{}');
  } catch (error) {
    return null;
  }
}
