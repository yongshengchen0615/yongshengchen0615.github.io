'use strict';

const MEMBERSHIP_ADMIN_MEMBER_PAGE_SIZE_ = 100;
const MEMBERSHIP_ADMIN_MEMBER_MAX_PAGE_SIZE_ = 100;
const MEMBERSHIP_ADMIN_MEMBER_QUERY_MAX_LENGTH_ = 80;
const MEMBERSHIP_SERVICE_MINUTES_MAX_GRANT_ = 1440;
const MEMBERSHIP_TIER_MAX_REQUIRED_SERVICE_MINUTES_ = 10000000;
const MEMBERSHIP_LAST_LOGIN_TOUCH_INTERVAL_MS_ = 5 * 60 * 1000;
const MEMBERSHIP_TIER_SETTINGS_CACHE_SECONDS_ = 120;
const MEMBERSHIP_TIER_SETTINGS_CACHE_KEY_ = 'membership:tier-settings:v1';
const MEMBERSHIP_SERVICE_MINUTES_CACHE_SECONDS_ = 120;
const MEMBERSHIP_TIER_DEFINITIONS_ = Object.freeze([
  Object.freeze({ tierKey: 'general', label: '一般會員', defaultRequiredServiceMinutes: 0 }),
  Object.freeze({ tierKey: 'silver', label: '銀級會員', defaultRequiredServiceMinutes: 600 }),
  Object.freeze({ tierKey: 'gold', label: '金級會員', defaultRequiredServiceMinutes: 1800 }),
  Object.freeze({ tierKey: 'platinum', label: '白金會員', defaultRequiredServiceMinutes: 3600 })
]);

function handleMemberBootstrap_(identity) {
  const member = ensureMember_(identity);
  return { profile: memberForClient_(member) };
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

  return withDataLock_(function() {
    const now = nowIso_();
    const match = findRecordWithRow_('Members', 'line_user_id', identity.lineUserId);
    if (!match) {
      const member = newMemberRecord_(identity, now);
      appendRecord_('Members', member);
      return member;
    }
    const member = match.record;
    if (!memberNeedsLoginTouch_(member, identity, Date.now())) return member;
    member.display_name = identity.displayName;
    member.last_login_at = now;
    member.updated_at = now;
    updateRecordAtRow_('Members', match.rowNumber, member);
    return member;
  });
}

function generateMemberCode_() { return 'LM-' + Utilities.getUuid().replace(/-/g, '').substring(0, 8).toUpperCase(); }
function newMemberRecord_(identity, now) { return { line_user_id: identity.lineUserId, display_name: identity.displayName, member_code: generateMemberCode_(), tier: '一般會員', status: 'active', joined_at: now, last_login_at: now, created_at: now, updated_at: now, birthday: '', phone: '' }; }

function memberForClient_(member) {
  const serviceMinutesTotal = serviceMinutesTotalForMember_(member.line_user_id);
  const tier = membershipTierForServiceMinutes_(serviceMinutesTotal);
  return { displayName: String(member.display_name || 'LINE 使用者'), memberCode: String(member.member_code || ''), tier: tier.label, status: String(member.status || 'active'), joinedAt: String(member.joined_at || ''), birthday: String(member.birthday || ''), phone: String(member.phone || ''), profileComplete: memberProfileComplete_(member), serviceMinutesTotal, benefits: ['會員專屬活動通知', '消費可累積集點進度', '優先享有新方案與回饋'] };
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
      appendRecord_('MembershipTierSettings', { tier_key: definition.tierKey, tier_label: definition.label, required_service_minutes: String(definition.defaultRequiredServiceMinutes), updated_by: 'system', updated_at: now });
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
    return { tierKey: definition.tierKey, label: definition.label, requiredServiceMinutes, updatedAt: String(record.updated_at || '') };
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
  return 'membership:service-minutes:' + digest_(String(lineUserId || '').trim()).substring(0, 32);
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
    const validMinimum = index === 0 ? requiredServiceMinutes === 0 : requiredServiceMinutes > previousRequiredServiceMinutes;
    if (!setting || !Number.isInteger(requiredServiceMinutes) || requiredServiceMinutes < 0 || requiredServiceMinutes > MEMBERSHIP_TIER_MAX_REQUIRED_SERVICE_MINUTES_ || !validMinimum || expectedUpdatedAt.length > 80) throw new ApiError(400, 'INVALID_TIER_SETTINGS', '會員等級門檻必須由一般會員 0 分鐘開始，並依序遞增。');
    previousRequiredServiceMinutes = requiredServiceMinutes;
    return { tierKey: definition.tierKey, requiredServiceMinutes, expectedUpdatedAt };
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
    return { member: adminMemberForClient_(member.record, serviceMinutesTotalForMember_(lineUserId)) };
  }
  const member = findRecordWithRow_('Members', 'line_user_id', lineUserId); if (!member) throw new ApiError(404, 'MEMBER_NOT_FOUND', '找不到會員資料。');
  if (String(member.record.status || 'active') !== 'active') throw new ApiError(400, 'MEMBER_DISABLED', '停用中的會員無法登錄服務時間。');
  const now = nowIso_();
  appendRecord_('ServiceTimeEntries', { entry_id: 'ST-' + Utilities.getUuid().replace(/-/g, '').substring(0, 12).toUpperCase(), line_user_id: lineUserId, minutes: String(minutes), note, created_by: identity.lineUserId, created_at: now, request_id: requestId });
  clearServiceMinutesTotalCache_(lineUserId);
  appendAuditRecord_({ audit_id: Utilities.getUuid(), actor_line_user_id: identity.lineUserId, actor_role: admin.role, action: 'SERVICE_TIME_ADD', target_type: 'service_time', target_id: lineUserId, result: 'success', detail: 'Added ' + minutes + ' service minute(s)', created_at: now });
  return { member: adminMemberForClient_(member.record, serviceMinutesTotalForMember_(lineUserId)) };
}

function handleMemberGrantAdd_(identity, admin, request) {
  const lineUserId = String(request.lineUserId || '').trim(); const requestId = String(request.requestId || '').trim(); const note = String(request.note || '').trim();
  const pointsInput = request.points && !Array.isArray(request.points) && typeof request.points === 'object' ? request.points : null;
  const serviceTimeInput = request.serviceTime && !Array.isArray(request.serviceTime) && typeof request.serviceTime === 'object' ? request.serviceTime : null;
  if (!lineUserId || lineUserId.length > 80 || !requestId || !/^[A-Za-z0-9_-]{16,88}$/.test(requestId) || note.length > 160 || (!pointsInput && !serviceTimeInput)) throw new ApiError(400, 'INVALID_MEMBER_GRANT', '發放內容或請求識別碼不合法。');
  const stamp = pointsInput ? normalizeStampAddRequest_({ lineUserId, cardId: pointsInput.cardId, amount: pointsInput.amount, note, requestId: requestId + '_points' }) : null;
  const serviceTime = serviceTimeInput ? normalizeServiceMinutesAddRequest_({ lineUserId, minutes: serviceTimeInput.minutes, note, requestId: requestId + '_service' }) : null;
  return withDataLock_(function() {
    const stampResult = stamp ? addStampLocked_(identity, admin, stamp) : null;
    const serviceTimeResult = serviceTime ? addServiceMinutesLocked_(identity, admin, serviceTime) : null;
    let memberResult = serviceTimeResult && serviceTimeResult.member ? serviceTimeResult.member : null;
    if (!memberResult) {
      const member = findRecordWithRow_('Members', 'line_user_id', lineUserId); if (!member) throw new ApiError(404, 'MEMBER_NOT_FOUND', '找不到會員資料。');
      memberResult = adminMemberForClient_(member.record, serviceMinutesTotalForMember_(lineUserId));
    }
    return { member: memberResult, stamps: stampResult, serviceTime: serviceTimeResult ? { minutes: serviceTime.minutes } : null };
  });
}
