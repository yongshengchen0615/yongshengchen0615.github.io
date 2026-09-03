'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

function loadMemberService() {
  class TestApiError extends Error {
    constructor(status, code, message) { super(message); this.status = status; this.code = code; }
  }
  const rows = {
    Members: [{ line_user_id: 'U-1', display_name: '測試會員', member_code: 'LM-TEST', tier: '一般會員', status: 'active', joined_at: '2026-09-03T00:00:00.000Z', last_login_at: '', created_at: '2026-09-03T00:00:00.000Z', updated_at: '2026-09-03T00:00:00.000Z', birthday: '', phone: '' }],
    ServiceTimeEntries: [],
    MembershipTierSettings: [
      { tier_key: 'general', tier_label: '一般會員', required_service_minutes: '0', updated_by: 'system', updated_at: '2026-09-03T00:00:00.000Z' },
      { tier_key: 'silver', tier_label: '銀級會員', required_service_minutes: '600', updated_by: 'system', updated_at: '2026-09-03T00:00:00.000Z' },
      { tier_key: 'gold', tier_label: '金級會員', required_service_minutes: '1800', updated_by: 'system', updated_at: '2026-09-03T00:00:00.000Z' },
      { tier_key: 'platinum', tier_label: '白金會員', required_service_minutes: '3600', updated_by: 'system', updated_at: '2026-09-03T00:00:00.000Z' }
    ],
    PointCards: [{ card_id: 'PC-1', title: '測試集點卡', target_stamps: '10', reward_title: '', expiry_mode: 'unlimited', expires_on: '', status: 'active', updated_at: '2026-09-03T00:00:00.000Z' }],
    PointBalances: [],
    PointEntries: [],
    PointCardRewards: [],
    PointCardLotteryPrizes: [],
    PointCardTicketTemplates: [],
    PointCardTickets: []
  };
  const audit = [];
  let id = 0;
  const context = {
    ApiError: TestApiError,
    Utilities: { getUuid: () => `00000000-0000-0000-0000-0000000000${String(id++).padStart(2, '0')}` },
    nowIso_: () => '2026-09-03T00:00:00.000Z',
    withDataLock_: (callback) => callback(),
    readRecords_: (sheetName) => rows[sheetName] || [],
    findRecordWithRow_: (sheetName, keyField, keyValue) => {
      const index = (rows[sheetName] || []).findIndex((record) => String(record[keyField] || '') === String(keyValue || ''));
      return index < 0 ? null : { rowNumber: index + 2, record: rows[sheetName][index] };
    },
    appendRecord_: (sheetName, record) => { rows[sheetName].push(record); },
    updateRecordAtRow_: (sheetName, rowNumber, record) => { rows[sheetName][rowNumber - 2] = record; },
    appendAuditRecord_: (record) => { audit.push(record); }
  };
  vm.createContext(context);
  vm.runInContext(read('gas/PointCardService.gs'), context, { filename: 'gas/PointCardService.gs' });
  vm.runInContext(read('gas/MemberService.gs'), context, { filename: 'gas/MemberService.gs' });
  return { context, rows, audit, TestApiError };
}

test('first-visit profile requires a real birthday and normalized phone for the member card only', () => {
  const { context, rows, audit, TestApiError } = loadMemberService();
  const identity = { lineUserId: 'U-1', displayName: '測試會員' };
  const result = context.handleMemberProfileSave_(identity, { birthday: '1990-02-28', phone: '0912-345-678' });
  assert.equal(rows.Members[0].birthday, '1990-02-28');
  assert.equal(rows.Members[0].phone, '0912345678');
  assert.equal(result.profile.profileComplete, true);
  assert.equal(result.profile.birthday, '1990-02-28');
  assert.equal(result.profile.phone, '0912345678');
  assert.equal(context.adminMemberForClient_(rows.Members[0], 0).birthday, undefined);
  assert.equal(context.adminMemberForClient_(rows.Members[0], 0).phone, undefined);
  assert.equal(audit[0].action, 'MEMBER_PROFILE_SAVE');
  assert.throws(() => context.handleMemberProfileSave_(identity, { birthday: '2026-02-30', phone: '0912345678' }), (error) => error instanceof TestApiError && error.code === 'INVALID_MEMBER_PROFILE');
  assert.throws(() => context.handleMemberProfileSave_(identity, { birthday: '1990-02-28', phone: 'bad-phone' }), (error) => error instanceof TestApiError && error.code === 'INVALID_MEMBER_PROFILE');
});

test('service-time grants are append-only, idempotent, and reflected in member totals', () => {
  const { context, rows, audit, TestApiError } = loadMemberService();
  const identity = { lineUserId: 'ADMIN-1' };
  const admin = { role: 'admin' };
  const request = { lineUserId: 'U-1', minutes: 75, note: '課程服務', requestId: 'request-service-time-0001' };
  const first = context.handleServiceMinutesAdd_(identity, admin, request);
  const duplicate = context.handleServiceMinutesAdd_(identity, admin, request);
  assert.equal(rows.ServiceTimeEntries.length, 1);
  assert.equal(first.member.serviceMinutesTotal, 75);
  assert.equal(duplicate.member.serviceMinutesTotal, 75);
  assert.equal(context.memberForClient_(rows.Members[0]).serviceMinutesTotal, 75);
  assert.equal(audit[0].action, 'SERVICE_TIME_ADD');
  assert.throws(() => context.handleServiceMinutesAdd_(identity, admin, { ...request, minutes: 90 }), (error) => error instanceof TestApiError && error.code === 'REQUEST_REUSE_MISMATCH');
  assert.throws(() => context.handleServiceMinutesAdd_(identity, admin, { ...request, requestId: 'request-service-time-0002', minutes: 1441 }), (error) => error instanceof TestApiError && error.code === 'INVALID_SERVICE_TIME');
});

test('member tiers are derived from accumulated service time and fixed threshold settings', () => {
  const { context, rows, audit, TestApiError } = loadMemberService();
  const member = rows.Members[0];
  member.tier = '白金會員';
  assert.equal(context.memberForClient_(member).tier, '一般會員');

  rows.ServiceTimeEntries.push({ line_user_id: 'U-1', minutes: '600' });
  assert.equal(context.adminMemberForClient_(member, 600).tier, '銀級會員');
  rows.ServiceTimeEntries.push({ line_user_id: 'U-1', minutes: '1200' });
  assert.equal(context.memberForClient_(member).tier, '金級會員');
  rows.ServiceTimeEntries.push({ line_user_id: 'U-1', minutes: '1800' });
  assert.equal(context.memberForClient_(member).tier, '白金會員');

  const result = context.handleMembershipTierSettingsSave_({ lineUserId: 'ADMIN-1' }, { role: 'admin' }, {
    tierSettings: [
      { tierKey: 'general', requiredServiceMinutes: 0, expectedUpdatedAt: '2026-09-03T00:00:00.000Z' },
      { tierKey: 'silver', requiredServiceMinutes: 1200, expectedUpdatedAt: '2026-09-03T00:00:00.000Z' },
      { tierKey: 'gold', requiredServiceMinutes: 2400, expectedUpdatedAt: '2026-09-03T00:00:00.000Z' },
      { tierKey: 'platinum', requiredServiceMinutes: 4800, expectedUpdatedAt: '2026-09-03T00:00:00.000Z' }
    ]
  });
  assert.deepEqual(JSON.parse(JSON.stringify(result.tierSettings.map((setting) => setting.requiredServiceMinutes))), [0, 1200, 2400, 4800]);
  assert.equal(context.memberForClient_(member).tier, '金級會員');
  assert.equal(audit.at(-1).action, 'MEMBER_TIER_SETTINGS_SAVE');
  assert.throws(
    () => context.handleMembershipTierSettingsSave_({ lineUserId: 'ADMIN-1' }, { role: 'admin' }, { tierSettings: [{ tierKey: 'general', requiredServiceMinutes: 1 }, { tierKey: 'silver', requiredServiceMinutes: 1200 }, { tierKey: 'gold', requiredServiceMinutes: 2400 }, { tierKey: 'platinum', requiredServiceMinutes: 4800 }] }),
    (error) => error instanceof TestApiError && error.code === 'INVALID_TIER_SETTINGS'
  );
  assert.throws(
    () => context.handleMembershipTierSettingsSave_({ lineUserId: 'ADMIN-1' }, { role: 'admin' }, { tierSettings: [{ tierKey: 'general', requiredServiceMinutes: 0 }, { tierKey: 'silver', requiredServiceMinutes: 1200 }, { tierKey: 'gold', requiredServiceMinutes: 1200 }, { tierKey: 'platinum', requiredServiceMinutes: 4800 }] }),
    (error) => error instanceof TestApiError && error.code === 'INVALID_TIER_SETTINGS'
  );
  rows.MembershipTierSettings[1].required_service_minutes = '1200.5';
  assert.throws(() => context.readMembershipTierSettings_(), (error) => error instanceof TestApiError && error.code === 'TIER_SETTINGS_INVALID');
});

test('combined member grants support either type or both without duplicate writes on replay', () => {
  const { context, rows, audit, TestApiError } = loadMemberService();
  const identity = { lineUserId: 'ADMIN-1' };
  const admin = { role: 'admin' };
  const request = {
    lineUserId: 'U-1',
    requestId: 'request-member-grant-0001',
    note: '會員活動',
    points: { cardId: 'PC-1', amount: 3 },
    serviceTime: { minutes: 75 }
  };
  const first = context.handleMemberGrantAdd_(identity, admin, request);
  const replay = context.handleMemberGrantAdd_(identity, admin, request);
  assert.equal(rows.PointEntries.length, 1);
  assert.equal(rows.ServiceTimeEntries.length, 1);
  assert.equal(rows.PointBalances[0].stamps, '3');
  assert.equal(first.stamps.stamps, 3);
  assert.equal(first.serviceTime.minutes, 75);
  assert.equal(first.member.serviceMinutesTotal, 75);
  assert.equal(replay.member.serviceMinutesTotal, 75);
  assert.deepEqual(audit.map((record) => record.action), ['STAMP_ADD', 'SERVICE_TIME_ADD']);

  context.handleMemberGrantAdd_(identity, admin, {
    lineUserId: 'U-1',
    requestId: 'request-member-grant-0002',
    points: { cardId: 'PC-1', amount: 2 }
  });
  assert.equal(rows.PointEntries.length, 2);
  assert.equal(rows.ServiceTimeEntries.length, 1);
  assert.equal(rows.PointBalances[0].stamps, '5');
  const serviceOnly = context.handleMemberGrantAdd_(identity, admin, {
    lineUserId: 'U-1',
    requestId: 'request-member-grant-0003',
    serviceTime: { minutes: 30 }
  });
  assert.equal(rows.PointEntries.length, 2);
  assert.equal(rows.ServiceTimeEntries.length, 2);
  assert.equal(serviceOnly.member.serviceMinutesTotal, 105);
  assert.throws(
    () => context.handleMemberGrantAdd_(identity, admin, { lineUserId: 'U-1', requestId: 'request-member-grant-0004' }),
    (error) => error instanceof TestApiError && error.code === 'INVALID_MEMBER_GRANT'
  );
});
