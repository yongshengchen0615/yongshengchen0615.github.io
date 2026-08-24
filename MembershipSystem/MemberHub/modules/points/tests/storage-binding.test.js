'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function createProperties(initial) {
  const stored = Object.assign({}, initial);
  return {
    stored,
    service: {
      getProperty: (key) => stored[key] || '',
      setProperty: (key, value) => { stored[key] = String(value); },
      deleteProperty: (key) => { delete stored[key]; }
    }
  };
}

test('storage resolution prefers and binds the active spreadsheet', () => {
  const source = read('gas/Storage.gs') + '\n;globalThis.__bindingTest = { resolvePointsCardSpreadsheet_ };';
  const properties = createProperties({ POINTS_CARD_SPREADSHEET_ID: 'SPREADSHEET-OLD' });
  const activeSpreadsheet = { getId: () => 'SPREADSHEET-ACTIVE' };
  const context = {
    POINTS_CARD_SERVICE: { spreadsheetProperty: 'POINTS_CARD_SPREADSHEET_ID' },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => activeSpreadsheet,
      openById: () => { throw new Error('the configured spreadsheet must not win over the active spreadsheet'); },
      create: () => { throw new Error('an active spreadsheet must not create another file'); }
    },
    fail_: (code, message) => { throw Object.assign(new Error(message), { code }); }
  };
  vm.createContext(context);
  vm.runInContext(source, context);

  const result = context.__bindingTest.resolvePointsCardSpreadsheet_(properties.service, true);
  assert.equal(result.spreadsheet, activeSpreadsheet);
  assert.equal(result.spreadsheetId, 'SPREADSHEET-ACTIVE');
  assert.equal(result.binding, 'active');
  assert.equal(properties.stored.POINTS_CARD_SPREADSHEET_ID, 'SPREADSHEET-ACTIVE');
});

test('storage resolution creates and binds a spreadsheet when no active or configured file exists', () => {
  const source = read('gas/Storage.gs') + '\n;globalThis.__bindingTest = { resolvePointsCardSpreadsheet_ };';
  const properties = createProperties({});
  const createdSpreadsheet = { getId: () => 'SPREADSHEET-CREATED' };
  const context = {
    POINTS_CARD_SERVICE: { spreadsheetProperty: 'POINTS_CARD_SPREADSHEET_ID' },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => null,
      openById: () => { throw new Error('there is no configured spreadsheet'); },
      create: () => createdSpreadsheet
    },
    fail_: (code, message) => { throw Object.assign(new Error(message), { code }); }
  };
  vm.createContext(context);
  vm.runInContext(source, context);

  const result = context.__bindingTest.resolvePointsCardSpreadsheet_(properties.service, true);
  assert.equal(result.spreadsheet, createdSpreadsheet);
  assert.equal(result.binding, 'created');
  assert.equal(result.created, true);
  assert.equal(properties.stored.POINTS_CARD_SPREADSHEET_ID, 'SPREADSHEET-CREATED');
});

test('public initialization binds the active spreadsheet and creates every base and multi-card table', () => {
  const source = [read('gas/Code.gs'), read('gas/Storage.gs'), read('gas/MultiCardStorage.gs')].join('\n') +
    '\n;globalThis.__bindingTest = { initializePointsCardStorage };';
  const properties = createProperties({});
  const activeSpreadsheet = { getId: () => 'SPREADSHEET-ACTIVE' };
  let lockHeld = false;
  let lockReleased = false;
  const context = {
    PropertiesService: { getScriptProperties: () => properties.service },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => activeSpreadsheet,
      openById: () => { throw new Error('active spreadsheet should be reused'); },
      create: () => { throw new Error('active spreadsheet should prevent file creation'); }
    },
    LockService: {
      getScriptLock: () => ({
        tryLock: () => { lockHeld = true; return true; },
        releaseLock: () => { lockHeld = false; lockReleased = true; }
      })
    }
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  const baseSheets = [];
  let multiInitializedWhileLocked = false;
  context.ensureSheetSchema_ = (_spreadsheet, sheetName) => { baseSheets.push(sheetName); };
  context.ensureMultiCardStorageForSpreadsheet_ = (spreadsheet, service) => {
    assert.equal(spreadsheet, activeSpreadsheet);
    assert.equal(service, properties.service);
    multiInitializedWhileLocked = lockHeld;
  };
  context.pointsCardSettings_ = () => ({ rewardNodes: [{ nodeId: 'node-10' }], rewardName: '招牌飲品一份' });

  const result = context.__bindingTest.initializePointsCardStorage();
  assert.deepEqual(baseSheets.sort(), [
    'AuditLogs', 'Members', 'RewardConfirmations', 'RewardRecords', 'StampRecords', 'StampVouchers'
  ]);
  assert.deepEqual(Array.from(result.sheets).sort(), [
    'AuditLogs', 'CardRewardNotifications', 'CardRewardRecords', 'CardStampRecords', 'CardStampVouchers', 'Cards',
    'MemberCardProgress', 'Members', 'RewardConfirmations', 'RewardRecords', 'StampRecords', 'StampVouchers'
  ]);
  assert.equal(result.spreadsheetId, 'SPREADSHEET-ACTIVE');
  assert.equal(result.binding, 'active');
  assert.equal(multiInitializedWhileLocked, true);
  assert.equal(lockReleased, true);
});
