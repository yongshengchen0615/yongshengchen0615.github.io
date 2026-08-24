'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../shared/common.js'), 'utf8');

function sessionStorageMock() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); }
  };
}

async function loadConfigFor(pageUrl, config) {
  const page = new URL(pageUrl);
  const window = {
    location: { href: page.href, pathname: page.pathname },
    sessionStorage: sessionStorageMock(),
    history: { replaceState() {} }
  };
  const context = {
    console,
    URL,
    window,
    document: {
      currentScript: { src: 'https://example.com/MembershipSystem/app/shared/common.js' }
    },
    fetch: async () => ({ ok: true, json: async () => config }),
    liff: {}
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return context.window.Membership.loadConfig();
}

const validConfig = {
  LIFF_ID: '2010787602-user',
  USER_LIFF_ID: '2010787602-user',
  ADMIN_LIFF_ID: '2010787602-admin',
  GAS_WEB_APP_URL: 'https://script.google.com/macros/s/test/exec'
};

test('member surface selects USER_LIFF_ID', async () => {
  const config = await loadConfigFor('https://example.com/MembershipSystem/app/user/', validConfig);
  assert.equal(config.LIFF_ID, validConfig.USER_LIFF_ID);
  assert.equal(config.USER_LIFF_ID, validConfig.USER_LIFF_ID);
  assert.equal(config.ADMIN_LIFF_ID, validConfig.ADMIN_LIFF_ID);
  assert.equal(config.ACTIVE_LIFF_ID, validConfig.USER_LIFF_ID);
});

test('admin surface selects ADMIN_LIFF_ID while LIFF_ID stays the member alias', async () => {
  const config = await loadConfigFor('https://example.com/MembershipSystem/app/admin/', validConfig);
  assert.equal(config.LIFF_ID, validConfig.USER_LIFF_ID);
  assert.equal(config.ACTIVE_LIFF_ID, validConfig.ADMIN_LIFF_ID);
});

test('admin surface fails closed when ADMIN_LIFF_ID is missing or placeholder', async () => {
  await assert.rejects(
    () => loadConfigFor('https://example.com/MembershipSystem/app/admin/', {
      ...validConfig,
      ADMIN_LIFF_ID: 'YOUR_ADMIN_LIFF_ID'
    }),
    /尚未設定 ADMIN_LIFF_ID/
  );
});

test('user surface supports legacy LIFF_ID during rollout but admin never falls back to it', async () => {
  const legacyConfig = {
    LIFF_ID: '2010787602-legacy-user',
    GAS_WEB_APP_URL: validConfig.GAS_WEB_APP_URL
  };
  const userConfig = await loadConfigFor('https://example.com/MembershipSystem/app/user/', legacyConfig);
  assert.equal(userConfig.ACTIVE_LIFF_ID, legacyConfig.LIFF_ID);

  await assert.rejects(
    () => loadConfigFor('https://example.com/MembershipSystem/app/admin/index.html', legacyConfig),
    /尚未設定 ADMIN_LIFF_ID/
  );
});

test('shared common script remains syntactically valid and LIFF init uses active surface ID', () => {
  assert.doesNotThrow(() => new vm.Script(source));
  assert.match(source, /liff\.init\(\{ liffId: activeConfig\.ACTIVE_LIFF_ID \}\)/);
});
