'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

function loadEventTicketService() {
  class TestApiError extends Error {
    constructor(status, code, message, details) { super(message); this.status = status; this.code = code; this.details = details || null; }
  }
  const rows = {
    Members: [{ line_user_id: 'U-1', display_name: '測試會員', status: 'active' }, { line_user_id: 'U-2', display_name: '另一位會員', status: 'active' }],
    EventTickets: [{ event_ticket_id: 'ET-1', title: '週年禮', ticket_type: 'coupon', description: '會員限定禮物', usage_method: '出示本券', usage_instructions: '限活動期間使用', lottery_prizes_json: '[]', status: 'active', starts_on: '', ends_on: '', quota: '1', accent: '#DF6B4D', created_at: '2026-09-03T00:00:00.000Z', updated_at: '2026-09-03T00:00:00.000Z' }],
    EventTicketClaims: [],
    AuditLogs: []
  };
  let uuid = 0;
  const context = {
    ApiError: TestApiError,
    Utilities: {
      getUuid: () => `00000000-0000-0000-0000-0000000000${String(uuid++).padStart(2, '0')}`,
      formatDate: () => '2026-09-04'
    },
    withDataLock_: (callback) => callback(),
    nowIso_: () => '2026-09-04T00:00:00.000Z',
    readRecords_: (sheetName) => rows[sheetName] || [],
    findRecordWithRow_: (sheetName, keyField, keyValue) => {
      const index = (rows[sheetName] || []).findIndex((record) => String(record[keyField] || '') === String(keyValue || ''));
      return index < 0 ? null : { rowNumber: index + 2, record: rows[sheetName][index] };
    },
    appendRecord_: (sheetName, record) => { rows[sheetName].push(record); },
    updateRecordAtRow_: (sheetName, rowNumber, record) => { rows[sheetName][rowNumber - 2] = record; },
    appendAuditRecord_: (record) => { rows.AuditLogs.push(record); }
  };
  vm.createContext(context);
  vm.runInContext(read('gas/EventTicketService.gs'), context, { filename: 'gas/EventTicketService.gs' });
  return { context, rows, TestApiError };
}

test('event ticket settings preserve zero-percent lottery prizes and validate the full probability', () => {
  const { context, TestApiError } = loadEventTicketService();
  const normalized = context.normalizeEventTicketPrizes_([
    { prizeTitle: '不會抽中', prizeDescription: '', winRate: 0 },
    { prizeTitle: '會員禮', prizeDescription: '限定禮物', winRate: 100 }
  ]);
  assert.equal(normalized.length, 2);
  assert.equal(normalized[0].win_rate, '0');
  assert.equal(normalized[1].win_rate, '100');
  assert.equal(context.eventTicketForClient_(context.readRecords_('EventTickets')[0], true, 0).availability, 'open');
  assert.throws(() => context.normalizeEventTicketPrizes_([{ prizeTitle: '錯誤', prizeDescription: '', winRate: 50 }]), (error) => error instanceof TestApiError && error.code === 'INVALID_EVENT_TICKET');
});

test('event ticket claim is owned, one-per-member, quota-limited, and snapshots content', () => {
  const { context, rows, TestApiError } = loadEventTicketService();
  const first = context.handleEventTicketClaim_({ lineUserId: 'U-1' }, { eventTicketId: 'ET-1' });
  assert.equal(first.claimed, true);
  assert.equal(rows.EventTicketClaims.length, 1);
  assert.equal(rows.EventTicketClaims[0].ticket_description, '會員限定禮物');

  const replay = context.handleEventTicketClaim_({ lineUserId: 'U-1' }, { eventTicketId: 'ET-1' });
  assert.equal(replay.alreadyClaimed, true);
  assert.equal(rows.EventTicketClaims.length, 1);
  assert.throws(() => context.handleEventTicketClaim_({ lineUserId: 'U-2' }, { eventTicketId: 'ET-1' }), (error) => error instanceof TestApiError && error.code === 'EVENT_TICKET_SOLD_OUT');
});

test('event ticket redemption checks ownership, expiry, and one-time use without point deductions', () => {
  const { context, rows, TestApiError } = loadEventTicketService();
  const claim = context.handleEventTicketClaim_({ lineUserId: 'U-1' }, { eventTicketId: 'ET-1' });
  assert.throws(() => context.handleEventTicketRedeem_({ lineUserId: 'U-2' }, { claimId: claim.ticket.claimId }), (error) => error instanceof TestApiError && error.code === 'EVENT_TICKET_CLAIM_NOT_FOUND');
  const redeemed = context.handleEventTicketRedeem_({ lineUserId: 'U-1' }, { claimId: claim.ticket.claimId });
  assert.equal(redeemed.redeemed, true);
  assert.equal(rows.EventTicketClaims[0].status, 'used');
  assert.throws(() => context.handleEventTicketRedeem_({ lineUserId: 'U-1' }, { claimId: claim.ticket.claimId }), (error) => error instanceof TestApiError && error.code === 'EVENT_TICKET_ALREADY_USED');

  rows.EventTickets[0].ends_on = '2026-09-03';
  const expiredClaim = { ...rows.EventTicketClaims[0], claim_id: 'EC-EXPIRED', status: 'available', used_at: '' };
  rows.EventTicketClaims.push(expiredClaim);
  assert.throws(() => context.handleEventTicketRedeem_({ lineUserId: 'U-1' }, { claimId: 'EC-EXPIRED' }), (error) => error instanceof TestApiError && error.code === 'EVENT_TICKET_ENDED');
});

test('event ticket browser and admin contracts are present', () => {
  const eventHtml = read('event/index.html');
  const eventApp = read('event/app.js');
  const adminHtml = read('admin/index.html');
  const adminApp = read('admin/app.js');
  const storage = read('gas/Storage.gs');
  const code = read('gas/Code.gs');
  assert.match(eventHtml, /static\.line-scdn\.net\/liff/);
  assert.match(eventHtml, /id="ticketModalAction"/);
  assert.match(eventApp, /signIn\(state\.config, 'event'\)/);
  assert.match(eventApp, /user\.event\.ticket\.claim/);
  assert.match(eventApp, /user\.event\.ticket\.redeem/);
  assert.match(eventApp, /setProcessing\(true\)/);
  assert.doesNotMatch(eventApp, /innerHTML/);
  assert.match(adminHtml, /id="eventsPanel"/);
  assert.match(adminHtml, /id="eventTicketForm"/);
  assert.match(adminApp, /admin\.event-tickets\.save/);
  assert.match(storage, /EventTickets:/);
  assert.match(storage, /EventTicketClaims:/);
  assert.match(code, /user\.event\.bootstrap/);
  assert.match(code, /user\.event\.ticket\.claim/);
  assert.match(code, /user\.event\.ticket\.redeem/);
  assert.match(code, /admin\.event-tickets\.save/);
});
