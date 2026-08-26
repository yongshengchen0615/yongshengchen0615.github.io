'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('admin loads the visual bulk-create enhancement after the base bulk actions', () => {
  const html = read('admin/index.html');
  const baseIndex = html.indexOf('bulk-actions.js');
  const uxIndex = html.indexOf('bulk-create-ux.js');

  assert.ok(baseIndex >= 0);
  assert.ok(uxIndex > baseIndex);
  assert.match(html, /bulk-create-ux\.css/);
});

test('bulk create uses date inputs and a visible review list instead of requiring date-range syntax', () => {
  const ux = read('admin/bulk-create-ux.js');

  assert.match(ux, /bulkUxStartDate/);
  assert.match(ux, /bulkUxEndDate/);
  assert.match(ux, /加入日期/);
  assert.match(ux, /bulkUxRangeList/);
  assert.match(ux, /準備新增/);
  assert.match(ux, /renderRanges/);
  assert.match(ux, /這個日期已經加入清單/);
  assert.match(ux, /不可新增已經過去的日期/);
  assert.doesNotMatch(ux, /split\('~'\)/);
});

test('bulk create keeps the existing server-side bulk API and hard batch limit', () => {
  const ux = read('admin/bulk-create-ux.js');

  assert.match(ux, /MAX_BATCH_ITEMS\s*=\s*20/);
  assert.match(ux, /admin\.calendar\.bulkCreate/);
  assert.match(ux, /clientType:\s*'admin'/);
  assert.match(ux, /getIDToken\(\)/);
});

test('bulk create enhancement does not introduce DOM injection or credential persistence', () => {
  const ux = read('admin/bulk-create-ux.js');

  assert.doesNotMatch(ux, /\.innerHTML\s*=/);
  assert.doesNotMatch(ux, /insertAdjacentHTML/);
  assert.doesNotMatch(ux, /localStorage/);
  assert.doesNotMatch(ux, /sessionStorage/);
  assert.doesNotMatch(ux, /console\.(log|info|warn|error)/);
});

test('bulk create has responsive visual step and date-list styling', () => {
  const css = read('admin/bulk-create-ux.css');

  assert.match(css, /\.bulk-create-step/);
  assert.match(css, /\.bulk-date-builder/);
  assert.match(css, /\.bulk-date-list/);
  assert.match(css, /\.bulk-date-row/);
  assert.match(css, /@media \(max-width: 720px\)/);
});
