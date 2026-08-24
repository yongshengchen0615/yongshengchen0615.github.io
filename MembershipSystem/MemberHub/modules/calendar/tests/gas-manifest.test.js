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

test('GAS URL fetch whitelist is restricted to LINE Verify and Membership access gate', () => {
  assert.deepEqual(manifest.urlFetchWhitelist, [
    'https://api.line.me/oauth2/v2.1/verify',
    'https://script.google.com/macros/s/AKfycbxql3uOcZA-mGuAX3PK0tz3gnHGWAP2RGKwJ2XnQYGhCPUV1QUCof_cJF61NcteuCIO/exec'
  ]);
  assert.equal(manifest.urlFetchWhitelist.some((value) => String(value).includes('*')), false);
});

test('GAS runtime and timezone are explicit', () => {
  assert.equal(manifest.runtimeVersion, 'V8');
  assert.equal(manifest.timeZone, 'Asia/Taipei');
});
