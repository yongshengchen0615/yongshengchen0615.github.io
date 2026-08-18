'use strict';

const MEMBERS_SHEET = 'Members';
const AUDIT_SHEET = 'AuditLogs';
const USAGE_VOUCHERS_SHEET = 'UsageVouchers';
const MEMBER_HEADERS = ['lineUserId', 'memberNo', 'displayName', 'pictureUrl', 'tier', 'membershipStatus', 'joinedAt', 'expiresAt', 'note', 'createdAt', 'updatedAt', 'canManageMembers', 'availableMinutes', 'consumedMinutes'];
const AUDIT_HEADERS = ['timestamp', 'actorLineUserId', 'actorRole', 'action', 'targetLineUserId', 'result', 'details'];
const USAGE_VOUCHER_HEADERS = [
  'voucherId', 'tokenHash', 'targetLineUserId', 'targetMemberNo', 'minutes', 'status',
  'expiresAt', 'note', 'createdByLineUserId', 'createdAt', 'updatedAt', 'processingAt',
  'redeemedByLineUserId', 'redeemedAt', 'cancelledByLineUserId', 'cancelledAt',
  'balanceBeforeMinutes', 'balanceAfterMinutes', 'consumedBeforeMinutes',
  'consumedAfterMinutes', 'auditRecordedAt'
];
const ALLOWED_TIERS = ['standard', 'silver', 'gold', 'vip'];
const ALLOWED_MEMBERSHIP_STATUS = ['active', 'suspended', 'disabled'];
const MAX_MEMBER_MINUTES = 60000;
const MAX_VOUCHER_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

function doGet() {
  return json_({ ok: true, data: { service: 'MembershipSystem', version: '1.2.0' } });
}

function doPost(e) {
  try {
    const action = cleanText_(e && e.parameter && e.parameter.action, 60, true);
    const idToken = cleanText_(e && e.parameter && e.parameter.idToken, 4096, true);
    rateLimitByToken_(idToken);
    const identity = verifyLineIdToken_(idToken);
    const context = { identity: identity, isAdmin: isAdmin_(identity.sub) };
    const payload = parsePayload_(e && e.parameter && e.parameter.payload);

    switch (action) {
      case 'member.me':
        return json_({ ok: true, data: memberMe_(context) });
      case 'usage.preview':
        rateLimit_('usage-preview:' + context.identity.sub, 30, 60);
        return json_({ ok: true, data: usagePreview_(context, payload) });
      case 'usage.redeem':
        rateLimit_('usage-redeem:' + context.identity.sub, 10, 60);
        return json_({ ok: true, data: usageRedeem_(context, payload) });
      case 'admin.list':
        requireAdmin_(context);
        rateLimit_('admin-list:' + context.identity.sub, 30, 60);
        return json_({ ok: true, data: adminList_(payload) });
      case 'admin.update':
        requireAdmin_(context);
        rateLimit_('admin-update:' + context.identity.sub, 20, 60);
        return json_({ ok: true, data: adminUpdate_(context, payload) });
      case 'admin.usage.list':
        requireAdmin_(context);
        rateLimit_('admin-usage-list:' + context.identity.sub, 30, 60);
        return json_({ ok: true, data: adminUsageList_(payload) });
      case 'admin.usage.create':
        requireAdmin_(context);
        rateLimit_('admin-usage-create:' + context.identity.sub, 20, 60);
        return json_({ ok: true, data: adminUsageCreate_(context, payload) });
      case 'admin.usage.cancel':
        requireAdmin_(context);
        rateLimit_('admin-usage-cancel:' + context.identity.sub, 30, 60);
        return json_({ ok: true, data: adminUsageCancel_(context, payload) });
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
          tier: 'standard',
          membershipStatus: 'active',
          joinedAt: now,
          expiresAt: '',
          note: '',
          createdAt: now,
          updatedAt: now,
          canManageMembers: false,
          availableMinutes: 0,
          consumedMinutes: 0
        };
        sheet.appendRow(memberToRow_(member));
        audit_(context.identity.sub, 'member', 'MEMBER_CREATED', context.identity.sub, 'success', { memberNo: member.memberNo });
      }
    } finally {
      lock.releaseLock();
    }
  } else {
    member = rowToMember_(sheet.getRange(row, 1, 1, MEMBER_HEADERS.length).getValues()[0]);
    const displayName = cleanText_(context.identity.name || member.displayName || 'LINE 會員', 80, false);
    const pictureUrl = safePictureUrl_(context.identity.picture);
    if (displayName !== member.displayName || pictureUrl !== member.pictureUrl) {
      member.displayName = displayName;
      member.pictureUrl = pictureUrl;
      member.updatedAt = new Date().toISOString();
      sheet.getRange(row, 1, 1, MEMBER_HEADERS.length).setValues([memberToRow_(member)]);
    }
  }

  return { member: publicMember_(member, false), isAdmin: hasManageMembersPermission_(member.canManageMembers) };
}

function adminList_(payload) {
  const sheet = getMembersSheet_();
  const query = cleanText_(payload.query || '', 80, false).toLowerCase();
  const page = clampInt_(payload.page, 1, 100000, 1);
  const pageSize = clampInt_(payload.pageSize, 1, 100, 50);
  const rows = sheet.getLastRow() > 1
    ? sheet.getRange(2, 1, sheet.getLastRow() - 1, MEMBER_HEADERS.length).getValues()
    : [];
  const allMembers = rows.map(rowToMember_);
  const stats = allMembers.reduce(function (acc, member) {
    acc.total += 1;
    acc.availableMinutes += member.availableMinutes;
    acc.consumedMinutes += member.consumedMinutes;
    if (member.membershipStatus === 'active') acc.active += 1;
    if (member.membershipStatus === 'suspended') acc.suspended += 1;
    if (member.membershipStatus === 'disabled') acc.disabled += 1;
    return acc;
  }, { total: 0, active: 0, suspended: 0, disabled: 0, availableMinutes: 0, consumedMinutes: 0 });

  const filtered = query ? allMembers.filter(function (member) {
    return member.memberNo.toLowerCase().indexOf(query) !== -1 ||
      member.displayName.toLowerCase().indexOf(query) !== -1;
  }) : allMembers;

  filtered.sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
  const start = (page - 1) * pageSize;
  return {
    members: filtered.slice(start, start + pageSize).map(function (member) { return publicMember_(member, true); }),
    total: filtered.length,
    page: page,
    pageSize: pageSize,
    stats: stats
  };
}

function adminUpdate_(context, payload) {
  const targetMemberNo = cleanText_(payload.targetMemberNo, 24, true);
  const expectedUpdatedAt = cleanText_(payload.expectedUpdatedAt, 40, true);
  const tier = enumValue_(payload.tier, ALLOWED_TIERS, 'INVALID_TIER', '會員等級不正確。');
  const membershipStatus = enumValue_(payload.membershipStatus, ALLOWED_MEMBERSHIP_STATUS, 'INVALID_STATUS', '會員狀態不正確。');
  const expiresAt = validateDate_(payload.expiresAt || '');
  const note = cleanText_(payload.note || '', 500, false);
  const availableMinutes = hoursToMinutes_(payload.availableHours, true);

  const sheet = getMembersSheet_();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) fail_('BUSY', '系統忙碌中，請稍後再試。');

  try {
    const row = findMemberRowByMemberNo_(sheet, targetMemberNo);
    if (!row) fail_('MEMBER_NOT_FOUND', '找不到指定會員。');
    const member = rowToMember_(sheet.getRange(row, 1, 1, MEMBER_HEADERS.length).getValues()[0]);

    if (String(member.updatedAt) !== expectedUpdatedAt) {
      fail_('CONFLICT', '會員資料已被其他操作更新，請重新整理後再試。');
    }

    const reservedMinutes = reservedMinutesForMember_(member.lineUserId);
    if (availableMinutes < reservedMinutes) {
      fail_('HOURS_RESERVED', '可用時數不可低於尚未核銷且未到期的已發放時數。');
    }

    const changedFields = [];
    if (member.tier !== tier) changedFields.push('tier');
    if (member.membershipStatus !== membershipStatus) changedFields.push('membershipStatus');
    if (String(member.expiresAt || '').slice(0, 10) !== expiresAt) changedFields.push('expiresAt');
    if (member.note !== note) changedFields.push('note');
    if (member.availableMinutes !== availableMinutes) changedFields.push('availableMinutes');

    member.tier = tier;
    member.membershipStatus = membershipStatus;
    member.expiresAt = expiresAt;
    member.note = note;
    member.availableMinutes = availableMinutes;
    member.updatedAt = new Date().toISOString();

    sheet.getRange(row, 1, 1, MEMBER_HEADERS.length).setValues([memberToRow_(member)]);
    audit_(context.identity.sub, 'admin', 'MEMBER_UPDATED', member.lineUserId, 'success', {
      memberNo: member.memberNo,
      fields: changedFields
    });
    return { member: publicMember_(member, true) };
  } finally {
    lock.releaseLock();
  }
}

function adminUsageList_(payload) {
  const limit = clampInt_(payload.limit, 1, 100, 50);
  const sheet = getUsageVouchersSheet_();
  const rows = sheet.getLastRow() > 1
    ? sheet.getRange(2, 1, sheet.getLastRow() - 1, USAGE_VOUCHER_HEADERS.length).getValues()
    : [];

  const vouchers = rows.map(rowToUsageVoucher_);
  vouchers.sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
  return { vouchers: vouchers.slice(0, limit).map(publicUsageVoucher_) };
}

function adminUsageCreate_(context, payload) {
  const targetMemberNo = cleanText_(payload.targetMemberNo, 24, true);
  const minutes = hoursToMinutes_(payload.hours, false);
  const expiresAt = validateVoucherExpiry_(payload.expiresAt);
  const note = cleanText_(payload.note || '', 200, false);

  const membersSheet = getMembersSheet_();
  const vouchersSheet = getUsageVouchersSheet_();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) fail_('BUSY', '系統忙碌中，請稍後再試。');

  try {
    const memberRow = findMemberRowByMemberNo_(membersSheet, targetMemberNo);
    if (!memberRow) fail_('MEMBER_NOT_FOUND', '找不到指定會員。');
    const member = rowToMember_(membersSheet.getRange(memberRow, 1, 1, MEMBER_HEADERS.length).getValues()[0]);

    if (!isMembershipUsable_(member)) {
      fail_('MEMBERSHIP_INACTIVE', '此會員目前不可核銷時數。');
    }

    const reservedMinutes = reservedMinutesForMember_(member.lineUserId);
    if (member.availableMinutes - reservedMinutes < minutes) {
      fail_('INSUFFICIENT_HOURS', '會員可發放時數不足，請先增加可用時數或取消未使用的核銷券。');
    }

    const now = new Date().toISOString();
    const rawToken = randomUsageToken_();
    const voucher = {
      voucherId: nextVoucherId_(),
      tokenHash: hashUsageToken_(rawToken),
      targetLineUserId: member.lineUserId,
      targetMemberNo: member.memberNo,
      minutes: minutes,
      status: 'issued',
      expiresAt: expiresAt,
      note: note,
      createdByLineUserId: context.identity.sub,
      createdAt: now,
      updatedAt: now,
      processingAt: '',
      redeemedByLineUserId: '',
      redeemedAt: '',
      cancelledByLineUserId: '',
      cancelledAt: '',
      balanceBeforeMinutes: 0,
      balanceAfterMinutes: 0,
      consumedBeforeMinutes: 0,
      consumedAfterMinutes: 0,
      auditRecordedAt: ''
    };

    vouchersSheet.appendRow(usageVoucherToRow_(voucher));
    audit_(context.identity.sub, 'admin', 'USAGE_VOUCHER_CREATED', member.lineUserId, 'success', {
      voucherId: voucher.voucherId,
      memberNo: member.memberNo,
      minutes: minutes,
      expiresAt: expiresAt
    });

    return { voucher: publicUsageVoucher_(voucher), token: rawToken };
  } finally {
    lock.releaseLock();
  }
}

function adminUsageCancel_(context, payload) {
  const voucherId = cleanText_(payload.voucherId, 40, true);
  const sheet = getUsageVouchersSheet_();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) fail_('BUSY', '系統忙碌中，請稍後再試。');

  try {
    const row = findUsageVoucherRowById_(sheet, voucherId);
    if (!row) fail_('VOUCHER_NOT_FOUND', '找不到指定核銷券。');
    const voucher = rowToUsageVoucher_(sheet.getRange(row, 1, 1, USAGE_VOUCHER_HEADERS.length).getValues()[0]);

    if (voucher.status === 'redeemed') fail_('VOUCHER_USED', '此核銷券已使用，不能取消。');
    if (voucher.status === 'processing') fail_('VOUCHER_PROCESSING', '此核銷券正在處理中，不能取消。');
    if (voucher.status === 'cancelled') return { voucher: publicUsageVoucher_(voucher) };

    const now = new Date().toISOString();
    voucher.status = 'cancelled';
    voucher.cancelledByLineUserId = context.identity.sub;
    voucher.cancelledAt = now;
    voucher.updatedAt = now;
    writeUsageVoucher_(sheet, row, voucher);

    audit_(context.identity.sub, 'admin', 'USAGE_VOUCHER_CANCELLED', voucher.targetLineUserId, 'success', {
      voucherId: voucher.voucherId,
      memberNo: voucher.targetMemberNo,
      minutes: voucher.minutes
    });

    return { voucher: publicUsageVoucher_(voucher) };
  } finally {
    lock.releaseLock();
  }
}

function usagePreview_(context, payload) {
  const token = cleanUsageToken_(payload.token);
  const sheet = getUsageVouchersSheet_();
  const row = findUsageVoucherRowByTokenHash_(sheet, hashUsageToken_(token));
  if (!row) fail_('INVALID_VOUCHER', '核銷網址無效或已失效。');

  const voucher = rowToUsageVoucher_(sheet.getRange(row, 1, 1, USAGE_VOUCHER_HEADERS.length).getValues()[0]);
  requireVoucherTarget_(voucher, context.identity.sub);

  const status = effectiveVoucherStatus_(voucher);
  if (status === 'expired') fail_('VOUCHER_EXPIRED', '此核銷券已過期。');
  if (status === 'cancelled') fail_('VOUCHER_CANCELLED', '此核銷券已取消。');
  if (status === 'redeemed') fail_('VOUCHER_USED', '此核銷券已使用。');
  if (status === 'processing') fail_('VOUCHER_PROCESSING', '此核銷券正在完成核銷，請稍後再試。');

  const member = getMemberByLineUserId_(context.identity.sub);
  if (!member || !isMembershipUsable_(member)) {
    fail_('MEMBERSHIP_INACTIVE', '目前會員狀態不可核銷時數。');
  }
  if (member.availableMinutes < voucher.minutes) {
    fail_('INSUFFICIENT_HOURS', '可用時數不足，無法完成此次核銷。');
  }

  return {
    voucher: publicUsageVoucher_(voucher),
    member: publicMember_(member, false)
  };
}

function usageRedeem_(context, payload) {
  const token = cleanUsageToken_(payload.token);
  const tokenHash = hashUsageToken_(token);
  const vouchersSheet = getUsageVouchersSheet_();
  const membersSheet = getMembersSheet_();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) fail_('BUSY', '系統忙碌中，請稍後再試。');

  try {
    const voucherRow = findUsageVoucherRowByTokenHash_(vouchersSheet, tokenHash);
    if (!voucherRow) fail_('INVALID_VOUCHER', '核銷網址無效或已失效。');

    let voucher = rowToUsageVoucher_(
      vouchersSheet.getRange(voucherRow, 1, 1, USAGE_VOUCHER_HEADERS.length).getValues()[0]
    );
    requireVoucherTarget_(voucher, context.identity.sub);

    const memberRow = findMemberRow_(membersSheet, context.identity.sub);
    if (!memberRow) fail_('MEMBER_NOT_FOUND', '找不到會員資料。');
    let member = rowToMember_(membersSheet.getRange(memberRow, 1, 1, MEMBER_HEADERS.length).getValues()[0]);

    if (voucher.status === 'redeemed') {
      if (voucher.redeemedByLineUserId !== context.identity.sub) {
        fail_('VOUCHER_USED', '此核銷券已使用。');
      }
      ensureRedemptionAudit_(vouchersSheet, voucherRow, voucher);
      return {
        voucher: publicUsageVoucher_(voucher),
        member: publicMember_(member, false),
        alreadyRedeemed: true
      };
    }

    if (voucher.status === 'cancelled') fail_('VOUCHER_CANCELLED', '此核銷券已取消。');

    if (voucher.status === 'processing') {
      if (voucher.redeemedByLineUserId !== context.identity.sub) {
        fail_('INVALID_VOUCHER', '核銷網址無效或已失效。');
      }
      const state = redemptionMemberState_(member, voucher);
      if (state === 'before') {
        member.availableMinutes = voucher.balanceAfterMinutes;
        member.consumedMinutes = voucher.consumedAfterMinutes;
        member.updatedAt = new Date().toISOString();
        membersSheet.getRange(memberRow, 1, 1, MEMBER_HEADERS.length).setValues([memberToRow_(member)]);
      } else if (state !== 'after') {
        fail_('REDEMPTION_CONFLICT', '核銷處理狀態不一致，請聯絡管理員確認時數。');
      }

      voucher.status = 'redeemed';
      voucher.redeemedAt = voucher.redeemedAt || new Date().toISOString();
      voucher.updatedAt = new Date().toISOString();
      writeUsageVoucher_(vouchersSheet, voucherRow, voucher);
      ensureRedemptionAudit_(vouchersSheet, voucherRow, voucher);

      return {
        voucher: publicUsageVoucher_(voucher),
        member: publicMember_(member, false),
        recovered: true
      };
    }

    if (effectiveVoucherStatus_(voucher) === 'expired') {
      fail_('VOUCHER_EXPIRED', '此核銷券已過期。');
    }
    if (!isMembershipUsable_(member)) {
      fail_('MEMBERSHIP_INACTIVE', '目前會員狀態不可核銷時數。');
    }
    if (member.availableMinutes < voucher.minutes) {
      fail_('INSUFFICIENT_HOURS', '可用時數不足，無法完成此次核銷。');
    }

    const now = new Date().toISOString();
    voucher.status = 'processing';
    voucher.processingAt = now;
    voucher.redeemedByLineUserId = context.identity.sub;
    voucher.balanceBeforeMinutes = member.availableMinutes;
    voucher.balanceAfterMinutes = member.availableMinutes - voucher.minutes;
    voucher.consumedBeforeMinutes = member.consumedMinutes;
    voucher.consumedAfterMinutes = member.consumedMinutes + voucher.minutes;
    voucher.updatedAt = now;
    writeUsageVoucher_(vouchersSheet, voucherRow, voucher);

    member.availableMinutes = voucher.balanceAfterMinutes;
    member.consumedMinutes = voucher.consumedAfterMinutes;
    member.updatedAt = new Date().toISOString();
    membersSheet.getRange(memberRow, 1, 1, MEMBER_HEADERS.length).setValues([memberToRow_(member)]);

    voucher.status = 'redeemed';
    voucher.redeemedAt = new Date().toISOString();
    voucher.updatedAt = voucher.redeemedAt;
    writeUsageVoucher_(vouchersSheet, voucherRow, voucher);
    ensureRedemptionAudit_(vouchersSheet, voucherRow, voucher);

    return {
      voucher: publicUsageVoucher_(voucher),
      member: publicMember_(member, false),
      alreadyRedeemed: false
    };
  } finally {
    lock.releaseLock();
  }
}

function redemptionMemberState_(member, voucher) {
  const available = nonNegativeInt_(member.availableMinutes);
  const consumed = nonNegativeInt_(member.consumedMinutes);
  if (available === voucher.balanceBeforeMinutes && consumed === voucher.consumedBeforeMinutes) return 'before';
  if (available === voucher.balanceAfterMinutes && consumed === voucher.consumedAfterMinutes) return 'after';
  return 'conflict';
}

function ensureRedemptionAudit_(sheet, row, voucher) {
  if (voucher.auditRecordedAt) return;
  const written = audit_(voucher.redeemedByLineUserId, 'member', 'USAGE_REDEEMED', voucher.targetLineUserId, 'success', {
    voucherId: voucher.voucherId,
    memberNo: voucher.targetMemberNo,
    minutes: voucher.minutes,
    balanceBeforeMinutes: voucher.balanceBeforeMinutes,
    balanceAfterMinutes: voucher.balanceAfterMinutes
  });
  if (!written) return;
  voucher.auditRecordedAt = new Date().toISOString();
  voucher.updatedAt = voucher.auditRecordedAt;
  writeUsageVoucher_(sheet, row, voucher);
}

function requireVoucherTarget_(voucher, lineUserId) {
  if (!voucher.targetLineUserId || voucher.targetLineUserId !== lineUserId) {
    fail_('INVALID_VOUCHER', '核銷網址無效或已失效。');
  }
}

function reservedMinutesForMember_(lineUserId) {
  const sheet = getUsageVouchersSheet_();
  if (sheet.getLastRow() <= 1) return 0;
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, USAGE_VOUCHER_HEADERS.length).getValues();
  const now = Date.now();

  return rows.map(rowToUsageVoucher_).reduce(function (sum, voucher) {
    if (voucher.targetLineUserId !== lineUserId) return sum;
    if (voucher.status !== 'issued' && voucher.status !== 'processing') return sum;
    if (voucher.status === 'issued' && Date.parse(voucher.expiresAt) <= now) return sum;
    return sum + voucher.minutes;
  }, 0);
}

function effectiveVoucherStatus_(voucher) {
  if (voucher.status === 'issued' && Date.parse(voucher.expiresAt) <= Date.now()) return 'expired';
  return voucher.status;
}

function isMembershipUsable_(member) {
  if (!member || member.membershipStatus !== 'active') return false;
  if (!member.expiresAt) return true;
  const today = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd');
  return String(member.expiresAt).slice(0, 10) >= today;
}

function verifyLineIdToken_(idToken) {
  const clientId = cleanText_(PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_ID'), 40, true);
  const response = UrlFetchApp.fetch('https://api.line.me/oauth2/v2.1/verify', {
    method: 'post',
    contentType: 'application/x-www-form-urlencoded',
    payload: { id_token: idToken, client_id: clientId },
    muteHttpExceptions: true
  });

  if (response.getResponseCode() !== 200) fail_('UNAUTHENTICATED', 'LINE 登入已失效，請重新登入。');

  let identity;
  try {
    identity = JSON.parse(response.getContentText());
  } catch (_) {
    fail_('UNAUTHENTICATED', 'LINE 登入驗證失敗。');
  }

  if (!identity || !identity.sub || String(identity.aud) !== clientId) {
    fail_('UNAUTHENTICATED', 'LINE 登入驗證失敗。');
  }
  return identity;
}

function requireAdmin_(context) {
  if (!context.isAdmin) fail_('FORBIDDEN', '你沒有會員管理權限。');
}

function isAdmin_(lineUserId) {
  const sheet = getMembersSheet_();
  const row = findMemberRow_(sheet, lineUserId);
  if (!row) return false;
  const member = rowToMember_(sheet.getRange(row, 1, 1, MEMBER_HEADERS.length).getValues()[0]);
  return hasManageMembersPermission_(member.canManageMembers);
}

function hasManageMembersPermission_(value) {
  if (value === true) return true;
  return String(value == null ? '' : value).trim().toLowerCase() === 'true';
}

function getSpreadsheet_() {
  const id = cleanText_(PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID'), 160, true);
  try {
    return SpreadsheetApp.openById(id);
  } catch (_) {
    fail_('CONFIG_ERROR', '會員資料庫尚未正確設定。');
  }
}

function getMembersSheet_() {
  return ensureSheet_(getSpreadsheet_(), MEMBERS_SHEET, MEMBER_HEADERS);
}

function getAuditSheet_() {
  return ensureSheet_(getSpreadsheet_(), AUDIT_SHEET, AUDIT_HEADERS);
}

function getUsageVouchersSheet_() {
  return ensureSheet_(getSpreadsheet_(), USAGE_VOUCHERS_SHEET, USAGE_VOUCHER_HEADERS);
}

function ensureSheet_(spreadsheet, name, headers) {
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(name);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    return sheet;
  }

  if (sheet.getLastColumn() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    return sheet;
  }

  headers.forEach(function (header, index) {
    const column = index + 1;
    const current = String(sheet.getRange(1, column).getValue() || '').trim();
    if (current === header) return;

    const lastColumn = sheet.getLastColumn();
    const remaining = lastColumn >= column
      ? sheet.getRange(1, column, 1, lastColumn - column + 1).getValues()[0].map(function (value) {
          return String(value || '').trim();
        })
      : [];

    if (remaining.indexOf(header) !== -1) {
      fail_('SCHEMA_ERROR', name + ' 工作表的必要欄位順序不正確：' + header);
    }

    sheet.insertColumnBefore(column);
    sheet.getRange(1, column).setValue(header);
  });

  sheet.setFrozenRows(1);
  return sheet;
}

function findMemberRow_(sheet, lineUserId) {
  if (sheet.getLastRow() <= 1) return 0;
  const found = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1)
    .createTextFinder(lineUserId).matchEntireCell(true).findNext();
  return found ? found.getRow() : 0;
}

function findMemberRowByMemberNo_(sheet, memberNo) {
  if (sheet.getLastRow() <= 1) return 0;
  const found = sheet.getRange(2, 2, sheet.getLastRow() - 1, 1)
    .createTextFinder(memberNo).matchEntireCell(true).findNext();
  return found ? found.getRow() : 0;
}

function getMemberByLineUserId_(lineUserId) {
  const sheet = getMembersSheet_();
  const row = findMemberRow_(sheet, lineUserId);
  return row ? rowToMember_(sheet.getRange(row, 1, 1, MEMBER_HEADERS.length).getValues()[0]) : null;
}

function findUsageVoucherRowById_(sheet, voucherId) {
  if (sheet.getLastRow() <= 1) return 0;
  const found = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1)
    .createTextFinder(voucherId).matchEntireCell(true).findNext();
  return found ? found.getRow() : 0;
}

function findUsageVoucherRowByTokenHash_(sheet, tokenHash) {
  if (sheet.getLastRow() <= 1) return 0;
  const found = sheet.getRange(2, 2, sheet.getLastRow() - 1, 1)
    .createTextFinder(tokenHash).matchEntireCell(true).findNext();
  return found ? found.getRow() : 0;
}

function nextMemberNo_(sheet) {
  const year = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy');
  const props = PropertiesService.getScriptProperties();
  const key = 'MEMBER_SEQUENCE_' + year;
  let sequence = Number(props.getProperty(key) || 0);

  if (!sequence && sheet.getLastRow() > 1) {
    const values = sheet.getRange(2, 2, sheet.getLastRow() - 1, 1).getValues();
    values.forEach(function (row) {
      const match = String(row[0]).match(new RegExp('^M' + year + '(\\d{6})$'));
      if (match) sequence = Math.max(sequence, Number(match[1]));
    });
  }

  sequence += 1;
  props.setProperty(key, String(sequence));
  return 'M' + year + String(sequence).padStart(6, '0');
}

function nextVoucherId_() {
  const date = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyyMMdd');
  const suffix = Utilities.getUuid().replace(/-/g, '').slice(0, 12).toUpperCase();
  return 'U' + date + '-' + suffix;
}

function randomUsageToken_() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '').toLowerCase();
}

function cleanUsageToken_(value) {
  const token = cleanText_(value, 80, true).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(token)) fail_('INVALID_VOUCHER', '核銷網址無效或已失效。');
  return token;
}

function hashUsageToken_(token) {
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    token,
    Utilities.Charset.UTF_8
  );
  return digest.map(function (byte) {
    return ('0' + ((byte + 256) % 256).toString(16)).slice(-2);
  }).join('');
}

function audit_(actorLineUserId, actorRole, action, targetLineUserId, result, details) {
  try {
    getAuditSheet_().appendRow([
      new Date().toISOString(),
      actorLineUserId,
      actorRole,
      action,
      targetLineUserId,
      result,
      JSON.stringify(details || {})
    ]);
    return true;
  } catch (_) {
    console.error('Audit write failed for action ' + action);
    return false;
  }
}

function rateLimitByToken_(idToken) {
  if (!idToken) fail_('UNAUTHENTICATED', '請先使用 LINE 登入。');
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, idToken, Utilities.Charset.UTF_8);
  const fingerprint = digest.slice(0, 12).map(function (byte) {
    return ('0' + ((byte + 256) % 256).toString(16)).slice(-2);
  }).join('');
  rateLimit_('request:' + fingerprint, 60, 60);
}

function rateLimit_(key, maxRequests, ttlSeconds) {
  const cache = CacheService.getScriptCache();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) fail_('BUSY', '系統忙碌中，請稍後再試。');

  try {
    const count = Number(cache.get(key) || 0) + 1;
    if (count > maxRequests) fail_('RATE_LIMITED', '操作過於頻繁，請稍後再試。');
    cache.put(key, String(count), ttlSeconds);
  } finally {
    lock.releaseLock();
  }
}

function parsePayload_(raw) {
  if (!raw) return {};
  if (String(raw).length > 6000) fail_('PAYLOAD_TOO_LARGE', '要求內容過大。');

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
      fail_('INVALID_PAYLOAD', '要求格式不正確。');
    }
    return parsed;
  } catch (error) {
    if (error && error.publicCode) throw error;
    fail_('INVALID_PAYLOAD', '要求格式不正確。');
  }
}

function publicMember_(member, includeAdminFields) {
  const result = {
    memberNo: member.memberNo,
    displayName: member.displayName,
    pictureUrl: member.pictureUrl,
    tier: member.tier,
    membershipStatus: member.membershipStatus,
    joinedAt: member.joinedAt,
    expiresAt: member.expiresAt,
    availableMinutes: nonNegativeInt_(member.availableMinutes),
    consumedMinutes: nonNegativeInt_(member.consumedMinutes),
    updatedAt: member.updatedAt
  };
  if (includeAdminFields) result.note = member.note;
  return result;
}

function publicUsageVoucher_(voucher) {
  return {
    voucherId: voucher.voucherId,
    targetMemberNo: voucher.targetMemberNo,
    minutes: nonNegativeInt_(voucher.minutes),
    status: effectiveVoucherStatus_(voucher),
    expiresAt: voucher.expiresAt,
    note: voucher.note,
    createdAt: voucher.createdAt,
    redeemedAt: voucher.redeemedAt,
    cancelledAt: voucher.cancelledAt
  };
}

function rowToMember_(row) {
  const member = {};
  MEMBER_HEADERS.forEach(function (header, index) {
    member[header] = normalizeCell_(row[index]);
  });
  member.availableMinutes = nonNegativeInt_(member.availableMinutes);
  member.consumedMinutes = nonNegativeInt_(member.consumedMinutes);
  return member;
}

function memberToRow_(member) {
  return MEMBER_HEADERS.map(function (header) {
    return sheetSafe_(member[header] == null ? '' : member[header]);
  });
}

function rowToUsageVoucher_(row) {
  const voucher = {};
  USAGE_VOUCHER_HEADERS.forEach(function (header, index) {
    voucher[header] = normalizeCell_(row[index]);
  });
  [
    'minutes', 'balanceBeforeMinutes', 'balanceAfterMinutes',
    'consumedBeforeMinutes', 'consumedAfterMinutes'
  ].forEach(function (field) {
    voucher[field] = nonNegativeInt_(voucher[field]);
  });
  return voucher;
}

function usageVoucherToRow_(voucher) {
  return USAGE_VOUCHER_HEADERS.map(function (header) {
    return sheetSafe_(voucher[header] == null ? '' : voucher[header]);
  });
}

function writeUsageVoucher_(sheet, row, voucher) {
  sheet.getRange(row, 1, 1, USAGE_VOUCHER_HEADERS.length).setValues([usageVoucherToRow_(voucher)]);
}

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
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
    fail_('INVALID_DATE', '有效期限不是有效日期。');
  }
  return text;
}

function validateVoucherExpiry_(value) {
  const text = cleanText_(value, 40, true);
  const timestamp = Date.parse(text);
  if (!Number.isFinite(timestamp)) fail_('INVALID_EXPIRY', '核銷券到期時間格式不正確。');

  const now = Date.now();
  if (timestamp <= now) fail_('INVALID_EXPIRY', '核銷券到期時間必須晚於現在。');
  if (timestamp - now > MAX_VOUCHER_LIFETIME_MS) {
    fail_('INVALID_EXPIRY', '核銷券有效期限最多 30 天。');
  }
  return new Date(timestamp).toISOString();
}

function hoursToMinutes_(value, allowZero) {
  const hours = Number(value);
  if (!Number.isFinite(hours)) fail_('INVALID_HOURS', '時數格式不正確。');

  const rawMinutes = hours * 60;
  const minutes = Math.round(rawMinutes);
  if (Math.abs(rawMinutes - minutes) > 0.000001 || minutes % 15 !== 0) {
    fail_('INVALID_HOURS', '時數必須以 0.25 小時為單位。');
  }

  const minimum = allowZero ? 0 : 15;
  if (minutes < minimum || minutes > MAX_MEMBER_MINUTES) {
    fail_('INVALID_HOURS', allowZero ? '可用時數必須介於 0 到 1000 小時。' : '核銷時數必須介於 0.25 到 1000 小時。');
  }
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

function json_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}
