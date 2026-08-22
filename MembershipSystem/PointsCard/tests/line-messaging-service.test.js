'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../gas/LineMessagingService.gs'), 'utf8');

function createContext(options) {
  const settings = options || {};
  let fetchCalls = 0;
  let lastRequest = null;
  const context = {
    Object,
    String,
    Boolean,
    Number,
    JSON,
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: () => settings.token || ''
      })
    },
    UrlFetchApp: {
      fetch: (url, requestOptions) => {
        fetchCalls += 1;
        lastRequest = { url, options: requestOptions };
        if (settings.throwNetwork) throw new Error('network');
        return { getResponseCode: () => settings.statusCode == null ? 200 : settings.statusCode };
      }
    },
    sha256Hex_: () => '123e4567e89b12d3a456426614174000123e4567e89b12d3a456426614174000'
  };
  vm.createContext(context);
  vm.runInContext(source + '\n;globalThis.__line = { createLineMessagingClient_, lineMessagingRetryKey_ };', context);
  return {
    context,
    fetchCalls: () => fetchCalls,
    lastRequest: () => lastRequest
  };
}

test('missing channel token fails closed without making an outbound request', () => {
  const fixture = createContext({ token: '' });
  const client = fixture.context.__line.createLineMessagingClient_();
  const result = client.sendTextPush('U123', 'retry-key', 'hello');
  assert.equal(client.configured, false);
  assert.equal(fixture.fetchCalls(), 0);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    configured: false,
    accepted: false,
    retryable: false,
    errorCode: 'NOT_CONFIGURED'
  });
});

test('LINE transport keeps success, duplicate and retry semantics stable', () => {
  for (const [statusCode, accepted, retryable, errorCode] of [
    [200, true, false, ''],
    [202, true, false, ''],
    [409, true, false, ''],
    [400, false, false, 'HTTP_400'],
    [429, false, true, 'HTTP_429'],
    [500, false, true, 'HTTP_500']
  ]) {
    const fixture = createContext({ token: 'secret-token', statusCode });
    const client = fixture.context.__line.createLineMessagingClient_();
    const result = client.sendTextPush('U123', 'retry-key', '通知內容');
    assert.equal(result.accepted, accepted, `accepted mismatch for HTTP ${statusCode}`);
    assert.equal(result.retryable, retryable, `retryable mismatch for HTTP ${statusCode}`);
    assert.equal(result.errorCode, errorCode, `error code mismatch for HTTP ${statusCode}`);
    assert.equal(result.configured, true);
    const request = fixture.lastRequest();
    assert.equal(request.options.headers.Authorization, 'Bearer secret-token');
    assert.equal(request.options.headers['X-Line-Retry-Key'], 'retry-key');
    assert.doesNotMatch(request.options.payload, /secret-token/);
  }
});

test('network failures remain retryable without exposing credentials', () => {
  const fixture = createContext({ token: 'secret-token', throwNetwork: true });
  const client = fixture.context.__line.createLineMessagingClient_();
  const result = client.sendTextPush('U123', 'retry-key', '通知內容');
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    accepted: false,
    retryable: true,
    errorCode: 'NETWORK_ERROR',
    configured: true
  });
  assert.equal(Object.prototype.hasOwnProperty.call(client, 'channelAccessToken'), false);
  assert.doesNotMatch(JSON.stringify(client), /secret-token/);
});

test('retry keys remain deterministic UUID-shaped values', () => {
  const fixture = createContext({});
  const first = fixture.context.__line.lineMessagingRetryKey_('same-seed');
  const second = fixture.context.__line.lineMessagingRetryKey_('same-seed');
  assert.equal(first, second);
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
});
