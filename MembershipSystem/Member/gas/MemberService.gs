'use strict';

const MEMBERSHIP_ADMIN_MEMBER_PAGE_SIZE_ = 100;
const MEMBERSHIP_ADMIN_MEMBER_MAX_PAGE_SIZE_ = 100;
const MEMBERSHIP_ADMIN_MEMBER_QUERY_MAX_LENGTH_ = 80;
const MEMBERSHIP_SERVICE_MINUTES_MAX_GRANT_ = 1440;

function handleMemberBootstrap_(identity) {
  const member = ensureMember_(identity);
  return { profile: memberForClient_(member) };
}

function ensureMember_(identity) {
  return withDataLock_(function() {
    const now = nowIso_();
    const match = findRecordWithRow_('Members', 'line_user_id', identity.lineUserId);
    if (!match) {
      const member = newMemberRecord_(identity, now);
      appendRecord_('Members', member);
      return member;
    }
    const member = match.record;
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
  return { displayName: String(member.display_name || 'LINE 使用者'), memberCode: String(member.member_code || ''), tier: String(member.tier || '一般會員'), status: String(member.status || 'active'), joinedAt: String(member.joined_at || ''), profileComplete: memberProfileComplete_(member), serviceMinutesTotal: serviceMinutesTotalForMember_(member.line_user_id), benefits: ['會員專屬活動通知', '消費可累積集點進度', '優先享有新方案與回饋'] };
}

function readMembers_() {
  const totalsByMember = serviceMinutesTotalsByMember_();
  return readRecords_('Members').map(function(member) { return adminMemberForClient_(member, totalsByMember[String(member.line_user_id || '')] || 0); }).sort(function(a, b) { return String(b.updatedAt).localeCompare(String(a.updatedAt)); });
}

function adminMemberForClient_(member, serviceMinutesTotal) {
  return { lineUserId: String(member.line_user_id || ''), displayName: String(member.display_name || 'LINE 使用者'), memberCode: String(member.member_code || ''), tier: String(member.tier || '一般會員'), status: String(member.status || 'active'), joinedAt: String(member.joined_at || ''), updatedAt: String(member.updated_at || ''), serviceMinutesTotal: Math.max(0, Number(serviceMinutesTotal || 0)) };
}

function memberProfileComplete_(member) { return Boolean(String(member.birthday || '').trim() && String(member.phone || '').trim()); }

function serviceMinutesTotalsByMember_() {
  return readRecords_('ServiceTimeEntries').reduce(function(totals, entry) {
    const lineUserId = String(entry.line_user_id || '').trim();
    const minutes = Number(entry.minutes || 0);
    if (lineUserId && Number.isInteger(minutes) && minutes > 0) totals[lineUserId] = (totals[lineUserId] || 0) + minutes;
    return totals;
  }, {});
}

function serviceMinutesTotalForMember_(lineUserId) { return Number(serviceMinutesTotalsByMember_()[String(lineUserId || '').trim()] || 0); }

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
  return withDataLock_(function() {
    const now = nowIso_();
    const match = findRecordWithRow_('Members', 'line_user_id', identity.lineUserId);
    const member = match ? match.record : newMemberRecord_(identity, now);
    member.display_name = identity.displayName;
    member.birthday = birthday;
    member.phone = phone;
    member.last_login_at = now;
    member.updated_at = now;
    if (match) updateRecordAtRow_('Members', match.rowNumber, member); else appendRecord_('Members', member);
    appendAuditRecord_({ audit_id: Utilities.getUuid(), actor_line_user_id: identity.lineUserId, actor_role: 'member', action: 'MEMBER_PROFILE_SAVE', target_type: 'member', target_id: identity.lineUserId, result: 'success', detail: 'Member profile contact details saved', created_at: now });
    return { profile: memberForClient_(member) };
  });
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
  const tier = String(request.tier || '').trim();
  const status = String(request.status || '').trim().toLowerCase();
  const expected = String(request.expectedUpdatedAt || '').trim();
  if (!lineUserId || lineUserId.length > 80) throw new ApiError(400, 'INVALID_MEMBER', '會員識別碼不合法。');
  if (!tier || tier.length > 40 || ['active', 'disabled'].indexOf(status) < 0) throw new ApiError(400, 'INVALID_MEMBER', '會員等級或狀態不合法。');
  return withDataLock_(function() {
    const match = findRecordWithRow_('Members', 'line_user_id', lineUserId); if (!match) throw new ApiError(404, 'MEMBER_NOT_FOUND', '找不到會員資料。');
    if (expected && String(match.record.updated_at || '') !== expected) throw new ApiError(409, 'CONFLICT', '會員資料已被更新，請重新整理。');
    const member = match.record; member.tier = tier; member.status = status; member.updated_at = nowIso_(); updateRecordAtRow_('Members', match.rowNumber, member);
    appendAuditRecord_({ audit_id: Utilities.getUuid(), actor_line_user_id: identity.lineUserId, actor_role: admin.role, action: 'MEMBER_UPDATE', target_type: 'member', target_id: lineUserId, result: 'success', detail: 'Member tier/status updated', created_at: nowIso_() });
    return { member: adminMemberForClient_(member, serviceMinutesTotalForMember_(lineUserId)) };
  });
}

function handleServiceMinutesAdd_(identity, admin, request) {
  const lineUserId = String(request.lineUserId || '').trim(); const minutes = Number(request.minutes); const note = String(request.note || '').trim(); const requestId = String(request.requestId || '').trim();
  if (!lineUserId || lineUserId.length > 80 || !Number.isInteger(minutes) || minutes < 1 || minutes > MEMBERSHIP_SERVICE_MINUTES_MAX_GRANT_ || note.length > 160) throw new ApiError(400, 'INVALID_SERVICE_TIME', '會員、服務時間或備註不合法。');
  if (requestId && !/^[A-Za-z0-9_-]{16,100}$/.test(requestId)) throw new ApiError(400, 'INVALID_REQUEST_ID', '服務時間請求識別碼不合法。');
  return withDataLock_(function() {
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
    appendAuditRecord_({ audit_id: Utilities.getUuid(), actor_line_user_id: identity.lineUserId, actor_role: admin.role, action: 'SERVICE_TIME_ADD', target_type: 'service_time', target_id: lineUserId, result: 'success', detail: 'Added ' + minutes + ' service minute(s)', created_at: now });
    return { member: adminMemberForClient_(member.record, serviceMinutesTotalForMember_(lineUserId)) };
  });
}
