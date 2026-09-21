(() => {
  'use strict';

  const VERSION = '2026-09-21.1';
  const HISTORY_KEY = 'member-user-qa-history-v1';
  const PANEL_ID = 'userAutomationTestPanel';
  const LAUNCHER_ID = 'userAutomationTestLauncher';
  const MAX_HISTORY = 5;

  const SURFACES = Object.freeze({
    member: {
      label: '會員卡',
      rootId: 'memberView',
      essentialIds: ['memberPass', 'memberCode', 'memberHonorificName', 'memberBirthday', 'memberPhone', 'membershipProgress'],
      bootstrapAction: 'user.member.bootstrap'
    },
    points: {
      label: '集點卡',
      rootId: 'pointsView',
      essentialIds: ['cardTabs', 'activeCardView', 'ticketList', 'ticketHistoryList', 'membershipProgress'],
      bootstrapAction: 'user.pointcard.bootstrap'
    },
    event: {
      label: '活動票券',
      rootId: 'eventView',
      essentialIds: ['eventList', 'eventSummary', 'ticketModal', 'usedTicketList', 'membershipProgress'],
      bootstrapAction: 'user.event.bootstrap'
    },
    calendar: {
      label: '活動日曆',
      rootId: 'calendarView',
      essentialIds: ['calendarGrid', 'monthTitle', 'previousMonthButton', 'nextMonthButton', 'calendarDetailModal'],
      bootstrapAction: 'user.calendar.bootstrap'
    },
    booking: {
      label: '預約',
      rootId: 'bookingView',
      essentialIds: ['bookingForm', 'servicePicker', 'bookingDate', 'slotGrid', 'bookingList', 'bookingConfirmModal'],
      bootstrapAction: 'user.booking.bootstrap'
    }
  });

  const surface = detectSurface();
  const definition = SURFACES[surface];
  if (!definition) return;

  const state = {
    config: null,
    session: null,
    visible: false,
    running: false,
    cancelled: false,
    currentSuite: 'quick',
    results: [],
    bootstrap: null,
    mutationSuite: null,
    launcher: null,
    panel: null
  };

  window.addEventListener('DOMContentLoaded', () => {
    void synchronizeAvailability();
  });
  window.addEventListener('member-test-session-ready', () => {
    void synchronizeAvailability();
  });
  window.addEventListener('pageshow', () => {
    void synchronizeAvailability();
  });

  function detectSurface() {
    const match = String(window.location.pathname || '').match(/\/MemberWebsocket-dev\/(member|points|event|calendar|booking)\/?/i);
    return match ? String(match[1] || '').toLowerCase() : '';
  }

  function wait(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function elapsed(start) {
    return Math.max(0, Math.round(performance.now() - start));
  }

  function plainError(error) {
    return {
      code: String(error && error.code || error && error.name || 'ERROR').slice(0, 120),
      message: String(error && error.message || '未知錯誤').slice(0, 500)
    };
  }

  function safeJson(value) {
    if (value === undefined) return null;
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
    if (Array.isArray(value)) return value.slice(0, 20).map(safeJson);
    if (typeof value !== 'object') return String(value);
    const out = {};
    const blocked = /^(?:.*token.*|.*secret.*|password|phone|birthday|lineuserid|line_user_id|surname|displayname)$/i;
    Object.entries(value).slice(0, 40).forEach(([key, item]) => {
      if (blocked.test(key)) {
        out[key] = '[redacted]';
        return;
      }
      out[key] = safeJson(item);
    });
    return out;
  }

  function result(status, message, expected, actual) {
    return {
      status,
      message: String(message || ''),
      expected: safeJson(expected),
      actual: safeJson(actual)
    };
  }

  function pass(message, expected, actual) {
    return result('passed', message, expected, actual);
  }

  function fail(message, expected, actual) {
    return result('failed', message, expected, actual);
  }

  function skip(message, expected, actual) {
    return result('skipped', message, expected, actual);
  }

  async function loadConfig() {
    if (state.config) return state.config;
    if (surface === 'booking') {
      if (!window.BookingSystem || typeof window.BookingSystem.loadConfig !== 'function') throw new Error('BookingSystem 尚未載入。');
      state.config = await window.BookingSystem.loadConfig();
    } else {
      if (!window.MemberSystem || typeof window.MemberSystem.loadConfig !== 'function') throw new Error('MemberSystem 尚未載入。');
      state.config = await window.MemberSystem.loadConfig();
    }
    return state.config;
  }

  async function synchronizeAvailability() {
    try {
      if (!window.TestModeClient || typeof window.TestModeClient.sessionStatus !== 'function') {
        removeUi();
        return;
      }
      const config = await loadConfig();
      const session = await window.TestModeClient.sessionStatus(config);
      const active = Boolean(session && session.active && session.account && session.account.memberId);
      if (!active) {
        state.session = null;
        removeUi();
        return;
      }
      state.session = session;
      ensureUi();
    } catch (_) {
      state.session = null;
      removeUi();
    }
  }

  function removeUi() {
    const launcher = document.getElementById(LAUNCHER_ID);
    const panel = document.getElementById(PANEL_ID);
    if (launcher) launcher.remove();
    if (panel) panel.remove();
    state.launcher = null;
    state.panel = null;
    state.visible = false;
    document.documentElement.classList.remove('user-qa-open');
  }

  function ensureUi() {
    if (document.getElementById(LAUNCHER_ID) && document.getElementById(PANEL_ID)) return;

    const launcher = document.createElement('button');
    launcher.id = LAUNCHER_ID;
    launcher.type = 'button';
    launcher.className = 'user-qa-launcher';
    launcher.innerHTML = '<span aria-hidden="true">✓</span><span>自動化測試</span>';
    launcher.addEventListener('click', () => togglePanel(true));

    const panel = document.createElement('aside');
    panel.id = PANEL_ID;
    panel.className = 'user-qa-panel hidden';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', 'userQaTitle');
    panel.innerHTML =
      '<div class="user-qa-shell">' +
        '<header class="user-qa-head">' +
          '<div><p class="user-qa-kicker">Test account QA</p><h2 id="userQaTitle">' + escapeHtml(definition.label) + '自動化測試</h2>' +
          '<p>只在後端驗證通過的測試帳號顯示。完整測試包含 API、UI、驗證邊界與 Realtime，不會自動消耗票券或建立正式交易。</p></div>' +
          '<button type="button" class="user-qa-close" data-qa-close aria-label="關閉">×</button>' +
        '</header>' +
        '<div class="user-qa-account"><span>測試帳號</span><strong data-qa-account>—</strong><small data-qa-version>Runner ' + VERSION + '</small></div>' +
        '<div class="user-qa-actions">' +
          '<button type="button" class="user-qa-button secondary" data-qa-run="quick">快速測試</button>' +
          '<button type="button" class="user-qa-button primary" data-qa-run="full">完整測試</button>' +
          '<button type="button" class="user-qa-button danger hidden" data-qa-cancel>停止</button>' +
        '</div>' +
        '<div class="user-qa-summary" aria-live="polite">' +
          '<div><span>狀態</span><strong data-qa-status>待命</strong></div>' +
          '<div><span>通過</span><strong data-qa-passed>0</strong></div>' +
          '<div><span>失敗</span><strong data-qa-failed>0</strong></div>' +
          '<div><span>略過</span><strong data-qa-skipped>0</strong></div>' +
        '</div>' +
        '<div class="user-qa-progress" role="progressbar" aria-label="自動化測試進度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span data-qa-progress></span></div>' +
        '<p class="user-qa-message" data-qa-message>可執行快速或完整測試。</p>' +
        '<div class="user-qa-results" data-qa-results></div>' +
        '<details class="user-qa-history"><summary>最近測試紀錄</summary><div data-qa-history></div></details>' +
      '</div>';

    panel.querySelector('[data-qa-close]').addEventListener('click', () => togglePanel(false));
    panel.addEventListener('click', (event) => {
      if (event.target === panel) togglePanel(false);
    });
    panel.querySelectorAll('[data-qa-run]').forEach((button) => {
      button.addEventListener('click', () => void runSuite(button.dataset.qaRun || 'quick'));
    });
    panel.querySelector('[data-qa-cancel]').addEventListener('click', () => {
      state.cancelled = true;
      setMessage('已要求停止；目前案例完成後不再執行下一項。');
    });

    document.body.append(launcher, panel);
    state.launcher = launcher;
    state.panel = panel;
    const account = state.session && state.session.account || {};
    panel.querySelector('[data-qa-account]').textContent = String(account.memberCode || '測試會員');
    renderHistory();
  }

  function togglePanel(open) {
    if (!state.panel) return;
    state.visible = Boolean(open);
    state.panel.classList.toggle('hidden', !state.visible);
    document.documentElement.classList.toggle('user-qa-open', state.visible);
    if (state.visible) {
      const close = state.panel.querySelector('[data-qa-close]');
      if (close) close.focus();
    }
  }

  function setMessage(message, isError) {
    if (!state.panel) return;
    const node = state.panel.querySelector('[data-qa-message]');
    node.textContent = String(message || '');
    node.classList.toggle('is-error', Boolean(isError));
  }

  function setRunning(value) {
    state.running = Boolean(value);
    if (!state.panel) return;
    state.panel.querySelectorAll('[data-qa-run]').forEach((button) => { button.disabled = state.running; });
    state.panel.querySelector('[data-qa-cancel]').classList.toggle('hidden', !state.running);
  }

  function setStatus(value) {
    if (!state.panel) return;
    state.panel.querySelector('[data-qa-status]').textContent = String(value || '—');
  }

  function updateSummary(done, total) {
    if (!state.panel) return;
    const passed = state.results.filter((item) => item.status === 'passed').length;
    const failed = state.results.filter((item) => item.status === 'failed').length;
    const skipped = state.results.filter((item) => item.status === 'skipped').length;
    state.panel.querySelector('[data-qa-passed]').textContent = String(passed);
    state.panel.querySelector('[data-qa-failed]').textContent = String(failed);
    state.panel.querySelector('[data-qa-skipped]').textContent = String(skipped);
    const percent = total > 0 ? Math.round((done / total) * 100) : 0;
    const bar = state.panel.querySelector('[data-qa-progress]');
    bar.style.width = percent + '%';
    const progress = bar.parentElement;
    progress.setAttribute('aria-valuenow', String(percent));
  }

  function renderResults() {
    if (!state.panel) return;
    const root = state.panel.querySelector('[data-qa-results]');
    root.replaceChildren(...state.results.map((item, index) => renderCase(item, index)));
  }

  function renderCase(item, index) {
    const details = document.createElement('details');
    details.className = 'user-qa-case is-' + item.status;
    details.open = item.status === 'failed' || item.status === 'running';

    const summary = document.createElement('summary');
    const left = document.createElement('span');
    left.className = 'user-qa-case-title';
    const mark = document.createElement('b');
    mark.textContent = item.status === 'passed' ? '✓' : item.status === 'failed' ? '!' : item.status === 'skipped' ? '–' : '●';
    const copy = document.createElement('span');
    const title = document.createElement('strong');
    title.textContent = (index + 1) + '. ' + item.name;
    const meta = document.createElement('small');
    meta.textContent = item.domain + (item.durationMs != null ? ' · ' + item.durationMs + ' ms' : '');
    copy.append(title, meta);
    left.append(mark, copy);

    const badge = document.createElement('span');
    badge.className = 'user-qa-case-badge';
    badge.textContent = statusLabel(item.status);
    summary.append(left, badge);
    details.append(summary);

    if (item.message) {
      const message = document.createElement('p');
      message.className = 'user-qa-case-message';
      message.textContent = item.message;
      details.append(message);
    }

    if (item.status !== 'running') {
      const grid = document.createElement('div');
      grid.className = 'user-qa-data';
      grid.append(dataBox('Expected', item.expected), dataBox('Actual', item.actual));
      details.append(grid);
    }
    return details;
  }

  function dataBox(label, value) {
    const box = document.createElement('section');
    const title = document.createElement('span');
    title.textContent = label;
    const pre = document.createElement('pre');
    try { pre.textContent = JSON.stringify(value === undefined ? null : value, null, 2); }
    catch (_) { pre.textContent = String(value); }
    box.append(title, pre);
    return box;
  }

  function statusLabel(status) {
    return status === 'passed' ? '通過' : status === 'failed' ? '失敗' : status === 'skipped' ? '略過' : status === 'running' ? '執行中' : '等待';
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
  }

  async function runSuite(suite) {
    if (state.running) return;
    try {
      const session = await window.TestModeClient.sessionStatus(await loadConfig());
      if (!session || !session.active || !session.account || !session.account.memberId) {
        removeUi();
        return;
      }
      state.session = session;
    } catch (error) {
      removeUi();
      return;
    }

    state.currentSuite = suite === 'full' ? 'full' : 'quick';
    state.results = [];
    state.bootstrap = null;
    state.mutationSuite = null;
    state.cancelled = false;
    setRunning(true);
    setStatus('執行中');
    setMessage(state.currentSuite === 'full' ? '正在執行完整用戶端測試…' : '正在執行快速健康檢查…');
    renderResults();

    const cases = buildCases(state.currentSuite);
    updateSummary(0, cases.length);

    for (let index = 0; index < cases.length; index += 1) {
      if (state.cancelled) break;
      const testCase = cases[index];
      const running = {
        name: testCase.name,
        domain: testCase.domain,
        status: 'running',
        message: '執行中…',
        expected: null,
        actual: null,
        durationMs: null
      };
      state.results.push(running);
      renderResults();

      const started = performance.now();
      try {
        const outcome = await testCase.run();
        Object.assign(running, outcome, { durationMs: elapsed(started) });
      } catch (error) {
        Object.assign(running, fail(
          '案例執行發生未預期錯誤。',
          { noUnhandledError: true },
          plainError(error)
        ), { durationMs: elapsed(started) });
      }
      renderResults();
      updateSummary(index + 1, cases.length);
      await wait(40);
    }

    const failed = state.results.filter((item) => item.status === 'failed').length;
    const cancelled = state.cancelled;
    setRunning(false);
    setStatus(cancelled ? '已停止' : failed ? '有異常' : '全部通過');
    setMessage(
      cancelled ? '測試已停止。' :
      failed ? '測試完成，發現 ' + failed + ' 個異常；展開失敗案例查看 Expected / Actual。' :
      '測試完成，所有已執行案例通過。',
      failed > 0
    );
    saveHistory();
    renderHistory();
  }

  function buildCases(suite) {
    const common = [
      caseDef('測試帳號授權邊界', 'Authentication', testSessionCase),
      caseDef('公開設定與 Client 設定', 'Configuration', configCase),
      caseDef('目前頁面載入狀態', 'UI', surfaceReadyCase),
      caseDef(definition.label + ' Bootstrap API', 'API', bootstrapCase),
      caseDef(definition.label + ' 核心 UI 元件', 'UI', essentialDomCase)
    ];
    if (suite !== 'full') return common;

    const fullCommon = [
      caseDef('無測試 Session 必須被拒絕', 'Security', negativeSessionCase),
      caseDef('Realtime 訂閱能力', 'Realtime', realtimeCase)
    ];

    const surfaceCases = {
      member: [
        caseDef('會員資料完整性', 'Member', memberProfileCase),
        caseDef('稱呼／生日／電話編輯視窗', 'UI', memberModalCase),
        caseDef('會員資料寫入驗證邊界', 'Validation', memberInvalidWriteCase),
        caseDef('會員資料成功寫入與還原', 'Mutation QA', () => mutationQaCase('MEMBER_PROFILE_WRITE'))
      ],
      points: [
        caseDef('集點卡／票券資料結構', 'Points', pointsDataCase),
        caseDef('票券使用共用設定', 'Points', pointSettingsCase),
        caseDef('集點卡切換互動', 'UI', pointsInteractionCase),
        caseDef('票券核銷輸入驗證', 'Validation', pointsInvalidWriteCase),
        caseDef('集點票券單筆／批次核銷成功與清理', 'Mutation QA', () => mutationQaCase('POINT_TICKET_WRITE'))
      ],
      event: [
        caseDef('活動票券領取／使用狀態', 'Tickets', eventDataCase),
        caseDef('票券詳情 Modal', 'UI', eventModalCase),
        caseDef('領券與核銷輸入驗證', 'Validation', eventInvalidWriteCase),
        caseDef('活動票券領取／核銷成功與清理', 'Mutation QA', () => mutationQaCase('EVENT_TICKET_WRITE'))
      ],
      calendar: [
        caseDef('指定日期明細 API', 'Calendar', calendarDetailApiCase),
        caseDef('月曆月份切換互動', 'UI', calendarNavigationCase),
        caseDef('日期輸入驗證邊界', 'Validation', calendarInvalidDateCase),
        caseDef('日曆寫入權限邊界', 'Mutation QA', () => mutationQaCase('CALENDAR_READ_ONLY'))
      ],
      booking: [
        caseDef('會員與預約 Bootstrap 一致性', 'Booking', bookingDataCase),
        caseDef('多人預約資源 Bootstrap', 'Booking', bookingGroupBootstrapCase),
        caseDef('預約表單安全初始狀態', 'UI', bookingFormCase),
        caseDef('新增／修改／取消輸入驗證', 'Validation', bookingInvalidWriteCase),
        caseDef('預約新增／修改／取消成功與清理', 'Mutation QA', () => mutationQaCase('BOOKING_WRITE')),
        caseDef('多人預約新增／修改成功與清理', 'Mutation QA', () => mutationQaCase('BOOKING_GROUP_WRITE'))
      ]
    };
    return common.concat(fullCommon, surfaceCases[surface] || []);
  }

  function caseDef(name, domain, run) {
    return { name, domain, run };
  }

  async function testSessionCase() {
    const session = await window.TestModeClient.sessionStatus(await loadConfig());
    const account = session && session.account || {};
    const ok = Boolean(session && session.active && account.memberId && account.memberCode);
    return ok
      ? pass('後端確認目前為有效測試帳號 Session。', { active: true, memberId: true, memberCode: true }, { active: true, memberId: Boolean(account.memberId), memberCode: account.memberCode || '' })
      : fail('後端未確認目前測試 Session。', { active: true }, { active: Boolean(session && session.active) });
  }

  async function configCase() {
    const config = await loadConfig();
    const liffKey = surface === 'member' ? 'memberLiffId'
      : surface === 'points' ? 'pointsLiffId'
      : surface === 'event' ? 'eventLiffId'
      : surface === 'calendar' ? 'calendarLiffId'
      : 'bookingLiffId';
    const urlOk = /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(String(config.supabaseUrl || ''));
    const fnOk = /^https:\/\/[a-z0-9-]+\.supabase\.co\/functions\/v1\/[A-Za-z0-9_-]+$/i.test(String(config.supabaseFunctionUrl || ''));
    const keyOk = /^sb_publishable_/.test(String(config.supabasePublishableKey || ''));
    const liffOk = Boolean(String(config[liffKey] || '').trim());
    const leakedServiceRole = /service_role/i.test(JSON.stringify(config || {}));
    const ok = urlOk && fnOk && keyOk && liffOk && !leakedServiceRole;
    const actual = { supabaseUrlValid: urlOk, functionUrlValid: fnOk, publishableKeyOnly: keyOk, liffConfigured: liffOk, serviceRoleVisible: leakedServiceRole, realtimeEnabled: config.realtimeEnabled !== false };
    return ok
      ? pass('公開設定完整，且未在 Client 設定中發現 service-role 標記。', { supabaseUrlValid: true, functionUrlValid: true, publishableKeyOnly: true, liffConfigured: true, serviceRoleVisible: false }, actual)
      : fail('目前 Client 設定存在缺漏或安全異常。', { supabaseUrlValid: true, functionUrlValid: true, publishableKeyOnly: true, liffConfigured: true, serviceRoleVisible: false }, actual);
  }

  async function surfaceReadyCase() {
    const root = document.getElementById(definition.rootId);
    const errorView = document.getElementById('errorView');
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline && root && root.classList.contains('hidden') && (!errorView || errorView.classList.contains('hidden'))) {
      await wait(120);
    }
    const actual = {
      rootExists: Boolean(root),
      rootVisible: Boolean(root && !root.classList.contains('hidden')),
      errorVisible: Boolean(errorView && !errorView.classList.contains('hidden'))
    };
    return actual.rootExists && actual.rootVisible && !actual.errorVisible
      ? pass('目前用戶端主畫面已完成登入與渲染。', { rootExists: true, rootVisible: true, errorVisible: false }, actual)
      : fail('用戶端沒有進入正常主畫面。', { rootExists: true, rootVisible: true, errorVisible: false }, actual);
  }

  async function requestCore(action, payload) {
    const config = await loadConfig();
    if (surface === 'booking') {
      return window.BookingSystem.request(config, 'member', '', action, payload || {});
    }
    return window.MemberSystem.request(config, surface, '', action, payload || {});
  }

  async function bootstrapCase() {
    const data = await requestCore(definition.bootstrapAction, {});
    state.bootstrap = data;
    const profile = data && data.profile || null;
    const account = state.session && state.session.account || {};
    let structural = false;
    let actual = {};

    if (surface === 'member') {
      structural = Boolean(profile && profile.memberCode && typeof profile.profileComplete === 'boolean');
      actual = { profile: Boolean(profile), memberCodeMatches: Boolean(profile && profile.memberCode === account.memberCode), profileComplete: Boolean(profile && profile.profileComplete) };
    } else if (surface === 'points') {
      structural = Boolean(profile && Array.isArray(data.cards) && data.cardDetails && typeof data.cardDetails === 'object' && Array.isArray(data.history));
      actual = { profile: Boolean(profile), memberCodeMatches: Boolean(profile && profile.memberCode === account.memberCode), cards: Array.isArray(data.cards) ? data.cards.length : -1, cardDetails: Boolean(data.cardDetails && typeof data.cardDetails === 'object'), history: Array.isArray(data.history) ? data.history.length : -1 };
    } else if (surface === 'event') {
      structural = Boolean(profile && Array.isArray(data.offers) && Array.isArray(data.usedTickets));
      actual = { profile: Boolean(profile), memberCodeMatches: Boolean(profile && profile.memberCode === account.memberCode), offers: Array.isArray(data.offers) ? data.offers.length : -1, usedTickets: Array.isArray(data.usedTickets) ? data.usedTickets.length : -1 };
    } else if (surface === 'calendar') {
      structural = Boolean(profile && Array.isArray(data.items));
      actual = { profile: Boolean(profile), memberCodeMatches: Boolean(profile && profile.memberCode === account.memberCode), items: Array.isArray(data.items) ? data.items.length : -1 };
    } else {
      structural = Boolean(data && data.settings && Array.isArray(data.services) && Array.isArray(data.bookings));
      actual = { settings: Boolean(data && data.settings), services: Array.isArray(data && data.services) ? data.services.length : -1, bookings: Array.isArray(data && data.bookings) ? data.bookings.length : -1, todayPresent: Boolean(data && data.today) };
    }

    const profileMatch = surface === 'booking' || Boolean(profile && profile.memberCode === account.memberCode);
    return structural && profileMatch
      ? pass('實際 Bootstrap API 回傳目前測試帳號可用的資料結構。', { validStructure: true, testAccountMatched: true }, { validStructure: structural, testAccountMatched: profileMatch, snapshot: actual })
      : fail('Bootstrap API 結構或測試帳號綁定不符合預期。', { validStructure: true, testAccountMatched: true }, { validStructure: structural, testAccountMatched: profileMatch, snapshot: actual });
  }

  async function essentialDomCase() {
    const missing = definition.essentialIds.filter((id) => !document.getElementById(id));
    const actual = { expectedCount: definition.essentialIds.length, foundCount: definition.essentialIds.length - missing.length, missing };
    return missing.length === 0
      ? pass('此頁核心操作與顯示元件皆存在。', { missing: [] }, actual)
      : fail('此頁缺少必要 DOM 元件，可能有舊版渲染或部署不完整。', { missing: [] }, actual);
  }

  async function negativeSessionCase() {
    const config = await loadConfig();
    const endpoint = String(config.supabaseUrl || '').replace(/\/$/, '') + '/functions/v1/test-mode-api';
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: String(config.supabasePublishableKey || '') },
      cache: 'no-store',
      body: JSON.stringify({ action: 'session.status', testSessionToken: '' })
    });
    const body = await response.json().catch(() => ({}));
    const code = String(body && body.error && body.error.code || '');
    const ok = response.status === 401 && /^TEST_SESSION_/.test(code);
    return ok
      ? pass('沒有測試 Session token 時，後端會拒絕取得測試身分。', { httpStatus: 401, errorPrefix: 'TEST_SESSION_' }, { httpStatus: response.status, errorCode: code })
      : fail('測試 Session 的拒絕邊界不符合預期。', { httpStatus: 401, errorPrefix: 'TEST_SESSION_' }, { httpStatus: response.status, errorCode: code });
  }

  async function realtimeCase() {
    const config = await loadConfig();
    if (config.realtimeEnabled === false) return skip('目前設定明確停用 Realtime。', { realtimeEnabled: true }, { realtimeEnabled: false });
    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
      return fail('Supabase Realtime SDK 未載入。', { sdkAvailable: true }, { sdkAvailable: false });
    }
    const client = window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
    });
    const channelName = 'qa-' + surface + '-' + Math.random().toString(36).slice(2, 9);
    let lastStatus = '';
    const channel = client.channel(channelName)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'realtime_events' }, () => {});
    try {
      const subscribed = await new Promise((resolve) => {
        const timer = window.setTimeout(() => resolve(false), 5000);
        channel.subscribe((status) => {
          lastStatus = String(status || '');
          if (status === 'SUBSCRIBED') {
            window.clearTimeout(timer);
            resolve(true);
          }
          if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) {
            window.clearTimeout(timer);
            resolve(false);
          }
        });
      });
      return subscribed
        ? pass('Realtime channel 可正常建立訂閱。', { status: 'SUBSCRIBED' }, { status: lastStatus })
        : fail('Realtime channel 未能完成訂閱。', { status: 'SUBSCRIBED' }, { status: lastStatus || 'timeout' });
    } finally {
      try { await client.removeChannel(channel); } catch (_) {}
    }
  }

  async function memberProfileCase() {
    const data = state.bootstrap || await requestCore('user.member.bootstrap', {});
    const profile = data && data.profile || {};
    const complete = Boolean(profile.memberCode && profile.profileComplete && profile.surname && ['mr', 'ms'].includes(String(profile.salutation || '')) && profile.birthday && profile.phone);
    const actual = {
      memberCodePresent: Boolean(profile.memberCode),
      profileComplete: Boolean(profile.profileComplete),
      honorificComplete: Boolean(profile.surname && ['mr', 'ms'].includes(String(profile.salutation || ''))),
      birthdayPresent: Boolean(profile.birthday),
      phonePresent: Boolean(profile.phone),
      tierPresent: Boolean(profile.tierKey && profile.tier)
    };
    return complete
      ? pass('測試會員具備正式會員功能需要的完整個人資料。', { memberCodePresent: true, profileComplete: true, honorificComplete: true, birthdayPresent: true, phonePresent: true }, actual)
      : fail('測試會員個人資料不完整，可能造成其他用戶端功能異常。', { memberCodePresent: true, profileComplete: true, honorificComplete: true, birthdayPresent: true, phonePresent: true }, actual);
  }

  async function clickModalPair(openId, modalId, closeId) {
    const open = document.getElementById(openId);
    const modal = document.getElementById(modalId);
    const close = document.getElementById(closeId);
    if (!open || !modal || !close) return { ok: false, reason: 'missing-element' };
    const initiallyHidden = modal.classList.contains('hidden');
    open.click();
    await wait(60);
    const opened = !modal.classList.contains('hidden');
    close.click();
    await wait(40);
    const closed = modal.classList.contains('hidden');
    return { ok: initiallyHidden && opened && closed, initiallyHidden, opened, closed };
  }

  async function memberModalCase() {
    const honorific = await clickModalPair('editHonorificButton', 'honorificEditModal', 'closeHonorificEditButton');
    const birthday = await clickModalPair('editBirthdayButton', 'birthdayEditModal', 'closeBirthdayEditButton');
    const phone = await clickModalPair('editPhoneButton', 'phoneEditModal', 'closePhoneEditButton');
    const ok = honorific.ok && birthday.ok && phone.ok;
    return ok
      ? pass('三個會員資料編輯視窗都可開啟並安全關閉。', { honorific: true, birthday: true, phone: true }, { honorific, birthday, phone })
      : fail('至少一個會員資料編輯視窗互動異常。', { honorific: true, birthday: true, phone: true }, { honorific, birthday, phone });
  }

  async function expectApiError(action, payload, codes) {
    try {
      await requestCore(action, payload || {});
      return { ok: false, code: '', message: 'request unexpectedly succeeded' };
    } catch (error) {
      const code = String(error && error.code || '');
      return { ok: !codes.length || codes.includes(code) || codes.some((item) => code.startsWith(item)), code, message: String(error && error.message || '').slice(0, 180) };
    }
  }

  async function memberInvalidWriteCase() {
    const checked = await expectApiError('user.member.profile.save', { birthday: 'not-a-date', phone: 'x' }, ['INVALID_BIRTHDAY', 'INVALID_']);
    return checked.ok
      ? pass('會員資料寫入 API 正確拒絕無效生日／電話，未執行資料修改。', { rejected: true }, checked)
      : fail('會員資料寫入驗證沒有依預期拒絕無效輸入。', { rejected: true }, checked);
  }

  async function pointsDataCase() {
    const data = state.bootstrap || await requestCore('user.pointcard.bootstrap', {});
    const cards = Array.isArray(data.cards) ? data.cards : [];
    const details = data.cardDetails && typeof data.cardDetails === 'object' ? data.cardDetails : {};
    const badCards = cards.filter((card) => !card || !card.cardId || !Number.isFinite(Number(card.stamps || 0))).length;
    const missingDetails = cards.filter((card) => !details[card.cardId]).length;
    const actual = { cardCount: cards.length, badCards, missingDetails, historyCount: Array.isArray(data.history) ? data.history.length : -1 };
    return badCards === 0 && missingDetails === 0 && Array.isArray(data.history)
      ? pass('集點卡、點數、票券與使用紀錄資料結構一致。', { badCards: 0, missingDetails: 0, historyArray: true }, actual)
      : fail('集點卡或票券資料結構有缺漏。', { badCards: 0, missingDetails: 0, historyArray: true }, actual);
  }

  async function pointExtensionRequest(operation, payload) {
    const config = await loadConfig();
    const endpoint = String(config.supabaseUrl || '').replace(/\/$/, '') + '/functions/v1/pointcard-extension-api';
    const body = window.TestModeClient.payload(Object.assign({}, payload || {}, { operation, idToken: '' }));
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: String(config.supabasePublishableKey || '') },
      cache: 'no-store',
      body: JSON.stringify(body)
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data || data.ok !== true) {
      const error = new Error(data && data.error && data.error.message || 'Point extension error');
      error.code = String(data && data.error && data.error.code || 'API_ERROR');
      throw error;
    }
    return data.data || {};
  }

  async function pointSettingsCase() {
    const data = await pointExtensionRequest('member.settings.get', {});
    const limit = Number(data.maxTicketsPerRedemption);
    const ok = Number.isInteger(limit) && limit >= 1 && limit <= 50;
    return ok
      ? pass('票券單次核銷上限可由測試 Session 正確讀取。', { min: 1, max: 50 }, { maxTicketsPerRedemption: limit })
      : fail('票券核銷設定不合法。', { min: 1, max: 50 }, { maxTicketsPerRedemption: data.maxTicketsPerRedemption });
  }

  async function pointsInteractionCase() {
    const tabs = Array.from(document.querySelectorAll('#cardTabs [data-card-id]'));
    if (!tabs.length) return skip('目前沒有啟用中的集點卡可切換。', { cardTabsAtLeast: 1 }, { cardTabs: 0 });
    const initial = tabs.find((node) => node.getAttribute('aria-selected') === 'true') || tabs[0];
    const target = tabs.length > 1 ? tabs[1] : tabs[0];
    target.click();
    await wait(120);
    const selected = target.getAttribute('aria-selected') === 'true';
    if (initial !== target) {
      initial.click();
      await wait(80);
    }
    return selected
      ? pass('集點卡分頁可切換且 aria-selected 會同步。', { selectedAfterClick: true }, { cardTabs: tabs.length, selectedAfterClick: selected })
      : fail('集點卡分頁點擊後未同步選取狀態。', { selectedAfterClick: true }, { cardTabs: tabs.length, selectedAfterClick: selected });
  }

  async function pointsInvalidWriteCase() {
    let extension;
    try {
      await pointExtensionRequest('member.redeem', { ticketIds: [], requestId: 'QA_INVALID_12345678' });
      extension = { ok: false, code: '' };
    } catch (error) {
      extension = { ok: String(error.code || '') === 'INVALID_TICKET_BATCH', code: String(error.code || '') };
    }
    const core = await expectApiError('user.pointcard.ticket.redeem', { ticketId: '' }, ['INVALID_INPUT', 'INVALID_', 'REQUIRED']);
    const ok = extension.ok && core.ok;
    return ok
      ? pass('兩條票券核銷入口都會拒絕空白／無效票券，不會變更點數。', { batchRejected: true, singleRejected: true }, { batch: extension, single: core })
      : fail('至少一條票券核銷驗證邊界異常。', { batchRejected: true, singleRejected: true }, { batch: extension, single: core });
  }

  async function eventDataCase() {
    const data = state.bootstrap || await requestCore('user.event.bootstrap', {});
    const offers = Array.isArray(data.offers) ? data.offers : [];
    const used = Array.isArray(data.usedTickets) ? data.usedTickets : [];
    const bad = offers.filter((offer) => !offer || !offer.ticket || !offer.ticket.eventTicketId || typeof offer.canClaim !== 'boolean' || typeof offer.canUse !== 'boolean').length;
    const actual = { offerCount: offers.length, usedCount: used.length, malformedOffers: bad, usedTicketCount: Number(data.usedTicketCount || 0) };
    return bad === 0 && used.length === Number(data.usedTicketCount || 0)
      ? pass('活動票券可領取／可使用狀態與歷史資料結構一致。', { malformedOffers: 0, usedCountMatches: true }, actual)
      : fail('活動票券狀態資料結構不一致。', { malformedOffers: 0, usedCountMatches: true }, actual);
  }

  async function eventModalCase() {
    const button = Array.from(document.querySelectorAll('#eventList button[data-event-ticket-id]')).find((node) => !node.disabled) || null;
    if (!button || button.disabled) return skip('目前沒有可開啟詳情的活動票券。', { openableTicket: true }, { openableTicket: false });
    const modal = document.getElementById('ticketModal');
    const close = document.getElementById('closeTicketModal');
    button.click();
    await wait(100);
    const opened = modal && !modal.classList.contains('hidden');
    if (opened && close) {
      close.click();
      await wait(50);
    }
    const closed = Boolean(modal && modal.classList.contains('hidden'));
    return opened && closed
      ? pass('活動票券詳情可開啟並關閉，未執行領券或核銷。', { opened: true, closed: true }, { opened, closed })
      : fail('活動票券詳情 Modal 互動異常。', { opened: true, closed: true }, { opened, closed });
  }

  async function eventInvalidWriteCase() {
    const claim = await expectApiError('user.event.ticket.claim', { eventTicketId: '' }, ['INVALID_INPUT', 'INVALID_', 'REQUIRED']);
    const redeem = await expectApiError('user.event.ticket.redeem', { claimId: '' }, ['INVALID_INPUT', 'INVALID_', 'REQUIRED']);
    return claim.ok && redeem.ok
      ? pass('領券與核銷 API 都會拒絕缺少識別碼，不產生票券異動。', { claimRejected: true, redeemRejected: true }, { claim, redeem })
      : fail('領券或核銷 API 的輸入驗證邊界異常。', { claimRejected: true, redeemRejected: true }, { claim, redeem });
  }

  async function calendarDetailApiCase() {
    const data = state.bootstrap || await requestCore('user.calendar.bootstrap', {});
    const first = Array.isArray(data.items) && data.items.find((item) => /^\d{4}-\d{2}-\d{2}$/.test(String(item.startsOn || '')));
    const date = first ? String(first.startsOn) : new Date().toISOString().slice(0, 10);
    const detail = await requestCore('user.calendar.date.details', { date });
    const items = Array.isArray(detail.items) ? detail.items : [];
    return Array.isArray(detail.items)
      ? pass('指定日期明細 API 可由測試帳號讀取。', { itemsArray: true }, { date, itemCount: items.length })
      : fail('指定日期明細 API 回傳格式不正確。', { itemsArray: true }, { date, itemsType: typeof detail.items });
  }

  async function calendarNavigationCase() {
    const title = document.getElementById('monthTitle');
    const next = document.getElementById('nextMonthButton');
    const previous = document.getElementById('previousMonthButton');
    if (!title || !next || !previous) return fail('月曆導覽元件缺失。', { controls: true }, { controls: false });
    const before = title.textContent;
    next.click();
    await wait(90);
    const after = title.textContent;
    previous.click();
    await wait(90);
    const restored = title.textContent;
    const changed = before !== after;
    const returned = restored === before;
    return changed && returned
      ? pass('下一月／上一月導覽可變更並恢復月份。', { changed: true, restored: true }, { changed, restored: returned })
      : fail('月曆月份切換未依預期運作。', { changed: true, restored: true }, { changed, restored: returned });
  }

  async function calendarInvalidDateCase() {
    const checked = await expectApiError('user.calendar.date.details', { date: '2099-99-99' }, ['INVALID_DATE']);
    return checked.ok
      ? pass('日期明細 API 正確拒絕非法日期。', { rejected: true, code: 'INVALID_DATE' }, checked)
      : fail('日期明細 API 沒有依預期拒絕非法日期。', { rejected: true, code: 'INVALID_DATE' }, checked);
  }

  async function bookingDataCase() {
    const bootstrap = state.bootstrap || await requestCore('user.booking.bootstrap', {});
    const profile = await window.BookingSystem.memberProfile(await loadConfig(), '');
    const account = state.session && state.session.account || {};
    const profileMatch = Boolean(profile && profile.memberCode === account.memberCode);
    const actual = {
      profileMatched: profileMatch,
      profileComplete: Boolean(profile && profile.profileComplete),
      services: Array.isArray(bootstrap.services) ? bootstrap.services.length : -1,
      bookings: Array.isArray(bootstrap.bookings) ? bootstrap.bookings.length : -1,
      settings: Boolean(bootstrap.settings),
      todayPresent: Boolean(bootstrap.today)
    };
    const ok = profileMatch && Array.isArray(bootstrap.services) && Array.isArray(bootstrap.bookings) && Boolean(bootstrap.settings);
    return ok
      ? pass('會員資料與預約資料都綁定目前測試帳號。', { profileMatched: true, servicesArray: true, bookingsArray: true, settings: true }, actual)
      : fail('會員資料與預約 Bootstrap 不一致。', { profileMatched: true, servicesArray: true, bookingsArray: true, settings: true }, actual);
  }

  async function directFunction(slug, body) {
    const config = await loadConfig();
    const endpoint = String(config.supabaseUrl || '').replace(/\/$/, '') + '/functions/v1/' + slug;
    const payload = window.TestModeClient.payload(Object.assign({}, body || {}, { idToken: '' }));
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: String(config.supabasePublishableKey || '') },
      cache: 'no-store',
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data || data.ok !== true) {
      const error = new Error(data && data.error && data.error.message || slug + ' error');
      error.code = String(data && data.error && data.error.code || 'API_ERROR');
      throw error;
    }
    return data.data || {};
  }

  async function bookingGroupBootstrapCase() {
    const data = await directFunction('booking-group-api', {
      action: 'user.booking.group.bootstrap',
      clientType: 'member'
    });
    const ok = Boolean(data.settings && Array.isArray(data.technicians) && data.bookingGroups && typeof data.bookingGroups === 'object');
    const actual = { settings: Boolean(data.settings), technicians: Array.isArray(data.technicians) ? data.technicians.length : -1, bookingGroups: data.bookingGroups && typeof data.bookingGroups === 'object' ? Object.keys(data.bookingGroups).length : -1 };
    return ok
      ? pass('多人預約資源、技師與歷史群組可正常讀取。', { settings: true, techniciansArray: true, bookingGroupsObject: true }, actual)
      : fail('多人預約 Bootstrap 結構不完整。', { settings: true, techniciansArray: true, bookingGroupsObject: true }, actual);
  }

  async function bookingFormCase() {
    const form = document.getElementById('bookingForm');
    const submit = document.getElementById('submitBookingButton');
    const date = document.getElementById('bookingDate');
    const servicePicker = document.getElementById('servicePicker');
    const actual = {
      formPresent: Boolean(form),
      submitPresent: Boolean(submit),
      submitInitiallyDisabled: Boolean(submit && submit.disabled),
      datePresent: Boolean(date),
      serviceChoices: servicePicker ? servicePicker.querySelectorAll('.service-choice').length : -1
    };
    const ok = actual.formPresent && actual.submitPresent && actual.submitInitiallyDisabled && actual.datePresent;
    return ok
      ? pass('未選項目／時段時送出按鈕維持停用，避免空白預約。', { formPresent: true, submitInitiallyDisabled: true, datePresent: true }, actual)
      : fail('預約表單初始安全狀態不符合預期。', { formPresent: true, submitInitiallyDisabled: true, datePresent: true }, actual);
  }

  async function bookingInvalidWriteCase() {
    const create = await expectApiError('user.booking.create', {
      requestId: 'BOOK-QA-' + Math.random().toString(36).slice(2, 12),
      items: [],
      bookingDate: '',
      startTime: ''
    }, ['INVALID_', 'BOOKING_', 'MEMBERSHIP_']);
    const update = await expectApiError('user.booking.update', {
      bookingId: 'not-a-uuid',
      expectedUpdatedAt: new Date().toISOString(),
      requestId: 'BOOK-QA-' + Math.random().toString(36).slice(2, 12),
      items: [],
      bookingDate: '',
      startTime: ''
    }, ['INVALID_', 'BOOKING_']);
    const cancel = await expectApiError('user.booking.cancel', { bookingId: 'not-a-uuid' }, ['INVALID_', 'BOOKING_']);

    let group;
    try {
      await directFunction('booking-group-api', {
        action: 'user.booking.group.create',
        clientType: 'member',
        requestId: 'BOOK-QA-' + Math.random().toString(36).slice(2, 12),
        participants: [],
        bookingDate: '',
        startTime: ''
      });
      group = { ok: false, code: '' };
    } catch (error) {
      const code = String(error.code || '');
      group = { ok: /^INVALID_|^BOOKING_/.test(code), code, message: String(error.message || '').slice(0, 180) };
    }

    const ok = create.ok && update.ok && cancel.ok && group.ok;
    return ok
      ? pass('新增、修改、取消與多人預約都會在無效輸入階段拒絕，不建立資料。', { createRejected: true, updateRejected: true, cancelRejected: true, groupRejected: true }, { create, update, cancel, group })
      : fail('至少一個預約寫入操作沒有在預期的驗證邊界拒絕。', { createRejected: true, updateRejected: true, cancelRejected: true, groupRejected: true }, { create, update, cancel, group });
  }

  async function loadMutationSuite() {
    if (state.mutationSuite) return state.mutationSuite;
    const config = await loadConfig();
    const endpoint = String(config.supabaseUrl || '').replace(/\/$/, '') + '/functions/v1/user-test-api';
    const payload = window.TestModeClient.payload({
      action: 'user.qa.mutations',
      surface,
      idToken: ''
    });
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 60000);
    let response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: String(config.supabasePublishableKey || '')
        },
        cache: 'no-store',
        signal: controller.signal,
        body: JSON.stringify(payload)
      });
    } catch (error) {
      const wrapped = new Error(error && error.name === 'AbortError'
        ? '成功寫入 QA 執行逾時。'
        : '無法連線成功寫入 QA 服務。');
      wrapped.code = error && error.name === 'AbortError' ? 'QA_TIMEOUT' : 'QA_NETWORK_ERROR';
      throw wrapped;
    } finally {
      window.clearTimeout(timer);
    }
    const data = await response.json().catch(() => null);
    if (!response.ok || !data || data.ok !== true) {
      const wrapped = new Error(data && data.error && data.error.message || '成功寫入 QA 被拒絕。');
      wrapped.code = String(data && data.error && data.error.code || 'QA_API_ERROR');
      throw wrapped;
    }
    state.mutationSuite = data.data || {};
    return state.mutationSuite;
  }

  async function mutationQaCase(caseKey) {
    const suite = await loadMutationSuite();
    const cases = Array.isArray(suite.cases) ? suite.cases : [];
    const item = cases.find((entry) => entry && entry.key === caseKey);
    if (!item) {
      return fail(
        '成功寫入 QA 沒有回傳此案例。',
        { caseKey, returned: true },
        { caseKey, returned: false }
      );
    }
    const expected = item.expected && typeof item.expected === 'object' ? item.expected : {};
    const actual = item.actual && typeof item.actual === 'object' ? item.actual : {};
    if (item.status === 'skipped') return skip(String(item.message || '此案例略過。'), expected, actual);
    if (item.status === 'passed') return pass(String(item.message || '成功寫入與清理完成。'), expected, actual);
    return fail(
      String(item.message || '成功寫入或清理失敗。'),
      expected,
      Object.assign({}, actual, { serverCase: caseKey })
    );
  }

  function saveHistory() {
    const entry = {
      at: new Date().toISOString(),
      surface,
      suite: state.currentSuite,
      passed: state.results.filter((item) => item.status === 'passed').length,
      failed: state.results.filter((item) => item.status === 'failed').length,
      skipped: state.results.filter((item) => item.status === 'skipped').length,
      total: state.results.length
    };
    try {
      const existing = JSON.parse(window.sessionStorage.getItem(HISTORY_KEY) || '[]');
      const list = Array.isArray(existing) ? existing : [];
      list.unshift(entry);
      window.sessionStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, MAX_HISTORY)));
    } catch (_) {}
  }

  function renderHistory() {
    if (!state.panel) return;
    const root = state.panel.querySelector('[data-qa-history]');
    let rows = [];
    try {
      const parsed = JSON.parse(window.sessionStorage.getItem(HISTORY_KEY) || '[]');
      rows = Array.isArray(parsed) ? parsed.filter((item) => item && item.surface === surface) : [];
    } catch (_) {}
    if (!rows.length) {
      root.innerHTML = '<p class="user-qa-history-empty">本次瀏覽器 Session 尚無測試紀錄。</p>';
      return;
    }
    root.replaceChildren(...rows.map((item) => {
      const row = document.createElement('div');
      row.className = 'user-qa-history-row';
      const time = document.createElement('strong');
      const date = new Date(item.at);
      time.textContent = Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
      const meta = document.createElement('span');
      meta.textContent = (item.suite === 'full' ? '完整' : '快速') + ' · ' + item.passed + ' 通過 · ' + item.failed + ' 失敗 · ' + item.skipped + ' 略過';
      row.append(time, meta);
      return row;
    }));
  }

  window.MemberUserTestControl = Object.freeze({
    version: VERSION,
    surface,
    runQuick: () => runSuite('quick'),
    runFull: () => runSuite('full')
  });
})();