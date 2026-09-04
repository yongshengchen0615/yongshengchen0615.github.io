'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

function makeCalendarRecord(id, startDate, endDate, status = 'published') {
  return {
    item_id: id,
    type: 'event',
    title: '測試事項 ' + id,
    start_date: startDate,
    end_date: endDate,
    all_day: 'true',
    start_time: '',
    end_time: '',
    description: '',
    location: '',
    status,
    created_by: 'tester',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_by: 'tester',
    updated_at: '2026-01-01T00:00:00.000Z',
    color: '#3182B8'
  };
}

function createCalendarServiceHarness(records) {
  const cache = new Map();
  const sandbox = {
    CacheService: {
      getScriptCache: () => ({
        get: (key) => cache.get(key) || null,
        put: (key, value) => cache.set(key, value)
      })
    },
    Utilities: {
      newBlob: (value) => ({ getBytes: () => Array.from(Buffer.from(String(value), 'utf8')) })
    },
    getCalendarDataRevision_: () => 'range-test',
    readRecords_: () => records
  };
  vm.createContext(sandbox);
  const source = [
    read('gas/Code.gs'),
    read('gas/CalendarService.gs'),
    'globalThis.__calendarRangeHooks = { calendarListRangeFromRequest_, listCalendarItems_ };'
  ].join('\n');
  new vm.Script(source, { filename: 'CalendarSystem-range-test.gs' }).runInContext(sandbox);
  return sandbox.__calendarRangeHooks;
}

function expectApiError(callback, code) {
  assert.throws(callback, (error) => error && error.code === code);
}

test('calendar list ranges include overlapping records and reject incomplete or oversized ranges', () => {
  const hooks = createCalendarServiceHarness([
    makeCalendarRecord('before', '2026-09-01', '2026-09-05'),
    makeCalendarRecord('overlap-start', '2026-09-25', '2026-10-03'),
    makeCalendarRecord('inside', '2026-10-10', '2026-10-10'),
    makeCalendarRecord('overlap-end', '2026-10-30', '2026-11-04'),
    makeCalendarRecord('after', '2026-11-10', '2026-11-12'),
    makeCalendarRecord('draft', '2026-10-10', '2026-10-10', 'draft')
  ]);
  const range = hooks.calendarListRangeFromRequest_({ rangeStart: '2026-10-01', rangeEnd: '2026-11-01' });
  const publicItems = hooks.listCalendarItems_(false, range);
  const adminItems = hooks.listCalendarItems_(true, range);

  assert.deepEqual(publicItems.map((item) => item.itemId), ['overlap-start', 'inside', 'overlap-end']);
  assert.deepEqual(adminItems.map((item) => item.itemId), ['overlap-start', 'draft', 'inside', 'overlap-end']);
  expectApiError(() => hooks.calendarListRangeFromRequest_({ rangeStart: '2026-10-01' }), 'INVALID_LIST_RANGE');
  expectApiError(() => hooks.calendarListRangeFromRequest_({ rangeStart: '2026-10-01', rangeEnd: '2026-11-12' }), 'LIST_RANGE_TOO_LARGE');
});

test('rate limiting provides an actionable retry delay without weakening the weighted cap', () => {
  const entries = new Map();
  const sandbox = {
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' },
      Charset: { UTF_8: 'utf8' },
      computeDigest: () => Array.from({ length: 32 }, () => 1)
    },
    CacheService: {
      getScriptCache: () => ({
        get: (key) => entries.get(key) || null,
        put: (key, value) => entries.set(key, value)
      })
    },
    LockService: {
      getScriptLock: () => ({ waitLock() {}, releaseLock() {} })
    }
  };
  vm.createContext(sandbox);
  const source = read('gas/Code.gs') + '\nglobalThis.__rateLimitHooks = { enforceRateLimit_ };';
  new vm.Script(source, { filename: 'CalendarSystem-rate-limit-test.gs' }).runInContext(sandbox);

  sandbox.__rateLimitHooks.enforceRateLimit_(
    'bulk-token',
    'admin.calendar.bulkUpdate',
    { updates: Array.from({ length: 20 }, () => ({})) }
  );
  assert.throws(
    () => sandbox.__rateLimitHooks.enforceRateLimit_(
      'bulk-token',
      'admin.calendar.bulkUpdate',
      { updates: Array.from({ length: 20 }, () => ({})) }
    ),
    (error) => error && error.code === 'RATE_LIMITED' &&
      Number.isInteger(error.details && error.details.retryAfterSeconds) &&
      error.details.retryAfterSeconds >= 1 &&
      error.details.retryAfterSeconds <= 60
  );
});
