'use strict';

const assert = require('node:assert/strict');
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

test('membership access gate authenticates the service and ignores membership tier', () => {
  const source = read('modules/membership/gas/Code.gs');
  const secret = 's'.repeat(32);
  let storedMember = { membershipStatus: 'suspended', tier: 'platinum', expiresAt: '' };
  const context = {
    Date, Math, String,
    MEMBER_HEADERS: ['member'],
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => secret }) },
    cleanText_: (value, max, required) => {
      const text = String(value == null ? '' : value).trim().slice(0, max);
      if (required && !text) publicError('INVALID_INPUT', 'required');
      return text;
    },
    tokenFingerprint_: (value) => 'hash:' + value,
    rateLimit_: () => {},
    getMembersSheet_: () => ({ getRange: () => ({ getValues: () => [[storedMember]] }) }),
    findMemberRow_: () => storedMember ? 2 : 0,
    rowToMember_: (row) => row[0],
    Utilities: { formatDate: () => '2026-08-25' },
    fail_: publicError
  };
  vm.createContext(context);
  vm.runInContext(
    functionSource(source, 'constantTimeTextEquals_') + '\n' +
      functionSource(source, 'isMembershipUsable_') + '\n' +
      functionSource(source, 'internalMemberAccessCheck_') +
      '\n;globalThis.check = internalMemberAccessCheck_;',
    context
  );

  assert.deepEqual(
    JSON.parse(JSON.stringify(context.check({ serviceToken: secret, lineUserId: 'U-ONE' }))),
    { allowed: false, membershipStatus: 'inactive' }
  );
  assert.throws(
    () => context.check({ serviceToken: 'x'.repeat(32), lineUserId: 'U-ONE' }),
    (error) => error && error.publicCode === 'FORBIDDEN'
  );
  storedMember = { membershipStatus: 'active', tier: 'platinum', expiresAt: '2026-08-25' };
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.check({ serviceToken: secret, lineUserId: 'U-ACTIVE' }))),
    { allowed: true, membershipStatus: 'active' }
  );
  storedMember = { membershipStatus: 'disabled', tier: 'platinum', expiresAt: '' };
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.check({ serviceToken: secret, lineUserId: 'U-DISABLED' }))),
    { allowed: false, membershipStatus: 'inactive' }
  );
  storedMember = null;
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.check({ serviceToken: secret, lineUserId: 'U-NEW' }))),
    { allowed: false, membershipStatus: 'unregistered' }
  );

  storedMember = { membershipStatus: 'active', tier: 'platinum', expiresAt: '2026-08-24' };
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.check({ serviceToken: secret, lineUserId: 'U-EXPIRED' }))),
    { allowed: false, membershipStatus: 'inactive' }
  );
});

test('points and calendar gate member actions only after LINE authentication', () => {
  const membership = read('modules/membership/gas/Code.gs');
  const points = read('modules/points/gas/Code.gs');
  const calendar = read('modules/calendar/gas/Code.gs');
  const manifest = JSON.parse(read('modules/calendar/gas/appsscript.json'));

  assert.ok(membership.indexOf("action === 'internal.member-access.check'") < membership.indexOf('const idToken ='));
  assert.match(membership, /MEMBERHUB_ACCESS_GATE_SECRET/);
  assert.match(membership, /constantTimeTextEquals_/);
  assert.doesNotMatch(functionSource(membership, 'internalMemberAccessCheck_'), /tier|canManageMembers/);

  assert.ok(points.indexOf('verifyLineIdToken_') < points.indexOf('if (isPointsMemberAction_(action))'));
  assert.match(functionSource(points, 'isPointsMemberAction_'), /member\.|stamp\.record|reward\.claim|reward\.prepare/);
  assert.doesNotMatch(functionSource(points, 'isPointsMemberAction_'), /admin\./);
  assert.match(points, /MEMBERSHIP_ACCESS_UNAVAILABLE/);
  assert.match(points, /MEMBERSHIP_INACTIVE/);

  assert.ok(calendar.indexOf('authenticateLine_') < calendar.indexOf("if (clientType === 'user') requireMemberHubAccess_"));
  assert.doesNotMatch(functionSource(calendar, 'requireMemberHubAccess_'), /authorizeAdmin_|role|tier/);
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
      const context = {
        JSON, String,
        PropertiesService: { getScriptProperties: () => ({ getProperty: (key) => key.endsWith('_URL') ? endpoint : secret }) },
        UrlFetchApp: { fetch: () => ({ getResponseCode: () => 200, getContentText: () => JSON.stringify(scenario.body) }) },
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
    }
  }
});
