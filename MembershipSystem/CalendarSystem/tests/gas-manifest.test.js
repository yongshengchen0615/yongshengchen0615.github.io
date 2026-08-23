'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'gas/appsscript.json'), 'utf8'));

test('GAS manifest authorizes and allowlists the LINE Verify endpoint', () => {
  const scopes = Array.isArray(manifest.oauthScopes) ? manifest.oauthScopes : [];
  const allowlist = Array.isArray(manifest.urlFetchWhitelist) ? manifest.urlFetchWhitelist : [];

  assert.ok(scopes.includes('https://www.googleapis.com/auth/script.external_request'));
  assert.deepEqual(allowlist, ['https://api.line.me/oauth2/v2.1/verify']);
});

test('GAS URL fetch allowlist does not use a wildcard', () => {
  const allowlist = Array.isArray(manifest.urlFetchWhitelist) ? manifest.urlFetchWhitelist : [];
  assert.equal(allowlist.some(value => String(value).includes('*')), false);
});
