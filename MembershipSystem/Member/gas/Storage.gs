'use strict';

const MEMBERSHIP_STORAGE_PROPERTY_ = 'MEMBERSHIP_SYSTEM_SPREADSHEET_ID';
const MEMBERSHIP_STORAGE_SCHEMA_CACHE_SECONDS_ = 120;
const MEMBERSHIP_SHEET_SCHEMAS_ = Object.freeze({
  Members: Object.freeze(['line_user_id', 'display_name', 'member_code', 'tier', 'status', 'joined_at', 'last_login_at', 'created_at', 'updated_at', 'birthday', 'phone']),
  Admins: Object.freeze(['line_user_id', 'display_name', 'role', 'status', 'first_seen_at', 'updated_at']),
  PointCards: Object.freeze(['card_id', 'title', 'description', 'target_stamps', 'reward_title', 'status', 'accent', 'created_by', 'created_at', 'updated_by', 'updated_at', 'expiry_mode', 'expires_on']),
  PointCardRewards: Object.freeze(['reward_id', 'card_id', 'threshold_stamps', 'reward_type', 'reward_title', 'reward_description', 'lottery_win_rate', 'created_at', 'updated_at', 'consume_stamps', 'ticket_template_id']),
  PointCardLotteryPrizes: Object.freeze(['prize_id', 'reward_id', 'prize_title', 'prize_description', 'win_rate', 'created_at', 'updated_at']),
  PointCardTicketTemplates: Object.freeze(['ticket_template_id', 'title', 'ticket_type', 'description', 'usage_method', 'usage_instructions', 'lottery_prizes_json', 'status', 'created_by', 'created_at', 'updated_by', 'updated_at']),
  PointCardTickets: Object.freeze(['ticket_id', 'line_user_id', 'card_id', 'reward_id', 'reward_key', 'threshold_stamps', 'ticket_type', 'ticket_title', 'ticket_description', 'lottery_prizes_json', 'status', 'failed_attempts', 'earned_at', 'used_at', 'result_json', 'created_at', 'updated_at', 'consume_stamps', 'ticket_template_id', 'usage_method', 'usage_instructions']),
  PointCardTicketChallenges: Object.freeze(['challenge_id', 'ticket_id', 'line_user_id', 'options_json', 'status', 'attempt_count', 'expires_at', 'created_at', 'used_at']),
  EventTickets: Object.freeze(['event_ticket_id', 'title', 'ticket_type', 'description', 'usage_method', 'usage_instructions', 'lottery_prizes_json', 'status', 'starts_on', 'ends_on', 'quota', 'accent', 'created_by', 'created_at', 'updated_by', 'updated_at']),
  EventTicketClaims: Object.freeze(['claim_id', 'event_ticket_id', 'line_user_id', 'ticket_type', 'ticket_title', 'ticket_description', 'usage_method', 'usage_instructions', 'lottery_prizes_json', 'status', 'claimed_at', 'used_at', 'result_json', 'created_at', 'updated_at']),
  PointBalances: Object.freeze(['line_user_id', 'card_id', 'stamps', 'updated_at']),
  PointEntries: Object.freeze(['entry_id', 'line_user_id', 'card_id', 'amount', 'note', 'created_by', 'created_at', 'request_id']),
  ServiceTimeEntries: Object.freeze(['entry_id', 'line_user_id', 'minutes', 'note', 'created_by', 'created_at', 'request_id']),
  MembershipTierSettings: Object.freeze(['tier_key', 'tier_label', 'required_service_minutes', 'updated_by', 'updated_at']),
  AuditLogs: Object.freeze(['audit_id', 'actor_line_user_id', 'actor_role', 'action', 'target_type', 'target_id', 'result', 'detail', 'created_at'])
});
let MEMBERSHIP_SPREADSHEET_CACHE_ = null;

function ensureMembershipStorage_() {
  const spreadsheet = resolveMembershipSpreadsheet_();
  const schemaCache = membershipSchemaCache_();
  const schemaCacheKey = membershipSchemaCacheKey_(spreadsheet.getId());
  if (schemaCache && schemaCache.get(schemaCacheKey) === 'ready') return spreadsheet;

  Object.keys(MEMBERSHIP_SHEET_SCHEMAS_).forEach(function(sheetName) {
    ensureSheetSchema_(spreadsheet, sheetName, MEMBERSHIP_SHEET_SCHEMAS_[sheetName]);
  });
  ensureMembershipTierSettings_();
  if (schemaCache) {
    try { schemaCache.put(schemaCacheKey, 'ready', MEMBERSHIP_STORAGE_SCHEMA_CACHE_SECONDS_); } catch (_) {}
  }
  return spreadsheet;
}

function membershipSchemaCache_() {
  try { return CacheService.getScriptCache(); } catch (_) { return null; }
}

function membershipSchemaCacheKey_(spreadsheetId) {
  const signature = Object.keys(MEMBERSHIP_SHEET_SCHEMAS_).map(function(sheetName) {
    return sheetName + ':' + MEMBERSHIP_SHEET_SCHEMAS_[sheetName].join(',');
  }).join('|');
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, signature, Utilities.Charset.UTF_8).map(function(byte) {
    const normalized = byte < 0 ? byte + 256 : byte;
    return ('0' + normalized.toString(16)).slice(-2);
  }).join('').substring(0, 16);
  return 'membership:schema:' + String(spreadsheetId || '') + ':' + digest;
}

function resolveMembershipSpreadsheet_() {
  if (MEMBERSHIP_SPREADSHEET_CACHE_) return MEMBERSHIP_SPREADSHEET_CACHE_;
  const properties = PropertiesService.getScriptProperties();
  const configuredId = String(properties.getProperty(MEMBERSHIP_STORAGE_PROPERTY_) || '').trim();
  if (configuredId) {
    try { MEMBERSHIP_SPREADSHEET_CACHE_ = SpreadsheetApp.openById(configuredId); return MEMBERSHIP_SPREADSHEET_CACHE_; } catch (_) { throw new ApiError(503, 'STORAGE_UNAVAILABLE', '設定的 Membership Spreadsheet 無法開啟。'); }
  }
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) { MEMBERSHIP_SPREADSHEET_CACHE_ = active; properties.setProperty(MEMBERSHIP_STORAGE_PROPERTY_, active.getId()); return active; }
  try { MEMBERSHIP_SPREADSHEET_CACHE_ = SpreadsheetApp.create('Lumen Club Membership Data'); properties.setProperty(MEMBERSHIP_STORAGE_PROPERTY_, MEMBERSHIP_SPREADSHEET_CACHE_.getId()); return MEMBERSHIP_SPREADSHEET_CACHE_; } catch (_) { throw new ApiError(503, 'STORAGE_UNAVAILABLE', '無法建立 Membership Spreadsheet。'); }
}

function ensureSheetSchema_(spreadsheet, sheetName, headers) {
  let sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) sheet = spreadsheet.insertSheet(sheetName);
  if (sheet.getLastRow() === 0 || sheet.getLastColumn() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]); sheet.setFrozenRows(1); sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold'); return;
  }
  const lastColumn = sheet.getLastColumn();
  if (lastColumn > headers.length) throw new ApiError(500, 'SCHEMA_MISMATCH', sheetName + ' 欄位數量與系統 schema 不一致。');
  const actual = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0];
  if (lastColumn < headers.length) {
    if (!headers.slice(0, lastColumn).every(function(header, index) { return String(actual[index] || '') === header; })) throw new ApiError(500, 'SCHEMA_MISMATCH', sheetName + ' 欄位與系統 schema 不一致。');
    const addedHeaders = headers.slice(lastColumn);
    sheet.getRange(1, lastColumn + 1, 1, addedHeaders.length).setValues([addedHeaders]);
    sheet.getRange(1, lastColumn + 1, 1, addedHeaders.length).setNumberFormat('@');
  }
  const finalActual = sheet.getRange(1, 1, 1, headers.length).getDisplayValues()[0];
  if (!headers.every(function(header, index) { return String(finalActual[index] || '') === header; })) throw new ApiError(500, 'SCHEMA_MISMATCH', sheetName + ' 欄位與系統 schema 不一致。');
}

function getDataSheet_(sheetName) { const sheet = resolveMembershipSpreadsheet_().getSheetByName(sheetName); if (!sheet) throw new ApiError(500, 'SCHEMA_MISSING', '缺少資料表：' + sheetName); return sheet; }

function readRecords_(sheetName) {
  const sheet = getDataSheet_(sheetName); const headers = MEMBERSHIP_SHEET_SCHEMAS_[sheetName]; const lastRow = sheet.getLastRow(); if (lastRow < 2) return [];
  return sheet.getRange(2, 1, lastRow - 1, headers.length).getValues().map(function(row) { return rowToRecord_(headers, row); });
}

function readRecordFields_(sheetName, fieldNames) {
  const fields = Array.isArray(fieldNames) ? fieldNames.map(function(field) { return String(field || ''); }) : [];
  if (!fields.length) return [];
  const sheet = getDataSheet_(sheetName);
  const headers = MEMBERSHIP_SHEET_SCHEMAS_[sheetName];
  const indexes = fields.map(function(field) {
    const index = headers.indexOf(field);
    if (index < 0) throw new ApiError(500, 'SCHEMA_MISSING', '未知欄位：' + field);
    return index;
  });
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const firstIndex = Math.min.apply(null, indexes);
  const lastIndex = Math.max.apply(null, indexes);
  const values = sheet.getRange(2, firstIndex + 1, lastRow - 1, lastIndex - firstIndex + 1).getValues();
  return values.map(function(row) {
    const record = {};
    fields.forEach(function(field, fieldIndex) { record[field] = decodeSheetValue_(row[indexes[fieldIndex] - firstIndex]); });
    return record;
  });
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

function deleteRecordsWhere_(sheetName, predicate) {
  const sheet = getDataSheet_(sheetName); const headers = MEMBERSHIP_SHEET_SCHEMAS_[sheetName]; const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  const rows = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  const rowNumbers = [];
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    if (predicate(rowToRecord_(headers, rows[index]))) rowNumbers.push(index + 2);
  }
  for (let index = 0; index < rowNumbers.length;) {
    const end = rowNumbers[index]; let start = end; index += 1;
    while (index < rowNumbers.length && rowNumbers[index] === start - 1) { start = rowNumbers[index]; index += 1; }
    sheet.deleteRows(start, end - start + 1);
  }
  return rowNumbers.length;
}

function recordToRow_(headers, record) { return headers.map(function(header) { return escapeSheetValue_(record && record[header] !== undefined ? record[header] : ''); }); }
function rowToRecord_(headers, row) { const record = {}; headers.forEach(function(header, index) { record[header] = decodeSheetValue_(row[index]); }); return record; }
function escapeSheetValue_(value) { if (value === null || value === undefined) return ''; const text = String(value); return /^[=+\-@]/.test(text) ? "'" + text : text; }
function decodeSheetValue_(value) { const text = value === null || value === undefined ? '' : String(value); return /^'[=+\-@]/.test(text) ? text.substring(1) : text; }
function withDataLock_(callback) { const lock = LockService.getScriptLock(); try { lock.waitLock(5000); } catch (_) { throw new ApiError(429, 'STORAGE_BUSY', '資料正在更新，請稍後再試。'); } try { return callback(); } finally { lock.releaseLock(); } }
function appendAuditRecord_(record) { appendRecord_('AuditLogs', record); }
function nowIso_() { return new Date().toISOString(); }
