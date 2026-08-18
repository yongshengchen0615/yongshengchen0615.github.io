'use strict';

const DEFAULT_TIER_THRESHOLDS = {
  standard: 0,
  silver: 600,
  gold: 1800,
  platinum: 3600
};
const TIER_THRESHOLD_PROPERTY_KEYS = {
  silver: 'MEMBERSHIP_TIER_SILVER_MINUTES',
  gold: 'MEMBERSHIP_TIER_GOLD_MINUTES',
  platinum: 'MEMBERSHIP_TIER_PLATINUM_MINUTES'
};
const MAX_TIER_THRESHOLD_MINUTES = 10000000;

function adminTierGet_(context) {
  return { thresholds: getTierThresholds_() };
}

function adminTierUpdate_(context, payload) {
  const thresholds = validateTierThresholds_(payload);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) fail_('BUSY', '系統忙碌中，請稍後再試。');

  try {
    const previous = getTierThresholds_();
    PropertiesService.getScriptProperties().setProperties({
      [TIER_THRESHOLD_PROPERTY_KEYS.silver]: String(thresholds.silver),
      [TIER_THRESHOLD_PROPERTY_KEYS.gold]: String(thresholds.gold),
      [TIER_THRESHOLD_PROPERTY_KEYS.platinum]: String(thresholds.platinum)
    });

    const updatedMembers = synchronizeAllMemberTiers_(thresholds);
    audit_(context.identity.sub, 'admin', 'MEMBERSHIP_TIER_THRESHOLDS_UPDATED', '', 'success', {
      previous: previous,
      current: thresholds,
      updatedMembers: updatedMembers
    });

    return { thresholds: thresholds, updatedMembers: updatedMembers };
  } finally {
    lock.releaseLock();
  }
}

function getTierThresholds_() {
  const props = PropertiesService.getScriptProperties();
  const thresholds = {
    standard: 0,
    silver: readTierThreshold_(props.getProperty(TIER_THRESHOLD_PROPERTY_KEYS.silver), DEFAULT_TIER_THRESHOLDS.silver),
    gold: readTierThreshold_(props.getProperty(TIER_THRESHOLD_PROPERTY_KEYS.gold), DEFAULT_TIER_THRESHOLDS.gold),
    platinum: readTierThreshold_(props.getProperty(TIER_THRESHOLD_PROPERTY_KEYS.platinum), DEFAULT_TIER_THRESHOLDS.platinum)
  };

  if (!(thresholds.silver >= 1 && thresholds.silver < thresholds.gold && thresholds.gold < thresholds.platinum)) {
    fail_('CONFIG_ERROR', '會員等級門檻設定不正確，請聯絡管理員。');
  }
  return thresholds;
}

function readTierThreshold_(value, fallback) {
  if (value == null || String(value).trim() === '') return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > MAX_TIER_THRESHOLD_MINUTES) {
    fail_('CONFIG_ERROR', '會員等級門檻設定不正確，請聯絡管理員。');
  }
  return number;
}

function validateTierThresholds_(payload) {
  const silver = validateTierThresholdValue_(payload.silver, '銀級');
  const gold = validateTierThresholdValue_(payload.gold, '金級');
  const platinum = validateTierThresholdValue_(payload.platinum, '白金');
  if (!(silver < gold && gold < platinum)) {
    fail_('INVALID_TIER_THRESHOLDS', '會員等級門檻必須依序為：銀級 < 金級 < 白金。');
  }
  return { standard: 0, silver: silver, gold: gold, platinum: platinum };
}

function validateTierThresholdValue_(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > MAX_TIER_THRESHOLD_MINUTES) {
    fail_('INVALID_TIER_THRESHOLDS', label + '門檻必須是 1 到 ' + MAX_TIER_THRESHOLD_MINUTES + ' 的整數分鐘。');
  }
  return number;
}

function tierForConsumedMinutes_(value, thresholds) {
  const minutes = nonNegativeInt_(value);
  const config = thresholds || getTierThresholds_();
  if (minutes >= config.platinum) return 'platinum';
  if (minutes >= config.gold) return 'gold';
  if (minutes >= config.silver) return 'silver';
  return 'standard';
}

function normalizeTier_(value) {
  const tier = String(value || '').trim().toLowerCase();
  if (tier === 'vip') return 'platinum';
  if (tier === 'silver' || tier === 'gold' || tier === 'platinum') return tier;
  return 'standard';
}

function synchronizeAllMemberTiers_(thresholds) {
  const sheet = getMembersSheet_();
  if (sheet.getLastRow() <= 1) return 0;

  const range = sheet.getRange(2, 1, sheet.getLastRow() - 1, MEMBER_HEADERS.length);
  const values = range.getValues();
  let changed = 0;
  const now = new Date().toISOString();

  values.forEach(function (row) {
    const member = rowToMember_(row);
    const tier = tierForConsumedMinutes_(member.consumedMinutes, thresholds);
    if (normalizeTier_(member.tier) === tier && String(row[4] || '').toLowerCase() === tier) return;
    row[4] = sheetSafe_(tier);
    row[10] = sheetSafe_(now);
    changed += 1;
  });

  if (changed > 0) range.setValues(values);
  return changed;
}
