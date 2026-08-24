'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const adminScript = fs.readFileSync(path.resolve(__dirname, '../admin/minute-grants.js'), 'utf8');
const code = fs.readFileSync(path.resolve(__dirname, '../gas/Code.gs'), 'utf8');

test('manual minute grant form is moved into the selected member dialog', () => {
  assert.match(adminScript, /function prepareMemberDialogGrantUi\(\)/);
  assert.match(adminScript, /editForm\.insertBefore\(panel, editError\)/);
  assert.match(adminScript, /function memberFromEditDialog\(\)/);
  assert.match(adminScript, /\$\('#editTargetMemberNo'\)\.value\.trim\(\)/);
  assert.match(adminScript, /MutationObserver[\s\S]*selectMemberFromOpenDialog/);
  assert.doesNotMatch(adminScript, /admin\.list[\s\S]*minuteGrantMemberSearch/);
});

test('grant result keeps the open member dialog concurrency token and totals current', () => {
  assert.match(adminScript, /function syncGrantResultToEditDialog\(member\)/);
  assert.match(adminScript, /\$\('#editExpectedUpdatedAt'\)\.value = member\.updatedAt/);
  assert.match(adminScript, /\$\('#editTier'\)\.value = tierLabel\[member\.tier\]/);
  assert.match(adminScript, /\$\('#editConsumedMinutes'\)\.value = `\$\{formatMinutes\(member\.consumedMinutes\)\} 分鐘`/);
  assert.match(adminScript, /adminRefreshButton/);
});

test('grant history and retry remain available while the grant API stays server-admin protected', () => {
  assert.match(adminScript, /admin\.minutes\.grant/);
  assert.match(adminScript, /admin\.minutes\.grants\.list/);
  assert.match(adminScript, /admin\.minutes\.push\.retry/);
  assert.match(code, /case 'admin\.minutes\.grant':\s*requireAdmin_\(context\);/s);
  assert.match(code, /case 'admin\.minutes\.push\.retry':\s*requireAdmin_\(context\);/s);
  assert.doesNotThrow(() => new vm.Script(adminScript));
});
