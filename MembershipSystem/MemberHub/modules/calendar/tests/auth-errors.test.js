'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const auth = fs.readFileSync(path.join(root, 'gas/Auth.gs'), 'utf8');

test('LINE Verify audience failures are reported as channel mismatch', () => {
  assert.match(auth, /Invalid IdToken Audience\./);
  assert.match(auth, /AUTH_CHANNEL_MISMATCH/);
  assert.match(auth, /expectedChannelId/);
});

test('LINE Verify expiration failures remain distinct from invalid tokens', () => {
  assert.match(auth, /IdToken expired\./);
  assert.match(auth, /AUTH_EXPIRED/);
});
