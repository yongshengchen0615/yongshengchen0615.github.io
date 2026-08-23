'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('user surface initializes LIFF and sends raw ID token to GAS', () => {
  const html = read('user/index.html');
  const app = read('user/app.js');

  assert.match(html, /https:\/\/static\.line-scdn\.net\/liff\/edge\/2\/sdk\.js/);
  assert.match(app, /liff\.init\(\{ liffId: state\.config\.liffId \}\)/);
  assert.match(app, /liff\.getIDToken\(\)/);
  assert.match(app, /body\.set\('idToken', state\.idToken\)/);
});

test('user token is kept in memory instead of browser storage or URL', () => {
  const app = read('user/app.js');

  assert.doesNotMatch(app, /localStorage/);
  assert.doesNotMatch(app, /sessionStorage/);
  assert.doesNotMatch(app, /searchParams\.set\([^\n]*idToken/i);
});

test('GAS verifies LINE ID token before returning calendar data', () => {
  const gas = read('gas/Code.gs');

  assert.match(gas, /https:\/\/api\.line\.me\/oauth2\/v2\.1\/verify/);
  assert.match(gas, /payload: \{ id_token: idToken, client_id: channelId \}/);
  assert.match(gas, /String\(identity\.aud\) !== String\(channelId\)/);
  assert.match(gas, /identity\.exp/);
  assert.match(gas, /case 'calendar\.month': \{\s*const identity = requireLineIdentity_\(request\.idToken\);/);
  assert.match(gas, /case 'calendar\.day': \{\s*const identity = requireLineIdentity_\(request\.idToken\);/);
});

test('admin remains independent from LIFF and has no user-view shortcut', () => {
  const html = read('admin/index.html');
  const app = read('admin/app.js');

  assert.doesNotMatch(html, /查看用戶端/);
  assert.doesNotMatch(html, /\.\.\/user\//);
  assert.doesNotMatch(app, /liff\./);
  assert.match(app, /adminToken/);
});

test('remote event text is rendered without innerHTML', () => {
  const userApp = read('user/app.js');
  assert.doesNotMatch(userApp, /innerHTML/);
  assert.match(userApp, /textContent/);
});
