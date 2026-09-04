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
      getUuid: () => `${String(uuid++).padStart(8, '0')}-0000-0000-0000-000000000000`,
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
    deleteRecordsWhere_: (sheetName, predicate) => { const before = rows[sheetName].length; rows[sheetName] = rows[sheetName].filter((record) => !predicate(record)); return before - rows[sheetName].length; },
    appendAuditRecord_: (record) => { rows.AuditLogs.push(record); },
    serviceMinutesTotalForMember_: (lineUserId) => lineUserId === 'U-2' ? 1800 : 0,
    membershipTierForServiceMinutes_: (minutes) => Number(minutes) >= 1800 ? { tierKey: 'gold', label: '金級會員' } : { tierKey: 'general', label: '一般會員' }
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

test('event tickets stay visible to every member while tier eligibility blocks claim and redemption', () => {
  const { context, rows, TestApiError } = loadEventTicketService();
  rows.EventTickets[0].allowed_tier_keys = JSON.stringify(['gold', 'platinum']);
  rows.EventTickets.push({ ...rows.EventTickets[0], event_ticket_id: 'ET-2', title: '銀級限定禮', allowed_tier_keys: JSON.stringify(['silver']) });
  const generalOffers = context.visibleEventTicketOffersForMember_('U-1', context.readEventTicketSnapshot_(), 'general');
  assert.equal(generalOffers.length, 2);
  assert.equal(generalOffers.every((offer) => offer.tierEligible === false && offer.canClaim === false && offer.canUse === false), true);
  assert.throws(() => context.handleEventTicketClaim_({ lineUserId: 'U-1' }, { eventTicketId: 'ET-1' }), (error) => error instanceof TestApiError && error.code === 'EVENT_TICKET_TIER_INELIGIBLE');

  const goldOffer = context.visibleEventTicketOffersForMember_('U-2', context.readEventTicketSnapshot_(), 'gold').find((offer) => offer.ticket.eventTicketId === 'ET-1');
  assert.equal(goldOffer.tierEligible, true);
  assert.equal(goldOffer.canClaim, true);
  assert.deepEqual(Array.from(goldOffer.ticket.allowedTierLabels), ['金級會員', '白金會員']);
  const claim = context.handleEventTicketClaim_({ lineUserId: 'U-2' }, { eventTicketId: 'ET-1' });
  assert.equal(claim.claimed, true);
  context.serviceMinutesTotalForMember_ = () => 0;
  const downgradedOffer = context.visibleEventTicketOffersForMember_('U-2', context.readEventTicketSnapshot_(), 'general').find((offer) => offer.ticket.eventTicketId === 'ET-1');
  assert.equal(downgradedOffer.tierEligible, false);
  assert.equal(downgradedOffer.canUse, false);
  assert.throws(() => context.handleEventTicketClaim_({ lineUserId: 'U-2' }, { eventTicketId: 'ET-1' }), (error) => error instanceof TestApiError && error.code === 'EVENT_TICKET_TIER_INELIGIBLE');
  assert.throws(() => context.handleEventTicketRedeem_({ lineUserId: 'U-2' }, { claimId: claim.ticket.claimId }), (error) => error instanceof TestApiError && error.code === 'EVENT_TICKET_TIER_INELIGIBLE');
});

test('each event ticket save persists its own allowed membership tiers', () => {
  const { context, rows } = loadEventTicketService();
  const save = (title, allowedTierKeys) => context.handleEventTicketSave_({ lineUserId: 'ADMIN-1' }, { role: 'admin' }, {
    eventTicket: { title, ticketType: 'coupon', description: '會員限定禮物', usageMethod: '出示本券', usageInstructions: '限活動期間使用', status: 'active', startsOn: '', endsOn: '', quota: 0, allowedTierKeys, accent: '#df6b4d', prizes: [] }
  }).eventTicket;

  const silverTicket = save('銀級限定', ['silver']);
  const goldTicket = save('金級限定', ['gold', 'platinum']);
  assert.deepEqual(Array.from(silverTicket.allowedTierKeys), ['silver']);
  assert.deepEqual(Array.from(goldTicket.allowedTierKeys), ['gold', 'platinum']);
  assert.equal(rows.EventTickets.find((ticket) => ticket.title === '銀級限定').allowed_tier_keys, '["silver"]');
  assert.equal(rows.EventTickets.find((ticket) => ticket.title === '金級限定').allowed_tier_keys, '["gold","platinum"]');
  assert.equal(context.visibleEventTicketOffersForMember_('U-1', context.readEventTicketSnapshot_(), 'silver').some((offer) => offer.ticket.eventTicketId === silverTicket.eventTicketId), true);
  const silverTicketForGold = context.visibleEventTicketOffersForMember_('U-1', context.readEventTicketSnapshot_(), 'gold').find((offer) => offer.ticket.eventTicketId === silverTicket.eventTicketId);
  assert.equal(silverTicketForGold.tierEligible, false);
  assert.equal(silverTicketForGold.canClaim, false);
  assert.equal(context.visibleEventTicketOffersForMember_('U-2', context.readEventTicketSnapshot_(), 'gold').some((offer) => offer.ticket.eventTicketId === goldTicket.eventTicketId), true);
});

test('only missing legacy tier settings default to all membership tiers', () => {
  const { context, rows } = loadEventTicketService();
  assert.deepEqual(Array.from(context.eventTicketAllowedTierKeys_(rows.EventTickets[0])), ['general', 'silver', 'gold', 'platinum']);

  rows.EventTickets[0].allowed_tier_keys = 'not-json';
  assert.deepEqual(Array.from(context.eventTicketAllowedTierKeys_(rows.EventTickets[0])), []);
  assert.equal(context.eventTicketAllowsTier_(rows.EventTickets[0], 'gold'), false);
});

test('legacy update requests retain an existing ticket tier restriction', () => {
  const { context, rows } = loadEventTicketService();
  rows.EventTickets[0].allowed_tier_keys = JSON.stringify(['gold', 'platinum']);
  const result = context.handleEventTicketSave_({ lineUserId: 'ADMIN-1' }, { role: 'admin' }, {
    expectedUpdatedAt: '2026-09-03T00:00:00.000Z',
    eventTicket: { eventTicketId: 'ET-1', title: '週年禮更新', ticketType: 'coupon', description: '會員限定禮物', usageMethod: '出示本券', usageInstructions: '限活動期間使用', status: 'active', startsOn: '', endsOn: '', quota: 1, accent: '#df6b4d', prizes: [] }
  });

  assert.deepEqual(Array.from(result.eventTicket.allowedTierKeys), ['gold', 'platinum']);
  assert.equal(rows.EventTickets[0].allowed_tier_keys, '["gold","platinum"]');
});

test('used event tickets move to member history and retain their snapshot after definition removal', () => {
  const { context, rows } = loadEventTicketService();
  const claim = context.handleEventTicketClaim_({ lineUserId: 'U-1' }, { eventTicketId: 'ET-1' });
  context.handleEventTicketRedeem_({ lineUserId: 'U-1' }, { claimId: claim.ticket.claimId });

  const beforeDelete = context.readEventTicketSnapshot_();
  assert.equal(context.visibleEventTicketOffersForMember_('U-1', beforeDelete, 'general').length, 0);
  const beforeDeleteHistory = context.usedEventTicketHistoryForMember_('U-1', beforeDelete);
  assert.equal(beforeDeleteHistory.length, 1);
  assert.equal(beforeDeleteHistory[0].ticket.title, '週年禮');
  assert.equal(beforeDeleteHistory[0].claim.status, 'used');

  context.handleEventTicketDelete_({ lineUserId: 'ADMIN-1' }, { role: 'admin' }, { eventTicketId: 'ET-1', expectedUpdatedAt: '2026-09-03T00:00:00.000Z' });
  const afterDeleteHistory = context.usedEventTicketHistoryForMember_('U-1', context.readEventTicketSnapshot_());
  assert.equal(afterDeleteHistory.length, 1);
  assert.equal(afterDeleteHistory[0].ticket.title, '週年禮');
  assert.equal(afterDeleteHistory[0].definitionRemoved, true);
  assert.equal(rows.EventTicketClaims[0].status, 'used');
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

test('deleting an event ticket removes its definition but retains claim and audit history', () => {
  const { context, rows, TestApiError } = loadEventTicketService();
  const claim = context.handleEventTicketClaim_({ lineUserId: 'U-1' }, { eventTicketId: 'ET-1' });
  const result = context.handleEventTicketDelete_({ lineUserId: 'ADMIN-1' }, { role: 'admin' }, { eventTicketId: 'ET-1', expectedUpdatedAt: '2026-09-03T00:00:00.000Z' });
  assert.equal(result.deleted, true);
  assert.equal(result.preservedClaimCount, 1);
  assert.equal(rows.EventTickets.length, 0);
  assert.equal(rows.EventTicketClaims.length, 1);
  assert.equal(rows.AuditLogs.at(-1).action, 'EVENT_TICKET_DELETE');
  assert.throws(() => context.handleEventTicketRedeem_({ lineUserId: 'U-1' }, { claimId: claim.ticket.claimId }), (error) => error instanceof TestApiError && error.code === 'EVENT_TICKET_REMOVED');
});

test('event ticket browser and admin contracts are present', () => {
  const eventHtml = read('event/index.html');
  const eventApp = read('event/app.js');
  const adminHtml = read('admin/index.html');
  const adminApp = read('admin/app.js');
  const eventService = read('gas/EventTicketService.gs');
  const storage = read('gas/Storage.gs');
  const code = read('gas/Code.gs');
  assert.match(eventHtml, /static\.line-scdn\.net\/liff/);
  assert.match(adminHtml, /app\.js\?v=event-tier-save-20260904/);
  assert.match(eventHtml, /id="ticketModalAction"/);
  assert.match(eventHtml, /id="memberTier"/);
  assert.match(eventHtml, /id="usedTicketHistory"/);
  assert.match(eventApp, /signIn\(state\.config, 'event'\)/);
  assert.match(eventApp, /user\.event\.ticket\.claim/);
  assert.match(eventApp, /user\.event\.ticket\.redeem/);
  assert.match(eventApp, /setProcessing\(true\)/);
  assert.doesNotMatch(eventApp, /innerHTML/);
  assert.match(adminHtml, /id="eventsPanel"/);
  assert.match(adminHtml, /id="eventTicketForm"/);
  assert.match(adminHtml, /id="eventTicketAllowedTiers"/);
  assert.match(adminHtml, /id="eventTicketTierSummary"/);
  assert.match(adminHtml, /form="eventTicketForm" name="eventTicketAllowedTierKey"/);
  assert.match(adminHtml, /id="deleteEventTicketButton"/);
  assert.match(adminApp, /admin\.event-tickets\.save/);
  assert.match(adminApp, /admin\.event-tickets\.delete/);
  assert.match(adminApp, /#eventTicketAllowedTiers input\[name="eventTicketAllowedTierKey"\]:checked/);
  assert.doesNotMatch(adminApp, /new FormData\(els\.eventTicketForm\)/);
  assert.match(adminApp, /insertBefore\(eventTicketTierAccess/);
  assert.match(adminApp, /updateEventTicketTierSummary/);
  assert.match(eventApp, /tierEligible/);
  assert.match(eventApp, /els\.memberTier\.textContent/);
  assert.match(eventApp, /目前會員等級無法領取或使用/);
  assert.match(storage, /EventTickets:/);
  assert.match(storage, /allowed_tier_keys/);
  assert.match(storage, /EventTicketClaims:/);
  assert.match(eventApp, /usedTickets/);
  assert.match(eventService, /usedEventTicketHistoryForMember_/);
  assert.match(code, /user\.event\.bootstrap/);
  assert.match(code, /user\.event\.ticket\.claim/);
  assert.match(code, /user\.event\.ticket\.redeem/);
  assert.match(code, /admin\.event-tickets\.save/);
  assert.match(code, /admin\.event-tickets\.delete/);
});
