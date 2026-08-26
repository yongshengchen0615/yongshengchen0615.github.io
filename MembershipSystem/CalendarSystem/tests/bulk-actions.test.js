'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('admin loads isolated bulk action UI assets', () => {
  const html = read('admin/index.html');
  assert.match(html, /bulk-actions\.css/);
  assert.match(html, /bulk-actions\.js/);
});

test('bulk UI supports create, update, and archive without HTML injection APIs', () => {
  const ui = read('admin/bulk-actions.js');
  assert.match(ui, /admin\.calendar\.bulkCreate/);
  assert.match(ui, /admin\.calendar\.bulkUpdate/);
  assert.match(ui, /admin\.calendar\.bulkArchive/);
  assert.match(ui, /MAX_BATCH_ITEMS\s*=\s*20/);
  assert.match(ui, /expectedUpdatedAt:\s*item\.updatedAt/);
  assert.match(ui, /window\.confirm/);
  assert.match(ui, /移除採封存/);
  assert.doesNotMatch(ui, /\.innerHTML\s*=/);
  assert.doesNotMatch(ui, /insertAdjacentHTML/);
  assert.doesNotMatch(ui, /localStorage|sessionStorage/);
});

test('bulk API routes are admin-authorized write actions with weighted rate limiting', () => {
  const code = read('gas/Code.gs');
  ['bulkCreate', 'bulkUpdate', 'bulkArchive'].forEach((name) => {
    assert.match(code, new RegExp(`admin\\.calendar\\.${name}`));
  });
  assert.match(code, /authorizeAdmin_\(identity\)/);
  assert.match(code, /requestRateLimitCost_/);
  assert.match(code, /current \+ cost > limit/);
});

test('bulk service validates count, versions, duplicates, past dates, and uses soft archive', () => {
  const service = read('gas/CalendarBulkService.gs');
  assert.match(service, /CALENDAR_BULK_MAX_ITEMS_\s*=\s*20/);
  assert.match(service, /validateCalendarItem_/);
  assert.match(service, /enforceAdminCalendarNotPast_/);
  assert.match(service, /expectedUpdatedAt/);
  assert.match(service, /DUPLICATE_ITEM_ID/);
  assert.match(service, /CONFLICT/);
  assert.match(service, /status:\s*'archived'/);
  assert.match(service, /withDataLock_/);
  assert.match(service, /writeCalendarRowsBatch_/);
  assert.match(service, /rowNumber:\s*index \+ 2/);
  assert.doesNotMatch(service, /table\.values/);
  assert.doesNotMatch(service, /deleteRow|deleteRows|clearContent/);
});

test('bulk service emits per-item audit records and does not log credentials', () => {
  const service = read('gas/CalendarBulkService.gs');
  assert.match(service, /CALENDAR_ITEM_CREATE/);
  assert.match(service, /CALENDAR_ITEM_UPDATE/);
  assert.match(service, /CALENDAR_ITEM_ARCHIVE/);
  assert.match(service, /actor_line_user_id/);
  assert.doesNotMatch(service, /console\.(log|info|warn|error)\([^\n]*idToken/i);
  assert.doesNotMatch(service, /password|access_token/i);
});
