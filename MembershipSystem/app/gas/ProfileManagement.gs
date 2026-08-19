'use strict';

const PROFILES_SHEET = 'Profiles';
const PROFILE_HEADERS = ['lineUserId', 'phone', 'birthDate', 'createdAt', 'updatedAt'];
const MIN_PROFILE_PHONE_DIGITS = 8;
const MAX_PROFILE_PHONE_DIGITS = 15;

function profileUpdate_(context, payload) {
  const phone = validateProfilePhone_(payload.phone);
  const birthDate = validateProfileBirthDate_(payload.birthDate);
  const expectedUpdatedAt = cleanText_(payload.expectedUpdatedAt || '', 40, false);

  const membersSheet = getMembersSheet_();
  if (!findMemberRow_(membersSheet, context.identity.sub)) {
    fail_('MEMBER_NOT_FOUND', '找不到會員資料，請重新開啟會員頁。');
  }

  const sheet = getProfilesSheet_();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) fail_('BUSY', '系統忙碌中，請稍後再試。');

  try {
    const row = findProfileRow_(sheet, context.identity.sub);
    const now = new Date().toISOString();

    if (!row) {
      if (expectedUpdatedAt) fail_('CONFLICT', '會員資料狀態已變更，請重新整理後再試。');
      const profile = {
        lineUserId: context.identity.sub,
        phone: phone,
        birthDate: birthDate,
        createdAt: now,
        updatedAt: now
      };
      sheet.appendRow(profileToRow_(profile));
      audit_(context.identity.sub, 'member', 'PROFILE_CREATED', context.identity.sub, 'success', {
        fields: ['phone', 'birthDate']
      });
      return { profile: publicProfile_(profile), profileRequired: false };
    }

    const profile = rowToProfile_(sheet.getRange(row, 1, 1, PROFILE_HEADERS.length).getValues()[0]);
    if (!expectedUpdatedAt || String(profile.updatedAt) !== expectedUpdatedAt) {
      fail_('CONFLICT', '會員資料已在其他頁面更新，請重新整理後再試。');
    }

    const changedFields = [];
    if (profile.phone !== phone) changedFields.push('phone');
    if (profile.birthDate !== birthDate) changedFields.push('birthDate');
    if (changedFields.length === 0) {
      return { profile: publicProfile_(profile), profileRequired: false };
    }

    profile.phone = phone;
    profile.birthDate = birthDate;
    profile.updatedAt = now;
    sheet.getRange(row, 1, 1, PROFILE_HEADERS.length).setValues([profileToRow_(profile)]);
    audit_(context.identity.sub, 'member', 'PROFILE_UPDATED', context.identity.sub, 'success', {
      fields: changedFields
    });
    return { profile: publicProfile_(profile), profileRequired: false };
  } finally {
    lock.releaseLock();
  }
}

function getProfilesSheet_() { return getCachedSheet_(PROFILES_SHEET, PROFILE_HEADERS); }
function findProfileRow_(sheet, lineUserId) { return findExactValueRow_(sheet, 1, lineUserId); }

function getProfileByLineUserId_(lineUserId) {
  const sheet = getProfilesSheet_();
  const row = findProfileRow_(sheet, lineUserId);
  return row ? rowToProfile_(sheet.getRange(row, 1, 1, PROFILE_HEADERS.length).getValues()[0]) : null;
}

function requireProfileComplete_(lineUserId) {
  const profile = getProfileByLineUserId_(lineUserId);
  if (!isProfileComplete_(profile)) {
    fail_('PROFILE_REQUIRED', '請先完成電話與生日資料，再使用會員功能。');
  }
  return profile;
}

function isProfileComplete_(profile) {
  return Boolean(profile && profile.phone && profile.birthDate);
}

function publicProfile_(profile) {
  if (!profile) return null;
  return {
    phone: profile.phone,
    birthDate: profile.birthDate,
    updatedAt: profile.updatedAt
  };
}

function rowToProfile_(row) {
  const profile = {};
  PROFILE_HEADERS.forEach(function (header, index) { profile[header] = normalizeCell_(row[index]); });
  return profile;
}

function profileToRow_(profile) {
  return PROFILE_HEADERS.map(function (header) {
    return sheetSafe_(profile[header] == null ? '' : profile[header]);
  });
}

function validateProfilePhone_(value) {
  const raw = cleanText_(value, 40, true);
  if (!/^[+0-9().\-\s]+$/.test(raw)) {
    fail_('INVALID_PHONE', '電話格式不正確。');
  }
  const compact = raw.replace(/[().\-\s]/g, '');
  if (!/^\+?\d+$/.test(compact)) fail_('INVALID_PHONE', '電話格式不正確。');
  const digits = compact.charAt(0) === '+' ? compact.slice(1) : compact;
  if (digits.length < MIN_PROFILE_PHONE_DIGITS || digits.length > MAX_PROFILE_PHONE_DIGITS) {
    fail_('INVALID_PHONE', '電話號碼長度必須介於 8 到 15 碼。');
  }
  return (compact.charAt(0) === '+' ? '+' : '') + digits;
}

function validateProfileBirthDate_(value) {
  const text = cleanText_(value, 10, true);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) fail_('INVALID_BIRTH_DATE', '生日格式不正確。');
  const date = new Date(text + 'T00:00:00Z');
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
    fail_('INVALID_BIRTH_DATE', '生日不是有效日期。');
  }
  const today = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd');
  if (text > today) fail_('INVALID_BIRTH_DATE', '生日不可晚於今天。');
  return text;
}
