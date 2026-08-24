'use strict';

const MINUTE_GRANTS_SHEET = 'MinuteGrants';
const MINUTE_GRANT_HEADERS = [
  'grantId', 'requestId', 'memberLineUserId', 'memberNo', 'memberDisplayName', 'minutes', 'reason',
  'status', 'consumedBeforeMinutes', 'consumedAfterMinutes', 'tierBefore', 'tierAfter',
  'grantedByLineUserId', 'pushStatus', 'pushErrorCode', 'pushAttemptedAt', 'pushSentAt',
  'createdAt', 'updatedAt', 'grantedAt', 'auditRecordedAt'
];
const MAX_ADMIN_MINUTE_GRANT = 60000;
const MINUTE_GRANT_PUSH_LABELS = Object.freeze({
  standard: '一般', silver: '銀級', gold: '金級', platinum: '白金', vip: '白金'
});

function getMinuteGrantsSheet_() {
  return getCachedSheet_(MINUTE_GRANTS_SHEET, MINUTE_GRANT_HEADERS);
}

function newMinuteGrantId_() {
  return 'MG-' + Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyMMdd') + '-' +
    Utilities.getUuid().replace(/-/g, '').slice(0, 12).toUpperCase();
}

function minuteGrantToRow_(grant) {
  return MINUTE_GRANT_HEADERS.map(function (header) {
    const value = grant && Object.prototype.hasOwnProperty.call(grant, header) ? grant[header] : '';
    return sheetSafe_(value == null ? '' : value);
  });
}

function rowToMinuteGrant_(row) {
  const result = {};
  MINUTE_GRANT_HEADERS.forEach(function (header, index) { result[header] = normalizeCell_(row[index]); });
  result.minutes = nonNegativeInt_(result.minutes);
  result.consumedBeforeMinutes = nonNegativeInt_(result.consumedBeforeMinutes);
  result.consumedAfterMinutes = nonNegativeInt_(result.consumedAfterMinutes);
  result.tierBefore = normalizeTier_(result.tierBefore);
  result.tierAfter = normalizeTier_(result.tierAfter);
  return result;
}

function findMinuteGrantByFieldWithRow_(field, value) {
  const index = MINUTE_GRANT_HEADERS.indexOf(field);
  if (index === -1) fail_('INTERNAL_ERROR', '分鐘發放欄位設定不正確。');
  const sheet = getMinuteGrantsSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return null;
  const rows = sheet.getRange(2, 1, lastRow - 1, MINUTE_GRANT_HEADERS.length).getValues();
  const expected = String(value || '');
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    if (String(normalizeCell_(rows[i][index]) || '') === expected) {
      return { row: i + 2, grant: rowToMinuteGrant_(rows[i]) };
    }
  }
  return null;
}

function writeMinuteGrantRow_(row, grant) {
  getMinuteGrantsSheet_().getRange(row, 1, 1, MINUTE_GRANT_HEADERS.length)
    .setValues([minuteGrantToRow_(grant)]);
}

function readMinuteGrantInput_(payload) {
  const targetMemberNo = cleanText_(payload && payload.targetMemberNo, 24, true);
  const minutes = Number(payload && payload.minutes);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_ADMIN_MINUTE_GRANT) {
    fail_('INVALID_MINUTES', '人工發放分鐘必須是 1 到 ' + MAX_ADMIN_MINUTE_GRANT + ' 的整數。');
  }
  const reason = cleanText_(payload && payload.reason, 200, true);
  const requestId = cleanText_(payload && payload.requestId, 64, true).toLowerCase();
  if (!/^[a-f0-9]{32,64}$/.test(requestId)) {
    fail_('INVALID_REQUEST_ID', '發放請求識別碼格式不正確。');
  }
  return { targetMemberNo: targetMemberNo, minutes: minutes, reason: reason, requestId: requestId };
}

function recoverMinuteGrant_(match, memberSheet, memberRow) {
  const grant = match.grant;
  if (grant.status === 'recorded') return grant;
  if (grant.status !== 'processing') {
    fail_('RECOVERY_REQUIRED', '分鐘發放紀錄狀態異常，請人工確認。');
  }

  const member = rowToMember_(memberSheet.getRange(memberRow, 1, 1, MEMBER_HEADERS.length).getValues()[0]);
  const now = new Date().toISOString();
  if (member.consumedMinutes === grant.consumedBeforeMinutes) {
    member.consumedMinutes = grant.consumedAfterMinutes;
    member.tier = tierForConsumedMinutes_(member.consumedMinutes);
    member.updatedAt = now;
    memberSheet.getRange(memberRow, 1, 1, MEMBER_HEADERS.length).setValues([memberToRow_(member)]);
  } else if (member.consumedMinutes !== grant.consumedAfterMinutes) {
    fail_('RECOVERY_REQUIRED', '會員累計消費分鐘已發生其他變更，無法自動恢復此筆發放。');
  }

  grant.tierAfter = tierForConsumedMinutes_(grant.consumedAfterMinutes);
  grant.status = 'recorded';
  grant.grantedAt = grant.grantedAt || now;
  grant.updatedAt = now;
  if (!grant.auditRecordedAt) {
    if (!audit_(grant.grantedByLineUserId, 'admin', 'MEMBER_MINUTES_GRANTED', grant.memberLineUserId, 'success', {
      grantId: grant.grantId,
      requestId: grant.requestId,
      memberNo: grant.memberNo,
      minutes: grant.minutes,
      consumedBeforeMinutes: grant.consumedBeforeMinutes,
      consumedAfterMinutes: grant.consumedAfterMinutes,
      reason: grant.reason,
      recovered: true
    })) {
      fail_('AUDIT_UNAVAILABLE', '分鐘已套用，但稽核紀錄暫時無法完成；請使用相同請求再次嘗試。');
    }
    grant.auditRecordedAt = now;
  }
  writeMinuteGrantRow_(match.row, grant);
  return grant;
}

function publicAdminMinuteGrant_(grant) {
  return {
    grantId: grant.grantId,
    memberNo: grant.memberNo,
    memberDisplayName: grant.memberDisplayName,
    minutes: grant.minutes,
    reason: grant.reason,
    status: grant.status,
    consumedBeforeMinutes: grant.consumedBeforeMinutes,
    consumedAfterMinutes: grant.consumedAfterMinutes,
    tierBefore: grant.tierBefore,
    tierAfter: grant.tierAfter,
    pushStatus: grant.pushStatus || 'pending',
    pushErrorCode: grant.pushErrorCode || '',
    pushAttemptedAt: grant.pushAttemptedAt || '',
    pushSentAt: grant.pushSentAt || '',
    grantedAt: grant.grantedAt || grant.createdAt,
    createdAt: grant.createdAt
  };
}

function publicMemberMinuteGrant_(grant) {
  return {
    grantId: grant.grantId,
    minutes: grant.minutes,
    reason: grant.reason,
    consumedAfterMinutes: grant.consumedAfterMinutes,
    tierAfter: grant.tierAfter,
    grantedAt: grant.grantedAt || grant.createdAt
  };
}

function adminMinuteGrant_(context, payload) {
  const input = readMinuteGrantInput_(payload);
  const memberSheet = getMembersSheet_();
  let grant;
  let updatedMember;
  let duplicate = false;

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(8000)) fail_('BUSY', '分鐘發放服務忙碌中，請稍後再試。');
  try {
    const memberRow = findMemberRowByMemberNo_(memberSheet, input.targetMemberNo);
    if (!memberRow) fail_('MEMBER_NOT_FOUND', '找不到指定會員。');
    let member = rowToMember_(memberSheet.getRange(memberRow, 1, 1, MEMBER_HEADERS.length).getValues()[0]);

    const existing = findMinuteGrantByFieldWithRow_('requestId', input.requestId);
    if (existing) {
      const existingGrant = existing.grant;
      if (existingGrant.memberNo !== member.memberNo || existingGrant.minutes !== input.minutes || existingGrant.reason !== input.reason) {
        fail_('REQUEST_CONFLICT', '此請求識別碼已用於其他分鐘發放操作。');
      }
      grant = recoverMinuteGrant_(existing, memberSheet, memberRow);
      member = rowToMember_(memberSheet.getRange(memberRow, 1, 1, MEMBER_HEADERS.length).getValues()[0]);
      duplicate = true;
      updatedMember = member;
    } else {
      if (!isMembershipUsable_(member)) {
        fail_('MEMBER_INACTIVE', '只能對目前有效且未過期的會員發放累計消費分鐘。');
      }
      if (member.consumedMinutes > 100000000 - input.minutes) {
        fail_('MINUTE_LIMIT_REACHED', '此會員累計消費分鐘已達系統上限。');
      }

      const now = new Date().toISOString();
      const consumedBefore = member.consumedMinutes;
      const consumedAfter = consumedBefore + input.minutes;
      const tierBefore = tierForConsumedMinutes_(consumedBefore);
      const tierAfter = tierForConsumedMinutes_(consumedAfter);
      grant = {
        grantId: newMinuteGrantId_(),
        requestId: input.requestId,
        memberLineUserId: member.lineUserId,
        memberNo: member.memberNo,
        memberDisplayName: member.displayName,
        minutes: input.minutes,
        reason: input.reason,
        status: 'processing',
        consumedBeforeMinutes: consumedBefore,
        consumedAfterMinutes: consumedAfter,
        tierBefore: tierBefore,
        tierAfter: tierAfter,
        grantedByLineUserId: context.identity.sub,
        pushStatus: 'pending',
        pushErrorCode: '',
        pushAttemptedAt: '',
        pushSentAt: '',
        createdAt: now,
        updatedAt: now,
        grantedAt: '',
        auditRecordedAt: ''
      };

      if (!audit_(context.identity.sub, 'admin', 'MEMBER_MINUTES_GRANT_REQUESTED', member.lineUserId, 'pending', {
        grantId: grant.grantId,
        requestId: grant.requestId,
        memberNo: member.memberNo,
        minutes: input.minutes,
        reason: input.reason
      })) {
        fail_('AUDIT_UNAVAILABLE', '稽核紀錄暫時無法寫入，分鐘尚未發放。');
      }
      getMinuteGrantsSheet_().appendRow(minuteGrantToRow_(grant));

      member.consumedMinutes = consumedAfter;
      member.tier = tierAfter;
      member.updatedAt = now;
      memberSheet.getRange(memberRow, 1, 1, MEMBER_HEADERS.length).setValues([memberToRow_(member)]);

      if (!audit_(context.identity.sub, 'admin', 'MEMBER_MINUTES_GRANTED', member.lineUserId, 'success', {
        grantId: grant.grantId,
        requestId: grant.requestId,
        memberNo: member.memberNo,
        minutes: input.minutes,
        consumedBeforeMinutes: consumedBefore,
        consumedAfterMinutes: consumedAfter,
        tierBefore: tierBefore,
        tierAfter: tierAfter,
        reason: input.reason
      })) {
        fail_('AUDIT_UNAVAILABLE', '分鐘已套用，但稽核紀錄暫時無法完成；請使用相同請求再次嘗試。');
      }

      grant.status = 'recorded';
      grant.grantedAt = now;
      grant.auditRecordedAt = now;
      grant.updatedAt = now;
      const stored = findMinuteGrantByFieldWithRow_('requestId', input.requestId);
      if (!stored) fail_('RECOVERY_REQUIRED', '分鐘發放紀錄遺失，請人工確認。');
      writeMinuteGrantRow_(stored.row, grant);
      updatedMember = member;
    }
  } finally {
    lock.releaseLock();
  }

  const push = attemptMinuteGrantPush_(grant.grantId);
  const refreshed = findMinuteGrantByFieldWithRow_('grantId', grant.grantId);
  const outputGrant = refreshed ? refreshed.grant : grant;
  return {
    duplicate: duplicate,
    grant: publicAdminMinuteGrant_(outputGrant),
    member: publicMember_(updatedMember, true),
    pushStatus: push.status,
    pushErrorCode: push.errorCode
  };
}

function minuteGrantPushMessage_(grant) {
  const beforeTier = MINUTE_GRANT_PUSH_LABELS[normalizeTier_(grant.tierBefore)] || '一般';
  const afterTier = MINUTE_GRANT_PUSH_LABELS[normalizeTier_(grant.tierAfter)] || '一般';
  const tierLine = beforeTier === afterTier ? afterTier : beforeTier + ' → ' + afterTier;
  return [
    '【會員累計消費分鐘發放】',
    '本次發放：' + grant.minutes + ' 分鐘',
    '發放原因：' + grant.reason,
    '累計消費：' + grant.consumedAfterMinutes + ' 分鐘',
    '會員等級：' + tierLine
  ].join('\n');
}

function attemptMinuteGrantPush_(grantId) {
  const match = findMinuteGrantByFieldWithRow_('grantId', cleanText_(grantId, 40, true));
  if (!match) fail_('GRANT_NOT_FOUND', '找不到指定分鐘發放紀錄。');
  const grant = match.grant;
  if (grant.status !== 'recorded') fail_('GRANT_NOT_READY', '此筆分鐘尚未完成發放。');
  if (grant.pushStatus === 'sent') return { status: 'sent', errorCode: '' };

  const client = createMembershipLineMessagingClient_();
  const result = client.sendTextPush(
    grant.memberLineUserId,
    membershipLineRetryKey_('minute-grant:' + grant.grantId),
    minuteGrantPushMessage_(grant)
  );

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return { status: grant.pushStatus || 'pending', errorCode: 'BUSY' };
  try {
    const latest = findMinuteGrantByFieldWithRow_('grantId', grant.grantId);
    if (!latest) return { status: 'failed', errorCode: 'GRANT_NOT_FOUND' };
    const updated = latest.grant;
    const now = new Date().toISOString();
    updated.pushAttemptedAt = now;
    updated.updatedAt = now;
    if (result.accepted) {
      updated.pushStatus = 'sent';
      updated.pushErrorCode = '';
      updated.pushSentAt = now;
      audit_(updated.grantedByLineUserId, 'admin', 'MEMBER_MINUTES_PUSH_SENT', updated.memberLineUserId, 'success', {
        grantId: updated.grantId, memberNo: updated.memberNo
      });
    } else {
      updated.pushStatus = result.configured === false ? 'not_configured' : 'failed';
      updated.pushErrorCode = result.errorCode || 'PUSH_FAILED';
      audit_(updated.grantedByLineUserId, 'admin', 'MEMBER_MINUTES_PUSH_FAILED', updated.memberLineUserId, 'failed', {
        grantId: updated.grantId, memberNo: updated.memberNo, errorCode: updated.pushErrorCode
      });
    }
    writeMinuteGrantRow_(latest.row, updated);
    return { status: updated.pushStatus, errorCode: updated.pushErrorCode };
  } finally {
    lock.releaseLock();
  }
}

function adminMinuteGrantRetryPush_(context, payload) {
  const grantId = cleanText_(payload && payload.grantId, 40, true);
  const push = attemptMinuteGrantPush_(grantId);
  const match = findMinuteGrantByFieldWithRow_('grantId', grantId);
  return { grant: publicAdminMinuteGrant_(match.grant), pushStatus: push.status, pushErrorCode: push.errorCode };
}

function adminMinuteGrantsList_(payload) {
  const limit = clampInt_(payload && payload.limit, 1, 100, 50);
  const sheet = getMinuteGrantsSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { grants: [] };
  const rows = sheet.getRange(2, 1, lastRow - 1, MINUTE_GRANT_HEADERS.length).getValues();
  const grants = rows.map(rowToMinuteGrant_)
    .sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); })
    .slice(0, limit)
    .map(publicAdminMinuteGrant_);
  return { grants: grants };
}

function memberMinuteGrantsList_(context, payload) {
  const limit = clampInt_(payload && payload.limit, 1, 50, 20);
  const sheet = getMinuteGrantsSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { grants: [] };
  const rows = sheet.getRange(2, 1, lastRow - 1, MINUTE_GRANT_HEADERS.length).getValues();
  const grants = rows.map(rowToMinuteGrant_)
    .filter(function (grant) {
      return grant.memberLineUserId === context.identity.sub && grant.status === 'recorded';
    })
    .sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); })
    .slice(0, limit)
    .map(publicMemberMinuteGrant_);
  return { grants: grants };
}
