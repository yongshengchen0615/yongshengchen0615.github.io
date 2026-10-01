const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('automatic tutorial open does not scroll the document', () => {
  const source = read('user-tour.js');
  assert.match(source, /renderStep\(\{ scroll: Boolean\(trigger\) \}\)/);
  assert.match(source, /if \(options\.scroll === true\) target\.scrollIntoView/);
  assert.match(source, /renderStep\(\{ scroll: false \}\)/);
});

test('admin booking layout styles are available before the booking loader runs', () => {
  const html = read('admin/index.html');
  const loader = read('admin/booking-panel.js');
  const scriptIndex = html.indexOf('./booking-panel.js?v=layout-stability-20261001-1');
  assert.ok(scriptIndex > 0);
  for (const asset of [
    './booking-panel-responsive.css?v=booking-settings-layout-20260918-1',
    './booking-summary.css?v=booking-theme-tokens-20260924-1',
    './booking-resources.css?v=booking-theme-tokens-20260924-1',
    '../booking-admin-group-details.css?v=booking-theme-tokens-20260924-1',
    './ui-polish.css?v=lumen-design-system-20260924-1',
    './ui-polish-responsive.css?v=ui-refresh-20260924-1',
  ]) {
    const assetIndex = html.indexOf(asset);
    assert.ok(assetIndex >= 0, asset);
    assert.ok(assetIndex < scriptIndex, asset + ' must load before booking-panel.js');
  }
  assert.doesNotMatch(loader, /loadStyle\(/);
  assert.doesNotMatch(loader, /loadSharedResponsive/);
});

test('admin BFCache resume revalidates server authorization instead of hard reloading', () => {
  const app = read('admin/app.js');
  assert.match(app, /if \(event\.persisted\) void resumeAdminFromBfcache\(\)/);
  assert.match(app, /async function resumeAdminFromBfcache\(\)/);
  assert.match(app, /await refreshData\(false\)/);
  assert.doesNotMatch(app, /if \(event\.persisted\) window\.location\.reload\(\)/);
});

test('legacy booking route selects the initial panel without polling after paint', () => {
  const loader = read('admin/booking-panel.js');
  const core = read('admin/booking-panel-core.js');
  assert.match(loader, /window\.MemberAdminInitialPanel = 'booking'/);
  assert.doesNotMatch(loader, /setInterval\(/);
  assert.match(core, /function openInitialBookingPanel\(\)/);
  assert.match(core, /activateBookingPanel\(\)/);
});

test('legacy IndexedDB sync cache cleanup runs at most once per browser storage', () => {
  const source = read('member-system.js');
  assert.match(source, /lumen-legacy-sync-cache-cleaned-v1/);
  assert.match(source, /deleteDatabase\('MembershipSystemSyncCache'\)/);
  assert.match(source, /request\.onsuccess/);
});
