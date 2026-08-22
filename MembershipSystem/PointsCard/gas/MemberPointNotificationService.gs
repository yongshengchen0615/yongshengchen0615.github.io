'use strict';

function pointGrantNotificationId_(grantId) {
  return 'PN-' + sha256Hex_(grantId).slice(0, 32).toUpperCase();
}

function pointGrantNotificationMessage_(cardName, stampCount, reason) {
  return '店家已在「' + cardName + '」發放 ' + stampCount + ' 點給你。\n原因：' + reason;
}

function ensurePointGrantNotification_(grant, cardName) {
  const notificationId = pointGrantNotificationId_(grant.grantId);
  const existing = findAdminPointGrantByFieldWithRow_(
    POINTS_CARD_ADMIN_GRANTS.notificationsSheet,
    'notificationId',
    notificationId
  );
  if (existing) return normalizeMemberPointNotification_(existing.object);

  const now = grant.grantedAt || grant.updatedAt || new Date().toISOString();
  const notification = {
    notificationId: notificationId,
    memberLineUserId: grant.memberLineUserId,
    memberNo: grant.memberNo,
    cardId: grant.cardId,
    cardName: cardName,
    type: 'point-grant',
    title: '你獲得 ' + grant.stampCount + ' 點',
    message: pointGrantNotificationMessage_(cardName, grant.stampCount, grant.reason),
    stampCount: grant.stampCount,
    totalAfter: grant.totalAfter,
    relatedId: grant.grantId,
    status: 'unread',
    createdAt: now,
    readAt: '',
    updatedAt: now
  };
  appendAdminPointGrantObject_(POINTS_CARD_ADMIN_GRANTS.notificationsSheet, notification);
  return normalizeMemberPointNotification_(notification);
}

function publicMemberPointNotification_(notification) {
  return {
    notificationId: notification.notificationId,
    cardId: notification.cardId,
    cardName: notification.cardName,
    type: notification.type,
    title: notification.title,
    message: notification.message,
    stampCount: notification.stampCount,
    totalAfter: notification.totalAfter,
    createdAt: notification.createdAt
  };
}

function memberPointNotificationsList_(context, payload) {
  ensureAdminPointGrantStorage_();
  const memberMatch = findByFieldWithRow_(
    getSheet_(POINTS_CARD_SHEETS.members),
    'lineUserId',
    context.identity.sub
  );
  if (!memberMatch) fail_('MEMBER_NOT_FOUND', '請先開啟集點卡完成會員建立。');

  const limit = clampInt_(
    payload && payload.limit,
    1,
    POINTS_CARD_ADMIN_GRANTS.maxUnreadNotifications,
    POINTS_CARD_ADMIN_GRANTS.maxUnreadNotifications
  );
  const notifications = readAdminPointGrantObjectsByField_(
    POINTS_CARD_ADMIN_GRANTS.notificationsSheet,
    'memberLineUserId',
    context.identity.sub
  ).map(normalizeMemberPointNotification_)
    .filter(function (notification) {
      return notification.type === 'point-grant' && notification.status === 'unread';
    })
    .sort(function (a, b) { return String(a.createdAt).localeCompare(String(b.createdAt)); })
    .slice(0, limit)
    .map(publicMemberPointNotification_);
  return { notifications: notifications };
}

function memberPointNotificationRead_(context, payload) {
  ensureAdminPointGrantStorage_();
  const notificationId = cleanText_(payload.notificationId, 40, true).toUpperCase();
  if (!/^PN-[A-F0-9]{32}$/.test(notificationId)) {
    fail_('INVALID_NOTIFICATION_ID', '通知識別碼格式不正確。');
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) fail_('BUSY', '通知服務忙碌中，請稍後再試。');
  try {
    const match = findAdminPointGrantByFieldWithRow_(
      POINTS_CARD_ADMIN_GRANTS.notificationsSheet,
      'notificationId',
      notificationId
    );
    if (!match) fail_('NOTIFICATION_NOT_FOUND', '找不到指定通知。');

    const notification = normalizeMemberPointNotification_(match.object);
    if (notification.memberLineUserId !== context.identity.sub) {
      fail_('FORBIDDEN', '無法讀取其他會員的通知。');
    }
    if (notification.status === 'read') {
      return { notificationId: notificationId, duplicate: true };
    }
    if (notification.status !== 'unread') fail_('DATA_INTEGRITY_ERROR', '通知狀態異常。');

    const now = new Date().toISOString();
    notification.status = 'read';
    notification.readAt = now;
    notification.updatedAt = now;
    writeAdminPointGrantObjectRow_(
      POINTS_CARD_ADMIN_GRANTS.notificationsSheet,
      match.row,
      notification
    );
    return { notificationId: notificationId, duplicate: false };
  } finally {
    lock.releaseLock();
  }
}
