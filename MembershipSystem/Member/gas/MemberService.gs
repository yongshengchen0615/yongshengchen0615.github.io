'use strict';

function handleMemberBootstrap_(identity) {
  const member = ensureMember_(identity);
  return { profile: memberForClient_(member) };
}

function ensureMember_(identity) {
  return withDataLock_(function() {
    const now = nowIso_();
    const match = findRecordWithRow_('Members', 'line_user_id', identity.lineUserId);
    if (!match) {
      const member = { line_user_id: identity.lineUserId, display_name: identity.displayName, member_code: generateMemberCode_(), tier: '一般會員', status: 'active', joined_at: now, last_login_at: now, created_at: now, updated_at: now };
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

function memberForClient_(member) {
  return { displayName: String(member.display_name || 'LINE 使用者'), memberCode: String(member.member_code || ''), tier: String(member.tier || '一般會員'), status: String(member.status || 'active'), joinedAt: String(member.joined_at || ''), benefits: ['會員專屬活動通知', '消費可累積集點進度', '優先享有新方案與回饋'] };
}

function readMembers_() {
  return readRecords_('Members').map(function(member) { return { lineUserId: String(member.line_user_id || ''), displayName: String(member.display_name || 'LINE 使用者'), memberCode: String(member.member_code || ''), tier: String(member.tier || '一般會員'), status: String(member.status || 'active'), joinedAt: String(member.joined_at || ''), updatedAt: String(member.updated_at || '') }; }).sort(function(a, b) { return String(b.updatedAt).localeCompare(String(a.updatedAt)); });
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
    return { member: { lineUserId, displayName: String(member.display_name || 'LINE 使用者'), memberCode: String(member.member_code || ''), tier: String(member.tier || ''), status: String(member.status || ''), joinedAt: String(member.joined_at || ''), updatedAt: String(member.updated_at || '') } };
  });
}
