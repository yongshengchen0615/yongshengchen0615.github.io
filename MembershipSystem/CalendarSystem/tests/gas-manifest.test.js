'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'gas/appsscript.json'), 'utf8'));

test('GAS manifest has only required external request and spreadsheet scopes', () => {
  assert.deepEqual(manifest.oauthScopes, [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/script.external_request'
  ]);
});

test('GAS URL fetch whitelist is restricted to LINE Verify and Profile APIs', () => {
  assert.deepEqual(manifest.urlFetchWhitelist, [
    'https://api.line.me/oauth2/v2.1/verify',
    'https://api.line.me/v2/profile'
  ]);
  assert.equal(manifest.urlFetchWhitelist.some((value) => String(value).includes('*')), false);
});

test('GAS runtime and timezone are explicit', () => {
  assert.equal(manifest.runtimeVersion, 'V8');
  assert.equal(manifest.timeZone, 'Asia/Taipei');
});
