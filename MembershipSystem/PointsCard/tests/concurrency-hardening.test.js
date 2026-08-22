'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
function read(relativePath) { return fs.readFileSync(path.join(root, relativePath), 'utf8'); }

test('ticket reminder sweep never holds the global script lock across LINE network delivery', () => {
  const reminders = read('gas/TicketNotificationService.gs');
  const sweepStart = reminders.indexOf('function runPointsCardTicketReminderSweep()');
  const installerStart = reminders.indexOf('function installPointsCardTicketReminderTrigger()', sweepStart);
  assert.ok(sweepStart >= 0 && installerStart > sweepStart, 'reminder sweep source must be present');

  const sweep = reminders.slice(sweepStart, installerStart);
  assert.doesNotMatch(sweep, /LockService\.getScriptLock\(\)/,
    'the sweep must not own a long-lived global lock');
  assert.match(reminders, /function claimTicketReminderAttempt_[\s\S]*?LockService\.getScriptLock\(\)/);
  assert.match(reminders, /function finalizeTicketReminderAttempt_[\s\S]*?LockService\.getScriptLock\(\)/);

  const claimIndex = sweep.indexOf('claimTicketReminderAttempt_(');
  const pushIndex = sweep.indexOf('lineMessaging.sendTextPush(');
  const finalizeIndex = sweep.indexOf('finalizeTicketReminderAttempt_(');
  assert.ok(claimIndex >= 0 && pushIndex > claimIndex && finalizeIndex > pushIndex,
    'reminders must be claimed, sent outside the lock, then finalized');
});

test('member point notification listing uses a member-scoped exact lookup instead of a full-table scan', () => {
  const storage = read('gas/AdminPointGrantStorage.gs');
  const service = read('gas/MemberPointNotificationService.gs');

  assert.match(storage, /function readAdminPointGrantObjectsByField_/);
  assert.match(service, /readAdminPointGrantObjectsByField_\(\s*POINTS_CARD_ADMIN_GRANTS\.notificationsSheet,\s*'memberLineUserId'/);
  assert.doesNotMatch(
    service.match(/function memberPointNotificationsList_\([\s\S]*?\n\}/)[0],
    /readAdminPointGrantObjects_\(POINTS_CARD_ADMIN_GRANTS\.notificationsSheet\)/
  );
});

test('member-scoped point notification lookup materializes only exact matching rows for bounded matches', () => {
  const source = read('gas/AdminPointGrantStorage.gs') +
    '\n;globalThis.__notificationLookup = { readAdminPointGrantObjectsByField_ };';
  let searchReads = 0;
  let rowReads = 0;
  let fullTableReads = 0;
  const rows = {
    10: ['PN-A', 'U1', 'PC-1', 'CARD-A', 'Card A', 'point-grant', 'A', 'A', 1, 1, 'G1', 'unread', '1', '', '1'],
    20: ['PN-B', 'U1', 'PC-1', 'CARD-A', 'Card A', 'point-grant', 'B', 'B', 1, 2, 'G2', 'unread', '2', '', '2']
  };
  const sheet = {
    getLastRow: () => 1000,
    getRange(row, column, rowCount, columnCount) {
      if (row === 2 && column === 2 && rowCount === 999 && columnCount === 1) {
        return {
          createTextFinder: () => ({
            matchEntireCell() { return this; },
            useRegularExpression() { return this; },
            findAll() {
              searchReads += 1;
              return [{ getRow: () => 10 }, { getRow: () => 20 }];
            }
          })
        };
      }
      if (rowCount === 1 && column === 1) {
        return {
          getValues: () => {
            rowReads += 1;
            return [rows[row]];
          }
        };
      }
      fullTableReads += 1;
      return { getValues: () => [] };
    }
  };
  const context = {
    getSpreadsheet_: () => ({ getSheetByName: () => sheet }),
    safeCellText_: (value) => value,
    storedNonNegativeInt_: (value) => Number(value || 0),
    fail_: (code, message) => { throw Object.assign(new Error(message), { code }); }
  };
  vm.createContext(context);
  vm.runInContext(source, context);

  const result = context.__notificationLookup.readAdminPointGrantObjectsByField_(
    'MemberPointNotifications',
    'memberLineUserId',
    'U1'
  );
  assert.equal(result.length, 2);
  assert.equal(searchReads, 1);
  assert.equal(rowReads, 2);
  assert.equal(fullTableReads, 0, 'bounded member lookups must not read the entire notification table');
});
