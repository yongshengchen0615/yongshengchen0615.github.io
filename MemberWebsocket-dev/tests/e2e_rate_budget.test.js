const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

test('background admin E2E disables duplicate general realtime and presence polling', () => {
  const app = read('admin/app.js');
  assert.match(app, /function isBackgroundE2ERunner\(/);
  assert.match(app, /if \(!isBackgroundE2ERunner\(\)\) \{[\s\S]*subscribeRealtime/);
  assert.match(app, /async function handleAdminRealtimeUpdate\(context = \{\}\) \{\s*if \(isBackgroundE2ERunner\(\)\) return;/);
  assert.match(app, /function startMemberPresencePolling\(\) \{[\s\S]*if \(isBackgroundE2ERunner\(\)\) return;/);
});

test('background booking panel does not subscribe to duplicate booking realtime refreshes', () => {
  const core = read('admin/booking-panel-core.js');
  const loader = read('admin/booking-panel.js');
  assert.match(core, /function isBackgroundE2ERunner\(/);
  assert.match(core, /function setupRealtime\(\) \{\s*if \(isBackgroundE2ERunner\(\) \|\| state\.realtimeListening\) return;/);
  assert.match(loader, /booking-panel-core\.js', 'layout-stability-20261001-1'/);
});

test('paired E2E uses adaptive booking read budget and next-bucket backoff', () => {
  const runner = read('admin/e2e-control.js');
  assert.match(runner, /const ADMIN_BOOKING_BOOTSTRAP_BASE_INTERVAL_MS = 3500/);
  assert.match(runner, /const ADMIN_BOOKING_BOOTSTRAP_MAX_INTERVAL_MS = 8000/);
  assert.match(runner, /function adminBookingBootstrapIntervalMs\(/);
  assert.match(runner, /ADMIN_BOOKING_BOOTSTRAP_BASE_INTERVAL_MS \+ \(participantCount - 1\) \* 500/);
  assert.match(runner, /'RATE_LIMITED'/);
  assert.match(runner, /Math\.floor\(Date\.now\(\) \/ 60000\) \+ 1/);
  assert.match(runner, /adminBookingBootstrapBackoffUntil/);
});

test('paired E2E protects workstation CPU and screenshot budget', () => {
  const runner = read('admin/e2e-control.js');
  const userRunner = read('user-test-control.js');
  assert.match(runner, /const DEFAULT_ACTIVE_CLIENT_CONCURRENCY_CAP = 2/);
  assert.match(runner, /navigator\?\.hardwareConcurrency|navigator\.hardwareConcurrency/);
  assert.match(runner, /deviceMemory/);
  assert.match(runner, /participantFanout >= 8/);
  assert.match(runner, /normalizedParticipantCount >= 3/);
  assert.match(runner, /participantConcurrencyCap/);
  assert.match(runner, /const FAILURE_SCREENSHOT_BUDGET = 2/);
  assert.match(runner, /reason: 'run-budget'/);
  assert.match(userRunner, /const FAILURE_SCREENSHOT_BUDGET = 1/);
  assert.match(userRunner, /reason: 'surface-budget'/);
});

test('admin rate-budget assets are cache-busted', () => {
  const html = read('admin/index.html');
  assert.match(html, /app\.js\?v=[^"'\\s>]+/);
  assert.match(html, /e2e-control\.js\?v=[^"'\\s>]+/);
  assert.match(html, /booking-panel\.js\?v=[^"']+/);
});
