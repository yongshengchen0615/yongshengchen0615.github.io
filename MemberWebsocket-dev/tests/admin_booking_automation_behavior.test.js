const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../admin/e2e-control.js'), 'utf8');
const startedAt = '2026-09-22T12:00:00.000Z';
const account = { memberId: 'test-member', memberCode: 'TEST-001' };
const booking = (id, fields = {}) => ({
  bookingId: id, memberCode: account.memberCode, memberNote: 'QA HUMAN E2E GROUP run',
  createdAt: startedAt, updatedAt: startedAt, status: 'pending', ...fields
});
const participant = () => ({
  index: 1, account,
  bookingResult: { account, results: [
    { key: 'BOOKING_HUMAN_GROUP', actual: { bookingId: 'complete' } },
    { key: 'BOOKING_HUMAN_LIFECYCLE', actual: { bookingId: 'cancel' } }
  ] }
});

// Execute the real runner with IO substituted; no live accounts or database writes.
function harness(bookings = [], extra = {}) {
  const calls = [];
  const window = { addEventListener() {}, setTimeout: (callback) => setTimeout(callback, 0) };
  const context = vm.createContext({ window, document: {}, performance, CSS: { escape: (x) => x }, ...extra });
  const expose = `
    window.qa = { state, pairedBookingCandidates, pairedAdminBookingFollowupCase, mutateDetectedBooking, runAdmin, runPaired };
    window.qa.install = (io) => {
      adminBookingBootstrapSnapshot = io.bootstrap;
      verifyDetectedBookingInCoreFilter = io.core;
      verifyDetectedBookingInCancellationFilter = io.cancellation;
      setDetectedBookingStatus = io.status;
      mutateDetectedBooking = io.modify;
      cancelDetectedBooking = io.cancel;
      waitAdminBookingSnapshot = io.snapshot;
    };
    window.qa.mutationIO = (io) => {
      openAdminBookingQueue = async () => {};
      waitAdminBookingSnapshot = io.snapshot;
      adminSession = async () => ({ idToken: 'test-stub' });
      postFunction = io.details;
    };
    window.qa.replacePaired = (run) => { runPaired = run; };
    window.qa.preflightIO = (fixture) => {
      selectedParticipantCount = () => 1;
      openClientWindows = () => [];
      adminSession = async () => ({});
      postPublicTestMode = async () => ({ maintenanceEnabled: false });
      prepareComplexE2EFixtures = fixture;
      recordRun = async () => null;
    };
  `;
  vm.runInContext(source.replace('  window.MemberAdminE2EControl =', expose + '\n  window.MemberAdminE2EControl ='), context);
  const qa = window.qa;
  qa.state.runStartedAt = startedAt;
  const io = {
    bootstrap: async () => ({ bookings }),
    core: async (id, filter) => ({ ok: true, bookingId: id, filter }),
    cancellation: async (id, mode) => ({ ok: true, bookingId: id, mode }),
    status: async (id, label, note, status) => {
      calls.push(status);
      return { ok: true, bookingId: id, actualStatus: status };
    },
    modify: async () => { calls.push('modify'); return { ok: true, persistedQuantity: 2 }; },
    cancel: async () => { calls.push('cancel'); return { ok: true, status: 'cancelled' }; },
    snapshot: async (id) => booking(id, { status: 'confirmed' })
  };
  qa.install(io);
  return { qa, calls, io, context, window };
}

const cancellation = () => booking('cancel', { cancellationRequestedAt: startedAt });

test('confirms, modifies, completes and cancels with independent observable results', async () => {
  const { qa, calls } = harness([booking('complete'), cancellation()]);
  const result = await qa.pairedAdminBookingFollowupCase(participant());
  assert.equal(result.status, 'passed');
  assert.deepEqual(calls, ['confirmed', 'modify', 'completed', 'cancel']);
  assert.equal(qa.state.results.length, 4);
  assert.ok(qa.state.results.every((row) => row.status === 'passed' && row.durationMs >= 0));
  assert.deepEqual(Object.keys(result.actual.statusTabs).sort(), [
    'pending', 'confirmed', 'completed', 'allCompleted', 'cancellationRequest', 'cancelled', 'allCancelled'
  ].sort());
});

test('missing cancellation request does not block confirm, modify or complete', async () => {
  const { qa, calls } = harness([booking('complete')]);
  const result = await qa.pairedAdminBookingFollowupCase(participant());
  assert.deepEqual(calls, ['confirmed', 'modify', 'completed']);
  assert.equal(result.status, 'failed');
  assert.equal(qa.state.results.find((row) => row.key.endsWith('_CANCEL')).status, 'failed');
  assert.equal(qa.state.results.find((row) => row.key.endsWith('_COMPLETE')).status, 'passed');
});

test('missing completion booking still permits independent cancellation review', async () => {
  const { qa, calls } = harness([cancellation()]);
  const result = await qa.pairedAdminBookingFollowupCase(participant());
  assert.deepEqual(calls, ['cancel']);
  assert.equal(result.status, 'failed');
  assert.equal(qa.state.results.find((row) => row.key.endsWith('_CANCEL')).status, 'passed');
});

test('a modification error blocks completion, preserves confirmation and still tests cancellation', async () => {
  const { qa, calls, io } = harness([booking('complete'), cancellation()]);
  io.modify = async () => { calls.push('modify'); throw new Error('conflict'); };
  qa.install(io);
  const result = await qa.pairedAdminBookingFollowupCase(participant());
  assert.deepEqual(calls, ['confirmed', 'modify', 'cancel']);
  assert.equal(result.actual.confirmed.ok, true);
  assert.equal(qa.state.results.find((row) => row.key.endsWith('_MODIFY')).actual.message, 'conflict');
  assert.equal(qa.state.results.find((row) => row.key.endsWith('_COMPLETE')).actual.dependencyFailed, 'CONFIRM_OR_MODIFY');
});

test('a failed confirmation must not modify or complete the booking', async () => {
  const { qa, calls, io } = harness([booking('complete'), cancellation()]);
  io.status = async () => { calls.push('confirm-failed'); return { ok: false }; };
  qa.install(io);
  await qa.pairedAdminBookingFollowupCase(participant());
  assert.deepEqual(calls, ['confirm-failed', 'cancel']);
});

test('stop after confirmation prevents all subsequent writes', async () => {
  const { qa, calls, io } = harness([booking('complete'), cancellation()]);
  io.status = async () => { calls.push('confirmed'); qa.state.cancelled = true; return { ok: true }; };
  qa.install(io);
  const result = await qa.pairedAdminBookingFollowupCase(participant());
  assert.equal(result.status, 'skipped');
  assert.deepEqual(calls, ['confirmed']);
});

test('only exact user-run booking IDs belonging to the same test member are selected', () => {
  const { qa } = harness();
  const data = { bookings: [
    booking('complete'), booking('old-run'), booking('cancel', { memberCode: 'REAL-001' }),
    booking('cancel', { memberNote: 'ordinary booking' }),
    booking('cancel', { createdAt: '2026-09-21T00:00:00Z' })
  ] };
  assert.equal(qa.pairedBookingCandidates(data, participant()).length, 1);
  assert.equal(qa.pairedBookingCandidates(data, { ...participant(), bookingResult: { account: { memberId: 'other' } } }).length, 0);
  assert.equal(qa.pairedBookingCandidates(data, { ...participant(), account: {} }).length, 0);
});

test('admin full E2E opens a booking client and includes the existing admin suite', async () => {
  const { qa } = harness();
  let options;
  qa.replacePaired(async (value) => { options = value; });
  await qa.runAdmin('full');
  assert.equal(options.bookingOnly, true);
  assert.equal(options.includeAdminSuite, true);
});

test('maintenance must be enabled before any fixtures or accounts are created', async () => {
  const { qa } = harness();
  let created = false;
  qa.preflightIO(async () => { created = true; });
  const result = await qa.runPaired({ bookingOnly: true });
  assert.equal(result.error.code, 'TEST_MAINTENANCE_REQUIRED');
  assert.equal(created, false);
});

for (const grouped of [false, true]) {
  test(`modification verifies stored quantities, not just timestamps (${grouped ? 'group' : 'single'})`, async () => {
    let closed = false;
    let persistedQuantity = 1;
    const quantity = { value: '1', dispatchEvent() {} };
    const checked = { value: 'service', closest: () => ({ querySelector: () => quantity }) };
    const form = { querySelector: (selector) => {
      if (selector.includes(':checked')) return checked;
      if (selector === '[data-participant-item-rows]') return grouped ? {} : null;
      if (selector === 'button[type="submit"]') return { click: () => { closed = true; } };
      return null;
    } };
    const modal = { classList: { contains: () => closed }, querySelector: () => form };
    const card = { querySelectorAll: () => [{ textContent: grouped ? '修改此位項目' : '修改服務項目', click() {} }] };
    const document = { querySelector: () => card, getElementById: () => modal };
    const { qa } = harness([], { document, Event: class {} });
    qa.mutationIO({
      snapshot: async () => booking('complete', { updatedAt: 'changed', items: [{ serviceId: 'service', quantity: persistedQuantity }] }),
      details: async () => ({ bookingGroups: { complete: { participants: [{ items: [{ serviceId: 'service', quantity: persistedQuantity }] }] } } })
    });
    const failed = await qa.mutateDetectedBooking(booking('complete'));
    assert.equal(failed.updatedAtChanged, true);
    assert.equal(failed.ok, false);
    closed = false;
    quantity.value = '1';
    persistedQuantity = 2;
    const passed = await qa.mutateDetectedBooking(booking('complete'));
    assert.equal(passed.persistedQuantity, 2);
    assert.equal(passed.ok, true);
  });
}
