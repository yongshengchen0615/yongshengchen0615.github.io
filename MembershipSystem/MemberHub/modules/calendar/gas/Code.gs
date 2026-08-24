'use strict';

const CALENDAR_API_VERSION_ = '2.2.0';
const CALENDAR_BUSINESS_TIME_ZONE_ = 'Asia/Taipei';
const USER_ACCESS_STATUSES_ = Object.freeze(['active', 'disabled']);
const MAX_REQUEST_BYTES_ = 20000;
const RATE_LIMIT_READ_PER_MINUTE_ = 90;
const RATE_LIMIT_WRITE_PER_MINUTE_ = 30;
const WRITE_ACTIONS_ = Object.freeze([
  'admin.calendar.create',
  'admin.calendar.update',
  'admin.calendar.archive',
  'admin.users.updateStatus'
]);

class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details || null;
  }
}

function doGet() {
  return jsonResponse_({
    ok: true,
    status: 200,
    data: {
      service: 'CalendarSystem',
      version: CALENDAR_API_VERSION_
    }
  });
}

function doPost(e) {
  try {
    const request = parseRequest_(e);
    const action = request.action;
    const clientType = clientTypeForAction_(action);

    if (request.clientType && request.clientType !== clientType) {
      throw new ApiError(400, 'CLIENT_TYPE_MISMATCH', 'Client type 與 API action 不一致。');
    }

    enforceRateLimit_(request.idToken, action);
    const identity = authenticateLine_(request.idToken, clientType);

    // Validate/open storage once per API execution. Storage helpers below this boundary
    // use the already validated spreadsheet instead of rechecking every sheet repeatedly.
    ensureCalendarStorage_();

    let data;
    switch (action) {
      case 'user.bootstrap':
        data = handleUserBootstrap_(identity);
        break;
      case 'user.calendar.list':
        data = handleUserCalendarList_(identity);
        break;
      case 'admin.bootstrap': {
        const admin = authorizeAdmin_(identity);
        data = handleAdminBootstrap_(identity, admin);
        break;
      }
      case 'admin.calendar.list': {
        const admin = authorizeAdmin_(identity);
        data = handleAdminCalendarList_(identity, admin);
        break;
      }
      case 'admin.calendar.create': {
        const admin = authorizeAdmin_(identity);
        enforceAdminCalendarNotPast_(request.item);
        data = handleAdminCalendarCreate_(identity, admin, request.item);
        break;
      }
      case 'admin.calendar.update': {
        const admin = authorizeAdmin_(identity);
        enforceAdminCalendarNotPast_(request.item);
        data = handleAdminCalendarUpdate_(identity, admin, request.item, request.expectedUpdatedAt);
        break;
      }
      case 'admin.calendar.archive': {
        const admin = authorizeAdmin_(identity);
        data = handleAdminCalendarArchive_(identity, admin, request.itemId, request.expectedUpdatedAt);
        break;
      }
      case 'admin.users.list': {
        const admin = authorizeAdmin_(identity);
        data = handleAdminUsersList_(identity, admin);
        break;
      }
      case 'admin.users.updateStatus': {
        const admin = authorizeAdmin_(identity);
        data = handleAdminUserStatusUpdate_(
          identity,
          admin,
          request.lineUserId,
          request.status,
          request.expectedUpdatedAt
        );
        break;
      }
      default:
        throw new ApiError(404, 'ACTION_NOT_FOUND', '不支援的 API action。');
    }

    return jsonResponse_({ ok: true, status: 200, data: data || {} });
  } catch (error) {
    return errorResponse_(error);
  }
}

function parseRequest_(e) {
  if (!e || !e.postData || typeof e.postData.contents !== 'string') {
    throw new ApiError(400, 'INVALID_REQUEST', '缺少 request body。');
  }

  const raw = e.postData.contents;
  if (raw.length === 0 || raw.length > MAX_REQUEST_BYTES_) {
    throw new ApiError(413, 'REQUEST_TOO_LARGE', 'Request body 大小不合法。');
  }

  let request;
  try {
    request = JSON.parse(raw);
  } catch (error) {
    throw new ApiError(400, 'INVALID_JSON', 'Request body 必須是 JSON。');
  }

  if (!request || Array.isArray(request) || typeof request !== 'object') {
    throw new ApiError(400, 'INVALID_REQUEST', 'Request body 格式不合法。');
  }

  request.action = String(request.action || '').trim();
  request.idToken = typeof request.idToken === 'string' ? request.idToken.trim() : '';
  request.clientType = typeof request.clientType === 'string' ? request.clientType.trim() : '';

  if (!request.action || request.action.length > 80) {
    throw new ApiError(400, 'INVALID_ACTION', 'API action 不合法。');
  }
  if (!request.idToken) {
    throw new ApiError(401, 'AUTH_REQUIRED', '需要 LINE 登入。');
  }
  return request;
}

function clientTypeForAction_(action) {
  if (action.indexOf('user.') === 0) return 'user';
  if (action.indexOf('admin.') === 0) return 'admin';
  throw new ApiError(404, 'ACTION_NOT_FOUND', '不支援的 API action。');
}

function enforceRateLimit_(credential, action) {
  if (!credential) return;

  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    credential,
    Utilities.Charset.UTF_8
  ).map(function(byte) {
    const value = byte < 0 ? byte + 256 : byte;
    return ('0' + value.toString(16)).slice(-2);
  }).join('');

  const minuteBucket = Math.floor(Date.now() / 60000);
  const isWrite = WRITE_ACTIONS_.indexOf(action) !== -1;
  const limit = isWrite ? RATE_LIMIT_WRITE_PER_MINUTE_ : RATE_LIMIT_READ_PER_MINUTE_;
  const cacheKey = 'rl:' + digest.substring(0, 32) + ':' + minuteBucket + ':' + (isWrite ? 'w' : 'r');
  const cache = CacheService.getScriptCache();
  const lock = LockService.getScriptLock();

  try {
    lock.waitLock(1000);
  } catch (error) {
    throw new ApiError(429, 'RATE_LIMIT_BUSY', '請求過於密集，請稍後再試。');
  }

  try {
    const current = Number(cache.get(cacheKey) || '0');
    if (current >= limit) {
      throw new ApiError(429, 'RATE_LIMITED', '請求過於密集，請稍後再試。');
    }
    cache.put(cacheKey, String(current + 1), 120);
  } finally {
    lock.releaseLock();
  }
}

function enforceAdminCalendarNotPast_(rawItem) {
  if (!rawItem || Array.isArray(rawItem) || typeof rawItem !== 'object') return;

  const startDate = typeof rawItem.startDate === 'string' ? rawItem.startDate.trim() : '';
  const endDate = typeof rawItem.endDate === 'string' ? rawItem.endDate.trim() : '';

  // CalendarService owns general date-format/range validation. This policy only
  // applies after both values are recognizable calendar date keys.
  if (!isValidDateKeyForPolicy_(startDate) || !isValidDateKeyForPolicy_(endDate)) return;

  const today = Utilities.formatDate(new Date(), CALENDAR_BUSINESS_TIME_ZONE_, 'yyyy-MM-dd');
  if (startDate < today || endDate < today) {
    throw new ApiError(
      400,
      'PAST_DATE_NOT_ALLOWED',
      '開始日期與結束日期不得設定為已經過去的日期。',
      { today: today }
    );
  }
}

function isValidDateKeyForPolicy_(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + 'T00:00:00Z');
  return !isNaN(parsed.getTime()) && parsed.toISOString().substring(0, 10) === value;
}

function handleAdminUsersList_() {
  const users = readRecords_('Users')
    .map(publicAdminUserAccess_)
    .sort(function(a, b) {
      return String(b.lastLoginAt || '').localeCompare(String(a.lastLoginAt || '')) ||
        String(a.displayName || '').localeCompare(String(b.displayName || ''), 'zh-Hant');
    });
  return { users: users };
}

function handleAdminUserStatusUpdate_(identity, admin, rawLineUserId, rawStatus, rawExpectedUpdatedAt) {
  const lineUserId = requireAdminUserAccessText_(rawLineUserId, 'lineUserId', 80, true);
  const status = requireAdminUserAccessText_(rawStatus, 'status', 20, true).toLowerCase();
  const expectedUpdatedAt = requireAdminUserAccessText_(rawExpectedUpdatedAt, 'expectedUpdatedAt', 40, true);

  if (USER_ACCESS_STATUSES_.indexOf(status) === -1) {
    throw new ApiError(400, 'INVALID_USER_STATUS', '用戶使用權限狀態不合法。');
  }

  let updatedRecord;
  withDataLock_(function() {
    const match = findRecordWithRow_('Users', 'line_user_id', lineUserId);
    if (!match) throw new ApiError(404, 'USER_NOT_FOUND', '找不到指定用戶。');

    if (String(match.record.updated_at || '') !== expectedUpdatedAt) {
      throw new ApiError(409, 'CONFLICT', '用戶權限已被其他管理員更新。');
    }

    const previousStatus = String(match.record.status || '').trim().toLowerCase();
    if (previousStatus === status) {
      updatedRecord = match.record;
      return;
    }

    const now = nowIso_();
    updatedRecord = Object.assign({}, match.record, {
      status: status,
      updated_at: now
    });
    updateRecordAtRow_('Users', match.rowNumber, updatedRecord);

    appendAuditRecord_({
      audit_id: Utilities.getUuid(),
      actor_line_user_id: identity.lineUserId,
      actor_role: admin.role,
      action: 'USER_ACCOUNT_STATUS_CHANGED',
      target_type: 'user_account',
      target_id: lineUserId,
      result: 'success',
      detail: 'status=' + (previousStatus || 'unknown') + '->' + status,
      created_at: now
    });
  });

  return { user: publicAdminUserAccess_(updatedRecord) };
}

function publicAdminUserAccess_(record) {
  const status = String(record && record.status || '').trim().toLowerCase();
  return {
    lineUserId: String(record && record.line_user_id || ''),
    displayName: String(record && record.display_name || ''),
    status: USER_ACCESS_STATUSES_.indexOf(status) !== -1 ? status : 'disabled',
    lastLoginAt: String(record && record.last_login_at || ''),
    createdAt: String(record && record.created_at || ''),
    updatedAt: String(record && record.updated_at || '')
  };
}

function requireAdminUserAccessText_(value, fieldName, maxLength, required) {
  if (value === null || value === undefined || typeof value !== 'string') {
    if (required) throw new ApiError(400, 'VALIDATION_ERROR', fieldName + ' 為必填字串。');
    return '';
  }
  const text = value.trim();
  if (required && !text) throw new ApiError(400, 'VALIDATION_ERROR', fieldName + ' 為必填。');
  if (text.length > maxLength) throw new ApiError(400, 'VALIDATION_ERROR', fieldName + ' 超過長度限制。');
  return text;
}

function errorResponse_(error) {
  if (error instanceof ApiError) {
    const payload = {
      ok: false,
      status: error.status,
      error: {
        code: error.code,
        message: error.message
      }
    };
    if (error.details) payload.error.details = error.details;
    return jsonResponse_(payload);
  }

  console.error('[CalendarSystem] Unhandled error: ' + String(error && error.name || 'Error'));
  return jsonResponse_({
    ok: false,
    status: 500,
    error: {
      code: 'INTERNAL_ERROR',
      message: '伺服器發生未預期錯誤。'
    }
  });
}

function jsonResponse_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
