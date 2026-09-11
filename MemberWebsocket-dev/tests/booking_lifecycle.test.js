const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const source = fs.readFileSync(require('node:path').join(__dirname, '../supabase/functions/booking-api/index.ts'), 'utf8').replace(/^import .*\n/, '');
const context = vm.createContext({ Deno: { serve() {}, env: { get() { return ''; } } }, Date, Intl, Set, Map, console, crypto: require('node:crypto').webcrypto, TextEncoder });
vm.runInContext(stripTypeScriptTypes(source), context);
const id = '10000000-0000-4000-8000-000000000001';
const version = '2026-09-11T00:00:00.000Z';
const identity = { lineUserId: 'fixture-user', displayName: 'Fixture' };
function db(booking, admin = { role: 'admin', status: 'active', display_name: 'Fixture' }) {
  const writes = [];
  return { writes, from(table) {
    const result = { data: table === 'bookings' ? booking : table === 'admins' ? admin : table === 'members' ? { id, membership_status: 'active', status: 'active' } : [], error: null };
    const q = { then(resolve) { return Promise.resolve(result).then(resolve); }, update(patch) { writes.push({ table, patch }); result.data = { ...booking, ...patch }; return q; }, insert() { return q; } };
    for (const key of ['select', 'eq', 'in', 'order', 'limit', 'gte']) q[key] = () => q;
    q.single = q.maybeSingle = async () => result;
    return q;
  } };
}
const booking = { id, status: 'confirmed', updated_at: version, booking_date: '2020-01-01', start_time: '09:00:00', end_time: '10:00:00' };
test('confirmed finished appointment can be completed with actor/time attribution', async () => {
  const client = db(booking);
  const result = await context.adminStatusUpdate(client, identity, { bookingId: id, status: 'completed', expectedUpdatedAt: version });
  assert.equal(result.booking.status, 'completed');
  assert.equal(client.writes[0].patch.completed_by, identity.lineUserId);
  assert.ok(result.booking.completedAt);
});
test('pending, cancelled and completed appointments cannot be completed', async () => {
  for (const status of ['pending', 'cancelled', 'completed']) {
    const client = db({ ...booking, status });
    await assert.rejects(context.adminStatusUpdate(client, identity, { bookingId: id, status: 'completed', expectedUpdatedAt: version }), { code: 'INVALID_BOOKING_TRANSITION' });
    assert.equal(client.writes.length, 0);
  }
});
test('future appointment cannot be marked complete', async () => {
  await assert.rejects(context.adminStatusUpdate(db({ ...booking, booking_date: '2099-01-01' }), identity, { bookingId: id, status: 'completed', expectedUpdatedAt: version }), { code: 'BOOKING_NOT_FINISHED' });
});
test('stale confirmation cannot confirm a rescheduled pending appointment', async () => {
  const client = db({ ...booking, status: 'pending', updated_at: '2026-09-11T01:00:00.000Z' });
  await assert.rejects(context.adminStatusUpdate(client, identity, { bookingId: id, status: 'confirmed', expectedUpdatedAt: version }), { code: 'BOOKING_CONFLICT' });
  assert.equal(client.writes.length, 0);
});
test('member cannot reach admin completion action', async () => {
  await assert.rejects(context.route(db(booking), identity, 'member', 'admin.booking.status.update', {}), { code: 'ACTION_NOT_FOUND' });
});
test('inactive administrator cannot reach completion action', async () => {
  const client = db(booking, { role: 'admin', status: 'pending' });
  await assert.rejects(context.route(client, identity, 'admin', 'admin.booking.status.update', {}), { code: 'ADMIN_PENDING' });
  assert.equal(client.writes.length, 0);
});
test('missing login token rejected', async () => {
  await assert.rejects(context.verifyLineIdToken('', 'member'), { code: 'AUTH_REQUIRED' });
});
test('edit rejects missing version before database mutation', async () => {
  const client = db(booking);
  await assert.rejects(context.userUpdate(client, identity, { id }, { bookingId: id }), { code: 'INVALID_INPUT' });
  assert.equal(client.writes.length, 0);
});
