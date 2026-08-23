'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const diagnostics = fs.readFileSync(path.join(root, 'gas/Diagnostics.gs'), 'utf8');

test('LINE diagnostics use an invalid probe token and never accept or expose a real token', () => {
  assert.match(diagnostics, /function diagnoseLineAuthService\(\)/);
  assert.match(diagnostics, /calendar_diagnostic_invalid_token/);
  assert.match(diagnostics, /https:\/\/api\.line\.me\/oauth2\/v2\.1\/verify/);
  assert.doesNotMatch(diagnostics, /function diagnoseLineAuthService\([^)]*idToken/);
  assert.doesNotMatch(diagnostics, /result\.[A-Za-z0-9_]*channelId\s*=/i);
});

test('LINE diagnostics distinguish reachability from authorization failures', () => {
  assert.match(diagnostics, /externalRequestReachable: false/);
  assert.match(diagnostics, /result\.externalRequestReachable = true/);
  assert.match(diagnostics, /result\.httpStatus = response\.getResponseCode\(\)/);
  assert.match(diagnostics, /status = 'EXTERNAL_REQUEST_FAILED'/);
  assert.match(diagnostics, /requiresAuthorization/);
});

test('combined GAS diagnostic remains editor-only and reuses storage diagnostics', () => {
  assert.match(diagnostics, /function diagnoseCalendarSystem\(\)/);
  assert.match(diagnostics, /diagnoseCalendarStorage\(\)/);
  assert.doesNotMatch(diagnostics, /doGet|doPost/);
});
