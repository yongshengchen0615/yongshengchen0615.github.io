'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('config defines different LIFF settings for user and admin surfaces', () => {
  const config = JSON.parse(read('config.json'));

  assert.equal(config.liffId, 'YOUR_CALENDAR_USER_LIFF_ID');
  assert.equal(config.adminLiffId, 'YOUR_CALENDAR_ADMIN_LIFF_ID');
  assert.notEqual(config.liffId, config.adminLiffId);
});

test('user surface initializes the user LIFF and sends raw ID token to GAS', () => {
  const html = read('user/index.html');
  const app = read('user/app.js');

  assert.match(html, /https:\/\/static\.line-scdn\.net\/liff\/edge\/2\/sdk\.js/);
  assert.match(app, /liff\.init\(\{ liffId: state\.config\.liffId \}\)/);
  assert.match(app, /liff\.getIDToken\(\)/);
  assert.match(app, /body\.set\('idToken', state\.idToken\)/);
});

test('user ID token is kept in memory instead of browser storage or URL', () => {
  const app = read('user/app.js');

  assert.doesNotMatch(app, /localStorage/);
  assert.doesNotMatch(app, /sessionStorage/);
  assert.doesNotMatch(app, /searchParams\.set\([^\n]*idToken/i);
});

test('admin surface uses a dedicated LIFF ID and sends both authentication factors', () => {
  const html = read('admin/index.html');
  const app = read('admin/app.js');

  assert.match(html, /https:\/\/static\.line-scdn\.net\/liff\/edge\/2\/sdk\.js/);
  assert.match(app, /liff\.init\(\{ liffId: state\.config\.adminLiffId \}\)/);
  assert.match(app, /liff\.getIDToken\(\)/);
  assert.match(app, /body\.set\('idToken', state\.idToken\)/);
  assert.match(app, /body\.set\('adminToken', state\.token\)/);
  assert.doesNotMatch(html, /查看用戶端/);
  assert.doesNotMatch(html, /\.\.\/user\//);
});

test('admin LINE ID token is not persisted in browser storage', () => {
  const app = read('admin/app.js');

  assert.doesNotMatch(app, /localStorage/);
  assert.doesNotMatch(app, /sessionStorage\.setItem\([^\n]*idToken/i);
  assert.match(app, /sessionStorage\.setItem\('calendarAdminToken', token\)/);
});

test('GAS verifies user and admin LIFF tokens against separate channel settings', () => {
  const gas = read('gas/Code.gs');

  assert.match(gas, /userLineChannelProperty: 'USER_LINE_LOGIN_CHANNEL_ID'/);
  assert.match(gas, /adminLineChannelProperty: 'ADMIN_LINE_LOGIN_CHANNEL_ID'/);
  assert.match(gas, /https:\/\/api\.line\.me\/oauth2\/v2\.1\/verify/);
  assert.match(gas, /payload: \{ id_token: idToken, client_id: channelId \}/);
  assert.match(gas, /String\(identity\.aud\) !== String\(channelId\)/);
  assert.match(gas, /case 'calendar\.month': \{\s*const identity = requireLineIdentity_\(request\.idToken, 'user'\);/);
  assert.match(gas, /case 'calendar\.day': \{\s*const identity = requireLineIdentity_\(request\.idToken, 'user'\);/);
  assert.match(gas, /case 'admin\.events\.list': \{\s*const identity = requireLineIdentity_\(request\.idToken, 'admin'\);\s*requireAdmin_\(request\.adminToken\);/);
  assert.match(gas, /case 'admin\.event\.save': \{\s*const identity = requireLineIdentity_\(request\.idToken, 'admin'\);\s*requireAdmin_\(request\.adminToken\);/);
  assert.match(gas, /case 'admin\.event\.delete': \{\s*const identity = requireLineIdentity_\(request\.idToken, 'admin'\);\s*requireAdmin_\(request\.adminToken\);/);
});

test('remote event text is rendered without innerHTML', () => {
  const userApp = read('user/app.js');
  const adminApp = read('admin/app.js');
  assert.doesNotMatch(userApp, /innerHTML/);
  assert.doesNotMatch(adminApp, /innerHTML/);
  assert.match(userApp, /textContent/);
  assert.match(adminApp, /textContent/);
});
