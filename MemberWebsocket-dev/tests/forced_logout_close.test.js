const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relative) {
  return fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
}

for (const [label, relative] of [
  ['member core', 'member-system.js'],
  ['booking core', 'booking/common.js'],
]) {
  test(`${label} alerts before closing the LIFF window on forced logout`, () => {
    const source = read(relative);
    assert.match(source, /SESSION_REVOKED/);
    assert.match(source, /function terminateAccessSession\(/);
    const helperStart = source.indexOf('function terminateAccessSession(');
    const helper = source.slice(helperStart, source.indexOf('\n  async function logout()', helperStart));
    assert.ok(helper.includes('window.alert(notice)'));
    assert.ok(helper.includes('window.liff.logout()'));
    assert.ok(helper.includes('window.liff.closeWindow()'));
    assert.ok(helper.indexOf('window.alert(notice)') < helper.indexOf('window.liff.closeWindow()'));
    assert.ok(helper.includes('window.close()'));
  });
}
