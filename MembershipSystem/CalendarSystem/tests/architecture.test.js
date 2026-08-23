'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

test('CalendarSystem V2 contains only the new separated client/GAS structure', () => {
  const required = [
    'index.html',
    'config.json',
    'README.md',
    'user/index.html',
    'user/styles.css',
    'user/app.js',
    'admin/index.html',
    'admin/styles.css',
    'admin/app.js',
    'gas/Code.gs',
    'gas/Auth.gs',
    'gas/CalendarService.gs',
    'gas/StorageBootstrap.gs',
    'gas/appsscript.json'
  ];

  required.forEach((file) => assert.equal(exists(file), true, `missing ${file}`));
});

test('obsolete CalendarSystem V1 files are removed', () => {
  const obsolete = [
    'user/auth.css',
    'gas/Diagnostics.gs',
    'tests/gas-diagnostics.test.js',
    'tests/liff-auth.test.js'
  ];

  obsolete.forEach((file) => assert.equal(exists(file), false, `obsolete file still exists: ${file}`));
});

test('public config separates User LIFF and Admin LIFF and contains no secret field', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
  assert.equal(typeof config.gasWebAppUrl, 'string');
  assert.equal(typeof config.userLiffId, 'string');
  assert.equal(typeof config.adminLiffId, 'string');
  assert.notEqual(config.userLiffId, config.adminLiffId);

  const keys = Object.keys(config).map((key) => key.toLowerCase());
  assert.equal(keys.some((key) => key.includes('secret') || key.includes('token') || key.includes('password')), false);
});
