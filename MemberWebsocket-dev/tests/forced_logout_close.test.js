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


test('admin force logout keeps admin surface but revokes the same identity on user surfaces', () => {
  const auth = read('supabase/functions/_shared/auth-contract.ts');
  const api = read('supabase/functions/api/index.ts');
  assert.match(auth, /const adminChannelId =/);
  assert.match(auth, /const canBypassUserRestrictions = isActiveAdmin && expectedChannelId === adminChannelId/);
  assert.match(auth, /if \(!canBypassUserRestrictions && revokedAtMs > 0/);
  assert.doesNotMatch(api, /SELF_FORCE_LOGOUT_BLOCKED/);
  assert.match(api, /\["member","points","event","calendar","booking","admin"\]/);
});
