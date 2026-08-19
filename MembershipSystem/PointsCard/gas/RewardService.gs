'use strict';

function adminRewardRedeem_(context, payload) {
  const targetMemberNo = cleanText_(payload.targetMemberNo, 30, true);
  const expectedUpdatedAt = cleanText_(payload.expectedUpdatedAt, 40, true);
  const requestId = cleanText_(payload.requestId, 64, true).toLowerCase();
  const note = cleanText_(payload.note || '門市現場兌換', 200, false);
  const expectedRewardOrdinal = payload.expectedRewardOrdinal == null || payload.expectedRewardOrdinal === '' ? 0 :
    strictInt_(payload.expectedRewardOrdinal, 1, 100000000, 'INVALID_REWARD', '兌換的獎勵節點不正確。');
  const expectedRewardNodesUpdatedAt = cleanText_(payload.expectedRewardNodesUpdatedAt || '', 64, false);
  if (!/^[a-f0-9]{32,64}$/.test(requestId)) fail_('INVALID_REQUEST_ID', '兌換請求識別碼格式不正確。');

  const memberSheet = getSheet_(POINTS_CARD_SHEETS.members);
  const rewardSheet = getSheet_(POINTS_CARD_SHEETS.rewardRecords);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(8000)) fail_('BUSY', '兌換服務忙碌中，請稍後再試。');
  try {
    const existing = findByFieldWithRow_(rewardSheet, 'requestId', requestId);
    if (existing) {
      if (existing.object.memberNo !== targetMemberNo || existing.object.redeemedByLineUserId !== context.identity.sub) {
        fail_('REQUEST_CONFLICT', '此請求識別碼已用於其他兌換操作。');
      }
      recoverRewardRecord_(existing);
      const recovered = findByFieldWithRow_(rewardSheet, 'requestId', requestId).object;
      if (recovered.status !== 'recorded') fail_('RECOVERY_REQUIRED', '先前兌換尚待人工確認。');
      const memberMatch = findByFieldWithRow_(memberSheet, 'memberNo', targetMemberNo);
      return rewardClaimResponse_(memberMatch.object, recovered, true, true);
    }

    recoverProcessingRewardRecordsForMember_(targetMemberNo);
    const memberMatch = findByFieldWithRow_(memberSheet, 'memberNo', targetMemberNo);
    if (!memberMatch) fail_('MEMBER_NOT_FOUND', '找不到指定會員。');
    const member = normalizeMember_(memberMatch.object);
    if (member.updatedAt !== expectedUpdatedAt) fail_('CONFLICT', '會員資料已更新，請重新整理後再兌換。');
    if (member.membershipStatus !== 'active') fail_('MEMBER_INACTIVE', '此會員目前無法兌換獎勵。');
    const settings = pointsCardSettings_();
    if (!expectedRewardOrdinal && settings.rewardNodes.length > 1) {
      fail_('CLIENT_UPGRADE_REQUIRED', '管理端版本過舊，請重新整理後再兌換多節點獎勵。');
    }
    if (expectedRewardNodesUpdatedAt && settings.rewardNodesUpdatedAt !== expectedRewardNodesUpdatedAt) {
      fail_('CONFLICT', '獎勵節點已更新，請重新整理後再兌換。');
    }
    const claimedOrdinals = readClaimedRewardOrdinalsForMember_(member.lineUserId);
    const reward = availableRewardForClaim_(member, settings, claimedOrdinals, expectedRewardOrdinal);
    if (!reward) fail_('NO_REWARD_AVAILABLE', '此會員目前沒有可兌換的獎勵。');

    const record = recordRewardClaim_(memberSheet, rewardSheet, memberMatch, member, reward, {
      requestId: requestId,
      actorLineUserId: context.identity.sub,
      actorRole: 'admin',
      note: note,
      confirmationId: ''
    });
    return rewardClaimResponse_(member, record, false, true);
  } finally { lock.releaseLock(); }
}

function memberRewardClaim_(context, payload) {
  const confirmationCode = cleanText_(payload.confirmationCode, 64, true).toLowerCase();
  const requestId = cleanText_(payload.requestId, 64, true).toLowerCase();
  const expectedRewardOrdinal = strictInt_(payload.expectedRewardOrdinal, 1, 100000000, 'INVALID_REWARD', '要使用的票券不正確。');
  const expectedRewardNodesUpdatedAt = cleanText_(payload.expectedRewardNodesUpdatedAt || '', 64, false);
  if (!/^[a-f0-9]{64}$/.test(confirmationCode)) fail_('INVALID_REWARD_CONFIRMATION_CODE', '店家票券確認 QR Code 格式不正確。');
  if (!/^[a-f0-9]{32,64}$/.test(requestId)) fail_('INVALID_REQUEST_ID', '票券使用請求識別碼格式不正確。');

  const memberSheet = getSheet_(POINTS_CARD_SHEETS.members);
  const rewardSheet = getSheet_(POINTS_CARD_SHEETS.rewardRecords);
  const confirmationSheet = getSheet_(POINTS_CARD_SHEETS.rewardConfirmations);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(8000)) fail_('BUSY', '票券確認服務忙碌中，請稍後再試。');
  try {
    const confirmationMatch = findByFieldWithRow_(confirmationSheet, 'shareCode', confirmationCode);
    if (!confirmationMatch) fail_('REWARD_CONFIRMATION_NOT_FOUND', '找不到這組店家票券確認 QR Code。');
    const confirmation = normalizeRewardConfirmation_(confirmationMatch.object);
    const existing = findByFieldWithRow_(rewardSheet, 'requestId', requestId);
    if (existing) {
      const record = existing.object;
      if (record.memberLineUserId !== context.identity.sub ||
        Number(record.rewardOrdinal || 0) !== expectedRewardOrdinal ||
        String(record.confirmationId || '') !== confirmation.confirmationId) {
        fail_('REQUEST_CONFLICT', '此請求識別碼已用於其他票券操作。');
      }
      recoverRewardRecord_(existing);
      const recovered = findByFieldWithRow_(rewardSheet, 'requestId', requestId).object;
      if (recovered.status !== 'recorded') fail_('RECOVERY_REQUIRED', '先前票券確認尚待人工確認。');
      const memberMatch = findByFieldWithRow_(memberSheet, 'lineUserId', context.identity.sub);
      return rewardClaimResponse_(memberMatch.object, recovered, true, false);
    }

    validateRewardConfirmationForClaim_(confirmation);
    const initialMemberMatch = findByFieldWithRow_(memberSheet, 'lineUserId', context.identity.sub);
    if (!initialMemberMatch) fail_('MEMBER_NOT_FOUND', '請先開啟集點卡完成會員建立。');
    recoverProcessingRewardRecordsForMember_(initialMemberMatch.object.memberNo);
    const memberMatch = findByFieldWithRow_(memberSheet, 'lineUserId', context.identity.sub);
    const member = normalizeMember_(memberMatch.object);
    if (member.membershipStatus !== 'active') fail_('MEMBER_INACTIVE', '這張集點卡目前無法使用，請洽店家確認。');
    const settings = pointsCardSettings_();
    if (expectedRewardNodesUpdatedAt && settings.rewardNodesUpdatedAt !== expectedRewardNodesUpdatedAt) {
      fail_('CONFLICT', '票券設定已更新，請重新整理後再試。');
    }
    const claimedOrdinals = readClaimedRewardOrdinalsForMember_(member.lineUserId);
    const reward = availableRewardForClaim_(member, settings, claimedOrdinals, expectedRewardOrdinal);
    if (!reward) fail_('REWARD_NOT_AVAILABLE', '這張票券尚未取得或已經使用。');

    const record = recordRewardClaim_(memberSheet, rewardSheet, memberMatch, member, reward, {
      requestId: requestId,
      actorLineUserId: member.lineUserId,
      actorRole: 'member',
      note: confirmation.note || '門市票券確認',
      confirmationId: confirmation.confirmationId
    });
    return rewardClaimResponse_(member, record, false, false);
  } finally { lock.releaseLock(); }
}

function availableRewardForClaim_(member, settings, claimedOrdinals, expectedRewardOrdinal) {
  const projection = rewardProjection_(member, settings, claimedOrdinals);
  if (!expectedRewardOrdinal) return projection.nextAvailableReward;
  const earnedRewards = projection.earnedRewards;
  const claimed = normalizedClaimedOrdinals_(member, claimedOrdinals);
  if (expectedRewardOrdinal > earnedRewards || claimed.has(expectedRewardOrdinal)) return null;
  return rewardEntitlementByOrdinal_(expectedRewardOrdinal, settings);
}

function lotteryResultForReward_(reward) {
  if (reward.rewardType !== 'lottery') return '';
  if (!Array.isArray(reward.lotteryPrizes) || reward.lotteryPrizes.length < 2) {
    fail_('CONFIGURATION_ERROR', '抽獎券尚未設定完整獎項。');
  }
  const outcomeCount = reward.lotteryPrizes.length;
  const sampleSpace = 0x100000000;
  const unbiasedLimit = sampleSpace - (sampleSpace % outcomeCount);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const randomValue = parseInt(randomHex_(4), 16);
    if (randomValue < unbiasedLimit) return reward.lotteryPrizes[randomValue % outcomeCount];
  }
  fail_('INTERNAL_ERROR', '暫時無法完成抽獎，請使用同一張票券再試一次。');
}

function recordRewardClaim_(memberSheet, rewardSheet, memberMatch, member, reward, options) {
  const now = new Date().toISOString();
  const redeemedBefore = member.redeemedRewards;
  const redeemedAfter = redeemedBefore + 1;
  const lotteryResult = lotteryResultForReward_(reward);
  const record = {
    rewardRecordId: 'RR-' + randomHex_(10).toUpperCase(),
    requestId: options.requestId,
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
  appendObject_(rewardSheet, record);

  member.redeemedRewards = redeemedAfter;
  member.updatedAt = now;
  writeObjectRow_(memberSheet, memberMatch.row, member);

  const recordMatch = findByFieldWithRow_(rewardSheet, 'requestId', options.requestId);
  record.status = 'recorded';
  record.updatedAt = now;
  record.redeemedAt = now;
  if (!audit_(options.actorLineUserId, options.actorRole, 'REWARD_REDEEMED', member.lineUserId, 'success', {
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
  writeObjectRow_(rewardSheet, recordMatch.row, record);
  return record;
}

function publicClaimedReward_(record) {
  return {
    entitlementOrdinal: Number(record.rewardOrdinal || 0),
    nodeId: String(record.rewardNodeId || ''),
    rewardName: String(record.rewardName || ''),
    rewardType: REWARD_TYPES.indexOf(String(record.rewardType)) >= 0 ? String(record.rewardType) : 'coupon',
    cycleNumber: Number(record.cycleNumber || 1),
    lotteryResult: String(record.lotteryResult || ''),
    redeemedAt: String(record.redeemedAt || record.createdAt || '')
  };
}

function rewardClaimResponse_(memberValue, record, duplicate, includeAdminFields) {
  const member = normalizeMember_(memberValue);
  return {
    duplicate: Boolean(duplicate),
    claimedReward: publicClaimedReward_(record),
    member: publicMember_(member, includeAdminFields, readClaimedRewardOrdinalsForMember_(member.lineUserId))
  };
}

function recoverProcessingRewardRecordsForMember_(memberNo) {
  const sheet = getSheet_(POINTS_CARD_SHEETS.rewardRecords);
  readObjects_(sheet).forEach(function (record) {
    if (record.memberNo === memberNo && record.status === 'processing') {
      const match = findByFieldWithRow_(sheet, 'requestId', record.requestId);
      if (match) recoverRewardRecord_(match);
    }
  });
}

function recoverRewardRecord_(recordMatch) {
  const rewardSheet = getSheet_(POINTS_CARD_SHEETS.rewardRecords);
  const memberSheet = getSheet_(POINTS_CARD_SHEETS.members);
  const record = recordMatch.object;
  if (record.status === 'recorded') return record;
  if (record.status !== 'processing') fail_('RECOVERY_REQUIRED', '兌換紀錄狀態不正確，請人工確認。');
  const memberMatch = findByFieldWithRow_(memberSheet, 'memberNo', record.memberNo);
  if (!memberMatch) fail_('RECOVERY_REQUIRED', '兌換會員資料不存在，請人工確認。');
  const member = normalizeMember_(memberMatch.object);
  const redeemedBefore = storedNonNegativeInt_(record.redeemedBefore, 100000000);
  const redeemedAfter = storedNonNegativeInt_(record.redeemedAfter, 100000000);
  const now = new Date().toISOString();
  if (member.redeemedRewards === redeemedBefore) {
    member.redeemedRewards = redeemedAfter;
    member.updatedAt = now;
    writeObjectRow_(memberSheet, memberMatch.row, member);
  } else if (member.redeemedRewards !== redeemedAfter) {
    fail_('RECOVERY_REQUIRED', '兌換資料需要人工確認。');
  }
  record.status = 'recorded';
  record.updatedAt = now;
  record.redeemedAt = record.redeemedAt || now;
  if (!record.auditRecordedAt) {
    if (!audit_(record.redeemedByLineUserId, record.confirmationId ? 'member' : 'admin', 'REWARD_RECOVERED', record.memberLineUserId, 'success', {
      memberNo: record.memberNo,
      rewardName: record.rewardName,
      rewardType: record.rewardType || 'coupon',
      lotteryResult: record.lotteryResult || '',
      confirmationId: record.confirmationId || '',
      requestId: record.requestId
    })) fail_('AUDIT_UNAVAILABLE', '稽核紀錄暫時無法寫入；請使用相同請求再次嘗試。');
    record.auditRecordedAt = now;
  }
  writeObjectRow_(rewardSheet, recordMatch.row, record);
  return record;
}
