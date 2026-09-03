'use strict';

const MEMBERSHIP_API_VERSION_ = '1.5.0';
const MEMBERSHIP_WRITE_ACTIONS_ = Object.freeze([
  'user.member.profile.save',
  'admin.member.update',
  'admin.member-tiers.save',
  'admin.pointcards.save',
  'admin.pointcards.archive',
  'admin.pointcards.delete',
  'admin.pointcards.remove',
  'admin.tickets.save',
  'user.pointcard.ticket.redeem',
  'admin.stamps.add',
  'admin.service_minutes.add',
  'admin.member-grants.add'
]);
const MEMBERSHIP_MAX_REQUEST_BYTES_ = 40000;
const MEMBERSHIP_READ_LIMIT_ = 90;
const MEMBERSHIP_WRITE_LIMIT_ = 30;

function doGet() {
  return jsonResponse_({
    ok: true,
    status: 200,
    data: { service: 'MembershipSystem Member', version: MEMBERSHIP_API_VERSION_ }
  });
}

function doPost(e) {
  try {
    const request = parseRequest_(e);
    const clientType = clientTypeForAction_(request.action);
    if (request.clientType && request.clientType !== clientType) {
      throw new ApiError(400, 'CLIENT_TYPE_MISMATCH', 'Client type 與 API action 不一致。');
    }
    const identity = authenticateLine_(request.idToken, clientType);
    enforceRateLimit_(identity.lineUserId, request.action);
    ensureMembershipStorage_();

    let data;
    switch (request.action) {
      case 'user.member.bootstrap':
        data = handleMemberBootstrap_(identity);
        break;
      case 'user.member.profile.save':
        data = handleMemberProfileSave_(identity, request);
        break;
      case 'user.pointcard.bootstrap':
        data = handlePointCardBootstrap_(identity);
        break;
      case 'admin.bootstrap': {
        const admin = authorizeAdmin_(identity);
        data = handleAdminBootstrap_(identity, admin, request);
        break;
      }
      case 'admin.members.list': {
        authorizeAdmin_(identity);
        data = readMembersPage_(request);
        break;
      }
      case 'admin.pointcards.list': {
        authorizeAdmin_(identity);
        data = { cards: readPointCards_(true) };
        break;
      }
      case 'admin.member.update': {
        const admin = authorizeAdmin_(identity);
        data = handleMemberUpdate_(identity, admin, request);
        break;
      }
      case 'admin.member-tiers.save': {
        const admin = authorizeAdmin_(identity);
        data = handleMembershipTierSettingsSave_(identity, admin, request);
        break;
      }
      case 'admin.pointcards.save': {
        const admin = authorizeAdmin_(identity);
        data = handlePointCardSave_(identity, admin, request);
        break;
      }
      case 'admin.pointcards.archive':
      case 'admin.pointcards.remove': {
        const admin = authorizeAdmin_(identity);
        data = handlePointCardArchive_(identity, admin, request);
        break;
      }
      case 'admin.pointcards.delete': {
        const admin = authorizeAdmin_(identity);
        data = handlePointCardDelete_(identity, admin, request);
        break;
      }
      case 'admin.tickets.save': {
        const admin = authorizeAdmin_(identity);
        data = handleTicketTemplateSave_(identity, admin, request);
        break;
      }
      case 'user.pointcard.ticket.redeem':
        data = handleTicketRedeem_(identity, request);
        break;
      case 'admin.stamps.add': {
        const admin = authorizeAdmin_(identity);
        data = handleStampAdd_(identity, admin, request);
        break;
      }
      case 'admin.service_minutes.add': {
        const admin = authorizeAdmin_(identity);
        data = handleServiceMinutesAdd_(identity, admin, request);
        break;
      }
      case 'admin.member-grants.add': {
        const admin = authorizeAdmin_(identity);
        data = handleMemberGrantAdd_(identity, admin, request);
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

function setupMembershipSystem() {
  const spreadsheet = ensureMembershipStorage_();
  return {
    spreadsheetId: spreadsheet.getId(),
    spreadsheetUrl: spreadsheet.getUrl(),
    sheets: Object.keys(MEMBERSHIP_SHEET_SCHEMAS_)
  };
}

function parseRequest_(e) {
  if (!e || !e.postData || typeof e.postData.contents !== 'string') {
    throw new ApiError(400, 'INVALID_REQUEST', '缺少 request body。');
  }
  const raw = e.postData.contents;
  if (!raw || raw.length > MEMBERSHIP_MAX_REQUEST_BYTES_) {
    throw new ApiError(413, 'REQUEST_TOO_LARGE', 'Request body 大小不合法。');
  }

  let request;
  try { request = JSON.parse(raw); } catch (_) { throw new ApiError(400, 'INVALID_JSON', 'Request body 必須是 JSON。'); }
  if (!request || Array.isArray(request) || typeof request !== 'object') {
    throw new ApiError(400, 'INVALID_REQUEST', 'Request body 格式不合法。');
  }
  request.action = String(request.action || '').trim();
  request.clientType = String(request.clientType || '').trim();
  request.idToken = typeof request.idToken === 'string' ? request.idToken.trim() : '';
  if (!request.action || request.action.length > 80) throw new ApiError(400, 'INVALID_ACTION', 'API action 不合法。');
  if (!request.idToken) throw new ApiError(401, 'AUTH_REQUIRED', '需要 LINE 登入。');
  return request;
}

function clientTypeForAction_(action) {
  if (action === 'user.member.bootstrap' || action === 'user.member.profile.save') return 'member';
  if (action === 'user.pointcard.bootstrap' || action.indexOf('user.pointcard.ticket.') === 0) return 'points';
  if (action.indexOf('admin.') === 0) return 'admin';
  throw new ApiError(404, 'ACTION_NOT_FOUND', '不支援的 API action。');
}

function enforceRateLimit_(principal, action) {
  if (!principal) return;
  const digest = digest_(principal);
  const bucket = Math.floor(Date.now() / 60000);
  const isWrite = MEMBERSHIP_WRITE_ACTIONS_.indexOf(action) !== -1;
  const limit = isWrite ? MEMBERSHIP_WRITE_LIMIT_ : MEMBERSHIP_READ_LIMIT_;
  const key = 'membership:rl:' + digest.substring(0, 32) + ':' + bucket + ':' + (isWrite ? 'w' : 'r');
  const lock = LockService.getScriptLock();
  try { lock.waitLock(1000); } catch (_) { throw new ApiError(429, 'RATE_LIMIT_BUSY', '請求過於密集，請稍後再試。'); }
  try {
    const current = Number(CacheService.getScriptCache().get(key) || '0');
    if (current + 1 > limit) throw new ApiError(429, 'RATE_LIMITED', '請求過於密集，請稍後再試。');
    CacheService.getScriptCache().put(key, String(current + 1), 120);
  } finally { lock.releaseLock(); }
}

function digest_(value) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8).map(function(byte) {
    const normalized = byte < 0 ? byte + 256 : byte;
    return ('0' + normalized.toString(16)).slice(-2);
  }).join('');
}

function jsonResponse_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}

function errorResponse_(error) {
  const apiError = error instanceof ApiError ? error : new ApiError(500, 'INTERNAL_ERROR', '系統暫時無法完成請求。');
  return jsonResponse_({ ok: false, status: apiError.status, error: { code: apiError.code, message: apiError.message, details: apiError.details || null } });
}

class ApiError extends Error {
  constructor(status, code, message, details) { super(message); this.name = 'ApiError'; this.status = status; this.code = code; this.details = details || null; }
}
