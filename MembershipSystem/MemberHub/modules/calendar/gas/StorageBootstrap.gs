'use strict';

const CALENDAR_STORAGE_PROPERTY_ = 'CALENDAR_SYSTEM_V2_SPREADSHEET_ID';
const CALENDAR_DATA_REVISION_PROPERTY_ = 'CALENDAR_SYSTEM_V2_DATA_REVISION';
const CALENDAR_LINE_VERIFY_PREFLIGHT_URL_ = 'https://api.line.me/oauth2/v2.1/verify';
const CALENDAR_SHEET_SCHEMAS_ = Object.freeze({
  Users: Object.freeze([
    'line_user_id', 'display_name', 'status', 'last_login_at', 'created_at', 'updated_at'
  ]),
  Admins: Object.freeze([
    'line_user_id', 'display_name', 'role', 'status', 'first_seen_at', 'updated_at'
  ]),
  CalendarItems: Object.freeze([
    'item_id', 'type', 'title', 'start_date', 'end_date', 'all_day', 'start_time', 'end_time',
    'description', 'location', 'status', 'created_by', 'created_at', 'updated_by', 'updated_at', 'color'
  ]),
  AuditLogs: Object.freeze([
    'audit_id', 'actor_line_user_id', 'actor_role', 'action', 'target_type', 'target_id',
    'result', 'detail', 'created_at'
  ])
});

let CALENDAR_SPREADSHEET_CACHE_ = null;

function setupCalendarSystem() {
  // Running setupCalendarSystem() manually from the Apps Script editor intentionally
  // touches UrlFetchApp so Google requests the external_request OAuth scope during
  // the same authorization flow used to create/access the Spreadsheet.
  const authorization = authorizeCalendarSetupRuntime_();
  const spreadsheet = ensureCalendarStorage_();
  return {
    spreadsheetId: spreadsheet.getId(),
    spreadsheetUrl: spreadsheet.getUrl(),
    sheets: Object.keys(CALENDAR_SHEET_SCHEMAS_),
    urlFetchAuthorized: authorization.urlFetchAuthorized,
    lineVerifyPreflightStatus: authorization.lineVerifyPreflightStatus
  };
}

function authorizeCalendarSetupRuntime_() {
  try {
    const response = UrlFetchApp.fetch(CALENDAR_LINE_VERIFY_PREFLIGHT_URL_, {
      method: 'post',
      contentType: 'application/x-www-form-urlencoded',
      payload: {
        id_token: 'calendar-system-permission-check',
        client_id: 'calendar-system-permission-check'
      },
      muteHttpExceptions: true,
      followRedirects: true
    });

    return Object.freeze({
      urlFetchAuthorized: true,
      lineVerifyPreflightStatus: response.getResponseCode()
    });
  } catch (error) {
    throw new ApiError(
      503,
      'URL_FETCH_AUTHORIZATION_REQUIRED',
      'CalendarSystem 初始化需要 UrlFetchApp 外部請求權限。請從 Apps Script 編輯器重新執行 setupCalendarSystem() 並完成 Google 授權。'
    );
  }
}

function ensureCalendarStorage_() {
  const spreadsheet = getCalendarSpreadsheet_();
  Object.keys(CALENDAR_SHEET_SCHEMAS_).forEach(function(sheetName) {
    ensureSheetSchema_(spreadsheet, sheetName, CALENDAR_SHEET_SCHEMAS_[sheetName]);
  });
  return spreadsheet;
}

function getCalendarSpreadsheet_() {
  if (CALENDAR_SPREADSHEET_CACHE_) return CALENDAR_SPREADSHEET_CACHE_;

  const properties = PropertiesService.getScriptProperties();
  const spreadsheetId = String(properties.getProperty(CALENDAR_STORAGE_PROPERTY_) || '').trim();

  if (spreadsheetId) {
    try {
      CALENDAR_SPREADSHEET_CACHE_ = SpreadsheetApp.openById(spreadsheetId);
      return CALENDAR_SPREADSHEET_CACHE_;
    } catch (error) {
      throw new ApiError(503, 'STORAGE_UNAVAILABLE', '設定的 CalendarSystem Spreadsheet 無法開啟。');
    }
  }

  try {
    CALENDAR_SPREADSHEET_CACHE_ = SpreadsheetApp.create('CalendarSystem V2 Data');
    properties.setProperty(CALENDAR_STORAGE_PROPERTY_, CALENDAR_SPREADSHEET_CACHE_.getId());
    return CALENDAR_SPREADSHEET_CACHE_;
  } catch (error) {
    throw new ApiError(503, 'STORAGE_UNAVAILABLE', '無法建立 CalendarSystem Spreadsheet。');
  }
}

function ensureSheetSchema_(spreadsheet, sheetName, headers) {
  let sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) sheet = spreadsheet.insertSheet(sheetName);

  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();

  if (lastRow === 0 || lastColumn === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    if (sheet.getMaxRows() > 1) {
      sheet.getRange(2, 1, sheet.getMaxRows() - 1, headers.length).setNumberFormat('@');
    }
    return;
  }

  if (lastColumn !== headers.length) {
    if (migrateLegacyCalendarItemsSchema_(sheet, sheetName, headers, lastColumn)) return;
    throw new ApiError(500, 'SCHEMA_MISMATCH', sheetName + ' 資料表欄位數量與 V2 schema 不一致。');
  }

  const actualHeaders = sheet.getRange(1, 1, 1, headers.length).getDisplayValues()[0];
  const matches = headers.every(function(header, index) {
    return String(actualHeaders[index] || '') === header;
  });
  if (!matches) {
    throw new ApiError(500, 'SCHEMA_MISMATCH', sheetName + ' 資料表欄位與 V2 schema 不一致。');
  }
}

function migrateLegacyCalendarItemsSchema_(sheet, sheetName, headers, lastColumn) {
  if (sheetName !== 'CalendarItems' || lastColumn !== headers.length - 1 || headers[headers.length - 1] !== 'color') {
    return false;
  }

  const legacyHeaders = headers.slice(0, -1);
  const actualHeaders = sheet.getRange(1, 1, 1, legacyHeaders.length).getDisplayValues()[0];
  const legacyMatches = legacyHeaders.every(function(header, index) {
    return String(actualHeaders[index] || '') === header;
  });
  if (!legacyMatches) return false;

  sheet.getRange(1, headers.length).setValue('color').setFontWeight('bold');
  if (sheet.getMaxRows() > 1) {
    sheet.getRange(2, headers.length, sheet.getMaxRows() - 1, 1).setNumberFormat('@');
  }
  return true;
}

function getDataSheet_(sheetName) {
  const spreadsheet = getCalendarSpreadsheet_();
  const sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) throw new ApiError(500, 'SCHEMA_MISSING', '缺少資料表：' + sheetName);
  return sheet;
}

function readRecords_(sheetName) {
  const sheet = getDataSheet_(sheetName);
  const headers = CALENDAR_SHEET_SCHEMAS_[sheetName];
  if (!headers) throw new ApiError(500, 'SCHEMA_MISSING', '未知資料表：' + sheetName);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  return values.map(function(row) {
    return rowToRecord_(headers, row);
  });
}

function findRecordWithRow_(sheetName, keyField, keyValue) {
  const sheet = getDataSheet_(sheetName);
  const headers = CALENDAR_SHEET_SCHEMAS_[sheetName];
  if (!headers) throw new ApiError(500, 'SCHEMA_MISSING', '未知資料表：' + sheetName);
  const keyIndex = headers.indexOf(keyField);
  if (keyIndex === -1) throw new ApiError(500, 'SCHEMA_MISSING', '未知欄位：' + keyField);

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  const expected = String(keyValue || '');
  const match = sheet
    .getRange(2, keyIndex + 1, lastRow - 1, 1)
    .createTextFinder(expected)
    .matchEntireCell(true)
    .matchCase(true)
    .findNext();

  if (!match) return null;
  const rowNumber = match.getRow();
  const row = sheet.getRange(rowNumber, 1, 1, headers.length).getValues()[0];
  return { rowNumber: rowNumber, record: rowToRecord_(headers, row) };
}

function appendRecord_(sheetName, record) {
  const sheet = getDataSheet_(sheetName);
  const headers = CALENDAR_SHEET_SCHEMAS_[sheetName];
  if (!headers) throw new ApiError(500, 'SCHEMA_MISSING', '未知資料表：' + sheetName);

  const rowNumber = Math.max(sheet.getLastRow() + 1, 2);
  const range = sheet.getRange(rowNumber, 1, 1, headers.length);
  range.setNumberFormat('@');
  range.setValues([recordToRow_(headers, record)]);
  return rowNumber;
}

function updateRecordAtRow_(sheetName, rowNumber, record) {
  const sheet = getDataSheet_(sheetName);
  const headers = CALENDAR_SHEET_SCHEMAS_[sheetName];
  if (!headers) throw new ApiError(500, 'SCHEMA_MISSING', '未知資料表：' + sheetName);
  if (!Number.isInteger(rowNumber) || rowNumber < 2 || rowNumber > sheet.getLastRow()) {
    throw new ApiError(500, 'INVALID_ROW', '資料列位置不合法。');
  }

  const range = sheet.getRange(rowNumber, 1, 1, headers.length);
  range.setNumberFormat('@');
  range.setValues([recordToRow_(headers, record)]);
}

function appendAuditRecord_(record) {
  appendRecord_('AuditLogs', record);
}

function getCalendarDataRevision_() {
  return String(PropertiesService.getScriptProperties().getProperty(CALENDAR_DATA_REVISION_PROPERTY_) || '0');
}

function bumpCalendarDataRevision_() {
  const revision = Date.now().toString(36) + '-' + Utilities.getUuid().substring(0, 8);
  PropertiesService.getScriptProperties().setProperty(CALENDAR_DATA_REVISION_PROPERTY_, revision);
  return revision;
}

function recordToRow_(headers, record) {
  return headers.map(function(header) {
    return escapeSheetValue_(record && record[header] !== undefined ? record[header] : '');
  });
}

function rowToRecord_(headers, row) {
  const record = {};
  headers.forEach(function(header, index) {
    record[header] = decodeSheetValue_(row[index]);
  });
  return record;
}

function escapeSheetValue_(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (/^[=+\-@]/.test(text)) return "'" + text;
  return text;
}

function decodeSheetValue_(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (/^'[=+\-@]/.test(text)) return text.substring(1);
  return text;
}

function withDataLock_(callback) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (error) {
    throw new ApiError(503, 'DATA_BUSY', '資料正在更新，請稍後再試。');
  }

  try {
    return callback();
  } finally {
    lock.releaseLock();
  }
}

function nowIso_() {
  return new Date().toISOString();
}
