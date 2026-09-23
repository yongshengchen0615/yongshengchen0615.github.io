const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

test('all five user surfaces load the human-evidence E2E runner asset', () => {
  for (const surface of ['member', 'points', 'event', 'calendar', 'booking']) {
    const html = read(surface + '/index.html');
    assert.match(html, /user-test-control\.js\?v=human-e2e-20260923-6/);
  }
});

test('user full E2E requires observable UI events for Human E2E cases', () => {
  const runner = read('user-test-control.js');
  assert.match(runner, /const VERSION = '2026-09-23\.6'/);
  assert.match(runner, /captureHumanInteraction/);
  assert.match(runner, /\['click', 'input', 'change', 'submit'\]/);
  assert.match(runner, /humanRequired: domain === 'Human E2E'/);
  assert.match(runner, /humanInteractionEventsAtLeast: 1/);
  assert.match(runner, /missingEvidenceKeys/);
  assert.match(runner, /MEMBER_HUMAN_PROFILE_EDIT/);
  assert.match(runner, /POINTS_HUMAN_REDEEM/);
  assert.match(runner, /EVENT_HUMAN_LIFECYCLE/);
  assert.match(runner, /CALENDAR_HUMAN_DETAIL/);
  assert.match(runner, /BOOKING_HUMAN_LIFECYCLE/);
  assert.match(runner, /BOOKING_HUMAN_GROUP/);
  assert.doesNotMatch(runner, /data-qa-run="quick"|data-qa-run="full"/);
  assert.doesNotMatch(runner, /runQuick: \(\) => runSuite\('quick'\)/);
});

test('admin paired full E2E requires human UI evidence and covers every client surface', () => {
  const html = read('admin/index.html');
  const runner = read('admin/e2e-control.js');
  assert.match(html, /e2e-control\.js\?v=admin-e2e-20260923-18/);
  assert.match(runner, /const VERSION = '2026-09-23\.18'/);
  assert.match(runner, /captureAdminHumanInteraction/);
  assert.match(runner, /adminHumanRequired/);
  assert.match(runner, /humanInteractionEventsAtLeast: 1/);
  assert.match(runner, /humanInteractionVerified/);
  assert.match(runner, /PAIRED_HUMAN_INTERACTION_COVERAGE/);
  assert.match(runner, /if \(!state\.cancelled\) \{/);
  assert.doesNotMatch(runner, /bookingOnly|includeAdminSuite/);
  for (const surface of ['member', 'points', 'event', 'calendar', 'booking']) {
    assert.match(runner, new RegExp("\\['" + surface + "',"));
  }
});

test('coverage assertion is observational and does not recursively require its own UI event', () => {
  const runner = read('admin/e2e-control.js');
  assert.match(
    runner,
    /normalizedKey === 'PAIRED_HUMAN_INTERACTION_COVERAGE' \|\| normalizedDomain === 'Coverage'/
  );
});

test('fixture and assertion APIs remain separate from the human UI gate', () => {
  const user = read('user-test-control.js');
  const admin = read('admin/e2e-control.js');
  assert.match(user, /user\.qa\.usage-state\.prepare/);
  assert.match(user, /recordBrowserRun/);
  assert.match(admin, /prepareComplexE2EFixtures/);
  assert.match(admin, /recordResultRows/);
  assert.match(admin, /pairedHumanInteractionCoverageCase/);
});


test('event human E2E exercises a deterministic activity lottery and persists its result', () => {
  const runner = read('user-test-control.js');
  const api = read('supabase/functions/user-test-api/index.ts');
  assert.match(api, /QA-UI-EVT-LOT-/);
  assert.match(api, /ticket_type: "lottery"/);
  assert.match(api, /prizeTitle: "E2E 必中獎"/);
  assert.match(api, /winRate: 100/);
  assert.match(api, /lotteryEventTicketId/);
  assert.match(runner, /fixture\.lotteryEventTicketId/);
  assert.match(runner, /#ticketModalResult \.lottery-result strong/);
  assert.match(runner, /resultVisible/);
  assert.match(runner, /resultPersisted/);
  assert.match(runner, /lotteryResultPersisted: true/);
});
