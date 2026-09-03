'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('GAS verifies LINE ID tokens server-side against the surface channel', () => {
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
  assert.match(auth, /AUTH_CHANNEL_MISMATCH/);
  assert.match(auth, /IdToken expired\./);
  assert.match(auth, /Invalid IdToken\./);
  assert.match(auth, /MEMBERSHIP_MEMBER_LINE_CHANNEL_ID/);
  assert.match(auth, /MEMBERSHIP_POINTS_LINE_CHANNEL_ID/);
  assert.match(auth, /MEMBERSHIP_ADMIN_LINE_CHANNEL_ID/);
});

test('browser clients use ID tokens and do not persist credentials', () => {
  const clients = [read('shared/common.js'), read('member/app.js'), read('points/app.js'), read('admin/app.js')].join('\n');
  assert.match(clients, /getIDToken\(\)/);
  assert.match(clients, /signIn\(state\.config, 'member'\)/);
  assert.match(clients, /signIn\(state\.config, 'points'\)/);
  assert.doesNotMatch(clients, /getAccessToken\(\)/);
  assert.match(clients, /member_system_reauth/);
  assert.match(clients, /isInClient\(\)/);
  assert.match(clients, /window\.liff\.logout\(\)/);
  assert.doesNotMatch(clients, /localStorage|sessionStorage/);
});

test('admin authorization is server-side and pending accounts are non-privileged', () => {
  const auth = read('gas/Auth.gs');
  const code = read('gas/Code.gs');
  assert.match(auth, /findRecordWithRow_\('Admins'/);
  assert.match(auth, /role: 'none'/);
  assert.match(auth, /status: 'pending'/);
  assert.match(auth, /ADMIN_PENDING/);
  assert.match(auth, /status !== 'active'/);
  assert.match(auth, /role !== 'admin'/);
  assert.doesNotMatch(code, /request\.(role|isAdmin|admin)/);
});

test('spreadsheet writes protect formulas and point entries are append-only', () => {
  const storage = read('gas/Storage.gs');
  const code = read('gas/Code.gs');
  const pointService = read('gas/PointCardService.gs');
  const memberService = read('gas/MemberService.gs');
  assert.match(storage, /escapeSheetValue_/);
  assert.match(storage, /\^\[=\+\\-@\]/);
  assert.match(pointService, /appendRecord_\('PointEntries'/);
  assert.match(pointService, /PointBalances/);
  assert.match(pointService, /withDataLock_/);
  assert.match(storage, /ServiceTimeEntries/);
  assert.match(memberService, /appendRecord_\('ServiceTimeEntries'/);
  assert.match(memberService, /normalizeBirthday_/);
  assert.match(memberService, /normalizePhone_/);
  assert.match(memberService, /REQUEST_REUSE_MISMATCH/);
  assert.match(code, /case 'admin\.member-grants\.add':[\s\S]*?authorizeAdmin_\(identity\)[\s\S]*?handleMemberGrantAdd_/);
  assert.match(memberService, /function handleMemberGrantAdd_/);
  assert.match(memberService, /requestId \+ '_points'/);
  assert.match(memberService, /requestId \+ '_service'/);
  assert.match(pointService, /function addStampLocked_/);
});

test('CSP allows the LIFF subwindow without unsafe-eval', () => {
  const html = [read('member/index.html'), read('points/index.html'), read('admin/index.html')].join('\n');
  assert.match(html, /frame-src https:\/\/liff-subwindow\.line\.me/);
  assert.match(html, /form-action https:\/\/liff-subwindow\.line\.me/);
  assert.doesNotMatch(html, /unsafe-eval/);
});

test('ID tokens are not explicitly written to logs or Sheets', () => {
  const gas = ['gas/Code.gs', 'gas/Auth.gs', 'gas/Storage.gs', 'gas/MemberService.gs', 'gas/PointCardService.gs'].map(read).join('\n');
  assert.doesNotMatch(gas, /console\.(log|info|warn|error)\([^\n]*idToken/i);
  assert.doesNotMatch(gas, /appendRecord_\([^\n]*idToken/i);
  assert.doesNotMatch(gas, /id_token[^\n]*console/i);
});

test('birth date and phone are sent only to the authenticated member profile, never the admin list', () => {
  const memberService = read('gas/MemberService.gs');
  const profileBody = memberService.match(/function memberForClient_\(member\) \{([\s\S]*?)\n\}/);
  const adminBody = memberService.match(/function adminMemberForClient_\(member, serviceMinutesTotal\) \{([\s\S]*?)\n\}/);
  assert.ok(profileBody);
  assert.ok(adminBody);
  assert.match(profileBody[1], /birthday/);
  assert.match(profileBody[1], /phone/);
  assert.doesNotMatch(adminBody[1], /birthday|phone/);
});
