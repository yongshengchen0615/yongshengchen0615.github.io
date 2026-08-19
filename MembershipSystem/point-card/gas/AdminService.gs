function pointAdminDashboard_() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) fail_('BUSY', '系統忙碌中，請稍後再試。');
  try {
    recoverProcessingPointTransactionsLocked_();
  } finally {
    lock.releaseLock();
  }

  const membersSheet = getPointMembersSheet_();
  const transactionsSheet = getPointTransactionsSheet_();
  const vouchersSheet = getPointVouchersSheet_();

  const members = membersSheet.getLastRow() > 1
    ? membersSheet.getRange(2, 1, membersSheet.getLastRow() - 1, POINT_MEMBER_HEADERS.length).getValues().map(rowToPointMember_)
    : [];
  members.sort(function (a, b) { return String(b.joinedAt).localeCompare(String(a.joinedAt)); });

  const transactions = transactionsSheet.getLastRow() > 1
    ? transactionsSheet.getRange(2, 1, transactionsSheet.getLastRow() - 1, POINT_TRANSACTION_HEADERS.length).getValues().map(rowToPointTransaction_)
    : [];
  transactions.sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });

  const vouchers = vouchersSheet.getLastRow() > 1
    ? vouchersSheet.getRange(2, 1, vouchersSheet.getLastRow() - 1, POINT_VOUCHER_HEADERS.length).getValues().map(rowToPointVoucher_)
    : [];
  vouchers.sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });

  const stats = members.reduce(function (acc, member) {
    acc.totalMembers += 1;
    if (member.status === 'active') acc.activeMembers += 1;
    acc.pointsBalance += member.pointsBalance;
    acc.lifetimeEarned += member.lifetimeEarned;
    return acc;
  }, { totalMembers: 0, activeMembers: 0, pointsBalance: 0, lifetimeEarned: 0 });

  return {
    settings: getPointSettings_(),
    stats: stats,
    members: members.slice(0, 200).map(publicPointMember_),
    transactions: transactions.filter(function (tx) { return tx.status === 'recorded'; }).slice(0, 50).map(publicPointTransaction_),
    vouchers: vouchers.slice(0, 50).map(publicPointVoucher_)
  };
}

function pointAdminSettingsUpdate_(context, payload) {
  const targetPoints = intInRange_(payload.targetPoints, 1, 1000, 'INVALID_TARGET', '兌獎門檻必須介於 1 到 1000 點。');
  const rewardTitle = cleanText_(payload.rewardTitle, 80, true);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) fail_('BUSY', '系統忙碌中，請稍後再試。');
  try {
    const props = PropertiesService.getScriptProperties();
    const previous = getPointSettings_();
    props.setProperties({
      [POINT_TARGET_PROPERTY]: String(targetPoints),
      [POINT_REWARD_TITLE_PROPERTY]: rewardTitle
    }, false);

    pointAudit_(context.identity.sub, 'admin', 'POINT_SETTINGS_UPDATED', '', 'success', {
      previousTargetPoints: previous.targetPoints,
      targetPoints: targetPoints,
      rewardTitleChanged: previous.rewardTitle !== rewardTitle
    });
    return { settings: getPointSettings_() };
  } finally {
    lock.releaseLock();
  }
}

function pointAdminMemberAdjust_(context, payload) {
  const pointMemberNo = cleanText_(payload.pointMemberNo, 24, true);
  const delta = intInRange_(payload.delta, -MAX_POINT_DELTA, MAX_POINT_DELTA, 'INVALID_DELTA', '點數異動必須介於 -1000 到 1000。');
  if (delta === 0) fail_('INVALID_DELTA', '點數異動不可為 0。');
  const note = cleanText_(payload.note, 200, true);
  const expectedUpdatedAt = cleanText_(payload.expectedUpdatedAt, 40, true);
  const requestId = validRequestId_(payload.requestId);

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) fail_('BUSY', '系統忙碌中，請稍後再試。');
  try {
    const existing = findPointTransactionByRequestId_(requestId);
    if (existing) {
      const tx = existing.transaction;
      if (tx.actorLineUserId !== context.identity.sub || tx.pointMemberNo !== pointMemberNo || tx.type !== 'adjustment') {
        fail_('INVALID_REQUEST', '此操作識別碼已被其他操作使用。');
      }
      const member = recoverPointTransactionLocked_(existing.row, tx);
      ensurePointTransactionAudit_(existing.row, tx);
      return { member: publicPointMember_(member), transaction: publicPointTransaction_(tx), alreadyApplied: true };
    }

    const located = getPointMemberByNo_(pointMemberNo);
    if (!located) fail_('MEMBER_NOT_FOUND', '找不到指定集點會員。');
    if (String(located.member.updatedAt) !== expectedUpdatedAt) fail_('CONFLICT', '會員點數已被其他操作更新，請重新整理後再試。');

    const tx = buildPointTransaction_({
      requestId: requestId,
      member: located.member,
      type: 'adjustment',
      delta: delta,
      sourceType: 'admin',
      sourceId: '',
      note: note,
      actorLineUserId: context.identity.sub
    });
    const txSheet = getPointTransactionsSheet_();
    txSheet.appendRow(pointTransactionToRow_(tx));
    const txRow = txSheet.getLastRow();
    const member = recoverPointTransactionLocked_(txRow, tx);
    ensurePointTransactionAudit_(txRow, tx);
    return { member: publicPointMember_(member), transaction: publicPointTransaction_(tx), alreadyApplied: false };
  } finally {
    lock.releaseLock();
  }
}

function pointAdminMemberStatus_(context, payload) {
  const pointMemberNo = cleanText_(payload.pointMemberNo, 24, true);
  const status = cleanText_(payload.status, 20, true).toLowerCase();
  if (POINT_MEMBER_STATUSES.indexOf(status) === -1) fail_('INVALID_STATUS', '會員狀態不正確。');
  const expectedUpdatedAt = cleanText_(payload.expectedUpdatedAt, 40, true);

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) fail_('BUSY', '系統忙碌中，請稍後再試。');
  try {
    const located = getPointMemberByNo_(pointMemberNo);
    if (!located) fail_('MEMBER_NOT_FOUND', '找不到指定集點會員。');
    const member = located.member;
    if (String(member.updatedAt) !== expectedUpdatedAt) fail_('CONFLICT', '會員資料已被其他操作更新，請重新整理後再試。');
    if (member.status === status) return { member: publicPointMember_(member) };

    const previous = member.status;
    member.status = status;
    member.updatedAt = new Date().toISOString();
    getPointMembersSheet_().getRange(located.row, 1, 1, POINT_MEMBER_HEADERS.length).setValues([pointMemberToRow_(member)]);
    pointAudit_(context.identity.sub, 'admin', 'POINT_MEMBER_STATUS_UPDATED', member.lineUserId, 'success', {
      pointMemberNo: member.pointMemberNo,
      previousStatus: previous,
      status: status
    });
    return { member: publicPointMember_(member) };
  } finally {
    lock.releaseLock();
  }
}

function pointAdminRewardRedeem_(context, payload) {
  const pointMemberNo = cleanText_(payload.pointMemberNo, 24, true);
  const note = cleanText_(payload.note || '', 200, false);
  const expectedUpdatedAt = cleanText_(payload.expectedUpdatedAt, 40, true);
  const requestId = validRequestId_(payload.requestId);
  const settings = getPointSettings_();

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) fail_('BUSY', '系統忙碌中，請稍後再試。');
  try {
    const existing = findPointTransactionByRequestId_(requestId);
    if (existing) {
      const tx = existing.transaction;
      if (tx.actorLineUserId !== context.identity.sub || tx.pointMemberNo !== pointMemberNo || tx.type !== 'reward_redeem') {
        fail_('INVALID_REQUEST', '此操作識別碼已被其他操作使用。');
      }
      const member = recoverPointTransactionLocked_(existing.row, tx);
      ensurePointTransactionAudit_(existing.row, tx);
      return { member: publicPointMember_(member), transaction: publicPointTransaction_(tx), alreadyApplied: true };
    }

    const located = getPointMemberByNo_(pointMemberNo);
    if (!located) fail_('MEMBER_NOT_FOUND', '找不到指定集點會員。');
    requirePointMemberActive_(located.member);
    if (String(located.member.updatedAt) !== expectedUpdatedAt) fail_('CONFLICT', '會員點數已被其他操作更新，請重新整理後再試。');
    if (located.member.pointsBalance < settings.targetPoints) fail_('INSUFFICIENT_POINTS', '會員點數不足，無法兌換此獎勵。');

    const tx = buildPointTransaction_({
      requestId: requestId,
      member: located.member,
      type: 'reward_redeem',
      delta: -settings.targetPoints,
      sourceType: 'reward',
      sourceId: settings.rewardTitle,
      note: note,
      actorLineUserId: context.identity.sub
    });
    const txSheet = getPointTransactionsSheet_();
    txSheet.appendRow(pointTransactionToRow_(tx));
    const txRow = txSheet.getLastRow();
    const member = recoverPointTransactionLocked_(txRow, tx);
    ensurePointTransactionAudit_(txRow, tx);
    return { member: publicPointMember_(member), transaction: publicPointTransaction_(tx), alreadyApplied: false };
  } finally {
    lock.releaseLock();
  }
}

function pointAdminVoucherCreate_(context, payload) {
  const points = intInRange_(payload.points, 1, 1000, 'INVALID_POINTS', '集點碼點數必須介於 1 到 1000。');
  const expiresAt = validateVoucherExpiry_(payload.expiresAt);
  const note = cleanText_(payload.note || '', 200, false);
  const requestId = validRequestId_(payload.requestId);
  const vouchersSheet = getPointVouchersSheet_();

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) fail_('BUSY', '系統忙碌中，請稍後再試。');
  try {
    const requestRow = findExactRow_(vouchersSheet, POINT_VOUCHER_HEADERS.indexOf('requestId') + 1, requestId);
    if (requestRow) fail_('VOUCHER_REQUEST_REPLAY', '此建立要求已處理；為避免重複發放，請重新建立一筆新的集點碼。');

    const now = new Date().toISOString();
    const claimCode = randomCode_();
    const voucher = {
      voucherId: nextPointVoucherId_(),
      requestId: requestId,
      codeHash: sha256Hex_(claimCode),
      points: points,
      status: 'issued',
      expiresAt: expiresAt,
      note: note,
      createdByLineUserId: context.identity.sub,
      createdAt: now,
      redeemedByLineUserId: '',
      redeemedAt: '',
      cancelledByLineUserId: '',
      cancelledAt: '',
      updatedAt: now
    };

    vouchersSheet.appendRow(pointVoucherToRow_(voucher));
    pointAudit_(context.identity.sub, 'admin', 'POINT_VOUCHER_CREATED', '', 'success', {
      voucherId: voucher.voucherId,
      points: points,
      expiresAt: expiresAt
    });
    return { voucher: publicPointVoucher_(voucher), claimCode: claimCode };
  } finally {
    lock.releaseLock();
  }
}

function pointAdminVoucherCancel_(context, payload) {
  const voucherId = cleanText_(payload.voucherId, 40, true);
  const sheet = getPointVouchersSheet_();

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) fail_('BUSY', '系統忙碌中，請稍後再試。');
  try {
    recoverProcessingPointTransactionsLocked_();
    const row = findExactRow_(sheet, 1, voucherId);
    if (!row) fail_('VOUCHER_NOT_FOUND', '找不到指定集點碼。');

    const voucher = rowToPointVoucher_(sheet.getRange(row, 1, 1, POINT_VOUCHER_HEADERS.length).getValues()[0]);
    if (voucher.status === 'redeemed') fail_('POINT_CODE_USED', '已使用的集點碼不能停止。');
    if (voucher.status === 'cancelled') return { voucher: publicPointVoucher_(voucher) };

    const now = new Date().toISOString();
    voucher.status = 'cancelled';
    voucher.cancelledByLineUserId = context.identity.sub;
    voucher.cancelledAt = now;
    voucher.updatedAt = now;
    sheet.getRange(row, 1, 1, POINT_VOUCHER_HEADERS.length).setValues([pointVoucherToRow_(voucher)]);

    pointAudit_(context.identity.sub, 'admin', 'POINT_VOUCHER_CANCELLED', '', 'success', {
      voucherId: voucher.voucherId
    });
    return { voucher: publicPointVoucher_(voucher) };
  } finally {
    lock.releaseLock();
  }
}

function validateVoucherExpiry_(value) {
  const text = cleanText_(value, 40, true);
  const timestamp = Date.parse(text);
  if (!Number.isFinite(timestamp)) fail_('INVALID_EXPIRY', '集點碼到期時間格式不正確。');
  const now = Date.now();
  if (timestamp <= now) fail_('INVALID_EXPIRY', '集點碼到期時間必須晚於現在。');
  if (timestamp - now > MAX_VOUCHER_LIFETIME_MS) fail_('INVALID_EXPIRY', '集點碼有效期限最多 7 天。');
  return new Date(timestamp).toISOString();
}
