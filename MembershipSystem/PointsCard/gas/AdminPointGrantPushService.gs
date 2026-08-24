'use strict';

function pointGrantRetryKey_(grantId) {
  return lineMessagingRetryKey_('point-grant|' + grantId);
}

function pointGrantRewardPushMessageFromNotification_(grant, notificationValue) {
  if (!notificationValue) return '';
  const notification = normalizeMemberPointNotification_(notificationValue);
  if (notification.type !== 'point-grant-reward' ||
    notification.memberLineUserId !== grant.memberLineUserId ||
    notification.relatedId !== grant.grantId || notification.cardId !== grant.cardId) return '';
  return notification.message;
}

function pointGrantRewardPushMessage_(grant, notificationOverride) {
  const directMessage = pointGrantRewardPushMessageFromNotification_(grant, notificationOverride);
  if (directMessage) return directMessage;

  const match = findAdminPointGrantByFieldWithRow_(
    POINTS_CARD_ADMIN_GRANTS.notificationsSheet,
    'notificationId',
    pointGrantNotificationId_(grant.grantId)
  );
  if (!match) return '';
  return pointGrantRewardPushMessageFromNotification_(grant, match.object);
}

function pointGrantPushGrantSnapshot_(persistedGrant, grantOverride) {
  if (!grantOverride) return null;
  const direct = normalizeAdminPointGrant_(grantOverride);
  if (direct.grantId !== persistedGrant.grantId ||
    direct.memberLineUserId !== persistedGrant.memberLineUserId ||
    direct.memberNo !== persistedGrant.memberNo ||
    direct.cardId !== persistedGrant.cardId ||
    direct.stampCount !== persistedGrant.stampCount ||
    direct.totalBefore !== persistedGrant.totalBefore ||
    direct.totalAfter !== persistedGrant.totalAfter) return null;
  return direct;
}

function pointGrantPushMessage_(grant, rewardMessage) {
  return '發放點數：' + grant.stampCount + ' 點\n發放原因：' + grant.reason +
    (rewardMessage ? '\n' + rewardMessage : '');
}

function pointGrantPushStatus_(push) {
  if (push.accepted) return 'sent';
  if (push.errorCode === 'NOT_CONFIGURED') return 'not-configured';
  return push.retryable ? 'retry' : 'failed';
}

function attemptAdminPointGrantPush_(grantId, grantOverride, rewardNotification) {
  ensureAdminPointGrantStorage_();
  const initial = findAdminPointGrantByFieldWithRow_(
    POINTS_CARD_ADMIN_GRANTS.grantsSheet,
    'grantId',
    grantId
  );
  if (!initial) return { status: 'failed', errorCode: 'GRANT_NOT_FOUND' };

  const persistedGrant = normalizeAdminPointGrant_(initial.object);
  if (persistedGrant.pushStatus === 'sent') return { status: 'sent', errorCode: '' };

  const messageGrant = pointGrantPushGrantSnapshot_(persistedGrant, grantOverride) || persistedGrant;
  const rewardMessage = pointGrantRewardPushMessage_(messageGrant, rewardNotification);
  const now = new Date().toISOString();
  const push = createLineMessagingClient_().sendTextPush(
    persistedGrant.memberLineUserId,
    pointGrantRetryKey_(persistedGrant.grantId),
    pointGrantPushMessage_(messageGrant, rewardMessage)
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