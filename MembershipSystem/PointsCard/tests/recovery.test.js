'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function publicError(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function storedNonNegativeInt(value, max) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > max) publicError('DATA_INTEGRITY_ERROR', 'invalid stored integer');
  return number;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createStampRecoveryHarness(memberTotal, recordOverrides) {
  const memberSheet = { name: 'Members' };
  const recordSheet = { name: 'StampRecords' };
  const memberState = {
    lineUserId: 'U1',
    memberNo: 'PC-1',
    totalStamps: memberTotal,
    redeemedRewards: 0,
    membershipStatus: 'active'
  };
  const recordState = Object.assign({
    requestId: 'a'.repeat(32),
    memberLineUserId: 'U1',
    memberNo: 'PC-1',
    voucherId: 'SQ-1',
    stampCount: 2,
    status: 'processing',
    totalBefore: 5,
    totalAfter: 7,
    recordedAt: '',
    auditRecordedAt: ''
  }, recordOverrides || {});
  const writes = [];
  const audits = [];

  const context = {
    POINTS_CARD_SHEETS: { members: 'Members', stampRecords: 'StampRecords' },
    MAX_STAMPS_PER_SCAN: 10,
    Array,
    Date,
    Number,
    String,
    Object,
    console,
    getSheet_: (name) => name === 'Members' ? memberSheet : recordSheet,
    findByFieldWithRow_: (sheet, field, value) => {
      if (sheet === memberSheet && field === 'lineUserId' && value === memberState.lineUserId) {
        return { row: 2, object: clone(memberState) };
      }
      return null;
    },
    normalizeMember_: (value) => Object.assign({}, value, {
      totalStamps: Number(value.totalStamps || 0),
      redeemedRewards: Number(value.redeemedRewards || 0)
    }),
    storedNonNegativeInt_: storedNonNegativeInt,
    writeObjectRow_: (sheet, row, value) => {
      writes.push({ sheet: sheet.name, row, value: clone(value) });
      if (sheet === memberSheet) Object.assign(memberState, clone(value));
      if (sheet === recordSheet) Object.assign(recordState, clone(value));
    },
    audit_: function () {
      audits.push(Array.from(arguments));
      return true;
    },
    fail_: publicError
  };
  vm.createContext(context);
  vm.runInContext(read('gas/StampService.gs') + '\n;globalThis.__test = { recoverStampRecord_ };', context);
  return { context, memberState, recordState, writes, audits };
}

function createRewardRecoveryHarness(redeemedRewards, recordOverrides) {
  const memberSheet = { name: 'Members' };
  const rewardSheet = { name: 'RewardRecords' };
  const memberState = {
    lineUserId: 'U1',
    memberNo: 'PC-1',
    totalStamps: 10,
    redeemedRewards: redeemedRewards,
    membershipStatus: 'active'
  };
  const recordState = Object.assign({
    requestId: 'b'.repeat(32),
    memberLineUserId: 'U1',
    memberNo: 'PC-1',
    rewardName: '測試優惠券',
    rewardType: 'coupon',
    rewardOrdinal: 1,
    redeemedBefore: 0,
    redeemedAfter: 1,
    status: 'processing',
    redeemedByLineUserId: 'ADMIN',
    confirmationId: '',
    lotteryResult: '',
    redeemedAt: '',
    auditRecordedAt: ''
  }, recordOverrides || {});
  const writes = [];
  const audits = [];

  const context = {
    POINTS_CARD_SHEETS: { members: 'Members', rewardRecords: 'RewardRecords' },
    Array,
    Date,
    Number,
    String,
    Object,
    console,
    getSheet_: (name) => name === 'Members' ? memberSheet : rewardSheet,
    findByFieldWithRow_: (sheet, field, value) => {
      if (sheet === memberSheet && field === 'memberNo' && value === memberState.memberNo) {
        return { row: 2, object: clone(memberState) };
      }
      return null;
    },
    normalizeMember_: (value) => Object.assign({}, value, {
      totalStamps: Number(value.totalStamps || 0),
      redeemedRewards: Number(value.redeemedRewards || 0)
    }),
    storedNonNegativeInt_: storedNonNegativeInt,
    writeObjectRow_: (sheet, row, value) => {
      writes.push({ sheet: sheet.name, row, value: clone(value) });
      if (sheet === memberSheet) Object.assign(memberState, clone(value));
      if (sheet === rewardSheet) Object.assign(recordState, clone(value));
    },
    audit_: function () {
      audits.push(Array.from(arguments));
      return true;
    },
    fail_: publicError
  };
  vm.createContext(context);
  vm.runInContext(read('gas/RewardService.gs') + '\n;globalThis.__test = { recoverRewardRecord_ };', context);
  return { context, memberState, recordState, writes, audits };
}

test('stamp recovery completes a processing record exactly once after a crash before member update', () => {
  const harness = createStampRecoveryHarness(5);
  const recovered = harness.context.__test.recoverStampRecord_({ row: 4, object: clone(harness.recordState) });

  assert.equal(harness.memberState.totalStamps, 7);
  assert.equal(recovered.status, 'recorded');
  assert.ok(recovered.recordedAt);
  assert.ok(recovered.auditRecordedAt);
  assert.equal(harness.writes.filter((write) => write.sheet === 'Members').length, 1);
  assert.equal(harness.writes.filter((write) => write.sheet === 'StampRecords').length, 1);
  assert.equal(harness.audits.length, 1);
});

test('stamp recovery does not add points again when member update already completed', () => {
  const harness = createStampRecoveryHarness(7);
  harness.context.__test.recoverStampRecord_({ row: 4, object: clone(harness.recordState) });

  assert.equal(harness.memberState.totalStamps, 7);
  assert.equal(harness.writes.filter((write) => write.sheet === 'Members').length, 0);
  assert.equal(harness.writes.filter((write) => write.sheet === 'StampRecords').length, 1);
});

test('stamp recovery fails closed when member total matches neither before nor after', () => {
  const harness = createStampRecoveryHarness(6);
  assert.throws(
    () => harness.context.__test.recoverStampRecord_({ row: 4, object: clone(harness.recordState) }),
    (error) => error && error.code === 'RECOVERY_REQUIRED'
  );
  assert.equal(harness.memberState.totalStamps, 6);
});

test('reward recovery completes a processing redemption exactly once after a crash before member update', () => {
  const harness = createRewardRecoveryHarness(0);
  const recovered = harness.context.__test.recoverRewardRecord_({ row: 5, object: clone(harness.recordState) });

  assert.equal(harness.memberState.redeemedRewards, 1);
  assert.equal(recovered.status, 'recorded');
  assert.ok(recovered.redeemedAt);
  assert.ok(recovered.auditRecordedAt);
  assert.equal(harness.writes.filter((write) => write.sheet === 'Members').length, 1);
  assert.equal(harness.writes.filter((write) => write.sheet === 'RewardRecords').length, 1);
  assert.equal(harness.audits.length, 1);
});

test('reward recovery does not redeem again when member counter already advanced', () => {
  const harness = createRewardRecoveryHarness(1);
  harness.context.__test.recoverRewardRecord_({ row: 5, object: clone(harness.recordState) });

  assert.equal(harness.memberState.redeemedRewards, 1);
  assert.equal(harness.writes.filter((write) => write.sheet === 'Members').length, 0);
  assert.equal(harness.writes.filter((write) => write.sheet === 'RewardRecords').length, 1);
});

test('reward recovery fails closed on ambiguous member state', () => {
  const harness = createRewardRecoveryHarness(2);
  assert.throws(
    () => harness.context.__test.recoverRewardRecord_({ row: 5, object: clone(harness.recordState) }),
    (error) => error && error.code === 'RECOVERY_REQUIRED'
  );
  assert.equal(harness.memberState.redeemedRewards, 2);
});
