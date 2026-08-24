'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('GAS verifies LINE ID tokens server-side via POST and binds them to the expected channel', () => {
  const auth = read('gas/Auth.gs');
  assert.match(auth, /oauth2\/v2\.1\/verify/);
  assert.match(auth, /method:\s*'post'/);
  assert.match(auth, /application\/x-www-form-urlencoded/);
  assert.match(auth, /id_token:\s*idToken/);
  assert.match(auth, /client_id:\s*expectedChannelId/);
  assert.match(auth, /verifyData\.aud/);
  assert.match(auth, /verifyData\.exp/);
  assert.match(auth, /verifyData\.iss/);
  assert.match(auth, /verifyData\.sub/);
  assert.match(auth, /CALENDAR_USER_LINE_CHANNEL_ID/);
  assert.match(auth, /CALENDAR_ADMIN_LINE_CHANNEL_ID/);
  assert.doesNotMatch(auth, /\?access_token=/);
});

test('frontend uses LIFF ID tokens instead of access-token verification', () => {
  const clients = read('user/app.js') + '\n' + read('admin/app.js');
  assert.match(clients, /getIDToken\(\)/);
  assert.doesNotMatch(clients, /getAccessToken\(\)/);
});

test('admin authorization is server-side and backed by the Admins sheet', () => {
  const auth = read('gas/Auth.gs');
  const code = read('gas/Code.gs');
  assert.match(auth, /findRecordWithRow_\('Admins'/);
  assert.match(auth, /status !== 'active'/);
  assert.match(auth, /role !== 'admin'/);
  assert.doesNotMatch(code, /request\.(role|isAdmin|admin)/);
});

test('first admin login creates only a pending/non-privileged row', () => {
  const auth = read('gas/Auth.gs');
  assert.match(auth, /role:\s*'none'/);
  assert.match(auth, /status:\s*'pending'/);
  assert.match(auth, /ADMIN_PENDING/);
});

test('calendar writes use optimistic concurrency and soft archive', () => {
  const service = read('gas/CalendarService.gs');
  assert.match(service, /expectedUpdatedAt/);
  assert.match(service, /CONFLICT/);
  assert.match(service, /status:\s*'archived'/);
  assert.match(service, /CALENDAR_ITEM_ARCHIVE/);
});

test('spreadsheet text is protected against formula injection', () => {
  const storage = read('gas/StorageBootstrap.gs');
  assert.match(storage, /escapeSheetValue_/);
  assert.match(storage, /\^\[=\+\\-@\]/);
});

test('ID tokens are not explicitly logged or persisted', () => {
  const gas = [
    read('gas/Code.gs'),
    read('gas/Auth.gs'),
    read('gas/CalendarService.gs'),
    read('gas/StorageBootstrap.gs')
  ].join('\n');

  assert.doesNotMatch(gas, /console\.(log|info|warn|error)\([^\n]*idToken/i);
  assert.doesNotMatch(gas, /appendRecord_\([^\n]*idToken/i);
  assert.doesNotMatch(gas, /id_token[^\n]*console/i);
});
