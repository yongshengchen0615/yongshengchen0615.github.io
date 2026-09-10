'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('admin loads isolated bulk action UI assets', () => {
  const html = read('admin/index.html');
  assert.match(html, /bulk-actions\.css/);
  assert.match(html, /bulk-actions\.js/);
  assert.match(html, /bulk-create-ux\.js/);
});

test('bulk UI supports update and soft archive through Supabase transport', () => {
  const ui = read('admin/bulk-actions.js');
  assert.match(ui, /admin\.calendar\.bulkUpdate/);
  assert.match(ui, /admin\.calendar\.bulkArchive/);
  assert.match(ui, /MAX_BATCH_ITEMS\s*=\s*20/);
  assert.match(ui, /expectedUpdatedAt:\s*item\.updatedAt/);
  assert.match(ui, /window\.confirm/);
  assert.match(ui, /移除採封存/);
  assert.match(ui, /supabaseFunctionUrl/);
  assert.doesNotMatch(ui, /gasWebAppUrl|script\.google\.com/i);
  assert.doesNotMatch(ui, /\.innerHTML\s*=/);
  assert.doesNotMatch(ui, /localStorage|sessionStorage/);
});

test('database batch RPC is limited to 20 and is one PostgreSQL transaction', () => {
  const sql = read('supabase/migrations/001_calendar_system.sql');
  assert.match(sql, /calendar_system_apply_batch/);
  assert.match(sql, /jsonb_array_length\(p_operations\) > 20/);
  assert.match(sql, /for v_op in select value from jsonb_array_elements\(p_operations\)/i);
  assert.match(sql, /for update/i);
  assert.match(sql, /raise exception 'CONFLICT'/);
  assert.match(sql, /status='archived'/);
  assert.doesNotMatch(sql, /delete from public\.calendar_system_items/i);
});

test('batch RPC is not callable by public browser roles', () => {
  const sql = read('supabase/migrations/001_calendar_system.sql');
  assert.match(sql, /security invoker/i);
  assert.match(sql, /revoke all on function public\.calendar_system_apply_batch\(text,jsonb\) from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.calendar_system_apply_batch\(text,jsonb\) to service_role/i);
});
