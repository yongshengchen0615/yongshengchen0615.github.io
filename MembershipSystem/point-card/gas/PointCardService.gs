const POINT_TARGET_PROPERTY = 'POINT_CARD_TARGET_POINTS';
const POINT_REWARD_TITLE_PROPERTY = 'POINT_CARD_REWARD_TITLE';
const DEFAULT_TARGET_POINTS = 10;
const DEFAULT_REWARD_TITLE = '集滿送好禮';

function pointMemberMe_(context) {
  const member = ensurePointMember_(context.identity);
  return pointMemberDashboard_(member, context);
}

function ensurePointMember_(identity) {
  const sheet = getPointMembersSheet_();
  let row = findExactRow_(sheet, 1, identity.sub);
  const displayName = cleanText_(identity.name || 'LINE 會員', 80, false) || 'LINE 會員';
  const pictureUrl = safeHttpsUrl_(identity.picture || '');

  if (!row) {
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(5000)) fail_('BUSY', '系統忙碌中，請稍後再試。');
    try {
      row = findExactRow_(sheet, 1, identity.sub);
      if (!row) {
        const now = new Date().toISOString();
        const member = {
          lineUserId: identity.sub,
          pointMemberNo: nextPointMemberNo_(),
          displayName: displayName,
          pictureUrl: pictureUrl,
          status: 'active',
          pointsBalance: 0,
          lifetimeEarned: 0,
          lifetimeRedeemed: 0,
          canManagePoints: false,
          joinedAt: now,
          createdAt: now,
          updatedAt: now
        };
        sheet.appendRow(pointMemberToRow_(member));
        pointAudit_(identity.sub, 'member', 'POINT_MEMBER_CREATED', identity.sub, 'success', {
          pointMemberNo: member.pointMemberNo
        });
        return member;
      }
    } finally {
      lock.releaseLock();
    }
  }

  let member = rowToPointMember_(sheet.getRange(row, 1, 1, POINT_MEMBER_HEADERS.length).getValues()[0]);
  if (member.displayName !== displayName || member.pictureUrl !== pictureUrl) {
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(5000)) fail_('BUSY', '系統忙碌中，請稍後再試。');
    try {
      const currentRow = findExactRow_(sheet, 1, identity.sub);
      if (!currentRow) fail_('MEMBER_NOT_FOUND', '找不到集點會員資料。');
      member = rowToPointMember_(sheet.getRange(currentRow, 1, 1, POINT_MEMBER_HEADERS.length).getValues()[0]);
      member.displayName = displayName;
      member.pictureUrl = pictureUrl;
      member.updatedAt = new Date().toISOString();
      sheet.getRange(currentRow, 1, 1, POINT_MEMBER_HEADERS.length).setValues([pointMemberToRow_(member)]);
    } finally {
      lock.releaseLock();
    }
  }
  return member;
}

function pointMemberDashboard_(member, context) {
  return {
    member: publicPointMember_(member),
    settings: getPointSettings_(),
    transactions: pointTransactionsForMember_(member.lineUserId, 30),
    isAdmin: context ? isPointAdmin_(member.lineUserId) : false
  };
}

function pointClaim_(context, payload) {
  const code = validCode_(payload.code);
  const requestId = validRequestId_(payload.requestId);
  const codeHash = sha256Hex_(code);
  const vouchersSheet = getPointVouchersSheet_();
  const voucherRow = findExactRow_(vouchersSheet, POINT_VOUCHER_HEADERS.indexOf('codeHash') + 1, codeHash);
  if (!voucherRow) fail_('POINT_CODE_NOT_FOUND', '此集點碼無效或不存在。');

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) fail_('BUSY', '系統忙碌中，請稍後再試。');
  try {
    const voucher = rowToPointVoucher_(vouchersSheet.getRange(voucherRow, 1, 1, POINT_VOUCHER_HEADERS.length).getValues()[0]);
    const existing = findPointTransactionByRequestId_(requestId);
    if (existing) {
      if (existing.transaction.memberLineUserId !== context.identity.sub ||
          existing.transaction.sourceType !== 'voucher' ||
          existing.transaction.sourceId !== voucher.voucherId) {
        fail_('INVALID_REQUEST', '操作識別碼與集點碼不一致，請重新操作。');
      }
      const member = recoverPointTransactionLocked_(existing.row, existing.transaction);
      finalizeVoucherForTransactionLocked_(voucherRow, voucher, existing.transaction);
      ensurePointTransactionAudit_(existing.row, existing.transaction);
      return {
        dashboard: pointMemberDashboard_(member, context),
        transaction: publicPointTransaction_(existing.transaction),
        alreadyClaimed: true
      };
    }

    const priorVoucherTx = findPointTransactionByVoucherId_(voucher.voucherId);
    if (priorVoucherTx) {
      recoverPointTransactionLocked_(priorVoucherTx.row, priorVoucherTx.transaction);
      finalizeVoucherForTransactionLocked_(voucherRow, voucher, priorVoucherTx.transaction);
      ensurePointTransactionAudit_(priorVoucherTx.row, priorVoucherTx.transaction);
      fail_('POINT_CODE_USED', '此集點碼已被使用。');
    }

    requireVoucherUsable_(voucher);
    const locatedMember = getPointMemberByLineUserIdLocated_(context.identity.sub);
    if (!locatedMember) fail_('MEMBER_NOT_FOUND', '找不到集點會員資料，請重新開啟集點卡。');
    requirePointMemberActive_(locatedMember.member);

    const tx = buildPointTransaction_({
      requestId: requestId,
      member: locatedMember.member,
      type: 'earn',
      delta: voucher.points,
      sourceType: 'voucher',
      sourceId: voucher.voucherId,
      note: voucher.note,
      actorLineUserId: context.identity.sub
    });

    const txSheet = getPointTransactionsSheet_();
    txSheet.appendRow(pointTransactionToRow_(tx));
    const txRow = txSheet.getLastRow();
    const member = recoverPointTransactionLocked_(txRow, tx);
    finalizeVoucherForTransactionLocked_(voucherRow, voucher, tx);
    ensurePointTransactionAudit_(txRow, tx);

    return {
      dashboard: pointMemberDashboard_(member, context),
      transaction: publicPointTransaction_(tx),
      alreadyClaimed: false
    };
  } finally {
    lock.releaseLock();
  }
}

function buildPointTransaction_(args) {
  const member = args.member;
  const delta = Number(args.delta);
  const balanceAfter = member.pointsBalance + delta;
  if (balanceAfter < 0) fail_('INSUFFICIENT_POINTS', '點數不足，無法完成此操作。');

  const earnedAfter = member.lifetimeEarned + ((args.type === 'earn' || (args.type === 'adjustment' && delta > 0)) ? delta : 0);
  const redeemedAfter = member.lifetimeRedeemed + (args.type === 'reward_redeem' ? Math.abs(delta) : 0);
  const now = new Date().toISOString();

  return {
    transactionId: nextPointTransactionId_(),
    requestId: args.requestId,
    memberLineUserId: member.lineUserId,
    pointMemberNo: member.pointMemberNo,
    type: args.type,
    pointsDelta: delta,
    balanceBefore: member.pointsBalance,
    balanceAfter: balanceAfter,
    lifetimeEarnedBefore: member.lifetimeEarned,
    lifetimeEarnedAfter: earnedAfter,
    lifetimeRedeemedBefore: member.lifetimeRedeemed,
    lifetimeRedeemedAfter: redeemedAfter,
    status: 'processing',
    sourceType: args.sourceType,
    sourceId: args.sourceId || '',
    note: args.note || '',
    actorLineUserId: args.actorLineUserId,
    createdAt: now,
    updatedAt: now,
    auditRecordedAt: ''
  };
}

function recoverPointTransactionLocked_(transactionRow, transaction) {
  const membersSheet = getPointMembersSheet_();
  const memberRow = findExactRow_(membersSheet, 1, transaction.memberLineUserId);
  if (!memberRow) fail_('POINT_TRANSACTION_CONFLICT', '點數交易對應的會員不存在，請聯絡管理員。');
  const member = rowToPointMember_(membersSheet.getRange(memberRow, 1, 1, POINT_MEMBER_HEADERS.length).getValues()[0]);

  if (transaction.status === 'processing') {
    const stateBefore = member.pointsBalance === transaction.balanceBefore &&
      member.lifetimeEarned === transaction.lifetimeEarnedBefore &&
      member.lifetimeRedeemed === transaction.lifetimeRedeemedBefore;
    const stateAfter = member.pointsBalance === transaction.balanceAfter &&
      member.lifetimeEarned === transaction.lifetimeEarnedAfter &&
      member.lifetimeRedeemed === transaction.lifetimeRedeemedAfter;

    if (stateBefore) {
      member.pointsBalance = transaction.balanceAfter;
      member.lifetimeEarned = transaction.lifetimeEarnedAfter;
      member.lifetimeRedeemed = transaction.lifetimeRedeemedAfter;
      member.updatedAt = new Date().toISOString();
      membersSheet.getRange(memberRow, 1, 1, POINT_MEMBER_HEADERS.length).setValues([pointMemberToRow_(member)]);
    } else if (!stateAfter) {
      fail_('POINT_TRANSACTION_CONFLICT', '會員點數與交易狀態不一致，請聯絡管理員確認。');
    }

    transaction.status = 'recorded';
    transaction.updatedAt = new Date().toISOString();
    getPointTransactionsSheet_().getRange(transactionRow, 1, 1, POINT_TRANSACTION_HEADERS.length).setValues([pointTransactionToRow_(transaction)]);
  } else if (transaction.status !== 'recorded') {
    fail_('POINT_TRANSACTION_CONFLICT', '點數交易狀態不正確。');
  }

  return rowToPointMember_(membersSheet.getRange(memberRow, 1, 1, POINT_MEMBER_HEADERS.length).getValues()[0]);
}

function recoverProcessingPointTransactionsLocked_() {
  const sheet = getPointTransactionsSheet_();
  if (sheet.getLastRow() <= 1) return;
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, POINT_TRANSACTION_HEADERS.length).getValues();
  for (let i = 0; i < rows.length; i += 1) {
    const tx = rowToPointTransaction_(rows[i]);
    if (tx.status !== 'processing') continue;
    recoverPointTransactionLocked_(i + 2, tx);
    if (tx.sourceType === 'voucher' && tx.sourceId) {
      const vouchersSheet = getPointVouchersSheet_();
      const voucherRow = findExactRow_(vouchersSheet, 1, tx.sourceId);
      if (voucherRow) {
        const voucher = rowToPointVoucher_(vouchersSheet.getRange(voucherRow, 1, 1, POINT_VOUCHER_HEADERS.length).getValues()[0]);
        finalizeVoucherForTransactionLocked_(voucherRow, voucher, tx);
      }
    }
    ensurePointTransactionAudit_(i + 2, tx);
  }
}

function finalizeVoucherForTransactionLocked_(voucherRow, voucher, transaction) {
  if (voucher.status === 'redeemed') {
    if (voucher.redeemedByLineUserId !== transaction.memberLineUserId) {
      fail_('POINT_TRANSACTION_CONFLICT', '集點碼已由其他會員使用。');
    }
    return;
  }
  if (voucher.status !== 'issued') fail_('POINT_TRANSACTION_CONFLICT', '集點碼狀態與交易不一致。');

  voucher.status = 'redeemed';
  voucher.redeemedByLineUserId = transaction.memberLineUserId;
  voucher.redeemedAt = transaction.updatedAt || new Date().toISOString();
  voucher.updatedAt = new Date().toISOString();
  getPointVouchersSheet_().getRange(voucherRow, 1, 1, POINT_VOUCHER_HEADERS.length).setValues([pointVoucherToRow_(voucher)]);
}

function ensurePointTransactionAudit_(transactionRow, transaction) {
  if (transaction.auditRecordedAt || transaction.status !== 'recorded') return;
  const actionMap = {
    earn: ['member', 'POINTS_CLAIMED'],
    adjustment: ['admin', 'POINTS_ADJUSTED'],
    reward_redeem: ['admin', 'POINT_REWARD_REDEEMED']
  };
  const mapped = actionMap[transaction.type] || ['system', 'POINT_TRANSACTION_RECORDED'];
  const written = pointAudit_(
    transaction.actorLineUserId,
    mapped[0],
    mapped[1],
    transaction.memberLineUserId,
    'success',
    {
      pointMemberNo: transaction.pointMemberNo,
      transactionId: transaction.transactionId,
      sourceType: transaction.sourceType,
      sourceId: transaction.sourceId,
      pointsDelta: transaction.pointsDelta,
      balanceAfter: transaction.balanceAfter
    }
  );
  if (!written) return;

  transaction.auditRecordedAt = new Date().toISOString();
  transaction.updatedAt = transaction.auditRecordedAt;
  getPointTransactionsSheet_().getRange(transactionRow, 1, 1, POINT_TRANSACTION_HEADERS.length).setValues([pointTransactionToRow_(transaction)]);
}

function getPointSettings_() {
  const props = PropertiesService.getScriptProperties();
  const rawTarget = Number(props.getProperty(POINT_TARGET_PROPERTY) || DEFAULT_TARGET_POINTS);
  const targetPoints = Number.isInteger(rawTarget) && rawTarget >= 1 && rawTarget <= 1000
    ? rawTarget : DEFAULT_TARGET_POINTS;
  const rewardTitle = cleanText_(props.getProperty(POINT_REWARD_TITLE_PROPERTY) || DEFAULT_REWARD_TITLE, 80, false) || DEFAULT_REWARD_TITLE;
  return { targetPoints: targetPoints, rewardTitle: rewardTitle };
}

function getPointMemberByLineUserIdLocated_(lineUserId) {
  const sheet = getPointMembersSheet_();
  const row = findExactRow_(sheet, 1, lineUserId);
  return row ? { row: row, member: rowToPointMember_(sheet.getRange(row, 1, 1, POINT_MEMBER_HEADERS.length).getValues()[0]) } : null;
}

function getPointMemberByLineUserId_(lineUserId) {
  const located = getPointMemberByLineUserIdLocated_(lineUserId);
  return located ? located.member : null;
}

function getPointMemberByNo_(pointMemberNo) {
  const sheet = getPointMembersSheet_();
  const row = findExactRow_(sheet, 2, pointMemberNo);
  return row ? { row: row, member: rowToPointMember_(sheet.getRange(row, 1, 1, POINT_MEMBER_HEADERS.length).getValues()[0]) } : null;
}

function requirePointMemberActive_(member) {
  if (!member || member.status !== 'active') {
    fail_('MEMBER_INACTIVE', '目前集點會員狀態不可使用點數功能。');
  }
}

function requireVoucherUsable_(voucher) {
  if (voucher.status === 'cancelled') fail_('POINT_CODE_CANCELLED', '此集點碼已停止使用。');
  if (voucher.status === 'redeemed') fail_('POINT_CODE_USED', '此集點碼已被使用。');
  if (Date.parse(voucher.expiresAt) <= Date.now()) fail_('POINT_CODE_EXPIRED', '此集點碼已過期。');
}

function pointTransactionsForMember_(lineUserId, limit) {
  const sheet = getPointTransactionsSheet_();
  if (sheet.getLastRow() <= 1) return [];
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, POINT_TRANSACTION_HEADERS.length).getValues();
  return rows.map(rowToPointTransaction_)
    .filter(function (tx) { return tx.memberLineUserId === lineUserId && tx.status === 'recorded'; })
    .sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); })
    .slice(0, limit)
    .map(publicPointTransaction_);
}

function findPointTransactionByRequestId_(requestId) {
  const sheet = getPointTransactionsSheet_();
  const row = findExactRow_(sheet, POINT_TRANSACTION_HEADERS.indexOf('requestId') + 1, requestId);
  return row ? {
    row: row,
    transaction: rowToPointTransaction_(sheet.getRange(row, 1, 1, POINT_TRANSACTION_HEADERS.length).getValues()[0])
  } : null;
}

function findPointTransactionByVoucherId_(voucherId) {
  const sheet = getPointTransactionsSheet_();
  if (sheet.getLastRow() <= 1) return null;
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, POINT_TRANSACTION_HEADERS.length).getValues();
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const tx = rowToPointTransaction_(rows[i]);
    if (tx.sourceType === 'voucher' && tx.sourceId === voucherId) {
      return { row: i + 2, transaction: tx };
    }
  }
  return null;
}

function nextPointMemberNo_() {
  const props = PropertiesService.getScriptProperties();
  const year = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy');
  const key = 'POINT_MEMBER_SEQUENCE_' + year;
  let sequence = Number(props.getProperty(key) || 0);
  sequence += 1;
  props.setProperty(key, String(sequence));
  return 'P' + year + String(sequence).padStart(6, '0');
}

function nextPointTransactionId_() {
  return 'PT' + Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyyMMdd') + '-' +
    Utilities.getUuid().replace(/-/g, '').slice(0, 14).toUpperCase();
}

function nextPointVoucherId_() {
  return 'PV' + Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyyMMdd') + '-' +
    Utilities.getUuid().replace(/-/g, '').slice(0, 12).toUpperCase();
}

function rowToPointMember_(row) {
  const member = {};
  POINT_MEMBER_HEADERS.forEach(function (header, index) { member[header] = normalizeCell_(row[index]); });
  member.pointsBalance = Math.max(0, Number(member.pointsBalance || 0));
  member.lifetimeEarned = Math.max(0, Number(member.lifetimeEarned || 0));
  member.lifetimeRedeemed = Math.max(0, Number(member.lifetimeRedeemed || 0));
  return member;
}

function pointMemberToRow_(member) {
  return POINT_MEMBER_HEADERS.map(function (header) { return sheetSafe_(member[header]); });
}

function rowToPointTransaction_(row) {
  const tx = {};
  POINT_TRANSACTION_HEADERS.forEach(function (header, index) { tx[header] = normalizeCell_(row[index]); });
  ['pointsDelta', 'balanceBefore', 'balanceAfter', 'lifetimeEarnedBefore', 'lifetimeEarnedAfter',
   'lifetimeRedeemedBefore', 'lifetimeRedeemedAfter'].forEach(function (field) {
    tx[field] = Number(tx[field] || 0);
  });
  return tx;
}

function pointTransactionToRow_(tx) {
  return POINT_TRANSACTION_HEADERS.map(function (header) { return sheetSafe_(tx[header]); });
}

function rowToPointVoucher_(row) {
  const voucher = {};
  POINT_VOUCHER_HEADERS.forEach(function (header, index) { voucher[header] = normalizeCell_(row[index]); });
  voucher.points = Number(voucher.points || 0);
  return voucher;
}

function pointVoucherToRow_(voucher) {
  return POINT_VOUCHER_HEADERS.map(function (header) { return sheetSafe_(voucher[header]); });
}

function publicPointMember_(member) {
  return {
    pointMemberNo: member.pointMemberNo,
    displayName: member.displayName,
    pictureUrl: member.pictureUrl,
    status: member.status,
    pointsBalance: member.pointsBalance,
    lifetimeEarned: member.lifetimeEarned,
    lifetimeRedeemed: member.lifetimeRedeemed,
    joinedAt: member.joinedAt,
    updatedAt: member.updatedAt
  };
}

function publicPointTransaction_(tx) {
  const labels = {
    earn: '集點',
    adjustment: '管理員調整',
    reward_redeem: '兌換獎勵'
  };
  return {
    transactionId: tx.transactionId,
    pointMemberNo: tx.pointMemberNo,
    type: tx.type,
    label: labels[tx.type] || '點數異動',
    pointsDelta: tx.pointsDelta,
    balanceAfter: tx.balanceAfter,
    note: tx.note,
    createdAt: tx.createdAt
  };
}

function publicPointVoucher_(voucher) {
  const labels = { issued: '可使用', redeemed: '已使用', cancelled: '已停止' };
  const expired = voucher.status === 'issued' && Date.parse(voucher.expiresAt) <= Date.now();
  return {
    voucherId: voucher.voucherId,
    points: voucher.points,
    status: expired ? 'expired' : voucher.status,
    statusLabel: expired ? '已過期' : (labels[voucher.status] || voucher.status),
    expiresAt: voucher.expiresAt,
    note: voucher.note,
    createdAt: voucher.createdAt,
    updatedAt: voucher.updatedAt
  };
}
