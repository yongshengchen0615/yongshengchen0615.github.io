'use strict';

const CALENDAR_STORAGE_PROPERTY_ = 'CALENDAR_SYSTEM_V2_SPREADSHEET_ID';
const CALENDAR_SHEET_SCHEMAS_ = Object.freeze({
  Users: Object.freeze([
    'line_user_id', 'display_name', 'status', 'last_login_at', 'created_at', 'updated_at'
  ]),
  Admins: Object.freeze([
    'line_user_id', 'display_name', 'role', 'status', 'first_seen_at', 'updated_at'
  ]),
  CalendarItems: Object.freeze([
    'item_id', 'type', 'title', 'start_date', 'end_date', 'all_day', 'start_time', 'end_time',
    'description', 'location', 'status', 'created_by', 'created_at', 'updated_by', 'updated_at'
  ]),
  AuditLogs: Object.freeze([
    'audit_id', 'actor_line_user_id', 'actor_role', 'action', 'target_type', 'target_id',
    'result', 'detail', 'created_at'
  ])
});

let CALENDAR_SPREADSHEET_CACHE_ = null;

function setupCalendarSystem() {
  const spreadsheet = ensureCalendarStorage_();
  return {
    spreadsheetId: spreadsheet.getId(),
    spreadsheetUrl: spreadsheet.getUrl(),
    sheets: Object.keys(CALENDAR_SHEET_SCHEMAS_)
  };
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

function getDataSheet_(sheetName) {
  const spreadsheet = ensureCalendarStorage_();
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
  const values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  const expected = String(keyValue || '');

  for (let index = 0; index < values.length; index += 1) {
    const record = rowToRecord_(headers, values[index]);
    if (String(record[keyField] || '') === expected) {
      return { rowNumber: index + 2, record: record };
    }
  }
  return null;
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
