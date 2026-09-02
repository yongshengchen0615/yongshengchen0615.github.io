'use strict';

const POINTS_CARD_SERVICE = Object.freeze({
  name: 'PointsCard',
  version: '2.3.2',
  spreadsheetProperty: 'POINTS_CARD_SPREADSHEET_ID',
  lineChannelProperty: 'LINE_LOGIN_CHANNEL_ID',
  minuteGrantIntegrationSecretProperty: 'POINTS_CARD_MINUTE_GRANT_INTEGRATION_SECRET',
  stampsPerRewardProperty: 'POINTS_CARD_STAMPS_PER_REWARD',
  rewardNameProperty: 'POINTS_CARD_REWARD_NAME',
  rewardNodesProperty: 'POINTS_CARD_REWARD_NODES_JSON',
  rewardNodesUpdatedAtProperty: 'POINTS_CARD_REWARD_NODES_UPDATED_AT'
});

const POINTS_CARD_SHEETS = Object.freeze({
  members: 'Members',
  vouchers: 'StampVouchers',
  stampRecords: 'StampRecords',
  rewardConfirmations: 'RewardConfirmations',
  rewardRecords: 'RewardRecords',
  audit: 'AuditLogs'
});

const POINTS_CARD_HEADERS = Object.freeze({
  Members: [
    'lineUserId', 'memberNo', 'displayName', 'pictureUrl', 'membershipStatus',
    'totalStamps', 'redeemedRewards', 'joinedAt', 'note', 'createdAt', 'updatedAt',
    'canManagePoints'
  ],
  StampVouchers: [
    'voucherId', 'shareCode', 'stampCount', 'scanMode', 'status', 'expiresAt', 'note',
    'createdByLineUserId', 'createdAt', 'updatedAt', 'cancelledByLineUserId', 'cancelledAt'
  ],
  StampRecords: [
    'recordId', 'requestId', 'voucherId', 'memberLineUserId', 'memberNo', 'stampCount',
    'note', 'status', 'totalBefore', 'totalAfter', 'createdAt', 'updatedAt', 'recordedAt',
    'auditRecordedAt'
  ],
  RewardConfirmations: [
    'confirmationId', 'shareCode', 'status', 'expiresAt', 'note', 'createdByLineUserId',
    'createdAt', 'updatedAt', 'cancelledByLineUserId', 'cancelledAt'
  ],
  RewardRecords: [
    'rewardRecordId', 'requestId', 'memberLineUserId', 'memberNo', 'rewardName',
    'rewardOrdinal', 'redeemedBefore', 'redeemedAfter', 'status', 'redeemedByLineUserId',
    'note', 'createdAt', 'updatedAt', 'redeemedAt', 'auditRecordedAt', 'rewardType',
    'rewardNodeId', 'cycleNumber', 'lotteryResult', 'confirmationId'
  ],
  AuditLogs: [
    'timestamp', 'actorLineUserId', 'actorRole', 'action', 'targetLineUserId', 'result', 'details'
  ]
});

const MEMBER_STATUS_VALUES = ['active', 'suspended', 'disabled'];
const STAMP_SCAN_MODES = ['single', 'per-member', 'repeatable'];
const REWARD_TYPES = ['coupon', 'lottery'];
const LOTTERY_WEIGHT_BASIS_POINTS = 10000;
const MAX_CARD_STAMPS = 10000;
const MAX_TICKET_TERM_DAYS = 3650;
const MAX_STAMPS_PER_SCAN = 10;
const MAX_VOUCHER_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
const LINE_IDENTITY_CACHE_MAX_SECONDS = 300;
const LINE_IDENTITY_EXPIRY_SKEW_SECONDS = 15;

let requestSpreadsheet_ = null;
let requestSheets_ = {};
let currentTraceId_ = '';
let currentAction_ = '';
let currentRequestStartedAt_ = 0;

function doGet() {
  return json_({
    ok: true,
    data: {
      service: POINTS_CARD_SERVICE.name,
      version: POINTS_CARD_SERVICE.version,
      capabilities: [
        'member.me', 'member.point-notifications.list', 'member.point-notification.read',
        'stamp.record', 'reward.prepare', 'reward.claim', 'admin.dashboard', 'admin.summary',
        'admin.members.search', 'admin.stamps.list', 'admin.reward-confirmations.list',
        'admin.member.update', 'admin.points.grant', 'admin.reward.redeem', 'admin.reward-nodes.update',
        'admin.cards.list', 'admin.card.create', 'admin.card.update', 'admin.card.save', 'admin.card.delete',
        'admin.stamp.create', 'admin.stamp.open', 'admin.stamp.cancel', 'admin.stamp.delete',
        'admin.reward-confirm.create', 'admin.reward-confirm.open', 'admin.reward-confirm.cancel',
        'admin.reward-confirm.delete'
      ]
    }
  });
}

function doPost(e) {
  resetRequestCaches_();
  requestMultiCardSheets_ = {};
  requestMultiCardObjects_ = {};
  requestMultiCardLookupObjects_ = {};
  currentTraceId_ = randomHex_(8);
  currentAction_ = '';
  currentRequestStartedAt_ = Date.now();
  try {
    const action = cleanText_(e && e.parameter && e.parameter.action, 80, true);
    currentAction_ = action;
    if (action === 'integration.minutes.grant-points') {
      return json_({ ok: true, data: minuteGrantPointsIntegration_(e) });
    }
    if (action === 'integration.minutes.cards.list') {
      return json_({ ok: true, data: minuteGrantCardsListIntegration_(e) });
    }
    const idToken = cleanText_(e && e.parameter && e.parameter.idToken, 4096, true);
    const tokenFingerprint = sha256Hex_(idToken);
    rateLimit_('token:' + tokenFingerprint, 90, 60);
    const identity = verifyLineIdToken_(idToken, tokenFingerprint);
    const context = { identity: identity, adminMember: null };
    const payload = parsePayload_(e && e.parameter && e.parameter.payload);

    switch (action) {
      case 'member.me':
        rateLimit_('member-me:' + identity.sub, 30, 60);
        return json_({ ok: true, data: memberMeVisibleMultiCard_(context, payload) });
      case 'member.point-notifications.list':
        rateLimit_('member-point-notifications-list:' + identity.sub, 30, 60);
        return json_({ ok: true, data: memberPointNotificationsList_(context, payload) });
      case 'member.point-notification.read':
        rateLimit_('member-point-notification-read:' + identity.sub, 30, 60);
        return json_({ ok: true, data: memberPointNotificationRead_(context, payload) });
      case 'stamp.record':
        rateLimit_('stamp-record:' + identity.sub, 12, 60);
        return json_({ ok: true, data: stampRecordMultiCard_(context, payload) });
      case 'reward.claim':
        rateLimit_('reward-claim:' + identity.sub, 12, 60);
        return json_({ ok: true, data: memberRewardClaimVisibleMultiCard_(context, payload) });
      case 'reward.prepare':
        rateLimit_('reward-prepare:' + identity.sub, 20, 60);
        return json_({ ok: true, data: memberRewardPrepareMultiCard_(context, payload) });
      case 'admin.dashboard':
        requireAdmin_(context);
        rateLimit_('admin-dashboard:' + identity.sub, 30, 60);
        return json_({ ok: true, data: adminDashboardMultiCard_(payload) });
      case 'admin.summary':
        requireAdmin_(context);
        rateLimit_('admin-summary:' + identity.sub, 45, 60);
        return json_({ ok: true, data: adminSummaryMultiCard_(payload) });
      case 'admin.cards.list':
        requireAdmin_(context);
        rateLimit_('admin-cards-list:' + identity.sub, 45, 60);
        return json_({ ok: true, data: adminCardsListMultiCard_() });
      case 'admin.members.search':
        requireAdmin_(context);
        rateLimit_('admin-members-search:' + identity.sub, 45, 60);
        return json_({ ok: true, data: adminMembersSearchMultiCard_(payload) });
      case 'admin.stamps.list':
        requireAdmin_(context);
        rateLimit_('admin-stamps-list:' + identity.sub, 45, 60);
        return json_({ ok: true, data: adminStampListMultiCard_(payload) });
      case 'admin.reward-confirmations.list':
        requireAdmin_(context);
        rateLimit_('admin-reward-confirmations-list:' + identity.sub, 45, 60);
        return json_({ ok: true, data: { rewardConfirmations: adminRewardConfirmationListMultiCard_(payload.limit || 50) } });
      case 'admin.member.update':
        requireAdmin_(context);
        rateLimit_('admin-member-update:' + identity.sub, 20, 60);
        return json_({ ok: true, data: adminMemberUpdateMultiCard_(context, payload) });
      case 'admin.points.grant':
        requireAdmin_(context);
        rateLimit_('admin-points-grant:' + identity.sub, 20, 60);
        return json_({ ok: true, data: adminPointGrantMultiCard_(context, payload) });
      case 'admin.reward.redeem':
        requireAdmin_(context);
        rateLimit_('admin-reward-redeem:' + identity.sub, 20, 60);
        return json_({ ok: true, data: adminRewardRedeemMultiCard_(context, payload) });
      case 'admin.reward-nodes.update':
        requireAdmin_(context);
        rateLimit_('admin-reward-nodes-update:' + identity.sub, 10, 60);
        return json_({ ok: true, data: adminRewardNodesUpdateMultiCard_(context, payload) });
      case 'admin.card.create':
        requireAdmin_(context);
        rateLimit_('admin-card-create:' + identity.sub, 10, 60);
        return json_({ ok: true, data: adminCardCreateMultiCard_(context, payload) });
      case 'admin.card.update':
        requireAdmin_(context);
        rateLimit_('admin-card-update:' + identity.sub, 10, 60);
        return json_({ ok: true, data: adminCardUpdateMultiCard_(context, payload) });
      case 'admin.card.save':
        requireAdmin_(context);
        rateLimit_('admin-card-save:' + identity.sub, 10, 60);
        return json_({ ok: true, data: adminCardSaveMultiCard_(context, payload) });
      case 'admin.card.delete':
        requireAdmin_(context);
        rateLimit_('admin-card-delete:' + identity.sub, 10, 60);
        return json_({ ok: true, data: adminCardDeleteMultiCard_(context, payload) });
      case 'admin.stamp.create':
        requireAdmin_(context);
        rateLimit_('admin-stamp-create:' + identity.sub, 20, 60);
        return json_({ ok: true, data: adminStampCreateMultiCard_(context, payload) });
      case 'admin.stamp.open':
        requireAdmin_(context);
        rateLimit_('admin-stamp-open:' + identity.sub, 30, 60);
        return json_({ ok: true, data: adminStampOpenMultiCard_(payload) });
      case 'admin.stamp.cancel':
        requireAdmin_(context);
        rateLimit_('admin-stamp-cancel:' + identity.sub, 20, 60);
        return json_({ ok: true, data: adminStampCancelMultiCard_(context, payload) });
      case 'admin.stamp.delete':
        requireAdmin_(context);
        rateLimit_('admin-stamp-delete:' + identity.sub, 20, 60);
        return json_({ ok: true, data: adminStampDeleteMultiCard_(context, payload) });
      case 'admin.reward-confirm.create':
        requireAdmin_(context);
        rateLimit_('admin-reward-confirm-create:' + identity.sub, 10, 60);
        return json_({ ok: true, data: adminRewardConfirmationCreate_(context, payload) });
      case 'admin.reward-confirm.open':
        requireAdmin_(context);
        rateLimit_('admin-reward-confirm-open:' + identity.sub, 30, 60);
        return json_({ ok: true, data: adminRewardConfirmationOpenMultiCard_(payload) });
      case 'admin.reward-confirm.cancel':
        requireAdmin_(context);
        rateLimit_('admin-reward-confirm-cancel:' + identity.sub, 20, 60);
        return json_({ ok: true, data: adminRewardConfirmationCancel_(context, payload) });
      case 'admin.reward-confirm.delete':
        requireAdmin_(context);
        rateLimit_('admin-reward-confirm-delete:' + identity.sub, 20, 60);
        return json_({ ok: true, data: adminRewardConfirmationDeleteMultiCard_(context, payload) });
      default:
        fail_('INVALID_ACTION', '不支援的操作。');
    }
  } catch (error) {
    if (!error || !error.publicCode) {
      console.error(JSON.stringify({
        event: 'points_card_unhandled_error',
        traceId: currentTraceId_,
        action: currentAction_ || 'unknown',
        stack: String(error && error.stack || error || '').slice(0, 4000)
      }));
      return json_({ ok: false, error: { code: 'INTERNAL_ERROR', message: '集點服務暫時無法處理此要求。' } });
    }
    return json_({ ok: false, error: { code: error.publicCode, message: error.publicMessage } });
  }
}

function memberMe_(context, skipProjection) {
  const sheet = getSheet_(POINTS_CARD_SHEETS.members);
  let match = findByFieldWithRow_(sheet, 'lineUserId', context.identity.sub);
  if (!match) {
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(5000)) fail_('BUSY', '系統忙碌中，請稍後再試。');
    try {
      match = findByFieldWithRow_(sheet, 'lineUserId', context.identity.sub);
      if (!match) {
        const now = new Date().toISOString();
        const member = {
          lineUserId: context.identity.sub,
          memberNo: nextMemberNo_(sheet),
          displayName: cleanText_(context.identity.name || 'LINE 會員', 80, false),
          pictureUrl: safePictureUrl_(context.identity.picture),
          membershipStatus: 'active', totalStamps: 0, redeemedRewards: 0,
          joinedAt: now, note: '', createdAt: now, updatedAt: now, canManagePoints: false
        };
        if (!audit_(context.identity.sub, 'member', 'MEMBER_CREATE_REQUESTED', context.identity.sub, 'pending', { memberNo: member.memberNo })) {
          fail_('AUDIT_UNAVAILABLE', '稽核紀錄暫時無法寫入，會員資料尚未建立。');
        }
        appendObject_(sheet, member);
        audit_(context.identity.sub, 'member', 'MEMBER_CREATED', context.identity.sub, 'success', { memberNo: member.memberNo });
        return { member: skipProjection ? normalizeMember_(member) : publicMember_(member, false) };
      }
    } finally { lock.releaseLock(); }
  }

  let member = match.object;
  const displayName = cleanText_(context.identity.name || member.displayName || 'LINE 會員', 80, false);
  const pictureUrl = safePictureUrl_(context.identity.picture);
  if (displayName !== member.displayName || pictureUrl !== member.pictureUrl) {
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(5000)) fail_('BUSY', '系統忙碌中，請稍後再試。');
    try {
      const fresh = findByFieldWithRow_(sheet, 'lineUserId', context.identity.sub);
      if (!fresh) fail_('MEMBER_NOT_FOUND', '找不到會員資料。');
      member = fresh.object;
      member.displayName = displayName;
      member.pictureUrl = pictureUrl;
      member.updatedAt = new Date().toISOString();
      writeObjectRow_(sheet, fresh.row, member);
    } finally { lock.releaseLock(); }
  }
  if (skipProjection) return { member: normalizeMember_(member) };
  return { member: publicMember_(member, false, readClaimedRewardOrdinalsForMember_(context.identity.sub)) };
}

function adminMemberUpdate_(context, payload) {
  const targetMemberNo = cleanText_(payload.targetMemberNo, 30, true);
  const expectedUpdatedAt = cleanText_(payload.expectedUpdatedAt, 40, true);
  const membershipStatus = enumValue_(payload.membershipStatus, MEMBER_STATUS_VALUES, 'INVALID_STATUS', '會員狀態不正確。');
  const note = cleanText_(payload.note || '', 500, false);
  const sheet = getSheet_(POINTS_CARD_SHEETS.members);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) fail_('BUSY', '系統忙碌中，請稍後再試。');
  try {
    const match = findByFieldWithRow_(sheet, 'memberNo', targetMemberNo);
    if (!match) fail_('MEMBER_NOT_FOUND', '找不到指定會員。');
    const member = normalizeMember_(match.object);
    if (String(member.updatedAt) !== expectedUpdatedAt) fail_('CONFLICT', '會員資料已被更新，請重新整理後再試。');
    const changedFields = [];
    if (member.membershipStatus !== membershipStatus) changedFields.push('membershipStatus');
    if (member.note !== note) changedFields.push('note');
    member.membershipStatus = membershipStatus;
    member.note = note;
    member.updatedAt = new Date().toISOString();
    if (!audit_(context.identity.sub, 'admin', 'MEMBER_UPDATE_REQUESTED', member.lineUserId, 'pending', {
      memberNo: member.memberNo, fields: changedFields
    })) fail_('AUDIT_UNAVAILABLE', '稽核紀錄暫時無法寫入，會員資料未更新。');
    writeObjectRow_(sheet, match.row, member);
    audit_(context.identity.sub, 'admin', 'MEMBER_UPDATED', member.lineUserId, 'success', {
      memberNo: member.memberNo, fields: changedFields
    });
    return { member: publicMember_(member, true, readClaimedRewardOrdinalsForMember_(member.lineUserId)) };
  } finally { lock.releaseLock(); }
}

function publicMember_(value, includeAdminFields, claimedOrdinals, settingsOverride) {
  const member = normalizeMember_(value);
  const settings = settingsOverride || pointsCardSettings_();
  const rewards = rewardProjection_(member, settings, claimedOrdinals);
  const result = {
    memberNo: member.memberNo,
    displayName: member.displayName,
    pictureUrl: member.pictureUrl,
    membershipStatus: member.membershipStatus,
    totalStamps: member.totalStamps,
    redeemedRewards: member.redeemedRewards,
    availableRewards: rewards.availableRewards,
    availableRewardNodes: rewards.availableRewardNodes.map(publicRewardTicket_),
    upcomingRewardNodes: rewards.upcomingRewardNodes.map(publicRewardTicket_),
    stampsPerReward: settings.stampsPerReward,
    cardSize: settings.cardSize,
    card: settings.card,
    visualStamps: rewards.visualStamps,
    displayCycleNumber: rewards.displayCycleNumber,
    stampsUntilReward: rewards.availableRewards > 0 ? 0 : rewards.stampsUntilNextReward,
    stampsUntilNextReward: rewards.stampsUntilNextReward,
    rewardName: rewards.nextAvailableReward ? rewards.nextAvailableReward.rewardName :
      (rewards.nextReward ? rewards.nextReward.rewardName : settings.rewardName),
    rewardNodesUpdatedAt: settings.rewardNodesUpdatedAt,
    rewardNodes: rewards.rewardNodes.map(publicRewardTicket_),
    nextAvailableReward: rewards.nextAvailableReward ? publicRewardTicket_(rewards.nextAvailableReward) : null,
    nextReward: rewards.nextReward ? publicRewardTicket_(rewards.nextReward) : null,
    joinedAt: member.joinedAt,
    updatedAt: member.updatedAt
  };
  if (includeAdminFields) result.note = member.note;
  return result;
}

function normalizeMember_(value) {
  return {
    lineUserId: String(value.lineUserId || ''),
    memberNo: String(value.memberNo || ''),
    displayName: String(value.displayName || 'LINE 會員'),
    pictureUrl: safePictureUrl_(value.pictureUrl),
    membershipStatus: MEMBER_STATUS_VALUES.indexOf(String(value.membershipStatus)) >= 0 ? String(value.membershipStatus) : 'disabled',
    totalStamps: storedNonNegativeInt_(value.totalStamps, 100000000),
    redeemedRewards: storedNonNegativeInt_(value.redeemedRewards, 100000000),
    joinedAt: String(value.joinedAt || ''),
    note: String(value.note || ''),
    createdAt: String(value.createdAt || ''),
    updatedAt: String(value.updatedAt || ''),
    canManagePoints: isTrue_(value.canManagePoints)
  };
}

function pointsCardSettings_() {
  const properties = PropertiesService.getScriptProperties();
  const legacyStamps = clampInt_(properties.getProperty(POINTS_CARD_SERVICE.stampsPerRewardProperty), 2, MAX_CARD_STAMPS, 10);
  const legacyRewardName = cleanText_(properties.getProperty(POINTS_CARD_SERVICE.rewardNameProperty) || '招牌飲品一份', 80, false);
  const rawNodes = properties.getProperty(POINTS_CARD_SERVICE.rewardNodesProperty) || '';
  let rewardNodes;
  if (rawNodes) {
    try {
      rewardNodes = normalizeRewardNodes_(JSON.parse(rawNodes), 'CONFIGURATION_ERROR', '獎勵節點設定格式不正確。');
    } catch (error) {
      if (error && error.publicCode) throw error;
      fail_('CONFIGURATION_ERROR', '獎勵節點設定格式不正確。');
    }
  } else {
    rewardNodes = normalizeRewardNodes_([{ stampsRequired: legacyStamps, rewardName: legacyRewardName }], 'CONFIGURATION_ERROR', '獎勵節點設定格式不正確。');
  }
  const lastNode = rewardNodes[rewardNodes.length - 1];
  return {
    stampsPerReward: lastNode.stampsRequired,
    cardSize: lastNode.stampsRequired,
    rewardName: lastNode.rewardName,
    rewardNodes: rewardNodes,
    rewardTicketTypesSupported: true,
    rewardLotteryWeightsSupported: true,
    cardLifecycleSupported: true,
    card: publicPointsCardLifecycle_(),
    rewardNodesUpdatedAt: properties.getProperty(POINTS_CARD_SERVICE.rewardNodesUpdatedAtProperty) || 'legacy'
  };
}

function normalizeLotteryPrizes_(value, errorCode, errorMessage) {
  if (!Array.isArray(value) || value.length < 2 || value.length > 8) fail_(errorCode, errorMessage);
  const isLegacyList = value.every(function (prize) { return typeof prize === 'string'; });
  const equalWeightBasis = Math.floor(LOTTERY_WEIGHT_BASIS_POINTS / value.length);
  const prizes = value.map(function (prize, index) {
    const source = isLegacyList ? { name: prize } : prize;
    if (!source || Object.prototype.toString.call(source) !== '[object Object]') fail_(errorCode, errorMessage);
    const name = String(source.name == null ? '' : source.name).replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
    if (!name || name.length > 80) fail_(errorCode, errorMessage);
    let weightBasis;
    if (isLegacyList) {
      weightBasis = index === value.length - 1 ? LOTTERY_WEIGHT_BASIS_POINTS - (equalWeightBasis * index) : equalWeightBasis;
    } else {
      if (source.weight == null || source.weight === '') fail_(errorCode, errorMessage);
      const weight = Number(source.weight);
      weightBasis = Math.round(weight * 100);
      if (!Number.isFinite(weight) || weight < 0 || weight > 100 || Math.abs((weight * 100) - weightBasis) > 0.000001) fail_(errorCode, errorMessage);
    }
    return { name: name, weight: weightBasis / 100 };
  });
  if (new Set(prizes.map(function (prize) { return prize.name; })).size !== prizes.length) fail_(errorCode, errorMessage);
  const totalWeightBasis = prizes.reduce(function (total, prize) { return total + Math.round(prize.weight * 100); }, 0);
  if (totalWeightBasis !== LOTTERY_WEIGHT_BASIS_POINTS) fail_(errorCode, errorMessage);
  return prizes;
}

function normalizeRewardNodes_(value, errorCode, errorMessage) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 5) fail_(errorCode, errorMessage);
  const nodes = value.map(function (node) {
    if (!node || Object.prototype.toString.call(node) !== '[object Object]') fail_(errorCode, errorMessage);
    const stampsRequired = Number(node.stampsRequired);
    if (!Number.isFinite(stampsRequired) || Math.floor(stampsRequired) !== stampsRequired || stampsRequired < 1 || stampsRequired > MAX_CARD_STAMPS) {
      fail_(errorCode, errorMessage);
    }
    const rewardName = String(node.rewardName == null ? '' : node.rewardName).replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
    if (!rewardName || rewardName.length > 80) fail_(errorCode, errorMessage);
    const rewardType = node.rewardType == null || node.rewardType === '' ? 'coupon' : String(node.rewardType);
    if (REWARD_TYPES.indexOf(rewardType) < 0) fail_(errorCode, errorMessage);
    const ticketValidityDays = node.ticketValidityDays == null || node.ticketValidityDays === '' ? 0 : Number(node.ticketValidityDays);
    const unusedReminderDays = node.unusedReminderDays == null || node.unusedReminderDays === '' ? 0 : Number(node.unusedReminderDays);
    if (!Number.isFinite(ticketValidityDays) || Math.floor(ticketValidityDays) !== ticketValidityDays ||
      ticketValidityDays < 0 || ticketValidityDays > MAX_TICKET_TERM_DAYS) fail_(errorCode, errorMessage);
    if (!Number.isFinite(unusedReminderDays) || Math.floor(unusedReminderDays) !== unusedReminderDays ||
      unusedReminderDays < 0 || unusedReminderDays > MAX_TICKET_TERM_DAYS) fail_(errorCode, errorMessage);
    if (ticketValidityDays > 0 && unusedReminderDays >= ticketValidityDays) {
      fail_(errorCode, '未使用提醒必須早於票券到期日。');
    }
    const lotteryPrizes = rewardType === 'lottery' ? normalizeLotteryPrizes_(node.lotteryPrizes, errorCode, errorMessage) : [];
    return {
      nodeId: 'node-' + stampsRequired,
      stampsRequired: stampsRequired,
      rewardName: rewardName,
      rewardType: rewardType,
      lotteryPrizes: lotteryPrizes,
      ticketValidityDays: ticketValidityDays,
      unusedReminderDays: unusedReminderDays
    };
  }).sort(function (a, b) { return a.stampsRequired - b.stampsRequired; });
  for (let index = 1; index < nodes.length; index += 1) {
    if (nodes[index - 1].stampsRequired === nodes[index].stampsRequired) fail_(errorCode, errorMessage);
  }
  return nodes;
}

function earnedRewardCountForStamps_(totalStamps, settings) {
  const cardSize = settings.cardSize;
  const fullCycles = Math.floor(totalStamps / cardSize);
  const remainder = totalStamps % cardSize;
  const partialRewards = settings.rewardNodes.filter(function (node) { return node.stampsRequired <= remainder; }).length;
  return fullCycles * settings.rewardNodes.length + partialRewards;
}

function rewardEntitlementByOrdinal_(ordinal, settings) {
  const nodeCount = settings.rewardNodes.length;
  const cycleIndex = Math.floor((ordinal - 1) / nodeCount);
  const nodeIndex = (ordinal - 1) % nodeCount;
  const node = settings.rewardNodes[nodeIndex];
  return {
    entitlementOrdinal: ordinal,
    nodeId: node.nodeId,
    stampsRequired: node.stampsRequired,
    rewardName: node.rewardName,
    rewardType: node.rewardType,
    lotteryPrizes: node.lotteryPrizes.map(function (prize) { return { name: prize.name, weight: prize.weight }; }),
    ticketValidityDays: node.ticketValidityDays || 0,
    unusedReminderDays: node.unusedReminderDays || 0,
    cycleNumber: cycleIndex + 1,
    absoluteStamps: cycleIndex * settings.cardSize + node.stampsRequired
  };
}

function publicRewardTicket_(reward) {
  const lotteryPrizes = reward.rewardType === 'lottery' && Array.isArray(reward.lotteryPrizes)
    ? reward.lotteryPrizes.map(function (prize) { return String(prize.name || ''); }).filter(Boolean)
    : [];
  return {
    entitlementOrdinal: Number(reward.entitlementOrdinal || 0),
    nodeId: String(reward.nodeId || ''),
    stampsRequired: Number(reward.stampsRequired || 0),
    rewardName: String(reward.rewardName || ''),
    rewardType: REWARD_TYPES.indexOf(String(reward.rewardType)) >= 0 ? String(reward.rewardType) : 'coupon',
    cycleNumber: Number(reward.cycleNumber || 1),
    absoluteStamps: Number(reward.absoluteStamps || 0),
    stampsUntilReward: Math.max(0, Number(reward.stampsUntilReward || 0)),
    state: String(reward.state || ''),
    lotteryPrizes: lotteryPrizes,
    ticketValidityDays: Number(reward.ticketValidityDays || 0),
    unusedReminderDays: Number(reward.unusedReminderDays || 0),
    earnedAt: String(reward.earnedAt || ''),
    expiresAt: String(reward.expiresAt || ''),
    expired: Boolean(reward.expired),
    usable: reward.usable === undefined ? !reward.expired : Boolean(reward.usable)
  };
}

function normalizedClaimedOrdinals_(member, claimedOrdinals) {
  const result = new Set();
  (Array.isArray(claimedOrdinals) ? claimedOrdinals : []).forEach(function (ordinal) {
    const value = Number(ordinal);
    if (Number.isFinite(value) && Math.floor(value) === value && value > 0) result.add(value);
  });
  let legacyOrdinal = 1;
  while (result.size < Number(member.redeemedRewards || 0)) {
    while (result.has(legacyOrdinal)) legacyOrdinal += 1;
    result.add(legacyOrdinal);
  }
  return result;
}

function claimedRewardOrdinalsByMember_() {
  const result = {};
  readObjects_(getSheet_(POINTS_CARD_SHEETS.rewardRecords)).forEach(function (record) {
    if (record.status !== 'recorded' && record.status !== 'processing') return;
    const lineUserId = String(record.memberLineUserId || '');
    const ordinal = Number(record.rewardOrdinal || 0);
    if (!lineUserId || !Number.isFinite(ordinal) || Math.floor(ordinal) !== ordinal || ordinal < 1) return;
    if (!result[lineUserId]) result[lineUserId] = [];
    if (result[lineUserId].indexOf(ordinal) < 0) result[lineUserId].push(ordinal);
  });
  return result;
}

function readClaimedRewardOrdinalsForMember_(lineUserId) {
  return claimedRewardOrdinalsByMember_()[String(lineUserId || '')] || [];
}

function rewardProjection_(member, settings, claimedOrdinals) {
  const totalStamps = Number(member.totalStamps || 0);
  const earnedRewards = earnedRewardCountForStamps_(totalStamps, settings);
  const claimed = normalizedClaimedOrdinals_(member, claimedOrdinals);
  const availableRewardNodes = [];
  for (let ordinal = 1; ordinal <= earnedRewards; ordinal += 1) {
    if (!claimed.has(ordinal)) availableRewardNodes.push(rewardEntitlementByOrdinal_(ordinal, settings));
  }
  const claimedEarnedCount = Array.from(claimed).filter(function (ordinal) { return ordinal <= earnedRewards; }).length;
  const availableRewards = Math.max(0, earnedRewards - claimedEarnedCount);
  const nextReward = rewardEntitlementByOrdinal_(earnedRewards + 1, settings);
  const upcomingRewardNodes = [];
  for (let ordinal = earnedRewards + 1; ordinal <= earnedRewards + settings.rewardNodes.length; ordinal += 1) {
    const upcoming = rewardEntitlementByOrdinal_(ordinal, settings);
    upcoming.stampsUntilReward = Math.max(0, upcoming.absoluteStamps - totalStamps);
    upcoming.state = 'pending';
    upcomingRewardNodes.push(upcoming);
  }
  const remainder = totalStamps % settings.cardSize;
  const completedCycles = Math.floor(totalStamps / settings.cardSize);
  const displayCycleIndex = totalStamps > 0 && remainder === 0 ? Math.max(0, completedCycles - 1) : completedCycles;
  const visualStamps = totalStamps > 0 && remainder === 0 ? settings.cardSize : remainder;
  const rewardNodes = settings.rewardNodes.map(function (node, index) {
    const entitlement = rewardEntitlementByOrdinal_(displayCycleIndex * settings.rewardNodes.length + index + 1, settings);
    let state = 'pending';
    if (claimed.has(entitlement.entitlementOrdinal)) state = 'redeemed';
    else if (entitlement.absoluteStamps <= totalStamps) state = 'available';
    return {
      nodeId: node.nodeId,
      stampsRequired: node.stampsRequired,
      rewardName: node.rewardName,
      rewardType: node.rewardType,
      lotteryPrizes: node.lotteryPrizes,
      ticketValidityDays: node.ticketValidityDays || 0,
      unusedReminderDays: node.unusedReminderDays || 0,
      entitlementOrdinal: entitlement.entitlementOrdinal,
      cycleNumber: entitlement.cycleNumber,
      absoluteStamps: entitlement.absoluteStamps,
      state: state
    };
  });
  return {
    earnedRewards: earnedRewards,
    availableRewards: availableRewards,
    availableRewardNodes: availableRewardNodes,
    upcomingRewardNodes: upcomingRewardNodes,
    nextAvailableReward: availableRewardNodes.length ? availableRewardNodes[0] : null,
    nextReward: nextReward,
    stampsUntilNextReward: Math.max(0, nextReward.absoluteStamps - totalStamps),
    visualStamps: visualStamps,
    displayCycleNumber: displayCycleIndex + 1,
    rewardNodes: rewardNodes
  };
}

function rewardEntitlementsBetweenTotals_(totalBefore, totalAfter, settings) {
  const beforeCount = earnedRewardCountForStamps_(totalBefore, settings);
  const afterCount = earnedRewardCountForStamps_(totalAfter, settings);
  const unlocked = [];
  for (let ordinal = beforeCount + 1; ordinal <= afterCount; ordinal += 1) unlocked.push(rewardEntitlementByOrdinal_(ordinal, settings));
  return unlocked;
}

function rewardSettingsLocked_() {
  if (getSheet_(POINTS_CARD_SHEETS.rewardRecords).getLastRow() > 1) return true;
  return readObjects_(getSheet_(POINTS_CARD_SHEETS.members)).some(function (member) {
    return storedNonNegativeInt_(member.redeemedRewards, 100000000) > 0;
  });
}

function requireAdmin_(context) {
  const memberSheet = getSheet_(POINTS_CARD_SHEETS.members);
  const match = findByFieldWithRow_(memberSheet, 'lineUserId', context.identity.sub);
  if (!match) fail_('FORBIDDEN', '尚未建立管理員會員資料。');
  const member = normalizeMember_(match.object);
  if (!member.canManagePoints || member.membershipStatus !== 'active') fail_('FORBIDDEN', '沒有集點卡管理權限。');
  context.adminMember = member;
  return member;
}

function verifyLineIdToken_(idToken, fingerprint) {
  if (!idToken || idToken.length < 20) fail_('UNAUTHENTICATED', 'LINE 登入憑證無效。');
  const channelId = String(PropertiesService.getScriptProperties().getProperty(POINTS_CARD_SERVICE.lineChannelProperty) || '').trim();
  if (!/^\d{6,20}$/.test(channelId)) fail_('CONFIGURATION_ERROR', 'LINE Login Channel ID 尚未正確設定。');
  const cache = CacheService.getScriptCache();
  const cacheKey = 'pc-line-' + fingerprint;
  try {
    const cached = cache.get(cacheKey);
    if (cached) {
      const identity = JSON.parse(cached);
      validateVerifiedIdentity_(identity, channelId);
      return identity;
    }
  } catch (_) {}

  let response;
  try {
    response = UrlFetchApp.fetch('https://api.line.me/oauth2/v2.1/verify', {
      method: 'post',
      payload: { id_token: idToken, client_id: channelId },
      muteHttpExceptions: true
    });
  } catch (_) {
    fail_('AUTH_SERVICE_UNAVAILABLE', 'LINE 身分驗證服務暫時無法使用。');
  }
  if (response.getResponseCode() !== 200) fail_('UNAUTHENTICATED', 'LINE 登入憑證已失效，請重新登入。');
  let parsed;
  try { parsed = JSON.parse(response.getContentText()); }
  catch (_) { fail_('AUTH_SERVICE_UNAVAILABLE', 'LINE 身分驗證服務回應不正確。'); }
  const identity = {
    sub: cleanText_(parsed.sub, 80, true),
    aud: String(parsed.aud || ''),
    exp: Number(parsed.exp || 0),
    iat: Number(parsed.iat || 0),
    name: cleanText_(parsed.name || 'LINE 會員', 80, false),
    picture: safePictureUrl_(parsed.picture)
  };
  validateVerifiedIdentity_(identity, channelId);
  const ttl = Math.min(LINE_IDENTITY_CACHE_MAX_SECONDS, Math.max(1, identity.exp - Math.floor(Date.now() / 1000) - LINE_IDENTITY_EXPIRY_SKEW_SECONDS));
  try { cache.put(cacheKey, JSON.stringify(identity), ttl); }
  catch (_) {}
  return identity;
}

function validateVerifiedIdentity_(identity, channelId) {
  if (!identity || !identity.sub || String(identity.aud) !== String(channelId)) fail_('UNAUTHENTICATED', 'LINE 登入憑證無效。');
  if (!Number(identity.exp) || Number(identity.exp) <= Math.floor(Date.now() / 1000) + LINE_IDENTITY_EXPIRY_SKEW_SECONDS) {
    fail_('UNAUTHENTICATED', 'LINE 登入憑證已過期，請重新登入。');
  }
}

function rateLimit_(key, limit, windowSeconds) {
  const cache = CacheService.getScriptCache();
  const cacheKey = 'pc-rate-' + sha256Hex_(key).slice(0, 40);
  const lock = LockService.getScriptLock();
  let locked = false;
  try {
    locked = lock.tryLock(750);
    if (!locked) fail_('BUSY', '系統忙碌中，請稍後再試。');
    const count = Number(cache.get(cacheKey) || 0);
    if (count >= limit) fail_('RATE_LIMITED', '操作過於頻繁，請稍後再試。');
    cache.put(cacheKey, String(count + 1), windowSeconds);
  } catch (error) {
    if (error && error.publicCode) throw error;
  } finally {
    if (locked) lock.releaseLock();
  }
}

function parsePayload_(raw) {
  const text = String(raw || '{}');
  if (text.length > 32768) fail_('INVALID_PAYLOAD', '請求內容過大。');
  let value;
  try { value = JSON.parse(text); }
  catch (_) { fail_('INVALID_PAYLOAD', '請求內容格式不正確。'); }
  if (!value || Object.prototype.toString.call(value) !== '[object Object]') fail_('INVALID_PAYLOAD', '請求內容格式不正確。');
  return value;
}

function cleanText_(value, maxLength, required) {
  const text = String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  if (required && !text) fail_('INVALID_INPUT', '缺少必要欄位。');
  if (text.length > maxLength) fail_('INVALID_INPUT', '輸入內容過長。');
  return text;
}

function enumValue_(value, allowed, code, message) {
  const text = String(value || '');
  if (allowed.indexOf(text) < 0) fail_(code, message);
  return text;
}

function clampInt_(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || Math.floor(number) !== number || number < min || number > max) return fallback;
  return number;
}

function strictInt_(value, min, max, code, message) {
  const number = Number(value);
  if (!Number.isFinite(number) || Math.floor(number) !== number || number < min || number > max) fail_(code, message);
  return number;
}

function storedNonNegativeInt_(value, max) {
  if (value === '' || value === null || value === undefined) return 0;
  const number = Number(value);
  if (!Number.isFinite(number) || Math.floor(number) !== number || number < 0 || number > max) {
    fail_('DATA_INTEGRITY_ERROR', '集點資料格式異常，請聯絡管理員。');
  }
  return number;
}

function validIsoFuture_(value) {
  const text = cleanText_(value, 40, true);
  const time = new Date(text).getTime();
  if (!Number.isFinite(time) || time <= Date.now()) fail_('INVALID_EXPIRY', '到期時間必須晚於現在。');
  if (time - Date.now() > MAX_VOUCHER_LIFETIME_MS) fail_('INVALID_EXPIRY', 'QR Code 最長只能設定 30 天。');
  return new Date(time).toISOString();
}

function safePictureUrl_(value) {
  const url = String(value || '').trim();
  return /^https:\/\//i.test(url) && url.length <= 1000 ? url : '';
}

function isTrue_(value) {
  return value === true || String(value).toLowerCase() === 'true' || Number(value) === 1;
}

function sha256Hex_(value) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(value || ''), Utilities.Charset.UTF_8);
  return bytes.map(function (byte) { return ((byte + 256) % 256).toString(16).padStart(2, '0'); }).join('');
}

function randomHex_(bytes) {
  let result = '';
  while (result.length < bytes * 2) result += Utilities.getUuid().replace(/-/g, '');
  return result.slice(0, bytes * 2).toLowerCase();
}

function fail_(code, message) {
  const error = new Error(message);
  error.publicCode = code;
  error.publicMessage = message;
  throw error;
}

function logApiResponse_(value) {
  if (!currentTraceId_) return;
  const payload = {
    event: 'points_card_api',
    traceId: currentTraceId_,
    action: currentAction_ || 'unknown',
    ok: Boolean(value && value.ok),
    durationMs: Math.max(0, Date.now() - Number(currentRequestStartedAt_ || Date.now()))
  };
  if (!payload.ok && value && value.error) payload.errorCode = String(value.error.code || 'UNKNOWN').slice(0, 80);
  const line = JSON.stringify(payload);
  if (payload.ok) console.info(line);
  else console.warn(line);
}

function json_(value) {
  if (currentTraceId_ && value && Object.prototype.toString.call(value) === '[object Object]') {
    value.meta = Object.assign({}, value.meta || {}, { traceId: currentTraceId_ });
    logApiResponse_(value);
  }
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
