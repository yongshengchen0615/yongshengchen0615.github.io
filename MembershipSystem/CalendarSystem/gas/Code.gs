'use strict';

const CALENDAR_SERVICE = Object.freeze({
  name: 'CalendarSystem',
  version: '1.0.0',
  adminTokenProperty: 'CALENDAR_ADMIN_TOKEN'
});

const CALENDAR_TYPES = ['holiday', 'activity'];
const CALENDAR_STATUSES = ['draft', 'published', 'archived'];
const MAX_TITLE_LENGTH = 80;
const MAX_DESCRIPTION_LENGTH = 2000;
const MAX_ADMIN_TOKEN_LENGTH = 512;

function doGet() {
  return json_({
    ok: true,
    data: {
      service: CALENDAR_SERVICE.name,
      version: CALENDAR_SERVICE.version,
      capabilities: [
        'calendar.month',
        'calendar.day',
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
      case 'calendar.month':
        rateLimit_('public-month', 240, 60);
        return json_({ ok: true, data: publicMonth_(payload) });

      case 'calendar.day':
        rateLimit_('public-day', 300, 60);
        return json_({ ok: true, data: publicDay_(payload) });

      case 'admin.events.list':
        requireAdmin_(request.adminToken);
        rateLimit_('admin-list', 120, 60);
        return json_({ ok: true, data: adminEventsList_(payload) });

      case 'admin.event.save':
        requireAdmin_(request.adminToken);
        rateLimit_('admin-save', 40, 60);
        return json_({ ok: true, data: adminEventSave_(payload) });

      case 'admin.event.delete':
        requireAdmin_(request.adminToken);
        rateLimit_('admin-delete', 30, 60);
        return json_({ ok: true, data: adminEventDelete_(payload) });

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

function adminEventSave_(payload) {
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
      audit_('admin', 'EVENT_UPDATED', updated.eventId, 'success', {
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
    audit_('admin', 'EVENT_CREATED', created.eventId, 'success', {
      date: created.date, type: created.type, status: created.status
    });
    return { created: true, event: created };
  } finally {
    lock.releaseLock();
  }
}

function adminEventDelete_(payload) {
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
    audit_('admin', 'EVENT_ARCHIVED', eventId, 'success', {
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

function requireAdmin_(token) {
  const configured = String(
    PropertiesService.getScriptProperties().getProperty(CALENDAR_SERVICE.adminTokenProperty) || ''
  );

  if (!configured) {
    fail_('ADMIN_NOT_CONFIGURED', '管理端尚未設定伺服器憑證。');
  }

  const supplied = cleanText_(token, MAX_ADMIN_TOKEN_LENGTH, true);
  rateLimit_('admin-auth', 120, 60);

  if (!constantTimeEqualHex_(sha256Hex_(configured), sha256Hex_(supplied))) {
    rateLimit_('admin-auth-failure', 30, 60);
    fail_('UNAUTHORIZED', '管理憑證不正確。');
  }
}

function parseRequest_(e) {
  const params = (e && e.parameter) || {};
  let payload = {};
  const rawPayload = String(params.payload || '').trim();

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
    adminToken: params.adminToken || ''
  };
}

function sheetObjects_(sheet) {
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  if (lastRow < 2 || lastColumn < 1) return [];

  const values = sheet.getRange(1, 1, lastRow, lastColumn).getDisplayValues();
  const headers = values[0];
  return values.slice(1)
    .filter(row => row.some(value => String(value).trim() !== ''))
    .map(row => {
      const object = {};
      headers.forEach((header, index) => {
        if (header) object[header] = row[index] == null ? '' : row[index];
      });
      return object;
    });
}

function appendObject_(sheet, object) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  sheet.appendRow(headers.map(header => object[header] == null ? '' : object[header]));
}

function writeObjectAtRow_(sheet, rowNumber, object) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  sheet.getRange(rowNumber, 1, 1, headers.length)
    .setValues([headers.map(header => object[header] == null ? '' : object[header])]);
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
  const text = String(value == null ? '' : value).trim();
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

function constantTimeEqualHex_(a, b) {
  const left = String(a || '');
  const right = String(b || '');
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    diff |= (left.charCodeAt(i % Math.max(left.length, 1)) || 0) ^
      (right.charCodeAt(i % Math.max(right.length, 1)) || 0);
  }
  return diff === 0;
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
