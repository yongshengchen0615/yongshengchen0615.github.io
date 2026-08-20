'use strict';

const POINTS_CARD_CARD_PROPERTIES = Object.freeze({
  status: 'POINTS_CARD_CARD_STATUS',
  expiresAt: 'POINTS_CARD_CARD_EXPIRES_AT',
  updatedAt: 'POINTS_CARD_CARD_UPDATED_AT'
});

function readPointsCardLifecycle_() {
  const properties = PropertiesService.getScriptProperties();
  const rawStatus = String(properties.getProperty(POINTS_CARD_CARD_PROPERTIES.status) || '').trim();
  const storedStatus = rawStatus === 'deleted' ? 'deleted' : 'active';
  const expiresAt = String(properties.getProperty(POINTS_CARD_CARD_PROPERTIES.expiresAt) || '').trim();
  const updatedAt = String(properties.getProperty(POINTS_CARD_CARD_PROPERTIES.updatedAt) || 'legacy').trim() || 'legacy';
  let status = storedStatus;

  if (storedStatus === 'active' && expiresAt) {
    const expiresTime = new Date(expiresAt).getTime();
    if (!Number.isFinite(expiresTime) || expiresTime <= Date.now()) status = 'expired';
  }

  return {
    status: status,
    storedStatus: storedStatus,
    available: status === 'active',
    expiresAt: expiresAt,
    updatedAt: updatedAt
  };
}

function publicPointsCardLifecycle_() {
  const card = readPointsCardLifecycle_();
  return {
    status: card.status,
    available: card.available,
    expiresAt: card.expiresAt,
    updatedAt: card.updatedAt
  };
}

function validPointsCardExpiry_(value) {
  const text = cleanText_(value || '', 40, false);
  if (!text) return '';
  const time = new Date(text).getTime();
  if (!Number.isFinite(time) || time <= Date.now()) {
    fail_('INVALID_CARD_EXPIRY', '集點卡到期時間必須晚於現在。');
  }
  return new Date(time).toISOString();
}

function assertPointsCardAvailable_(message) {
  if (!readPointsCardLifecycle_().available) {
    fail_('CARD_UNAVAILABLE', message || '目前沒有可用集點卡。');
  }
}

function cancelActiveStampVouchersForCardLifecycle_(actorLineUserId, now) {
  const sheet = getSheet_(POINTS_CARD_SHEETS.vouchers);
  const headers = POINTS_CARD_HEADERS[POINTS_CARD_SHEETS.vouchers];
  const statusColumn = headers.indexOf('status') + 1;
  const cancelledByColumn = headers.indexOf('cancelledByLineUserId') + 1;
  const cancelledAtColumn = headers.indexOf('cancelledAt') + 1;
  const updatedAtColumn = headers.indexOf('updatedAt') + 1;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;

  const statusValues = sheet.getRange(2, statusColumn, lastRow - 1, 1).getValues();
  const activeRows = [];
  statusValues.forEach(function (row, index) {
    if (String(row[0] || '') === 'active') activeRows.push(index + 2);
  });
  if (!activeRows.length) return 0;

  function rangesForColumn_(column) {
    return activeRows.map(function (row) {
      return sheet.getRange(row, column).getA1Notation();
    });
  }

  sheet.getRangeList(rangesForColumn_(statusColumn)).setValue('cancelled');
  sheet.getRangeList(rangesForColumn_(cancelledByColumn)).setValue(actorLineUserId);
  sheet.getRangeList(rangesForColumn_(cancelledAtColumn)).setValue(now);
  sheet.getRangeList(rangesForColumn_(updatedAtColumn)).setValue(now);
  invalidateSheetObjects_(sheet);
  return activeRows.length;
}

function adminCardUpdate_(context, payload) {
  const expectedUpdatedAt = cleanText_(payload.expectedUpdatedAt || 'legacy', 64, true);
  const expiresAt = validPointsCardExpiry_(payload.expiresAt || '');
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) fail_('BUSY', '系統忙碌中，請稍後再試。');
  try {
    const current = readPointsCardLifecycle_();
    if (current.updatedAt !== expectedUpdatedAt) {
      fail_('CONFLICT', '集點卡設定已被更新，請重新整理後再試。');
    }
    const now = new Date().toISOString();
    if (!audit_(context.identity.sub, 'admin', 'POINTS_CARD_UPDATE_REQUESTED', '', 'pending', {
      previousStatus: current.status,
      expiresAt: expiresAt || 'unlimited'
    })) {
      fail_('AUDIT_UNAVAILABLE', '稽核紀錄暫時無法寫入，集點卡設定未更新。');
    }

    let revokedStampQrCount = 0;
    if (current.storedStatus === 'deleted') {
      revokedStampQrCount = cancelActiveStampVouchersForCardLifecycle_(context.identity.sub, now);
    }

    const properties = PropertiesService.getScriptProperties();
    const next = {};
    next[POINTS_CARD_CARD_PROPERTIES.status] = 'active';
    next[POINTS_CARD_CARD_PROPERTIES.expiresAt] = expiresAt;
    next[POINTS_CARD_CARD_PROPERTIES.updatedAt] = now;
    properties.setProperties(next, false);
    audit_(context.identity.sub, 'admin', 'POINTS_CARD_UPDATED', '', 'success', {
      status: 'active',
      expiresAt: expiresAt || 'unlimited',
      revokedStampQrCount: revokedStampQrCount
    });
    return { card: publicPointsCardLifecycle_() };
  } finally {
    lock.releaseLock();
  }
}

function adminCardDelete_(context, payload) {
  const expectedUpdatedAt = cleanText_(payload.expectedUpdatedAt || 'legacy', 64, true);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) fail_('BUSY', '系統忙碌中，請稍後再試。');
  try {
    const current = readPointsCardLifecycle_();
    if (current.updatedAt !== expectedUpdatedAt) {
      fail_('CONFLICT', '集點卡設定已被更新，請重新整理後再試。');
    }
    if (current.storedStatus === 'deleted') {
      fail_('CARD_NOT_FOUND', '目前沒有可刪除的集點卡。');
    }
    const now = new Date().toISOString();
    if (!audit_(context.identity.sub, 'admin', 'POINTS_CARD_DELETE_REQUESTED', '', 'pending', {
      expiresAt: current.expiresAt || 'unlimited'
    })) {
      fail_('AUDIT_UNAVAILABLE', '稽核紀錄暫時無法寫入，集點卡未刪除。');
    }

    const properties = PropertiesService.getScriptProperties();
    const next = {};
    next[POINTS_CARD_CARD_PROPERTIES.status] = 'deleted';
    next[POINTS_CARD_CARD_PROPERTIES.updatedAt] = now;
    properties.setProperties(next, false);

    const revokedStampQrCount = cancelActiveStampVouchersForCardLifecycle_(context.identity.sub, now);
    audit_(context.identity.sub, 'admin', 'POINTS_CARD_DELETED', '', 'success', {
      preservedMemberHistory: true,
      preservedRewards: true,
      revokedStampQrCount: revokedStampQrCount
    });
    return { card: publicPointsCardLifecycle_(), revokedStampQrCount: revokedStampQrCount };
  } finally {
    lock.releaseLock();
  }
}
