(() => {
  'use strict';

  const VERSION = '2026-09-23.2';
  const TEST_SESSION_STORAGE_KEY = 'member-test-session-v1';
  const MAX_PAIRED_PARTICIPANTS = 10;
  const PAIRED_BOOKING_LIVE_TIMEOUT_MS = 10 * 60 * 1000;
  const PAIRED_SURFACES = Object.freeze([
    ['member', '會員卡'],
    ['points', '集點卡'],
    ['event', '活動票券'],
    ['calendar', '活動日曆'],
    ['booking', '預約']
  ]);
  const state = {
    running: false,
    cancelled: false,
    runSequence: 0,
    results: [],
    section: null,
    list: null,
    message: null,
    badge: null,
    summary: null,
    participantList: null,
    floating: null,
    clientWindows: [],
    participants: [],
    adminTestAccount: null,
    runStartedAt: ''
  };

  window.addEventListener('DOMContentLoaded', mount);
  window.addEventListener('member-admin-ready', mount);
  window.addEventListener('pagehide', closeClientWindows);

  function mount() {
    if (document.getElementById('adminBrowserE2ESection')) return;
    const host = document.querySelector('.test-control-center');
    const layout = host?.querySelector('.test-control-layout');
    if (!host || !layout) return;

    const section = document.createElement('section');
    section.id = 'adminBrowserE2ESection';
    section.className = 'admin-e2e-section';
    section.setAttribute('aria-labelledby', 'adminBrowserE2ETitle');
    section.innerHTML = `
      <div class="admin-e2e-heading">
        <div>
          <span class="test-mode-eyebrow">Browser E2E</span>
          <h4 id="adminBrowserE2ETitle">管理端真人 E2E / 管理端 ↔ 用戶端協同測試</h4>
          <p>協同模式會先由管理端建立高複雜度完整測試資料（優惠券／抽獎券／固定票券、不同集點節點、日期區間、會員階級、日曆與預約資源），確認完成後才讓測試用戶端開始。測試帳號與五種用戶端執行順序都會隨機化，並加入隨機操作間隔、Realtime、併發重送與非常規操作驗證。</p>
        </div>
        <div class="admin-e2e-actions">
          <span id="adminBrowserE2EBadge" class="test-mode-status-badge is-off">Browser Runner：待命</span>
          <button id="runAdminQuickE2EButton" class="button button-outline" type="button" data-admin-e2e-control="true">管理端快速 E2E</button>
          <button id="runAdminFullE2EButton" class="button button-outline" type="button" data-admin-e2e-control="true">管理端完整 E2E</button>
          <button id="runBookingPendingE2EButton" class="button button-outline" type="button" data-admin-e2e-control="true">待確認 E2E</button>
          <button id="runBookingCancellationE2EButton" class="button button-outline" type="button" data-admin-e2e-control="true">取消申請 E2E</button>
          <button id="runBookingFullE2EButton" class="button button-outline" type="button" data-admin-e2e-control="true">預約完整協同 E2E</button>
          <button id="runPairedFullE2EButton" class="button button-dark" type="button" data-admin-e2e-control="true">管理端 ↔ 用戶端完整 E2E</button>
          <button id="stopAdminE2EButton" class="button button-danger hidden" type="button" data-admin-e2e-stop="true">停止 E2E</button>
        </div>
      </div>
      <div class="admin-e2e-paired-config">
        <label for="pairedE2EAccountCount"><strong>協同測試人數</strong><input id="pairedE2EAccountCount" type="number" min="1" max="10" step="1" value="1" inputmode="numeric"></label>
        <small>1–10 人。預約完整協同 E2E 由管理端一鍵啟動：自動開啟測試用戶端，以真人方式新增／修改／多人預約／申請取消；再由管理端像真人切分頁、開視窗、修改項目與技師、確認／拒絕／完成／審核取消，且每一步都要求用戶端透過 Realtime 自動同步，最後做終態、競態、越權與資料遺漏風險掃描。待確認／取消申請 E2E 僅供單點診斷。正式用戶不會被選入。</small>
      </div>
      <div id="adminBrowserE2EMessage" class="form-message hidden" role="status" aria-live="polite"></div>
      <div id="adminBrowserE2ESummary" class="admin-e2e-summary">尚未執行瀏覽器 E2E。</div>
      <div id="adminE2EParticipantList" class="admin-e2e-participant-list hidden" aria-live="polite"></div>
      <div id="adminBrowserE2ECaseList" class="test-control-case-list admin-e2e-case-list"></div>
    `;
    host.insertBefore(section, layout);

    const floating = document.createElement('div');
    floating.id = 'adminE2EFloatingStatus';
    floating.className = 'admin-e2e-floating hidden';
    floating.setAttribute('role', 'status');
    floating.setAttribute('aria-live', 'polite');
    document.body.appendChild(floating);

    state.section = section;
    state.list = section.querySelector('#adminBrowserE2ECaseList');
    state.message = section.querySelector('#adminBrowserE2EMessage');
    state.badge = section.querySelector('#adminBrowserE2EBadge');
    state.summary = section.querySelector('#adminBrowserE2ESummary');
    state.participantList = section.querySelector('#adminE2EParticipantList');
    state.floating = floating;

    section.querySelector('#runAdminQuickE2EButton')?.addEventListener('click', () => runAdmin('quick'));
    section.querySelector('#runAdminFullE2EButton')?.addEventListener('click', () => runAdmin('full'));
    section.querySelector('#runBookingPendingE2EButton')?.addEventListener('click', () => runAdminBookingQueueE2E('pending'));
    section.querySelector('#runBookingCancellationE2EButton')?.addEventListener('click', () => runAdminBookingQueueE2E('cancellation'));
    section.querySelector('#runBookingFullE2EButton')?.addEventListener('click', () => runPaired({ bookingOnly: true }));
    section.querySelector('#runPairedFullE2EButton')?.addEventListener('click', () => runPaired());
    section.querySelector('#stopAdminE2EButton')?.addEventListener('click', requestStop);
  }

  function sleep(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function randomInt(min, max) {
    const low = Math.ceil(Number(min) || 0);
    const high = Math.floor(Number(max) || low);
    if (high <= low) return low;
    try {
      const value = new Uint32Array(1);
      crypto.getRandomValues(value);
      return low + (value[0] % (high - low + 1));
    } catch (_) {
      return low + Math.floor(Math.random() * (high - low + 1));
    }
  }

  function shuffled(items) {
    const copy = Array.isArray(items) ? items.slice() : [];
    for (let index = copy.length - 1; index > 0; index -= 1) {
      const swap = randomInt(0, index);
      [copy[index], copy[swap]] = [copy[swap], copy[index]];
    }
    return copy;
  }

  async function waitFor(predicate, timeoutMs = 7000, intervalMs = 60) {
    const deadline = Date.now() + timeoutMs;
    let lastError = null;
    while (Date.now() < deadline) {
      try {
        const value = predicate();
        if (value) return value;
      } catch (error) {
        lastError = error;
      }
      await sleep(intervalMs);
    }
    if (lastError) throw lastError;
    return null;
  }

  function safe(value) {
    try { return JSON.parse(JSON.stringify(value ?? {})); }
    catch { return {}; }
  }

  function plainError(error) {
    return {
      code: String(error?.code || error?.name || 'Error').slice(0, 120),
      message: String(error?.message || error || '未知錯誤').slice(0, 500)
    };
  }

  function outcome(status, message, expected, actual) {
    return { status, message, expected: safe(expected), actual: safe(actual) };
  }

  function pass(message, expected, actual) {
    return outcome('passed', message, expected, actual);
  }

  function fail(message, expected, actual) {
    return outcome('failed', message, expected, actual);
  }

  function skip(message, expected, actual) {
    return outcome('skipped', message, expected, actual);
  }

  function adminHumanRequired(key, name, domain) {
    const normalizedKey = String(key || '');
    const normalizedName = String(name || '');
    const normalizedDomain = String(domain || '');
    if (normalizedKey === 'PAIRED_HUMAN_INTERACTION_COVERAGE' || normalizedDomain === 'Coverage') return false;
    if (/真人/.test(normalizedName)) return true;
    if (normalizedDomain === 'Admin CRUD E2E') return true;
    if (/^Booking Queue E2E \/ (?:Pending|Cancellation)$/.test(normalizedDomain)) return true;
    if (/^Booking \/ (?:Confirm|Modify Items|Modify Technician|Complete|Reject|Cancellation Keep|Cancellation Approve)$/.test(normalizedDomain)) return true;
    if (/^Paired E2E \/ (?:Membership|Points)$/.test(normalizedDomain)) return true;
    return /^PAIRED_\d+_ADMIN_BOOKING_(?:CONFIRM|MODIFY|MODIFY_TECHNICIAN|COMPLETE|REJECT|KEEP_CANCELLATION|CANCEL)$/.test(normalizedKey);
  }

  function caseDef(key, name, domain, run) {
    return { key, name, domain, run, humanRequired: adminHumanRequired(key, name, domain) };
  }

  function setBusy(running, label = '') {
    state.running = Boolean(running);
    state.section?.querySelectorAll('button[data-admin-e2e-control]').forEach((button) => {
      button.disabled = state.running;
    });
    const stopButton = state.section?.querySelector('#stopAdminE2EButton');
    if (stopButton) {
      stopButton.disabled = !state.running;
      stopButton.classList.toggle('hidden', !state.running);
    }
    const countInput = state.section?.querySelector('#pairedE2EAccountCount');
    if (countInput) countInput.disabled = state.running;
    if (state.badge) {
      state.badge.textContent = state.running ? (state.cancelled ? 'Browser Runner：停止中' : 'Browser Runner：執行中') : 'Browser Runner：待命';
      state.badge.classList.toggle('is-on', state.running);
      state.badge.classList.toggle('is-off', !state.running);
    }
    if (state.floating) {
      state.floating.classList.toggle('hidden', !state.running);
      state.floating.textContent = state.running ? ((state.cancelled ? 'E2E 停止中' : 'E2E 執行中') + (label ? ' · ' + label : '')) : '';
    }
  }

  function requestStop() {
    if (!state.running || state.cancelled) return false;
    state.cancelled = true;
    if (state.badge) state.badge.textContent = 'Browser Runner：停止中';
    if (state.floating) state.floating.textContent = 'E2E 停止中 · 目前案例完成安全清理後停止';
    for (const participant of state.participants) {
      participant.status = '停止中';
      try {
        const child = participant.window;
        if (child && !child.closed && typeof child.MemberUserTestControl?.stop === 'function') child.MemberUserTestControl.stop();
      } catch {}
    }
    renderParticipants();
    setMessage('已要求停止 E2E；目前正在執行的案例會先完成安全清理，之後不再啟動下一個案例。');
    return true;
  }

  

  function setMessage(message, error = false) {
    if (!state.message) return;
    state.message.textContent = message;
    state.message.classList.remove('hidden');
    state.message.classList.toggle('success', !error);
  }

  function render() {
    if (!state.list || !state.summary) return;
    const passed = state.results.filter((r) => r.status === 'passed').length;
    const failed = state.results.filter((r) => r.status === 'failed').length;
    const skipped = state.results.filter((r) => r.status === 'skipped').length;
    state.summary.textContent = `共 ${state.results.length} 案例 · ${passed} 通過 · ${failed} 失敗 · ${skipped} 略過`;
    state.list.replaceChildren(...state.results.map((item, index) => {
      const details = document.createElement('details');
      details.className = 'test-control-case admin-e2e-case is-' + String(item.status || 'queued');
      if (item.status === 'failed') details.open = true;
      const summary = document.createElement('summary');
      summary.innerHTML = `<span class="test-control-case-index">${index + 1}</span><span class="test-control-case-title"><strong></strong><small></small></span><span class="test-control-case-status"></span>`;
      summary.querySelector('strong').textContent = item.name || item.key || 'E2E case';
      summary.querySelector('small').textContent = (item.domain || 'Browser E2E') + (item.durationMs != null ? ' · ' + Math.round(item.durationMs) + ' ms' : '');
      summary.querySelector('.test-control-case-status').textContent =
        item.status === 'passed' ? '通過' : item.status === 'failed' ? '失敗' : item.status === 'skipped' ? '略過' : '執行中';
      const body = document.createElement('div');
      body.className = 'admin-e2e-case-body';
      const message = document.createElement('p');
      message.textContent = item.message || '';
      const grid = document.createElement('div');
      grid.className = 'admin-e2e-data-grid';
      grid.append(dataBox('Expected', item.expected), dataBox('Actual', item.actual));
      body.append(message, grid);
      details.append(summary, body);
      return details;
    }));
  }

  function dataBox(label, value) {
    const box = document.createElement('div');
    box.className = 'admin-e2e-data-box';
    const title = document.createElement('strong');
    title.textContent = label;
    const pre = document.createElement('pre');
    pre.textContent = JSON.stringify(safe(value), null, 2);
    box.append(title, pre);
    return box;
  }

  function adminHumanTargetLabel(node) {
    if (!node || node.nodeType !== 1) return 'unknown';
    const id = String(node.id || '').trim();
    if (id) return '#' + id;
    const action = String(node.getAttribute?.('data-action') || node.getAttribute?.('data-booking-admin-action') || '').trim();
    if (action) return '[action=' + action + ']';
    const cls = String(node.className || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.');
    const tag = String(node.tagName || 'element').toLowerCase();
    return cls ? tag + '.' + cls : tag;
  }

  async function captureAdminHumanInteraction(run) {
    const events = [];
    const types = ['click', 'input', 'change', 'submit'];
    const handler = (event) => {
      const target = event?.target;
      if (!target || state.section?.contains(target)) return;
      events.push({
        type: String(event.type || ''),
        target: adminHumanTargetLabel(target),
        trusted: event.isTrusted === true
      });
      if (events.length > 100) events.shift();
    };
    types.forEach((type) => document.addEventListener(type, handler, true));
    try {
      await sleep(randomInt(80, 260));
      const outcome = await run();
      await sleep(randomInt(70, 220));
      return {
        outcome,
        evidence: {
          eventCount: events.length,
          eventTypes: [...new Set(events.map((item) => item.type))],
          targets: [...new Set(events.map((item) => item.target))].slice(0, 24)
        }
      };
    } finally {
      types.forEach((type) => document.removeEventListener(type, handler, true));
    }
  }

  async function executeCases(defs, phaseLabel) {
    for (const def of defs) {
      if (state.cancelled) break;
      const row = {
        key: def.key,
        name: def.name,
        domain: def.domain,
        humanRequired: def.humanRequired === true,
        status: 'running',
        message: '執行中…',
        expected: {},
        actual: {},
        durationMs: null
      };
      state.results.push(row);
      if (state.floating) state.floating.textContent = 'E2E 執行中 · ' + phaseLabel + ' · ' + def.name;
      render();
      const started = performance.now();
      try {
        let outcome;
        if (def.humanRequired === true) {
          const captured = await captureAdminHumanInteraction(def.run);
          outcome = captured.outcome;
          const mergedActual = outcome?.actual && typeof outcome.actual === 'object' && !Array.isArray(outcome.actual)
            ? { ...outcome.actual, humanInteraction: captured.evidence }
            : { value: outcome?.actual ?? null, humanInteraction: captured.evidence };
          if (outcome?.status === 'passed' && Number(captured.evidence.eventCount || 0) < 1) {
            outcome = fail(
              '案例邏輯完成，但沒有觀察到管理端真人 UI 互動事件；完整 E2E 不接受只走 API／內部函式。',
              { humanInteractionEventsAtLeast: 1 },
              mergedActual
            );
          } else {
            outcome = { ...outcome, actual: safe(mergedActual) };
          }
        } else {
          outcome = await def.run();
        }
        Object.assign(row, outcome);
      } catch (error) {
        Object.assign(row, fail('案例執行發生未預期錯誤。', { noUnhandledError: true }, plainError(error)));
      }
      row.durationMs = Math.max(0, Math.round(performance.now() - started));
      render();
      if (state.cancelled) break;
      await sleep(50);
    }
  }

  

  async function adminSession() {
    const session = await window.MemberAdminSession?.wait?.();
    if (!session?.idToken || !session?.config?.supabaseUrl) throw new Error('管理端 Session 尚未準備完成。');
    return session;
  }

  function functionUrl(config, slug) {
    const base = String(config?.supabaseUrl || '').replace(/\/$/, '');
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(base)) throw new Error('Supabase URL 設定不完整。');
    return base + '/functions/v1/' + slug;
  }

  async function postFunction(slug, body) {
    const session = await adminSession();
    const response = await fetch(functionUrl(session.config, slug), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: String(session.config.supabasePublishableKey || '')
      },
      cache: 'no-store',
      body: JSON.stringify(body)
    });
    let parsed = null;
    try { parsed = await response.json(); } catch {}
    if (!response.ok || !parsed || parsed.ok !== true) {
      const error = new Error(parsed?.error?.message || 'E2E 後端服務拒絕操作。');
      error.code = parsed?.error?.code || 'E2E_API_ERROR';
      throw error;
    }
    return parsed.data || {};
  }

  function compactRecordSnapshot(value, maxChars = 1600) {
    const normalized = safe(value);
    let serialized = '';
    try { serialized = JSON.stringify(normalized); } catch { return { serializationFailed: true }; }
    if (serialized.length <= maxChars) return normalized;
    return {
      truncated: true,
      originalChars: serialized.length,
      preview: serialized.slice(0, Math.max(200, maxChars - 120))
    };
  }

  async function recordResultRows(rows, runnerKind, suite, memberId = '', startedAt = '') {
    const sourceRows = Array.isArray(rows) ? rows : [];
    if (!sourceRows.length) return null;
    // test-control-api accepts at most 80 cases per browser run.
    if (sourceRows.length > 80) {
      const batches = [];
      for (let offset = 0; offset < sourceRows.length; offset += 80) {
        batches.push(await recordResultRows(sourceRows.slice(offset, offset + 80), runnerKind, suite, memberId, startedAt));
      }
      return { ...batches[batches.length - 1], runs: batches.map((batch) => batch?.run).filter(Boolean) };
    }
    const session = await adminSession();
    const cases = sourceRows.map((item) => {
      const detailLimit = item.status === 'failed' ? 3600 : 1400;
      return {
        key: item.key,
        name: item.name,
        domain: item.domain,
        status: item.status,
        message: String(item.message || '').slice(0, 1000),
        expected: compactRecordSnapshot(item.expected, detailLimit),
        actual: compactRecordSnapshot(item.actual, detailLimit),
        durationMs: Number(item.durationMs || 0)
      };
    });
    const payload = {
      action: 'admin.test-control.record-browser-run',
      clientType: 'admin',
      idToken: session.idToken,
      runnerKind,
      suite,
      memberId: memberId || undefined,
      startedAt: startedAt || state.runStartedAt || new Date(Date.now() - 1000).toISOString(),
      completedAt: new Date().toISOString(),
      cases
    };
    const bytes = new TextEncoder().encode(JSON.stringify(payload)).byteLength;
    if (bytes > 320000) {
      payload.cases = cases.map((item) => ({
        ...item,
        expected: compactRecordSnapshot(item.expected, 500),
        actual: compactRecordSnapshot(item.actual, 900)
      }));
    }
    return postFunction('test-control-api', payload);
  }

  async function recordRun(runnerKind, suite, memberId = '') {
    return recordResultRows(state.results, runnerKind, suite, memberId, state.runStartedAt || '');
  }

  function adminDefinitions(suite) {
    const common = [
      caseDef('ADMIN_AUTH_READY', '管理端授權與頁面就緒', 'Authentication', adminReadyCase),
      caseDef('ADMIN_PRIMARY_NAVIGATION', '管理端主要分頁真人切換', 'UI', adminNavigationCase),
      caseDef('ADMIN_TEST_MEMBER_ROSTER', '測試會員名冊真人切換與載入', 'Member', adminTestRosterCase),
      caseDef('ADMIN_MEMBER_MODALS', '會員狀態／紀錄／發放視窗真人操作', 'UI', adminMemberModalCase)
    ];
    if (suite !== 'full') return common;
    return common.concat([
      caseDef('ADMIN_TEST_MEMBER_PROFILE_EDIT', '真人操作：修改並還原測試會員資料', 'Human E2E', adminProfileMutationCase),
      caseDef('ADMIN_RESOURCE_EDITORS', '集點卡／票券／活動票券／日曆編輯視窗', 'Human E2E', adminResourceEditorsCase),
      caseDef('ADMIN_TICKET_CRUD', '票券：新增／修改／封存／清理', 'Admin CRUD E2E', adminTicketCrudCase),
      caseDef('ADMIN_LOTTERY_TICKET_CRUD', '抽獎券：一般票券＋活動票券建立／機率／回讀／清理', 'Admin CRUD E2E', adminLotteryTicketCrudCase),
      caseDef('ADMIN_POINT_CARD_CRUD', '集點卡：新增／修改／刪除', 'Admin CRUD E2E', adminPointCardCrudCase),
      caseDef('ADMIN_EVENT_TICKET_CRUD', '活動票券：新增／修改／刪除', 'Admin CRUD E2E', adminEventTicketCrudCase),
      caseDef('ADMIN_CALENDAR_CRUD', '日曆：新增／修改／刪除', 'Admin CRUD E2E', adminCalendarCrudCase),
      caseDef('ADMIN_BOOKING_CRUD', '預約：類型與項目新增／修改／刪除', 'Admin CRUD E2E', adminBookingCrudCase),
      caseDef('ADMIN_BOOKING_CONTROLS', '預約管理分頁與新增視窗', 'Human E2E', adminBookingControlsCase),
      caseDef('ADMIN_TEST_MODE_CONTROLS', '測試環境控制元件', 'UI', adminTestModeControlsCase),
      caseDef('ADMIN_BUTTON_COVERAGE', '所有按鈕／動態控制覆蓋清單', 'Coverage', adminButtonCoverageCase)
    ]);
  }

  async function runAdmin(suite) {
    if (state.running) return;
    // Open the child synchronously within the user's click, before any await.
    if (suite === 'full') return runPaired({ bookingOnly: true, includeAdminSuite: true });
    state.results = [];
    state.participants = [];
    state.cancelled = false;
    state.runSequence += 1;
    state.runStartedAt = new Date().toISOString();
    renderParticipants();
    setBusy(true, '管理端');
    setMessage(suite === 'full' ? '正在以測試用戶執行管理端完整真人 E2E…' : '正在以測試用戶執行管理端快速 E2E…');
    try {
      const accounts = await prepareTestAccounts(1);
      state.adminTestAccount = accounts[0];
      if (!state.cancelled) await executeCases(adminDefinitions(suite), '管理端 · 測試用戶');
      const cancelled = state.cancelled;
      const recorded = !cancelled && state.results.length ? await recordRun('admin-browser', suite) : null;
      const failed = state.results.filter((item) => item.status === 'failed').length;
      setMessage(
        cancelled
          ? '管理端 E2E 已停止；已完成案例保留，未開始的案例不再執行。'
          : failed
            ? '管理端 E2E 完成，發現 ' + failed + ' 個異常。'
            : '管理端 E2E 完成；所有會員操作皆鎖定測試用戶，結果已寫入 Test Control Center。',
        !cancelled && failed > 0
      );
      return { cancelled, recorded, account: safe(state.adminTestAccount), results: safe(state.results) };
    } catch (error) {
      const cancelled = state.cancelled;
      setMessage(cancelled ? '管理端 E2E 已停止。' : (error?.message || '管理端 E2E 未能完整執行。'), !cancelled);
      return { cancelled, error: cancelled ? null : plainError(error), results: safe(state.results) };
    } finally {
      state.adminTestAccount = null;
      setBusy(false);
      render();
    }
  }


  async function runAdminBookingQueueE2E(mode) {
    if (state.running) return;
    const queueMode = mode === 'cancellation' ? 'cancellation' : 'pending';
    state.results = [];
    state.participants = [];
    state.cancelled = false;
    state.runSequence += 1;
    state.runStartedAt = new Date().toISOString();
    renderParticipants();
    setBusy(true, queueMode === 'pending' ? '預約待確認' : '預約取消申請');
    setMessage(queueMode === 'pending'
      ? '正在建立測試會員待確認預約，接著會實際執行確認預約與不通過。'
      : '正在建立測試會員取消申請，接著會實際執行保留預約與確認取消。');
    try {
      const scenario = await prepareAdminBookingQueueScenario(queueMode);
      state.adminTestAccount = scenario.account;
      state.results.push({
        key: queueMode === 'pending' ? 'ADMIN_BOOKING_PENDING_FIXTURE' : 'ADMIN_BOOKING_CANCELLATION_FIXTURE',
        name: queueMode === 'pending' ? '預約：建立待確認 E2E 資料' : '預約：建立取消申請 E2E 資料',
        domain: 'Booking Queue E2E / Fixture',
        status: 'passed',
        message: '只使用測試會員建立本輪預約資料；正式會員不在自動化操作範圍。',
        expected: { testAccountOnly: true, fixtureReady: true },
        actual: {
          memberId: scenario.account.memberId,
          memberCode: scenario.account.memberCode,
          bookingIds: scenario.bookingIds,
          pendingCount: scenario.pending.length,
          cancellationCount: scenario.cancellations.length
        },
        durationMs: 0
      });
      render();

      if (queueMode === 'pending') {
        await executeCases([
          caseDef('ADMIN_BOOKING_PENDING_CONFIRM', '待確認：確認預約', 'Booking Queue E2E / Pending', () => adminPendingConfirmCase(scenario)),
          caseDef('ADMIN_BOOKING_PENDING_REJECT', '待確認：不通過', 'Booking Queue E2E / Pending', () => adminPendingRejectCase(scenario))
        ], '預約待確認');
      } else {
        await executeCases([
          caseDef('ADMIN_BOOKING_CANCELLATION_KEEP', '取消申請：保留預約', 'Booking Queue E2E / Cancellation', () => adminCancellationKeepCase(scenario)),
          caseDef('ADMIN_BOOKING_CANCELLATION_APPROVE', '取消申請：確認取消', 'Booking Queue E2E / Cancellation', () => adminCancellationApproveCase(scenario))
        ], '預約取消申請');
      }

      const cancelled = state.cancelled;
      const recorded = !cancelled && state.results.length
        ? await recordResultRows(state.results, 'admin-booking-queue', 'full', String(scenario.account.memberId || ''), state.runStartedAt)
        : null;
      const failed = state.results.filter((item) => item.status === 'failed').length;
      setMessage(
        cancelled
          ? '預約佇列 E2E 已停止；已完成動作保留。'
          : failed
            ? '預約佇列 E2E 完成，但有 ' + failed + ' 個動作失敗。'
            : queueMode === 'pending'
              ? '待確認 E2E 完成：確認預約與不通過都已實際執行並回讀。'
              : '取消申請 E2E 完成：保留預約、再次申請取消與確認取消都已實際執行並回讀。',
        !cancelled && failed > 0
      );
      return { cancelled, recorded, account: safe(scenario.account), results: safe(state.results) };
    } catch (error) {
      const cancelled = state.cancelled;
      setMessage(cancelled ? '預約佇列 E2E 已停止。' : (error?.message || '預約佇列 E2E 未能執行。'), !cancelled);
      return { cancelled, error: cancelled ? null : plainError(error), results: safe(state.results) };
    } finally {
      state.adminTestAccount = null;
      setBusy(false);
      render();
    }
  }

  async function runPairedAdminBookingLive(participant) {
    const wrapperKey = 'PAIRED_' + participant.index + '_ADMIN_BOOKING_FOLLOWUP';
    const rowPrefix = 'PAIRED_' + participant.index + '_ADMIN_BOOKING_';
    participant.adminStatus = '即時監看管理端預約資料';
    renderParticipants();
    await executeCases([
      caseDef(
        wrapperKey,
        '測試用戶 ' + participant.index + '：管理端資料出現即接手預約',
        'Paired E2E / Booking Admin',
        () => pairedAdminBookingFollowupCase(participant)
      )
    ], '管理端即時監看 · 測試用戶 ' + participant.index);

    const wrapperRow = state.results.find((row) => row.key === wrapperKey);
    participant.adminStatus = wrapperRow?.status === 'passed' ? '預約接手完成' : state.cancelled ? '已停止' : '預約接手有異常';
    renderParticipants();

    const followupRows = state.results.filter((row) =>
      row.key === wrapperKey || String(row.key || '').startsWith(rowPrefix)
    );
    if (!state.cancelled && followupRows.length) {
      try {
        const recordedFollowup = await recordResultRows(
          followupRows,
          'paired-browser',
          'full',
          String(participant.account?.memberId || ''),
          participant.startedAt ? new Date(participant.startedAt).toISOString() : state.runStartedAt
        );
        const followupRunCode = String(recordedFollowup?.run?.runCode || '');
        if (followupRunCode) participant.runCodes.push(followupRunCode);
      } catch (error) {
        state.results.push({
          key: 'PAIRED_' + participant.index + '_ADMIN_BOOKING_RECORD',
          name: '測試用戶 ' + participant.index + '：管理端預約 E2E 紀錄寫入',
          domain: 'Paired E2E / Audit',
          status: 'failed',
          message: '管理端預約接手流程已執行，但無法綁定回該測試會員的 Test Automation 紀錄。',
          expected: { recordedToMember: true },
          actual: plainError(error),
          durationMs: 0
        });
        render();
      }
    }
    return wrapperRow || null;
  }


  async function runPaired({ bookingOnly = false, includeAdminSuite = false } = {}) {
    if (state.running) return;
    state.cancelled = false;
    state.runSequence += 1;
    let participantCount = 1;
    let openedWindows = [];
    try {
      participantCount = includeAdminSuite ? 1 : selectedParticipantCount();
      closeClientWindows();
      openedWindows = openClientWindows(participantCount);
    } catch (error) {
      setMessage(error?.message || '無法開啟用戶端測試視窗。請允許此網站開啟彈出式視窗後重試。', true);
      return { error: plainError(error), results: [] };
    }

    state.results = [];
    state.participants = [];
    state.runStartedAt = new Date().toISOString();
    setBusy(true, '協同');
    setMessage('管理端正在先建立完整高複雜度測試資料；用戶端視窗目前只保持待命，不會提前開始。');
    try {
      const session = await adminSession();
      const mode = await postPublicTestMode(session, { action: 'public.status', clientType: 'booking' });
      if (!mode.maintenanceEnabled) {
        const error = new Error('請先啟用系統維護，再執行包含預約操作的完整 E2E。');
        error.code = 'TEST_MAINTENANCE_REQUIRED';
        throw error;
      }
      if (state.cancelled) return { cancelled: true, results: safe(state.results) };
      const fixture = await prepareComplexE2EFixtures();
      if (state.cancelled) return { cancelled: true, results: safe(state.results) };

      const accounts = await prepareTestAccounts(participantCount);
      state.adminTestAccount = accounts[0];
      state.participants = accounts.map((account, index) => ({
        index: index + 1,
        account,
        window: openedWindows[index],
        status: '等待隨機啟動',
        surface: '前置資料完成',
        surfacePlan: bookingOnly ? PAIRED_SURFACES.filter(([key]) => key === 'booking') : shuffled(PAIRED_SURFACES),
        runCodes: [],
        startedAt: Date.now(),
        login: null,
        lastSurfaceKey: '',
        adminStatus: '監看預約資料',
        liveBookingIds: [],
        adminBookingTask: null
      }));
      renderParticipants();

      setMessage('管理端前置資料已完整建立；現在隨機啟動 ' + participantCount + ' 位測試用戶，管理端會同步監看預約資料，資料一出現在管理端就開始模擬審核，不等待用戶端關閉。');
      if (!state.cancelled) {
        const liveAdminTasks = state.participants.map((participant) => {
          const task = runPairedAdminBookingLive(participant);
          participant.adminBookingTask = task;
          return task;
        });
        const clientTasks = state.participants.map(async (participant) => {
          await sleep(randomInt(80, 1200));
          return runParticipantSurfaces(participant);
        });
        const definitions = bookingOnly && !includeAdminSuite
          ? adminDefinitions('full').filter((def) => ['ADMIN_AUTH_READY', 'ADMIN_BOOKING_CONTROLS'].includes(def.key))
          : adminDefinitions('full');
        const adminTask = executeCases(definitions, '管理端 · 完整資料已建立');
        await Promise.all([adminTask, ...clientTasks, ...liveAdminTasks]);
      }

      if (!state.cancelled) {
        for (const participant of shuffled(state.participants)) {
          participant.status = '同步驗證';
          participant.surface = '管理端紀錄';
          renderParticipants();
          await executeCases([
            caseDef(
              'PAIRED_' + participant.index + '_ADMIN_RECORD_SYNC',
              '測試用戶 ' + participant.index + '：用戶端測試紀錄同步回管理端',
              'Paired E2E / Audit',
              () => verifyUserRunsVisibleInAdmin(participant.account, participant.runCodes)
            )
          ], '同步驗證 · 測試用戶 ' + participant.index);
          participant.status = state.results[state.results.length - 1]?.status === 'passed' ? '完成' : '有異常';
          participant.surface = '完成';
          renderParticipants();
          if (state.cancelled) break;
          await sleep(randomInt(60, 360));
        }
      }

      if (!state.cancelled && !bookingOnly && state.participants[0]) {
        await runDeepPairedSuite(state.participants[randomInt(0, state.participants.length - 1)]);
      }

      if (!state.cancelled && !bookingOnly) {
        await executeCases([
          caseDef(
            'PAIRED_HUMAN_INTERACTION_COVERAGE',
            '管理端 ↔ 用戶端真人互動完整覆蓋',
            'Coverage',
            pairedHumanInteractionCoverageCase
          )
        ], '真人互動覆蓋驗證');
      }

      const cancelled = state.cancelled;
      const recorded = !cancelled && state.results.length ? await recordRun('paired-browser', 'full') : null;
      const failed = state.results.filter((item) => item.status === 'failed').length;
      if (cancelled) {
        for (const participant of state.participants) {
          if (participant.status !== '完成') {
            participant.status = '已停止';
            participant.surface = '停止';
          }
        }
        renderParticipants();
      }
      setMessage(
        cancelled
          ? '協同 E2E 已停止；已完成案例與管理端建立的測試資料均保留，用戶端視窗保留供檢查。'
          : failed
            ? participantCount + ' 位測試用戶隨機協同 E2E 完成，發現 ' + failed + ' 個異常；高複雜度測試資料保留供檢查。'
            : participantCount + ' 位測試用戶已完成隨機多路徑管理端 ↔ 用戶端協同 E2E；高複雜度測試資料保留，需由「移除測試資料」統一清理。',
        !cancelled && failed > 0
      );
      return {
        cancelled,
        recorded,
        fixture: safe(fixture),
        participants: safe(state.participants.map((item) => ({
          account: item.account,
          surfacePlan: item.surfacePlan?.map(([key]) => key) || []
        }))),
        results: safe(state.results)
      };
    } catch (error) {
      if (!state.cancelled) {
        state.results.push({
          key: 'PAIRED_RUNNER_FATAL',
          name: '協同 Runner 啟動',
          domain: 'Paired E2E',
          status: 'failed',
          message: error?.message || '協同 Runner 無法啟動。',
          expected: { runnable: true, testAccountsOnly: true, complexFixtureReadyBeforeClients: true },
          actual: { ...plainError(error), fixture: safe(error?.fixture || {}) },
          durationMs: 0
        });
      }
      setMessage(state.cancelled ? '協同 E2E 已停止。' : (error?.message || '協同 E2E 無法啟動。請確認系統維護、目前裝置測試登入與彈出式視窗權限。'), !state.cancelled);
      render();
      if (!state.cancelled) {
        try { await recordRun('paired-browser', 'full'); } catch {}
        closeClientWindows();
      }
      return { cancelled: state.cancelled, error: state.cancelled ? null : plainError(error), results: safe(state.results) };
    } finally {
      state.adminTestAccount = null;
      setBusy(false);
      render();
      renderParticipants();
    }
  }

  async function runParticipantSurfaces(participant) {
    participant.startedAt = Number(participant.startedAt || 0) || Date.now();
    participant.status = '執行中';
    participant.surfacePlan = Array.isArray(participant.surfacePlan) && participant.surfacePlan.length
      ? participant.surfacePlan
      : shuffled(PAIRED_SURFACES);
    renderParticipants();

    for (const [surface, label] of participant.surfacePlan) {
      if (state.cancelled) break;
      await sleep(randomInt(120, 950));
      const started = performance.now();
      const row = {
        key: 'PAIRED_' + participant.index + '_' + surface.toUpperCase(),
        name: '測試用戶 ' + participant.index + '：' + label + '隨機真人 E2E',
        domain: 'Paired E2E / ' + surface,
        status: 'running',
        message: '正在建立此用戶端專屬 Session，並於獨立視窗執行隨機化真人操作…',
        expected: { memberCode: participant.account?.memberCode || null, failedCases: 0, sessionSurface: surface, humanInteractionVerified: true },
        actual: {},
        durationMs: null
      };
      state.results.push(row);
      participant.status = '執行中';
      participant.surface = label;
      renderParticipants();
      render();
      if (state.floating) state.floating.textContent = 'E2E 執行中 · 多用戶隨機並行 · 測試用戶 ' + participant.index + ' · ' + label;
      try {
        const login = await createPairedSession(participant.account, surface);
        participant.login = login;
        participant.lastSurfaceKey = surface;
        seedParticipantSession(participant, login);
        await sleep(randomInt(80, 520));
        const child = await runUserSurface(participant, surface, label);
        if (surface === 'booking') {
          participant.bookingResult = child;
          participant.adminStatus = '已取得完整接手清單';
          renderParticipants();
          if (participant.adminBookingTask) await participant.adminBookingTask;
        }
        const summary = child?.summary || {};
        const childMemberId = child?.account?.memberId || '';
        const runCode = String(child?.browserRun?.runCode || '');
        if (runCode) participant.runCodes.push(runCode);
        const humanInteraction = child?.humanInteraction || {};
        const humanInteractionVerified = Number(humanInteraction.requiredCases || 0) > 0
          && Number(humanInteraction.passedCases || 0) === Number(humanInteraction.requiredCases || 0)
          && Array.isArray(humanInteraction.missingEvidenceKeys)
          && humanInteraction.missingEvidenceKeys.length === 0;
        row.actual = {
          memberCode: participant.account?.memberCode || null,
          sessionSurface: surface,
          sameTestMember: childMemberId === participant.account?.memberId,
          humanInteractionVerified,
          humanInteraction: safe(humanInteraction),
          passed: Number(summary.passed || 0),
          failed: Number(summary.failed || 0),
          skipped: Number(summary.skipped || 0),
          total: Number(summary.total || 0),
          runCode: runCode || null,
          cancelled: Boolean(child?.cancelled),
          surfacePlan: participant.surfacePlan.map(([key]) => key)
        };
        if (state.cancelled || child?.cancelled) {
          Object.assign(row, skip(label + ' E2E 已依停止要求中止。', { stoppedSafely: true }, row.actual));
        } else {
          const sameMember = childMemberId === participant.account?.memberId;
          const ok = child?.ok === true && Number(summary.failed || 0) === 0 && sameMember && humanInteractionVerified;
          Object.assign(row, ok
            ? pass(label + '隨機真人 E2E 通過，且使用的是該用戶端專屬測試 Session。', row.expected, row.actual)
            : fail(label + '真人 E2E、Session surface 或測試用戶一致性驗證失敗。', row.expected, row.actual));
        }
      } catch (error) {
        Object.assign(row, state.cancelled
          ? skip(label + ' E2E 已停止。', { stoppedSafely: true }, { stoppedSafely: true })
          : fail(label + '獨立用戶端 E2E 發生錯誤。', row.expected, plainError(error)));
      }
      row.durationMs = Math.max(0, Math.round(performance.now() - started));
      render();
    }

    participant.status = state.cancelled ? '已停止' : '用戶端完成';
    participant.surface = state.cancelled ? '停止' : '等待同步驗證';
    renderParticipants();
  }

  async function pairedHumanInteractionCoverageCase() {
    const expectedSurfaces = PAIRED_SURFACES.map(([key]) => key);
    const clientCoverage = [];
    for (const participant of state.participants) {
      for (const surfaceKey of expectedSurfaces) {
        const row = state.results.find((item) => item.key === 'PAIRED_' + participant.index + '_' + surfaceKey.toUpperCase());
        clientCoverage.push({
          participant: participant.index,
          surface: surfaceKey,
          passed: row?.status === 'passed',
          humanInteractionVerified: row?.actual?.humanInteractionVerified === true
        });
      }
    }

    const adminRows = state.results.filter((item) => item.humanRequired === true && !/^PAIRED_\d+_(?:MEMBER|POINTS|EVENT|CALENDAR|BOOKING)$/.test(String(item.key || '')));
    const adminCoverage = adminRows.map((item) => ({
      key: item.key,
      status: item.status,
      eventCount: Number(item?.actual?.humanInteraction?.eventCount || 0)
    }));
    const missingClients = clientCoverage.filter((item) => !item.passed || !item.humanInteractionVerified);
    const missingAdmin = adminCoverage.filter((item) => item.status !== 'passed' || item.eventCount < 1);
    const ok = clientCoverage.length === state.participants.length * expectedSurfaces.length
      && missingClients.length === 0
      && adminCoverage.length > 0
      && missingAdmin.length === 0;
    const actual = {
      expectedSurfaceCountPerParticipant: expectedSurfaces.length,
      clientCoverage,
      adminHumanCaseCount: adminCoverage.length,
      adminCoverage,
      missingClients,
      missingAdmin
    };
    return ok
      ? pass('五種用戶端與管理端所有真人案例都有實際 UI 互動證據。', {
          allClientSurfacesHumanDriven: true,
          allAdminHumanCasesObserved: true
        }, actual)
      : fail('完整協同 E2E 仍有 surface 或管理端案例缺少真人 UI 互動證據。', {
          allClientSurfacesHumanDriven: true,
          allAdminHumanCasesObserved: true
        }, actual);
  }

  async function adminReadyCase() {
    const session = await adminSession();
    const ready = document.documentElement.dataset.memberAdminReady === 'true';
    const visible = !document.getElementById('adminView')?.classList.contains('hidden');
    return ready && visible
      ? pass('管理員已通過身分與權限驗證，管理畫面已就緒。', { ready: true, visible: true }, { ready, visible, hasIdToken: Boolean(session.idToken) })
      : fail('管理端尚未完成登入或畫面未就緒。', { ready: true, visible: true }, { ready, visible, hasIdToken: Boolean(session.idToken) });
  }

  async function adminNavigationCase() {
    const pairs = [
      ['membersTab', 'membersPanel'],
      ['cardsTab', 'cardsPanel'],
      ['eventsTab', 'eventsPanel'],
      ['calendarTab', 'calendarPanel'],
      ['bookingTab', 'bookingPanel'],
      ['testModeTab', 'testModePanel']
    ];
    const actual = {};
    for (const [tabId, panelId] of pairs) {
      const tab = await waitFor(() => document.getElementById(tabId), 6000);
      if (!tab) { actual[tabId] = false; continue; }
      tab.click();
      actual[tabId] = Boolean(await waitFor(() => {
        const panel = document.getElementById(panelId);
        return panel && !panel.classList.contains('hidden');
      }, 3000));
    }
    const ok = Object.values(actual).every(Boolean);
    return ok
      ? pass('所有主要管理分頁皆以真人點擊方式成功切換。', { allPrimaryTabsOpen: true }, actual)
      : fail('至少一個主要管理分頁無法正常切換。', { allPrimaryTabsOpen: true }, actual);
  }

  async function ensureTestRoster(account = state.adminTestAccount) {
    document.getElementById('membersTab')?.click();
    await waitFor(() => !document.getElementById('membersPanel')?.classList.contains('hidden'), 3000);
    document.getElementById('testMembersSubtab')?.click();
    const selected = await waitFor(
      () => document.getElementById('testMembersSubtab')?.getAttribute('aria-selected') === 'true',
      3000
    );
    if (!selected) {
      const error = new Error('E2E 安全邊界：無法切換到測試用戶名冊，已停止會員操作。');
      error.code = 'E2E_TEST_ROSTER_REQUIRED';
      throw error;
    }
    const memberCode = String(account?.memberCode || '');
    const edit = await waitFor(() => {
      const rows = Array.from(document.querySelectorAll('#memberTableBody tr'));
      const row = memberCode
        ? rows.find((item) => item.textContent?.includes(memberCode))
        : rows[0];
      return row?.querySelector('button[data-action="edit-member"]') || null;
    }, 10000, 100);
    if (!edit) throw new Error(memberCode ? '找不到本次指定的測試用戶：' + memberCode : '測試會員名冊未載入可操作帳號。');
    return edit;
  }

  async function adminTestRosterCase() {
    const edit = await ensureTestRoster();
    const rows = document.querySelectorAll('#memberTableBody tr').length;
    const testRosterSelected = document.getElementById('testMembersSubtab')?.getAttribute('aria-selected') === 'true';
    const targetCode = String(state.adminTestAccount?.memberCode || '');
    return rows > 0 && testRosterSelected
      ? pass('已真人切換到測試用戶名冊，且本次 E2E 指定測試用戶可操作。', { rowsAtLeast: 1, testRosterSelected: true, targetTestAccount: true }, { rows, testRosterSelected, targetCode, firstAction: edit.dataset.action })
      : fail('測試用戶名冊或指定測試用戶載入異常。', { rowsAtLeast: 1, testRosterSelected: true, targetTestAccount: true }, { rows, testRosterSelected, targetCode });
  }

  async function clickRowAction(action, lineUserId) {
    const buttons = Array.from(document.querySelectorAll('#memberTableBody button[data-action]'));
    const button = buttons.find((item) => item.dataset.action === action && (!lineUserId || item.dataset.value === lineUserId));
    if (!button) throw new Error('找不到會員操作按鈕：' + action);
    button.click();
    return button;
  }

  async function adminMemberModalCase() {
    const edit = await ensureTestRoster();
    const lineUserId = String(edit.dataset.value || '');
    const actual = { edit: false, records: false, grant: false };

    await clickRowAction('edit-member', lineUserId);
    actual.edit = Boolean(await waitFor(() => !document.getElementById('memberModal')?.classList.contains('hidden'), 3000));
    if (document.getElementById('memberIsTestAccount')?.value !== 'true') {
      document.getElementById('cancelMemberButton')?.click();
      const error = new Error('E2E 安全邊界：管理端會員測試只能操作測試用戶，已阻擋正式用戶。');
      error.code = 'E2E_REAL_MEMBER_BLOCKED';
      throw error;
    }
    document.getElementById('cancelMemberButton')?.click();
    await waitFor(() => document.getElementById('memberModal')?.classList.contains('hidden'), 3000);

    await clickRowAction('view-records', lineUserId);
    actual.records = Boolean(await waitFor(() => !document.getElementById('memberRecordsModal')?.classList.contains('hidden'), 7000));
    document.getElementById('closeMemberRecordsModal')?.click();
    await waitFor(() => document.getElementById('memberRecordsModal')?.classList.contains('hidden'), 3000);

    await clickRowAction('add-grant', lineUserId);
    actual.grant = Boolean(await waitFor(() => !document.getElementById('grantModal')?.classList.contains('hidden'), 7000));
    document.getElementById('cancelGrantButton')?.click();
    await waitFor(() => document.getElementById('grantModal')?.classList.contains('hidden'), 3000);

    const ok = Object.values(actual).every(Boolean);
    return ok
      ? pass('會員狀態、紀錄、發放三個管理視窗皆可真人開啟與關閉。', { allDialogs: true }, actual)
      : fail('至少一個會員管理視窗互動異常。', { allDialogs: true }, actual);
  }

  function setField(id, value) {
    const element = document.getElementById(id);
    if (!element) return false;
    element.value = value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  async function openTestMember(lineUserId) {
    await ensureTestRoster();
    await clickRowAction('edit-member', lineUserId);
    const opened = Boolean(await waitFor(() => !document.getElementById('memberModal')?.classList.contains('hidden'), 4000));
    if (!opened) return false;
    if (document.getElementById('memberIsTestAccount')?.value !== 'true') {
      document.getElementById('cancelMemberButton')?.click();
      const error = new Error('E2E 安全邊界：偵測到正式用戶，已禁止修改並停止測試。');
      error.code = 'E2E_REAL_MEMBER_BLOCKED';
      throw error;
    }
    return true;
  }

  async function submitMemberAndWait() {
    document.getElementById('saveMemberButton')?.click();
    return Boolean(await waitFor(() => document.getElementById('memberModal')?.classList.contains('hidden'), 10000));
  }

  async function adminProfileMutationCase() {
    const edit = await ensureTestRoster();
    const lineUserId = String(edit.dataset.value || '');
    await openTestMember(lineUserId);
    const original = {
      displayName: String(document.getElementById('memberDisplayName')?.value || ''),
      surname: String(document.getElementById('memberSurname')?.value || ''),
      salutation: String(document.getElementById('memberSalutation')?.value || 'mr'),
      birthday: String(document.getElementById('memberBirthday')?.value || ''),
      phone: String(document.getElementById('memberPhone')?.value || ''),
      status: String(document.getElementById('memberStatus')?.value || 'active')
    };
    const suffix = Date.now().toString(36).slice(-5).toUpperCase();
    const next = {
      displayName: ('QA E2E ' + suffix).slice(0, 70),
      surname: original.surname === '測' ? '驗' : '測',
      salutation: original.salutation === 'mr' ? 'ms' : 'mr',
      birthday: original.birthday === '1990-01-15' ? '1991-02-16' : '1990-01-15',
      phone: original.phone.replace(/\D/g, '') === '0900000001' ? '0900000002' : '0900000001',
      status: original.status
    };
    let changedVerified = false;
    let restoredVerified = false;

    async function fill(profile) {
      setField('memberDisplayName', profile.displayName);
      setField('memberSurname', profile.surname);
      setField('memberSalutation', profile.salutation);
      setField('memberBirthday', profile.birthday);
      setField('memberPhone', profile.phone);
      setField('memberStatus', profile.status);
    }

    try {
      await fill(next);
      if (!await submitMemberAndWait()) throw new Error('測試會員修改後視窗未正常關閉。');
      await openTestMember(lineUserId);
      changedVerified = [
        ['memberDisplayName', next.displayName],
        ['memberSurname', next.surname],
        ['memberSalutation', next.salutation],
        ['memberBirthday', next.birthday],
        ['memberPhone', next.phone]
      ].every(([id, value]) => String(document.getElementById(id)?.value || '') === value);
      await fill(original);
      if (!await submitMemberAndWait()) throw new Error('測試會員還原後視窗未正常關閉。');
      await openTestMember(lineUserId);
      restoredVerified = [
        ['memberDisplayName', original.displayName],
        ['memberSurname', original.surname],
        ['memberSalutation', original.salutation],
        ['memberBirthday', original.birthday],
        ['memberPhone', original.phone]
      ].every(([id, value]) => String(document.getElementById(id)?.value || '') === value);
      document.getElementById('cancelMemberButton')?.click();
    } finally {
      if (!restoredVerified) {
        try {
          if (document.getElementById('memberModal')?.classList.contains('hidden')) await openTestMember(lineUserId);
          await fill(original);
          await submitMemberAndWait();
        } catch {}
      }
    }

    const actual = { changedVerified, restoredVerified, lineUserId: lineUserId ? '[present]' : '[missing]' };
    return changedVerified && restoredVerified
      ? pass('已透過管理端 UI 修改測試會員全部可編輯個資欄位，驗證後完整還原。', { changedVerified: true, restoredVerified: true }, actual)
      : fail('測試會員修改或還原驗證失敗。', { changedVerified: true, restoredVerified: true }, actual);
  }

  async function openEditor(buttonId, modalId, preClick) {
    if (typeof preClick === 'function') await preClick();
    const button = document.getElementById(buttonId);
    if (!button) return false;
    button.click();
    const modal = await waitFor(() => {
      const node = document.getElementById(modalId);
      return node && !node.classList.contains('hidden') ? node : null;
    }, 3500);
    if (!modal) return false;
    modal.querySelector('.editor-modal-close')?.click();
    await waitFor(() => modal.classList.contains('hidden'), 3000);
    return true;
  }

  async function adminResourceEditorsCase() {
    const actual = {};
    document.getElementById('cardsTab')?.click();
    await sleep(50);
    actual.card = await openEditor('newCardButton', 'cardEditorModal', async () => document.getElementById('cardSettingsTab')?.click());
    actual.ticket = await openEditor('newTicketButton', 'ticketEditorModal', async () => document.getElementById('ticketSettingsTab')?.click());
    document.getElementById('eventsTab')?.click();
    actual.eventTicket = await openEditor('newEventTicketButton', 'eventTicketEditorModal');
    document.getElementById('calendarTab')?.click();
    actual.calendar = await openEditor('newCalendarItemButton', 'calendarEditorModal');

    const prev = document.getElementById('adminCalendarMonthTitle')?.textContent || '';
    document.getElementById('adminCalendarNextMonthButton')?.click();
    await sleep(80);
    const moved = document.getElementById('adminCalendarMonthTitle')?.textContent || '';
    document.getElementById('adminCalendarTodayButton')?.click();
    actual.calendarNavigation = Boolean(prev && moved && prev !== moved);

    const ok = Object.values(actual).every(Boolean);
    return ok
      ? pass('四種資源編輯視窗與管理日曆切換皆可真人操作。', { allEditors: true, calendarNavigation: true }, actual)
      : fail('至少一個資源編輯視窗或日曆切換異常。', { allEditors: true, calendarNavigation: true }, actual);
  }

  function qaCrudStamp() {
    return Date.now().toString(36).slice(-7) + Math.random().toString(36).slice(2, 6);
  }

  function textIncludes(selector, value) {
    return String(document.querySelector(selector)?.textContent || '').includes(String(value || ''));
  }

  async function withAutoConfirm(task) {
    const original = window.confirm;
    window.confirm = () => true;
    try { return await task(); }
    finally { window.confirm = original; }
  }

  function closeEditorModalById(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal || modal.classList.contains('hidden')) return;
    modal.querySelector('.editor-modal-close')?.click();
  }

  async function waitEditorOpen(modalId, timeoutMs = 4000) {
    return waitFor(() => {
      const modal = document.getElementById(modalId);
      return modal && !modal.classList.contains('hidden') ? modal : null;
    }, timeoutMs);
  }

  async function waitAdminWriteSettled(buttonId, timeoutMs = 22000) {
    return Boolean(await waitFor(() => {
      const button = document.getElementById(buttonId);
      if (!button) return null;
      return !button.disabled ? button : null;
    }, timeoutMs, 80));
  }

  async function clickResourceRow(selector, dataKey, value, timeoutMs = 6000) {
    const row = await waitFor(() => {
      return Array.from(document.querySelectorAll(selector)).find((item) =>
        String(item.dataset?.[dataKey] || '') === String(value || '')
      ) || null;
    }, timeoutMs, 80);
    if (!row) return false;
    row.click();
    return true;
  }

  function findBookingRow(containerId, title) {
    return Array.from(document.querySelectorAll('#' + containerId + ' .booking-admin-service-row')).find((row) => {
      return String(row.querySelector('strong')?.textContent || '').trim() === String(title || '').trim();
    }) || null;
  }

  async function waitBookingAdminReady(timeoutMs = 15000) {
    return Boolean(await waitFor(() => {
      const status = document.getElementById('bookingAdminSyncStatus');
      const text = String(status?.textContent || '');
      if (!status || /同步預約資料中/.test(text) || status.classList.contains('error')) return null;
      return document.getElementById('bookingAdminNewTypeButton')
        && document.getElementById('bookingAdminNewServiceButton')
        && document.getElementById('bookingAdminTypeList')
        && document.getElementById('bookingAdminServiceList');
    }, timeoutMs, 100));
  }

  function clickBookingRowAction(containerId, title, actionLabel) {
    const row = findBookingRow(containerId, title);
    if (!row) return false;
    const button = Array.from(row.querySelectorAll('button')).find((item) => String(item.textContent || '').trim() === actionLabel);
    if (!button) return false;
    button.click();
    return true;
  }


  async function cleanupQaTicketTemplate(ticketTemplateId) {
    if (!ticketTemplateId) return { deleted: true, alreadyMissing: true };
    const session = await adminSession();
    return postFunction('test-control-api', {
      action: 'admin.test-control.cleanup-ticket-template',
      clientType: 'admin',
      idToken: session.idToken,
      ticketTemplateId
    });
  }

  async function createQaTicketTemplate(title, options = {}) {
    document.getElementById('cardsTab')?.click();
    document.getElementById('ticketSettingsTab')?.click();
    document.getElementById('newTicketButton')?.click();
    const modal = await waitEditorOpen('ticketEditorModal', 5000);
    if (!modal) throw new Error('票券新增編輯器未開啟。');

    const ticketType = String(options.ticketType || 'coupon');
    setField('ticketTitle', title);
    setField('ticketType', ticketType);
    setField('ticketDescription', options.description || 'E2E QA 深度測試票券，完成後由 Test Control 清理。');
    setField('ticketUsageMethod', options.usageMethod || '僅供自動化 E2E');
    setField('ticketUsageInstructions', options.usageInstructions || '不可供正式會員使用；測試完成後自動清理。');
    setField('ticketStatus', options.status || 'active');
    if (ticketType === 'lottery') {
      const lottery = await configureLotteryPrizeEditor('ticket', Array.isArray(options.prizes) && options.prizes.length
        ? options.prizes
        : [
            { title: 'E2E 頭獎', rate: 50, description: '管理端 E2E 抽獎券頭獎' },
            { title: 'E2E 二獎', rate: 35, description: '管理端 E2E 抽獎券二獎' },
            { title: 'E2E 參加獎', rate: 15, description: '管理端 E2E 抽獎券參加獎' }
          ]);
      if (!lottery.editorVisible || !lottery.totalIs100) {
        closeEditorModalById('ticketEditorModal');
        throw new Error('抽獎券獎項機率未完成 100% 設定。');
      }
    }
    document.getElementById('saveTicketButton')?.click();

    const ticketTemplateId = String(await waitFor(() => document.getElementById('ticketTemplateId')?.value || null, 15000) || '');
    await waitAdminWriteSettled('saveTicketButton');
    if (!ticketTemplateId) {
      closeEditorModalById('ticketEditorModal');
      throw new Error('票券儲存後沒有取得 Ticket Template ID。');
    }
    const listed = Boolean(await waitFor(() => textIncludes('#ticketListItems', title), 10000));
    if (!listed) {
      closeEditorModalById('ticketEditorModal');
      throw new Error('票券儲存後沒有出現在管理端票券清單。');
    }
    return { ticketTemplateId, title, modal };
  }

  async function adminTicketCrudCase() {
    const stamp = qaCrudStamp();
    const createdTitle = 'E2E QA 深度票券 ' + stamp;
    const updatedTitle = createdTitle + ' 修改';
    const actual = { created: false, updated: false, archived: false, cleaned: false };
    let ticketTemplateId = '';

    try {
      const fixture = await createQaTicketTemplate(createdTitle, { status: 'active' });
      ticketTemplateId = fixture.ticketTemplateId;
      actual.created = Boolean(ticketTemplateId);

      setField('ticketTitle', updatedTitle);
      setField('ticketDescription', 'E2E QA 深度票券已完成修改驗證。');
      document.getElementById('saveTicketButton')?.click();
      await waitAdminWriteSettled('saveTicketButton');
      await clickResourceRow('#ticketListItems [data-ticket-template-id]', 'ticketTemplateId', ticketTemplateId);
      actual.updated = Boolean(await waitFor(() =>
        String(document.getElementById('ticketTemplateId')?.value || '') === ticketTemplateId &&
        String(document.getElementById('ticketTitle')?.value || '') === updatedTitle &&
        textIncludes('#ticketListItems', updatedTitle)
      , 8000));

      setField('ticketStatus', 'archived');
      document.getElementById('saveTicketButton')?.click();
      await waitAdminWriteSettled('saveTicketButton');
      await clickResourceRow('#ticketListItems [data-ticket-template-id]', 'ticketTemplateId', ticketTemplateId);
      actual.archived = Boolean(await waitFor(() =>
        String(document.getElementById('ticketTemplateId')?.value || '') === ticketTemplateId &&
        String(document.getElementById('ticketStatus')?.value || '') === 'archived'
      , 8000));
    } finally {
      closeEditorModalById('ticketEditorModal');
      if (ticketTemplateId) {
        try {
          const result = await cleanupQaTicketTemplate(ticketTemplateId);
          actual.cleaned = Boolean(result?.deleted);
        } catch {}
      }
    }

    const ok = actual.created && actual.updated && actual.archived && actual.cleaned;
    return ok
      ? pass('已透過管理端 UI 完成票券新增、修改與封存，並由受管理員授權的 QA 清理路徑移除測試範本。', { created: true, updated: true, archived: true, cleaned: true }, actual)
      : fail('票券 CRUD E2E 至少一個階段失敗。', { created: true, updated: true, archived: true, cleaned: true }, actual);
  }


  async function configureLotteryPrizeEditor(kind, prizes) {
    const isEvent = kind === 'event';
    const typeId = isEvent ? 'eventTicketType' : 'ticketType';
    const editorId = isEvent ? 'eventTicketPrizeEditor' : 'ticketPrizeEditor';
    const rowsId = isEvent ? 'eventTicketPrizeRows' : 'ticketPrizeRows';
    const addId = isEvent ? 'addEventTicketPrizeButton' : 'addTicketPrizeButton';
    const totalId = isEvent ? 'eventTicketPrizeTotal' : 'ticketPrizeTotal';
    const rowSelector = isEvent ? '[data-event-ticket-prize-row]' : '[data-ticket-prize-row]';
    const titleField = isEvent ? 'eventTicketPrizeTitle' : 'ticketPrizeTitle';
    const rateField = isEvent ? 'eventTicketPrizeRate' : 'ticketPrizeRate';
    const descriptionField = isEvent ? 'eventTicketPrizeDescription' : 'ticketPrizeDescription';

    setField(typeId, 'lottery');
    if (!await waitFor(() => !document.getElementById(editorId)?.classList.contains('hidden'), 2500)) {
      throw new Error('抽獎券獎項編輯器未開啟。');
    }
    while (document.querySelectorAll('#' + rowsId + ' ' + rowSelector).length < prizes.length) {
      document.getElementById(addId)?.click();
      await sleep(20);
    }
    const rows = Array.from(document.querySelectorAll('#' + rowsId + ' ' + rowSelector));
    if (rows.length < prizes.length) throw new Error('抽獎券獎項列建立不完整。');

    prizes.forEach((prize, index) => {
      const row = rows[index];
      const title = row?.querySelector('[data-field="' + titleField + '"]');
      const rate = row?.querySelector('[data-field="' + rateField + '"]');
      const description = row?.querySelector('[data-field="' + descriptionField + '"]');
      if (!title || !rate || !description) throw new Error('抽獎券獎項欄位不完整。');
      title.value = String(prize.title || '');
      rate.value = String(prize.rate);
      description.value = String(prize.description || '');
      [title, rate, description].forEach((input) => {
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
    });
    const totalText = String(document.getElementById(totalId)?.textContent || '');
    return {
      editorVisible: !document.getElementById(editorId)?.classList.contains('hidden'),
      rowCount: document.querySelectorAll('#' + rowsId + ' ' + rowSelector).length,
      totalText,
      totalIs100: /機率合計\s*100(?:\.0+)?%\s*✓/.test(totalText)
    };
  }

  async function adminLotteryTicketCrudCase() {
    const stamp = qaCrudStamp();
    const ticketTitle = 'E2E QA 抽獎券 ' + stamp;
    const eventTitle = 'E2E QA 活動抽獎券 ' + stamp;
    const actual = {
      ticket: { editorVisible: false, probability100: false, created: false, reloaded: false, cleaned: false },
      event: { editorVisible: false, probability100: false, created: false, reloaded: false, deleted: false, cleaned: false }
    };
    let ticketTemplateId = '';
    let eventTicketId = '';

    try {
      document.getElementById('cardsTab')?.click();
      document.getElementById('ticketSettingsTab')?.click();
      document.getElementById('newTicketButton')?.click();
      if (!await waitEditorOpen('ticketEditorModal', 5000)) throw new Error('抽獎券新增編輯器未開啟。');
      setField('ticketTitle', ticketTitle);
      setField('ticketDescription', '管理端 E2E 多獎項抽獎券');
      setField('ticketUsageMethod', '開啟後執行抽獎');
      setField('ticketUsageInstructions', '僅供測試帳號與自動化測試使用。');
      setField('ticketStatus', 'active');
      const ticketEditor = await configureLotteryPrizeEditor('ticket', [
        { title: '頭獎', rate: 55, description: 'E2E 頭獎' },
        { title: '二獎', rate: 30, description: 'E2E 二獎' },
        { title: '參加獎', rate: 15, description: 'E2E 參加獎' }
      ]);
      actual.ticket.editorVisible = ticketEditor.editorVisible;
      actual.ticket.probability100 = ticketEditor.totalIs100 && ticketEditor.rowCount >= 3;
      document.getElementById('saveTicketButton')?.click();
      ticketTemplateId = String(await waitFor(() => document.getElementById('ticketTemplateId')?.value || null, 15000) || '');
      await waitAdminWriteSettled('saveTicketButton');
      actual.ticket.created = Boolean(ticketTemplateId && textIncludes('#ticketListItems', ticketTitle));
      if (ticketTemplateId) {
        await clickResourceRow('#ticketListItems [data-ticket-template-id]', 'ticketTemplateId', ticketTemplateId);
        actual.ticket.reloaded = Boolean(await waitFor(() =>
          String(document.getElementById('ticketTemplateId')?.value || '') === ticketTemplateId
          && String(document.getElementById('ticketType')?.value || '') === 'lottery'
          && document.querySelectorAll('#ticketPrizeRows [data-ticket-prize-row]').length >= 3
          && /100(?:\.0+)?%\s*✓/.test(String(document.getElementById('ticketPrizeTotal')?.textContent || ''))
        , 8000));
      }
      closeEditorModalById('ticketEditorModal');

      document.getElementById('eventsTab')?.click();
      document.getElementById('newEventTicketButton')?.click();
      if (!await waitEditorOpen('eventTicketEditorModal', 5000)) throw new Error('活動抽獎券新增編輯器未開啟。');
      setField('eventTicketTitle', eventTitle);
      setField('eventTicketDescription', '管理端 E2E 活動抽獎券');
      setField('eventTicketUsageMethod', '領取後執行抽獎');
      setField('eventTicketUsageInstructions', '測試完成後由 E2E 自動清理。');
      setField('eventTicketStatus', 'draft');
      setField('eventTicketStartsOn', '');
      setField('eventTicketEndsOn', '');
      setField('eventTicketQuota', '12');
      const eventEditor = await configureLotteryPrizeEditor('event', [
        { title: 'VIP A', rate: 61, description: 'E2E VIP A' },
        { title: 'VIP B', rate: 29, description: 'E2E VIP B' },
        { title: 'VIP C', rate: 10, description: 'E2E VIP C' }
      ]);
      actual.event.editorVisible = eventEditor.editorVisible;
      actual.event.probability100 = eventEditor.totalIs100 && eventEditor.rowCount >= 3;
      document.getElementById('saveEventTicketButton')?.click();
      eventTicketId = String(await waitFor(() => document.getElementById('eventTicketId')?.value || null, 15000) || '');
      await waitAdminWriteSettled('saveEventTicketButton');
      actual.event.created = Boolean(eventTicketId && textIncludes('#eventTicketListItems', eventTitle));
      if (eventTicketId) {
        await clickResourceRow('#eventTicketListItems [data-event-ticket-id]', 'eventTicketId', eventTicketId);
        actual.event.reloaded = Boolean(await waitFor(() =>
          String(document.getElementById('eventTicketId')?.value || '') === eventTicketId
          && String(document.getElementById('eventTicketType')?.value || '') === 'lottery'
          && document.querySelectorAll('#eventTicketPrizeRows [data-event-ticket-prize-row]').length >= 3
          && /100(?:\.0+)?%\s*✓/.test(String(document.getElementById('eventTicketPrizeTotal')?.textContent || ''))
        , 8000));
        await withAutoConfirm(async () => {
          document.getElementById('deleteEventTicketButton')?.click();
          actual.event.deleted = Boolean(await waitFor(() => !String(document.getElementById('eventTicketId')?.value || ''), 15000));
        });
        actual.event.cleaned = actual.event.deleted;
      }
    } finally {
      closeEditorModalById('eventTicketEditorModal');
      closeEditorModalById('ticketEditorModal');
      if (eventTicketId && !actual.event.cleaned) {
        try {
          document.getElementById('eventsTab')?.click();
          const row = document.querySelector('#eventTicketListItems [data-event-ticket-id="' + CSS.escape(eventTicketId) + '"]');
          row?.click();
          await waitFor(() => String(document.getElementById('eventTicketId')?.value || '') === eventTicketId, 3000);
          await withAutoConfirm(async () => {
            document.getElementById('deleteEventTicketButton')?.click();
            actual.event.cleaned = Boolean(await waitFor(() => !String(document.getElementById('eventTicketId')?.value || ''), 12000));
          });
        } catch {}
      }
      if (ticketTemplateId) {
        try {
          const result = await cleanupQaTicketTemplate(ticketTemplateId);
          actual.ticket.cleaned = Boolean(result?.deleted);
        } catch {
          actual.ticket.cleaned = false;
        }
      }
    }

    const ok = Object.values(actual.ticket).every(Boolean) && Object.values(actual.event).every(Boolean);
    return ok
      ? pass('一般抽獎券與活動抽獎券都已完成多獎項機率 100%、儲存、回讀與清理驗證。', {
          ticketLottery: true,
          eventLottery: true,
          prizeProbabilityTotal: 100,
          persistedAndReloaded: true,
          cleaned: true
        }, actual)
      : fail('抽獎券 E2E 至少一個階段失敗。', {
          ticketLottery: true,
          eventLottery: true,
          prizeProbabilityTotal: 100,
          persistedAndReloaded: true,
          cleaned: true
        }, actual);
  }

  async function adminPointCardCrudCase() {
    const stamp = qaCrudStamp();
    const createdTitle = 'E2E 集點卡 ' + stamp;
    const updatedTitle = createdTitle + ' 修改';
    const actual = {
      lotteryTicketCreated: false,
      lotteryTicketLinked: false,
      lotteryRewardReloaded: false,
      created: false,
      updated: false,
      deleted: false,
      cleaned: false,
      ticketCleaned: true
    };
    let createdId = '';
    let qaTicketTemplateId = '';

    try {
      const lotteryFixture = await createQaTicketTemplate('E2E QA 集點卡抽獎券 ' + stamp, {
        status: 'active',
        ticketType: 'lottery',
        description: '管理端 E2E：集點卡兌換節點專用抽獎券',
        usageMethod: '集滿指定點數後使用並抽獎',
        usageInstructions: '僅供自動化 E2E；測試完成後清理。',
        prizes: [
          { title: '集點頭獎', rate: 55, description: '集點卡抽獎券頭獎' },
          { title: '集點二獎', rate: 30, description: '集點卡抽獎券二獎' },
          { title: '集點參加獎', rate: 15, description: '集點卡抽獎券參加獎' }
        ]
      });
      qaTicketTemplateId = lotteryFixture.ticketTemplateId;
      actual.lotteryTicketCreated = Boolean(qaTicketTemplateId);
      closeEditorModalById('ticketEditorModal');

      document.getElementById('cardsTab')?.click();
      document.getElementById('cardSettingsTab')?.click();
      document.getElementById('newCardButton')?.click();
      if (!await waitEditorOpen('cardEditorModal')) throw new Error('集點卡新增編輯器未開啟。');

      setField('cardTitle', createdTitle);
      setField('cardUsageMethod', 'E2E 測試用集點方式');
      setField('cardUsageInstructions', '此資料由管理端 E2E 建立，測試完成後自動刪除。');
      setField('cardBenefitDescription', '97 點兌換管理端 E2E 抽獎券');
      setField('cardStatus', 'draft');
      setField('cardExpiryMode', 'unlimited');

      const rewardSelect = await waitFor(() => document.querySelector('#rewardRows [data-field="ticketTemplateId"]'), 5000);
      const threshold = document.querySelector('#rewardRows [data-field="thresholdStamps"]');
      const lotteryOption = rewardSelect
        ? Array.from(rewardSelect.options).find((option) => String(option.value || '') === qaTicketTemplateId && !option.disabled)
        : null;
      if (!rewardSelect || !threshold || !lotteryOption) {
        throw new Error('集點卡無法選取剛建立的抽獎券兌換節點。');
      }
      threshold.value = '97';
      threshold.dispatchEvent(new Event('input', { bubbles: true }));
      rewardSelect.value = qaTicketTemplateId;
      rewardSelect.dispatchEvent(new Event('change', { bubbles: true }));
      actual.lotteryTicketLinked = String(rewardSelect.value || '') === qaTicketTemplateId;

      document.getElementById('saveCardButton')?.click();
      createdId = String(await waitFor(() => document.getElementById('cardId')?.value || null, 15000) || '');
      await waitAdminWriteSettled('saveCardButton');
      actual.created = Boolean(createdId && await waitFor(() => textIncludes('#cardListItems', createdTitle), 10000));

      if (actual.created) {
        setField('cardTitle', updatedTitle);
        setField('cardBenefitDescription', '管理端 CRUD E2E 已完成抽獎券節點修改驗證');
        document.getElementById('saveCardButton')?.click();
        await waitAdminWriteSettled('saveCardButton');
        await clickResourceRow('#cardListItems [data-card-id]', 'cardId', createdId);
        actual.updated = Boolean(await waitFor(() => {
          return String(document.getElementById('cardId')?.value || '') === createdId &&
            String(document.getElementById('cardTitle')?.value || '') === updatedTitle &&
            textIncludes('#cardListItems', updatedTitle);
        }, 8000));
        actual.lotteryRewardReloaded = Boolean(await waitFor(() => {
          const persisted = document.querySelector('#rewardRows [data-field="ticketTemplateId"]');
          return persisted && String(persisted.value || '') === qaTicketTemplateId;
        }, 5000));
      }

      if (actual.created) {
        await withAutoConfirm(async () => {
          document.getElementById('deleteCardButton')?.click();
          actual.deleted = Boolean(await waitFor(() => {
            return !String(document.getElementById('cardId')?.value || '') && !textIncludes('#cardListItems', updatedTitle);
          }, 15000));
        });
      }
      actual.cleaned = actual.deleted;
    } finally {
      if (!actual.deleted && createdId) {
        try {
          const row = document.querySelector('#cardListItems [data-card-id="' + CSS.escape(createdId) + '"]');
          row?.click();
          await waitFor(() => String(document.getElementById('cardId')?.value || '') === createdId, 3000);
          await withAutoConfirm(async () => {
            document.getElementById('deleteCardButton')?.click();
            actual.cleaned = Boolean(await waitFor(() => !String(document.getElementById('cardId')?.value || ''), 12000));
          });
        } catch {}
      }
      closeEditorModalById('cardEditorModal');
      if (qaTicketTemplateId) {
        try {
          const result = await cleanupQaTicketTemplate(qaTicketTemplateId);
          actual.ticketCleaned = Boolean(result?.deleted);
        } catch {
          actual.ticketCleaned = false;
        }
      }
    }

    const ok = actual.lotteryTicketCreated && actual.lotteryTicketLinked && actual.lotteryRewardReloaded &&
      actual.created && actual.updated && actual.deleted && actual.cleaned && actual.ticketCleaned;
    return ok
      ? pass('已透過管理端 UI 建立抽獎券並綁定集點卡兌換節點，完成儲存回讀、修改、永久刪除與 QA 清理。', {
          lotteryTicketCreated: true,
          lotteryTicketLinked: true,
          lotteryRewardReloaded: true,
          created: true,
          updated: true,
          deleted: true,
          cleaned: true
        }, actual)
      : fail('集點卡抽獎券 CRUD E2E 至少一個階段失敗。', {
          lotteryTicketCreated: true,
          lotteryTicketLinked: true,
          lotteryRewardReloaded: true,
          created: true,
          updated: true,
          deleted: true,
          cleaned: true
        }, actual);
  }

  async function adminEventTicketCrudCase() {
    const stamp = qaCrudStamp();
    const createdTitle = 'E2E 活動票券 ' + stamp;
    const updatedTitle = createdTitle + ' 修改';
    const actual = { created: false, updated: false, deleted: false, cleaned: false };
    let createdId = '';

    document.getElementById('eventsTab')?.click();
    document.getElementById('newEventTicketButton')?.click();
    const modal = await waitEditorOpen('eventTicketEditorModal');
    if (!modal) return fail('活動票券新增編輯器未開啟。', { editorOpen: true }, { editorOpen: false });

    try {
      setField('eventTicketTitle', createdTitle);
      setField('eventTicketType', 'coupon');
      setField('eventTicketDescription', '管理端 CRUD E2E 測試票券');
      setField('eventTicketUsageMethod', '僅供自動化 E2E');
      setField('eventTicketUsageInstructions', '測試完成後自動刪除，不提供正式會員使用。');
      setField('eventTicketStatus', 'draft');
      setField('eventTicketStartsOn', '');
      setField('eventTicketEndsOn', '');
      setField('eventTicketQuota', '0');

      document.getElementById('saveEventTicketButton')?.click();
      createdId = String(await waitFor(() => document.getElementById('eventTicketId')?.value || null, 15000) || '');
      await waitAdminWriteSettled('saveEventTicketButton');
      actual.created = Boolean(createdId && await waitFor(() => textIncludes('#eventTicketListItems', createdTitle), 10000));

      if (actual.created) {
        setField('eventTicketTitle', updatedTitle);
        setField('eventTicketDescription', '管理端 CRUD E2E 已完成修改');
        document.getElementById('saveEventTicketButton')?.click();
        await waitAdminWriteSettled('saveEventTicketButton');
        await clickResourceRow('#eventTicketListItems [data-event-ticket-id]', 'eventTicketId', createdId);
        actual.updated = Boolean(await waitFor(() => {
          return String(document.getElementById('eventTicketId')?.value || '') === createdId &&
            String(document.getElementById('eventTicketTitle')?.value || '') === updatedTitle &&
            textIncludes('#eventTicketListItems', updatedTitle);
        }, 8000));
      }

      if (actual.created) {
        await withAutoConfirm(async () => {
          document.getElementById('deleteEventTicketButton')?.click();
          actual.deleted = Boolean(await waitFor(() => {
            return !String(document.getElementById('eventTicketId')?.value || '') && !textIncludes('#eventTicketListItems', updatedTitle);
          }, 15000));
        });
      }
      actual.cleaned = actual.deleted;
    } finally {
      if (!actual.deleted && createdId) {
        try {
          const row = document.querySelector('#eventTicketListItems [data-event-ticket-id="' + CSS.escape(createdId) + '"]');
          row?.click();
          await waitFor(() => String(document.getElementById('eventTicketId')?.value || '') === createdId, 3000);
          await withAutoConfirm(async () => {
            document.getElementById('deleteEventTicketButton')?.click();
            actual.cleaned = Boolean(await waitFor(() => !String(document.getElementById('eventTicketId')?.value || ''), 12000));
          });
        } catch {}
      }
      closeEditorModalById('eventTicketEditorModal');
    }

    const ok = actual.created && actual.updated && actual.deleted && actual.cleaned;
    return ok
      ? pass('已透過管理端 UI 完成活動票券新增、修改、刪除，QA 資料已清理。', { created: true, updated: true, deleted: true, cleaned: true }, actual)
      : fail('活動票券 CRUD E2E 至少一個階段失敗。', { created: true, updated: true, deleted: true, cleaned: true }, actual);
  }

  async function adminCalendarCrudCase() {
    const stamp = qaCrudStamp();
    const createdTitle = 'E2E 日曆 ' + stamp;
    const updatedTitle = createdTitle + ' 修改';
    const actual = { created: false, updated: false, deleted: false, cleaned: false };
    let createdId = '';

    document.getElementById('calendarTab')?.click();
    document.getElementById('newCalendarItemButton')?.click();
    const modal = await waitEditorOpen('calendarEditorModal');
    if (!modal) return fail('日曆新增編輯器未開啟。', { editorOpen: true }, { editorOpen: false });

    try {
      setField('calendarItemTitle', createdTitle);
      setField('calendarItemType', 'holiday');
      setField('calendarItemDescription', '管理端 CRUD E2E 測試日期');
      setField('calendarItemStatus', 'draft');
      const startInput = document.getElementById('calendarItemStartsOn');
      if (!startInput?.value) {
        const today = new Date();
        const local = new Date(today.getTime() - today.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
        setField('calendarItemStartsOn', local);
      }
      setField('calendarItemEndsOn', '');

      document.getElementById('saveCalendarItemButton')?.click();
      createdId = String(await waitFor(() => document.getElementById('calendarItemId')?.value || null, 15000) || '');
      actual.created = Boolean(createdId);

      if (actual.created) {
        setField('calendarItemTitle', updatedTitle);
        setField('calendarItemDescription', '管理端 CRUD E2E 已完成修改');
        document.getElementById('saveCalendarItemButton')?.click();
        actual.updated = Boolean(await waitFor(() => {
          return String(document.getElementById('calendarItemId')?.value || '') === createdId &&
            String(document.getElementById('calendarItemTitle')?.value || '') === updatedTitle;
        }, 15000));
      }

      if (actual.created) {
        await withAutoConfirm(async () => {
          document.getElementById('deleteCalendarItemButton')?.click();
          actual.deleted = Boolean(await waitFor(() => !String(document.getElementById('calendarItemId')?.value || ''), 15000));
        });
      }
      actual.cleaned = actual.deleted;
    } finally {
      if (!actual.deleted && createdId) {
        try {
          const itemButton = document.querySelector('#adminCalendarGrid [data-admin-calendar-item-id="' + CSS.escape(createdId) + '"]');
          itemButton?.click();
          await waitFor(() => String(document.getElementById('calendarItemId')?.value || '') === createdId, 3000);
          await withAutoConfirm(async () => {
            document.getElementById('deleteCalendarItemButton')?.click();
            actual.cleaned = Boolean(await waitFor(() => !String(document.getElementById('calendarItemId')?.value || ''), 12000));
          });
        } catch {}
      }
      closeEditorModalById('calendarEditorModal');
    }

    const ok = actual.created && actual.updated && actual.deleted && actual.cleaned;
    return ok
      ? pass('已透過管理端 UI 完成日曆項目新增、修改、刪除，QA 資料已清理。', { created: true, updated: true, deleted: true, cleaned: true }, actual)
      : fail('日曆 CRUD E2E 至少一個階段失敗。', { created: true, updated: true, deleted: true, cleaned: true }, actual);
  }

  async function adminBookingCrudCase() {
    const stamp = qaCrudStamp();
    const typeCreated = 'E2E類型' + stamp;
    const typeUpdated = typeCreated + '改';
    const serviceCreated = 'E2E預約' + stamp;
    const serviceUpdated = serviceCreated + '改';
    const actual = {
      typeCreated: false, typeUpdated: false, serviceCreated: false,
      serviceUpdated: false, serviceDeleted: false, typeDeleted: false, cleaned: false
    };

    const tab = await waitFor(() => document.getElementById('bookingTab'), 6000);
    if (!tab) return fail('預約管理分頁未載入。', { bookingTab: true }, { bookingTab: false });
    tab.click();
    document.getElementById('bookingAdminServicesSubtab')?.click();
    await waitFor(() => !document.getElementById('bookingAdminServicesPanel')?.classList.contains('hidden'), 4000);
    if (!await waitBookingAdminReady()) {
      return fail('預約管理資料尚未同步完成。', { bookingAdminReady: true }, { bookingAdminReady: false });
    }

    try {
      document.getElementById('bookingAdminNewTypeButton')?.click();
      let modal = await waitFor(() => {
        const node = document.getElementById('bookingAdminCrudModal');
        return node && !node.classList.contains('hidden') ? node : null;
      }, 4000);
      if (!modal) throw new Error('新增預約類型視窗未開啟。');
      const typeInput = modal.querySelector('[data-type-name]');
      if (!typeInput) throw new Error('預約類型名稱欄位不存在。');
      typeInput.value = typeCreated;
      typeInput.dispatchEvent(new Event('input', { bubbles: true }));
      modal.querySelector('form button[type="submit"]')?.click();
      actual.typeCreated = Boolean(await waitFor(() => findBookingRow('bookingAdminTypeList', typeCreated), 15000));

      if (actual.typeCreated && clickBookingRowAction('bookingAdminTypeList', typeCreated, '修改')) {
        modal = await waitFor(() => {
          const node = document.getElementById('bookingAdminCrudModal');
          return node && !node.classList.contains('hidden') ? node : null;
        }, 4000);
        const editInput = modal?.querySelector('[data-type-name]');
        if (editInput) {
          editInput.value = typeUpdated;
          editInput.dispatchEvent(new Event('input', { bubbles: true }));
          modal.querySelector('form button[type="submit"]')?.click();
          actual.typeUpdated = Boolean(await waitFor(() => findBookingRow('bookingAdminTypeList', typeUpdated), 15000));
        }
      }

      if (actual.typeUpdated) {
        document.getElementById('bookingAdminNewServiceButton')?.click();
        modal = await waitFor(() => {
          const node = document.getElementById('bookingAdminCrudModal');
          return node && !node.classList.contains('hidden') ? node : null;
        }, 4000);
        const form = modal?.querySelector('form');
        if (!form) throw new Error('新增預約項目表單未開啟。');
        const title = form.querySelector('[data-field="title"]');
        const type = form.querySelector('[data-field="serviceType"]');
        const duration = form.querySelector('[data-field="durationMinutes"]');
        const price = form.querySelector('[data-field="priceAmount"]');
        if (!title || !type || !duration || !price) throw new Error('預約項目表單欄位不完整。');
        title.value = serviceCreated;
        type.value = typeUpdated;
        duration.value = '35';
        price.value = '123';
        [title, type, duration, price].forEach((input) => input.dispatchEvent(new Event('change', { bubbles: true })));
        form.querySelector('button[type="submit"]')?.click();
        actual.serviceCreated = Boolean(await waitFor(() => findBookingRow('bookingAdminServiceList', serviceCreated), 15000));
      }

      if (actual.serviceCreated && clickBookingRowAction('bookingAdminServiceList', serviceCreated, '修改')) {
        modal = await waitFor(() => {
          const node = document.getElementById('bookingAdminCrudModal');
          return node && !node.classList.contains('hidden') ? node : null;
        }, 4000);
        const form = modal?.querySelector('form');
        const title = form?.querySelector('[data-field="title"]');
        const duration = form?.querySelector('[data-field="durationMinutes"]');
        if (title && duration) {
          title.value = serviceUpdated;
          duration.value = '40';
          title.dispatchEvent(new Event('input', { bubbles: true }));
          duration.dispatchEvent(new Event('change', { bubbles: true }));
          form.querySelector('button[type="submit"]')?.click();
          actual.serviceUpdated = Boolean(await waitFor(() => findBookingRow('bookingAdminServiceList', serviceUpdated), 15000));
        }
      }

      if (actual.serviceUpdated) {
        await withAutoConfirm(async () => {
          clickBookingRowAction('bookingAdminServiceList', serviceUpdated, '刪除');
          actual.serviceDeleted = Boolean(await waitFor(() => !findBookingRow('bookingAdminServiceList', serviceUpdated), 15000));
        });
      }

      if (actual.typeUpdated) {
        await withAutoConfirm(async () => {
          clickBookingRowAction('bookingAdminTypeList', typeUpdated, '刪除');
          actual.typeDeleted = Boolean(await waitFor(() => !findBookingRow('bookingAdminTypeList', typeUpdated), 15000));
        });
      }
      actual.cleaned = actual.serviceDeleted && actual.typeDeleted;
    } finally {
      document.getElementById('bookingAdminCrudModalClose')?.click();
      if (!actual.serviceDeleted) {
        for (const title of [serviceUpdated, serviceCreated]) {
          if (!findBookingRow('bookingAdminServiceList', title)) continue;
          try {
            await withAutoConfirm(async () => {
              clickBookingRowAction('bookingAdminServiceList', title, '刪除');
              await waitFor(() => !findBookingRow('bookingAdminServiceList', title), 12000);
            });
          } catch {}
        }
      }
      if (!actual.typeDeleted) {
        for (const title of [typeUpdated, typeCreated]) {
          if (!findBookingRow('bookingAdminTypeList', title)) continue;
          try {
            await withAutoConfirm(async () => {
              clickBookingRowAction('bookingAdminTypeList', title, '刪除');
              await waitFor(() => !findBookingRow('bookingAdminTypeList', title), 12000);
            });
          } catch {}
        }
      }
      actual.cleaned = !findBookingRow('bookingAdminServiceList', serviceUpdated) &&
        !findBookingRow('bookingAdminServiceList', serviceCreated) &&
        !findBookingRow('bookingAdminTypeList', typeUpdated) &&
        !findBookingRow('bookingAdminTypeList', typeCreated);
    }

    const ok = actual.typeCreated && actual.typeUpdated && actual.serviceCreated && actual.serviceUpdated &&
      actual.serviceDeleted && actual.typeDeleted && actual.cleaned;
    return ok
      ? pass('已透過管理端 UI 完成預約類型與預約項目的新增、修改、刪除，QA 資料已清理。', {
          typeCreated: true, typeUpdated: true, serviceCreated: true, serviceUpdated: true,
          serviceDeleted: true, typeDeleted: true, cleaned: true
        }, actual)
      : fail('預約 CRUD E2E 至少一個階段失敗。', {
          typeCreated: true, typeUpdated: true, serviceCreated: true, serviceUpdated: true,
          serviceDeleted: true, typeDeleted: true, cleaned: true
        }, actual);
  }


  async function adminBookingControlsCase() {
    const tab = await waitFor(() => document.getElementById('bookingTab'), 6000);
    if (!tab) return fail('預約管理分頁未載入。', { bookingTab: true }, { bookingTab: false });
    tab.click();
    const subtabs = [
      ['bookingAdminTechniciansSubtab', 'bookingAdminTechniciansPanel'],
      ['bookingAdminServicesSubtab', 'bookingAdminServicesPanel'],
      ['bookingAdminSettingsSubtab', 'bookingAdminSettingsPanel'],
      ['bookingAdminQueueSubtab', 'bookingAdminQueuePanel']
    ];
    const actual = {};
    for (const [id, panelId] of subtabs) {
      document.getElementById(id)?.click();
      actual[id] = Boolean(await waitFor(() => !document.getElementById(panelId)?.classList.contains('hidden'), 2500));
    }

    document.getElementById('bookingAdminServicesSubtab')?.click();
    for (const [key, buttonId] of [['newType', 'bookingAdminNewTypeButton'], ['newService', 'bookingAdminNewServiceButton']]) {
      document.getElementById(buttonId)?.click();
      const opened = Boolean(await waitFor(() => !document.getElementById('bookingAdminCrudModal')?.classList.contains('hidden'), 3000));
      actual[key] = opened;
      document.getElementById('bookingAdminCrudModalClose')?.click();
      await waitFor(() => document.getElementById('bookingAdminCrudModal')?.classList.contains('hidden'), 2500);
    }

    document.getElementById('bookingAdminQueueSubtab')?.click();
    actual.bookingQueueReady = Boolean(await waitFor(() => !document.getElementById('bookingAdminQueuePanel')?.classList.contains('hidden'), 4000));
    const statusTabs = [
      ['pending', () => document.querySelector('[data-booking-filter="pending"]'), false],
      ['confirmed', () => document.querySelector('[data-booking-filter="confirmed"]'), false],
      ['cancellationRequest', () => document.getElementById('bookingCancellationRequestFilter'), true],
      ['cancelled', () => document.getElementById('bookingCancelledFilter'), true],
      ['completed', () => document.querySelector('[data-booking-filter="completed"]'), false],
      ['all', () => document.querySelector('[data-booking-filter="all"]'), false]
    ];
    for (const [key, getButton, cancellationMode] of statusTabs) {
      const button = await waitFor(getButton, 6000);
      if (!button) {
        actual['status_' + key] = false;
        continue;
      }
      button.click();
      actual['status_' + key] = Boolean(await waitFor(() => {
        const coreQueue = document.getElementById('bookingAdminQueue');
        const review = document.getElementById('bookingCancellationReview');
        if (!button.classList.contains('active')) return false;
        if (cancellationMode) {
          return Boolean(review && !review.classList.contains('hidden') && coreQueue?.classList.contains('hidden'));
        }
        return Boolean(coreQueue && !coreQueue.classList.contains('hidden') && (!review || review.classList.contains('hidden')));
      }, 5000));
    }

    const ok = Object.values(actual).every(Boolean);
    return ok
      ? pass('預約管理四個子分頁、新增視窗與待確認／已確認／取消申請／已取消／已完成／全部六個狀態分頁皆可真人操作。', {
          allBookingControls: true,
          allBookingStatusTabs: true
        }, actual)
      : fail('至少一個預約管理控制或狀態分頁異常。', {
          allBookingControls: true,
          allBookingStatusTabs: true
        }, actual);
  }

  async function adminBookingBootstrapSnapshot() {
    const session = await adminSession();
    return postFunction('booking-api', {
      action: 'admin.booking.bootstrap',
      clientType: 'admin',
      idToken: session.idToken
    });
  }

  function bookingCreatedMs(booking) {
    const created = Date.parse(String(booking?.createdAt || ''));
    if (Number.isFinite(created)) return created;
    const updated = Date.parse(String(booking?.updatedAt || ''));
    return Number.isFinite(updated) ? updated : 0;
  }

  function pairedBookingCandidates(data, participant, options = {}) {
    const live = options?.live === true;
    const account = participant?.account || {};
    const memberCode = String(account.memberCode || '');
    const runStartedMs = Date.parse(String(state.runStartedAt || ''));
    const result = participant?.bookingResult;
    const handoff = result?.bookingHandoff;
    if (!account.memberId || !memberCode || !Number.isFinite(runStartedMs)) return [];

    let bookingIds = null;
    if (!live) {
      if (result?.account?.memberId !== account.memberId || handoff?.ready !== true
          || handoff.memberId !== account.memberId || !Array.isArray(handoff.bookingIds)) return [];
      bookingIds = new Set(handoff.bookingIds.map(String).filter(Boolean));
    } else if (handoff?.ready === true && handoff.memberId === account.memberId && Array.isArray(handoff.bookingIds)) {
      bookingIds = new Set(handoff.bookingIds.map(String).filter(Boolean));
    }

    return (Array.isArray(data?.bookings) ? data.bookings : [])
      .filter((booking) => !bookingIds || bookingIds.has(String(booking?.bookingId || '')))
      .filter((booking) => String(booking?.memberCode || '') === memberCode)
      .filter((booking) => String(booking?.memberId || '') === String(account.memberId))
      .filter((booking) => /^(?:QA HUMAN E2E(?: GROUP)? |QA STATE PACK |QA automated (?:group )?(?:create|update)$)/i.test(String(booking?.memberNote || '')))
      .filter((booking) => bookingCreatedMs(booking) >= runStartedMs - 2 * 60 * 1000)
      .slice()
      .sort((a, b) => bookingCreatedMs(b) - bookingCreatedMs(a));
  }

  function livePairedBookingSet(candidates) {
    const rows = Array.isArray(candidates) ? candidates : [];
    const mutable = rows.find((booking) =>
      /^QA HUMAN E2E GROUP /i.test(String(booking.memberNote || ''))
      && String(booking.status || '') === 'pending'
      && !(booking.cancellationRequestedAt && !booking.cancellationReviewedAt)
    ) || null;
    const rejectTarget = rows.find((booking) =>
      /^QA STATE PACK pending /i.test(String(booking.memberNote || ''))
      && String(booking.status || '') === 'pending'
      && !(booking.cancellationRequestedAt && !booking.cancellationReviewedAt)
      && String(booking.bookingId || '') !== String(mutable?.bookingId || '')
    ) || null;
    const cancellationTarget = rows.find((booking) =>
      /^QA STATE PACK cancel_requested /i.test(String(booking.memberNote || ''))
      && booking.cancellationRequestedAt && !booking.cancellationReviewedAt
      && ['pending', 'confirmed'].includes(String(booking.status || ''))
      && String(booking.bookingId || '') !== String(mutable?.bookingId || '')
      && String(booking.bookingId || '') !== String(rejectTarget?.bookingId || '')
    ) || null;
    return {
      mutable,
      rejectTarget,
      cancellationTarget,
      ready: Boolean(mutable && rejectTarget && cancellationTarget)
    };
  }

  async function waitForLivePairedBookingTarget(participant, targetKey = 'any', timeoutMs = PAIRED_BOOKING_LIVE_TIMEOUT_MS) {
    const deadline = Date.now() + Math.max(5000, Number(timeoutMs) || PAIRED_BOOKING_LIVE_TIMEOUT_MS);
    let candidates = [];
    let detected = livePairedBookingSet(candidates);
    while (Date.now() < deadline) {
      if (state.cancelled) return { booking: null, ...detected, candidates, stopped: true };
      const data = await adminBookingBootstrapSnapshot();
      candidates = pairedBookingCandidates(data, participant, { live: true });
      participant.liveBookingIds = [...new Set([
        ...(Array.isArray(participant.liveBookingIds) ? participant.liveBookingIds : []),
        ...candidates.map((booking) => String(booking?.bookingId || '')).filter(Boolean)
      ])];
      detected = livePairedBookingSet(candidates);
      const booking = targetKey === 'any' ? (candidates[0] || null) : (detected?.[targetKey] || null);
      if (booking) {
        participant.adminStatus = targetKey === 'any'
          ? '管理端已偵測本輪預約'
          : '依資料狀態執行管理員操作';
        renderParticipants();
        return { booking, ...detected, candidates, handoffReady: false };
      }
      const handoff = participant?.bookingResult?.bookingHandoff;
      if (handoff?.ready === true && handoff.memberId === participant?.account?.memberId) {
        return { booking: null, ...detected, candidates, handoffReady: true };
      }
      participant.adminStatus = candidates.length
        ? '已看到預約，等待對應管理動作資料'
        : '等待管理端出現本輪預約';
      renderParticipants();
      await sleep(300);
    }
    return { booking: null, ...detected, candidates, timedOut: true };
  }

  async function waitForLivePairedBookingSet(participant, timeoutMs = PAIRED_BOOKING_LIVE_TIMEOUT_MS) {
    const deadline = Date.now() + Math.max(5000, Number(timeoutMs) || PAIRED_BOOKING_LIVE_TIMEOUT_MS);
    let candidates = [];
    let detected = livePairedBookingSet(candidates);
    while (Date.now() < deadline) {
      if (state.cancelled) return { ...detected, candidates, stopped: true };
      const data = await adminBookingBootstrapSnapshot();
      candidates = pairedBookingCandidates(data, participant, { live: true });
      participant.liveBookingIds = [...new Set([
        ...(Array.isArray(participant.liveBookingIds) ? participant.liveBookingIds : []),
        ...candidates.map((booking) => String(booking?.bookingId || '')).filter(Boolean)
      ])];
      detected = livePairedBookingSet(candidates);
      if (detected.ready) return { ...detected, candidates, handoffReady: false };
      const handoff = participant?.bookingResult?.bookingHandoff;
      if (handoff?.ready === true && handoff.memberId === participant?.account?.memberId) {
        return { ...detected, candidates, handoffReady: true };
      }
      participant.adminStatus = candidates.length
        ? '已看到預約，等待可安全接手狀態'
        : '等待管理端出現本輪預約';
      renderParticipants();
      await sleep(350);
    }
    return { ...detected, candidates, timedOut: true };
  }

  async function waitForPairedBookingHandoff(participant, timeoutMs = PAIRED_BOOKING_LIVE_TIMEOUT_MS) {
    const deadline = Date.now() + Math.max(5000, Number(timeoutMs) || PAIRED_BOOKING_LIVE_TIMEOUT_MS);
    while (Date.now() < deadline) {
      if (state.cancelled) return null;
      const handoff = participant?.bookingResult?.bookingHandoff;
      if (handoff?.ready === true
          && handoff.memberId === participant?.account?.memberId
          && Array.isArray(handoff.bookingIds)) return handoff;
      await sleep(250);
    }
    return null;
  }

  async function waitAdminBookingSnapshot(bookingId, predicate, timeoutMs = 15000) {
    const deadline = Date.now() + Math.max(1000, Number(timeoutMs) || 15000);
    let last = null;
    while (Date.now() < deadline) {
      if (state.cancelled) return null;
      const data = await adminBookingBootstrapSnapshot();
      last = (Array.isArray(data?.bookings) ? data.bookings : []).find((booking) => String(booking?.bookingId || '') === String(bookingId || '')) || null;
      if (last && (!predicate || predicate(last))) return last;
      await sleep(750);
    }
    return last;
  }

  async function adminHumanPause(minMs = 90, maxMs = 260) {
    if (state.cancelled) throw new Error('E2E 已停止。');
    await sleep(randomInt(minMs, maxMs));
  }

  async function adminHumanClick(node, label = '控制項') {
    if (!node) throw new Error('找不到可操作的' + label + '。');
    if (node.disabled) throw new Error(label + '目前不可操作。');
    try { node.scrollIntoView?.({ block: 'center', inline: 'nearest', behavior: 'auto' }); } catch {}
    try { node.focus?.({ preventScroll: true }); } catch { try { node.focus?.(); } catch {} }
    await adminHumanPause(70, 220);
    node.click();
    await adminHumanPause(80, 260);
    return true;
  }

  async function adminHumanSelect(select, value, label = '下拉選單') {
    if (!select) throw new Error('找不到' + label + '。');
    try { select.scrollIntoView?.({ block: 'center', inline: 'nearest', behavior: 'auto' }); } catch {}
    try { select.focus?.({ preventScroll: true }); } catch { try { select.focus?.(); } catch {} }
    await adminHumanPause(60, 180);
    select.value = String(value ?? '');
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await adminHumanPause(80, 240);
    return true;
  }

  async function adminHumanTextInput(input, value, label = '文字欄位') {
    if (!input) return false;
    try { input.scrollIntoView?.({ block: 'center', inline: 'nearest', behavior: 'auto' }); } catch {}
    try { input.focus?.({ preventScroll: true }); } catch { try { input.focus?.(); } catch {} }
    await adminHumanPause(50, 150);
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const text = String(value || '');
    const chunks = text.match(/.{1,8}/g) || [''];
    for (const chunk of chunks) {
      input.value += chunk;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await adminHumanPause(18, 55);
    }
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await adminHumanPause(60, 180);
    return true;
  }

  async function openAdminBookingQueue(filter = 'pending') {
    const tab = await waitFor(() => document.getElementById('bookingTab'), 6000);
    if (!tab) throw new Error('預約管理分頁未載入。');
    await adminHumanClick(tab, '預約管理分頁');
    const queueSubtab = await waitFor(() => document.getElementById('bookingAdminQueueSubtab'), 6000);
    await adminHumanClick(queueSubtab, '用戶預約分頁');
    if (!await waitFor(() => !document.getElementById('bookingAdminQueuePanel')?.classList.contains('hidden'), 5000)) {
      throw new Error('用戶預約管理分頁未開啟。');
    }
    if (!await waitBookingAdminReady()) throw new Error('預約管理資料尚未同步完成。');
    const filterButton = await waitFor(() => document.querySelector('[data-booking-filter="' + filter + '"]'), 3000);
    await adminHumanClick(filterButton, '預約狀態篩選');
    await sleep(100);
    return true;
  }

  function bookingActionButton(card, label) {
    return Array.from(card?.querySelectorAll('button') || []).find((button) => String(button.textContent || '').trim() === label) || null;
  }


  async function verifyDetectedBookingInCoreFilter(bookingId, filter) {
    await openAdminBookingQueue(filter);
    const button = document.querySelector('[data-booking-filter="' + filter + '"]');
    const card = await waitFor(() => document.querySelector(
      '#bookingAdminQueue .booking-admin-booking[data-booking-id="' + CSS.escape(String(bookingId || '')) + '"]'
    ), 10000, 100);
    const review = document.getElementById('bookingCancellationReview');
    const actual = {
      bookingId: String(bookingId || ''),
      filter,
      buttonActive: Boolean(button?.classList.contains('active')),
      coreQueueVisible: Boolean(document.getElementById('bookingAdminQueue') && !document.getElementById('bookingAdminQueue').classList.contains('hidden')),
      cancellationReviewHidden: Boolean(!review || review.classList.contains('hidden')),
      bookingVisible: Boolean(card)
    };
    actual.ok = actual.buttonActive && actual.coreQueueVisible && actual.cancellationReviewHidden && actual.bookingVisible;
    return actual;
  }

  async function verifyDetectedBookingInCancellationFilter(bookingId, mode) {
    await openAdminBookingQueue('pending');
    const isCancelled = mode === 'cancelled';
    const buttonId = isCancelled ? 'bookingCancelledFilter' : 'bookingCancellationRequestFilter';
    const button = await waitFor(() => document.getElementById(buttonId), 8000, 100);
    if (!button) {
      return { bookingId: String(bookingId || ''), mode, buttonFound: false, ok: false };
    }
    await adminHumanClick(button, isCancelled ? '已取消分頁' : '取消申請分頁');
    const reviewVisible = Boolean(await waitFor(() => {
      const review = document.getElementById('bookingCancellationReview');
      const coreQueue = document.getElementById('bookingAdminQueue');
      return button.classList.contains('active')
        && review
        && !review.classList.contains('hidden')
        && coreQueue?.classList.contains('hidden');
    }, 6000, 100));
    const card = await waitFor(() => document.querySelector(
      '#bookingCancellationReviewList .booking-admin-booking[data-booking-id="' + CSS.escape(String(bookingId || '')) + '"]'
    ), 12000, 120);
    const actual = {
      bookingId: String(bookingId || ''),
      mode,
      buttonFound: true,
      buttonActive: Boolean(button.classList.contains('active')),
      reviewVisible,
      bookingVisible: Boolean(card)
    };
    actual.ok = actual.buttonActive && actual.reviewVisible && actual.bookingVisible;
    return actual;
  }

  async function mutateDetectedBooking(booking) {
    await openAdminBookingQueue(String(booking?.status || 'pending'));
    const bookingId = String(booking?.bookingId || '');
    let card = await waitFor(() => document.querySelector('#bookingAdminQueue .booking-admin-booking[data-booking-id="' + CSS.escape(bookingId) + '"]'), 8000, 100);
    if (!card) throw new Error('管理端找不到要修改的用戶端 E2E 預約。');

    const editButton = bookingActionButton(card, '修改此位項目') || bookingActionButton(card, '修改服務項目');
    if (!editButton) throw new Error('這筆預約沒有可供管理端 E2E 操作的修改項目按鈕。');
    await adminHumanClick(editButton, '修改此位項目');

    const modal = await waitFor(() => {
      const node = document.getElementById('bookingAdminCrudModal');
      return node && !node.classList.contains('hidden') ? node : null;
    }, 5000);
    if (!modal) throw new Error('管理端修改預約視窗未開啟。');
    const form = modal.querySelector('form');
    if (!form) throw new Error('管理端修改預約表單不存在。');

    const checked = form.querySelector('input[type="checkbox"]:checked');
    const quantity = checked?.closest('label')?.querySelector('select');
    if (!checked || !quantity) throw new Error('管理端修改預約沒有可調整的已選服務項目。');
    const beforeQuantity = Number(quantity.value || 1);
    const afterQuantity = beforeQuantity === 2 ? 1 : 2;
    const serviceId = String(checked.dataset?.bookingService || checked.value || '');
    const participantEditor = Boolean(form.querySelector('[data-participant-item-rows]'));
    await adminHumanSelect(quantity, String(afterQuantity), '服務數量');
    const beforeUpdatedAt = String(booking?.updatedAt || '');

    if (state.cancelled) throw new Error('E2E 已停止，未送出修改。');
    const submit = form.querySelector('button[type="submit"]');
    if (!submit || submit.disabled) throw new Error('修改預約送出按鈕尚未就緒。');
    await adminHumanClick(submit, '儲存預約項目');
    const closed = Boolean(await waitFor(() => document.getElementById('bookingAdminCrudModal')?.classList.contains('hidden'), 18000, 100));
    if (!closed) {
      const message = form.querySelector('[data-modal-message]')?.textContent || '';
      document.getElementById('bookingAdminCrudModalClose')?.click();
      throw new Error(message || '管理端修改預約送出後視窗未關閉。');
    }

    const updated = await waitAdminBookingSnapshot(bookingId, (row) => String(row.updatedAt || '') !== beforeUpdatedAt, 16000);
    let items = updated?.items || [];
    if (participantEditor && updated) {
      const session = await adminSession();
      const details = await postFunction('booking-group-details-api', {
        action: 'admin.booking.group.details', clientType: 'admin', idToken: session.idToken,
        bookingIds: [bookingId]
      });
      // The first edit button belongs to the first participant displayed by the UI.
      items = details?.bookingGroups?.[bookingId]?.participants?.[0]?.items || [];
    }
    const persistedQuantity = Number(items.find((item) => String(item.serviceId || '') === serviceId)?.quantity || 0);
    const updatedAtChanged = Boolean(updated && String(updated.updatedAt || '') !== beforeUpdatedAt);
    return {
      bookingId,
      serviceId,
      beforeQuantity,
      afterQuantity,
      persistedQuantity,
      updatedAtChanged,
      updatedAt: updated?.updatedAt || null,
      participantPosition: participantEditor ? 1 : null,
      ok: updatedAtChanged && persistedQuantity === afterQuantity
    };
  }


  async function detectedBookingGroupDetails(bookingId) {
    const id = String(bookingId || '');
    const session = await adminSession();
    const details = await postFunction('booking-group-details-api', {
      action: 'admin.booking.group.details',
      clientType: 'admin',
      idToken: session.idToken,
      bookingIds: [id]
    });
    return {
      group: details?.bookingGroups?.[id] || null,
      primaryTechnicianId: String(details?.primaryTechnicianId || '')
    };
  }

  async function mutateDetectedBookingTechnician(booking) {
    await openAdminBookingQueue(String(booking?.status || 'pending'));
    const bookingId = String(booking?.bookingId || '');
    const beforeDetails = await detectedBookingGroupDetails(bookingId);
    const participants = Array.isArray(beforeDetails.group?.participants) ? beforeDetails.group.participants : [];
    if (participants.length < 2) throw new Error('修改技師 E2E 需要至少兩位預約人，避免移除唯一主要技師。');

    const targetIndex = participants.findIndex((participant) => participant?.isPrimaryTechnician !== true);
    if (targetIndex < 0) throw new Error('找不到可安全修改的非主要技師預約人。');
    const targetBefore = participants[targetIndex];
    const targetPosition = Number(targetBefore?.position || targetIndex + 1);
    const currentTechnicianId = String(targetBefore?.technicianId || '');
    const otherTechnicianIds = new Set(participants
      .filter((_, index) => index !== targetIndex)
      .map((participant) => String(participant?.technicianId || ''))
      .filter(Boolean));

    const card = await waitFor(() => document.querySelector(
      '#bookingAdminQueue .booking-admin-booking[data-booking-id="' + CSS.escape(bookingId) + '"]'
    ), 8000, 100);
    if (!card) throw new Error('管理端找不到要修改技師的用戶端 E2E 預約。');
    const blocks = Array.from(card.querySelectorAll('.booking-group-admin-participant'));
    const targetBlock = blocks[targetIndex];
    const editButton = bookingActionButton(targetBlock, '修改此位技師');
    if (!editButton) throw new Error('這筆多人預約缺少「修改此位技師」操作。');
    await adminHumanClick(editButton, '修改此位技師');

    const modal = await waitFor(() => {
      const node = document.getElementById('bookingAdminCrudModal');
      return node && !node.classList.contains('hidden') ? node : null;
    }, 5000);
    if (!modal) throw new Error('管理端修改技師視窗未開啟。');
    const form = modal.querySelector('form');
    const select = form?.querySelector('[data-participant-technician]');
    if (!form || !select) throw new Error('管理端修改技師表單不完整。');

    const options = Array.from(select.options || []).filter((option) => {
      const value = String(option.value || '');
      return option.disabled !== true
        && value !== currentTechnicianId
        && (!value || !otherTechnicianIds.has(value));
    });
    const replacement = currentTechnicianId
      ? (options.find((option) => String(option.value || '') === '') || options[0])
      : options.find((option) => String(option.value || '') !== '');
    if (!replacement) {
      document.getElementById('bookingAdminCrudModalClose')?.click();
      throw new Error('目前沒有可安全切換且不重複的替代技師。');
    }

    const nextTechnicianId = String(replacement.value || '');
    await adminHumanSelect(select, nextTechnicianId, '預約技師');
    const beforeUpdatedAt = String(booking?.updatedAt || '');
    if (state.cancelled) throw new Error('E2E 已停止，未送出技師修改。');
    const submit = form.querySelector('button[type="submit"]');
    if (!submit || submit.disabled) throw new Error('修改技師送出按鈕尚未就緒。');
    await adminHumanClick(submit, '儲存預約技師');

    const closed = Boolean(await waitFor(
      () => document.getElementById('bookingAdminCrudModal')?.classList.contains('hidden'),
      18000,
      100
    ));
    if (!closed) {
      const message = form.querySelector('[data-modal-message]')?.textContent || '';
      document.getElementById('bookingAdminCrudModalClose')?.click();
      throw new Error(message || '管理端修改技師送出後視窗未關閉。');
    }

    const updated = await waitAdminBookingSnapshot(
      bookingId,
      (row) => String(row.updatedAt || '') !== beforeUpdatedAt,
      16000
    );
    const afterDetails = await detectedBookingGroupDetails(bookingId);
    const afterParticipants = Array.isArray(afterDetails.group?.participants) ? afterDetails.group.participants : [];
    const targetAfter = afterParticipants.find((participant) => Number(participant?.position || 0) === targetPosition)
      || afterParticipants[targetIndex]
      || null;
    const persistedTechnicianId = String(targetAfter?.technicianId || '');
    const updatedAtChanged = Boolean(updated && String(updated.updatedAt || '') !== beforeUpdatedAt);
    return {
      bookingId,
      participantPosition: targetPosition,
      beforeTechnicianId: currentTechnicianId,
      afterTechnicianId: nextTechnicianId,
      persistedTechnicianId,
      primaryTechnicianId: beforeDetails.primaryTechnicianId,
      updatedAtChanged,
      updatedAt: updated?.updatedAt || null,
      ok: updatedAtChanged && persistedTechnicianId === nextTechnicianId
    };
  }

  async function setDetectedBookingStatus(bookingId, label, adminNote, expectedStatus, sourceFilter = 'pending') {
    await openAdminBookingQueue(sourceFilter);
    const card = await waitFor(() => document.querySelector('#bookingAdminQueue .booking-admin-booking[data-booking-id="' + CSS.escape(String(bookingId || '')) + '"]'), 9000, 100);
    if (!card) throw new Error('管理端找不到待審核的用戶端 E2E 預約。');
    const textarea = card.querySelector('.booking-admin-note-field textarea');
    if (textarea) await adminHumanTextInput(textarea, String(adminNote || ''), '管理端說明');
    const action = bookingActionButton(card, label);
    if (!action) throw new Error('管理端預約缺少「' + label + '」操作。');
    if (!await waitFor(() => !action.disabled, 5000)) throw new Error('管理端預約操作尚未就緒。');
    if (state.cancelled) throw new Error('E2E 已停止，未送出狀態變更。');
    if (expectedStatus === 'completed') {
      await withAutoConfirm(async () => { await adminHumanClick(action, label); });
    } else {
      await adminHumanClick(action, label);
    }
    const updated = await waitAdminBookingSnapshot(bookingId, (row) => String(row.status || '') === expectedStatus, 18000);
    return {
      bookingId: String(bookingId || ''),
      expectedStatus,
      actualStatus: String(updated?.status || ''),
      adminNote: String(updated?.adminNote || ''),
      updatedAt: updated?.updatedAt || null,
      ok: Boolean(updated && String(updated.status || '') === expectedStatus)
    };
  }

  async function reviewDetectedCancellation(bookingId, decision) {
    await openAdminBookingQueue('pending');
    const id = String(bookingId || '');
    const requestFilter = await waitFor(() => document.getElementById('bookingCancellationRequestFilter'), 8000, 100);
    if (!requestFilter) throw new Error('取消申請審核分頁未載入。');
    requestFilter.click();
    const card = await waitFor(() => document.querySelector(
      '#bookingCancellationReviewList .booking-admin-booking[data-booking-id="' + CSS.escape(id) + '"]'
    ), 10000, 100);
    if (!card) throw new Error('管理端取消申請分頁找不到用戶端 E2E 預約。');

    const keeping = decision === 'rejected';
    const actionKey = keeping ? 'reject-cancellation' : 'approve-cancellation';
    const label = keeping ? '保留預約' : '確認取消';
    const action = card.querySelector('[data-booking-admin-action="' + actionKey + '"]') || bookingActionButton(card, label);
    if (!action) throw new Error('取消申請缺少「' + label + '」審核操作。');
    const before = await waitAdminBookingSnapshot(id);
    const sourceStatus = String(before?.status || '');
    if (!['pending', 'confirmed'].includes(sourceStatus)) {
      throw new Error('取消申請來源狀態不是可審核的 pending / confirmed。');
    }
    if (state.cancelled) throw new Error('E2E 已停止，未送出取消審核。');

    await withAutoConfirm(async () => { await adminHumanClick(action, label); });
    const reviewed = await waitAdminBookingSnapshot(id, (row) => {
      if (!row?.cancellationReviewedAt || String(row.cancellationDecision || '') !== decision) return false;
      if (keeping) {
        return !row.cancellationRequestedAt && String(row.status || '') === sourceStatus;
      }
      return String(row.status || '') === 'cancelled';
    }, 18000);

    return {
      bookingId: id,
      decision,
      sourceStatus,
      status: String(reviewed?.status || ''),
      cancellationRequestedAt: reviewed?.cancellationRequestedAt || null,
      cancellationReviewedAt: reviewed?.cancellationReviewedAt || null,
      cancellationDecision: reviewed?.cancellationDecision || null,
      cancelledAt: reviewed?.cancelledAt || null,
      ok: Boolean(reviewed
        && String(reviewed.cancellationDecision || '') === decision
        && (keeping
          ? !reviewed.cancellationRequestedAt && String(reviewed.status || '') === sourceStatus
          : String(reviewed.status || '') === 'cancelled'))
    };
  }

  async function approveDetectedCancellation(bookingId) {
    return reviewDetectedCancellation(bookingId, 'approved');
  }

  async function rejectDetectedCancellation(bookingId) {
    return reviewDetectedCancellation(bookingId, 'rejected');
  }

  async function requestDetectedCancellationFromClient(participant, bookingId) {
    const id = String(bookingId || '');
    let child = participant?.window;
    if (!child || child.closed) throw new Error('預約用戶端視窗已關閉，無法再次提出取消申請。');
    if (participant.lastSurfaceKey !== 'booking' || child.MemberUserTestControl?.surface !== 'booking') {
      const login = await createPairedSession(participant.account, 'booking');
      participant.login = login;
      participant.lastSurfaceKey = 'booking';
      seedParticipantSession(participant, login);
      child = await waitParticipantSurface(participant, 'booking', 'bookingView');
    }
    const card = await waitFor(() => child.document.querySelector(
      '#bookingList .booking-item[data-booking-id="' + CSS.escape(id) + '"]'
    ), 8000, 100);
    if (!card) throw new Error('預約用戶端找不到要再次取消的預約卡片。');
    const cancelButton = Array.from(card.querySelectorAll('button'))
      .find((button) => String(button.textContent || '').trim() === '申請取消');
    if (!cancelButton) throw new Error('預約用戶端沒有可操作的「申請取消」按鈕。');

    try { cancelButton.scrollIntoView?.({ block: 'center', inline: 'nearest', behavior: 'auto' }); } catch {}
    try { cancelButton.focus?.({ preventScroll: true }); } catch { try { cancelButton.focus?.(); } catch {} }
    await adminHumanPause(80, 240);
    const originalConfirm = child.confirm;
    try {
      child.confirm = () => true;
      cancelButton.click();
    } finally {
      child.confirm = originalConfirm;
    }

    const clientPending = Boolean(await waitFor(() => {
      const snapshot = child.MemberClientQaHooks?.getBookingSnapshot?.(id);
      const badge = child.document.querySelector(
        '#bookingList .booking-item[data-booking-id="' + CSS.escape(id) + '"] .status-badge'
      );
      return snapshot?.cancellationRequestedAt
        && !snapshot?.cancellationReviewedAt
        && badge?.classList.contains('status-cancel_requested');
    }, 12000, 120));
    const requested = await waitAdminBookingSnapshot(
      id,
      (row) => Boolean(row?.cancellationRequestedAt) && !row?.cancellationReviewedAt,
      18000
    );
    return {
      bookingId: id,
      status: String(requested?.status || ''),
      cancellationRequestedAt: requested?.cancellationRequestedAt || null,
      cancellationReviewedAt: requested?.cancellationReviewedAt || null,
      clientPending,
      humanUiAction: true,
      ok: Boolean(clientPending && requested?.cancellationRequestedAt && !requested?.cancellationReviewedAt)
    };
  }

  async function cancelDetectedBooking(booking) {
    const bookingId = String(booking?.bookingId || '');
    if (booking?.cancellationRequestedAt && !booking?.cancellationReviewedAt) {
      return approveDetectedCancellation(bookingId);
    }

    let confirmed = null;
    const startingStatus = String(booking?.status || '');
    if (startingStatus === 'pending') {
      confirmed = await setDetectedBookingStatus(
        bookingId,
        '確認預約',
        'QA ADMIN E2E PREPARE CANCEL ' + qaCrudStamp(),
        'confirmed',
        'pending'
      );
      if (!confirmed.ok) return { bookingId, mode: 'direct', confirmed, cancelled: null, ok: false };
    } else if (startingStatus !== 'confirmed') {
      return { bookingId, mode: 'direct', startingStatus, confirmed: null, cancelled: null, ok: false };
    }

    const cancelled = await setDetectedBookingStatus(
      bookingId,
      '取消預約',
      'QA ADMIN E2E CANCEL ' + qaCrudStamp(),
      'cancelled',
      'confirmed'
    );
    return {
      bookingId,
      mode: 'direct',
      confirmed,
      cancelled,
      ok: Boolean(cancelled?.ok)
    };
  }



  async function ensureBookingRealtimeClient(participant) {
    let child = participant?.window;
    if (!child || child.closed) throw new Error('預約用戶端視窗已關閉，無法驗證 Realtime。');
    if (participant.lastSurfaceKey !== 'booking' || child.MemberUserTestControl?.surface !== 'booking') {
      const login = await createPairedSession(participant.account, 'booking');
      participant.login = login;
      participant.lastSurfaceKey = 'booking';
      seedParticipantSession(participant, login);
      child = await waitParticipantSurface(participant, 'booking', 'bookingView');
    }
    const hooks = child.MemberClientQaHooks;
    if (hooks?.surface !== 'booking'
      || typeof hooks.getRenderCount !== 'function'
      || typeof hooks.getBookingSnapshot !== 'function') {
      throw new Error('預約用戶端 Realtime QA probe 尚未就緒。');
    }
    return { child, hooks };
  }

  async function beginBookingRealtimeProbe(participant, bookingId) {
    const { child, hooks } = await ensureBookingRealtimeClient(participant);
    const id = String(bookingId || '');
    return {
      bookingId: id,
      beforeRenderCount: Number(hooks.getRenderCount() || 0),
      beforeSnapshot: safe(hooks.getBookingSnapshot(id)),
      clientUrl: String(child.location?.href || '')
    };
  }

  function memberBookingItems(snapshot, participantPosition = null) {
    if (participantPosition && Array.isArray(snapshot?.participants)) {
      const participant = snapshot.participants.find((item, index) =>
        Number(item?.position || index + 1) === Number(participantPosition)
      );
      if (participant) return Array.isArray(participant.items) ? participant.items : [];
    }
    return Array.isArray(snapshot?.items) ? snapshot.items : [];
  }

  function memberBookingQuantity(snapshot, serviceId, participantPosition = null) {
    const item = memberBookingItems(snapshot, participantPosition)
      .find((row) => String(row?.serviceId || '') === String(serviceId || ''));
    return Number(item?.quantity || 0);
  }

  function memberBookingTechnician(snapshot, participantPosition) {
    const participants = Array.isArray(snapshot?.participants) ? snapshot.participants : [];
    const participant = participants.find((item, index) =>
      Number(item?.position || index + 1) === Number(participantPosition)
    );
    return String(participant?.technicianId || '');
  }

  function memberDisplayStatus(snapshot) {
    return snapshot?.cancellationRequestedAt && !snapshot?.cancellationReviewedAt
      ? 'cancel_requested'
      : String(snapshot?.status || '');
  }

  async function verifyBookingRealtimeSync(participant, probe, validator, expectedDisplayStatus = '', timeoutMs = 15000) {
    const { child, hooks } = await ensureBookingRealtimeClient(participant);
    const started = performance.now();
    let latest = null;
    const synchronized = Boolean(await waitFor(() => {
      const renderCount = Number(hooks.getRenderCount() || 0);
      const snapshot = hooks.getBookingSnapshot(probe.bookingId);
      const card = child.document.querySelector(
        '#bookingList .booking-item[data-booking-id="' + CSS.escape(probe.bookingId) + '"]'
      );
      const displayStatus = memberDisplayStatus(snapshot);
      const badgeMatches = !expectedDisplayStatus
        || Boolean(card?.querySelector('.status-badge')?.classList.contains('status-' + expectedDisplayStatus));
      let dataMatches = false;
      try { dataMatches = Boolean(snapshot && validator(snapshot)); } catch { dataMatches = false; }
      latest = {
        renderCount,
        renderAdvanced: renderCount > Number(probe.beforeRenderCount || 0),
        displayStatus,
        badgeMatches,
        dataMatches,
        snapshot: safe(snapshot)
      };
      return latest.renderAdvanced && latest.badgeMatches && latest.dataMatches ? true : null;
    }, timeoutMs, 120));
    return {
      bookingId: probe.bookingId,
      beforeRenderCount: probe.beforeRenderCount,
      afterRenderCount: Number(latest?.renderCount || 0),
      renderAdvanced: Boolean(latest?.renderAdvanced),
      expectedDisplayStatus: expectedDisplayStatus || null,
      actualDisplayStatus: latest?.displayStatus || null,
      badgeMatches: Boolean(latest?.badgeMatches),
      dataMatches: Boolean(latest?.dataMatches),
      elapsedMs: Math.max(0, Math.round(performance.now() - started)),
      manualRefreshUsed: false,
      ok: synchronized
    };
  }

  function bookingTerminalSnapshot(bookings, bookingIds, memberId) {
    const ids = [...new Set((bookingIds || []).map(String).filter(Boolean))];
    const byId = new Map((Array.isArray(bookings) ? bookings : [])
      .filter((row) => String(row.memberId || '') === String(memberId || ''))
      .map((row) => [String(row.bookingId || ''), row]));
    const missingIds = ids.filter((id) => !byId.has(id));
    const unresolved = ids.map((id) => byId.get(id)).filter(Boolean)
      .filter((row) => !['completed', 'cancelled', 'rejected'].includes(row.status)
        || (row.cancellationRequestedAt && !row.cancellationReviewedAt))
      .map((row) => ({ bookingId: row.bookingId, status: row.status, cancellationPending: Boolean(row.cancellationRequestedAt && !row.cancellationReviewedAt) }));
    return { total: ids.length, missingIds, unresolved, ok: ids.length > 0 && !missingIds.length && !unresolved.length };
  }

  async function finishRemainingBooking(booking) {
    const bookingId = String(booking.bookingId || '');
    const current = await waitAdminBookingSnapshot(bookingId);
    if (!current || current.memberId !== booking.memberId) return { bookingId, ok: false, reason: 'booking-missing-or-owner-changed' };
    if (state.cancelled) return { bookingId, ok: false, reason: 'stopped' };
    if (current.cancellationRequestedAt && !current.cancellationReviewedAt) return cancelDetectedBooking(current);
    if (['completed', 'cancelled', 'rejected'].includes(current.status)) return { bookingId, status: current.status, alreadyTerminal: true, ok: true };
    let confirmed = null;
    if (current.status === 'pending') {
      confirmed = await setDetectedBookingStatus(bookingId, '確認預約', 'QA ADMIN E2E CONFIRM ' + qaCrudStamp(), 'confirmed', 'pending');
      if (!confirmed.ok) return { bookingId, confirmed, ok: false };
    } else if (current.status !== 'confirmed') return { bookingId, status: current.status, ok: false };
    if (state.cancelled) return { bookingId, confirmed, ok: false, reason: 'stopped' };
    const completed = await setDetectedBookingStatus(bookingId, '確認服務完成', 'QA ADMIN E2E COMPLETE ' + qaCrudStamp(), 'completed', 'confirmed');
    return { bookingId, confirmed, completed, ok: completed.ok };
  }

  async function verifyBookingClientTerminal(participant, bookingIds) {
    if (state.cancelled) return { ok: false, stopped: true };
    let child = participant.window;
    if (!child || child.closed) throw new Error('預約用戶端視窗已關閉，無法驗證終態。');
    if (participant.lastSurfaceKey !== 'booking' || child.MemberUserTestControl?.surface !== 'booking') {
      const login = await createPairedSession(participant.account, 'booking');
      participant.login = login;
      participant.lastSurfaceKey = 'booking';
      seedParticipantSession(participant, login);
      child = await waitParticipantSurface(participant, 'booking', 'bookingView');
    }
    if (typeof child.MemberClientQaHooks?.refresh !== 'function') throw new Error('預約用戶端同步入口尚未就緒。');
    await child.MemberClientQaHooks.refresh();
    const config = await child.BookingSystem.loadConfig();
    const data = await child.BookingSystem.request(config, 'member', '', 'user.booking.bootstrap', {});
    const snapshot = bookingTerminalSnapshot(data?.bookings, bookingIds, participant.account.memberId);
    const uiSynchronized = snapshot.ok && Boolean(await waitFor(() => bookingIds.every((id) => {
      const row = data.bookings.find((item) => String(item.bookingId) === id);
      const card = child.document.querySelector('#bookingList .booking-item[data-booking-id="' + CSS.escape(id) + '"]');
      return card?.querySelector('.status-badge')?.classList.contains('status-' + row.status);
    }), 10000, 150));
    return { ...snapshot, refreshed: true, uiSynchronized, ok: snapshot.ok && uiSynchronized };
  }

  async function verifyPairedBookingTerminalState(participant) {
    const handoff = participant.bookingResult?.bookingHandoff;
    if (handoff?.ready !== true || handoff.memberId !== participant.account?.memberId || !Array.isArray(handoff.bookingIds)) {
      return { ok: false, reason: 'complete-handoff-required' };
    }
    const data = await adminBookingBootstrapSnapshot();
    const admin = bookingTerminalSnapshot(data?.bookings, handoff.bookingIds, participant.account.memberId);
    const client = admin.ok ? await verifyBookingClientTerminal(participant, handoff.bookingIds) : { ok: false, checked: false };
    return { admin, client, ok: admin.ok && client.ok };
  }

  async function pairedAdminBookingFollowupCase(participant) {
    const account = participant?.account || {};
    const liveSet = await waitForLivePairedBookingTarget(participant, 'any');
    let candidates = Array.isArray(liveSet?.candidates) ? liveSet.candidates : [];
    let mutable = liveSet?.mutable || null;
    let cancellationTarget = liveSet?.cancellationTarget || null;
    let rejectTarget = liveSet?.rejectTarget || null;

    // Backward-compatible fallback is allowed only after the user's complete handoff exists.
    // Before handoff, live processing is restricted to explicit QA state markers to avoid
    // racing the member's still-running single-booking edit/cancel flow.
    if (liveSet?.handoffReady) {
      mutable = mutable || candidates.find((booking) =>
        /^QA HUMAN E2E GROUP /i.test(String(booking.memberNote || ''))
        && String(booking.status || '') === 'pending'
        && !(booking.cancellationRequestedAt && !booking.cancellationReviewedAt)
      ) || candidates.find((booking) =>
        String(booking.status || '') === 'pending'
        && !(booking.cancellationRequestedAt && !booking.cancellationReviewedAt)
      );
      cancellationTarget = cancellationTarget || candidates.find((booking) =>
        String(booking.bookingId || '') !== String(mutable?.bookingId || '')
        && booking.cancellationRequestedAt && !booking.cancellationReviewedAt
        && ['pending', 'confirmed'].includes(String(booking.status || ''))
      );
      rejectTarget = rejectTarget || candidates.find((booking) =>
        String(booking.bookingId || '') !== String(mutable?.bookingId || '')
        && String(booking.bookingId || '') !== String(cancellationTarget?.bookingId || '')
        && String(booking.status || '') === 'pending'
        && !(booking.cancellationRequestedAt && !booking.cancellationReviewedAt)
      );
    }

    participant.adminStatus = liveSet?.booking
      ? '管理端已看到資料，開始模擬管理員'
      : liveSet?.handoffReady
        ? '用戶端完成，接手現有預約'
        : '預約監看逾時';
    renderParticipants();

    const actual = {
      memberCode: account.memberCode || null,
      detectedCount: candidates.length,
      detectedBookings: candidates.map((booking) => ({
        bookingId: booking.bookingId,
        status: booking.status,
        memberNote: booking.memberNote || '',
        cancellationPending: Boolean(booking.cancellationRequestedAt && !booking.cancellationReviewedAt)
      })),
      statusTabs: {},
      confirmed: null,
      modified: null,
      modifiedTechnician: null,
      completed: null,
      rejected: null,
      keptCancellation: null,
      cancellationRerequest: null,
      cancelled: null,
      realtime: {},
      remainingProcessed: [],
      terminal: null,
      riskScan: null,
      liveWatcher: {
        startedBeforeClientCompletion: !liveSet?.handoffReady,
        readyFromAdminData: Boolean(liveSet?.booking),
        timedOut: Boolean(liveSet?.timedOut),
        liveBookingIds: Array.isArray(participant.liveBookingIds) ? participant.liveBookingIds.slice() : []
      },
      handoffReady: false
    };
    const expected = {
      detectedFromUserE2E: true,
      confirmed: true,
      modifiedItems: true,
      modifiedTechnician: true,
      completed: true,
      rejected: true,
      cancellationKept: true,
      cancellationApproved: true,
      allStatusTabs: true,
      realtimeEveryAdminAction: true,
      riskScanPassed: true,
      recordsPreserved: true
    };
    const prefix = 'PAIRED_' + participant.index + '_ADMIN_BOOKING_';

    const updateDetectedSnapshot = () => {
      actual.detectedCount = candidates.length;
      actual.detectedBookings = candidates.map((booking) => ({
        bookingId: booking.bookingId,
        status: booking.status,
        memberNote: booking.memberNote || '',
        cancellationPending: Boolean(booking.cancellationRequestedAt && !booking.cancellationReviewedAt)
      }));
      actual.liveWatcher.liveBookingIds = Array.isArray(participant.liveBookingIds)
        ? participant.liveBookingIds.slice()
        : [];
    };

    const acquireLiveTarget = async (targetKey) => {
      const found = await waitForLivePairedBookingTarget(participant, targetKey);
      if (Array.isArray(found?.candidates) && found.candidates.length) {
        candidates = found.candidates;
        updateDetectedSnapshot();
      }
      if (found?.booking) return found.booking;
      if (found?.handoffReady) {
        const strictData = await adminBookingBootstrapSnapshot();
        const strictCandidates = pairedBookingCandidates(strictData, participant);
        if (strictCandidates.length) {
          candidates = strictCandidates;
          updateDetectedSnapshot();
        }
        const set = livePairedBookingSet(candidates);
        if (set?.[targetKey]) return set[targetKey];
        if (targetKey === 'mutable') {
          return candidates.find((booking) =>
            String(booking.status || '') === 'pending'
            && !(booking.cancellationRequestedAt && !booking.cancellationReviewedAt)
          ) || null;
        }
        if (targetKey === 'cancellationTarget') {
          return candidates.find((booking) =>
            String(booking.bookingId || '') !== String(mutable?.bookingId || '')
            && booking.cancellationRequestedAt && !booking.cancellationReviewedAt
            && ['pending', 'confirmed'].includes(String(booking.status || ''))
          ) || null;
        }
        if (targetKey === 'rejectTarget') {
          return candidates.find((booking) =>
            String(booking.bookingId || '') !== String(mutable?.bookingId || '')
            && String(booking.bookingId || '') !== String(cancellationTarget?.bookingId || '')
            && String(booking.status || '') === 'pending'
            && !(booking.cancellationRequestedAt && !booking.cancellationReviewedAt)
          ) || null;
        }
      }
      return null;
    };

    await executeCases([
      caseDef(prefix + 'REJECT', '預約：不通過', 'Booking / Reject', async () => {
        rejectTarget = rejectTarget || await acquireLiveTarget('rejectTarget');
        if (!rejectTarget) {
          return fail('本輪缺少可供「不通過」的獨立待確認預約；不可重用完成流程的同一筆資料。', {
            separatePendingBooking: true
          }, actual.detectedBookings);
        }
        actual.statusTabs.rejectPending = await verifyDetectedBookingInCoreFilter(rejectTarget.bookingId, 'pending');
        const realtimeProbe = await beginBookingRealtimeProbe(participant, rejectTarget.bookingId);
        actual.rejected = await setDetectedBookingStatus(
          rejectTarget.bookingId,
          '不通過',
          'QA ADMIN E2E REJECT ' + qaCrudStamp(),
          'rejected',
          'pending'
        );
        if (actual.rejected.ok) {
          actual.realtime.rejected = await verifyBookingRealtimeSync(
            participant,
            realtimeProbe,
            (snapshot) => String(snapshot.status || '') === 'rejected',
            'rejected'
          );
          actual.statusTabs.allRejected = await verifyDetectedBookingInCoreFilter(rejectTarget.bookingId, 'all');
        }
        const detail = {
          ...actual.rejected,
          pendingTab: actual.statusTabs.rejectPending,
          allTab: actual.statusTabs.allRejected,
          realtimeSync: actual.realtime.rejected
        };
        return actual.rejected.ok && detail.pendingTab?.ok && detail.allTab?.ok && detail.realtimeSync?.ok
          ? pass('已像真人點擊「不通過」，且用戶端 Realtime 自動更新為未通過。', { status: 'rejected', realtime: true }, detail)
          : fail('不通過操作、全部分頁或用戶端 Realtime 同步失敗。', { status: 'rejected', realtime: true }, detail);
      }),

      caseDef(prefix + 'KEEP_CANCELLATION', '預約：保留預約', 'Booking / Cancellation Keep', async () => {
        cancellationTarget = cancellationTarget || await acquireLiveTarget('cancellationTarget');
        if (!cancellationTarget) {
          return fail('本輪沒有可供審核的取消申請。', { cancellationRequestDetected: true }, actual.detectedBookings);
        }
        actual.statusTabs.cancellationRequestKeep = await verifyDetectedBookingInCancellationFilter(cancellationTarget.bookingId, 'request');
        const realtimeProbe = await beginBookingRealtimeProbe(participant, cancellationTarget.bookingId);
        actual.keptCancellation = await rejectDetectedCancellation(cancellationTarget.bookingId);
        if (actual.keptCancellation.ok) {
          actual.realtime.keptCancellation = await verifyBookingRealtimeSync(
            participant,
            realtimeProbe,
            (snapshot) => String(snapshot.status || '') === String(actual.keptCancellation.sourceStatus || '')
              && !snapshot.cancellationRequestedAt,
            String(actual.keptCancellation.sourceStatus || '')
          );
          actual.statusTabs.keptSource = await verifyDetectedBookingInCoreFilter(
            cancellationTarget.bookingId,
            actual.keptCancellation.sourceStatus
          );
        }
        const detail = {
          ...actual.keptCancellation,
          requestTab: actual.statusTabs.cancellationRequestKeep,
          sourceTab: actual.statusTabs.keptSource,
          realtimeSync: actual.realtime.keptCancellation
        };
        return actual.keptCancellation.ok && detail.requestTab?.ok && detail.sourceTab?.ok && detail.realtimeSync?.ok
          ? pass('已像真人點擊「保留預約」，且用戶端 Realtime 自動移除取消待確認狀態。', {
              decision: 'rejected', cancellationPending: false, realtime: true
            }, detail)
          : fail('保留預約、狀態回讀或用戶端 Realtime 同步失敗。', {
              decision: 'rejected', cancellationPending: false, realtime: true
            }, detail);
      }),

      caseDef(prefix + 'CONFIRM', '預約：確認預約', 'Booking / Confirm', async () => {
        mutable = mutable || await acquireLiveTarget('mutable');
        if (!mutable) return fail('本輪用戶端未留下可確認的預約。', { mutablePendingBooking: true }, actual.detectedBookings);
        actual.statusTabs.pending = await verifyDetectedBookingInCoreFilter(mutable.bookingId, 'pending');
        const realtimeProbe = await beginBookingRealtimeProbe(participant, mutable.bookingId);
        actual.confirmed = await setDetectedBookingStatus(
          mutable.bookingId,
          '確認預約',
          'QA ADMIN E2E CONFIRM ' + qaCrudStamp(),
          'confirmed',
          'pending'
        );
        if (actual.confirmed.ok) {
          actual.realtime.confirmed = await verifyBookingRealtimeSync(
            participant,
            realtimeProbe,
            (snapshot) => String(snapshot.status || '') === 'confirmed',
            'confirmed'
          );
          actual.statusTabs.confirmed = await verifyDetectedBookingInCoreFilter(mutable.bookingId, 'confirmed');
        }
        const detail = {
          ...actual.confirmed,
          pendingTab: actual.statusTabs.pending,
          confirmedTab: actual.statusTabs.confirmed,
          realtimeSync: actual.realtime.confirmed
        };
        return actual.confirmed.ok && detail.pendingTab?.ok && detail.confirmedTab?.ok && detail.realtimeSync?.ok
          ? pass('已像真人點擊「確認預約」，且用戶端未手動重新整理就由 Realtime 更新為已確認。', { status: 'confirmed', realtime: true }, detail)
          : fail('確認預約、狀態分頁或用戶端 Realtime 同步失敗。', { status: 'confirmed', realtime: true }, detail);
      }),

      caseDef(prefix + 'MODIFY', '預約：修改此位項目', 'Booking / Modify Items', async () => {
        if (!actual.confirmed?.ok) return fail('確認步驟未成功，未送出項目修改。', { confirmed: true }, { dependencyFailed: 'CONFIRM' });
        const current = await waitAdminBookingSnapshot(mutable.bookingId, (row) => row.status === 'confirmed');
        if (!current || current.status !== 'confirmed') return fail('修改項目前預約狀態已改變。', { status: 'confirmed' }, { status: current?.status });
        const realtimeProbe = await beginBookingRealtimeProbe(participant, mutable.bookingId);
        actual.modified = await mutateDetectedBooking(current);
        if (actual.modified.ok) {
          actual.realtime.modifiedItems = await verifyBookingRealtimeSync(
            participant,
            realtimeProbe,
            (snapshot) => memberBookingQuantity(
              snapshot,
              actual.modified.serviceId,
              actual.modified.participantPosition
            ) === Number(actual.modified.afterQuantity),
            'confirmed'
          );
        }
        const detail = { ...actual.modified, realtimeSync: actual.realtime.modifiedItems };
        return actual.modified.ok && detail.realtimeSync?.ok
          ? pass('已像真人修改預約項目，且用戶端 Realtime 同步顯示新的項目數量。', { quantityPersisted: true, realtime: true }, detail)
          : fail('修改此位項目持久化或用戶端 Realtime 同步失敗。', { quantityPersisted: true, realtime: true }, detail);
      }),

      caseDef(prefix + 'MODIFY_TECHNICIAN', '預約：修改此位技師', 'Booking / Modify Technician', async () => {
        if (!actual.confirmed?.ok || !actual.modified?.ok) {
          return fail('確認或項目修改未成功，未送出技師修改。', { confirmed: true, modifiedItems: true }, { dependencyFailed: 'CONFIRM_OR_MODIFY' });
        }
        const current = await waitAdminBookingSnapshot(mutable.bookingId, (row) => row.status === 'confirmed');
        const realtimeProbe = await beginBookingRealtimeProbe(participant, mutable.bookingId);
        actual.modifiedTechnician = await mutateDetectedBookingTechnician(current || mutable);
        if (actual.modifiedTechnician.ok) {
          actual.realtime.modifiedTechnician = await verifyBookingRealtimeSync(
            participant,
            realtimeProbe,
            (snapshot) => memberBookingTechnician(
              snapshot,
              actual.modifiedTechnician.participantPosition
            ) === String(actual.modifiedTechnician.afterTechnicianId || ''),
            'confirmed'
          );
        }
        const detail = { ...actual.modifiedTechnician, realtimeSync: actual.realtime.modifiedTechnician };
        return actual.modifiedTechnician.ok && detail.realtimeSync?.ok
          ? pass('已像真人修改預約技師，且用戶端 Realtime 同步顯示新的技師資料。', { technicianPersisted: true, realtime: true }, detail)
          : fail('修改此位技師持久化或用戶端 Realtime 同步失敗。', { technicianPersisted: true, realtime: true }, detail);
      }),

      caseDef(prefix + 'COMPLETE', '預約：完成預約', 'Booking / Complete', async () => {
        if (!actual.confirmed?.ok || !actual.modified?.ok || !actual.modifiedTechnician?.ok) {
          return fail('確認、項目或技師修改未成功，未送出完成。', {
            confirmed: true, modifiedItems: true, modifiedTechnician: true
          }, { dependencyFailed: 'CONFIRM_OR_MODIFY' });
        }
        const realtimeProbe = await beginBookingRealtimeProbe(participant, mutable.bookingId);
        actual.completed = await setDetectedBookingStatus(
          mutable.bookingId,
          '確認服務完成',
          'QA ADMIN E2E COMPLETE ' + qaCrudStamp(),
          'completed',
          'confirmed'
        );
        if (actual.completed.ok) {
          actual.realtime.completed = await verifyBookingRealtimeSync(
            participant,
            realtimeProbe,
            (snapshot) => String(snapshot.status || '') === 'completed',
            'completed'
          );
          actual.statusTabs.completed = await verifyDetectedBookingInCoreFilter(mutable.bookingId, 'completed');
          actual.statusTabs.allCompleted = await verifyDetectedBookingInCoreFilter(mutable.bookingId, 'all');
        }
        const detail = {
          ...actual.completed,
          completedTab: actual.statusTabs.completed,
          allTab: actual.statusTabs.allCompleted,
          realtimeSync: actual.realtime.completed
        };
        return actual.completed.ok && detail.completedTab?.ok && detail.allTab?.ok && detail.realtimeSync?.ok
          ? pass('已像真人完成預約，且用戶端 Realtime 自動更新為服務已完成。', { status: 'completed', realtime: true }, detail)
          : fail('完成預約、狀態分頁或用戶端 Realtime 同步失敗。', { status: 'completed', realtime: true }, detail);
      }),

      caseDef(prefix + 'CANCEL', '預約：確認取消', 'Booking / Cancellation Approve', async () => {
        cancellationTarget = cancellationTarget || await acquireLiveTarget('cancellationTarget');
        if (!cancellationTarget) {
          return fail('本輪沒有可供再次申請取消的預約。', { cancellationRequestDetected: true }, actual.detectedBookings);
        }
        if (!actual.keptCancellation?.ok) {
          return fail('保留預約步驟未成功，不能以同一筆資料建立第二次獨立取消申請。', {
            cancellationKept: true
          }, { dependencyFailed: 'KEEP_CANCELLATION' });
        }
        if (!actual.handoffReady) {
          const handoff = await waitForPairedBookingHandoff(participant);
          actual.handoffReady = Boolean(handoff);
        }
        if (!actual.handoffReady) {
          return fail('用戶端完整預約案例尚未交接完成，為避免與真人操作競態，不執行第二次取消申請。', {
            completeHandoffBeforeMemberUiReuse: true
          }, { handoffReady: false });
        }
        actual.cancellationRerequest = await requestDetectedCancellationFromClient(participant, cancellationTarget.bookingId);
        if (!actual.cancellationRerequest.ok) {
          return fail('會員端未能再次提出取消申請。', { cancellationRequestedAgain: true }, actual.cancellationRerequest);
        }
        actual.statusTabs.cancellationRequestApprove = await verifyDetectedBookingInCancellationFilter(cancellationTarget.bookingId, 'request');
        const realtimeProbe = await beginBookingRealtimeProbe(participant, cancellationTarget.bookingId);
        actual.cancelled = await approveDetectedCancellation(cancellationTarget.bookingId);
        if (actual.cancelled.ok) {
          actual.realtime.cancelled = await verifyBookingRealtimeSync(
            participant,
            realtimeProbe,
            (snapshot) => String(snapshot.status || '') === 'cancelled',
            'cancelled'
          );
          actual.statusTabs.cancelled = await verifyDetectedBookingInCancellationFilter(cancellationTarget.bookingId, 'cancelled');
          actual.statusTabs.allCancelled = await verifyDetectedBookingInCoreFilter(cancellationTarget.bookingId, 'all');
        }
        const detail = {
          ...actual.cancelled,
          rerequest: actual.cancellationRerequest,
          requestTab: actual.statusTabs.cancellationRequestApprove,
          cancelledTab: actual.statusTabs.cancelled,
          allTab: actual.statusTabs.allCancelled,
          realtimeSync: actual.realtime.cancelled
        };
        return actual.cancelled.ok && detail.requestTab?.ok && detail.cancelledTab?.ok && detail.allTab?.ok && detail.realtimeSync?.ok
          ? pass('會員再次申請取消後，管理端像真人確認取消，用戶端 Realtime 自動更新為已取消。', {
              decision: 'approved', status: 'cancelled', realtime: true
            }, detail)
          : fail('確認取消、狀態分頁或用戶端 Realtime 同步失敗。', {
              decision: 'approved', status: 'cancelled', realtime: true
            }, detail);
      })
    ], '預約完整自動處理 · 測試用戶 ' + participant.index);

    const finalHandoff = await waitForPairedBookingHandoff(participant);
    actual.handoffReady = Boolean(finalHandoff);
    if (finalHandoff) {
      const fresh = await adminBookingBootstrapSnapshot();
      const finalCandidates = pairedBookingCandidates(fresh, participant);
      if (finalCandidates.length) candidates = finalCandidates;
      actual.detectedCount = candidates.length;
      actual.detectedBookings = candidates.map((booking) => ({
        bookingId: booking.bookingId,
        status: booking.status,
        memberNote: booking.memberNote || '',
        cancellationPending: Boolean(booking.cancellationRequestedAt && !booking.cancellationReviewedAt)
      }));
    }
    participant.adminStatus = finalHandoff ? '完整接手清單已同步' : '接手清單未完成';
    renderParticipants();

    const primaryIds = new Set([
      mutable?.bookingId,
      rejectTarget?.bookingId,
      cancellationTarget?.bookingId
    ].filter(Boolean));
    const remaining = candidates.filter((booking) => !primaryIds.has(booking.bookingId));
    await executeCases(remaining.map((booking, index) => caseDef(
      prefix + 'REMAINING_' + (index + 1),
      '預約：接手其餘本輪 QA 資料 ' + (index + 1),
      'Booking / Remaining',
      async () => {
        const realtimeProbe = await beginBookingRealtimeProbe(participant, booking.bookingId);
        const detail = await finishRemainingBooking(booking);
        if (detail.ok && !detail.alreadyTerminal) {
          const finalRow = await waitAdminBookingSnapshot(
            booking.bookingId,
            (row) => ['completed', 'cancelled', 'rejected'].includes(String(row?.status || ''))
              && !(row?.cancellationRequestedAt && !row?.cancellationReviewedAt),
            12000
          );
          detail.realtimeSync = finalRow
            ? await verifyBookingRealtimeSync(
                participant,
                realtimeProbe,
                (snapshot) => String(snapshot.status || '') === String(finalRow.status || '')
                  && !(snapshot.cancellationRequestedAt && !snapshot.cancellationReviewedAt),
                String(finalRow.status || '')
              )
            : { ok: false, reason: 'admin-terminal-state-not-found' };
        } else if (detail.ok) {
          detail.realtimeSync = { ok: true, notRequired: true, reason: 'already-terminal' };
        }
        actual.remainingProcessed.push(detail);
        return detail.ok && detail.realtimeSync?.ok
          ? pass('本輪額外 QA 預約已由管理端處理至終態，且用戶端同步完成。', {
              terminal: true, clientSynchronized: true
            }, detail)
          : fail('本輪額外 QA 預約未處理完成或用戶端同步失敗。', {
              terminal: true, clientSynchronized: true
            }, detail);
      }
    )), '預約剩餘資料 · 測試用戶 ' + participant.index);

    await executeCases([caseDef(prefix + 'TERMINAL', '預約：兩端皆無本輪未完成資料', 'Booking / Terminal', async () => {
      actual.terminal = await verifyPairedBookingTerminalState(participant);
      return actual.terminal.ok
        ? pass('管理端與用戶端均已回讀本輪預約終態，沒有待確認或待審核取消。', {
            unresolved: 0, clientSynchronized: true
          }, actual.terminal)
        : fail('本輪仍有預約未完成、未拒絕、未審核取消、資料遺失或用戶端未同步。', {
            unresolved: 0, clientSynchronized: true
          }, actual.terminal);
    })], '預約終態驗證 · 測試用戶 ' + participant.index);

    await executeCases([caseDef(prefix + 'RISK_SCAN', '預約：同步／競態／越權風險掃描', 'Booking / Risk Scan', async () => {
      const handoffIds = Array.isArray(participant.bookingResult?.bookingHandoff?.bookingIds)
        ? participant.bookingResult.bookingHandoff.bookingIds.map(String).filter(Boolean)
        : [];
      const uniqueHandoffIds = [...new Set(handoffIds)];
      const fresh = await adminBookingBootstrapSnapshot();
      const allRows = Array.isArray(fresh?.bookings) ? fresh.bookings : [];
      const handoffRows = allRows.filter((row) => uniqueHandoffIds.includes(String(row?.bookingId || '')));
      const foreignOwnerRows = handoffRows.filter((row) => String(row?.memberId || '') !== String(account.memberId || ''));
      const candidateOutsideHandoff = candidates
        .filter((row) => !uniqueHandoffIds.includes(String(row?.bookingId || '')))
        .map((row) => String(row?.bookingId || ''));
      const realtimeRows = Object.entries(actual.realtime).map(([name, value]) => ({ name, ...(value || {}) }));
      const realtimeFailures = realtimeRows.filter((row) => row.ok !== true);
      const manualRefreshViolations = realtimeRows.filter((row) => row.manualRefreshUsed === true);
      const remainingSyncFailures = actual.remainingProcessed.filter((row) => row?.realtimeSync?.ok !== true);
      const unresolved = Array.isArray(actual.terminal?.admin?.unresolved) ? actual.terminal.admin.unresolved : [];
      const missingIds = Array.isArray(actual.terminal?.admin?.missingIds) ? actual.terminal.admin.missingIds : [];
      const cancellationPending = unresolved.filter((row) => row.cancellationPending);
      actual.riskScan = {
        handoffCount: handoffIds.length,
        duplicateHandoffIds: handoffIds.length - uniqueHandoffIds.length,
        foreignOwnerBookingIds: foreignOwnerRows.map((row) => String(row?.bookingId || '')),
        candidateOutsideHandoff,
        realtimeChecks: realtimeRows.length,
        realtimeFailures,
        manualRefreshViolations,
        remainingSyncFailures: remainingSyncFailures.map((row) => row.bookingId),
        unresolved,
        missingIds,
        cancellationPending,
        terminalClientSynchronized: Boolean(actual.terminal?.client?.uiSynchronized),
        risksDetected: []
      };
      if (actual.riskScan.duplicateHandoffIds) actual.riskScan.risksDetected.push('duplicate-handoff');
      if (foreignOwnerRows.length || candidateOutsideHandoff.length) actual.riskScan.risksDetected.push('cross-account-or-out-of-scope');
      if (realtimeFailures.length || manualRefreshViolations.length || remainingSyncFailures.length) actual.riskScan.risksDetected.push('realtime-or-stale-client');
      if (unresolved.length || missingIds.length || cancellationPending.length) actual.riskScan.risksDetected.push('unfinished-or-cancellation-race');
      if (!actual.terminal?.client?.uiSynchronized) actual.riskScan.risksDetected.push('backend-ui-divergence');
      const ok = actual.riskScan.risksDetected.length === 0
        && realtimeRows.length >= 7
        && uniqueHandoffIds.length > 0;
      actual.riskScan.ok = ok;
      return ok
        ? pass('完整預約 E2E 未發現跨會員誤操作、Realtime 靜默失效、UI 落後、取消競態或未處理預約。', {
            risksDetected: 0, realtimeChecksAtLeast: 7, unresolved: 0
          }, actual.riskScan)
        : fail('完整預約 E2E 偵測到同步、競態、資料範圍或終態風險。', {
            risksDetected: 0, realtimeChecksAtLeast: 7, unresolved: 0
          }, actual.riskScan);
    })], '預約風險掃描 · 測試用戶 ' + participant.index);

    if (state.cancelled) return skip('預約 E2E 已停止，已完成的動作與資料保留。', expected, actual);
    const steps = ['REJECT', 'KEEP_CANCELLATION', 'CONFIRM', 'MODIFY', 'MODIFY_TECHNICIAN', 'COMPLETE', 'CANCEL', 'TERMINAL', 'RISK_SCAN']
      .map((key) => state.results.find((row) => row.key === prefix + key));
    return steps.every((row) => row?.status === 'passed')
      && actual.remainingProcessed.length === remaining.length
      && actual.remainingProcessed.every((row) => row.ok && row.realtimeSync?.ok)
      && actual.terminal?.ok
      && actual.riskScan?.ok
      ? pass('管理端已像真人接手所有本輪預約，逐步驗證用戶端 Realtime，同時完成終態與風險掃描。', expected, actual)
      : fail('預約 E2E 有未通過步驟，請查看各動作的獨立結果。', expected, actual);
  }


  async function adminTestModeControlsCase() {
    document.getElementById('testModeTab')?.click();
    const ids = [
      'testModePcLoginEnabled', 'testModeMobileLoginEnabled', 'testModeMaintenanceMessage',
      'testModeAddAccountCount', 'saveTestModeButton', 'runQuickAutomationTestButton',
      'runFullAutomationTestButton', 'runAdminQuickE2EButton', 'runAdminFullE2EButton',
      'runBookingPendingE2EButton', 'runBookingCancellationE2EButton', 'runBookingFullE2EButton',
      'runPairedFullE2EButton', 'pairedE2EAccountCount'
    ];
    const actual = Object.fromEntries(ids.map((id) => [id, Boolean(document.getElementById(id))]));
    const ok = Object.values(actual).every(Boolean);
    return ok
      ? pass('管理端測試環境與兩類 Runner 控制元件皆存在。', { allControls: true }, actual)
      : fail('測試環境控制元件不完整。', { allControls: true }, actual);
  }

  async function adminButtonCoverageCase() {
    const buttons = Array.from(document.querySelectorAll('#adminView button, body > .modal button, #bookingPanel button'));
    const unmapped = [];
    const mapped = [];
    for (const button of buttons) {
      const id = String(button.id || '');
      const datasets = Object.keys(button.dataset || {});
      const accepted =
        Boolean(id && /^(retry|logout|members|cards|events|calendar|testMode|refresh|tier|manageGrant|saveTier|realMembers|testMembers|member|card|ticket|event|adminCalendar|saveTestMode|deleteSelectedTestAccounts|purgeTestData|runQuickAutomation|runFullAutomation|close|cancel|save|grant|messagePreset|booking|runAdmin|runPaired|add|queue|delete|clear|new|reset|archive|balance|fixedTicket)/i.test(id)) ||
        datasets.length > 0 ||
        button.classList.contains('editor-modal-close') ||
        button.classList.contains('close-button');
      const key = id || datasets.map((key) => 'data-' + key).join(',') || button.textContent?.trim().slice(0, 60) || '[button]';
      (accepted ? mapped : unmapped).push(key);
    }
    const actual = { totalButtons: buttons.length, mapped: mapped.length, unmapped };
    return unmapped.length === 0
      ? pass('目前管理端所有按鈕與動態控制皆已可被 E2E runner 分類追蹤。', { unmapped: [] }, actual)
      : fail('發現尚未納入管理端 E2E 覆蓋分類的新控制。', { unmapped: [] }, actual);
  }

  function selectedParticipantCount() {
    const input = state.section?.querySelector('#pairedE2EAccountCount');
    const count = Number(input?.value || 1);
    if (!Number.isInteger(count) || count < 1 || count > MAX_PAIRED_PARTICIPANTS) {
      const error = new Error(`協同測試人數必須是 1–${MAX_PAIRED_PARTICIPANTS} 的整數。`);
      error.code = 'INVALID_PAIRED_PARTICIPANT_COUNT';
      throw error;
    }
    return count;
  }

  function closeClientWindows() {
    for (const item of state.clientWindows) {
      try { if (item && !item.closed) item.close(); } catch {}
    }
    state.clientWindows = [];
  }

  function openClientWindows(count) {
    const opened = [];
    const stamp = Date.now();
    for (let index = 0; index < count; index += 1) {
      const child = window.open('about:blank', `member-e2e-${stamp}-${index + 1}`);
      if (!child) {
        for (const existing of opened) {
          try { existing.close(); } catch {}
        }
        const error = new Error(`瀏覽器阻擋了第 ${index + 1} 個用戶端視窗。請允許此網站開啟彈出式視窗後重試。`);
        error.code = 'E2E_POPUP_BLOCKED';
        throw error;
      }
      try {
        child.document.title = `Lumen Club E2E · 測試用戶 ${index + 1}`;
        child.document.body.innerHTML = '<main style="font-family:system-ui,sans-serif;padding:32px;line-height:1.7"><h1>用戶端 E2E 準備中</h1><p>正在建立獨立測試 Session，完成後會自動進入會員頁面。</p></main>';
      } catch {}
      opened.push(child);
    }
    state.clientWindows = opened;
    return opened;
  }

  function renderParticipants() {
    if (!state.participantList) return;
    const participants = Array.isArray(state.participants) ? state.participants : [];
    state.participantList.classList.toggle('hidden', participants.length === 0);
    state.participantList.replaceChildren(...participants.map((participant) => {
      const card = document.createElement('div');
      card.className = 'admin-e2e-participant';
      const identity = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = `測試用戶 ${participant.index}`;
      const code = document.createElement('small');
      code.textContent = String(participant.account?.memberCode || '準備中');
      identity.append(title, code);
      const status = document.createElement('span');
      status.textContent = `${participant.status || '準備中'} · ${participant.surface || '—'}` +
        (participant.adminStatus ? ` · 管理端：${participant.adminStatus}` : '');
      card.append(identity, status);
      return card;
    }));
  }

  async function postAdminTestMode(action, payload = {}) {
    const session = await adminSession();
    return postFunction('test-mode-api', {
      ...payload,
      action,
      clientType: 'admin',
      idToken: session.idToken
    });
  }

  function activeTestAccounts(data) {
    return (Array.isArray(data?.accounts) ? data.accounts : []).filter((account) =>
      account?.status === 'active' && account?.membershipStatus === 'active' && account?.memberId
    );
  }

  async function prepareTestAccounts(count) {
    let data = await postAdminTestMode('admin.test-mode.bootstrap');
    let accounts = activeTestAccounts(data).filter((account) => !Array.isArray(account.activeSurfaces) || account.activeSurfaces.length === 0);
    if (accounts.length < count) {
      const shortage = count - accounts.length;
      const settings = data?.settings || {};
      await postAdminTestMode('admin.test-mode.save', {
        maintenanceEnabled: Boolean(settings.maintenanceEnabled),
        allowPcTestLogin: Boolean(settings.allowPcTestLogin),
        allowMobileTestLogin: Boolean(settings.allowMobileTestLogin),
        maintenanceMessage: String(settings.maintenanceMessage || ''),
        addAccountCount: shortage
      });
      data = await postAdminTestMode('admin.test-mode.bootstrap');
      accounts = activeTestAccounts(data).filter((account) => !Array.isArray(account.activeSurfaces) || account.activeSurfaces.length === 0);
    }
    if (accounts.length < count) {
      throw new Error(`可供協同測試且尚未登入任何用戶端的測試用戶不足：需要 ${count} 位，目前只有 ${accounts.length} 位。`);
    }
    return shuffled(accounts).slice(0, count);
  }


  async function waitStandaloneBookingRows(bookingIds, memberId, timeoutMs = 20000) {
    const ids = [...new Set((bookingIds || []).map(String).filter(Boolean))];
    const deadline = Date.now() + Math.max(3000, Number(timeoutMs) || 20000);
    let rows = [];
    while (Date.now() < deadline) {
      const data = await adminBookingBootstrapSnapshot();
      rows = (Array.isArray(data?.bookings) ? data.bookings : [])
        .filter((booking) => ids.includes(String(booking?.bookingId || '')))
        .filter((booking) => String(booking?.memberId || '') === String(memberId || ''));
      if (rows.length === ids.length) return rows;
      await sleep(500);
    }
    return rows;
  }

  async function prepareAdminBookingQueueScenario(mode) {
    const queueMode = mode === 'cancellation' ? 'cancellation' : 'pending';
    const accounts = await prepareTestAccounts(1);
    const account = accounts[0];
    if (!account?.memberId) throw new Error('找不到可供預約佇列 E2E 使用的測試會員。');

    const login = await createPairedSession(account, 'booking');
    const targetPending = queueMode === 'pending' ? 2 : 1;
    const targetCancellation = 1;
    const bookingIds = [];
    const stateRows = [];

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const usage = await postFunction('user-test-api', {
        action: 'user.qa.usage-state.prepare',
        surface: 'booking',
        testSessionToken: login.testSessionToken
      });
      for (const item of Array.isArray(usage?.bookings) ? usage.bookings : []) {
        const bookingId = String(item?.bookingId || '');
        if (bookingId && !bookingIds.includes(bookingId)) bookingIds.push(bookingId);
        if (bookingId) stateRows.push({ bookingId, state: String(item?.state || '') });
      }

      const knownPending = stateRows.filter((item) => item.state === 'pending').length;
      const knownCancellation = stateRows.filter((item) => item.state === 'cancel_requested').length;
      if (knownPending >= targetPending && knownCancellation >= targetCancellation) break;
    }

    if (!bookingIds.length) throw new Error('測試會員無法建立預約 E2E 資料，請確認預約資源與可預約時段。');
    const rows = await waitStandaloneBookingRows(bookingIds, account.memberId);
    const pending = rows.filter((booking) =>
      String(booking?.status || '') === 'pending'
      && !(booking?.cancellationRequestedAt && !booking?.cancellationReviewedAt)
    );
    const cancellations = rows.filter((booking) =>
      ['pending', 'confirmed'].includes(String(booking?.status || ''))
      && Boolean(booking?.cancellationRequestedAt)
      && !booking?.cancellationReviewedAt
    );

    if (queueMode === 'pending' && pending.length < 2) {
      throw new Error('待確認 E2E 需要兩筆獨立測試預約（確認／不通過各一筆），目前建立不足。');
    }
    if (queueMode === 'cancellation' && cancellations.length < 1) {
      throw new Error('取消申請 E2E 未建立出待審核取消資料。');
    }

    return {
      mode: queueMode,
      account,
      login,
      bookingIds,
      pending: pending.slice(0, 2),
      cancellations: cancellations.slice(0, 1)
    };
  }

  async function requestDetectedCancellationWithTestSession(testSessionToken, bookingId) {
    const id = String(bookingId || '');
    const result = await postFunction('booking-api', {
      action: 'user.booking.cancel',
      clientType: 'member',
      testSessionToken: String(testSessionToken || ''),
      bookingId: id
    });
    document.getElementById('bookingAdminRefreshButton')?.click();
    const requested = await waitAdminBookingSnapshot(
      id,
      (row) => Boolean(row?.cancellationRequestedAt) && !row?.cancellationReviewedAt,
      18000
    );
    return {
      bookingId: id,
      responseStatus: String(result?.booking?.status || ''),
      status: String(requested?.status || ''),
      cancellationRequestedAt: requested?.cancellationRequestedAt || null,
      cancellationReviewedAt: requested?.cancellationReviewedAt || null,
      ok: Boolean(requested?.cancellationRequestedAt && !requested?.cancellationReviewedAt)
    };
  }

  async function adminPendingConfirmCase(scenario) {
    const target = scenario?.pending?.[0];
    if (!target) return fail('缺少可供確認的測試會員待確認預約。', { pendingTarget: true }, { pendingTarget: false });
    const pendingTab = await verifyDetectedBookingInCoreFilter(target.bookingId, 'pending');
    const confirmed = await setDetectedBookingStatus(
      target.bookingId,
      '確認預約',
      'QA ADMIN PENDING E2E CONFIRM ' + qaCrudStamp(),
      'confirmed',
      'pending'
    );
    const confirmedTab = confirmed.ok ? await verifyDetectedBookingInCoreFilter(target.bookingId, 'confirmed') : null;
    const actual = { bookingId: target.bookingId, pendingTab, confirmed, confirmedTab };
    return pendingTab.ok && confirmed.ok && confirmedTab?.ok
      ? pass('待確認分頁已實際點擊「確認預約」，並回讀 confirmed。', { status: 'confirmed' }, actual)
      : fail('待確認「確認預約」沒有完整執行或回讀失敗。', { status: 'confirmed' }, actual);
  }

  async function adminPendingRejectCase(scenario) {
    const target = scenario?.pending?.[1];
    if (!target) return fail('缺少第二筆可供不通過的測試會員待確認預約。', { secondPendingTarget: true }, { secondPendingTarget: false });
    const pendingTab = await verifyDetectedBookingInCoreFilter(target.bookingId, 'pending');
    const rejected = await setDetectedBookingStatus(
      target.bookingId,
      '不通過',
      'QA ADMIN PENDING E2E REJECT ' + qaCrudStamp(),
      'rejected',
      'pending'
    );
    const allTab = rejected.ok ? await verifyDetectedBookingInCoreFilter(target.bookingId, 'all') : null;
    const actual = { bookingId: target.bookingId, pendingTab, rejected, allTab };
    return pendingTab.ok && rejected.ok && allTab?.ok
      ? pass('待確認分頁已實際點擊「不通過」，並回讀 rejected。', { status: 'rejected' }, actual)
      : fail('待確認「不通過」沒有完整執行或回讀失敗。', { status: 'rejected' }, actual);
  }

  async function adminCancellationKeepCase(scenario) {
    const target = scenario?.cancellations?.[0];
    if (!target) return fail('缺少可供保留預約的測試會員取消申請。', { cancellationTarget: true }, { cancellationTarget: false });
    const requestTab = await verifyDetectedBookingInCancellationFilter(target.bookingId, 'request');
    const kept = await rejectDetectedCancellation(target.bookingId);
    const sourceTab = kept.ok ? await verifyDetectedBookingInCoreFilter(target.bookingId, kept.sourceStatus) : null;
    scenario.keptBookingId = target.bookingId;
    scenario.keepResult = kept;
    const actual = { bookingId: target.bookingId, requestTab, kept, sourceTab };
    return requestTab.ok && kept.ok && sourceTab?.ok
      ? pass('取消申請分頁已實際點擊「保留預約」，取消申請已結束且原狀態保留。', { decision: 'rejected' }, actual)
      : fail('取消申請「保留預約」沒有完整執行或回讀失敗。', { decision: 'rejected' }, actual);
  }

  async function adminCancellationApproveCase(scenario) {
    const bookingId = String(scenario?.keptBookingId || scenario?.cancellations?.[0]?.bookingId || '');
    if (!bookingId || !scenario?.keepResult?.ok) {
      return fail('保留預約未成功，不能安全建立第二次取消申請。', { keepSucceeded: true }, { keepSucceeded: false, bookingId });
    }
    const rerequest = await requestDetectedCancellationWithTestSession(scenario.login?.testSessionToken, bookingId);
    if (!rerequest.ok) return fail('測試會員重新提出取消申請失敗。', { cancellationRequestedAgain: true }, rerequest);
    const requestTab = await verifyDetectedBookingInCancellationFilter(bookingId, 'request');
    const approved = await approveDetectedCancellation(bookingId);
    const cancelledTab = approved.ok ? await verifyDetectedBookingInCancellationFilter(bookingId, 'cancelled') : null;
    const allTab = approved.ok ? await verifyDetectedBookingInCoreFilter(bookingId, 'all') : null;
    const actual = { bookingId, rerequest, requestTab, approved, cancelledTab, allTab };
    return rerequest.ok && requestTab.ok && approved.ok && cancelledTab?.ok && allTab?.ok
      ? pass('測試會員再次申請取消後，管理端已實際點擊「確認取消」並回讀 cancelled。', { decision: 'approved', status: 'cancelled' }, actual)
      : fail('取消申請「確認取消」沒有完整執行或回讀失敗。', { decision: 'approved', status: 'cancelled' }, actual);
  }

  async function prepareComplexE2EFixtures() {
    const session = await adminSession();
    const runTag = 'PAIR-' + Date.now().toString(36).toUpperCase() + '-' + randomInt(1000, 9999);
    const data = await postFunction('test-control-api', {
      action: 'admin.test-control.prepare-e2e-fixtures',
      clientType: 'admin',
      idToken: session.idToken,
      runTag
    });
    const fixture = data?.fixture || {};
    const primaryTechnicianId = String(fixture.primaryTechnicianId || '').trim();
    const maxPartySize = Number(fixture.maxPartySize || 0);
    const ready = Number(fixture.ticketTemplates || 0) >= 4 &&
      Number(fixture.pointCards || 0) >= 3 &&
      Number(fixture.pointRewardNodes || 0) >= 6 &&
      Number(fixture.eventTickets || 0) >= 6 &&
      Number(fixture.calendarItems || 0) >= 5 &&
      Number(fixture.fixedTickets || 0) >= 4 &&
      Number(fixture.bookingServices || 0) >= 4 &&
      Number(fixture.bookingTechnicians || 0) >= 3 &&
      Boolean(primaryTechnicianId) &&
      maxPartySize >= 2;
    if (!ready) {
      const error = new Error('管理端高複雜度 E2E 前置資料建立不完整（包含主要技師／多人預約設定），已禁止用戶端開始測試。');
      error.code = 'E2E_FIXTURE_INCOMPLETE';
      error.fixture = fixture;
      throw error;
    }
    state.results.push({
      key: 'PAIRED_COMPLEX_FIXTURE_PREPARE',
      name: '管理端：建立完整高複雜度測試資料',
      domain: 'Paired E2E / Fixture',
      status: 'passed',
      message: '已完成票券種類、固定票券週期與效期、集點節點、活動日期、會員階級、日曆與預約資源前置資料；現在才允許用戶端開始。',
      expected: {
        ticketTypes: ['coupon', 'lottery', 'fixed'],
        fixedSchedules: ['birthday_month', 'yearly', 'monthly', 'weekly'],
        eventDateStates: ['past', 'today', 'active-window', 'future'],
        membershipTiers: ['general', 'silver', 'gold', 'platinum'],
        minimumPointNodes: 6,
        primaryTechnicianConfigured: true,
        maxPartySizeAtLeast: 2
      },
      actual: safe(fixture),
      durationMs: 0
    });
    render();
    return fixture;
  }

  async function createPairedSession(account, surface = 'member') {
    const session = await adminSession();
    if (!account?.memberId) throw new Error('測試用戶識別不完整。');
    if (!PAIRED_SURFACES.some(([key]) => key === surface)) throw new Error('協同 E2E 用戶端類型不正確。');
    const common = { clientType: surface };
    const status = await postPublicTestMode(session, { action: 'public.status', ...common });
    if (!status.maintenanceEnabled) {
      const error = new Error('協同 E2E 需要先啟用「系統維護」，以確保正式用戶不會進入測試流程。');
      error.code = 'TEST_MAINTENANCE_REQUIRED';
      throw error;
    }
    const login = await postPublicTestMode(session, {
      action: 'test-mode.login',
      ...common,
      memberId: account.memberId
    });
    if (!login.testSessionToken || login.account?.memberId !== account.memberId || String(login.surface || surface) !== surface) {
      throw new Error('指定測試用戶 Session 建立不完整、帳號不一致或用戶端類型不一致。');
    }
    return login;
  }

  function seedParticipantSession(participant, login) {
    const child = participant?.window;
    if (!child || child.closed) throw new Error(`測試用戶 ${participant?.index || '?'} 的用戶端視窗已關閉。`);
    try {
      child.sessionStorage.setItem(TEST_SESSION_STORAGE_KEY, JSON.stringify({
        token: String(login.testSessionToken),
        expiresAt: new Date(login.expiresAt).getTime()
      }));
    } catch {
      throw new Error('無法把測試 Session 寫入獨立用戶端視窗。');
    }
  }

  function navigateParticipant(participant, surface) {
    const child = participant?.window;
    if (!child || child.closed) throw new Error(`測試用戶 ${participant?.index || '?'} 的用戶端視窗已關閉。`);
    const url = new URL('../' + surface + '/', window.location.href);
    url.searchParams.set('qaPair', `${Date.now()}-${participant.index}`);
    child.location.href = url.href;
  }

  async function postPublicTestMode(session, body) {
    const response = await fetch(functionUrl(session.config, 'test-mode-api'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: String(session.config.supabasePublishableKey || '')
      },
      cache: 'no-store',
      body: JSON.stringify(body)
    });
    let parsed = null;
    try { parsed = await response.json(); } catch {}
    if (!response.ok || !parsed || parsed.ok !== true) {
      const error = new Error(parsed?.error?.message || '測試登入服務拒絕協同 E2E。');
      error.code = parsed?.error?.code || 'TEST_MODE_ERROR';
      throw error;
    }
    return parsed.data || {};
  }

  async function runUserSurface(participant, surface, label) {
    const child = participant?.window;
    if (!child || child.closed) throw new Error('測試用戶 ' + (participant?.index || '?') + ' 的用戶端視窗已被關閉。');
    participant.surface = label;
    renderParticipants();
    navigateParticipant(participant, surface);

    const control = await waitFor(() => {
      if (state.cancelled) return { cancelled: true };
      try {
        if (child.closed) return null;
        return child.MemberUserTestControl?.surface === surface ? child.MemberUserTestControl : null;
      } catch { return null; }
    }, 25000, 120);
    if (control?.cancelled || state.cancelled) {
      return { ok: false, cancelled: true, surface, account: participant.account, results: [], summary: { passed: 0, failed: 0, skipped: 0, total: 0 } };
    }
    if (!control) throw new Error(label + ' E2E 控制器未在獨立用戶端視窗就緒。');

    const surfaceTimeoutMs = surface === 'booking' ? 180000 : 150000;
    let result;
    let timeoutId = 0;
    try {
      result = await Promise.race([
        control.runFull(),
        new Promise((_, reject) => {
          timeoutId = window.setTimeout(() => {
            const error = new Error(label + ' E2E 超過允許執行時間，已自動停止以避免協同測試卡住。');
            error.code = 'E2E_SURFACE_TIMEOUT';
            reject(error);
          }, surfaceTimeoutMs);
        })
      ]);
    } catch (error) {
      if (error?.code === 'E2E_SURFACE_TIMEOUT') {
        try { control.stop?.(); } catch {}
      }
      throw error;
    } finally {
      if (timeoutId) window.clearTimeout(timeoutId);
    }
    if (!result || typeof result !== 'object') throw new Error(label + ' E2E 未回傳結構化結果。');
    if (!result.cancelled && result?.account?.memberId !== participant.account?.memberId) {
      const error = new Error(label + ' E2E 使用者與指定測試用戶不一致。');
      error.code = 'E2E_TEST_ACCOUNT_MISMATCH';
      throw error;
    }
    return safe(result);
  }

  

  async function verifyUserRunsVisibleInAdmin(account, runCodes) {
    const latestRunCode = String(runCodes.filter(Boolean).slice(-1)[0] || '');
    if (!account?.memberCode || !latestRunCode) {
      return fail('沒有足夠資料驗證用戶端測試紀錄同步。', { memberCode: true, runCode: true }, { memberCode: account?.memberCode || null, runCode: latestRunCode || null });
    }
    await ensureTestRoster(account);
    const rows = Array.from(document.querySelectorAll('#memberTableBody tr'));
    const row = rows.find((item) => item.textContent?.includes(String(account.memberCode)));
    if (!row) return fail('管理端名冊找不到協同測試會員。', { memberCode: account.memberCode }, { found: false });
    const button = row.querySelector('button[data-action="view-records"]');
    if (!button) return fail('協同測試會員缺少紀錄按鈕。', { recordsButton: true }, { recordsButton: false });
    button.click();
    const modal = await waitFor(() => {
      const node = document.getElementById('memberRecordsModal');
      return node && !node.classList.contains('hidden') ? node : null;
    }, 8000);
    if (!modal) return fail('會員紀錄視窗未開啟。', { modalOpen: true }, { modalOpen: false });
    const tab = modal.querySelector('[data-record-filter="testAutomation"]');
    tab?.click();
    const visible = Boolean(await waitFor(() => modal.querySelector('#memberRecordsList')?.textContent?.includes(latestRunCode), 10000, 120));
    document.getElementById('closeMemberRecordsModal')?.click();
    return visible
      ? pass('用戶端真人 E2E 的 run code 已同步出現在同一位測試會員的管理端紀錄。', { runCodeVisible: true }, { runCodeVisible: true, runCode: latestRunCode })
      : fail('用戶端 E2E 已完成，但管理端會員紀錄尚未看見該 run code。', { runCodeVisible: true }, { runCodeVisible: false, runCode: latestRunCode });
  }


  async function createEphemeralTestAccount() {
    const before = await postAdminTestMode('admin.test-mode.bootstrap');
    const beforeIds = new Set(activeTestAccounts(before).map((account) => String(account.memberId || '')));
    const settings = before?.settings || {};
    const after = await postAdminTestMode('admin.test-mode.save', {
      maintenanceEnabled: Boolean(settings.maintenanceEnabled),
      allowPcTestLogin: Boolean(settings.allowPcTestLogin),
      allowMobileTestLogin: Boolean(settings.allowMobileTestLogin),
      maintenanceMessage: String(settings.maintenanceMessage || ''),
      addAccountCount: 1
    });
    const created = activeTestAccounts(after).find((account) => !beforeIds.has(String(account.memberId || '')));
    if (!created?.memberId || !created?.memberCode) throw new Error('無法建立深度 E2E 專用臨時測試會員。');
    try {
      const member = await adminMemberSnapshot(created);
      if (!member?.lineUserId) throw new Error('深度 E2E 臨時測試會員缺少管理端身分對應。');
      return { ...created, lineUserId: member.lineUserId };
    } catch (error) {
      await postAdminTestMode('admin.test-mode.delete-accounts', { memberIds: [created.memberId] }).catch(() => {});
      throw error;
    }
  }

  async function removeEphemeralTestAccount(account) {
    if (!account?.memberId) return false;
    const result = await postAdminTestMode('admin.test-mode.delete-accounts', { memberIds: [account.memberId] });
    return Number(result?.deletedAccountCount || 0) >= 1;
  }

  async function waitParticipantSurface(participant, surface, rootId, timeoutMs = 25000) {
    navigateParticipant(participant, surface);
    const child = participant.window;
    const ready = await waitFor(() => {
      try {
        if (!child || child.closed) return null;
        if (child.MemberUserTestControl?.surface !== surface) return null;
        const root = child.document.getElementById(rootId);
        const error = child.document.getElementById('errorView');
        if (error && !error.classList.contains('hidden')) return { error: String(error.textContent || '').trim() };
        return root && !root.classList.contains('hidden') ? root : null;
      } catch { return null; }
    }, timeoutMs, 120);
    if (!ready || ready.error) throw new Error(ready?.error || surface + ' 用戶端沒有進入可操作狀態。');
    return child;
  }

  function childMembership(child) {
    const root = child?.document?.getElementById('membershipProgress');
    return {
      currentTier: String(root?.querySelector('[data-membership-current-tier]')?.textContent || '').trim(),
      summary: String(root?.querySelector('[data-membership-summary]')?.textContent || '').trim(),
      remaining: String(root?.querySelector('[data-membership-remaining]')?.textContent || '').trim(),
      styleKey: String(root?.getAttribute('data-membership-tier-style') || '')
    };
  }

  async function adminMemberSnapshot(account) {
    const session = await adminSession();
    const result = await window.MemberSystem.request(session.config, 'admin', session.idToken, 'admin.members.list', {
      memberPage: 1,
      memberPageSize: 100,
      memberQuery: String(account?.memberCode || ''),
      memberKind: 'test'
    });
    const members = Array.isArray(result?.members) ? result.members : [];
    const lineUserId = String(account?.lineUserId || '');
    const memberCode = String(account?.memberCode || '');
    return members.find((member) =>
      (lineUserId && String(member.lineUserId || '') === lineUserId) ||
      (memberCode && String(member.memberCode || '') === memberCode)
    ) || null;
  }

  async function waitAdminMember(account, predicate, timeoutMs = 12000) {
    const deadline = Date.now() + Math.max(100, Number(timeoutMs) || 12000);
    let lastError = null;
    while (Date.now() < deadline) {
      try {
        const member = await adminMemberSnapshot(account);
        if (member && predicate(member)) return member;
      } catch (error) {
        lastError = error;
      }
      await sleep(180);
    }
    if (lastError) throw lastError;
    return null;
  }

  async function openGrantForAccount(account) {
    await ensureTestRoster(account);
    const row = Array.from(document.querySelectorAll('#memberTableBody tr')).find((item) => item.textContent?.includes(String(account.memberCode || '')));
    const button = row?.querySelector('button[data-action="add-grant"]');
    if (!button) throw new Error('深度 E2E 測試會員沒有發放按鈕。');
    button.click();
    const modal = await waitFor(() => {
      const node = document.getElementById('grantModal');
      return node && !node.classList.contains('hidden') ? node : null;
    }, 6000);
    if (!modal) throw new Error('發放視窗沒有開啟。');
    if (String(document.getElementById('grantMemberId')?.value || '') !== String(account.lineUserId || '')) {
      throw new Error('發放視窗綁定的測試會員不一致。');
    }
    return modal;
  }

  function toggleCheckbox(id, checked) {
    const input = document.getElementById(id);
    if (!input) throw new Error('找不到控制欄位：' + id);
    input.checked = Boolean(checked);
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return input;
  }

  async function submitServiceGrant(account, minutes, doubleClick = false) {
    await openGrantForAccount(account);
    toggleCheckbox('grantStampsEnabled', false);
    toggleCheckbox('grantServiceTimeEnabled', true);
    setField('grantServiceTimeMinutes', String(minutes));
    const button = document.getElementById('saveGrantButton');
    button?.click();
    if (doubleClick) button?.click();
    const closed = Boolean(await waitFor(() => document.getElementById('grantModal')?.classList.contains('hidden'), 15000));
    if (!closed) throw new Error('服務時數發放後視窗沒有關閉。');
    return true;
  }

  async function submitPointGrant(account, cardId, amount, doubleClick = false) {
    await openGrantForAccount(account);
    toggleCheckbox('grantStampsEnabled', true);
    toggleCheckbox('grantServiceTimeEnabled', false);
    const row = await waitFor(() => document.querySelector('#grantPointRows [data-grant-point-row]'), 3000);
    const select = row?.querySelector('[data-grant-point-field="cardId"]');
    const input = row?.querySelector('[data-grant-point-field="amount"]');
    if (!select || !input) throw new Error('發放集點欄位沒有建立。');
    select.value = String(cardId);
    select.dispatchEvent(new Event('change', { bubbles: true }));
    input.value = String(amount);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const button = document.getElementById('saveGrantButton');
    button?.click();
    if (doubleClick) button?.click();
    const closed = Boolean(await waitFor(() => document.getElementById('grantModal')?.classList.contains('hidden'), 15000));
    if (!closed) throw new Error('點數發放後視窗沒有關閉。');
    return true;
  }

  async function invalidGrantBoundaryCase(account) {
    const before = await adminMemberSnapshot(account);
    await openGrantForAccount(account);
    toggleCheckbox('grantStampsEnabled', false);
    toggleCheckbox('grantServiceTimeEnabled', true);
    setField('grantServiceTimeMinutes', '0');
    document.getElementById('saveGrantButton')?.click();
    const zeroRejected = Boolean(await waitFor(() => /1–1440/.test(String(document.getElementById('grantFormMessage')?.textContent || '')), 1500));
    setField('grantServiceTimeMinutes', '1441');
    document.getElementById('saveGrantButton')?.click();
    const tooLargeRejected = Boolean(await waitFor(() => /1–1440/.test(String(document.getElementById('grantFormMessage')?.textContent || '')), 1500));
    toggleCheckbox('grantServiceTimeEnabled', false);
    document.getElementById('saveGrantButton')?.click();
    const emptyRejected = Boolean(await waitFor(() => /至少勾選/.test(String(document.getElementById('grantFormMessage')?.textContent || '')), 1500));
    document.getElementById('cancelGrantButton')?.click();
    const after = await adminMemberSnapshot(account);
    const unchanged = Number(after?.serviceMinutesTotal || 0) === Number(before?.serviceMinutesTotal || 0);
    return { zeroRejected, tooLargeRejected, emptyRejected, unchanged };
  }

  function currentTierSettingsFromDom() {
    return [
      ['general', 'tierGeneralMinutes', 'tierGeneralStyle'],
      ['silver', 'tierSilverMinutes', 'tierSilverStyle'],
      ['gold', 'tierGoldMinutes', 'tierGoldStyle'],
      ['platinum', 'tierPlatinumMinutes', 'tierPlatinumStyle']
    ].map(([tierKey, minutesId, styleId]) => ({
      tierKey,
      requiredServiceMinutes: Number(document.getElementById(minutesId)?.value || 0),
      styleKey: String(document.getElementById(styleId)?.value || 'forest')
    }));
  }

  async function saveTierSettingsViaUi(settings) {
    const map = Object.fromEntries(settings.map((item) => [item.tierKey, item]));
    setField('tierSilverMinutes', String(map.silver.requiredServiceMinutes));
    setField('tierGoldMinutes', String(map.gold.requiredServiceMinutes));
    setField('tierPlatinumMinutes', String(map.platinum.requiredServiceMinutes));
    setField('tierGeneralStyle', map.general.styleKey);
    setField('tierSilverStyle', map.silver.styleKey);
    setField('tierGoldStyle', map.gold.styleKey);
    setField('tierPlatinumStyle', map.platinum.styleKey);
    document.getElementById('saveTierSettingsButton')?.click();
    const saved = Boolean(await waitFor(() => /已儲存/.test(String(document.getElementById('tierSettingsFormMessage')?.textContent || '')), 15000));
    if (!saved) throw new Error('會員階級門檻沒有完成儲存。');
  }

  async function deepServiceTierRealtimeCase(ctx) {
    const account = ctx.account;
    const participant = ctx.participant;
    await ensureTestRoster(account);
    ctx.originalTierSettings = currentTierSettingsFromDom();

    const invalid = ctx.originalTierSettings.map((item) => ({ ...item }));
    invalid.find((item) => item.tierKey === 'silver').requiredServiceMinutes = 2;
    invalid.find((item) => item.tierKey === 'gold').requiredServiceMinutes = 2;
    invalid.find((item) => item.tierKey === 'platinum').requiredServiceMinutes = 4;
    setField('tierSilverMinutes', '2');
    setField('tierGoldMinutes', '2');
    setField('tierPlatinumMinutes', '4');
    document.getElementById('saveTierSettingsButton')?.click();
    const invalidTierRejected = Boolean(await waitFor(() => /依序遞增/.test(String(document.getElementById('tierSettingsFormMessage')?.textContent || '')), 1600));

    const testSettings = ctx.originalTierSettings.map((item) => ({ ...item }));
    testSettings.find((item) => item.tierKey === 'silver').requiredServiceMinutes = 2;
    testSettings.find((item) => item.tierKey === 'gold').requiredServiceMinutes = 3;
    testSettings.find((item) => item.tierKey === 'platinum').requiredServiceMinutes = 4;
    await saveTierSettingsViaUi(testSettings);
    ctx.tierSettingsChanged = true;

    const child = await waitParticipantSurface(participant, 'member', 'memberView');
    const before = await adminMemberSnapshot(account);
    const beforeMinutes = Number(before?.serviceMinutesTotal || 0);
    if (beforeMinutes !== 0) throw new Error('深度 E2E 臨時會員初始服務時數不是 0。');

    const invalidGrant = await invalidGrantBoundaryCase(account);

    const session = await adminSession();
    const requestId = 'E2E-SVC-' + qaCrudStamp();
    const payload = {
      lineUserId: account.lineUserId,
      requestId,
      messagePresetId: '',
      serviceTime: { minutes: 1 }
    };
    const replayResults = await Promise.allSettled([
      window.MemberSystem.request(session.config, 'admin', session.idToken, 'admin.member-grants.add', payload),
      window.MemberSystem.request(session.config, 'admin', session.idToken, 'admin.member-grants.add', payload)
    ]);
    const afterReplay = await waitAdminMember(account, (member) => Number(member.serviceMinutesTotal || 0) >= 1, 15000);
    const replayDeltaOne = Number(afterReplay?.serviceMinutesTotal || 0) === 1;
    const replayRealtime = Boolean(await waitFor(() => childMembership(child).summary.includes('累積 1 分鐘'), 12000, 120));

    await submitServiceGrant(account, 1, true);
    const silverMember = await waitAdminMember(account, (member) => Number(member.serviceMinutesTotal || 0) === 2, 15000);
    const doubleSubmitDeltaOne = Number(silverMember?.serviceMinutesTotal || 0) === 2;
    const silverRealtime = Boolean(await waitFor(() => /銀級/.test(childMembership(child).currentTier) && childMembership(child).summary.includes('累積 2 分鐘'), 12000, 120));

    await submitServiceGrant(account, 1, false);
    const goldRealtime = Boolean(await waitFor(() => /金級/.test(childMembership(child).currentTier) && childMembership(child).summary.includes('累積 3 分鐘'), 12000, 120));

    await submitServiceGrant(account, 1, false);
    const platinumRealtime = Boolean(await waitFor(() => /白金/.test(childMembership(child).currentTier) && childMembership(child).summary.includes('累積 4 分鐘'), 12000, 120));
    const finalMember = await adminMemberSnapshot(account);

    const actual = {
      invalidTierRejected,
      invalidGrant,
      replayRequests: replayResults.map((item) => item.status),
      replayDeltaOne,
      replayRealtime,
      doubleSubmitDeltaOne,
      silverRealtime,
      goldRealtime,
      platinumRealtime,
      finalServiceMinutes: Number(finalMember?.serviceMinutesTotal || 0),
      finalTier: finalMember?.tier || null
    };
    const ok = invalidTierRejected && Object.values(invalidGrant).every(Boolean) && replayDeltaOne && replayRealtime &&
      doubleSubmitDeltaOne && silverRealtime && goldRealtime && platinumRealtime && actual.finalServiceMinutes === 4;
    return ok
      ? pass('會員階級與服務時數已完成非法輸入、同 requestId 併發重送、UI 連點及跨級 Realtime 驗證；管理端與用戶端最終狀態一致。', {
          invalidRejected: true, idempotentReplayDelta: 1, doubleSubmitDelta: 1, finalServiceMinutes: 4,
          realtimeTiers: ['銀級', '金級', '白金']
        }, actual)
      : fail('會員階級／服務時數深度協同 E2E 發現狀態不一致。', {
          invalidRejected: true, idempotentReplayDelta: 1, doubleSubmitDelta: 1, finalServiceMinutes: 4,
          realtimeTiers: ['銀級', '金級', '白金']
        }, actual);
  }

  async function createDeepPointCard(ctx) {
    const stamp = qaCrudStamp();
    ctx.ticketTitle = 'E2E QA 深度集點抽獎券 ' + stamp;
    const ticket = await createQaTicketTemplate(ctx.ticketTitle, {
      status: 'active',
      ticketType: 'lottery',
      description: '深度協同 E2E：集點卡兌換後執行抽獎並驗證結果。',
      usageMethod: '集滿 2 點後使用並抽獎',
      usageInstructions: '僅供深度協同 E2E。',
      prizes: [
        { title: '深度頭獎', rate: 50, description: '深度協同 E2E 頭獎' },
        { title: '深度二獎', rate: 35, description: '深度協同 E2E 二獎' },
        { title: '深度參加獎', rate: 15, description: '深度協同 E2E 參加獎' }
      ]
    });
    ctx.ticketTemplateId = ticket.ticketTemplateId;
    closeEditorModalById('ticketEditorModal');

    document.getElementById('cardSettingsTab')?.click();
    document.getElementById('newCardButton')?.click();
    if (!await waitEditorOpen('cardEditorModal', 5000)) throw new Error('深度 E2E 集點卡編輯器未開啟。');
    ctx.cardTitle = 'E2E QA 深度集點卡 ' + stamp;
    setField('cardTitle', ctx.cardTitle);
    setField('cardUsageMethod', '深度 E2E 自動集點');
    setField('cardUsageInstructions', '測試管理端發點、票券產生與用戶端即時更新。');
    setField('cardBenefitDescription', '2 點取得深度 E2E 測試票券');
    setField('cardStatus', 'active');
    setField('cardExpiryMode', 'unlimited');

    const threshold = await waitFor(() => document.querySelector('#rewardRows [data-field="thresholdStamps"]'), 3000);
    const select = document.querySelector('#rewardRows [data-field="ticketTemplateId"]');
    if (!threshold || !select) throw new Error('集點卡兌換節點欄位未建立。');
    threshold.value = '2';
    threshold.dispatchEvent(new Event('input', { bubbles: true }));
    select.value = String(ctx.ticketTemplateId);
    select.dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('saveCardButton')?.click();
    ctx.cardId = String(await waitFor(() => document.getElementById('cardId')?.value || null, 15000) || '');
    await waitAdminWriteSettled('saveCardButton');
    if (!ctx.cardId) throw new Error('深度 E2E 集點卡沒有取得 Card ID。');
    if (!await waitFor(() => textIncludes('#cardListItems', ctx.cardTitle), 10000)) throw new Error('深度 E2E 集點卡沒有出現在管理端。');
    closeEditorModalById('cardEditorModal');
    return ctx.cardId;
  }

  async function invalidPointGrantCase(account, cardId) {
    await openGrantForAccount(account);
    toggleCheckbox('grantStampsEnabled', true);
    toggleCheckbox('grantServiceTimeEnabled', false);
    const row = await waitFor(() => document.querySelector('#grantPointRows [data-grant-point-row]'), 3000);
    const select = row?.querySelector('[data-grant-point-field="cardId"]');
    const input = row?.querySelector('[data-grant-point-field="amount"]');
    select.value = String(cardId);
    select.dispatchEvent(new Event('change', { bubbles: true }));
    input.value = '0';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('saveGrantButton')?.click();
    const zeroRejected = Boolean(await waitFor(() => /1–100/.test(String(document.getElementById('grantFormMessage')?.textContent || '')), 1500));
    input.value = '101';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('saveGrantButton')?.click();
    const tooLargeRejected = Boolean(await waitFor(() => /1–100/.test(String(document.getElementById('grantFormMessage')?.textContent || '')), 1500));
    document.getElementById('cancelGrantButton')?.click();
    return { zeroRejected, tooLargeRejected };
  }

  function childPointState(child, cardId, cardTitle, ticketTitle) {
    const tabs = Array.from(child?.document?.querySelectorAll('#cardTabs [data-card-id]') || []);
    const tab = tabs.find((node) => String(node.dataset.cardId || '') === String(cardId || '')) || null;
    return {
      cardVisible: Boolean(tab && String(tab.textContent || '').includes(cardTitle)),
      activeTitle: String(child?.document?.getElementById('activeCardTitle')?.textContent || '').trim(),
      points: Number(String(child?.document?.getElementById('progressCount')?.textContent || '0').replace(/[^0-9-]/g, '') || 0),
      ticketVisible: String(child?.document?.getElementById('ticketList')?.textContent || '').includes(ticketTitle),
      ticketHistoryVisible: String(child?.document?.getElementById('ticketHistoryList')?.textContent || '').includes(ticketTitle)
    };
  }

  async function selectChildCard(child, cardId) {
    const tab = await waitFor(() => {
      try { return Array.from(child.document.querySelectorAll('#cardTabs [data-card-id]')).find((node) => String(node.dataset.cardId || '') === String(cardId || '')) || null; }
      catch { return null; }
    }, 12000, 120);
    if (!tab) return false;
    tab.click();
    return Boolean(await waitFor(() => String(child.document.getElementById('activeCardTitle')?.textContent || '').trim() !== '', 3000));
  }

  async function redeemDeepTicketInChild(child, ticketTitle, expectLottery = false) {
    const checkbox = await waitFor(() => {
      try {
        return Array.from(child.document.querySelectorAll('#ticketList [data-ticket-select]')).find((node) => {
          const host = node.closest('article,li,section,div');
          return String(host?.textContent || '').includes(ticketTitle);
        }) || null;
      } catch { return null; }
    }, 10000, 120);
    if (!checkbox) return { selected: false, cancelledOnce: false, redeemed: false, lotteryResultVisible: false, history: false };
    checkbox.checked = true;
    checkbox.dispatchEvent(new child.Event('change', { bubbles: true }));
    const useButton = await waitFor(() => {
      try {
        const button = child.document.querySelector('.ticket-overview-use');
        return button && !button.disabled ? button : null;
      } catch { return null; }
    }, 3000);
    if (!useButton) return { selected: true, cancelledOnce: false, redeemed: false, lotteryResultVisible: false, history: false };
    useButton.click();
    const modal = await waitFor(() => {
      try {
        const node = child.document.getElementById('ticketBatchModal');
        return node && !node.classList.contains('hidden') ? node : null;
      } catch { return null; }
    }, 3000);
    if (!modal) return { selected: true, cancelledOnce: false, redeemed: false, lotteryResultVisible: false, history: false };
    modal.querySelector('.ticket-batch-cancel')?.click();
    const cancelledOnce = Boolean(await waitFor(() => modal.classList.contains('hidden'), 1800));
    useButton.click();
    await waitFor(() => !modal.classList.contains('hidden'), 1800);
    modal.querySelector('.ticket-batch-confirm')?.click();
    const completed = await waitFor(() => {
      const confirm = modal.querySelector('.ticket-batch-confirm');
      return confirm && confirm.dataset.mode === 'close' && !confirm.disabled ? confirm : null;
    }, 12000, 120);
    const redeemed = Boolean(completed);
    const resultText = String(modal.querySelector('[data-batch-list]')?.textContent || '');
    const lotteryResultVisible = expectLottery ? /抽中：/.test(resultText) : true;
    completed?.click();
    const history = Boolean(await waitFor(() => String(child.document.getElementById('ticketHistoryList')?.textContent || '').includes(ticketTitle), 12000, 120));
    return { selected: true, cancelledOnce, redeemed, lotteryResultVisible, resultText, history };
  }

  async function verifyPointRecordInAdmin(account, expectedText) {
    await ensureTestRoster(account);
    const row = Array.from(document.querySelectorAll('#memberTableBody tr')).find((item) => item.textContent?.includes(String(account.memberCode || '')));
    const button = row?.querySelector('button[data-action="view-records"]');
    if (!button) return false;
    button.click();
    const modal = await waitFor(() => {
      const node = document.getElementById('memberRecordsModal');
      return node && !node.classList.contains('hidden') ? node : null;
    }, 7000);
    if (!modal) return false;
    modal.querySelector('[data-record-filter="pointCards"]')?.click();
    const visible = Boolean(await waitFor(() => String(modal.querySelector('#memberRecordsList')?.textContent || '').includes(expectedText), 10000, 120));
    document.getElementById('closeMemberRecordsModal')?.click();
    return visible;
  }

  async function deleteDeepPointCard(ctx) {
    if (!ctx.cardId) return true;
    document.getElementById('cardsTab')?.click();
    document.getElementById('cardSettingsTab')?.click();
    const row = document.querySelector('#cardListItems [data-card-id="' + CSS.escape(ctx.cardId) + '"]');
    row?.click();
    if (!await waitFor(() => String(document.getElementById('cardId')?.value || '') === String(ctx.cardId), 5000)) return false;
    return withAutoConfirm(async () => {
      document.getElementById('deleteCardButton')?.click();
      const deleted = Boolean(await waitFor(() => !String(document.getElementById('cardId')?.value || ''), 15000));
      closeEditorModalById('cardEditorModal');
      return deleted;
    });
  }

  async function deepPointTicketRealtimeCase(ctx) {
    const account = ctx.account;
    const participant = ctx.participant;
    const pointsLogin = await createPairedSession(account, 'points');
    seedParticipantSession(participant, pointsLogin);
    const child = await waitParticipantSurface(participant, 'points', 'pointsView');
    const baselineTabs = String(child.document.getElementById('cardTabs')?.textContent || '');

    await createDeepPointCard(ctx);
    const cardRealtime = Boolean(await waitFor(() => {
      try { return Array.from(child.document.querySelectorAll('#cardTabs [data-card-id]')).some((node) => String(node.dataset.cardId || '') === String(ctx.cardId)); }
      catch { return false; }
    }, 12000, 120));
    await selectChildCard(child, ctx.cardId);
    const invalid = await invalidPointGrantCase(account, ctx.cardId);

    const session = await adminSession();
    const requestId = 'E2E-PTS-' + qaCrudStamp();
    const payload = {
      lineUserId: account.lineUserId,
      requestId,
      messagePresetId: '',
      points: [{ cardId: ctx.cardId, amount: 1 }]
    };
    const replay = await Promise.allSettled([
      window.MemberSystem.request(session.config, 'admin', session.idToken, 'admin.member-grants.add', payload),
      window.MemberSystem.request(session.config, 'admin', session.idToken, 'admin.member-grants.add', payload)
    ]);
    const replayRealtime = Boolean(await waitFor(() => childPointState(child, ctx.cardId, ctx.cardTitle, ctx.ticketTitle).points === 1, 12000, 120));

    await submitPointGrant(account, ctx.cardId, 1, true);
    const awarded = Boolean(await waitFor(() => {
      const snapshot = childPointState(child, ctx.cardId, ctx.cardTitle, ctx.ticketTitle);
      return snapshot.points === 2 && snapshot.ticketVisible;
    }, 15000, 120));
    const beforeRedeem = childPointState(child, ctx.cardId, ctx.cardTitle, ctx.ticketTitle);
    const userRedeem = await redeemDeepTicketInChild(child, ctx.ticketTitle, true);
    const adminRecordVisible = await verifyPointRecordInAdmin(account, ctx.cardTitle);

    const deleted = await deleteDeepPointCard(ctx);
    ctx.cardDeleted = deleted;
    const cardRemovedRealtime = Boolean(await waitFor(() => {
      try { return !Array.from(child.document.querySelectorAll('#cardTabs [data-card-id]')).some((node) => String(node.dataset.cardId || '') === String(ctx.cardId)); }
      catch { return false; }
    }, 12000, 120));

    const actual = {
      baselineHadQaCard: baselineTabs.includes(ctx.cardTitle || '---'),
      sessionSurface: 'points',
      cardRealtime,
      invalid,
      replayRequests: replay.map((item) => item.status),
      replayRealtime,
      doubleSubmitResult: beforeRedeem,
      awarded,
      userRedeem,
      adminRecordVisible,
      cardDeleted: deleted,
      cardRemovedRealtime
    };
    const ok = cardRealtime && Object.values(invalid).every(Boolean) && replayRealtime && awarded &&
      beforeRedeem.points === 2 && userRedeem.selected && userRedeem.cancelledOnce && userRedeem.redeemed &&
      userRedeem.lotteryResultVisible && userRedeem.history && adminRecordVisible && deleted && cardRemovedRealtime;
    return ok
      ? pass('票券／點數已完成 points 專屬 Session、管理端建立、非法輸入、同 requestId 併發重送、UI 連點發放、用戶端即時出票與真人核銷，再反向同步到管理端紀錄並清理。', {
          sessionSurface: 'points', cardRealtime: true, invalidRejected: true, replayPoints: 1, finalPointsBeforeRedeem: 2,
          ticketRealtime: true, lotteryResultVisible: true, userRedeemed: true, adminRecordVisible: true, cleanupRealtime: true
        }, actual)
      : fail('票券／點數深度協同 E2E 發現狀態不一致。', {
          sessionSurface: 'points', cardRealtime: true, invalidRejected: true, replayPoints: 1, finalPointsBeforeRedeem: 2,
          ticketRealtime: true, lotteryResultVisible: true, userRedeemed: true, adminRecordVisible: true, cleanupRealtime: true
        }, actual);
  }

  async function cleanupDeepContext(ctx) {
    const result = {
      tierRestored: !ctx.tierSettingsChanged,
      postTestAutoCleanupSkipped: true,
      accountPreserved: Boolean(ctx.account),
      originalSessionRestored: false
    };
    if (ctx.tierSettingsChanged && Array.isArray(ctx.originalTierSettings)) {
      try {
        await ensureTestRoster(ctx.account);
        await saveTierSettingsViaUi(ctx.originalTierSettings);
        result.tierRestored = true;
      } catch {}
    }
    if (ctx.originalLogin && ctx.participant?.window && !ctx.participant.window.closed) {
      try {
        seedParticipantSession(ctx.participant, ctx.originalLogin);
        navigateParticipant(ctx.participant, ctx.originalSurface || 'member');
        result.originalSessionRestored = true;
      } catch {}
    } else {
      result.originalSessionRestored = true;
    }
    return result;
  }

  async function runDeepPairedSuite(participant) {
    const previousAdminAccount = state.adminTestAccount;
    const ctx = {
      participant,
      originalLogin: participant.login || null,
      originalSurface: participant.lastSurfaceKey || 'member',
      account: null,
      originalTierSettings: null,
      tierSettingsChanged: false,
      cardId: '',
      ticketTemplateId: '',
      cardDeleted: false
    };
    participant.status = '深度互動';
    participant.surface = '票券／階級／點數／時數';
    renderParticipants();
    try {
      ctx.account = await createEphemeralTestAccount();
      state.adminTestAccount = ctx.account;
      const login = await createPairedSession(ctx.account, 'member');
      seedParticipantSession(participant, login);
      await executeCases([
        caseDef('PAIRED_DEEP_SERVICE_TIER_REALTIME', '深度：會員階級／服務時數跨端 Realtime + 冪等 + 連點', 'Paired E2E / Membership', () => deepServiceTierRealtimeCase(ctx)),
        caseDef('PAIRED_DEEP_POINT_TICKET_REALTIME', '深度：票券／發放點數跨端 Realtime + 核銷回寫', 'Paired E2E / Points', () => deepPointTicketRealtimeCase(ctx))
      ], '深度協同 · 臨時測試會員');
    } finally {
      const retention = ctx.account ? await cleanupDeepContext(ctx) : {
        tierRestored: true,
        postTestAutoCleanupSkipped: true,
        accountPreserved: true,
        originalSessionRestored: true
      };
      state.results.push({
        key: 'PAIRED_DEEP_RETENTION',
        name: '深度 E2E：保留測試資料並還原共用設定',
        domain: 'Paired E2E / Retention',
        status: Object.values(retention).every(Boolean) ? 'passed' : 'failed',
        message: Object.values(retention).every(Boolean)
          ? '臨時測試會員與未被測試流程主動刪除的 QA 資料已保留；共用會員階級設定與原始測試視窗 Session 已還原。'
          : '深度 E2E 的資料保留或共用設定還原有未完成項目，請依 Actual 檢查。',
        expected: { tierRestored: true, postTestAutoCleanupSkipped: true, accountPreserved: true, originalSessionRestored: true },
        actual: retention,
        durationMs: 0
      });
      state.adminTestAccount = previousAdminAccount;
      participant.status = '完成';
      participant.surface = '完成';
      renderParticipants();
      render();
    }
  }


  window.MemberAdminE2EControl = Object.freeze({
    version: VERSION,
    runQuick: () => runAdmin('quick'),
    runFull: () => runAdmin('full'),
    runBookingPending: () => runAdminBookingQueueE2E('pending'),
    runBookingCancellation: () => runAdminBookingQueueE2E('cancellation'),
    runBookingFull: () => runPaired({ bookingOnly: true }),
    runPairedFull: () => runPaired(),
    stop: () => requestStop(),
    maxPairedParticipants: MAX_PAIRED_PARTICIPANTS
  });
})();
