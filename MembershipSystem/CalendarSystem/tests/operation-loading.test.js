'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('admin loads operation loading assets after bulk create UX', () => {
  const html = read('admin/index.html');
  const bulkIndex = html.indexOf('bulk-create-ux.js');
  const loadingIndex = html.indexOf('operation-loading.js');

  assert.ok(bulkIndex >= 0);
  assert.ok(loadingIndex > bulkIndex);
  assert.match(html, /operation-loading\.css/);
});

test('loading overlay covers bulk create, update, archive and manual sync', () => {
  const js = read('admin/operation-loading.js');

  assert.match(js, /\.bulk-create-ux-form/);
  assert.match(js, /套用批量修改/);
  assert.match(js, /批量移除/);
  assert.match(js, /refreshButton/);
  assert.match(js, /正在建立/);
  assert.match(js, /正在修改/);
  assert.match(js, /正在移除/);
  assert.match(js, /正在同步日曆/);
});

test('loading follows server result and does not get stuck on validation or cancelled archive', () => {
  const js = read('admin/operation-loading.js');

  assert.match(js, /observeBulkMessage/);
  assert.match(js, /observeBulkModal/);
  assert.match(js, /observeSyncStatus/);
  assert.match(js, /showBulkLoadingAfterAction/);
  assert.match(js, /button\.disabled/);
  assert.match(js, /MAX_VISIBLE_MS\s*=\s*45000/);
  assert.match(js, /同步失敗/);
});

test('loading UI remains DOM-safe and does not persist credentials', () => {
  const js = read('admin/operation-loading.js');

  assert.doesNotMatch(js, /innerHTML\s*=/);
  assert.doesNotMatch(js, /insertAdjacentHTML/);
  assert.doesNotMatch(js, /localStorage/);
  assert.doesNotMatch(js, /sessionStorage/);
  assert.doesNotMatch(js, /getIDToken/);
  assert.doesNotMatch(js, /console\.(log|info|warn|error)/);
});

test('loading overlay is full-screen, responsive and reduced-motion aware', () => {
  const css = read('admin/operation-loading.css');

  assert.match(css, /position:\s*fixed/);
  assert.match(css, /inset:\s*0/);
  assert.match(css, /z-index:\s*140/);
  assert.match(css, /@media \(max-width: 520px\)/);
  assert.match(css, /prefers-reduced-motion/);
});
