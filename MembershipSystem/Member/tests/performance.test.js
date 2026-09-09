'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

function signedBytes(buffer) {
  return Array.from(buffer, (value) => value > 127 ? value - 256 : value);
}

function loadRateLimiter() {
  const cache = new Map();
  let lockWaits = 0;
  let lockReleases = 0;
  const context = {
    CacheService: {
      getScriptCache: () => ({
        get: (key) => cache.get(key) || null,
        put: (key, value) => { cache.set(key, String(value)); }
      })
    },
    LockService: {
      getScriptLock: () => ({
        waitLock: () => { lockWaits += 1; },
        releaseLock: () => { lockReleases += 1; }
      })
    },
    Utilities: {
      computeDigest: (_algorithm, value) => signedBytes(crypto.createHash('sha256').update(String(value)).digest()),
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      Charset: { UTF_8: 'UTF_8' }
    },
    ContentService: { createTextOutput: () => ({ setMimeType() { return this; } }), MimeType: { JSON: 'JSON' } }
  };
  vm.createContext(context);
  vm.runInContext(read('gas/Code.gs'), context, { filename: 'gas/Code.gs' });
  return { context, counters: () => ({ lockWaits, lockReleases }) };
}

function loadPointCardBootstrap() {
  let lockWaits = 0;
  let lockReleases = 0;
  const context = {
    withDataLock_: (callback) => {
      lockWaits += 1;
      try { return callback(); } finally { lockReleases += 1; }
    },
    Utilities: { formatDate: () => '2026-09-03' }
  };
  vm.createContext(context);
  vm.runInContext(read('gas/PointCardService.gs'), context, { filename: 'gas/PointCardService.gs' });
  return { context, counters: () => ({ lockWaits, lockReleases }) };
}

function loadServiceMinutesCache() {
  const entries = new Map();
  let reads = 0;
  const context = {
    CacheService: { getScriptCache: () => ({
      get: (key) => entries.get(key) || null,
      put: (key, value) => { entries.set(key, String(value)); },
      remove: (key) => { entries.delete(key); }
    }) },
    digest_: (value) => `digest-${value}`,
    readRecordFields_: () => {
      reads += 1;
      return [{ line_user_id: 'U-1', minutes: '30' }, { line_user_id: 'U-1', minutes: '45' }];
    }
  };
  vm.createContext(context);
  vm.runInContext(read('gas/MemberService.gs'), context, { filename: 'gas/MemberService.gs' });
  return { context, reads: () => reads };
}

function loadVersionedBootstrapCache() {
  const entries = new Map();
  const properties = new Map();
  let sequence = 0;
  let now = 0;
  class TestDate extends Date {
    static now() { return now; }
  }
  const context = {
    CacheService: { getScriptCache: () => ({
      get: (key) => entries.get(key) || null,
      put: (key, value) => { entries.set(key, String(value)); }
    }) },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (key) => properties.get(key) || null,
      setProperty: (key, value) => { properties.set(key, String(value)); }
    }) },
    Utilities: { getUuid: () => `version-${++sequence}` },
    digest_: (value) => `digest-${String(value)}`,
    Date: TestDate
  };
  vm.createContext(context);
  vm.runInContext(read('gas/Storage.gs'), context, { filename: 'gas/Storage.gs' });
  return { context, setNow: (value) => { now = value; } };
}

test('synthetic 5,000 authenticated read requests do not acquire the global rate-limit lock', () => {
  const { context, counters } = loadRateLimiter();
  for (let index = 0; index < 5000; index += 1) {
    context.enforceRateLimit_(`USER-${index}`, 'user.member.bootstrap');
  }
  assert.deepEqual(counters(), { lockWaits: 0, lockReleases: 0 });
});

test('write rate limiting stays exact and lock-backed', () => {
  const { context, counters } = loadRateLimiter();
  for (let index = 0; index < 30; index += 1) {
    context.enforceRateLimit_('ADMIN-1', 'admin.member.update');
  }
  assert.equal(counters().lockWaits, 30);
  assert.equal(counters().lockReleases, 30);
  assert.throws(
    () => context.enforceRateLimit_('ADMIN-1', 'admin.member.update'),
    (error) => error && error.code === 'RATE_LIMITED'
  );
  assert.equal(counters().lockWaits, 31);
  assert.equal(counters().lockReleases, 31);
});

test('synthetic 5,000 point-card bootstrap reads do not acquire the data lock when no ticket is due', () => {
  const { context, counters } = loadPointCardBootstrap();
  context.ensureMember_ = () => ({ display_name: '測試會員' });
  context.memberForClient_ = () => ({ displayName: '測試會員', tier: '一般會員', tierProgress: {} });
  context.readPointCardSnapshot_ = () => ({ id: 'read-only' });
  context.pointCardTicketIssuanceRequired_ = () => false;
  context.visiblePointCardsForMember_ = () => [];
  context.visibleTicketsForMember_ = () => [];

  for (let index = 0; index < 5000; index += 1) {
    context.handlePointCardBootstrap_({ lineUserId: `USER-${index}`, displayName: '測試會員' });
  }
  assert.deepEqual(counters(), { lockWaits: 0, lockReleases: 0 });
});

test('point-card bootstrap re-reads inside the lock before issuing a due ticket', () => {
  const { context, counters } = loadPointCardBootstrap();
  let snapshotReads = 0;
  context.ensureMember_ = () => ({ display_name: '測試會員' });
  context.memberForClient_ = () => ({ displayName: '測試會員', tier: '一般會員', tierProgress: {} });
  context.readPointCardSnapshot_ = () => ({ id: ++snapshotReads });
  context.pointCardTicketIssuanceRequired_ = (lineUserId, snapshot) => snapshot.id === 1;
  context.ensurePointCardTicketsForMember_ = () => {};
  context.visiblePointCardsForMember_ = (lineUserId, snapshot) => [snapshot.id];
  context.visibleTicketsForMember_ = () => [];

  const response = context.handlePointCardBootstrap_({ lineUserId: 'U-1', displayName: '測試會員' });
  assert.equal(snapshotReads, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(response.cards)), [2]);
  assert.deepEqual(counters(), { lockWaits: 1, lockReleases: 1 });
});

test('all browser write actions are single-attempt when the response is uncertain', async () => {
  let attempts = 0;
  const context = {
    window: {},
    fetch: async () => {
      attempts += 1;
      return { status: 502, text: async () => '<html>temporary gateway response</html>' };
    }
  };
  vm.createContext(context);
  vm.runInContext(read('admin/common.js'), context, { filename: 'admin/common.js' });
  const request = context.window.MemberSystem.request;
  const writeActions = [
    'user.member.profile.save',
    'admin.member.update',
    'admin.member-tiers.save',
    'admin.pointcards.save',
    'admin.pointcards.reorder',
    'admin.pointcards.archive',
    'admin.pointcards.delete',
    'admin.pointcards.remove',
    'admin.tickets.save',
    'admin.event-tickets.save',
    'admin.event-tickets.delete',
    'admin.calendar-items.save',
    'admin.calendar-items.delete',
    'admin.calendar-items.batch',
    'admin.stamps.add',
    'admin.service_minutes.add',
    'admin.member-grants.add',
    'user.pointcard.ticket.redeem',
    'user.event.ticket.claim',
    'user.event.ticket.redeem'
  ];

  for (const action of writeActions) {
    const before = attempts;
    await assert.rejects(
      () => request({ gasWebAppUrl: 'https://example.invalid' }, action.startsWith('admin.') ? 'admin' : action.startsWith('user.pointcard.') ? 'points' : action.startsWith('user.event.') ? 'event' : 'member', 'id-token', action),
      (error) => error && error.code === 'API_RESPONSE_UNCERTAIN'
    );
    assert.equal(attempts - before, 1, `${action} must never auto-retry after an uncertain response`);
  }
});

test('member hot path throttles login writes and uses narrow service-time reads', () => {
  const source = read('gas/MemberService.gs');
  assert.match(source, /MEMBERSHIP_LAST_LOGIN_TOUCH_INTERVAL_MS_/);
  assert.match(source, /if \(initialMatch && !memberNeedsLoginTouch_/);
  assert.match(source, /readRecordFields_\('ServiceTimeEntries', \['line_user_id', 'minutes'\]\)/);
  assert.match(source, /MEMBERSHIP_SERVICE_MINUTES_CACHE_SECONDS_/);
  assert.match(source, /clearServiceMinutesTotalCache_\(lineUserId\)/);
});

test('member service-time totals are cached per member and invalidated on a write', () => {
  const { context, reads } = loadServiceMinutesCache();
  assert.equal(context.serviceMinutesTotalForMember_('U-1'), 75);
  assert.equal(context.serviceMinutesTotalForMember_('U-1'), 75);
  assert.equal(reads(), 1);
  context.clearServiceMinutesTotalCache_('U-1');
  assert.equal(context.serviceMinutesTotalForMember_('U-1'), 75);
  assert.equal(reads(), 2);
});

test('schema cache hit skips repeated tier initialization', () => {
  const source = read('gas/Storage.gs');
  assert.match(source, /if \(schemaCache && schemaCache\.get\(schemaCacheKey\) === 'ready'\) return spreadsheet;/);
  const cacheHitBody = source.match(/if \(schemaCache && schemaCache\.get\(schemaCacheKey\) === 'ready'\)([\s\S]*?)Object\.keys/);
  assert.ok(cacheHitBody);
  assert.doesNotMatch(cacheHitBody[1], /ensureMembershipTierSettings_/);
});

test('versioned bootstrap uses durable identity-bound revisions and invalidates short-lived read caches after a write', () => {
  const { context, setNow } = loadVersionedBootstrapCache();
  assert.notEqual(context.membershipSafeCacheScope_('會員甲'), context.membershipSafeCacheScope_('會員乙'));
  let bootstrapBuilds = 0;
  const identity = { lineUserId: 'U-1' };
  const first = context.membershipVersionedBootstrapResponse_('points', identity, {}, () => ({ cards: [++bootstrapBuilds] }));
  const unchanged = context.membershipVersionedBootstrapResponse_('points', identity, { knownRevision: first.revision, knownCacheScope: first.cacheScope }, () => ({ cards: [++bootstrapBuilds] }));
  assert.equal(first.unchanged, false);
  assert.equal(unchanged.unchanged, true);
  assert.equal(bootstrapBuilds, 1);
  assert.notEqual(first.cacheScope, context.membershipVersionedBootstrapResponse_('points', { lineUserId: 'U-2' }, {}, () => ({ cards: [] })).cacheScope);
  assert.equal(context.membershipVersionedBootstrapResponse_('points', { lineUserId: 'U-2' }, { knownRevision: first.revision, knownCacheScope: first.cacheScope }, () => ({ cards: [++bootstrapBuilds] })).unchanged, false);

  setNow(120000);
  const windowRefreshed = context.membershipVersionedBootstrapResponse_('points', identity, { knownRevision: first.revision, knownCacheScope: first.cacheScope }, () => ({ cards: [++bootstrapBuilds] }));
  assert.equal(windowRefreshed.unchanged, false);

  context.membershipSyncBump_('points', '');
  const refreshed = context.membershipVersionedBootstrapResponse_('points', identity, { knownRevision: windowRefreshed.revision, knownCacheScope: windowRefreshed.cacheScope }, () => ({ cards: [++bootstrapBuilds] }));
  assert.equal(refreshed.unchanged, false);
  assert.equal(bootstrapBuilds, 3);

  let readBuilds = 0;
  assert.deepEqual(JSON.parse(JSON.stringify(context.membershipReadThroughCache_('definitions', () => ({ generation: ++readBuilds })))), { generation: 1 });
  assert.deepEqual(JSON.parse(JSON.stringify(context.membershipReadThroughCache_('definitions', () => ({ generation: ++readBuilds })))), { generation: 1 });
  context.rotateMembershipDataCacheEpoch_();
  assert.deepEqual(JSON.parse(JSON.stringify(context.membershipReadThroughCache_('definitions', () => ({ generation: ++readBuilds })))), { generation: 2 });
  setNow(240000);
  assert.deepEqual(JSON.parse(JSON.stringify(context.membershipReadThroughCache_('definitions', () => ({ generation: ++readBuilds })))), { generation: 3 });
});

test('admin waits for the complete GAS bootstrap before exposing the workspace', () => {
  const code = read('gas/Code.gs');
  const service = read('gas/PointCardService.gs');
  const adminApp = read('admin/app.js');
  assert.match(code, /case 'admin\.summary'/);
  assert.match(code, /case 'admin\.event-tickets\.list'/);
  assert.match(code, /membershipSyncBumpForWrite_\(request\.action, identity, request\)/);
  assert.match(service, /const lazy = Boolean\(request && request\.lazy\)/);
  assert.match(service, /initial\.cards = cards/);
  assert.match(service, /initial\.tickets = tickets/);
  assert.match(service, /initial\.eventTickets = eventTickets/);
  assert.match(service, /initial\.calendarItems = calendarItems/);
  assert.doesNotMatch(adminApp, /lazy:\s*true/);
  assert.match(adminApp, /function assertCompleteAdminBootstrap\(result\)/);
  assert.match(adminApp, /state\.loadedPanels = \{ members: true, cards: true, events: true, calendar: true \}/);
  assert.match(adminApp, /applyAdminCards\(result, false\)/);
  assert.match(adminApp, /applyAdminEventTickets\(result, false\)/);
  assert.match(adminApp, /await refreshData\(false\);[\s\S]*setView\('admin'\)/);
  assert.match(adminApp, /function ensureAdminPanelData\(panel\)/);
  assert.match(adminApp, /panel === 'members' \|\| state\.loadedPanels\[panel\]/);
  assert.match(adminApp, /if \(state\.loadedPanels\.cards\) return openGrantModal\(member\)/);
  assert.match(adminApp, /if \(!state\.loadedPanels\[panel\]\) ensureAdminPanelData\(panel\)/);
  assert.match(adminApp, /admin\.pointcards\.list/);
  assert.match(adminApp, /admin\.event-tickets\.list/);
  assert.match(adminApp, /admin\.calendar-items\.list/);
});


test('server payload cache separates full, compact and selected-card representations', () => {
  const { context } = loadVersionedBootstrapCache();
  const identity = { lineUserId: 'U-1' };
  const shapes = [
    [{}, 'full'],
    [{ compact: true }, 'compact'],
    [{ compact: true, includeActiveCard: true, activeCardId: 'A' }, 'detail-A'],
    [{ compact: true, includeActiveCard: true, activeCardId: 'B' }, 'detail-B']
  ];
  for (const [request, label] of shapes) assert.equal(context.membershipVersionedBootstrapResponse_('points', identity, request, () => ({ shape: label })).shape, label);
  for (const [request, label] of shapes) assert.equal(context.membershipVersionedBootstrapResponse_('points', identity, request, () => { throw new Error('cache miss'); }).shape, label);
});

test('preloaded admin panels do not issue redundant GAS reads', async () => {
  const source = read('admin/app.js');
  const extract = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start) + start.length));
  const state = { config: {}, idToken: 'local-test', bootstrapVersion: 'v1', loadedPanels: { members: true, cards: true, events: true, calendar: true }, panelLoads: {} };
  const calls = [];
  const context = {
    state,
    window: { MemberSystem: { request: async (_config, _surface, _token, action) => { calls.push(action); return {}; } } },
    adoptIncomingBootstrapVersion: () => false,
    refreshData: async () => {},
    applyAdminCards: () => {},
    applyAdminEventTickets: () => {},
    applyAdminCalendarItems: () => {}
  };
  vm.createContext(context);
  vm.runInContext(extract('  async function ensureAdminPanelData(', '  function adoptIncomingBootstrapVersion('), context);
  await context.ensureAdminPanelData('cards');
  await context.ensureAdminPanelData('events');
  await context.ensureAdminPanelData('calendar');
  assert.deepEqual(calls, []);
});

test('admin panel version refresh resolves without waiting on its own in-flight promise', async () => {
  const source = read('admin/app.js');
  const extract = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start) + start.length));
  const state = { config: {}, idToken: 'local-test', activePanel: 'cards', bootstrapVersion: 'v1', memberPage: { page: 1, query: '' }, loadedPanels: {}, panelLoads: {} };
  const calls = [];
  const context = {
    state,
    els: { syncStatus: { classList: { remove() {} } } },
    window: { MemberSystem: { request: async (_config, _surface, _token, action) => {
      calls.push(action);
      if (action === 'admin.bootstrap') return { version: 'v2', members: [], memberPage: { page: 1, pageSize: 100, total: 0, totalPages: 1, query: '' }, tierSettings: [], cards: [{ cardId: 'new' }], tickets: [], eventTickets: [], calendarItems: [], stats: {} };
      return { version: 'v2', cards: [{ cardId: 'new' }] };
    } } },
    memberPagePayload: () => ({}),
    invalidateLazyPanels: () => { state.loadedPanels = {}; },
    applyAdminBootstrap: (result) => { state.bootstrapVersion = result.version; },
    applyAdminCards: (result) => { state.cards = result.cards; },
    loadAdminSummary: async () => {},
    setSyncStatus: () => {}
  };
  vm.createContext(context);
  vm.runInContext([
    extract('  async function refreshData(', '  function applyAdminBootstrap('),
    extract('  async function ensureAdminPanelData(', '  function applyAdminCards(')
  ].join('\n'), context);
  let timer;
  try {
    await Promise.race([context.ensureAdminPanelData('cards'), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('panel refresh deadlocked')), 1000); })]);
  } finally { clearTimeout(timer); }
  assert.deepEqual(calls, ['admin.pointcards.list', 'admin.bootstrap', 'admin.pointcards.list']);
  assert.equal(state.cards[0].cardId, 'new'); assert.equal(state.loadedPanels.cards, true); assert.equal(state.panelLoads.cards, undefined);
});
