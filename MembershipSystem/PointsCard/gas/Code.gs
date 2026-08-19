'use strict';

const POINTS_CARD_SERVICE = Object.freeze({
  name: 'PointsCard',
  version: '1.0.0',
  spreadsheetProperty: 'POINTS_CARD_SPREADSHEET_ID',
  lineChannelProperty: 'LINE_LOGIN_CHANNEL_ID',
  stampsPerRewardProperty: 'POINTS_CARD_STAMPS_PER_REWARD',
  rewardNameProperty: 'POINTS_CARD_REWARD_NAME'
});

const POINTS_CARD_SHEETS = Object.freeze({
  members: 'Members',
  vouchers: 'StampVouchers',
  stampRecords: 'StampRecords',
  rewardRecords: 'RewardRecords',
  audit: 'AuditLogs'
});

const POINTS_CARD_HEADERS = Object.freeze({
  Members: [
    'lineUserId', 'memberNo', 'displayName', 'pictureUrl', 'membershipStatus',
    'totalStamps', 'redeemedRewards', 'joinedAt', 'note', 'createdAt', 'updatedAt',
    'canManagePoints'
  ],
  StampVouchers: [
    'voucherId', 'shareCode', 'stampCount', 'scanMode', 'status', 'expiresAt', 'note',
    'createdByLineUserId', 'createdAt', 'updatedAt', 'cancelledByLineUserId', 'cancelledAt'
  ],
  StampRecords: [
    'recordId', 'requestId', 'voucherId', 'memberLineUserId', 'memberNo', 'stampCount',
    'note', 'status', 'totalBefore', 'totalAfter', 'createdAt', 'updatedAt', 'recordedAt',
    'auditRecordedAt'
  ],
  RewardRecords: [
    'rewardRecordId', 'requestId', 'memberLineUserId', 'memberNo', 'rewardName',
    'rewardOrdinal', 'redeemedBefore', 'redeemedAfter', 'status', 'redeemedByLineUserId',
    'note', 'createdAt', 'updatedAt', 'redeemedAt', 'auditRecordedAt'
  ],
  AuditLogs: [
    'timestamp', 'actorLineUserId', 'actorRole', 'action', 'targetLineUserId', 'result', 'details'
  ]
});

const MEMBER_STATUS_VALUES = ['active', 'suspended', 'disabled'];
const STAMP_SCAN_MODES = ['single', 'repeatable'];
const MAX_STAMPS_PER_SCAN = 10;
const MAX_VOUCHER_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
const LINE_IDENTITY_CACHE_MAX_SECONDS = 300;
const LINE_IDENTITY_EXPIRY_SKEW_SECONDS = 15;

let requestSpreadsheet_ = null;
let requestSheets_ = {};

function doGet() {
  return json_({
    ok: true,
    data: {
      service: POINTS_CARD_SERVICE.name,
      version: POINTS_CARD_SERVICE.version,
      capabilities: [
        'member.me', 'stamp.record', 'admin.dashboard', 'admin.member.update',
        'admin.reward.redeem', 'admin.stamp.create', 'admin.stamp.open',
        'admin.stamp.cancel', 'admin.stamp.delete'
      ]
    }
  });
}

function doPost(e) {
  resetRequestCaches_();
  try {
    const action = cleanText_(e && e.parameter && e.parameter.action, 80, true);
    const idToken = cleanText_(e && e.parameter && e.parameter.idToken, 4096, true);
    const tokenFingerprint = sha256Hex_(idToken);
    rateLimit_('token:' + tokenFingerprint, 90, 60);
    const identity = verifyLineIdToken_(idToken, tokenFingerprint);
    const context = { identity: identity, adminMember: null };
    const payload = parsePayload_(e && e.parameter && e.parameter.payload);

    switch (action) {
      case 'member.me':
        rateLimit_('member-me:' + identity.sub, 30, 60);
        return json_({ ok: true, data: memberMe_(context) });
      case 'stamp.record':
        rateLimit_('stamp-record:' + identity.sub, 12, 60);
        return json_({ ok: true, data: stampRecord_(context, payload) });
      case 'admin.dashboard':
        requireAdmin_(context);
        rateLimit_('admin-dashboard:' + identity.sub, 30, 60);
        return json_({ ok: true, data: adminDashboard_(payload) });
      case 'admin.member.update':
        requireAdmin_(context);
        rateLimit_('admin-member-update:' + identity.sub, 20, 60);
        return json_({ ok: true, data: adminMemberUpdate_(context, payload) });
      case 'admin.reward.redeem':
        requireAdmin_(context);
        rateLimit_('admin-reward-redeem:' + identity.sub, 20, 60);
        return json_({ ok: true, data: adminRewardRedeem_(context, payload) });
      case 'admin.stamp.create':
        requireAdmin_(context);
        rateLimit_('admin-stamp-create:' + identity.sub, 20, 60);
        return json_({ ok: true, data: adminStampCreate_(context, payload) });
      case 'admin.stamp.open':
        requireAdmin_(context);
        rateLimit_('admin-stamp-open:' + identity.sub, 30, 60);
        return json_({ ok: true, data: adminStampOpen_(payload) });
      case 'admin.stamp.cancel':
        requireAdmin_(context);
        rateLimit_('admin-stamp-cancel:' + identity.sub, 20, 60);
        return json_({ ok: true, data: adminStampCancel_(context, payload) });
      case 'admin.stamp.delete':
        requireAdmin_(context);
        rateLimit_('admin-stamp-delete:' + identity.sub, 20, 60);
        return json_({ ok: true, data: adminStampDelete_(context, payload) });
      default:
        fail_('INVALID_ACTION', '不支援的操作。');
    }
  } catch (error) {
    if (!error || !error.publicCode) {
      console.error('Unhandled PointsCard API error');
      return json_({ ok: false, error: { code: 'INTERNAL_ERROR', message: '集點服務暫時無法處理此要求。' } });
    }
    return json_({ ok: false, error: { code: error.publicCode, message: error.publicMessage } });
  }
}

function memberMe_(context) {
  const sheet = getSheet_(POINTS_CARD_SHEETS.members);
  let match = findByFieldWithRow_(sheet, 'lineUserId', context.identity.sub);
  if (!match) {
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(5000)) fail_('BUSY', '系統忙碌中，請稍後再試。');
    try {
      match = findByFieldWithRow_(sheet, 'lineUserId', context.identity.sub);
      if (!match) {
        const now = new Date().toISOString();
        const member = {
          lineUserId: context.identity.sub,
          memberNo: nextMemberNo_(sheet),
          displayName: cleanText_(context.identity.name || 'LINE 會員', 80, false),
          pictureUrl: safePictureUrl_(context.identity.picture),
          membershipStatus: 'active', totalStamps: 0, redeemedRewards: 0,
          joinedAt: now, note: '', createdAt: now, updatedAt: now, canManagePoints: false
        };
        if (!audit_(context.identity.sub, 'member', 'MEMBER_CREATE_REQUESTED', context.identity.sub, 'pending', { memberNo: member.memberNo })) {
          fail_('AUDIT_UNAVAILABLE', '稽核紀錄暫時無法寫入，會員資料尚未建立。');
        }
        appendObject_(sheet, member);
        audit_(context.identity.sub, 'member', 'MEMBER_CREATED', context.identity.sub, 'success', { memberNo: member.memberNo });
        return { member: publicMember_(member, false), activity: [] };
      }
    } finally { lock.releaseLock(); }
  }

  let member = match.object;
  const displayName = cleanText_(context.identity.name || member.displayName || 'LINE 會員', 80, false);
  const pictureUrl = safePictureUrl_(context.identity.picture);
  if (displayName !== member.displayName || pictureUrl !== member.pictureUrl) {
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(5000)) fail_('BUSY', '系統忙碌中，請稍後再試。');
    try {
      const fresh = findByFieldWithRow_(sheet, 'lineUserId', context.identity.sub);
      if (!fresh) fail_('MEMBER_NOT_FOUND', '找不到會員資料。');
      member = fresh.object;
      member.displayName = displayName;
      member.pictureUrl = pictureUrl;
      member.updatedAt = new Date().toISOString();
      writeObjectRow_(sheet, fresh.row, member);
    } finally { lock.releaseLock(); }
  }

  return {
    member: publicMember_(member, false),
    activity: listMemberActivity_(member.lineUserId, 20)
  };
}

function adminDashboard_(payload) {
  const memberSheet = getSheet_(POINTS_CARD_SHEETS.members);
  const query = cleanText_(payload.query || '', 80, false).toLowerCase();
  const pageSize = clampInt_(payload.pageSize, 1, 100, 100);
  const allMembers = readObjects_(memberSheet).map(normalizeMember_);
  const filtered = query ? allMembers.filter(function (member) {
    return member.memberNo.toLowerCase().indexOf(query) !== -1 ||
      member.displayName.toLowerCase().indexOf(query) !== -1;
  }) : allMembers;
  filtered.sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });

  const stats = allMembers.reduce(function (result, member) {
    result.totalMembers += 1;
    result.totalStamps += member.totalStamps;
    result.redeemedRewards += member.redeemedRewards;
    if (member.membershipStatus === 'active') result.activeMembers += 1;
    return result;
  }, { totalMembers: 0, activeMembers: 0, totalStamps: 0, redeemedRewards: 0 });

  return {
    members: filtered.slice(0, pageSize).map(function (member) { return publicMember_(member, true); }),
    vouchers: adminStampList_(payload.voucherLimit || 50),
    stats: stats,
    settings: pointsCardSettings_()
  };
}

function adminMemberUpdate_(context, payload) {
  const targetMemberNo = cleanText_(payload.targetMemberNo, 30, true);
  const expectedUpdatedAt = cleanText_(payload.expectedUpdatedAt, 40, true);
  const membershipStatus = enumValue_(payload.membershipStatus, MEMBER_STATUS_VALUES, 'INVALID_STATUS', '會員狀態不正確。');
  const note = cleanText_(payload.note || '', 500, false);
  const sheet = getSheet_(POINTS_CARD_SHEETS.members);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) fail_('BUSY', '系統忙碌中，請稍後再試。');
  try {
    const match = findByFieldWithRow_(sheet, 'memberNo', targetMemberNo);
    if (!match) fail_('MEMBER_NOT_FOUND', '找不到指定會員。');
    const member = normalizeMember_(match.object);
    if (String(member.updatedAt) !== expectedUpdatedAt) fail_('CONFLICT', '會員資料已被更新，請重新整理後再試。');
    const changedFields = [];
    if (member.membershipStatus !== membershipStatus) changedFields.push('membershipStatus');
    if (member.note !== note) changedFields.push('note');
    member.membershipStatus = membershipStatus;
    member.note = note;
    member.updatedAt = new Date().toISOString();
    if (!audit_(context.identity.sub, 'admin', 'MEMBER_UPDATE_REQUESTED', member.lineUserId, 'pending', {
      memberNo: member.memberNo, fields: changedFields
    })) fail_('AUDIT_UNAVAILABLE', '稽核紀錄暫時無法寫入，會員資料未更新。');
    writeObjectRow_(sheet, match.row, member);
    audit_(context.identity.sub, 'admin', 'MEMBER_UPDATED', member.lineUserId, 'success', {
      memberNo: member.memberNo, fields: changedFields
    });
    return { member: publicMember_(member, true) };
  } finally { lock.releaseLock(); }
}

function listMemberActivity_(lineUserId, limit) {
  const stampRows = readObjects_(getSheet_(POINTS_CARD_SHEETS.stampRecords)).filter(function (record) {
    return record.memberLineUserId === lineUserId && record.status === 'recorded';
  }).map(function (record) {
    return {
      type: 'stamp', stampCount: Number(record.stampCount || 0), note: String(record.note || ''),
      createdAt: String(record.recordedAt || record.createdAt || '')
    };
  });
  const rewardRows = readObjects_(getSheet_(POINTS_CARD_SHEETS.rewardRecords)).filter(function (record) {
    return record.memberLineUserId === lineUserId && record.status === 'recorded';
  }).map(function (record) {
    return {
      type: 'reward', rewardName: String(record.rewardName || ''), note: String(record.note || ''),
      createdAt: String(record.redeemedAt || record.createdAt || '')
    };
  });
  return stampRows.concat(rewardRows).sort(function (a, b) {
    return String(b.createdAt).localeCompare(String(a.createdAt));
  }).slice(0, clampInt_(limit, 1, 50, 20));
}

function publicMember_(value, includeAdminFields) {
  const member = normalizeMember_(value);
  const settings = pointsCardSettings_();
  const earnedRewards = Math.floor(member.totalStamps / settings.stampsPerReward);
  const availableRewards = Math.max(0, earnedRewards - member.redeemedRewards);
  const remainder = member.totalStamps % settings.stampsPerReward;
  const visualStamps = availableRewards > 0 ? settings.stampsPerReward : remainder;
  const result = {
    memberNo: member.memberNo,
    displayName: member.displayName,
    pictureUrl: member.pictureUrl,
    membershipStatus: member.membershipStatus,
    totalStamps: member.totalStamps,
    redeemedRewards: member.redeemedRewards,
    availableRewards: availableRewards,
    stampsPerReward: settings.stampsPerReward,
    visualStamps: visualStamps,
    stampsUntilReward: availableRewards > 0 ? 0 : settings.stampsPerReward - remainder,
    rewardName: settings.rewardName,
    joinedAt: member.joinedAt,
    updatedAt: member.updatedAt
  };
  if (includeAdminFields) result.note = member.note;
  return result;
}

function normalizeMember_(value) {
  return {
    lineUserId: String(value.lineUserId || ''),
    memberNo: String(value.memberNo || ''),
    displayName: String(value.displayName || 'LINE 會員'),
    pictureUrl: safePictureUrl_(value.pictureUrl),
    membershipStatus: MEMBER_STATUS_VALUES.indexOf(String(value.membershipStatus)) >= 0 ? String(value.membershipStatus) : 'disabled',
    totalStamps: storedNonNegativeInt_(value.totalStamps, 100000000),
    redeemedRewards: storedNonNegativeInt_(value.redeemedRewards, 100000000),
    joinedAt: String(value.joinedAt || ''),
    note: String(value.note || ''),
    createdAt: String(value.createdAt || ''),
    updatedAt: String(value.updatedAt || ''),
    canManagePoints: isTrue_(value.canManagePoints)
  };
}

function pointsCardSettings_() {
  const properties = PropertiesService.getScriptProperties();
  return {
    stampsPerReward: clampInt_(properties.getProperty(POINTS_CARD_SERVICE.stampsPerRewardProperty), 2, 20, 10),
    rewardName: cleanText_(properties.getProperty(POINTS_CARD_SERVICE.rewardNameProperty) || '招牌飲品一份', 80, false)
  };
}

function requireAdmin_(context) {
  const memberSheet = getSheet_(POINTS_CARD_SHEETS.members);
  const match = findByFieldWithRow_(memberSheet, 'lineUserId', context.identity.sub);
  if (!match) fail_('FORBIDDEN', '尚未建立管理員會員資料。');
  const member = normalizeMember_(match.object);
  if (!member.canManagePoints || member.membershipStatus !== 'active') fail_('FORBIDDEN', '沒有集點卡管理權限。');
  context.adminMember = member;
  return member;
}

function verifyLineIdToken_(idToken, fingerprint) {
  if (!idToken || idToken.length < 20) fail_('UNAUTHENTICATED', 'LINE 登入憑證無效。');
  const channelId = String(PropertiesService.getScriptProperties().getProperty(POINTS_CARD_SERVICE.lineChannelProperty) || '').trim();
  if (!/^\d{6,20}$/.test(channelId)) fail_('CONFIGURATION_ERROR', 'LINE Login Channel ID 尚未正確設定。');
  const cache = CacheService.getScriptCache();
  const cacheKey = 'pc-line-' + fingerprint;
  try {
    const cached = cache.get(cacheKey);
    if (cached) {
      const identity = JSON.parse(cached);
      validateVerifiedIdentity_(identity, channelId);
      return identity;
    }
  } catch (_) {}

  let response;
  try {
    response = UrlFetchApp.fetch('https://api.line.me/oauth2/v2.1/verify', {
      method: 'post',
      payload: { id_token: idToken, client_id: channelId },
      muteHttpExceptions: true
    });
  } catch (_) {
    fail_('AUTH_SERVICE_UNAVAILABLE', 'LINE 身分驗證服務暫時無法使用。');
  }
  if (response.getResponseCode() !== 200) fail_('UNAUTHENTICATED', 'LINE 登入憑證已失效，請重新登入。');
  let parsed;
  try { parsed = JSON.parse(response.getContentText()); }
  catch (_) { fail_('AUTH_SERVICE_UNAVAILABLE', 'LINE 身分驗證服務回應不正確。'); }
  const identity = {
    sub: cleanText_(parsed.sub, 80, true),
    aud: String(parsed.aud || ''),
    exp: Number(parsed.exp || 0),
    iat: Number(parsed.iat || 0),
    name: cleanText_(parsed.name || 'LINE 會員', 80, false),
    picture: safePictureUrl_(parsed.picture)
  };
  validateVerifiedIdentity_(identity, channelId);
  const ttl = Math.min(LINE_IDENTITY_CACHE_MAX_SECONDS, Math.max(1, identity.exp - Math.floor(Date.now() / 1000) - LINE_IDENTITY_EXPIRY_SKEW_SECONDS));
  try { cache.put(cacheKey, JSON.stringify(identity), ttl); }
  catch (_) {}
  return identity;
}

function validateVerifiedIdentity_(identity, channelId) {
  if (!identity || !identity.sub || String(identity.aud) !== String(channelId)) fail_('UNAUTHENTICATED', 'LINE 登入憑證無效。');
  if (!Number(identity.exp) || Number(identity.exp) <= Math.floor(Date.now() / 1000) + LINE_IDENTITY_EXPIRY_SKEW_SECONDS) {
    fail_('UNAUTHENTICATED', 'LINE 登入憑證已過期，請重新登入。');
  }
}

function rateLimit_(key, limit, windowSeconds) {
  const cache = CacheService.getScriptCache();
  const cacheKey = 'pc-rate-' + sha256Hex_(key).slice(0, 40);
  try {
    const count = Number(cache.get(cacheKey) || 0);
    if (count >= limit) fail_('RATE_LIMITED', '操作過於頻繁，請稍後再試。');
    cache.put(cacheKey, String(count + 1), windowSeconds);
  } catch (error) {
    if (error && error.publicCode) throw error;
  }
}

function parsePayload_(raw) {
  const text = String(raw || '{}');
  if (text.length > 32768) fail_('INVALID_PAYLOAD', '請求內容過大。');
  let value;
  try { value = JSON.parse(text); }
  catch (_) { fail_('INVALID_PAYLOAD', '請求內容格式不正確。'); }
  if (!value || Object.prototype.toString.call(value) !== '[object Object]') fail_('INVALID_PAYLOAD', '請求內容格式不正確。');
  return value;
}

function cleanText_(value, maxLength, required) {
  const text = String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  if (required && !text) fail_('INVALID_INPUT', '缺少必要欄位。');
  if (text.length > maxLength) fail_('INVALID_INPUT', '輸入內容過長。');
  return text;
}

function enumValue_(value, allowed, code, message) {
  const text = String(value || '');
  if (allowed.indexOf(text) < 0) fail_(code, message);
  return text;
}

function clampInt_(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || Math.floor(number) !== number || number < min || number > max) return fallback;
  return number;
}

function strictInt_(value, min, max, code, message) {
  const number = Number(value);
  if (!Number.isFinite(number) || Math.floor(number) !== number || number < min || number > max) fail_(code, message);
  return number;
}

function storedNonNegativeInt_(value, max) {
  if (value === '' || value === null || value === undefined) return 0;
  const number = Number(value);
  if (!Number.isFinite(number) || Math.floor(number) !== number || number < 0 || number > max) {
    fail_('DATA_INTEGRITY_ERROR', '集點資料格式異常，請聯絡管理員。');
  }
  return number;
}

function validIsoFuture_(value) {
  const text = cleanText_(value, 40, true);
  const time = new Date(text).getTime();
  if (!Number.isFinite(time) || time <= Date.now()) fail_('INVALID_EXPIRY', '到期時間必須晚於現在。');
  if (time - Date.now() > MAX_VOUCHER_LIFETIME_MS) fail_('INVALID_EXPIRY', 'QR Code 最長只能設定 30 天。');
  return new Date(time).toISOString();
}

function safePictureUrl_(value) {
  const url = String(value || '').trim();
  return /^https:\/\//i.test(url) && url.length <= 1000 ? url : '';
}

function isTrue_(value) {
  return value === true || String(value).toLowerCase() === 'true' || Number(value) === 1;
}

function sha256Hex_(value) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(value || ''), Utilities.Charset.UTF_8);
  return bytes.map(function (byte) { return ((byte + 256) % 256).toString(16).padStart(2, '0'); }).join('');
}

function randomHex_(bytes) {
  let result = '';
  while (result.length < bytes * 2) result += Utilities.getUuid().replace(/-/g, '');
  return result.slice(0, bytes * 2).toLowerCase();
}

function fail_(code, message) {
  const error = new Error(message);
  error.publicCode = code;
  error.publicMessage = message;
  throw error;
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
