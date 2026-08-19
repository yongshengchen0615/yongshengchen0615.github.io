'use strict';

const LOYALTY_SCHEMA_VERSION_ = 1;

const LOYALTY_SHEETS_ = Object.freeze({
  users: 'Users',
  accounts: 'LoyaltyAccounts',
  transactions: 'LoyaltyTransactions',
  admins: 'Admins',
  sessions: 'Sessions',
  audit: 'AuditLogs',
  config: 'SystemConfig'
});

const LOYALTY_HEADERS_ = Object.freeze({
  Users: [
    'user_id',
    'external_identity',
    'display_name',
    'picture_url',
    'status',
    'created_at',
    'updated_at',
    'last_login_at'
  ],
  LoyaltyAccounts: [
    'account_id',
    'user_id',
    'card_code',
    'points_balance',
    'version',
    'status',
    'created_at',
    'updated_at'
  ],
  LoyaltyTransactions: [
    'transaction_id',
    'user_id',
    'type',
    'points',
    'balance_before',
    'balance_after',
    'version_after',
    'reason',
    'actor_id',
    'idempotency_key',
    'request_fingerprint',
    'created_at'
  ],
  Admins: [
    'admin_id',
    'user_id',
    'role',
    'active',
    'created_at',
    'updated_at'
  ],
  Sessions: [
    'session_id',
    'token_hash',
    'user_id',
    'audience',
    'expires_at',
    'revoked_at',
    'created_at',
    'last_seen_at'
  ],
  AuditLogs: [
    'audit_id',
    'actor_id',
    'action',
    'target_id',
    'amount',
    'balance_before',
    'balance_after',
    'result',
    'reason',
    'request_id',
    'created_at'
  ],
  SystemConfig: [
    'key',
    'value',
    'updated_at'
  ]
});

function initializeLoyaltyStorage() {
  const spreadsheet = ensureLoyaltyStorage_();
  return {
    spreadsheetId: spreadsheet.getId(),
    schemaVersion: LOYALTY_SCHEMA_VERSION_,
    sheets: Object.keys(LOYALTY_HEADERS_)
  };
}

function ensureLoyaltyStorage_() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    throw AppError_('LOCK_TIMEOUT', 'Storage initialization is busy');
  }

  try {
    const properties = PropertiesService.getScriptProperties();
    let spreadsheetId = properties.getProperty('SPREADSHEET_ID') || '';
    let spreadsheet;
    let created = false;

    if (spreadsheetId) {
      try {
        spreadsheet = SpreadsheetApp.openById(spreadsheetId);
      } catch (_) {
        throw AppError_('CONFIGURATION_ERROR', 'Configured spreadsheet is not accessible');
      }
    } else {
      spreadsheet = SpreadsheetApp.create('MembershipSystem Loyalty Card');
      spreadsheetId = spreadsheet.getId();
      properties.setProperty('SPREADSHEET_ID', spreadsheetId);
      created = true;
    }

    Object.keys(LOYALTY_HEADERS_).forEach((sheetName) => {
      ensureSheetSchema_(spreadsheet, sheetName, LOYALTY_HEADERS_[sheetName]);
    });

    ensureSystemSetting_('schema_version', String(LOYALTY_SCHEMA_VERSION_));
    ensureSystemSetting_('reward_target', '10');
    ensureSystemSetting_('max_balance', '999999');
    ensureSystemSetting_('max_adjustment', '1000');
    ensureSystemSetting_('session_hours', '8');

    const configuredVersion = Number(getSystemSetting_('schema_version', '0'));
    if (configuredVersion > LOYALTY_SCHEMA_VERSION_) {
      throw AppError_('SCHEMA_MISMATCH', 'Storage schema is newer than this code');
    }
    if (configuredVersion < LOYALTY_SCHEMA_VERSION_) {
      setSystemSetting_('schema_version', String(LOYALTY_SCHEMA_VERSION_));
    }

    if (created) {
      const defaultSheet = spreadsheet.getSheetByName('Sheet1');
      if (defaultSheet && defaultSheet.getLastRow() === 0 && spreadsheet.getSheets().length > 1) {
        spreadsheet.deleteSheet(defaultSheet);
      }
    }

    return spreadsheet;
  } finally {
    lock.releaseLock();
  }
}

function ensureSheetSchema_(spreadsheet, sheetName, expectedHeaders) {
  let sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(sheetName);
  }

  const lastColumn = sheet.getLastColumn();
  if (lastColumn === 0) {
    sheet.getRange(1, 1, 1, expectedHeaders.length).setValues([expectedHeaders]);
    sheet.setFrozenRows(1);
    return sheet;
  }

  const currentHeaders = sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(String);
  if (currentHeaders.length > expectedHeaders.length) {
    throw AppError_('SCHEMA_MISMATCH', 'Existing sheet schema mismatch: ' + sheetName);
  }

  for (let i = 0; i < currentHeaders.length; i++) {
    if (currentHeaders[i] !== expectedHeaders[i]) {
      throw AppError_('SCHEMA_MISMATCH', 'Existing sheet schema mismatch: ' + sheetName);
    }
  }

  if (currentHeaders.length < expectedHeaders.length) {
    const missing = expectedHeaders.slice(currentHeaders.length);
    sheet.getRange(1, currentHeaders.length + 1, 1, missing.length).setValues([missing]);
  }

  sheet.setFrozenRows(1);
  return sheet;
}

function getLoyaltySpreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID') || '';
  if (!id) {
    throw AppError_('CONFIGURATION_ERROR', 'Storage is not initialized');
  }

  try {
    return SpreadsheetApp.openById(id);
  } catch (_) {
    throw AppError_('CONFIGURATION_ERROR', 'Configured spreadsheet is not accessible');
  }
}

function getLoyaltySheet_(sheetName) {
  const sheet = getLoyaltySpreadsheet_().getSheetByName(sheetName);
  if (!sheet) {
    throw AppError_('SCHEMA_MISMATCH', 'Required storage is missing');
  }
  return sheet;
}

function getRowsAsObjects_(sheet) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  const headers = values[0].map(String);
  return values
    .slice(1)
    .filter((row) => row.some((value) => value !== ''))
    .map((row) => {
      const object = {};
      headers.forEach((header, index) => {
        object[header] = row[index];
      });
      return object;
    });
}

function findByField_(sheet, field, value) {
  const match = findByFieldWithRow_(sheet, field, value);
  return match ? match.object : null;
}

function findByFieldWithRow_(sheet, field, value) {
  const headers = getHeaderMap_(sheet);
  const column = headers[field];
  if (!column) {
    throw AppError_('SCHEMA_MISMATCH', 'Required storage field is missing');
  }

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;

  const finder = sheet
    .getRange(2, column, lastRow - 1, 1)
    .createTextFinder(String(value))
    .matchEntireCell(true)
    .useRegularExpression(false);

  const cell = finder.findNext();
  if (!cell) return null;

  const row = cell.getRow();
  const values = sheet.getRange(row, 1, 1, sheet.getLastColumn()).getValues()[0];
  const headerRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  const object = {};
  headerRow.forEach((header, index) => {
    object[header] = values[index];
  });

  return { row: row, object: object };
}

function appendObject_(sheet, object) {
  const headerRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  const row = headerRow.map((header) => object[header] === undefined ? '' : object[header]);
  sheet.appendRow(row);
}

function updateFieldsByRow_(sheet, row, fields) {
  const headerMap = getHeaderMap_(sheet);
  Object.keys(fields).forEach((field) => {
    const column = headerMap[field];
    if (!column) {
      throw AppError_('SCHEMA_MISMATCH', 'Required storage field is missing');
    }
    sheet.getRange(row, column).setValue(fields[field]);
  });
}

function getHeaderMap_(sheet) {
  const lastColumn = sheet.getLastColumn();
  if (!lastColumn) {
    throw AppError_('SCHEMA_MISMATCH', 'Storage header is missing');
  }

  const values = sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(String);
  return values.reduce((map, header, index) => {
    map[header] = index + 1;
    return map;
  }, {});
}

function getSystemSetting_(key, fallback) {
  const sheet = getLoyaltySheet_(LOYALTY_SHEETS_.config);
  const row = findByField_(sheet, 'key', key);
  return row ? String(row.value) : String(fallback);
}

function getNumberSetting_(key, fallback, min, max) {
  const value = Number(getSystemSetting_(key, String(fallback)));
  if (!Number.isFinite(value)) return fallback;
  if (value < min || value > max) return fallback;
  return value;
}

function ensureSystemSetting_(key, value) {
  const sheet = getLoyaltySheet_(LOYALTY_SHEETS_.config);
  if (!findByField_(sheet, 'key', key)) {
    appendObject_(sheet, {
      key: safeCellText_(key),
      value: safeCellText_(value),
      updated_at: isoNow_()
    });
  }
}

function setSystemSetting_(key, value) {
  const sheet = getLoyaltySheet_(LOYALTY_SHEETS_.config);
  const match = findByFieldWithRow_(sheet, 'key', key);
  if (!match) {
    appendObject_(sheet, {
      key: safeCellText_(key),
      value: safeCellText_(value),
      updated_at: isoNow_()
    });
    return;
  }

  updateFieldsByRow_(sheet, match.row, {
    value: safeCellText_(value),
    updated_at: isoNow_()
  });
}

function generateCardCode_() {
  const sheet = getLoyaltySheet_(LOYALTY_SHEETS_.accounts);
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = 'LC-' + compactUuid_().slice(0, 10).toUpperCase();
    if (!findByField_(sheet, 'card_code', code)) return code;
  }
  throw AppError_('INTERNAL_ERROR', 'Unable to generate card code');
}

function isoNow_() {
  return new Date().toISOString();
}

function compactUuid_() {
  return Utilities.getUuid().replace(/-/g, '');
}

function sha256Hex_(value) {
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(value),
    Utilities.Charset.UTF_8
  );
  return digest
    .map((byte) => ('0' + ((byte + 256) % 256).toString(16)).slice(-2))
    .join('');
}

function cleanText_(value, maxLength) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, Number(maxLength || 120));
}

function safeCellText_(value) {
  const text = String(value == null ? '' : value);
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function formatTaipei_(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (isNaN(date.getTime())) return '';
  return Utilities.formatDate(date, 'Asia/Taipei', 'yyyy/MM/dd HH:mm');
}
