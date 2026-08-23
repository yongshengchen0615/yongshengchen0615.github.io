'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('GAS verifies LINE access tokens server-side and binds them to the expected channel', () => {
  const auth = read('gas/Auth.gs');
  assert.match(auth, /oauth2\/v2\.1\/verify/);
  assert.match(auth, /client_id/);
  assert.match(auth, /CALENDAR_USER_LINE_CHANNEL_ID/);
  assert.match(auth, /CALENDAR_ADMIN_LINE_CHANNEL_ID/);
  assert.match(auth, /api\.line\.me\/v2\/profile/);
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

test('access tokens are not explicitly logged or persisted', () => {
  const files = [
    read('gas/Code.gs'),
    read('gas/Auth.gs'),
    read('gas/CalendarService.gs'),
    read('gas/StorageBootstrap.gs')
  ].join('\n');

  assert.doesNotMatch(files, /console\.(log|info|warn|error)\([^\n]*accessToken/i);
  assert.doesNotMatch(files, /appendRecord_\([^\n]*accessToken/i);
  assert.doesNotMatch(files, /access_token[^\n]*console/i);
});
