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
  assert.match(app, /async function handleAdminRealtimeUpdate\(\) \{\s*if \(isBackgroundE2ERunner\(\)\) return;/);
  assert.match(app, /function startMemberPresencePolling\(\) \{[\s\S]*if \(isBackgroundE2ERunner\(\)\) return;/);
});

test('background booking panel does not subscribe to duplicate booking realtime refreshes', () => {
  const core = read('admin/booking-panel-core.js');
  const loader = read('admin/booking-panel.js');
  assert.match(core, /function isBackgroundE2ERunner\(/);
  assert.match(core, /function setupRealtime\(\) \{\s*if \(isBackgroundE2ERunner\(\)\) return;/);
  assert.match(loader, /booking-panel-core\.js', 'booking-refresh-coalesce-20260924-1'/);
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

test('admin rate-budget assets are cache-busted', () => {
  const html = read('admin/index.html');
  assert.match(html, /app\.js\?v=admin-operations-integration-20260925-1/);
  assert.match(html, /e2e-control\.js\?v=admin-e2e-20260924-\d+/);
  assert.match(html, /booking-panel\.js\?v=[^"']+/);
});
