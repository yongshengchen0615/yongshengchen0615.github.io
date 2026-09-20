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
  assert.match(html, /profile-extension\.js\?v=member-profile-session-ready-20260920-1/);
});
