'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('deleting a card permanently revokes active stamp QR codes before any later reactivation', () => {
  const source = read('gas/CardService.gs');

  assert.match(source, /function cancelActiveStampVouchersForCardLifecycle_/);
  assert.match(source, /statusValues\.forEach/);
  assert.match(source, /String\(row\[0\] \|\| ''\) === 'active'/);
  assert.match(source, /getRangeList\(rangesForColumn_\(statusColumn\)\)\.setValue\('cancelled'\)/);
  assert.match(source, /getRangeList\(rangesForColumn_\(cancelledByColumn\)\)\.setValue\(actorLineUserId\)/);
  assert.match(source, /invalidateSheetObjects_\(sheet\)/);
  assert.match(source, /revokedStampQrCount = cancelActiveStampVouchersForCardLifecycle_/);
  assert.match(source, /if \(current\.storedStatus === 'deleted'\)[\s\S]*cancelActiveStampVouchersForCardLifecycle_/);
  assert.match(source, /POINTS_CARD_DELETED[\s\S]*revokedStampQrCount/);
});
