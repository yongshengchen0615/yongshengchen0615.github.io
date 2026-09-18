const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function harness() {
  let now = 0;
  let timerId = 0;
  let onChange = null;
  const timers = new Map();
  const windowListeners = new Map();
  const documentListeners = new Map();

  class FakeDate extends Date {
    static now() { return now; }
  }

  const add = (bucket, type, fn) => {
    if (!bucket.has(type)) bucket.set(type, new Set());
    bucket.get(type).add(fn);
  };
  const remove = (bucket, type, fn) => bucket.get(type)?.delete(fn);

  const channel = {
    on(_event, _filter, callback) { onChange = callback; return this; },
    subscribe() { return this; },
  };
  const client = {
    channel() { return channel; },
    removeChannel() { return Promise.resolve(); },
  };
  const window = {
    location: { pathname: '/MemberWebsocket-dev/booking/', href: 'https://example.test/MemberWebsocket-dev/booking/' },
    supabase: { createClient() { return client; } },
    setTimeout(fn, delay = 0) {
      const id = ++timerId;
      timers.set(id, { fn, at: now + Number(delay || 0) });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    addEventListener(type, fn) { add(windowListeners, type, fn); },
    removeEventListener(type, fn) { remove(windowListeners, type, fn); },
  };
  const document = {
    visibilityState: 'visible',
    addEventListener(type, fn) { add(documentListeners, type, fn); },
    removeEventListener(type, fn) { remove(documentListeners, type, fn); },
    querySelector() { return null; },
    getElementById() { return null; },
  };
  const navigator = { onLine: true };
  const context = vm.createContext({
    window, document, navigator, Date: FakeDate, Map, Set, URL, AbortController,
    Promise, console, fetch() { throw new Error('Unexpected fetch'); },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../booking/common.js'), 'utf8'), context);

  async function flush() {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  }
  async function runNextTimer() {
    if (!timers.size) return false;
    const [id, item] = [...timers.entries()].sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
    timers.delete(id);
    now = Math.max(now, item.at);
    item.fn();
    await flush();
    return true;
  }
  async function drainTimers(limit = 20) {
    for (let i = 0; i < limit && timers.size; i++) await runNextTimer();
  }

  return {
    BookingSystem: window.BookingSystem,
    emit(scope = 'member') {
      assert.equal(typeof onChange, 'function');
      onChange({ new: { scope } });
    },
    runNextTimer,
    drainTimers,
    flush,
    pendingTimers: () => timers.size,
  };
}

const config = {
  realtimeEnabled: true,
  supabaseUrl: 'https://example.supabase.co',
  supabasePublishableKey: 'fixture',
};

test('booking realtime recovers after a synchronous refresh exception', async () => {
  const h = harness();
  let calls = 0;
  h.BookingSystem.subscribeRealtime(config, () => {
    calls += 1;
    if (calls === 1) throw new Error('fixture sync failure');
  }, 'member');

  h.emit();
  await h.runNextTimer();
  assert.equal(calls, 1);

  h.emit();
  await h.drainTimers();
  assert.equal(calls, 2);
});

test('booking realtime coalesces an event storm while one refresh is in flight', async () => {
  const h = harness();
  let calls = 0;
  let active = 0;
  let maxActive = 0;
  let releaseFirst;
  const first = new Promise((resolve) => { releaseFirst = resolve; });

  h.BookingSystem.subscribeRealtime(config, async () => {
    calls += 1;
    active += 1;
    maxActive = Math.max(maxActive, active);
    if (calls === 1) await first;
    active -= 1;
  }, 'member');

  h.emit();
  await h.runNextTimer();
  assert.equal(calls, 1);

  for (let i = 0; i < 100; i++) h.emit();
  await h.drainTimers();
  assert.equal(calls, 1);

  releaseFirst();
  await h.flush();
  await h.drainTimers();
  assert.equal(calls, 2);
  assert.equal(maxActive, 1);
});
