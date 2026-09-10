'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('frontend sends LIFF ID tokens only to the configured Edge Function', () => {
  const user = read('user/app.js');
  const admin = read('admin/app.js');
  const clients = `${user}\n${admin}`;
  assert.match(user, /getIDToken\(\)/);
  assert.match(admin, /getIDToken\(\)/);
  assert.match(clients, /supabaseFunctionUrl/);
  assert.doesNotMatch(clients, /getAccessToken\(\)/);
  assert.doesNotMatch(clients, /service_role|sb_secret_|SUPABASE_SECRET/i);
  assert.doesNotMatch(clients, /localStorage|sessionStorage/);
});

test('Supabase tables are RLS-enabled and browser roles have no direct table grants', () => {
  const sql = read('supabase/migrations/001_calendar_system.sql');
  assert.match(sql, /alter table public\.calendar_system_users enable row level security/i);
  assert.match(sql, /alter table public\.calendar_system_items enable row level security/i);
  assert.match(sql, /revoke all on table public\.calendar_system_users from anon, authenticated/i);
  assert.match(sql, /revoke all on table public\.calendar_system_items from anon, authenticated/i);
  assert.match(sql, /revoke all on function public\.calendar_system_apply_batch\(text,jsonb\) from public, anon, authenticated/i);
  assert.match(sql, /security invoker/i);
  assert.doesNotMatch(sql, /security definer/i);
});

test('admin clients never trust a client-provided role or admin flag', () => {
  const admin = [read('admin/app.js'), read('admin/bulk-actions.js'), read('admin/user-access.js')].join('\n');
  assert.doesNotMatch(admin, /isAdmin\s*:/);
  assert.doesNotMatch(admin, /role\s*:\s*['"]admin['"]/);
  assert.match(read('README.md'), /Server-side Admin authorization/);
  assert.match(read('README.md'), /role == admin/);
  assert.match(read('README.md'), /status == active/);
});

test('config and repository docs contain no backend credential fields', () => {
  const config = read('config.json');
  const backend = read('supabase/README.md');
  assert.doesNotMatch(config, /service_role|sb_secret_|channelSecret|password/i);
  assert.match(backend, /must never be added to GitHub Pages or `config\.json`/);
});

test('calendar writes preserve optimistic concurrency and soft archive semantics', () => {
  const sql = read('supabase/migrations/001_calendar_system.sql');
  assert.match(sql, /expectedUpdatedAt/);
  assert.match(sql, /for update/i);
  assert.match(sql, /raise exception 'CONFLICT'/);
  assert.match(sql, /status='archived'/);
  assert.doesNotMatch(sql, /delete from public\.calendar_system_items/i);
});
