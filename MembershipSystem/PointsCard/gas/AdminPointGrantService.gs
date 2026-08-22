'use strict';

const POINTS_CARD_ADMIN_GRANTS = Object.freeze({
  grantsSheet: 'CardPointGrants',
  notificationsSheet: 'MemberPointNotifications',
  maxGrantPoints: 100,
  maxUnreadNotifications: 10,
  channelAccessTokenProperty: 'LINE_MESSAGING_CHANNEL_ACCESS_TOKEN'
});

const POINTS_CARD_ADMIN_GRANT_HEADERS = Object.freeze({
  CardPointGrants: [
    'grantId', 'requestId', 'cardId', 'memberLineUserId', 'memberNo', 'stampCount', 'reason',
    'status', 'totalBefore', 'totalAfter', 'grantedByLineUserId', 'pushStatus', 'pushErrorCode',
    'pushAttemptedAt', 'pushSentAt', 'createdAt', 'updatedAt', 'grantedAt', 'auditRecordedAt'
  ],
  MemberPointNotifications: [
    'notificationId', 'memberLineUserId', 'memberNo', 'cardId', 'cardName', 'type', 'title',
    'message', 'stampCount', 'totalAfter', 'relatedId', 'status', 'createdAt', 'readAt', 'updatedAt'
  ]
});

function ensureAdminPointGrantStorage_() {
  const spreadsheet = getSpreadsheet_();
  Object.keys(POINTS_CARD_ADMIN_GRANT_HEADERS).forEach(function (sheetName) {
    let sheet = spreadsheet.getSheetByName(sheetName);
    const expected = POINTS_CARD_ADMIN_GRANT_HEADERS[sheetName];
    if (!sheet) sheet = spreadsheet.insertSheet(sheetName);
    const lastColumn = sheet.getLastColumn();
    if (lastColumn === 0) {
      sheet.getRange(1, 1, 1, expected.length).setValues([expected]);
      sheet.setFrozenRows(1);
      return;
    }
    if (lastColumn !== expected.length) fail_('SCHEMA_MISMATCH', sheetName + ' 欄位數不正確。');
    const headers = sheet.getRange(1, 1, 1, expected.length).getValues()[0].map(String);
    expected.forEach(function (header, index) {
      if (headers[index] !== header) fail_('SCHEMA_MISMATCH', sheetName + ' 欄位順序不正確。');
    });
    sheet.setFrozenRows(1);
  });
}

function getAdminPointGrantSheet_(sheetName) {
  const headers = POINTS_CARD_ADMIN_GRANT_HEADERS[sheetName];
  if (!headers) fail_('SCHEMA_MISMATCH', '不支援的人工發點資料工作表。');
  const sheet = getSpreadsheet_().getSheetByName(sheetName);
  if (!sheet) fail_('SCHEMA_MISMATCH', '缺少人工發點資料工作表：' + sheetName + '。');
  return sheet;
}

function adminPointGrantRowToObject_(sheetName, row) {
  const object = {};
  POINTS_CARD_ADMIN_GRANT_HEADERS[sheetName].forEach(function (header, index) { object[header] = row[index]; });
  return object;
}

function adminPointGrantObjectToRow_(sheetName, object) {
  return POINTS_CARD_ADMIN_GRANT_HEADERS[sheetName].map(function (header) {
    const value = object[header] === undefined || object[header] === null ? '' : object[header];
    return typeof value === 'string' ? safeCellText_(value) : value;
  });
}

function readAdminPointGrantObjects_(sheetName) {
  const sheet = getAdminPointGrantSheet_(sheetName);
  const headers = POINTS_CARD_ADMIN_GRANT_HEADERS[sheetName];
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet.getRange(2, 1, lastRow - 1, headers.length).getValues().filter(function (row) {
    return row.some(function (value) { return value !== ''; });
  }).map(function (row) { return adminPointGrantRowToObject_(sheetName, row); });
}

function findAdminPointGrantByFieldWithRow_(sheetName, field, value) {
  const sheet = getAdminPointGrantSheet_(sheetName);
  const headers = POINTS_CARD_ADMIN_GRANT_HEADERS[sheetName];
  const columnIndex = headers.indexOf(field);
  if (columnIndex < 0) fail_('SCHEMA_MISMATCH', '缺少必要欄位。');
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  const match = sheet.getRange(2, columnIndex + 1, lastRow - 1, 1)
    .createTextFinder(String(value)).matchEntireCell(true).useRegularExpression(false).findNext();
  if (!match) return null;
  const rowNumber = match.getRow();
  const row = sheet.getRange(rowNumber, 1, 1, headers.length).getValues()[0];
  return { row: rowNumber, object: adminPointGrantRowToObject_(sheetName, row) };
}

function appendAdminPointGrantObject_(sheetName, object) {
  getAdminPointGrantSheet_(sheetName).appendRow(adminPointGrantObjectToRow_(sheetName, object));
}

function writeAdminPointGrantObjectRow_(sheetName, rowNumber, object) {
  const sheet = getAdminPointGrantSheet_(sheetName);
  const headers = POINTS_CARD_ADMIN_GRANT_HEADERS[sheetName];
  sheet.getRange(rowNumber, 1, 1, headers.length).setValues([adminPointGrantObjectToRow_(sheetName, object)]);
}

function normalizeAdminPointGrant_(value) {
  return {
    grantId: String(value.grantId || ''),
    requestId: String(value.requestId || ''),
    cardId: String(value.cardId || ''),
    memberLineUserId: String(value.memberLineUserId || ''),
    memberNo: String(value.memberNo || ''),
    stampCount: storedNonNegativeInt_(value.stampCount, POINTS_CARD_ADMIN_GRANTS.maxGrantPoints),
    reason: String(value.reason || ''),
    status: String(value.status || ''),
    totalBefore: storedNonNegativeInt_(value.totalBefore, 100000000),
    totalAfter: storedNonNegativeInt_(value.totalAfter, 100000000),
    grantedByLineUserId: String(value.grantedByLineUserId || ''),
    pushStatus: String(value.pushStatus || 'pending'),
    pushErrorCode: String(value.pushErrorCode || ''),
    pushAttemptedAt: String(value.pushAttemptedAt || ''),
    pushSentAt: String(value.pushSentAt || ''),
    createdAt: String(value.createdAt || ''),
    updatedAt: String(value.updatedAt || ''),
    grantedAt: String(value.grantedAt || ''),
    auditRecordedAt: String(value.auditRecordedAt || '')
  };
}

function normalizeMemberPointNotification_(value) {
  return {
    notificationId: String(value.notificationId || ''),
    memberLineUserId: String(value.memberLineUserId || ''),
    memberNo: String(value.memberNo || ''),
    cardId: String(value.cardId || ''),
    cardName: String(value.cardName || ''),
    type: String(value.type || ''),
    title: String(value.title || ''),
    message: String(value.message || ''),
    stampCount: storedNonNegativeInt_(value.stampCount, POINTS_CARD_ADMIN_GRANTS.maxGrantPoints),
    totalAfter: storedNonNegativeInt_(value.totalAfter, 100000000),
    relatedId: String(value.relatedId || ''),
    status: String(value.status || ''),
    createdAt: String(value.createdAt || ''),
    readAt: String(value.readAt || ''),
    updatedAt: String(value.updatedAt || '')
  };
}

function newAdminPointGrantId_() {
  return 'PG-' + Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyMMdd') + '-' + randomHex_(6).toUpperCase();
}

function pointGrantNotificationId_(grantId) {
  return 'PN-' + sha256Hex_(grantId).slice(0, 32).toUpperCase();
}

function pointGrantRetryKey_(grantId) {
  const value = sha256Hex_('point-grant|' + grantId);
  return value.slice(0, 8) + '-' + value.slice(8, 12) + '-4' + value.slice(13, 16) +
    '-a' + value.slice(17, 20) + '-' + value.slice(20, 32);
}

function pointGrantNotificationMessage_(cardName, stampCount, reason) {
  return '店家已在「' + cardName + '」發放 ' + stampCount + ' 點給你。\n原因：' + reason;
}

function ensurePointGrantNotification_(grant, cardName) {
  const notificationId = pointGrantNotificationId_(grant.grantId);
  const existing = findAdminPointGrantByFieldWithRow_(POINTS_CARD_ADMIN_GRANTS.notificationsSheet, 'notificationId', notificationId);
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

function recoverAdminPointGrant_(grantMatch) {
  const grant = normalizeAdminPointGrant_(grantMatch.object);
  if (grant.status === 'recorded') {
    const recordedCard = findMultiCard_(grant.cardId);
    ensurePointGrantNotification_(grant, recordedCard ? recordedCard.card.name : '集點卡');
    return grant;
  }
  if (grant.status !== 'processing') fail_('RECOVERY_REQUIRED', '人工發點紀錄狀態不正確，請聯絡管理員。');
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
  ensurePointGrantNotification_(grant, cardMatch.card.name);
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
    })) fail_('AUDIT_UNAVAILABLE', '發點已套用但稽核紀錄暫時無法完成；請使用相同請求再次嘗試。');
    grant.auditRecordedAt = now;
  }
  writeAdminPointGrantObjectRow_(POINTS_CARD_ADMIN_GRANTS.grantsSheet, grantMatch.row, grant);
  return grant;
}

function pointGrantPushMessage_(grant, cardName) {
  return '你已獲得「' + cardName + '」' + grant.stampCount + ' 點。\n原因：' + grant.reason +
    '\n目前累計：' + grant.totalAfter + ' 點。\n請開啟集點卡查看最新進度。';
}

function sendPointGrantPush_(channelAccessToken, lineUserId, retryKey, message) {
  try {
    const response = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
      method: 'post',
      contentType: 'application/json',
      headers: {
        Authorization: 'Bearer ' + channelAccessToken,
        'X-Line-Retry-Key': retryKey
      },
      payload: JSON.stringify({ to: lineUserId, messages: [{ type: 'text', text: message }] }),
      muteHttpExceptions: true
    });
    const responseCode = Number(response.getResponseCode());
    return {
      accepted: responseCode === 200 || responseCode === 409,
      retryable: responseCode === 429 || responseCode >= 500,
      errorCode: responseCode === 200 || responseCode === 409 ? '' : 'HTTP_' + responseCode
    };
  } catch (_) {
    return { accepted: false, retryable: true, errorCode: 'NETWORK_ERROR' };
  }
}

function attemptAdminPointGrantPush_(grantId) {
  ensureAdminPointGrantStorage_();
  const initial = findAdminPointGrantByFieldWithRow_(POINTS_CARD_ADMIN_GRANTS.grantsSheet, 'grantId', grantId);
  if (!initial) return { status: 'failed', errorCode: 'GRANT_NOT_FOUND' };
  const grant = normalizeAdminPointGrant_(initial.object);
  if (grant.pushStatus === 'sent') return { status: 'sent', errorCode: '' };
  const channelAccessToken = String(PropertiesService.getScriptProperties()
    .getProperty(POINTS_CARD_ADMIN_GRANTS.channelAccessTokenProperty) || '').trim();
  const cardMatch = findMultiCard_(grant.cardId);
  const cardName = cardMatch ? cardMatch.card.name : '集點卡';
  const now = new Date().toISOString();
  const push = channelAccessToken
    ? sendPointGrantPush_(channelAccessToken, grant.memberLineUserId, pointGrantRetryKey_(grant.grantId), pointGrantPushMessage_(grant, cardName))
    : { accepted: false, retryable: false, errorCode: 'NOT_CONFIGURED' };

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return { status: push.accepted ? 'sent' : 'retry', errorCode: 'PUSH_STATE_BUSY' };
  try {
    const currentMatch = findAdminPointGrantByFieldWithRow_(POINTS_CARD_ADMIN_GRANTS.grantsSheet, 'grantId', grantId);
    if (!currentMatch) return { status: 'failed', errorCode: 'GRANT_NOT_FOUND' };
    const current = normalizeAdminPointGrant_(currentMatch.object);
    if (current.pushStatus === 'sent') return { status: 'sent', errorCode: '' };
    current.pushStatus = push.accepted ? 'sent' : (push.errorCode === 'NOT_CONFIGURED' ? 'not-configured' : (push.retryable ? 'retry' : 'failed'));
    current.pushErrorCode = push.errorCode;
    current.pushAttemptedAt = now;
    current.pushSentAt = push.accepted ? now : current.pushSentAt;
    current.updatedAt = now;
    writeAdminPointGrantObjectRow_(POINTS_CARD_ADMIN_GRANTS.grantsSheet, currentMatch.row, current);
    audit_('system', 'system', 'CARD_POINTS_PUSH_NOTIFICATION', current.memberLineUserId, push.accepted ? 'success' : 'failed', {
      grantId: current.grantId,
      cardId: current.cardId,
      memberNo: current.memberNo,
      errorCode: push.errorCode || ''
    });
    return { status: current.pushStatus, errorCode: current.pushErrorCode };
  } finally {
    lock.releaseLock();
  }
}

function adminPointGrantMultiCard_(context, payload) {
  ensureMultiCardStorage_();
  ensureAdminPointGrantStorage_();
  const targetMemberNo = cleanText_(payload.targetMemberNo, 30, true);
  const cardId = validMultiCardId_(payload.cardId, true);
  const stampCount = strictInt_(payload.stampCount, 1, POINTS_CARD_ADMIN_GRANTS.maxGrantPoints, 'INVALID_STAMP_COUNT', '人工發點必須是 1 到 100 的整數。');
  const reason = cleanText_(payload.reason, 200, true);
  const requestId = cleanText_(payload.requestId, 64, true).toLowerCase();
  if (!/^[a-f0-9]{32,64}$/.test(requestId)) fail_('INVALID_REQUEST_ID', '發點請求識別碼格式不正確。');

  let result;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(8000)) fail_('BUSY', '發點服務忙碌中，請稍後再試。');
  try {
    const memberMatch = findByFieldWithRow_(getSheet_(POINTS_CARD_SHEETS.members), 'memberNo', targetMemberNo);
    if (!memberMatch) fail_('MEMBER_NOT_FOUND', '找不到指定會員。');
    const member = normalizeMember_(memberMatch.object);
    if (member.membershipStatus !== 'active') fail_('MEMBER_INACTIVE', '只能對有效會員發放點數。');
    const cardMatch = findMultiCard_(cardId);
    if (!cardMatch) fail_('CARD_NOT_FOUND', '找不到指定集點卡。');
    if (!cardMatch.card.available) fail_('CARD_UNAVAILABLE', '只能對目前有效的集點卡發放點數。');

    const existing = findAdminPointGrantByFieldWithRow_(POINTS_CARD_ADMIN_GRANTS.grantsSheet, 'requestId', requestId);
    if (existing) {
      const existingGrant = normalizeAdminPointGrant_(existing.object);
      if (existingGrant.memberLineUserId !== member.lineUserId || existingGrant.memberNo !== member.memberNo ||
        existingGrant.cardId !== cardId || existingGrant.stampCount !== stampCount || existingGrant.reason !== reason) {
        fail_('REQUEST_CONFLICT', '此請求識別碼已用於其他人工發點操作。');
      }
      const recovered = recoverAdminPointGrant_(existing);
      const refreshed = normalizeMember_(findByFieldWithRow_(getSheet_(POINTS_CARD_SHEETS.members), 'lineUserId', member.lineUserId).object);
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
      if (totalBefore > 100000000 - stampCount) fail_('STAMP_LIMIT_REACHED', '此會員在這張卡的累計集點已達系統上限。');
      const totalAfter = totalBefore + stampCount;
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
      })) fail_('AUDIT_UNAVAILABLE', '稽核紀錄暫時無法寫入，點數尚未發放。');
      appendAdminPointGrantObject_(POINTS_CARD_ADMIN_GRANTS.grantsSheet, grant);

      progress.totalStamps = totalAfter;
      progress.updatedAt = now;
      writeMultiCardObjectRow_(getMultiCardSheet_(MULTI_CARD_SHEETS.progress), progressMatch.row, progress);

      grant.status = 'recorded';
      grant.grantedAt = now;
      grant.updatedAt = now;
      ensurePointGrantNotification_(grant, cardMatch.card.name);
      if (!audit_(context.identity.sub, 'admin', 'CARD_POINTS_GRANTED', member.lineUserId, 'success', {
        grantId: grant.grantId,
        requestId: requestId,
        cardId: cardId,
        memberNo: member.memberNo,
        stampCount: stampCount,
        totalBefore: totalBefore,
        totalAfter: totalAfter,
        reason: reason
      })) fail_('AUDIT_UNAVAILABLE', '點數已套用但稽核紀錄暫時無法完成；請使用相同請求再次嘗試。');
      grant.auditRecordedAt = now;
      const grantMatch = findAdminPointGrantByFieldWithRow_(POINTS_CARD_ADMIN_GRANTS.grantsSheet, 'requestId', requestId);
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

  const push = attemptAdminPointGrantPush_(result.grantId);
  result.pushStatus = push.status;
  result.pushErrorCode = push.errorCode;
  return result;
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
  const memberMatch = findByFieldWithRow_(getSheet_(POINTS_CARD_SHEETS.members), 'lineUserId', context.identity.sub);
  if (!memberMatch) fail_('MEMBER_NOT_FOUND', '請先開啟集點卡完成會員建立。');
  const limit = clampInt_(payload && payload.limit, 1, POINTS_CARD_ADMIN_GRANTS.maxUnreadNotifications, POINTS_CARD_ADMIN_GRANTS.maxUnreadNotifications);
  const notifications = readAdminPointGrantObjects_(POINTS_CARD_ADMIN_GRANTS.notificationsSheet)
    .map(normalizeMemberPointNotification_)
    .filter(function (notification) {
      return notification.memberLineUserId === context.identity.sub && notification.type === 'point-grant' && notification.status === 'unread';
    })
    .sort(function (a, b) { return String(a.createdAt).localeCompare(String(b.createdAt)); })
    .slice(0, limit)
    .map(publicMemberPointNotification_);
  return { notifications: notifications };
}

function memberPointNotificationRead_(context, payload) {
  ensureAdminPointGrantStorage_();
  const notificationId = cleanText_(payload.notificationId, 40, true).toUpperCase();
  if (!/^PN-[A-F0-9]{32}$/.test(notificationId)) fail_('INVALID_NOTIFICATION_ID', '通知識別碼格式不正確。');
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) fail_('BUSY', '通知服務忙碌中，請稍後再試。');
  try {
    const match = findAdminPointGrantByFieldWithRow_(POINTS_CARD_ADMIN_GRANTS.notificationsSheet, 'notificationId', notificationId);
    if (!match) fail_('NOTIFICATION_NOT_FOUND', '找不到指定通知。');
    const notification = normalizeMemberPointNotification_(match.object);
    if (notification.memberLineUserId !== context.identity.sub) fail_('FORBIDDEN', '無法讀取其他會員的通知。');
    if (notification.status === 'read') return { notificationId: notificationId, duplicate: true };
    if (notification.status !== 'unread') fail_('DATA_INTEGRITY_ERROR', '通知狀態異常。');
    const now = new Date().toISOString();
    notification.status = 'read';
    notification.readAt = now;
    notification.updatedAt = now;
    writeAdminPointGrantObjectRow_(POINTS_CARD_ADMIN_GRANTS.notificationsSheet, match.row, notification);
    return { notificationId: notificationId, duplicate: false };
  } finally {
    lock.releaseLock();
  }
}
