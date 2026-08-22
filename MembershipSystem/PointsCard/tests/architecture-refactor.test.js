'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
function read(relativePath) { return fs.readFileSync(path.join(root, relativePath), 'utf8'); }

test('read-only transport policy includes safe reads but never mutation actions', () => {
  const source = read('shared/common.js');
  const setMatch = source.match(/const READ_ONLY_ACTIONS = new Set\(\[([\s\S]*?)\]\);/);
  assert.ok(setMatch, 'READ_ONLY_ACTIONS declaration missing');
  const policy = setMatch[1];
  assert.match(policy, /'member\.point-notifications\.list'/);
  assert.match(policy, /'admin\.dashboard'/);
  assert.doesNotMatch(policy, /'member\.point-notification\.read'/);
  assert.doesNotMatch(policy, /'admin\.points\.grant'/);
  assert.doesNotMatch(policy, /'stamp\.record'/);
  assert.doesNotMatch(policy, /'reward\.claim'/);
});

test('frontend observability filters expected business errors while retaining security and system failures', () => {
  const source = read('shared/common.js');
  const setMatch = source.match(/const EXPECTED_API_ERROR_CODES = new Set\(\[([\s\S]*?)\]\);/);
  assert.ok(setMatch, 'EXPECTED_API_ERROR_CODES declaration missing');
  const expected = setMatch[1];
  assert.match(expected, /'REQUEST_CONFLICT'/);
  assert.match(expected, /'CARD_UNAVAILABLE'/);
  assert.match(expected, /'REWARD_EXPIRED'/);
  assert.doesNotMatch(expected, /'UNAUTHENTICATED'/);
  assert.doesNotMatch(expected, /'FORBIDDEN'/);
  assert.doesNotMatch(expected, /'RATE_LIMITED'/);
  assert.doesNotMatch(expected, /'INTERNAL_ERROR'/);
  assert.doesNotMatch(expected, /'DATA_INTEGRITY_ERROR'/);
  assert.match(source, /value\.indexOf\('INVALID_'\) === 0/);
  assert.match(source, /\/_NOT_FOUND\$\/\.test\(value\)/);
  assert.match(source, /if \(shouldReportApiError\(error\.code\)\)/);
  assert.match(source, /error_code: safeContext\.code \|\| 'unknown'/);
});

test('error reporting keeps the existing PII and credential sanitizers', () => {
  const source = read('shared/common.js');
  assert.match(source, /\[url\]/);
  assert.match(source, /\[line-user-id\]/);
  assert.match(source, /\[hex-token\]/);
  assert.match(source, /\[jwt\]/);
  assert.match(source, /window\.Sentry\.captureException/);
});

test('LINE transport ownership is single-sourced across business services', () => {
  const messaging = read('gas/LineMessagingService.gs');
  const grant = read('gas/AdminPointGrantService.gs');
  const reminder = read('gas/TicketNotificationService.gs');
  assert.match(messaging, /LINE_MESSAGING_CHANNEL_ACCESS_TOKEN/);
  assert.match(messaging, /UrlFetchApp\.fetch/);
  assert.doesNotMatch(grant, /LINE_MESSAGING_CHANNEL_ACCESS_TOKEN|UrlFetchApp\.fetch/);
  assert.doesNotMatch(reminder, /LINE_MESSAGING_CHANNEL_ACCESS_TOKEN|UrlFetchApp\.fetch/);
});
