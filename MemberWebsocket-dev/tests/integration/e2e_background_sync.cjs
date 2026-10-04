const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

function view(id = 'qa-1', status = 'running', passed = 0) {
  return {
    run: { id, runCode: id.toUpperCase(), suite: 'full', status,
      totalCases: 2, passedCases: passed, failedCases: 0, createdAt: '2026-10-04T09:00:00Z' },
    cases: [
      { id: id + '-a', key: 'QA_A', name: 'First QA case', status: passed ? 'passed' : 'running', steps: [] },
      { id: id + '-b', key: 'QA_B', name: 'Second QA case', status: passed === 2 ? 'passed' : 'queued', steps: [] }
    ]
  };
}

async function page(query = '') {
  const dom = new JSDOM(read('admin/index.html'), {
    runScripts: 'outside-only', pretendToBeVisual: true,
    url: 'https://example.test/MemberWebsocket-dev/admin/' + query
  });
  const w = dom.window;
  await new Promise(resolve => w.addEventListener('load', resolve, { once: true }));
  const timers = new Map();
  let nextTimer = 0;
  w.setInterval = (callback, delay) => { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; };
  w.clearInterval = id => timers.delete(id);
  w.AbortController = AbortController;
  w.TextEncoder = TextEncoder;
  w.MemberAdminSession = { wait: async () => ({
    config: { supabaseUrl: 'https://fixture.supabase.co', supabasePublishableKey: 'fixture-publishable' },
    idToken: 'private-fixture-session'
  }) };
  w.MemberE2EScenarioGraph = { runWithDeadline: callback => callback() };
  w.requests = [];
  w.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    w.requests.push(body);
    const data = await w.respond(body);
    return { ok: true, json: async () => ({ ok: true, data }) };
  };
  w.respond = async () => ({ runs: [] });
  w.eval(read('admin/test-control.js'));
  w.dispatchEvent(new w.Event('DOMContentLoaded'));
  w.document.documentElement.dataset.memberAdminReady = 'true';
  w.eval(read('admin/e2e-control.js').replace('  window.MemberAdminE2EControl =',
    '  window.syncProbe = { state };\n  window.MemberAdminE2EControl ='));
  return { w, timers, close: () => w.close(), timer: delay => [...timers.values()].find(item => item.delay === delay)?.callback };
}

function connect(parent, child, runId = 'BG-sync') {
  parent.w.syncProbe.state.backgroundRunId = runId;
  parent.w.syncProbe.state.backgroundRunnerWindow = child.w;
  parent.w.syncProbe.state.running = true;
  child.w.opener = parent.w;
  child.w.syncProbe.state.backgroundRunId = runId;
  child.w.syncProbe.state.backgroundExecution = true;
  child.w.syncProbe.state.running = true;
}

test('backend QA pushes creation, per-case progress and completion to parent without reload or duplicate reads', async () => {
  const parent = await page();
  const child = await page('?e2eBackgroundRunner=1&e2eRunId=BG-sync');
  try {
    connect(parent, child);
    const execute = deferred();
    const queued = view('qa-1', 'queued');
    const running = view('qa-1', 'running', 1);
    const complete = view('qa-1', 'passed', 2);
    child.w.respond = body => body.action.endsWith('.create') ? { ...queued, runs: [queued.run] }
      : body.action.endsWith('.execute') ? execute.promise : { ...running, runs: [running.run] };
    const started = child.w.MemberAdminTestControl.runFull(['member']);
    await flush();
    assert.equal(child.w.MemberAdminE2EControl.getStatus().coverage, null, 'uncomputed coverage must remain null across windows');
    assert.equal(parent.w.document.getElementById('automationTestRunCode').textContent, 'QA-1');
    assert.equal(parent.w.document.querySelectorAll('[data-test-run-id]').length, 1);
    assert.equal(parent.w.document.getElementById('purgeTestDataButton').disabled, true);
    assert.equal(child.timer(5000), undefined, 'isolated Runner must not create a second history watcher');
    await child.timer(900)();
    assert.equal(parent.w.document.getElementById('automationTestPassedCount').textContent, '1');
    assert.equal(parent.w.document.getElementById('automationTestProgress').getAttribute('aria-valuenow'), '50');
    execute.resolve({ ...complete, runs: [complete.run] });
    await started;
    assert.equal(parent.w.document.getElementById('automationTestRunStatus').textContent, '通過');
    assert.equal(parent.w.document.getElementById('automationTestRunnerBadge').textContent, 'Runner：全部通過');
    assert.equal(parent.w.document.getElementById('automationTestPassedCount').textContent, '2');
    assert.equal(parent.w.document.getElementById('purgeTestDataButton').disabled, false);
    assert.equal(parent.timer(900), undefined, 'parent consumes the push instead of polling the same run');
    assert.equal(parent.w.requests.length, 0);
    assert.doesNotMatch(JSON.stringify(child.w.MemberAdminE2EControl.getStatus()), /private-fixture-session/);
  } finally { child.close(); parent.close(); }
});

test('an empty or incomplete coverage report cannot interrupt background progress rendering', async () => {
  const p = await page();
  try {
    p.w.syncProbe.state.backgroundRunId = 'BG-sync';
    for (const coverage of [null, {}, { total: 1 }, { total: 1, counts: { passed: 0 }, complete: false }]) {
      const accepted = p.w.MemberAdminE2EControl.receiveBackgroundStatus({
        runId: 'BG-sync', running: true, coverage,
        clientCoverage: [{ participant: 1, surface: 'member', coverage: {} }],
        results: [{ key: 'ACTIVE_NODE', name: 'Active node', status: 'running' }]
      });
      assert.equal(accepted, true);
      assert.equal(p.w.document.querySelector('#adminBrowserE2ECaseList strong').textContent, 'Active node');
    }
  } finally { p.close(); }
});

test('a pending poll cannot revert the execute response from completed to running', async () => {
  const p = await page('?e2eBackgroundRunner=1&e2eRunId=BG-sync');
  try {
    const execute = deferred();
    const poll = deferred();
    const running = view();
    const complete = view('qa-1', 'passed', 2);
    p.w.respond = body => body.action.endsWith('.create') ? { ...running, runs: [running.run] }
      : body.action.endsWith('.execute') ? execute.promise : poll.promise;
    const started = p.w.MemberAdminTestControl.runFull(['member']);
    await flush();
    const polling = p.timer(900)();
    await flush();
    execute.resolve({ ...complete, runs: [complete.run] });
    await started;
    poll.resolve({ ...running, runs: [running.run] });
    await polling;
    assert.equal(p.w.document.getElementById('automationTestRunStatus').textContent, '通過');
    assert.equal(p.w.document.getElementById('automationTestPassedCount').textContent, '2');
  } finally { p.close(); }
});

test('history refresh updates the same selected run, retains expanded cases, and coalesces overlapping refreshes', async () => {
  const p = await page();
  try {
    let current = view('qa-1', 'passed', 1);
    p.w.respond = body => body.action.endsWith('.list') ? { runs: [current.run] } : { ...current, runs: [current.run] };
    await p.w.MemberAdminTestControl.refresh();
    const firstNode = p.w.document.querySelector('[data-test-case-id]');
    firstNode.open = true;
    const first = p.w.MemberAdminTestControl.refresh();
    assert.equal(p.w.MemberAdminTestControl.refresh(), first);
    await first;
    assert.equal(p.w.document.querySelector('[data-test-case-id]'), firstNode, 'unchanged snapshots must not rebuild the cases');
    current = view('qa-1', 'passed', 2);
    await p.w.MemberAdminTestControl.refresh();
    assert.equal(p.w.document.getElementById('automationTestPassedCount').textContent, '2');
    assert.equal(p.w.document.querySelector('[data-test-case-id]').open, true);
  } finally { p.close(); }
});

test('visible history discovers another tab run and catches up on focus; hidden and inactive tabs do not poll', async () => {
  const p = await page();
  try {
    const current = view('qa-new', 'passed', 2);
    p.w.respond = body => body.action.endsWith('.list') ? { runs: [current.run] } : { ...current, runs: [current.run] };
    p.timer(5000)();
    await flush();
    assert.equal(p.w.requests.length, 0, 'inactive test tab does not read history');
    p.w.document.getElementById('testModeTab').setAttribute('aria-selected', 'true');
    Object.defineProperty(p.w.document, 'hidden', { configurable: true, value: true });
    p.timer(5000)();
    await flush();
    assert.equal(p.w.requests.length, 0, 'hidden page does not read history');
    Object.defineProperty(p.w.document, 'hidden', { configurable: true, value: false });
    p.timer(5000)();
    await flush();
    assert.equal(p.w.document.getElementById('automationTestRunCode').textContent, 'QA-NEW');
    const before = p.w.requests.length;
    p.w.dispatchEvent(new p.w.Event('focus'));
    await flush();
    assert.equal(p.w.requests.length, before + 2);
    p.w.dispatchEvent(new p.w.Event('pagehide'));
    assert.equal(p.timer(5000), undefined);
    p.w.dispatchEvent(new p.w.Event('pageshow'));
    await flush();
    assert.ok(p.timer(5000), 'history watcher resumes after back-forward cache');
  } finally { p.close(); }
});

test('changing history selection rejects the previous run response and keeps a pinned record selected', async () => {
  const p = await page();
  try {
    const first = view('qa-first', 'passed', 2);
    const second = view('qa-second', 'passed', 2);
    let delayed;
    p.w.respond = body => body.action.endsWith('.list') ? { runs: [first.run, second.run] }
      : body.runId === first.run.id && delayed ? delayed.promise
        : { ...(body.runId === first.run.id ? first : second), runs: [first.run, second.run] };
    await p.w.MemberAdminTestControl.refresh();
    delayed = deferred();
    p.w.document.querySelector('[data-test-run-id="qa-first"]').click();
    await flush();
    p.w.document.querySelector('[data-test-run-id="qa-second"]').click();
    await flush();
    delayed.resolve({ ...first, runs: [first.run, second.run] });
    await flush();
    await p.w.MemberAdminTestControl.refresh();
    assert.equal(p.w.MemberAdminTestControl.currentRunId(), 'qa-second');
    assert.equal(p.w.document.getElementById('automationTestRunCode').textContent, 'QA-SECOND');
  } finally { p.close(); }
});

test('background pushes invalidate a stale history read and old run snapshots cannot end the current E2E', async () => {
  const parent = await page();
  const child = await page('?e2eBackgroundRunner=1&e2eRunId=BG-sync');
  try {
    const old = deferred();
    parent.w.respond = () => old.promise;
    const refresh = parent.w.MemberAdminTestControl.refresh();
    await flush();
    connect(parent, child);
    const complete = view('qa-live', 'passed', 2);
    child.w.MemberAdminTestControl.acceptRecordedRun({ ...complete, runs: [complete.run] });
    old.resolve({ runs: [] });
    await refresh;
    assert.equal(parent.w.document.getElementById('automationTestRunCode').textContent, 'QA-LIVE');
    for (const runId of ['', 'BG-old']) {
      assert.equal(parent.w.MemberAdminE2EControl.receiveBackgroundStatus({ runId, running: false, results: [] }), false);
      assert.equal(parent.w.MemberAdminE2EControl.isRunning(), true);
    }
    const snapshot = child.w.MemberAdminE2EControl.getStatus();
    assert.equal(parent.w.MemberAdminTestControl.receiveBackgroundStatus(snapshot.testControl, snapshot.runId), false,
      'repeated heartbeat snapshots must not reset the selected record');
  } finally { child.close(); parent.close(); }
});

test('returning to the main page pulls missed Runner status and newly persisted browser records', async () => {
  const parent = await page();
  const child = await page('?e2eBackgroundRunner=1&e2eRunId=BG-sync');
  try {
    connect(parent, child);
    child.w.opener = null; // Simulate a missed push while the parent is suspended.
    const record = view('browser-complete', 'passed', 2);
    child.w.MemberAdminTestControl.acceptRecordedRun({ ...record, runs: [record.run] });
    child.w.syncProbe.state.results = [{ key: 'NEW_NODE', name: 'Latest node', status: 'passed' }];
    parent.w.dispatchEvent(new parent.w.Event('focus'));
    assert.equal(parent.w.document.getElementById('automationTestRunCode').textContent, 'BROWSER-COMPLETE');
    assert.equal(parent.w.document.querySelector('#adminBrowserE2ECaseList strong').textContent, 'Latest node');
    assert.equal(parent.w.requests.length, 0);
  } finally { child.close(); parent.close(); }
});
