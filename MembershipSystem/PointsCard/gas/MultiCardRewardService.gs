'use strict';

function adminRewardRedeemMultiCard_(context, payload) {
  ensureMultiCardStorage_();
  const cardId = validMultiCardId_(payload.cardId, true);
  const targetMemberNo = cleanText_(payload.targetMemberNo, 30, true);
  const expectedUpdatedAt = cleanText_(payload.expectedUpdatedAt, 40, true);
  const requestId = cleanText_(payload.requestId, 64, true).toLowerCase();
  const note = cleanText_(payload.note || '門市現場兌換', 200, false);
  const expectedRewardOrdinal = payload.expectedRewardOrdinal == null || payload.expectedRewardOrdinal === '' ? 0 :
    strictInt_(payload.expectedRewardOrdinal, 1, 100000000, 'INVALID_REWARD', '兌換的獎勵節點不正確。');
  const expectedRewardNodesUpdatedAt = cleanText_(payload.expectedRewardNodesUpdatedAt || '', 64, false);
  if (!/^[a-f0-9]{32,64}$/.test(requestId)) fail_('INVALID_REQUEST_ID', '兌換請求識別碼格式不正確。');

  const memberSheet = getSheet_(POINTS_CARD_SHEETS.members);
  const rewardSheet = getMultiCardSheet_(MULTI_CARD_SHEETS.rewardRecords);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(8000)) fail_('BUSY', '兌換服務忙碌中，請稍後再試。');
  try {
    const cardMatch = findMultiCard_(cardId);
    if (!cardMatch) fail_('CARD_NOT_FOUND', '找不到指定集點卡。');

    const existing = findMultiCardByFieldWithRow_(rewardSheet, 'requestId', requestId);
    if (existing) {
      const existingRecord = normalizeMultiCardRewardRecord_(existing.object);
      if (existingRecord.memberNo !== targetMemberNo || existingRecord.redeemedByLineUserId !== context.identity.sub || existingRecord.cardId !== cardId) {
        fail_('REQUEST_CONFLICT', '此請求識別碼已用於其他兌換操作。');
      }
      recoverMultiCardRewardRecord_(existing);
      const recovered = normalizeMultiCardRewardRecord_(findMultiCardByFieldWithRow_(rewardSheet, 'requestId', requestId).object);
      if (recovered.status !== 'recorded') fail_('RECOVERY_REQUIRED', '先前兌換尚待人工確認。');
      const memberMatch = findByFieldWithRow_(memberSheet, 'memberNo', targetMemberNo);
      return multiCardRewardClaimResponse_(memberMatch.object, recovered, true, true);
    }

    recoverProcessingMultiCardRewardRecordsForMember_(targetMemberNo, cardId);
    const memberMatch = findByFieldWithRow_(memberSheet, 'memberNo', targetMemberNo);
    if (!memberMatch) fail_('MEMBER_NOT_FOUND', '找不到指定會員。');
    const member = normalizeMember_(memberMatch.object);
    if (member.updatedAt !== expectedUpdatedAt) fail_('CONFLICT', '會員資料已更新，請重新整理後再兌換。');
    if (member.membershipStatus !== 'active') fail_('MEMBER_INACTIVE', '此會員目前無法兌換獎勵。');
    const settings = multiCardSettingsForProjection_(cardMatch.card);
    if (!expectedRewardOrdinal && settings.rewardNodes.length > 1) {
      fail_('CLIENT_UPGRADE_REQUIRED', '管理端版本過舊，請重新整理後再兌換多節點獎勵。');
    }
    if (expectedRewardNodesUpdatedAt && settings.rewardNodesUpdatedAt !== expectedRewardNodesUpdatedAt) {
      fail_('CONFLICT', '獎勵節點已更新，請重新整理後再兌換。');
    }
    const progressMatch = ensureMemberCardProgress_(cardMatch.card, member);
    const reward = availableMultiCardRewardForClaim_(progressMatch.progress, cardMatch.card, member.lineUserId, expectedRewardOrdinal);
    if (!reward) fail_('NO_REWARD_AVAILABLE', '此會員目前沒有可兌換的獎勵。');

    const record = recordMultiCardRewardClaim_(rewardSheet, progressMatch, member, cardMatch.card, reward, {
      requestId: requestId,
      actorLineUserId: context.identity.sub,
      actorRole: 'admin',
      note: note,
      confirmationId: ''
    });
    return multiCardRewardClaimResponse_(member, record, false, true);
  } finally {
    lock.releaseLock();
  }
}

function memberRewardPrepareMultiCard_(context, payload) {
  ensureMultiCardStorage_();
  const cardId = validMultiCardId_(payload.cardId, true);
  const confirmationCode = cleanText_(payload.confirmationCode, 64, true).toLowerCase();
  const expectedRewardOrdinal = strictInt_(payload.expectedRewardOrdinal, 1, 100000000, 'INVALID_REWARD', '要使用的票券不正確。');
  const expectedRewardNodesUpdatedAt = cleanText_(payload.expectedRewardNodesUpdatedAt || '', 64, false);
  if (!/^[a-f0-9]{64}$/.test(confirmationCode)) fail_('INVALID_REWARD_CONFIRMATION_CODE', '店家票券確認 QR Code 格式不正確。');

  const cardMatch = findMultiCard_(cardId);
  if (!cardMatch) fail_('CARD_NOT_FOUND', '這張票券所屬的集點卡已不存在。');
  const confirmationMatch = findByFieldWithRow_(getSheet_(POINTS_CARD_SHEETS.rewardConfirmations), 'shareCode', confirmationCode);
  if (!confirmationMatch) fail_('REWARD_CONFIRMATION_NOT_FOUND', '找不到這組店家票券確認 QR Code。');
  validateRewardConfirmationForClaim_(normalizeRewardConfirmation_(confirmationMatch.object));

  const memberMatch = findByFieldWithRow_(getSheet_(POINTS_CARD_SHEETS.members), 'lineUserId', context.identity.sub);
  if (!memberMatch) fail_('MEMBER_NOT_FOUND', '請先開啟集點卡完成會員建立。');
  const member = normalizeMember_(memberMatch.object);
  if (member.membershipStatus !== 'active') fail_('MEMBER_INACTIVE', '會員目前無法使用票券，請洽店家確認。');
  const settings = multiCardSettingsForProjection_(cardMatch.card);
  if (expectedRewardNodesUpdatedAt && settings.rewardNodesUpdatedAt !== expectedRewardNodesUpdatedAt) {
    fail_('CONFLICT', '票券設定已更新，請重新整理後再試。');
  }
  const progressMatch = findMemberCardProgress_(cardId, member.lineUserId);
  const progress = progressMatch ? progressMatch.progress : { totalStamps: 0, redeemedRewards: 0 };
  const reward = availableMultiCardRewardForClaim_(progress, cardMatch.card, member.lineUserId, expectedRewardOrdinal);
  if (!reward) fail_('REWARD_NOT_AVAILABLE', '這張票券尚未取得或已經使用。');
  if (reward.rewardType !== 'lottery') fail_('INVALID_REWARD', '這張票券不是抽獎券。');

  return { prepared: true };
}

function memberRewardClaimMultiCard_(context, payload) {
  ensureMultiCardStorage_();
  const cardId = validMultiCardId_(payload.cardId, true);
  const confirmationCode = cleanText_(payload.confirmationCode, 64, true).toLowerCase();
  const requestId = cleanText_(payload.requestId, 64, true).toLowerCase();
  const expectedRewardOrdinal = strictInt_(payload.expectedRewardOrdinal, 1, 100000000, 'INVALID_REWARD', '要使用的票券不正確。');
  const expectedRewardNodesUpdatedAt = cleanText_(payload.expectedRewardNodesUpdatedAt || '', 64, false);
  if (!/^[a-f0-9]{64}$/.test(confirmationCode)) fail_('INVALID_REWARD_CONFIRMATION_CODE', '店家票券確認 QR Code 格式不正確。');
  if (!/^[a-f0-9]{32,64}$/.test(requestId)) fail_('INVALID_REQUEST_ID', '票券使用請求識別碼格式不正確。');

  const memberSheet = getSheet_(POINTS_CARD_SHEETS.members);
  const rewardSheet = getMultiCardSheet_(MULTI_CARD_SHEETS.rewardRecords);
  const confirmationSheet = getSheet_(POINTS_CARD_SHEETS.rewardConfirmations);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(8000)) fail_('BUSY', '票券確認服務忙碌中，請稍後再試。');
  try {
    const cardMatch = findMultiCard_(cardId);
    if (!cardMatch) fail_('CARD_NOT_FOUND', '這張票券所屬的集點卡已不存在。');
    const confirmationMatch = findByFieldWithRow_(confirmationSheet, 'shareCode', confirmationCode);
    if (!confirmationMatch) fail_('REWARD_CONFIRMATION_NOT_FOUND', '找不到這組店家票券確認 QR Code。');
    const confirmation = normalizeRewardConfirmation_(confirmationMatch.object);

    const existing = findMultiCardByFieldWithRow_(rewardSheet, 'requestId', requestId);
    if (existing) {
      const record = normalizeMultiCardRewardRecord_(existing.object);
      if (record.memberLineUserId !== context.identity.sub || record.cardId !== cardId ||
        record.rewardOrdinal !== expectedRewardOrdinal || record.confirmationId !== confirmation.confirmationId) {
        fail_('REQUEST_CONFLICT', '此請求識別碼已用於其他票券操作。');
      }
      recoverMultiCardRewardRecord_(existing);
      const recovered = normalizeMultiCardRewardRecord_(findMultiCardByFieldWithRow_(rewardSheet, 'requestId', requestId).object);
      if (recovered.status !== 'recorded') fail_('RECOVERY_REQUIRED', '先前票券確認尚待人工確認。');
      const memberMatch = findByFieldWithRow_(memberSheet, 'lineUserId', context.identity.sub);
      return multiCardRewardClaimResponse_(memberMatch.object, recovered, true, false);
    }

    validateRewardConfirmationForClaim_(confirmation);
    const initialMemberMatch = findByFieldWithRow_(memberSheet, 'lineUserId', context.identity.sub);
    if (!initialMemberMatch) fail_('MEMBER_NOT_FOUND', '請先開啟集點卡完成會員建立。');
    recoverProcessingMultiCardRewardRecordsForMember_(initialMemberMatch.object.memberNo, cardId);
    const memberMatch = findByFieldWithRow_(memberSheet, 'lineUserId', context.identity.sub);
    const member = normalizeMember_(memberMatch.object);
    if (member.membershipStatus !== 'active') fail_('MEMBER_INACTIVE', '會員目前無法使用票券，請洽店家確認。');
    const settings = multiCardSettingsForProjection_(cardMatch.card);
    if (expectedRewardNodesUpdatedAt && settings.rewardNodesUpdatedAt !== expectedRewardNodesUpdatedAt) {
      fail_('CONFLICT', '票券設定已更新，請重新整理後再試。');
    }
    const progressMatch = ensureMemberCardProgress_(cardMatch.card, member);
    const reward = availableMultiCardRewardForClaim_(progressMatch.progress, cardMatch.card, member.lineUserId, expectedRewardOrdinal);
    if (!reward) fail_('REWARD_NOT_AVAILABLE', '這張票券尚未取得或已經使用。');

    const record = recordMultiCardRewardClaim_(rewardSheet, progressMatch, member, cardMatch.card, reward, {
      requestId: requestId,
      actorLineUserId: member.lineUserId,
      actorRole: 'member',
      note: confirmation.note || '門市票券確認',
      confirmationId: confirmation.confirmationId
    });
    return multiCardRewardClaimResponse_(member, record, false, false);
  } finally {
    lock.releaseLock();
  }
}

function availableMultiCardRewardForClaim_(progress, card, lineUserId, expectedRewardOrdinal) {
  const settings = multiCardSettingsForProjection_(card);
  const projectionMember = { totalStamps: progress.totalStamps, redeemedRewards: progress.redeemedRewards };
  const claimedOrdinals = claimedOrdinalsForCardMember_(card.cardId, lineUserId);
  const projection = rewardProjection_(projectionMember, settings, claimedOrdinals);
  let reward;
  if (!expectedRewardOrdinal) reward = projection.nextAvailableReward;
  else {
    const claimed = normalizedClaimedOrdinals_(projectionMember, claimedOrdinals);
    if (expectedRewardOrdinal > projection.earnedRewards || claimed.has(expectedRewardOrdinal)) return null;
    reward = rewardEntitlementByOrdinal_(expectedRewardOrdinal, settings);
  }
  if (!reward) return null;
  const ticket = multiCardRewardTicketState_(
    reward,
    progress,
    { joinedAt: progress.createdAt || progress.updatedAt || '' },
    multiCardStampRecordsForMemberCard_(lineUserId, card.cardId, true)
  );
  if (ticket.expired) fail_('REWARD_EXPIRED', '這張票券已過期。');
  return ticket;
}

function recordMultiCardRewardClaim_(rewardSheet, progressMatch, member, card, reward, options) {
  const progress = progressMatch.progress;
  const now = new Date().toISOString();
  const redeemedBefore = progress.redeemedRewards;
  const redeemedAfter = redeemedBefore + 1;
  const lotteryResult = lotteryResultForReward_(reward);
  const record = {
    rewardRecordId: 'RR-' + randomHex_(10).toUpperCase(),
    requestId: options.requestId,
    cardId: card.cardId,
    memberLineUserId: member.lineUserId,
    memberNo: member.memberNo,
    rewardName: reward.rewardName,
    rewardOrdinal: reward.entitlementOrdinal,
    redeemedBefore: redeemedBefore,
    redeemedAfter: redeemedAfter,
    status: 'processing',
    redeemedByLineUserId: options.actorLineUserId,
    note: options.note,
    createdAt: now,
    updatedAt: now,
    redeemedAt: '',
    auditRecordedAt: '',
    rewardType: reward.rewardType,
    rewardNodeId: reward.nodeId,
    cycleNumber: reward.cycleNumber,
    lotteryResult: lotteryResult,
    confirmationId: options.confirmationId
  };
  appendMultiCardObject_(rewardSheet, record);

  progress.redeemedRewards = redeemedAfter;
  progress.updatedAt = now;
  writeMultiCardObjectRow_(getMultiCardSheet_(MULTI_CARD_SHEETS.progress), progressMatch.row, progress);

  const recordMatch = findMultiCardByFieldWithRow_(rewardSheet, 'requestId', options.requestId);
  record.status = 'recorded';
  record.updatedAt = now;
  record.redeemedAt = now;
  if (!audit_(options.actorLineUserId, options.actorRole, 'CARD_REWARD_REDEEMED', member.lineUserId, 'success', {
    cardId: card.cardId,
    memberNo: member.memberNo,
    rewardName: reward.rewardName,
    rewardType: reward.rewardType,
    rewardOrdinal: reward.entitlementOrdinal,
    rewardNodeId: reward.nodeId,
    cycleNumber: reward.cycleNumber,
    lotteryResult: lotteryResult,
    confirmationId: options.confirmationId,
    requestId: options.requestId
  })) fail_('AUDIT_UNAVAILABLE', '稽核紀錄暫時無法寫入；再次嘗試會恢復同一筆票券紀錄。');
  record.auditRecordedAt = now;
  writeMultiCardObjectRow_(rewardSheet, recordMatch.row, record);
  return normalizeMultiCardRewardRecord_(record);
}

function normalizeMultiCardRewardRecord_(value) {
  return {
    rewardRecordId: String(value.rewardRecordId || ''),
    requestId: String(value.requestId || ''),
    cardId: String(value.cardId || ''),
    memberLineUserId: String(value.memberLineUserId || ''),
    memberNo: String(value.memberNo || ''),
    rewardName: String(value.rewardName || ''),
    rewardOrdinal: storedNonNegativeInt_(value.rewardOrdinal, 100000000),
    redeemedBefore: storedNonNegativeInt_(value.redeemedBefore, 100000000),
    redeemedAfter: storedNonNegativeInt_(value.redeemedAfter, 100000000),
    status: String(value.status || ''),
    redeemedByLineUserId: String(value.redeemedByLineUserId || ''),
    note: String(value.note || ''),
    createdAt: String(value.createdAt || ''),
    updatedAt: String(value.updatedAt || ''),
    redeemedAt: String(value.redeemedAt || ''),
    auditRecordedAt: String(value.auditRecordedAt || ''),
    rewardType: REWARD_TYPES.indexOf(String(value.rewardType)) >= 0 ? String(value.rewardType) : 'coupon',
    rewardNodeId: String(value.rewardNodeId || ''),
    cycleNumber: storedNonNegativeInt_(value.cycleNumber || 1, 100000000),
    lotteryResult: String(value.lotteryResult || ''),
    confirmationId: String(value.confirmationId || '')
  };
}

function publicMultiCardClaimedReward_(record) {
  return {
    cardId: record.cardId,
    entitlementOrdinal: record.rewardOrdinal,
    nodeId: record.rewardNodeId,
    rewardName: record.rewardName,
    rewardType: record.rewardType,
    cycleNumber: record.cycleNumber || 1,
    lotteryResult: record.lotteryResult,
    redeemedAt: record.redeemedAt || record.createdAt
  };
}

function multiCardRewardClaimResponse_(memberValue, recordValue, duplicate, includeAdminFields) {
  const member = normalizeMember_(memberValue);
  const record = normalizeMultiCardRewardRecord_(recordValue);
  return {
    duplicate: Boolean(duplicate),
    claimedReward: publicMultiCardClaimedReward_(record),
    member: publicMultiCardMember_(member, { cardId: record.cardId }, includeAdminFields)
  };
}

function recoverProcessingMultiCardRewardRecordsForMember_(memberNo, cardId) {
  const sheet = getMultiCardSheet_(MULTI_CARD_SHEETS.rewardRecords);
  readMultiCardObjects_(sheet).forEach(function (record) {
    if (record.memberNo === memberNo && record.status === 'processing' && (!cardId || record.cardId === cardId)) {
      const match = findMultiCardByFieldWithRow_(sheet, 'requestId', record.requestId);
      if (match) recoverMultiCardRewardRecord_(match);
    }
  });
}

function recoverMultiCardRewardRecord_(recordMatch) {
  const rewardSheet = getMultiCardSheet_(MULTI_CARD_SHEETS.rewardRecords);
  const record = normalizeMultiCardRewardRecord_(recordMatch.object);
  if (record.status === 'recorded') return record;
  if (record.status !== 'processing') fail_('RECOVERY_REQUIRED', '兌換紀錄狀態不正確，請人工確認。');
  const cardMatch = findMultiCard_(record.cardId);
  if (!cardMatch) fail_('RECOVERY_REQUIRED', '兌換所屬集點卡不存在，請人工確認。');
  const progressMatch = findMemberCardProgress_(record.cardId, record.memberLineUserId);
  if (!progressMatch) fail_('RECOVERY_REQUIRED', '會員集點進度不存在，請人工確認。');
  const progress = progressMatch.progress;
  const now = new Date().toISOString();
  if (progress.redeemedRewards === record.redeemedBefore) {
    progress.redeemedRewards = record.redeemedAfter;
    progress.updatedAt = now;
    writeMultiCardObjectRow_(getMultiCardSheet_(MULTI_CARD_SHEETS.progress), progressMatch.row, progress);
  } else if (progress.redeemedRewards !== record.redeemedAfter) {
    fail_('RECOVERY_REQUIRED', '兌換資料需要人工確認。');
  }
  record.status = 'recorded';
  record.updatedAt = now;
  record.redeemedAt = record.redeemedAt || now;
  if (!record.auditRecordedAt) {
    if (!audit_(record.redeemedByLineUserId, record.confirmationId ? 'member' : 'admin', 'CARD_REWARD_RECOVERED', record.memberLineUserId, 'success', {
      cardId: record.cardId,
      memberNo: record.memberNo,
      rewardName: record.rewardName,
      rewardType: record.rewardType,
      lotteryResult: record.lotteryResult,
      confirmationId: record.confirmationId,
      requestId: record.requestId
    })) fail_('AUDIT_UNAVAILABLE', '稽核紀錄暫時無法寫入；請使用相同請求再次嘗試。');
    record.auditRecordedAt = now;
  }
  writeMultiCardObjectRow_(rewardSheet, recordMatch.row, record);
  return record;
}

function multiCardRewardConfirmationRecordCounts_() {
  ensureMultiCardStorage_();
  return readMultiCardObjects_(getMultiCardSheet_(MULTI_CARD_SHEETS.rewardRecords)).reduce(function (counts, record) {
    if (record.confirmationId && record.status === 'recorded') {
      counts[record.confirmationId] = (counts[record.confirmationId] || 0) + 1;
    }
    return counts;
  }, {});
}

function adminRewardConfirmationListMultiCard_(limit) {
  const maxRows = clampInt_(limit, 1, 100, 50);
  const recordCounts = multiCardRewardConfirmationRecordCounts_();
  return readObjects_(getSheet_(POINTS_CARD_SHEETS.rewardConfirmations)).map(normalizeRewardConfirmation_)
    .sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); })
    .slice(0, maxRows)
    .map(function (confirmation) {
      return publicRewardConfirmation_(confirmation, recordCounts[confirmation.confirmationId] || 0, false);
    });
}

function countRewardConfirmationRecordsMultiCard_(confirmationId) {
  const counts = multiCardRewardConfirmationRecordCounts_();
  return Number(counts[confirmationId] || 0);
}

function hasRewardConfirmationRecordsMultiCard_(confirmationId) {
  ensureMultiCardStorage_();
  return readMultiCardObjects_(getMultiCardSheet_(MULTI_CARD_SHEETS.rewardRecords)).some(function (record) {
    return record.confirmationId === confirmationId;
  });
}

function adminRewardConfirmationOpenMultiCard_(payload) {
  ensureMultiCardStorage_();
  const confirmationId = cleanText_(payload.confirmationId, 40, true);
  const match = findByFieldWithRow_(getSheet_(POINTS_CARD_SHEETS.rewardConfirmations), 'confirmationId', confirmationId);
  if (!match) fail_('REWARD_CONFIRMATION_NOT_FOUND', '找不到指定的票券確認 QR Code。');
  const confirmation = normalizeRewardConfirmation_(match.object);
  if (confirmation.status !== 'active') fail_('REWARD_CONFIRMATION_INACTIVE', '已停止的票券確認 QR Code 不再提供連結。');
  return { confirmation: publicRewardConfirmation_(confirmation, countRewardConfirmationRecordsMultiCard_(confirmationId), true) };
}

function adminRewardConfirmationDeleteMultiCard_(context, payload) {
  ensureMultiCardStorage_();
  const confirmationId = cleanText_(payload.confirmationId, 40, true);
  const expectedUpdatedAt = cleanText_(payload.expectedUpdatedAt, 40, true);
  const sheet = getSheet_(POINTS_CARD_SHEETS.rewardConfirmations);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) fail_('BUSY', '系統忙碌中，請稍後再試。');
  try {
    const match = findByFieldWithRow_(sheet, 'confirmationId', confirmationId);
    if (!match) fail_('REWARD_CONFIRMATION_NOT_FOUND', '找不到指定的票券確認 QR Code。');
    const confirmation = normalizeRewardConfirmation_(match.object);
    if (confirmation.updatedAt !== expectedUpdatedAt) fail_('CONFLICT', '票券確認 QR Code 已更新，請重新整理後再試。');
    if (hasRewardConfirmationRecordsMultiCard_(confirmationId)) {
      fail_('REWARD_CONFIRMATION_HAS_RECORDS', '已有票券領取紀錄的 QR Code 只能停止，不能刪除。');
    }
    if (!audit_(context.identity.sub, 'admin', 'REWARD_CONFIRM_QR_DELETE_REQUESTED', '', 'pending', { confirmationId: confirmationId })) {
      fail_('AUDIT_UNAVAILABLE', '稽核紀錄暫時無法寫入，票券確認 QR Code 未刪除。');
    }
    deleteObjectRow_(sheet, match.row);
    audit_(context.identity.sub, 'admin', 'REWARD_CONFIRM_QR_DELETED', '', 'success', { confirmationId: confirmationId });
    return { confirmationId: confirmationId };
  } finally {
    lock.releaseLock();
  }
}
