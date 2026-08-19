'use strict';

function adminRewardConfirmationList_(limit) {
  const maxRows = clampInt_(limit, 1, 100, 50);
  const recordCounts = readObjects_(getSheet_(POINTS_CARD_SHEETS.rewardRecords)).reduce(function (counts, record) {
    if (record.confirmationId && record.status === 'recorded') {
      counts[record.confirmationId] = (counts[record.confirmationId] || 0) + 1;
    }
    return counts;
  }, {});
  return readObjects_(getSheet_(POINTS_CARD_SHEETS.rewardConfirmations)).map(normalizeRewardConfirmation_)
    .sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); })
    .slice(0, maxRows)
    .map(function (confirmation) {
      return publicRewardConfirmation_(confirmation, recordCounts[confirmation.confirmationId] || 0, false);
    });
}

function adminRewardConfirmationCreate_(context, payload) {
  const expiresAt = validIsoFuture_(payload.expiresAt);
  const note = cleanText_(payload.note || '門市票券確認', 200, false);
  const sheet = getSheet_(POINTS_CARD_SHEETS.rewardConfirmations);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) fail_('BUSY', '系統忙碌中，請稍後再試。');
  try {
    let shareCode = '';
    for (let attempt = 0; attempt < 8; attempt += 1) {
      shareCode = randomHex_(32);
      if (!findByFieldWithRow_(sheet, 'shareCode', shareCode)) break;
      shareCode = '';
    }
    if (!shareCode) fail_('INTERNAL_ERROR', '無法產生票券確認 QR Code。');
    const now = new Date().toISOString();
    const confirmation = {
      confirmationId: 'RC-' + Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyMMdd') + '-' + randomHex_(4).toUpperCase(),
      shareCode: shareCode,
      status: 'active',
      expiresAt: expiresAt,
      note: note,
      createdByLineUserId: context.identity.sub,
      createdAt: now,
      updatedAt: now,
      cancelledByLineUserId: '',
      cancelledAt: ''
    };
    if (!audit_(context.identity.sub, 'admin', 'REWARD_CONFIRM_QR_CREATE_REQUESTED', '', 'pending', {
      confirmationId: confirmation.confirmationId, expiresAt: expiresAt
    })) fail_('AUDIT_UNAVAILABLE', '稽核紀錄暫時無法寫入，票券確認 QR Code 尚未建立。');
    appendObject_(sheet, confirmation);
    audit_(context.identity.sub, 'admin', 'REWARD_CONFIRM_QR_CREATED', '', 'success', {
      confirmationId: confirmation.confirmationId, expiresAt: expiresAt
    });
    return { confirmation: publicRewardConfirmation_(confirmation, 0, true) };
  } finally { lock.releaseLock(); }
}

function adminRewardConfirmationOpen_(payload) {
  const confirmationId = cleanText_(payload.confirmationId, 40, true);
  const match = findByFieldWithRow_(getSheet_(POINTS_CARD_SHEETS.rewardConfirmations), 'confirmationId', confirmationId);
  if (!match) fail_('REWARD_CONFIRMATION_NOT_FOUND', '找不到指定的票券確認 QR Code。');
  const confirmation = normalizeRewardConfirmation_(match.object);
  if (confirmation.status !== 'active') fail_('REWARD_CONFIRMATION_INACTIVE', '已停止的票券確認 QR Code 不再提供連結。');
  return { confirmation: publicRewardConfirmation_(confirmation, countRewardConfirmationRecords_(confirmationId), true) };
}

function adminRewardConfirmationCancel_(context, payload) {
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
    if (confirmation.status !== 'active') fail_('REWARD_CONFIRMATION_INACTIVE', '這組票券確認 QR Code 已停止使用。');
    const now = new Date().toISOString();
    confirmation.status = 'cancelled';
    confirmation.updatedAt = now;
    confirmation.cancelledByLineUserId = context.identity.sub;
    confirmation.cancelledAt = now;
    if (!audit_(context.identity.sub, 'admin', 'REWARD_CONFIRM_QR_CANCEL_REQUESTED', '', 'pending', {
      confirmationId: confirmationId
    })) fail_('AUDIT_UNAVAILABLE', '稽核紀錄暫時無法寫入，票券確認 QR Code 未停止。');
    writeObjectRow_(sheet, match.row, confirmation);
    audit_(context.identity.sub, 'admin', 'REWARD_CONFIRM_QR_CANCELLED', '', 'success', { confirmationId: confirmationId });
    return { confirmation: publicRewardConfirmation_(confirmation, countRewardConfirmationRecords_(confirmationId), false) };
  } finally { lock.releaseLock(); }
}

function adminRewardConfirmationDelete_(context, payload) {
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
    if (hasRewardConfirmationRecords_(confirmationId)) {
      fail_('REWARD_CONFIRMATION_HAS_RECORDS', '已有票券領取紀錄的 QR Code 只能停止，不能刪除。');
    }
    if (!audit_(context.identity.sub, 'admin', 'REWARD_CONFIRM_QR_DELETE_REQUESTED', '', 'pending', {
      confirmationId: confirmationId
    })) fail_('AUDIT_UNAVAILABLE', '稽核紀錄暫時無法寫入，票券確認 QR Code 未刪除。');
    sheet.deleteRow(match.row);
    audit_(context.identity.sub, 'admin', 'REWARD_CONFIRM_QR_DELETED', '', 'success', { confirmationId: confirmationId });
    return { confirmationId: confirmationId };
  } finally { lock.releaseLock(); }
}

function normalizeRewardConfirmation_(value) {
  return {
    confirmationId: String(value.confirmationId || ''),
    shareCode: String(value.shareCode || ''),
    status: String(value.status || 'cancelled'),
    expiresAt: String(value.expiresAt || ''),
    note: String(value.note || ''),
    createdByLineUserId: String(value.createdByLineUserId || ''),
    createdAt: String(value.createdAt || ''),
    updatedAt: String(value.updatedAt || ''),
    cancelledByLineUserId: String(value.cancelledByLineUserId || ''),
    cancelledAt: String(value.cancelledAt || '')
  };
}

function publicRewardConfirmation_(confirmation, recordCount, includeShareCode) {
  const result = {
    confirmationId: confirmation.confirmationId,
    status: confirmation.status,
    expiresAt: confirmation.expiresAt,
    note: confirmation.note,
    createdAt: confirmation.createdAt,
    updatedAt: confirmation.updatedAt,
    recordCount: Number(recordCount || 0)
  };
  if (includeShareCode) result.shareCode = confirmation.shareCode;
  return result;
}

function countRewardConfirmationRecords_(confirmationId) {
  return readObjects_(getSheet_(POINTS_CARD_SHEETS.rewardRecords)).filter(function (record) {
    return record.confirmationId === confirmationId && record.status === 'recorded';
  }).length;
}

function hasRewardConfirmationRecords_(confirmationId) {
  return readObjects_(getSheet_(POINTS_CARD_SHEETS.rewardRecords)).some(function (record) {
    return record.confirmationId === confirmationId;
  });
}

function validateRewardConfirmationForClaim_(confirmation) {
  if (confirmation.status !== 'active') fail_('REWARD_CONFIRMATION_INACTIVE', '這組店家確認 QR Code 已停止使用。');
  if (!confirmation.expiresAt || new Date(confirmation.expiresAt).getTime() <= Date.now()) {
    fail_('REWARD_CONFIRMATION_EXPIRED', '這組店家確認 QR Code 已過期。');
  }
}
