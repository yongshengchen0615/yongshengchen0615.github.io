const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const root = path.resolve(__dirname, '..');
const member = fs.readFileSync(path.join(root, 'member-system.js'), 'utf8');
const booking = fs.readFileSync(path.join(root, 'booking/common.js'), 'utf8');
const api = fs.readFileSync(path.join(root, 'supabase/functions/api/index.ts'), 'utf8');
const auth = fs.readFileSync(path.join(root, 'supabase/functions/_shared/auth-contract.ts'), 'utf8');
const config = {
  supabaseUrl: 'https://fixture.supabase.co',
  supabaseFunctionUrl: 'https://fixture.supabase.co/functions/v1/api',
  supabasePublishableKey: 'public-key',
  realtimeEnabled: true,
  memberLiffId: 'member-fixture', adminLiffId: 'admin-fixture',
  pointsLiffId: 'points-fixture', eventLiffId: 'event-fixture',
  calendarLiffId: 'calendar-fixture', bookingLiffId: 'booking-fixture'
};

function harness(server, local = new Map(), options = {}) {
  const calls = [];
  const listeners = {};
  let onRealtime;
  const window = {
    crypto: webcrypto, setTimeout: () => 1, clearTimeout: () => {},
    alert: message => calls.push(['alert', message]),
    confirm: () => options.approve === true,
    close: () => calls.push(['close']),
    closed: true,
    location: { replace: () => calls.push(['replace']) },
    localStorage: {
      getItem: key => local.get(key) || null,
      setItem: (key, value) => local.set(key, value),
      removeItem: key => local.delete(key)
    },
    addEventListener: (event, cb) => { listeners[event] = cb; },
    liff: {
      init: async () => {},
      isInClient: () => true,
      isLoggedIn: () => true,
      getIDToken: () => options.token || 'id-token',
      logout: () => calls.push(['logout']),
      closeWindow: () => calls.push(['liff.closeWindow'])
    },
    supabase: {
      createClient: () => ({
        channel: () => ({
          on(_type, _match, cb) { onRealtime = cb; return this; },
          subscribe: () => ({})
        }),
        removeChannel: async () => {}
      })
    }
  };
  const document = {
    visibilityState: 'visible',
    title: 'Member',
    querySelectorAll: () => [],
    addEventListener: (event, cb) => { listeners[event] = cb; }
  };
  const fetch = async (_url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push(['request', body.action, body.mode]);
    const result = server(body);
    return { ok: result.ok !== false, status: result.ok === false ? 401 : 200,
      text: async () => JSON.stringify(result.ok === false
        ? { ok: false, status: 401, error: { code: result.code || 'SESSION_REPLACED', message: '已被其他裝置登入取代。' } }
        : { ok: true, status: 200, data: result.data || {} }) };
  };
  vm.runInNewContext(member, { window, document, fetch, URL, AbortController });
  return { window, calls, local, emit: event => onRealtime?.({ new: { scope: 'all', event_type: event } }) };
}

test('single-login takeover: old identity is revalidated immediately after a successful new-device claim', async () => {
  let owner = '';
  const accepted = new Set();
  const server = request => {
    if (request.action.endsWith('.session.claim')) {
      const key = request.browserKey;
      if (owner && owner !== key && request.mode !== 'login') return { ok:false };
      if (owner !== key) accepted.clear();
      owner = key;
      accepted.add(request.idToken);
      return { data:{ state:'claimed' } };
    }
    if (request.action.endsWith('.session.status')) {
      return accepted.has(request.idToken) ? { data:{ state:'active' } } : { ok:false };
    }
    return { data:{} };
  };
  const first = harness(server, new Map(), { token:'device-A' });
  await first.window.MemberSystem.signIn(config, 'member');
  first.window.MemberSystem.subscribeRealtime(config, 'member', () => {});
  const second = harness(server, new Map(), { token:'device-B' });
  await second.window.MemberSystem.signIn(config, 'member');
  first.emit('member.login.replaced');
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(first.calls.some(x => x[1] === 'user.member.session.status'));
  assert.equal(first.calls.some(x => x[0] === 'liff.closeWindow'), true);
  assert.equal(first.local.get('member-login-registered-v1'), 'replaced');
  assert.equal(second.calls.some(x => x[0] === 'liff.closeWindow'), false);
});

test('replaced browser requires user approval before reclaiming a newer login', async () => {
  const local = new Map([['member-login-registered-v1','replaced']]);
  const server = request => ({ data: { state:request.mode === 'login' ? 'replaced' : 'resumed' } });
  const denied = harness(server, local, { token:'fresh-A', approve:false });
  await assert.rejects(denied.window.MemberSystem.signIn(config,'member'), { code:'LOGIN_TAKEOVER_CANCELLED' });
  assert.equal(denied.calls.some(x => x[1] === 'user.member.session.claim'), false);
  assert.equal(local.get('member-login-registered-v1'), 'replaced');
  const approved = harness(server, local, { token:'fresh-B', approve:true });
  await approved.window.MemberSystem.signIn(config,'member');
  assert.ok(approved.calls.some(x => x[1] === 'user.member.session.claim' && x[2] === 'login'));
  assert.equal(local.get('member-login-registered-v1'), '1');
});

test('session status remains server-authenticated and never opens an admin bypass', () => {
  assert.match(api, /session\.\(claim\|logout\|status\)/);
  assert.match(api, /return \{ state:"active" \}/);
  assert.match(auth, /if \(!allowLoginClaim && !canBypassUserRestrictions\)/);
  assert.match(auth, /member_login_token_grants/);
  assert.match(booking, /user\.booking\.session\.status/);
  assert.match(booking, /targetScope !== 'admin'/);
  assert.match(member, /member\.login\.replaced'\) verifyCurrentLogin\(\)/);
  assert.match(member, /const approved = typeof window\.confirm === 'function'/);
});
