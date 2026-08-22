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

test('reward confirmation QR lifetime is independently capped at seven days', () => {
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

  const sixDays = new Date(Date.now() + 6 * 24 * 60 * 60 * 1000).toISOString();
  assert.equal(context.__hardening.validRewardConfirmationExpiry_(sixDays), sixDays);

  const eightDays = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000).toISOString();
  assert.throws(
    () => context.__hardening.validRewardConfirmationExpiry_(eightDays),
    (error) => error && error.publicCode === 'INVALID_EXPIRY' && /7 天/.test(error.message)
  );
});

test('PointsCard has a dedicated production GAS deployment contract', () => {
  const workflowPath = path.resolve(root, '..', '..', '.github', 'workflows', 'deploy-membership-points-card-gas.yml');
  const workflow = fs.readFileSync(workflowPath, 'utf8');

  assert.match(workflow, /MembershipSystem\/PointsCard\/gas\/\*\*/);
  assert.match(workflow, /MembershipSystem\/PointsCard\/shared\/config\.json/);
  assert.match(workflow, /MEMBERSHIP_POINTS_CARD_GAS_SCRIPT_ID/);
  assert.match(workflow, /data\.data\?\.service !== 'PointsCard'/);
  assert.match(workflow, /data\.data\?\.version !== '2\.3\.0'/);
  assert.doesNotMatch(workflow, /MembershipSystem\/point-card\//);
});
