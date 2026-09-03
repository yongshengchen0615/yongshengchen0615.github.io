'use strict';

const POINT_CARD_REWARD_TYPES_ = Object.freeze(['coupon', 'lottery']);
const POINT_CARD_MAX_REWARDS_ = 30;
const POINT_CARD_MAX_THRESHOLD_STAMPS_ = 100;
const POINT_CARD_MAX_LOTTERY_PRIZES_ = 30;
const POINT_CARD_RATE_BASIS_POINTS_ = 10000;
const POINT_CARD_TICKET_TEMPLATE_STATUSES_ = Object.freeze(['active', 'draft', 'archived']);
const POINT_CARD_TICKET_STATUS_AVAILABLE_ = 'available';
const POINT_CARD_TICKET_STATUS_USED_ = 'used';

function handlePointCardBootstrap_(identity) {
  const member = ensureMember_(identity);
  const snapshot = withDataLock_(function() {
    const pointCardSnapshot = readPointCardSnapshot_();
    ensurePointCardTicketsForMember_(identity.lineUserId, pointCardSnapshot);
    return pointCardSnapshot;
  });
  return { profile: { displayName: String(member.display_name || identity.displayName) }, cards: visiblePointCardsForMember_(identity.lineUserId, snapshot), tickets: visibleTicketsForMember_(identity.lineUserId, snapshot) };
}

function readPointCardSnapshot_() {
  const snapshot = {
    cards: readRecords_('PointCards'),
    rewards: readRecords_('PointCardRewards'),
    lotteryPrizes: readRecords_('PointCardLotteryPrizes'),
    ticketTemplates: readRecords_('PointCardTicketTemplates'),
    balances: readRecords_('PointBalances'),
    tickets: readRecords_('PointCardTickets')
  };
  snapshot.prizesByReward = pointCardLotteryPrizesByReward_(snapshot.lotteryPrizes);
  snapshot.rewardsByCard = pointCardRewardsByCard_(snapshot.rewards, snapshot.prizesByReward);
  snapshot.ticketTemplatesById = pointCardTicketTemplatesById_(snapshot.ticketTemplates);
  snapshot.balancesByMemberCard = pointCardBalancesByMemberCard_(snapshot.balances);
  snapshot.ticketsByMember = pointCardRecordsByMember_(snapshot.tickets);
  snapshot.ticketsByMemberCard = pointCardRecordsByMemberCard_(snapshot.tickets);
  return snapshot;
}

function pointCardMemberCardKey_(lineUserId, cardId) {
  return String(lineUserId || '').trim() + '\u0000' + String(cardId || '').trim();
}

function pointCardBalancesByMemberCard_(records) {
  const grouped = {};
  (Array.isArray(records) ? records : []).forEach(function(record) {
    const key = pointCardMemberCardKey_(record.line_user_id, record.card_id);
    if (key !== '\u0000') grouped[key] = record;
  });
  return grouped;
}

function pointCardRecordsByMember_(records) {
  const grouped = {};
  (Array.isArray(records) ? records : []).forEach(function(record) {
    const lineUserId = String(record.line_user_id || '').trim();
    if (!lineUserId) return;
    if (!grouped[lineUserId]) grouped[lineUserId] = [];
    grouped[lineUserId].push(record);
  });
  return grouped;
}

function pointCardRecordsByMemberCard_(records) {
  const grouped = {};
  (Array.isArray(records) ? records : []).forEach(function(record) {
    const key = pointCardMemberCardKey_(record.line_user_id, record.card_id);
    if (key === '\u0000') return;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(record);
  });
  return grouped;
}

function pointCardTicketsForMember_(lineUserId, snapshot) {
  if (snapshot && snapshot.ticketsByMember) return snapshot.ticketsByMember[String(lineUserId || '').trim()] || [];
  return readRecords_('PointCardTickets').filter(function(ticket) { return String(ticket.line_user_id || '') === String(lineUserId || ''); });
}

function pointCardTicketsForMemberCard_(lineUserId, cardId, snapshot) {
  if (snapshot && snapshot.ticketsByMemberCard) return snapshot.ticketsByMemberCard[pointCardMemberCardKey_(lineUserId, cardId)] || [];
  return pointCardTicketsForMember_(lineUserId).filter(function(ticket) { return String(ticket.card_id || '') === String(cardId || ''); });
}

function appendTicketToPointCardSnapshot_(snapshot, ticket) {
  if (!snapshot) return;
  snapshot.tickets.push(ticket);
  const lineUserId = String(ticket.line_user_id || '').trim();
  const memberCardKey = pointCardMemberCardKey_(lineUserId, ticket.card_id);
  if (!snapshot.ticketsByMember[lineUserId]) snapshot.ticketsByMember[lineUserId] = [];
  snapshot.ticketsByMember[lineUserId].push(ticket);
  if (!snapshot.ticketsByMemberCard[memberCardKey]) snapshot.ticketsByMemberCard[memberCardKey] = [];
  snapshot.ticketsByMemberCard[memberCardKey].push(ticket);
}

function readPointCards_(includeAdminDetails, snapshot) {
  const rewardsByCard = snapshot ? snapshot.rewardsByCard : pointCardRewardsByCard_();
  const ticketTemplatesById = snapshot ? snapshot.ticketTemplatesById : pointCardTicketTemplatesById_();
  const cards = snapshot ? snapshot.cards : readRecords_('PointCards');
  return cards.map(function(card) { return pointCardForClient_(card, rewardsByCard[String(card.card_id || '')] || [], includeAdminDetails, ticketTemplatesById); }).sort(function(a, b) { return String(b.updatedAt).localeCompare(String(a.updatedAt)); });
}

function pointCardForClient_(card, configuredRewards, includeAdminDetails, ticketTemplatesById) {
  const cardId = String(card.card_id || '');
  const rewards = Array.isArray(configuredRewards) && configuredRewards.length
    ? configuredRewards.map(function(reward) { return pointCardRewardForClient_(reward, includeAdminDetails, ticketTemplatesById); }).sort(function(a, b) { return a.thresholdStamps - b.thresholdStamps; })
    : legacyPointCardReward_(card);
  const finalReward = rewards.length ? rewards[rewards.length - 1] : null;
  const clientCard = { cardId, title: String(card.title || ''), description: String(card.description || ''), targetStamps: Number(card.target_stamps || 0), rewardTitle: String(card.reward_title || (finalReward && finalReward.rewardTitle) || ''), rewards, expiryMode: pointCardExpiryMode_(card), expiresOn: pointCardExpiresOn_(card), expired: pointCardIsExpired_(card), status: String(card.status || 'draft'), accent: String(card.accent || '#e47845'), createdAt: String(card.created_at || ''), updatedAt: String(card.updated_at || '') };
  return clientCard;
}

function pointCardRewardsByCard_(records, prizesByReward) {
  const grouped = {};
  const normalizedPrizes = prizesByReward || pointCardLotteryPrizesByReward_();
  const source = Array.isArray(records) ? records : readRecords_('PointCardRewards');
  source.forEach(function(record) {
    const cardId = String(record.card_id || '').trim();
    if (!cardId) return;
    if (!grouped[cardId]) grouped[cardId] = [];
    record.prizes = normalizedPrizes[String(record.reward_id || '')] || [];
    grouped[cardId].push(record);
  });
  return grouped;
}

function pointCardLotteryPrizesByReward_(records) {
  const grouped = {};
  const source = Array.isArray(records) ? records : readRecords_('PointCardLotteryPrizes');
  source.forEach(function(record) {
    const rewardId = String(record.reward_id || '').trim();
    if (!rewardId) return;
    if (!grouped[rewardId]) grouped[rewardId] = [];
    grouped[rewardId].push(record);
  });
  return grouped;
}

function pointCardTicketTemplatesById_(records) {
  const grouped = {};
  const source = Array.isArray(records) ? records : readRecords_('PointCardTicketTemplates');
  source.forEach(function(template) {
    const templateId = String(template.ticket_template_id || '').trim();
    if (templateId) grouped[templateId] = template;
  });
  return grouped;
}

function readPointCardTicketTemplates_(includeAdminDetails, snapshot) {
  const templates = snapshot ? snapshot.ticketTemplates : readRecords_('PointCardTicketTemplates');
  return templates.map(function(template) {
    return pointCardTicketTemplateForClient_(template, includeAdminDetails);
  }).sort(function(a, b) { return String(b.updatedAt).localeCompare(String(a.updatedAt)); });
}

function pointCardTicketTemplateForClient_(template, includeAdminDetails) {
  const ticketType = String(template.ticket_type || 'coupon').toLowerCase() === 'lottery' ? 'lottery' : 'coupon';
  const clientTemplate = {
    ticketTemplateId: String(template.ticket_template_id || ''),
    title: String(template.title || ''),
    ticketType,
    description: String(template.description || ''),
    usageMethod: String(template.usage_method || ''),
    usageInstructions: String(template.usage_instructions || ''),
    status: POINT_CARD_TICKET_TEMPLATE_STATUSES_.indexOf(String(template.status || 'draft')) >= 0 ? String(template.status || 'draft') : 'draft',
    createdAt: String(template.created_at || ''),
    updatedAt: String(template.updated_at || ''),
    prizes: parseJsonArray_(template.lottery_prizes_json).map(function(prize) { return pointCardLotteryPrizeForClient_(prize, includeAdminDetails); })
  };
  return clientTemplate;
}

function pointCardRewardForClient_(reward, includeAdminDetails, ticketTemplatesById) {
  const thresholdStamps = Number(reward.threshold_stamps || reward.thresholdStamps || 0);
  const ticketTemplateId = String(reward.ticket_template_id || reward.ticketTemplateId || '').trim();
  const template = ticketTemplateId && ticketTemplatesById ? ticketTemplatesById[ticketTemplateId] : null;
  if (template) {
    const clientTemplate = pointCardTicketTemplateForClient_(template, includeAdminDetails);
    return {
      rewardId: String(reward.reward_id || reward.rewardId || ''),
      cardId: String(reward.card_id || reward.cardId || ''),
      ticketTemplateId,
      thresholdStamps,
      consumeStamps: rewardConsumeStamps_(reward, thresholdStamps),
      rewardType: clientTemplate.ticketType,
      rewardTitle: clientTemplate.title,
      rewardDescription: clientTemplate.description,
      usageMethod: clientTemplate.usageMethod,
      usageInstructions: clientTemplate.usageInstructions,
      lotteryWinRate: 0,
      prizes: clientTemplate.prizes
    };
  }
  const clientReward = {
    rewardId: String(reward.reward_id || reward.rewardId || ''),
    cardId: String(reward.card_id || reward.cardId || ''),
    ticketTemplateId,
    thresholdStamps,
    consumeStamps: rewardConsumeStamps_(reward, thresholdStamps),
    rewardType: POINT_CARD_REWARD_TYPES_.indexOf(String(reward.reward_type || reward.rewardType || '').toLowerCase()) >= 0 ? String(reward.reward_type || reward.rewardType).toLowerCase() : 'coupon',
    rewardTitle: String(reward.reward_title || reward.rewardTitle || ''),
    rewardDescription: String(reward.reward_description || reward.rewardDescription || ''),
    lotteryWinRate: Number(reward.lottery_win_rate || reward.lotteryWinRate || 0),
    prizes: Array.isArray(reward.prizes || reward.lotteryPrizes) ? (reward.prizes || reward.lotteryPrizes).map(function(prize) { return pointCardLotteryPrizeForClient_(prize, includeAdminDetails); }) : []
  };
  return clientReward;
}

function pointCardLotteryPrizeForClient_(prize, includeWinRate) {
  const clientPrize = { prizeId: String(prize.prize_id || prize.prizeId || ''), rewardId: String(prize.reward_id || prize.rewardId || ''), prizeTitle: String(prize.prize_title || prize.prizeTitle || ''), prizeDescription: String(prize.prize_description || prize.prizeDescription || '') };
  if (includeWinRate) clientPrize.winRate = Number(prize.win_rate || prize.winRate || 0);
  return clientPrize;
}

function legacyPointCardReward_(card) {
  const title = String(card.reward_title || '').trim();
  if (!title) return [];
  return [{ rewardId: 'legacy:' + String(card.card_id || ''), cardId: String(card.card_id || ''), thresholdStamps: Number(card.target_stamps || 0), consumeStamps: Number(card.target_stamps || 0), rewardType: 'coupon', rewardTitle: title, rewardDescription: '', lotteryWinRate: 0, prizes: [] }];
}

function visiblePointCardsForMember_(lineUserId, snapshot) {
  const balanceMap = snapshot && snapshot.balancesByMemberCard
    ? snapshot.balancesByMemberCard
    : pointCardBalancesByMemberCard_(readRecords_('PointBalances'));
  return readPointCards_(false, snapshot).filter(function(card) {
    return card.status === 'active';
  }).map(function(card) {
    const balance = balanceMap[pointCardMemberCardKey_(lineUserId, card.cardId)] || {};
    return Object.assign({}, card, { stamps: Math.max(0, Number(balance.stamps || 0)), updatedAt: String(balance.updated_at || '') || card.updatedAt });
  });
}

function pointCardExpiryMode_(card) {
  return String(card && card.expiry_mode || 'unlimited').trim().toLowerCase() === 'date' ? 'date' : 'unlimited';
}

function pointCardExpiresOn_(card) {
  const expiresOn = String(card && card.expires_on || '').trim();
  return pointCardExpiryMode_(card) === 'date' && isValidDateOnly_(expiresOn) ? expiresOn : '';
}

function pointCardIsExpired_(card) {
  const expiresOn = pointCardExpiresOn_(card);
  return Boolean(expiresOn && expiresOn < Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd'));
}

function isValidDateOnly_(value) {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const parts = text.split('-').map(Number);
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  return date.getUTCFullYear() === parts[0] && date.getUTCMonth() === parts[1] - 1 && date.getUTCDate() === parts[2];
}

function handlePointCardArchive_(identity, admin, request) {
  const cardId = String(request.cardId || '').trim();
  const expected = String(request.expectedUpdatedAt || '').trim();
  if (!cardId || cardId.length > 80) throw new ApiError(400, 'INVALID_CARD', '集點卡識別碼不合法。');
  return withDataLock_(function() {
    const match = findRecordWithRow_('PointCards', 'card_id', cardId);
    if (!match) throw new ApiError(404, 'CARD_NOT_FOUND', '找不到集點卡。');
    if (expected && String(match.record.updated_at || '') !== expected) throw new ApiError(409, 'CONFLICT', '集點卡已被更新，請重新整理。');
    const card = match.record;
    const now = nowIso_();
    card.status = 'archived';
    card.updated_by = identity.lineUserId;
    card.updated_at = now;
    updateRecordAtRow_('PointCards', match.rowNumber, card);
    appendAuditRecord_({ audit_id: Utilities.getUuid(), actor_line_user_id: identity.lineUserId, actor_role: admin.role, action: 'POINT_CARD_ARCHIVE', target_type: 'point_card', target_id: cardId, result: 'success', detail: 'Point card archived; history retained', created_at: now });
    return { card: pointCardForClient_(card, pointCardRewardsByCard_()[cardId] || [], true) };
  });
}

function handlePointCardDelete_(identity, admin, request) {
  const cardId = String(request.cardId || '').trim();
  const expected = String(request.expectedUpdatedAt || '').trim();
  if (!cardId || cardId.length > 80) throw new ApiError(400, 'INVALID_CARD', '集點卡識別碼不合法。');
  return withDataLock_(function() {
    const match = findRecordWithRow_('PointCards', 'card_id', cardId);
    if (!match) throw new ApiError(404, 'CARD_NOT_FOUND', '找不到集點卡。');
    if (expected && String(match.record.updated_at || '') !== expected) throw new ApiError(409, 'CONFLICT', '集點卡已被更新，請重新整理。');

    const rewardIds = {};
    readRecords_('PointCardRewards').forEach(function(reward) {
      if (String(reward.card_id || '') === cardId) rewardIds[String(reward.reward_id || '')] = true;
    });
    const ticketIds = {};
    readRecords_('PointCardTickets').forEach(function(ticket) {
      if (String(ticket.card_id || '') === cardId) ticketIds[String(ticket.ticket_id || '')] = true;
    });

    const deleted = {
      ticketChallenges: deleteRecordsWhere_('PointCardTicketChallenges', function(challenge) { return Boolean(ticketIds[String(challenge.ticket_id || '')]); }),
      lotteryPrizes: deleteRecordsWhere_('PointCardLotteryPrizes', function(prize) { return Boolean(rewardIds[String(prize.reward_id || '')]); }),
      rewards: deleteRecordsWhere_('PointCardRewards', function(reward) { return String(reward.card_id || '') === cardId; }),
      tickets: deleteRecordsWhere_('PointCardTickets', function(ticket) { return String(ticket.card_id || '') === cardId; }),
      balances: deleteRecordsWhere_('PointBalances', function(balance) { return String(balance.card_id || '') === cardId; }),
      entries: deleteRecordsWhere_('PointEntries', function(entry) { return String(entry.card_id || '') === cardId; })
    };
    deleted.auditLogs = deleteRecordsWhere_('AuditLogs', function(audit) {
      const targetType = String(audit.target_type || ''); const targetId = String(audit.target_id || '');
      return (targetType === 'point_card' && targetId === cardId)
        || (targetType === 'point_card_ticket' && Boolean(ticketIds[targetId]))
        || (targetType === 'point_balance' && targetId.endsWith(':' + cardId));
    });
    deleted.cards = deleteRecordsWhere_('PointCards', function(card) { return String(card.card_id || '') === cardId; });
    return { deleted: true, cardId, counts: deleted };
  });
}

function handlePointCardRemove_(identity, admin, request) {
  return handlePointCardArchive_(identity, admin, request);
}

function handleAdminBootstrap_(identity, admin, request) {
  const memberResult = readMembersPage_(request);
  const cards = readPointCards_(true);
  const tickets = readPointCardTicketTemplates_(true);
  const entries = readRecords_('PointEntries');
  const today = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd');
  return { profile: { displayName: identity.displayName }, role: admin.role, members: memberResult.members, memberPage: memberResult.memberPage, cards, tickets, stats: { memberCount: memberResult.stats.memberCount, activeMemberCount: memberResult.stats.activeMemberCount, activeCardCount: cards.filter(function(card) { return card.status === 'active' && !card.expired; }).length, todayEntryCount: entries.filter(function(entry) { return formatEntryDate_(entry.created_at) === today; }).length } };
}

function handlePointCardSave_(identity, admin, request) {
  const input = request.card && typeof request.card === 'object' ? request.card : {};
  const cardId = String(input.cardId || '').trim();
  const title = String(input.title || '').trim();
  const description = String(input.description || '').trim();
  const rewardTitle = String(input.rewardTitle || '').trim();
  const legacyTargetStamps = Number(input.targetStamps);
  const status = String(input.status || '').trim().toLowerCase();
  const accent = String(input.accent || '').trim();
  const expiryMode = String(input.expiryMode || 'unlimited').trim().toLowerCase();
  const expiresOn = String(input.expiresOn || '').trim();
  const expected = String(request.expectedUpdatedAt || '').trim();
  const hasRewards = Object.prototype.hasOwnProperty.call(input, 'rewards');
  if (!title || title.length > 80 || description.length > 240 || (!hasRewards && (!rewardTitle || rewardTitle.length > 100))) throw new ApiError(400, 'INVALID_CARD', '集點卡名稱、說明或回饋內容不合法。');
  const ticketTemplatesById = pointCardTicketTemplatesById_();
  const rewards = hasRewards ? normalizePointCardRewards_(input.rewards, POINT_CARD_MAX_THRESHOLD_STAMPS_, ticketTemplatesById) : null;
  if (['active', 'draft', 'archived'].indexOf(status) < 0 || !/^#[0-9a-f]{6}$/i.test(accent) || ['unlimited', 'date'].indexOf(expiryMode) < 0 || (expiryMode === 'date' && !isValidDateOnly_(expiresOn))) throw new ApiError(400, 'INVALID_CARD', '集點卡狀態、識別色或使用期限不合法。');

  return withDataLock_(function() {
    const now = nowIso_();
    let card;
    let rowNumber = 0;
    if (cardId) {
      const match = findRecordWithRow_('PointCards', 'card_id', cardId); if (!match) throw new ApiError(404, 'CARD_NOT_FOUND', '找不到集點卡。');
      if (expected && String(match.record.updated_at || '') !== expected) throw new ApiError(409, 'CONFLICT', '集點卡已被更新，請重新整理。');
      card = match.record; rowNumber = match.rowNumber;
    } else { card = { card_id: 'PC-' + Utilities.getUuid().replace(/-/g, '').substring(0, 12).toUpperCase(), created_by: identity.lineUserId, created_at: now }; }
    const existingRewards = hasRewards ? [] : pointCardRewardsByCard_()[card.card_id] || [];
    const storedTargetStamps = Number(card.target_stamps);
    const targetStamps = hasRewards
      ? Math.max.apply(null, rewards.map(function(reward) { return Number(reward.threshold_stamps); }))
      : Number.isInteger(legacyTargetStamps) && legacyTargetStamps >= 1 && legacyTargetStamps <= POINT_CARD_MAX_THRESHOLD_STAMPS_
        ? legacyTargetStamps
        : existingRewards.length
          ? Math.max.apply(null, existingRewards.map(function(reward) { return Number(reward.threshold_stamps || 0); }))
          : Number.isInteger(storedTargetStamps) && storedTargetStamps >= 1 && storedTargetStamps <= POINT_CARD_MAX_THRESHOLD_STAMPS_ ? storedTargetStamps : 10;
    if (!hasRewards && existingRewards.some(function(existingReward) { return Number(existingReward.threshold_stamps || 0) > targetStamps; })) throw new ApiError(400, 'INVALID_CARD_REWARDS', '舊版集點卡完成點數不可低於既有節點點數，請一併更新節點設定。');
    card.title = title; card.description = description; card.target_stamps = String(targetStamps); card.reward_title = hasRewards ? rewards[rewards.length - 1].reward_title : rewardTitle; card.status = status; card.accent = accent.toUpperCase(); card.expiry_mode = expiryMode; card.expires_on = expiryMode === 'date' ? expiresOn : ''; card.updated_by = identity.lineUserId; card.updated_at = now;
    if (rowNumber) updateRecordAtRow_('PointCards', rowNumber, card); else appendRecord_('PointCards', card);
    if (hasRewards) replacePointCardRewards_(card.card_id, rewards, now);
    appendAuditRecord_({ audit_id: Utilities.getUuid(), actor_line_user_id: identity.lineUserId, actor_role: admin.role, action: 'POINT_CARD_SAVE', target_type: 'point_card', target_id: card.card_id, result: 'success', detail: 'Point card saved', created_at: now });
    return { card: pointCardForClient_(card, hasRewards ? rewards : existingRewards, true, ticketTemplatesById) };
  });
}

function handleTicketTemplateSave_(identity, admin, request) {
  const input = request.ticket && typeof request.ticket === 'object' && !Array.isArray(request.ticket) ? request.ticket : {};
  const ticketTemplateId = String(input.ticketTemplateId || '').trim();
  const title = String(input.title || '').trim();
  const ticketType = String(input.ticketType || '').trim().toLowerCase();
  const description = String(input.description || '').trim();
  const usageMethod = String(input.usageMethod || '').trim();
  const usageInstructions = String(input.usageInstructions || '').trim();
  const status = String(input.status || '').trim().toLowerCase();
  const expected = String(request.expectedUpdatedAt || '').trim();
  if (!title || title.length > 100 || POINT_CARD_REWARD_TYPES_.indexOf(ticketType) < 0 || description.length > 240 || !usageMethod || usageMethod.length > 120 || !usageInstructions || usageInstructions.length > 500 || POINT_CARD_TICKET_TEMPLATE_STATUSES_.indexOf(status) < 0) {
    throw new ApiError(400, 'INVALID_TICKET_TEMPLATE', '票券名稱、類型、說明、使用方式、使用說明或狀態不合法。');
  }
  const prizes = ticketType === 'lottery' ? normalizePointCardLotteryPrizes_(input.prizes) : [];
  return withDataLock_(function() {
    const now = nowIso_();
    let template;
    let rowNumber = 0;
    if (ticketTemplateId) {
      const match = findRecordWithRow_('PointCardTicketTemplates', 'ticket_template_id', ticketTemplateId);
      if (!match) throw new ApiError(404, 'TICKET_TEMPLATE_NOT_FOUND', '找不到票券。');
      if (expected && String(match.record.updated_at || '') !== expected) throw new ApiError(409, 'CONFLICT', '票券已被更新，請重新整理。');
      template = match.record;
      rowNumber = match.rowNumber;
    } else {
      template = { ticket_template_id: 'PT-' + Utilities.getUuid().replace(/-/g, '').substring(0, 12).toUpperCase(), created_by: identity.lineUserId, created_at: now };
    }
    template.title = title;
    template.ticket_type = ticketType;
    template.description = description;
    template.usage_method = usageMethod;
    template.usage_instructions = usageInstructions;
    template.lottery_prizes_json = JSON.stringify(prizes);
    template.status = status;
    template.updated_by = identity.lineUserId;
    template.updated_at = now;
    if (rowNumber) updateRecordAtRow_('PointCardTicketTemplates', rowNumber, template); else appendRecord_('PointCardTicketTemplates', template);
    appendAuditRecord_({ audit_id: Utilities.getUuid(), actor_line_user_id: identity.lineUserId, actor_role: admin.role, action: 'POINT_CARD_TICKET_TEMPLATE_SAVE', target_type: 'point_card_ticket_template', target_id: template.ticket_template_id, result: 'success', detail: 'Ticket template saved', created_at: now });
    return { ticket: pointCardTicketTemplateForClient_(template, true) };
  });
}

function normalizePointCardRewards_(rawRewards, maxThresholdStamps, ticketTemplatesById) {
  if (!Array.isArray(rawRewards) || rawRewards.length < 1 || rawRewards.length > POINT_CARD_MAX_REWARDS_) throw new ApiError(400, 'INVALID_CARD_REWARDS', '至少要設定 1 個節點，最多 30 個節點。');
  const maximum = maxThresholdStamps === undefined ? POINT_CARD_MAX_THRESHOLD_STAMPS_ : Number(maxThresholdStamps);
  const seenThresholds = {};
  const normalized = rawRewards.map(function(rawReward) {
    if (!rawReward || typeof rawReward !== 'object' || Array.isArray(rawReward)) throw new ApiError(400, 'INVALID_CARD_REWARDS', '節點獎勵格式不合法。');
    const thresholdStamps = Number(rawReward.thresholdStamps);
    const consumeStamps = rawReward.consumeStamps === undefined || rawReward.consumeStamps === null || String(rawReward.consumeStamps).trim() === '' ? thresholdStamps : Number(rawReward.consumeStamps);
    const ticketTemplateId = String(rawReward.ticketTemplateId || '').trim();
    const ticketTemplate = ticketTemplateId && ticketTemplatesById ? ticketTemplatesById[ticketTemplateId] : null;
    const rewardType = String(rawReward.rewardType || '').trim().toLowerCase();
    const rewardTitle = String(rawReward.rewardTitle || '').trim();
    const rewardDescription = String(rawReward.rewardDescription || '').trim();
    if (!Number.isInteger(thresholdStamps) || thresholdStamps < 1 || thresholdStamps > maximum || seenThresholds[thresholdStamps]) throw new ApiError(400, 'INVALID_CARD_REWARDS', '需要集到的點數必須是互不重複、且介於 1–' + maximum + ' 點。');
    if (!Number.isInteger(consumeStamps) || consumeStamps < 1 || consumeStamps > thresholdStamps) throw new ApiError(400, 'INVALID_CARD_REWARDS', '每個獎勵的消耗點數必須是 1 點以上，且不可超過需要集到的點數。');
    if (ticketTemplateId && (!ticketTemplate || String(ticketTemplate.status || '') !== 'active')) throw new ApiError(400, 'INVALID_CARD_REWARDS', '請選擇一張啟用中的票券。');
    if (!ticketTemplate && (POINT_CARD_REWARD_TYPES_.indexOf(rewardType) < 0 || !rewardTitle || rewardTitle.length > 100 || rewardDescription.length > 240)) throw new ApiError(400, 'INVALID_CARD_REWARDS', '節點獎勵名稱、說明或類型不合法。');
    seenThresholds[thresholdStamps] = true;
    let lotteryWinRate = 0;
    let prizes = [];
    if (ticketTemplate) {
      const templateType = String(ticketTemplate.ticket_type || '').toLowerCase() === 'lottery' ? 'lottery' : 'coupon';
      return { reward_id: 'PR-' + Utilities.getUuid().replace(/-/g, '').substring(0, 12).toUpperCase(), card_id: '', threshold_stamps: String(thresholdStamps), ticket_template_id: ticketTemplateId, reward_type: templateType, reward_title: String(ticketTemplate.title || ''), reward_description: String(ticketTemplate.description || ''), lottery_win_rate: String(lotteryWinRate), prizes: [], created_at: '', updated_at: '', consume_stamps: String(consumeStamps) };
    }
    if (rewardType === 'lottery') {
      prizes = normalizePointCardLotteryPrizes_(rawReward.prizes);
    }
    return { reward_id: 'PR-' + Utilities.getUuid().replace(/-/g, '').substring(0, 12).toUpperCase(), card_id: '', threshold_stamps: String(thresholdStamps), ticket_template_id: '', reward_type: rewardType, reward_title: rewardTitle, reward_description: rewardDescription, lottery_win_rate: String(lotteryWinRate), prizes, created_at: '', updated_at: '', consume_stamps: String(consumeStamps) };
  }).sort(function(a, b) { return Number(a.threshold_stamps) - Number(b.threshold_stamps); });
  return normalized;
}

function rewardConsumeStamps_(reward, thresholdOverride) {
  const thresholdStamps = Number(thresholdOverride !== undefined ? thresholdOverride : reward && (reward.threshold_stamps !== undefined ? reward.threshold_stamps : reward.thresholdStamps));
  const rawConsume = reward && (reward.consume_stamps !== undefined ? reward.consume_stamps : reward.consumeStamps);
  const consumeStamps = rawConsume === undefined || rawConsume === null || String(rawConsume).trim() === '' ? thresholdStamps : Number(rawConsume);
  return Number.isInteger(consumeStamps) && consumeStamps >= 1 && consumeStamps <= thresholdStamps ? consumeStamps : thresholdStamps;
}

function normalizePointCardLotteryPrizes_(rawPrizes) {
  if (!Array.isArray(rawPrizes) || rawPrizes.length < 1 || rawPrizes.length > POINT_CARD_MAX_LOTTERY_PRIZES_) throw new ApiError(400, 'INVALID_CARD_REWARDS', '抽獎券至少要設定 1 個獎項，最多 30 個獎項。');
  let totalBasisPoints = 0;
  const prizes = rawPrizes.map(function(rawPrize) {
    if (!rawPrize || typeof rawPrize !== 'object' || Array.isArray(rawPrize)) throw new ApiError(400, 'INVALID_CARD_REWARDS', '抽獎獎項格式不合法。');
    const prizeTitle = String(rawPrize.prizeTitle || '').trim();
    const prizeDescription = String(rawPrize.prizeDescription || '').trim();
    const winRateText = rawPrize.winRate === null || rawPrize.winRate === undefined ? '' : String(rawPrize.winRate).trim();
    if (!prizeTitle || prizeTitle.length > 100 || prizeDescription.length > 240 || !winRateText) throw new ApiError(400, 'INVALID_CARD_REWARDS', '抽獎獎項名稱、說明與機率都必須合法。');
    const winRate = Number(winRateText);
    if (!Number.isFinite(winRate) || winRate < 0 || winRate > 100) throw new ApiError(400, 'INVALID_CARD_REWARDS', '每個獎項機率必須介於 0–100%。');
    const basisPoints = Math.round(winRate * 100);
    totalBasisPoints += basisPoints;
    return { prize_id: 'LP-' + Utilities.getUuid().replace(/-/g, '').substring(0, 12).toUpperCase(), reward_id: '', prize_title: prizeTitle, prize_description: prizeDescription, win_rate: String(basisPoints / 100), created_at: '', updated_at: '' };
  });
  if (totalBasisPoints !== POINT_CARD_RATE_BASIS_POINTS_) throw new ApiError(400, 'INVALID_CARD_REWARDS', '同一張抽獎券的獎項機率合計必須正好是 100%。');
  return prizes;
}

function replacePointCardRewards_(cardId, rewards, now) {
  const sheet = getDataSheet_('PointCardRewards');
  const headers = MEMBERSHIP_SHEET_SCHEMAS_.PointCardRewards;
  const matches = [];
  if (sheet.getLastRow() >= 2) {
    const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
    values.forEach(function(row, index) {
      const record = rowToRecord_(headers, row);
      if (String(record.card_id || '') === String(cardId)) matches.push({ rowNumber: index + 2, record });
    });
  }
  rewards.forEach(function(reward, index) {
    const oldRewardId = matches[index] && String(matches[index].record.reward_id || '');
    reward.card_id = String(cardId);
    reward.created_at = now;
    reward.updated_at = now;
    if (matches[index]) updateRecordAtRow_('PointCardRewards', matches[index].rowNumber, reward); else appendRecord_('PointCardRewards', reward);
    if (oldRewardId && oldRewardId !== reward.reward_id) replacePointCardLotteryPrizes_(oldRewardId, [], now);
    replacePointCardLotteryPrizes_(reward.reward_id, reward.prizes || [], now);
  });
  for (let index = matches.length - 1; index >= rewards.length; index -= 1) { replacePointCardLotteryPrizes_(String(matches[index].record.reward_id || ''), [], now); sheet.deleteRow(matches[index].rowNumber); }
}

function replacePointCardLotteryPrizes_(rewardId, prizes, now) {
  if (!rewardId) return;
  const sheet = getDataSheet_('PointCardLotteryPrizes');
  const headers = MEMBERSHIP_SHEET_SCHEMAS_.PointCardLotteryPrizes;
  const matches = [];
  if (sheet.getLastRow() >= 2) {
    const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
    values.forEach(function(row, index) {
      const record = rowToRecord_(headers, row);
      if (String(record.reward_id || '') === String(rewardId)) matches.push({ rowNumber: index + 2, record });
    });
  }
  prizes.forEach(function(prize, index) {
    prize.reward_id = String(rewardId);
    prize.created_at = now;
    prize.updated_at = now;
    if (matches[index]) updateRecordAtRow_('PointCardLotteryPrizes', matches[index].rowNumber, prize); else appendRecord_('PointCardLotteryPrizes', prize);
  });
  for (let index = matches.length - 1; index >= prizes.length; index -= 1) sheet.deleteRow(matches[index].rowNumber);
}

function handleStampAdd_(identity, admin, request) {
  const lineUserId = String(request.lineUserId || '').trim(); const cardId = String(request.cardId || '').trim(); const amount = Number(request.amount); const note = String(request.note || '').trim(); const requestId = String(request.requestId || '').trim();
  if (!lineUserId || lineUserId.length > 80 || !cardId || cardId.length > 80 || !Number.isInteger(amount) || amount < 1 || amount > 100 || note.length > 160) throw new ApiError(400, 'INVALID_STAMP', '會員、集點卡、點數或備註不合法。');
  if (requestId && !/^[A-Za-z0-9_-]{16,100}$/.test(requestId)) throw new ApiError(400, 'INVALID_REQUEST_ID', '發點請求識別碼不合法。');
  return withDataLock_(function() {
    const prior = requestId ? findRecordWithRow_('PointEntries', 'request_id', requestId) : null;
    if (prior) {
      const entry = prior.record;
      if (String(entry.line_user_id || '') !== lineUserId || String(entry.card_id || '') !== cardId || Number(entry.amount || 0) !== amount || String(entry.note || '') !== note || String(entry.created_by || '') !== String(identity.lineUserId || '')) throw new ApiError(409, 'REQUEST_REUSE_MISMATCH', '這個發點請求已用於不同資料，請重新開啟發點視窗。');
      const currentBalance = findBalance_(lineUserId, cardId);
      return { lineUserId, cardId, stamps: currentBalance ? Number(currentBalance.record.stamps || 0) : 0, updatedAt: String(currentBalance && currentBalance.record.updated_at || entry.created_at || '') };
    }
    const member = findRecordWithRow_('Members', 'line_user_id', lineUserId); if (!member) throw new ApiError(404, 'MEMBER_NOT_FOUND', '找不到會員資料。');
    if (String(member.record.status || 'active') !== 'active') throw new ApiError(400, 'MEMBER_DISABLED', '停用中的會員無法補登點數。');
    const card = findRecordWithRow_('PointCards', 'card_id', cardId); if (!card || String(card.record.status) !== 'active') throw new ApiError(400, 'CARD_NOT_ACTIVE', '只能為啟用中的集點卡增加點數。');
    if (pointCardIsExpired_(card.record)) throw new ApiError(410, 'CARD_EXPIRED', '這張集點卡已超過使用期限，無法再增加點數。');
    const balanceMatch = findBalance_(lineUserId, cardId); const now = nowIso_(); const current = balanceMatch ? Number(balanceMatch.record.stamps || 0) : 0; const nextBalance = current + amount; const balance = { line_user_id: lineUserId, card_id: cardId, stamps: String(nextBalance), updated_at: now };
    if (balanceMatch) updateRecordAtRow_('PointBalances', balanceMatch.rowNumber, balance); else appendRecord_('PointBalances', balance);
    issuePointCardTicketsForBalance_(lineUserId, card.record, current, nextBalance, now);
    appendRecord_('PointEntries', { entry_id: 'PE-' + Utilities.getUuid().replace(/-/g, '').substring(0, 12).toUpperCase(), line_user_id: lineUserId, card_id: cardId, amount: String(amount), note, created_by: identity.lineUserId, created_at: now, request_id: requestId });
    appendAuditRecord_({ audit_id: Utilities.getUuid(), actor_line_user_id: identity.lineUserId, actor_role: admin.role, action: 'STAMP_ADD', target_type: 'point_balance', target_id: lineUserId + ':' + cardId, result: 'success', detail: 'Added ' + amount + ' stamp(s)', created_at: now });
    return { lineUserId, cardId, stamps: nextBalance, updatedAt: now };
  });
}

function findBalance_(lineUserId, cardId) {
  return readRecords_('PointBalances').map(function(record, index) { return { record, index }; }).reduce(function(found, item) { if (found) return found; return item.record.line_user_id === lineUserId && item.record.card_id === cardId ? { rowNumber: item.index + 2, record: item.record } : null; }, null);
}

function formatEntryDate_(value) {
  const date = new Date(String(value || ''));
  return Number.isNaN(date.getTime()) ? '' : Utilities.formatDate(date, 'Asia/Taipei', 'yyyy-MM-dd');
}

function ticketRewardKey_(cardId, thresholdStamps) {
  return String(cardId || '').trim() + ':' + String(Number(thresholdStamps));
}

function generateTicketRandomBasisPoint_() {
  const seed = Utilities.getUuid() + ':' + new Date().getTime() + ':' + Math.random();
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, seed, Utilities.Charset.UTF_8);
  let value = 0;
  bytes.slice(0, 4).forEach(function(byte) { const normalized = byte < 0 ? byte + 256 : byte; value = (value * 256 + normalized) % POINT_CARD_RATE_BASIS_POINTS_; });
  return value;
}

function issuePointCardTicketsForBalance_(lineUserId, card, currentBalance, nextBalance, now, snapshot) {
  const cardId = String(card.card_id || '').trim();
  const issuedTickets = [];
  if (!cardId) return issuedTickets;
  const configured = (snapshot ? snapshot.rewardsByCard : pointCardRewardsByCard_())[cardId] || [];
  const ticketTemplatesById = snapshot ? snapshot.ticketTemplatesById : pointCardTicketTemplatesById_();
  const rewards = configured.length
    ? configured.map(function(reward) {
      const ticketTemplateId = String(reward.ticket_template_id || '').trim();
      const template = ticketTemplateId ? ticketTemplatesById[ticketTemplateId] : null;
      if (template && String(template.status || '') !== 'active') return null;
      return pointCardRewardForClient_(reward, true, ticketTemplatesById);
    }).filter(function(reward) { return Boolean(reward); })
    : legacyPointCardReward_(card);
  const existingByKey = {};
  pointCardTicketsForMemberCard_(lineUserId, cardId, snapshot).forEach(function(ticket) {
    const rewardKey = String(ticket.reward_key || '');
    if (!existingByKey[rewardKey]) existingByKey[rewardKey] = [];
    existingByKey[rewardKey].push(ticket);
  });
  rewards.forEach(function(reward) {
    const threshold = Number(reward.threshold_stamps || reward.thresholdStamps || 0);
    const consumeStamps = rewardConsumeStamps_(reward, threshold);
    const rewardKey = ticketRewardKey_(cardId, threshold);
    const existingTickets = existingByKey[rewardKey] || [];
    const hasOpenTicket = existingTickets.some(function(ticket) { return String(ticket.status || '') !== POINT_CARD_TICKET_STATUS_USED_; });
    const eligibleForIssuance = Number(nextBalance) >= threshold;
    if (!Number.isInteger(threshold) || threshold < 1 || !Number.isInteger(consumeStamps) || consumeStamps < 1 || hasOpenTicket || !eligibleForIssuance) return;
    const ticket = ticketRecordFromReward_(lineUserId, cardId, reward, rewardKey, now);
    appendRecord_('PointCardTickets', ticket);
    appendTicketToPointCardSnapshot_(snapshot, ticket);
    issuedTickets.push(ticket);
    existingByKey[rewardKey] = existingTickets.concat([{}]);
  });
  return issuedTickets;
}

function ensurePointCardTicketsForMember_(lineUserId, snapshot) {
  const ensureTickets = function() {
    const balanceMap = snapshot && snapshot.balancesByMemberCard
      ? snapshot.balancesByMemberCard
      : pointCardBalancesByMemberCard_(readRecords_('PointBalances'));
    const cards = snapshot ? snapshot.cards : readRecords_('PointCards');
    const now = nowIso_();
    cards.filter(function(card) { return String(card.status || '') === 'active' && !pointCardIsExpired_(card); }).forEach(function(card) {
      const balance = balanceMap[pointCardMemberCardKey_(lineUserId, card.card_id)] || {};
      const stamps = Number(balance.stamps || 0);
      issuePointCardTicketsForBalance_(lineUserId, card, stamps, stamps, now, snapshot);
    });
  };
  return snapshot ? ensureTickets() : withDataLock_(ensureTickets);
}

function ticketRecordFromReward_(lineUserId, cardId, reward, usageKey, now) {
  const thresholdStamps = Number(reward.threshold_stamps || reward.thresholdStamps || 0);
  const prizes = Array.isArray(reward.prizes || reward.lotteryPrizes) ? (reward.prizes || reward.lotteryPrizes).map(function(prize) {
    return { prize_id: String(prize.prize_id || prize.prizeId || ''), reward_id: String(prize.reward_id || prize.rewardId || ''), prize_title: String(prize.prize_title || prize.prizeTitle || ''), prize_description: String(prize.prize_description || prize.prizeDescription || ''), win_rate: String(prize.win_rate !== undefined ? prize.win_rate : prize.winRate || 0) };
  }) : [];
  return {
    ticket_id: 'TK-' + Utilities.getUuid().replace(/-/g, '').substring(0, 16).toUpperCase(),
    line_user_id: String(lineUserId),
    card_id: String(cardId),
    reward_id: String(reward.reward_id || reward.rewardId || ''),
    ticket_template_id: String(reward.ticket_template_id || reward.ticketTemplateId || ''),
    reward_key: String(usageKey),
    threshold_stamps: String(thresholdStamps),
    consume_stamps: String(rewardConsumeStamps_(reward, thresholdStamps)),
    ticket_type: String(reward.reward_type || reward.rewardType || 'coupon').toLowerCase() === 'lottery' ? 'lottery' : 'coupon',
    ticket_title: String(reward.reward_title || reward.rewardTitle || ''),
    ticket_description: String(reward.reward_description || reward.rewardDescription || ''),
    usage_method: String(reward.usage_method || reward.usageMethod || ''),
    usage_instructions: String(reward.usage_instructions || reward.usageInstructions || ''),
    lottery_prizes_json: JSON.stringify(prizes),
    status: POINT_CARD_TICKET_STATUS_AVAILABLE_,
    earned_at: now,
    used_at: '',
    result_json: '',
    created_at: now,
    updated_at: now
  };
}

function visibleTicketsForMember_(lineUserId, snapshot) {
  const activeCardIds = {};
  (snapshot ? snapshot.cards : readRecords_('PointCards')).forEach(function(card) { if (String(card.status || '') === 'active' && !pointCardIsExpired_(card)) activeCardIds[String(card.card_id || '')] = true; });
  return pointCardTicketsForMember_(lineUserId, snapshot).filter(function(ticket) { return activeCardIds[String(ticket.card_id || '')] && String(ticket.status || '') !== POINT_CARD_TICKET_STATUS_USED_; }).map(ticketForClient_).sort(function(a, b) { return String(b.earnedAt).localeCompare(String(a.earnedAt)); });
}

function ticketForClient_(ticket) {
  const prizes = parseJsonArray_(ticket.lottery_prizes_json).map(function(prize) { return pointCardLotteryPrizeForClient_(prize, false); });
  let result = null;
  try { result = ticket.result_json ? ticketResultForClient_(JSON.parse(String(ticket.result_json))) : null; } catch (_) { result = null; }
  return {
    ticketId: String(ticket.ticket_id || ''),
    lineUserId: String(ticket.line_user_id || ''),
    cardId: String(ticket.card_id || ''),
    rewardId: String(ticket.reward_id || ''),
    thresholdStamps: Number(ticket.threshold_stamps || 0),
    consumeStamps: rewardConsumeStamps_(ticket, Number(ticket.threshold_stamps || 0)),
    ticketType: String(ticket.ticket_type || 'coupon'),
    ticketTitle: String(ticket.ticket_title || ''),
    ticketDescription: String(ticket.ticket_description || ''),
    ticketTemplateId: String(ticket.ticket_template_id || ''),
    usageMethod: String(ticket.usage_method || ''),
    usageInstructions: String(ticket.usage_instructions || ''),
    prizes,
    status: String(ticket.status || POINT_CARD_TICKET_STATUS_AVAILABLE_),
    earnedAt: String(ticket.earned_at || ''),
    usedAt: String(ticket.used_at || ''),
    result
  };
}

function ticketResultForClient_(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null;
  return { prizeId: String(result.prizeId || result.prize_id || ''), prizeTitle: String(result.prizeTitle || result.prize_title || ''), prizeDescription: String(result.prizeDescription || result.prize_description || '') };
}

function parseJsonArray_(value) {
  try { const parsed = JSON.parse(String(value || '[]')); return Array.isArray(parsed) ? parsed : []; } catch (_) { return []; }
}

function assertTicketCardUsable_(ticket) {
  const cardMatch = findRecordWithRow_('PointCards', 'card_id', String(ticket.card_id || ''));
  if (!cardMatch || String(cardMatch.record.status || '') !== 'active') throw new ApiError(410, 'TICKET_CARD_REMOVED', '這張票券所屬的集點卡已移除，無法使用。');
  if (pointCardIsExpired_(cardMatch.record)) throw new ApiError(410, 'CARD_EXPIRED', '這張集點卡已超過使用期限，票券無法使用。');
  return cardMatch.record;
}

function handleTicketRedeem_(identity, request) {
  const ticketId = String(request.ticketId || '').trim();
  if (!ticketId || ticketId.length > 80) throw new ApiError(400, 'INVALID_TICKET_REDEEM', '票券識別碼不合法。');
  return withDataLock_(function() {
    const ticketMatch = findRecordWithRow_('PointCardTickets', 'ticket_id', ticketId);
    if (!ticketMatch || String(ticketMatch.record.line_user_id || '') !== String(identity.lineUserId)) throw new ApiError(404, 'TICKET_NOT_FOUND', '找不到這張票券。');
    const ticket = ticketMatch.record;
    const card = assertTicketCardUsable_(ticket);
    if (String(ticket.status || '') === POINT_CARD_TICKET_STATUS_USED_) throw new ApiError(409, 'TICKET_ALREADY_USED', '這張票券已使用。', { usedAt: String(ticket.used_at || '') });
    const now = nowIso_();
    const consumeStamps = rewardConsumeStamps_(ticket, Number(ticket.threshold_stamps || 0));
    const balanceMatch = findBalance_(identity.lineUserId, String(ticket.card_id || ''));
    const currentBalance = balanceMatch ? Number(balanceMatch.record.stamps || 0) : 0;
    if (!Number.isInteger(consumeStamps) || consumeStamps < 1 || currentBalance < consumeStamps) throw new ApiError(409, 'INSUFFICIENT_STAMPS', '目前點數不足，無法兌換這項獎勵。', { requiredStamps: consumeStamps, availableStamps: Math.max(0, currentBalance), ticketStatus: POINT_CARD_TICKET_STATUS_AVAILABLE_ });
    const nextBalance = currentBalance - consumeStamps;
    const balance = { line_user_id: identity.lineUserId, card_id: String(ticket.card_id || ''), stamps: String(nextBalance), updated_at: now };
    updateRecordAtRow_('PointBalances', balanceMatch.rowNumber, balance);
    appendRecord_('PointEntries', { entry_id: 'PE-' + Utilities.getUuid().replace(/-/g, '').substring(0, 12).toUpperCase(), line_user_id: identity.lineUserId, card_id: String(ticket.card_id || ''), amount: String(-consumeStamps), note: '票券兌換：' + String(ticket.ticket_title || ''), created_by: identity.lineUserId, created_at: now });
    const result = String(ticket.ticket_type || '') === 'lottery' ? drawTicketPrize_(ticket) : null;
    ticket.status = POINT_CARD_TICKET_STATUS_USED_;
    ticket.used_at = now;
    ticket.result_json = result ? JSON.stringify(result) : '';
    ticket.updated_at = now;
    updateRecordAtRow_('PointCardTickets', ticketMatch.rowNumber, ticket);
    const nextTickets = issuePointCardTicketsForBalance_(identity.lineUserId, card, currentBalance, nextBalance, now).map(ticketForClient_);
    appendAuditRecord_({ audit_id: Utilities.getUuid(), actor_line_user_id: identity.lineUserId, actor_role: 'member', action: 'POINT_CARD_TICKET_REDEEM', target_type: 'point_card_ticket', target_id: ticketId, result: 'success', detail: result ? 'Lottery ticket redeemed and prize drawn' : 'Coupon ticket redeemed', created_at: now });
    return { redeemed: true, ticket: ticketForClient_(ticket), nextTickets, balance: { cardId: String(ticket.card_id || ''), stamps: nextBalance, updatedAt: now } };
  });
}

function drawTicketPrize_(ticket) {
  const prizes = parseJsonArray_(ticket.lottery_prizes_json);
  let cursor = 0;
  let lastPositive = null;
  const roll = generateTicketRandomBasisPoint_();
  for (let index = 0; index < prizes.length; index += 1) {
    const prize = prizes[index];
    const basisPoints = Math.max(0, Math.round(Number(prize.win_rate || prize.winRate || 0) * 100));
    if (basisPoints > 0) lastPositive = prize;
    cursor += basisPoints;
    if (basisPoints > 0 && roll < cursor) return ticketPrizeResult_(prize);
  }
  return lastPositive ? ticketPrizeResult_(lastPositive) : null;
}

function ticketPrizeResult_(prize) {
  return { prizeId: String(prize.prize_id || prize.prizeId || ''), prizeTitle: String(prize.prize_title || prize.prizeTitle || ''), prizeDescription: String(prize.prize_description || prize.prizeDescription || '') };
}
