'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../user/point-notifications.js'), 'utf8');

test('member notification module stays syntactically valid', () => {
  assert.doesNotThrow(() => new vm.Script(source));
});

test('member notification presentation remains intentionally inert', () => {
  assert.match(source, /LINE push only/);
  assert.match(source, /intentionally inert/);
  assert.doesNotMatch(source, /MutationObserver|\.observe\(/);
  assert.doesNotMatch(source, /querySelector|querySelectorAll|getElementById/);
});

test('opening PointsCard does not poll or consume point-grant notifications', () => {
  assert.doesNotMatch(source, /PointsCard\.callApi/);
  assert.doesNotMatch(source, /member\.point-notifications\.list/);
  assert.doesNotMatch(source, /member\.point-notification\.read/);
});

test('notification module cannot create duplicate browser dialogs or retry loops', () => {
  assert.doesNotMatch(source, /showModal|HTMLDialogElement|currentNotice/);
  assert.doesNotMatch(source, /setTimeout|setInterval|presentationRetryScheduled/);
});

test('notification module does not add an independent client timeout path', () => {
  assert.doesNotMatch(source, /NOTICE_API_TIMEOUT_MS|Promise\.race|CLIENT_TIMEOUT/);
});
