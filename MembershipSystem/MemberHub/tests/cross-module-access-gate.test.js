'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

function functionSource(source, name) {
  const start = source.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name + ' must exist');
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === "'" || char === '"' || char === '`') { quote = char; continue; }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error('unterminated function ' + name);
}

function publicError(code, message) {
  const error = new Error(message);
  error.publicCode = code;
  throw error;
}

function hmacBytes(message, secret) {
  return Array.from(crypto.createHmac('sha256', secret).update(message).digest(),
    (byte) => byte > 127 ? byte - 256 : byte);
}

function hmacHex(message, secret) {
  return crypto.createHmac('sha256', secret).update(message).digest('hex');
}

const fixedNowMs = 1787614800000;
class TestDate extends Date {
  constructor(...args) { super(...(args.length ? args : [fixedNowMs])); }
  static now() { return fixedNowMs; }
}

test('membership access gate authenticates the service and ignores membership tier', () => {
  const source = read('modules/membership/gas/Code.gs');
  const serviceSecrets = { points: 'p'.repeat(32), calendar: 'c'.repeat(32) };
  const requestedSecretProperties = new Set();
  const usedNonces = new Set();
  let storedMember = { membershipStatus: 'suspended', tier: 'platinum', expiresAt: '' };
  const context = {
    Date: TestDate, Math, Number, String,
    MEMBER_HEADERS: ['member'],
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (key) => {
        requestedSecretProperties.add(key);
        return key === 'MEMBERHUB_POINTS_ACCESS_GATE_SECRET'
          ? serviceSecrets.points : serviceSecrets.calendar;
      }
    }) },
    cleanText_: (value, max, required) => {
      const text = String(value == null ? '' : value).trim().slice(0, max);
      if (required && !text) publicError('INVALID_INPUT', 'required');
      return text;
    },
    rateLimit_: () => {},
    getMembersSheet_: () => ({ getRange: () => ({ getValues: () => [[storedMember]] }) }),
    findMemberRow_: () => storedMember ? 2 : 0,
    rowToMember_: (row) => row[0],
    Utilities: {
      Charset: { UTF_8: 'UTF_8' },
      computeHmacSha256Signature: (message, key) => hmacBytes(message, key),
      formatDate: () => '2026-08-25'
    },
    CacheService: { getScriptCache: () => ({
      get: (key) => usedNonces.has(key) ? '1' : null,
      put: (key) => usedNonces.add(key)
    }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    fail_: publicError
  };
  vm.createContext(context);
  vm.runInContext(
    functionSource(source, 'constantTimeTextEquals_') + '\n' +
      functionSource(source, 'memberAccessGateSignature_') + '\n' +
      functionSource(source, 'memberAccessGateProbeResponseSignature_') + '\n' +
      functionSource(source, 'consumeMemberAccessNonce_') + '\n' +
      functionSource(source, 'isMembershipUsable_') + '\n' +
      functionSource(source, 'internalMemberAccessCheck_') +
      '\n;globalThis.check = internalMemberAccessCheck_;',
    context
  );

  let nonceSequence = 0;
  const signedRequest = (lineUserId, options = {}) => {
    const serviceId = options.serviceId || 'points';
    const timestampValue = Object.prototype.hasOwnProperty.call(options, 'timestamp')
      ? options.timestamp : Math.floor(TestDate.now() / 1000);
    const timestamp = String(timestampValue);
    const nonce = options.nonce || (++nonceSequence).toString(16).padStart(32, '0');
    return {
      serviceId, timestamp, nonce, lineUserId,
      signature: hmacHex(
        [serviceId, timestamp, nonce, lineUserId].join('\n'),
        options.secret || serviceSecrets[serviceId]
      )
    };
  };

  const suspendedRequest = signedRequest('U-ONE');
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.check(suspendedRequest))),
    { allowed: false, membershipStatus: 'inactive' }
  );
  assert.throws(
    () => context.check(suspendedRequest),
    (error) => error && error.publicCode === 'MEMBER_ACCESS_REPLAYED'
  );
  assert.throws(
    () => context.check(signedRequest('U-ONE', { secret: 'x'.repeat(32) })),
    (error) => error && error.publicCode === 'FORBIDDEN'
  );
  assert.throws(
    () => context.check(signedRequest('U-ONE', {
      serviceId: 'calendar',
      secret: serviceSecrets.points
    })),
    (error) => error && error.publicCode === 'FORBIDDEN'
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.check(signedRequest('U-CALENDAR', { serviceId: 'calendar' })))),
    { allowed: false, membershipStatus: 'inactive' }
  );
  assert.deepEqual(
    Array.from(requestedSecretProperties).sort(),
    ['MEMBERHUB_CALENDAR_ACCESS_GATE_SECRET', 'MEMBERHUB_POINTS_ACCESS_GATE_SECRET']
  );
  assert.throws(
    () => context.check(signedRequest('U-ONE', { timestamp: Math.floor(TestDate.now() / 1000) - 61 })),
    (error) => error && error.publicCode === 'FORBIDDEN'
  );
  assert.throws(
    () => context.check(signedRequest('U-ONE', { timestamp: Math.floor(TestDate.now() / 1000) + 61 })),
    (error) => error && error.publicCode === 'FORBIDDEN'
  );

  for (const offset of [-60, 60]) {
    assert.deepEqual(
      JSON.parse(JSON.stringify(context.check(signedRequest('U-BOUNDARY-' + offset, {
        timestamp: Math.floor(TestDate.now() / 1000) + offset
      })))),
      { allowed: false, membershipStatus: 'inactive' }
    );
  }

  const mutations = [
    (request) => { request.serviceId = 'calendar'; },
    (request) => { request.timestamp = String(Number(request.timestamp) + 1); },
    (request) => { request.nonce = 'f' + request.nonce.slice(1); },
    (request) => { request.lineUserId = 'U-TAMPERED'; }
  ];
  for (const mutate of mutations) {
    const request = signedRequest('U-BOUND');
    mutate(request);
    assert.throws(
      () => context.check(request),
      (error) => error && error.publicCode === 'FORBIDDEN'
    );
  }

  const malformed = [
    { serviceId: 'membership' },
    { timestamp: 'not-a-time' },
    { nonce: 'a'.repeat(31) },
    { signature: 'a'.repeat(63) }
  ];
  for (const fields of malformed) {
    assert.throws(
      () => context.check(Object.assign(signedRequest('U-MALFORMED'), fields)),
      (error) => error && error.publicCode === 'FORBIDDEN'
    );
  }
  storedMember = { membershipStatus: 'active', tier: 'platinum', expiresAt: '2026-08-25' };
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.check(signedRequest('U-ACTIVE')))),
    { allowed: true, membershipStatus: 'active' }
  );
  storedMember = { membershipStatus: 'disabled', tier: 'platinum', expiresAt: '' };
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.check(signedRequest('U-DISABLED')))),
    { allowed: false, membershipStatus: 'inactive' }
  );
  storedMember = null;
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.check(signedRequest('U-NEW')))),
    { allowed: false, membershipStatus: 'unregistered' }
  );
  const probeRequest = signedRequest('memberhub-deployment-probe-points');
  const probeResult = JSON.parse(JSON.stringify(context.check(probeRequest)));
  assert.equal(probeResult.allowed, false);
  assert.equal(probeResult.membershipStatus, 'unregistered');
  assert.equal(
    probeResult.probeSignature,
    hmacHex([
      'memberhub-access-gate-probe-response-v1', probeRequest.serviceId,
      probeRequest.timestamp, probeRequest.nonce, probeRequest.lineUserId,
      'false', 'unregistered'
    ].join('\n'), serviceSecrets.points)
  );

  storedMember = { membershipStatus: 'active', tier: 'platinum', expiresAt: '2026-08-24' };
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.check(signedRequest('U-EXPIRED')))),
    { allowed: false, membershipStatus: 'inactive' }
  );
});

test('all access-gate HMAC helpers match an independent known vector', () => {
  const vector = {
    secret: '0123456789abcdef0123456789abcdef',
    serviceId: 'points',
    timestamp: '1787614800',
    nonce: '0123456789abcdef0123456789abcdef',
    lineUserId: 'U0123456789abcdef'
  };
  const message = [vector.serviceId, vector.timestamp, vector.nonce, vector.lineUserId].join('\n');
  const expected = hmacHex(message, vector.secret);

  for (const relative of [
    'modules/membership/gas/Code.gs',
    'modules/points/gas/Code.gs',
    'modules/calendar/gas/Code.gs'
  ]) {
    const context = {
      Utilities: {
        Charset: { UTF_8: 'UTF_8' },
        computeHmacSha256Signature: (value, key) => hmacBytes(value, key)
      }
    };
    vm.createContext(context);
    vm.runInContext(
      functionSource(read(relative), 'memberAccessGateSignature_') +
        '\n;globalThis.sign = memberAccessGateSignature_;',
      context
    );
    assert.equal(
      context.sign(vector.secret, vector.serviceId, vector.timestamp, vector.nonce, vector.lineUserId),
      expected,
      relative
    );
  }

  const responseMessage = [
    'memberhub-access-gate-probe-response-v1', vector.serviceId, vector.timestamp,
    vector.nonce, vector.lineUserId, 'false', 'unregistered'
  ].join('\n');
  const expectedResponse = hmacHex(responseMessage, vector.secret);
  for (const relative of [
    'modules/membership/gas/Code.gs',
    'modules/points/gas/DeploymentDiagnostics.gs',
    'modules/calendar/gas/DeploymentDiagnostics.gs'
  ]) {
    const context = {
      Utilities: {
        Charset: { UTF_8: 'UTF_8' },
        computeHmacSha256Signature: (value, key) => hmacBytes(value, key)
      }
    };
    vm.createContext(context);
    vm.runInContext(
      functionSource(read(relative), 'memberAccessGateProbeResponseSignature_') +
        '\n;globalThis.signResponse = memberAccessGateProbeResponseSignature_;',
      context
    );
    assert.equal(
      context.signResponse(
        vector.secret, vector.serviceId, vector.timestamp, vector.nonce,
        vector.lineUserId, false, 'unregistered'
      ),
      expectedResponse,
      relative
    );
  }
});

test('points and calendar gate member actions only after LINE authentication', () => {
  const membership = read('modules/membership/gas/Code.gs');
  const points = read('modules/points/gas/Code.gs');
  const calendar = read('modules/calendar/gas/Code.gs');
  const manifest = JSON.parse(read('modules/calendar/gas/appsscript.json'));

  assert.ok(membership.indexOf("action === 'internal.member-access.check'") < membership.indexOf('const idToken ='));
  assert.match(membership, /MEMBERHUB_POINTS_ACCESS_GATE_SECRET/);
  assert.match(membership, /MEMBERHUB_CALENDAR_ACCESS_GATE_SECRET/);
  assert.doesNotMatch(membership, /getProperty\('MEMBERHUB_ACCESS_GATE_SECRET'\)/);
  assert.match(membership, /constantTimeTextEquals_/);
  assert.match(membership, /computeHmacSha256Signature/);
  assert.match(membership, /MEMBER_ACCESS_REPLAYED/);
  assert.doesNotMatch(functionSource(membership, 'internalMemberAccessCheck_'), /serviceToken/);
  assert.doesNotMatch(functionSource(membership, 'internalMemberAccessCheck_'), /tier|canManageMembers/);

  assert.ok(points.indexOf('verifyLineIdToken_') < points.indexOf('if (isPointsMemberAction_(action))'));
  assert.match(functionSource(points, 'isPointsMemberAction_'), /member\.|stamp\.record|reward\.claim|reward\.prepare/);
  assert.doesNotMatch(functionSource(points, 'isPointsMemberAction_'), /admin\./);
  assert.match(points, /MEMBERSHIP_ACCESS_UNAVAILABLE/);
  assert.match(points, /MEMBERSHIP_INACTIVE/);
  assert.match(points, /memberAccessGateSignature_\(serviceToken, 'points'/);
  assert.match(points, /getProperty\('MEMBERHUB_POINTS_ACCESS_GATE_SECRET'\)/);
  assert.doesNotMatch(points, /getProperty\('MEMBERHUB_CALENDAR_ACCESS_GATE_SECRET'\)/);
  assert.doesNotMatch(functionSource(points, 'requireMemberHubAccess_'), /serviceToken:\s*serviceToken/);

  assert.ok(calendar.indexOf('authenticateLine_') < calendar.indexOf("if (clientType === 'user') requireMemberHubAccess_"));
  assert.doesNotMatch(functionSource(calendar, 'requireMemberHubAccess_'), /authorizeAdmin_|role|tier/);
  assert.match(calendar, /memberAccessGateSignature_\(serviceToken, 'calendar'/);
  assert.match(calendar, /getProperty\('MEMBERHUB_CALENDAR_ACCESS_GATE_SECRET'\)/);
  assert.doesNotMatch(calendar, /getProperty\('MEMBERHUB_POINTS_ACCESS_GATE_SECRET'\)/);
  assert.doesNotMatch(functionSource(calendar, 'requireMemberHubAccess_'), /serviceToken:\s*serviceToken/);
  assert.ok(manifest.urlFetchWhitelist.some((url) => /script\.google\.com\/macros\/s\/.+\/exec$/.test(url)));
});

test('points and calendar access checks fail closed on denial and malformed responses', () => {
  const secret = 's'.repeat(32);
  const endpoint = 'https://script.google.com/macros/s/test-deployment/exec';
  const cases = [
    { body: { ok: true, data: { allowed: false } }, code: 'MEMBERSHIP_INACTIVE' },
    { body: { ok: true, data: { allowed: false, membershipStatus: 'unregistered' } }, code: 'MEMBERSHIP_REGISTRATION_REQUIRED' },
    { body: { ok: true, data: {} }, code: 'MEMBERSHIP_ACCESS_UNAVAILABLE' }
  ];

  for (const relative of ['modules/points/gas/Code.gs', 'modules/calendar/gas/Code.gs']) {
    const source = read(relative);
    for (const scenario of cases) {
      let sentPayload = null;
      const requestedProperties = [];
      const expectedSecretProperty = relative.includes('/points/')
        ? 'MEMBERHUB_POINTS_ACCESS_GATE_SECRET'
        : 'MEMBERHUB_CALENDAR_ACCESS_GATE_SECRET';
      const context = {
        Date, JSON, String,
        PropertiesService: { getScriptProperties: () => ({ getProperty: (key) => {
          requestedProperties.push(key);
          return key.endsWith('_URL') ? endpoint : secret;
        } }) },
        UrlFetchApp: { fetch: (url, options) => {
          sentPayload = options.payload;
          return { getResponseCode: () => 200, getContentText: () => JSON.stringify(scenario.body) };
        } },
        Utilities: { getUuid: () => '12345678-1234-1234-1234-1234567890ab' },
        randomHex_: () => 'b'.repeat(32),
        memberAccessGateSignature_: () => 'a'.repeat(64),
        cleanText_: (value) => String(value || '').trim(),
        fail_: publicError,
        ApiError: class ApiError extends Error {
          constructor(status, code, message) { super(message); this.code = code; this.status = status; }
        }
      };
      vm.createContext(context);
      vm.runInContext(functionSource(source, 'requireMemberHubAccess_') + '\n;globalThis.check = requireMemberHubAccess_;', context);
      assert.throws(
        () => context.check('U-ONE'),
        (error) => error && (error.publicCode === scenario.code || error.code === scenario.code),
        relative + ' must fail closed with ' + scenario.code
      );
      assert.equal(sentPayload.serviceToken, undefined);
      assert.equal(JSON.stringify(sentPayload).includes(secret), false);
      assert.deepEqual(requestedProperties, ['MEMBERHUB_ACCESS_GATE_URL', expectedSecretProperty]);
      assert.match(sentPayload.signature, /^[a-f0-9]{64}$/);
      assert.match(sentPayload.nonce, /^[a-f0-9]{32}$/);
      assert.match(sentPayload.timestamp, /^\d{10}$/);
    }
  }
});
