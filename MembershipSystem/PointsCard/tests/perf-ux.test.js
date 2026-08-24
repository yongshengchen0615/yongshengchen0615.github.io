'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function makeHarness(options) {
  const source = read('shared/perf-ux.js');
  let networkCalls = 0;
  const appended = new Map();
  const listeners = {};
  const document = {
    readyState: 'complete',
    documentElement: { dataset: {} },
    body: {
      append(node) {
        if (node && node.id) appended.set(node.id, node);
      }
    },
    getElementById(id) { return appended.get(id) || null; },
    createElement() {
      return {
        id: '',
        className: '',
        hidden: false,
        dataset: {},
        textContent: '',
        setAttribute() {}
      };
    },
    addEventListener() {},
    dispatchEvent() {}
  };

  const nativeFetch = async (_input, fetchOptions) => {
    networkCalls += 1;
    const action = String(fetchOptions && fetchOptions.body && fetchOptions.body.get('action') || '');
    if (options && options.failSummary && action === 'admin.summary') throw new TypeError('summary unavailable');
    if (action === 'admin.summary') {
      return new Response(JSON.stringify({
        ok: true,
        data: {
          settings: {
            cards: [{ cardId: 'CARD-TEST-01', name: '測試卡', status: 'active' }]
          }
        }
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (action === 'admin.cards.list') {
      return new Response(JSON.stringify({
        ok: true,
        data: { cards: [{ cardId: 'CARD-NETWORK-01', name: '網路卡', status: 'active' }] }
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ ok: true, data: {} }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };

  const window = {
    fetch: nativeFetch,
    Response,
    URL,
    URLSearchParams,
    location: { href: 'https://example.test/MembershipSystem/PointsCard/admin/' },
    navigator: { onLine: true },
    setTimeout,
    clearTimeout,
    addEventListener(name, handler) { listeners[name] = handler; }
  };
  const context = {
    window,
    document,
    Response,
    URL,
    URLSearchParams,
    CustomEvent: function CustomEvent(type, init) { this.type = type; this.detail = init && init.detail; },
    Set,
    Date,
    Promise,
    JSON,
    String,
    Boolean,
    Array,
    RegExp
  };
  vm.createContext(context);
  vm.runInContext(source, context);

  return {
    window,
    listeners,
    appended,
    getNetworkCalls: () => networkCalls
  };
}

function apiOptions(action) {
  return {
    method: 'POST',
    body: new URLSearchParams({
      action,
      idToken: 'test-token',
      payload: '{}'
    })
  };
}

const gasUrl = 'https://script.google.com/macros/s/test-deployment/exec';

test('admin summary card list is reused for the immediate cards.list request', async () => {
  const harness = makeHarness();
  await harness.window.fetch(gasUrl, apiOptions('admin.summary'));
  const cardsResponse = await harness.window.fetch(gasUrl, apiOptions('admin.cards.list'));
  const body = await cardsResponse.json();

  assert.equal(harness.getNetworkCalls(), 1);
  assert.equal(body.ok, true);
  assert.equal(body.data.cards[0].cardId, 'CARD-TEST-01');
});

test('a mutation invalidates the admin card snapshot', async () => {
  const harness = makeHarness();
  await harness.window.fetch(gasUrl, apiOptions('admin.summary'));
  await harness.window.fetch(gasUrl, apiOptions('admin.card.update'));
  const cardsResponse = await harness.window.fetch(gasUrl, apiOptions('admin.cards.list'));
  const body = await cardsResponse.json();

  assert.equal(harness.getNetworkCalls(), 3);
  assert.equal(body.data.cards[0].cardId, 'CARD-NETWORK-01');
});

test('cards.list falls back to the real endpoint when an in-flight summary fails', async () => {
  const harness = makeHarness({ failSummary: true });
  const summary = harness.window.fetch(gasUrl, apiOptions('admin.summary'));
  const cards = harness.window.fetch(gasUrl, apiOptions('admin.cards.list'));

  await assert.rejects(summary, /summary unavailable/);
  const body = await (await cards).json();
  assert.equal(harness.getNetworkCalls(), 2);
  assert.equal(body.data.cards[0].cardId, 'CARD-NETWORK-01');
});

test('read reuse is scoped to the configured GAS host shape', async () => {
  const harness = makeHarness();
  await harness.window.fetch(gasUrl, apiOptions('admin.summary'));
  await harness.window.fetch('https://example.test/api', apiOptions('admin.cards.list'));
  assert.equal(harness.getNetworkCalls(), 2);
});

test('user and admin load perf UX before common transport captures fetch', () => {
  ['user/index.html', 'admin/index.html'].forEach((relativePath) => {
    const html = read(relativePath);
    assert.match(html, /\.\.\/shared\/perf-ux\.css/);
    assert.match(html, /\.\.\/shared\/perf-ux\.js/);
    assert.ok(html.indexOf('../shared/perf-ux.js') < html.indexOf('../shared/common.js'));
  });
});

test('network UX exposes an accessible offline indicator without persisting credentials', () => {
  const source = read('shared/perf-ux.js');
  const harness = makeHarness();
  const status = harness.appended.get('pointsCardNetworkStatus');

  assert.ok(status);
  assert.equal(status.hidden, true);
  harness.listeners.offline();
  assert.equal(status.hidden, false);
  assert.match(status.textContent, /離線/);
  assert.equal(harness.window.navigator.onLine, true);
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/i);
});
