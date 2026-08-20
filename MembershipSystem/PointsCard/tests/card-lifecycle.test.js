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

function htmlIds(source) {
  return new Set(Array.from(source.matchAll(/\sid="([^"]+)"/g), (match) => match[1]));
}

function jsElementIds(source) {
  return Array.from(source.matchAll(/\$\('([^']+)'\)/g), (match) => match[1]);
}

test('card lifecycle defaults legacy installs to active unlimited and derives expiry safely', () => {
  const source = read('gas/CardService.gs') + '\n;globalThis.__cardTest = { readPointsCardLifecycle_, validPointsCardExpiry_, assertPointsCardAvailable_ };';
  const values = {};
  const properties = {
    getProperty(key) { return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null; },
    setProperty(key, value) { values[key] = String(value); },
    setProperties(next) { Object.keys(next).forEach((key) => { values[key] = String(next[key]); }); }
  };
  const context = {
    PropertiesService: { getScriptProperties: () => properties },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    audit_: () => true,
    cleanText_(value, maxLength, required) {
      const text = String(value == null ? '' : value).trim();
      if (required && !text) throw Object.assign(new Error('required'), { publicCode: 'INVALID_INPUT' });
      if (text.length > maxLength) throw Object.assign(new Error('too long'), { publicCode: 'INVALID_INPUT' });
      return text;
    },
    fail_(code, message) { throw Object.assign(new Error(message), { publicCode: code }); },
    Date,
    Number,
    String,
    Object,
    console
  };
  vm.createContext(context);
  vm.runInContext(source, context);

  let card = context.__cardTest.readPointsCardLifecycle_();
  assert.equal(card.status, 'active');
  assert.equal(card.available, true);
  assert.equal(card.expiresAt, '');
  assert.equal(card.updatedAt, 'legacy');

  values.POINTS_CARD_CARD_EXPIRES_AT = new Date(Date.now() + 60_000).toISOString();
  card = context.__cardTest.readPointsCardLifecycle_();
  assert.equal(card.status, 'active');
  assert.equal(card.available, true);

  values.POINTS_CARD_CARD_EXPIRES_AT = '2000-01-01T00:00:00.000Z';
  card = context.__cardTest.readPointsCardLifecycle_();
  assert.equal(card.status, 'expired');
  assert.equal(card.available, false);

  values.POINTS_CARD_CARD_STATUS = 'deleted';
  values.POINTS_CARD_CARD_EXPIRES_AT = '';
  card = context.__cardTest.readPointsCardLifecycle_();
  assert.equal(card.status, 'deleted');
  assert.equal(card.available, false);
  assert.throws(() => context.__cardTest.assertPointsCardAvailable_(), (error) => error.publicCode === 'CARD_UNAVAILABLE');

  assert.equal(context.__cardTest.validPointsCardExpiry_(''), '');
  assert.throws(
    () => context.__cardTest.validPointsCardExpiry_('2000-01-01T00:00:00.000Z'),
    (error) => error.publicCode === 'INVALID_CARD_EXPIRY'
  );
});

test('card lifecycle admin APIs are server-authorized, concurrency guarded, and preserve history', () => {
  const code = read('gas/Code.gs');
  const cardService = read('gas/CardService.gs');
  const stampService = read('gas/StampService.gs');

  assert.match(code, /case 'admin\.card\.update':\s*requireAdmin_\(context\)/);
  assert.match(code, /case 'admin\.card\.delete':\s*requireAdmin_\(context\)/);
  assert.match(code, /cardLifecycleSupported:\s*true/);
  assert.match(code, /card:\s*publicPointsCardLifecycle_\(\)/);
  assert.match(code, /card:\s*settings\.card/);

  assert.match(cardService, /expectedUpdatedAt/);
  assert.match(cardService, /LockService\.getScriptLock\(\)/);
  assert.match(cardService, /POINTS_CARD_DELETE_REQUESTED/);
  assert.match(cardService, /POINTS_CARD_DELETED/);
  assert.match(cardService, /setProperties\(next, false\)/);
  assert.doesNotMatch(cardService, /deleteObjectRow_|deleteRow\(/);

  const existingRequestIndex = stampService.indexOf('const existing = findByFieldWithRow_');
  const availabilityIndex = stampService.indexOf("assertPointsCardAvailable_('目前沒有可用集點卡。')");
  const voucherLookupIndex = stampService.indexOf("const voucherMatch = findByFieldWithRow_(voucherSheet, 'shareCode', stampCode)");
  assert.ok(existingRequestIndex >= 0 && availabilityIndex > existingRequestIndex, 'retry recovery must run before card availability rejection');
  assert.ok(voucherLookupIndex > availabilityIndex, 'new stamp voucher processing must run only after card availability check');
  assert.match(stampService, /adminStampCreate_[\s\S]*assertPointsCardAvailable_\('目前沒有可用集點卡/);
});

test('new lifecycle frontend API actions are routed and every controller element id exists', () => {
  const adminHtml = read('admin/index.html');
  const userHtml = read('user/index.html');
  const adminLifecycle = read('admin/card-lifecycle.js');
  const userScript = read('user/app.js');
  const gas = read('gas/Code.gs');

  const adminIds = htmlIds(adminHtml);
  const missingAdminIds = Array.from(new Set(jsElementIds(adminLifecycle))).filter((id) => !adminIds.has(id));
  assert.deepEqual(missingAdminIds, []);

  const userIds = htmlIds(userHtml);
  const missingUserIds = Array.from(new Set(jsElementIds(userScript))).filter((id) => !userIds.has(id));
  assert.deepEqual(missingUserIds, []);

  const frontend = read('admin/app.js') + adminLifecycle + userScript;
  const actions = Array.from(frontend.matchAll(/PointsCard\.callApi\('([^']+)'/g), (match) => match[1]);
  const routed = new Set(Array.from(gas.matchAll(/case '([^']+)'/g), (match) => match[1]));
  actions.forEach((action) => assert.ok(routed.has(action), `missing GAS route for ${action}`));

  assert.match(adminHtml, /<script src="\.\/card-lifecycle\.js"><\/script>/);
  assert.doesNotThrow(() => new vm.Script(adminLifecycle));
  assert.doesNotThrow(() => new vm.Script(userScript));
});

test('member UI shows exact no-card state while preserving earned tickets', () => {
  const html = read('user/index.html');
  const script = read('user/app.js');

  assert.match(html, /id="noCardState"/);
  assert.match(html, /目前沒有可用集點卡/);
  assert.match(html, /id="upcomingTicketGroup"/);
  assert.match(script, /\$\('stampCard'\)\.classList\.toggle\('hidden', !cardAvailable\)/);
  assert.match(script, /\$\('noCardState'\)\.classList\.toggle\('hidden', cardAvailable\)/);
  assert.match(script, /\$\('upcomingTicketGroup'\)\.classList\.toggle\('hidden', !cardAvailable\)/);
  assert.match(script, /earned\.forEach\(function \(ticket\) \{ earnedList\.append\(createEarnedTicket\(ticket\)\); \}\)/);
  assert.match(script, /CARD_UNAVAILABLE/);
  assert.match(script, /PointsCard\.clearNavigationState\(\)/);
});

test('admin UI can set limited or unlimited card lifetime and delete or reactivate the card', () => {
  const html = read('admin/index.html');
  const script = read('admin/card-lifecycle.js');

  assert.match(html, /id="cardExpiryMode"/);
  assert.match(html, /value="limited">有期限/);
  assert.match(html, /value="unlimited" selected>無期限/);
  assert.match(html, /id="deleteCardButton"/);
  assert.match(script, /admin\.card\.update/);
  assert.match(script, /admin\.card\.delete/);
  assert.match(script, /expectedUpdatedAt:\s*card\.updatedAt/);
  assert.match(script, /重新啟用集點卡/);
  assert.match(script, /newStampButton\.disabled = !card\.available/);
});
