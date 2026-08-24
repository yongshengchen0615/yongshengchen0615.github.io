'use strict';

/**
 * Member-facing projection policy for archived cards.
 *
 * Active/expired cards keep the existing visibility semantics. A deleted card
 * is retained in the member UI only while that member still owns at least one
 * usable, unexpired and unclaimed reward ticket for the card.
 *
 * This is presentation/business projection only. Reward entitlement and claim
 * authorization remain enforced by MultiCardRewardService.gs.
 */
function memberVisibleCycleProjection_(projection) {
  if (!projection || !projection.card || !projection.card.available) return projection;
  const cardSize = Number(projection.cardSize || 0);
  const totalStamps = Number(projection.totalStamps || 0);
  if (!Number.isFinite(cardSize) || cardSize <= 0 || !Number.isFinite(totalStamps) || totalStamps <= 0) return projection;
  if (totalStamps % cardSize !== 0) return projection;

  const next = Object.assign({}, projection, {
    visualStamps: 0,
    displayCycleNumber: Math.floor(totalStamps / cardSize) + 1
  });
  next.rewardNodes = Array.isArray(projection.rewardNodes) ? projection.rewardNodes.map(function (node) {
    return Object.assign({}, node, { state: 'pending' });
  }) : [];
  return next;
}

function publicMemberWithVisibleDeletedCards_(memberValue, payload) {
  const member = normalizeMember_(memberValue);
  const preferSelectiveRead = true;
  const progressMap = progressMapForMember_(member.lineUserId, preferSelectiveRead);
  const deletedCardProjections = {};

  const visibleCards = allMultiCards_().filter(function (card) {
    if (card.storedStatus !== 'deleted') return true;
    const progress = progressMap[card.cardId];
    if (!progress) return false;
    const projection = publicMemberCardProjection_(card, member, progress, preferSelectiveRead);
    deletedCardProjections[card.cardId] = projection;
    return Boolean(projection.nextAvailableReward);
  });

  const requestedCardId = requestedMultiCardId_(payload || {});
  let selectedCard = requestedCardId ? visibleCards.find(function (card) {
    return card.cardId === requestedCardId;
  }) : null;
  if (!selectedCard) selectedCard = visibleCards.find(function (card) { return card.available; }) || null;
  if (!selectedCard) selectedCard = visibleCards.find(function (card) {
    return Boolean(progressMap[card.cardId]);
  }) || visibleCards[0] || null;

  const summaries = visibleCards.map(function (card) {
    const progress = progressMap[card.cardId];
    const summary = publicMultiCard_(card);
    summary.totalStamps = progress ? progress.totalStamps : 0;
    summary.redeemedRewards = progress ? progress.redeemedRewards : 0;
    return summary;
  });

  const base = {
    memberNo: member.memberNo,
    displayName: member.displayName,
    pictureUrl: member.pictureUrl,
    membershipStatus: member.membershipStatus,
    joinedAt: member.joinedAt,
    updatedAt: member.updatedAt,
    cards: summaries,
    selectedCardId: selectedCard ? selectedCard.cardId : ''
  };

  if (!selectedCard) {
    return Object.assign(base, {
      totalStamps: 0,
      redeemedRewards: 0,
      availableRewards: 0,
      availableRewardNodes: [],
      upcomingRewardNodes: [],
      stampsPerReward: 10,
      cardSize: 10,
      card: { cardId: '', name: '', description: '', status: 'deleted', available: false, expiresAt: '', updatedAt: 'none' },
      visualStamps: 0,
      displayCycleNumber: 1,
      stampsUntilReward: 0,
      stampsUntilNextReward: 0,
      rewardName: '本期優惠券',
      rewardNodesUpdatedAt: 'none',
      rewardNodes: [],
      nextAvailableReward: null,
      nextReward: null
    });
  }

  const selectedProjection = deletedCardProjections[selectedCard.cardId] || publicMemberCardProjection_(
    selectedCard,
    member,
    progressMap[selectedCard.cardId] || null,
    preferSelectiveRead
  );
  return Object.assign(base, memberVisibleCycleProjection_(selectedProjection));
}

function memberMeVisibleMultiCard_(context, payload) {
  ensureMultiCardStorage_();
  const synchronizedMember = memberMe_(context, true).member;
  return {
    member: publicMemberWithVisibleDeletedCards_(synchronizedMember, payload || {})
  };
}

function memberRewardClaimVisibleMultiCard_(context, payload) {
  const result = memberRewardClaimMultiCard_(context, payload);
  if (!result || !result.member) return result;

  const synchronizedMember = memberMe_(context, true).member;
  const claimedCardId = String(result.claimedReward && result.claimedReward.cardId || payload && payload.cardId || '');
  result.member = publicMemberWithVisibleDeletedCards_(synchronizedMember, { cardId: claimedCardId });
  return result;
}
