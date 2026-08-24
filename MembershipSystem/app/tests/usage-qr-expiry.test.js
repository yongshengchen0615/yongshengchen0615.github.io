'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

function loadGasHelpers() {
  const sourcePath = path.resolve(__dirname, '../gas/Code.gs');
  const source = fs.readFileSync(sourcePath, 'utf8');
  const context = { console };
  vm.createContext(context);
  vm.runInContext(
    source + '\nthis.__usageExpiryExports = { validateVoucherExpiry_, effectiveVoucherStatus_ };',
    context
  );
  return context.__usageExpiryExports;
}

test('permanent QR expiry is represented by an empty expiresAt value', () => {
  const api = loadGasHelpers();
  assert.equal(api.validateVoucherExpiry_(''), '');
  assert.equal(api.validateVoucherExpiry_(null), '');
  assert.equal(api.validateVoucherExpiry_('   '), '');
});

test('timed QR accepts a valid future timestamp beyond the old 30-day ceiling', () => {
  const api = loadGasHelpers();
  const future = new Date(Date.now() + 400 * 24 * 60 * 60 * 1000).toISOString();
  assert.equal(api.validateVoucherExpiry_(future), future);
});

test('timed QR rejects invalid or non-future expiry values', () => {
  const api = loadGasHelpers();
  const past = new Date(Date.now() - 60 * 1000).toISOString();

  assert.throws(
    () => api.validateVoucherExpiry_(past),
    (error) => error && error.publicCode === 'INVALID_EXPIRY'
  );
  assert.throws(
    () => api.validateVoucherExpiry_('not-a-date'),
    (error) => error && error.publicCode === 'INVALID_EXPIRY'
  );
});

test('permanent repeatable QR remains issued until explicitly stopped', () => {
  const api = loadGasHelpers();
  assert.equal(api.effectiveVoucherStatus_({ status: 'issued', scanMode: 'repeatable', expiresAt: '' }, 0), 'issued');
  assert.equal(api.effectiveVoucherStatus_({ status: 'cancelled', scanMode: 'repeatable', expiresAt: '' }, 0), 'cancelled');
});

test('single-use semantics still override permanent expiry after first record', () => {
  const api = loadGasHelpers();
  assert.equal(api.effectiveVoucherStatus_({ status: 'issued', scanMode: 'single', expiresAt: '' }, 1), 'redeemed');
});

test('expired timed QR expires and malformed persisted expiry fails closed', () => {
  const api = loadGasHelpers();
  const past = new Date(Date.now() - 60 * 1000).toISOString();
  assert.equal(api.effectiveVoucherStatus_({ status: 'issued', scanMode: 'repeatable', expiresAt: past }, 0), 'expired');
  assert.equal(api.effectiveVoucherStatus_({ status: 'issued', scanMode: 'repeatable', expiresAt: 'corrupt' }, 0), 'expired');
});

test('admin UI exposes permanent/timed modes and JavaScript remains syntactically valid', () => {
  const html = fs.readFileSync(path.resolve(__dirname, '../admin/index.html'), 'utf8');
  const script = fs.readFileSync(path.resolve(__dirname, '../admin/app.js'), 'utf8');

  assert.match(html, /id="usageExpiryMode"/);
  assert.match(html, /value="timed">指定期限</);
  assert.match(html, /value="permanent">無期限</);
  assert.match(html, /無期限 QR Code 在管理員停止前會持續有效/);
  assert.match(script, /expiryMode === 'timed'/);
  assert.match(script, /expiryMode !== 'permanent'/);
  assert.match(script, /expiresAt = ''/);
  assert.doesNotThrow(() => new vm.Script(script));
});
