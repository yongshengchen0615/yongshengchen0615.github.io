'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('new calendar users are active by default and disabled users are rejected server-side', () => {
  const service = read('gas/CalendarService.gs');
  assert.match(service, /status:\s*'active'/);
  assert.match(service, /status[^\n]*!==\s*'active'/);
  assert.match(service, /ACCOUNT_DISABLED/);
});

test('admin user access APIs require server-side admin authorization', () => {
  const code = read('gas/Code.gs');
  const listCase = code.match(/case 'admin\.users\.list':[\s\S]*?break;/);
  const updateCase = code.match(/case 'admin\.users\.updateStatus':[\s\S]*?break;/);

  assert.ok(listCase);
  assert.ok(updateCase);
  assert.match(listCase[0], /authorizeAdmin_\(identity\)[\s\S]*handleAdminUsersList_/);
  assert.match(updateCase[0], /authorizeAdmin_\(identity\)[\s\S]*handleAdminUserStatusUpdate_/);
});

test('user status updates are allowlisted, concurrency protected, and audited', () => {
  const code = read('gas/Code.gs');
  assert.match(code, /USER_ACCESS_STATUSES_\s*=\s*Object\.freeze\(\['active', 'disabled'\]\)/);
  assert.match(code, /INVALID_USER_STATUS/);
  assert.match(code, /expectedUpdatedAt/);
  assert.match(code, /CONFLICT/);
  assert.match(code, /USER_ACCOUNT_STATUS_CHANGED/);
  assert.match(code, /target_type:\s*'user_account'/);
  assert.match(code, /admin\.users\.updateStatus/);
  assert.match(code, /WRITE_ACTIONS_[\s\S]*admin\.users\.updateStatus/);
});

test('admin UI offers only pass or disable and does not render untrusted HTML', () => {
  const html = read('admin/index.html');
  const ui = read('admin/user-access.js');

  assert.match(html, /id="userAccessCard"/);
  assert.match(html, /user-access\.js/);
  assert.match(ui, /\['active', '通過'\]/);
  assert.match(ui, /\['disabled', '停用'\]/);
  assert.match(ui, /admin\.users\.list/);
  assert.match(ui, /admin\.users\.updateStatus/);
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
