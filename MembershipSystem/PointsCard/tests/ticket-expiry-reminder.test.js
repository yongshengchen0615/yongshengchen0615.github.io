'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
function read(relativePath) { return fs.readFileSync(path.join(root, relativePath), 'utf8'); }

test('reward nodes accept backward-compatible ticket expiry and reminder terms', () => {
  const context = {};
  vm.createContext(context);
  vm.runInContext(read('gas/Code.gs') + '\n;globalThis.__ticketTerms = { normalizeRewardNodes_, rewardEntitlementByOrdinal_, publicRewardTicket_ };', context);

  const nodes = context.__ticketTerms.normalizeRewardNodes_([{
    stampsRequired: 3,
    rewardName: '生日優惠券',
    rewardType: 'coupon',
    ticketValidityDays: 30,
    unusedReminderDays: 7
  }], 'INVALID_REWARD_NODES', 'invalid');
  const settings = { cardSize: 3, rewardNodes: nodes };
  const reward = context.__ticketTerms.rewardEntitlementByOrdinal_(1, settings);
  const ticket = context.__ticketTerms.publicRewardTicket_(reward);

  assert.equal(ticket.ticketValidityDays, 30);
  assert.equal(ticket.unusedReminderDays, 7);
  const legacy = context.__ticketTerms.normalizeRewardNodes_([{
    stampsRequired: 10,
    rewardName: '舊版優惠券',
    rewardType: 'coupon'
  }], 'INVALID_REWARD_NODES', 'invalid');
  assert.equal(legacy[0].ticketValidityDays, 0);
  assert.equal(legacy[0].unusedReminderDays, 0);
  assert.throws(
    () => context.__ticketTerms.normalizeRewardNodes_([{
      stampsRequired: 3,
      rewardName: '錯誤期限',
      rewardType: 'coupon',
      ticketValidityDays: 7,
      unusedReminderDays: 7
    }], 'INVALID_REWARD_NODES', 'invalid'),
    (error) => error && error.publicCode === 'INVALID_REWARD_NODES'
  );
});

test('earned ticket state is based on the stamp record that crossed its node', () => {
  const context = {};
  vm.createContext(context);
  vm.runInContext(read('gas/Code.gs') + '\n' + read('gas/TicketNotificationService.gs') +
    '\n;globalThis.__ticketState = { multiCardRewardTicketState_ };', context);
  const earnedAt = '2026-08-01T00:00:00.000Z';
  const state = context.__ticketState.multiCardRewardTicketState_({
    absoluteStamps: 3,
    ticketValidityDays: 10,
    unusedReminderDays: 2
  }, {
    createdAt: '2026-07-01T00:00:00.000Z'
  }, {
    joinedAt: '2026-06-01T00:00:00.000Z'
  }, [{
    status: 'recorded',
    totalBefore: 2,
    totalAfter: 3,
    recordedAt: earnedAt
  }], new Date('2026-08-05T00:00:00.000Z').getTime());

  assert.equal(state.earnedAt, earnedAt);
  assert.equal(state.reminderAt, '2026-08-03T00:00:00.000Z');
  assert.equal(state.expiresAt, '2026-08-11T00:00:00.000Z');
  assert.equal(state.expired, false);
  assert.equal(state.usable, true);

  const expired = context.__ticketState.multiCardRewardTicketState_(state, {}, {}, [{
    status: 'recorded', totalBefore: 2, totalAfter: 3, recordedAt: earnedAt
  }], new Date('2026-08-11T00:00:00.000Z').getTime());
  assert.equal(expired.expired, true);
  assert.equal(expired.usable, false);
});

test('LINE reminder push always uses a stable retry key and accepts duplicate acknowledgement', () => {
  let request = null;
  const context = {
    UrlFetchApp: {
      fetch: (url, options) => {
        request = { url, options };
        return { getResponseCode: () => 409 };
      }
    }
  };
  vm.createContext(context);
  vm.runInContext(read('gas/TicketNotificationService.gs') +
    '\n;globalThis.__reminderPush = { ticketReminderNotificationId_, ticketReminderRetryKey_, sendTicketReminderPush_ };', context);
  context.sha256Hex_ = () => '123e4567e89b12d3a456426614174000123e4567e89b12d3a456426614174000';
  const notificationId = context.__reminderPush.ticketReminderNotificationId_('CARD-ONE', 'U123', 1);
  const retryKey = context.__reminderPush.ticketReminderRetryKey_('RN-1');
  const result = context.__reminderPush.sendTicketReminderPush_('secret-token', 'U123', retryKey, '提醒內容');

  assert.match(retryKey, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.match(notificationId, /^RN-[0-9A-F]{32}$/);
  assert.equal(request.url, 'https://api.line.me/v2/bot/message/push');
  assert.equal(request.options.headers['X-Line-Retry-Key'], retryKey);
  assert.equal(request.options.headers.Authorization, 'Bearer secret-token');
  assert.doesNotMatch(request.options.payload, /secret-token/);
  assert.deepEqual(JSON.parse(request.options.payload), {
    to: 'U123', messages: [{ type: 'text', text: '提醒內容' }]
  });
  assert.equal(result.accepted, true);
  assert.equal(result.retryable, false);
});

test('ticket terms, card validity, archived ticket access, and reminder trigger are wired end to end', () => {
  const storage = read('gas/MultiCardStorage.gs');
  const rewards = read('gas/MultiCardRewardService.gs');
  const reminders = read('gas/TicketNotificationService.gs');
  const member = read('user/app.js');
  const memberHtml = read('user/index.html');
  const admin = read('admin/card-lifecycle.js');
  const manifest = JSON.parse(read('gas/appsscript.json'));

  assert.match(storage, /notifications:\s*'CardRewardNotifications'/);
  assert.match(storage, /card\.storedStatus !== 'deleted' \|\| Boolean\(progressMap\[card\.cardId\]\)/);
  assert.match(storage, /preservedUnusedRewards:\s*true/);
  assert.match(storage, /multiCardRewardTicketState_/);
  assert.match(rewards, /REWARD_EXPIRED/);
  assert.match(reminders, /LINE_MESSAGING_CHANNEL_ACCESS_TOKEN/);
  assert.match(reminders, /runPointsCardTicketReminderSweep/);
  assert.match(reminders, /X-Line-Retry-Key/);
  assert.doesNotMatch(read('gas/Code.gs'), /case '.*reminder/i);
  assert.match(admin, /reward-node-validity-days/);
  assert.match(admin, /reward-node-reminder-days/);
  assert.match(memberHtml, /id="cardValidityText"/);
  assert.match(member, /集點卡期限：/);
  assert.match(member, /使用期限：/);
  assert.match(member, /scanRewardButton'\)\.disabled = ticket\.expired \|\| !ticket\.usable \|\| rewardClaimInFlight/);
  assert.ok(manifest.oauthScopes.includes('https://www.googleapis.com/auth/script.scriptapp'));
});
