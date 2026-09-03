'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const exists = (relativePath) => fs.existsSync(path.join(root, relativePath));

test('Member module has independent user surfaces and one shared admin surface', () => {
  [
    'index.html', 'config.json', 'README.md', 'shared/common.js',
    'member/index.html', 'member/styles.css', 'member/app.js',
    'points/index.html', 'points/styles.css', 'points/app.js',
    'admin/index.html', 'admin/styles.css', 'admin/app.js',
    'gas/Code.gs', 'gas/Auth.gs', 'gas/Storage.gs', 'gas/MemberService.gs', 'gas/PointCardService.gs', 'gas/appsscript.json', 'tests/pointcard-rewards.test.js'
  ].forEach((file) => assert.equal(exists(file), true, `missing ${file}`));
});

test('public config contains separate LIFF ids and no secret-shaped key', () => {
  const config = JSON.parse(read('config.json'));
  assert.equal(typeof config.gasWebAppUrl, 'string');
  assert.equal(typeof config.memberLiffId, 'string');
  assert.equal(typeof config.pointsLiffId, 'string');
  assert.equal(typeof config.adminLiffId, 'string');
  assert.notEqual(config.memberLiffId, config.pointsLiffId);
  assert.notEqual(config.memberLiffId, config.adminLiffId);
  assert.notEqual(config.pointsLiffId, config.adminLiffId);
  assert.equal(Object.keys(config).some((key) => /secret|token|password/i.test(key)), false);
});

test('user clients expose separate entry points while admin uses one app', () => {
  const memberHtml = read('member/index.html');
  const pointsHtml = read('points/index.html');
  const adminHtml = read('admin/index.html');
  assert.match(memberHtml, /\.\/styles\.css/);
  assert.match(memberHtml, /\.\/app\.js/);
  assert.match(pointsHtml, /\.\/styles\.css/);
  assert.match(pointsHtml, /\.\/app\.js/);
  assert.match(adminHtml, /\.\/styles\.css/);
  assert.match(adminHtml, /\.\/app\.js/);
  assert.match(adminHtml, /membersPanel/);
  assert.match(adminHtml, /cardsPanel/);
});

test('all browser JavaScript and GAS files parse as JavaScript', () => {
  const files = ['shared/common.js', 'member/app.js', 'points/app.js', 'admin/app.js', 'gas/Code.gs', 'gas/Auth.gs', 'gas/Storage.gs', 'gas/MemberService.gs', 'gas/PointCardService.gs'];
  files.forEach((file) => assert.doesNotThrow(() => new vm.Script(read(file), { filename: file }), file));
});

test('transport distinguishes an uncertain write outcome from a failed read response', async () => {
  const context = {
    window: {},
    fetch: async () => ({ text: async () => '<html>temporary response</html>' })
  };
  vm.createContext(context);
  vm.runInContext(read('shared/common.js'), context, { filename: 'shared/common.js' });
  const request = context.window.MemberSystem.request;
  await assert.rejects(
    () => request({ gasWebAppUrl: 'https://example.invalid' }, 'admin', 'id-token', 'admin.stamps.add'),
    (error) => error && error.code === 'API_RESPONSE_UNCERTAIN'
  );
  await assert.rejects(
    () => request({ gasWebAppUrl: 'https://example.invalid' }, 'admin', 'id-token', 'admin.bootstrap'),
    (error) => error && error.code === 'API_RESPONSE_ERROR'
  );

  let readAttempts = 0;
  context.fetch = async () => {
    readAttempts += 1;
    return readAttempts === 1
      ? { status: 502, text: async () => '<html>temporary response</html>' }
      : { status: 200, text: async () => JSON.stringify({ ok: true, data: { members: [] } }) };
  };
  await assert.doesNotReject(
    () => request({ gasWebAppUrl: 'https://example.invalid' }, 'admin', 'id-token', 'admin.bootstrap')
  );
  assert.equal(readAttempts, 2, 'read requests retry once after a non-JSON response');

  let writeAttempts = 0;
  context.fetch = async () => {
    writeAttempts += 1;
    return { status: 502, text: async () => '<html>temporary response</html>' };
  };
  await assert.rejects(
    () => request({ gasWebAppUrl: 'https://example.invalid' }, 'admin', 'id-token', 'admin.stamps.add'),
    (error) => error && error.code === 'API_RESPONSE_UNCERTAIN'
  );
  assert.equal(writeAttempts, 1, 'write requests must not retry after an uncertain response');

  context.fetch = async () => { throw new Error('network interrupted'); };
  await assert.rejects(
    () => request({ gasWebAppUrl: 'https://example.invalid' }, 'admin', 'id-token', 'admin.stamps.add'),
    (error) => error && error.code === 'API_RESPONSE_UNCERTAIN'
  );
});

test('storage schema checks are cached and point-card bootstrap has a snapshot read path', () => {
  const storage = read('gas/Storage.gs');
  const pointService = read('gas/PointCardService.gs');
  assert.match(storage, /MEMBERSHIP_STORAGE_SCHEMA_CACHE_SECONDS_/);
  assert.match(storage, /membershipSchemaCacheKey_/);
  assert.match(storage, /schemaCache\.get\(schemaCacheKey\) === 'ready'/);
  assert.match(pointService, /function readPointCardSnapshot_\(\)/);
  assert.match(pointService, /ensurePointCardTicketsForMember_\(identity\.lineUserId, pointCardSnapshot\)/);
  assert.match(pointService, /visiblePointCardsForMember_\(identity\.lineUserId, snapshot\)/);
});

test('storage schema cache skips repeated schema checks for the same spreadsheet and schema', () => {
  const entries = new Map();
  const context = {
    CacheService: { getScriptCache: () => ({ get: (key) => entries.get(key) || null, put: (key, value) => entries.set(key, value) }) },
    Utilities: { computeDigest: () => Array.from({ length: 8 }, (_, index) => index), DigestAlgorithm: { SHA_256: 'SHA_256' }, Charset: { UTF_8: 'UTF_8' } }
  };
  vm.createContext(context);
  vm.runInContext(read('gas/Storage.gs'), context, { filename: 'gas/Storage.gs' });
  let schemaChecks = 0;
  context.resolveMembershipSpreadsheet_ = () => ({ getId: () => 'sheet-1' });
  context.ensureSheetSchema_ = () => { schemaChecks += 1; };
  context.ensureMembershipStorage_();
  context.ensureMembershipStorage_();
  assert.ok(schemaChecks > 0);
  assert.equal(schemaChecks, 11);
});
