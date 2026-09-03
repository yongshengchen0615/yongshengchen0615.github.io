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
    ServiceTimeEntries: []
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
  vm.runInContext(read('gas/MemberService.gs'), context, { filename: 'gas/MemberService.gs' });
  return { context, rows, audit, TestApiError };
}

test('first-visit profile requires a real birthday and normalized phone without returning either field', () => {
  const { context, rows, audit, TestApiError } = loadMemberService();
  const identity = { lineUserId: 'U-1', displayName: '測試會員' };
  const result = context.handleMemberProfileSave_(identity, { birthday: '1990-02-28', phone: '0912-345-678' });
  assert.equal(rows.Members[0].birthday, '1990-02-28');
  assert.equal(rows.Members[0].phone, '0912345678');
  assert.equal(result.profile.profileComplete, true);
  assert.equal(result.profile.birthday, undefined);
  assert.equal(result.profile.phone, undefined);
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
