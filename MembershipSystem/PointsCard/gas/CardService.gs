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
    const properties = PropertiesService.getScriptProperties();
    properties.setProperty(POINTS_CARD_CARD_PROPERTIES.status, 'active');
    properties.setProperty(POINTS_CARD_CARD_PROPERTIES.expiresAt, expiresAt);
    properties.setProperty(POINTS_CARD_CARD_PROPERTIES.updatedAt, now);
    audit_(context.identity.sub, 'admin', 'POINTS_CARD_UPDATED', '', 'success', {
      status: 'active',
      expiresAt: expiresAt || 'unlimited'
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
    properties.setProperty(POINTS_CARD_CARD_PROPERTIES.status, 'deleted');
    properties.setProperty(POINTS_CARD_CARD_PROPERTIES.updatedAt, now);
    audit_(context.identity.sub, 'admin', 'POINTS_CARD_DELETED', '', 'success', {
      preservedMemberHistory: true,
      preservedRewards: true
    });
    return { card: publicPointsCardLifecycle_() };
  } finally {
    lock.releaseLock();
  }
}
