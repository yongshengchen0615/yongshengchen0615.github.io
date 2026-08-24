const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('user and admin surfaces expose all three modules', () => {
  const hub = read('shared/hub.js');
  for (const moduleName of ['membership', 'points', 'calendar']) {
    assert.match(hub, new RegExp(`id: '${moduleName}'`));
    assert.match(hub, new RegExp(`modules/${moduleName}`));
  }
  assert.match(hub, /user:/);
  assert.match(hub, /admin:/);
});

test('entry pages apply restrictive document policy', () => {
  for (const relative of ['index.html', 'user/index.html', 'admin/index.html']) {
    const html = read(relative);
    assert.match(html, /Content-Security-Policy/);
    assert.match(html, /frame-ancestors 'none'/);
    assert.match(html, /referrer/);
    assert.doesNotMatch(html, /unsafe-eval|unsafe-inline/);
  }
});

test('hub does not persist identity or authorize in the browser', () => {
  const source = read('shared/hub.js') + read('shared/entry.js');
  assert.doesNotMatch(source, /localStorage|sessionStorage|idToken|accessToken|canManage/);
  assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML|document\.write/);
});

test('architecture keeps membership tier separate from permissions', () => {
  const architecture = read('ARCHITECTURE.md');
  assert.match(architecture, /Membership Tier/);
  assert.match(architecture, /Admin Permission/);
  assert.match(architecture, /server-side fail-closed/);
});
