'use strict';

function stampRecordMultiCard_(context, payload) {
  ensureMultiCardStorage_();
  const stampCode = cleanText_(payload.stampCode, 64, true).toLowerCase();
  const requestId = cleanText_(payload.requestId, 64, true).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(stampCode)) fail_('INVALID_STAMP_CODE', '集點 QR Code 格式不正確。');
  if (!/^[a-f0-9]{32,64}$/.test(requestId)) fail_('INVALID_REQUEST_ID', '集點請求識別碼格式不正確。');

  const memberSheet = getSheet_(POINTS_CARD_SHEETS.members);
  const voucherSheet = getMultiCardSheet_(MULTI_CARD_SHEETS.vouchers);
  const recordSheet = getMultiCardSheet_(MULTI_CARD_SHEETS.stampRecords);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(8000)) fail_('BUSY', '集點服務忙碌中，請稍後再試。');
  try {
    let memberMatch = findByFieldWithRow_(memberSheet, 'lineUserId', context.identity.sub);
    if (!memberMatch) fail_('MEMBER_NOT_FOUND', '請先開啟集點卡完成會員建立。');
    recoverProcessingCardStampRecordsForMember_(context.identity.sub);
    memberMatch = findByFieldWithRow_(memberSheet, 'lineUserId', context.identity.sub);
    const member = normalizeMember_(memberMatch.object);
    if (member.membershipStatus !== 'active') fail_('MEMBER_INACTIVE', '會員目前無法使用集點服務，請洽店家確認。');

    const existing = findMultiCardByFieldWithRow_(recordSheet, 'requestId', requestId);
    if (existing) {
      const record = normalizeCardStampRecord_(existing.object);
      const voucherForRequest = findMultiCardByFieldWithRow_(voucherSheet, 'shareCode', stampCode);
      if (record.memberLineUserId !== context.identity.sub || !voucherForRequest ||
        record.voucherId !== String(voucherForRequest.object.voucherId || '') ||
        record.cardId !== String(voucherForRequest.object.cardId || '')) {
        fail_('REQUEST_CONFLICT', '此請求識別碼已用於其他集點操作。');
      }
      recoverCardStampRecord_(existing);
      const recovered = normalizeCardStampRecord_(findMultiCardByFieldWithRow_(recordSheet, 'requestId', requestId).object);
      if (recovered.status !== 'recorded') fail_('RECOVERY_REQUIRED', '先前集點尚待人工確認，請聯絡店家。');
      const refreshedMember = normalizeMember_(findByFieldWithRow_(memberSheet, 'lineUserId', context.identity.sub).object);
      return {
        duplicate: true,
        stampCount: recovered.stampCount,
        unlockedRewards: [],
        member: publicMultiCardMember_(refreshedMember, { cardId: recovered.cardId }, false)
      };
    }

    const voucherMatch = findMultiCardByFieldWithRow_(voucherSheet, 'shareCode', stampCode);
    if (!voucherMatch) fail_('VOUCHER_NOT_FOUND', '找不到這組集點 QR Code。');
    const voucher = normalizeMultiCardVoucher_(voucherMatch.object);
    const cardMatch = findMultiCard_(voucher.cardId);
    if (!cardMatch) fail_('CARD_UNAVAILABLE', '這組 QR Code 所屬的集點卡已不存在。');
    if (!cardMatch.card.available) fail_('CARD_UNAVAILABLE', '這張集點卡目前不可集點。');
    validateMultiCardVoucherForStamp_(voucher);
    recoverProcessingCardStampRecordsForVoucher_(voucher.cardId, voucher.voucherId);
    assertMultiCardVoucherUsageAllowed_(voucher, readMultiCardObjects_(recordSheet), member.lineUserId);

    const progressMatch = ensureMemberCardProgress_(cardMatch.card, member);
    const progress = progressMatch.progress;
    const now = new Date().toISOString();
    const totalBefore = progress.totalStamps;
    if (totalBefore > 100000000 - voucher.stampCount) fail_('STAMP_LIMIT_REACHED', '此會員在這張卡的累計集點已達系統上限。');
    const totalAfter = totalBefore + voucher.stampCount;
    const settings = multiCardSettingsForProjection_(cardMatch.card);
    const unlockedRewards = rewardEntitlementsBetweenTotals_(totalBefore, totalAfter, settings);
    const record = {
      recordId: 'SR-' + randomHex_(10).toUpperCase(),
      requestId: requestId,
      cardId: cardMatch.card.cardId,
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
    appendMultiCardObject_(recordSheet, record);

    progress.totalStamps = totalAfter;
    progress.updatedAt = now;
    writeMultiCardObjectRow_(getMultiCardSheet_(MULTI_CARD_SHEETS.progress), progressMatch.row, progress);

    const recordMatch = findMultiCardByFieldWithRow_(recordSheet, 'requestId', requestId);
    record.status = 'recorded';
    record.updatedAt = now;
    record.recordedAt = now;
    if (!audit_(member.lineUserId, 'member', 'CARD_STAMP_RECORDED', member.lineUserId, 'success', {
      cardId: cardMatch.card.cardId,
      memberNo: member.memberNo,
      voucherId: voucher.voucherId,
      stampCount: voucher.stampCount,
      totalBefore: totalBefore,
      totalAfter: totalAfter,
      requestId: requestId
    })) fail_('AUDIT_UNAVAILABLE', '稽核紀錄暫時無法寫入；再次嘗試會恢復同一筆集點。');
    record.auditRecordedAt = now;
    writeMultiCardObjectRow_(recordSheet, recordMatch.row, record);

    const publicUnlocked = unlockedRewards.map(function (reward) {
      const ticket = publicRewardTicket_(reward);
      ticket.cardId = cardMatch.card.cardId;
      return ticket;
    });
    return {
      duplicate: false,
      stampCount: voucher.stampCount,
      unlockedRewards: publicUnlocked,
      member: publicMultiCardMember_(member, { cardId: cardMatch.card.cardId }, false)
    };
  } finally {
    lock.releaseLock();
  }
}

function normalizeCardStampRecord_(value) {
  return {
    recordId: String(value.recordId || ''),
    requestId: String(value.requestId || ''),
    cardId: String(value.cardId || ''),
    voucherId: String(value.voucherId || ''),
    memberLineUserId: String(value.memberLineUserId || ''),
    memberNo: String(value.memberNo || ''),
    stampCount: storedNonNegativeInt_(value.stampCount, MAX_STAMPS_PER_SCAN),
    note: String(value.note || ''),
    status: String(value.status || ''),
    totalBefore: storedNonNegativeInt_(value.totalBefore, 100000000),
    totalAfter: storedNonNegativeInt_(value.totalAfter, 100000000),
    createdAt: String(value.createdAt || ''),
    updatedAt: String(value.updatedAt || ''),
    recordedAt: String(value.recordedAt || ''),
    auditRecordedAt: String(value.auditRecordedAt || '')
  };
}

function recoverProcessingCardStampRecordsForMember_(lineUserId) {
  const sheet = getMultiCardSheet_(MULTI_CARD_SHEETS.stampRecords);
  readMultiCardObjects_(sheet).forEach(function (record) {
    if (record.memberLineUserId === lineUserId && record.status === 'processing') {
      const match = findMultiCardByFieldWithRow_(sheet, 'requestId', record.requestId);
      if (match) recoverCardStampRecord_(match);
    }
  });
}

function recoverProcessingCardStampRecordsForVoucher_(cardId, voucherId) {
  const sheet = getMultiCardSheet_(MULTI_CARD_SHEETS.stampRecords);
  readMultiCardObjects_(sheet).forEach(function (record) {
    if (record.cardId === cardId && record.voucherId === voucherId && record.status === 'processing') {
      const match = findMultiCardByFieldWithRow_(sheet, 'requestId', record.requestId);
      if (match) recoverCardStampRecord_(match);
    }
  });
}

function recoverCardStampRecord_(recordMatch) {
  const recordSheet = getMultiCardSheet_(MULTI_CARD_SHEETS.stampRecords);
  const record = normalizeCardStampRecord_(recordMatch.object);
  if (record.status === 'recorded') return record;
  if (record.status !== 'processing') fail_('RECOVERY_REQUIRED', '集點紀錄狀態不正確，請聯絡店家。');
  const cardMatch = findMultiCard_(record.cardId);
  if (!cardMatch) fail_('RECOVERY_REQUIRED', '集點卡已不存在，請聯絡店家確認此筆交易。');
  const progressMatch = findMemberCardProgress_(record.cardId, record.memberLineUserId);
  if (!progressMatch) fail_('RECOVERY_REQUIRED', '會員集點進度不存在，請聯絡店家。');
  const progress = progressMatch.progress;
  const now = new Date().toISOString();
  if (progress.totalStamps === record.totalBefore) {
    progress.totalStamps = record.totalAfter;
    progress.updatedAt = now;
    writeMultiCardObjectRow_(getMultiCardSheet_(MULTI_CARD_SHEETS.progress), progressMatch.row, progress);
  } else if (progress.totalStamps !== record.totalAfter) {
    fail_('RECOVERY_REQUIRED', '集點資料需要人工確認，請聯絡店家。');
  }
  record.status = 'recorded';
  record.updatedAt = now;
  record.recordedAt = record.recordedAt || now;
  if (!record.auditRecordedAt) {
    if (!audit_(record.memberLineUserId, 'member', 'CARD_STAMP_RECOVERED', record.memberLineUserId, 'success', {
      cardId: record.cardId,
      memberNo: record.memberNo,
      voucherId: record.voucherId,
      stampCount: record.stampCount,
      requestId: record.requestId
    })) fail_('AUDIT_UNAVAILABLE', '稽核紀錄暫時無法寫入；請使用相同請求再次嘗試。');
    record.auditRecordedAt = now;
  }
  writeMultiCardObjectRow_(recordSheet, recordMatch.row, record);
  return record;
}

function validateMultiCardVoucherForStamp_(voucher) {
  if (voucher.status !== 'active') fail_('VOUCHER_INACTIVE', '這組集點 QR Code 已停止使用。');
  if (voucher.expiresAt && new Date(voucher.expiresAt).getTime() <= Date.now()) fail_('VOUCHER_EXPIRED', '這組集點 QR Code 已過期。');
}

function assertMultiCardVoucherUsageAllowed_(voucher, records, memberLineUserId) {
  const recorded = records.filter(function (record) {
    return record.voucherId === voucher.voucherId && record.cardId === voucher.cardId && record.status === 'recorded';
  });
  if (voucher.scanMode === 'single' && recorded.length) fail_('VOUCHER_USED', '這組單次集點 QR Code 已經使用過。');
  if (voucher.scanMode === 'per-member' && recorded.some(function (record) { return record.memberLineUserId === memberLineUserId; })) {
    fail_('VOUCHER_USED', '這組集點 QR Code 此會員已使用過。');
  }
}

function normalizeMultiCardVoucher_(value) {
  return {
    voucherId: String(value.voucherId || ''),
    cardId: String(value.cardId || ''),
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

function publicMultiCardVoucher_(voucher, recordCount, includeShareCode) {
  const cardMatch = findMultiCard_(voucher.cardId);
  const result = {
    voucherId: voucher.voucherId,
    cardId: voucher.cardId,
    cardName: cardMatch ? cardMatch.card.name : '',
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

function assertMultiCardVoucherBelongsToCard_(voucher, cardId) {
  if (String(voucher && voucher.cardId || '') !== String(cardId || '')) {
    fail_('VOUCHER_CARD_MISMATCH', '這組 QR Code 不屬於目前選取的集點卡。');
  }
}

function newMultiCardVoucherId_(sheet) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const voucherId = 'SQ-' + Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyMMdd') + '-' + randomHex_(4).toUpperCase();
    if (!findMultiCardByFieldWithRow_(sheet, 'voucherId', voucherId)) return voucherId;
  }
  fail_('INTERNAL_ERROR', '無法產生唯一的 QR Code 識別碼。');
}

function adminStampListMultiCard_(payload) {
  ensureMultiCardStorage_();
  const cardId = validMultiCardId_(payload && payload.cardId, true);
  const cardMatch = findMultiCard_(cardId);
  if (!cardMatch) fail_('CARD_NOT_FOUND', '找不到指定集點卡。');
  const selected = cardMatch.card;
  const maxRows = clampInt_(payload && payload.limit, 1, 100, 50);
  const recordCounts = readMultiCardObjects_(getMultiCardSheet_(MULTI_CARD_SHEETS.stampRecords)).reduce(function (counts, record) {
    if (record.cardId === selected.cardId && record.status === 'recorded') counts[record.voucherId] = (counts[record.voucherId] || 0) + 1;
    return counts;
  }, {});
  const vouchers = readMultiCardObjects_(getMultiCardSheet_(MULTI_CARD_SHEETS.vouchers)).map(normalizeMultiCardVoucher_).filter(function (voucher) {
    return voucher.cardId === selected.cardId && voucher.status !== 'deleted';
  }).sort(function (a, b) {
    return String(b.createdAt).localeCompare(String(a.createdAt));
  }).slice(0, maxRows).map(function (voucher) {
    return publicMultiCardVoucher_(voucher, recordCounts[voucher.voucherId] || 0, false);
  });
  return { vouchers: vouchers };
}

function adminStampCreateMultiCard_(context, payload) {
  ensureMultiCardStorage_();
  const cardId = validMultiCardId_(payload.cardId, true);
  const cardMatch = findMultiCard_(cardId);
  if (!cardMatch) fail_('CARD_NOT_FOUND', '找不到指定集點卡。');
  if (!cardMatch.card.available) fail_('CARD_UNAVAILABLE', '這張集點卡目前不可建立集點 QR Code。');
  const stampCount = strictInt_(payload.stampCount, 1, MAX_STAMPS_PER_SCAN, 'INVALID_STAMP_COUNT', '集點數量必須是 1 到 10 的整數。');
  const scanMode = enumValue_(payload.scanMode, STAMP_SCAN_MODES, 'INVALID_SCAN_MODE', 'QR Code 使用模式不正確。');
  const rawExpiresAt = cleanText_(payload.expiresAt || '', 40, false);
  const expiresAt = rawExpiresAt ? validIsoFuture_(rawExpiresAt) : '';
  const note = cleanText_(payload.note || '', 200, false);
  const sheet = getMultiCardSheet_(MULTI_CARD_SHEETS.vouchers);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) fail_('BUSY', '系統忙碌中，請稍後再試。');
  try {
    const freshCard = findMultiCard_(cardId);
    if (!freshCard || !freshCard.card.available) fail_('CARD_UNAVAILABLE', '這張集點卡目前不可建立集點 QR Code。');
    const now = new Date().toISOString();
    let shareCode = '';
    for (let attempt = 0; attempt < 8; attempt += 1) {
      shareCode = randomHex_(32);
      if (!findMultiCardByFieldWithRow_(sheet, 'shareCode', shareCode)) break;
      shareCode = '';
    }
    if (!shareCode) fail_('INTERNAL_ERROR', '無法產生 QR Code 識別碼。');
    const voucher = {
      voucherId: newMultiCardVoucherId_(sheet),
      cardId: cardId,
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
    if (!audit_(context.identity.sub, 'admin', 'CARD_STAMP_QR_CREATE_REQUESTED', '', 'pending', {
      cardId: cardId,
      voucherId: voucher.voucherId,
      stampCount: stampCount,
      scanMode: scanMode,
      expiresAt: expiresAt || 'unlimited'
    })) fail_('AUDIT_UNAVAILABLE', '稽核紀錄暫時無法寫入，QR Code 尚未建立。');
    appendMultiCardObject_(sheet, voucher);
    audit_(context.identity.sub, 'admin', 'CARD_STAMP_QR_CREATED', '', 'success', {
      cardId: cardId,
      voucherId: voucher.voucherId
    });
    return { voucher: publicMultiCardVoucher_(normalizeMultiCardVoucher_(voucher), 0, true) };
  } finally {
    lock.releaseLock();
  }
}

function adminStampOpenMultiCard_(payload) {
  ensureMultiCardStorage_();
  const cardId = validMultiCardId_(payload.cardId, true);
  const voucherId = cleanText_(payload.voucherId, 40, true);
  const match = findMultiCardByFieldWithRow_(getMultiCardSheet_(MULTI_CARD_SHEETS.vouchers), 'voucherId', voucherId);
  if (!match) fail_('VOUCHER_NOT_FOUND', '找不到指定 QR Code。');
  const voucher = normalizeMultiCardVoucher_(match.object);
  assertMultiCardVoucherBelongsToCard_(voucher, cardId);
  if (voucher.status === 'cancelled' || voucher.status === 'deleted') fail_('VOUCHER_INACTIVE', '已停止或刪除的 QR Code 不再提供發放連結。');
  return { voucher: publicMultiCardVoucher_(voucher, countMultiCardVoucherRecords_(cardId, voucherId), true) };
}

function adminStampCancelMultiCard_(context, payload) {
  ensureMultiCardStorage_();
  const cardId = validMultiCardId_(payload.cardId, true);
  const voucherId = cleanText_(payload.voucherId, 40, true);
  const expectedUpdatedAt = cleanText_(payload.expectedUpdatedAt, 40, true);
  const sheet = getMultiCardSheet_(MULTI_CARD_SHEETS.vouchers);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) fail_('BUSY', '系統忙碌中，請稍後再試。');
  try {
    const match = findMultiCardByFieldWithRow_(sheet, 'voucherId', voucherId);
    if (!match) fail_('VOUCHER_NOT_FOUND', '找不到指定 QR Code。');
    const voucher = normalizeMultiCardVoucher_(match.object);
    assertMultiCardVoucherBelongsToCard_(voucher, cardId);
    if (voucher.updatedAt !== expectedUpdatedAt) fail_('CONFLICT', 'QR Code 已被更新，請重新整理後再試。');
    if (voucher.status !== 'active') fail_('VOUCHER_INACTIVE', '這組 QR Code 已停止使用。');
    const now = new Date().toISOString();
    voucher.status = 'cancelled';
    voucher.cancelledByLineUserId = context.identity.sub;
    voucher.cancelledAt = now;
    voucher.updatedAt = now;
    if (!audit_(context.identity.sub, 'admin', 'CARD_STAMP_QR_CANCEL_REQUESTED', '', 'pending', { cardId: voucher.cardId, voucherId: voucherId })) {
      fail_('AUDIT_UNAVAILABLE', '稽核紀錄暫時無法寫入，QR Code 未停止。');
    }
    writeMultiCardObjectRow_(sheet, match.row, voucher);
    audit_(context.identity.sub, 'admin', 'CARD_STAMP_QR_CANCELLED', '', 'success', { cardId: voucher.cardId, voucherId: voucherId });
    return { voucher: publicMultiCardVoucher_(voucher, countMultiCardVoucherRecords_(cardId, voucherId), false) };
  } finally {
    lock.releaseLock();
  }
}

function adminStampDeleteMultiCard_(context, payload) {
  ensureMultiCardStorage_();
  const cardId = validMultiCardId_(payload.cardId, true);
  const voucherId = cleanText_(payload.voucherId, 40, true);
  const expectedUpdatedAt = cleanText_(payload.expectedUpdatedAt, 40, true);
  const sheet = getMultiCardSheet_(MULTI_CARD_SHEETS.vouchers);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) fail_('BUSY', '系統忙碌中，請稍後再試。');
  try {
    const match = findMultiCardByFieldWithRow_(sheet, 'voucherId', voucherId);
    if (!match) fail_('VOUCHER_NOT_FOUND', '找不到指定 QR Code。');
    const voucher = normalizeMultiCardVoucher_(match.object);
    assertMultiCardVoucherBelongsToCard_(voucher, cardId);
    if (voucher.updatedAt !== expectedUpdatedAt) fail_('CONFLICT', 'QR Code 已被更新，請重新整理後再試。');
    if (voucher.status === 'deleted') fail_('VOUCHER_NOT_FOUND', '找不到指定 QR Code。');
    const hasRecords = readMultiCardObjects_(getMultiCardSheet_(MULTI_CARD_SHEETS.stampRecords)).some(function (record) {
      return record.cardId === cardId && record.voucherId === voucherId;
    });
    if (!audit_(context.identity.sub, 'admin', 'CARD_STAMP_QR_DELETE_REQUESTED', '', 'pending', {
      cardId: voucher.cardId,
      voucherId: voucherId,
      preserveHistory: hasRecords
    })) fail_('AUDIT_UNAVAILABLE', '稽核紀錄暫時無法寫入，QR Code 未刪除。');
    if (hasRecords) {
      const now = new Date().toISOString();
      voucher.status = 'deleted';
      voucher.cancelledByLineUserId = context.identity.sub;
      voucher.cancelledAt = voucher.cancelledAt || now;
      voucher.updatedAt = now;
      writeMultiCardObjectRow_(sheet, match.row, voucher);
    } else {
      deleteMultiCardObjectRow_(sheet, match.row);
    }
    audit_(context.identity.sub, 'admin', 'CARD_STAMP_QR_DELETED', '', 'success', {
      cardId: voucher.cardId,
      voucherId: voucherId,
      preserveHistory: hasRecords
    });
    return { voucherId: voucherId, preservedHistory: hasRecords };
  } finally {
    lock.releaseLock();
  }
}

function countMultiCardVoucherRecords_(cardId, voucherId) {
  return readMultiCardObjects_(getMultiCardSheet_(MULTI_CARD_SHEETS.stampRecords)).filter(function (record) {
    return record.cardId === cardId && record.voucherId === voucherId && record.status === 'recorded';
  }).length;
}
