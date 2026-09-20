const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('test-account member profile editor resyncs after delayed test login', () => {
  const client = read('test-mode-client.js');
  const profile = read('member/profile-extension.js');
  const html = read('member/index.html');

  assert.match(client, /SESSION_READY_EVENT = 'member-test-session-ready'/);
  assert.match(client, /announceSessionReady\(\)/);
  assert.match(client, /window\.dispatchEvent\(new Event\(SESSION_READY_EVENT\)\)/);
  assert.match(profile, /window\.addEventListener\('member-test-session-ready', \(\) => scheduleProfileSync\(0\)\)/);
  assert.match(profile, /async function ensureCurrentProfile\(\)/);
  assert.match(profile, /return fetchCurrentProfile\(16\)/);
  assert.doesNotMatch(profile, /if \(!currentProfile \|\| typeof currentProfile !== 'object'\) return;/);
  assert.match(html, /test-mode-client\.js\?v=member-profile-session-ready-20260920-1/);
  assert.match(html, /profile-extension\.js\?v=test-profile-edit-fix-20260920-2/);
  assert.match(html, /profile-birthday-edit\.js\?v=test-profile-edit-fix-20260920-2/);
  assert.match(html, /app\.js\?v=test-profile-edit-fix-20260920-2/);
});


test('member card renders honorific from the primary profile source', () => {
  const app = read('member/app.js');
  const profile = read('member/profile-extension.js');
  assert.match(app, /memberHonorificName/);
  assert.match(app, /salutation === 'mr' \? '先生' : salutation === 'ms' \? '小姐'/);
  assert.match(app, /member-profile-ready/);
  assert.match(profile, /window\.addEventListener\('member-profile-ready'/);
});

test('profile edit actions use independent partial updates', () => {
  const profile = read('member/profile-extension.js');
  const birthday = read('member/profile-birthday-edit.js');
  const api = read('supabase/functions/member-profile-api/index.ts');

  assert.match(profile, /saveProfilePayload\(\{ surname, salutation \}\)/);
  assert.match(profile, /saveProfilePayload\(\{ phone: rawPhone \}\)/);
  assert.match(birthday, /requestProfile\('user\.member\.profile\.save', \{ birthday \}\)/);
  assert.match(api, /const hasBirthday = Object\.prototype\.hasOwnProperty\.call\(body, "birthday"\)/);
  assert.match(api, /const hasPhone = Object\.prototype\.hasOwnProperty\.call\(body, "phone"\)/);
  assert.match(api, /const hasSurname = Object\.prototype\.hasOwnProperty\.call\(body, "surname"\)/);
  assert.match(api, /const hasSalutation = Object\.prototype\.hasOwnProperty\.call\(body, "salutation"\)/);
  assert.match(api, /profileFields\.push\("birthday"\)/);
  assert.match(api, /生日不可晚於今天/);
});
