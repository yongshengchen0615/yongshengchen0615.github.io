'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
function read(relativePath) { return fs.readFileSync(path.join(root, relativePath), 'utf8'); }

function card(cardId, status, available) {
  return {
    cardId,
    name: cardId,
    description: '',
    storedStatus: status === 'deleted' ? 'deleted' : 'active',
    status,
    available,
    expiresAt: '',
    updatedAt: '2026-08-23T00:00:00.000Z'
  };
}

function projectionFor(targetCard, usable) {
  return {
    cardId: targetCard.cardId,
    card: {
      cardId: targetCard.cardId,
      name: targetCard.name,
      description: '',
      status: targetCard.status,
      available: targetCard.available,
      expiresAt: '',
      updatedAt: targetCard.updatedAt
    },
    totalStamps: 10,
    redeemedRewards: usable ? 0 : 1,
    availableRewards: usable ? 1 : 0,
    availableRewardNodes: usable ? [{ cardId: targetCard.cardId, usable: true }] : [],
    upcomingRewardNodes: [],
    stampsPerReward: 10,
    cardSize: 10,
    visualStamps: 10,
    displayCycleNumber: 1,
    stampsUntilReward: 0,
    stampsUntilNextReward: 10,
    rewardName: '優惠券',
    rewardNodesUpdatedAt: 'v1',
    rewardNodes: [],
    nextAvailableReward: usable ? { cardId: targetCard.cardId, usable: true } : null,
    nextReward: null,
    progressUpdatedAt: '2026-08-23T00:00:00.000Z'
  };
}

function visibilityContext(options) {
  const active = card('CARD-ACTIVE', 'active', true);
  const retained = card('CARD-RETAINED', 'deleted', false);
  const consumed = card('CARD-CONSUMED', 'deleted', false);
  const cards = options && options.cards || [active, retained, consumed];
  const progress = {
    'CARD-RETAINED': { cardId: 'CARD-RETAINED', totalStamps: 10, redeemedRewards: 0 },
    'CARD-CONSUMED': { cardId: 'CARD-CONSUMED', totalStamps: 10, redeemedRewards: 1 }
  };
  const member = {
    lineUserId: 'UMEMBER', memberNo: 'M0001', displayName: '會員', pictureUrl: '',
    membershipStatus: 'active', joinedAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-23T00:00:00.000Z'
  };
  const context = {
    console,
    normalizeMember_: (value) => Object.assign({}, value),
    progressMapForMember_: () => progress,
    allMultiCards_: () => cards,
    requestedMultiCardId_: (payload) => String(payload && payload.cardId || ''),
    publicMultiCard_: (value) => ({
      cardId: value.cardId,
      name: value.name,
      description: value.description,
      status: value.status,
      available: value.available,
      expiresAt: value.expiresAt,
      updatedAt: value.updatedAt
    }),
    publicMemberCardProjection_: (value) => projectionFor(value, value.cardId !== 'CARD-CONSUMED'),
    ensureMultiCardStorage_: () => {},
    memberMe_: () => ({ member }),
    memberRewardClaimMultiCard_: () => ({
      duplicate: false,
      claimedReward: { cardId: 'CARD-CONSUMED', rewardName: '優惠券' },
      member: { selectedCardId: 'CARD-CONSUMED' }
    })
  };
  vm.createContext(context);
  vm.runInContext(
    read('gas/MemberCardVisibilityService.gs') +
      '\n;globalThis.__project = publicMemberWithVisibleDeletedCards_;' +
      'globalThis.__claim = memberRewardClaimVisibleMultiCard_;',
    context
  );
  return { context, member, active, retained, consumed };
}

test('deleted cards stay visible only while the member still has a usable retained ticket', () => {
  const { context, member } = visibilityContext();
  const result = context.__project(member, { cardId: 'CARD-RETAINED' });

  assert.deepEqual(Array.from(result.cards, (item) => item.cardId), ['CARD-ACTIVE', 'CARD-RETAINED']);
  assert.equal(result.selectedCardId, 'CARD-RETAINED');
  assert.equal(result.card.status, 'deleted');
  assert.ok(result.nextAvailableReward);
});

test('a consumed deleted card cannot be selected from a stale session cardId', () => {
  const { context, member } = visibilityContext();
  const result = context.__project(member, { cardId: 'CARD-CONSUMED' });

  assert.deepEqual(Array.from(result.cards, (item) => item.cardId), ['CARD-ACTIVE', 'CARD-RETAINED']);
  assert.equal(result.selectedCardId, 'CARD-ACTIVE');
  assert.equal(result.card.status, 'active');
});

test('using the last retained ticket immediately removes the deleted card from the returned member page', () => {
  const { context } = visibilityContext();
  const result = context.__claim({ identity: { sub: 'UMEMBER' } }, {
    cardId: 'CARD-CONSUMED', confirmationCode: 'a'.repeat(64), requestId: 'b'.repeat(32), expectedRewardOrdinal: 1
  });

  assert.equal(result.claimedReward.cardId, 'CARD-CONSUMED');
  assert.deepEqual(Array.from(result.member.cards, (item) => item.cardId), ['CARD-ACTIVE', 'CARD-RETAINED']);
  assert.equal(result.member.selectedCardId, 'CARD-ACTIVE');
});

test('when no active card exists, another deleted card with an unused ticket remains selectable', () => {
  const retained = card('CARD-RETAINED', 'deleted', false);
  const consumed = card('CARD-CONSUMED', 'deleted', false);
  const { context, member } = visibilityContext({ cards: [retained, consumed] });
  const result = context.__project(member, { cardId: 'CARD-CONSUMED' });

  assert.deepEqual(Array.from(result.cards, (item) => item.cardId), ['CARD-RETAINED']);
  assert.equal(result.selectedCardId, 'CARD-RETAINED');
  assert.equal(result.card.status, 'deleted');
});

test('member API routes use the deleted-card visibility projection without changing reward authorization', () => {
  const code = read('gas/Code.gs');
  assert.match(code, /data:\s*memberMeVisibleMultiCard_\(context, payload\)/);
  assert.match(code, /data:\s*memberRewardClaimVisibleMultiCard_\(context, payload\)/);
  assert.doesNotMatch(code, /case 'reward\.claim':[\s\S]{0,160}data:\s*memberRewardClaimMultiCard_\(context, payload\)/);
});
