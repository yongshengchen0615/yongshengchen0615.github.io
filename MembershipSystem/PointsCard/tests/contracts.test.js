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
  return Array.from(source.matchAll(/\sid="([^"]+)"/g), (match) => match[1]);
}

function jsElementIds(source) {
  return Array.from(source.matchAll(/\$\('([^']+)'\)/g), (match) => match[1]);
}

test('frontend element references resolve to unique HTML ids', () => {
  for (const area of ['user', 'admin']) {
    const html = read(`${area}/index.html`);
    const script = read(`${area}/app.js`);
    const ids = htmlIds(html);
    assert.equal(new Set(ids).size, ids.length, `${area} contains duplicate ids`);
    const missing = Array.from(new Set(jsElementIds(script))).filter((id) => !ids.includes(id));
    assert.deepEqual(missing, [], `${area} references missing ids`);
  }
});

test('every frontend API action is routed by GAS', () => {
  const frontend = read('user/app.js') + read('admin/app.js');
  const gas = read('gas/Code.gs');
  const actions = Array.from(frontend.matchAll(/PointsCard\.callApi\('([^']+)'/g), (match) => match[1]);
  const routed = new Set(Array.from(gas.matchAll(/case '([^']+)'/g), (match) => match[1]));
  assert.ok(actions.length >= 8);
  actions.forEach((action) => assert.ok(routed.has(action), `missing GAS route for ${action}`));
});

test('CSP pages keep executable JavaScript in external files', () => {
  for (const htmlPath of ['index.html', 'user/index.html', 'admin/index.html']) {
    const html = read(htmlPath);
    assert.match(html, /Content-Security-Policy/);
    assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i);
  }
});

test('member reward projection keeps cumulative stamps and redeemed rewards separate', () => {
  const source = read('gas/Code.gs') + '\n;globalThis.__pointsCardTest = { publicMember_, clampInt_ };';
  const context = {
    PropertiesService: {
      getScriptProperties() {
        return {
          getProperty(key) {
            if (key === 'POINTS_CARD_STAMPS_PER_REWARD') return '10';
            if (key === 'POINTS_CARD_REWARD_NAME') return '測試獎勵';
            return '';
          }
        };
      }
    },
    Object,
    String,
    Number,
    Math,
    Date,
    JSON,
    console
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  const project = (totalStamps, redeemedRewards) => context.__pointsCardTest.publicMember_({
    memberNo: 'PC-TEST',
    displayName: 'Test',
    membershipStatus: 'active',
    totalStamps,
    redeemedRewards,
    joinedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }, false);

  assert.deepEqual(
    [project(0, 0).availableRewards, project(0, 0).visualStamps, project(0, 0).stampsUntilReward],
    [0, 0, 10]
  );
  assert.deepEqual(
    [project(10, 0).availableRewards, project(10, 0).visualStamps, project(10, 0).stampsUntilReward],
    [1, 10, 0]
  );
  assert.deepEqual(
    [project(15, 1).availableRewards, project(15, 1).visualStamps, project(15, 1).stampsUntilReward],
    [0, 5, 5]
  );
  assert.equal(project(20, 0).availableRewards, 2);
});

test('mutation contracts include idempotency, processing recovery, and server authorization', () => {
  const code = read('gas/Code.gs');
  const stamps = read('gas/StampService.gs');
  const rewards = read('gas/RewardService.gs');
  assert.match(code, /requireAdmin_\(context\)/);
  assert.match(code, /verifyLineIdToken_\(idToken/);
  assert.match(stamps, /requestId/);
  assert.match(stamps, /status: 'processing'/);
  assert.match(stamps, /recoverStampRecord_/);
  assert.match(rewards, /status: 'processing'/);
  assert.match(rewards, /recoverRewardRecord_/);
  assert.match(read('gas/Storage.gs'), /AUDIT_UNAVAILABLE|audit_/);
});

test('spreadsheet text is guarded against formula injection', () => {
  const source = read('gas/Storage.gs') + '\n;globalThis.__storageTest = { safeCellText_ };';
  const context = { String, Object, console };
  vm.createContext(context);
  vm.runInContext(source, context);
  assert.equal(context.__storageTest.safeCellText_('=IMPORTXML("x")'), "'=IMPORTXML(\"x\")");
  assert.equal(context.__storageTest.safeCellText_('+123'), "'+123");
  assert.equal(context.__storageTest.safeCellText_('一般文字'), '一般文字');
});
