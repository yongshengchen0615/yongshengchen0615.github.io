'use strict';

const LINE_VERIFY_URL_ = 'https://api.line.me/oauth2/v2.1/verify';
const LINE_PROFILE_URL_ = 'https://api.line.me/v2/profile';
const USER_CHANNEL_PROPERTY_ = 'CALENDAR_USER_LINE_CHANNEL_ID';
const ADMIN_CHANNEL_PROPERTY_ = 'CALENDAR_ADMIN_LINE_CHANNEL_ID';

function authenticateLine_(accessToken, clientType) {
  if (typeof accessToken !== 'string' || accessToken.length < 20 || accessToken.length > 4096) {
    throw new ApiError(401, 'AUTH_INVALID', 'LINE access token 不合法。');
  }

  const propertyName = clientType === 'admin' ? ADMIN_CHANNEL_PROPERTY_ : USER_CHANNEL_PROPERTY_;
  const expectedChannelId = String(PropertiesService.getScriptProperties().getProperty(propertyName) || '').trim();
  if (!expectedChannelId) {
    throw new ApiError(503, 'CONFIG_MISSING', 'GAS 尚未設定對應的 LINE Channel ID。');
  }

  let verifyResponse;
  try {
    verifyResponse = UrlFetchApp.fetch(
      LINE_VERIFY_URL_ + '?access_token=' + encodeURIComponent(accessToken),
      {
        method: 'get',
        muteHttpExceptions: true,
        followRedirects: true
      }
    );
  } catch (error) {
    throw new ApiError(503, 'LINE_UNAVAILABLE', 'LINE 身分驗證服務暫時無法使用。');
  }

  const verifyCode = verifyResponse.getResponseCode();
  const verifyData = parseLineJson_(verifyResponse);
  if (verifyCode !== 200 || !verifyData) {
    throw new ApiError(401, 'AUTH_INVALID', 'LINE access token 驗證失敗。');
  }
  if (Number(verifyData.expires_in || 0) <= 0) {
    throw new ApiError(401, 'AUTH_EXPIRED', 'LINE access token 已過期。');
  }
  if (String(verifyData.client_id || '') !== expectedChannelId) {
    throw new ApiError(401, 'AUTH_CHANNEL_MISMATCH', 'LINE token 不屬於此 LIFF Channel。');
  }

  let profileResponse;
  try {
    profileResponse = UrlFetchApp.fetch(LINE_PROFILE_URL_, {
      method: 'get',
      headers: { Authorization: 'Bearer ' + accessToken },
      muteHttpExceptions: true,
      followRedirects: true
    });
  } catch (error) {
    throw new ApiError(503, 'LINE_UNAVAILABLE', 'LINE Profile 服務暫時無法使用。');
  }

  const profileCode = profileResponse.getResponseCode();
  const profileData = parseLineJson_(profileResponse);
  if (profileCode !== 200 || !profileData || !profileData.userId) {
    throw new ApiError(401, 'AUTH_INVALID', '無法取得可信任的 LINE 身分。');
  }

  const lineUserId = String(profileData.userId || '').trim();
  const displayName = String(profileData.displayName || '').trim().substring(0, 100);
  if (!lineUserId || lineUserId.length > 80) {
    throw new ApiError(401, 'AUTH_INVALID', 'LINE 使用者識別碼不合法。');
  }

  return Object.freeze({
    lineUserId: lineUserId,
    displayName: displayName || 'LINE 使用者',
    clientType: clientType
  });
}

function authorizeAdmin_(identity) {
  return withDataLock_(function() {
    ensureCalendarStorage_();
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
