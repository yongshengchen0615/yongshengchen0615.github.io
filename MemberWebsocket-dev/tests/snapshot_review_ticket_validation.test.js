const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');

const source = fs.readFileSync(path.join(__dirname, '../supabase/functions/booking-receipt-api/index.ts'), 'utf8');
const validatorCode = stripTypeScriptTypes(source.slice(
  source.indexOf('async function validateAccessibleBenefits('),
  source.indexOf('async function registrationOptions('),
));

function fixture({ kind = 'points', allowed = [], matchMode = 'any', canonicalError = null, missingReward = false } = {}) {
  const memberId = '10000000-0000-4000-8000-000000000001';
  const ticketId = kind === 'points' ? 'POINT-OLDER-ISSUED' : 'CLAIM-OLDER-ISSUED';
  const rewardId = '20000000-0000-4000-8000-000000000001';
  const eventId = '30000000-0000-4000-8000-000000000001';
  const accessed = [], calls = [];
  const rows = {
    point_tickets: kind === 'points' ? [{ ticket_id: ticketId, reward_id: rewardId }] : [],
    event_ticket_claims: kind === 'event' ? [{ claim_id: ticketId, event_ticket_id: eventId }] : [],
    point_card_rewards: kind === 'points' && !missingReward
      ? [{ id: rewardId, required_service_ids: allowed, required_service_match_mode: matchMode }] : [],
    event_tickets: kind === 'event'
      ? [{ id: eventId, required_service_ids: allowed, required_service_match_mode: matchMode }] : [],
  };
  const db = {
    from(table) {
      accessed.push(table);
      const q = {
        select() { return q; },
        eq() { return q; },
        maybeSingle: async () => ({ data: { member_id: memberId, status: 'awaiting_review' }, error: null }),
        in: async () => ({ data: rows[table] || [], error: null }),
      };
      return q;
    },
    async rpc(name, params) {
      calls.push({ name, params });
      return canonicalError ? { data: null, error: { message: canonicalError } }
        : { data: [{ kind, id: ticketId }], error: null };
    },
  };
  class ApiError extends Error {
    constructor(status, code, message) { super(message); this.status = status; this.code = code; }
  }
  const ctx = vm.createContext({
    normalizeAccessibleBenefits: (v) => v,
    asText: (v) => String(v || ''),
    dbError: (err) => new ApiError(409, 'BOOKING_BENEFIT_NOT_AVAILABLE', String(err.message || '')),
    ApiError, String, Set, Map, Array, Promise,
  });
  vm.runInContext(validatorCode, ctx);
  const review = (serviceIds = []) => ctx.validateAccessibleBenefits(
    db, 'RECEIPT-001', '', serviceIds.map(serviceId => ({ serviceId })),
    [{ kind, id: ticketId }],
  );
  return { review, accessed, calls, ticketId, memberId };
}

test('admin snapshot review uses exact issued point ticket, not a truncated latest-offer catalog', async () => {
  const f = fixture();
  const result = await f.review();
  assert.equal(result.length, 1);
  assert.equal(result[0].id, f.ticketId);
  assert.deepEqual(f.calls.map(call => call.name), ['validate_snapshot_ticket_selection']);
  assert.equal(f.calls[0].params.p_booking, null);
  assert.equal(f.calls[0].params.p_member, f.memberId);
  assert.deepEqual(f.accessed, ['booking_receipts', 'point_tickets', 'point_card_rewards']);
  assert.equal(f.accessed.includes('point_balances'), false);
});

test('admin snapshot review validates an exact older event claim without relying on latest event preview', async () => {
  const f = fixture({ kind: 'event', allowed: ['service-A'] });
  const result = await f.review(['service-A']);
  assert.equal(result[0].id, f.ticketId);
  assert.deepEqual(f.accessed, ['booking_receipts', 'event_ticket_claims', 'event_tickets']);
});

test('admin snapshot review keeps service restrictions for issued tickets', async () => {
  const f = fixture({ allowed: ['service-A', 'service-B'], matchMode: 'all' });
  await assert.rejects(f.review(['service-A']), (err) => err.code === 'BOOKING_BENEFIT_SERVICE_REQUIRED');
  assert.equal((await f.review(['service-A', 'service-B'])).length, 1);
});

test('admin snapshot review cannot bypass canonical ownership, expiry or availability validation', async () => {
  const f = fixture({ canonicalError: 'BOOKING_BENEFIT_NOT_AVAILABLE' });
  await assert.rejects(f.review(), (err) => err.code === 'BOOKING_BENEFIT_NOT_AVAILABLE');
  assert.deepEqual(f.accessed, ['booking_receipts']);
});

test('historically removed point reward does not invalidate a still-valid issued ticket', async () => {
  const f = fixture({ missingReward: true });
  assert.equal((await f.review()).length, 1);
});
