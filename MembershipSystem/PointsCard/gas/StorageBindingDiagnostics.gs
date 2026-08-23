'use strict';

/**
 * Trusted Apps Script editor diagnostic for the storage binding used by PointsCard.
 * This function is intentionally not routed through doGet()/doPost() and must
 * not create a spreadsheet or change Script Properties while inspecting state.
 */
function inspectPointsCardStorageBinding() {
  const properties = PropertiesService.getScriptProperties();
  const configuredSpreadsheetId = String(
    properties.getProperty(POINTS_CARD_SERVICE.spreadsheetProperty) || ''
  ).trim();
  const resolved = pointsCardStorageReadOnlyBinding_(configuredSpreadsheetId);

  if (!resolved.spreadsheet) {
    return {
      serviceVersion: POINTS_CARD_SERVICE.version,
      configuredSpreadsheetId: configuredSpreadsheetId,
      actualSpreadsheetId: '',
      spreadsheetName: '',
      binding: resolved.binding,
      bindingMatchesConfigured: false,
      storageAvailable: false,
      errorCode: resolved.errorCode,
      migration: pointsCardStorageMigrationDiagnostic_(properties),
      schema: null
    };
  }

  const spreadsheet = resolved.spreadsheet;
  const actualSpreadsheetId = String(spreadsheet.getId() || '').trim();
  const spreadsheetName = typeof spreadsheet.getName === 'function'
    ? String(spreadsheet.getName() || '').slice(0, 160)
    : '';

  return {
    serviceVersion: POINTS_CARD_SERVICE.version,
    configuredSpreadsheetId: configuredSpreadsheetId,
    actualSpreadsheetId: actualSpreadsheetId,
    spreadsheetName: spreadsheetName,
    binding: resolved.binding,
    bindingMatchesConfigured: Boolean(
      configuredSpreadsheetId && actualSpreadsheetId === configuredSpreadsheetId
    ),
    storageAvailable: true,
    errorCode: '',
    migration: pointsCardStorageMigrationDiagnostic_(properties),
    schema: pointsCardStorageSchemaHealth_(spreadsheet)
  };
}

function pointsCardStorageReadOnlyBinding_(configuredSpreadsheetId) {
  const configured = String(configuredSpreadsheetId || '').trim();
  if (configured) {
    try {
      return {
        spreadsheet: SpreadsheetApp.openById(configured),
        binding: 'configured',
        errorCode: ''
      };
    } catch (_) {
      return {
        spreadsheet: null,
        binding: 'configured',
        errorCode: 'CONFIGURED_STORAGE_UNAVAILABLE'
      };
    }
  }

  let active = null;
  try {
    if (typeof SpreadsheetApp.getActiveSpreadsheet === 'function') {
      active = SpreadsheetApp.getActiveSpreadsheet();
    }
  } catch (_) {
    active = null;
  }
  if (active) {
    return {
      spreadsheet: active,
      binding: 'active-unconfigured',
      errorCode: ''
    };
  }

  return {
    spreadsheet: null,
    binding: 'unconfigured',
    errorCode: 'STORAGE_UNCONFIGURED'
  };
}

function pointsCardStorageMigrationDiagnostic_(properties) {
  return {
    migratedAt: String(properties.getProperty(MULTI_CARD.migrationProperty) || ''),
    migratedSpreadsheetId: String(properties.getProperty(MULTI_CARD.migrationSpreadsheetProperty) || ''),
    migrationTargetSpreadsheetId: String(properties.getProperty(MULTI_CARD.migrationTargetSpreadsheetProperty) || ''),
    schemaVersion: String(properties.getProperty(MULTI_CARD.schemaVersionProperty) || ''),
    expectedSchemaVersion: MULTI_CARD.schemaVersion
  };
}

function pointsCardStorageSchemaHealth_(spreadsheet) {
  const base = pointsCardStorageSchemaGroupHealth_(spreadsheet, POINTS_CARD_HEADERS);
  const multiCard = pointsCardStorageSchemaGroupHealth_(spreadsheet, MULTI_CARD_HEADERS);
  return {
    healthy: base.healthy && multiCard.healthy,
    base: base,
    multiCard: multiCard
  };
}

function pointsCardStorageSchemaGroupHealth_(spreadsheet, headerMap) {
  const missingSheets = [];
  const invalidSheets = [];

  Object.keys(headerMap).forEach(function (sheetName) {
    const expected = headerMap[sheetName];
    const sheet = spreadsheet.getSheetByName(sheetName);
    if (!sheet) {
      missingSheets.push(sheetName);
      return;
    }

    const lastColumn = Number(sheet.getLastColumn());
    if (lastColumn !== expected.length) {
      invalidSheets.push({
        sheetName: sheetName,
        reason: 'column-count',
        expectedColumns: expected.length,
        actualColumns: lastColumn
      });
      return;
    }

    const headers = sheet.getRange(1, 1, 1, expected.length).getValues()[0].map(String);
    for (let index = 0; index < expected.length; index += 1) {
      if (headers[index] !== expected[index]) {
        invalidSheets.push({
          sheetName: sheetName,
          reason: 'header-order',
          column: index + 1
        });
        break;
      }
    }
  });

  return {
    healthy: missingSheets.length === 0 && invalidSheets.length === 0,
    missingSheets: missingSheets,
    invalidSheets: invalidSheets
  };
}
