'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const surfaces = ['member', 'points', 'event', 'calendar', 'admin'];
const ok = (data = {}) => ({ ok: true, status: 200, text: async () => JSON.stringify({ ok: true, data }) });
const config = { gasWebAppUrl: 'https://script.google.com/macros/s/test/exec', memberLiffId: 'member', pointsLiffId: 'points', adminLiffId: 'admin', eventLiffId: 'event', calendarLiffId: 'calendar' };
function client(surface, fetch, extra = {}) {
  const context = { window: { setTimeout, clearTimeout, ...extra }, fetch, URL, AbortController };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, surface, 'common.js'), 'utf8'), context);
  return { api: context.window.MemberSystem, context };
}
for (const surface of surfaces) {
  test(`${surface}: identical in-flight reads share one POST and settle without caching results`, async () => {
    let resolveFetch; let calls = 0;
    const { api } = client(surface, () => { calls++; return new Promise((resolve) => { resolveFetch = resolve; }); });
    const first = api.request(config, surface, 'token-A', 'user.member.bootstrap');
    const second = api.request(config, surface, 'token-A', 'user.member.bootstrap');
    assert.equal(first, second);
    assert.equal(calls, 1);
    resolveFetch(ok({ ready: true }));
    assert.equal((await first).ready, true);
    const third = api.request(config, surface, 'token-A', 'user.member.bootstrap');
    assert.equal(calls, 2);
    resolveFetch(ok()); await third;
  });
  test(`${surface}: writes are never coalesced and payload cannot replace identity or action`, async () => {
    const bodies = [];
    const { api } = client(surface, async (_url, options) => { bodies.push(JSON.parse(options.body)); return ok(); });
    await Promise.all([1, 2].map(() => api.request(config, surface, 'verified-token', 'user.member.profile.save', { idToken: 'spoof', clientType: 'admin', action: 'admin.stamps.add' })));
    assert.equal(bodies.length, 2);
    for (const body of bodies) {
      assert.equal(body.idToken, 'verified-token'); assert.equal(body.clientType, surface); assert.equal(body.action, 'user.member.profile.save');
    }
  });
}
test('read coalescing isolates identities, endpoints, actions and payloads', async () => {
  const resolvers = []; let calls = 0;
  const { api } = client('points', () => { calls++; return new Promise((resolve) => resolvers.push(resolve)); });
  const requests = [
    api.request(config, 'points', 'A', 'user.pointcard.detail', { cardId: 'one' }),
    api.request(config, 'points', 'B', 'user.pointcard.detail', { cardId: 'one' }),
    api.request(config, 'points', 'A', 'user.pointcard.detail', { cardId: 'two' }),
    api.request(config, 'points', 'A', 'user.pointcard.bootstrap'),
    api.request({ ...config, gasWebAppUrl: config.gasWebAppUrl + 'other' }, 'points', 'A', 'user.pointcard.detail', { cardId: 'one' })
  ];
  assert.equal(calls, 5); resolvers.forEach((resolve) => resolve(ok())); await Promise.all(requests);
});
test('a failed shared read is evicted and the next explicit retry sends a fresh request', async () => {
  let calls = 0;
  const { api } = client('points', async () => { calls++; return calls === 1 ? { status: 403, text: async () => JSON.stringify({ ok: false, error: { code: 'MEMBERSHIP_REQUIRED' } }) } : ok(); });
  const first = api.request(config, 'points', 'A', 'user.pointcard.bootstrap');
  const second = api.request(config, 'points', 'A', 'user.pointcard.bootstrap');
  await assert.rejects(first, { code: 'MEMBERSHIP_REQUIRED' }); await assert.rejects(second, { code: 'MEMBERSHIP_REQUIRED' });
  assert.equal(calls, 1); await api.request(config, 'points', 'A', 'user.pointcard.bootstrap'); assert.equal(calls, 2);
});
test('stalled non-bootstrap reads abort once within a 9000 ms aggregate transport budget; writes send once', async () => {
  const scheduled = []; const signals = []; let now = 0;
  class Clock extends Date { static now() { return now; } }
  const { api, context } = client('points', (_url, options) => { signals.push(options.signal); return new Promise(() => {}); }, {
    setTimeout(callback, ms) { scheduled.push(ms); return setImmediate(() => { now += ms; callback(); }); }, clearTimeout: clearImmediate
  });
  context.Date = Clock;
  await assert.rejects(api.request(config, 'points', 'A', 'user.pointcard.detail', { cardId: 'one' }), { code: 'SERVICE_TIMEOUT' });
  assert.deepEqual(scheduled, [9000]); assert.equal(now, 9000); assert.equal(signals.length, 1); assert.ok(signals.every((signal) => signal.aborted));
  await assert.rejects(api.request(config, 'points', 'A', 'user.pointcard.ticket.redeem'), { code: 'API_RESPONSE_UNCERTAIN' });
  assert.equal(signals.length, 2);
});
test('all complete bootstrap reads have a bounded 30000 ms budget while lightweight reads keep 9000 ms', async () => {
  const cases = [
    ['member', 'user.member.bootstrap', {}],
    ['points', 'user.pointcard.bootstrap', {}],
    ['event', 'user.event.bootstrap', {}],
    ['calendar', 'user.calendar.bootstrap', {}],
    ['admin', 'admin.bootstrap', {}]
  ];
  for (const [surface, action, payload] of cases) {
    const scheduled = []; let now = 0;
    class Clock extends Date { static now() { return now; } }
    const { api, context } = client(surface, () => new Promise(() => {}), {
      setTimeout(callback, ms) { scheduled.push(ms); return setImmediate(() => { now += ms; callback(); }); },
      clearTimeout: clearImmediate
    });
    context.Date = Clock;
    await assert.rejects(api.request(config, surface, 'A', action, payload), { code: 'SERVICE_TIMEOUT' });
    assert.deepEqual(scheduled, [30000], surface);
  }

  const scheduled = []; let now = 0;
  class Clock extends Date { static now() { return now; } }
  const { api, context } = client('admin', () => new Promise(() => {}), {
    setTimeout(callback, ms) { scheduled.push(ms); return setImmediate(() => { now += ms; callback(); }); },
    clearTimeout: clearImmediate
  });
  context.Date = Clock;
  await assert.rejects(api.request(config, 'admin', 'A', 'admin.bootstrap', { lazy: true }), { code: 'SERVICE_TIMEOUT' });
  assert.deepEqual(scheduled, [9000]);
});
test('LIFF init cannot leave a permanent loading screen or trigger late login side effects', async () => {
  let finish; let tokenReads = 0;
  const { api } = client('member', async () => ok(), {
    setTimeout: (callback) => setImmediate(callback), clearTimeout: clearImmediate,
    liff: { init: () => new Promise((resolve) => { finish = resolve; }), getIDToken: () => { tokenReads++; return 'token'; } }
  });
  await assert.rejects(api.signIn(config, 'member'), { code: 'LIFF_INIT_ERROR' }); finish(); await new Promise(setImmediate); assert.equal(tokenReads, 0);
});
test('legacy display snapshots are removed without reading or writing their records', () => {
  let removedName = '';
  const { api } = client('points', async () => ok(), {
    indexedDB: { deleteDatabase(name) { removedName = name; } }
  });
  assert.equal(removedName, 'MembershipSystemSyncCache');
  assert.equal(typeof api.readSyncSnapshot, 'undefined');
  assert.equal(typeof api.writeSyncSnapshot, 'undefined');
  assert.equal(typeof api.clearSyncSnapshots, 'undefined');
});
test('dialog keyboard focus wraps in both directions and ignores hidden/disabled controls', () => {
  let listener; let focused = '';
  const first = { tabIndex: 0, getClientRects: () => [1], focus: () => { focused = 'first'; } };
  const last = { tabIndex: 0, getClientRects: () => [1], focus: () => { focused = 'last'; } };
  const disabled = { ...last, disabled: true };
  const dialog = { getClientRects: () => [1], querySelectorAll: () => [first, disabled, last], contains: (el) => el === first || el === last };
  const { api, context } = client('points', async () => ok());
  context.document = { addEventListener: (_name, fn) => { listener = fn; }, querySelectorAll: () => [dialog], activeElement: last };
  api.bindDialogKeyboard(); let prevented = 0;
  listener({ key: 'Tab', shiftKey: false, preventDefault() { prevented++; } }); assert.equal(focused, 'first');
  context.document.activeElement = first;
  listener({ key: 'Tab', shiftKey: true, preventDefault() { prevented++; } }); assert.equal(focused, 'last'); assert.equal(prevented, 2);
});
