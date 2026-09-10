'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('user and admin require LIFF ID tokens before API calls', () => {
  const user = read('user/app.js');
  const admin = read('admin/app.js');
  assert.match(user, /getIDToken\(\)/);
  assert.match(admin, /getIDToken\(\)/);
  assert.match(user, /LINE 登入已失效/);
  assert.match(admin, /LINE 登入已失效/);
});

test('authentication failures never fall back to anonymous database access', () => {
  const clients = [read('user/app.js'), read('admin/app.js')].join('\n');
  assert.match(clients, /AUTH_REQUIRED/);
  assert.match(clients, /AUTH_INVALID/);
  assert.doesNotMatch(clients, /\.from\(|createClient\(|supabase-js/);
});

test('README documents server-side LINE claim verification and channel separation', () => {
  const readme = read('README.md');
  assert.match(readme, /Server 驗證 `sub`、`aud`、`iss`、`exp`/);
  assert.match(readme, /User Channel ID：`2005939681`/);
  assert.match(readme, /Admin Channel ID：`2011356226`/);
  assert.match(readme, /User LIFF token 不可拿去呼叫 Admin surface/);
});
