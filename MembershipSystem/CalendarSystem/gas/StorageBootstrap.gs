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
    'lineUserId', 'surface', 'displayName', 'pictureUrl', 'status',
    'firstSeenAt', 'lastLoginAt', 'loginCount'
  ],
  AdminPermissions: [
    'lineUserId', 'displayName', 'canManageCalendar', 'status', 'note', 'firstSeenAt'
  ],
  AuditLogs: [
    'timestamp', 'actor', 'action', 'eventId', 'result', 'details'
  ]
});

function setupCalendarStorage() {
  const spreadsheet = ensureCalendarStorage_();
  return {
    spreadsheetId: spreadsheet.getId(),
    spreadsheetUrl: spreadsheet.getUrl(),
    sheets: Object.keys(CALENDAR_HEADERS)
  };
}

function ensureCalendarStorage_() {
  const properties = PropertiesService.getScriptProperties();
  const existingId = String(properties.getProperty(CALENDAR_STORAGE.spreadsheetProperty) || '').trim();

  let spreadsheet = null;
  if (existingId) {
    try {
      spreadsheet = SpreadsheetApp.openById(existingId);
    } catch (error) {
      console.warn('Calendar spreadsheet binding is invalid; creating a new spreadsheet.');
    }
  }

  if (!spreadsheet) {
    spreadsheet = SpreadsheetApp.create('MembershipSystem Calendar Data');
    properties.setProperty(CALENDAR_STORAGE.spreadsheetProperty, spreadsheet.getId());
  }

  Object.keys(CALENDAR_HEADERS).forEach(name => ensureSheet_(spreadsheet, name, CALENDAR_HEADERS[name]));
  return spreadsheet;
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
      throw new Error('Existing sheet "' + name + '" has incompatible headers.');
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
        'lineUserId', 'surface', 'displayName', 'pictureUrl', 'status',
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
