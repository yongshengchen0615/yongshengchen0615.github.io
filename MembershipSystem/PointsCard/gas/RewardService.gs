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
      return { duplicate: true, member: publicMember_(memberMatch.object, true) };
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
    const projection = rewardProjection_(member, settings);
    const reward = projection.nextAvailableReward;
    if (!reward) fail_('NO_REWARD_AVAILABLE', '此會員目前沒有可兌換的獎勵。');
    if (expectedRewardOrdinal && reward.entitlementOrdinal !== expectedRewardOrdinal) {
      fail_('CONFLICT', '可兌換獎勵已更新，請重新整理後再試。');
    }

    const now = new Date().toISOString();
    const redeemedBefore = member.redeemedRewards;
    const redeemedAfter = redeemedBefore + 1;
    const record = {
      rewardRecordId: 'RR-' + randomHex_(10).toUpperCase(),
      requestId: requestId,
      memberLineUserId: member.lineUserId,
      memberNo: member.memberNo,
      rewardName: reward.rewardName,
      rewardOrdinal: reward.entitlementOrdinal,
      redeemedBefore: redeemedBefore,
      redeemedAfter: redeemedAfter,
      status: 'processing',
      redeemedByLineUserId: context.identity.sub,
      note: note,
      createdAt: now,
      updatedAt: now,
      redeemedAt: '',
      auditRecordedAt: ''
    };
    appendObject_(rewardSheet, record);

    member.redeemedRewards = redeemedAfter;
    member.updatedAt = now;
    writeObjectRow_(memberSheet, memberMatch.row, member);

    const recordMatch = findByFieldWithRow_(rewardSheet, 'requestId', requestId);
    record.status = 'recorded';
    record.updatedAt = now;
    record.redeemedAt = now;
    if (!audit_(context.identity.sub, 'admin', 'REWARD_REDEEMED', member.lineUserId, 'success', {
      memberNo: member.memberNo,
      rewardName: reward.rewardName,
      rewardOrdinal: reward.entitlementOrdinal,
      rewardNodeId: reward.nodeId,
      cycleNumber: reward.cycleNumber,
      requestId: requestId
    })) fail_('AUDIT_UNAVAILABLE', '稽核紀錄暫時無法寫入；再次嘗試會恢復同一筆兌換。');
    record.auditRecordedAt = now;
    writeObjectRow_(rewardSheet, recordMatch.row, record);

    return { duplicate: false, claimedReward: reward, member: publicMember_(member, true) };
  } finally { lock.releaseLock(); }
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
    if (!audit_(record.redeemedByLineUserId, 'admin', 'REWARD_RECOVERED', record.memberLineUserId, 'success', {
      memberNo: record.memberNo,
      rewardName: record.rewardName,
      requestId: record.requestId
    })) fail_('AUDIT_UNAVAILABLE', '稽核紀錄暫時無法寫入；請使用相同請求再次嘗試。');
    record.auditRecordedAt = now;
  }
  writeObjectRow_(rewardSheet, recordMatch.row, record);
  return record;
}
