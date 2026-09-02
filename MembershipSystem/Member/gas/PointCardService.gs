'use strict';

const POINT_CARD_REWARD_TYPES_ = Object.freeze(['coupon', 'lottery']);
const POINT_CARD_MAX_REWARDS_ = 30;
const POINT_CARD_MAX_LOTTERY_PRIZES_ = 30;
const POINT_CARD_RATE_BASIS_POINTS_ = 10000;

function handlePointCardBootstrap_(identity) {
  const member = ensureMember_(identity);
  return { profile: { displayName: String(member.display_name || identity.displayName) }, cards: visiblePointCardsForMember_(identity.lineUserId) };
}

function readPointCards_() {
  const rewardsByCard = pointCardRewardsByCard_();
  return readRecords_('PointCards').map(function(card) { return pointCardForClient_(card, rewardsByCard[String(card.card_id || '')] || []); }).sort(function(a, b) { return String(b.updatedAt).localeCompare(String(a.updatedAt)); });
}

function pointCardForClient_(card, configuredRewards) {
  const cardId = String(card.card_id || '');
  const rewards = Array.isArray(configuredRewards) && configuredRewards.length
    ? configuredRewards.map(pointCardRewardForClient_).sort(function(a, b) { return a.thresholdStamps - b.thresholdStamps; })
    : legacyPointCardReward_(card);
  const finalReward = rewards.length ? rewards[rewards.length - 1] : null;
  return { cardId, title: String(card.title || ''), description: String(card.description || ''), targetStamps: Number(card.target_stamps || 0), rewardTitle: String(card.reward_title || (finalReward && finalReward.rewardTitle) || ''), rewards, status: String(card.status || 'draft'), accent: String(card.accent || '#e47845'), createdAt: String(card.created_at || ''), updatedAt: String(card.updated_at || '') };
}

function pointCardRewardsByCard_() {
  const grouped = {};
  const prizesByReward = pointCardLotteryPrizesByReward_();
  readRecords_('PointCardRewards').forEach(function(record) {
    const cardId = String(record.card_id || '').trim();
    if (!cardId) return;
    if (!grouped[cardId]) grouped[cardId] = [];
    record.prizes = prizesByReward[String(record.reward_id || '')] || [];
    grouped[cardId].push(record);
  });
  return grouped;
}

function pointCardLotteryPrizesByReward_() {
  const grouped = {};
  readRecords_('PointCardLotteryPrizes').forEach(function(record) {
    const rewardId = String(record.reward_id || '').trim();
    if (!rewardId) return;
    if (!grouped[rewardId]) grouped[rewardId] = [];
    grouped[rewardId].push(record);
  });
  return grouped;
}

function pointCardRewardForClient_(reward) {
  return {
    rewardId: String(reward.reward_id || reward.rewardId || ''),
    cardId: String(reward.card_id || reward.cardId || ''),
    thresholdStamps: Number(reward.threshold_stamps || reward.thresholdStamps || 0),
    rewardType: POINT_CARD_REWARD_TYPES_.indexOf(String(reward.reward_type || reward.rewardType || '').toLowerCase()) >= 0 ? String(reward.reward_type || reward.rewardType).toLowerCase() : 'coupon',
    rewardTitle: String(reward.reward_title || reward.rewardTitle || ''),
    rewardDescription: String(reward.reward_description || reward.rewardDescription || ''),
    lotteryWinRate: Number(reward.lottery_win_rate || reward.lotteryWinRate || 0),
    prizes: Array.isArray(reward.prizes || reward.lotteryPrizes) ? (reward.prizes || reward.lotteryPrizes).map(pointCardLotteryPrizeForClient_) : []
  };
}

function pointCardLotteryPrizeForClient_(prize) {
  return { prizeId: String(prize.prize_id || prize.prizeId || ''), rewardId: String(prize.reward_id || prize.rewardId || ''), prizeTitle: String(prize.prize_title || prize.prizeTitle || ''), prizeDescription: String(prize.prize_description || prize.prizeDescription || ''), winRate: Number(prize.win_rate || prize.winRate || 0) };
}

function legacyPointCardReward_(card) {
  const title = String(card.reward_title || '').trim();
  if (!title) return [];
  return [{ rewardId: 'legacy:' + String(card.card_id || ''), cardId: String(card.card_id || ''), thresholdStamps: Number(card.target_stamps || 0), rewardType: 'coupon', rewardTitle: title, rewardDescription: '', lotteryWinRate: 0, prizes: [] }];
}

function visiblePointCardsForMember_(lineUserId) {
  const balances = readRecords_('PointBalances').filter(function(balance) { return String(balance.line_user_id || '') === lineUserId; });
  const balanceMap = {}; balances.forEach(function(balance) { balanceMap[String(balance.card_id || '')] = { stamps: Number(balance.stamps || 0), updatedAt: String(balance.updated_at || '') }; });
  return readPointCards_().filter(function(card) { return card.status === 'active'; }).map(function(card) { const balance = balanceMap[card.cardId] || { stamps: 0, updatedAt: card.updatedAt }; return Object.assign({}, card, { stamps: Math.max(0, balance.stamps), updatedAt: balance.updatedAt || card.updatedAt }); });
}

function handleAdminBootstrap_(identity, admin) {
  const members = readMembers_();
  const cards = readPointCards_();
  const entries = readRecords_('PointEntries');
  const today = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd');
  return { profile: { displayName: identity.displayName }, role: admin.role, members, cards, stats: { memberCount: members.length, activeMemberCount: members.filter(function(member) { return member.status === 'active'; }).length, activeCardCount: cards.filter(function(card) { return card.status === 'active'; }).length, todayEntryCount: entries.filter(function(entry) { return formatEntryDate_(entry.created_at) === today; }).length } };
}

function handlePointCardSave_(identity, admin, request) {
  const input = request.card && typeof request.card === 'object' ? request.card : {};
  const cardId = String(input.cardId || '').trim();
  const title = String(input.title || '').trim();
  const description = String(input.description || '').trim();
  const rewardTitle = String(input.rewardTitle || '').trim();
  const targetStamps = Number(input.targetStamps);
  const status = String(input.status || '').trim().toLowerCase();
  const accent = String(input.accent || '').trim();
  const expected = String(request.expectedUpdatedAt || '').trim();
  const hasRewards = Object.prototype.hasOwnProperty.call(input, 'rewards');
  if (!title || title.length > 80 || description.length > 240 || (!hasRewards && (!rewardTitle || rewardTitle.length > 100))) throw new ApiError(400, 'INVALID_CARD', '集點卡名稱、說明或回饋內容不合法。');
  if (!Number.isInteger(targetStamps) || targetStamps < 1 || targetStamps > 100) throw new ApiError(400, 'INVALID_CARD', '完成點數必須是 1–100 的整數。');
  const rewards = hasRewards ? normalizePointCardRewards_(input.rewards, targetStamps) : null;
  if (['active', 'draft', 'archived'].indexOf(status) < 0 || !/^#[0-9a-f]{6}$/i.test(accent)) throw new ApiError(400, 'INVALID_CARD', '集點卡狀態或識別色不合法。');

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
    if (!hasRewards && existingRewards.some(function(existingReward) { return Number(existingReward.threshold_stamps || 0) > targetStamps; })) throw new ApiError(400, 'INVALID_CARD_REWARDS', '完成點數不可低於既有節點點數，請一併更新節點設定。');
    card.title = title; card.description = description; card.target_stamps = String(targetStamps); card.reward_title = hasRewards ? rewards[rewards.length - 1].reward_title : rewardTitle; card.status = status; card.accent = accent.toUpperCase(); card.updated_by = identity.lineUserId; card.updated_at = now;
    if (rowNumber) updateRecordAtRow_('PointCards', rowNumber, card); else appendRecord_('PointCards', card);
    if (hasRewards) replacePointCardRewards_(card.card_id, rewards, now);
    appendAuditRecord_({ audit_id: Utilities.getUuid(), actor_line_user_id: identity.lineUserId, actor_role: admin.role, action: 'POINT_CARD_SAVE', target_type: 'point_card', target_id: card.card_id, result: 'success', detail: 'Point card saved', created_at: now });
    return { card: pointCardForClient_(card, hasRewards ? rewards : existingRewards) };
  });
}

function normalizePointCardRewards_(rawRewards, targetStamps) {
  if (!Array.isArray(rawRewards) || rawRewards.length < 1 || rawRewards.length > POINT_CARD_MAX_REWARDS_) throw new ApiError(400, 'INVALID_CARD_REWARDS', '至少要設定 1 個節點，最多 30 個節點。');
  const seenThresholds = {};
  const normalized = rawRewards.map(function(rawReward) {
    if (!rawReward || typeof rawReward !== 'object' || Array.isArray(rawReward)) throw new ApiError(400, 'INVALID_CARD_REWARDS', '節點獎勵格式不合法。');
    const thresholdStamps = Number(rawReward.thresholdStamps);
    const rewardType = String(rawReward.rewardType || '').trim().toLowerCase();
    const rewardTitle = String(rawReward.rewardTitle || '').trim();
    const rewardDescription = String(rawReward.rewardDescription || '').trim();
    if (!Number.isInteger(thresholdStamps) || thresholdStamps < 1 || thresholdStamps > targetStamps || seenThresholds[thresholdStamps]) throw new ApiError(400, 'INVALID_CARD_REWARDS', '節點點數必須是互不重複、且不超過完成點數的整數。');
    if (POINT_CARD_REWARD_TYPES_.indexOf(rewardType) < 0 || !rewardTitle || rewardTitle.length > 100 || rewardDescription.length > 240) throw new ApiError(400, 'INVALID_CARD_REWARDS', '節點獎勵名稱、說明或類型不合法。');
    seenThresholds[thresholdStamps] = true;
    let lotteryWinRate = 0;
    let prizes = [];
    if (rewardType === 'lottery') {
      prizes = normalizePointCardLotteryPrizes_(rawReward.prizes);
    }
    return { reward_id: 'PR-' + Utilities.getUuid().replace(/-/g, '').substring(0, 12).toUpperCase(), card_id: '', threshold_stamps: String(thresholdStamps), reward_type: rewardType, reward_title: rewardTitle, reward_description: rewardDescription, lottery_win_rate: String(lotteryWinRate), prizes, created_at: '', updated_at: '' };
  }).sort(function(a, b) { return Number(a.threshold_stamps) - Number(b.threshold_stamps); });
  return normalized;
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
  const lineUserId = String(request.lineUserId || '').trim(); const cardId = String(request.cardId || '').trim(); const amount = Number(request.amount); const note = String(request.note || '').trim();
  if (!lineUserId || lineUserId.length > 80 || !cardId || cardId.length > 80 || !Number.isInteger(amount) || amount < 1 || amount > 100 || note.length > 160) throw new ApiError(400, 'INVALID_STAMP', '會員、集點卡、點數或備註不合法。');
  return withDataLock_(function() {
    const member = findRecordWithRow_('Members', 'line_user_id', lineUserId); if (!member) throw new ApiError(404, 'MEMBER_NOT_FOUND', '找不到會員資料。');
    if (String(member.record.status || 'active') !== 'active') throw new ApiError(400, 'MEMBER_DISABLED', '停用中的會員無法補登點數。');
    const card = findRecordWithRow_('PointCards', 'card_id', cardId); if (!card || String(card.record.status) !== 'active') throw new ApiError(400, 'CARD_NOT_ACTIVE', '只能為啟用中的集點卡增加點數。');
    const balanceMatch = findBalance_(lineUserId, cardId); const now = nowIso_(); const current = balanceMatch ? Number(balanceMatch.record.stamps || 0) : 0; const nextBalance = current + amount; const balance = { line_user_id: lineUserId, card_id: cardId, stamps: String(nextBalance), updated_at: now };
    if (balanceMatch) updateRecordAtRow_('PointBalances', balanceMatch.rowNumber, balance); else appendRecord_('PointBalances', balance);
    appendRecord_('PointEntries', { entry_id: 'PE-' + Utilities.getUuid().replace(/-/g, '').substring(0, 12).toUpperCase(), line_user_id: lineUserId, card_id: cardId, amount: String(amount), note, created_by: identity.lineUserId, created_at: now });
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
