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

test('member API no longer performs unused activity full-table scans', () => {
  const code = read('gas/Code.gs');
  const stamps = read('gas/StampService.gs');
  assert.doesNotMatch(code, /listMemberActivity_/);
  assert.doesNotMatch(stamps, /listMemberActivity_/);
  assert.doesNotMatch(code, /activity:\s*listMemberActivity_/);
  assert.doesNotMatch(stamps, /activity:\s*listMemberActivity_/);
});

test('migrated multi-card requests skip the redundant full schema initialization pass', () => {
  const source = read('gas/MultiCardStorage.gs') + '\n;globalThis.__multiCardOptimizationTest = { ensureMultiCardStorage_ };';
  let spreadsheetReads = 0;
  let lockReads = 0;
  const context = {
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key) => key === 'POINTS_CARD_MULTI_CARD_MIGRATED_AT' ? '2026-08-20T00:00:00.000Z' : ''
      })
    },
    getSpreadsheet_: () => { spreadsheetReads += 1; throw new Error('migrated requests must not initialize every sheet'); },
    LockService: { getScriptLock: () => { lockReads += 1; throw new Error('migrated requests must not acquire the migration lock'); } }
  };
  vm.createContext(context);
  vm.runInContext(source, context);

  context.__multiCardOptimizationTest.ensureMultiCardStorage_();
  assert.equal(spreadsheetReads, 0);
  assert.equal(lockReads, 0);
});

test('an unmigrated deployment still validates every multi-card sheet before migration', () => {
  const source = read('gas/MultiCardStorage.gs') + '\n;globalThis.__multiCardMigrationTest = { ensureMultiCardStorage_ };';
  const stored = {};
  let lockReleased = false;
  const context = {
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key) => stored[key] || '',
        setProperty: (key, value) => { stored[key] = value; }
      })
    },
    LockService: {
      getScriptLock: () => ({
        tryLock: () => true,
        releaseLock: () => { lockReleased = true; }
      })
    },
    getSpreadsheet_: () => ({})
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  const validatedSheets = [];
  let migrations = 0;
  context.ensureMultiCardSheetSchema_ = (_spreadsheet, name) => { validatedSheets.push(name); };
  context.migrateLegacyPointsCard_ = () => { migrations += 1; };

  context.__multiCardMigrationTest.ensureMultiCardStorage_();
  assert.deepEqual(validatedSheets.sort(), [
    'CardRewardRecords', 'CardStampRecords', 'CardStampVouchers', 'Cards', 'MemberCardProgress'
  ]);
  assert.equal(migrations, 1);
  assert.match(stored.POINTS_CARD_MULTI_CARD_MIGRATED_AT, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(lockReleased, true);
});

test('multi-card member boot reuses the synchronized member without building a discarded legacy projection', () => {
  const code = read('gas/Code.gs');
  const multiCard = read('gas/MultiCardStorage.gs');
  assert.match(code, /function memberMe_\(context, skipProjection\)/);
  assert.match(code, /if \(skipProjection\) return \{ member: normalizeMember_\(member\) \};/);
  assert.match(multiCard, /const synchronizedMember = memberMe_\(context, true\)\.member;/);
  const memberBoot = multiCard.match(/function memberMeMultiCard_\([\s\S]*?\n\}/)[0];
  assert.doesNotMatch(memberBoot, /findByFieldWithRow_/);
});

test('member boot overlaps critical downloads and allows the public config response to be reused', () => {
  const entry = read('index.html');
  const member = read('user/index.html');
  const redirect = read('redirect.js');
  const common = read('shared/common.js');

  assert.match(entry, /rel="preconnect" href="https:\/\/static\.line-scdn\.net"/);
  assert.match(entry, /rel="preload" href="\.\/shared\/config\.json" as="fetch"/);
  assert.match(entry, /<script defer src="https:\/\/static\.line-scdn\.net\/liff\/edge\/2\/sdk\.js"><\/script>/);
  assert.match(member, /rel="preload" href="\.\.\/shared\/config\.json" as="fetch"/);
  assert.match(member, /<script defer src="\.\.\/shared\/common\.js"><\/script>/);
  assert.match(member, /<script defer src="\.\/app\.js"><\/script>/);
  assert.doesNotMatch(redirect, /cache:\s*'no-store'/);
  assert.doesNotMatch(common, /new URL\('\.\.\/shared\/config\.json'[\s\S]{0,220}cache:\s*'no-store'/);
  assert.match(common, /function preconnectApi\(gasUrl\)/);
});

test('admin data is split into independently authorized query routes', () => {
  const code = read('gas/Code.gs');
  const admin = read('admin/app.js');
  for (const action of [
    'admin.summary',
    'admin.members.search',
    'admin.stamps.list',
    'admin.reward-confirmations.list'
  ]) {
    assert.match(code, new RegExp("case '" + action.replace(/[.]/g, '\\.') + "'"));
    assert.match(admin, new RegExp("PointsCard\\.callApi\\('" + action.replace(/[.]/g, '\\.') + "'"));
  }
  assert.doesNotMatch(admin, /PointsCard\.callApi\('admin\.dashboard'/);
  assert.match(admin, /loadAdminTab\(nextTab, false\)/);
  assert.match(admin, /memberSearch[\s\S]*loadMembers/);
});

test('per-member stamp mode rejects a second recorded use by the same member', () => {
  const source = read('gas/StampService.gs') + '\n;globalThis.__stampTest = { assertVoucherUsageAllowed_ };';
  const context = {
    Array,
    fail_: (code, message) => { throw Object.assign(new Error(message), { code }); }
  };
  vm.createContext(context);
  vm.runInContext(source, context);

  const voucher = { voucherId: 'SQ-1', scanMode: 'per-member' };
  const records = [
    { voucherId: 'SQ-1', memberLineUserId: 'U1', status: 'recorded' },
    { voucherId: 'SQ-1', memberLineUserId: 'U2', status: 'recorded' }
  ];
  assert.throws(
    () => context.__stampTest.assertVoucherUsageAllowed_(voucher, records, 'U1'),
    (error) => error && error.code === 'VOUCHER_USED'
  );
  assert.doesNotThrow(() => context.__stampTest.assertVoucherUsageAllowed_(voucher, records, 'U3'));
});

test('legacy single and repeatable stamp modes remain backward compatible', () => {
  const source = read('gas/StampService.gs') + '\n;globalThis.__stampTest = { assertVoucherUsageAllowed_ };';
  const context = {
    Array,
    fail_: (code, message) => { throw Object.assign(new Error(message), { code }); }
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  const records = [{ voucherId: 'SQ-1', memberLineUserId: 'U1', status: 'recorded' }];
  assert.throws(
    () => context.__stampTest.assertVoucherUsageAllowed_({ voucherId: 'SQ-1', scanMode: 'single' }, records, 'U2'),
    (error) => error && error.code === 'VOUCHER_USED'
  );
  assert.doesNotThrow(() => context.__stampTest.assertVoucherUsageAllowed_({ voucherId: 'SQ-1', scanMode: 'repeatable' }, records, 'U1'));
});

test('request-scoped sheet cache reads once and invalidates after writes', () => {
  const source = read('gas/Storage.gs') + '\n;globalThis.__storageOptimizationTest = { readObjects_, appendObject_, writeObjectRow_, deleteObjectRow_ };';
  let readCount = 0;
  let appendCount = 0;
  let deleteCount = 0;
  const sheet = {
    getName: () => 'Members',
    getLastRow: () => 2,
    getRange: () => ({
      getValues() {
        readCount += 1;
        return [['U1']];
      },
      setValues() {}
    }),
    appendRow() { appendCount += 1; },
    deleteRow() { deleteCount += 1; }
  };
  const context = {
    POINTS_CARD_HEADERS: { Members: ['lineUserId'] },
    String,
    Object,
    JSON,
    console
  };
  vm.createContext(context);
  vm.runInContext(source, context);

  assert.equal(context.__storageOptimizationTest.readObjects_(sheet)[0].lineUserId, 'U1');
  context.__storageOptimizationTest.readObjects_(sheet);
  assert.equal(readCount, 1, 'second read in the same request should use the snapshot cache');

  context.__storageOptimizationTest.appendObject_(sheet, { lineUserId: 'U2' });
  assert.equal(appendCount, 1);
  context.__storageOptimizationTest.readObjects_(sheet);
  assert.equal(readCount, 2, 'append invalidates cached rows');

  context.__storageOptimizationTest.writeObjectRow_(sheet, 2, { lineUserId: 'U1' });
  context.__storageOptimizationTest.readObjects_(sheet);
  assert.equal(readCount, 3, 'row update invalidates cached rows');

  context.__storageOptimizationTest.deleteObjectRow_(sheet, 2);
  assert.equal(deleteCount, 1);
  context.__storageOptimizationTest.readObjects_(sheet);
  assert.equal(readCount, 4, 'row deletion invalidates cached rows');
});

test('API responses expose trace IDs without logging credentials or mutation payloads', () => {
  const code = read('gas/Code.gs');
  const common = read('shared/common.js');
  assert.match(code, /meta[\s\S]*traceId/);
  assert.match(code, /points_card_api/);
  assert.match(code, /durationMs/);
  assert.doesNotMatch(code, /points_card_api[\s\S]{0,600}idToken/);
  assert.doesNotMatch(code, /points_card_api[\s\S]{0,600}payload:/);
  assert.match(common, /window\.Sentry/);
  assert.match(common, /captureException/);
  assert.match(common, /\['source', 'action', 'traceId'\]/);
});

test('new stamp QR defaults to per-member while legacy modes remain selectable', () => {
  const html = read('admin/index.html');
  const admin = read('admin/app.js');
  const code = read('gas/Code.gs');
  assert.match(html, /option value="per-member" selected/);
  assert.match(html, /option value="single"/);
  assert.match(html, /option value="repeatable"/);
  assert.match(admin, /stampMode'\)\.value = 'per-member'/);
  assert.match(code, /STAMP_SCAN_MODES = \['single', 'per-member', 'repeatable'\]/);
});
