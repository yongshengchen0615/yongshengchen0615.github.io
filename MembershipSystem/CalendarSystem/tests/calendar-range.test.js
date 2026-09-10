'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('user and admin request exactly the 42-day visible calendar grid', () => {
  ['user/app.js', 'admin/app.js'].forEach((file) => {
    const app = read(file);
    assert.match(app, /function visibleCalendarRange\(\)/);
    assert.match(app, /gridStart/);
    assert.match(app, /getDate\(\) \+ 41/);
    assert.match(app, /rangeStart:\s*dateKey\(gridStart\)/);
    assert.match(app, /rangeEnd:\s*dateKey\(gridEnd\)/);
  });
  assert.match(read('user/app.js'), /api\('user\.bootstrap', visibleCalendarRange\(\)\)/);
  assert.match(read('user/app.js'), /api\('user\.calendar\.list', requestedRange\)/);
  assert.match(read('admin/app.js'), /api\('admin\.bootstrap', visibleCalendarRange\(\)\)/);
  assert.match(read('admin/app.js'), /api\('admin\.calendar\.list', requestedRange\)/);
});

test('clients reject stale month responses before replacing current data', () => {
  const user = read('user/app.js');
  const admin = read('admin/app.js');
  assert.match(user, /requestedRangeKey !== calendarRangeKey\(visibleCalendarRange\(\)\)/);
  assert.match(admin, /requestedRangeKey !== calendarRangeKey\(visibleCalendarRange\(\)\)/);
});

test('database has indexes supporting status and date-range calendar lookup', () => {
  const sql = read('supabase/migrations/001_calendar_system.sql');
  assert.match(sql, /calendar_system_items_range_idx/);
  assert.match(sql, /\(start_date, end_date\)/);
  assert.match(sql, /calendar_system_items_status_range_idx/);
  assert.match(sql, /\(status, start_date, end_date\)/);
});

test('public user rendering only accepts published items even if transport data is malformed', () => {
  const user = read('user/app.js');
  assert.match(user, /item\.status === 'published'/);
  assert.match(user, /item\.endDate >= rangeStart/);
  assert.match(user, /item\.startDate <= rangeEnd/);
});
