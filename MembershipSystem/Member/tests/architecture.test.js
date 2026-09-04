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
    'event/index.html', 'event/styles.css', 'event/app.js',
    'admin/index.html', 'admin/styles.css', 'admin/app.js',
    'gas/Code.gs', 'gas/Auth.gs', 'gas/Storage.gs', 'gas/MemberService.gs', 'gas/PointCardService.gs', 'gas/EventTicketService.gs', 'gas/appsscript.json', 'tests/pointcard-rewards.test.js', 'tests/event-tickets.test.js'
  ].forEach((file) => assert.equal(exists(file), true, `missing ${file}`));
});

test('public config contains separate LIFF ids and no secret-shaped key', () => {
  const config = JSON.parse(read('config.json'));
  assert.equal(typeof config.gasWebAppUrl, 'string');
  assert.equal(typeof config.memberLiffId, 'string');
  assert.equal(typeof config.pointsLiffId, 'string');
  assert.equal(typeof config.adminLiffId, 'string');
  assert.equal(typeof config.eventLiffId, 'string');
  assert.notEqual(config.memberLiffId, config.pointsLiffId);
  assert.notEqual(config.memberLiffId, config.adminLiffId);
  assert.notEqual(config.pointsLiffId, config.adminLiffId);
  assert.notEqual(config.eventLiffId, config.memberLiffId);
  assert.notEqual(config.eventLiffId, config.pointsLiffId);
  assert.notEqual(config.eventLiffId, config.adminLiffId);
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
  const eventHtml = read('event/index.html');
  const eventApp = read('event/app.js');
  assert.match(eventHtml, /\.\/styles\.css/);
  assert.match(eventHtml, /\.\/app\.js/);
  assert.match(eventApp, /user\.event\.bootstrap/);
  assert.match(adminHtml, /\.\/styles\.css/);
  assert.match(adminHtml, /\.\/app\.js/);
  assert.match(adminHtml, /membersPanel/);
  assert.match(adminHtml, /cardsPanel/);
});

test('member card omits the removed member-exclusive content section', () => {
  const memberHtml = read('member/index.html');
  const memberApp = read('member/app.js');
  const memberStyles = read('member/styles.css');
  assert.doesNotMatch(memberHtml, /會員專屬內容|會員權益|benefitList|statusTitle|statusMessage|statusLineText|syncedAt/);
  assert.doesNotMatch(memberApp, /benefitList|statusTitle|statusMessage|statusLineText|syncedAt/);
  assert.doesNotMatch(memberStyles, /member-details|benefits-panel|status-panel/);
});

test('member card collects first-visit contact details and displays accumulated service time', () => {
  const memberHtml = read('member/index.html');
  const memberApp = read('member/app.js');
  const adminHtml = read('admin/index.html');
  const adminApp = read('admin/app.js');
  assert.match(memberHtml, /profileBirthday/);
  assert.match(memberHtml, /profilePhone/);
  assert.match(memberHtml, /memberBirthday/);
  assert.match(memberHtml, /memberPhone/);
  assert.match(memberHtml, /serviceMinutesTotal/);
  assert.match(memberApp, /user\.member\.profile\.save/);
  assert.doesNotMatch(memberApp, /小時/);
  assert.match(adminHtml, /grantModal/);
  assert.match(adminHtml, /grantStampsEnabled/);
  assert.match(adminHtml, /grantServiceTimeEnabled/);
  assert.match(adminHtml, /grantSuccessNotice/);
  assert.match(adminApp, /admin\.member-grants\.add/);
  assert.match(adminApp, /showGrantSuccess\(details\)/);
  assert.match(adminApp, /發放完成/);
  assert.doesNotMatch(adminApp, /admin\.stamps\.add|admin\.service_minutes\.add/);
  assert.doesNotMatch(adminApp, /小時/);
});

test('admin derives fixed membership tiers from service-time thresholds instead of editing members individually', () => {
  const adminHtml = read('admin/index.html');
  const adminApp = read('admin/app.js');
  const memberService = read('gas/MemberService.gs');
  const code = read('gas/Code.gs');
  assert.match(adminHtml, /tierSettingsForm/);
  assert.match(adminHtml, /tierGeneralMinutes/);
  assert.match(adminHtml, /tierSilverMinutes/);
  assert.match(adminHtml, /tierGoldMinutes/);
  assert.match(adminHtml, /tierPlatinumMinutes/);
  assert.doesNotMatch(adminHtml, /<input id="memberTier"/);
  assert.match(adminApp, /admin\.member-tiers\.save/);
  assert.doesNotMatch(adminApp, /tier:\s*String\(els\.memberTier/);
  assert.match(code, /'admin\.member-tiers\.save'/);
  assert.match(memberService, /function membershipTierForServiceMinutes_/);
  assert.match(memberService, /function handleMembershipTierSettingsSave_/);
});

test('all browser JavaScript and GAS files parse as JavaScript', () => {
  const files = ['shared/common.js', 'member/app.js', 'points/app.js', 'event/app.js', 'admin/app.js', 'gas/Code.gs', 'gas/Auth.gs', 'gas/Storage.gs', 'gas/MemberService.gs', 'gas/PointCardService.gs', 'gas/EventTicketService.gs'];
  files.forEach((file) => assert.doesNotThrow(() => new vm.Script(read(file), { filename: file }), file));
});

test('combined GAS deployment bundle has no duplicate declarations', () => {
  const files = ['gas/Code.gs', 'gas/Auth.gs', 'gas/Storage.gs', 'gas/MemberService.gs', 'gas/PointCardService.gs', 'gas/EventTicketService.gs'];
  assert.doesNotThrow(() => new vm.Script(files.map(read).join('\n'), { filename: 'membership-gas-combined.js' }));
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
  assert.match(pointService, /function pointCardTicketIssuanceRequired_\(lineUserId, snapshot\)/);
  assert.match(pointService, /const lockedSnapshot = readPointCardSnapshot_\(\)/);
  assert.match(pointService, /ensurePointCardTicketsForMember_\(identity\.lineUserId, lockedSnapshot\)/);
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
  context.ensureMembershipTierSettings_ = () => {};
  context.ensureMembershipStorage_();
  context.ensureMembershipStorage_();
  assert.ok(schemaChecks > 0);
  assert.equal(schemaChecks, 15);
});
