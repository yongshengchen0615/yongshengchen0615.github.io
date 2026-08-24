'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'gas', 'Code.gs'), 'utf8');

test('usage recording resolves a bearer code only after acquiring ScriptLock', () => {
  const start = source.indexOf('function usageRecord_(');
  const end = source.indexOf('\nfunction recoverOrReturnUsageRecord_', start);
  assert.ok(start >= 0 && end > start, 'usageRecord_ source must be present');

  const body = source.slice(start, end);
  const lockIndex = body.indexOf("if (!lock.tryLock(5000))");
  const lookupIndex = body.indexOf('const located = findUsageVoucherByAccess_(access);');
  const rowReadIndex = body.indexOf('getRange(located.row');

  assert.ok(lockIndex >= 0, 'usageRecord_ must acquire ScriptLock');
  assert.ok(lookupIndex > lockIndex, 'bearer lookup must happen after ScriptLock acquisition');
  assert.ok(rowReadIndex > lookupIndex, 'the locked lookup row must be used for the voucher read');
  assert.equal((body.match(/findUsageVoucherByAccess_\(access\);/g) || []).length, 1, 'usageRecord_ must not keep a pre-lock lookup');
});
