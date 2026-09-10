'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('CalendarSystem user table has an explicit active/disabled account status model', () => {
  const sql = read('supabase/migrations/001_calendar_system.sql');
  assert.match(sql, /calendar_system_users/);
  assert.match(sql, /status text not null default 'active'/);
  assert.match(sql, /status in \('active','disabled'\)/);
  assert.match(sql, /line_user_id text not null unique/);
});

test('admin user access UI uses server APIs through the shared Supabase transport', () => {
  const html = read('admin/index.html');
  const ui = read('admin/user-access.js');
  assert.match(html, /id="userAccessCard"/);
  assert.match(ui, /CalendarSystemAdminTransport/);
  assert.match(ui, /admin\.users\.list/);
  assert.match(ui, /admin\.users\.updateStatus/);
  assert.match(ui, /expectedUpdatedAt/);
  assert.doesNotMatch(ui, /gasWebAppUrl|script\.google\.com/i);
});

test('admin UI only exposes active or disabled user-service states', () => {
  const ui = read('admin/user-access.js');
  assert.match(ui, /\['active', '通過'\]/);
  assert.match(ui, /\['disabled', '停用'\]/);
  assert.doesNotMatch(ui, /\.innerHTML\s*=/);
  assert.doesNotMatch(ui, /insertAdjacentHTML/);
  assert.doesNotMatch(ui, /console\./);
});

test('disabled user receives a dedicated disabled-account message', () => {
  const html = read('user/index.html');
  const ui = read('user/account-status-ui.js');
  assert.match(html, /account-status-ui\.js/);
  assert.match(ui, /帳號已停用/);
  assert.match(ui, /日曆使用權限目前已停用/);
  assert.match(ui, /聯絡管理員/);
});
