'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
function read(relativePath) { return fs.readFileSync(path.join(root, relativePath), 'utf8'); }

test('card deletion archives the card, revokes active stamp QR, and preserves member tickets and history', () => {
  const source = read('gas/MultiCardStorage.gs');
  const start = source.indexOf('function adminCardDeleteMultiCard_');
  const end = source.indexOf('function rewardSettingsLockedForCard_', start);
  const deletion = source.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(deletion, /CARD_DELETE_REQUESTED/);
  assert.match(deletion, /CARD_DELETED/);
  assert.match(deletion, /preservedCounts/);
  assert.match(deletion, /MULTI_CARD_SHEETS\.progress/);
  assert.match(deletion, /MULTI_CARD_SHEETS\.vouchers/);
  assert.match(deletion, /MULTI_CARD_SHEETS\.stampRecords/);
  assert.match(deletion, /MULTI_CARD_SHEETS\.rewardRecords/);
  assert.match(deletion, /MULTI_CARD_SHEETS\.cards/);
  assert.match(deletion, /cancelActiveMultiCardStampVouchersForCard_/);
  assert.match(deletion, /storedStatus:\s*'deleted'/);
  assert.match(deletion, /preservedUnusedRewards:\s*true/);
  assert.doesNotMatch(deletion, /deleteMultiCardRowsWhere_/);
  assert.doesNotMatch(deletion, /deleteMultiCardObjectRow_/);
  assert.doesNotMatch(source, /function adminCardReactivateMultiCard_/);
});

test('migration clears legacy point counters and legacy transactional rows after copying', () => {
  const source = read('gas/MultiCardStorage.gs');
  assert.match(source, /migrateLegacyProgress_/);
  assert.match(source, /migrateLegacyVouchers_/);
  assert.match(source, /migrateLegacyStampRecords_/);
  assert.match(source, /migrateLegacyRewardRecords_/);
  assert.match(source, /clearLegacyTransactionalData_\(\)/);
  assert.match(source, /clearLegacyMemberCounters_\(\)/);
  assert.match(source, /fresh\.totalStamps = 0/);
  assert.match(source, /fresh\.redeemedRewards = 0/);
  assert.match(source, /POINTS_CARD_MULTI_CARD_MIGRATED_AT/);
});

test('migration retry path copies missing legacy rows before clearing legacy sources', () => {
  const source = read('gas/MultiCardStorage.gs');
  const start = source.indexOf('function migrateLegacyPointsCard_');
  const end = source.indexOf('function migrateLegacyProgress_', start);
  const migration = source.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(migration, /legacyCardMatch/);
  assert.match(migration, /if \(!legacyCardMatch\)/);
  assert.doesNotMatch(migration, /readMultiCardObjects_\(cardsSheet\)\.length[\s\S]*return/);

  const progressIndex = migration.indexOf('migrateLegacyProgress_(now)');
  const voucherIndex = migration.indexOf('migrateLegacyVouchers_()');
  const stampIndex = migration.indexOf('migrateLegacyStampRecords_()');
  const rewardIndex = migration.indexOf('migrateLegacyRewardRecords_()');
  const clearTransactionsIndex = migration.indexOf('clearLegacyTransactionalData_()');
  const clearMembersIndex = migration.indexOf('clearLegacyMemberCounters_()');

  assert.ok(progressIndex >= 0);
  assert.ok(voucherIndex > progressIndex);
  assert.ok(stampIndex > voucherIndex);
  assert.ok(rewardIndex > stampIndex);
  assert.ok(clearTransactionsIndex > rewardIndex);
  assert.ok(clearMembersIndex > clearTransactionsIndex);

  const helper = source.slice(source.indexOf('function appendMultiCardIfMissing_'), start);
  assert.match(helper, /findMultiCardByFieldWithRow_/);
  assert.match(helper, /appendMultiCardObject_/);
});

test('card deletion mutation writes only archived card and cancelled QR state', () => {
  const source = read('gas/MultiCardStorage.gs') + '\n;globalThis.__deleteCard = adminCardDeleteMultiCard_;';
  const writes = [];
  const sheets = {
    Cards: { name: 'Cards' },
    MemberCardProgress: { name: 'MemberCardProgress' },
    CardStampVouchers: { name: 'CardStampVouchers' },
    CardStampRecords: { name: 'CardStampRecords' },
    CardRewardRecords: { name: 'CardRewardRecords' }
  };
  const context = {
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) }
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  context.ensureMultiCardStorage_ = () => {};
  context.validMultiCardId_ = (value) => value;
  context.cleanText_ = (value) => String(value);
  context.findMultiCard_ = () => ({
    row: 2,
    card: {
      cardId: 'CARD-ONE', name: '保留票券卡', description: '', storedStatus: 'active', status: 'active',
      available: true, expiresAt: '', rewardNodes: [{ stampsRequired: 1, rewardName: '優惠券' }],
      rewardNodesUpdatedAt: 'v1', createdByLineUserId: 'UADMIN', createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-02T00:00:00.000Z'
    }
  });
  context.getMultiCardSheet_ = (name) => sheets[name];
  context.readMultiCardObjects_ = (sheet) => {
    if (sheet.name === 'MemberCardProgress') return [{ cardId: 'CARD-ONE' }];
    if (sheet.name === 'CardStampRecords') return [{ cardId: 'CARD-ONE' }];
    if (sheet.name === 'CardRewardRecords') return [{ cardId: 'CARD-ONE', status: 'recorded' }];
    return [];
  };
  context.writeMultiCardObjectRow_ = (sheet, row, value) => { writes.push({ sheet: sheet.name, row, value }); };
  context.audit_ = () => true;
  context.deleteMultiCardRowsWhere_ = () => { throw new Error('history rows must not be deleted'); };
  context.deleteMultiCardObjectRow_ = () => { throw new Error('card row must be archived, not deleted'); };

  const result = context.__deleteCard({ identity: { sub: 'UADMIN' } }, {
    cardId: 'CARD-ONE', expectedUpdatedAt: '2026-08-02T00:00:00.000Z'
  });
  assert.equal(result.archived, true);
  assert.deepEqual(JSON.parse(JSON.stringify(result.deleted)), {
    progress: 0, vouchers: 0, stampRecords: 0, rewardRecords: 0
  });
  assert.equal(result.preserved.progress, 1);
  assert.equal(result.preserved.stampRecords, 1);
  assert.equal(result.preserved.rewardRecords, 1);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].sheet, 'Cards');
  assert.equal(writes[0].value.status, 'deleted');
});
