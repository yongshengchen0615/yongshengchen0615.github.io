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
    { stampsRequired: 6, rewardName: '幸運抽獎券', rewardType: 'lottery', lotteryPrizes: [{ name: '免費飲品', weight: 25 }, { name: '再接再厲', weight: 75 }] },
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
  assert.deepEqual(Array.from(empty.upcomingRewardNodes[1].lotteryPrizes), ['免費飲品', '再接再厲']);

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
    { stampsRequired: 5, rewardName: '抽獎券', rewardType: 'lottery', lotteryPrizes: [{ name: '只有一項', weight: 100 }] }
  ], 'INVALID', 'invalid'));
  assert.throws(() => context.__pointsCardTest.normalizeRewardNodes_([
    { stampsRequired: 5, rewardName: '抽獎券', rewardType: 'lottery', lotteryPrizes: [{ name: 'A', weight: 49.99 }, { name: 'B', weight: 50 }] }
  ], 'INVALID', 'invalid'), 'lottery weights must total exactly 100%');
  const zeroWeight = context.__pointsCardTest.normalizeRewardNodes_([
    { stampsRequired: 5, rewardName: '抽獎券', rewardType: 'lottery', lotteryPrizes: [{ name: '未中獎', weight: 100 }, { name: '大獎', weight: 0 }] }
  ], 'INVALID', 'invalid');
  assert.deepEqual(Array.from(zeroWeight[0].lotteryPrizes, (prize) => prize.weight), [100, 0]);
  rewardNodesJson = JSON.stringify(zeroWeight);
  assert.deepEqual(Array.from(project(0, 0).nextReward.lotteryPrizes), ['未中獎', '大獎'], '0% prizes remain visible in the member prize list');
  const legacyLottery = context.__pointsCardTest.normalizeRewardNodes_([
    { stampsRequired: 5, rewardName: '舊抽獎券', rewardType: 'lottery', lotteryPrizes: ['A', 'B', 'C'] }
  ], 'INVALID', 'invalid');
  assert.equal(Array.from(legacyLottery[0].lotteryPrizes, (prize) => prize.weight).reduce((total, weight) => total + weight, 0), 100);
});

test('member ticket UI removes account history and exposes earned and upcoming ticket flows', () => {
  const html = read('user/index.html');
  const script = read('user/app.js');
  assert.doesNotMatch(html, /id="displayCycleNumber"|id="totalStamps"|id="redeemedRewards"|id="joinedAt"|id="activityList"/);
  assert.doesNotMatch(html, />最近紀錄</);
  assert.doesNotMatch(html, /目前進度|id="visualStampCount"|id="stampsPerReward"|id="progressMessage"/);
  assert.match(html, /id="earnedTicketList"/);
  assert.match(html, /id="upcomingTicketList"/);
  assert.match(html, /id="lotteryStage"/);
  assert.match(script, /reward\.claim/);
  assert.match(script, /playLotteryAnimation/);
  assert.match(script, /rewardConfirm/);
  assert.match(script, /抽獎獎項/);
  assert.match(script, /lotteryPrizeNames/);
});

test('admin functions use accessible in-page tabs without additional HTML pages', () => {
  const html = read('admin/index.html');
  const script = read('admin/app.js');
  const tabs = Array.from(html.matchAll(/data-admin-tab="([^"]+)"/g), (match) => match[1]);
  const panels = Array.from(html.matchAll(/data-admin-panel="([^"]+)"/g), (match) => match[1]);
  assert.deepEqual(tabs, ['overview', 'reward-nodes', 'reward-confirmations', 'members', 'stamp-qr']);
  assert.deepEqual(panels, tabs);
  assert.equal((html.match(/role="tab"/g) || []).length, tabs.length);
  assert.equal((html.match(/role="tabpanel"/g) || []).length, panels.length);
  assert.match(script, /function selectAdminTab/);
  assert.match(script, /ArrowLeft/);
  assert.match(script, /ArrowRight/);
});

test('responsive UI contracts cover safe areas, compact heights, touch targets, and mobile admin rows', () => {
  const userCss = read('user/styles.css');
  const adminCss = read('admin/styles.css');
  const adminScript = read('admin/app.js');
  assert.match(userCss, /env\(safe-area-inset-bottom\)/);
  assert.match(userCss, /@media \(max-height: 650px\)/);
  assert.match(userCss, /max-height: calc\(100dvh - 24px\)/);
  assert.doesNotMatch(userCss, /body\s*\{[^}]*min-width:\s*320px/);
  assert.match(adminCss, /@media \(max-width: 900px\)/);
  assert.match(adminCss, /content: attr\(data-label\)/);
  assert.match(adminCss, /min-height: 44px/);
  assert.match(adminCss, /env\(safe-area-inset-bottom\)/);
  assert.doesNotMatch(adminCss, /\.data-table\s*\{\s*min-width:\s*760px/);
  assert.match(adminScript, /function setTableCellLabels/);
  assert.match(adminScript, /scrollIntoView/);
  assert.match(adminScript, /prefers-reduced-motion: reduce/);
});

test('member ticket dialog stays viewport anchored and keeps the QR scan action visible', () => {
  const html = read('user/index.html');
  const css = read('user/styles.css');
  const script = read('user/app.js');
  assert.match(html, /class="ticket-dialog-content" data-dialog-scroll/);
  assert.match(html, /class="ticket-dialog-actions">\s*<button id="scanRewardButton"/);
  assert.match(css, /\.feedback-dialog, \.ticket-dialog, \.lottery-dialog \{[^}]*position: fixed;[^}]*inset: 0;/);
  assert.match(css, /\.ticket-dialog\[open\] \{ display: grid; grid-template-rows: minmax\(0, 1fr\) auto; \}/);
  assert.match(css, /\.ticket-dialog-content \{[^}]*overflow-y: auto;/);
  assert.match(script, /dialogPageScrollPositions/);
  assert.match(script, /window\.scrollTo\(position\.left, position\.top\)/);
});

test('weighted lottery selection is server-side, respects boundaries, and skips 0% prizes', () => {
  const source = 'const LOTTERY_WEIGHT_BASIS_POINTS = 10000;\n' + read('gas/RewardService.gs') + '\n;globalThis.__rewardTest = { lotteryResultForReward_ };';
  let randomValue = '00000000';
  const context = {
    parseInt,
    Array,
    randomHex_: () => randomValue,
    fail_: (code, message) => { throw Object.assign(new Error(message), { code }); }
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  const zeroWeightResult = context.__rewardTest.lotteryResultForReward_({
    rewardType: 'lottery',
    lotteryPrizes: [{ name: '不會抽中', weight: 0 }, { name: '保證抽中', weight: 100 }]
  });
  assert.equal(zeroWeightResult, '保證抽中');

  const prizes = [{ name: '25% 獎項', weight: 25 }, { name: '75% 獎項', weight: 75 }];
  randomValue = '000009c3';
  assert.equal(context.__rewardTest.lotteryResultForReward_({ rewardType: 'lottery', lotteryPrizes: prizes }), '25% 獎項');
  randomValue = '000009c4';
  assert.equal(context.__rewardTest.lotteryResultForReward_({ rewardType: 'lottery', lotteryPrizes: prizes }), '75% 獎項');
  assert.throws(() => context.__rewardTest.lotteryResultForReward_({
    rewardType: 'lottery',
    lotteryPrizes: [{ name: 'A', weight: 60 }, { name: 'B', weight: 39.99 }]
  }), /100%/);
});

test('admin lottery editor exposes prize rows, live allocation feedback, and equal distribution', () => {
  const script = read('admin/app.js');
  assert.match(script, /lottery-prize-row/);
  assert.match(script, /distribute-prize-button/);
  assert.match(script, /尚需分配/);
  assert.match(script, /0% 會保留獎項但不會抽中/);
  assert.match(script, /total \+ prize\.weightBasis/);
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
