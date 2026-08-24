'use strict';

function newAdminPointGrantId_() {
  return 'PG-' + Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyMMdd') + '-' + randomHex_(6).toUpperCase();
}

function recoverAdminPointGrant_(grantMatch) {
  const grant = normalizeAdminPointGrant_(grantMatch.object);
  if (grant.status === 'recorded') return grant;
  if (grant.status !== 'processing') {
    fail_('RECOVERY_REQUIRED', '人工發點紀錄狀態不正確，請聯絡管理員。');
  }

  const cardMatch = findMultiCard_(grant.cardId);
  if (!cardMatch) fail_('RECOVERY_REQUIRED', '人工發點所屬集點卡已不存在，請人工確認。');
  const progressMatch = findMemberCardProgress_(grant.cardId, grant.memberLineUserId);
  if (!progressMatch) fail_('RECOVERY_REQUIRED', '會員集點進度不存在，請人工確認。');

  const progress = progressMatch.progress;
  const now = new Date().toISOString();
  if (progress.totalStamps === grant.totalBefore) {
    progress.totalStamps = grant.totalAfter;
    progress.updatedAt = now;
    writeMultiCardObjectRow_(getMultiCardSheet_(MULTI_CARD_SHEETS.progress), progressMatch.row, progress);
  } else if (progress.totalStamps !== grant.totalAfter) {
    fail_('RECOVERY_REQUIRED', '人工發點資料與會員集點進度不一致，請人工確認。');
  }

  grant.status = 'recorded';
  grant.grantedAt = grant.grantedAt || now;
  grant.updatedAt = now;
  ensurePointGrantNotification_(grant, cardMatch.card);

  if (!grant.auditRecordedAt) {
    if (!audit_(grant.grantedByLineUserId, 'admin', 'CARD_POINTS_GRANTED', grant.memberLineUserId, 'success', {
      grantId: grant.grantId,
      requestId: grant.requestId,
      cardId: grant.cardId,
      memberNo: grant.memberNo,
      stampCount: grant.stampCount,
      totalBefore: grant.totalBefore,
      totalAfter: grant.totalAfter,
      recovered: true
    })) {
      fail_('AUDIT_UNAVAILABLE', '發點已套用但稽核紀錄暫時無法完成；請使用相同請求再次嘗試。');
    }
    grant.auditRecordedAt = now;
  }

  writeAdminPointGrantObjectRow_(POINTS_CARD_ADMIN_GRANTS.grantsSheet, grantMatch.row, grant);
  return grant;
}

function adminPointGrantMultiCard_(context, payload) {
  ensureMultiCardStorage_();
  ensureAdminPointGrantStorage_();

  const targetMemberNo = cleanText_(payload.targetMemberNo, 30, true);
  const cardId = validMultiCardId_(payload.cardId, true);
  const stampCount = strictInt_(
    payload.stampCount,
    1,
    POINTS_CARD_ADMIN_GRANTS.maxGrantPoints,
    'INVALID_STAMP_COUNT',
    '人工發點必須是 1 到 100 的整數。'
  );
  const reason = cleanText_(payload.reason, 200, true);
  const requestId = cleanText_(payload.requestId, 64, true).toLowerCase();
  if (!/^[a-f0-9]{32,64}$/.test(requestId)) {
    fail_('INVALID_REQUEST_ID', '發點請求識別碼格式不正確。');
  }

  let result;
  let rewardNotificationForPush = null;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(8000)) fail_('BUSY', '發點服務忙碌中，請稍後再試。');
  try {
    const memberMatch = findByFieldWithRow_(
      getSheet_(POINTS_CARD_SHEETS.members),
      'memberNo',
      targetMemberNo
    );
    if (!memberMatch) fail_('MEMBER_NOT_FOUND', '找不到指定會員。');

    const member = normalizeMember_(memberMatch.object);
    if (member.membershipStatus !== 'active') {
      fail_('MEMBER_INACTIVE', '只能對有效會員發放點數。');
    }

    const cardMatch = findMultiCard_(cardId);
    if (!cardMatch) fail_('CARD_NOT_FOUND', '找不到指定集點卡。');
    if (!cardMatch.card.available) fail_('CARD_UNAVAILABLE', '只能對目前有效的集點卡發放點數。');

    const existing = findAdminPointGrantByFieldWithRow_(
      POINTS_CARD_ADMIN_GRANTS.grantsSheet,
      'requestId',
      requestId
    );
    if (existing) {
      const existingGrant = normalizeAdminPointGrant_(existing.object);
      if (existingGrant.memberLineUserId !== member.lineUserId ||
        existingGrant.memberNo !== member.memberNo ||
        existingGrant.cardId !== cardId ||
        existingGrant.stampCount !== stampCount ||
        existingGrant.reason !== reason) {
        fail_('REQUEST_CONFLICT', '此請求識別碼已用於其他人工發點操作。');
      }

      const recovered = recoverAdminPointGrant_(existing);
      const refreshedMatch = findByFieldWithRow_(
        getSheet_(POINTS_CARD_SHEETS.members),
        'lineUserId',
        member.lineUserId
      );
      const refreshed = normalizeMember_(refreshedMatch.object);
      result = {
        duplicate: true,
        grantId: recovered.grantId,
        stampCount: recovered.stampCount,
        totalAfter: recovered.totalAfter,
        member: publicMultiCardMember_(refreshed, { cardId: cardId }, true)
      };
    } else {
      const progressMatch = ensureMemberCardProgress_(cardMatch.card, member);
      const progress = progressMatch.progress;
      const totalBefore = progress.totalStamps;
      if (totalBefore > 100000000 - stampCount) {
        fail_('STAMP_LIMIT_REACHED', '此會員在這張卡的累計集點已達系統上限。');
      }

      const totalAfter = totalBefore + stampCount;
      const settings = multiCardSettingsForProjection_(cardMatch.card);
      const unlockedRewards = rewardEntitlementsBetweenTotals_(totalBefore, totalAfter, settings);
      const now = new Date().toISOString();
      const grant = {
        grantId: newAdminPointGrantId_(),
        requestId: requestId,
        cardId: cardId,
        memberLineUserId: member.lineUserId,
        memberNo: member.memberNo,
        stampCount: stampCount,
        reason: reason,
        status: 'processing',
        totalBefore: totalBefore,
        totalAfter: totalAfter,
        grantedByLineUserId: context.identity.sub,
        pushStatus: 'pending',
        pushErrorCode: '',
        pushAttemptedAt: '',
        pushSentAt: '',
        createdAt: now,
        updatedAt: now,
        grantedAt: '',
        auditRecordedAt: ''
      };

      if (!audit_(context.identity.sub, 'admin', 'CARD_POINTS_GRANT_REQUESTED', member.lineUserId, 'pending', {
        grantId: grant.grantId,
        requestId: requestId,
        cardId: cardId,
        memberNo: member.memberNo,
        stampCount: stampCount,
        reason: reason
      })) {
        fail_('AUDIT_UNAVAILABLE', '稽核紀錄暫時無法寫入，點數尚未發放。');
      }
      appendAdminPointGrantObject_(POINTS_CARD_ADMIN_GRANTS.grantsSheet, grant);

      progress.totalStamps = totalAfter;
      progress.updatedAt = now;
      writeMultiCardObjectRow_(
        getMultiCardSheet_(MULTI_CARD_SHEETS.progress),
        progressMatch.row,
        progress
      );

      grant.status = 'recorded';
      grant.grantedAt = now;
      grant.updatedAt = now;
      rewardNotificationForPush = ensurePointGrantNotification_(grant, cardMatch.card, unlockedRewards);

      if (!audit_(context.identity.sub, 'admin', 'CARD_POINTS_GRANTED', member.lineUserId, 'success', {
        grantId: grant.grantId,
        requestId: requestId,
        cardId: cardId,
        memberNo: member.memberNo,
        stampCount: stampCount,
        totalBefore: totalBefore,
        totalAfter: totalAfter,
        reason: reason
      })) {
        fail_('AUDIT_UNAVAILABLE', '點數已套用但稽核紀錄暫時無法完成；請使用相同請求再次嘗試。');
      }
      grant.auditRecordedAt = now;

      const grantMatch = findAdminPointGrantByFieldWithRow_(
        POINTS_CARD_ADMIN_GRANTS.grantsSheet,
        'requestId',
        requestId
      );
      if (!grantMatch) fail_('RECOVERY_REQUIRED', '人工發點紀錄遺失，請人工確認。');
      writeAdminPointGrantObjectRow_(POINTS_CARD_ADMIN_GRANTS.grantsSheet, grantMatch.row, grant);

      result = {
        duplicate: false,
        grantId: grant.grantId,
        stampCount: stampCount,
        totalAfter: totalAfter,
        member: publicMultiCardMember_(member, { cardId: cardId }, true)
      };
    }
  } finally {
    lock.releaseLock();
  }

  const push = attemptAdminPointGrantPush_(result.grantId, rewardNotificationForPush);
  result.pushStatus = push.status;
  result.pushErrorCode = push.errorCode;
  return result;
}