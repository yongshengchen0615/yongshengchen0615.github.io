const POINT_MEMBERS_SHEET = 'PointMembers';
const POINT_TRANSACTIONS_SHEET = 'PointTransactions';
const POINT_VOUCHERS_SHEET = 'PointVouchers';
const POINT_AUDIT_SHEET = 'PointAudit';

const POINT_MEMBER_HEADERS = [
  'lineUserId', 'pointMemberNo', 'displayName', 'pictureUrl', 'status',
  'pointsBalance', 'lifetimeEarned', 'lifetimeRedeemed', 'canManagePoints',
  'joinedAt', 'createdAt', 'updatedAt'
];
const POINT_TRANSACTION_HEADERS = [
  'transactionId', 'requestId', 'memberLineUserId', 'pointMemberNo', 'type',
  'pointsDelta', 'balanceBefore', 'balanceAfter',
  'lifetimeEarnedBefore', 'lifetimeEarnedAfter',
  'lifetimeRedeemedBefore', 'lifetimeRedeemedAfter',
  'status', 'sourceType', 'sourceId', 'note', 'actorLineUserId',
  'createdAt', 'updatedAt', 'auditRecordedAt'
];
const POINT_VOUCHER_HEADERS = [
  'voucherId', 'requestId', 'codeHash', 'points', 'status', 'expiresAt', 'note',
  'createdByLineUserId', 'createdAt', 'redeemedByLineUserId', 'redeemedAt',
  'cancelledByLineUserId', 'cancelledAt', 'updatedAt'
];
const POINT_AUDIT_HEADERS = [
  'timestamp', 'actorLineUserId', 'actorRole', 'action', 'targetLineUserId', 'result', 'details'
];

const POINT_MEMBER_STATUSES = ['active', 'suspended', 'disabled'];
const POINT_VOUCHER_STATUSES = ['issued', 'redeemed', 'cancelled'];
const MAX_POINT_DELTA = 1000;
const MAX_VOUCHER_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const IDENTITY_CACHE_MAX_SECONDS = 300;
const IDENTITY_EXPIRY_SKEW_SECONDS = 15;

let requestSpreadsheet_ = null;
let requestSheets_ = {};

function doGet() {
  return json_({ ok: true, data: { service: 'MembershipPointCard', version: '1.0.0' } });
}

function doPost(e) {
  resetRequestCaches_();
  try {
    const action = cleanText_(e && e.parameter && e.parameter.action, 60, true);
    const idToken = cleanText_(e && e.parameter && e.parameter.idToken, 4096, true);
    const fingerprint = rateLimitByToken_(idToken);
    const identity = verifyLineIdToken_(idToken, fingerprint);
    const context = { identity: identity, isAdmin: null };
    const payload = parsePayload_(e && e.parameter && e.parameter.payload);

    switch (action) {
      case 'member.me':
        rateLimit_('member-me:' + identity.sub, 30, 60);
        return json_({ ok: true, data: pointMemberMe_(context) });

      case 'points.claim':
        rateLimit_('points-claim:' + identity.sub, 10, 60);
        return json_({ ok: true, data: pointClaim_(context, payload) });

      case 'admin.dashboard':
        requirePointAdmin_(context);
        rateLimit_('admin-dashboard:' + identity.sub, 30, 60);
        return json_({ ok: true, data: pointAdminDashboard_() });

      case 'admin.settings.update':
        requirePointAdmin_(context);
        rateLimit_('admin-settings:' + identity.sub, 10, 60);
        return json_({ ok: true, data: pointAdminSettingsUpdate_(context, payload) });

      case 'admin.member.adjust':
        requirePointAdmin_(context);
        rateLimit_('admin-adjust:' + identity.sub, 20, 60);
        return json_({ ok: true, data: pointAdminMemberAdjust_(context, payload) });

      case 'admin.member.status':
        requirePointAdmin_(context);
        rateLimit_('admin-status:' + identity.sub, 20, 60);
        return json_({ ok: true, data: pointAdminMemberStatus_(context, payload) });

      case 'admin.reward.redeem':
        requirePointAdmin_(context);
        rateLimit_('admin-reward:' + identity.sub, 20, 60);
        return json_({ ok: true, data: pointAdminRewardRedeem_(context, payload) });

      case 'admin.voucher.create':
        requirePointAdmin_(context);
        rateLimit_('admin-voucher-create:' + identity.sub, 20, 60);
        return json_({ ok: true, data: pointAdminVoucherCreate_(context, payload) });

      case 'admin.voucher.cancel':
        requirePointAdmin_(context);
        rateLimit_('admin-voucher-cancel:' + identity.sub, 20, 60);
        return json_({ ok: true, data: pointAdminVoucherCancel_(context, payload) });

      default:
        fail_('INVALID_ACTION', '不支援的操作。');
    }
  } catch (error) {
    if (!error || !error.publicCode) {
      console.error('Unhandled point-card API error');
      return json_({ ok: false, error: { code: 'INTERNAL_ERROR', message: '集點卡服務暫時無法處理此要求。' } });
    }
    return json_({ ok: false, error: { code: error.publicCode, message: error.publicMessage } });
  }
}

function verifyLineIdToken_(idToken, tokenFingerprint) {
  const props = PropertiesService.getScriptProperties();
  const clientId = cleanText_(props.getProperty('LINE_LOGIN_CHANNEL_ID'), 64, true);
  const fingerprint = tokenFingerprint || sha256Hex_(idToken);
  const cache = CacheService.getScriptCache();
  const key = 'point-id:v1:' + fingerprint;
  const cached = readCachedIdentity_(cache.get(key), clientId);
  if (cached) return cached;

  const response = UrlFetchApp.fetch('https://api.line.me/oauth2/v2.1/verify', {
    method: 'post',
    contentType: 'application/x-www-form-urlencoded',
    payload: { id_token: idToken, client_id: clientId },
    muteHttpExceptions: true
  });

  let result = {};
  try { result = JSON.parse(response.getContentText() || '{}'); }
  catch (_) { result = {}; }

  if (response.getResponseCode() !== 200 || !result.sub) {
    fail_('UNAUTHENTICATED', 'LINE 登入驗證失敗，請重新開啟頁面登入。');
  }
  if (String(result.aud) !== clientId) {
    fail_('LINE_CHANNEL_MISMATCH', 'LINE Login Channel 設定不一致，請聯絡管理員。');
  }

  const identity = {
    sub: String(result.sub),
    aud: String(result.aud),
    exp: Number(result.exp || 0),
    name: cleanText_(result.name || '', 80, false),
    picture: safeHttpsUrl_(result.picture || '')
  };
  cacheIdentity_(cache, key, identity);
  return identity;
}

function readCachedIdentity_(raw, clientId) {
  if (!raw) return null;
  try {
    const identity = JSON.parse(raw);
    const now = Math.floor(Date.now() / 1000);
    if (!identity || !identity.sub || String(identity.aud) !== clientId) return null;
    if (!Number.isFinite(Number(identity.exp)) || Number(identity.exp) <= now + IDENTITY_EXPIRY_SKEW_SECONDS) return null;
    return identity;
  } catch (_) {
    return null;
  }
}

function cacheIdentity_(cache, key, identity) {
  const now = Math.floor(Date.now() / 1000);
  const ttl = Math.min(IDENTITY_CACHE_MAX_SECONDS, Math.floor(Number(identity.exp) - now - IDENTITY_EXPIRY_SKEW_SECONDS));
  if (ttl < 1) return;
  try { cache.put(key, JSON.stringify(identity), ttl); }
  catch (_) { /* CacheService is only an optimization. */ }
}

function requirePointAdmin_(context) {
  if (context.isAdmin == null) context.isAdmin = isPointAdmin_(context.identity.sub);
  if (!context.isAdmin) fail_('FORBIDDEN', '你沒有集點卡管理權限。');
}

function isPointAdmin_(lineUserId) {
  const sheet = getPointMembersSheet_();
  const row = findExactRow_(sheet, 1, lineUserId);
  if (!row) return false;
  const member = rowToPointMember_(sheet.getRange(row, 1, 1, POINT_MEMBER_HEADERS.length).getValues()[0]);
  return boolValue_(member.canManagePoints);
}

function resetRequestCaches_() {
  requestSpreadsheet_ = null;
  requestSheets_ = {};
}

function getSpreadsheet_() {
  if (requestSpreadsheet_) return requestSpreadsheet_;
  const id = cleanText_(PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID'), 180, true);
  try {
    requestSpreadsheet_ = SpreadsheetApp.openById(id);
    return requestSpreadsheet_;
  } catch (_) {
    fail_('CONFIG_ERROR', '集點卡資料庫尚未正確設定。');
  }
}

function getCachedSheet_(name, headers) {
  if (requestSheets_[name]) return requestSheets_[name];
  const sheet = ensureSheet_(getSpreadsheet_(), name, headers);
  requestSheets_[name] = sheet;
  return sheet;
}

function getPointMembersSheet_() { return getCachedSheet_(POINT_MEMBERS_SHEET, POINT_MEMBER_HEADERS); }
function getPointTransactionsSheet_() { return getCachedSheet_(POINT_TRANSACTIONS_SHEET, POINT_TRANSACTION_HEADERS); }
function getPointVouchersSheet_() { return getCachedSheet_(POINT_VOUCHERS_SHEET, POINT_VOUCHER_HEADERS); }
function getPointAuditSheet_() { return getCachedSheet_(POINT_AUDIT_SHEET, POINT_AUDIT_HEADERS); }

function ensureSheet_(spreadsheet, name, headers) {
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(name);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    return sheet;
  }

  if (sheet.getLastColumn() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    return sheet;
  }

  const width = Math.max(sheet.getLastColumn(), headers.length);
  const current = sheet.getRange(1, 1, 1, width).getValues()[0].map(function (value) {
    return String(value || '').trim();
  });

  for (let i = 0; i < headers.length; i += 1) {
    if (current[i] !== headers[i]) {
      fail_('SCHEMA_ERROR', name + ' 工作表欄位不正確，請確認欄位順序：' + headers[i]);
    }
  }
  return sheet;
}

function findExactRow_(sheet, column, value) {
  if (sheet.getLastRow() <= 1) return 0;
  const found = sheet.getRange(2, column, sheet.getLastRow() - 1, 1)
    .createTextFinder(String(value)).matchEntireCell(true).findNext();
  return found ? found.getRow() : 0;
}

function pointAudit_(actorLineUserId, actorRole, action, targetLineUserId, result, details) {
  try {
    getPointAuditSheet_().appendRow([
      new Date().toISOString(), actorLineUserId, actorRole, action,
      targetLineUserId || '', result, JSON.stringify(details || {})
    ]);
    return true;
  } catch (_) {
    console.error('Point audit write failed for action ' + action);
    return false;
  }
}

function rateLimitByToken_(idToken) {
  if (!idToken) fail_('UNAUTHENTICATED', '請先使用 LINE 登入。');
  const fingerprint = sha256Hex_(idToken);
  rateLimit_('point-request:' + fingerprint.slice(0, 24), 60, 60);
  return fingerprint;
}

function rateLimit_(key, maxRequests, ttlSeconds) {
  const cache = CacheService.getScriptCache();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) fail_('BUSY', '系統忙碌中，請稍後再試。');
  try {
    const count = Number(cache.get(key) || 0) + 1;
    if (count > maxRequests) fail_('RATE_LIMITED', '操作過於頻繁，請稍後再試。');
    cache.put(key, String(count), ttlSeconds);
  } finally {
    lock.releaseLock();
  }
}

function parsePayload_(raw) {
  if (!raw) return {};
  if (String(raw).length > 6000) fail_('PAYLOAD_TOO_LARGE', '要求內容過大。');
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
      fail_('INVALID_PAYLOAD', '要求格式不正確。');
    }
    return parsed;
  } catch (error) {
    if (error && error.publicCode) throw error;
    fail_('INVALID_PAYLOAD', '要求格式不正確。');
  }
}

function cleanText_(value, maxLength, required) {
  const text = value == null ? '' : String(value).replace(/[\u0000-\u001F\u007F]/g, '').trim();
  if (required && !text) fail_('INVALID_INPUT', '缺少必要欄位。');
  if (text.length > maxLength) fail_('INVALID_INPUT', '輸入內容超過允許長度。');
  return text;
}

function safeHttpsUrl_(value) {
  if (!value) return '';
  const text = cleanText_(value, 2048, false);
  return /^https:\/\/[^\s]+$/i.test(text) ? text : '';
}

function sheetSafe_(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = value instanceof Date ? value.toISOString() : String(value == null ? '' : value);
  return /^[=+@-]/.test(text) ? "'" + text : text;
}

function normalizeCell_(value) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  const text = value == null ? '' : String(value);
  return /^'[=+@-]/.test(text) ? text.slice(1) : text;
}

function boolValue_(value) {
  if (value === true) return true;
  return String(value == null ? '' : value).trim().toLowerCase() === 'true';
}

function intInRange_(value, min, max, code, message) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) fail_(code, message);
  return number;
}

function randomCode_() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '').toLowerCase();
}

function sha256Hex_(value) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(value), Utilities.Charset.UTF_8);
  return digest.map(function (byte) {
    return ('0' + ((byte + 256) % 256).toString(16)).slice(-2);
  }).join('');
}

function validCode_(value) {
  const code = cleanText_(value, 80, true).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(code)) fail_('INVALID_POINT_CODE', '集點碼格式不正確。');
  return code;
}

function validRequestId_(value) {
  const requestId = cleanText_(value, 80, true).toLowerCase();
  if (!/^[a-f0-9]{32,64}$/.test(requestId)) fail_('INVALID_REQUEST', '操作識別碼不正確，請重新操作。');
  return requestId;
}

function json_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}

function fail_(code, message) {
  const error = new Error(message);
  error.publicCode = code;
  error.publicMessage = message;
  throw error;
}
