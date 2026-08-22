'use strict';

const POINTS_CARD_TICKET_REMINDERS = Object.freeze({
  channelAccessTokenProperty: 'LINE_MESSAGING_CHANNEL_ACCESS_TOKEN',
  handlerFunction: 'runPointsCardTicketReminderSweep',
  maxPushesPerRun: 50,
  maxEntitlementsPerRun: 2000,
  maxAttempts: 3,
  retryWindowMs: 23 * 60 * 60 * 1000,
  retryDelayMs: 15 * 60 * 1000
});

function multiCardRewardEarnedAt_(reward, progress, member, stampRecords) {
  const absoluteStamps = Number(reward && reward.absoluteStamps || 0);
  const matches = (stampRecords || []).filter(function (record) {
    if (record.status !== 'recorded' && record.status !== 'processing') return false;
    return Number(record.totalBefore || 0) < absoluteStamps && Number(record.totalAfter || 0) >= absoluteStamps;
  }).map(function (record) {
    return String(record.recordedAt || record.createdAt || record.updatedAt || '');
  }).filter(function (value) {
    return Number.isFinite(new Date(value).getTime());
  }).sort();
  if (matches.length) return matches[0];
  const fallback = String(progress && progress.createdAt || member && member.joinedAt ||
    progress && progress.updatedAt || new Date().toISOString());
  return Number.isFinite(new Date(fallback).getTime()) ? new Date(fallback).toISOString() : new Date().toISOString();
}

function multiCardRewardTicketState_(reward, progress, member, stampRecords, nowMs) {
  const earnedAt = multiCardRewardEarnedAt_(reward, progress, member, stampRecords);
  const earnedTime = new Date(earnedAt).getTime();
  const validityDays = Number(reward && reward.ticketValidityDays || 0);
  const reminderDays = Number(reward && reward.unusedReminderDays || 0);
  const expiresAt = validityDays > 0 ? new Date(earnedTime + validityDays * 86400000).toISOString() : '';
  const reminderAt = reminderDays > 0 ? new Date(earnedTime + reminderDays * 86400000).toISOString() : '';
  const expired = Boolean(expiresAt && new Date(expiresAt).getTime() <= Number(nowMs == null ? Date.now() : nowMs));
  return Object.assign({}, reward, {
    earnedAt: earnedAt,
    expiresAt: expiresAt,
    reminderAt: reminderAt,
    expired: expired,
    usable: !expired
  });
}

function multiCardStampRecordsForMemberCard_(lineUserId, cardId, preferSelectiveRead) {
  const sheet = getMultiCardSheet_(MULTI_CARD_SHEETS.stampRecords);
  const rows = preferSelectiveRead
    ? readMultiCardObjectsByField_(sheet, 'memberLineUserId', lineUserId)
    : readMultiCardObjects_(sheet);
  return rows.filter(function (record) {
    return String(record.memberLineUserId || '') === String(lineUserId || '') &&
      String(record.cardId || '') === String(cardId || '');
  }).map(normalizeCardStampRecord_);
}

function normalizeMultiCardRewardNotification_(value) {
  return {
    notificationId: String(value.notificationId || ''),
    cardId: String(value.cardId || ''),
    memberLineUserId: String(value.memberLineUserId || ''),
    memberNo: String(value.memberNo || ''),
    rewardOrdinal: storedNonNegativeInt_(value.rewardOrdinal, 100000000),
    reminderAt: String(value.reminderAt || ''),
    retryKey: String(value.retryKey || ''),
    status: String(value.status || ''),
    attemptCount: storedNonNegativeInt_(value.attemptCount, POINTS_CARD_TICKET_REMINDERS.maxAttempts),
    sentAt: String(value.sentAt || ''),
    lastAttemptAt: String(value.lastAttemptAt || ''),
    lastErrorCode: String(value.lastErrorCode || ''),
    createdAt: String(value.createdAt || ''),
    updatedAt: String(value.updatedAt || '')
  };
}

function ticketReminderNotificationId_(cardId, lineUserId, rewardOrdinal) {
  return 'RN-' + sha256Hex_([cardId, lineUserId, rewardOrdinal].join('|')).slice(0, 32).toUpperCase();
}

function ticketReminderRetryKey_(notificationId) {
  const value = sha256Hex_(notificationId);
  return value.slice(0, 8) + '-' + value.slice(8, 12) + '-4' + value.slice(13, 16) +
    '-a' + value.slice(17, 20) + '-' + value.slice(20, 32);
}

function ticketReminderMessage_(card, reward) {
  const typeLabel = reward.rewardType === 'lottery' ? '抽獎券' : '優惠券';
  const expiryLabel = reward.expiresAt
    ? Utilities.formatDate(new Date(reward.expiresAt), 'Asia/Taipei', 'yyyy/MM/dd HH:mm')
    : '無期限';
  return '提醒你，「' + card.name + '」的' + typeLabel + '「' + reward.rewardName +
    '」尚未使用。\n使用期限：' + expiryLabel + '\n請回到集點卡查看票券。';
}

function sendTicketReminderPush_(channelAccessToken, lineUserId, retryKey, message) {
  try {
    const response = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
      method: 'post',
      contentType: 'application/json',
      headers: {
        Authorization: 'Bearer ' + channelAccessToken,
        'X-Line-Retry-Key': retryKey
      },
      payload: JSON.stringify({
        to: lineUserId,
        messages: [{ type: 'text', text: message }]
      }),
      muteHttpExceptions: true
    });
    const responseCode = Number(response.getResponseCode());
    return {
      accepted: responseCode === 200 || responseCode === 409,
      retryable: responseCode === 429 || responseCode >= 500,
      errorCode: responseCode === 200 || responseCode === 409 ? '' : 'HTTP_' + responseCode
    };
  } catch (error) {
    return { accepted: false, retryable: true, errorCode: 'NETWORK_ERROR' };
  }
}

function shouldAttemptTicketReminder_(notification, nowMs) {
  if (!notification) return true;
  if (notification.status === 'sent' || notification.status === 'failed') return false;
  if (notification.attemptCount >= POINTS_CARD_TICKET_REMINDERS.maxAttempts) return false;
  const lastAttemptTime = new Date(notification.lastAttemptAt || notification.updatedAt || 0).getTime();
  if (!Number.isFinite(lastAttemptTime)) return true;
  const age = nowMs - lastAttemptTime;
  if (age > POINTS_CARD_TICKET_REMINDERS.retryWindowMs) return false;
  return age >= POINTS_CARD_TICKET_REMINDERS.retryDelayMs;
}

function runPointsCardTicketReminderSweep() {
  ensureMultiCardStorage_();
  const channelAccessToken = String(PropertiesService.getScriptProperties()
    .getProperty(POINTS_CARD_TICKET_REMINDERS.channelAccessTokenProperty) || '').trim();
  if (!channelAccessToken) {
    return { configured: false, scannedEntitlements: 0, attempted: 0, sent: 0, retryable: 0, failed: 0 };
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { configured: true, busy: true, scannedEntitlements: 0, attempted: 0, sent: 0, retryable: 0, failed: 0 };
  try {
    const nowMs = Date.now();
    const now = new Date(nowMs).toISOString();
    const cardsById = {};
    allMultiCards_().forEach(function (card) { cardsById[card.cardId] = card; });
    const membersByLineUserId = {};
    readObjects_(getSheet_(POINTS_CARD_SHEETS.members)).map(normalizeMember_).forEach(function (member) {
      membersByLineUserId[member.lineUserId] = member;
    });
    const claimed = {};
    readMultiCardObjects_(getMultiCardSheet_(MULTI_CARD_SHEETS.rewardRecords)).forEach(function (record) {
      if (record.status !== 'recorded' && record.status !== 'processing') return;
      claimed[String(record.cardId || '') + '|' + String(record.memberLineUserId || '') + '|' + String(record.rewardOrdinal || '')] = true;
    });
    const stampRecords = {};
    readMultiCardObjects_(getMultiCardSheet_(MULTI_CARD_SHEETS.stampRecords)).map(normalizeCardStampRecord_).forEach(function (record) {
      const key = record.cardId + '|' + record.memberLineUserId;
      if (!stampRecords[key]) stampRecords[key] = [];
      stampRecords[key].push(record);
    });
    const notificationSheet = getMultiCardSheet_(MULTI_CARD_SHEETS.notifications);
    const notifications = {};
    readMultiCardObjects_(notificationSheet).forEach(function (row) {
      const notification = normalizeMultiCardRewardNotification_(row);
      notifications[notification.notificationId] = notification;
    });

    const result = { configured: true, scannedEntitlements: 0, attempted: 0, sent: 0, retryable: 0, failed: 0 };
    const progressRows = readMultiCardObjects_(getMultiCardSheet_(MULTI_CARD_SHEETS.progress)).map(normalizeMemberCardProgress_);
    for (let progressIndex = 0; progressIndex < progressRows.length &&
      result.scannedEntitlements < POINTS_CARD_TICKET_REMINDERS.maxEntitlementsPerRun &&
      result.attempted < POINTS_CARD_TICKET_REMINDERS.maxPushesPerRun; progressIndex += 1) {
      const progress = progressRows[progressIndex];
      const card = cardsById[progress.cardId];
      const member = membersByLineUserId[progress.memberLineUserId];
      if (!card || !member || member.membershipStatus !== 'active') continue;
      const settings = multiCardSettingsForProjection_(card);
      const earnedRewards = earnedRewardCountForStamps_(progress.totalStamps, settings);
      const memberStampRecords = stampRecords[card.cardId + '|' + member.lineUserId] || [];
      for (let ordinal = 1; ordinal <= earnedRewards &&
        result.scannedEntitlements < POINTS_CARD_TICKET_REMINDERS.maxEntitlementsPerRun &&
        result.attempted < POINTS_CARD_TICKET_REMINDERS.maxPushesPerRun; ordinal += 1) {
        result.scannedEntitlements += 1;
        if (claimed[card.cardId + '|' + member.lineUserId + '|' + ordinal]) continue;
        const reward = rewardEntitlementByOrdinal_(ordinal, settings);
        if (!reward.unusedReminderDays) continue;
        const ticket = multiCardRewardTicketState_(reward, progress, member, memberStampRecords, nowMs);
        if (ticket.expired || !ticket.reminderAt || new Date(ticket.reminderAt).getTime() > nowMs) continue;
        const notificationId = ticketReminderNotificationId_(card.cardId, member.lineUserId, ordinal);
        let notification = notifications[notificationId] || null;
        if (!shouldAttemptTicketReminder_(notification, nowMs)) continue;
        const retryKey = notification ? notification.retryKey : ticketReminderRetryKey_(notificationId);
        if (!notification) {
          notification = {
            notificationId: notificationId,
            cardId: card.cardId,
            memberLineUserId: member.lineUserId,
            memberNo: member.memberNo,
            rewardOrdinal: ordinal,
            reminderAt: ticket.reminderAt,
            retryKey: retryKey,
            status: 'processing',
            attemptCount: 0,
            sentAt: '',
            lastAttemptAt: '',
            lastErrorCode: '',
            createdAt: now,
            updatedAt: now
          };
          appendMultiCardObject_(notificationSheet, notification);
        }
        notification.attemptCount += 1;
        notification.status = 'processing';
        notification.lastAttemptAt = now;
        notification.updatedAt = now;
        const matchBeforePush = findMultiCardByFieldWithRow_(notificationSheet, 'notificationId', notificationId);
        if (!matchBeforePush) continue;
        writeMultiCardObjectRow_(notificationSheet, matchBeforePush.row, notification);

        result.attempted += 1;
        const push = sendTicketReminderPush_(channelAccessToken, member.lineUserId, retryKey, ticketReminderMessage_(card, ticket));
        notification.status = push.accepted ? 'sent' : (push.retryable ? 'retry' : 'failed');
        notification.sentAt = push.accepted ? now : '';
        notification.lastErrorCode = push.errorCode;
        notification.updatedAt = now;
        const matchAfterPush = findMultiCardByFieldWithRow_(notificationSheet, 'notificationId', notificationId);
        if (matchAfterPush) writeMultiCardObjectRow_(notificationSheet, matchAfterPush.row, notification);
        notifications[notificationId] = notification;
        if (push.accepted) result.sent += 1;
        else if (push.retryable) result.retryable += 1;
        else result.failed += 1;
        audit_('system', 'system', 'TICKET_UNUSED_REMINDER', '', push.accepted ? 'success' : 'failed', {
          notificationId: notificationId,
          cardId: card.cardId,
          rewardOrdinal: ordinal,
          errorCode: push.errorCode || ''
        });
      }
    }
    return result;
  } finally {
    lock.releaseLock();
  }
}

function installPointsCardTicketReminderTrigger() {
  const existing = ScriptApp.getProjectTriggers().filter(function (trigger) {
    return trigger.getHandlerFunction() === POINTS_CARD_TICKET_REMINDERS.handlerFunction;
  });
  if (existing.length) return { installed: false, existing: existing.length };
  ScriptApp.newTrigger(POINTS_CARD_TICKET_REMINDERS.handlerFunction).timeBased().everyHours(1).create();
  return { installed: true, existing: 0 };
}
