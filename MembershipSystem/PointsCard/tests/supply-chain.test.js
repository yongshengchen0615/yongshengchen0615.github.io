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
  const liffIndex = html.indexOf('<script src="../vendor/liff-client.js"></script>');
  const commonIndex = html.indexOf('<script src="../shared/common.js"></script>');
  const qrIndex = html.indexOf('qrcode-generator@2.0.4/dist/qrcode.js');
  const appIndex = html.indexOf('<script src="./app.js"></script>');

  assert.ok(liffIndex >= 0, 'the local LIFF bundle must be loaded');
  assert.ok(commonIndex > liffIndex, 'trusted transport must capture the local LIFF client');
  assert.ok(qrIndex > commonIndex, 'QR generator must load after trusted transport is captured');
  assert.ok(appIndex > qrIndex, 'admin app must start after QR generator is available');
});

test('shared transport captures sensitive browser primitives and freezes its public API', () => {
  const common = read('shared/common.js');
  assert.match(common, /const nativeFetch = window\.fetch\.bind\(window\)/);
  assert.match(common, /const NativeURLSearchParams = window\.URLSearchParams/);
  assert.match(common, /const NativeAbortController = window\.AbortController/);
  assert.match(common, /const liffClient = window\.PointsCardLiff/);
  assert.match(common, /await nativeFetch\(/);
  assert.match(common, /new NativeURLSearchParams\(\)/);
  assert.match(common, /new NativeAbortController\(\)/);
  assert.match(common, /Object\.defineProperty\(window, 'PointsCard'/);
  assert.match(common, /writable: false/);
  assert.match(common, /configurable: false/);
});

test('local LIFF bundle is pinned, minimal, and compatible with strict CSP', () => {
  const packageJson = JSON.parse(read('package.json'));
  const buildScript = read('scripts/build-liff.mjs');
  const entry = read('shared/liff-client.entry.js');
  const bundle = read('vendor/liff-client.js');
  const memberHtml = read('user/index.html');

  assert.equal(packageJson.dependencies['@line/liff'], '2.29.2');
  assert.equal(packageJson.devDependencies.esbuild, '0.25.9');
  for (const moduleName of [
    'get-decoded-id-token', 'get-id-token', 'is-in-client', 'is-logged-in',
    'login', 'logout', 'scan-code-v2'
  ]) {
    assert.match(entry, new RegExp("@line/liff/" + moduleName));
  }
  assert.doesNotMatch(entry, /@line\/liff\/sub-window/);
  assert.match(buildScript, /occurrenceCount !== 1/);
  assert.match(buildScript, /frameDocument\.createElement\(\"form\"\)/);
  assert.doesNotMatch(bundle, /\beval\s*\(/);
  assert.doesNotMatch(bundle, /new\s+Function\s*\(/);
  assert.match(bundle, /PointsCardLiff/);
  assert.doesNotMatch(memberHtml, /'unsafe-eval'/);
  assert.match(memberHtml, /frame-src https:\/\/liff-subwindow\.line\.me/);
  assert.match(memberHtml, /form-action https:\/\/liff-subwindow\.line\.me/);
});
