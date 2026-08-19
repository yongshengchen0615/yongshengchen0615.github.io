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

function assertBalancedHtml(source, name) {
  const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
  const stack = [];
  for (const match of source.matchAll(/<\/?([a-z][\w:-]*)\b[^>]*>/gi)) {
    const tag = match[1].toLowerCase();
    const token = match[0];
    if (token.startsWith('</')) {
      assert.equal(stack.pop(), tag, `${name} closes ${tag} out of order`);
    } else if (!voidTags.has(tag) && !token.endsWith('/>')) {
      stack.push(tag);
    }
  }
  assert.deepEqual(stack, [], `${name} contains unclosed tags`);
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

test('frontend HTML keeps tags structurally balanced', () => {
  for (const htmlPath of ['index.html', 'user/index.html', 'admin/index.html']) {
    assertBalancedHtml(read(htmlPath), htmlPath);
  }
});

test('multi-node ticket projection repeats each card and supports coupon and lottery tickets', () => {
  let rewardNodesJson = JSON.stringify([
    { stampsRequired: 3, rewardName: '小點心優惠券', rewardType: 'coupon' },
    { stampsRequired: 6, rewardName: '幸運抽獎券', rewardType: 'lottery', lotteryPrizes: ['免費飲品', '再接再厲'] },
    { stampsRequired: 10, rewardName: '招牌飲品優惠券', rewardType: 'coupon' }
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
  const project = (totalStamps, redeemedRewards, claimedOrdinals) => context.__pointsCardTest.publicMember_({
    memberNo: 'PC-TEST',
    displayName: 'Test',
    membershipStatus: 'active',
    totalStamps,
    redeemedRewards,
    joinedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }, false, claimedOrdinals);

  const empty = project(0, 0);
  assert.deepEqual([empty.availableRewards, empty.visualStamps, empty.stampsUntilNextReward], [0, 0, 3]);
  assert.equal(empty.nextReward.rewardName, '小點心優惠券');
  assert.equal(empty.nextReward.rewardType, 'coupon');
  assert.equal(empty.upcomingRewardNodes[1].rewardType, 'lottery');

  const firstNode = project(3, 0);
  assert.equal(firstNode.nextAvailableReward.rewardName, '小點心優惠券');
  assert.equal(firstNode.nextReward.rewardName, '幸運抽獎券');
  assert.equal(firstNode.availableRewards, 1);

  const mixed = project(7, 1);
  assert.deepEqual([mixed.availableRewards, mixed.visualStamps, mixed.stampsUntilNextReward], [1, 7, 3]);
  assert.equal(mixed.nextAvailableReward.rewardName, '幸運抽獎券');
  assert.deepEqual(Array.from(mixed.rewardNodes, (node) => node.state), ['redeemed', 'available', 'pending']);

  const claimedOutOfOrder = project(7, 1, [2]);
  assert.equal(claimedOutOfOrder.nextAvailableReward.rewardName, '小點心優惠券');
  assert.deepEqual(Array.from(claimedOutOfOrder.rewardNodes, (node) => node.state), ['available', 'redeemed', 'pending']);

  assert.deepEqual([project(10, 0).availableRewards, project(10, 0).visualStamps], [3, 10]);
  const secondCycle = project(13, 3);
  assert.equal(secondCycle.displayCycleNumber, 2);
  assert.equal(secondCycle.nextAvailableReward.rewardName, '小點心優惠券');
  assert.equal(secondCycle.nextAvailableReward.cycleNumber, 2);

  const settings = context.__pointsCardTest.pointsCardSettings_();
  const unlocked = context.__pointsCardTest.rewardEntitlementsBetweenTotals_(2, 7, settings);
  assert.deepEqual(Array.from(unlocked, (reward) => reward.rewardName), ['小點心優惠券', '幸運抽獎券']);

  rewardNodesJson = '';
  assert.equal(project(20, 0).availableRewards, 2, 'legacy single-node settings remain compatible');
  assert.throws(() => context.__pointsCardTest.normalizeRewardNodes_([
    { stampsRequired: 3, rewardName: 'A' },
    { stampsRequired: 3, rewardName: 'B' }
  ], 'INVALID', 'invalid'));
  assert.throws(() => context.__pointsCardTest.normalizeRewardNodes_([
    { stampsRequired: 5, rewardName: '抽獎券', rewardType: 'lottery', lotteryPrizes: ['只有一項'] }
  ], 'INVALID', 'invalid'));
});

test('member ticket UI removes account history and exposes earned and upcoming ticket flows', () => {
  const html = read('user/index.html');
  const script = read('user/app.js');
  assert.doesNotMatch(html, /id="displayCycleNumber"|id="totalStamps"|id="redeemedRewards"|id="joinedAt"|id="activityList"/);
  assert.doesNotMatch(html, />最近紀錄</);
  assert.match(html, /id="earnedTicketList"/);
  assert.match(html, /id="upcomingTicketList"/);
  assert.match(html, /id="lotteryStage"/);
  assert.match(script, /reward\.claim/);
  assert.match(script, /playLotteryAnimation/);
  assert.match(script, /rewardConfirm/);
});

test('lottery outcome selection is server-side and returns one configured prize', () => {
  const source = read('gas/RewardService.gs') + '\n;globalThis.__rewardTest = { lotteryResultForReward_ };';
  const context = {
    parseInt,
    Array,
    randomHex_: () => '00000000',
    fail_: (code, message) => { throw Object.assign(new Error(message), { code }); }
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  const result = context.__rewardTest.lotteryResultForReward_({
    rewardType: 'lottery',
    lotteryPrizes: ['免費飲品', '再接再厲']
  });
  assert.equal(result, '免費飲品');
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
  assert.match(rewards, /memberRewardClaim_/);
  assert.match(rewards, /lotteryResult/);
  assert.match(code, /admin\.reward-nodes\.update/);
  assert.match(code, /admin\.reward-confirm\.create/);
  assert.match(code, /rewardSettingsLocked_/);
  assert.match(code, /RewardConfirmations/);
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
