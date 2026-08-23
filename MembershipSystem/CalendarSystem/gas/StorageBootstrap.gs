'use strict';

const CALENDAR_STORAGE = Object.freeze({
  spreadsheetProperty: 'CALENDAR_SPREADSHEET_ID',
  eventsSheet: 'CalendarEvents',
  identitiesSheet: 'LineIdentities',
  adminPermissionsSheet: 'AdminPermissions',
  auditSheet: 'AuditLogs'
});

const CALENDAR_HEADERS = Object.freeze({
  CalendarEvents: [
    'eventId', 'date', 'type', 'title', 'description', 'status',
    'createdAt', 'updatedAt'
  ],
  LineIdentities: [
    'lineUserId', 'surface', 'displayName', 'pictureUrl',
    'firstSeenAt', 'lastLoginAt', 'loginCount'
  ],
  AdminPermissions: [
    'lineUserId', 'displayName', 'canManageCalendar', 'status', 'note', 'firstSeenAt'
  ],
  AuditLogs: [
    'timestamp', 'actor', 'action', 'eventId', 'result', 'details'
  ]
});

/**
 * One-time bootstrap entrypoint for the Apps Script editor.
 * If CALENDAR_SPREADSHEET_ID is already configured, this function validates
 * and prepares that exact spreadsheet. It creates a new spreadsheet only
 * when no binding exists yet.
 */
function setupCalendarStorage() {
  const properties = PropertiesService.getScriptProperties();
  const existingId = String(properties.getProperty(CALENDAR_STORAGE.spreadsheetProperty) || '').trim();
  let spreadsheet;
  let created = false;

  if (existingId) {
    spreadsheet = openCalendarSpreadsheet_(existingId);
  } else {
    spreadsheet = SpreadsheetApp.create('MembershipSystem Calendar Data');
    properties.setProperty(CALENDAR_STORAGE.spreadsheetProperty, spreadsheet.getId());
    created = true;
  }

  ensureCalendarSheets_(spreadsheet);
  SpreadsheetApp.flush();

  return {
    created: created,
    spreadsheetId: spreadsheet.getId(),
    spreadsheetUrl: spreadsheet.getUrl(),
    sheets: Object.keys(CALENDAR_HEADERS)
  };
}

/**
 * Runtime storage resolver used by API requests.
 * Never silently switches databases. Missing/invalid configuration fails
 * closed so membership, permission and audit data cannot be written elsewhere.
 */
function ensureCalendarStorage_() {
  const properties = PropertiesService.getScriptProperties();
  const existingId = String(properties.getProperty(CALENDAR_STORAGE.spreadsheetProperty) || '').trim();

  if (!existingId) {
    storageFail_(
      'CONFIGURATION_ERROR',
      '日曆資料庫尚未設定。',
      'CALENDAR_SPREADSHEET_ID is missing.'
    );
  }

  const spreadsheet = openCalendarSpreadsheet_(existingId);
  ensureCalendarSheets_(spreadsheet);
  return spreadsheet;
}

function openCalendarSpreadsheet_(spreadsheetId) {
  try {
    return SpreadsheetApp.openById(spreadsheetId);
  } catch (error) {
    storageFail_(
      'CONFIGURATION_ERROR',
      '日曆資料庫設定無效或目前無法存取。',
      'Unable to open CALENDAR_SPREADSHEET_ID: ' + String(error && error.message || error || '')
    );
  }
}

function ensureCalendarSheets_(spreadsheet) {
  Object.keys(CALENDAR_HEADERS).forEach(name => {
    ensureSheet_(spreadsheet, name, CALENDAR_HEADERS[name]);
  });
}

/**
 * Manual diagnostic entrypoint. Run from the Apps Script editor.
 * It does not expose tokens or LINE user IDs. The temporary probe sheet is
 * deleted before returning.
 */
function diagnoseCalendarStorage() {
  const properties = PropertiesService.getScriptProperties();
  const configuredId = String(properties.getProperty(CALENDAR_STORAGE.spreadsheetProperty) || '').trim();
  const spreadsheet = ensureCalendarStorage_();
  const sheets = {};

  Object.keys(CALENDAR_HEADERS).forEach(name => {
    const sheet = spreadsheet.getSheetByName(name);
    sheets[name] = {
      exists: !!sheet,
      dataRows: sheet ? Math.max(0, sheet.getLastRow() - 1) : null,
      lastColumn: sheet ? sheet.getLastColumn() : null
    };
  });

  let probeSheet = null;
  let writeProbe = false;
  const probeName = '__calendar_write_probe_' + Date.now();
  try {
    probeSheet = spreadsheet.insertSheet(probeName);
    probeSheet.getRange('A1').setValue('calendar-storage-write-ok');
    SpreadsheetApp.flush();
    writeProbe = probeSheet.getRange('A1').getDisplayValue() === 'calendar-storage-write-ok';
  } finally {
    if (probeSheet) {
      try {
        spreadsheet.deleteSheet(probeSheet);
      } catch (error) {
        console.error(JSON.stringify({
          event: 'calendar_storage_probe_cleanup_failed',
          message: String(error && error.message || error || '').slice(0, 300)
        }));
      }
    }
  }

  return {
    configured: !!configuredId,
    spreadsheetId: spreadsheet.getId(),
    spreadsheetUrl: spreadsheet.getUrl(),
    writeProbe: writeProbe,
    sheets: sheets
  };
}

function storageFail_(code, publicMessage, internalMessage) {
  console.error(JSON.stringify({
    event: 'calendar_storage_error',
    code: String(code || 'STORAGE_ERROR'),
    message: String(internalMessage || '').slice(0, 500)
  }));

  if (typeof fail_ === 'function') {
    fail_(code, publicMessage);
  }

  const error = new Error(publicMessage);
  error.publicCode = code;
  error.publicMessage = publicMessage;
  throw error;
}

function ensureSheet_(spreadsheet, name, headers) {
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet) sheet = spreadsheet.insertSheet(name);

  if (sheet.getMaxColumns() < headers.length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), headers.length - sheet.getMaxColumns());
  }

  const current = sheet.getRange(1, 1, 1, headers.length).getDisplayValues()[0];
  const mismatch = headers.some((header, index) => current[index] !== header);
  if (mismatch) {
    if (sheet.getLastRow() > 1) {
      storageFail_(
        'DATA_INTEGRITY_ERROR',
        '日曆資料表欄位結構不相容。',
        'Existing sheet "' + name + '" has incompatible headers.'
      );
    }
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    sheet.autoResizeColumns(1, headers.length);

    // Prevent Google Sheets from coercing identifiers, dates or permission values.
    let textColumns = ['eventId', 'actor', 'action', 'result'];
    if (name === CALENDAR_STORAGE.eventsSheet) {
      textColumns = ['eventId', 'date', 'type', 'status'];
    } else if (name === CALENDAR_STORAGE.identitiesSheet) {
      textColumns = [
        'lineUserId', 'surface', 'displayName', 'pictureUrl',
        'firstSeenAt', 'lastLoginAt', 'loginCount'
      ];
    } else if (name === CALENDAR_STORAGE.adminPermissionsSheet) {
      textColumns = ['lineUserId', 'displayName', 'canManageCalendar', 'status', 'note', 'firstSeenAt'];
    }

    textColumns.forEach(header => {
      const index = headers.indexOf(header);
      if (index >= 0 && sheet.getMaxRows() > 1) {
        sheet.getRange(2, index + 1, sheet.getMaxRows() - 1, 1).setNumberFormat('@');
      }
    });
  }

  return sheet;
}
