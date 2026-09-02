'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

function loadPointCardService() {
  class TestApiError extends Error {
    constructor(status, code, message) {
      super(message);
      this.status = status;
      this.code = code;
    }
  }
  const context = {
    ApiError: TestApiError,
    Utilities: { getUuid: () => '00000000-0000-0000-0000-000000000000' }
  };
  vm.createContext(context);
  vm.runInContext(read('gas/PointCardService.gs'), context, { filename: 'gas/PointCardService.gs' });
  return { context, normalize: context.normalizePointCardRewards_, TestApiError };
}

test('PointCard rewards are stored as milestone rows with safe types and sorted thresholds', () => {
  const { normalize } = loadPointCardService();
  const rewards = normalize([
    { thresholdStamps: 20, rewardType: 'lottery', rewardTitle: '週末抽獎券', rewardDescription: '抽咖啡機', lotteryWinRate: 12.5 },
    { thresholdStamps: 5, rewardType: 'coupon', rewardTitle: '飲品折價券', rewardDescription: '限下次使用', lotteryWinRate: 0 }
  ], 20);

  assert.deepEqual(rewards.map((reward) => Number(reward.threshold_stamps)), [5, 20]);
  assert.equal(rewards[0].reward_type, 'coupon');
  assert.equal(rewards[0].lottery_win_rate, '0');
  assert.equal(rewards[1].reward_type, 'lottery');
  assert.equal(rewards[1].lottery_win_rate, '12.5');
});

test('PointCard reward validation accepts 0% and rejects duplicate or out-of-range nodes', () => {
  const { normalize, TestApiError } = loadPointCardService();
  assert.doesNotThrow(() => normalize([{ thresholdStamps: 5, rewardType: 'lottery', rewardTitle: '抽獎券', lotteryWinRate: 0 }], 20));
  assert.throws(() => normalize([
    { thresholdStamps: 5, rewardType: 'coupon', rewardTitle: 'A' },
    { thresholdStamps: 5, rewardType: 'lottery', rewardTitle: 'B', lotteryWinRate: 50 }
  ], 20), (error) => error instanceof TestApiError && error.code === 'INVALID_CARD_REWARDS');
  assert.throws(() => normalize([{ thresholdStamps: 21, rewardType: 'coupon', rewardTitle: '超出' }], 20), (error) => error instanceof TestApiError && error.code === 'INVALID_CARD_REWARDS');
  assert.throws(() => normalize([{ thresholdStamps: 10, rewardType: 'lottery', rewardTitle: '錯誤', lotteryWinRate: 101 }], 20), (error) => error instanceof TestApiError && error.code === 'INVALID_CARD_REWARDS');
});

test('legacy cards still expose their original final reward as a coupon node', () => {
  const { context } = loadPointCardService();
  const card = context.pointCardForClient_({ card_id: 'PC-OLD', target_stamps: '20', reward_title: '免費咖啡', status: 'active' });
  assert.equal(card.rewardTitle, '免費咖啡');
  assert.deepEqual(JSON.parse(JSON.stringify(card.rewards[0])), {
    rewardId: 'legacy:PC-OLD',
    cardId: 'PC-OLD',
    thresholdStamps: 20,
    rewardType: 'coupon',
    rewardTitle: '免費咖啡',
    rewardDescription: '',
    lotteryWinRate: 0
  });
});

test('admin and member surfaces expose milestone reward controls and progress', () => {
  const adminHtml = read('admin/index.html');
  const adminApp = read('admin/app.js');
  const pointsHtml = read('points/index.html');
  const pointsApp = read('points/app.js');
  const storage = read('gas/Storage.gs');
  assert.match(storage, /PointCardRewards:/);
  assert.match(storage, /threshold_stamps/);
  assert.match(storage, /lottery_win_rate/);
  assert.match(adminHtml, /id="rewardRows"/);
  assert.match(adminHtml, /id="addRewardButton"/);
  assert.match(adminApp, /rewardType/);
  assert.match(adminApp, /lotteryWinRate/);
  assert.match(adminApp, /card\.rewards/);
  assert.match(pointsHtml, /id="milestoneList"/);
  assert.match(pointsApp, /renderMilestones/);
  assert.match(pointsApp, /中獎率/);
});
