const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

test('paired E2E receives a persisted evolution profile and records it', () => {
  const admin = read('admin/e2e-control.js');
  const api = read('supabase/functions/test-control-api/index.ts');
  assert.match(api, /buildEvolutionProfile/);
  assert.match(api, /adaptive-e2e-20260923-1/);
  assert.match(api, /generation/);
  assert.match(api, /ratePressure/);
  assert.match(api, /maxRateBucket/);
  assert.match(api, /evolution,\s*runs:/);
  assert.match(api, /summary:[\s\S]*evolution/);
  assert.match(admin, /PAIRED_EVOLUTION_PLAN/);
  assert.match(admin, /normalizeEvolutionProfile/);
  assert.match(admin, /participantEvolution/);
  assert.match(admin, /evolution: runnerKind === 'paired-browser'/);
});

test('scenario order is seeded and difficulty adds bounded challenge rounds', () => {
  const admin = read('admin/e2e-control.js');
  const user = read('user-test-control.js');
  assert.match(admin, /scenarioShuffled\(PAIRED_SURFACES/);
  assert.match(admin, /deepParticipants/);
  assert.match(admin, /deepTargets/);
  assert.match(user, /scenarioShuffled\(fullCommon\.concat/);
  assert.match(user, /challengeRounds/);
  assert.match(user, /EVOLUTION_CHALLENGE_/);
  assert.match(user, /runFull: \(options = \{\}\) => runSuite\('full', options\)/);
  assert.match(admin, /control\.runFull\(\{ evolution: participantEvolution/);
});

test('adaptive backpressure limits polling and booking state retries', () => {
  const admin = read('admin/e2e-control.js');
  const user = read('user-test-control.js');
  assert.match(admin, /bookingNetworkMinIntervalMs/);
  assert.match(admin, /bookingPollMs/);
  assert.match(admin, /Math\.max\(ADMIN_BOOKING_BOOTSTRAP_MIN_INTERVAL_MS/);
  assert.match(user, /bookingStateMaxAttempts/);
  assert.match(user, /Math\.max\(2, Math\.min\(5,/);
  assert.doesNotMatch(user, /const maxAttempts = 4/);
});

test('evolution adds semantic complexity without unbounded parallel admin DOM writes', () => {
  const admin = read('admin/e2e-control.js');
  const api = read('supabase/functions/test-control-api/index.ts');
  assert.match(admin, /let adminChain = Promise\.resolve\(\)/);
  assert.match(admin, /adminChain\.then\(\(\) => runPairedAdminBookingLive/);
  assert.match(api, /challengeRounds: Math\.min\(4/);
  assert.match(api, /deepParticipants: Math\.min\(3/);
  assert.doesNotMatch(api, /Promise\.all\([^\n]*executeCase/);
});
