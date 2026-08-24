'use strict';

const MEMBERS_SHEET = 'Members';
const AUDIT_SHEET = 'AuditLogs';
const USAGE_VOUCHERS_SHEET = 'UsageVouchers';
const USAGE_RECORDS_SHEET = 'UsageRecords';

const MEMBER_HEADERS = [
  'lineUserId', 'memberNo', 'displayName', 'pictureUrl', 'tier', 'membershipStatus',
  'joinedAt', 'expiresAt', 'note', 'createdAt', 'updatedAt', 'canManageMembers',
  'availableMinutes', 'consumedMinutes'
];
const AUDIT_HEADERS = ['timestamp', 'actorLineUserId', 'actorRole', 'action', 'targetLineUserId', 'result', 'details'];
// Legacy redemption columns are retained to preserve already-issued QR rows.
const USAGE_VOUCHER_HEADERS = [
  'voucherId', 'tokenHash', 'targetLineUserId', 'targetMemberNo', 'minutes', 'status',
  'expiresAt', 'note', 'createdByLineUserId', 'createdAt', 'updatedAt', 'processingAt',
  'redeemedByLineUserId', 'redeemedAt', 'cancelledByLineUserId', 'cancelledAt',
  'balanceBeforeMinutes', 'balanceAfterMinutes', 'consumedBeforeMinutes',
  'consumedAfterMinutes', 'auditRecordedAt', 'scanMode', 'shareCode'
];
const USAGE_RECORD_HEADERS = [
  'recordId', 'requestId', 'voucherId', 'memberLineUserId', 'memberNo', 'minutes',
  'status', 'createdAt', 'updatedAt', 'consumedBeforeMinutes', 'consumedAfterMinutes',
  'recordedAt', 'auditRecordedAt'
];

const ALLOWED_TIERS = ['standard', 'silver', 'gold', 'platinum'];
const ALLOWED_MEMBERSHIP_STATUS = ['active', 'suspended', 'disabled'];
const ALLOWED_SCAN_MODES = ['single', 'repeatable'];
const MAX_USAGE_MINUTES = 60000;
// Public LINE Login channel identifier for LIFF app 2010787602-WceTV9tT.
// This is an expected token audience, not a secret.
const LINE_LOGIN_CHANNEL_ID = '2010787602';
const LINE_IDENTITY_CACHE_MAX_SECONDS = 300;
const LINE_IDENTITY_EXPIRY_SKEW_SECONDS = 15;

// These caches are reset at the beginning of every Web App request. They only
// reuse Apps Script service objects / derived reads inside the current request.
let requestSpreadsheet_ = null;
let requestSheets_ = {};
let requestUsageRecordCounts_ = null;

function doGet() {
  return json_({ ok: true, data: { service: 'MembershipSystem', version: '1.9.0' } });
}

function doPost(e) {
  resetRequestCaches_();
  try {
    const action = cleanText_(e && e.parameter && e.parameter.action, 60, true);
    const idToken = cleanText_(e && e.parameter && e.parameter.idToken, 4096, true);
    const tokenFingerprint = rateLimitByToken_(idToken);
    const identity = verifyLineIdToken_(idToken, tokenFingerprint);
    // Authorization is intentionally lazy. Member APIs do not need an extra
    // Members Sheet lookup just to compute an admin flag they never use.
    const context = { identity: identity, isAdmin: null };
    const payload = parsePayload_(e && e.parameter && e.parameter.payload);

    switch (action) {
      case 'member.me':
        return json_({ ok: true, data: memberMe_(context) });
      case 'member.minutes.grants.list':
        rateLimit_('member-minute-grants:' + context.identity.sub, 20, 60);
        return json_({ ok: true, data: memberMinuteGrantsList_(context, payload) });
      case 'profile.update':
        rateLimit_('profile-update:' + context.identity.sub, 10, 60);
        return json_({ ok: true, data: profileUpdate_(context, payload) });
      case 'usage.preview':
        rateLimit_('usage-preview:' + context.identity.sub, 30, 60);
        return json_({ ok: true, data: usagePreview_(context, payload) });
      case 'usage.record':
      case 'usage.redeem': // compatibility only: old frontend now records time and never deducts a balance.
        rateLimit_('usage-record:' + context.identity.sub, 10, 60);
        return json_({ ok: true, data: usageRecord_(context, payload) });
      case 'admin.dashboard':
        requireAdmin_(context);
        rateLimit_('admin-dashboard:' + context.identity.sub, 30, 60);
        return json_({ ok: true, data: adminDashboard_(payload) });
      case 'admin.list':
        requireAdmin_(context);
        rateLimit_('admin-list:' + context.identity.sub, 30, 60);
        return json_({ ok: true, data: adminList_(payload) });
      case 'admin.update':
        requireAdmin_(context);
        rateLimit_('admin-update:' + context.identity.sub, 20, 60);
        return json_({ ok: true, data: adminUpdate_(context, payload) });
      case 'admin.minutes.grant':
        requireAdmin_(context);
        rateLimit_('admin-minute-grant:' + context.identity.sub, 10, 60);
        return json_({ ok: true, data: adminMinuteGrant_(context, payload) });
      case 'admin.minutes.grants.list':
        requireAdmin_(context);
        rateLimit_('admin-minute-grants-list:' + context.identity.sub, 30, 60);
        return json_({ ok: true, data: adminMinuteGrantsList_(payload) });
      case 'admin.minutes.push.retry':
        requireAdmin_(context);
        rateLimit_('admin-minute-push-retry:' + context.identity.sub, 10, 60);
        return json_({ ok: true, data: adminMinuteGrantRetryPush_(context, payload) });
      case 'admin.tier.get':
        requireAdmin_(context);
        rateLimit_('admin-tier-get:' + context.identity.sub, 30, 60);
        return json_({ ok: true, data: adminTierGet_(context) });
      case 'admin.tier.update':
        requireAdmin_(context);
        rateLimit_('admin-tier-update:' + context.identity.sub, 10, 60);
        return json_({ ok: true, data: adminTierUpdate_(context, payload) });
      case 'admin.usage.list':
        requireAdmin_(context);
        rateLimit_('admin-usage-list:' + context.identity.sub, 30, 60);
        return json_({ ok: true, data: adminUsageList_(payload) });
      case 'admin.usage.create':
        requireAdmin_(context);
        rateLimit_('admin-usage-create:' + context.identity.sub, 20, 60);
        return json_({ ok: true, data: adminUsageCreate_(context, payload) });
      case 'admin.usage.update':
        requireAdmin_(context);
        rateLimit_('admin-usage-update:' + context.identity.sub, 20, 60);
        return json_({ ok: true, data: adminUsageUpdate_(context, payload) });
      case 'admin.usage.open':
        requireAdmin_(context);
        rateLimit_('admin-usage-open:' + context.identity.sub, 30, 60);
        return json_({ ok: true, data: adminUsageOpen_(context, payload) });
      case 'admin.usage.cancel':
        requireAdmin_(context);
        rateLimit_('admin-usage-cancel:' + context.identity.sub, 30, 60);
        return json_({ ok: true, data: adminUsageCancel_(context, payload) });
      case 'admin.usage.delete':
        requireAdmin_(context);
        rateLimit_('admin-usage-delete:' + context.identity.sub, 20, 60);
        return json_({ ok: true, data: adminUsageDelete_(context, payload) });
      default:
        fail_('INVALID_ACTION', '不支援的操作。');
    }
  } catch (error) {
    if (!error || !error.publicCode) {
      console.error('Unhandled membership API error');
      return json_({ ok: false, error: { code: 'INTERNAL_ERROR', message: '會員服務暫時無法處理此要求。' } });
    }
    return json_({ ok: false, error: { code: error.publicCode, message: error.publicMessage } });
  }
}

function memberMe_(context) {
  const sheet = getMembersSheet_();
  const row = findMemberRow_(sheet, context.identity.sub);
  let member;
  if (!row) {
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(5000)) fail_('BUSY', '系統忙碌中，請稍後再試。');
    try {
      const existingRow = findMemberRow_(sheet, context.identity.sub);
      if (existingRow) {
        member = rowToMember_(sheet.getRange(existingRow, 1, 1, MEMBER_HEADERS.length).getValues()[0]);
      } else {
        const now = new Date().toISOString();
        member = {
          lineUserId: context.identity.sub,
          memberNo: nextMemberNo_(sheet),
          displayName: cleanText_(context.identity.name || 'LINE 會員', 80, false),
          pictureUrl: safePictureUrl_(context.identity.picture),
          tier: 'standard', membershipStatus: 'active', joinedAt: now, expiresAt: '', note: '',
          createdAt: now, updatedAt: now, canManageMembers: false,
          availableMinutes: 0,
          consumedMinutes: 0
        };
        sheet.appendRow(memberToRow_(member));
        audit_(context.identity.sub, 'member', 'MEMBER_CREATED', context.identity.sub, 'success', { memberNo: member.memberNo });
      }
    } finally { lock.releaseLock(); }
  } else {
    member = rowToMember_(sheet.getRange(row, 1, 1, MEMBER_HEADERS.length).getValues()[0]);
    const displayName = cleanText_(context.identity.name || member.displayName || 'LINE 會員', 80, false);
    const pictureUrl = safePictureUrl_(context.identity.picture);
    const tier = tierForConsumedMinutes_(member.consumedMinutes);
    if (displayName !== member.displayName || pictureUrl !== member.pictureUrl || tier !== normalizeTier_(member.tier)) {
      member.displayName = displayName;
      member.pictureUrl = pictureUrl;
      member.tier = tier;
      member.updatedAt = new Date().toISOString();
      sheet.getRange(row, 1, 1, MEMBER_HEADERS.length).setValues([memberToRow_(member)]);
    }
  }
  member.tier = tierForConsumedMinutes_(member.consumedMinutes);
  const profile = getProfileByLineUserId_(context.identity.sub);
  return {
    member: publicMember_(member, false),
    profile: publicProfile_(profile),
    profileRequired: !isProfileComplete_(profile),
    isAdmin: hasManageMembersPermission_(member.canManageMembers)
  };
}

function adminDashboard_(payload) {
  const memberResult = adminList_({
    query: payload.query || '',
    page: payload.page || 1,
    pageSize: payload.pageSize || 100
  });
  const voucherResult = adminUsageList_({ limit: payload.voucherLimit || 50 });
  return {
    members: memberResult.members,
    total: memberResult.total,
    page: memberResult.page,
    pageSize: memberResult.pageSize,
    stats: memberResult.stats,
    thresholds: getTierThresholds_(),
    vouchers: voucherResult.vouchers
  };
}

function adminList_(payload) {
  const sheet = getMembersSheet_();
  const query = cleanText_(payload.query || '', 80, false).toLowerCase();
  const page = clampInt_(payload.page, 1, 100000, 1);
  const pageSize = clampInt_(payload.pageSize, 1, 100, 50);
  const rows = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, MEMBER_HEADERS.length).getValues() : [];
  const thresholds = getTierThresholds_();
  const allMembers = rows.map(function (row) {
    const member = rowToMember_(row);
    member.tier = tierForConsumedMinutes_(member.consumedMinutes, thresholds);
    return member;
  });
  const stats = allMembers.reduce(function (acc, member) {
    acc.total += 1;
    acc.consumedMinutes += member.consumedMinutes;
    if (member.membershipStatus === 'active') acc.active += 1;
    if (member.membershipStatus === 'suspended') acc.suspended += 1;
    if (member.membershipStatus === 'disabled') acc.disabled += 1;
    return acc;
  }, { total: 0, active: 0, suspended: 0, disabled: 0, consumedMinutes: 0 });
  const filtered = query ? allMembers.filter(function (member) {
    return member.memberNo.toLowerCase().indexOf(query) !== -1 || member.displayName.toLowerCase().indexOf(query) !== -1;
  }) : allMembers;
  filtered.sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
  const start = (page - 1) * pageSize;
  return {
    members: filtered.slice(start, start + pageSize).map(function (member) { return publicMember_(member, true); }),
    total: filtered.length, page: page, pageSize: pageSize, stats: stats
  };
}

function adminUpdate_(context, payload) {
  const targetMemberNo = cleanText_(payload.targetMemberNo, 24, true);
  const expectedUpdatedAt = cleanText_(payload.expectedUpdatedAt, 40, true);
  const membershipStatus = enumValue_(payload.membershipStatus, ALLOWED_MEMBERSHIP_STATUS, 'INVALID_STATUS', '會員狀態不正確。');
  const expiresAt = validateDate_(payload.expiresAt || '');
  const note = cleanText_(payload.note || '', 500, false);
  const sheet = getMembersSheet_();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) fail_('BUSY', '系統忙碌中，請稍後再試。');
  try {
    const row = findMemberRowByMemberNo_(sheet, targetMemberNo);
    if (!row) fail_('MEMBER_NOT_FOUND', '找不到指定會員。');
    const member = rowToMember_(sheet.getRange(row, 1, 1, MEMBER_HEADERS.length).getValues()[0]);
    if (String(member.updatedAt) !== expectedUpdatedAt) fail_('CONFLICT', '會員資料已被其他操作更新，請重新整理後再試。');
    const tier = tierForConsumedMinutes_(member.consumedMinutes);
    const changedFields = [];
    if (normalizeTier_(member.tier) !== tier) changedFields.push('tier');
    if (member.membershipStatus !== membershipStatus) changedFields.push('membershipStatus');
    if (String(member.expiresAt || '').slice(0, 10) !== expiresAt) changedFields.push('expiresAt');
    if (member.note !== note) changedFields.push('note');
    member.tier = tier;
    member.membershipStatus = membershipStatus;
    member.expiresAt = expiresAt;
    member.note = note;
    member.updatedAt = new Date().toISOString();
    sheet.getRange(row, 1, 1, MEMBER_HEADERS.length).setValues([memberToRow_(member)]);
    audit_(context.identity.sub, 'admin', 'MEMBER_UPDATED', member.lineUserId, 'success', { memberNo: member.memberNo, fields: changedFields });
    return { member: publicMember_(member, true) };
  } finally { lock.releaseLock(); }
}

function adminUsageList_(payload) {
  const limit = clampInt_(payload.limit, 1, 100, 50);
  const sheet = getUsageVouchersSheet_();
  const rows = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, USAGE_VOUCHER_HEADERS.length).getValues() : [];
  const counts = usageRecordCounts_();
  const vouchers = rows.map(rowToUsageVoucher_);
  vouchers.sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
  return { vouchers: vouchers.slice(0, limit).map(function (voucher) { return publicUsageVoucher_(voucher, counts[voucher.voucherId] || 0); }) };
}

function adminUsageCreate_(context, payload) {
  const minutes = validateMinutes_(payload.minutes, false);
  const scanMode = enumValue_(payload.scanMode, ALLOWED_SCAN_MODES, 'INVALID_SCAN_MODE', '掃描模式不正確。');
  const expiresAt = validateVoucherExpiry_(payload.expiresAt);
  const note = cleanText_(payload.note || '', 200, false);
  const sheet = getUsageVouchersSheet_();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) fail_('BUSY', '系統忙碌中，請稍後再試。');
  try {
    const now = new Date().toISOString();
    const shareCode = randomUsageCode_();
    const voucher = {
      voucherId: nextVoucherId_(), tokenHash: hashUsageCode_(shareCode), targetLineUserId: '', targetMemberNo: '',
      minutes: minutes, status: 'issued', expiresAt: expiresAt, note: note,
      createdByLineUserId: context.identity.sub, createdAt: now, updatedAt: now,
      processingAt: '', redeemedByLineUserId: '', redeemedAt: '', cancelledByLineUserId: '', cancelledAt: '',
      balanceBeforeMinutes: 0, balanceAfterMinutes: 0, consumedBeforeMinutes: 0, consumedAfterMinutes: 0,
      auditRecordedAt: '', scanMode: scanMode, shareCode: shareCode
    };
    sheet.appendRow(usageVoucherToRow_(voucher));
    audit_(context.identity.sub, 'admin', 'USAGE_QR_CREATED', '', 'success', {
      voucherId: voucher.voucherId, minutes: minutes, scanMode: scanMode, expiresAt: expiresAt
    });
    return { voucher: publicUsageVoucher_(voucher, 0), shareCode: shareCode };
  } finally { lock.releaseLock(); }
}

function adminUsageOpen_(context, payload) {
  const voucherId = cleanText_(payload.voucherId, 40, true);
  const sheet = getUsageVouchersSheet_();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) fail_('BUSY', '系統忙碌中，請稍後再試。');
  try {
    const row = findUsageVoucherRowById_(sheet, voucherId);
    if (!row) fail_('VOUCHER_NOT_FOUND', '找不到指定 QR Code。');
    const voucher = rowToUsageVoucher_(sheet.getRange(row, 1, 1, USAGE_VOUCHER_HEADERS.length).getValues()[0]);
    if (!voucher.shareCode) {
      voucher.shareCode = randomUsageCode_();
      voucher.updatedAt = new Date().toISOString();
      writeUsageVoucher_(sheet, row, voucher);
      audit_(context.identity.sub, 'admin', 'USAGE_QR_SHARE_CODE_CREATED', '', 'success', { voucherId: voucher.voucherId });
    }
    return { voucher: publicUsageVoucher_(voucher, countUsageRecords_(voucher.voucherId)), shareCode: voucher.shareCode };
  } finally { lock.releaseLock(); }
}

function adminUsageCancel_(context, payload) {
  const voucherId = cleanText_(payload.voucherId, 40, true);
  const sheet = getUsageVouchersSheet_();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) fail_('BUSY', '系統忙碌中，請稍後再試。');
  try {
    const row = findUsageVoucherRowById_(sheet, voucherId);
    if (!row) fail_('VOUCHER_NOT_FOUND', '找不到指定 QR Code。');
    const voucher = rowToUsageVoucher_(sheet.getRange(row, 1, 1, USAGE_VOUCHER_HEADERS.length).getValues()[0]);
    const recordsSheet = getUsageRecordsSheet_();
    const pendingRow = findProcessingUsageRecordRowByVoucher_(recordsSheet, voucher.voucherId);
    if (pendingRow) {
      const pending = rowToUsageRecord_(recordsSheet.getRange(pendingRow, 1, 1, USAGE_RECORD_HEADERS.length).getValues()[0]);
      recoverUsageRecord_(recordsSheet, pendingRow, pending, getMembersSheet_(), sheet, row, voucher);
    }
    if (voucher.status === 'cancelled') return { voucher: publicUsageVoucher_(voucher, countUsageRecords_(voucher.voucherId)) };
    if (voucherScanMode_(voucher) === 'single' && countUsageRecords_(voucher.voucherId) > 0) fail_('VOUCHER_USED', '此單次 QR Code 已完成一次消費時間記錄。');
    const now = new Date().toISOString();
    voucher.status = 'cancelled';
    voucher.cancelledByLineUserId = context.identity.sub;
    voucher.cancelledAt = now;
    voucher.updatedAt = now;
    writeUsageVoucher_(sheet, row, voucher);
    audit_(context.identity.sub, 'admin', 'USAGE_QR_CANCELLED', '', 'success', { voucherId: voucher.voucherId });
    return { voucher: publicUsageVoucher_(voucher, countUsageRecords_(voucher.voucherId)) };
  } finally { lock.releaseLock(); }
}

function usagePreview_(context, payload) {
  requireProfileComplete_(context.identity.sub);
  const access = readUsageAccess_(payload);
  const located = findUsageVoucherByAccess_(access);
  if (!located.row) fail_('INVALID_USAGE_QR', '消費時間 QR Code 無效或已失效。');
  const voucher = located.voucher;
  if (isLegacyTargetedVoucher_(voucher)) requireVoucherTarget_(voucher, context.identity.sub);
  const recordCount = countUsageRecords_(voucher.voucherId);
  requireUsageVoucherUsable_(voucher, recordCount);
  const member = getMemberByLineUserId_(context.identity.sub);
  if (!member || !isMembershipUsable_(member)) fail_('MEMBERSHIP_INACTIVE', '目前會員狀態不可記錄消費時間。');
  member.tier = tierForConsumedMinutes_(member.consumedMinutes);
  return { voucher: publicUsageVoucher_(voucher, recordCount), member: publicMember_(member, false) };
}

function usageRecord_(context, payload) {
  requireProfileComplete_(context.identity.sub);
  const access = readUsageAccess_(payload);
  const requestId = cleanUsageRequestId_(payload.requestId);
  const vouchersSheet = getUsageVouchersSheet_();
  const recordsSheet = getUsageRecordsSheet_();
  const membersSheet = getMembersSheet_();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) fail_('BUSY', '系統忙碌中，請稍後再試。');
  try {
    // Resolve the bearer code only after acquiring the same lock used by
    // deletion. A pre-lock numeric row can become stale when deleteRow()
    // shifts subsequent vouchers upward.
    const located = findUsageVoucherByAccess_(access);
    if (!located.row) fail_('INVALID_USAGE_QR', '消費時間 QR Code 無效或已失效。');
    const voucher = rowToUsageVoucher_(vouchersSheet.getRange(located.row, 1, 1, USAGE_VOUCHER_HEADERS.length).getValues()[0]);
    if (isLegacyTargetedVoucher_(voucher)) requireVoucherTarget_(voucher, context.identity.sub);

    const pendingRow = findProcessingUsageRecordRowByVoucher_(recordsSheet, voucher.voucherId);
    if (pendingRow) {
      const pending = rowToUsageRecord_(recordsSheet.getRange(pendingRow, 1, 1, USAGE_RECORD_HEADERS.length).getValues()[0]);
      const sameRequest = pending.requestId === requestId && pending.memberLineUserId === context.identity.sub;
      if (!sameRequest) {
        recoverUsageRecord_(recordsSheet, pendingRow, pending, membersSheet, vouchersSheet, located.row, voucher);
        if (voucherScanMode_(voucher) === 'single') fail_('USAGE_QR_USED', '此單次 QR Code 已完成消費時間記錄。');
      }
    }

    const existingRow = findUsageRecordRowByRequestId_(recordsSheet, requestId);
    if (existingRow) {
      const existing = rowToUsageRecord_(recordsSheet.getRange(existingRow, 1, 1, USAGE_RECORD_HEADERS.length).getValues()[0]);
      if (existing.voucherId !== voucher.voucherId || existing.memberLineUserId !== context.identity.sub) {
        fail_('INVALID_USAGE_REQUEST', '消費時間記錄要求無效，請重新掃描 QR Code。');
      }
      return recoverOrReturnUsageRecord_(recordsSheet, existingRow, existing, membersSheet, vouchersSheet, located.row, voucher);
    }

    const recordCount = countUsageRecords_(voucher.voucherId);
    requireUsageVoucherUsable_(voucher, recordCount);
    const memberRow = findMemberRow_(membersSheet, context.identity.sub);
    if (!memberRow) fail_('MEMBER_NOT_FOUND', '找不到會員資料。');
    const member = rowToMember_(membersSheet.getRange(memberRow, 1, 1, MEMBER_HEADERS.length).getValues()[0]);
    if (!isMembershipUsable_(member)) fail_('MEMBERSHIP_INACTIVE', '目前會員狀態不可記錄消費時間。');

    const now = new Date().toISOString();
    const record = {
      recordId: nextUsageRecordId_(), requestId: requestId, voucherId: voucher.voucherId,
      memberLineUserId: context.identity.sub, memberNo: member.memberNo, minutes: voucher.minutes,
      status: 'processing', createdAt: now, updatedAt: now,
      consumedBeforeMinutes: member.consumedMinutes,
      consumedAfterMinutes: member.consumedMinutes + voucher.minutes,
      recordedAt: '', auditRecordedAt: ''
    };
    recordsSheet.appendRow(usageRecordToRow_(record));
    const recordRow = recordsSheet.getLastRow();

    member.consumedMinutes = record.consumedAfterMinutes;
    member.tier = tierForConsumedMinutes_(member.consumedMinutes);
    member.updatedAt = new Date().toISOString();
    membersSheet.getRange(memberRow, 1, 1, MEMBER_HEADERS.length).setValues([memberToRow_(member)]);

    record.status = 'recorded';
    record.recordedAt = new Date().toISOString();
    record.updatedAt = record.recordedAt;
    writeUsageRecord_(recordsSheet, recordRow, record);
    invalidateUsageRecordCounts_();
    finalizeVoucherAfterRecord_(vouchersSheet, located.row, voucher, record);
    ensureUsageRecordAudit_(recordsSheet, recordRow, record, voucher);

    return {
      voucher: publicUsageVoucher_(voucher, recordCount + 1),
      member: publicMember_(member, false),
      record: publicUsageRecord_(record),
      alreadyRecorded: false
    };
  } finally { lock.releaseLock(); }
}

function recoverOrReturnUsageRecord_(recordsSheet, recordRow, record, membersSheet, vouchersSheet, voucherRow, voucher) {
  const member = recoverUsageRecord_(recordsSheet, recordRow, record, membersSheet, vouchersSheet, voucherRow, voucher);
  return {
    voucher: publicUsageVoucher_(voucher, countUsageRecords_(voucher.voucherId)),
    member: publicMember_(member, false), record: publicUsageRecord_(record),
    alreadyRecorded: true, recovered: true
  };
}

function recoverUsageRecord_(recordsSheet, recordRow, record, membersSheet, vouchersSheet, voucherRow, voucher) {
  const memberRow = findMemberRow_(membersSheet, record.memberLineUserId);
  if (!memberRow) fail_('USAGE_RECORD_CONFLICT', '消費時間記錄的會員資料不存在，請聯絡管理員。');
  const member = rowToMember_(membersSheet.getRange(memberRow, 1, 1, MEMBER_HEADERS.length).getValues()[0]);
  if (record.status === 'processing') {
    if (member.consumedMinutes === record.consumedBeforeMinutes) {
      member.consumedMinutes = record.consumedAfterMinutes;
      member.tier = tierForConsumedMinutes_(member.consumedMinutes);
      member.updatedAt = new Date().toISOString();
      membersSheet.getRange(memberRow, 1, 1, MEMBER_HEADERS.length).setValues([memberToRow_(member)]);
    } else if (member.consumedMinutes !== record.consumedAfterMinutes) {
      fail_('USAGE_RECORD_CONFLICT', '消費時間記錄狀態不一致，請聯絡管理員確認。');
    }
    record.status = 'recorded';
    record.recordedAt = record.recordedAt || new Date().toISOString();
    record.updatedAt = new Date().toISOString();
    writeUsageRecord_(recordsSheet, recordRow, record);
    invalidateUsageRecordCounts_();
    finalizeVoucherAfterRecord_(vouchersSheet, voucherRow, voucher, record);
  } else if (record.status !== 'recorded') {
    fail_('USAGE_RECORD_CONFLICT', '消費時間記錄狀態不正確。');
  }
  member.tier = tierForConsumedMinutes_(member.consumedMinutes);
  ensureUsageRecordAudit_(recordsSheet, recordRow, record, voucher);
  return member;
}

function finalizeVoucherAfterRecord_(sheet, row, voucher, record) {
  if (voucherScanMode_(voucher) === 'single') {
    voucher.status = 'redeemed';
    voucher.redeemedByLineUserId = record.memberLineUserId;
    voucher.redeemedAt = record.recordedAt;
  }
  voucher.updatedAt = new Date().toISOString();
  writeUsageVoucher_(sheet, row, voucher);
}

function ensureUsageRecordAudit_(sheet, row, record, voucher) {
  if (record.auditRecordedAt) return;
  const written = audit_(record.memberLineUserId, 'member', 'USAGE_TIME_RECORDED', record.memberLineUserId, 'success', {
    recordId: record.recordId, voucherId: voucher.voucherId, memberNo: record.memberNo,
    minutes: record.minutes, scanMode: voucherScanMode_(voucher), consumedAfterMinutes: record.consumedAfterMinutes
  });
  if (!written) return;
  record.auditRecordedAt = new Date().toISOString();
  record.updatedAt = record.auditRecordedAt;
  writeUsageRecord_(sheet, row, record);
}

function readUsageAccess_(payload) {
  const code = cleanOptionalUsageCode_(payload.code || '');
  const token = cleanOptionalUsageCode_(payload.token || '');
  if (!code && !token) fail_('INVALID_USAGE_QR', '缺少消費時間 QR Code。');
  return { code: code, token: token };
}

function findUsageVoucherByAccess_(access) {
  const sheet = getUsageVouchersSheet_();
  if (sheet.getLastRow() <= 1) return { row: 0, voucher: null };

  let row = 0;
  if (access.code) {
    row = findExactValueRow_(sheet, USAGE_VOUCHER_HEADERS.indexOf('shareCode') + 1, access.code);
  } else if (access.token) {
    row = findExactValueRow_(sheet, USAGE_VOUCHER_HEADERS.indexOf('tokenHash') + 1, hashUsageCode_(access.token));
  }
  if (!row) return { row: 0, voucher: null };
  return {
    row: row,
    voucher: rowToUsageVoucher_(sheet.getRange(row, 1, 1, USAGE_VOUCHER_HEADERS.length).getValues()[0])
  };
}

function requireUsageVoucherUsable_(voucher, recordCount) {
  const status = effectiveVoucherStatus_(voucher, recordCount);
  if (status === 'expired') fail_('USAGE_QR_EXPIRED', '此消費時間 QR Code 已過期。');
  if (status === 'cancelled') fail_('USAGE_QR_CANCELLED', '此消費時間 QR Code 已停止使用。');
  if (status === 'redeemed') fail_('USAGE_QR_USED', '此單次 QR Code 已完成消費時間記錄。');
}

function requireVoucherTarget_(voucher, lineUserId) {
  if (!voucher.targetLineUserId || voucher.targetLineUserId !== lineUserId) fail_('INVALID_USAGE_QR', '此舊版 QR Code 不適用於目前會員。');
}

function isLegacyTargetedVoucher_(voucher) {
  return !voucher.scanMode && Boolean(voucher.targetLineUserId);
}

function voucherScanMode_(voucher) {
  const value = String(voucher.scanMode || '').toLowerCase();
  return ALLOWED_SCAN_MODES.indexOf(value) !== -1 ? value : 'single';
}

function effectiveVoucherStatus_(voucher, recordCount) {
  if (voucher.status === 'cancelled') return 'cancelled';
  if (voucher.expiresAt) {
    const expiresAt = Date.parse(voucher.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return 'expired';
  }
  if (voucherScanMode_(voucher) === 'single' && (recordCount > 0 || voucher.status === 'redeemed')) return 'redeemed';
  return 'issued';
}

function usageRecordCounts_() {
  if (requestUsageRecordCounts_) return requestUsageRecordCounts_;
  const sheet = getUsageRecordsSheet_();
  const counts = {};
  if (sheet.getLastRow() > 1) {
    const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, USAGE_RECORD_HEADERS.length).getValues();
    rows.map(rowToUsageRecord_).forEach(function (record) {
      if (record.status !== 'recorded') return;
      counts[record.voucherId] = (counts[record.voucherId] || 0) + 1;
    });
  }
  requestUsageRecordCounts_ = counts;
  return requestUsageRecordCounts_;
}

function invalidateUsageRecordCounts_() { requestUsageRecordCounts_ = null; }
function countUsageRecords_(voucherId) { return usageRecordCounts_()[voucherId] || 0; }

function isMembershipUsable_(member) {
  if (!member || member.membershipStatus !== 'active') return false;
  if (!member.expiresAt) return true;
  const today = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd');
  return String(member.expiresAt).slice(0, 10) >= today;
}

function verifyLineIdToken_(idToken, tokenFingerprint) {
  const clientId = LINE_LOGIN_CHANNEL_ID;
  const fingerprint = tokenFingerprint || tokenFingerprint_(idToken);
  const cache = CacheService.getScriptCache();
  const cacheKey = 'line-id:v1:' + fingerprint;
  const cached = readCachedLineIdentity_(cache.get(cacheKey), clientId);
  if (cached) return cached;

  const response = UrlFetchApp.fetch('https://api.line.me/oauth2/v2.1/verify', {
    method: 'post', contentType: 'application/x-www-form-urlencoded',
    payload: { id_token: idToken, client_id: clientId }, muteHttpExceptions: true
  });

  let result = {};
  try { result = JSON.parse(response.getContentText() || '{}'); }
  catch (_) { result = {}; }

  if (response.getResponseCode() !== 200) {
    const description = String(result.error_description || '');
    if (description === 'Invalid IdToken Audience.') {
      fail_('LINE_CHANNEL_MISMATCH', 'LINE Login Channel 設定不一致，請聯絡管理員。');
    }
    if (description === 'IdToken expired.') {
      fail_('UNAUTHENTICATED', 'LINE 登入已過期，請重新開啟頁面登入。');
    }
    fail_('UNAUTHENTICATED', 'LINE 登入驗證失敗，請重新開啟頁面登入。');
  }

  if (!result || !result.sub || String(result.aud) !== clientId) {
    fail_('LINE_CHANNEL_MISMATCH', 'LINE Login Channel 設定不一致，請聯絡管理員。');
  }

  const identity = sanitizedLineIdentity_(result);
  cacheVerifiedLineIdentity_(cache, cacheKey, identity);
  return identity;
}

function sanitizedLineIdentity_(result) {
  return {
    sub: String(result.sub || ''),
    aud: String(result.aud || ''),
    exp: Number(result.exp || 0),
    iat: Number(result.iat || 0),
    name: cleanText_(result.name || '', 80, false),
    picture: safePictureUrl_(result.picture || '')
  };
}

function readCachedLineIdentity_(raw, clientId) {
  if (!raw) return null;
  try {
    const identity = JSON.parse(raw);
    const now = Math.floor(Date.now() / 1000);
    if (!identity || !identity.sub || String(identity.aud) !== clientId) return null;
    if (!Number.isFinite(Number(identity.exp)) || Number(identity.exp) <= now + LINE_IDENTITY_EXPIRY_SKEW_SECONDS) return null;
    return identity;
  } catch (_) {
    return null;
  }
}

function cacheVerifiedLineIdentity_(cache, cacheKey, identity) {
  const now = Math.floor(Date.now() / 1000);
  const remaining = Math.floor(Number(identity.exp) - now - LINE_IDENTITY_EXPIRY_SKEW_SECONDS);
  const ttl = Math.min(LINE_IDENTITY_CACHE_MAX_SECONDS, remaining);
  if (ttl < 1) return;
  try { cache.put(cacheKey, JSON.stringify(identity), ttl); }
  catch (_) { /* CacheService is an optimization only. */ }
}

function requireAdmin_(context) {
  if (context.isAdmin == null) context.isAdmin = isAdmin_(context.identity.sub);
  if (!context.isAdmin) fail_('FORBIDDEN', '你沒有會員管理權限。');
}

function isAdmin_(lineUserId) {
  const sheet = getMembersSheet_();
  const row = findMemberRow_(sheet, lineUserId);
  if (!row) return false;
  return hasManageMembersPermission_(rowToMember_(sheet.getRange(row, 1, 1, MEMBER_HEADERS.length).getValues()[0]).canManageMembers);
}

function hasManageMembersPermission_(value) {
  if (value === true) return true;
  return String(value == null ? '' : value).trim().toLowerCase() === 'true';
}

function resetRequestCaches_() {
  requestSpreadsheet_ = null;
  requestSheets_ = {};
  requestUsageRecordCounts_ = null;
}

function getSpreadsheet_() {
  if (requestSpreadsheet_) return requestSpreadsheet_;
  const id = cleanText_(PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID'), 160, true);
  try {
    requestSpreadsheet_ = SpreadsheetApp.openById(id);
    return requestSpreadsheet_;
  } catch (_) {
    fail_('CONFIG_ERROR', '會員資料庫尚未正確設定。');
  }
}

function getCachedSheet_(name, headers) {
  if (requestSheets_[name]) return requestSheets_[name];
  const sheet = ensureSheet_(getSpreadsheet_(), name, headers);
  requestSheets_[name] = sheet;
  return sheet;
}

function getMembersSheet_() { return getCachedSheet_(MEMBERS_SHEET, MEMBER_HEADERS); }
function getAuditSheet_() { return getCachedSheet_(AUDIT_SHEET, AUDIT_HEADERS); }
function getUsageVouchersSheet_() { return getCachedSheet_(USAGE_VOUCHERS_SHEET, USAGE_VOUCHER_HEADERS); }
function getUsageRecordsSheet_() { return getCachedSheet_(USAGE_RECORDS_SHEET, USAGE_RECORD_HEADERS); }

function ensureSheet_(spreadsheet, name, headers) {
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(name);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    return sheet;
  }

  const lastColumn = sheet.getLastColumn();
  if (lastColumn === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    return sheet;
  }

  // Common path: validate all expected headers with one batched read instead of
  // one Spreadsheet service call per column.
  const width = Math.max(lastColumn, headers.length);
  const currentHeaders = sheet.getRange(1, 1, 1, width).getValues()[0].map(function (value) {
    return String(value || '').trim();
  });
  let exact = true;
  for (let i = 0; i < headers.length; i += 1) {
    if (currentHeaders[i] !== headers[i]) { exact = false; break; }
  }
  if (exact) return sheet;

  // Migration path: preserve the existing compatibility behavior, but work
  // from the already-fetched header array and only call Sheets when inserting.
  headers.forEach(function (header, index) {
    if (currentHeaders[index] === header) return;
    if (currentHeaders.indexOf(header, index + 1) !== -1) {
      fail_('SCHEMA_ERROR', name + ' 工作表的必要欄位順序不正確：' + header);
    }
    const column = index + 1;
    sheet.insertColumnBefore(column);
    sheet.getRange(1, column).setValue(header);
    currentHeaders.splice(index, 0, header);
  });
  sheet.setFrozenRows(1);
  return sheet;
}

function findExactValueRow_(sheet, column, value) {
  if (sheet.getLastRow() <= 1) return 0;
  const found = sheet.getRange(2, column, sheet.getLastRow() - 1, 1)
    .createTextFinder(value).matchEntireCell(true).findNext();
  return found ? found.getRow() : 0;
}

function findMemberRow_(sheet, lineUserId) { return findExactValueRow_(sheet, 1, lineUserId); }
function findMemberRowByMemberNo_(sheet, memberNo) { return findExactValueRow_(sheet, 2, memberNo); }
function getMemberByLineUserId_(lineUserId) {
  const sheet = getMembersSheet_();
  const row = findMemberRow_(sheet, lineUserId);
  return row ? rowToMember_(sheet.getRange(row, 1, 1, MEMBER_HEADERS.length).getValues()[0]) : null;
}
function findUsageVoucherRowById_(sheet, voucherId) { return findExactValueRow_(sheet, 1, voucherId); }
function findUsageRecordRowByRequestId_(sheet, requestId) { return findExactValueRow_(sheet, 2, requestId); }
function findProcessingUsageRecordRowByVoucher_(sheet, voucherId) {
  if (sheet.getLastRow() <= 1) return 0;
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, USAGE_RECORD_HEADERS.length).getValues();
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const record = rowToUsageRecord_(rows[i]);
    if (record.voucherId === voucherId && record.status === 'processing') return i + 2;
  }
  return 0;
}

function nextMemberNo_(sheet) {
  const year = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy');
  const props = PropertiesService.getScriptProperties();
  const key = 'MEMBER_SEQUENCE_' + year;
  let sequence = Number(props.getProperty(key) || 0);
  if (!sequence && sheet.getLastRow() > 1) {
    sheet.getRange(2, 2, sheet.getLastRow() - 1, 1).getValues().forEach(function (row) {
      const match = String(row[0]).match(new RegExp('^M' + year + '(\\d{6})$'));
      if (match) sequence = Math.max(sequence, Number(match[1]));
    });
  }
  sequence += 1;
  props.setProperty(key, String(sequence));
  return 'M' + year + String(sequence).padStart(6, '0');
}
function nextVoucherId_() {
  return 'U' + Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyyMMdd') + '-' + Utilities.getUuid().replace(/-/g, '').slice(0, 12).toUpperCase();
}
function nextUsageRecordId_() {
  return 'T' + Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyyMMdd') + '-' + Utilities.getUuid().replace(/-/g, '').slice(0, 16).toUpperCase();
}
function randomUsageCode_() { return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '').toLowerCase(); }
function cleanOptionalUsageCode_(value) {
  if (!value) return '';
  const code = cleanText_(value, 80, true).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(code)) fail_('INVALID_USAGE_QR', '消費時間 QR Code 格式不正確。');
  return code;
}
function cleanUsageRequestId_(value) {
  const requestId = cleanText_(value, 80, true).toLowerCase();
  if (!/^[a-f0-9]{32,64}$/.test(requestId)) fail_('INVALID_USAGE_REQUEST', '消費時間記錄要求無效，請重新掃描 QR Code。');
  return requestId;
}
function hashUsageCode_(code) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, code, Utilities.Charset.UTF_8);
  return digest.map(function (byte) { return ('0' + ((byte + 256) % 256).toString(16)).slice(-2); }).join('');
}
function tokenFingerprint_(idToken) { return hashUsageCode_(idToken); }

function audit_(actorLineUserId, actorRole, action, targetLineUserId, result, details) {
  try {
    getAuditSheet_().appendRow([new Date().toISOString(), actorLineUserId, actorRole, action, targetLineUserId, result, JSON.stringify(details || {})]);
    return true;
  } catch (_) {
    console.error('Audit write failed for action ' + action);
    return false;
  }
}
function rateLimitByToken_(idToken) {
  if (!idToken) fail_('UNAUTHENTICATED', '請先使用 LINE 登入。');
  const fingerprint = tokenFingerprint_(idToken);
  rateLimit_('request:' + fingerprint.slice(0, 24), 60, 60);
  return fingerprint;
}
function rateLimit_(key, maxRequests, ttlSeconds) {
  const cache = CacheService.getScriptCache();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) fail_('BUSY', '系統忙碌中，請稍後再試。');
  try {
    const count = Number(cache.get(key) || 0) + 1;
    if (count > maxRequests) fail_('RATE_LIMITED', '操作過於頻繁，請稍後再試。');
    cache.put(key, String(count), ttlSeconds);
  } finally { lock.releaseLock(); }
}
function parsePayload_(raw) {
  if (!raw) return {};
  if (String(raw).length > 6000) fail_('PAYLOAD_TOO_LARGE', '要求內容過大。');
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') fail_('INVALID_PAYLOAD', '要求格式不正確。');
    return parsed;
  } catch (error) {
    if (error && error.publicCode) throw error;
    fail_('INVALID_PAYLOAD', '要求格式不正確。');
  }
}

function memberTierProgress_(member) {
  const thresholds = getTierThresholds_();
  const currentMinutes = nonNegativeInt_(member && member.consumedMinutes);
  const currentTier = normalizeTier_(member && member.tier);
  const nextTierByCurrentTier = {
    standard: 'silver',
    silver: 'gold',
    gold: 'platinum'
  };
  const nextTier = nextTierByCurrentTier[currentTier] || '';
  const nextThresholdMinutes = nextTier ? nonNegativeInt_(thresholds[nextTier]) : 0;
  return {
    currentTier: currentTier,
    currentMinutes: currentMinutes,
    nextTier: nextTier,
    nextThresholdMinutes: nextThresholdMinutes,
    remainingMinutes: nextTier ? Math.max(0, nextThresholdMinutes - currentMinutes) : 0
  };
}

function publicMember_(member, includeAdminFields) {
  const result = {
    memberNo: member.memberNo, displayName: member.displayName, pictureUrl: member.pictureUrl,
    tier: normalizeTier_(member.tier), membershipStatus: member.membershipStatus, joinedAt: member.joinedAt,
    expiresAt: member.expiresAt, consumedMinutes: nonNegativeInt_(member.consumedMinutes), updatedAt: member.updatedAt,
    availableMinutes: nonNegativeInt_(member.availableMinutes)
  };
  if (!includeAdminFields) result.tierProgress = memberTierProgress_(member);
  if (includeAdminFields) result.note = member.note;
  return result;
}
function publicUsageVoucher_(voucher, recordCount) {
  const count = nonNegativeInt_(recordCount);
  const result = {
    voucherId: voucher.voucherId, minutes: nonNegativeInt_(voucher.minutes),
    scanMode: voucherScanMode_(voucher), status: effectiveVoucherStatus_(voucher, count),
    recordCount: count, expiresAt: voucher.expiresAt, note: voucher.note, createdAt: voucher.createdAt,
    updatedAt: voucher.updatedAt, cancelledAt: voucher.cancelledAt,
    legacyTargeted: isLegacyTargetedVoucher_(voucher), shareReady: Boolean(voucher.shareCode)
  };
  if (voucher.targetMemberNo) result.targetMemberNo = voucher.targetMemberNo;
  return result;
}
function publicUsageRecord_(record) {
  return {
    recordId: record.recordId, voucherId: record.voucherId, memberNo: record.memberNo,
    minutes: nonNegativeInt_(record.minutes), status: record.status, recordedAt: record.recordedAt
  };
}
function rowToMember_(row) {
  const member = {};
  MEMBER_HEADERS.forEach(function (header, index) { member[header] = normalizeCell_(row[index]); });
  member.tier = normalizeTier_(member.tier);
  member.availableMinutes = nonNegativeInt_(member.availableMinutes);
  member.consumedMinutes = nonNegativeInt_(member.consumedMinutes);
  return member;
}
function memberToRow_(member) { return MEMBER_HEADERS.map(function (header) { return sheetSafe_(member[header] == null ? '' : member[header]); }); }
function rowToUsageVoucher_(row) {
  const voucher = {};
  USAGE_VOUCHER_HEADERS.forEach(function (header, index) { voucher[header] = normalizeCell_(row[index]); });
  voucher.minutes = nonNegativeInt_(voucher.minutes);
  return voucher;
}
function usageVoucherToRow_(voucher) { return USAGE_VOUCHER_HEADERS.map(function (header) { return sheetSafe_(voucher[header] == null ? '' : voucher[header]); }); }
function writeUsageVoucher_(sheet, row, voucher) { sheet.getRange(row, 1, 1, USAGE_VOUCHER_HEADERS.length).setValues([usageVoucherToRow_(voucher)]); }
function rowToUsageRecord_(row) {
  const record = {};
  USAGE_RECORD_HEADERS.forEach(function (header, index) { record[header] = normalizeCell_(row[index]); });
  record.minutes = nonNegativeInt_(record.minutes);
  record.consumedBeforeMinutes = nonNegativeInt_(record.consumedBeforeMinutes);
  record.consumedAfterMinutes = nonNegativeInt_(record.consumedAfterMinutes);
  return record;
}
function usageRecordToRow_(record) { return USAGE_RECORD_HEADERS.map(function (header) { return sheetSafe_(record[header] == null ? '' : record[header]); }); }
function writeUsageRecord_(sheet, row, record) { sheet.getRange(row, 1, 1, USAGE_RECORD_HEADERS.length).setValues([usageRecordToRow_(record)]); }

function normalizeCell_(value) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'boolean' || typeof value === 'number') return value;
  const text = value == null ? '' : String(value);
  return /^'[=+@-]/.test(text) ? text.slice(1) : text;
}
function sheetSafe_(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = value instanceof Date ? value.toISOString() : String(value);
  return /^[=+@-]/.test(text) ? "'" + text : text;
}
function nonNegativeInt_(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.floor(number);
}
function safePictureUrl_(value) {
  if (!value) return '';
  const text = cleanText_(value, 2048, false);
  return /^https:\/\/[^\s]+$/i.test(text) ? text : '';
}
function validateDate_(value) {
  if (!value) return '';
  const text = cleanText_(value, 10, true);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) fail_('INVALID_DATE', '有效期限格式不正確。');
  const date = new Date(text + 'T00:00:00Z');
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) fail_('INVALID_DATE', '有效期限不是有效日期。');
  return text;
}
function validateVoucherExpiry_(value) {
  if (value == null || String(value).trim() === '') return '';
  const text = cleanText_(value, 40, true);
  const timestamp = Date.parse(text);
  if (!Number.isFinite(timestamp)) fail_('INVALID_EXPIRY', 'QR Code 到期時間格式不正確。');
  const now = Date.now();
  if (timestamp <= now) fail_('INVALID_EXPIRY', 'QR Code 到期時間必須晚於現在。');
  return new Date(timestamp).toISOString();
}
function validateMinutes_(value, allowZero) {
  const minutes = Number(value);
  if (!Number.isInteger(minutes)) fail_('INVALID_MINUTES', '分鐘必須是整數。');
  const minimum = allowZero ? 0 : 1;
  if (minutes < minimum || minutes > MAX_USAGE_MINUTES) fail_('INVALID_MINUTES', '消費分鐘必須介於 ' + minimum + ' 到 60000 分鐘。');
  return minutes;
}
function enumValue_(value, allowed, code, message) {
  const text = cleanText_(value, 30, true).toLowerCase();
  if (allowed.indexOf(text) === -1) fail_(code, message);
  return text;
}
function cleanText_(value, maxLength, required) {
  const text = value == null ? '' : String(value).replace(/[\u0000-\u001F\u007F]/g, '').trim();
  if (required && !text) fail_('INVALID_INPUT', '缺少必要欄位。');
  if (text.length > maxLength) fail_('INVALID_INPUT', '輸入內容超過允許長度。');
  return text;
}
function clampInt_(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isInteger(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}
function fail_(code, message) {
  const error = new Error(message);
  error.publicCode = code;
  error.publicMessage = message;
  throw error;
}
function json_(payload) { return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON); }
