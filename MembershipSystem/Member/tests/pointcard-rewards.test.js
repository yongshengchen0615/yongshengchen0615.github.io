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
    Members: [{ line_user_id: 'U-1', status: 'active' }],
    PointCards: [{ card_id: 'PC-1', status: 'active', expiry_mode: 'unlimited', expires_on: '' }],
    PointCardTickets: [{ ticket_id: 'TK-1', line_user_id: 'U-1', card_id: 'PC-1', reward_id: 'PR-1', reward_key: 'PC-1:10', threshold_stamps: '10', ticket_type: 'coupon', ticket_title: '咖啡券', ticket_description: '', lottery_prizes_json: '[]', status: 'available', failed_attempts: '0', earned_at: '2026-09-02T00:00:00.000Z', used_at: '', result_json: '', created_at: '2026-09-02T00:00:00.000Z', updated_at: '2026-09-02T00:00:00.000Z', consume_stamps: '10' }],
    PointBalances: [{ line_user_id: 'U-1', card_id: 'PC-1', stamps: '10', updated_at: '2026-09-02T00:00:00.000Z' }],
    PointEntries: [],
    PointMutations: [],
    PointCardTicketChallenges: [],
    PointCardRewards: [],
    PointCardLotteryPrizes: [],
    AuditLogs: []
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
    deleteRecordsWhere_: (sheetName, predicate) => {
      const records = rows[sheetName] || []; const retained = records.filter((record) => !predicate(record)); const deleted = records.length - retained.length;
      rows[sheetName] = retained; return deleted;
    },
    memberForClient_: (member) => ({ displayName: String(member.display_name || '測試會員'), tier: '銀級會員', birthday: '2000-01-01', phone: '0912345678', tierProgress: { serviceMinutesTotal: 600, currentRequiredServiceMinutes: 600, nextTierLabel: '金級會員', nextRequiredServiceMinutes: 1800, remainingServiceMinutes: 1200, isHighestTier: false } }),
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

test('PointCard reward validation uses the threshold as the only redemption cost', () => {
  const { normalize, TestApiError } = loadPointCardService();
  const normalized = normalize([{ thresholdStamps: 5, consumeStamps: 3, rewardType: 'lottery', rewardTitle: '抽獎券', prizes: [{ prizeTitle: '0% 獎項', winRate: 0 }, { prizeTitle: '一般獎項', winRate: 100 }] }], 20);
  assert.equal(normalized[0].consume_stamps, '5');
  assert.doesNotThrow(() => normalize([{ thresholdStamps: 5, consumeStamps: 6, rewardType: 'coupon', rewardTitle: '過時的消耗設定' }], 20));
  assert.throws(() => normalize([
    { thresholdStamps: 5, rewardType: 'coupon', rewardTitle: 'A' },
    { thresholdStamps: 5, rewardType: 'lottery', rewardTitle: 'B', prizes: [{ prizeTitle: 'B 獎項', winRate: 100 }] }
  ], 20), (error) => error instanceof TestApiError && error.code === 'INVALID_CARD_REWARDS');
  assert.throws(() => normalize([{ thresholdStamps: 21, rewardType: 'coupon', rewardTitle: '超出' }], 20), (error) => error instanceof TestApiError && error.code === 'INVALID_CARD_REWARDS');
  assert.throws(() => normalize([{ thresholdStamps: 10, rewardType: 'lottery', rewardTitle: '錯誤', prizes: [{ prizeTitle: '超過', winRate: 101 }] }], 20), (error) => error instanceof TestApiError && error.code === 'INVALID_CARD_REWARDS');
  assert.throws(() => normalize([{ thresholdStamps: 10, rewardType: 'lottery', rewardTitle: '總和錯誤', prizes: [{ prizeTitle: '獎項 A', winRate: 40 }, { prizeTitle: '獎項 B', winRate: 40 }] }], 20), (error) => error instanceof TestApiError && error.code === 'INVALID_CARD_REWARDS');
});

test('point card nodes can select a managed ticket template without duplicating its UI configuration', () => {
  const { context, normalize } = loadPointCardService();
  const templates = {
    'PT-COFFEE': {
      ticket_template_id: 'PT-COFFEE', title: '免費咖啡', ticket_type: 'coupon', description: '可兌換中杯咖啡', usage_method: '結帳前出示本券', usage_instructions: '確認使用後請向店員出示完成畫面。', lottery_prizes_json: '[]', status: 'active'
    }
  };
  const reward = normalize([{ thresholdStamps: 5, consumeStamps: 3, ticketTemplateId: 'PT-COFFEE' }], 20, templates)[0];
  assert.equal(reward.ticket_template_id, 'PT-COFFEE');
  assert.equal(reward.reward_title, '免費咖啡');
  assert.equal(reward.consume_stamps, '5');
  const clientReward = context.pointCardRewardForClient_(reward, false, templates);
  assert.equal(clientReward.ticketTemplateId, 'PT-COFFEE');
  assert.equal(clientReward.usageMethod, '結帳前出示本券');
  assert.equal(clientReward.usageInstructions, '確認使用後請向店員出示完成畫面。');
});

test('archiving a managed ticket stops new issuance without removing already earned tickets', () => {
  const { context, rows } = loadTicketService();
  rows.PointCardTickets[0].status = 'used';
  context.pointCardRewardsByCard_ = () => ({ 'PC-1': [{ reward_id: 'PR-1', card_id: 'PC-1', threshold_stamps: '5', consume_stamps: '5', ticket_template_id: 'PT-ARCHIVED' }] });
  context.pointCardTicketTemplatesById_ = () => ({ 'PT-ARCHIVED': { ticket_template_id: 'PT-ARCHIVED', status: 'archived', ticket_type: 'coupon', title: '停止發放的票券' } });
  context.issuePointCardTicketsForBalance_('U-1', rows.PointCards[0], 4, 5, '2026-09-02T00:00:00.000Z');
  assert.equal(rows.PointCardTickets.length, 1);
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
  const styled = context.pointCardForClient_({ card_id: 'PC-STYLED', target_stamps: '10', reward_title: '午夜藍', status: 'active', style_key: 'midnight' });
  assert.equal(expired.expiryMode, 'date');
  assert.equal(expired.expiresOn, '2026-09-01');
  assert.equal(expired.expired, true);
  assert.equal(active.expiryMode, 'unlimited');
  assert.equal(active.expiresOn, '');
  assert.equal(active.expired, false);
  assert.equal(styled.styleKey, 'midnight');
  assert.equal(active.styleKey, 'forest');
});

test('tickets keep a reward snapshot without any usage password data', () => {
  const { context } = loadPointCardService();
  const memberCard = context.pointCardForClient_({ card_id: 'PC-1', target_stamps: '10', reward_title: '咖啡券' }, undefined, false);
  const adminCard = context.pointCardForClient_({ card_id: 'PC-1', target_stamps: '10', reward_title: '咖啡券' }, undefined, true);
  assert.equal(memberCard.usageCode, undefined);
  assert.equal(adminCard.usageCode, undefined);
  assert.equal(memberCard.rewards[0].usageCode, undefined);
  assert.equal(adminCard.rewards[0].usageCode, undefined);
  const ticket = context.ticketRecordFromReward_('U-1', 'PC-1', {
    rewardId: 'PR-1', thresholdStamps: 10, consumeStamps: 3, rewardType: 'lottery', rewardTitle: '抽獎券', rewardDescription: '到店使用',
    prizes: [{ prizeId: 'P-0', prizeTitle: '不會抽中', prizeDescription: '', winRate: 0 }, { prizeId: 'P-1', prizeTitle: '咖啡券', prizeDescription: '', winRate: 100 }]
  }, 'PC-1:10', '2026-09-02T00:00:00.000Z');
  assert.equal(ticket.reward_key, 'PC-1:10');
  assert.equal(ticket.status, 'available');
  assert.equal(ticket.consume_stamps, '10');
  assert.doesNotMatch(JSON.stringify(ticket), /usage.?code|password/i);
  const clientTicket = context.ticketForClient_(ticket);
  assert.deepEqual(JSON.parse(JSON.stringify(clientTicket.prizes.map((prize) => prize.prizeTitle))), ['不會抽中', '咖啡券']);
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

test('tickets redeem directly and only once', () => {
  const { context, rows, TestApiError } = loadTicketService();
  const identity = { lineUserId: 'U-1' };
  const redeemed = context.handleTicketRedeem_(identity, { ticketId: 'TK-1' });
  assert.equal(redeemed.redeemed, true);
  assert.equal(rows.PointCardTickets[0].status, 'used');
  assert.equal(rows.PointBalances[0].stamps, '0');
  assert.equal(rows.PointEntries[0].amount, '-10');
  assert.equal(rows.PointEntries[0].entry_type, 'ticket_redeem');
  assert.equal(rows.PointEntries[0].reference_type, 'point_card_ticket');
  assert.equal(rows.PointEntries[0].reference_id, 'TK-1');
  assert.equal(rows.PointCardTickets[0].points_spent, '10');
  assert.equal(rows.PointCardTickets[0].redeem_entry_id, rows.PointEntries[0].entry_id);
  assert.equal(redeemed.activity.activityId, 'ticket:TK-1');
  assert.equal(redeemed.activity.pointsSpent, 10);
  assert.deepEqual(context.visibleTicketsForMember_('U-1'), []);
  const replay = context.handleTicketRedeem_(identity, { ticketId: 'TK-1' });
  assert.equal(replay.alreadyRedeemed, true);
  assert.equal(rows.PointBalances[0].stamps, '0');
  assert.equal(rows.PointEntries.length, 1);
});


test('ticket history presents one correlated business event after refresh', () => {
  const { context, rows } = loadTicketService();
  rows.PointCardTickets[0].ticket_type = 'lottery';
  rows.PointCardTickets[0].ticket_title = '抽獎券';
  rows.PointCardTickets[0].lottery_prizes_json = JSON.stringify([{ prize_id: 'P-NONE', prize_title: '未獲得優惠', prize_description: '本次未中獎', win_rate: '100' }]);
  context.generateTicketRandomBasisPoint_ = () => 0;
  const redeemed = context.handleTicketRedeem_({ lineUserId: 'U-1' }, { ticketId: 'TK-1' });
  assert.equal(redeemed.activity.activityType, 'lottery_ticket_redeem');
  assert.equal(redeemed.activity.result.prizeTitle, '未獲得優惠');
  assert.equal(redeemed.activity.pointsSpent, 10);

  context.ensureMember_ = () => ({ display_name: '測試會員' });
  const refreshed = context.handlePointCardBootstrap_({ lineUserId: 'U-1', displayName: '測試會員' });
  assert.equal(refreshed.history.length, 1);
  assert.equal(refreshed.history[0].activityId, 'ticket:TK-1');
  assert.equal(refreshed.history[0].pointsSpent, 10);
  assert.equal(refreshed.history[0].result.prizeTitle, '未獲得優惠');
});

test('point-card bootstrap limits history payload while retaining the exact total', () => {
  const { context, rows } = loadTicketService();
  rows.PointCardTickets = Array.from({ length: 7 }, (_, index) => ({
    ...rows.PointCardTickets[0],
    ticket_id: `TK-HISTORY-${index + 1}`,
    status: 'used',
    used_at: `2026-09-0${index + 1}T00:00:00.000Z`,
    points_spent: '10'
  }));
  context.ensureMember_ = () => ({ display_name: '測試會員' });
  const result = context.handlePointCardBootstrap_({ lineUserId: 'U-1', displayName: '測試會員' });
  assert.equal(result.historyTotal, 7);
  assert.equal(result.history.length, 5);
  assert.equal(result.history[0].ticketId, 'TK-HISTORY-7');
});

test('legacy used tickets remain one history item without scanning the point ledger', () => {
  const { context, rows } = loadTicketService();
  rows.PointCardTickets[0].status = 'used';
  rows.PointCardTickets[0].used_at = '2026-09-02T08:52:00.000Z';
  rows.PointCardTickets[0].result_json = JSON.stringify({ prizeTitle: '未獲得優惠' });
  let pointEntryReads = 0;
  const readRecords = context.readRecords_;
  context.readRecords_ = (sheetName) => { if (sheetName === 'PointEntries') pointEntryReads += 1; return readRecords(sheetName); };
  const history = context.pointCardActivityHistoryForMember_('U-1');
  assert.equal(history.length, 1);
  assert.equal(history[0].activityId, 'ticket:TK-1');
  assert.equal(history[0].pointsSpent, 10);
  assert.equal(pointEntryReads, 0);
});

test('point cards sort by the persisted display order before stable fallbacks', () => {
  const { context } = loadPointCardService();
  const cards = [
    { cardId: 'PC-B', title: '第二張', sortOrder: 20, createdAt: '2026-09-02' },
    { cardId: 'PC-A', title: '第一張', sortOrder: 10, createdAt: '2026-09-03' },
    { cardId: 'PC-C', title: '同序較早', sortOrder: 10, createdAt: '2026-09-01' }
  ].sort(context.comparePointCards_);
  assert.deepEqual(cards.map((card) => card.cardId), ['PC-C', 'PC-A', 'PC-B']);
});

test('point-card reorder updates the complete list atomically and rejects stale edits', () => {
  const { context, rows, TestApiError } = loadTicketService();
  rows.PointCards[0].title = '第一張';
  rows.PointCards[0].sort_order = '10';
  rows.PointCards[0].updated_at = 'old-1';
  rows.PointCards.push({ card_id: 'PC-2', title: '第二張', status: 'draft', expiry_mode: 'unlimited', expires_on: '', sort_order: '20', updated_at: 'old-2', created_at: '2026-09-02T00:00:00.000Z' });
  let auditCount = 0;
  context.appendAuditRecord_ = () => { auditCount += 1; };

  const result = context.handlePointCardReorder_({ lineUserId: 'ADMIN-1' }, { role: 'admin' }, { cardOrders: [
    { cardId: 'PC-2', sortOrder: 0, expectedUpdatedAt: 'old-2' },
    { cardId: 'PC-1', sortOrder: 1, expectedUpdatedAt: 'old-1' }
  ] });
  assert.deepEqual(JSON.parse(JSON.stringify(result.cards.map((card) => card.cardId))), ['PC-2', 'PC-1']);
  assert.deepEqual(rows.PointCards.map((card) => Number(card.sort_order)), [1, 0]);
  assert.equal(auditCount, 2);

  const before = JSON.stringify(rows.PointCards);
  assert.throws(() => context.handlePointCardReorder_({ lineUserId: 'ADMIN-1' }, { role: 'admin' }, { cardOrders: [
    { cardId: 'PC-2', sortOrder: 0, expectedUpdatedAt: 'old-2' },
    { cardId: 'PC-1', sortOrder: 1, expectedUpdatedAt: 'old-1' }
  ] }), (error) => error instanceof TestApiError && error.code === 'CONFLICT');
  assert.equal(JSON.stringify(rows.PointCards), before);
});

test('point-card bootstrap uses one coherent snapshot instead of repeated full-sheet reads', () => {
  const { context, rows } = loadTicketService();
  const calls = {};
  const readRecords = context.readRecords_;
  context.readRecords_ = (sheetName) => { calls[sheetName] = (calls[sheetName] || 0) + 1; return readRecords(sheetName); };
  context.ensureMember_ = () => ({ display_name: '測試會員' });
  const response = context.handlePointCardBootstrap_({ lineUserId: 'U-1', displayName: '測試會員' });
  assert.equal(response.profile.displayName, '測試會員');
  assert.deepEqual(JSON.parse(JSON.stringify(response.profile)), { displayName: '測試會員', tier: '銀級會員', tierProgress: { serviceMinutesTotal: 600, currentRequiredServiceMinutes: 600, nextTierLabel: '金級會員', nextRequiredServiceMinutes: 1800, remainingServiceMinutes: 1200, isHighestTier: false } });
  assert.equal(response.cards.length, 1);
  assert.equal(response.tickets.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), {
    PointCards: 1,
    PointCardRewards: 1,
    PointCardLotteryPrizes: 1,
    PointCardTicketTemplates: 1,
    PointBalances: 1,
    PointCardTickets: 1,
    PointMutations: 1
  });
  assert.equal(rows.PointCardTickets.length, 1);
});

test('point-card bootstrap returns tickets reissued from its snapshot', () => {
  const { context, rows } = loadTicketService();
  rows.PointCards[0].target_stamps = '10';
  rows.PointCards[0].reward_title = '咖啡券';
  rows.PointCardTickets[0].status = 'used';
  const readRecords = context.readRecords_;
  context.readRecords_ = (sheetName) => readRecords(sheetName).map((record) => ({ ...record }));
  context.ensureMember_ = () => ({ display_name: '測試會員' });
  const response = context.handlePointCardBootstrap_({ lineUserId: 'U-1', displayName: '測試會員' });
  assert.equal(rows.PointCardTickets.length, 2);
  assert.equal(rows.PointCardTickets[1].status, 'available');
  assert.equal(response.tickets.length, 1);
  assert.equal(response.tickets[0].ticketId, rows.PointCardTickets[1].ticket_id);
});

test('direct ticket redemption still enforces ticket ownership', () => {
  const { context, rows, TestApiError } = loadTicketService();
  assert.throws(() => context.handleTicketRedeem_({ lineUserId: 'U-2' }, { ticketId: 'TK-1' }), (error) => error instanceof TestApiError && error.code === 'TICKET_NOT_FOUND');
  assert.equal(rows.PointCardTickets[0].status, 'available');
  assert.equal(rows.PointBalances[0].stamps, '10');
  assert.equal(rows.PointEntries.length, 0);
});

test('legacy locked tickets can use the password-free redemption flow', () => {
  const { context, rows } = loadTicketService();
  rows.PointCardTickets[0].status = 'locked';
  const redeemed = context.handleTicketRedeem_({ lineUserId: 'U-1' }, { ticketId: 'TK-1' });
  assert.equal(redeemed.redeemed, true);
  assert.equal(rows.PointCardTickets[0].status, 'used');
});

test('ticket redemption rejects insufficient balance without changing the ticket or balance', () => {
  const { context, rows, TestApiError } = loadTicketService();
  rows.PointBalances[0].stamps = '4';
  assert.throws(() => context.handleTicketRedeem_({ lineUserId: 'U-1' }, { ticketId: 'TK-1' }), (error) => error instanceof TestApiError && error.code === 'INSUFFICIENT_STAMPS');
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
  const redeemed = context.handleTicketRedeem_({ lineUserId: 'U-1' }, { ticketId: 'TK-1' });
  assert.equal(redeemed.balance.stamps, 8);
  assert.equal(redeemed.nextTickets.length, 1);
  assert.equal(redeemed.nextTickets[0].thresholdStamps, 5);
  assert.equal(rows.PointCardTickets.length, 2);
  assert.equal(rows.PointCardTickets[1].status, 'available');
  assert.equal(context.visibleTicketsForMember_('U-1').length, 1);
});

test('earned tickets always require their threshold even when legacy consumption data is lower', () => {
  const { context, rows } = loadTicketService();
  rows.PointCardTickets[0].consume_stamps = '3';
  rows.PointBalances[0].stamps = '3';
  assert.throws(() => context.handleTicketRedeem_({ lineUserId: 'U-1' }, { ticketId: 'TK-1' }), (error) => error && error.code === 'INSUFFICIENT_STAMPS');
  assert.equal(rows.PointBalances[0].stamps, '3');
  assert.equal(rows.PointEntries.length, 0);
});

test('replaying the same stamp request does not add points twice', () => {
  const { context, rows, TestApiError } = loadTicketService();
  context.issuePointCardTicketsForBalance_ = () => [];
  const identity = { lineUserId: 'ADMIN-1' };
  const admin = { role: 'admin' };
  const request = { lineUserId: 'U-1', cardId: 'PC-1', amount: 2, note: '到店補登', requestId: 'stamp-request-0001' };
  const first = context.handleStampAdd_(identity, admin, request);
  const replay = context.handleStampAdd_(identity, admin, request);
  assert.equal(first.stamps, 12);
  assert.equal(replay.stamps, 12);
  assert.equal(rows.PointBalances[0].stamps, '12');
  assert.equal(rows.PointEntries.length, 1);
  assert.equal(rows.PointEntries[0].request_id, 'stamp-request-0001');
  assert.throws(() => context.handleStampAdd_(identity, admin, Object.assign({}, request, { amount: 3 })), (error) => error instanceof TestApiError && error.code === 'REQUEST_REUSE_MISMATCH');
});

test('pending point grants recover after the journal write without duplicating member rights', () => {
  const { context, rows } = loadTicketService();
  context.issuePointCardTicketsForBalance_ = () => [];
  rows.PointMutations.push({
    operation_id: 'point_grant:stamp-recovery-0001', operation_type: 'point_grant', request_id: 'stamp-recovery-0001', line_user_id: 'U-1', card_id: 'PC-1', amount: '2', ticket_id: '', before_stamps: '10', after_stamps: '12', entry_id: 'PEM-point_grant_stamp-recovery-0001', note: '弱網補登', created_by: 'ADMIN-1', result_json: '', status: 'pending', created_at: '2026-09-02T00:00:00.000Z', updated_at: '2026-09-02T00:00:00.000Z'
  });

  assert.equal(context.reconcilePendingPointMutationsForMember_('U-1'), true);
  assert.equal(rows.PointBalances[0].stamps, '12');
  assert.equal(rows.PointEntries.length, 1);
  assert.equal(rows.PointEntries[0].request_id, 'stamp-recovery-0001');
  assert.equal(rows.PointMutations[0].status, 'complete');
  assert.equal(context.reconcilePendingPointMutationsForMember_('U-1'), false);
  assert.equal(rows.PointBalances[0].stamps, '12');
  assert.equal(rows.PointEntries.length, 1);
});

test('pending ticket redemption recovers when the balance changed before the ticket and ledger writes', () => {
  const { context, rows } = loadTicketService();
  rows.PointBalances[0].stamps = '0';
  rows.PointMutations.push({
    operation_id: 'ticket_redeem:TK-1', operation_type: 'ticket_redeem', request_id: '', line_user_id: 'U-1', card_id: 'PC-1', amount: '-10', ticket_id: 'TK-1', before_stamps: '10', after_stamps: '0', entry_id: 'PEM-ticket_redeem_TK-1', note: '票券兌換：咖啡券', created_by: 'U-1', result_json: '', status: 'pending', created_at: '2026-09-02T00:00:00.000Z', updated_at: '2026-09-02T00:00:00.000Z'
  });

  assert.equal(context.reconcilePendingPointMutationsForMember_('U-1'), true);
  assert.equal(rows.PointBalances[0].stamps, '0');
  assert.equal(rows.PointEntries.length, 1);
  assert.equal(rows.PointCardTickets[0].status, 'used');
  assert.equal(rows.PointCardTickets[0].redeem_entry_id, rows.PointEntries[0].entry_id);
  assert.equal(rows.PointMutations[0].status, 'complete');
  const replay = context.handleTicketRedeem_({ lineUserId: 'U-1' }, { ticketId: 'TK-1' });
  assert.equal(replay.alreadyRedeemed, true);
  assert.equal(rows.PointEntries.length, 1);
});

test('archiving a point card preserves its data while hiding it from members', () => {
  const { context, rows } = loadTicketService();
  const archived = context.handlePointCardArchive_({ lineUserId: 'ADMIN-1' }, { role: 'admin' }, { cardId: 'PC-1' });
  assert.equal(archived.card.status, 'archived');
  assert.equal(rows.PointCards.length, 1);
  assert.equal(rows.PointCardTickets.length, 1);
  assert.equal(rows.PointBalances.length, 1);
  assert.deepEqual(context.visibleTicketsForMember_('U-1'), []);
});

test('deleting a point card permanently removes its dependent records but not shared ticket templates', () => {
  const { context, rows } = loadTicketService();
  rows.PointCardRewards.push({ reward_id: 'PR-1', card_id: 'PC-1' });
  rows.PointCardLotteryPrizes.push({ prize_id: 'PP-1', reward_id: 'PR-1' });
  rows.PointCardTicketChallenges.push({ challenge_id: 'CH-1', ticket_id: 'TK-1' });
  rows.PointEntries.push({ entry_id: 'PE-1', card_id: 'PC-1' });
  rows.AuditLogs.push(
    { target_type: 'point_card', target_id: 'PC-1' },
    { target_type: 'point_card_ticket', target_id: 'TK-1' },
    { target_type: 'point_balance', target_id: 'U-1:PC-1' },
    { target_type: 'point_card', target_id: 'PC-OTHER' }
  );
  rows.PointCardTicketTemplates = [{ ticket_template_id: 'PT-SHARED', title: '共用票券' }];
  const deleted = context.handlePointCardDelete_({ lineUserId: 'ADMIN-1' }, { role: 'admin' }, { cardId: 'PC-1' });
  assert.equal(deleted.deleted, true);
  assert.deepEqual(JSON.parse(JSON.stringify(deleted.counts)), { ticketChallenges: 1, lotteryPrizes: 1, rewards: 1, tickets: 1, balances: 1, entries: 1, mutations: 0, auditLogs: 3, cards: 1 });
  assert.equal(rows.PointCards.length, 0);
  assert.equal(rows.PointCardRewards.length, 0);
  assert.equal(rows.PointCardLotteryPrizes.length, 0);
  assert.equal(rows.PointCardTickets.length, 0);
  assert.equal(rows.PointBalances.length, 0);
  assert.equal(rows.PointEntries.length, 0);
  assert.equal(rows.PointCardTicketChallenges.length, 0);
  assert.equal(rows.AuditLogs.length, 1);
  assert.equal(rows.PointCardTicketTemplates.length, 1);
});

test('removed cards and their tickets are hidden from the member response', () => {
  const { context, rows } = loadTicketService();
  assert.equal(context.visibleTicketsForMember_('U-1').length, 1);
  rows.PointCards[0].status = 'archived';
  assert.deepEqual(context.visibleTicketsForMember_('U-1'), []);
});

test('expired cards reject direct ticket redemption even when an unused ticket remains', () => {
  const { context, rows, TestApiError } = loadTicketService();
  rows.PointCards[0].expiry_mode = 'date';
  rows.PointCards[0].expires_on = '2026-09-01';
  assert.throws(() => context.handleTicketRedeem_({ lineUserId: 'U-1' }, { ticketId: 'TK-1' }), (error) => error instanceof TestApiError && error.code === 'CARD_EXPIRED');
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

test('admin ticket library and member ticket confirmation flow are present', () => {
  const adminHtml = read('admin/index.html');
  const adminApp = read('admin/app.js');
  const pointsHtml = read('points/index.html');
  const pointsApp = read('points/app.js');
  const pointsStyles = read('points/styles.css');
  const storage = read('gas/Storage.gs');
  assert.match(storage, /PointCardRewards:/);
  assert.match(storage, /PointCardTicketTemplates:/);
  assert.match(storage, /PointCardLotteryPrizes:/);
  assert.match(storage, /ticket_template_id/);
  assert.match(storage, /usage_method/);
  assert.match(storage, /usage_instructions/);
  assert.match(storage, /threshold_stamps/);
  assert.match(storage, /win_rate/);
  assert.match(adminHtml, /id="rewardRows"/);
  assert.match(adminHtml, /id="cardExpiresOnSummary"/);
  assert.match(adminHtml, /data-date-target="cardExpiresOn"/);
  assert.match(adminHtml, /data-open-date-picker="cardExpiresOn"/);
  assert.match(adminApp, /input\.showPicker/);
  assert.match(adminApp, /updateCardExpiryDateUI/);
  assert.match(adminApp, /formatAdminDateCompact/);
  assert.match(adminHtml, /id="addRewardButton"/);
  assert.match(adminHtml, /id="cardSettingsTab"/);
  assert.match(adminHtml, /id="ticketSettingsTab"/);
  assert.match(adminHtml, /id="ticketSettingsPanel"/);
  assert.doesNotMatch(adminHtml, /id="ticketsTab"/);
  assert.match(adminApp, /switchCardWorkspace\('tickets'\)/);
  assert.match(adminHtml, /id="ticketUsageMethod"/);
  assert.match(adminHtml, /id="ticketUsageInstructions"/);
  assert.match(adminApp, /ticketTemplateId/);
  assert.match(adminApp, /admin\.tickets\.save/);
  assert.match(adminHtml, /平均分配/);
  assert.match(adminApp, /選擇票券/);
  assert.doesNotMatch(adminHtml, /獎勵類型/);
  assert.match(pointsHtml, /id="ticketList"/);
  assert.match(pointsHtml, /id="ticketModalUsageInstructions"/);
  assert.match(pointsHtml, /id="confirmTicketUseButton"/);
  assert.match(pointsHtml, /id="membershipProgressTitle"/);
  assert.match(pointsHtml, /id="membershipProgress"/);
  assert.match(pointsHtml, /data-membership-current-tier/);
  assert.match(pointsHtml, /membership-progress\.js/);
  assert.match(pointsHtml, /集點卡票券總覽/);
  assert.match(pointsApp, /MembershipProgress\.render\(els\.membershipProgress, state\.profile\)/);
  assert.doesNotMatch(pointsApp, /function renderMembershipProgress/);
  assert.doesNotMatch(pointsHtml, /id="milestoneList"/);
  assert.doesNotMatch(pointsApp, /renderMilestones/);
  assert.doesNotMatch(pointsApp, /已取得票券 · 還差/);
  assert.doesNotMatch(pointsApp, /目前有 .* 張可使用票券/);
  assert.match(pointsApp, /ticketOffersForCard/);
  assert.match(pointsApp, /即可解鎖/);
  assert.match(pointsStyles, /member-ticket-list/);
  assert.match(pointsApp, /data-use-ticket/);
  assert.match(pointsApp, /createLotteryPrizeOpportunities/);
  assert.match(pointsApp, /有機會獲得/);
  assert.match(pointsApp, /prize-opportunities/);
  assert.doesNotMatch(pointsApp, /prizeRate/);
  assert.doesNotMatch(pointsApp, /winRate/);
  assert.match(pointsApp, /lottery-reveal/);
  assert.doesNotMatch(adminHtml, /ticket-code-settings|generateTicketUsageCodeButton|票券使用密碼/);
  assert.doesNotMatch(adminApp, /generateTicketUsageCode|usage-code\.generate|updateTicketUsageCodeUI/);
  assert.doesNotMatch(adminApp, /data-generate-usage-code/);
  assert.match(adminHtml, /id="archiveCardButton"/);
  assert.match(adminHtml, /id="deleteCardButton"/);
  assert.match(adminApp, /admin\.pointcards\.archive/);
  assert.match(adminApp, /admin\.pointcards\.delete/);
  assert.match(read('gas/Code.gs'), /admin\.pointcards\.remove/);
  assert.match(read('gas/PointCardService.gs'), /handlePointCardDelete_/);
  assert.match(storage, /PointCardTickets:/);
  assert.match(pointsHtml, /確認使用這張票券/);
  assert.match(pointsHtml, /id="ticketModalProcessing"/);
  assert.match(pointsHtml, /id="ticketHistoryList"/);
  assert.match(pointsApp, /function renderHistory\(\)/);
  assert.match(pointsApp, /本次抽獎結果/);
  assert.doesNotMatch(pointsApp, /恭喜你抽中/);
  assert.match(pointsApp, /本次實際扣除/);
  assert.match(pointsApp, /紀錄編號/);
  assert.match(pointsApp, /confirmTicketUseButton\.addEventListener/);
  assert.match(pointsApp, /redeemTicket/);
  assert.match(pointsApp, /setTicketProcessing\(true\)/);
  assert.match(pointsApp, /setTicketProcessing\(false\)/);
  assert.match(pointsStyles, /ticket-processing-spinner/);
  assert.doesNotMatch(pointsApp, /handleTicketChoice|startTicketChallenge|selectedCode|challengeId|ticket\.challenge/);
  assert.doesNotMatch(read('gas/PointCardService.gs'), /ticketUsageCode|handleTicketChallenge_|selectedCode|POINT_CARD_TICKET_OPTION_COUNT_|POINT_CARD_TICKET_CODE_LENGTH_/);
  assert.doesNotMatch(read('gas/Code.gs'), /usage-code\.generate|ticket\.challenge/);
  assert.doesNotMatch(adminApp, /consumeStamps/);
  assert.doesNotMatch(adminHtml, /兌換消耗|消耗點數|扣除幾點/);
  assert.match(adminHtml, /cardExpiryMode/);
  assert.doesNotMatch(pointsHtml, /targetCount|progressBar/);
  assert.doesNotMatch(adminHtml, /完成需要/);
  assert.match(pointsApp, /state\.tickets = state\.tickets\.filter/);
  assert.match(pointsApp, /result\.nextTickets/);
  assert.match(read('gas/PointCardService.gs'), /storedTargetStamps/);
  assert.doesNotMatch(read('gas/PointCardService.gs'), /舊版集點卡完成點數必須是/);
  assert.match(storage, /consume_stamps/);
  assert.match(storage, /expires_on/);
  assert.match(storage, /request_id/);
  assert.match(adminApp, /refreshAfterSuccessfulWrite/);
  assert.match(adminHtml, /id="grantModal"/);
  assert.match(adminHtml, /id="grantStampsEnabled"/);
  assert.match(adminHtml, /id="grantServiceTimeEnabled"/);
  assert.match(adminApp, /requestId: state\.grantRequestId/);
  assert.match(adminApp, /admin\.member-grants\.add/);
  assert.match(adminApp, /API_RESPONSE_UNCERTAIN/);
  assert.match(read('points/common.js'), /API_RESPONSE_UNCERTAIN/);
  assert.doesNotMatch(read('points/common.js'), /確認 GAS 部署的是最新版本/);
  assert.match(pointsApp, /uncertainTicketId/);
  assert.match(pointsHtml, /id="refreshTicketButton"/);
});
