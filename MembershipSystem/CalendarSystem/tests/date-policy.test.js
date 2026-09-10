'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('admin date picker limits start to today and end to start date', () => {
  const html = read('admin/index.html');
  const constraints = read('admin/date-constraints.js');
  assert.match(html, /date-constraints\.js/);
  assert.match(constraints, /BUSINESS_TIME_ZONE\s*=\s*'Asia\/Taipei'/);
  assert.match(constraints, /startDate\.min\s*=\s*today/);
  assert.match(constraints, /endDate\.min\s*=\s*start && start > today \? start : today/);
  assert.match(constraints, /已經過去的日期/);
  assert.match(constraints, /form\.addEventListener\('submit', blockInvalidSubmit, true\)/);
});

test('bulk create independently rejects past dates in the browser UX', () => {
  const bulk = read('admin/bulk-create-ux.js');
  assert.match(bulk, /const today = localDateKey\(new Date\(\)\)/);
  assert.match(bulk, /startDate < today \|\| endDate < today/);
  assert.match(bulk, /不可新增已經過去的日期/);
});

test('PostgreSQL enforces date and time integrity even if client validation is bypassed', () => {
  const sql = read('supabase/migrations/001_calendar_system.sql');
  assert.match(sql, /calendar_system_items_date_range check \(end_date >= start_date\)/i);
  assert.match(sql, /calendar_system_items_time_consistency check/i);
  assert.match(sql, /all_day and start_time is null and end_time is null/i);
  assert.match(sql, /not all_day and start_time is not null and end_time is not null/i);
});

test('server-side not-past business rule remains documented as mandatory', () => {
  const readme = read('README.md');
  assert.match(readme, /Admin 不可新增或修改已經過去的日期/);
  assert.match(readme, /Asia\/Taipei/);
});
