'use strict';

const MEMBERSHIP_LINE_VERIFY_URL_ = 'https://api.line.me/oauth2/v2.1/verify';
const MEMBERSHIP_LINE_ISSUER_ = 'https://access.line.me';
const MEMBERSHIP_USER_CHANNEL_PROPERTY_ = 'MEMBERSHIP_USER_LINE_CHANNEL_ID';
const MEMBERSHIP_ADMIN_CHANNEL_PROPERTY_ = 'MEMBERSHIP_ADMIN_LINE_CHANNEL_ID';
const MEMBERSHIP_VERIFY_CACHE_SECONDS_ = 300;
const MEMBERSHIP_VERIFY_RETRY_DELAY_MS_ = 180;

function authenticateLine_(idToken, clientType) {
  if (typeof idToken !== 'string' || idToken.length < 20 || idToken.length > 8192) throw new ApiError(401, 'AUTH_INVALID', 'LINE ID token 不合法。');
  const property = clientType === 'admin' ? MEMBERSHIP_ADMIN_CHANNEL_PROPERTY_ : MEMBERSHIP_USER_CHANNEL_PROPERTY_;
  const expectedChannelId = String(PropertiesService.getScriptProperties().getProperty(property) || '').trim();
  if (!expectedChannelId) throw new ApiError(503, 'CONFIG_MISSING', 'GAS 尚未設定對應的 LINE Channel ID。');

  const cacheKey = 'membership:line:' + digest_(idToken + ':' + expectedChannelId).substring(0, 48);
  const cached = readIdentityCache_(cacheKey, clientType);
  if (cached) return cached;

  const response = fetchLineVerification_(idToken, expectedChannelId);

  let verifyData;
  try { verifyData = JSON.parse(response.getContentText() || '{}'); } catch (_) { verifyData = null; }
  if (response.getResponseCode() !== 200 || !verifyData) throw new ApiError(401, 'AUTH_INVALID', 'LINE ID token 驗證失敗。');
  if (String(verifyData.aud || '') !== expectedChannelId) throw new ApiError(401, 'AUTH_CHANNEL_MISMATCH', 'LINE token 的 Channel ID 與 GAS 設定不一致。');
  if (String(verifyData.iss || '') !== MEMBERSHIP_LINE_ISSUER_) throw new ApiError(401, 'AUTH_INVALID', 'LINE ID token issuer 不合法。');
  if (!Number(verifyData.exp) || Number(verifyData.exp) * 1000 <= Date.now()) throw new ApiError(401, 'AUTH_EXPIRED', 'LINE ID token 已過期。');

  const lineUserId = String(verifyData.sub || '').trim();
  if (!lineUserId || lineUserId.length > 80) throw new ApiError(401, 'AUTH_INVALID', 'LINE 使用者識別碼不合法。');
  const identity = Object.freeze({ lineUserId, displayName: String(verifyData.name || 'LINE 使用者').trim().substring(0, 100) || 'LINE 使用者', clientType });
  const ttl = Math.min(MEMBERSHIP_VERIFY_CACHE_SECONDS_, Math.floor((Number(verifyData.exp) * 1000 - Date.now()) / 1000) - 15);
  if (ttl > 0) {
    try { CacheService.getScriptCache().put(cacheKey, JSON.stringify(Object.assign({}, identity, { expiresAt: Number(verifyData.exp) * 1000 })), ttl); } catch (_) {}
  }
  return identity;
}

function fetchLineVerification_(idToken, expectedChannelId) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let response;
    try {
      response = UrlFetchApp.fetch(MEMBERSHIP_LINE_VERIFY_URL_, {
        method: 'post',
        contentType: 'application/x-www-form-urlencoded',
        payload: { id_token: idToken, client_id: expectedChannelId },
        muteHttpExceptions: true,
        followRedirects: true
      });
    } catch (_) {
      if (attempt === 0) { Utilities.sleep(MEMBERSHIP_VERIFY_RETRY_DELAY_MS_); continue; }
      throw new ApiError(503, 'LINE_UNAVAILABLE', 'LINE 身分驗證服務暫時無法使用。');
    }
    const code = response.getResponseCode();
    if ((code === 429 || code >= 500) && attempt === 0) { Utilities.sleep(MEMBERSHIP_VERIFY_RETRY_DELAY_MS_); continue; }
    if (code === 429 || code >= 500) throw new ApiError(503, 'LINE_UNAVAILABLE', 'LINE 身分驗證服務暫時無法使用。');
    return response;
  }
  throw new ApiError(503, 'LINE_UNAVAILABLE', 'LINE 身分驗證服務暫時無法使用。');
}

function readIdentityCache_(cacheKey, clientType) {
  try {
    const cached = JSON.parse(CacheService.getScriptCache().get(cacheKey) || 'null');
    if (!cached || cached.clientType !== clientType || Number(cached.expiresAt || 0) <= Date.now()) return null;
    if (!cached.lineUserId || String(cached.lineUserId).length > 80) return null;
    return Object.freeze({ lineUserId: String(cached.lineUserId), displayName: String(cached.displayName || 'LINE 使用者').substring(0, 100), clientType });
  } catch (_) { return null; }
}

function authorizeAdmin_(identity) {
  return withDataLock_(function() {
    const now = nowIso_();
    const match = findRecordWithRow_('Admins', 'line_user_id', identity.lineUserId);
    if (!match) {
      appendRecord_('Admins', { line_user_id: identity.lineUserId, display_name: identity.displayName, role: 'none', status: 'pending', first_seen_at: now, updated_at: now });
      appendAuditRecord_({ audit_id: Utilities.getUuid(), actor_line_user_id: identity.lineUserId, actor_role: 'none', action: 'ADMIN_ACCESS_PENDING', target_type: 'admin_access', target_id: identity.lineUserId, result: 'denied', detail: 'First admin login recorded as pending', created_at: now });
      throw new ApiError(403, 'ADMIN_PENDING', '此 LINE 帳號尚未完成管理權限授權。', { lineUserId: identity.lineUserId });
    }
    const admin = match.record;
    const role = String(admin.role || '').trim().toLowerCase();
    const status = String(admin.status || '').trim().toLowerCase();
    if (status === 'pending') throw new ApiError(403, 'ADMIN_PENDING', '此 LINE 帳號尚未完成管理權限授權。', { lineUserId: identity.lineUserId });
    if (status !== 'active' || role !== 'admin') throw new ApiError(403, 'ADMIN_FORBIDDEN', '此 LINE 帳號沒有管理端權限。');
    if (String(admin.display_name || '') !== identity.displayName) { admin.display_name = identity.displayName; admin.updated_at = now; updateRecordAtRow_('Admins', match.rowNumber, admin); }
    return Object.freeze({ role: 'admin', status: 'active' });
  });
}
