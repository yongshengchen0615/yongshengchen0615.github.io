'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('GAS validates storage once at the request boundary instead of from every sheet helper', () => {
  const code = read('gas/Code.gs');
  const storage = read('gas/StorageBootstrap.gs');
  const auth = read('gas/Auth.gs');
  const service = read('gas/CalendarService.gs');

  assert.match(code, /authenticateLine_[\s\S]*ensureCalendarStorage_\(\);/);
  assert.match(storage, /function getDataSheet_[\s\S]*getCalendarSpreadsheet_\(\)/);
  assert.doesNotMatch(auth, /ensureCalendarStorage_\(\)/);
  assert.doesNotMatch(service, /ensureCalendarStorage_\(\)/);
});

test('setup triggers the UrlFetch external-request authorization before creating storage', () => {
  const storage = read('gas/StorageBootstrap.gs');

  assert.match(storage, /function setupCalendarSystem\(\)[\s\S]*authorizeCalendarSetupRuntime_\(\)[\s\S]*ensureCalendarStorage_\(\)/);
  assert.match(storage, /function authorizeCalendarSetupRuntime_[\s\S]*UrlFetchApp\.fetch/);
  assert.match(storage, /calendar-system-permission-check/);
  assert.match(storage, /URL_FETCH_AUTHORIZATION_REQUIRED/);
});

test('LINE verification uses a bounded digest-keyed cache and retries transient failures only', () => {
  const auth = read('gas/Auth.gs');

  assert.match(auth, /LINE_VERIFY_CACHE_MAX_SECONDS_\s*=\s*300/);
  assert.match(auth, /Utilities\.computeDigest/);
  assert.match(auth, /CacheService\.getScriptCache\(\)/);
  assert.match(auth, /for \(let attempt = 0; attempt < 2;/);
  assert.match(auth, /code === 429 \|\| code >= 500/);
  assert.doesNotMatch(auth, /put\([^\n]*idToken/);
});

test('calendar list cache is revision-aware and writes advance the revision', () => {
  const service = read('gas/CalendarService.gs');
  const storage = read('gas/StorageBootstrap.gs');

  assert.match(service, /getCalendarDataRevision_\(\)/);
  assert.match(service, /CALENDAR_LIST_CACHE_SECONDS_\s*=\s*30/);
  assert.match(service, /readCalendarListCache_/);
  assert.match(service, /writeCalendarListCache_/);
  assert.match(service, /bumpCalendarDataRevision_\(\)/);
  assert.match(service, /CALENDAR_LIST_MAX_RANGE_DAYS_\s*=\s*42/);
  assert.match(service, /function calendarListRangeFromRequest_/);
  assert.match(service, /record\.end_date[^\n]*range\.startDate/);
  assert.match(service, /record\.start_date[^\n]*range\.endDate/);
  assert.match(storage, /CALENDAR_DATA_REVISION_PROPERTY_/);
  assert.match(storage, /function bumpCalendarDataRevision_/);
});

test('key lookups use a single key-column TextFinder instead of loading every record', () => {
  const storage = read('gas/StorageBootstrap.gs');

  assert.match(storage, /createTextFinder\(expected\)/);
  assert.match(storage, /matchEntireCell\(true\)/);
  assert.match(storage, /matchCase\(true\)/);
});

test('calendar clients request only their 42-day visible range and sort it once before indexing', () => {
  const code = read('gas/Code.gs');
  const service = read('gas/CalendarService.gs');

  assert.match(code, /handleUserBootstrap_\(identity, request\)/);
  assert.match(code, /handleUserCalendarList_\(identity, request\)/);
  assert.match(code, /handleAdminBootstrap_\(identity, admin, request\)/);
  assert.match(code, /handleAdminCalendarList_\(request\)/);
  assert.match(service, /range\.startDate \+ ':' \+ range\.endDate/);

  ['user/app.js', 'admin/app.js'].forEach((relativePath) => {
    const app = read(relativePath);
    const build = app.match(/function buildVisibleDayIndex\([\s\S]*?\n  \}/);
    assert.ok(build, relativePath + ' should define buildVisibleDayIndex');
    assert.match(app, /visibleCalendarRange/);
    assert.match(build[0], /const visibleItems = state\.items\.filter/);
    assert.match(build[0], /sortCalendarItems\(visibleItems\)/);
    assert.doesNotMatch(build[0], /index\.forEach/);
  });
  assert.match(read('user/app.js'), /api\('user\.bootstrap', visibleCalendarRange\(\)\)/);
  assert.match(read('user/app.js'), /api\('user\.calendar\.list', requestedRange\)/);
  assert.match(read('admin/app.js'), /api\('admin\.bootstrap', visibleCalendarRange\(\)\)/);
  assert.match(read('admin/app.js'), /api\('admin\.calendar\.list', requestedRange\)/);
});

test('admin write success applies the returned server item locally', () => {
  const app = read('admin/app.js');

  assert.match(app, /applyServerItem\(result\.item\)/);
  assert.match(app, /state\.visibleDayIndex\.get\(key\)/);
  assert.match(app, /CONFLICT[\s\S]*refreshItems\(false\)/);
});

test('user refresh is stale-gated and preserves the last calendar on transient refresh errors', () => {
  const app = read('user/app.js');

  assert.match(app, /AUTO_REFRESH_STALE_MS\s*=\s*60000/);
  assert.match(app, /visibilitychange/);
  assert.match(app, /user\.calendar\.list/);
  assert.match(app, /requestedRangeKey !== calendarRangeKey\(visibleCalendarRange\(\)\)/);
  assert.match(app, /更新失敗，仍顯示上次資料/);
  assert.match(app, /buildVisibleDayIndex/);
});
