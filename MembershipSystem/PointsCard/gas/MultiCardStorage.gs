'use strict';

const MULTI_CARD = Object.freeze({
  migrationProperty: 'POINTS_CARD_MULTI_CARD_MIGRATED_AT',
  migrationSpreadsheetProperty: 'POINTS_CARD_MULTI_CARD_SPREADSHEET_ID',
  migrationTargetSpreadsheetProperty: 'POINTS_CARD_MULTI_CARD_MIGRATION_TARGET_ID',
  schemaVersionProperty: 'POINTS_CARD_MULTI_CARD_SCHEMA_VERSION',
  schemaVersion: '3',
  legacyCardId: 'CARD-LEGACY',
  maxCardStamps: 10000,
  maxCards: 100,
  maxNameLength: 80,
  maxDescriptionLength: 500
});

const MULTI_CARD_SHEETS = Object.freeze({
  cards: 'Cards',
  progress: 'MemberCardProgress',
  vouchers: 'CardStampVouchers',
  stampRecords: 'CardStampRecords',
  rewardRecords: 'CardRewardRecords',
  notifications: 'CardRewardNotifications'
});

const MULTI_CARD_HEADERS = Object.freeze({
  Cards: [
    'cardId', 'name', 'description', 'status', 'expiresAt', 'rewardNodesJson',
    'rewardNodesUpdatedAt', 'createdByLineUserId', 'createdAt', 'updatedAt'
  ],
  MemberCardProgress: [
    'progressId', 'cardId', 'memberLineUserId', 'memberNo', 'totalStamps',
    'redeemedRewards', 'createdAt', 'updatedAt'
  ],
  CardStampVouchers: [
    'voucherId', 'cardId', 'shareCode', 'stampCount', 'scanMode', 'status', 'expiresAt', 'note',
    'createdByLineUserId', 'createdAt', 'updatedAt', 'cancelledByLineUserId', 'cancelledAt'
  ],
  CardStampRecords: [
    'recordId', 'requestId', 'cardId', 'voucherId', 'memberLineUserId', 'memberNo', 'stampCount',
    'note', 'status', 'totalBefore', 'totalAfter', 'createdAt', 'updatedAt', 'recordedAt',
    'auditRecordedAt'
  ],
  CardRewardRecords: [
    'rewardRecordId', 'requestId', 'cardId', 'memberLineUserId', 'memberNo', 'rewardName',
    'rewardOrdinal', 'redeemedBefore', 'redeemedAfter', 'status', 'redeemedByLineUserId',
    'note', 'createdAt', 'updatedAt', 'redeemedAt', 'auditRecordedAt', 'rewardType',
    'rewardNodeId', 'cycleNumber', 'lotteryResult', 'confirmationId'
  ],
  CardRewardNotifications: [
    'notificationId', 'cardId', 'memberLineUserId', 'memberNo', 'rewardOrdinal',
    'reminderAt', 'retryKey', 'status', 'attemptCount', 'sentAt', 'lastAttemptAt',
    'lastErrorCode', 'createdAt', 'updatedAt'
  ]
});

let requestMultiCardSheets_ = {};
let requestMultiCardObjects_ = {};
let requestMultiCardLookupObjects_ = {};

function ensureMultiCardStorage_() {
  const properties = PropertiesService.getScriptProperties();
  const configuredSpreadsheetId = String(properties.getProperty(POINTS_CARD_SERVICE.spreadsheetProperty) || '').trim();
  if (multiCardMigrationMatchesSpreadsheet_(properties, configuredSpreadsheetId)) return;

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) fail_('BUSY', '多集點卡資料升級進行中，請稍後再試。');
  try {
    const lockedSpreadsheetId = String(properties.getProperty(POINTS_CARD_SERVICE.spreadsheetProperty) || '').trim();
    if (multiCardMigrationMatchesSpreadsheet_(properties, lockedSpreadsheetId)) return;

    const spreadsheet = getSpreadsheet_();
    ensurePointsCardBaseStorage_(spreadsheet, properties);
    ensureMultiCardStorageForSpreadsheet_(spreadsheet, properties);
  } finally {
    lock.releaseLock();
  }
}

function ensureMultiCardStorageForSpreadsheet_(spreadsheet, properties) {
  const actualSpreadsheetId = String(spreadsheet.getId() || '').trim();
  if (!actualSpreadsheetId) fail_('CONFIGURATION_ERROR', '目前試算表缺少可用的識別碼。');
  properties.setProperty(POINTS_CARD_SERVICE.spreadsheetProperty, actualSpreadsheetId);

  const migrationAt = String(properties.getProperty(MULTI_CARD.migrationProperty) || '');
  const migrationTargetSpreadsheetId = String(properties.getProperty(MULTI_CARD.migrationTargetSpreadsheetProperty) || '');
  const sheetNames = Object.keys(MULTI_CARD_HEADERS);
  const presentSheetNames = sheetNames.filter(function (sheetName) {
    return Boolean(spreadsheet.getSheetByName(sheetName));
  });
  const missingSheetNames = sheetNames.filter(function (sheetName) {
    return presentSheetNames.indexOf(sheetName) < 0;
  });
  const additiveSheetNames = [MULTI_CARD_SHEETS.notifications];
  const missingCriticalSheetNames = missingSheetNames.filter(function (sheetName) {
    return additiveSheetNames.indexOf(sheetName) < 0;
  });

  const migrationRetry = Boolean(actualSpreadsheetId && migrationTargetSpreadsheetId === actualSpreadsheetId);
  if (migrationAt && !migrationRetry && presentSheetNames.length > 0 && missingCriticalSheetNames.length > 0) {
    fail_(
      'SCHEMA_MISMATCH',
      '多集點卡資料工作表不完整，缺少：' + missingCriticalSheetNames.join('、') + '。為避免覆蓋既有資料，請先從備份還原。'
    );
  }

  const shouldMigrate = !migrationAt || presentSheetNames.length === 0 || migrationRetry;
  if (shouldMigrate) properties.setProperty(MULTI_CARD.migrationTargetSpreadsheetProperty, actualSpreadsheetId);

  sheetNames.forEach(function (sheetName) {
    ensureMultiCardSheetSchema_(spreadsheet, sheetName, MULTI_CARD_HEADERS[sheetName]);
  });

  if (shouldMigrate) migrateLegacyPointsCard_();
  properties.setProperty(MULTI_CARD.migrationProperty, new Date().toISOString());
  properties.setProperty(MULTI_CARD.migrationSpreadsheetProperty, actualSpreadsheetId);
  properties.setProperty(MULTI_CARD.schemaVersionProperty, MULTI_CARD.schemaVersion);
  properties.deleteProperty(MULTI_CARD.migrationTargetSpreadsheetProperty);
}

function multiCardMigrationMatchesSpreadsheet_(properties, spreadsheetId) {
  if (!spreadsheetId || !properties.getProperty(MULTI_CARD.migrationProperty)) return false;
  return String(properties.getProperty(MULTI_CARD.migrationSpreadsheetProperty) || '') === spreadsheetId &&
    String(properties.getProperty(MULTI_CARD.schemaVersionProperty) || '') === MULTI_CARD.schemaVersion;
}

function ensureMultiCardSheetSchema_(spreadsheet, sheetName, expectedHeaders) {
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
  currentHeaders.forEach(function (header, index) {
    if (header !== expectedHeaders[index]) fail_('SCHEMA_MISMATCH', sheetName + ' 欄位順序不正確。');
  });
  if (currentHeaders.length < expectedHeaders.length) {
    const missing = expectedHeaders.slice(currentHeaders.length);
    sheet.getRange(1, currentHeaders.length + 1, 1, missing.length).setValues([missing]);
  }
  sheet.setFrozenRows(1);
  return sheet;
}

function getMultiCardSheet_(sheetName) {
  if (requestMultiCardSheets_[sheetName]) return requestMultiCardSheets_[sheetName];
  const expected = MULTI_CARD_HEADERS[sheetName];
  if (!expected) fail_('SCHEMA_MISMATCH', '不支援的多集點卡資料工作表。');
  const sheet = getSpreadsheet_().getSheetByName(sheetName);
  if (!sheet) fail_('SCHEMA_MISMATCH', '缺少多集點卡資料工作表：' + sheetName + '。請先確認資料表切換或備份還原狀態。');
  if (sheet.getLastColumn() !== expected.length) fail_('SCHEMA_MISMATCH', sheetName + ' 欄位數不正確。');
  const headers = sheet.getRange(1, 1, 1, expected.length).getValues()[0].map(String);
  expected.forEach(function (header, index) {
    if (headers[index] !== header) fail_('SCHEMA_MISMATCH', sheetName + ' 欄位順序不正確。');
  });
  requestMultiCardSheets_[sheetName] = sheet;
  return sheet;
}

function invalidateMultiCardSheet_(sheet) {
  if (!sheet || typeof sheet.getName !== 'function') return;
  const sheetName = sheet.getName();
  delete requestMultiCardObjects_[sheetName];
  Object.keys(requestMultiCardLookupObjects_).forEach(function (key) {
    if (key.indexOf(sheetName + '\n') === 0) delete requestMultiCardLookupObjects_[key];
  });
}

function multiCardRowToObject_(headers, row) {
  const object = {};
  headers.forEach(function (header, index) { object[header] = row[index]; });
  return object;
}

function readMultiCardObjects_(sheet) {
  const sheetName = sheet.getName();
  if (Object.prototype.hasOwnProperty.call(requestMultiCardObjects_, sheetName)) return requestMultiCardObjects_[sheetName];
  const headers = MULTI_CARD_HEADERS[sheetName];
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    requestMultiCardObjects_[sheetName] = [];
    return requestMultiCardObjects_[sheetName];
  }
  const rows = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  requestMultiCardObjects_[sheetName] = rows.filter(function (row) {
    return row.some(function (value) { return value !== ''; });
  }).map(function (row) { return multiCardRowToObject_(headers, row); });
  return requestMultiCardObjects_[sheetName];
}

function readMultiCardObjectsByField_(sheet, field, value) {
  const sheetName = sheet.getName();
  const headers = MULTI_CARD_HEADERS[sheetName];
  const columnIndex = headers.indexOf(field);
  if (columnIndex < 0) fail_('SCHEMA_MISMATCH', '缺少必要欄位。');
  const expected = String(value || '');
  if (Object.prototype.hasOwnProperty.call(requestMultiCardObjects_, sheetName)) {
    return requestMultiCardObjects_[sheetName].filter(function (object) {
      return String(object[field] || '') === expected;
    });
  }

  const cacheKey = sheetName + '\n' + field + '\n' + expected;
  if (Object.prototype.hasOwnProperty.call(requestMultiCardLookupObjects_, cacheKey)) {
    return requestMultiCardLookupObjects_[cacheKey];
  }
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    requestMultiCardLookupObjects_[cacheKey] = [];
    return requestMultiCardLookupObjects_[cacheKey];
  }

  const searchRange = sheet.getRange(2, columnIndex + 1, lastRow - 1, 1);
  if (!searchRange || typeof searchRange.createTextFinder !== 'function') {
    return readMultiCardObjects_(sheet).filter(function (object) {
      return String(object[field] || '') === expected;
    });
  }
  const matches = searchRange.createTextFinder(expected)
    .matchEntireCell(true).useRegularExpression(false).findAll();
  if (matches.length > 20) {
    return readMultiCardObjects_(sheet).filter(function (object) {
      return String(object[field] || '') === expected;
    });
  }
  const rowNumbers = matches.map(function (match) { return match.getRow(); })
    .filter(function (rowNumber, index, values) { return values.indexOf(rowNumber) === index; });
  requestMultiCardLookupObjects_[cacheKey] = rowNumbers.map(function (rowNumber) {
    const row = sheet.getRange(rowNumber, 1, 1, headers.length).getValues()[0];
    return multiCardRowToObject_(headers, row);
  });
  return requestMultiCardLookupObjects_[cacheKey];
}

function multiCardObjectToRow_(sheetName, object) {
  return MULTI_CARD_HEADERS[sheetName].map(function (header) {
    const value = object[header] === undefined || object[header] === null ? '' : object[header];
    return typeof value === 'string' ? safeCellText_(value) : value;
  });
}

function appendMultiCardObject_(sheet, object) {
  sheet.appendRow(multiCardObjectToRow_(sheet.getName(), object));
  invalidateMultiCardSheet_(sheet);
}

function writeMultiCardObjectRow_(sheet, rowNumber, object) {
  sheet.getRange(rowNumber, 1, 1, MULTI_CARD_HEADERS[sheet.getName()].length)
    .setValues([multiCardObjectToRow_(sheet.getName(), object)]);
  invalidateMultiCardSheet_(sheet);
}

function deleteMultiCardObjectRow_(sheet, rowNumber) {
  sheet.deleteRow(rowNumber);
  invalidateMultiCardSheet_(sheet);
}

function findMultiCardByFieldWithRow_(sheet, field, value) {
  const headers = MULTI_CARD_HEADERS[sheet.getName()];
  const columnIndex = headers.indexOf(field);
  if (columnIndex < 0) fail_('SCHEMA_MISMATCH', '缺少必要欄位。');
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  const match = sheet.getRange(2, columnIndex + 1, lastRow - 1, 1)
    .createTextFinder(String(value)).matchEntireCell(true).useRegularExpression(false).findNext();
  if (!match) return null;
  const rowNumber = match.getRow();
  const row = sheet.getRange(rowNumber, 1, 1, headers.length).getValues()[0];
  const object = {};
  headers.forEach(function (header, index) { object[header] = row[index]; });
  return { row: rowNumber, object: object };
}

function deleteMultiCardRowsWhere_(sheet, predicate) {
  const headers = MULTI_CARD_HEADERS[sheet.getName()];
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  const rows = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  const deleteRows = [];
  rows.forEach(function (row, index) {
    const object = {};
    headers.forEach(function (header, columnIndex) { object[header] = row[columnIndex]; });
    if (predicate(object)) deleteRows.push(index + 2);
  });
  deleteRows.sort(function (a, b) { return b - a; }).forEach(function (rowNumber) { sheet.deleteRow(rowNumber); });
  if (deleteRows.length) invalidateMultiCardSheet_(sheet);
  return deleteRows.length;
}

function clearLegacySheetDataRows_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) sheet.deleteRows(2, lastRow - 1);
  invalidateSheetObjects_(sheet);
}

function appendMultiCardIfMissing_(sheet, field, value, object) {
  if (!findMultiCardByFieldWithRow_(sheet, field, value)) appendMultiCardObject_(sheet, object);
}

function migrateLegacyPointsCard_() {
  const lifecycle = readPointsCardLifecycle_();
  const cardsSheet = getMultiCardSheet_(MULTI_CARD_SHEETS.cards);
  const legacyCardMatch = findMultiCardByFieldWithRow_(cardsSheet, 'cardId', MULTI_CARD.legacyCardId);
  const now = new Date().toISOString();

  if (lifecycle.storedStatus === 'deleted') {
    deleteMultiCardRowsWhere_(getMultiCardSheet_(MULTI_CARD_SHEETS.stampRecords), function (row) { return String(row.cardId || '') === MULTI_CARD.legacyCardId; });
    deleteMultiCardRowsWhere_(getMultiCardSheet_(MULTI_CARD_SHEETS.rewardRecords), function (row) { return String(row.cardId || '') === MULTI_CARD.legacyCardId; });
    deleteMultiCardRowsWhere_(getMultiCardSheet_(MULTI_CARD_SHEETS.vouchers), function (row) { return String(row.cardId || '') === MULTI_CARD.legacyCardId; });
    deleteMultiCardRowsWhere_(getMultiCardSheet_(MULTI_CARD_SHEETS.progress), function (row) { return String(row.cardId || '') === MULTI_CARD.legacyCardId; });
    if (legacyCardMatch) deleteMultiCardObjectRow_(cardsSheet, legacyCardMatch.row);
  } else {
    if (!legacyCardMatch) {
      const settings = pointsCardSettings_();
      appendMultiCardObject_(cardsSheet, {
        cardId: MULTI_CARD.legacyCardId,
        name: '原集點卡',
        description: '由舊版單一卡模式自動移轉。',
        status: 'active',
        expiresAt: lifecycle.expiresAt || '',
        rewardNodesJson: JSON.stringify(settings.rewardNodes),
        rewardNodesUpdatedAt: settings.rewardNodesUpdatedAt || now,
        createdByLineUserId: 'migration',
        createdAt: now,
        updatedAt: now
      });
    }
    migrateLegacyProgress_(now);
    migrateLegacyVouchers_();
    migrateLegacyStampRecords_();
    migrateLegacyRewardRecords_();
  }

  clearLegacyTransactionalData_();
  clearLegacyMemberCounters_();
  audit_('migration', 'system', 'MULTI_CARD_MIGRATION_COMPLETED', '', 'success', {
    migratedLegacyCard: lifecycle.storedStatus !== 'deleted'
  });
}

function migrateLegacyProgress_(now) {
  const progressSheet = getMultiCardSheet_(MULTI_CARD_SHEETS.progress);
  readObjects_(getSheet_(POINTS_CARD_SHEETS.members)).map(normalizeMember_).forEach(function (member) {
    if (member.totalStamps < 1 && member.redeemedRewards < 1) return;
    const progressId = multiCardProgressId_(MULTI_CARD.legacyCardId, member.lineUserId);
    appendMultiCardIfMissing_(progressSheet, 'progressId', progressId, {
      progressId: progressId,
      cardId: MULTI_CARD.legacyCardId,
      memberLineUserId: member.lineUserId,
      memberNo: member.memberNo,
      totalStamps: member.totalStamps,
      redeemedRewards: member.redeemedRewards,
      createdAt: member.createdAt || member.joinedAt || now,
      updatedAt: member.updatedAt || now
    });
  });
}

function migrateLegacyVouchers_() {
  const target = getMultiCardSheet_(MULTI_CARD_SHEETS.vouchers);
  readObjects_(getSheet_(POINTS_CARD_SHEETS.vouchers)).forEach(function (voucher) {
    appendMultiCardIfMissing_(target, 'voucherId', String(voucher.voucherId || ''), {
      voucherId: String(voucher.voucherId || ''),
      cardId: MULTI_CARD.legacyCardId,
      shareCode: String(voucher.shareCode || ''),
      stampCount: Number(voucher.stampCount || 0),
      scanMode: String(voucher.scanMode || ''),
      status: String(voucher.status || 'cancelled'),
      expiresAt: String(voucher.expiresAt || ''),
      note: String(voucher.note || ''),
      createdByLineUserId: String(voucher.createdByLineUserId || ''),
      createdAt: String(voucher.createdAt || ''),
      updatedAt: String(voucher.updatedAt || ''),
      cancelledByLineUserId: String(voucher.cancelledByLineUserId || ''),
      cancelledAt: String(voucher.cancelledAt || '')
    });
  });
}

function migrateLegacyStampRecords_() {
  const target = getMultiCardSheet_(MULTI_CARD_SHEETS.stampRecords);
  readObjects_(getSheet_(POINTS_CARD_SHEETS.stampRecords)).forEach(function (record) {
    appendMultiCardIfMissing_(target, 'recordId', String(record.recordId || ''), {
      recordId: String(record.recordId || ''),
      requestId: String(record.requestId || ''),
      cardId: MULTI_CARD.legacyCardId,
      voucherId: String(record.voucherId || ''),
      memberLineUserId: String(record.memberLineUserId || ''),
      memberNo: String(record.memberNo || ''),
      stampCount: Number(record.stampCount || 0),
      note: String(record.note || ''),
      status: String(record.status || ''),
      totalBefore: Number(record.totalBefore || 0),
      totalAfter: Number(record.totalAfter || 0),
      createdAt: String(record.createdAt || ''),
      updatedAt: String(record.updatedAt || ''),
      recordedAt: String(record.recordedAt || ''),
      auditRecordedAt: String(record.auditRecordedAt || '')
    });
  });
}

function migrateLegacyRewardRecords_() {
  const target = getMultiCardSheet_(MULTI_CARD_SHEETS.rewardRecords);
  readObjects_(getSheet_(POINTS_CARD_SHEETS.rewardRecords)).forEach(function (record) {
    appendMultiCardIfMissing_(target, 'rewardRecordId', String(record.rewardRecordId || ''), {
      rewardRecordId: String(record.rewardRecordId || ''),
      requestId: String(record.requestId || ''),
      cardId: MULTI_CARD.legacyCardId,
      memberLineUserId: String(record.memberLineUserId || ''),
      memberNo: String(record.memberNo || ''),
      rewardName: String(record.rewardName || ''),
      rewardOrdinal: Number(record.rewardOrdinal || 0),
      redeemedBefore: Number(record.redeemedBefore || 0),
      redeemedAfter: Number(record.redeemedAfter || 0),
      status: String(record.status || ''),
      redeemedByLineUserId: String(record.redeemedByLineUserId || ''),
      note: String(record.note || ''),
      createdAt: String(record.createdAt || ''),
      updatedAt: String(record.updatedAt || ''),
      redeemedAt: String(record.redeemedAt || ''),
      auditRecordedAt: String(record.auditRecordedAt || ''),
      rewardType: String(record.rewardType || 'coupon'),
      rewardNodeId: String(record.rewardNodeId || ''),
      cycleNumber: Number(record.cycleNumber || 1),
      lotteryResult: String(record.lotteryResult || ''),
      confirmationId: String(record.confirmationId || '')
    });
  });
}

function clearLegacyTransactionalData_() {
  clearLegacySheetDataRows_(getSheet_(POINTS_CARD_SHEETS.vouchers));
  clearLegacySheetDataRows_(getSheet_(POINTS_CARD_SHEETS.stampRecords));
  clearLegacySheetDataRows_(getSheet_(POINTS_CARD_SHEETS.rewardRecords));
}

function clearLegacyMemberCounters_() {
  const sheet = getSheet_(POINTS_CARD_SHEETS.members);
  const snapshot = readObjects_(sheet).map(normalizeMember_);
  snapshot.forEach(function (member) {
    if (member.totalStamps === 0 && member.redeemedRewards === 0) return;
    const current = findByFieldWithRow_(sheet, 'lineUserId', member.lineUserId);
    if (!current) return;
    const fresh = normalizeMember_(current.object);
    if (fresh.totalStamps === 0 && fresh.redeemedRewards === 0) return;
    fresh.totalStamps = 0;
    fresh.redeemedRewards = 0;
    fresh.updatedAt = new Date().toISOString();
    writeObjectRow_(sheet, current.row, fresh);
  });
}

function normalizeMultiCard_(value) {
  let rewardNodes;
  try {
    rewardNodes = normalizeRewardNodes_(JSON.parse(String(value.rewardNodesJson || '[]')), 'DATA_INTEGRITY_ERROR', '集點卡節點資料異常。');
  } catch (error) {
    if (error && error.publicCode) throw error;
    fail_('DATA_INTEGRITY_ERROR', '集點卡節點資料異常。');
  }
  const storedStatus = String(value.status || 'active');
  if (storedStatus !== 'active' && storedStatus !== 'deleted') fail_('DATA_INTEGRITY_ERROR', '集點卡狀態資料異常。');
  const expiresAt = String(value.expiresAt || '');
  let status = storedStatus;
  if (storedStatus === 'active' && expiresAt) {
    const expiresTime = new Date(expiresAt).getTime();
    if (!Number.isFinite(expiresTime) || expiresTime <= Date.now()) status = 'expired';
  }
  return {
    cardId: String(value.cardId || ''),
    name: String(value.name || ''),
    description: String(value.description || ''),
    storedStatus: storedStatus,
    status: status,
    available: status === 'active',
    expiresAt: expiresAt,
    rewardNodes: rewardNodes,
    rewardNodesUpdatedAt: String(value.rewardNodesUpdatedAt || 'legacy'),
    createdByLineUserId: String(value.createdByLineUserId || ''),
    createdAt: String(value.createdAt || ''),
    updatedAt: String(value.updatedAt || '')
  };
}

function multiCardStorageObject_(card) {
  return {
    cardId: card.cardId,
    name: card.name,
    description: card.description,
    status: card.storedStatus === 'deleted' || card.status === 'deleted' ? 'deleted' : 'active',
    expiresAt: card.expiresAt || '',
    rewardNodesJson: JSON.stringify(card.rewardNodes),
    rewardNodesUpdatedAt: card.rewardNodesUpdatedAt,
    createdByLineUserId: card.createdByLineUserId || '',
    createdAt: card.createdAt,
    updatedAt: card.updatedAt
  };
}

function publicMultiCard_(card) {
  return {
    cardId: card.cardId,
    name: card.name,
    description: card.description,
    status: card.status,
    available: card.available,
    expiresAt: card.expiresAt,
    cardSize: card.rewardNodes[card.rewardNodes.length - 1].stampsRequired,
    rewardNodesUpdatedAt: card.rewardNodesUpdatedAt,
    createdAt: card.createdAt,
    updatedAt: card.updatedAt
  };
}

function multiCardAdminSummaries_() {
  const cards = allMultiCards_().filter(function (card) { return card.storedStatus !== 'deleted'; });
  const lockedIds = new Set(readMultiCardObjects_(getMultiCardSheet_(MULTI_CARD_SHEETS.rewardRecords)).filter(function (record) {
    return record.status === 'processing' || record.status === 'recorded';
  }).map(function (record) { return String(record.cardId || ''); }));
  const minimumRewardByCard = {};
  cards.forEach(function (card) {
    minimumRewardByCard[card.cardId] = card.rewardNodes[0].stampsRequired;
  });
  readMultiCardObjects_(getMultiCardSheet_(MULTI_CARD_SHEETS.progress)).forEach(function (row) {
    const cardId = String(row.cardId || '');
    if (!Object.prototype.hasOwnProperty.call(minimumRewardByCard, cardId)) return;
    const totalStamps = storedNonNegativeInt_(row.totalStamps, 100000000);
    if (totalStamps >= minimumRewardByCard[cardId]) lockedIds.add(cardId);
  });
  return cards.map(function (card) {
    const result = publicMultiCard_(card);
    result.rewardNodes = card.rewardNodes;
    result.rewardSettingsLocked = lockedIds.has(card.cardId);
    return result;
  });
}

function multiCardSettings_(card) {
  const lastNode = card.rewardNodes[card.rewardNodes.length - 1];
  return {
    stampsPerReward: lastNode.stampsRequired,
    cardSize: lastNode.stampsRequired,
    rewardName: lastNode.rewardName,
    rewardNodes: card.rewardNodes,
    rewardTicketTypesSupported: true,
    rewardLotteryWeightsSupported: true,
    cardLifecycleSupported: true,
    multiCardSupported: true,
    card: publicMultiCard_(card),
    cards: multiCardAdminSummaries_(),
    rewardNodesUpdatedAt: card.rewardNodesUpdatedAt,
    rewardSettingsLocked: rewardSettingsLockedForCard_(card.cardId)
  };
}

function emptyMultiCardSettings_() {
  return {
    stampsPerReward: 10,
    cardSize: 10,
    rewardName: '本期優惠券',
    rewardNodes: [{ nodeId: 'node-10', stampsRequired: 10, rewardName: '本期優惠券', rewardType: 'coupon', lotteryPrizes: [] }],
    rewardTicketTypesSupported: true,
    rewardLotteryWeightsSupported: true,
    cardLifecycleSupported: true,
    multiCardSupported: true,
    card: { cardId: '', name: '', description: '', status: 'deleted', available: false, expiresAt: '', cardSize: 10, rewardNodesUpdatedAt: 'none', createdAt: '', updatedAt: '' },
    cards: [],
    rewardNodesUpdatedAt: 'none',
    rewardSettingsLocked: true
  };
}

function validMultiCardExpiry_(value) {
  const text = cleanText_(value || '', 40, false);
  if (!text) return '';
  const time = new Date(text).getTime();
  if (!Number.isFinite(time) || time <= Date.now()) fail_('INVALID_CARD_EXPIRY', '集點卡到期時間必須晚於現在。');
  return new Date(time).toISOString();
}

function validMultiCardId_(value, required) {
  const cardId = cleanText_(value || '', 64, Boolean(required)).toUpperCase();
  if (cardId && !/^CARD-[A-Z0-9-]{2,58}$/.test(cardId)) fail_('INVALID_CARD_ID', '集點卡識別碼格式不正確。');
  return cardId;
}

function newMultiCardId_() {
  const sheet = getMultiCardSheet_(MULTI_CARD_SHEETS.cards);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const cardId = 'CARD-' + Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyMMdd') + '-' + randomHex_(4).toUpperCase();
    if (!findMultiCardByFieldWithRow_(sheet, 'cardId', cardId)) return cardId;
  }
  fail_('INTERNAL_ERROR', '無法產生集點卡識別碼。');
}

function multiCardProgressId_(cardId, lineUserId) {
  return 'MP-' + sha256Hex_(cardId + '|' + lineUserId).slice(0, 24).toUpperCase();
}

function findMultiCard_(cardId) {
  const match = findMultiCardByFieldWithRow_(getMultiCardSheet_(MULTI_CARD_SHEETS.cards), 'cardId', cardId);
  return match ? { row: match.row, card: normalizeMultiCard_(match.object) } : null;
}

function allMultiCards_() {
  return readMultiCardObjects_(getMultiCardSheet_(MULTI_CARD_SHEETS.cards)).map(normalizeMultiCard_)
    .sort(function (a, b) { return String(a.createdAt).localeCompare(String(b.createdAt)); });
}

function multiCardNameKey_(value) {
  let name = cleanText_(value, MULTI_CARD.maxNameLength, true);
  if (typeof name.normalize === 'function') name = name.normalize('NFKC');
  return name.replace(/\s+/g, ' ').trim().toLowerCase();
}

function assertMultiCardNameAvailable_(name, excludedCardId) {
  const nameKey = multiCardNameKey_(name);
  const duplicate = allMultiCards_().some(function (card) {
    return card.cardId !== String(excludedCardId || '') && multiCardNameKey_(card.name) === nameKey;
  });
  if (duplicate) fail_('CARD_NAME_DUPLICATE', '集點卡名稱不可重複。');
}

function requestedMultiCardId_(payload) {
  return validMultiCardId_(payload && payload.cardId || '', false);
}

function selectedAdminMultiCard_(payload) {
  const cards = allMultiCards_().filter(function (card) { return card.storedStatus !== 'deleted'; });
  const requested = requestedMultiCardId_(payload);
  if (requested) {
    const match = cards.find(function (card) { return card.cardId === requested; });
    if (match) return match;
  }
  return cards.find(function (card) { return card.available; }) || cards[0] || null;
}

function selectedMemberMultiCard_(payload, memberLineUserId, progressMap) {
  const progressIds = progressMap || progressMapForMember_(memberLineUserId, true);
  const cards = allMultiCards_().filter(function (card) {
    return card.storedStatus !== 'deleted' || Boolean(progressIds[card.cardId]);
  });
  const requested = requestedMultiCardId_(payload);
  if (requested) {
    const requestedCard = cards.find(function (card) { return card.cardId === requested; });
    if (requestedCard) return requestedCard;
  }
  const active = cards.find(function (card) { return card.available; });
  if (active) return active;
  return cards.find(function (card) { return Boolean(progressIds[card.cardId]); }) || cards[0] || null;
}

function progressMapForMember_(lineUserId, preferSelectiveRead) {
  const map = {};
  const sheet = getMultiCardSheet_(MULTI_CARD_SHEETS.progress);
  const rows = preferSelectiveRead
    ? readMultiCardObjectsByField_(sheet, 'memberLineUserId', lineUserId)
    : readMultiCardObjects_(sheet);
  rows.forEach(function (row) {
    if (String(row.memberLineUserId || '') !== String(lineUserId || '')) return;
    const progress = normalizeMemberCardProgress_(row);
    map[progress.cardId] = progress;
  });
  return map;
}

function findMemberCardProgress_(cardId, lineUserId) {
  const progressId = multiCardProgressId_(cardId, lineUserId);
  const match = findMultiCardByFieldWithRow_(getMultiCardSheet_(MULTI_CARD_SHEETS.progress), 'progressId', progressId);
  if (!match) return null;
  return { row: match.row, progress: normalizeMemberCardProgress_(match.object) };
}

function normalizeMemberCardProgress_(value) {
  return {
    progressId: String(value.progressId || ''),
    cardId: String(value.cardId || ''),
    memberLineUserId: String(value.memberLineUserId || ''),
    memberNo: String(value.memberNo || ''),
    totalStamps: storedNonNegativeInt_(value.totalStamps, 100000000),
    redeemedRewards: storedNonNegativeInt_(value.redeemedRewards, 100000000),
    createdAt: String(value.createdAt || ''),
    updatedAt: String(value.updatedAt || '')
  };
}

function ensureMemberCardProgress_(card, member) {
  const existing = findMemberCardProgress_(card.cardId, member.lineUserId);
  if (existing) return existing;
  const now = new Date().toISOString();
  const progress = {
    progressId: multiCardProgressId_(card.cardId, member.lineUserId),
    cardId: card.cardId,
    memberLineUserId: member.lineUserId,
    memberNo: member.memberNo,
    totalStamps: 0,
    redeemedRewards: 0,
    createdAt: now,
    updatedAt: now
  };
  const sheet = getMultiCardSheet_(MULTI_CARD_SHEETS.progress);
  appendMultiCardObject_(sheet, progress);
  const match = findMultiCardByFieldWithRow_(sheet, 'progressId', progress.progressId);
  return { row: match.row, progress: normalizeMemberCardProgress_(match.object) };
}

function claimedOrdinalsForCardMember_(cardId, lineUserId, preferSelectiveRead) {
  const ordinals = [];
  const sheet = getMultiCardSheet_(MULTI_CARD_SHEETS.rewardRecords);
  const records = preferSelectiveRead
    ? readMultiCardObjectsByField_(sheet, 'memberLineUserId', lineUserId)
    : readMultiCardObjects_(sheet);
  records.forEach(function (record) {
    if (String(record.cardId || '') !== cardId || String(record.memberLineUserId || '') !== lineUserId) return;
    if (record.status !== 'recorded' && record.status !== 'processing') return;
    const ordinal = Number(record.rewardOrdinal || 0);
    if (Number.isFinite(ordinal) && Math.floor(ordinal) === ordinal && ordinal > 0 && ordinals.indexOf(ordinal) < 0) ordinals.push(ordinal);
  });
  return ordinals;
}

function multiCardSettingsForProjection_(card) {
  const lastNode = card.rewardNodes[card.rewardNodes.length - 1];
  return {
    stampsPerReward: lastNode.stampsRequired,
    cardSize: lastNode.stampsRequired,
    rewardName: lastNode.rewardName,
    rewardNodes: card.rewardNodes,
    rewardNodesUpdatedAt: card.rewardNodesUpdatedAt
  };
}

function publicMemberCardProjection_(card, member, progressOverride, preferSelectiveRead) {
  const progressMatch = progressOverride === undefined ? findMemberCardProgress_(card.cardId, member.lineUserId) : null;
  const progress = progressOverride || (progressMatch ? progressMatch.progress : {
    totalStamps: 0,
    redeemedRewards: 0,
    createdAt: member.joinedAt,
    updatedAt: member.updatedAt
  });
  const settings = multiCardSettingsForProjection_(card);
  const projectionMember = { totalStamps: progress.totalStamps, redeemedRewards: progress.redeemedRewards };
  const rewards = rewardProjection_(
    projectionMember,
    settings,
    claimedOrdinalsForCardMember_(card.cardId, member.lineUserId, preferSelectiveRead)
  );
  const stampRecords = multiCardStampRecordsForMemberCard_(member.lineUserId, card.cardId, preferSelectiveRead);
  const earnedTickets = rewards.availableRewardNodes.map(function (reward) {
    return multiCardRewardTicketState_(reward, progress, member, stampRecords);
  });
  const usableTickets = earnedTickets.filter(function (ticket) { return ticket.usable; });
  const expiredVisibleTicketCount = earnedTickets.length - usableTickets.length;
  const availableRewards = Math.max(0, rewards.availableRewards - expiredVisibleTicketCount);
  const cardPublic = publicMultiCard_(card);
  return {
    cardId: card.cardId,
    card: cardPublic,
    name: card.name,
    description: card.description,
    status: card.status,
    available: card.available,
    expiresAt: card.expiresAt,
    totalStamps: progress.totalStamps,
    redeemedRewards: progress.redeemedRewards,
    availableRewards: availableRewards,
    availableRewardNodes: earnedTickets.map(function (ticket) {
      const publicTicket = publicRewardTicket_(ticket);
      publicTicket.cardId = card.cardId;
      return publicTicket;
    }),
    upcomingRewardNodes: rewards.upcomingRewardNodes.map(function (ticket) {
      const publicTicket = publicRewardTicket_(ticket);
      publicTicket.cardId = card.cardId;
      return publicTicket;
    }),
    stampsPerReward: settings.stampsPerReward,
    cardSize: settings.cardSize,
    visualStamps: rewards.visualStamps,
    displayCycleNumber: rewards.displayCycleNumber,
    stampsUntilReward: availableRewards > 0 ? 0 : rewards.stampsUntilNextReward,
    stampsUntilNextReward: rewards.stampsUntilNextReward,
    rewardName: rewards.nextAvailableReward ? rewards.nextAvailableReward.rewardName : (rewards.nextReward ? rewards.nextReward.rewardName : settings.rewardName),
    rewardNodesUpdatedAt: settings.rewardNodesUpdatedAt,
    rewardNodes: rewards.rewardNodes.map(function (ticket) {
      if (ticket.state === 'available') {
        ticket = multiCardRewardTicketState_(ticket, progress, member, stampRecords);
      }
      const publicTicket = publicRewardTicket_(ticket);
      publicTicket.cardId = card.cardId;
      return publicTicket;
    }),
    nextAvailableReward: usableTickets.length ? Object.assign(publicRewardTicket_(usableTickets[0]), { cardId: card.cardId }) : null,
    nextReward: rewards.nextReward ? Object.assign(publicRewardTicket_(rewards.nextReward), { cardId: card.cardId }) : null,
    progressUpdatedAt: progress.updatedAt || ''
  };
}

function publicMultiCardMember_(member, payload, includeAdminFields) {
  const preferSelectiveRead = !includeAdminFields;
  const progressMap = progressMapForMember_(member.lineUserId, preferSelectiveRead);
  const allCards = allMultiCards_().filter(function (card) {
    return card.storedStatus !== 'deleted' || Boolean(progressMap[card.cardId]);
  });
  const selectedCard = selectedMemberMultiCard_(payload, member.lineUserId, progressMap);
  const summaries = allCards.map(function (card) {
    const progress = progressMap[card.cardId];
    const summary = publicMultiCard_(card);
    summary.totalStamps = progress ? progress.totalStamps : 0;
    summary.redeemedRewards = progress ? progress.redeemedRewards : 0;
    return summary;
  });
  const base = {
    memberNo: member.memberNo,
    displayName: member.displayName,
    pictureUrl: member.pictureUrl,
    membershipStatus: member.membershipStatus,
    joinedAt: member.joinedAt,
    updatedAt: member.updatedAt,
    cards: summaries,
    selectedCardId: selectedCard ? selectedCard.cardId : ''
  };
  if (includeAdminFields) base.note = member.note;

  if (!selectedCard) {
    return Object.assign(base, {
      totalStamps: 0,
      redeemedRewards: 0,
      availableRewards: 0,
      availableRewardNodes: [],
      upcomingRewardNodes: [],
      stampsPerReward: 10,
      cardSize: 10,
      card: { cardId: '', name: '', description: '', status: 'deleted', available: false, expiresAt: '', updatedAt: 'none' },
      visualStamps: 0,
      displayCycleNumber: 1,
      stampsUntilReward: 0,
      stampsUntilNextReward: 0,
      rewardName: '本期優惠券',
      rewardNodesUpdatedAt: 'none',
      rewardNodes: [],
      nextAvailableReward: null,
      nextReward: null
    });
  }

  return Object.assign(base, publicMemberCardProjection_(
    selectedCard,
    member,
    progressMap[selectedCard.cardId] || null,
    preferSelectiveRead
  ));
}

function memberMeMultiCard_(context, payload) {
  ensureMultiCardStorage_();
  const synchronizedMember = memberMe_(context, true).member;
  return { member: publicMultiCardMember_(synchronizedMember, payload || {}, false) };
}

function adminCardsListMultiCard_() {
  ensureMultiCardStorage_();
  return { cards: multiCardAdminSummaries_() };
}

function adminCardCreateMultiCard_(context, payload) {
  ensureMultiCardStorage_();
  const name = cleanText_(payload.name, MULTI_CARD.maxNameLength, true);
  const description = cleanText_(payload.description || '', MULTI_CARD.maxDescriptionLength, false);
  const expiresAt = validMultiCardExpiry_(payload.expiresAt || '');
  const rewardNodes = payload.rewardNodes
    ? normalizeRewardNodes_(payload.rewardNodes, 'INVALID_REWARD_NODES', '獎勵節點設定不正確。')
    : normalizeRewardNodes_([{ stampsRequired: 10, rewardName: '本期優惠券', rewardType: 'coupon' }], 'INVALID_REWARD_NODES', '獎勵節點設定不正確。');
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) fail_('BUSY', '系統忙碌中，請稍後再試。');
  try {
    const managedCardCount = allMultiCards_().filter(function (card) { return card.storedStatus !== 'deleted'; }).length;
    if (managedCardCount >= MULTI_CARD.maxCards) fail_('CARD_LIMIT_REACHED', '集點卡數量已達系統上限 100 張。');
    assertMultiCardNameAvailable_(name, '');
    const now = new Date().toISOString();
    const card = {
      cardId: newMultiCardId_(),
      name: name,
      description: description,
      status: 'active',
      expiresAt: expiresAt,
      rewardNodes: rewardNodes,
      rewardNodesUpdatedAt: now,
      createdByLineUserId: context.identity.sub,
      createdAt: now,
      updatedAt: now
    };
    if (!audit_(context.identity.sub, 'admin', 'CARD_CREATE_REQUESTED', '', 'pending', {
      cardId: card.cardId,
      name: name,
      expiresAt: expiresAt || 'unlimited'
    })) fail_('AUDIT_UNAVAILABLE', '稽核紀錄暫時無法寫入，集點卡尚未建立。');
    appendMultiCardObject_(getMultiCardSheet_(MULTI_CARD_SHEETS.cards), multiCardStorageObject_(card));
    audit_(context.identity.sub, 'admin', 'CARD_CREATED', '', 'success', {
      cardId: card.cardId,
      name: name,
      expiresAt: expiresAt || 'unlimited'
    });
    return { card: publicMultiCard_(normalizeMultiCard_(multiCardStorageObject_(card))) };
  } finally {
    lock.releaseLock();
  }
}

function adminCardUpdateMultiCard_(context, payload) {
  ensureMultiCardStorage_();
  const cardId = validMultiCardId_(payload.cardId, true);
  const expectedUpdatedAt = cleanText_(payload.expectedUpdatedAt, 64, true);
  const name = cleanText_(payload.name, MULTI_CARD.maxNameLength, true);
  const description = cleanText_(payload.description || '', MULTI_CARD.maxDescriptionLength, false);
  const expiresAt = validMultiCardExpiry_(payload.expiresAt || '');
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) fail_('BUSY', '系統忙碌中，請稍後再試。');
  try {
    const match = findMultiCard_(cardId);
    if (!match) fail_('CARD_NOT_FOUND', '找不到指定集點卡。');
    if (match.card.storedStatus === 'deleted') fail_('CARD_NOT_FOUND', '找不到指定集點卡。');
    if (match.card.updatedAt !== expectedUpdatedAt) fail_('CONFLICT', '集點卡已被更新，請重新整理後再試。');
    assertMultiCardNameAvailable_(name, cardId);
    const next = Object.assign({}, match.card, {
      name: name,
      description: description,
      expiresAt: expiresAt,
      updatedAt: new Date().toISOString()
    });
    if (!audit_(context.identity.sub, 'admin', 'CARD_UPDATE_REQUESTED', '', 'pending', {
      cardId: cardId,
      fields: ['name', 'description', 'expiresAt']
    })) fail_('AUDIT_UNAVAILABLE', '稽核紀錄暫時無法寫入，集點卡未更新。');
    writeMultiCardObjectRow_(getMultiCardSheet_(MULTI_CARD_SHEETS.cards), match.row, multiCardStorageObject_(next));
    audit_(context.identity.sub, 'admin', 'CARD_UPDATED', '', 'success', { cardId: cardId });
    return { card: publicMultiCard_(normalizeMultiCard_(multiCardStorageObject_(next))) };
  } finally {
    lock.releaseLock();
  }
}

function cancelActiveMultiCardStampVouchersForCard_(cardId, actorLineUserId, now) {
  const sheet = getMultiCardSheet_(MULTI_CARD_SHEETS.vouchers);
  let cancelledCount = 0;
  readMultiCardObjects_(sheet).forEach(function (row) {
    if (String(row.cardId || '') !== cardId || String(row.status || '') !== 'active') return;
    const match = findMultiCardByFieldWithRow_(sheet, 'voucherId', row.voucherId);
    if (!match) return;
    const voucher = normalizeMultiCardVoucher_(match.object);
    if (voucher.cardId !== cardId || voucher.status !== 'active') return;
    voucher.status = 'cancelled';
    voucher.cancelledByLineUserId = actorLineUserId;
    voucher.cancelledAt = now;
    voucher.updatedAt = now;
    writeMultiCardObjectRow_(sheet, match.row, voucher);
    cancelledCount += 1;
  });
  return cancelledCount;
}

function adminCardDeleteMultiCard_(context, payload) {
  ensureMultiCardStorage_();
  const cardId = validMultiCardId_(payload.cardId, true);
  const expectedUpdatedAt = cleanText_(payload.expectedUpdatedAt, 64, true);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(8000)) fail_('BUSY', '系統忙碌中，請稍後再試。');
  try {
    const match = findMultiCard_(cardId);
    if (!match) fail_('CARD_NOT_FOUND', '找不到指定集點卡。');
    if (match.card.storedStatus === 'deleted') fail_('CARD_NOT_FOUND', '找不到指定集點卡。');
    if (match.card.updatedAt !== expectedUpdatedAt) fail_('CONFLICT', '集點卡已被更新，請重新整理後再試。');

    const counts = {
      progress: readMultiCardObjects_(getMultiCardSheet_(MULTI_CARD_SHEETS.progress)).filter(function (row) { return String(row.cardId || '') === cardId; }).length,
      vouchers: readMultiCardObjects_(getMultiCardSheet_(MULTI_CARD_SHEETS.vouchers)).filter(function (row) { return String(row.cardId || '') === cardId; }).length,
      stampRecords: readMultiCardObjects_(getMultiCardSheet_(MULTI_CARD_SHEETS.stampRecords)).filter(function (row) { return String(row.cardId || '') === cardId; }).length,
      rewardRecords: readMultiCardObjects_(getMultiCardSheet_(MULTI_CARD_SHEETS.rewardRecords)).filter(function (row) { return String(row.cardId || '') === cardId; }).length
    };
    if (!audit_(context.identity.sub, 'admin', 'CARD_DELETE_REQUESTED', '', 'pending', {
      cardId: cardId,
      name: match.card.name,
      preservedCounts: counts
    })) fail_('AUDIT_UNAVAILABLE', '稽核紀錄暫時無法寫入，集點卡未刪除。');

    const now = new Date().toISOString();
    const revokedStampQrCount = cancelActiveMultiCardStampVouchersForCard_(cardId, context.identity.sub, now);
    const archivedCard = Object.assign({}, match.card, {
      storedStatus: 'deleted',
      status: 'deleted',
      available: false,
      updatedAt: now
    });
    writeMultiCardObjectRow_(getMultiCardSheet_(MULTI_CARD_SHEETS.cards), match.row, multiCardStorageObject_(archivedCard));

    audit_(context.identity.sub, 'admin', 'CARD_DELETED', '', 'success', {
      cardId: cardId,
      preservedMemberHistory: true,
      preservedUnusedRewards: true,
      preservedCounts: counts,
      revokedStampQrCount: revokedStampQrCount
    });
    return {
      cardId: cardId,
      archived: true,
      deleted: { progress: 0, vouchers: 0, stampRecords: 0, rewardRecords: 0 },
      preserved: counts,
      revokedStampQrCount: revokedStampQrCount
    };
  } finally {
    lock.releaseLock();
  }
}

function rewardSettingsLockedForCard_(cardId) {
  const cardMatch = findMultiCard_(cardId);
  if (!cardMatch || !Array.isArray(cardMatch.card.rewardNodes) || !cardMatch.card.rewardNodes.length) return true;
  const firstRewardThreshold = Number(cardMatch.card.rewardNodes[0].stampsRequired || 0);
  const earnedRewardExists = readMultiCardObjects_(getMultiCardSheet_(MULTI_CARD_SHEETS.progress)).some(function (row) {
    if (String(row.cardId || '') !== cardId) return false;
    return storedNonNegativeInt_(row.totalStamps, 100000000) >= firstRewardThreshold;
  });
  if (earnedRewardExists) return true;
  return readMultiCardObjects_(getMultiCardSheet_(MULTI_CARD_SHEETS.rewardRecords)).some(function (record) {
    return String(record.cardId || '') === cardId && (record.status === 'processing' || record.status === 'recorded');
  });
}

function adminRewardNodesUpdateMultiCard_(context, payload) {
  ensureMultiCardStorage_();
  const cardId = validMultiCardId_(payload.cardId, true);
  const expectedUpdatedAt = cleanText_(payload.expectedUpdatedAt, 64, true);
  const rewardNodes = normalizeRewardNodes_(payload.rewardNodes, 'INVALID_REWARD_NODES', '請設定有效的獎勵節點；節點點數最多 10,000 點。');
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) fail_('BUSY', '系統忙碌中，請稍後再試。');
  try {
    const match = findMultiCard_(cardId);
    if (!match) fail_('CARD_NOT_FOUND', '找不到指定集點卡。');
    if (match.card.storedStatus === 'deleted') fail_('CARD_NOT_FOUND', '找不到指定集點卡。');
    if (match.card.rewardNodesUpdatedAt !== expectedUpdatedAt) fail_('CONFLICT', '獎勵節點已被更新，請重新整理後再試。');
    if (rewardSettingsLockedForCard_(cardId)) fail_('REWARD_SETTINGS_LOCKED', '這張集點卡已有會員取得票券或已有票券使用紀錄，為保留既有權益不能再修改節點。');
    const now = new Date().toISOString();
    if (!audit_(context.identity.sub, 'admin', 'CARD_REWARD_NODES_UPDATE_REQUESTED', '', 'pending', {
      cardId: cardId,
      rewardNodes: rewardNodes
    })) fail_('AUDIT_UNAVAILABLE', '稽核紀錄暫時無法寫入，獎勵節點未更新。');
    const next = Object.assign({}, match.card, {
      rewardNodes: rewardNodes,
      rewardNodesUpdatedAt: now,
      updatedAt: now
    });
    writeMultiCardObjectRow_(getMultiCardSheet_(MULTI_CARD_SHEETS.cards), match.row, multiCardStorageObject_(next));
    audit_(context.identity.sub, 'admin', 'CARD_REWARD_NODES_UPDATED', '', 'success', { cardId: cardId });
    return { settings: multiCardSettings_(normalizeMultiCard_(multiCardStorageObject_(next))) };
  } finally {
    lock.releaseLock();
  }
}

function adminSummaryMultiCard_(payload) {
  ensureMultiCardStorage_();
  const allMembers = readObjects_(getSheet_(POINTS_CARD_SHEETS.members)).map(normalizeMember_);
  const progress = readMultiCardObjects_(getMultiCardSheet_(MULTI_CARD_SHEETS.progress)).map(normalizeMemberCardProgress_);
  const stats = {
    totalMembers: allMembers.length,
    activeMembers: allMembers.filter(function (member) { return member.membershipStatus === 'active'; }).length,
    totalStamps: progress.reduce(function (total, item) { return total + item.totalStamps; }, 0),
    redeemedRewards: progress.reduce(function (total, item) { return total + item.redeemedRewards; }, 0),
    totalCards: allMultiCards_().filter(function (card) { return card.storedStatus !== 'deleted'; }).length
  };
  const selected = selectedAdminMultiCard_(payload || {});
  return { stats: stats, settings: selected ? multiCardSettings_(selected) : emptyMultiCardSettings_() };
}

function adminDashboardMultiCard_(payload) {
  const summary = adminSummaryMultiCard_(payload || {});
  const memberPage = adminMembersSearchMultiCard_(payload || {});
  return {
    members: memberPage.members,
    pagination: memberPage.pagination,
    vouchers: adminStampListMultiCard_(payload || {}).vouchers,
    rewardConfirmations: adminRewardConfirmationListMultiCard_(payload && payload.confirmationLimit || 50),
    stats: summary.stats,
    settings: summary.settings
  };
}

function adminMembersSearchMultiCard_(payload) {
  ensureMultiCardStorage_();
  const query = cleanText_(payload.query || '', 80, false).toLowerCase();
  const page = clampInt_(payload.page, 1, 1000000, 1);
  const pageSize = clampInt_(payload.pageSize, 1, 100, 100);
  const selected = selectedAdminMultiCard_(payload || {});
  const allMembers = readObjects_(getSheet_(POINTS_CARD_SHEETS.members)).map(normalizeMember_);
  const filtered = query ? allMembers.filter(function (member) {
    return member.memberNo.toLowerCase().indexOf(query) !== -1 || member.displayName.toLowerCase().indexOf(query) !== -1;
  }) : allMembers;
  filtered.sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
  const start = (page - 1) * pageSize;
  const members = filtered.slice(start, start + pageSize).map(function (member) {
    return publicMultiCardMember_(member, { cardId: selected ? selected.cardId : '' }, true);
  });
  return {
    members: members,
    pagination: { page: page, pageSize: pageSize, total: filtered.length, hasMore: start + members.length < filtered.length }
  };
}

function adminMemberUpdateMultiCard_(context, payload) {
  ensureMultiCardStorage_();
  adminMemberUpdate_(context, payload);
  const match = findByFieldWithRow_(getSheet_(POINTS_CARD_SHEETS.members), 'memberNo', cleanText_(payload.targetMemberNo, 30, true));
  if (!match) fail_('MEMBER_NOT_FOUND', '找不到指定會員。');
  return { member: publicMultiCardMember_(normalizeMember_(match.object), payload || {}, true) };
}
