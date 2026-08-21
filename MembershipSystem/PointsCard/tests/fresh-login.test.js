'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const commonSource = fs.readFileSync(path.join(root, 'shared/common.js'), 'utf8');
const redirectSource = fs.readFileSync(path.join(root, 'redirect.js'), 'utf8');
const userSource = fs.readFileSync(path.join(root, 'user/app.js'), 'utf8');
const adminSource = fs.readFileSync(path.join(root, 'admin/app.js'), 'utf8');
const publicConfig = JSON.parse(fs.readFileSync(path.join(root, 'shared/config.json'), 'utf8'));

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
  const calls = { init: 0, login: 0, logout: 0, getIdToken: 0, locationReplace: 0 };
  const location = {
    get href() { return currentHref; },
    set href(value) { currentHref = new URL(value, currentHref).href; },
    get origin() { return new URL(currentHref).origin; },
    replace(value) {
      calls.locationReplace += 1;
      currentHref = new URL(value, currentHref).href;
    }
  };
  const liff = {
    async init(config) { calls.init += 1; calls.liffId = config.liffId; },
    isInClient: () => Boolean(options.inClient),
    isLoggedIn: () => options.loggedIn !== false,
    getIDToken() { calls.getIdToken += 1; return 'fresh-id-token'; },
    getDecodedIDToken: () => ({
      exp: Math.floor(Date.now() / 1000) + (options.tokenExpirySeconds == null ? 3600 : options.tokenExpirySeconds)
    }),
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
        return Object.assign({
          USER_LIFF_ID: '1234567890-user',
          ADMIN_LIFF_ID: '1234567890-admin',
          LIFF_ID: '1234567890-test',
          GAS_WEB_APP_URL: 'https://script.google.com/macros/s/test/exec'
        }, options.config || {});
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

test('member and admin initialize their own LIFF app and reuse a valid LINE session', async () => {
  for (const surface of [
    { path: 'user', liffId: '1234567890-user' },
    { path: 'admin', liffId: '1234567890-admin' }
  ]) {
    const harness = createLoginHarness({
      href: `https://example.com/PointsCard/${surface.path}/`,
      inClient: false,
      loggedIn: true
    });
    assert.equal(await harness.window.PointsCard.ensureLiffLogin(), true);
    assert.equal(harness.calls.init, 1);
    assert.equal(harness.calls.liffId, surface.liffId);
    assert.equal(harness.calls.logout, 0);
    assert.equal(harness.calls.login, 0);
    assert.equal(harness.calls.getIdToken, 1);
  }
});

test('logged-out external admin entry starts LINE Login with the admin callback URL', async () => {
  const harness = createLoginHarness({
    href: 'https://example.com/PointsCard/admin/',
    inClient: false,
    loggedIn: false
  });
  assert.equal(await harness.window.PointsCard.ensureLiffLogin(), false);
  assert.equal(harness.calls.liffId, '1234567890-admin');
  assert.equal(harness.calls.logout, 0);
  assert.equal(harness.calls.login, 1);
  assert.equal(harness.calls.redirectUri, 'https://example.com/PointsCard/admin/');
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
  assert.equal(harness.calls.liffId, '1234567890-user');
});

test('external login callback is accepted after successful LIFF initialization without storage coupling', async () => {
  const harness = createLoginHarness({
    href: 'https://example.com/PointsCard/admin/?code=callback-code&state=callback-state',
    inClient: false,
    loggedIn: true
  });
  assert.equal(await harness.window.PointsCard.ensureLiffLogin(), true);
  assert.equal(harness.calls.logout, 0);
  assert.equal(harness.calls.login, 0);
  assert.equal(harness.href(), 'https://example.com/PointsCard/admin/');
});

test('expired external token logs out and reloads before starting another login', async () => {
  const harness = createLoginHarness({
    href: 'https://example.com/PointsCard/admin/',
    inClient: false,
    loggedIn: true,
    tokenExpirySeconds: 0
  });
  assert.equal(await harness.window.PointsCard.ensureLiffLogin(), false);
  assert.equal(harness.calls.logout, 1);
  assert.equal(harness.calls.login, 0);
  assert.equal(harness.calls.locationReplace, 1);
  assert.equal(harness.href(), 'https://example.com/PointsCard/admin/');
});

test('valid current login works even when session storage is unavailable', async () => {
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
  assert.equal(await harness.window.PointsCard.ensureLiffLogin(), true);
  assert.equal(harness.calls.logout, 0);
  assert.equal(harness.calls.login, 0);
});

test('admin requires its own configured LIFF ID instead of falling back to the user ID', async () => {
  const harness = createLoginHarness({
    href: 'https://example.com/PointsCard/admin/',
    inClient: true,
    loggedIn: true,
    config: { ADMIN_LIFF_ID: 'YOUR_ADMIN_LIFF_ID' }
  });
  await assert.rejects(
    harness.window.PointsCard.ensureLiffLogin(),
    /ADMIN_LIFF_ID 尚未設定/
  );
  assert.equal(harness.calls.init, 0);
});

test('legacy LIFF_ID remains a user-only compatibility fallback', async () => {
  const harness = createLoginHarness({
    href: 'https://example.com/PointsCard/user/',
    inClient: true,
    loggedIn: true,
    config: { USER_LIFF_ID: '', LIFF_ID: '1234567890-legacy-user' }
  });
  assert.equal(await harness.window.PointsCard.ensureLiffLogin(), true);
  assert.equal(harness.calls.liffId, '1234567890-legacy-user');
});

test('public config and generated member links keep user and admin LIFF IDs separated', () => {
  assert.match(publicConfig.USER_LIFF_ID, /^\d+-[A-Za-z0-9_-]+$/);
  assert.match(publicConfig.ADMIN_LIFF_ID, /^\d+-[A-Za-z0-9_-]+$/);
  assert.notEqual(publicConfig.USER_LIFF_ID, publicConfig.ADMIN_LIFF_ID);
  assert.match(redirectSource, /config\.USER_LIFF_ID \|\| config\.LIFF_ID/);
  assert.match(userSource, /config\.USER_LIFF_ID/);
  assert.equal((adminSource.match(/config\.USER_LIFF_ID/g) || []).length, 2);
  assert.doesNotMatch(adminSource, /encodeURIComponent\(config\.LIFF_ID\)/);
});
