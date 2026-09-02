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
    Utilities: { getUuid: () => '00000000-0000-0000-0000-000000000000', formatDate: () => '2026-09-02' }
  };
  vm.createContext(context);
  vm.runInContext(read('gas/PointCardService.gs'), context, { filename: 'gas/PointCardService.gs' });
  return { context, normalize: context.normalizePointCardRewards_, TestApiError };
}

function loadTicketService() {
  class TestApiError extends Error {
    constructor(status, code, message, details) {
      super(message);
      this.status = status;
      this.code = code;
      this.details = details || null;
    }
  }
  const rows = {
    PointCards: [{ card_id: 'PC-1', status: 'active', expiry_mode: 'unlimited', expires_on: '' }],
    PointCardTickets: [{ ticket_id: 'TK-1', line_user_id: 'U-1', card_id: 'PC-1', reward_id: 'PR-1', reward_key: 'PC-1:10', threshold_stamps: '10', ticket_type: 'coupon', ticket_title: '咖啡券', ticket_description: '', lottery_prizes_json: '[]', status: 'available', failed_attempts: '0', earned_at: '2026-09-02T00:00:00.000Z', used_at: '', result_json: '', created_at: '2026-09-02T00:00:00.000Z', updated_at: '2026-09-02T00:00:00.000Z', consume_stamps: '10' }],
    PointBalances: [{ line_user_id: 'U-1', card_id: 'PC-1', stamps: '10', updated_at: '2026-09-02T00:00:00.000Z' }],
    PointEntries: [],
    PointCardTicketChallenges: []
  };
  let uuid = 0;
  let digestSeed = 0;
  const context = {
    ApiError: TestApiError,
    Utilities: {
      getUuid: () => `00000000-0000-0000-0000-0000000000${String(uuid++).padStart(2, '0')}`,
      computeDigest: () => Array.from({ length: 32 }, (_, index) => (digestSeed++ + index) % 256),
      formatDate: () => '2026-09-02',
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      Charset: { UTF_8: 'UTF_8' }
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (key) => key.endsWith('PC-1') ? '10' : '' }) },
    MEMBERSHIP_SHEET_SCHEMAS_: { PointCardTicketChallenges: ['challenge_id', 'ticket_id', 'line_user_id', 'options_json', 'status', 'attempt_count', 'expires_at', 'created_at', 'used_at'] },
    withDataLock_: (callback) => callback(),
    nowIso_: () => '2026-09-02T00:00:00.000Z',
    digest_: () => 'challenge-fingerprint',
    readRecords_: (sheetName) => rows[sheetName] || [],
    findRecordWithRow_: (sheetName, keyField, keyValue) => {
      const index = (rows[sheetName] || []).findIndex((record) => String(record[keyField] || '') === String(keyValue || ''));
      return index < 0 ? null : { rowNumber: index + 2, record: rows[sheetName][index] };
    },
    appendRecord_: (sheetName, record) => { rows[sheetName].push(record); return rows[sheetName].length + 1; },
    updateRecordAtRow_: (sheetName, rowNumber, record) => { rows[sheetName][rowNumber - 2] = record; },
    appendAuditRecord_: () => {}
  };
  vm.createContext(context);
  vm.runInContext(read('gas/PointCardService.gs'), context, { filename: 'gas/PointCardService.gs' });
  return { context, rows, TestApiError };
}

test('PointCard rewards are stored as milestone rows with safe types and sorted thresholds', () => {
  const { context, normalize } = loadPointCardService();
  const rewards = normalize([
    { thresholdStamps: 20, rewardType: 'lottery', rewardTitle: '週末抽獎券', rewardDescription: '抽咖啡機', prizes: [{ prizeTitle: '頭獎咖啡機', winRate: 0 }, { prizeTitle: '二獎咖啡券', winRate: 100 }] },
    { thresholdStamps: 5, rewardType: 'coupon', rewardTitle: '飲品折價券', rewardDescription: '限下次使用', lotteryWinRate: 0 }
  ], 20);

  assert.deepEqual(rewards.map((reward) => Number(reward.threshold_stamps)), [5, 20]);
  assert.equal(rewards[0].reward_type, 'coupon');
  assert.equal(rewards[0].consume_stamps, '5');
  assert.equal(rewards[0].lottery_win_rate, '0');
  assert.equal(rewards[1].reward_type, 'lottery');
  assert.equal(rewards[1].prizes[0].win_rate, '0');
  assert.equal(rewards[1].prizes[1].win_rate, '100');
  const memberReward = context.pointCardRewardForClient_(rewards[1]);
  assert.deepEqual(JSON.parse(JSON.stringify(memberReward.prizes.map((prize) => prize.prizeTitle))), ['頭獎咖啡機', '二獎咖啡券']);
  assert.equal(memberReward.prizes[0].winRate, undefined);
  const adminReward = context.pointCardRewardForClient_(rewards[1], true);
  assert.deepEqual(JSON.parse(JSON.stringify(adminReward.prizes.map((prize) => ({ prizeTitle: prize.prizeTitle, winRate: prize.winRate })))), [
    { prizeTitle: '頭獎咖啡機', winRate: 0 },
    { prizeTitle: '二獎咖啡券', winRate: 100 }
  ]);
});

test('PointCard reward validation accepts 0% and rejects duplicate or out-of-range nodes', () => {
  const { normalize, TestApiError } = loadPointCardService();
  assert.doesNotThrow(() => normalize([{ thresholdStamps: 5, consumeStamps: 3, rewardType: 'lottery', rewardTitle: '抽獎券', prizes: [{ prizeTitle: '0% 獎項', winRate: 0 }, { prizeTitle: '一般獎項', winRate: 100 }] }], 20));
  assert.throws(() => normalize([{ thresholdStamps: 5, consumeStamps: 6, rewardType: 'coupon', rewardTitle: '超額消耗' }], 20), (error) => error instanceof TestApiError && error.code === 'INVALID_CARD_REWARDS');
  assert.throws(() => normalize([
    { thresholdStamps: 5, rewardType: 'coupon', rewardTitle: 'A' },
    { thresholdStamps: 5, rewardType: 'lottery', rewardTitle: 'B', prizes: [{ prizeTitle: 'B 獎項', winRate: 100 }] }
  ], 20), (error) => error instanceof TestApiError && error.code === 'INVALID_CARD_REWARDS');
  assert.throws(() => normalize([{ thresholdStamps: 21, rewardType: 'coupon', rewardTitle: '超出' }], 20), (error) => error instanceof TestApiError && error.code === 'INVALID_CARD_REWARDS');
  assert.throws(() => normalize([{ thresholdStamps: 10, rewardType: 'lottery', rewardTitle: '錯誤', prizes: [{ prizeTitle: '超過', winRate: 101 }] }], 20), (error) => error instanceof TestApiError && error.code === 'INVALID_CARD_REWARDS');
  assert.throws(() => normalize([{ thresholdStamps: 10, rewardType: 'lottery', rewardTitle: '總和錯誤', prizes: [{ prizeTitle: '獎項 A', winRate: 40 }, { prizeTitle: '獎項 B', winRate: 40 }] }], 20), (error) => error instanceof TestApiError && error.code === 'INVALID_CARD_REWARDS');
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
    lotteryWinRate: 0,
    prizes: [],
    consumeStamps: 20
  });
});

test('point cards expose an explicit expiry state and keep unlimited cards active', () => {
  const { context } = loadPointCardService();
  const expired = context.pointCardForClient_({ card_id: 'PC-EXPIRED', target_stamps: '10', reward_title: '已到期', status: 'active', expiry_mode: 'date', expires_on: '2026-09-01' });
  const active = context.pointCardForClient_({ card_id: 'PC-ACTIVE', target_stamps: '10', reward_title: '無期限', status: 'active', expiry_mode: 'unlimited', expires_on: '' });
  assert.equal(expired.expiryMode, 'date');
  assert.equal(expired.expiresOn, '2026-09-01');
  assert.equal(expired.expired, true);
  assert.equal(active.expiryMode, 'unlimited');
  assert.equal(active.expiresOn, '');
  assert.equal(active.expired, false);
});

test('tickets keep a reward snapshot and never expose the usage code in the client ticket', () => {
  const { context } = loadPointCardService();
  context.PropertiesService = { getScriptProperties: () => ({ getProperty: (key) => key.endsWith('PC-1') ? '10' : '' }) };
  const memberCard = context.pointCardForClient_({ card_id: 'PC-1', target_stamps: '10', reward_title: '咖啡券' }, undefined, false);
  const adminCard = context.pointCardForClient_({ card_id: 'PC-1', target_stamps: '10', reward_title: '咖啡券' }, undefined, true);
  assert.equal(memberCard.usageCode, undefined);
  assert.equal(adminCard.usageCode, '10');
  assert.equal(memberCard.rewards[0].usageCode, undefined);
  assert.equal(adminCard.rewards[0].usageCode, undefined);
  const ticket = context.ticketRecordFromReward_('U-1', 'PC-1', {
    rewardId: 'PR-1', thresholdStamps: 10, consumeStamps: 3, rewardType: 'lottery', rewardTitle: '抽獎券', rewardDescription: '到店使用',
    prizes: [{ prizeId: 'P-0', prizeTitle: '不會抽中', prizeDescription: '', winRate: 0 }, { prizeId: 'P-1', prizeTitle: '咖啡券', prizeDescription: '', winRate: 100 }]
  }, 'PC-1:10', '2026-09-02T00:00:00.000Z');
  assert.equal(ticket.reward_key, 'PC-1:10');
  assert.equal(ticket.status, 'available');
  assert.equal(ticket.consume_stamps, '3');
  assert.doesNotMatch(JSON.stringify(ticket), /usage.?code|password/i);
  const clientTicket = context.ticketForClient_(ticket);
  assert.equal(clientTicket.prizes[0].winRate, undefined);
  assert.equal(clientTicket.prizes[1].prizeTitle, '咖啡券');
});

test('lottery drawing skips 0% prizes and returns the server-side result shape', () => {
  const { context } = loadPointCardService();
  context.generateTicketRandomBasisPoint_ = () => 0;
  const result = context.drawTicketPrize_({ lottery_prizes_json: JSON.stringify([
    { prize_id: 'P-0', prize_title: '0% 獎項', prize_description: '', win_rate: '0' },
    { prize_id: 'P-1', prize_title: '必中獎項', prize_description: '恭喜', win_rate: '100' }
  ]) });
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { prizeId: 'P-1', prizeTitle: '必中獎項', prizeDescription: '恭喜' });
});

test('ticket challenge returns five decoys plus the configured code and redeems only once', () => {
  const { context, rows, TestApiError } = loadTicketService();
  const identity = { lineUserId: 'U-1' };
  const challenge = context.handleTicketChallenge_(identity, { ticketId: 'TK-1' });
  assert.equal(challenge.options.length, 6);
  assert.equal(new Set(challenge.options).size, 6);
  assert.equal(challenge.options.includes('10'), true);
  assert.equal(JSON.parse(rows.PointCardTicketChallenges[0].options_json).hashes.length, 6);
  assert.doesNotMatch(rows.PointCardTicketChallenges[0].options_json, /10/);
  const redeemed = context.handleTicketRedeem_(identity, { ticketId: 'TK-1', challengeId: challenge.challengeId, selectedCode: '10' });
  assert.equal(redeemed.redeemed, true);
  assert.equal(rows.PointCardTickets[0].status, 'used');
  assert.equal(rows.PointBalances[0].stamps, '0');
  assert.equal(rows.PointEntries[0].amount, '-10');
  assert.deepEqual(context.visibleTicketsForMember_('U-1'), []);
  assert.throws(() => context.handleTicketRedeem_(identity, { ticketId: 'TK-1', challengeId: challenge.challengeId, selectedCode: '10' }), (error) => error instanceof TestApiError && error.code === 'TICKET_ALREADY_USED');
});

test('ticket redemption rejects insufficient balance without changing the ticket or balance', () => {
  const { context, rows, TestApiError } = loadTicketService();
  rows.PointBalances[0].stamps = '4';
  const challenge = context.handleTicketChallenge_({ lineUserId: 'U-1' }, { ticketId: 'TK-1' });
  assert.throws(() => context.handleTicketRedeem_({ lineUserId: 'U-1' }, { ticketId: 'TK-1', challengeId: challenge.challengeId, selectedCode: '10' }), (error) => error instanceof TestApiError && error.code === 'INSUFFICIENT_STAMPS');
  assert.equal(rows.PointCardTickets[0].status, 'available');
  assert.equal(rows.PointBalances[0].stamps, '4');
  assert.equal(rows.PointEntries.length, 0);
});

test('redeeming a node reissues its ticket while the remaining balance still covers consumption', () => {
  const { context, rows } = loadTicketService();
  rows.PointCards[0].target_stamps = '5';
  rows.PointCards[0].reward_title = '咖啡券';
  rows.PointCardTickets[0].threshold_stamps = '5';
  rows.PointCardTickets[0].reward_key = 'PC-1:5';
  rows.PointCardTickets[0].consume_stamps = '5';
  rows.PointBalances[0].stamps = '13';
  const challenge = context.handleTicketChallenge_({ lineUserId: 'U-1' }, { ticketId: 'TK-1' });
  const redeemed = context.handleTicketRedeem_({ lineUserId: 'U-1' }, { ticketId: 'TK-1', challengeId: challenge.challengeId, selectedCode: '10' });
  assert.equal(redeemed.balance.stamps, 8);
  assert.equal(redeemed.nextTickets.length, 1);
  assert.equal(redeemed.nextTickets[0].thresholdStamps, 5);
  assert.equal(rows.PointCardTickets.length, 2);
  assert.equal(rows.PointCardTickets[1].status, 'available');
  assert.equal(context.visibleTicketsForMember_('U-1').length, 1);
});

test('earned tickets can redeem when balance covers consumption without retaining the threshold balance', () => {
  const { context, rows } = loadTicketService();
  rows.PointCardTickets[0].consume_stamps = '3';
  rows.PointBalances[0].stamps = '3';
  const challenge = context.handleTicketChallenge_({ lineUserId: 'U-1' }, { ticketId: 'TK-1' });
  const redeemed = context.handleTicketRedeem_({ lineUserId: 'U-1' }, { ticketId: 'TK-1', challengeId: challenge.challengeId, selectedCode: '10' });
  assert.equal(redeemed.redeemed, true);
  assert.equal(rows.PointBalances[0].stamps, '0');
  assert.equal(rows.PointEntries[0].amount, '-3');
});

test('removed cards and their tickets are hidden from the member response', () => {
  const { context, rows } = loadTicketService();
  assert.equal(context.visibleTicketsForMember_('U-1').length, 1);
  rows.PointCards[0].status = 'archived';
  assert.deepEqual(context.visibleTicketsForMember_('U-1'), []);
});

test('expired cards reject ticket challenges even when an unused ticket remains', () => {
  const { context, rows, TestApiError } = loadTicketService();
  rows.PointCards[0].expiry_mode = 'date';
  rows.PointCards[0].expires_on = '2026-09-01';
  assert.throws(() => context.handleTicketChallenge_({ lineUserId: 'U-1' }, { ticketId: 'TK-1' }), (error) => error instanceof TestApiError && error.code === 'CARD_EXPIRED');
});

test('consumable tickets are reissued once while the balance covers consumption', () => {
  const { context, rows } = loadTicketService();
  rows.PointCards[0].target_stamps = '5';
  rows.PointCards[0].reward_title = '咖啡券';
  rows.PointCardTickets[0].threshold_stamps = '5';
  rows.PointCardTickets[0].reward_key = 'PC-1:5';
  rows.PointCardTickets[0].consume_stamps = '5';
  rows.PointCardTickets[0].status = 'used';
  context.issuePointCardTicketsForBalance_('U-1', rows.PointCards[0], 10, 10, '2026-09-02T00:00:00.000Z');
  assert.equal(rows.PointCardTickets.length, 2);
  context.issuePointCardTicketsForBalance_('U-1', rows.PointCards[0], 10, 10, '2026-09-02T00:00:00.000Z');
  assert.equal(rows.PointCardTickets.length, 2);
  assert.equal(rows.PointCardTickets[1].status, 'available');
  rows.PointCardTickets[1].status = 'used';
  context.issuePointCardTicketsForBalance_('U-1', rows.PointCards[0], 4, 5, '2026-09-02T00:00:00.000Z');
  assert.equal(rows.PointCardTickets.length, 3);
  assert.equal(rows.PointCardTickets[2].status, 'available');
});

test('admin and member surfaces expose milestone reward controls and progress', () => {
  const adminHtml = read('admin/index.html');
  const adminApp = read('admin/app.js');
  const pointsHtml = read('points/index.html');
  const pointsApp = read('points/app.js');
  const pointsStyles = read('points/styles.css');
  const storage = read('gas/Storage.gs');
  assert.match(storage, /PointCardRewards:/);
  assert.match(storage, /PointCardLotteryPrizes:/);
  assert.match(storage, /threshold_stamps/);
  assert.match(storage, /win_rate/);
  assert.match(adminHtml, /id="rewardRows"/);
  assert.match(adminHtml, /id="addRewardButton"/);
  assert.match(adminApp, /rewardType/);
  assert.match(adminApp, /prizeTitle/);
  assert.match(adminApp, /data-add-prize/);
  assert.match(adminApp, /平均分配/);
  assert.match(adminApp, /updateRewardRowSummary/);
  assert.match(adminApp, /card\.rewards/);
  assert.match(pointsHtml, /id="milestoneList"/);
  assert.match(pointsApp, /renderMilestones/);
  assert.match(pointsApp, /prize-opportunities/);
  assert.doesNotMatch(pointsStyles, /prize-opportunity span:last-child \{ display: none; \}/);
  assert.match(pointsApp, /data-use-ticket/);
  assert.doesNotMatch(pointsApp, /prizeRate/);
  assert.doesNotMatch(pointsApp, /winRate/);
  assert.match(pointsApp, /lottery-reveal/);
  assert.match(adminHtml, /id="generateTicketUsageCodeButton"/);
  assert.match(adminHtml, /沒有重新產生.*目前密碼/);
  assert.match(adminApp, /generateTicketUsageCodeButton/);
  assert.match(adminApp, /admin\.pointcards\.usage-code\.generate/);
  assert.match(adminApp, /未重新產生前不變/);
  assert.doesNotMatch(adminApp, /data-generate-usage-code/);
  assert.match(adminApp, /admin\.pointcards\.remove/);
  assert.match(pointsHtml, /id="ticketChoices"/);
  assert.match(storage, /PointCardTickets:/);
  assert.match(storage, /PointCardTicketChallenges:/);
  assert.match(read('gas/PointCardService.gs'), /POINT_CARD_TICKET_OPTION_COUNT_ = 6/);
  assert.match(read('gas/PointCardService.gs'), /POINT_CARD_TICKET_CODE_LENGTH_ = 2/);
  assert.match(adminApp, /consumeStamps/);
  assert.match(adminHtml, /cardExpiryMode/);
  assert.match(pointsApp, /使用消耗/);
  assert.match(pointsApp, /點數不足/);
  assert.match(pointsApp, /已取得票券 · 還差/);
  assert.doesNotMatch(pointsHtml, /targetCount|progressBar/);
  assert.doesNotMatch(adminHtml, /完成需要/);
  assert.match(pointsHtml, /兌換票券節點/);
  assert.match(adminHtml, /持續累積/);
  assert.match(pointsApp, /state\.tickets = state\.tickets\.filter/);
  assert.match(pointsApp, /result\.nextTickets/);
  assert.match(read('gas/PointCardService.gs'), /storedTargetStamps/);
  assert.doesNotMatch(read('gas/PointCardService.gs'), /舊版集點卡完成點數必須是/);
  assert.match(storage, /consume_stamps/);
  assert.match(storage, /expires_on/);
});
