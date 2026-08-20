'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
function read(relativePath) { return fs.readFileSync(path.join(root, relativePath), 'utf8'); }

test('card deletion is destructive for card-owned points and transactions and has no resurrection path', () => {
  const source = read('gas/MultiCardStorage.gs');
  const start = source.indexOf('function adminCardDeleteMultiCard_');
  const end = source.indexOf('function rewardSettingsLockedForCard_', start);
  const deletion = source.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(deletion, /CARD_DELETE_REQUESTED/);
  assert.match(deletion, /CARD_DELETED/);
  assert.match(deletion, /deleteCounts/);
  assert.match(deletion, /MULTI_CARD_SHEETS\.progress/);
  assert.match(deletion, /MULTI_CARD_SHEETS\.vouchers/);
  assert.match(deletion, /MULTI_CARD_SHEETS\.stampRecords/);
  assert.match(deletion, /MULTI_CARD_SHEETS\.rewardRecords/);
  assert.match(deletion, /MULTI_CARD_SHEETS\.cards/);
  assert.match(deletion, /String\(row\.cardId \|\| ''\) === cardId/g);
  assert.doesNotMatch(deletion, /cancelActiveStampVouchersForCardLifecycle_/);
  assert.doesNotMatch(deletion, /status\s*=\s*['"]deleted['"]/);
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
