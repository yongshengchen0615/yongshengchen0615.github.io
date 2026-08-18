'use strict';

function adminUsageUpdate_(context, payload) {
  const voucherId = cleanText_(payload.voucherId, 40, true);
  const expectedUpdatedAt = cleanText_(payload.expectedUpdatedAt, 40, true);
  const minutes = validateMinutes_(payload.minutes, false);
  const scanMode = enumValue_(payload.scanMode, ALLOWED_SCAN_MODES, 'INVALID_SCAN_MODE', '掃描模式不正確。');
  const expiresAt = validateVoucherExpiry_(payload.expiresAt);
  const note = cleanText_(payload.note || '', 200, false);
  const sheet = getUsageVouchersSheet_();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) fail_('BUSY', '系統忙碌中，請稍後再試。');

  try {
    const row = findUsageVoucherRowById_(sheet, voucherId);
    if (!row) fail_('VOUCHER_NOT_FOUND', '找不到指定 QR Code。');

    const voucher = rowToUsageVoucher_(sheet.getRange(row, 1, 1, USAGE_VOUCHER_HEADERS.length).getValues()[0]);
    if (String(voucher.updatedAt) !== expectedUpdatedAt) {
      fail_('CONFLICT', 'QR Code 已被其他操作更新，請重新整理後再試。');
    }
    if (isLegacyTargetedVoucher_(voucher)) {
      fail_('LEGACY_VOUCHER_READ_ONLY', '舊版指定會員 QR Code 不支援修改，請重新建立新的 QR Code。');
    }

    const recordsSheet = getUsageRecordsSheet_();
    if (findProcessingUsageRecordRowByVoucher_(recordsSheet, voucher.voucherId)) {
      fail_('VOUCHER_IN_USE', '此 QR Code 正在處理消費紀錄，請稍後再試。');
    }

    const recordCount = countUsageRecords_(voucher.voucherId);
    if (recordCount > 0) {
      fail_('VOUCHER_HAS_RECORDS', '此 QR Code 已有消費紀錄，為保持歷史資料一致性不可修改。');
    }
    if (effectiveVoucherStatus_(voucher, recordCount) !== 'issued' || voucher.status !== 'issued') {
      fail_('VOUCHER_NOT_EDITABLE', '只有目前可使用且尚未記錄的 QR Code 可以修改。');
    }

    const changedFields = [];
    if (voucher.minutes !== minutes) changedFields.push('minutes');
    if (voucherScanMode_(voucher) !== scanMode) changedFields.push('scanMode');
    if (String(voucher.expiresAt) !== expiresAt) changedFields.push('expiresAt');
    if (voucher.note !== note) changedFields.push('note');

    voucher.minutes = minutes;
    voucher.scanMode = scanMode;
    voucher.expiresAt = expiresAt;
    voucher.note = note;
    voucher.updatedAt = new Date().toISOString();
    writeUsageVoucher_(sheet, row, voucher);

    audit_(context.identity.sub, 'admin', 'USAGE_QR_UPDATED', '', 'success', {
      voucherId: voucher.voucherId,
      fields: changedFields,
      minutes: voucher.minutes,
      scanMode: voucher.scanMode,
      expiresAt: voucher.expiresAt
    });

    return {
      voucher: publicUsageVoucher_(voucher, 0),
      shareCode: voucher.shareCode
    };
  } finally {
    lock.releaseLock();
  }
}

function adminUsageDelete_(context, payload) {
  const voucherId = cleanText_(payload.voucherId, 40, true);
  const expectedUpdatedAt = cleanText_(payload.expectedUpdatedAt, 40, true);
  const sheet = getUsageVouchersSheet_();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) fail_('BUSY', '系統忙碌中，請稍後再試。');

  try {
    const row = findUsageVoucherRowById_(sheet, voucherId);
    if (!row) fail_('VOUCHER_NOT_FOUND', '找不到指定 QR Code。');

    const voucher = rowToUsageVoucher_(sheet.getRange(row, 1, 1, USAGE_VOUCHER_HEADERS.length).getValues()[0]);
    if (String(voucher.updatedAt) !== expectedUpdatedAt) {
      fail_('CONFLICT', 'QR Code 已被其他操作更新，請重新整理後再試。');
    }
    if (isLegacyTargetedVoucher_(voucher)) {
      fail_('LEGACY_VOUCHER_READ_ONLY', '舊版指定會員 QR Code 為保留歷史關聯不可刪除；如需停用請使用「停止」。');
    }

    const recordsSheet = getUsageRecordsSheet_();
    if (findProcessingUsageRecordRowByVoucher_(recordsSheet, voucher.voucherId)) {
      fail_('VOUCHER_IN_USE', '此 QR Code 正在處理消費紀錄，目前不能刪除。');
    }

    const recordCount = countUsageRecords_(voucher.voucherId);
    if (recordCount > 0) {
      fail_('VOUCHER_HAS_RECORDS', '此 QR Code 已有消費紀錄，不能刪除；如需停止後續使用，請使用「停止」。');
    }

    const auditDetails = {
      voucherId: voucher.voucherId,
      minutes: voucher.minutes,
      scanMode: voucherScanMode_(voucher),
      expiresAt: voucher.expiresAt,
      previousStatus: effectiveVoucherStatus_(voucher, 0)
    };

    if (!audit_(context.identity.sub, 'admin', 'USAGE_QR_DELETE_REQUESTED', '', 'pending', auditDetails)) {
      fail_('AUDIT_FAILED', '無法建立刪除稽核紀錄，QR Code 未刪除。');
    }

    sheet.deleteRow(row);
    audit_(context.identity.sub, 'admin', 'USAGE_QR_DELETED', '', 'success', auditDetails);
    return { voucherId: voucherId, deleted: true };
  } finally {
    lock.releaseLock();
  }
}
