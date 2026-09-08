'use strict';

const MEMBERSHIP_ADMIN_MEMBER_PAGE_SIZE_ = 100;
const MEMBERSHIP_ADMIN_MEMBER_MAX_PAGE_SIZE_ = 100;
const MEMBERSHIP_ADMIN_MEMBER_QUERY_MAX_LENGTH_ = 80;
const MEMBERSHIP_SERVICE_MINUTES_MAX_GRANT_ = 1440;
const MEMBERSHIP_TIER_MAX_REQUIRED_SERVICE_MINUTES_ = 10000000;
const MEMBERSHIP_LAST_LOGIN_TOUCH_INTERVAL_MS_ = 5 * 60 * 1000;
const MEMBERSHIP_TIER_SETTINGS_CACHE_SECONDS_ = 120;
const MEMBERSHIP_TIER_SETTINGS_CACHE_KEY_ = 'membership:tier-settings:v2';
const MEMBERSHIP_SERVICE_MINUTES_CACHE_SECONDS_ = 120;
const MEMBERSHIP_LINE_CHANNEL_ACCESS_TOKEN_PROPERTY_ = 'MEMBERSHIP_LINE_CHANNEL_ACCESS_TOKEN';
const MEMBERSHIP_LINE_PUSH_URL_ = 'https://api.line.me/v2/bot/message/push';
const MEMBERSHIP_LINE_MESSAGE_MAX_LENGTH_ = 5000;
const MEMBERSHIP_TIER_DEFINITIONS_ = Object.freeze([
  Object.freeze({ tierKey: 'general', label: '一般會員', defaultRequiredServiceMinutes: 0 }),
  Object.freeze({ tierKey: 'silver', label: '銀級會員', defaultRequiredServiceMinutes: 600 }),
  Object.freeze({ tierKey: 'gold', label: '金級會員', defaultRequiredServiceMinutes: 1800 }),
  Object.freeze({ tierKey: 'platinum', label: '白金會員', defaultRequiredServiceMinutes: 3600 })
]);
const MEMBERSHIP_TIER_STYLE_DEFINITIONS_ = Object.freeze([
  Object.freeze({ styleKey: 'forest', label: '森林綠' }),
  Object.freeze({ styleKey: 'midnight', label: '午夜藍' }),
  Object.freeze({ styleKey: 'ocean', label: '海灣青' }),
  Object.freeze({ styleKey: 'sunset', label: '夕陽橘' }),
  Object.freeze({ styleKey: 'lavender', label: '薰衣草紫' }),
  Object.freeze({ styleKey: 'rose', label: '玫瑰粉' }),
  Object.freeze({ styleKey: 'gold', label: '金曜棕' }),
  Object.freeze({ styleKey: 'platinum', label: '鉑金灰' }),
  Object.freeze({ styleKey: 'mint', label: '薄荷綠' }),
  Object.freeze({ styleKey: 'cherry', label: '櫻桃紅' })
]);
const MEMBERSHIP_TIER_DEFAULT_STYLE_KEYS_ = Object.freeze({ general: 'forest', silver: 'ocean', gold: 'gold', platinum: 'platinum' });

function handleMemberBootstrap_(identity, request) {
  const member = ensureMember_(identity);
  return typeof membershipVersionedBootstrapResponse_ === 'function'
    ? membershipVersionedBootstrapResponse_('member', identity, request, function() { return { profile: memberForClient_(member) }; })
    : { profile: memberForClient_(member) };
}

function memberNeedsLoginTouch_(member, identity, nowMs) {
  if (String(member && member.display_name || '') !== String(identity && identity.displayName || '')) return true;
  const lastLoginMs = new Date(String(member && member.last_login_at || '')).getTime();
  return !Number.isFinite(lastLoginMs) || nowMs - lastLoginMs >= MEMBERSHIP_LAST_LOGIN_TOUCH_INTERVAL_MS_;
}

function ensureMember_(identity) {
  const initialMatch = findRecordWithRow_('Members', 'line_user_id', identity.lineUserId);
  const nowMs = Date.now();
  if (initialMatch && !memberNeedsLoginTouch_(initialMatch.record, identity, nowMs)) return initialMatch.record;

  let profileChanged = false;
  const member = withDataLock_(function() {
    const now = nowIso_();
    const match = findRecordWithRow_('Members', 'line_user_id', identity.lineUserId);
    if (!match) {
      const member = newMemberRecord_(identity, now);
      appendRecord_('Members', member);
      profileChanged = true;
      return member;
    }
    const member = match.record;
    if (!memberNeedsLoginTouch_(member, identity, Date.now())) return member;
    const displayNameChanged = String(member.display_name || '') !== String(identity.displayName || '');
    if (displayNameChanged) {
      member.display_name = identity.displayName;
      profileChanged = true;
    }
    member.last_login_at = now;
    // Keep the login audit timestamp accurate without treating a periodic
    // login touch as a display-data revision.
    if (displayNameChanged) member.updated_at = now;
    updateRecordAtRow_('Members', match.rowNumber, member);
    return member;
  });
  if (profileChanged) {
    if (typeof membershipSyncBumpMember_ === 'function') membershipSyncBumpMember_(identity.lineUserId);
  }
  return member;
}

function generateMemberCode_() { return 'LM-' + Utilities.getUuid().replace(/-/g, '').substring(0, 8).toUpperCase(); }
function newMemberRecord_(identity, now) { return { line_user_id: identity.lineUserId, display_name: identity.displayName, member_code: generateMemberCode_(), tier: '一般會員', status: 'active', joined_at: now, last_login_at: now, created_at: now, updated_at: now, birthday: '', phone: '', membership_status: 'pending' }; }

function memberMembershipStatus_(member) {
  const stored = String(member && member.membership_status || '').trim().toLowerCase();
  // Existing rows predate this additive field and remain available to avoid
  // locking out established members during the migration.
  return stored || 'active';
}

function memberIsJoined_(member) {
  return Boolean(member) && String(member.status || 'active').toLowerCase() === 'active' && memberMembershipStatus_(member) === 'active';
}

function assertMemberJoined_(member) {
  if (!member) throw new ApiError(403, 'MEMBERSHIP_REQUIRED', '請先加入會員，完成會員資料後才能使用此功能。');
  if (String(member.status || 'active').toLowerCase() !== 'active') throw new ApiError(400, 'MEMBER_DISABLED', '停用中的會員無法使用此功能。');
  if (!memberIsJoined_(member)) throw new ApiError(403, 'MEMBERSHIP_REQUIRED', '請先加入會員，完成會員資料後才能使用此功能。');
  return member;
}

function memberForClient_(member) {
  const serviceMinutesTotal = serviceMinutesTotalForMember_(member.line_user_id);
  const tierSettings = readMembershipTierSettings_();
  const tierProgress = membershipTierProgressForServiceMinutes_(serviceMinutesTotal, tierSettings);
  const tierStyle = membershipTierStyleForKey_(tierProgress.currentTierKey, tierSettings);
  return { displayName: String(member.display_name || 'LINE 使用者'), memberCode: String(member.member_code || ''), tier: tierProgress.currentTierLabel, tierStyleKey: tierStyle.styleKey, tierStyleLabel: tierStyle.label, status: String(member.status || 'active'), membershipStatus: memberMembershipStatus_(member), membershipRequired: !memberIsJoined_(member), joinedAt: String(member.joined_at || ''), birthday: String(member.birthday || ''), phone: String(member.phone || ''), profileComplete: memberProfileComplete_(member), serviceMinutesTotal, tierProgress, benefits: ['會員專屬活動通知', '消費可累積集點進度', '優先享有新方案與回饋'] };
}

function readMembers_() {
  const totalsByMember = serviceMinutesTotalsByMember_();
  const tierSettings = readMembershipTierSettings_();
  return readRecords_('Members').map(function(member) { return adminMemberForClient_(member, totalsByMember[String(member.line_user_id || '')] || 0, tierSettings); }).sort(function(a, b) { return String(b.updatedAt).localeCompare(String(a.updatedAt)); });
}

function adminMemberForClient_(member, serviceMinutesTotal, tierSettings) {
  const normalizedServiceMinutesTotal = Math.max(0, Number(serviceMinutesTotal || 0));
  const tier = membershipTierForServiceMinutes_(normalizedServiceMinutesTotal, tierSettings);
  return { lineUserId: String(member.line_user_id || ''), displayName: String(member.display_name || 'LINE 使用者'), memberCode: String(member.member_code || ''), tier: tier.label, status: String(member.status || 'active'), joinedAt: String(member.joined_at || ''), updatedAt: String(member.updated_at || ''), serviceMinutesTotal: normalizedServiceMinutesTotal };
}

function membershipTierSettingsCache_() {
  try { return typeof CacheService !== 'undefined' ? CacheService.getScriptCache() : null; } catch (_) { return null; }
}

function clearMembershipTierSettingsCache_() {
  const cache = membershipTierSettingsCache_();
  if (!cache) return;
  try { cache.remove(MEMBERSHIP_TIER_SETTINGS_CACHE_KEY_); } catch (_) {}
}

function ensureMembershipTierSettings_() {
  if (readRecords_('MembershipTierSettings').length) {
    readMembershipTierSettings_(true);
    return;
  }
  withDataLock_(function() {
    if (readRecords_('MembershipTierSettings').length) return;
    const now = nowIso_();
    MEMBERSHIP_TIER_DEFINITIONS_.forEach(function(definition) {
      appendRecord_('MembershipTierSettings', { tier_key: definition.tierKey, tier_label: definition.label, required_service_minutes: String(definition.defaultRequiredServiceMinutes), style_key: membershipTierDefaultStyleKey_(definition.tierKey), updated_by: 'system', updated_at: now });
    });
    clearMembershipTierSettingsCache_();
  });
  readMembershipTierSettings_(true);
}

function readMembershipTierSettings_(forceFresh) {
  const cache = membershipTierSettingsCache_();
  if (!forceFresh && cache) {
    try {
      const cached = JSON.parse(cache.get(MEMBERSHIP_TIER_SETTINGS_CACHE_KEY_) || 'null');
      if (Array.isArray(cached) && cached.length === MEMBERSHIP_TIER_DEFINITIONS_.length) return cached;
    } catch (_) {}
  }

  const recordsByKey = {};
  readRecords_('MembershipTierSettings').forEach(function(record) {
    const tierKey = String(record.tier_key || '').trim();
    if (!MEMBERSHIP_TIER_DEFINITIONS_.some(function(definition) { return definition.tierKey === tierKey; }) || recordsByKey[tierKey]) throw new ApiError(500, 'TIER_SETTINGS_INVALID', '會員等級設定資料不完整。');
    recordsByKey[tierKey] = record;
  });
  if (Object.keys(recordsByKey).length !== MEMBERSHIP_TIER_DEFINITIONS_.length) throw new ApiError(500, 'TIER_SETTINGS_INVALID', '會員等級設定資料不完整。');
  let previousRequiredServiceMinutes = -1;
  const settings = MEMBERSHIP_TIER_DEFINITIONS_.map(function(definition, index) {
    const record = recordsByKey[definition.tierKey];
    const storedRequiredServiceMinutes = String(record.required_service_minutes || '').trim();
    const requiredServiceMinutes = Number(storedRequiredServiceMinutes);
    const validMinimum = index === 0 ? requiredServiceMinutes === 0 : requiredServiceMinutes > previousRequiredServiceMinutes;
    if (!/^(0|[1-9]\d*)$/.test(storedRequiredServiceMinutes) || !Number.isInteger(requiredServiceMinutes) || requiredServiceMinutes < 0 || requiredServiceMinutes > MEMBERSHIP_TIER_MAX_REQUIRED_SERVICE_MINUTES_ || !validMinimum) throw new ApiError(500, 'TIER_SETTINGS_INVALID', '會員等級門檻資料不合法。');
    previousRequiredServiceMinutes = requiredServiceMinutes;
    const style = membershipTierStyleForRecord_(record, definition.tierKey);
    return { tierKey: definition.tierKey, label: definition.label, requiredServiceMinutes, styleKey: style.styleKey, styleLabel: style.label, updatedAt: String(record.updated_at || '') };
  });
  if (cache) {
    try { cache.put(MEMBERSHIP_TIER_SETTINGS_CACHE_KEY_, JSON.stringify(settings), MEMBERSHIP_TIER_SETTINGS_CACHE_SECONDS_); } catch (_) {}
  }
  return settings;
}

function membershipTierForServiceMinutes_(serviceMinutesTotal, tierSettings) {
  const minutes = Math.max(0, Math.floor(Number(serviceMinutesTotal) || 0));
  const settings = tierSettings || readMembershipTierSettings_();
  return settings.reduce(function(currentTier, tier) { return minutes >= tier.requiredServiceMinutes ? tier : currentTier; }, settings[0]);
}

function membershipTierProgressForServiceMinutes_(serviceMinutesTotal, tierSettings) {
  const normalizedServiceMinutesTotal = Math.max(0, Math.floor(Number(serviceMinutesTotal) || 0));
  const settings = tierSettings || readMembershipTierSettings_();
  const currentTier = membershipTierForServiceMinutes_(normalizedServiceMinutesTotal, settings);
  const currentTierIndex = settings.findIndex(function(tier) { return tier.tierKey === currentTier.tierKey; });
  const nextTier = currentTierIndex >= 0 ? settings[currentTierIndex + 1] : null;
  return {
    serviceMinutesTotal: normalizedServiceMinutesTotal,
    currentTierKey: currentTier.tierKey,
    currentTierLabel: currentTier.label,
    currentRequiredServiceMinutes: currentTier.requiredServiceMinutes,
    nextTierKey: nextTier ? nextTier.tierKey : '',
    nextTierLabel: nextTier ? nextTier.label : '',
    nextRequiredServiceMinutes: nextTier ? nextTier.requiredServiceMinutes : null,
    remainingServiceMinutes: nextTier ? Math.max(0, nextTier.requiredServiceMinutes - normalizedServiceMinutesTotal) : 0,
    isHighestTier: !nextTier
  };
}

function membershipTierStyleForKey_(tierKey, tierSettings) {
  const settings = Array.isArray(tierSettings) ? tierSettings : [];
  const setting = settings.find(function(item) { return String(item && item.tierKey || '') === String(tierKey || ''); });
  return membershipTierStyleDefinition_(setting && setting.styleKey, tierKey);
}

function membershipTierStyleForRecord_(record, tierKey) {
  return membershipTierStyleDefinition_(record && record.style_key, tierKey);
}

function membershipTierStyleDefinition_(styleKey, tierKey) {
  const requested = String(styleKey || '').trim();
  const selected = MEMBERSHIP_TIER_STYLE_DEFINITIONS_.find(function(style) { return style.styleKey === requested; });
  if (selected) return selected;
  const fallbackKey = membershipTierDefaultStyleKey_(tierKey);
  return MEMBERSHIP_TIER_STYLE_DEFINITIONS_.find(function(style) { return style.styleKey === fallbackKey; }) || MEMBERSHIP_TIER_STYLE_DEFINITIONS_[0];
}

function membershipTierDefaultStyleKey_(tierKey) {
  return MEMBERSHIP_TIER_DEFAULT_STYLE_KEYS_[String(tierKey || '').trim()] || MEMBERSHIP_TIER_STYLE_DEFINITIONS_[0].styleKey;
}

function normalizeMembershipTierStyleKey_(value, tierKey) {
  const styleKey = String(value || '').trim();
  if (!styleKey) throw new ApiError(400, 'INVALID_TIER_SETTINGS', '會員卡樣式不合法。');
  if (!MEMBERSHIP_TIER_STYLE_DEFINITIONS_.some(function(style) { return style.styleKey === styleKey; })) throw new ApiError(400, 'INVALID_TIER_SETTINGS', '會員卡樣式不合法。');
  return styleKey;
}

function memberProfileComplete_(member) { return Boolean(String(member.birthday || '').trim() && String(member.phone || '').trim()); }

function serviceMinutesTotalsByMember_() {
  return readRecordFields_('ServiceTimeEntries', ['line_user_id', 'minutes']).reduce(function(totals, entry) {
    const lineUserId = String(entry.line_user_id || '').trim();
    const minutes = Number(entry.minutes || 0);
    if (lineUserId && Number.isInteger(minutes) && minutes > 0) totals[lineUserId] = (totals[lineUserId] || 0) + minutes;
    return totals;
  }, {});
}

function serviceMinutesTotalCacheKey_(lineUserId) {
  const dataEpoch = typeof membershipDataCacheEpoch_ === 'function' ? membershipDataCacheEpoch_() : 'default';
  return 'membership:service-minutes:' + dataEpoch + ':' + digest_(String(lineUserId || '').trim()).substring(0, 32);
}

function clearServiceMinutesTotalCache_(lineUserId) {
  const normalizedLineUserId = String(lineUserId || '').trim();
  const cache = membershipTierSettingsCache_();
  if (!normalizedLineUserId || !cache) return;
  try { cache.remove(serviceMinutesTotalCacheKey_(normalizedLineUserId)); } catch (_) {}
}

function serviceMinutesTotalForMember_(lineUserId) {
  const normalizedLineUserId = String(lineUserId || '').trim();
  if (!normalizedLineUserId) return 0;
  const cache = membershipTierSettingsCache_();
  const cacheKey = cache ? serviceMinutesTotalCacheKey_(normalizedLineUserId) : '';
  if (cache) {
    try {
      const cached = String(cache.get(cacheKey) || '');
      if (/^\d+$/.test(cached)) return Number(cached);
    } catch (_) {}
  }
  const total = Number(serviceMinutesTotalsByMember_()[normalizedLineUserId] || 0);
  if (cache) {
    try { cache.put(cacheKey, String(total), MEMBERSHIP_SERVICE_MINUTES_CACHE_SECONDS_); } catch (_) {}
  }
  return total;
}

function normalizeBirthday_(value) {
  const birthday = String(value || '').trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthday);
  if (!match) throw new ApiError(400, 'INVALID_MEMBER_PROFILE', '生日格式不合法。');
  const year = Number(match[1]); const month = Number(match[2]); const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  const now = new Date();
  if (year < 1900 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day || date.getTime() > Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) throw new ApiError(400, 'INVALID_MEMBER_PROFILE', '生日不合法。');
  return birthday;
}

function normalizePhone_(value) {
  const phone = String(value || '').trim().replace(/[()\s-]/g, '');
  if (!/^\+?[0-9]{8,15}$/.test(phone)) throw new ApiError(400, 'INVALID_MEMBER_PROFILE', '電話格式不合法。');
  return phone;
}

function handleMemberProfileSave_(identity, request) {
  const birthday = normalizeBirthday_(request.birthday);
  const phone = normalizePhone_(request.phone);
  const member = withDataLock_(function() {
    const now = nowIso_();
    const match = findRecordWithRow_('Members', 'line_user_id', identity.lineUserId);
    const record = match ? match.record : newMemberRecord_(identity, now);
    record.display_name = identity.displayName;
    record.birthday = birthday;
    record.phone = phone;
    record.membership_status = 'active';
    record.last_login_at = now;
    record.updated_at = now;
    if (match) updateRecordAtRow_('Members', match.rowNumber, record); else appendRecord_('Members', record);
    appendAuditRecord_({ audit_id: Utilities.getUuid(), actor_line_user_id: identity.lineUserId, actor_role: 'member', action: 'MEMBER_PROFILE_SAVE', target_type: 'member', target_id: identity.lineUserId, result: 'success', detail: 'Member profile contact details saved', created_at: now });
    return record;
  });
  return { profile: memberForClient_(member) };
}

function normalizeAdminMemberPageRequest_(request) {
  const input = request && typeof request === 'object' ? request : {};
  const requestedPage = Math.floor(Number(input.memberPage));
  const requestedPageSize = Math.floor(Number(input.memberPageSize));
  const query = String(input.memberQuery || '').trim().toLowerCase();
  return {
    page: Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1,
    pageSize: Number.isInteger(requestedPageSize) && requestedPageSize > 0 ? Math.min(requestedPageSize, MEMBERSHIP_ADMIN_MEMBER_MAX_PAGE_SIZE_) : MEMBERSHIP_ADMIN_MEMBER_PAGE_SIZE_,
    query: query.substring(0, MEMBERSHIP_ADMIN_MEMBER_QUERY_MAX_LENGTH_)
  };
}

function readMembersPage_(request) {
  const pageRequest = normalizeAdminMemberPageRequest_(request);
  const allMembers = readMembers_();
  const query = pageRequest.query;
  const matchingMembers = query ? allMembers.filter(function(member) {
    return [member.displayName, member.memberCode, member.tier].join(' ').toLowerCase().indexOf(query) >= 0;
  }) : allMembers;
  const totalPages = Math.max(1, Math.ceil(matchingMembers.length / pageRequest.pageSize));
  const page = Math.min(pageRequest.page, totalPages);
  const start = (page - 1) * pageRequest.pageSize;
  return {
    members: matchingMembers.slice(start, start + pageRequest.pageSize),
    memberPage: { page, pageSize: pageRequest.pageSize, total: matchingMembers.length, totalPages, query },
    stats: { memberCount: allMembers.length, activeMemberCount: allMembers.filter(function(member) { return member.status === 'active'; }).length }
  };
}

function handleMemberUpdate_(identity, admin, request) {
  const lineUserId = String(request.lineUserId || '').trim();
  const status = String(request.status || '').trim().toLowerCase();
  const expected = String(request.expectedUpdatedAt || '').trim();
  if (!lineUserId || lineUserId.length > 80) throw new ApiError(400, 'INVALID_MEMBER', '會員識別碼不合法。');
  if (['active', 'disabled'].indexOf(status) < 0) throw new ApiError(400, 'INVALID_MEMBER', '會員狀態不合法。');
  const member = withDataLock_(function() {
    const match = findRecordWithRow_('Members', 'line_user_id', lineUserId); if (!match) throw new ApiError(404, 'MEMBER_NOT_FOUND', '找不到會員資料。');
    if (expected && String(match.record.updated_at || '') !== expected) throw new ApiError(409, 'CONFLICT', '會員資料已被更新，請重新整理。');
    const record = match.record; record.status = status; record.updated_at = nowIso_(); updateRecordAtRow_('Members', match.rowNumber, record);
    appendAuditRecord_({ audit_id: Utilities.getUuid(), actor_line_user_id: identity.lineUserId, actor_role: admin.role, action: 'MEMBER_UPDATE', target_type: 'member', target_id: lineUserId, result: 'success', detail: 'Member status updated', created_at: nowIso_() });
    return record;
  });
  return { member: adminMemberForClient_(member, serviceMinutesTotalForMember_(lineUserId)) };
}

function normalizeMembershipTierSettingsRequest_(request) {
  const input = Array.isArray(request.tierSettings) ? request.tierSettings : [];
  if (input.length !== MEMBERSHIP_TIER_DEFINITIONS_.length) throw new ApiError(400, 'INVALID_TIER_SETTINGS', '請完整設定四種會員等級門檻。');
  const inputByKey = {};
  input.forEach(function(setting) {
    const tierKey = String(setting && setting.tierKey || '').trim();
    if (!tierKey || inputByKey[tierKey]) throw new ApiError(400, 'INVALID_TIER_SETTINGS', '會員等級設定重複或不合法。');
    inputByKey[tierKey] = setting;
  });
  let previousRequiredServiceMinutes = -1;
  return MEMBERSHIP_TIER_DEFINITIONS_.map(function(definition, index) {
    const setting = inputByKey[definition.tierKey];
    const requiredServiceMinutes = Number(setting && setting.requiredServiceMinutes);
    const expectedUpdatedAt = String(setting && setting.expectedUpdatedAt || '').trim();
    const hasStyleKey = Boolean(setting && Object.prototype.hasOwnProperty.call(setting, 'styleKey'));
    const styleKey = hasStyleKey ? normalizeMembershipTierStyleKey_(setting.styleKey, definition.tierKey) : '';
    const validMinimum = index === 0 ? requiredServiceMinutes === 0 : requiredServiceMinutes > previousRequiredServiceMinutes;
    if (!setting || !Number.isInteger(requiredServiceMinutes) || requiredServiceMinutes < 0 || requiredServiceMinutes > MEMBERSHIP_TIER_MAX_REQUIRED_SERVICE_MINUTES_ || !validMinimum || expectedUpdatedAt.length > 80) throw new ApiError(400, 'INVALID_TIER_SETTINGS', '會員等級門檻必須由一般會員 0 分鐘開始，並依序遞增。');
    previousRequiredServiceMinutes = requiredServiceMinutes;
    return { tierKey: definition.tierKey, requiredServiceMinutes, styleKey, hasStyleKey, expectedUpdatedAt };
  });
}

function handleMembershipTierSettingsSave_(identity, admin, request) {
  const tierSettings = normalizeMembershipTierSettingsRequest_(request);
  withDataLock_(function() {
    const currentSettings = readMembershipTierSettings_(true);
    const currentByKey = currentSettings.reduce(function(byKey, setting) { byKey[setting.tierKey] = setting; return byKey; }, {});
    tierSettings.forEach(function(setting) {
      if (setting.expectedUpdatedAt && currentByKey[setting.tierKey].updatedAt !== setting.expectedUpdatedAt) throw new ApiError(409, 'CONFLICT', '會員等級門檻已被更新，請重新整理。');
    });
    const now = nowIso_();
    tierSettings.forEach(function(setting) {
      const match = findRecordWithRow_('MembershipTierSettings', 'tier_key', setting.tierKey);
      if (!match) throw new ApiError(500, 'TIER_SETTINGS_INVALID', '會員等級設定資料不完整。');
      const record = match.record;
      record.required_service_minutes = String(setting.requiredServiceMinutes);
      if (setting.hasStyleKey) record.style_key = setting.styleKey;
      record.updated_by = identity.lineUserId;
      record.updated_at = now;
      updateRecordAtRow_('MembershipTierSettings', match.rowNumber, record);
    });
    clearMembershipTierSettingsCache_();
    appendAuditRecord_({ audit_id: Utilities.getUuid(), actor_line_user_id: identity.lineUserId, actor_role: admin.role, action: 'MEMBER_TIER_SETTINGS_SAVE', target_type: 'membership_tiers', target_id: 'all', result: 'success', detail: 'Membership tier thresholds updated', created_at: now });
  });
  return { tierSettings: readMembershipTierSettings_(true) };
}

function handleServiceMinutesAdd_(identity, admin, request) {
  const serviceTime = normalizeServiceMinutesAddRequest_(request);
  return withDataLock_(function() { return addServiceMinutesLocked_(identity, admin, serviceTime); });
}

function normalizeServiceMinutesAddRequest_(request) {
  const lineUserId = String(request.lineUserId || '').trim(); const minutes = Number(request.minutes); const note = String(request.note || '').trim(); const requestId = String(request.requestId || '').trim();
  if (!lineUserId || lineUserId.length > 80 || !Number.isInteger(minutes) || minutes < 1 || minutes > MEMBERSHIP_SERVICE_MINUTES_MAX_GRANT_ || note.length > 160) throw new ApiError(400, 'INVALID_SERVICE_TIME', '會員、服務時間或備註不合法。');
  if (requestId && !/^[A-Za-z0-9_-]{16,100}$/.test(requestId)) throw new ApiError(400, 'INVALID_REQUEST_ID', '服務時間請求識別碼不合法。');
  return { lineUserId, minutes, note, requestId };
}

function addServiceMinutesLocked_(identity, admin, serviceTime) {
  const lineUserId = serviceTime.lineUserId; const minutes = serviceTime.minutes; const note = serviceTime.note; const requestId = serviceTime.requestId;
  const prior = requestId ? findRecordWithRow_('ServiceTimeEntries', 'request_id', requestId) : null;
  if (prior) {
    const entry = prior.record;
    if (String(entry.line_user_id || '') !== lineUserId || Number(entry.minutes || 0) !== minutes || String(entry.note || '') !== note || String(entry.created_by || '') !== String(identity.lineUserId || '')) throw new ApiError(409, 'REQUEST_REUSE_MISMATCH', '這個服務時間請求已用於不同資料，請重新開啟登錄視窗。');
    const member = findRecordWithRow_('Members', 'line_user_id', lineUserId); if (!member) throw new ApiError(404, 'MEMBER_NOT_FOUND', '找不到會員資料。');
    return { created: false, member: adminMemberForClient_(member.record, serviceMinutesTotalForMember_(lineUserId)) };
  }
  const member = findRecordWithRow_('Members', 'line_user_id', lineUserId); if (!member) throw new ApiError(404, 'MEMBER_NOT_FOUND', '找不到會員資料。');
  if (String(member.record.status || 'active') !== 'active') throw new ApiError(400, 'MEMBER_DISABLED', '停用中的會員無法登錄服務時間。');
  const now = nowIso_();
  appendRecord_('ServiceTimeEntries', { entry_id: 'ST-' + Utilities.getUuid().replace(/-/g, '').substring(0, 12).toUpperCase(), line_user_id: lineUserId, minutes: String(minutes), note, created_by: identity.lineUserId, created_at: now, request_id: requestId });
  clearServiceMinutesTotalCache_(lineUserId);
  appendAuditRecord_({ audit_id: Utilities.getUuid(), actor_line_user_id: identity.lineUserId, actor_role: admin.role, action: 'SERVICE_TIME_ADD', target_type: 'service_time', target_id: lineUserId, result: 'success', detail: 'Added ' + minutes + ' service minute(s)', created_at: now });
  return { created: true, member: adminMemberForClient_(member.record, serviceMinutesTotalForMember_(lineUserId)) };
}

function handleMemberGrantAdd_(identity, admin, request) {
  const lineUserId = String(request.lineUserId || '').trim(); const requestId = String(request.requestId || '').trim(); const note = String(request.note || '').trim();
  const hasPoints = Array.isArray(request.points) || Boolean(request.points && typeof request.points === 'object');
  const hasServiceTime = Boolean(request.serviceTime && !Array.isArray(request.serviceTime) && typeof request.serviceTime === 'object');
  if (!lineUserId || lineUserId.length > 80 || !requestId || !/^[A-Za-z0-9_-]{16,88}$/.test(requestId) || note.length > 160 || (!hasPoints && !hasServiceTime)) throw new ApiError(400, 'INVALID_MEMBER_GRANT', '發放內容或請求識別碼不合法。');
  const stamps = hasPoints ? normalizeMemberGrantPoints_(lineUserId, request.points, note, requestId) : [];
  const serviceTime = hasServiceTime ? normalizeServiceMinutesAddRequest_({ lineUserId, minutes: request.serviceTime.minutes, note, requestId: requestId + '_service' }) : null;
  const grantResult = withDataLock_(function() {
    validateMemberGrantTargetsLocked_(lineUserId, stamps, serviceTime);
    const stampResults = stamps.map(function(stamp) { return addStampLocked_(identity, admin, stamp); });
    const serviceTimeResult = serviceTime ? addServiceMinutesLocked_(identity, admin, serviceTime) : null;
    let memberResult = serviceTimeResult && serviceTimeResult.member ? serviceTimeResult.member : null;
    if (!memberResult) {
      const member = findRecordWithRow_('Members', 'line_user_id', lineUserId); if (!member) throw new ApiError(404, 'MEMBER_NOT_FOUND', '找不到會員資料。');
      memberResult = adminMemberForClient_(member.record, serviceMinutesTotalForMember_(lineUserId));
    }

    const existingNotification = findRecordWithRow_('LineNotificationLogs', 'request_id', requestId);
    const created = stampResults.some(function(result) { return result.created; }) || Boolean(serviceTimeResult && serviceTimeResult.created);
    let notificationLog = existingNotification ? existingNotification.record : null;
    if (!notificationLog && created) {
      const now = nowIso_();
      notificationLog = { notification_id: 'LN-' + Utilities.getUuid().replace(/-/g, '').substring(0, 16).toUpperCase(), request_id: requestId, line_user_id: lineUserId, message: memberGrantNotificationText_(memberResult, stampResults, serviceTime), status: 'pending', error_code: '', created_at: now, sent_at: '', updated_at: now };
      appendRecord_('LineNotificationLogs', notificationLog);
    }
    return { member: memberResult, stampResults, serviceTimeResult, notificationLog };
  });

  const notification = grantResult.notificationLog && String(grantResult.notificationLog.status || '') === 'pending'
    ? dispatchMemberGrantLineNotification_(grantResult.notificationLog)
    : lineNotificationForClient_(grantResult.notificationLog);
  return {
    member: grantResult.member,
    stamps: grantResult.stampResults.length === 1 && !Array.isArray(request.points) ? grantResult.stampResults[0] : grantResult.stampResults,
    stampGrants: grantResult.stampResults,
    serviceTime: grantResult.serviceTimeResult ? { minutes: serviceTime.minutes } : null,
    notification
  };
}

function normalizeMemberGrantPoints_(lineUserId, rawPoints, note, requestId) {
  const inputs = Array.isArray(rawPoints) ? rawPoints : [rawPoints];
  if (!inputs.length || inputs.length > 20) throw new ApiError(400, 'INVALID_MEMBER_GRANT', '一次最多可發放 20 張不同集點卡。');
  const cardIds = {};
  return inputs.map(function(input, index) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ApiError(400, 'INVALID_MEMBER_GRANT', '集點發放資料格式不合法。');
    const stamp = normalizeStampAddRequest_({ lineUserId, cardId: input.cardId, amount: input.amount, note, requestId: requestId + (Array.isArray(rawPoints) ? '_points_' + (index + 1) : '_points') });
    if (cardIds[stamp.cardId]) throw new ApiError(400, 'INVALID_MEMBER_GRANT', '同一次發放不可重複選擇同一張集點卡。');
    cardIds[stamp.cardId] = true;
    return stamp;
  });
}

function validateMemberGrantTargetsLocked_(lineUserId, stamps, serviceTime) {
  const member = findRecordWithRow_('Members', 'line_user_id', lineUserId);
  if (!member) throw new ApiError(404, 'MEMBER_NOT_FOUND', '找不到會員資料。');
  if (String(member.record.status || 'active') !== 'active') throw new ApiError(400, 'MEMBER_DISABLED', '停用中的會員無法發放福利。');
  (Array.isArray(stamps) ? stamps : []).forEach(function(stamp) {
    const card = findRecordWithRow_('PointCards', 'card_id', stamp.cardId);
    if (!card || String(card.record.status || '') !== 'active') throw new ApiError(400, 'CARD_NOT_ACTIVE', '只能發放啟用中的集點卡。');
    if (pointCardIsExpired_(card.record)) throw new ApiError(410, 'CARD_EXPIRED', '集點卡已超過使用期限，無法發放點數。');
  });
  if (serviceTime && (serviceTime.minutes < 1 || serviceTime.minutes > MEMBERSHIP_SERVICE_MINUTES_MAX_GRANT_)) throw new ApiError(400, 'INVALID_SERVICE_TIME', '服務時間不合法。');
  return member.record;
}

function memberGrantNotificationText_(member, stampResults, serviceTime) {
  const lines = ['會員福利已更新', String(member && member.displayName || '會員') + '，您好！'];
  (Array.isArray(stampResults) ? stampResults : []).forEach(function(result) {
    lines.push('・' + String(result.cardTitle || '集點卡') + '：+' + String(result.amount || 0) + ' 點');
  });
  if (serviceTime) lines.push('・消費服務時間：+' + String(serviceTime.minutes) + ' 分鐘');
  lines.push('請開啟會員中心查看最新進度。');
  return lines.join('\n').substring(0, MEMBERSHIP_LINE_MESSAGE_MAX_LENGTH_);
}

function lineNotificationForClient_(record) {
  const status = String(record && record.status || 'skipped');
  const messages = {
    sent: 'LINE 官方帳號通知已發送。',
    not_configured: '資料已發放，但尚未設定 LINE 官方帳號通知。',
    failed: '資料已發放，但 LINE 官方帳號通知未送出，請檢查官方帳號推播設定。',
    pending: '資料已發放，LINE 官方帳號通知仍在處理中。',
    skipped: '資料已發放。'
  };
  return { status, message: messages[status] || messages.failed };
}

function dispatchMemberGrantLineNotification_(record) {
  const properties = typeof PropertiesService !== 'undefined' ? PropertiesService.getScriptProperties() : null;
  const token = properties ? String(properties.getProperty(MEMBERSHIP_LINE_CHANNEL_ACCESS_TOKEN_PROPERTY_) || '').trim() : '';
  if (!token) return updateLineNotificationStatus_(record, 'not_configured', 'LINE_CHANNEL_ACCESS_TOKEN_MISSING');
  if (typeof UrlFetchApp === 'undefined') return updateLineNotificationStatus_(record, 'failed', 'URL_FETCH_UNAVAILABLE');
  try {
    const response = UrlFetchApp.fetch(MEMBERSHIP_LINE_PUSH_URL_, { method: 'post', contentType: 'application/json', headers: { Authorization: 'Bearer ' + token }, payload: JSON.stringify({ to: String(record.line_user_id || ''), messages: [{ type: 'text', text: String(record.message || '').substring(0, MEMBERSHIP_LINE_MESSAGE_MAX_LENGTH_) }] }), muteHttpExceptions: true });
    const responseCode = Number(response && response.getResponseCode && response.getResponseCode());
    return updateLineNotificationStatus_(record, responseCode >= 200 && responseCode < 300 ? 'sent' : 'failed', responseCode >= 200 && responseCode < 300 ? '' : 'LINE_PUSH_HTTP_' + responseCode);
  } catch (_) {
    return updateLineNotificationStatus_(record, 'failed', 'LINE_PUSH_REQUEST_FAILED');
  }
}

function updateLineNotificationStatus_(record, status, errorCode) {
  const updated = withDataLock_(function() {
    const match = findRecordWithRow_('LineNotificationLogs', 'notification_id', String(record && record.notification_id || ''));
    if (!match) return record;
    const next = match.record; const now = nowIso_();
    next.status = status; next.error_code = String(errorCode || ''); next.sent_at = status === 'sent' ? now : String(next.sent_at || ''); next.updated_at = now;
    updateRecordAtRow_('LineNotificationLogs', match.rowNumber, next);
    return next;
  });
  return lineNotificationForClient_(updated);
}
