'use strict';

const POINTS_CARD_TICKET_REMINDERS = Object.freeze({
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
  return lineMessagingRetryKey_(notificationId);
}

function ticketReminderMessage_(card, reward) {
  const typeLabel = reward.rewardType === 'lottery' ? '抽獎券' : '優惠券';
  const expiryLabel = reward.expiresAt
    ? Utilities.formatDate(new Date(reward.expiresAt), 'Asia/Taipei', 'yyyy/MM/dd HH:mm')
    : '無期限';
  return '提醒你，「' + card.name + '」的' + typeLabel + '「' + reward.rewardName +
    '」尚未使用。\n使用期限：' + expiryLabel + '\n請回到集點卡查看票券。';
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

function ticketReminderRewardClaimedFresh_(cardId, lineUserId, rewardOrdinal) {
  const sheet = getMultiCardSheet_(MULTI_CARD_SHEETS.rewardRecords);
  const headers = MULTI_CARD_HEADERS[MULTI_CARD_SHEETS.rewardRecords];
  const memberColumnIndex = headers.indexOf('memberLineUserId');
  const lastRow = sheet.getLastRow();
  if (memberColumnIndex < 0 || lastRow < 2) return false;
  const matches = sheet.getRange(2, memberColumnIndex + 1, lastRow - 1, 1)
    .createTextFinder(String(lineUserId || '')).matchEntireCell(true).useRegularExpression(false).findAll();
  return matches.some(function (match) {
    const row = sheet.getRange(match.getRow(), 1, 1, headers.length).getValues()[0];
    const record = multiCardRowToObject_(headers, row);
    return String(record.cardId || '') === String(cardId || '') &&
      Number(record.rewardOrdinal || 0) === Number(rewardOrdinal || 0) &&
      (record.status === 'recorded' || record.status === 'processing');
  });
}

function claimTicketReminderAttempt_(notificationSheet, candidate, nowMs) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return null;
  try {
    const memberMatch = findByFieldWithRow_(
      getSheet_(POINTS_CARD_SHEETS.members),
      'lineUserId',
      candidate.memberLineUserId
    );
    if (!memberMatch || normalizeMember_(memberMatch.object).membershipStatus !== 'active') return null;
    if (ticketReminderRewardClaimedFresh_(candidate.cardId, candidate.memberLineUserId, candidate.rewardOrdinal)) {
      return null;
    }

    const attemptTimeMs = Number(nowMs == null ? Date.now() : nowMs);
    const attemptAt = new Date(attemptTimeMs).toISOString();
    let match = findMultiCardByFieldWithRow_(notificationSheet, 'notificationId', candidate.notificationId);
    let notification = match ? normalizeMultiCardRewardNotification_(match.object) : null;
    if (!shouldAttemptTicketReminder_(notification, attemptTimeMs)) return null;

    if (!notification) {
      notification = {
        notificationId: candidate.notificationId,
        cardId: candidate.cardId,
        memberLineUserId: candidate.memberLineUserId,
        memberNo: candidate.memberNo,
        rewardOrdinal: candidate.rewardOrdinal,
        reminderAt: candidate.reminderAt,
        retryKey: candidate.retryKey,
        status: 'processing',
        attemptCount: 0,
        sentAt: '',
        lastAttemptAt: '',
        lastErrorCode: '',
        createdAt: attemptAt,
        updatedAt: attemptAt
      };
      appendMultiCardObject_(notificationSheet, notification);
      match = findMultiCardByFieldWithRow_(notificationSheet, 'notificationId', candidate.notificationId);
      if (!match) return null;
    }

    notification.retryKey = notification.retryKey || candidate.retryKey;
    notification.attemptCount += 1;
    notification.status = 'processing';
    notification.lastAttemptAt = attemptAt;
    notification.updatedAt = attemptAt;
    writeMultiCardObjectRow_(notificationSheet, match.row, notification);
    return {
      notification: normalizeMultiCardRewardNotification_(notification),
      attemptAt: attemptAt
    };
  } finally {
    lock.releaseLock();
  }
}

function finalizeTicketReminderAttempt_(notificationSheet, notificationId, attemptAt, push, completedAt) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return false;
  try {
    const match = findMultiCardByFieldWithRow_(notificationSheet, 'notificationId', notificationId);
    if (!match) return false;
    const notification = normalizeMultiCardRewardNotification_(match.object);
    if (notification.status !== 'processing' || notification.lastAttemptAt !== attemptAt) return false;

    notification.status = push.accepted ? 'sent' : (push.retryable ? 'retry' : 'failed');
    notification.sentAt = push.accepted ? completedAt : '';
    notification.lastErrorCode = push.errorCode || '';
    notification.updatedAt = completedAt;
    writeMultiCardObjectRow_(notificationSheet, match.row, notification);
    return true;
  } finally {
    lock.releaseLock();
  }
}

function runPointsCardTicketReminderSweep() {
  ensureMultiCardStorage_();
  const lineMessaging = createLineMessagingClient_();
  if (!lineMessaging.configured) {
    return { configured: false, scannedEntitlements: 0, attempted: 0, sent: 0, retryable: 0, failed: 0 };
  }

  const nowMs = Date.now();
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
      const retryKey = ticketReminderRetryKey_(notificationId);
      const claim = claimTicketReminderAttempt_(notificationSheet, {
        notificationId: notificationId,
        cardId: card.cardId,
        memberLineUserId: member.lineUserId,
        memberNo: member.memberNo,
        rewardOrdinal: ordinal,
        reminderAt: ticket.reminderAt,
        retryKey: retryKey
      }, nowMs);
      if (!claim) continue;

      result.attempted += 1;
      const push = lineMessaging.sendTextPush(member.lineUserId, claim.notification.retryKey, ticketReminderMessage_(card, ticket));
      const completedAt = new Date().toISOString();
      finalizeTicketReminderAttempt_(notificationSheet, notificationId, claim.attemptAt, push, completedAt);

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
}

function installPointsCardTicketReminderTrigger() {
  const existing = ScriptApp.getProjectTriggers().filter(function (trigger) {
    return trigger.getHandlerFunction() === POINTS_CARD_TICKET_REMINDERS.handlerFunction;
  });
  if (existing.length) return { installed: false, existing: existing.length };
  ScriptApp.newTrigger(POINTS_CARD_TICKET_REMINDERS.handlerFunction).timeBased().everyHours(1).create();
  return { installed: true, existing: 0 };
}
