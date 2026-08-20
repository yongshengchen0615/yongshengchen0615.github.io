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
  assert.match(deletion, /row\.cardId === cardId/g);
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
  assert.match(source, /member\.totalStamps = 0/);
  assert.match(source, /member\.redeemedRewards = 0/);
  assert.match(source, /POINTS_CARD_MULTI_CARD_MIGRATED_AT/);
});
