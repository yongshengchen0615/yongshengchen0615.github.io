'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('config defines different LIFF settings for user and admin surfaces', () => {
  const config = JSON.parse(read('config.json'));

  assert.match(String(config.apiUrl || ''), /^https:\/\//);
  assert.ok(String(config.liffId || '').trim());
  assert.ok(String(config.adminLiffId || '').trim());
  assert.notEqual(config.liffId, config.adminLiffId);
});

test('Apps Script manifest grants UrlFetch external request scope for LINE verification', () => {
  const manifest = JSON.parse(read('gas/appsscript.json'));
  const scopes = Array.isArray(manifest.oauthScopes) ? manifest.oauthScopes : [];

  assert.ok(scopes.includes('https://www.googleapis.com/auth/spreadsheets'));
  assert.ok(scopes.includes('https://www.googleapis.com/auth/script.external_request'));
});

test('user surface initializes the user LIFF and sends raw ID token to GAS', () => {
  const html = read('user/index.html');
  const app = read('user/app.js');

  assert.match(html, /https:\/\/static\.line-scdn\.net\/liff\/edge\/2\/sdk\.js/);
  assert.match(app, /liff\.init\(\{ liffId: state\.config\.liffId \}\)/);
  assert.match(app, /liff\.getIDToken\(\)/);
  assert.match(app, /body\.set\('idToken', state\.idToken\)/);
});

test('admin surface uses a dedicated LIFF ID without a separate admin credential', () => {
  const html = read('admin/index.html');
  const app = read('admin/app.js');

  assert.match(html, /https:\/\/static\.line-scdn\.net\/liff\/edge\/2\/sdk\.js/);
  assert.match(app, /liff\.init\(\{ liffId: state\.config\.adminLiffId \}\)/);
  assert.match(app, /liff\.getIDToken\(\)/);
  assert.match(app, /body\.set\('idToken', state\.idToken\)/);
  assert.doesNotMatch(app, /adminToken/);
  assert.doesNotMatch(app, /calendarAdminToken/);
  assert.doesNotMatch(html, /管理憑證|type="password"/i);
  assert.doesNotMatch(html, /查看用戶端/);
  assert.doesNotMatch(html, /\.\.\/user\//);
});

test('LIFF ID tokens are not persisted in browser storage or URL', () => {
  const userApp = read('user/app.js');
  const adminApp = read('admin/app.js');

  assert.doesNotMatch(userApp, /localStorage|sessionStorage/);
  assert.doesNotMatch(adminApp, /localStorage|sessionStorage/);
  assert.doesNotMatch(userApp, /searchParams\.set\([^\n]*idToken/i);
  assert.doesNotMatch(adminApp, /searchParams\.set\([^\n]*idToken/i);
});

test('storage creates an AdminPermissions sheet with an explicit permission field', () => {
  const storage = read('gas/StorageBootstrap.gs');

  assert.match(storage, /adminPermissionsSheet: 'AdminPermissions'/);
  assert.match(storage, /'lineUserId', 'displayName', 'canManageCalendar', 'status', 'note', 'firstSeenAt'/);
});

test('new admin identities are fail-closed until the sheet permission is manually enabled', () => {
  const gas = read('gas/Code.gs');

  assert.match(gas, /canManageCalendar: 'FALSE'/);
  assert.match(gas, /status: 'active'/);
  assert.match(gas, /function requireCalendarAdmin_\(identity\)/);
  assert.match(gas, /permission\.status !== 'active' \|\| !permission\.canManageCalendar/);
  assert.match(gas, /fail_\('FORBIDDEN'/);
});

test('GAS verifies separate LIFF channels and checks sheet authorization on every admin action', () => {
  const gas = read('gas/Code.gs');

  assert.match(gas, /userLineChannelProperty: 'USER_LINE_LOGIN_CHANNEL_ID'/);
  assert.match(gas, /adminLineChannelProperty: 'ADMIN_LINE_LOGIN_CHANNEL_ID'/);
  assert.match(gas, /https:\/\/api\.line\.me\/oauth2\/v2\.1\/verify/);
  assert.match(gas, /payload: \{ id_token: idToken, client_id: channelId \}/);
  assert.match(gas, /String\(identity\.aud\) !== String\(channelId\)/);
  assert.match(gas, /case 'admin\.session': \{\s*const identity = requireLineIdentity_\(request\.idToken, 'admin'\);/);
  assert.match(gas, /case 'admin\.events\.list': \{\s*const identity = requireLineIdentity_\(request\.idToken, 'admin'\);\s*requireCalendarAdmin_\(identity\);/);
  assert.match(gas, /case 'admin\.event\.save': \{\s*const identity = requireLineIdentity_\(request\.idToken, 'admin'\);\s*requireCalendarAdmin_\(identity\);/);
  assert.match(gas, /case 'admin\.event\.delete': \{\s*const identity = requireLineIdentity_\(request\.idToken, 'admin'\);\s*requireCalendarAdmin_\(identity\);/);
  assert.doesNotMatch(gas, /CALENDAR_ADMIN_TOKEN|adminTokenProperty|request\.adminToken/);
});

test('duplicate permission rows fail closed and remote event text avoids innerHTML', () => {
  const gas = read('gas/Code.gs');
  const userApp = read('user/app.js');
  const adminApp = read('admin/app.js');

  assert.match(gas, /matches\.length > 1/);
  assert.match(gas, /DATA_INTEGRITY_ERROR/);
  assert.doesNotMatch(userApp, /innerHTML/);
  assert.doesNotMatch(adminApp, /innerHTML/);
  assert.match(userApp, /textContent/);
  assert.match(adminApp, /textContent/);
});
