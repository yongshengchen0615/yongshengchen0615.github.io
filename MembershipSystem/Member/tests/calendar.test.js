'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

function loadCalendarService() {
  class TestApiError extends Error {
    constructor(status, code, message) { super(message); this.status = status; this.code = code; }
  }
  const rows = {
    Members: [{ line_user_id: 'U-1', display_name: '測試會員', status: 'active' }],
    CalendarItems: [
      { calendar_item_id: 'CI-1', title: '店休', item_type: 'holiday', description: '中秋節店休', starts_on: '2026-09-25', ends_on: '2026-09-25', status: 'active', accent: '#DF6B4D', created_by: 'ADMIN-1', created_at: '2026-09-01T00:00:00.000Z', updated_by: 'ADMIN-1', updated_at: '2026-09-01T00:00:00.000Z' },
      { calendar_item_id: 'CI-2', title: '草稿活動', item_type: 'event', description: '', starts_on: '2026-09-27', ends_on: '2026-09-28', status: 'draft', accent: '#278258', created_by: 'ADMIN-1', created_at: '2026-09-01T00:00:00.000Z', updated_by: 'ADMIN-1', updated_at: '2026-09-01T00:00:00.000Z' }
    ],
    AuditLogs: []
  };
  let uuid = 0;
  const context = {
    ApiError: TestApiError,
    Utilities: {
      getUuid: () => '00000000-0000-0000-0000-0000000000' + String(uuid++).padStart(2, '0'),
      formatDate: () => '2026-09-20'
    },
    nowIso_: () => '2026-09-20T00:00:00.000Z',
    withDataLock_: (callback) => callback(),
    rotateMembershipDataCacheEpoch_: () => {},
    ensureMember_: (identity) => rows.Members.find((member) => member.line_user_id === identity.lineUserId),
    readRecords_: (sheetName) => rows[sheetName] || [],
    findRecordWithRow_: (sheetName, keyField, keyValue) => {
      const index = (rows[sheetName] || []).findIndex((record) => String(record[keyField] || '') === String(keyValue || ''));
      return index < 0 ? null : { rowNumber: index + 2, record: rows[sheetName][index] };
    },
    appendRecord_: (sheetName, record) => { rows[sheetName].push(record); },
    updateRecordAtRow_: (sheetName, rowNumber, record) => { rows[sheetName][rowNumber - 2] = record; },
    deleteRecordsWhere_: (sheetName, predicate) => {
      const before = rows[sheetName].length;
      rows[sheetName] = rows[sheetName].filter((record) => !predicate(record));
      return before - rows[sheetName].length;
    },
    appendAuditRecord_: (record) => { rows.AuditLogs.push(record); }
  };
  vm.createContext(context);
  vm.runInContext(read('gas/CalendarService.gs'), context, { filename: 'gas/CalendarService.gs' });
  return { context, rows, TestApiError };
}

test('member calendar returns only active items for a bounded three-month view', () => {
  const { context, TestApiError } = loadCalendarService();
  const result = context.handleCalendarBootstrap_({ lineUserId: 'U-1', displayName: '測試會員' }, { rangeStart: '2026-08-01', rangeEnd: '2026-10-31' });
  assert.equal(result.profile.displayName, '測試會員');
  assert.equal(result.rangeStart, '2026-08-01');
  assert.equal(result.rangeEnd, '2026-10-31');
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].calendarItemId, 'CI-1');
  assert.equal(result.items[0].updatedAt, undefined);
  assert.throws(
    () => context.handleCalendarBootstrap_({ lineUserId: 'U-1', displayName: '測試會員' }, { rangeStart: '2026-08-01', rangeEnd: '2026-11-30' }),
    (error) => error instanceof TestApiError && error.code === 'INVALID_CALENDAR_RANGE'
  );
});

test('calendar item settings normalize one-day entries, enforce conflicts, and audit mutations', () => {
  const { context, rows, TestApiError } = loadCalendarService();
  const create = context.handleCalendarItemSave_({ lineUserId: 'ADMIN-1' }, { role: 'admin' }, {
    calendarItem: { title: '會員日', itemType: 'event', description: '限定活動', startsOn: '2026-10-10', endsOn: '', status: 'active', accent: '#278258' }
  });
  assert.equal(create.calendarItem.startsOn, '2026-10-10');
  assert.equal(create.calendarItem.endsOn, '2026-10-10');
  assert.equal(rows.CalendarItems.at(-1).ends_on, '2026-10-10');
  assert.equal(rows.AuditLogs.at(-1).action, 'CALENDAR_ITEM_SAVE');

  assert.throws(
    () => context.handleCalendarItemSave_({ lineUserId: 'ADMIN-1' }, { role: 'admin' }, {
      expectedUpdatedAt: 'outdated',
      calendarItem: { calendarItemId: 'CI-1', title: '店休', itemType: 'holiday', description: '', startsOn: '2026-09-25', endsOn: '', status: 'active', accent: '#DF6B4D' }
    }),
    (error) => error instanceof TestApiError && error.code === 'CONFLICT'
  );

  const deleted = context.handleCalendarItemDelete_({ lineUserId: 'ADMIN-1' }, { role: 'admin' }, { calendarItemId: create.calendarItem.calendarItemId, expectedUpdatedAt: create.calendarItem.updatedAt });
  assert.equal(deleted.deleted, true);
  assert.equal(rows.CalendarItems.some((item) => item.calendar_item_id === create.calendarItem.calendarItemId), false);
  assert.equal(rows.AuditLogs.at(-1).action, 'CALENDAR_ITEM_DELETE');
});

test('calendar batch mutations validate every operation before writes and preserve individual display colors', () => {
  const { context, rows, TestApiError } = loadCalendarService();
  const beforeRejectedBatch = rows.CalendarItems.map((item) => ({ ...item }));
  const beforeRejectedAuditCount = rows.AuditLogs.length;
  assert.throws(
    () => context.handleCalendarItemBatch_({ lineUserId: 'ADMIN-1' }, { role: 'admin' }, {
      calendarItemOperations: [
        { operation: 'save', calendarItem: { title: '不應寫入', itemType: 'event', description: '', startsOn: '2026-10-01', endsOn: '', status: 'active', accent: '#278258' } },
        { operation: 'delete', calendarItemId: 'CI-1', expectedUpdatedAt: 'outdated' }
      ]
    }),
    (error) => error instanceof TestApiError && error.code === 'CONFLICT'
  );
  assert.deepEqual(rows.CalendarItems, beforeRejectedBatch);
  assert.equal(rows.AuditLogs.length, beforeRejectedAuditCount);

  assert.throws(
    () => context.handleCalendarItemBatch_({ lineUserId: 'ADMIN-1' }, { role: 'admin' }, {
      calendarItemOperations: [
        { operation: 'save', calendarItem: { calendarItemId: 'CI-1', title: '缺少版本', itemType: 'holiday', description: '', startsOn: '2026-09-25', endsOn: '', status: 'active', accent: '#DF6B4D' } }
      ]
    }),
    (error) => error instanceof TestApiError && error.code === 'INVALID_CALENDAR_BATCH'
  );

  const result = context.handleCalendarItemBatch_({ lineUserId: 'ADMIN-1' }, { role: 'admin' }, {
    calendarItemOperations: [
      { operation: 'save', expectedUpdatedAt: '2026-09-01T00:00:00.000Z', calendarItem: { calendarItemId: 'CI-1', title: '店休調整', itemType: 'holiday', description: '調整後說明', startsOn: '2026-09-25', endsOn: '', status: 'active', accent: '#123ABC' } },
      { operation: 'save', calendarItem: { title: '會員限定日', itemType: 'event', description: '可查看完整活動說明', startsOn: '2026-10-10', endsOn: '2026-10-11', status: 'active', accent: '#278258' } },
      { operation: 'delete', calendarItemId: 'CI-2', expectedUpdatedAt: '2026-09-01T00:00:00.000Z' }
    ]
  });
  assert.equal(result.operationCount, 3);
  assert.equal(result.savedCalendarItems.length, 2);
  assert.equal(Array.from(result.deletedCalendarItemIds).join(','), 'CI-2');
  assert.equal(rows.CalendarItems.some((item) => item.calendar_item_id === 'CI-2'), false);
  assert.equal(rows.CalendarItems.find((item) => item.calendar_item_id === 'CI-1').accent, '#123ABC');
  assert.equal(result.savedCalendarItems.find((item) => item.title === '會員限定日').accent, '#278258');
  assert.equal(rows.AuditLogs.filter((entry) => entry.action === 'CALENDAR_ITEM_BATCH_SAVE').length, 2);
  assert.equal(rows.AuditLogs.filter((entry) => entry.action === 'CALENDAR_ITEM_BATCH_DELETE').length, 1);
});

test('calendar client and admin form keep read-only user display and server-admin write boundaries', () => {
  const calendarHtml = read('calendar/index.html');
  const calendarApp = read('calendar/app.js');
  const adminHtml = read('admin/index.html');
  const adminApp = read('admin/app.js');
  const code = read('gas/Code.gs');
  const auth = read('gas/Auth.gs');
  assert.match(calendarHtml, /Content-Security-Policy/);
  assert.match(calendarApp, /signIn\(state\.config, 'calendar'\)/);
  assert.match(calendarApp, /user\.calendar\.bootstrap/);
  assert.match(calendarApp, /rangeStart/);
  assert.match(calendarApp, /initialCalendarDataRange/);
  assert.match(calendarApp, /isLoadedCalendarMonth/);
  assert.match(calendarApp, /handleCalendarTouchStart/);
  assert.match(calendarApp, /handleCalendarWheel/);
  assert.match(calendarApp, /suppressCalendarDayClickUntil/);
  assert.match(calendarHtml, /id="calendarRangeNotice"/);
  assert.match(calendarHtml, /id="calendarDetailModal"/);
  assert.match(calendarHtml, /id="calendarDetailItems"/);
  assert.doesNotMatch(calendarHtml, /id="calendarDetailType"/);
  assert.match(calendarApp, /openCalendarDateDetails/);
  assert.match(calendarApp, /data-calendar-date/);
  assert.match(calendarApp, /state\.items\.filter\(\(item\) => itemOnDate\(item, isoDate\)\)/);
  assert.doesNotMatch(calendarApp, /innerHTML/);
  assert.match(adminHtml, /id="calendarPanel"/);
  assert.match(adminHtml, /id="calendarItemForm"/);
  assert.match(adminHtml, /id="calendarBatchRows"/);
  assert.match(adminApp, /admin\.calendar-items\.save/);
  assert.match(adminApp, /admin\.calendar-items\.delete/);
  assert.match(adminApp, /admin\.calendar-items\.batch/);
  assert.match(code, /case 'admin\.calendar-items\.save':[\s\S]*?authorizeAdmin_\(identity\)[\s\S]*?handleCalendarItemSave_/);
  assert.match(code, /case 'admin\.calendar-items\.delete':[\s\S]*?authorizeAdmin_\(identity\)[\s\S]*?handleCalendarItemDelete_/);
  assert.match(code, /case 'admin\.calendar-items\.batch':[\s\S]*?authorizeAdmin_\(identity\)[\s\S]*?handleCalendarItemBatch_/);
  assert.match(auth, /MEMBERSHIP_CALENDAR_LINE_CHANNEL_ID/);
});
