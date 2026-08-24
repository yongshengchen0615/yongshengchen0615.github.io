'use strict';

const POINTS_CARD_ADMIN_GRANTS = Object.freeze({
  grantsSheet: 'CardPointGrants',
  notificationsSheet: 'MemberPointNotifications',
  maxGrantPoints: 100,
  maxUnreadNotifications: 10
});

const POINTS_CARD_ADMIN_GRANT_HEADERS = Object.freeze({
  CardPointGrants: [
    'grantId', 'requestId', 'cardId', 'memberLineUserId', 'memberNo', 'stampCount', 'reason',
    'status', 'totalBefore', 'totalAfter', 'grantedByLineUserId', 'pushStatus', 'pushErrorCode',
    'pushAttemptedAt', 'pushSentAt', 'createdAt', 'updatedAt', 'grantedAt', 'auditRecordedAt'
  ],
  MemberPointNotifications: [
    'notificationId', 'memberLineUserId', 'memberNo', 'cardId', 'cardName', 'type', 'title',
    'message', 'stampCount', 'totalAfter', 'relatedId', 'status', 'createdAt', 'readAt', 'updatedAt'
  ]
});

function ensureAdminPointGrantStorage_() {
  const spreadsheet = getSpreadsheet_();
  Object.keys(POINTS_CARD_ADMIN_GRANT_HEADERS).forEach(function (sheetName) {
    let sheet = spreadsheet.getSheetByName(sheetName);
    const expected = POINTS_CARD_ADMIN_GRANT_HEADERS[sheetName];
    if (!sheet) sheet = spreadsheet.insertSheet(sheetName);
    const lastColumn = sheet.getLastColumn();
    if (lastColumn === 0) {
      sheet.getRange(1, 1, 1, expected.length).setValues([expected]);
      sheet.setFrozenRows(1);
      return;
    }
    if (lastColumn !== expected.length) fail_('SCHEMA_MISMATCH', sheetName + ' 欄位數不正確。');
    const headers = sheet.getRange(1, 1, 1, expected.length).getValues()[0].map(String);
    expected.forEach(function (header, index) {
      if (headers[index] !== header) fail_('SCHEMA_MISMATCH', sheetName + ' 欄位順序不正確。');
    });
    sheet.setFrozenRows(1);
  });
}

function getAdminPointGrantSheet_(sheetName) {
  const headers = POINTS_CARD_ADMIN_GRANT_HEADERS[sheetName];
  if (!headers) fail_('SCHEMA_MISMATCH', '不支援的人工發點資料工作表。');
  const sheet = getSpreadsheet_().getSheetByName(sheetName);
  if (!sheet) fail_('SCHEMA_MISMATCH', '缺少人工發點資料工作表：' + sheetName + '。');
  return sheet;
}

function adminPointGrantRowToObject_(sheetName, row) {
  const object = {};
  POINTS_CARD_ADMIN_GRANT_HEADERS[sheetName].forEach(function (header, index) { object[header] = row[index]; });
  return object;
}

function adminPointGrantObjectToRow_(sheetName, object) {
  return POINTS_CARD_ADMIN_GRANT_HEADERS[sheetName].map(function (header) {
    const value = object[header] === undefined || object[header] === null ? '' : object[header];
    return typeof value === 'string' ? safeCellText_(value) : value;
  });
}

function readAdminPointGrantObjects_(sheetName) {
  const sheet = getAdminPointGrantSheet_(sheetName);
  const headers = POINTS_CARD_ADMIN_GRANT_HEADERS[sheetName];
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet.getRange(2, 1, lastRow - 1, headers.length).getValues().filter(function (row) {
    return row.some(function (value) { return value !== ''; });
  }).map(function (row) { return adminPointGrantRowToObject_(sheetName, row); });
}

function readAdminPointGrantObjectsByField_(sheetName, field, value) {
  const sheet = getAdminPointGrantSheet_(sheetName);
  const headers = POINTS_CARD_ADMIN_GRANT_HEADERS[sheetName];
  const columnIndex = headers.indexOf(field);
  if (columnIndex < 0) fail_('SCHEMA_MISMATCH', '缺少必要欄位。');
  const expected = String(value || '');
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const matches = sheet.getRange(2, columnIndex + 1, lastRow - 1, 1)
    .createTextFinder(expected).matchEntireCell(true).useRegularExpression(false).findAll();
  if (matches.length > 20) {
    return readAdminPointGrantObjects_(sheetName).filter(function (object) {
      return String(object[field] || '') === expected;
    });
  }
  return matches.map(function (match) {
    const row = sheet.getRange(match.getRow(), 1, 1, headers.length).getValues()[0];
    return adminPointGrantRowToObject_(sheetName, row);
  });
}

function findAdminPointGrantByFieldWithRow_(sheetName, field, value) {
  const sheet = getAdminPointGrantSheet_(sheetName);
  const headers = POINTS_CARD_ADMIN_GRANT_HEADERS[sheetName];
  const columnIndex = headers.indexOf(field);
  if (columnIndex < 0) fail_('SCHEMA_MISMATCH', '缺少必要欄位。');
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  const match = sheet.getRange(2, columnIndex + 1, lastRow - 1, 1)
    .createTextFinder(String(value)).matchEntireCell(true).useRegularExpression(false).findNext();
  if (!match) return null;
  const rowNumber = match.getRow();
  const row = sheet.getRange(rowNumber, 1, 1, headers.length).getValues()[0];
  return { row: rowNumber, object: adminPointGrantRowToObject_(sheetName, row) };
}

function appendAdminPointGrantObject_(sheetName, object) {
  getAdminPointGrantSheet_(sheetName).appendRow(adminPointGrantObjectToRow_(sheetName, object));
}

function writeAdminPointGrantObjectRow_(sheetName, rowNumber, object) {
  const sheet = getAdminPointGrantSheet_(sheetName);
  const headers = POINTS_CARD_ADMIN_GRANT_HEADERS[sheetName];
  sheet.getRange(rowNumber, 1, 1, headers.length).setValues([adminPointGrantObjectToRow_(sheetName, object)]);
}

function normalizeAdminPointGrant_(value) {
  return {
    grantId: String(value.grantId || ''),
    requestId: String(value.requestId || ''),
    cardId: String(value.cardId || ''),
    memberLineUserId: String(value.memberLineUserId || ''),
    memberNo: String(value.memberNo || ''),
    stampCount: storedNonNegativeInt_(value.stampCount, POINTS_CARD_ADMIN_GRANTS.maxGrantPoints),
    reason: String(value.reason || ''),
    status: String(value.status || ''),
    totalBefore: storedNonNegativeInt_(value.totalBefore, 100000000),
    totalAfter: storedNonNegativeInt_(value.totalAfter, 100000000),
    grantedByLineUserId: String(value.grantedByLineUserId || ''),
    pushStatus: String(value.pushStatus || 'pending'),
    pushErrorCode: String(value.pushErrorCode || ''),
    pushAttemptedAt: String(value.pushAttemptedAt || ''),
    pushSentAt: String(value.pushSentAt || ''),
    createdAt: String(value.createdAt || ''),
    updatedAt: String(value.updatedAt || ''),
    grantedAt: String(value.grantedAt || ''),
    auditRecordedAt: String(value.auditRecordedAt || '')
  };
}

function normalizeMemberPointNotification_(value) {
  return {
    notificationId: String(value.notificationId || ''),
    memberLineUserId: String(value.memberLineUserId || ''),
    memberNo: String(value.memberNo || ''),
    cardId: String(value.cardId || ''),
    cardName: String(value.cardName || ''),
    type: String(value.type || ''),
    title: String(value.title || ''),
    message: String(value.message || ''),
    stampCount: storedNonNegativeInt_(value.stampCount, POINTS_CARD_ADMIN_GRANTS.maxGrantPoints),
    totalAfter: storedNonNegativeInt_(value.totalAfter, 100000000),
    relatedId: String(value.relatedId || ''),
    status: String(value.status || ''),
    createdAt: String(value.createdAt || ''),
    readAt: String(value.readAt || ''),
    updatedAt: String(value.updatedAt || '')
  };
}
