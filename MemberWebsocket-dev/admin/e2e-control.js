(() => {
  'use strict';

  const VERSION = '2026-09-22.3';
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
    adminTestAccount: null
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
          <p>管理端會員操作只允許測試用戶。協同模式會依設定人數開啟獨立用戶端視窗，每位測試用戶都在自己的視窗依序執行會員卡、集點卡、活動票券、日曆與預約真人 E2E，再回管理端確認測試紀錄已同步。</p>
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

  async function recordRun(runnerKind, suite, memberId = '') {
    const session = await adminSession();
    return postFunction('test-control-api', {
      action: 'admin.test-control.record-browser-run',
      clientType: 'admin',
      idToken: session.idToken,
      runnerKind,
      suite,
      memberId: memberId || undefined,
      cases: state.results.map((item) => ({
        key: item.key,
        name: item.name,
        domain: item.domain,
        status: item.status,
        message: item.message,
        expected: safe(item.expected),
        actual: safe(item.actual),
        durationMs: Number(item.durationMs || 0)
      }))
    });
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
    setBusy(true, '協同');
    setMessage('正在準備 ' + participantCount + ' 位測試用戶；所有用戶端就緒後會同時開始完整 E2E。');
    try {
      const accounts = await prepareTestAccounts(participantCount);
      state.adminTestAccount = accounts[0];
      state.participants = accounts.map((account, index) => ({
        index: index + 1,
        account,
        window: openedWindows[index],
        status: '準備登入',
        surface: '準備中',
        runCodes: [],
        startedAt: 0
      }));
      renderParticipants();

      await Promise.all(state.participants.map(async (participant) => {
        if (state.cancelled) return;
        const login = await createPairedSession(participant.account);
        seedParticipantSession(participant, login);
        participant.status = '已登入';
        participant.surface = '會員卡';
        navigateParticipant(participant, 'member');
        state.results.push({
          key: 'PAIRED_' + participant.index + '_TEST_SESSION',
          name: '測試用戶 ' + participant.index + '：建立獨立 Session',
          domain: 'Authentication',
          status: 'passed',
          message: '已建立短效測試會員 Session，並寫入該測試用戶自己的新視窗；未使用正式用戶、管理員權限或 service role。',
          expected: { isTestAccount: true, isolatedClientWindow: true },
          actual: { memberCode: participant.account?.memberCode || null, isolatedClientWindow: true },
          durationMs: 0
        });
        renderParticipants();
        render();
      }));

      if (!state.cancelled) {
        setMessage('所有 ' + participantCount + ' 個用戶端視窗已就緒；現在同時啟動用戶端 E2E，管理端 E2E 也同步執行。');
        const clientTasks = state.participants.map((participant) => runParticipantSurfaces(participant));
        const adminTask = executeCases(adminDefinitions('full'), '管理端 · 測試用戶');
        await Promise.all([adminTask, ...clientTasks]);
      }

      if (!state.cancelled) {
        for (const participant of state.participants) {
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
        }
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
          ? '協同 E2E 已停止；已完成案例保留，用戶端視窗保留供檢查。'
          : failed
            ? participantCount + ' 位測試用戶協同 E2E 完成，發現 ' + failed + ' 個異常；用戶端視窗保留供檢查。'
            : participantCount + ' 位測試用戶已同步並行完成管理端 ↔ 用戶端協同 E2E；用戶端視窗保留供檢查。',
        !cancelled && failed > 0
      );
      return { cancelled, recorded, participants: safe(state.participants.map((item) => item.account)), results: safe(state.results) };
    } catch (error) {
      if (!state.cancelled) {
        state.results.push({
          key: 'PAIRED_RUNNER_FATAL',
          name: '協同 Runner 啟動',
          domain: 'Paired E2E',
          status: 'failed',
          message: error?.message || '協同 Runner 無法啟動。',
          expected: { runnable: true, testAccountsOnly: true },
          actual: plainError(error),
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
    renderParticipants();

    for (const [surface, label] of PAIRED_SURFACES) {
      if (state.cancelled) break;
      const started = performance.now();
      const row = {
        key: 'PAIRED_' + participant.index + '_' + surface.toUpperCase(),
        name: '測試用戶 ' + participant.index + '：' + label + '真人 E2E',
        domain: 'Paired E2E / ' + surface,
        status: 'running',
        message: '正在獨立用戶端視窗執行…',
        expected: { memberCode: participant.account?.memberCode || null, failedCases: 0 },
        actual: {},
        durationMs: null
      };
      state.results.push(row);
      participant.status = '執行中';
      participant.surface = label;
      renderParticipants();
      render();
      if (state.floating) state.floating.textContent = 'E2E 執行中 · 多用戶並行 · 測試用戶 ' + participant.index + ' · ' + label;
      try {
        const child = await runUserSurface(participant, surface, label);
        const summary = child?.summary || {};
        const childMemberId = child?.account?.memberId || '';
        const runCode = String(child?.browserRun?.runCode || '');
        if (runCode) participant.runCodes.push(runCode);
        row.actual = {
          memberCode: participant.account?.memberCode || null,
          sameTestMember: childMemberId === participant.account?.memberId,
          passed: Number(summary.passed || 0),
          failed: Number(summary.failed || 0),
          skipped: Number(summary.skipped || 0),
          total: Number(summary.total || 0),
          runCode: runCode || null,
          cancelled: Boolean(child?.cancelled)
        };
        if (state.cancelled || child?.cancelled) {
          Object.assign(row, skip(label + ' E2E 已依停止要求中止。', { stoppedSafely: true }, row.actual));
        } else {
          const sameMember = childMemberId === participant.account?.memberId;
          const ok = child?.ok === true && Number(summary.failed || 0) === 0 && sameMember;
          Object.assign(row, ok
            ? pass(label + '真人 E2E 通過，且仍為指定測試用戶。', row.expected, row.actual)
            : fail(label + '真人 E2E 或測試用戶一致性驗證失敗。', row.expected, row.actual));
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
    let accounts = activeTestAccounts(data);
    if (accounts.length < count) {
      const shortage = count - accounts.length;
      const settings = data?.settings || {};
      data = await postAdminTestMode('admin.test-mode.save', {
        maintenanceEnabled: Boolean(settings.maintenanceEnabled),
        allowPcTestLogin: Boolean(settings.allowPcTestLogin),
        allowMobileTestLogin: Boolean(settings.allowMobileTestLogin),
        maintenanceMessage: String(settings.maintenanceMessage || ''),
        addAccountCount: shortage
      });
      accounts = activeTestAccounts(data);
    }
    if (accounts.length < count) {
      throw new Error(`啟用中的測試用戶不足：需要 ${count} 位，目前只有 ${accounts.length} 位。`);
    }
    return accounts.slice(0, count);
  }

  async function createPairedSession(account) {
    const session = await adminSession();
    if (!account?.memberId) throw new Error('測試用戶識別不完整。');
    const common = { clientType: 'member' };
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
    if (!login.testSessionToken || login.account?.memberId !== account.memberId) {
      throw new Error('指定測試用戶 Session 建立不完整或帳號不一致。');
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

    const result = await control.runFull();
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

  window.MemberAdminE2EControl = Object.freeze({
    version: VERSION,
    runQuick: () => runAdmin('quick'),
    runFull: () => runAdmin('full'),
    runPairedFull: () => runPaired(),
    stop: () => requestStop(),
    maxPairedParticipants: MAX_PAIRED_PARTICIPANTS
  });
})();
