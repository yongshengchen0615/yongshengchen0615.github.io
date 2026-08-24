'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

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

test('server keeps the not-past date policy in Code.gs without a standalone GAS file', () => {
  const code = read('gas/Code.gs');
  const standalonePolicy = path.join(root, 'gas', 'CalendarDatePolicy.gs');

  assert.equal(fs.existsSync(standalonePolicy), false);
  assert.match(code, /CALENDAR_BUSINESS_TIME_ZONE_\s*=\s*'Asia\/Taipei'/);
  assert.match(code, /function enforceAdminCalendarNotPast_/);
  assert.match(code, /Utilities\.formatDate\(new Date\(\), CALENDAR_BUSINESS_TIME_ZONE_, 'yyyy-MM-dd'\)/);
  assert.match(code, /startDate < today \|\| endDate < today/);
  assert.match(code, /PAST_DATE_NOT_ALLOWED/);
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
