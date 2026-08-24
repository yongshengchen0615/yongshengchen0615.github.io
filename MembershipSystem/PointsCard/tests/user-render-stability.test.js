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

test('member notification presentation never observes the whole document body', () => {
  assert.doesNotMatch(source, /\.observe\(document\.body/);
  assert.doesNotMatch(source, /subtree:\s*true/);
  assert.match(source, /surfaceObserver\.observe\(app, \{ attributes: true, attributeFilter: \['class'\] \}\)/);
  assert.match(source, /surfaceObserver\.observe\(processing, \{ attributes: true, attributeFilter: \['class'\] \}\)/);
});

test('member notification retries are coalesced and driven by narrow UI lifecycle signals', () => {
  assert.match(source, /presentationRetryScheduled/);
  assert.match(source, /window\.setTimeout\(function \(\) \{[\s\S]*retryPresentation\(\)/);
  assert.match(source, /querySelectorAll\('dialog'\)[\s\S]*addEventListener\('close', scheduleRetryPresentation\)/);
});

test('showing the same unread notification is idempotent', () => {
  assert.match(source, /dialog && dialog\.open && currentNotice && currentNotice\.notificationId === nextNotice\.notificationId/);
});

test('notification API calls have a client-side escape hatch if response body consumption stalls', () => {
  assert.match(source, /NOTICE_API_TIMEOUT_MS = 32000/);
  assert.match(source, /Promise\.race\(\[[\s\S]*request,[\s\S]*timeoutPromise/);
  assert.match(source, /withNoticeApiTimeout\(PointsCard\.callApi\('member\.point-notifications\.list'/);
  assert.match(source, /withNoticeApiTimeout\(PointsCard\.callApi\('member\.point-notification\.read'/);
  assert.match(source, /CLIENT_TIMEOUT/);
  assert.match(source, /通知服務回應逾時/);
});
