'use strict';

function pointGrantRetryKey_(grantId) {
  return lineMessagingRetryKey_('point-grant|' + grantId);
}

function pointGrantPushMessage_(grant, card) {
  const cardName = String(card && card.name || '集點卡');
  const unlockedRewards = pointGrantUnlockedRewards_(grant, card);
  const rewardMessage = unlockedRewards.length
    ? '\n新獲得：' + pointGrantRewardSummary_(unlockedRewards) + '。'
    : '';
  return '你已獲得「' + cardName + '」' + grant.stampCount + ' 點。\n發放原因：' + grant.reason +
    '\n目前點數：' + grant.totalAfter + ' 點。' + rewardMessage;
}

function pointGrantPushStatus_(push) {
  if (push.accepted) return 'sent';
  if (push.errorCode === 'NOT_CONFIGURED') return 'not-configured';
  return push.retryable ? 'retry' : 'failed';
}

function attemptAdminPointGrantPush_(grantId) {
  ensureAdminPointGrantStorage_();
  const initial = findAdminPointGrantByFieldWithRow_(
    POINTS_CARD_ADMIN_GRANTS.grantsSheet,
    'grantId',
    grantId
  );
  if (!initial) return { status: 'failed', errorCode: 'GRANT_NOT_FOUND' };

  const grant = normalizeAdminPointGrant_(initial.object);
  if (grant.pushStatus === 'sent') return { status: 'sent', errorCode: '' };

  const cardMatch = findMultiCard_(grant.cardId);
  const card = cardMatch ? cardMatch.card : null;
  const now = new Date().toISOString();
  const push = createLineMessagingClient_().sendTextPush(
    grant.memberLineUserId,
    pointGrantRetryKey_(grant.grantId),
    pointGrantPushMessage_(grant, card)
  );

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    return { status: push.accepted ? 'sent' : 'retry', errorCode: 'PUSH_STATE_BUSY' };
  }
  try {
    const currentMatch = findAdminPointGrantByFieldWithRow_(
      POINTS_CARD_ADMIN_GRANTS.grantsSheet,
      'grantId',
      grantId
    );
    if (!currentMatch) return { status: 'failed', errorCode: 'GRANT_NOT_FOUND' };

    const current = normalizeAdminPointGrant_(currentMatch.object);
    if (current.pushStatus === 'sent') return { status: 'sent', errorCode: '' };

    current.pushStatus = pointGrantPushStatus_(push);
    current.pushErrorCode = push.errorCode;
    current.pushAttemptedAt = now;
    current.pushSentAt = push.accepted ? now : current.pushSentAt;
    current.updatedAt = now;
    writeAdminPointGrantObjectRow_(POINTS_CARD_ADMIN_GRANTS.grantsSheet, currentMatch.row, current);

    audit_(
      'system',
      'system',
      'CARD_POINTS_PUSH_NOTIFICATION',
      current.memberLineUserId,
      push.accepted ? 'success' : 'failed',
      {
        grantId: current.grantId,
        cardId: current.cardId,
        memberNo: current.memberNo,
        errorCode: push.errorCode || ''
      }
    );
    return { status: current.pushStatus, errorCode: current.pushErrorCode };
  } finally {
    lock.releaseLock();
  }
}