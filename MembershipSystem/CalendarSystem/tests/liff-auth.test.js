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

test('external browsers force a fresh LIFF login on every user and admin page entry', () => {
  const userApp = read('user/app.js');
  const adminApp = read('admin/app.js');

  [userApp, adminApp].forEach(app => {
    assert.match(app, /FRESH_LOGIN_PARAM = 'calendar_reauth'/);
    assert.match(app, /!window\.liff\.isInClient\(\)/);
    assert.match(app, /window\.liff\.logout\(\)/);
    assert.match(app, /window\.liff\.login\(\{ redirectUri/);
    assert.match(app, /freshLoginUrl\(\)/);
  });
});

test('LIFF ID tokens are not persisted in browser storage or URL', () => {
  const userApp = read('user/app.js');
  const adminApp = read('admin/app.js');

  assert.doesNotMatch(userApp, /localStorage|sessionStorage/);
  assert.doesNotMatch(adminApp, /localStorage|sessionStorage/);
  assert.doesNotMatch(userApp, /searchParams\.set\([^\n]*idToken/i);
  assert.doesNotMatch(adminApp, /searchParams\.set\([^\n]*idToken/i);
});

test('storage creates identity, admin permission, calendar and audit sheets', () => {
  const storage = read('gas/StorageBootstrap.gs');

  assert.match(storage, /identitiesSheet: 'LineIdentities'/);
  assert.match(storage, /'lineUserId', 'surface', 'displayName', 'pictureUrl'/);
  assert.match(storage, /'firstSeenAt', 'lastLoginAt', 'loginCount'/);
  assert.match(storage, /adminPermissionsSheet: 'AdminPermissions'/);
  assert.match(storage, /'lineUserId', 'displayName', 'canManageCalendar', 'status', 'note', 'firstSeenAt'/);
});

test('runtime storage binding fails closed and cannot silently create a different database', () => {
  const storage = read('gas/StorageBootstrap.gs');
  const runtimeStart = storage.indexOf('function ensureCalendarStorage_()');
  const runtimeEnd = storage.indexOf('function openCalendarSpreadsheet_', runtimeStart);
  const runtime = storage.slice(runtimeStart, runtimeEnd);

  assert.match(runtime, /CALENDAR_SPREADSHEET_ID is missing/);
  assert.match(runtime, /openCalendarSpreadsheet_\(existingId\)/);
  assert.doesNotMatch(runtime, /SpreadsheetApp\.create/);
  assert.match(storage, /function diagnoseCalendarStorage\(\)/);
  assert.match(storage, /writeProbe/);
});

test('successful user and admin sessions persist and verify login identity data', () => {
  const gas = read('gas/Code.gs');

  assert.match(gas, /version: '1\.5\.0'/);
  assert.match(gas, /function memberMe_\(identity\) \{\s*recordIdentityLogin_\(identity, 'user'\);/);
  assert.match(gas, /function adminSession_\(identity\) \{\s*recordIdentityLogin_\(identity, 'admin'\);/);
  assert.match(gas, /function recordIdentityLogin_\(identity, surface\)/);
  assert.match(gas, /lastLoginAt: now/);
  assert.match(gas, /loginCount: '1'/);
  assert.match(gas, /verifyIdentityPersistence_\(sheet, lineUserId, authSurface, now\)/);
  assert.match(gas, /function verifyIdentityPersistence_/);
  assert.match(gas, /STORAGE_WRITE_FAILED/);
  assert.match(gas, /LOGIN_SUCCESS/);
});

test('sheet writes flush and surface structured storage failures without logging credentials', () => {
  const gas = read('gas/Code.gs');

  assert.match(gas, /function appendObject_\(sheet, object\)/);
  assert.match(gas, /function writeObjectAtRow_\(sheet, rowNumber, object\)/);
  assert.match(gas, /SpreadsheetApp\.flush\(\)/);
  assert.match(gas, /calendar_sheet_append_failed/);
  assert.match(gas, /calendar_sheet_update_failed/);
  assert.doesNotMatch(gas, /console\.(?:log|info|warn|error)[^\n]*idToken/i);
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

test('duplicate identity or permission rows fail closed and remote event text avoids innerHTML', () => {
  const gas = read('gas/Code.gs');
  const userApp = read('user/app.js');
  const adminApp = read('admin/app.js');

  assert.match(gas, /LINE 身分資料存在重複紀錄/);
  assert.match(gas, /管理權限資料存在重複 LINE 使用者/);
  assert.match(gas, /DATA_INTEGRITY_ERROR/);
  assert.doesNotMatch(userApp, /innerHTML/);
  assert.doesNotMatch(adminApp, /innerHTML/);
  assert.match(userApp, /textContent/);
  assert.match(adminApp, /textContent/);
});
