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
  const stored = {
    POINTS_CARD_SPREADSHEET_ID: 'SPREADSHEET-1',
    POINTS_CARD_MULTI_CARD_MIGRATED_AT: '2026-08-20T00:00:00.000Z',
    POINTS_CARD_MULTI_CARD_SPREADSHEET_ID: 'SPREADSHEET-1',
    POINTS_CARD_MULTI_CARD_SCHEMA_VERSION: '3'
  };
  const context = {
    POINTS_CARD_SERVICE: { spreadsheetProperty: 'POINTS_CARD_SPREADSHEET_ID' },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key) => stored[key] || ''
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
  const stored = { POINTS_CARD_SPREADSHEET_ID: 'SPREADSHEET-1' };
  let lockReleased = false;
  let baseInitializations = 0;
  const context = {
    POINTS_CARD_SERVICE: { spreadsheetProperty: 'POINTS_CARD_SPREADSHEET_ID' },
    ensurePointsCardBaseStorage_: () => { baseInitializations += 1; },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key) => stored[key] || '',
        setProperty: (key, value) => { stored[key] = value; },
        deleteProperty: (key) => { delete stored[key]; }
      })
    },
    LockService: {
      getScriptLock: () => ({
        tryLock: () => true,
        releaseLock: () => { lockReleased = true; }
      })
    },
    getSpreadsheet_: () => ({
      getId: () => 'SPREADSHEET-1',
      getSheetByName: () => null
    })
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  const validatedSheets = [];
  let migrations = 0;
  context.ensureMultiCardSheetSchema_ = (_spreadsheet, name) => { validatedSheets.push(name); };
  context.migrateLegacyPointsCard_ = () => { migrations += 1; };

  context.__multiCardMigrationTest.ensureMultiCardStorage_();
  assert.deepEqual(validatedSheets.sort(), [
    'CardRewardNotifications', 'CardRewardRecords', 'CardStampRecords', 'CardStampVouchers', 'Cards', 'MemberCardProgress'
  ]);
  assert.equal(migrations, 1);
  assert.equal(baseInitializations, 1);
  assert.match(stored.POINTS_CARD_MULTI_CARD_MIGRATED_AT, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(stored.POINTS_CARD_MULTI_CARD_SPREADSHEET_ID, 'SPREADSHEET-1');
  assert.equal(lockReleased, true);
});

test('switching spreadsheets initializes and migrates a missing multi-card schema once', () => {
  const source = read('gas/MultiCardStorage.gs') + '\n;globalThis.__multiCardMigrationTest = { ensureMultiCardStorage_ };';
  const stored = {
    POINTS_CARD_SPREADSHEET_ID: 'SPREADSHEET-NEW',
    POINTS_CARD_MULTI_CARD_MIGRATED_AT: '2026-08-20T00:00:00.000Z',
    POINTS_CARD_MULTI_CARD_SPREADSHEET_ID: 'SPREADSHEET-OLD'
  };
  let lockReleased = false;
  const context = {
    POINTS_CARD_SERVICE: { spreadsheetProperty: 'POINTS_CARD_SPREADSHEET_ID' },
    ensurePointsCardBaseStorage_: () => {},
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key) => stored[key] || '',
        setProperty: (key, value) => { stored[key] = value; },
        deleteProperty: (key) => { delete stored[key]; }
      })
    },
    LockService: {
      getScriptLock: () => ({
        tryLock: () => true,
        releaseLock: () => { lockReleased = true; }
      })
    },
    getSpreadsheet_: () => ({
      getId: () => 'SPREADSHEET-NEW',
      getSheetByName: () => null
    })
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  const initializedSheets = [];
  let migrations = 0;
  context.ensureMultiCardSheetSchema_ = (_spreadsheet, name) => { initializedSheets.push(name); };
  context.migrateLegacyPointsCard_ = () => { migrations += 1; };

  context.__multiCardMigrationTest.ensureMultiCardStorage_();
  assert.deepEqual(initializedSheets.sort(), [
    'CardRewardNotifications', 'CardRewardRecords', 'CardStampRecords', 'CardStampVouchers', 'Cards', 'MemberCardProgress'
  ]);
  assert.equal(migrations, 1);
  assert.equal(stored.POINTS_CARD_MULTI_CARD_SPREADSHEET_ID, 'SPREADSHEET-NEW');
  assert.equal(lockReleased, true);
});

test('an interrupted spreadsheet migration retries before marking the new spreadsheet ready', () => {
  const source = read('gas/MultiCardStorage.gs') + '\n;globalThis.__multiCardMigrationTest = { ensureMultiCardStorage_ };';
  const stored = {
    POINTS_CARD_SPREADSHEET_ID: 'SPREADSHEET-NEW',
    POINTS_CARD_MULTI_CARD_MIGRATED_AT: '2026-08-20T00:00:00.000Z',
    POINTS_CARD_MULTI_CARD_SPREADSHEET_ID: 'SPREADSHEET-OLD',
    POINTS_CARD_MULTI_CARD_MIGRATION_TARGET_ID: 'SPREADSHEET-NEW'
  };
  const context = {
    POINTS_CARD_SERVICE: { spreadsheetProperty: 'POINTS_CARD_SPREADSHEET_ID' },
    ensurePointsCardBaseStorage_: () => {},
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key) => stored[key] || '',
        setProperty: (key, value) => { stored[key] = value; },
        deleteProperty: (key) => { delete stored[key]; }
      })
    },
    LockService: {
      getScriptLock: () => ({ tryLock: () => true, releaseLock() {} })
    },
    getSpreadsheet_: () => ({
      getId: () => 'SPREADSHEET-NEW',
      getSheetByName: (name) => ({ name })
    })
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  let migrations = 0;
  context.ensureMultiCardSheetSchema_ = () => {};
  context.migrateLegacyPointsCard_ = () => { migrations += 1; };

  context.__multiCardMigrationTest.ensureMultiCardStorage_();
  assert.equal(migrations, 1);
  assert.equal(stored.POINTS_CARD_MULTI_CARD_SPREADSHEET_ID, 'SPREADSHEET-NEW');
  assert.equal(stored.POINTS_CARD_MULTI_CARD_MIGRATION_TARGET_ID, undefined);
});

test('an existing legacy migration marker is bound without rerunning destructive migration', () => {
  const source = read('gas/MultiCardStorage.gs') + '\n;globalThis.__multiCardMigrationTest = { ensureMultiCardStorage_ };';
  const stored = {
    POINTS_CARD_SPREADSHEET_ID: 'SPREADSHEET-1',
    POINTS_CARD_MULTI_CARD_MIGRATED_AT: '2026-08-20T00:00:00.000Z'
  };
  const context = {
    POINTS_CARD_SERVICE: { spreadsheetProperty: 'POINTS_CARD_SPREADSHEET_ID' },
    ensurePointsCardBaseStorage_: () => {},
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key) => stored[key] || '',
        setProperty: (key, value) => { stored[key] = value; },
        deleteProperty: (key) => { delete stored[key]; }
      })
    },
    LockService: {
      getScriptLock: () => ({ tryLock: () => true, releaseLock() {} })
    },
    getSpreadsheet_: () => ({
      getId: () => 'SPREADSHEET-1',
      getSheetByName: (name) => ({ name })
    })
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  let migrations = 0;
  context.ensureMultiCardSheetSchema_ = () => {};
  context.migrateLegacyPointsCard_ = () => { migrations += 1; };

  context.__multiCardMigrationTest.ensureMultiCardStorage_();
  assert.equal(migrations, 0);
  assert.equal(stored.POINTS_CARD_MULTI_CARD_SPREADSHEET_ID, 'SPREADSHEET-1');
});

test('a partially missing migrated schema fails closed with the missing sheet names', () => {
  const source = read('gas/MultiCardStorage.gs') + '\n;globalThis.__multiCardMigrationTest = { ensureMultiCardStorage_ };';
  const stored = {
    POINTS_CARD_SPREADSHEET_ID: 'SPREADSHEET-1',
    POINTS_CARD_MULTI_CARD_MIGRATED_AT: '2026-08-20T00:00:00.000Z'
  };
  let lockReleased = false;
  const context = {
    POINTS_CARD_SERVICE: { spreadsheetProperty: 'POINTS_CARD_SPREADSHEET_ID' },
    ensurePointsCardBaseStorage_: () => {},
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key) => stored[key] || '',
        setProperty: (key, value) => { stored[key] = value; },
        deleteProperty: (key) => { delete stored[key]; }
      })
    },
    LockService: {
      getScriptLock: () => ({
        tryLock: () => true,
        releaseLock: () => { lockReleased = true; }
      })
    },
    getSpreadsheet_: () => ({
      getId: () => 'SPREADSHEET-1',
      getSheetByName: (name) => name === 'Cards' ? { name } : null
    }),
    fail_: (code, message) => { throw Object.assign(new Error(message), { code }); }
  };
  vm.createContext(context);
  vm.runInContext(source, context);

  assert.throws(
    () => context.__multiCardMigrationTest.ensureMultiCardStorage_(),
    (error) => error && error.code === 'SCHEMA_MISMATCH' && /MemberCardProgress/.test(error.message)
  );
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

  assert.match(entry, /rel="preload" href="\.\/shared\/config\.json" as="fetch"/);
  assert.match(entry, /<script defer src="\.\/vendor\/liff-client\.js"><\/script>/);
  assert.match(member, /rel="preload" href="\.\.\/shared\/config\.json" as="fetch"/);
  assert.match(member, /<script defer src="\.\.\/vendor\/liff-client\.js"><\/script>/);
  assert.match(member, /<script defer src="\.\.\/shared\/common\.js"><\/script>/);
  assert.match(member, /<script defer src="\.\/app\.js"><\/script>/);
  assert.doesNotMatch(redirect, /cache:\s*'no-store'/);
  assert.doesNotMatch(common, /new URL\('\.\.\/shared\/config\.json'[\s\S]{0,220}cache:\s*'no-store'/);
  assert.match(common, /function preconnectApi\(gasUrl\)/);
});

test('read-only transport deduplicates concurrent calls and retries one transient failure without retrying mutations', async () => {
  const common = read('shared/common.js');
  const storage = new Map();
  let apiCalls = 0;
  let failNextApiCall = true;
  const nativeSetTimeout = setTimeout;
  const window = {
    fetch: async (url) => {
      if (String(url).includes('config.json')) {
        return {
          ok: true,
          json: async () => ({
            USER_LIFF_ID: '123-user',
            ADMIN_LIFF_ID: '123-admin',
            GAS_WEB_APP_URL: 'https://script.google.com/macros/s/test/exec'
          })
        };
      }
      apiCalls += 1;
      if (failNextApiCall) {
        failNextApiCall = false;
        throw new TypeError('temporary network failure');
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ok: true, data: { member: { selectedCardId: '' } } })
      };
    },
    URLSearchParams,
    AbortController,
    URL,
    crypto: { getRandomValues: (array) => array.fill(7) },
    PointsCardLiff: {
      init: async () => {},
      isLoggedIn: () => true,
      isInClient: () => false,
      getIDToken: () => 'header.payload.signature',
      getDecodedIDToken: () => ({ exp: Math.floor(Date.now() / 1000) + 3600 })
    },
    sessionStorage: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key)
    },
    location: {
      href: 'https://example.test/PointsCard/user/',
      origin: 'https://example.test',
      replace() {}
    },
    history: { replaceState() {} },
    performance: { now: () => Date.now() },
    setTimeout(callback, delay) {
      if (delay < 1000) return nativeSetTimeout(callback, 0);
      return 1;
    },
    clearTimeout() {},
    document: {
      createElement: () => ({}),
      head: { append() {} }
    },
    console
  };
  const context = { window, document: window.document, URL, URLSearchParams, AbortController, Uint8Array, Intl, Date, Map, Set, Object, String, Number, JSON, Array, Error, TypeError, console };
  vm.createContext(context);
  vm.runInContext(common, context);

  assert.equal(await window.PointsCard.ensureLiffLogin(), true);
  await Promise.all([
    window.PointsCard.callApi('member.me'),
    window.PointsCard.callApi('member.me')
  ]);
  assert.equal(apiCalls, 2, 'one shared read request should make one failed attempt and one retry');

  failNextApiCall = true;
  await assert.rejects(() => window.PointsCard.callApi('stamp.record', {
    stampCode: 'a'.repeat(64), requestId: 'b'.repeat(32)
  }), /無法連線/);
  assert.equal(apiCalls, 3, 'a mutation must not be retried automatically');
});

test('member projection uses bounded exact lookups and invalidates lookup snapshots after writes', () => {
  const source = read('gas/MultiCardStorage.gs') + '\n;globalThis.__lookupTest = { readMultiCardObjectsByField_, invalidateMultiCardSheet_ };';
  let finderReads = 0;
  let rowReads = 0;
  const rows = {
    10: ['P-1', 'CARD-A', 'U1', 'PC-1', 4, 0, 'created', 'updated'],
    20: ['P-2', 'CARD-B', 'U1', 'PC-1', 8, 1, 'created', 'updated']
  };
  const sheet = {
    getName: () => 'MemberCardProgress',
    getLastRow: () => 1000,
    getRange(row, column, rowCount, columnCount) {
      if (row === 2 && column === 3 && rowCount === 999 && columnCount === 1) {
        return {
          createTextFinder: () => ({
            matchEntireCell() { return this; },
            useRegularExpression() { return this; },
            findAll() {
              finderReads += 1;
              return [{ getRow: () => 10 }, { getRow: () => 20 }];
            }
          })
        };
      }
      return { getValues: () => { rowReads += 1; return [rows[row]]; } };
    }
  };
  const context = { Array, Date, JSON, Math, Number, Object, String, console };
  vm.createContext(context);
  vm.runInContext(source, context);

  const first = context.__lookupTest.readMultiCardObjectsByField_(sheet, 'memberLineUserId', 'U1');
  const second = context.__lookupTest.readMultiCardObjectsByField_(sheet, 'memberLineUserId', 'U1');
  assert.equal(first.length, 2);
  assert.equal(second.length, 2);
  assert.equal(finderReads, 1, 'the second lookup should use the request-scoped exact-match cache');
  assert.equal(rowReads, 2, 'only matching rows should be materialized');

  context.__lookupTest.invalidateMultiCardSheet_(sheet);
  context.__lookupTest.readMultiCardObjectsByField_(sheet, 'memberLineUserId', 'U1');
  assert.equal(finderReads, 2, 'a write invalidation must clear exact-match snapshots');
});

test('base exact lookup batches more than twenty matching rows without a full-table fallback', () => {
  const source = read('gas/Storage.gs') +
    '\n;globalThis.__baseLookupTest = { readObjectsByField_ };';
  const matchingRows = Array.from({ length: 25 }, (_, index) => 10 + index);
  let dataReads = 0;
  let fullTableReads = 0;
  const sheet = {
    getName: () => 'RewardRecords',
    getLastRow: () => 3000,
    getRange(row, column, rowCount, columnCount) {
      if (row === 2 && column === 2 && rowCount === 2999 && columnCount === 1) {
        return {
          createTextFinder: () => ({
            matchEntireCell() { return this; },
            useRegularExpression() { return this; },
            findAll: () => matchingRows.map((rowNumber) => ({ getRow: () => rowNumber }))
          })
        };
      }
      if (row === 2 && column === 1 && rowCount === 2999) {
        fullTableReads += 1;
        return { getValues: () => [] };
      }
      dataReads += 1;
      return {
        getValues: () => Array.from({ length: rowCount }, (_, offset) => [
          'RR-' + (row + offset), 'RC-TARGET', 'recorded'
        ])
      };
    }
  };
  const context = {
    Array, Date, JSON, Math, Number, Object, String, console,
    POINTS_CARD_HEADERS: {
      RewardRecords: ['rewardRecordId', 'confirmationId', 'status']
    }
  };
  vm.createContext(context);
  vm.runInContext(source, context);

  const result = context.__baseLookupTest.readObjectsByField_(
    sheet, 'confirmationId', 'RC-TARGET'
  );
  assert.equal(result.length, 25);
  assert.equal(dataReads, 1, 'contiguous matching rows should be materialized in one bounded window');
  assert.equal(fullTableReads, 0, 'large exact lookups must not load the complete sheet');
});

test('member and admin refresh flows preserve rendered data and card management stays in-page', () => {
  const memberHtml = read('user/index.html');
  const memberScript = read('user/app.js');
  const adminHtml = read('admin/index.html');
  const adminScript = read('admin/app.js');
  const lifecycle = read('admin/card-lifecycle.js');

  assert.match(memberHtml, /id="syncStatus"[^>]+role="status"/);
  assert.match(memberScript, /更新失敗，保留上次資料/);
  assert.match(memberScript, /PointsCard\.setSelectedCardId\(previousCardId\)/);
  assert.match(adminHtml, /id="adminSyncStatus"[^>]+role="status"/);
  assert.match(adminScript, /function refreshAdminContext/);
  assert.match(adminScript, /points-card:admin-card-changed/);
  assert.match(lifecycle, /notifyAdminCardChanged\('selection'\)/);
  assert.match(lifecycle, /notifyAdminCardChanged\('saved'\)/);
  assert.match(lifecycle, /notifyAdminCardChanged\('deleted'\)/);
  assert.doesNotMatch(lifecycle, /window\.location\.reload\(\)/);
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
