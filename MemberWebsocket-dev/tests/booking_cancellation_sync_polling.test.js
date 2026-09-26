const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../admin/booking-cancellation-sync.js'), 'utf8');

function createHarness(search = '') {
  const timers = new Map();
  let nextId = 0;
  let subscriptionStatus;
  const channel = {
    on() { return this; },
    subscribe(callback) { subscriptionStatus = callback; return this; },
  };
  const window = {
    location: { search },
    setTimeout(callback, delay) { const id = ++nextId; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    addEventListener() {},
    removeEventListener() {},
    MemberAdminSession: { wait: async () => ({
      config: { supabaseUrl: 'https://example.supabase.co', supabasePublishableKey: 'public-key' },
      idToken: 'test-token',
    }) },
    supabase: { createClient: () => ({ channel: () => channel, removeChannel: async () => {} }) },
  };
  const document = { readyState: 'loading', addEventListener() {}, removeEventListener() {}, visibilityState: 'visible' };
  const instrumented = source.replace(/\}\)\(\);\s*$/, 'globalThis.pollingUnderTest = { setupPolling, setupRealtime, teardown };\n})();');
  assert.notEqual(instrumented, source);
  const context = { window, document, navigator: { onLine: true }, URLSearchParams, console };
  vm.runInNewContext(instrumented, context);
  return {
    api: context.pollingUnderTest,
    timers,
    status: (value) => subscriptionStatus(value),
    delays: () => [...timers.values()].map(({ delay }) => delay),
  };
}

test('cancellation sync uses frequent fallback only while Realtime is unavailable', async () => {
  const harness = createHarness();
  harness.api.setupPolling();
  assert.deepEqual(harness.delays(), [12000]);

  await harness.api.setupRealtime();
  harness.status('SUBSCRIBED');
  assert.deepEqual(harness.delays().sort((a, b) => a - b), [350, 120000]);

  harness.status('CHANNEL_ERROR');
  assert.deepEqual(harness.delays().sort((a, b) => a - b), [350, 12000]);
  harness.api.teardown();
  assert.deepEqual(harness.delays(), []);
});

test('background E2E runner keeps its 12 second reconciliation', async () => {
  const harness = createHarness('?e2eBackgroundRunner=1&e2eRunId=run-1');
  await harness.api.setupRealtime();
  harness.status('SUBSCRIBED');
  assert.deepEqual(harness.delays().sort((a, b) => a - b), [350, 12000]);
  harness.api.teardown();
});
