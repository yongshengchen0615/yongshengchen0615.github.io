const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {inspect} = require('../e2e-member-activity-evidence.js');
const root = path.resolve(__dirname,'..');

const history = (cases, records = {}) => ({records:{testAutomation:cases,...records}});
const run = (caseKey,status='passed',runCode='QA-CLIENT-1') =>
  ({caseKey,status,runStatus:'passed',runCode});

test('member activity evidence rejects a claimed browser run with no member-linked history', () => {
  const report = inspect(history([]),['QA-CLIENT-1']);
  assert.equal(report.ok,false);
  assert.deepEqual(report.missingRunCodes,['QA-CLIENT-1']);
  assert.equal(report.observedCounts.testAutomation,0);
});
test('member activity verifies actual point redemption, event redemption, and booking rows', () => {
  const cases = ['POINTS_HUMAN_REDEEM','EVENT_HUMAN_LIFECYCLE','BOOKING_HUMAN_LIFECYCLE',
    'BOOKING_HUMAN_GROUP','BOOKING_BENEFIT_REDEMPTION_LIFECYCLE'].map(key => run(key));
  const observed = history(cases,{
    pointCards:[{recordType:'point_ticket',usedAt:'2026-10-15T08:00:00Z'}],
    eventTickets:[{usedAt:'2026-10-15T08:00:00Z'},{usedAt:'2026-10-15T08:01:00Z'}],
    bookings:[
      {bookingId:'book-1',memberNote:'QA HUMAN E2E abc updated',partySize:1},
      {bookingId:'book-2',memberNote:'QA HUMAN E2E GROUP abc',partySize:2},
      {bookingId:'book-3',memberNote:'QA HUMAN E2E BENEFIT xyz',partySize:1}]
  });
  const report = inspect(observed,['QA-CLIENT-1']);
  assert.equal(report.ok,true);
  assert.equal(report.evidenceLevel,'business-record-verified');
  assert.equal(report.observedActions.length,5);
});
test('passing self-report without the corresponding member operations must fail verification', () => {
  const report = inspect(history([run('POINTS_HUMAN_REDEEM'),run('BOOKING_HUMAN_LIFECYCLE')]),['QA-CLIENT-1']);
  assert.equal(report.ok,false);
  assert.deepEqual(report.missingActions.map(item => item.caseKey),['POINTS_HUMAN_REDEEM','BOOKING_HUMAN_LIFECYCLE']);
});
test('no historical activity from a different member can satisfy a missing run', () => {
  const report = inspect(history([run('POINTS_HUMAN_REDEEM','passed','OTHER-MEMBER')],{
    pointCards:[{recordType:'point_ticket',usedAt:'2026-10-15T08:00:00Z'}]
  }),['QA-CLIENT-1']);
  assert.equal(report.ok,false);
  assert.deepEqual(report.missingRunCodes,['QA-CLIENT-1']);
  assert.deepEqual(report.observedActions,[]);
});
test('unknown or skipped status cannot be accepted as passed; read-only checks remain case-only', () => {
  const result = inspect(history([run('COMMON_BOOTSTRAP'),{...run('MEMBER_HUMAN_PROFILE_EDIT'),status:'skipped'}]),['QA-CLIENT-1']);
  assert.equal(result.ok,false);
  assert.equal(result.rejectedCases[0].caseKey,'MEMBER_HUMAN_PROFILE_EDIT');
  const readOnly = inspect(history([run('COMMON_BOOTSTRAP')]),['QA-CLIENT-1']);
  assert.equal(readOnly.ok,true);
  assert.equal(readOnly.evidenceLevel,'case-record-only-or-incomplete');
});
test('every requested run code requires member-bound cases, not just the most recent run', () => {
  const result = inspect(history([run('COMMON_BOOTSTRAP','passed','QA-CLIENT-2')]),['QA-CLIENT-1','QA-CLIENT-2']);
  assert.deepEqual(result.missingRunCodes,['QA-CLIENT-1']);
  assert.equal(result.ok,false);
});
test('paired browser runner reads member usage history from authorized API, not the legacy member 360 modal', () => {
  const source = fs.readFileSync(path.join(root,'admin/e2e-control.js'),'utf8');
  const start = source.indexOf('async function verifyUserRunsVisibleInAdmin(');
  const end = source.indexOf('\n  async function createEphemeralTestAccount()',start);
  assert.ok(start>=0 && end>start);
  const fn = source.slice(start,end);
  assert.match(fn,/admin\.member-records\.list/);
  assert.match(fn,/MemberE2EActivityEvidence/);
  assert.doesNotMatch(fn,/modal\.querySelector/);
  const html = fs.readFileSync(path.join(root,'admin/index.html'),'utf8');
  assert.ok(html.indexOf('../e2e-member-activity-evidence.js')>=0);
  assert.ok(html.indexOf('../e2e-member-activity-evidence.js') < html.indexOf('./e2e-control-loader.js'));
});
