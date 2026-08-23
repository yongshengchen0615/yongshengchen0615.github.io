'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

function loadDatePolicy(today = '2026-08-23') {
  class TestApiError extends Error {
    constructor(status, code, message, details) {
      super(message);
      this.status = status;
      this.code = code;
      this.details = details || null;
    }
  }

  const context = {
    ApiError: TestApiError,
    Utilities: {
      formatDate(date, timeZone, format) {
        assert.ok(date instanceof Date);
        assert.equal(timeZone, 'Asia/Taipei');
        assert.equal(format, 'yyyy-MM-dd');
        return today;
      }
    },
    Date,
    isNaN
  };

  vm.createContext(context);
  vm.runInContext(read('gas/CalendarDatePolicy.gs'), context);
  return context;
}

test('admin date picker limits start to today and end to start date', () => {
  const html = read('admin/index.html');
  const constraints = read('admin/date-constraints.js');

  assert.match(html, /date-constraints\.js/);
  assert.match(constraints, /BUSINESS_TIME_ZONE\s*=\s*'Asia\/Taipei'/);
  assert.match(constraints, /startDate\.min\s*=\s*today/);
  assert.match(constraints, /endDate\.min\s*=\s*start && start > today \? start : today/);
  assert.match(constraints, /endDate\.value < start/);
  assert.match(constraints, /結束日期不得早於開始日期/);
  assert.match(constraints, /已經過去的日期/);
  assert.match(constraints, /form\.addEventListener\('submit', blockInvalidSubmit, true\)/);
});

test('server rejects past dates but allows today and future dates', () => {
  const policy = loadDatePolicy('2026-08-23');

  assert.doesNotThrow(() => policy.enforceAdminCalendarNotPast_({
    startDate: '2026-08-23',
    endDate: '2026-08-23'
  }));
  assert.doesNotThrow(() => policy.enforceAdminCalendarNotPast_({
    startDate: '2026-08-24',
    endDate: '2026-08-30'
  }));

  assert.throws(
    () => policy.enforceAdminCalendarNotPast_({ startDate: '2026-08-22', endDate: '2026-08-23' }),
    (error) => error && error.status === 400 && error.code === 'PAST_DATE_NOT_ALLOWED'
  );
  assert.throws(
    () => policy.enforceAdminCalendarNotPast_({ startDate: '2026-08-23', endDate: '2026-08-22' }),
    (error) => error && error.status === 400 && error.code === 'PAST_DATE_NOT_ALLOWED'
  );
});

test('server date policy runs only after admin authorization for create and update', () => {
  const code = read('gas/Code.gs');
  const createCase = code.match(/case 'admin\.calendar\.create':[\s\S]*?break;/);
  const updateCase = code.match(/case 'admin\.calendar\.update':[\s\S]*?break;/);

  assert.ok(createCase);
  assert.ok(updateCase);
  assert.match(createCase[0], /authorizeAdmin_\(identity\)[\s\S]*enforceAdminCalendarNotPast_\(request\.item\)[\s\S]*handleAdminCalendarCreate_/);
  assert.match(updateCase[0], /authorizeAdmin_\(identity\)[\s\S]*enforceAdminCalendarNotPast_\(request\.item\)[\s\S]*handleAdminCalendarUpdate_/);
});

test('general service validation still rejects end dates before start dates', () => {
  const service = read('gas/CalendarService.gs');
  assert.match(service, /if \(endDate < startDate\)/);
  assert.match(service, /INVALID_DATE_RANGE/);
  assert.match(service, /結束日期不得早於開始日期/);
});
