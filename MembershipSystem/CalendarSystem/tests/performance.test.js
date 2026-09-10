'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('calendar database defines range indexes for the dominant list query', () => {
  const sql = read('supabase/migrations/001_calendar_system.sql');
  assert.match(sql, /calendar_system_items_range_idx/);
  assert.match(sql, /calendar_system_items_status_range_idx/);
});

test('calendar clients request only the visible 42-day range for normal month navigation', () => {
  ['user/app.js', 'admin/app.js'].forEach((file) => {
    const app = read(file);
    assert.match(app, /visibleCalendarRange/);
    assert.match(app, /getDate\(\) \+ 41/);
    assert.match(app, /requestedRangeKey/);
  });
});

test('calendar clients filter and sort visible items once before building the day index', () => {
  ['user/app.js', 'admin/app.js'].forEach((file) => {
    const app = read(file);
    const build = app.match(/function buildVisibleDayIndex\([\s\S]*?\n  \}/);
    assert.ok(build, `${file} should define buildVisibleDayIndex`);
    assert.match(build[0], /const visibleItems = state\.items\.filter/);
    assert.match(build[0], /sortCalendarItems\(visibleItems\)/);
  });
});

test('admin single-write success applies authoritative server item locally', () => {
  const app = read('admin/app.js');
  assert.match(app, /applyServerItem\(result\.item\)/);
  assert.match(app, /CONFLICT[\s\S]*refreshItems\(false\)/);
});

test('user refresh is stale-gated and preserves last data on transient errors', () => {
  const app = read('user/app.js');
  assert.match(app, /AUTO_REFRESH_STALE_MS\s*=\s*60000/);
  assert.match(app, /visibilitychange/);
  assert.match(app, /更新失敗，仍顯示上次資料/);
  assert.doesNotMatch(app, /state\.items\s*=\s*\[\][\s\S]*更新失敗/);
});

test('batch mutation uses one RPC boundary instead of N browser requests', () => {
  const bulk = read('admin/bulk-actions.js');
  const create = read('admin/bulk-create-ux.js');
  const sql = read('supabase/migrations/001_calendar_system.sql');
  assert.match(bulk, /admin\.calendar\.bulkUpdate/);
  assert.match(bulk, /admin\.calendar\.bulkArchive/);
  assert.match(create, /admin\.calendar\.bulkCreate/);
  assert.match(sql, /calendar_system_apply_batch/);
});
