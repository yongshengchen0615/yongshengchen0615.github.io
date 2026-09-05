'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

function signedBytes(value) {
  return Array.from(crypto.createHash('sha256').update(String(value)).digest(), (byte) => byte > 127 ? byte - 256 : byte);
}

test('manual new-environment reset clears every data table and restores only default tier settings', () => {
  const cache = new Map();
  const sheetNames = ['Members', 'Admins', 'PointCards', 'PointCardRewards', 'PointCardLotteryPrizes', 'PointCardTicketTemplates', 'PointCardTickets', 'PointCardTicketChallenges', 'EventTickets', 'EventTicketClaims', 'CalendarItems', 'PointBalances', 'PointEntries', 'ServiceTimeEntries', 'MembershipTierSettings', 'AuditLogs'];
  const rows = Object.fromEntries(sheetNames.map((sheetName) => [sheetName, [{ id: `${sheetName}-1` }, { id: `${sheetName}-2` }] ]));
  const sheets = Object.fromEntries(sheetNames.map((sheetName) => [sheetName, {
    getLastRow: () => rows[sheetName].length + 1,
    deleteRows: (startRow, count) => rows[sheetName].splice(startRow - 2, count)
  }]));
  const spreadsheet = { getId: () => 'sheet-reset-1', getSheetByName: (sheetName) => sheets[sheetName] || null };
  const context = {
    CacheService: { getScriptCache: () => ({ get: (key) => cache.get(key) || null, put: (key, value) => { cache.set(key, String(value)); }, remove: (key) => { cache.delete(key); } }) },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    Utilities: { getUuid: () => 'reset-epoch', computeDigest: (_algorithm, value) => signedBytes(value), DigestAlgorithm: { SHA_256: 'SHA_256' }, Charset: { UTF_8: 'UTF_8' } },
    nowIso_: () => '2026-09-05T00:00:00.000Z',
    withDataLock_: (callback) => callback()
  };
  vm.createContext(context);
  vm.runInContext(read('gas/Storage.gs'), context, { filename: 'gas/Storage.gs' });
  vm.runInContext(read('gas/MemberService.gs'), context, { filename: 'gas/MemberService.gs' });
  context.ensureMembershipStorage_ = () => spreadsheet;
  context.appendRecord_ = (sheetName, record) => { rows[sheetName].push(record); };

  const result = context.resetMembershipSystemDataForNewEnvironment();

  assert.equal(result.reset, true);
  assert.equal(result.spreadsheetId, 'sheet-reset-1');
  assert.equal(result.restoredMembershipTierSettings, 4);
  sheetNames.forEach((sheetName) => assert.equal(result.clearedRowsBySheet[sheetName], 2));
  sheetNames.filter((sheetName) => sheetName !== 'MembershipTierSettings').forEach((sheetName) => assert.deepEqual(rows[sheetName], []));
  assert.deepEqual(JSON.parse(JSON.stringify(rows.MembershipTierSettings.map((row) => [row.tier_key, row.required_service_minutes]))), [['general', '0'], ['silver', '600'], ['gold', '1800'], ['platinum', '3600']]);
  assert.equal(cache.get('membership:data-epoch:v1'), 'reset-epoch');
});
