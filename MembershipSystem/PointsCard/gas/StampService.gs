'use strict';

function stampRecord_(context, payload) {
  const stampCode = cleanText_(payload.stampCode, 64, true).toLowerCase();
  const requestId = cleanText_(payload.requestId, 64, true).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(stampCode)) fail_('INVALID_STAMP_CODE', '集點 QR Code 格式不正確。');
  if (!/^[a-f0-9]{32,64}$/.test(requestId)) fail_('INVALID_REQUEST_ID', '集點請求識別碼格式不正確。');

  const memberSheet = getSheet_(POINTS_CARD_SHEETS.members);
  const voucherSheet = getSheet_(POINTS_CARD_SHEETS.vouchers);
  const recordSheet = getSheet_(POINTS_CARD_SHEETS.stampRecords);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(8000)) fail_('BUSY', '集點服務忙碌中，請稍後再試。');
  try {
    let memberMatch = findByFieldWithRow_(memberSheet, 'lineUserId', context.identity.sub);
    if (!memberMatch) fail_('MEMBER_NOT_FOUND', '請先開啟集點卡完成會員建立。');
    recoverProcessingStampRecordsForMember_(context.identity.sub);
    memberMatch = findByFieldWithRow_(memberSheet, 'lineUserId', context.identity.sub);
    let member = normalizeMember_(memberMatch.object);
    if (member.membershipStatus !== 'active') fail_('MEMBER_INACTIVE', '這張集點卡目前無法使用，請洽店家確認。');

    const existing = findByFieldWithRow_(recordSheet, 'requestId', requestId);
    if (existing) {
      const record = existing.object;
      const voucherMatchForRequest = findByFieldWithRow_(voucherSheet, 'shareCode', stampCode);
      if (record.memberLineUserId !== context.identity.sub || !voucherMatchForRequest || record.voucherId !== voucherMatchForRequest.object.voucherId) {
        fail_('REQUEST_CONFLICT', '此請求識別碼已用於其他集點操作。');
      }
      recoverStampRecord_(existing);
      const recovered = findByFieldWithRow_(recordSheet, 'requestId', requestId).object;
      if (recovered.status !== 'recorded') fail_('RECOVERY_REQUIRED', '先前集點尚待人工確認，請聯絡店家。');
      member = normalizeMember_(findByFieldWithRow_(memberSheet, 'lineUserId', context.identity.sub).object);
      return {
        duplicate: true,
        stampCount: Number(recovered.stampCount || 0),
        member: publicMember_(member, false),
        activity: listMemberActivity_(member.lineUserId, 20)
      };
    }

    const voucherMatch = findByFieldWithRow_(voucherSheet, 'shareCode', stampCode);
    if (!voucherMatch) fail_('VOUCHER_NOT_FOUND', '找不到這組集點 QR Code。');
    const voucher = normalizeVoucher_(voucherMatch.object);
    validateVoucherForStamp_(voucher);
    recoverProcessingStampRecordsForVoucher_(voucher.voucherId);
    if (voucher.scanMode === 'single') {
      const used = readObjects_(recordSheet).some(function (record) {
        return record.voucherId === voucher.voucherId && record.status === 'recorded';
      });
      if (used) fail_('VOUCHER_USED', '這組單次集點 QR Code 已經使用過。');
    }

    memberMatch = findByFieldWithRow_(memberSheet, 'lineUserId', context.identity.sub);
    member = normalizeMember_(memberMatch.object);
    const now = new Date().toISOString();
    const totalBefore = member.totalStamps;
    if (totalBefore > 100000000 - voucher.stampCount) fail_('STAMP_LIMIT_REACHED', '此會員的累計集點已達系統上限。');
    const totalAfter = totalBefore + voucher.stampCount;
    const record = {
      recordId: 'SR-' + randomHex_(10).toUpperCase(),
      requestId: requestId,
      voucherId: voucher.voucherId,
      memberLineUserId: member.lineUserId,
      memberNo: member.memberNo,
      stampCount: voucher.stampCount,
      note: voucher.note,
      status: 'processing',
      totalBefore: totalBefore,
      totalAfter: totalAfter,
      createdAt: now,
      updatedAt: now,
      recordedAt: '',
      auditRecordedAt: ''
    };
    appendObject_(recordSheet, record);

    member.totalStamps = totalAfter;
    member.updatedAt = now;
    writeObjectRow_(memberSheet, memberMatch.row, member);

    const recordMatch = findByFieldWithRow_(recordSheet, 'requestId', requestId);
    record.status = 'recorded';
    record.updatedAt = now;
    record.recordedAt = now;
    if (!audit_(member.lineUserId, 'member', 'STAMP_RECORDED', member.lineUserId, 'success', {
      memberNo: member.memberNo,
      voucherId: voucher.voucherId,
      stampCount: voucher.stampCount,
      totalBefore: totalBefore,
      totalAfter: totalAfter,
      requestId: requestId
    })) fail_('AUDIT_UNAVAILABLE', '稽核紀錄暫時無法寫入；再次嘗試會恢復同一筆集點。');
    record.auditRecordedAt = now;
    writeObjectRow_(recordSheet, recordMatch.row, record);

    return {
      duplicate: false,
      stampCount: voucher.stampCount,
      member: publicMember_(member, false),
      activity: listMemberActivity_(member.lineUserId, 20)
    };
  } finally { lock.releaseLock(); }
}

function validateVoucherForStamp_(voucher) {
  if (voucher.status !== 'active') fail_('VOUCHER_INACTIVE', '這組集點 QR Code 已停止使用。');
  if (!voucher.expiresAt || new Date(voucher.expiresAt).getTime() <= Date.now()) fail_('VOUCHER_EXPIRED', '這組集點 QR Code 已過期。');
}

function recoverProcessingStampRecordsForMember_(lineUserId) {
  const sheet = getSheet_(POINTS_CARD_SHEETS.stampRecords);
  readObjects_(sheet).forEach(function (record) {
    if (record.memberLineUserId === lineUserId && record.status === 'processing') {
      const match = findByFieldWithRow_(sheet, 'requestId', record.requestId);
      if (match) recoverStampRecord_(match);
    }
  });
}

function recoverProcessingStampRecordsForVoucher_(voucherId) {
  const sheet = getSheet_(POINTS_CARD_SHEETS.stampRecords);
  readObjects_(sheet).forEach(function (record) {
    if (record.voucherId === voucherId && record.status === 'processing') {
      const match = findByFieldWithRow_(sheet, 'requestId', record.requestId);
      if (match) recoverStampRecord_(match);
    }
  });
}

function recoverStampRecord_(recordMatch) {
  const recordSheet = getSheet_(POINTS_CARD_SHEETS.stampRecords);
  const memberSheet = getSheet_(POINTS_CARD_SHEETS.members);
  const record = recordMatch.object;
  if (record.status === 'recorded') return record;
  if (record.status !== 'processing') fail_('RECOVERY_REQUIRED', '集點紀錄狀態不正確，請聯絡店家。');
  const memberMatch = findByFieldWithRow_(memberSheet, 'lineUserId', record.memberLineUserId);
  if (!memberMatch) fail_('RECOVERY_REQUIRED', '集點會員資料不存在，請聯絡店家。');
  const member = normalizeMember_(memberMatch.object);
  const totalBefore = storedNonNegativeInt_(record.totalBefore, 100000000);
  const totalAfter = storedNonNegativeInt_(record.totalAfter, 100000000);
  const now = new Date().toISOString();
  if (member.totalStamps === totalBefore) {
    member.totalStamps = totalAfter;
    member.updatedAt = now;
    writeObjectRow_(memberSheet, memberMatch.row, member);
  } else if (member.totalStamps !== totalAfter) {
    fail_('RECOVERY_REQUIRED', '集點資料需要人工確認，請聯絡店家。');
  }
  record.status = 'recorded';
  record.updatedAt = now;
  record.recordedAt = record.recordedAt || now;
  if (!record.auditRecordedAt) {
    if (!audit_(record.memberLineUserId, 'member', 'STAMP_RECOVERED', record.memberLineUserId, 'success', {
      memberNo: record.memberNo,
      voucherId: record.voucherId,
      stampCount: storedNonNegativeInt_(record.stampCount, MAX_STAMPS_PER_SCAN),
      requestId: record.requestId
    })) fail_('AUDIT_UNAVAILABLE', '稽核紀錄暫時無法寫入；請使用相同請求再次嘗試。');
    record.auditRecordedAt = now;
  }
  writeObjectRow_(recordSheet, recordMatch.row, record);
  return record;
}

function adminStampList_(limit) {
  const maxRows = clampInt_(limit, 1, 100, 50);
  const recordCounts = readObjects_(getSheet_(POINTS_CARD_SHEETS.stampRecords)).reduce(function (counts, record) {
    if (record.status === 'recorded') counts[record.voucherId] = (counts[record.voucherId] || 0) + 1;
    return counts;
  }, {});
  return readObjects_(getSheet_(POINTS_CARD_SHEETS.vouchers)).map(normalizeVoucher_).sort(function (a, b) {
    return String(b.createdAt).localeCompare(String(a.createdAt));
  }).slice(0, maxRows).map(function (voucher) {
    return publicVoucher_(voucher, recordCounts[voucher.voucherId] || 0, false);
  });
}

function adminStampCreate_(context, payload) {
  const stampCount = strictInt_(payload.stampCount, 1, MAX_STAMPS_PER_SCAN, 'INVALID_STAMP_COUNT', '集點數量必須是 1 到 10 的整數。');
  const scanMode = enumValue_(payload.scanMode, STAMP_SCAN_MODES, 'INVALID_SCAN_MODE', 'QR Code 使用模式不正確。');
  const expiresAt = validIsoFuture_(payload.expiresAt);
  const note = cleanText_(payload.note || '', 200, false);
  const sheet = getSheet_(POINTS_CARD_SHEETS.vouchers);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) fail_('BUSY', '系統忙碌中，請稍後再試。');
  try {
    const now = new Date().toISOString();
    let shareCode;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      shareCode = randomHex_(32);
      if (!findByFieldWithRow_(sheet, 'shareCode', shareCode)) break;
      shareCode = '';
    }
    if (!shareCode) fail_('INTERNAL_ERROR', '無法產生 QR Code 識別碼。');
    const voucher = {
      voucherId: 'SQ-' + Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyMMdd') + '-' + randomHex_(4).toUpperCase(),
      shareCode: shareCode,
      stampCount: stampCount,
      scanMode: scanMode,
      status: 'active',
      expiresAt: expiresAt,
      note: note,
      createdByLineUserId: context.identity.sub,
      createdAt: now,
      updatedAt: now,
      cancelledByLineUserId: '',
      cancelledAt: ''
    };
    if (!audit_(context.identity.sub, 'admin', 'STAMP_QR_CREATE_REQUESTED', '', 'pending', {
      voucherId: voucher.voucherId, stampCount: stampCount, scanMode: scanMode, expiresAt: expiresAt
    })) fail_('AUDIT_UNAVAILABLE', '稽核紀錄暫時無法寫入，QR Code 尚未建立。');
    appendObject_(sheet, voucher);
    audit_(context.identity.sub, 'admin', 'STAMP_QR_CREATED', '', 'success', {
      voucherId: voucher.voucherId, stampCount: stampCount, scanMode: scanMode, expiresAt: expiresAt
    });
    return { voucher: publicVoucher_(voucher, 0, true) };
  } finally { lock.releaseLock(); }
}

function adminStampOpen_(payload) {
  const voucherId = cleanText_(payload.voucherId, 40, true);
  const voucherMatch = findByFieldWithRow_(getSheet_(POINTS_CARD_SHEETS.vouchers), 'voucherId', voucherId);
  if (!voucherMatch) fail_('VOUCHER_NOT_FOUND', '找不到指定 QR Code。');
  const voucher = normalizeVoucher_(voucherMatch.object);
  if (voucher.status === 'cancelled') fail_('VOUCHER_INACTIVE', '已停止的 QR Code 不再提供發放連結。');
  const recordCount = countVoucherRecords_(voucherId);
  return { voucher: publicVoucher_(voucher, recordCount, true) };
}

function adminStampCancel_(context, payload) {
  const voucherId = cleanText_(payload.voucherId, 40, true);
  const expectedUpdatedAt = cleanText_(payload.expectedUpdatedAt, 40, true);
  const sheet = getSheet_(POINTS_CARD_SHEETS.vouchers);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) fail_('BUSY', '系統忙碌中，請稍後再試。');
  try {
    const match = findByFieldWithRow_(sheet, 'voucherId', voucherId);
    if (!match) fail_('VOUCHER_NOT_FOUND', '找不到指定 QR Code。');
    const voucher = normalizeVoucher_(match.object);
    if (voucher.updatedAt !== expectedUpdatedAt) fail_('CONFLICT', 'QR Code 已被更新，請重新整理後再試。');
    if (voucher.status !== 'active') fail_('VOUCHER_INACTIVE', '這組 QR Code 已停止使用。');
    const now = new Date().toISOString();
    voucher.status = 'cancelled';
    voucher.cancelledByLineUserId = context.identity.sub;
    voucher.cancelledAt = now;
    voucher.updatedAt = now;
    if (!audit_(context.identity.sub, 'admin', 'STAMP_QR_CANCEL_REQUESTED', '', 'pending', { voucherId: voucherId })) {
      fail_('AUDIT_UNAVAILABLE', '稽核紀錄暫時無法寫入，QR Code 未停止。');
    }
    writeObjectRow_(sheet, match.row, voucher);
    audit_(context.identity.sub, 'admin', 'STAMP_QR_CANCELLED', '', 'success', { voucherId: voucherId });
    return { voucher: publicVoucher_(voucher, countVoucherRecords_(voucherId), false) };
  } finally { lock.releaseLock(); }
}

function adminStampDelete_(context, payload) {
  const voucherId = cleanText_(payload.voucherId, 40, true);
  const expectedUpdatedAt = cleanText_(payload.expectedUpdatedAt, 40, true);
  const sheet = getSheet_(POINTS_CARD_SHEETS.vouchers);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) fail_('BUSY', '系統忙碌中，請稍後再試。');
  try {
    const match = findByFieldWithRow_(sheet, 'voucherId', voucherId);
    if (!match) fail_('VOUCHER_NOT_FOUND', '找不到指定 QR Code。');
    const voucher = normalizeVoucher_(match.object);
    if (voucher.updatedAt !== expectedUpdatedAt) fail_('CONFLICT', 'QR Code 已被更新，請重新整理後再試。');
    const hasRecords = readObjects_(getSheet_(POINTS_CARD_SHEETS.stampRecords)).some(function (record) {
      return record.voucherId === voucherId;
    });
    if (hasRecords) fail_('VOUCHER_HAS_RECORDS', '已有集點紀錄的 QR Code 只能停止，不能刪除。');
    if (!audit_(context.identity.sub, 'admin', 'STAMP_QR_DELETE_REQUESTED', '', 'pending', { voucherId: voucherId })) {
      fail_('AUDIT_UNAVAILABLE', '稽核紀錄暫時無法寫入，QR Code 未刪除。');
    }
    sheet.deleteRow(match.row);
    audit_(context.identity.sub, 'admin', 'STAMP_QR_DELETED', '', 'success', { voucherId: voucherId });
    return { voucherId: voucherId };
  } finally { lock.releaseLock(); }
}

function normalizeVoucher_(value) {
  return {
    voucherId: String(value.voucherId || ''),
    shareCode: String(value.shareCode || ''),
    stampCount: storedVoucherStampCount_(value.stampCount),
    scanMode: storedScanMode_(value.scanMode),
    status: String(value.status || 'cancelled'),
    expiresAt: String(value.expiresAt || ''),
    note: String(value.note || ''),
    createdByLineUserId: String(value.createdByLineUserId || ''),
    createdAt: String(value.createdAt || ''),
    updatedAt: String(value.updatedAt || ''),
    cancelledByLineUserId: String(value.cancelledByLineUserId || ''),
    cancelledAt: String(value.cancelledAt || '')
  };
}

function publicVoucher_(voucher, recordCount, includeShareCode) {
  const result = {
    voucherId: voucher.voucherId,
    stampCount: voucher.stampCount,
    scanMode: voucher.scanMode,
    status: voucher.status,
    expiresAt: voucher.expiresAt,
    note: voucher.note,
    createdAt: voucher.createdAt,
    updatedAt: voucher.updatedAt,
    recordCount: Number(recordCount || 0)
  };
  if (includeShareCode) result.shareCode = voucher.shareCode;
  return result;
}

function countVoucherRecords_(voucherId) {
  return readObjects_(getSheet_(POINTS_CARD_SHEETS.stampRecords)).filter(function (record) {
    return record.voucherId === voucherId && record.status === 'recorded';
  }).length;
}

function storedVoucherStampCount_(value) {
  const stampCount = storedNonNegativeInt_(value, MAX_STAMPS_PER_SCAN);
  if (stampCount < 1) fail_('DATA_INTEGRITY_ERROR', 'QR Code 點數資料異常，請聯絡管理員。');
  return stampCount;
}

function storedScanMode_(value) {
  const mode = String(value || '');
  if (STAMP_SCAN_MODES.indexOf(mode) < 0) fail_('DATA_INTEGRITY_ERROR', 'QR Code 模式資料異常，請聯絡管理員。');
  return mode;
}
