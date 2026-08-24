'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
function read(relativePath) { return fs.readFileSync(path.join(root, relativePath), 'utf8'); }

test('earned coupon survives card archive, reloads on the deleted card, and remains claimable', () => {
  const storageSource = read('gas/MultiCardStorage.gs');
  const rewardSource = read('gas/MultiCardRewardService.gs');
  const context = { console };
  vm.createContext(context);
  vm.runInContext(
    storageSource + '\n;globalThis.__deleteCard = adminCardDeleteMultiCard_; globalThis.__publicMember = publicMultiCardMember_;',
    context
  );

  const state = {
    card: {
      cardId: 'CARD-ONE',
      name: '保留優惠券卡',
      description: '',
      storedStatus: 'active',
      status: 'active',
      available: true,
      expiresAt: '',
      rewardNodes: [{
        nodeId: 'node-10', stampsRequired: 10, rewardName: '保留優惠券', rewardType: 'coupon',
        lotteryPrizes: [], ticketValidityDays: 30, unusedReminderDays: 0
      }],
      rewardNodesUpdatedAt: 'v1',
      createdByLineUserId: 'UADMIN',
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-02T00:00:00.000Z'
    },
    progress: [{
      progressId: 'MP-ONE', cardId: 'CARD-ONE', memberLineUserId: 'UMEMBER', memberNo: 'M0001',
      totalStamps: 10, redeemedRewards: 0, createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-02T00:00:00.000Z'
    }],
    stampRecords: [{ cardId: 'CARD-ONE', memberLineUserId: 'UMEMBER', status: 'recorded', totalBefore: 0, totalAfter: 10 }],
    rewardRecords: [],
    vouchers: [{ cardId: 'CARD-ONE', status: 'active' }]
  };

  context.ensureMultiCardStorage_ = () => {};
  context.validMultiCardId_ = (value) => String(value);
  context.cleanText_ = (value) => String(value);
  context.LockService = { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) };
  context.findMultiCard_ = (cardId) => cardId === state.card.cardId ? { row: 2, card: state.card } : null;
  context.getMultiCardSheet_ = (name) => ({ name });
  context.readMultiCardObjects_ = (sheet) => {
    if (sheet.name === 'MemberCardProgress') return state.progress;
    if (sheet.name === 'CardStampVouchers') return state.vouchers;
    if (sheet.name === 'CardStampRecords') return state.stampRecords;
    if (sheet.name === 'CardRewardRecords') return state.rewardRecords;
    return [];
  };
  context.cancelActiveMultiCardStampVouchersForCard_ = () => 1;
  context.audit_ = () => true;
  context.writeMultiCardObjectRow_ = (sheet, row, storedCard) => {
    assert.equal(sheet.name, 'Cards');
    assert.equal(row, 2);
    state.card = Object.assign({}, state.card, {
      storedStatus: storedCard.status,
      status: storedCard.status,
      available: false,
      updatedAt: storedCard.updatedAt
    });
  };

  const deleted = context.__deleteCard({ identity: { sub: 'UADMIN' } }, {
    cardId: 'CARD-ONE', expectedUpdatedAt: '2026-08-02T00:00:00.000Z'
  });

  assert.equal(deleted.archived, true);
  assert.equal(state.card.storedStatus, 'deleted');
  assert.equal(state.progress.length, 1);
  assert.equal(state.progress[0].totalStamps, 10);
  assert.equal(state.rewardRecords.length, 0);
  assert.equal(state.stampRecords.length, 1);

  const coupon = {
    cardId: 'CARD-ONE', nodeId: 'node-10', entitlementOrdinal: 1, stampsRequired: 10,
    rewardName: '保留優惠券', rewardType: 'coupon', expired: false, usable: true
  };
  context.progressMapForMember_ = () => ({ 'CARD-ONE': state.progress[0] });
  context.allMultiCards_ = () => [state.card];
  context.publicMultiCard_ = (card) => ({
    cardId: card.cardId, name: card.name, description: card.description, status: card.status,
    available: card.available, expiresAt: card.expiresAt, updatedAt: card.updatedAt
  });
  context.publicMemberCardProjection_ = (card) => ({
    cardId: card.cardId,
    card: context.publicMultiCard_(card),
    name: card.name,
    description: card.description,
    status: card.status,
    available: false,
    expiresAt: card.expiresAt,
    totalStamps: 10,
    redeemedRewards: 0,
    availableRewards: 1,
    availableRewardNodes: [coupon],
    upcomingRewardNodes: [],
    rewardNodes: [coupon],
    nextAvailableReward: coupon,
    nextReward: null,
    rewardNodesUpdatedAt: 'v1'
  });

  const reloaded = context.__publicMember({
    lineUserId: 'UMEMBER', memberNo: 'M0001', displayName: '會員', pictureUrl: '',
    membershipStatus: 'active', joinedAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-02T00:00:00.000Z'
  }, { cardId: 'CARD-ONE' }, false);

  assert.equal(reloaded.selectedCardId, 'CARD-ONE');
  assert.equal(reloaded.card.status, 'deleted');
  assert.equal(reloaded.availableRewardNodes.length, 1);
  assert.equal(reloaded.availableRewardNodes[0].rewardName, '保留優惠券');

  context.POINTS_CARD_SHEETS = { members: 'Members', rewardConfirmations: 'RewardConfirmations' };
  vm.runInContext(rewardSource + '\n;globalThis.__claimReward = memberRewardClaimMultiCard_;', context);

  const member = {
    lineUserId: 'UMEMBER', memberNo: 'M0001', membershipStatus: 'active',
    joinedAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-02T00:00:00.000Z'
  };
  const confirmation = {
    confirmationId: 'RC-ONE', shareCode: 'a'.repeat(64), status: 'active',
    expiresAt: '2099-01-01T00:00:00.000Z', note: '門市確認'
  };
  let recordedCardStatus = '';

  context.strictInt_ = (value) => Number(value);
  context.getSheet_ = (name) => ({ name });
  context.findMultiCard_ = (cardId) => cardId === 'CARD-ONE' ? { row: 2, card: state.card } : null;
  context.findMultiCardByFieldWithRow_ = () => null;
  context.findByFieldWithRow_ = (sheet, field, value) => {
    if (sheet.name === 'RewardConfirmations' && field === 'shareCode' && value === confirmation.shareCode) {
      return { row: 2, object: confirmation };
    }
    if (sheet.name === 'Members' && field === 'lineUserId' && value === member.lineUserId) {
      return { row: 2, object: member };
    }
    return null;
  };
  context.normalizeRewardConfirmation_ = (value) => value;
  context.validateRewardConfirmationForClaim_ = () => {};
  context.normalizeMember_ = (value) => value;
  context.recoverProcessingMultiCardRewardRecordsForMember_ = () => {};
  context.multiCardSettingsForProjection_ = () => ({ rewardNodesUpdatedAt: 'v1', rewardNodes: state.card.rewardNodes });
  context.ensureMemberCardProgress_ = () => ({ row: 2, progress: state.progress[0] });
  context.availableMultiCardRewardForClaim_ = (progress, card, lineUserId, ordinal) => {
    assert.equal(progress.totalStamps, 10);
    assert.equal(card.storedStatus, 'deleted');
    assert.equal(lineUserId, 'UMEMBER');
    assert.equal(ordinal, 1);
    return coupon;
  };
  context.recordMultiCardRewardClaim_ = (sheet, progressMatch, claimMember, card, reward) => {
    recordedCardStatus = card.storedStatus;
    progressMatch.progress.redeemedRewards += 1;
    return {
      rewardRecordId: 'RR-ONE', requestId: 'b'.repeat(32), cardId: card.cardId,
      memberLineUserId: claimMember.lineUserId, memberNo: claimMember.memberNo,
      rewardName: reward.rewardName, rewardOrdinal: reward.entitlementOrdinal,
      status: 'recorded', rewardType: reward.rewardType, rewardNodeId: reward.nodeId,
      cycleNumber: 1, lotteryResult: '', confirmationId: confirmation.confirmationId,
      createdAt: '2026-08-23T00:00:00.000Z', redeemedAt: '2026-08-23T00:00:00.000Z'
    };
  };
  context.multiCardRewardClaimResponse_ = (memberValue, record) => ({
    duplicate: false,
    claimedReward: record,
    member: { memberNo: memberValue.memberNo, card: { cardId: record.cardId, status: 'deleted' } }
  });

  const claimed = context.__claimReward({ identity: { sub: 'UMEMBER' } }, {
    cardId: 'CARD-ONE',
    confirmationCode: confirmation.shareCode,
    requestId: 'b'.repeat(32),
    expectedRewardOrdinal: 1,
    expectedRewardNodesUpdatedAt: 'v1'
  });

  assert.equal(recordedCardStatus, 'deleted');
  assert.equal(state.progress[0].redeemedRewards, 1);
  assert.equal(claimed.claimedReward.rewardName, '保留優惠券');
});

test('deleted-card diagnostics distinguish historical destructive deletion without mutating storage', () => {
  const source = read('gas/DeletedCardIntegrityDiagnostics.gs');
  const auditRows = [[
    '2026-08-20T09:31:52.000Z', 'UADMIN', 'admin', 'CARD_DELETED', '', 'success',
    JSON.stringify({ cardId: 'CARD-OLD', deleteCounts: { progress: 1, rewardRecords: 0 } })
  ]];
  const auditSheet = {
    getLastRow: () => 2,
    getRange(row, column, rows, columns) {
      if (column === 7 && columns === 1) {
        return {
          createTextFinder() {
            return {
              matchCase() { return this; },
              useRegularExpression() { return this; },
              findAll() { return [{ getRow: () => 2 }]; }
            };
          }
        };
      }
      return { getValues: () => auditRows };
    }
  };
  const context = {
    console,
    MULTI_CARD_SHEETS: {
      progress: 'MemberCardProgress', vouchers: 'CardStampVouchers', stampRecords: 'CardStampRecords',
      rewardRecords: 'CardRewardRecords', notifications: 'CardRewardNotifications'
    },
    POINTS_CARD_SHEETS: { audit: 'AuditLogs' },
    POINTS_CARD_HEADERS: {
      AuditLogs: ['timestamp', 'actorLineUserId', 'actorRole', 'action', 'targetLineUserId', 'result', 'details']
    },
    ensureMultiCardStorage_: () => {},
    validMultiCardId_: (value) => String(value),
    findMultiCard_: () => null,
    getMultiCardSheet_: (name) => ({ name }),
    readMultiCardObjectsByField_: () => [],
    getSheet_: () => auditSheet,
    fail_: (code, message) => { const error = new Error(message); error.code = code; throw error; }
  };
  vm.createContext(context);
  vm.runInContext(source + '\n;globalThis.__diagnose = diagnosePointsCardDeletedCardRetention;', context);

  const result = context.__diagnose('CARD-OLD');
  assert.equal(result.card.exists, false);
  assert.equal(result.deletionAudit.destructiveEvidence, true);
  assert.equal(result.deletionAudit.archiveEvidence, false);
  assert.equal(result.classification, 'historical-destructive-delete-confirmed');
  assert.equal(result.recoverableFromCurrentRows, false);

  assert.doesNotMatch(source, /appendMultiCardObject_|writeMultiCardObjectRow_|deleteMultiCard|deleteObjectRow_|writeObjectRow_/);
});
