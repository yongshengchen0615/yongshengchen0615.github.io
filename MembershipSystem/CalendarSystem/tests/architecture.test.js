'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const exists = (file) => fs.existsSync(path.join(root, file));

test('CalendarSystem V3.1 uses LIFF plus standalone Supabase and has no GAS runtime directory', () => {
  [
    'index.html', 'config.json', 'README.md',
    'user/index.html', 'user/app.js',
    'admin/index.html', 'admin/app.js',
    'admin/bulk-actions.js', 'admin/bulk-create-ux.js', 'admin/user-access.js',
    'supabase/README.md',
    'supabase/migrations/001_calendar_system.sql',
    'supabase/migrations/002_standalone_support.sql'
  ].forEach((file) => assert.equal(exists(file), true, `missing ${file}`));
  assert.equal(exists('gas'), false, 'GAS directory must not exist in V3.1');
});

test('public config targets only the standalone CalendarSystem Supabase project', () => {
  const config = JSON.parse(read('config.json'));
  assert.equal(config.supabaseFunctionUrl, 'https://zrdpsobxaehqukacjjss.supabase.co/functions/v1/calendar-system-api');
  assert.doesNotMatch(config.supabaseFunctionUrl, /dbuquirnaskrwcamdxki/);
  assert.equal(config.userLiffId, '2005939681-390hQmGR');
  assert.equal(config.adminLiffId, '2011356226-HwBcyRfS');
  assert.notEqual(config.userLiffId, config.adminLiffId);
  assert.equal('gasWebAppUrl' in config, false);

  const keys = Object.keys(config).map((key) => key.toLowerCase());
  assert.equal(keys.some((key) => key.includes('secret') || key.includes('password') || key === 'token'), false);
});

test('standalone support schema owns admin audit and rate-limit state', () => {
  const sql = read('supabase/migrations/002_standalone_support.sql');
  assert.match(sql, /create table if not exists public\.admins/i);
  assert.match(sql, /create table if not exists public\.audit_logs/i);
  assert.match(sql, /create table if not exists public\.api_rate_limits/i);
  assert.match(sql, /create or replace function public\.consume_api_rate_limit/i);
  assert.match(read('README.md'), /不依賴 MemberWebsocket-dev Supabase 專案/);
});

test('frontend transport targets only the Supabase Edge Function config key', () => {
  const clients = [read('user/app.js'), read('admin/app.js'), read('admin/bulk-actions.js'), read('admin/bulk-create-ux.js'), read('admin/user-access.js')].join('\n');
  assert.match(clients, /supabaseFunctionUrl/);
  assert.doesNotMatch(clients, /gasWebAppUrl|script\.google\.com|google\.script\.run/i);
});
