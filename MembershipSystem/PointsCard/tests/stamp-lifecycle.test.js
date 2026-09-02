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

test('stamp QR supports limited and unlimited expiry without treating blank expiry as expired', () => {
  const stamps = read('gas/StampService.gs');
  const source = stamps + '\n;globalThis.__stampLifecycleTest = { validateVoucherForStamp_ };';
  const context = {
    Date,
    Array,
    String,
    Number,
    Object,
    Math,
    console,
    fail_(code, message) {
      throw Object.assign(new Error(message), { code });
    }
  };
  vm.createContext(context);
  vm.runInContext(source, context);

  assert.doesNotThrow(() => context.__stampLifecycleTest.validateVoucherForStamp_({
    status: 'active',
    expiresAt: ''
  }));

  assert.throws(() => context.__stampLifecycleTest.validateVoucherForStamp_({
    status: 'active',
    expiresAt: '2000-01-01T00:00:00.000Z'
  }), (error) => error.code === 'VOUCHER_EXPIRED');

  assert.throws(() => context.__stampLifecycleTest.validateVoucherForStamp_({
    status: 'deleted',
    expiresAt: ''
  }), (error) => error.code === 'VOUCHER_INACTIVE');

  assert.match(stamps, /rawExpiresAt \? validIsoFuture_\(rawExpiresAt\) : ''/);
});

test('reward confirmation QR supports limited and unlimited expiry without treating blank expiry as expired', () => {
  const confirmations = read('gas/RewardConfirmationService.gs');
  const source = confirmations + '\n;globalThis.__rewardConfirmationLifecycleTest = { validRewardConfirmationExpiry_, validateRewardConfirmationForClaim_ };';
  const context = {
    Date,
    Array,
    String,
    Number,
    Object,
    Math,
    console,
    cleanText_(value, maxLength, required) {
      const text = String(value == null ? '' : value).trim();
      if (required && !text) throw Object.assign(new Error('required'), { code: 'INVALID_INPUT' });
      if (text.length > maxLength) throw Object.assign(new Error('too long'), { code: 'INVALID_INPUT' });
      return text;
    },
    fail_(code, message) {
      throw Object.assign(new Error(message), { code });
    }
  };
  vm.createContext(context);
  vm.runInContext(source, context);

  assert.equal(context.__rewardConfirmationLifecycleTest.validRewardConfirmationExpiry_(''), '');
  assert.doesNotThrow(() => context.__rewardConfirmationLifecycleTest.validateRewardConfirmationForClaim_({
    status: 'active',
    expiresAt: ''
  }));
  assert.throws(() => context.__rewardConfirmationLifecycleTest.validateRewardConfirmationForClaim_({
    status: 'active',
    expiresAt: '2000-01-01T00:00:00.000Z'
  }), (error) => error.code === 'REWARD_CONFIRMATION_EXPIRED');

  assert.match(confirmations, /if \(!text\) return '';/);
  assert.match(confirmations, /if \(confirmation\.expiresAt && new Date\(confirmation\.expiresAt\)\.getTime\(\) <= Date\.now\(\)\)/);
});

test('used stamp QR deletion preserves history while removing deleted QR from admin list', () => {
  const stamps = read('gas/StampService.gs');
  assert.match(stamps, /voucher\.status = 'deleted'/);
  assert.match(stamps, /preserveHistory: hasRecords/);
  assert.match(stamps, /voucher\.status !== 'deleted'/);
  assert.match(stamps, /deleteObjectRow_\(sheet, match\.row\)/);
});

test('admin expiry controls and QR loading state are wired without syntax errors', () => {
  const html = read('admin/index.html');
  const script = read('admin/app.js');

  assert.match(html, /id="stampExpiryMode"/);
  assert.match(html, /value="unlimited">無期限/);
  assert.match(html, /id="stampExpiryField"/);
  assert.match(html, /id="stampUrlField"/);

  assert.match(script, /function syncStampExpiryMode/);
  assert.match(script, /expiresAt: ''/);
  assert.match(script, /voucher\.expiresAt \? PointsCard\.formatDateTime\(voucher\.expiresAt, '—'\) : '無期限'/);
  assert.match(script, /function showStampLoadingState/);
  assert.match(script, /showStampLoadingState\(\);\s*openDialog\(\$\('stampDialog'\)\);\s*try \{\s*const result = await PointsCard\.callApi\('admin\.stamp\.open'/s);
  assert.match(script, /歷史集點與稽核紀錄會保留/);

  assert.doesNotThrow(() => new vm.Script(script));
});

test('admin reward confirmation expiry controls support unlimited QR and display its state', () => {
  const html = read('admin/index.html');
  const script = read('admin/app.js');

  assert.match(html, /id="rewardConfirmationExpiryMode"/);
  assert.match(html, /id="rewardConfirmationExpiryMode"[^>]*>[^]*value="limited"[^]*value="unlimited">無期限/);
  assert.match(html, /id="rewardConfirmationExpiryField"/);
  assert.match(script, /function syncRewardConfirmationExpiryMode/);
  assert.match(script, /expiresAt: '', note: \$\('rewardConfirmationNote'\)\.value\.trim\(\)/);
  assert.match(script, /confirmation\.expiresAt \? PointsCard\.formatDateTime\(confirmation\.expiresAt, '—'\) : '無期限'/);
  assert.match(script, /'無期限'/);
});

test('member ticket wallet groups duplicate tickets and retains the earliest-expiring claim target', () => {
  const script = read('user/app.js');
  const marker = '  init().catch(showFatalError);\n})();';
  const source = script.replace(marker, '  globalThis.__ticketWalletTest = { groupEarnedTickets };\n})();');
  assert.notEqual(source, script, 'ticket grouping test hook must replace startup');
  const context = { Array, Date, Intl, Map, Math, Number, Object, Set, String, WeakMap, console };
  vm.createContext(context);
  vm.runInContext(source, context);

  const grouped = context.__ticketWalletTest.groupEarnedTickets([
    { cardId: 'CARD-1', nodeId: 'NODE-COFFEE', rewardName: '咖啡優惠券', rewardType: 'coupon', expiresAt: '2030-02-01T00:00:00.000Z', usable: true, expired: false, entitlementOrdinal: 8 },
    { cardId: 'CARD-1', nodeId: 'NODE-COFFEE', rewardName: '咖啡優惠券', rewardType: 'coupon', expiresAt: '2030-01-01T00:00:00.000Z', usable: true, expired: false, entitlementOrdinal: 3 },
    { cardId: 'CARD-1', nodeId: 'NODE-COFFEE', rewardName: '咖啡優惠券', rewardType: 'coupon', expiresAt: '2000-01-01T00:00:00.000Z', usable: false, expired: true, entitlementOrdinal: 1 }
  ]);

  assert.equal(grouped.length, 2, 'expired tickets stay visibly distinct from usable tickets');
  assert.equal(grouped[0].ticketCount, 2);
  assert.equal(grouped[0].entitlementOrdinal, 3);
  assert.equal(grouped[0].expiresAt, '2030-01-01T00:00:00.000Z');
  assert.equal(grouped[1].ticketCount, 1);
  assert.match(script, /function groupEarnedTickets/);
  assert.match(script, /earnedGroups\.forEach/);
  assert.match(script, /ticket-quantity/);
  assert.match(read('user/styles.css'), /\.ticket-quantity/);
});
