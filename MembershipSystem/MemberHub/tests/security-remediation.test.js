'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('every authenticated module clears the SDK persisted raw ID token', () => {
  const sources = [
    read('modules/membership/shared/common.js'),
    read('modules/points/shared/common.js'),
    read('modules/calendar/user/app.js'),
    read('modules/calendar/admin/app.js')
  ];

  for (const source of sources) {
    assert.match(source, /localStorage\.removeItem\(/);
    assert.match(source, /sessionStorage\.removeItem\(/);
    assert.match(source, /LIFF_STORE:/);
    assert.match(source, /:IDToken/);
  }
});

test('all admin module boot paths fail closed when framed', () => {
  for (const relative of [
    'modules/membership/admin/app.js',
    'modules/points/admin/app.js',
    'modules/calendar/admin/app.js'
  ]) {
    assert.match(read(relative), /window\.top !== window\.self/);
  }
});

test('calendar user-access extension reuses an allowlisted in-memory API capability', () => {
  const app = read('modules/calendar/admin/app.js');
  const extension = read('modules/calendar/admin/user-access.js');
  assert.match(app, /CalendarAdminUserAccessApi/);
  assert.match(extension, /CalendarAdminUserAccessApi/);
  assert.doesNotMatch(extension, /getIDToken/);
  assert.doesNotMatch(extension, /idToken/);
});
