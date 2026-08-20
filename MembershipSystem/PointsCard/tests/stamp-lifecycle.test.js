'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('stamp QR supports limited and unlimited expiry without treating blank expiry as expired', () => {
  const stamps = read('gas/StampService.gs');
  const source = stamps + '\n;globalThis.__stampLifecycleTest = { validateVoucherForStamp_ };';
  const context = {
    Date,
    Array,
    String,
    Number,
    Object,
    Math,
    console,
    fail_(code, message) {
      throw Object.assign(new Error(message), { code });
    }
  };
  vm.createContext(context);
  vm.runInContext(source, context);

  assert.doesNotThrow(() => context.__stampLifecycleTest.validateVoucherForStamp_({
    status: 'active',
    expiresAt: ''
  }));

  assert.throws(() => context.__stampLifecycleTest.validateVoucherForStamp_({
    status: 'active',
    expiresAt: '2000-01-01T00:00:00.000Z'
  }), (error) => error.code === 'VOUCHER_EXPIRED');

  assert.throws(() => context.__stampLifecycleTest.validateVoucherForStamp_({
    status: 'deleted',
    expiresAt: ''
  }), (error) => error.code === 'VOUCHER_INACTIVE');

  assert.match(stamps, /rawExpiresAt \? validIsoFuture_\(rawExpiresAt\) : ''/);
});

test('used stamp QR deletion preserves history while removing deleted QR from admin list', () => {
  const stamps = read('gas/StampService.gs');
  assert.match(stamps, /voucher\.status = 'deleted'/);
  assert.match(stamps, /preserveHistory: hasRecords/);
  assert.match(stamps, /voucher\.status !== 'deleted'/);
  assert.match(stamps, /deleteObjectRow_\(sheet, match\.row\)/);
});

test('admin expiry controls and QR loading state are wired without syntax errors', () => {
  const html = read('admin/index.html');
  const script = read('admin/app.js');

  assert.match(html, /id="stampExpiryMode"/);
  assert.match(html, /value="unlimited">無期限/);
  assert.match(html, /id="stampExpiryField"/);
  assert.match(html, /id="stampUrlField"/);

  assert.match(script, /function syncStampExpiryMode/);
  assert.match(script, /expiresAt: ''/);
  assert.match(script, /voucher\.expiresAt \? PointsCard\.formatDateTime\(voucher\.expiresAt, '—'\) : '無期限'/);
  assert.match(script, /function showStampLoadingState/);
  assert.match(script, /showStampLoadingState\(\);\s*openDialog\(\$\('stampDialog'\)\);\s*try \{\s*const result = await PointsCard\.callApi\('admin\.stamp\.open'/s);
  assert.match(script, /歷史集點與稽核紀錄會保留/);

  assert.doesNotThrow(() => new vm.Script(script));
});
