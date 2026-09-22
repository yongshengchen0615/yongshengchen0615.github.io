(() => {
  'use strict';

  const VERSION = '2026-09-22.8';
  const TEST_SESSION_STORAGE_KEY = 'member-test-session-v1';
  const MAX_PAIRED_PARTICIPANTS = 10;
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
          <button id="runPairedFullE2EButton" class="button button-dark" type="button" data-admin-e2e-control="true">管理端 ↔ 用戶端完整 E2E</button>
          <button id="stopAdminE2EButton" class="button button-danger hidden" type="button" data-admin-e2e-stop="true">停止 E2E</button>
        </div>
      </div>
      <div class="admin-e2e-paired-config">
        <label for="pairedE2EAccountCount"><strong>協同測試人數</strong><input id="pairedE2EAccountCount" type="number" min="1" max="10" step="1" value="1" inputmode="numeric"></label>
        <small>1–10 人。若啟用中的測試用戶不足，系統會自動補建；每位測試用戶會使用獨立的新用戶端視窗，正式用戶不會被選入。</small>
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

  function caseDef(key, name, domain, run) {
    return { key, name, domain, run };
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

  async function executeCases(defs, phaseLabel) {
    for (const def of defs) {
      if (state.cancelled) break;
      const row = {
        key: def.key,
        name: def.name,
        domain: def.domain,
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
        Object.assign(row, await def.run());
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

  async function recordRun(runnerKind, suite, memberId = '') {
    const session = await adminSession();
    const cases = state.results.map((item) => {
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
      startedAt: state.runStartedAt || undefined,
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

  async function runPaired() {
    if (state.running) return;
    state.cancelled = false;
    state.runSequence += 1;
    let participantCount = 1;
    let openedWindows = [];
    try {
      participantCount = selectedParticipantCount();
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
        surfacePlan: shuffled(PAIRED_SURFACES),
        runCodes: [],
        startedAt: 0,
        login: null,
        lastSurfaceKey: ''
      }));
      renderParticipants();

      setMessage('管理端前置資料已完整建立；現在隨機啟動 ' + participantCount + ' 位測試用戶，各自以不同用戶端順序與操作間隔開始 E2E。');
      if (!state.cancelled) {
        const clientTasks = state.participants.map(async (participant) => {
          await sleep(randomInt(80, 1200));
          return runParticipantSurfaces(participant);
        });
        const adminTask = executeCases(adminDefinitions('full'), '管理端 · 完整資料已建立');
        await Promise.all([adminTask, ...clientTasks]);
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

      if (!state.cancelled && state.participants[0]) {
        await runDeepPairedSuite(state.participants[randomInt(0, state.participants.length - 1)]);
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
    participant.startedAt = Date.now();
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
        expected: { memberCode: participant.account?.memberCode || null, failedCases: 0, sessionSurface: surface },
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
        const summary = child?.summary || {};
        const childMemberId = child?.account?.memberId || '';
        const runCode = String(child?.browserRun?.runCode || '');
        if (runCode) participant.runCodes.push(runCode);
        row.actual = {
          memberCode: participant.account?.memberCode || null,
          sessionSurface: surface,
          sameTestMember: childMemberId === participant.account?.memberId,
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
          const ok = child?.ok === true && Number(summary.failed || 0) === 0 && sameMember;
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

    setField('ticketTitle', title);
    setField('ticketType', 'coupon');
    setField('ticketDescription', options.description || 'E2E QA 深度測試票券，完成後由 Test Control 清理。');
    setField('ticketUsageMethod', options.usageMethod || '僅供自動化 E2E');
    setField('ticketUsageInstructions', options.usageInstructions || '不可供正式會員使用；測試完成後自動清理。');
    setField('ticketStatus', options.status || 'active');
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

  async function adminPointCardCrudCase() {
    const stamp = qaCrudStamp();
    const createdTitle = 'E2E 集點卡 ' + stamp;
    const updatedTitle = createdTitle + ' 修改';
    const actual = { created: false, updated: false, deleted: false, cleaned: false, usedExistingTicket: false, seededTicket: false, ticketCleaned: true };
    let createdId = '';
    let qaTicketTemplateId = '';

    document.getElementById('cardsTab')?.click();
    document.getElementById('cardSettingsTab')?.click();
    document.getElementById('newCardButton')?.click();
    const modal = await waitEditorOpen('cardEditorModal');
    if (!modal) return fail('集點卡新增編輯器未開啟。', { editorOpen: true }, { editorOpen: false });

    try {
      setField('cardTitle', createdTitle);
      setField('cardUsageMethod', 'E2E 測試用集點方式');
      setField('cardUsageInstructions', '此資料由管理端 E2E 建立，測試完成後自動刪除。');
      setField('cardBenefitDescription', '管理端 CRUD E2E');
      setField('cardStatus', 'draft');
      setField('cardExpiryMode', 'unlimited');

      let rewardSelect = await waitFor(() => document.querySelector('#rewardRows [data-field="ticketTemplateId"]'), 3000);
      let ticketOption = rewardSelect ? Array.from(rewardSelect.options).find((option) => option.value && !option.disabled) : null;
      if (!rewardSelect || !ticketOption) {
        closeEditorModalById('cardEditorModal');
        const fixture = await createQaTicketTemplate('E2E QA 深度票券 卡片前置 ' + stamp, { status: 'active' });
        qaTicketTemplateId = fixture.ticketTemplateId;
        actual.seededTicket = true;
        closeEditorModalById('ticketEditorModal');
        document.getElementById('cardSettingsTab')?.click();
        document.getElementById('newCardButton')?.click();
        if (!await waitEditorOpen('cardEditorModal', 5000)) throw new Error('建立 QA 票券後無法重新開啟集點卡編輯器。');
        setField('cardTitle', createdTitle);
        setField('cardUsageMethod', 'E2E 測試用集點方式');
        setField('cardUsageInstructions', '此資料由管理端 E2E 建立，測試完成後自動刪除。');
        setField('cardBenefitDescription', '管理端 CRUD E2E');
        setField('cardStatus', 'draft');
        setField('cardExpiryMode', 'unlimited');
        rewardSelect = await waitFor(() => document.querySelector('#rewardRows [data-field="ticketTemplateId"]'), 5000);
        ticketOption = rewardSelect ? Array.from(rewardSelect.options).find((option) => option.value === qaTicketTemplateId && !option.disabled) : null;
      }
      if (!rewardSelect || !ticketOption) {
        return fail('集點卡 CRUD 無法取得可用票券；自動建立 QA 前置資料後仍失敗。', { activeTicketAvailable: true }, { activeTicketAvailable: false, seededTicket: actual.seededTicket });
      }
      const threshold = document.querySelector('#rewardRows [data-field="thresholdStamps"]');
      if (threshold) {
        threshold.value = '97';
        threshold.dispatchEvent(new Event('input', { bubbles: true }));
      }
      rewardSelect.value = ticketOption.value;
      rewardSelect.dispatchEvent(new Event('change', { bubbles: true }));
      actual.usedExistingTicket = true;

      document.getElementById('saveCardButton')?.click();
      createdId = String(await waitFor(() => document.getElementById('cardId')?.value || null, 15000) || '');
      await waitAdminWriteSettled('saveCardButton');
      actual.created = Boolean(createdId && await waitFor(() => textIncludes('#cardListItems', createdTitle), 10000));

      if (actual.created) {
        setField('cardTitle', updatedTitle);
        setField('cardBenefitDescription', '管理端 CRUD E2E 已完成修改');
        document.getElementById('saveCardButton')?.click();
        await waitAdminWriteSettled('saveCardButton');
        await clickResourceRow('#cardListItems [data-card-id]', 'cardId', createdId);
        actual.updated = Boolean(await waitFor(() => {
          return String(document.getElementById('cardId')?.value || '') === createdId &&
            String(document.getElementById('cardTitle')?.value || '') === updatedTitle &&
            textIncludes('#cardListItems', updatedTitle);
        }, 8000));
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

    const ok = actual.created && actual.updated && actual.deleted && actual.cleaned && actual.usedExistingTicket && actual.ticketCleaned;
    return ok
      ? pass('已透過管理端 UI 完成集點卡新增、修改、永久刪除，QA 資料已清理。', { created: true, updated: true, deleted: true, cleaned: true }, actual)
      : fail('集點卡 CRUD E2E 至少一個階段失敗。', { created: true, updated: true, deleted: true, cleaned: true }, actual);
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
    const ok = Object.values(actual).every(Boolean);
    return ok
      ? pass('預約管理四個子分頁與新增類型／項目視窗皆可操作。', { allBookingControls: true }, actual)
      : fail('至少一個預約管理控制異常。', { allBookingControls: true }, actual);
  }

  async function adminTestModeControlsCase() {
    document.getElementById('testModeTab')?.click();
    const ids = [
      'testModePcLoginEnabled', 'testModeMobileLoginEnabled', 'testModeMaintenanceMessage',
      'testModeAddAccountCount', 'saveTestModeButton', 'runQuickAutomationTestButton',
      'runFullAutomationTestButton', 'runAdminQuickE2EButton', 'runAdminFullE2EButton',
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
        Boolean(id && /^(retry|logout|members|cards|events|calendar|testMode|refresh|tier|manageGrant|saveTier|realMembers|testMembers|member|card|ticket|event|adminCalendar|saveTestMode|deleteSelectedTestAccounts|runQuickAutomation|runFullAutomation|close|cancel|save|grant|messagePreset|booking|runAdmin|runPaired|add|queue|delete|clear|new|reset|archive|balance)/i.test(id)) ||
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
      status.textContent = `${participant.status || '準備中'} · ${participant.surface || '—'}`;
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
    ctx.ticketTitle = 'E2E QA 深度票券 點數 ' + stamp;
    const ticket = await createQaTicketTemplate(ctx.ticketTitle, { status: 'active' });
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

  async function redeemDeepTicketInChild(child, ticketTitle) {
    const checkbox = await waitFor(() => {
      try {
        return Array.from(child.document.querySelectorAll('#ticketList [data-ticket-select]')).find((node) => {
          const host = node.closest('article,li,section,div');
          return String(host?.textContent || '').includes(ticketTitle);
        }) || null;
      } catch { return null; }
    }, 10000, 120);
    if (!checkbox) return { selected: false, cancelledOnce: false, redeemed: false, history: false };
    checkbox.checked = true;
    checkbox.dispatchEvent(new child.Event('change', { bubbles: true }));
    const useButton = await waitFor(() => {
      try {
        const button = child.document.querySelector('.ticket-overview-use');
        return button && !button.disabled ? button : null;
      } catch { return null; }
    }, 3000);
    if (!useButton) return { selected: true, cancelledOnce: false, redeemed: false, history: false };
    useButton.click();
    const modal = await waitFor(() => {
      try {
        const node = child.document.getElementById('ticketBatchModal');
        return node && !node.classList.contains('hidden') ? node : null;
      } catch { return null; }
    }, 3000);
    if (!modal) return { selected: true, cancelledOnce: false, redeemed: false, history: false };
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
    completed?.click();
    const history = Boolean(await waitFor(() => String(child.document.getElementById('ticketHistoryList')?.textContent || '').includes(ticketTitle), 12000, 120));
    return { selected: true, cancelledOnce, redeemed, history };
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
    const userRedeem = await redeemDeepTicketInChild(child, ctx.ticketTitle);
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
      userRedeem.history && adminRecordVisible && deleted && cardRemovedRealtime;
    return ok
      ? pass('票券／點數已完成 points 專屬 Session、管理端建立、非法輸入、同 requestId 併發重送、UI 連點發放、用戶端即時出票與真人核銷，再反向同步到管理端紀錄並清理。', {
          sessionSurface: 'points', cardRealtime: true, invalidRejected: true, replayPoints: 1, finalPointsBeforeRedeem: 2,
          ticketRealtime: true, userRedeemed: true, adminRecordVisible: true, cleanupRealtime: true
        }, actual)
      : fail('票券／點數深度協同 E2E 發現狀態不一致。', {
          sessionSurface: 'points', cardRealtime: true, invalidRejected: true, replayPoints: 1, finalPointsBeforeRedeem: 2,
          ticketRealtime: true, userRedeemed: true, adminRecordVisible: true, cleanupRealtime: true
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
    runPairedFull: () => runPaired(),
    stop: () => requestStop(),
    maxPairedParticipants: MAX_PAIRED_PARTICIPANTS
  });
})();
