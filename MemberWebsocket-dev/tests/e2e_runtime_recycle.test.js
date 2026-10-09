const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const migration = read('supabase/migrations/20261009180000_recycle_e2e_runtime_before_run.sql');
const api = read('supabase/functions/test-control-api/index.ts');
const runner = read('admin/e2e-control.js');

test('every full browser E2E run recycles prior QA assets before generating any fixture', () => {
  const paired = runner.slice(runner.indexOf('async function runPaired('), runner.indexOf('async function runPaired(') + 10000);
  const lease = paired.indexOf('await acquireE2ECleanupLease()');
  const recycle = paired.indexOf('await recyclePreviousE2ERuntime(cleanupLeaseId)');
  const backend = paired.indexOf('await runUnifiedServerFullPhase(selectedModules)');
  const fixture = paired.indexOf('await prepareComplexE2EFixtures(profile)');
  assert.ok(lease >= 0 && lease < recycle && recycle < backend && backend < fixture);
  assert.match(runner, /E2E_RUNTIME_RECYCLE/);
  assert.match(runner, /previousCleanup\.alreadyRecycled/);
});

test('recycle is bound to an active admin-owned E2E lease and is one-shot', () => {
  assert.match(migration, /runtime_recycled_at timestamptz/);
  assert.match(migration, /lease_type = 'full_e2e'/);
  assert.match(migration, /actor_line_user_id = p_actor/);
  assert.match(migration, /expires_at > clock_timestamp\(\)/);
  assert.match(migration, /for update;/i);
  assert.match(migration, /if v_recycled_at is not null then\s*return jsonb_build_object\('alreadyRecycled', true/);
  assert.match(migration, /raise exception 'E2E_RECYCLE_OTHER_RUN_ACTIVE'/);
  assert.match(migration, /raise exception 'E2E_RECYCLE_BACKEND_RUN_ACTIVE'/);
  assert.match(migration, /raise exception 'E2E_RECYCLE_QA_ARTIFACTS_REMAIN/);
  assert.match(migration, /revoke all on function public\.admin_recycle_e2e_runtime\(uuid, text\)/);
  assert.match(migration, /grant execute on function public\.admin_recycle_e2e_runtime\(uuid, text\) to service_role/);
});

test('recycle preserves historical result rows, learning state, and test-account identities', () => {
  assert.doesNotMatch(migration, /delete from public\.automation_test_runs\s+where/);
  assert.doesNotMatch(migration, /delete from public\.e2e_case_learning_state/);
  assert.doesNotMatch(migration, /delete from public\.e2e_evolution_state/);
  assert.doesNotMatch(migration, /delete from public\.members\s/);
  assert.match(migration, /TEST_DATA_CROSS_BOUNDARY_POINT_TRANSFER/);
  assert.match(migration, /TEST_DATA_CROSS_BOUNDARY_REFERRAL/);
  assert.match(migration, /delete from public\.point_tickets/);
  assert.match(migration, /delete from public\.event_ticket_claims/);
  assert.match(migration, /admin_purge_extended_qa_artifacts\(\)/);
  assert.match(migration, /remainingQaArtifacts', v_remaining/);
});

test('API fails closed if recycling fails; it does not claim the next run has started', () => {
  assert.match(api, /admin\.test-control\.recycle-e2e-runtime/);
  assert.match(api, /p_lease_id: leaseId/);
  assert.match(api, /p_actor: identity\.lineUserId/);
  assert.match(api, /E2E_RECYCLE_BLOCKED/);
  assert.match(api, /E2E_RECYCLE_INCOMPLETE/);
  assert.match(api, /test_control\.e2e_runtime\.recycle/);
});

test('SQL compiles, disallows anonymous callers and rejects a missing execution lease', async () => {
  const { PGlite } = require('@electric-sql/pglite');
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role;
      create table public.test_execution_leases (
        id uuid primary key, lease_type text not null, actor_line_user_id text not null,
        expires_at timestamptz not null, created_at timestamptz default now()
      );
    `);
    await db.exec(migration);
    const result = await db.query("select has_function_privilege('anon', 'public.admin_recycle_e2e_runtime(uuid,text)', 'execute') as allowed");
    assert.equal(result.rows[0].allowed, false);
    await assert.rejects(
      db.query("select public.admin_recycle_e2e_runtime('00000000-0000-4000-8000-000000000001'::uuid, 'not-an-admin')"),
      /E2E_RECYCLE_LEASE_INVALID/
    );
  } finally {
    await db.close();
  }
});
