'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const commonSource = fs.readFileSync(path.join(root, 'shared/common.js'), 'utf8');

function createStore(seed) {
  const values = new Map(seed ? Array.from(seed.entries()) : []);
  return {
    values,
    api: {
      getItem: (key) => values.has(key) ? values.get(key) : null,
      setItem: (key, value) => values.set(key, String(value)),
      removeItem: (key) => values.delete(key)
    }
  };
}

function createLoginHarness(options) {
  let currentHref = options.href;
  const store = options.store || createStore();
  const calls = { init: 0, login: 0, logout: 0, getIdToken: 0 };
  const location = {
    get href() { return currentHref; },
    set href(value) { currentHref = new URL(value, currentHref).href; },
    get origin() { return new URL(currentHref).origin; },
    replace(value) { currentHref = new URL(value, currentHref).href; }
  };
  const liff = {
    async init() { calls.init += 1; },
    isInClient: () => Boolean(options.inClient),
    isLoggedIn: () => options.loggedIn !== false,
    getIDToken() { calls.getIdToken += 1; return 'fresh-id-token'; },
    getDecodedIDToken: () => ({ exp: Math.floor(Date.now() / 1000) + 3600 }),
    logout() { calls.logout += 1; },
    login(config) { calls.login += 1; calls.redirectUri = config.redirectUri; }
  };
  class AbortControllerStub {
    constructor() { this.signal = {}; }
    abort() {}
  }
  const document = {
    createElement: () => ({}),
    head: { append() {} }
  };
  const window = {
    liff,
    location,
    history: {
      replaceState(_state, _title, value) { currentHref = new URL(value, currentHref).href; }
    },
    sessionStorage: store.api,
    fetch: async () => ({
      ok: true,
      async json() {
        return {
          LIFF_ID: '1234567890-test',
          GAS_WEB_APP_URL: 'https://script.google.com/macros/s/test/exec'
        };
      }
    }),
    URLSearchParams,
    AbortController: AbortControllerStub,
    crypto: { getRandomValues: (buffer) => buffer.fill(1) },
    performance: { now: () => 1 },
    setTimeout,
    clearTimeout,
    pageXOffset: 0,
    pageYOffset: 0
  };
  const context = {
    window,
    document,
    URL,
    URLSearchParams,
    AbortController: AbortControllerStub,
    Intl,
    Date,
    Math,
    Number,
    Object,
    String,
    JSON,
    console,
    setTimeout,
    clearTimeout
  };
  vm.createContext(context);
  vm.runInContext(commonSource, context);
  return { window, store, calls, href: () => currentHref };
}

test('member and admin external entries force a new LINE login', async () => {
  for (const surface of ['user', 'admin']) {
    const harness = createLoginHarness({
      href: `https://example.com/PointsCard/${surface}/`,
      inClient: false,
      loggedIn: true
    });
    assert.equal(await harness.window.PointsCard.ensureLiffLogin(), false);
    assert.equal(harness.calls.init, 1);
    assert.equal(harness.calls.logout, 1);
    assert.equal(harness.calls.login, 1);
    assert.equal(harness.calls.getIdToken, 0);
    const pending = JSON.parse(harness.store.values.get('points-card.liff.fresh-login.pending'));
    assert.equal(pending.surface, `/PointsCard/${surface}/`);
  }
});

test('fresh external login callback is accepted once without a redirect loop', async () => {
  const first = createLoginHarness({
    href: 'https://example.com/PointsCard/user/',
    inClient: false,
    loggedIn: true
  });
  assert.equal(await first.window.PointsCard.ensureLiffLogin(), false);

  const callback = createLoginHarness({
    href: 'https://example.com/PointsCard/user/?code=callback-code&state=callback-state',
    inClient: false,
    loggedIn: true,
    store: first.store
  });
  assert.equal(await callback.window.PointsCard.ensureLiffLogin(), true);
  assert.equal(callback.calls.logout, 0);
  assert.equal(callback.calls.login, 0);
  assert.equal(callback.calls.getIdToken, 1);
  assert.equal(callback.store.values.has('points-card.liff.fresh-login.pending'), false);
  assert.equal(callback.href(), 'https://example.com/PointsCard/user/');

  const reentry = createLoginHarness({
    href: 'https://example.com/PointsCard/user/',
    inClient: false,
    loggedIn: true,
    store: callback.store
  });
  assert.equal(await reentry.window.PointsCard.ensureLiffLogin(), false);
  assert.equal(reentry.calls.logout, 1);
  assert.equal(reentry.calls.login, 1);
});

test('LIFF browser uses its mandatory automatic login on every initialization', async () => {
  const harness = createLoginHarness({
    href: 'https://example.com/PointsCard/user/',
    inClient: true,
    loggedIn: true
  });
  assert.equal(await harness.window.PointsCard.ensureLiffLogin(), true);
  assert.equal(harness.calls.init, 1);
  assert.equal(harness.calls.logout, 0);
  assert.equal(harness.calls.login, 0);
  assert.equal(harness.calls.getIdToken, 1);
});

test('a member callback marker cannot bypass the admin fresh login', async () => {
  const store = createStore();
  store.values.set('points-card.liff.fresh-login.pending', JSON.stringify({
    surface: '/PointsCard/user/',
    startedAt: Date.now()
  }));
  const harness = createLoginHarness({
    href: 'https://example.com/PointsCard/admin/?code=callback-code&state=callback-state',
    inClient: false,
    loggedIn: true,
    store
  });
  assert.equal(await harness.window.PointsCard.ensureLiffLogin(), false);
  assert.equal(harness.calls.logout, 1);
  assert.equal(harness.calls.login, 1);
  const replacement = JSON.parse(store.values.get('points-card.liff.fresh-login.pending'));
  assert.equal(replacement.surface, '/PointsCard/admin/');
});

test('login callback marker stores only route and time, never credentials', async () => {
  const harness = createLoginHarness({
    href: 'https://example.com/PointsCard/admin/',
    inClient: false,
    loggedIn: true
  });
  await harness.window.PointsCard.ensureLiffLogin();
  const serialized = harness.store.values.get('points-card.liff.fresh-login.pending');
  assert.doesNotMatch(serialized, /fresh-id-token|idToken|accessToken/i);
  assert.deepEqual(Object.keys(JSON.parse(serialized)).sort(), ['startedAt', 'surface']);
});

test('fresh login fails closed instead of looping when session storage is unavailable', async () => {
  const blockedStore = {
    values: new Map(),
    api: {
      getItem: () => null,
      setItem() { throw new Error('blocked'); },
      removeItem() {}
    }
  };
  const harness = createLoginHarness({
    href: 'https://example.com/PointsCard/admin/',
    inClient: false,
    loggedIn: true,
    store: blockedStore
  });
  await assert.rejects(
    harness.window.PointsCard.ensureLiffLogin(),
    /無法安全保存重新登入狀態/
  );
  assert.equal(harness.calls.logout, 0);
  assert.equal(harness.calls.login, 0);
});
