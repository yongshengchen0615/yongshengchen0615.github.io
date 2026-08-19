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

test('multi-node reward projection repeats each card and preserves FIFO redemption', () => {
  let rewardNodesJson = JSON.stringify([
    { stampsRequired: 3, rewardName: '小點心' },
    { stampsRequired: 6, rewardName: '折價券' },
    { stampsRequired: 10, rewardName: '招牌飲品' }
  ]);
  const source = read('gas/Code.gs') + '\n;globalThis.__pointsCardTest = { publicMember_, pointsCardSettings_, normalizeRewardNodes_, rewardEntitlementsBetweenTotals_ };';
  const context = {
    PropertiesService: {
      getScriptProperties() {
        return {
          getProperty(key) {
            if (key === 'POINTS_CARD_REWARD_NODES_JSON') return rewardNodesJson;
            if (key === 'POINTS_CARD_REWARD_NODES_UPDATED_AT') return 'v1';
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

  const empty = project(0, 0);
  assert.deepEqual([empty.availableRewards, empty.visualStamps, empty.stampsUntilNextReward], [0, 0, 3]);
  assert.equal(empty.nextReward.rewardName, '小點心');

  const firstNode = project(3, 0);
  assert.equal(firstNode.nextAvailableReward.rewardName, '小點心');
  assert.equal(firstNode.nextReward.rewardName, '折價券');
  assert.equal(firstNode.availableRewards, 1);

  const mixed = project(7, 1);
  assert.deepEqual([mixed.availableRewards, mixed.visualStamps, mixed.stampsUntilNextReward], [1, 7, 3]);
  assert.equal(mixed.nextAvailableReward.rewardName, '折價券');
  assert.deepEqual(Array.from(mixed.rewardNodes, (node) => node.state), ['redeemed', 'available', 'pending']);

  assert.deepEqual([project(10, 0).availableRewards, project(10, 0).visualStamps], [3, 10]);
  const secondCycle = project(13, 3);
  assert.equal(secondCycle.displayCycleNumber, 2);
  assert.equal(secondCycle.nextAvailableReward.rewardName, '小點心');
  assert.equal(secondCycle.nextAvailableReward.cycleNumber, 2);

  const settings = context.__pointsCardTest.pointsCardSettings_();
  const unlocked = context.__pointsCardTest.rewardEntitlementsBetweenTotals_(2, 7, settings);
  assert.deepEqual(Array.from(unlocked, (reward) => reward.rewardName), ['小點心', '折價券']);

  rewardNodesJson = '';
  assert.equal(project(20, 0).availableRewards, 2, 'legacy single-node settings remain compatible');
  assert.throws(() => context.__pointsCardTest.normalizeRewardNodes_([
    { stampsRequired: 3, rewardName: 'A' },
    { stampsRequired: 3, rewardName: 'B' }
  ], 'INVALID', 'invalid'));
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
  assert.match(code, /admin\.reward-nodes\.update/);
  assert.match(code, /rewardSettingsLocked_/);
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
