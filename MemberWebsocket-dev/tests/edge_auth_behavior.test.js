const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const root = path.resolve(__dirname, '..');

function fixture(overrides = {}) {
  let dbReads = 0;
  const responses = {
    test_mode_settings: { maintenance_enabled: false, maintenance_revoked_after: null },
    admins: null,
    members: { force_logout_after: null },
    ...overrides.rows,
  };
  const now = Math.floor(Date.now() / 1000);
  const claims = { sub: 'fixture-identity', aud: 'member-channel', iss: 'https://access.line.me', exp: now + 60, iat: now - 60, ...overrides.claims };
  let source = fs.readFileSync(path.join(root, 'supabase/functions/_shared/auth-contract.ts'), 'utf8');
  source = source.replace('export async function', 'async function').replace('export async function', 'async function')
    .replace('export type', 'type').replace('await import("npm:@supabase/supabase-js@2.57.0")', 'testClient');
  source = stripTypeScriptTypes(source, { mode: 'transform' });
  const context = vm.createContext({ Date, URLSearchParams,
    Deno: { env: { get: name => ({ SUPABASE_URL: 'https://fixture.test', SUPABASE_SERVICE_ROLE_KEY: 'test-only', LINE_ADMIN_CHANNEL_ID: 'admin-channel' }[name]) } },
    fetch: async () => ({ ok: true, json: async () => claims }),
    testClient: { createClient: () => ({ from: table => ({ select() { return this; }, eq() { return this; },
      maybeSingle: async () => { dbReads++; return { data: responses[table], error: overrides.dbError ? {} : null }; } }) }) },
  });
  vm.runInContext(source, context);
  return { verify: idToken => context.verifyLineIdTokenContract({ idToken, expectedChannelId: overrides.channel || 'member-channel',
    createError: (status, code) => Object.assign(new Error(code), { status, code }) }), reads: () => dbReads };
}

test('canonical identity rejects absent and invalid claims before reading protected data', async () => {
  const absent = fixture(); await assert.rejects(absent.verify(''), { code: 'AUTH_REQUIRED', status: 401 }); assert.equal(absent.reads(), 0);
  for (const claims of [{ aud: 'other-channel' }, { iss: 'https://untrusted.test' }, { exp: 1 }, { iat: 0 }]) {
    const h = fixture({ claims }); await assert.rejects(h.verify('fixture'), { code: 'AUTH_INVALID', status: 401 }); assert.equal(h.reads(), 0);
  }
});

test('membership session revocation and maintenance stay effective for admins using member surfaces', async () => {
  const admins = { role: 'admin', status: 'active' };
  const revoked = fixture({ rows: { admins, members: { force_logout_after: new Date().toISOString() } } });
  await assert.rejects(revoked.verify('fixture'), { code: 'SESSION_REVOKED', status: 401 });
  const maintenance = fixture({ rows: { admins, test_mode_settings: { maintenance_enabled: true } } });
  await assert.rejects(maintenance.verify('fixture'), { code: 'SYSTEM_MAINTENANCE', status: 503 });
  const adminSurface = fixture({ channel: 'admin-channel', claims: { aud: 'admin-channel' }, rows: { admins,
    members: { force_logout_after: new Date().toISOString() }, test_mode_settings: { maintenance_enabled: true } } });
  assert.equal((await adminSurface.verify('fixture')).lineUserId, 'fixture-identity');
  const dbFailure = fixture({ dbError: true });
  await assert.rejects(dbFailure.verify('fixture'), { code: 'ACCESS_CONTROL_UNAVAILABLE', status: 503 });
});
