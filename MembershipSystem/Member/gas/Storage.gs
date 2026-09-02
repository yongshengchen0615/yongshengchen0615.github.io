'use strict';

const MEMBERSHIP_STORAGE_PROPERTY_ = 'MEMBERSHIP_SYSTEM_SPREADSHEET_ID';
const MEMBERSHIP_SHEET_SCHEMAS_ = Object.freeze({
  Members: Object.freeze(['line_user_id', 'display_name', 'member_code', 'tier', 'status', 'joined_at', 'last_login_at', 'created_at', 'updated_at']),
  Admins: Object.freeze(['line_user_id', 'display_name', 'role', 'status', 'first_seen_at', 'updated_at']),
  PointCards: Object.freeze(['card_id', 'title', 'description', 'target_stamps', 'reward_title', 'status', 'accent', 'created_by', 'created_at', 'updated_by', 'updated_at']),
  PointCardRewards: Object.freeze(['reward_id', 'card_id', 'threshold_stamps', 'reward_type', 'reward_title', 'reward_description', 'lottery_win_rate', 'created_at', 'updated_at']),
  PointCardLotteryPrizes: Object.freeze(['prize_id', 'reward_id', 'prize_title', 'prize_description', 'win_rate', 'created_at', 'updated_at']),
  PointCardTickets: Object.freeze(['ticket_id', 'line_user_id', 'card_id', 'reward_id', 'reward_key', 'threshold_stamps', 'ticket_type', 'ticket_title', 'ticket_description', 'lottery_prizes_json', 'status', 'failed_attempts', 'earned_at', 'used_at', 'result_json', 'created_at', 'updated_at']),
  PointCardTicketChallenges: Object.freeze(['challenge_id', 'ticket_id', 'line_user_id', 'options_json', 'status', 'attempt_count', 'expires_at', 'created_at', 'used_at']),
  PointBalances: Object.freeze(['line_user_id', 'card_id', 'stamps', 'updated_at']),
  PointEntries: Object.freeze(['entry_id', 'line_user_id', 'card_id', 'amount', 'note', 'created_by', 'created_at']),
  AuditLogs: Object.freeze(['audit_id', 'actor_line_user_id', 'actor_role', 'action', 'target_type', 'target_id', 'result', 'detail', 'created_at'])
});
let MEMBERSHIP_SPREADSHEET_CACHE_ = null;

function ensureMembershipStorage_() {
  const spreadsheet = resolveMembershipSpreadsheet_();
  Object.keys(MEMBERSHIP_SHEET_SCHEMAS_).forEach(function(sheetName) { ensureSheetSchema_(spreadsheet, sheetName, MEMBERSHIP_SHEET_SCHEMAS_[sheetName]); });
  return spreadsheet;
}

function resolveMembershipSpreadsheet_() {
  if (MEMBERSHIP_SPREADSHEET_CACHE_) return MEMBERSHIP_SPREADSHEET_CACHE_;
  const properties = PropertiesService.getScriptProperties();
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) { MEMBERSHIP_SPREADSHEET_CACHE_ = active; properties.setProperty(MEMBERSHIP_STORAGE_PROPERTY_, active.getId()); return active; }
  const configuredId = String(properties.getProperty(MEMBERSHIP_STORAGE_PROPERTY_) || '').trim();
  if (configuredId) {
    try { MEMBERSHIP_SPREADSHEET_CACHE_ = SpreadsheetApp.openById(configuredId); return MEMBERSHIP_SPREADSHEET_CACHE_; } catch (_) { throw new ApiError(503, 'STORAGE_UNAVAILABLE', '設定的 Membership Spreadsheet 無法開啟。'); }
  }
  try { MEMBERSHIP_SPREADSHEET_CACHE_ = SpreadsheetApp.create('Lumen Club Membership Data'); properties.setProperty(MEMBERSHIP_STORAGE_PROPERTY_, MEMBERSHIP_SPREADSHEET_CACHE_.getId()); return MEMBERSHIP_SPREADSHEET_CACHE_; } catch (_) { throw new ApiError(503, 'STORAGE_UNAVAILABLE', '無法建立 Membership Spreadsheet。'); }
}

function ensureSheetSchema_(spreadsheet, sheetName, headers) {
  let sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) sheet = spreadsheet.insertSheet(sheetName);
  if (sheet.getLastRow() === 0 || sheet.getLastColumn() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]); sheet.setFrozenRows(1); sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold'); return;
  }
  if (sheet.getLastColumn() !== headers.length) throw new ApiError(500, 'SCHEMA_MISMATCH', sheetName + ' 欄位數量與系統 schema 不一致。');
  const actual = sheet.getRange(1, 1, 1, headers.length).getDisplayValues()[0];
  if (!headers.every(function(header, index) { return String(actual[index] || '') === header; })) throw new ApiError(500, 'SCHEMA_MISMATCH', sheetName + ' 欄位與系統 schema 不一致。');
}

function getDataSheet_(sheetName) { const sheet = resolveMembershipSpreadsheet_().getSheetByName(sheetName); if (!sheet) throw new ApiError(500, 'SCHEMA_MISSING', '缺少資料表：' + sheetName); return sheet; }

function readRecords_(sheetName) {
  const sheet = getDataSheet_(sheetName); const headers = MEMBERSHIP_SHEET_SCHEMAS_[sheetName]; const lastRow = sheet.getLastRow(); if (lastRow < 2) return [];
  return sheet.getRange(2, 1, lastRow - 1, headers.length).getValues().map(function(row) { return rowToRecord_(headers, row); });
}

function findRecordWithRow_(sheetName, keyField, keyValue) {
  const sheet = getDataSheet_(sheetName); const headers = MEMBERSHIP_SHEET_SCHEMAS_[sheetName]; const index = headers.indexOf(keyField); if (index < 0) throw new ApiError(500, 'SCHEMA_MISSING', '未知欄位：' + keyField);
  if (sheet.getLastRow() < 2) return null;
  const match = sheet.getRange(2, index + 1, sheet.getLastRow() - 1, 1).createTextFinder(String(keyValue || '')).matchEntireCell(true).matchCase(true).findNext();
  if (!match) return null;
  return { rowNumber: match.getRow(), record: rowToRecord_(headers, sheet.getRange(match.getRow(), 1, 1, headers.length).getValues()[0]) };
}

function appendRecord_(sheetName, record) {
  const sheet = getDataSheet_(sheetName); const headers = MEMBERSHIP_SHEET_SCHEMAS_[sheetName]; const row = Math.max(sheet.getLastRow() + 1, 2); const range = sheet.getRange(row, 1, 1, headers.length); range.setNumberFormat('@'); range.setValues([recordToRow_(headers, record)]); return row;
}

function updateRecordAtRow_(sheetName, rowNumber, record) {
  const sheet = getDataSheet_(sheetName); const headers = MEMBERSHIP_SHEET_SCHEMAS_[sheetName]; if (rowNumber < 2 || rowNumber > sheet.getLastRow()) throw new ApiError(500, 'INVALID_ROW', '資料列位置不合法。'); const range = sheet.getRange(rowNumber, 1, 1, headers.length); range.setNumberFormat('@'); range.setValues([recordToRow_(headers, record)]);
}

function recordToRow_(headers, record) { return headers.map(function(header) { return escapeSheetValue_(record && record[header] !== undefined ? record[header] : ''); }); }
function rowToRecord_(headers, row) { const record = {}; headers.forEach(function(header, index) { record[header] = decodeSheetValue_(row[index]); }); return record; }
function escapeSheetValue_(value) { if (value === null || value === undefined) return ''; const text = String(value); return /^[=+\-@]/.test(text) ? "'" + text : text; }
function decodeSheetValue_(value) { const text = value === null || value === undefined ? '' : String(value); return /^'[=+\-@]/.test(text) ? text.substring(1) : text; }
function withDataLock_(callback) { const lock = LockService.getScriptLock(); try { lock.waitLock(5000); } catch (_) { throw new ApiError(429, 'STORAGE_BUSY', '資料正在更新，請稍後再試。'); } try { return callback(); } finally { lock.releaseLock(); } }
function appendAuditRecord_(record) { appendRecord_('AuditLogs', record); }
function nowIso_() { return new Date().toISOString(); }
