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

function publicError(code, message) {
  const error = new Error(message);
  error.publicCode = code;
  throw error;
}

test('reward settings lock as soon as a member earns the first entitlement', () => {
  const context = { Array, Date, JSON, Math, Number, Object, String, console };
  vm.createContext(context);
  vm.runInContext(
    read('gas/MultiCardStorage.gs') + '\n;globalThis.__hardening = { rewardSettingsLockedForCard_ };',
    context
  );

  const sheets = {
    MemberCardProgress: { name: 'MemberCardProgress' },
    CardRewardRecords: { name: 'CardRewardRecords' }
  };
  let progressRows = [];
  let rewardRows = [];

  context.findMultiCard_ = () => ({
    card: {
      cardId: 'CARD-ONE',
      rewardNodes: [{ stampsRequired: 3 }, { stampsRequired: 10 }]
    }
  });
  context.getMultiCardSheet_ = (name) => sheets[name];
  context.readMultiCardObjects_ = (sheet) => sheet.name === 'MemberCardProgress' ? progressRows : rewardRows;
  context.storedNonNegativeInt_ = (value, max) => {
    const number = Number(value);
    if (!Number.isInteger(number) || number < 0 || number > max) publicError('DATA_INTEGRITY_ERROR', 'invalid total');
    return number;
  };

  progressRows = [{ cardId: 'CARD-ONE', totalStamps: 2 }];
  assert.equal(context.__hardening.rewardSettingsLockedForCard_('CARD-ONE'), false);

  progressRows = [{ cardId: 'CARD-ONE', totalStamps: 3 }];
  assert.equal(context.__hardening.rewardSettingsLockedForCard_('CARD-ONE'), true);

  progressRows = [{ cardId: 'CARD-ONE', totalStamps: 0 }];
  rewardRows = [{ cardId: 'CARD-ONE', status: 'recorded' }];
  assert.equal(context.__hardening.rewardSettingsLockedForCard_('CARD-ONE'), true);
});

test('missing card data fails closed for reward settings mutations', () => {
  const context = { Array, Date, JSON, Math, Number, Object, String, console };
  vm.createContext(context);
  vm.runInContext(
    read('gas/MultiCardStorage.gs') + '\n;globalThis.__hardening = { rewardSettingsLockedForCard_ };',
    context
  );
  context.findMultiCard_ = () => null;
  assert.equal(context.__hardening.rewardSettingsLockedForCard_('CARD-MISSING'), true);
});

test('reward projection exposes all earned unclaimed tickets beyond twenty', () => {
  const context = { Array, Date, JSON, Math, Number, Object, Set, String, console };
  vm.createContext(context);
  vm.runInContext(
    read('gas/Code.gs') + '\n;globalThis.__hardening = { rewardProjection_ };',
    context
  );

  const settings = {
    cardSize: 1,
    rewardNodes: [{
      nodeId: 'node-1',
      stampsRequired: 1,
      rewardName: '測試票券',
      rewardType: 'coupon',
      lotteryPrizes: [],
      ticketValidityDays: 0,
      unusedReminderDays: 0
    }]
  };
  const projection = context.__hardening.rewardProjection_(
    { totalStamps: 25, redeemedRewards: 0 },
    settings,
    []
  );

  assert.equal(projection.availableRewards, 25);
  assert.equal(projection.availableRewardNodes.length, 25);
  assert.equal(projection.availableRewardNodes[0].entitlementOrdinal, 1);
  assert.equal(projection.availableRewardNodes[24].entitlementOrdinal, 25);
});

test('reward confirmation QR lifetime is capped at fifteen minutes', () => {
  const context = {
    Array, Date, JSON, Math, Number, Object, String, console,
    cleanText_: (value, maxLength, required) => {
      const text = String(value == null ? '' : value).trim();
      if (required && !text) publicError('INVALID_INPUT', 'required');
      if (text.length > maxLength) publicError('INVALID_INPUT', 'too long');
      return text;
    },
    fail_: publicError
  };
  vm.createContext(context);
  vm.runInContext(
    read('gas/RewardConfirmationService.gs') + '\n;globalThis.__hardening = { validRewardConfirmationExpiry_ };',
    context
  );

  const tenMinutes = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  assert.equal(context.__hardening.validRewardConfirmationExpiry_(tenMinutes), tenMinutes);

  const sixteenMinutes = new Date(Date.now() + 16 * 60 * 1000).toISOString();
  assert.throws(
    () => context.__hardening.validRewardConfirmationExpiry_(sixteenMinutes),
    (error) => error && error.publicCode === 'INVALID_EXPIRY' && /15 分鐘/.test(error.message)
  );
});

test('storage initialization preserves an existing configured production spreadsheet binding', () => {
  const stored = { POINTS_CARD_SPREADSHEET_ID: 'SPREADSHEET-PROD' };
  const properties = {
    getProperty: (key) => stored[key] || '',
    setProperty: (key, value) => { stored[key] = String(value); }
  };
  const configuredSpreadsheet = { getId: () => 'SPREADSHEET-PROD' };
  let activeSpreadsheetReads = 0;
  let openedId = '';
  const context = {
    Array, Date, JSON, Math, Number, Object, String, console,
    POINTS_CARD_SERVICE: { spreadsheetProperty: 'POINTS_CARD_SPREADSHEET_ID' },
    POINTS_CARD_HEADERS: { Members: [] },
    MULTI_CARD_HEADERS: { Cards: [] },
    requestSpreadsheet_: null,
    requestSheets_: {},
    requestMultiCardSheets_: {},
    requestMultiCardObjects_: {},
    requestMultiCardLookupObjects_: {},
    PropertiesService: { getScriptProperties: () => properties },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => {
        activeSpreadsheetReads += 1;
        return { getId: () => 'SPREADSHEET-WRONG-ACTIVE' };
      },
      openById: (id) => {
        openedId = id;
        return configuredSpreadsheet;
      },
      create: () => { throw new Error('configured storage must never create a replacement spreadsheet'); }
    },
    LockService: {
      getScriptLock: () => ({ tryLock: () => true, releaseLock() {} })
    },
    fail_: publicError
  };
  vm.createContext(context);
  vm.runInContext(read('gas/Storage.gs') + '\n;globalThis.__hardening = { initializePointsCardStorage };', context);
  context.ensurePointsCardBaseStorage_ = () => {};
  context.ensureMultiCardStorageForSpreadsheet_ = () => {};
  context.pointsCardSettings_ = () => ({});

  const result = context.__hardening.initializePointsCardStorage();
  assert.equal(result.binding, 'configured');
  assert.equal(result.spreadsheetId, 'SPREADSHEET-PROD');
  assert.equal(openedId, 'SPREADSHEET-PROD');
  assert.equal(activeSpreadsheetReads, 0);
  assert.equal(stored.POINTS_CARD_SPREADSHEET_ID, 'SPREADSHEET-PROD');
});

test('PointsCard has a dedicated production GAS deployment contract', () => {
  const workflowPath = path.resolve(root, '..', '..', '..', '..', '.github', 'workflows', 'deploy-membership-points-card-gas.yml');
  const workflow = fs.readFileSync(workflowPath, 'utf8');

  assert.match(workflow, /MembershipSystem\/PointsCard\/gas\/\*\*/);
  assert.match(workflow, /MembershipSystem\/PointsCard\/shared\/config\.json/);
  assert.match(workflow, /MEMBERSHIP_POINTS_CARD_GAS_SCRIPT_ID/);
  assert.match(workflow, /data\.data\?\.service !== 'PointsCard'/);
  assert.match(workflow, /data\.data\?\.version !== '2\.3\.0'/);
  assert.doesNotMatch(workflow, /MembershipSystem\/point-card\//);
});
