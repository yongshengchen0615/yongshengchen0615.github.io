'use strict';

function handlePointCardBootstrap_(identity) {
  const member = ensureMember_(identity);
  return { profile: { displayName: String(member.display_name || identity.displayName) }, cards: visiblePointCardsForMember_(identity.lineUserId) };
}

function readPointCards_() {
  return readRecords_('PointCards').map(pointCardForClient_).sort(function(a, b) { return String(b.updatedAt).localeCompare(String(a.updatedAt)); });
}

function pointCardForClient_(card) {
  return { cardId: String(card.card_id || ''), title: String(card.title || ''), description: String(card.description || ''), targetStamps: Number(card.target_stamps || 0), rewardTitle: String(card.reward_title || ''), status: String(card.status || 'draft'), accent: String(card.accent || '#e47845'), createdAt: String(card.created_at || ''), updatedAt: String(card.updated_at || '') };
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
  if (!title || title.length > 80 || description.length > 240 || !rewardTitle || rewardTitle.length > 100) throw new ApiError(400, 'INVALID_CARD', '集點卡名稱、說明或回饋內容不合法。');
  if (!Number.isInteger(targetStamps) || targetStamps < 1 || targetStamps > 100) throw new ApiError(400, 'INVALID_CARD', '完成點數必須是 1–100 的整數。');
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
    card.title = title; card.description = description; card.target_stamps = String(targetStamps); card.reward_title = rewardTitle; card.status = status; card.accent = accent.toUpperCase(); card.updated_by = identity.lineUserId; card.updated_at = now;
    if (rowNumber) updateRecordAtRow_('PointCards', rowNumber, card); else appendRecord_('PointCards', card);
    appendAuditRecord_({ audit_id: Utilities.getUuid(), actor_line_user_id: identity.lineUserId, actor_role: admin.role, action: 'POINT_CARD_SAVE', target_type: 'point_card', target_id: card.card_id, result: 'success', detail: 'Point card saved', created_at: now });
    return { card: pointCardForClient_(card) };
  });
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
