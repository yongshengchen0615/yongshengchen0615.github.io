'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('admin captures trusted transport before loading the third-party QR generator', () => {
  const html = read('admin/index.html');
  const commonIndex = html.indexOf('<script src="../shared/common.js"></script>');
  const qrIndex = html.indexOf('qrcode-generator@2.0.4/dist/qrcode.js');
  const appIndex = html.indexOf('<script src="./app.js"></script>');

  assert.ok(commonIndex >= 0, 'shared/common.js must be loaded');
  assert.ok(qrIndex > commonIndex, 'QR generator must load after trusted transport is captured');
  assert.ok(appIndex > qrIndex, 'admin app must start after QR generator is available');
});

test('shared transport captures sensitive browser primitives and freezes its public API', () => {
  const common = read('shared/common.js');
  assert.match(common, /const nativeFetch = window\.fetch\.bind\(window\)/);
  assert.match(common, /const NativeURLSearchParams = window\.URLSearchParams/);
  assert.match(common, /const NativeAbortController = window\.AbortController/);
  assert.match(common, /const liffClient = window\.liff/);
  assert.match(common, /await nativeFetch\(/);
  assert.match(common, /new NativeURLSearchParams\(\)/);
  assert.match(common, /new NativeAbortController\(\)/);
  assert.match(common, /Object\.defineProperty\(window, 'PointsCard'/);
  assert.match(common, /writable: false/);
  assert.match(common, /configurable: false/);
});
