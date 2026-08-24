'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
function read(relativePath) { return fs.readFileSync(path.join(root, relativePath), 'utf8'); }

function schemaSheet(headers) {
  return {
    getLastColumn: () => headers.length,
    getRange: () => ({ getValues: () => [headers.slice()] })
  };
}

test('storage binding diagnostic reports configured/actual drift and a missing progress sheet without mutating storage', () => {
  const source = read('gas/StorageBindingDiagnostics.gs');
  const properties = {
    POINTS_CARD_SPREADSHEET_ID: 'SPREADSHEET-CONFIGURED',
    POINTS_CARD_MULTI_CARD_MIGRATED_AT: '2026-08-23T04:54:36.135Z',
    POINTS_CARD_MULTI_CARD_SPREADSHEET_ID: 'SPREADSHEET-CONFIGURED',
    POINTS_CARD_MULTI_CARD_SCHEMA_VERSION: '3'
  };
  const baseHeaders = { AuditLogs: ['timestamp'] };
  const multiHeaders = {
    Cards: ['cardId', 'status'],
    MemberCardProgress: ['progressId', 'cardId']
  };
  const sheets = {
    AuditLogs: schemaSheet(baseHeaders.AuditLogs),
    Cards: schemaSheet(multiHeaders.Cards)
  };
  const spreadsheet = {
    getId: () => 'SPREADSHEET-ACTUAL',
    getName: () => '集點卡',
    getSheetByName: (name) => sheets[name] || null
  };
  const context = {
    POINTS_CARD_SERVICE: {
      version: '2.3.0',
      spreadsheetProperty: 'POINTS_CARD_SPREADSHEET_ID'
    },
    POINTS_CARD_HEADERS: baseHeaders,
    MULTI_CARD_HEADERS: multiHeaders,
    MULTI_CARD: {
      migrationProperty: 'POINTS_CARD_MULTI_CARD_MIGRATED_AT',
      migrationSpreadsheetProperty: 'POINTS_CARD_MULTI_CARD_SPREADSHEET_ID',
      migrationTargetSpreadsheetProperty: 'POINTS_CARD_MULTI_CARD_MIGRATION_TARGET_ID',
      schemaVersionProperty: 'POINTS_CARD_MULTI_CARD_SCHEMA_VERSION',
      schemaVersion: '3'
    },
    PropertiesService: {
      getScriptProperties: () => ({ getProperty: (key) => properties[key] || '' })
    },
    SpreadsheetApp: {
      openById: (id) => {
        assert.equal(id, 'SPREADSHEET-CONFIGURED');
        return spreadsheet;
      },
      getActiveSpreadsheet: () => { throw new Error('configured binding must not inspect active spreadsheet'); },
      create: () => { throw new Error('diagnostic must never create a spreadsheet'); }
    }
  };
  vm.createContext(context);
  vm.runInContext(source + '\n;globalThis.__inspectStorage = inspectPointsCardStorageBinding;', context);

  const result = context.__inspectStorage();
  assert.equal(result.storageAvailable, true);
  assert.equal(result.binding, 'configured');
  assert.equal(result.configuredSpreadsheetId, 'SPREADSHEET-CONFIGURED');
  assert.equal(result.actualSpreadsheetId, 'SPREADSHEET-ACTUAL');
  assert.equal(result.bindingMatchesConfigured, false);
  assert.equal(result.schema.healthy, false);
  assert.deepEqual(Array.from(result.schema.multiCard.missingSheets), ['MemberCardProgress']);
  assert.equal(result.schema.multiCard.invalidSheets.length, 0);

  assert.doesNotMatch(source, /setProperty\s*\(|appendRow\s*\(|setValues\s*\(|deleteSheet\s*\(|SpreadsheetApp\.create\s*\(/);
});

test('storage binding diagnostic can inspect an unconfigured active sheet without binding or creating storage', () => {
  const source = read('gas/StorageBindingDiagnostics.gs');
  const baseHeaders = { AuditLogs: ['timestamp'] };
  const multiHeaders = { Cards: ['cardId'] };
  const sheets = {
    AuditLogs: schemaSheet(baseHeaders.AuditLogs),
    Cards: schemaSheet(multiHeaders.Cards)
  };
  const spreadsheet = {
    getId: () => 'SPREADSHEET-ACTIVE',
    getName: () => 'Active Sheet',
    getSheetByName: (name) => sheets[name] || null
  };
  const context = {
    POINTS_CARD_SERVICE: { version: '2.3.0', spreadsheetProperty: 'POINTS_CARD_SPREADSHEET_ID' },
    POINTS_CARD_HEADERS: baseHeaders,
    MULTI_CARD_HEADERS: multiHeaders,
    MULTI_CARD: {
      migrationProperty: 'MIGRATED_AT',
      migrationSpreadsheetProperty: 'MIGRATED_SHEET',
      migrationTargetSpreadsheetProperty: 'MIGRATION_TARGET',
      schemaVersionProperty: 'SCHEMA_VERSION',
      schemaVersion: '3'
    },
    PropertiesService: {
      getScriptProperties: () => ({ getProperty: () => '' })
    },
    SpreadsheetApp: {
      openById: () => { throw new Error('unconfigured diagnostic must not open an arbitrary id'); },
      getActiveSpreadsheet: () => spreadsheet,
      create: () => { throw new Error('diagnostic must never create a spreadsheet'); }
    }
  };
  vm.createContext(context);
  vm.runInContext(source + '\n;globalThis.__inspectStorage = inspectPointsCardStorageBinding;', context);

  const result = context.__inspectStorage();
  assert.equal(result.storageAvailable, true);
  assert.equal(result.binding, 'active-unconfigured');
  assert.equal(result.configuredSpreadsheetId, '');
  assert.equal(result.actualSpreadsheetId, 'SPREADSHEET-ACTIVE');
  assert.equal(result.bindingMatchesConfigured, false);
  assert.equal(result.schema.healthy, true);
});

test('deleted-card diagnostic returns storage-schema-incomplete instead of throwing when MemberCardProgress is missing', () => {
  const source = read('gas/DeletedCardIntegrityDiagnostics.gs');
  const existingSheetNames = new Set([
    'Cards', 'CardStampVouchers', 'CardStampRecords', 'CardRewardRecords',
    'CardRewardNotifications', 'AuditLogs'
  ]);
  const spreadsheet = {
    getSheetByName: (name) => existingSheetNames.has(name) ? { name } : null
  };
  const auditSheet = { getLastRow: () => 1 };
  const context = {
    console,
    MULTI_CARD_SHEETS: {
      cards: 'Cards',
      progress: 'MemberCardProgress',
      vouchers: 'CardStampVouchers',
      stampRecords: 'CardStampRecords',
      rewardRecords: 'CardRewardRecords',
      notifications: 'CardRewardNotifications'
    },
    POINTS_CARD_SHEETS: { audit: 'AuditLogs' },
    POINTS_CARD_HEADERS: {
      AuditLogs: ['timestamp', 'actorLineUserId', 'actorRole', 'action', 'targetLineUserId', 'result', 'details']
    },
    getSpreadsheet_: () => spreadsheet,
    validMultiCardId_: (value) => String(value),
    findMultiCard_: () => ({
      card: {
        cardId: 'CARD-DELETED', storedStatus: 'deleted', status: 'deleted',
        available: false, updatedAt: '2026-08-20T00:00:00.000Z'
      }
    }),
    getMultiCardSheet_: (name) => {
      if (name === 'MemberCardProgress') throw new Error('diagnostic must not open a missing progress sheet');
      return { name };
    },
    readMultiCardObjectsByField_: () => [],
    getSheet_: (name) => {
      assert.equal(name, 'AuditLogs');
      return auditSheet;
    },
    fail_: (code, message) => { throw Object.assign(new Error(message), { code }); }
  };
  vm.createContext(context);
  vm.runInContext(source + '\n;globalThis.__diagnose = diagnosePointsCardDeletedCardRetention;', context);

  const result = context.__diagnose('CARD-DELETED');
  assert.equal(result.classification, 'storage-schema-incomplete');
  assert.equal(result.schemaHealth.complete, false);
  assert.deepEqual(Array.from(result.schemaHealth.missingMultiCardSheets), ['MemberCardProgress']);
  assert.equal(result.retainedRows.progress, null);
  assert.equal(result.recoverableFromCurrentRows, false);
});
