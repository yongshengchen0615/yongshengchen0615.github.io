'use strict';

const CALENDAR_SERVICE = Object.freeze({
  name: 'CalendarSystem',
  version: '1.5.0',
  userLineChannelProperty: 'USER_LINE_LOGIN_CHANNEL_ID',
  legacyUserLineChannelProperty: 'LINE_LOGIN_CHANNEL_ID',
  adminLineChannelProperty: 'ADMIN_LINE_LOGIN_CHANNEL_ID'
});

const CALENDAR_TYPES = ['holiday', 'activity'];
const CALENDAR_STATUSES = ['draft', 'published', 'archived'];
const MAX_TITLE_LENGTH = 80;
const MAX_DESCRIPTION_LENGTH = 2000;
const MAX_ID_TOKEN_LENGTH = 4096;
const LINE_IDENTITY_CACHE_MAX_SECONDS = 300;
const LINE_IDENTITY_EXPIRY_SKEW_SECONDS = 15;

function doGet() {
  return json_({
    ok: true,
    data: {
      service: CALENDAR_SERVICE.name,
      version: CALENDAR_SERVICE.version,
      capabilities: [
        'member.me',
        'calendar.month',
        'calendar.day',
        'admin.session',
        'admin.events.list',
        'admin.event.save',
        'admin.event.delete'
      ]
    }
  });
}

function doPost(e) {
  try {
    const request = parseRequest_(e);
    const action = cleanText_(request.action, 80, true);
    const payload = request.payload || {};

    switch (action) {
      case 'member.me': {
        const identity = requireLineIdentity_(request.idToken, 'user');
        rateLimit_('member-me:' + identity.sub, 30, 60);
        return json_({ ok: true, data: memberMe_(identity) });
      }

      case 'calendar.month': {
        const identity = requireLineIdentity_(request.idToken, 'user');
        rateLimit_('calendar-month:' + identity.sub, 60, 60);
        return json_({ ok: true, data: publicMonth_(payload) });
      }

      case 'calendar.day': {
        const identity = requireLineIdentity_(request.idToken, 'user');
        rateLimit_('calendar-day:' + identity.sub, 90, 60);
        return json_({ ok: true, data: publicDay_(payload) });
      }

      case 'admin.session': {
        const identity = requireLineIdentity_(request.idToken, 'admin');
        rateLimit_('admin-session:' + identity.sub, 30, 60);
        return json_({ ok: true, data: adminSession_(identity) });
      }

      case 'admin.events.list': {
        const identity = requireLineIdentity_(request.idToken, 'admin');
        requireCalendarAdmin_(identity);
        rateLimit_('admin-list:' + identity.sub, 120, 60);
        return json_({ ok: true, data: adminEventsList_(payload) });
      }

      case 'admin.event.save': {
        const identity = requireLineIdentity_(request.idToken, 'admin');
        requireCalendarAdmin_(identity);
        rateLimit_('admin-save:' + identity.sub, 40, 60);
        return json_({ ok: true, data: adminEventSave_(payload, identity) });
      }

      case 'admin.event.delete': {
        const identity = requireLineIdentity_(request.idToken, 'admin');
        requireCalendarAdmin_(identity);
        rateLimit_('admin-delete:' + identity.sub, 30, 60);
        return json_({ ok: true, data: adminEventDelete_(payload, identity) });
      }

      default:
        fail_('INVALID_ACTION', '不支援的操作。');
    }
  } catch (error) {
    if (!error || !error.publicCode) {
      console.error(JSON.stringify({
        event: 'calendar_unhandled_error',
        message: String(error && error.message || error || '').slice(0, 500)
      }));
      return json_({
        ok: false,
        error: { code: 'INTERNAL_ERROR', message: '日曆服務暫時無法處理此要求。' }
      });
    }
    return json_({
      ok: false,
      error: { code: error.publicCode, message: error.publicMessage }
    });
  }
}

function memberMe_(identity) {
  recordIdentityLogin_(identity, 'user');
  return { profile: identityProfile_(identity) };
}

function adminSession_(identity) {
  recordIdentityLogin_(identity, 'admin');
  const permission = ensureAdminPermissionRecord_(identity);
  return {
    profile: identityProfile_(identity),
    authorization: {
      canManageCalendar: permission.canManageCalendar,
      status: permission.status
    }
  };
}

function identityProfile_(identity) {
  return {
    displayName: cleanText_(identity && identity.name || 'LINE 會員', 80, false) || 'LINE 會員',
    pictureUrl: safePictureUrl_(identity && identity.picture)
  };
}

function publicMonth_(payload) {
  const year = integerInRange_(payload.year, 2000, 2100, 'year');
  const month = integerInRange_(payload.month, 1, 12, 'month');
  const prefix = year + '-' + String(month).padStart(2, '0') + '-';

  const events = readEvents_()
    .filter(event => event.status === 'published' && event.date.indexOf(prefix) === 0)
    .map(publicEvent_)
    .sort(eventSort_);

  return { year: year, month: month, events: events };
}

function publicDay_(payload) {
  const date = validDate_(payload.date);
  const events = readEvents_()
    .filter(event => event.status === 'published' && event.date === date)
    .map(publicEvent_)
    .sort(eventSort_);

  return { date: date, events: events };
}

function adminEventsList_(payload) {
  const year = integerInRange_(payload.year, 2000, 2100, 'year');
  const month = integerInRange_(payload.month, 1, 12, 'month');
  const prefix = year + '-' + String(month).padStart(2, '0') + '-';

  const events = readEvents_()
    .filter(event => event.status !== 'archived' && event.date.indexOf(prefix) === 0)
    .sort(eventSort_);

  return { year: year, month: month, events: events };
}

function adminEventSave_(payload, actorIdentity) {
  const event = validateEventInput_(payload);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) fail_('BUSY', '系統忙碌中，請稍後再試。');

  try {
    const sheet = eventsSheet_();
    const rows = sheetObjects_(sheet);
    const now = new Date().toISOString();
    const existingIndex = event.eventId
      ? rows.findIndex(row => row.eventId === event.eventId)
      : -1;

    if (event.eventId && existingIndex < 0) {
      fail_('NOT_FOUND', '找不到要更新的日期設定。');
    }

    if (existingIndex >= 0) {
      const existing = rows[existingIndex];
      const updated = {
        eventId: existing.eventId,
        date: event.date,
        type: event.type,
        title: event.title,
        description: event.description,
        status: event.status,
        createdAt: existing.createdAt || now,
        updatedAt: now
      };
      writeObjectAtRow_(sheet, existingIndex + 2, updated);
      audit_(adminActor_(actorIdentity), 'EVENT_UPDATED', updated.eventId, 'success', {
        date: updated.date, type: updated.type, status: updated.status
      });
      return { created: false, event: updated };
    }

    const created = {
      eventId: 'evt_' + Utilities.getUuid().replace(/-/g, ''),
      date: event.date,
      type: event.type,
      title: event.title,
      description: event.description,
      status: event.status,
      createdAt: now,
      updatedAt: now
    };
    appendObject_(sheet, created);
    audit_(adminActor_(actorIdentity), 'EVENT_CREATED', created.eventId, 'success', {
      date: created.date, type: created.type, status: created.status
    });
    return { created: true, event: created };
  } finally {
    lock.releaseLock();
  }
}

function adminEventDelete_(payload, actorIdentity) {
  const eventId = cleanText_(payload.eventId, 80, true);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) fail_('BUSY', '系統忙碌中，請稍後再試。');

  try {
    const sheet = eventsSheet_();
    const rows = sheetObjects_(sheet);
    const index = rows.findIndex(row => row.eventId === eventId && row.status !== 'archived');
    if (index < 0) fail_('NOT_FOUND', '找不到要封存的日期設定。');

    const existing = rows[index];
    const archived = Object.assign({}, existing, {
      status: 'archived',
      updatedAt: new Date().toISOString()
    });
    writeObjectAtRow_(sheet, index + 2, archived);
    audit_(adminActor_(actorIdentity), 'EVENT_ARCHIVED', eventId, 'success', {
      date: archived.date, type: archived.type
    });
    return { eventId: eventId, archived: true };
  } finally {
    lock.releaseLock();
  }
}

function validateEventInput_(payload) {
  const eventId = cleanText_(payload.eventId, 80, false);
  const date = validDate_(payload.date);
  const type = cleanText_(payload.type, 20, true);
  const status = cleanText_(payload.status, 20, true);
  const title = cleanText_(payload.title, MAX_TITLE_LENGTH, true);
  const description = cleanText_(payload.description, MAX_DESCRIPTION_LENGTH, false);

  if (CALENDAR_TYPES.indexOf(type) < 0) {
    fail_('INVALID_TYPE', '類型必須是休假日或活動日。');
  }
  if (status !== 'draft' && status !== 'published') {
    fail_('INVALID_STATUS', '發布狀態不正確。');
  }

  return {
    eventId: eventId,
    date: date,
    type: type,
    status: status,
    title: title,
    description: description
  };
}

function publicEvent_(event) {
  return {
    date: event.date,
    type: event.type,
    title: event.title,
    description: event.description
  };
}

function readEvents_() {
  return sheetObjects_(eventsSheet_()).map(normalizeEvent_);
}

function normalizeEvent_(row) {
  return {
    eventId: cleanText_(row.eventId, 80, false),
    date: cleanText_(row.date, 10, false),
    type: cleanText_(row.type, 20, false),
    title: cleanText_(row.title, MAX_TITLE_LENGTH, false),
    description: cleanText_(row.description, MAX_DESCRIPTION_LENGTH, false),
    status: cleanText_(row.status, 20, false) || 'draft',
    createdAt: cleanText_(row.createdAt, 64, false),
    updatedAt: cleanText_(row.updatedAt, 64, false)
  };
}

function eventSort_(a, b) {
  return String(a.date).localeCompare(String(b.date)) ||
    String(a.type).localeCompare(String(b.type)) ||
    String(a.title).localeCompare(String(b.title));
}

function eventsSheet_() {
  return ensureCalendarStorage_().getSheetByName(CALENDAR_STORAGE.eventsSheet);
}

function identitiesSheet_() {
  return ensureCalendarStorage_().getSheetByName(CALENDAR_STORAGE.identitiesSheet);
}

function adminPermissionsSheet_() {
  return ensureCalendarStorage_().getSheetByName(CALENDAR_STORAGE.adminPermissionsSheet);
}

function audit_(actor, action, eventId, result, details) {
  try {
    const sheet = ensureCalendarStorage_().getSheetByName(CALENDAR_STORAGE.auditSheet);
    appendObject_(sheet, {
      timestamp: new Date().toISOString(),
      actor: cleanText_(actor, 80, false),
      action: cleanText_(action, 80, false),
      eventId: cleanText_(eventId, 80, false),
      result: cleanText_(result, 40, false),
      details: JSON.stringify(details || {}).slice(0, 2000)
    });
    return true;
  } catch (error) {
    console.error('calendar_audit_failed: ' + String(error && error.message || error).slice(0, 300));
    return false;
  }
}

function adminActor_(identity) {
  return cleanText_(identity && identity.sub || 'admin', 80, false) || 'admin';
}

function recordIdentityLogin_(identity, surface) {
  const authSurface = surface === 'admin' ? 'admin' : 'user';
  const lineUserId = cleanText_(identity && identity.sub, 80, true);
  const displayName = cleanText_(identity && identity.name || 'LINE 會員', 80, false) || 'LINE 會員';
  const pictureUrl = safePictureUrl_(identity && identity.picture);
  const now = new Date().toISOString();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(3000)) fail_('BUSY', '系統忙碌中，請稍後再試。');

  try {
    const sheet = identitiesSheet_();
    const rows = sheetObjects_(sheet);
    const matches = [];
    rows.forEach((row, index) => {
      if (
        cleanText_(row.lineUserId, 80, false) === lineUserId &&
        cleanText_(row.surface, 20, false) === authSurface
      ) {
        matches.push({ row: row, rowNumber: index + 2 });
      }
    });

    if (matches.length > 1) {
      fail_('DATA_INTEGRITY_ERROR', 'LINE 身分資料存在重複紀錄，請先修正資料表。');
    }

    if (!matches.length) {
      const created = {
        lineUserId: lineUserId,
        surface: authSurface,
        displayName: displayName,
        pictureUrl: pictureUrl,
        firstSeenAt: now,
        lastLoginAt: now,
        loginCount: '1'
      };
      appendObject_(sheet, created);
      verifyIdentityPersistence_(sheet, lineUserId, authSurface, now);
      audit_(lineUserId, 'LINE_IDENTITY_CREATED', '', 'success', { surface: authSurface });
      audit_(lineUserId, 'LOGIN_SUCCESS', '', 'success', { surface: authSurface });
      return created;
    }

    const existing = matches[0].row;
    const count = Math.max(0, parseInt(String(existing.loginCount || '0'), 10) || 0) + 1;
    const updated = {
      lineUserId: lineUserId,
      surface: authSurface,
      displayName: displayName,
      pictureUrl: pictureUrl,
      firstSeenAt: cleanText_(existing.firstSeenAt, 64, false) || now,
      lastLoginAt: now,
      loginCount: String(count)
    };
    writeObjectAtRow_(sheet, matches[0].rowNumber, updated);
    verifyIdentityPersistence_(sheet, lineUserId, authSurface, now);
    audit_(lineUserId, 'LOGIN_SUCCESS', '', 'success', { surface: authSurface });
    return updated;
  } finally {
    lock.releaseLock();
  }
}

function verifyIdentityPersistence_(sheet, lineUserId, surface, expectedLastLoginAt) {
  SpreadsheetApp.flush();
  const matches = sheetObjects_(sheet).filter(row =>
    cleanText_(row.lineUserId, 80, false) === lineUserId &&
    cleanText_(row.surface, 20, false) === surface
  );

  if (
    matches.length !== 1 ||
    cleanText_(matches[0].lastLoginAt, 64, false) !== expectedLastLoginAt
  ) {
    fail_('STORAGE_WRITE_FAILED', 'LINE 登入資料寫入失敗，請稍後再試。');
  }
}

function ensureAdminPermissionRecord_(identity) {
  const lineUserId = cleanText_(identity && identity.sub, 80, true);
  let existing = findAdminPermission_(lineUserId);
  if (existing) return existing;

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(3000)) fail_('BUSY', '系統忙碌中，請稍後再試。');
  try {
    existing = findAdminPermission_(lineUserId);
    if (existing) return existing;

    const created = {
      lineUserId: lineUserId,
      displayName: cleanText_(identity && identity.name || 'LINE 管理員', 80, false) || 'LINE 管理員',
      canManageCalendar: 'FALSE',
      status: 'active',
      note: '',
      firstSeenAt: new Date().toISOString()
    };
    appendObject_(adminPermissionsSheet_(), created);
    audit_(lineUserId, 'ADMIN_PERMISSION_DISCOVERED', '', 'success', {
      canManageCalendar: false,
      status: 'active'
    });
    return normalizeAdminPermission_(created);
  } finally {
    lock.releaseLock();
  }
}

function findAdminPermission_(lineUserId) {
  const matches = sheetObjects_(adminPermissionsSheet_())
    .filter(row => cleanText_(row.lineUserId, 80, false) === lineUserId);

  if (matches.length > 1) {
    fail_('DATA_INTEGRITY_ERROR', '管理權限資料存在重複 LINE 使用者，請先修正資料表。');
  }
  return matches.length ? normalizeAdminPermission_(matches[0]) : null;
}

function normalizeAdminPermission_(row) {
  const rawStatus = cleanText_(row.status, 20, false).toLowerCase();
  return {
    lineUserId: cleanText_(row.lineUserId, 80, false),
    displayName: cleanText_(row.displayName, 80, false),
    canManageCalendar: isTrue_(row.canManageCalendar),
    status: rawStatus === 'active' ? 'active' : 'disabled',
    note: cleanText_(row.note, 500, false),
    firstSeenAt: cleanText_(row.firstSeenAt, 64, false)
  };
}

function requireCalendarAdmin_(identity) {
  const permission = ensureAdminPermissionRecord_(identity);
  if (permission.status !== 'active' || !permission.canManageCalendar) {
    fail_('FORBIDDEN', '此 LINE 帳號尚未取得日曆管理權限。');
  }
  return permission;
}

function requireLineIdentity_(idToken, surface) {
  const authSurface = surface === 'admin' ? 'admin' : 'user';
  const supplied = cleanText_(idToken, MAX_ID_TOKEN_LENGTH, true);
  if (supplied.length < 20) fail_('UNAUTHENTICATED', 'LINE 登入憑證無效。');
  const fingerprint = sha256Hex_(supplied);
  rateLimit_('line-token:' + authSurface + ':' + fingerprint.slice(0, 32), 90, 60);
  return verifyLineIdToken_(supplied, fingerprint, authSurface);
}

function lineChannelIdForSurface_(surface) {
  const properties = PropertiesService.getScriptProperties();
  let channelId = '';

  if (surface === 'admin') {
    channelId = String(properties.getProperty(CALENDAR_SERVICE.adminLineChannelProperty) || '').trim();
  } else {
    channelId = String(properties.getProperty(CALENDAR_SERVICE.userLineChannelProperty) || '').trim();
    if (!channelId) {
      channelId = String(properties.getProperty(CALENDAR_SERVICE.legacyUserLineChannelProperty) || '').trim();
    }
  }

  if (!/^\d{6,20}$/.test(channelId)) {
    fail_(
      'CONFIGURATION_ERROR',
      surface === 'admin'
        ? '管理端 LINE Login Channel ID 尚未正確設定。'
        : '用戶端 LINE Login Channel ID 尚未正確設定。'
    );
  }
  return channelId;
}

function verifyLineIdToken_(idToken, fingerprint, surface) {
  const channelId = lineChannelIdForSurface_(surface);
  const cache = CacheService.getScriptCache();
  const cacheKey = 'calendar-line-' + surface + '-' + fingerprint.slice(0, 40);
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

  if (response.getResponseCode() !== 200) {
    fail_('UNAUTHENTICATED', 'LINE 登入憑證已失效，請重新登入。');
  }

  let parsed;
  try {
    parsed = JSON.parse(response.getContentText());
  } catch (_) {
    fail_('AUTH_SERVICE_UNAVAILABLE', 'LINE 身分驗證服務回應不正確。');
  }

  const identity = {
    sub: cleanText_(parsed.sub, 80, true),
    aud: String(parsed.aud || ''),
    exp: Number(parsed.exp || 0),
    iat: Number(parsed.iat || 0),
    name: cleanText_(parsed.name || 'LINE 會員', 80, false),
    picture: safePictureUrl_(parsed.picture)
  };
  validateVerifiedIdentity_(identity, channelId);

  const ttl = Math.min(
    LINE_IDENTITY_CACHE_MAX_SECONDS,
    Math.max(1, identity.exp - Math.floor(Date.now() / 1000) - LINE_IDENTITY_EXPIRY_SKEW_SECONDS)
  );
  try {
    cache.put(cacheKey, JSON.stringify(identity), ttl);
  } catch (_) {}
  return identity;
}

function validateVerifiedIdentity_(identity, channelId) {
  if (!identity || !identity.sub || String(identity.aud) !== String(channelId)) {
    fail_('UNAUTHENTICATED', 'LINE 登入憑證無效。');
  }
  if (!Number(identity.exp) || Number(identity.exp) <= Math.floor(Date.now() / 1000) + LINE_IDENTITY_EXPIRY_SKEW_SECONDS) {
    fail_('UNAUTHENTICATED', 'LINE 登入憑證已過期，請重新登入。');
  }
}

function safePictureUrl_(value) {
  const url = String(value || '').trim();
  return /^https:\/\//i.test(url) && url.length <= 1000 ? url : '';
}

function isTrue_(value) {
  return value === true || String(value == null ? '' : value).trim().toLowerCase() === 'true' || Number(value) === 1;
}

function parseRequest_(e) {
  const params = (e && e.parameter) || {};
  let payload = {};
  const rawPayload = String(params.payload || '').trim();

  if (rawPayload.length > 32768) {
    fail_('INVALID_PAYLOAD', 'payload 內容過大。');
  }

  if (rawPayload) {
    try {
      payload = JSON.parse(rawPayload);
    } catch (error) {
      fail_('INVALID_PAYLOAD', 'payload 必須是有效 JSON。');
    }
  }

  if (!payload || Object.prototype.toString.call(payload) !== '[object Object]') {
    fail_('INVALID_PAYLOAD', 'payload 格式不正確。');
  }

  return {
    action: params.action || '',
    payload: payload,
    idToken: params.idToken || ''
  };
}

function sheetObjects_(sheet) {
  const lastRow = sheet.getLastRow();
  const headers = sheetHeaders_(sheet);
  if (lastRow < 2) return [];

  const values = sheet.getRange(1, 1, lastRow, headers.length).getDisplayValues();
  return values.slice(1)
    .filter(row => row.some(value => String(value).trim() !== ''))
    .map(row => {
      const object = {};
      headers.forEach((header, index) => {
        object[header] = row[index] == null ? '' : row[index];
      });
      return object;
    });
}

function sheetHeaders_(sheet) {
  const lastColumn = sheet.getLastColumn();
  if (lastColumn < 1) fail_('DATA_INTEGRITY_ERROR', '資料表缺少欄位標題。');

  const row = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0];
  let end = row.length;
  while (end > 0 && !String(row[end - 1] || '').trim()) end -= 1;
  const headers = row.slice(0, end).map(value => String(value || '').trim());

  if (!headers.length || headers.some(header => !header)) {
    fail_('DATA_INTEGRITY_ERROR', '資料表欄位標題不完整。');
  }
  return headers;
}

function appendObject_(sheet, object) {
  try {
    const headers = sheetHeaders_(sheet);
    sheet.appendRow(headers.map(header => object[header] == null ? '' : object[header]));
    SpreadsheetApp.flush();
  } catch (error) {
    if (error && error.publicCode) throw error;
    console.error(JSON.stringify({
      event: 'calendar_sheet_append_failed',
      sheet: String(sheet && sheet.getName ? sheet.getName() : '').slice(0, 80),
      message: String(error && error.message || error || '').slice(0, 500)
    }));
    fail_('STORAGE_WRITE_FAILED', '資料暫時無法儲存，請稍後再試。');
  }
}

function writeObjectAtRow_(sheet, rowNumber, object) {
  try {
    const headers = sheetHeaders_(sheet);
    sheet.getRange(rowNumber, 1, 1, headers.length)
      .setValues([headers.map(header => object[header] == null ? '' : object[header])]);
    SpreadsheetApp.flush();
  } catch (error) {
    if (error && error.publicCode) throw error;
    console.error(JSON.stringify({
      event: 'calendar_sheet_update_failed',
      sheet: String(sheet && sheet.getName ? sheet.getName() : '').slice(0, 80),
      message: String(error && error.message || error || '').slice(0, 500)
    }));
    fail_('STORAGE_WRITE_FAILED', '資料暫時無法儲存，請稍後再試。');
  }
}

function validDate_(value) {
  const text = cleanText_(value, 10, true);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    fail_('INVALID_DATE', '日期格式必須是 YYYY-MM-DD。');
  }

  const parts = text.split('-').map(Number);
  const date = new Date(parts[0], parts[1] - 1, parts[2]);
  if (
    date.getFullYear() !== parts[0] ||
    date.getMonth() !== parts[1] - 1 ||
    date.getDate() !== parts[2] ||
    parts[0] < 2000 ||
    parts[0] > 2100
  ) {
    fail_('INVALID_DATE', '日期不正確。');
  }
  return text;
}

function integerInRange_(value, min, max, field) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    fail_('INVALID_' + String(field).toUpperCase(), field + ' 超出允許範圍。');
  }
  return number;
}

function cleanText_(value, maxLength, required) {
  const text = String(value == null ? '' : value)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim();
  if (required && !text) fail_('REQUIRED_FIELD', '缺少必要欄位。');
  if (text.length > maxLength) fail_('FIELD_TOO_LONG', '欄位內容過長。');
  return text;
}

function sha256Hex_(value) {
  return Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(value || ''),
    Utilities.Charset.UTF_8
  ).map(byte => ('0' + ((byte + 256) % 256).toString(16)).slice(-2)).join('');
}

function rateLimit_(key, limit, windowSeconds) {
  const cache = CacheService.getScriptCache();
  const safeKey = 'calendar-rate:' + sha256Hex_(String(key)).slice(0, 24);
  const lock = LockService.getScriptLock();

  if (!lock.tryLock(1500)) fail_('BUSY', '系統忙碌中，請稍後再試。');
  try {
    const current = Number(cache.get(safeKey) || 0);
    if (current >= limit) fail_('RATE_LIMITED', '操作過於頻繁，請稍後再試。');
    cache.put(safeKey, String(current + 1), windowSeconds);
  } finally {
    lock.releaseLock();
  }
}

function fail_(code, message) {
  const error = new Error(message);
  error.publicCode = code;
  error.publicMessage = message;
  throw error;
}

function json_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
