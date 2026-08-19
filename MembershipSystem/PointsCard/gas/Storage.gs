'use strict';

function initializePointsCardStorage() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) fail_('BUSY', '資料初始化進行中，請稍後再試。');
  try {
    const properties = PropertiesService.getScriptProperties();
    let spreadsheetId = properties.getProperty(POINTS_CARD_SERVICE.spreadsheetProperty) || '';
    let spreadsheet;
    let created = false;
    if (spreadsheetId) {
      try { spreadsheet = SpreadsheetApp.openById(spreadsheetId); }
      catch (_) { fail_('CONFIGURATION_ERROR', '設定的試算表無法存取。'); }
    } else {
      spreadsheet = SpreadsheetApp.create('PointsCard Data');
      spreadsheetId = spreadsheet.getId();
      properties.setProperty(POINTS_CARD_SERVICE.spreadsheetProperty, spreadsheetId);
      created = true;
    }

    Object.keys(POINTS_CARD_HEADERS).forEach(function (sheetName) {
      ensureSheetSchema_(spreadsheet, sheetName, POINTS_CARD_HEADERS[sheetName]);
    });
    if (!properties.getProperty(POINTS_CARD_SERVICE.stampsPerRewardProperty)) {
      properties.setProperty(POINTS_CARD_SERVICE.stampsPerRewardProperty, '10');
    }
    if (!properties.getProperty(POINTS_CARD_SERVICE.rewardNameProperty)) {
      properties.setProperty(POINTS_CARD_SERVICE.rewardNameProperty, '招牌飲品一份');
    }

    if (created) {
      const defaultSheet = spreadsheet.getSheetByName('工作表1') || spreadsheet.getSheetByName('Sheet1');
      if (defaultSheet && defaultSheet.getLastRow() === 0 && spreadsheet.getSheets().length > 1) {
        spreadsheet.deleteSheet(defaultSheet);
      }
    }
    resetRequestCaches_();
    return {
      spreadsheetId: spreadsheetId,
      sheets: Object.keys(POINTS_CARD_HEADERS),
      settings: pointsCardSettings_()
    };
  } finally { lock.releaseLock(); }
}

function setPointsCardAdmin(lineUserId, enabled) {
  const targetLineUserId = cleanText_(lineUserId, 80, true);
  const sheet = getSheet_(POINTS_CARD_SHEETS.members);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) fail_('BUSY', '系統忙碌中，請稍後再試。');
  try {
    const match = findByFieldWithRow_(sheet, 'lineUserId', targetLineUserId);
    if (!match) fail_('MEMBER_NOT_FOUND', '請先使用該 LINE 帳號開啟會員端，建立會員資料。');
    const member = normalizeMember_(match.object);
    member.canManagePoints = Boolean(enabled);
    member.updatedAt = new Date().toISOString();
    if (!audit_('script-editor', 'system', enabled ? 'ADMIN_GRANT_REQUESTED' : 'ADMIN_REVOKE_REQUESTED', targetLineUserId, 'pending', {
      memberNo: member.memberNo
    })) fail_('AUDIT_UNAVAILABLE', '稽核紀錄暫時無法寫入，管理權限未變更。');
    writeObjectRow_(sheet, match.row, member);
    audit_('script-editor', 'system', enabled ? 'ADMIN_GRANTED' : 'ADMIN_REVOKED', targetLineUserId, 'success', {
      memberNo: member.memberNo
    });
    return { memberNo: member.memberNo, canManagePoints: member.canManagePoints };
  } finally { lock.releaseLock(); }
}

function configurePointsCard(lineLoginChannelId, rewardName, stampsPerReward) {
  const channelId = cleanText_(lineLoginChannelId, 40, true);
  if (!/^\d{6,20}$/.test(channelId)) fail_('INVALID_INPUT', 'LINE Login Channel ID 格式不正確。');
  const safeRewardName = cleanText_(rewardName, 80, true);
  const target = strictInt_(stampsPerReward, 2, 20, 'INVALID_INPUT', '每張集點卡必須設定為 2 到 20 點。');
  const properties = PropertiesService.getScriptProperties();
  properties.setProperty(POINTS_CARD_SERVICE.lineChannelProperty, channelId);
  properties.setProperty(POINTS_CARD_SERVICE.rewardNameProperty, safeRewardName);
  properties.setProperty(POINTS_CARD_SERVICE.stampsPerRewardProperty, String(target));
  return pointsCardSettings_();
}

function resetRequestCaches_() {
  requestSpreadsheet_ = null;
  requestSheets_ = {};
}

function getSpreadsheet_() {
  if (requestSpreadsheet_) return requestSpreadsheet_;
  const spreadsheetId = PropertiesService.getScriptProperties().getProperty(POINTS_CARD_SERVICE.spreadsheetProperty) || '';
  if (!spreadsheetId) fail_('CONFIGURATION_ERROR', '集點卡資料尚未初始化。');
  try { requestSpreadsheet_ = SpreadsheetApp.openById(spreadsheetId); }
  catch (_) { fail_('CONFIGURATION_ERROR', '集點卡試算表無法存取。'); }
  return requestSpreadsheet_;
}

function getSheet_(sheetName) {
  if (requestSheets_[sheetName]) return requestSheets_[sheetName];
  const sheet = getSpreadsheet_().getSheetByName(sheetName);
  if (!sheet) fail_('SCHEMA_MISMATCH', '缺少必要的資料工作表。');
  const expected = POINTS_CARD_HEADERS[sheetName];
  if (!expected) fail_('SCHEMA_MISMATCH', '不支援的資料工作表。');
  validateSheetSchema_(sheet, expected);
  requestSheets_[sheetName] = sheet;
  return sheet;
}

function ensureSheetSchema_(spreadsheet, sheetName, expectedHeaders) {
  let sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) sheet = spreadsheet.insertSheet(sheetName);
  const lastColumn = sheet.getLastColumn();
  if (lastColumn === 0) {
    sheet.getRange(1, 1, 1, expectedHeaders.length).setValues([expectedHeaders]);
    sheet.setFrozenRows(1);
    return sheet;
  }
  const currentHeaders = sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(String);
  if (currentHeaders.length > expectedHeaders.length) fail_('SCHEMA_MISMATCH', sheetName + ' 欄位比目前程式版本更新。');
  for (let index = 0; index < currentHeaders.length; index += 1) {
    if (currentHeaders[index] !== expectedHeaders[index]) fail_('SCHEMA_MISMATCH', sheetName + ' 欄位順序不正確。');
  }
  if (currentHeaders.length < expectedHeaders.length) {
    const missing = expectedHeaders.slice(currentHeaders.length);
    sheet.getRange(1, currentHeaders.length + 1, 1, missing.length).setValues([missing]);
  }
  sheet.setFrozenRows(1);
  return sheet;
}

function validateSheetSchema_(sheet, expectedHeaders) {
  if (sheet.getLastColumn() !== expectedHeaders.length) fail_('SCHEMA_MISMATCH', sheet.getName() + ' 欄位數不正確。');
  const headers = sheet.getRange(1, 1, 1, expectedHeaders.length).getValues()[0].map(String);
  for (let index = 0; index < expectedHeaders.length; index += 1) {
    if (headers[index] !== expectedHeaders[index]) fail_('SCHEMA_MISMATCH', sheet.getName() + ' 欄位順序不正確。');
  }
}

function readObjects_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const headers = POINTS_CARD_HEADERS[sheet.getName()];
  const values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  return values.filter(function (row) {
    return row.some(function (value) { return value !== ''; });
  }).map(function (row) { return rowToObject_(headers, row); });
}

function findByFieldWithRow_(sheet, field, value) {
  const headers = POINTS_CARD_HEADERS[sheet.getName()];
  const columnIndex = headers.indexOf(field);
  if (columnIndex < 0) fail_('SCHEMA_MISMATCH', '缺少必要欄位。');
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  const match = sheet.getRange(2, columnIndex + 1, lastRow - 1, 1)
    .createTextFinder(String(value)).matchEntireCell(true).useRegularExpression(false).findNext();
  if (!match) return null;
  const rowNumber = match.getRow();
  const row = sheet.getRange(rowNumber, 1, 1, headers.length).getValues()[0];
  return { row: rowNumber, object: rowToObject_(headers, row) };
}

function rowToObject_(headers, row) {
  const object = {};
  headers.forEach(function (header, index) { object[header] = row[index]; });
  return object;
}

function objectToRow_(headers, object) {
  return headers.map(function (header) {
    const value = object[header] === undefined || object[header] === null ? '' : object[header];
    return typeof value === 'string' ? safeCellText_(value) : value;
  });
}

function appendObject_(sheet, object) {
  const headers = POINTS_CARD_HEADERS[sheet.getName()];
  sheet.appendRow(objectToRow_(headers, object));
}

function writeObjectRow_(sheet, rowNumber, object) {
  const headers = POINTS_CARD_HEADERS[sheet.getName()];
  sheet.getRange(rowNumber, 1, 1, headers.length).setValues([objectToRow_(headers, object)]);
}

function safeCellText_(value) {
  const text = String(value == null ? '' : value);
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function nextMemberNo_(sheet) {
  const datePart = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyMMdd');
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const memberNo = 'PC-' + datePart + '-' + randomHex_(3).toUpperCase();
    if (!findByFieldWithRow_(sheet, 'memberNo', memberNo)) return memberNo;
  }
  fail_('INTERNAL_ERROR', '無法產生會員編號。');
}

function audit_(actorLineUserId, actorRole, action, targetLineUserId, result, details) {
  try {
    appendObject_(getSheet_(POINTS_CARD_SHEETS.audit), {
      timestamp: new Date().toISOString(),
      actorLineUserId: cleanText_(actorLineUserId, 100, false),
      actorRole: cleanText_(actorRole, 30, false),
      action: cleanText_(action, 80, false),
      targetLineUserId: cleanText_(targetLineUserId, 100, false),
      result: cleanText_(result, 30, false),
      details: JSON.stringify(details || {}).slice(0, 2000)
    });
    return true;
  } catch (_) {
    console.error('PointsCard audit write failed action=%s', String(action || '').slice(0, 80));
    return false;
  }
}
