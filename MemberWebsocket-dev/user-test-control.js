(() => {
  'use strict';

  const VERSION = '2026-09-21.9';
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
    browserRun: null,
    availabilitySync: null,
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
      const sensitiveScalar = blocked.test(key) && (item === null || ['string', 'number', 'bigint'].includes(typeof item));
      if (sensitiveScalar) {
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
    if (state.availabilitySync) return state.availabilitySync;

    const task = (async () => {
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
    })();

    state.availabilitySync = task;
    try {
      return await task;
    } finally {
      if (state.availabilitySync === task) state.availabilitySync = null;
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
    panel.setAttribute('aria-modal', 'false');
    panel.setAttribute('aria-labelledby', 'userQaTitle');
    panel.innerHTML =
      '<div class="user-qa-shell">' +
        '<header class="user-qa-head">' +
          '<div><p class="user-qa-kicker">Test account QA</p><h2 id="userQaTitle">' + escapeHtml(definition.label) + '自動化測試</h2>' +
          '<p>只在後端驗證通過的測試帳號顯示。測試帳號會走與真人相同的登入、API、權限與前端互動流程；為避免佔用真實資源，寫入測試的臨時腳手架完成後會清理，但測試結果會保留在會員名冊紀錄。</p></div>' +
          '<div class="user-qa-head-actions"><button type="button" class="user-qa-minimize" data-qa-minimize aria-expanded="true">縮小</button><button type="button" class="user-qa-close" data-qa-close aria-label="關閉">×</button></div>' +
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
    panel.querySelector('[data-qa-minimize]').addEventListener('click', togglePanelMinimized);
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
    if (state.visible) {
      const close = state.panel.querySelector('[data-qa-close]');
      if (close) close.focus();
    }
  }

  function togglePanelMinimized() {
    if (!state.panel) return;
    const minimized = !state.panel.classList.contains('is-minimized');
    state.panel.classList.toggle('is-minimized', minimized);
    const button = state.panel.querySelector('[data-qa-minimize]');
    if (button) {
      button.textContent = minimized ? '展開' : '縮小';
      button.setAttribute('aria-expanded', minimized ? 'false' : 'true');
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
        key: testCase.key || '',
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

    const cancelled = state.cancelled;
    if (!cancelled) {
      try {
        state.browserRun = await recordBrowserRun();
      } catch (error) {
        state.results.push({
          key: 'QA_BROWSER_RUN_RECORD',
          name: '會員名冊測試紀錄寫入',
          domain: 'Audit',
          status: 'failed',
          message: error && error.message || '真人操作測試結果無法寫入會員名冊。',
          expected: { persisted: true },
          actual: plainError(error),
          durationMs: 0
        });
        renderResults();
      }
    }
    const failed = state.results.filter((item) => item.status === 'failed').length;
    setRunning(false);
    setStatus(cancelled ? '已停止' : failed ? '有異常' : '全部通過');
    setMessage(
      cancelled ? '測試已停止。' :
      failed ? '測試完成，發現 ' + failed + ' 個異常；展開失敗案例查看 Expected / Actual。' :
      '測試完成，所有已執行案例通過；真人操作結果已同步到會員名冊。',
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
      caseDef('Realtime 訂閱能力', 'Realtime', realtimeCase, 'COMMON_REALTIME')
    ];

    const surfaceCases = {
      member: [
        caseDef('會員資料完整性', 'Member', memberProfileCase, 'MEMBER_PROFILE_DATA'),
        caseDef('稱呼／生日／電話編輯視窗', 'UI', memberModalCase, 'MEMBER_MODAL_OPEN_CLOSE'),
        caseDef('真人操作：修改並還原稱呼／生日／電話', 'Human E2E', memberHumanProfileEditCase, 'MEMBER_HUMAN_PROFILE_EDIT'),
        caseDef('會員資料寫入驗證邊界', 'Validation', memberInvalidWriteCase, 'MEMBER_INVALID_WRITE'),
        caseDef('會員資料成功寫入與還原', 'Mutation QA', () => mutationQaCase('MEMBER_PROFILE_WRITE'), 'MEMBER_SERVER_MUTATION')
      ],
      points: [
        caseDef('集點卡／票券資料結構', 'Points', pointsDataCase, 'POINTS_DATA'),
        caseDef('票券使用共用設定', 'Points', pointSettingsCase, 'POINTS_SETTINGS'),
        caseDef('集點卡切換互動', 'UI', pointsInteractionCase, 'POINTS_CARD_SWITCH'),
        caseDef('真人操作：勾選票券／取消／確認核銷', 'Human E2E', pointsHumanRedeemCase, 'POINTS_HUMAN_REDEEM'),
        caseDef('票券核銷輸入驗證', 'Validation', pointsInvalidWriteCase, 'POINTS_INVALID_WRITE'),
        caseDef('集點票券單筆／批次核銷成功與清理', 'Mutation QA', () => mutationQaCase('POINT_TICKET_WRITE'), 'POINTS_SERVER_MUTATION')
      ],
      event: [
        caseDef('活動票券領取／使用狀態', 'Tickets', eventDataCase, 'EVENT_DATA'),
        caseDef('票券詳情 Modal', 'UI', eventModalCase, 'EVENT_MODAL'),
        caseDef('真人操作：開啟／領取／核銷／查看紀錄', 'Human E2E', eventHumanTicketLifecycleCase, 'EVENT_HUMAN_LIFECYCLE'),
        caseDef('領券與核銷輸入驗證', 'Validation', eventInvalidWriteCase, 'EVENT_INVALID_WRITE'),
        caseDef('活動票券領取／核銷成功與清理', 'Mutation QA', () => mutationQaCase('EVENT_TICKET_WRITE'), 'EVENT_SERVER_MUTATION')
      ],
      calendar: [
        caseDef('指定日期明細 API', 'Calendar', calendarDetailApiCase, 'CALENDAR_DETAIL_API'),
        caseDef('月曆月份切換互動', 'UI', calendarNavigationCase, 'CALENDAR_NAVIGATION'),
        caseDef('真人操作：點日期／開明細／關閉', 'Human E2E', calendarHumanDetailCase, 'CALENDAR_HUMAN_DETAIL'),
        caseDef('日期輸入驗證邊界', 'Validation', calendarInvalidDateCase, 'CALENDAR_INVALID_DATE'),
        caseDef('日曆寫入權限邊界', 'Mutation QA', () => mutationQaCase('CALENDAR_READ_ONLY'), 'CALENDAR_SERVER_BOUNDARY')
      ],
      booking: [
        caseDef('會員與預約 Bootstrap 一致性', 'Booking', bookingDataCase, 'BOOKING_DATA'),
        caseDef('多人預約資源 Bootstrap', 'Booking', bookingGroupBootstrapCase, 'BOOKING_GROUP_DATA'),
        caseDef('預約表單安全初始狀態', 'UI', bookingFormCase, 'BOOKING_FORM_INITIAL'),
        caseDef('真人操作：日期／視窗／項目／多人控制', 'Human E2E', bookingHumanControlsCase, 'BOOKING_HUMAN_CONTROLS'),
        caseDef('真人操作：新增／修改／取消預約', 'Human E2E', bookingHumanLifecycleCase, 'BOOKING_HUMAN_LIFECYCLE'),
        caseDef('真人操作：多人預約新增與清理', 'Human E2E', bookingHumanGroupLifecycleCase, 'BOOKING_HUMAN_GROUP'),
        caseDef('新增／修改／取消輸入驗證', 'Validation', bookingInvalidWriteCase, 'BOOKING_INVALID_WRITE'),
        caseDef('預約新增／修改／取消成功與清理', 'Mutation QA', () => mutationQaCase('BOOKING_WRITE'), 'BOOKING_SERVER_MUTATION'),
        caseDef('多人預約新增／修改成功與清理', 'Mutation QA', () => mutationQaCase('BOOKING_GROUP_WRITE'), 'BOOKING_GROUP_SERVER_MUTATION')
      ]
    };
    return common.concat(
      fullCommon,
      surfaceCases[surface] || [],
      [
        caseDef('所有按鈕／動態控制覆蓋清單', 'Coverage', buttonCoverageCase, (surface || 'surface').toUpperCase() + '_BUTTON_COVERAGE'),
        caseDef('測試帳號 LINE 通知抑制', 'Notification', () => mutationQaCase('LINE_SUPPRESSION'), (surface || 'surface').toUpperCase() + '_LINE_SUPPRESSION')
      ]
    );
  }

  function caseDef(name, domain, run, key) {
    return { name, domain, run, key: String(key || '') };
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

  async function waitForModalState(modal, shouldBeOpen, timeoutMs) {
    const deadline = performance.now() + Math.max(100, Number(timeoutMs) || 1000);
    while (performance.now() < deadline) {
      const isOpen = !modal.classList.contains('hidden');
      if (isOpen === shouldBeOpen) return true;
      await wait(25);
    }
    return (!modal.classList.contains('hidden')) === shouldBeOpen;
  }

  async function clickModalPair(openId, modalId, closeId) {
    const open = document.getElementById(openId);
    const modal = document.getElementById(modalId);
    const close = document.getElementById(closeId);
    if (!open || !modal || !close) return { ok: false, reason: 'missing-element' };
    const initiallyHidden = modal.classList.contains('hidden');
    open.click();
    const opened = await waitForModalState(modal, true, 1500);
    if (opened) close.click();
    const closed = opened
      ? await waitForModalState(modal, false, 1000)
      : modal.classList.contains('hidden');
    return { ok: initiallyHidden && opened && closed, initiallyHidden, opened, closed };
  }

  async function memberModalCase() {
    const honorific = await clickModalPair('editHonorificButton', 'honorificEditModal', 'closeHonorificEditButton');
    const birthday = await clickModalPair('editBirthdayButton', 'birthdayEditModal', 'closeBirthdayEditButton');
    const phone = await clickModalPair('editPhoneButton', 'phoneEditModal', 'closePhoneEditButton');
    const expectedModal = Object.freeze({ ok: true, initiallyHidden: true, opened: true, closed: true });
    const expected = {
      honorific: { ...expectedModal },
      birthday: { ...expectedModal },
      phone: { ...expectedModal }
    };
    const ok = honorific.ok && birthday.ok && phone.ok;
    const actual = { honorific, birthday, phone };
    return ok
      ? pass('三個會員資料編輯視窗都可開啟並安全關閉。', expected, actual)
      : fail('至少一個會員資料編輯視窗互動異常。', expected, actual);
  }


  async function waitFor(predicate, timeoutMs = 5000, intervalMs = 40) {
    const deadline = performance.now() + Math.max(100, Number(timeoutMs) || 5000);
    let lastError = null;
    while (performance.now() < deadline) {
      try {
        const value = predicate();
        if (value) return value;
      } catch (error) {
        lastError = error;
      }
      await wait(intervalMs);
    }
    if (lastError) throw lastError;
    return null;
  }

  function setFieldValue(element, value) {
    if (!element) return false;
    element.value = String(value ?? '');
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  async function qaServiceRequest(action, payload = {}, timeoutMs = 30000) {
    const config = await loadConfig();
    const endpoint = String(config.supabaseUrl || '').replace(/\/$/, '') + '/functions/v1/user-test-api';
    const body = window.TestModeClient.payload(Object.assign({}, payload, { action, surface, idToken: '' }));
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: String(config.supabasePublishableKey || '') },
        cache: 'no-store',
        signal: controller.signal,
        body: JSON.stringify(body)
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data || data.ok !== true) {
        const error = new Error(data && data.error && data.error.message || '用戶端 QA 服務拒絕操作。');
        error.code = String(data && data.error && data.error.code || 'QA_API_ERROR');
        throw error;
      }
      return data.data || {};
    } finally {
      window.clearTimeout(timer);
    }
  }

  async function refreshRealClient() {
    if (window.MemberClientQaHooks && window.MemberClientQaHooks.surface === surface && typeof window.MemberClientQaHooks.refresh === 'function') {
      await window.MemberClientQaHooks.refresh();
      await wait(80);
      return true;
    }
    return false;
  }

  async function recordBrowserRun() {
    const cases = state.results.map((item) => ({
      key: item.key || '',
      name: item.name,
      domain: item.domain,
      status: item.status,
      message: item.message,
      expected: item.expected && typeof item.expected === 'object' ? item.expected : {},
      actual: item.actual && typeof item.actual === 'object' ? item.actual : {},
      durationMs: Number(item.durationMs || 0)
    }));
    return qaServiceRequest('user.qa.browser-run.record', { cases }, 30000);
  }

  async function memberHumanProfileEditCase() {
    const original = await requestCore('user.member.bootstrap', {});
    const profile = original && original.profile || {};
    const originalSurname = String(profile.surname || '');
    const originalSalutation = String(profile.salutation || '').toLowerCase();
    const originalBirthday = String(profile.birthday || '');
    const originalPhone = String(profile.phone || '');
    const nextSurname = originalSurname === '測' ? '驗' : '測';
    const nextSalutation = originalSalutation === 'mr' ? 'ms' : 'mr';
    const nextBirthday = originalBirthday === '1990-01-15' ? '1991-02-16' : '1990-01-15';
    const nextPhone = originalPhone.replace(/\D/g, '') === '0900000001' ? '0900000002' : '0900000001';
    const actual = {
      honorificCancelled: false, honorificSaved: false, honorificRestored: false,
      birthdayClosed: false, birthdaySaved: false, birthdayRestored: false,
      phoneCancelled: false, phoneSaved: false, phoneRestored: false
    };

    async function open(id, modalId) {
      document.getElementById(id)?.click();
      return Boolean(await waitFor(() => {
        const modal = document.getElementById(modalId);
        return modal && !modal.classList.contains('hidden') ? modal : null;
      }, 2500));
    }
    async function waitClosed(modalId) {
      return Boolean(await waitFor(() => document.getElementById(modalId)?.classList.contains('hidden'), 3000));
    }
    async function setBirthday(value) {
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
      const year = document.getElementById('birthdayEditYear');
      const month = document.getElementById('birthdayEditMonth');
      const day = document.getElementById('birthdayEditDay');
      if (match && year && month && day) {
        setFieldValue(year, match[1]);
        setFieldValue(month, match[2]);
        await wait(20);
        setFieldValue(day, match[3]);
        return true;
      }
      return setFieldValue(document.getElementById('birthdayEditInput'), value);
    }

    try {
      if (!await open('editHonorificButton', 'honorificEditModal')) throw new Error('稱呼編輯視窗未開啟。');
      document.getElementById('cancelHonorificEditButton')?.click();
      actual.honorificCancelled = await waitClosed('honorificEditModal');

      if (!await open('editHonorificButton', 'honorificEditModal')) throw new Error('稱呼編輯視窗第二次未開啟。');
      setFieldValue(document.getElementById('honorificSurnameInput'), nextSurname);
      setFieldValue(document.getElementById('honorificSalutationSelect'), nextSalutation);
      document.getElementById('saveHonorificEditButton')?.click();
      await waitClosed('honorificEditModal');
      let fresh = await requestCore('user.member.bootstrap', {});
      actual.honorificSaved = String(fresh?.profile?.surname || '') === nextSurname && String(fresh?.profile?.salutation || '').toLowerCase() === nextSalutation;

      await open('editHonorificButton', 'honorificEditModal');
      setFieldValue(document.getElementById('honorificSurnameInput'), originalSurname);
      setFieldValue(document.getElementById('honorificSalutationSelect'), originalSalutation);
      document.getElementById('saveHonorificEditButton')?.click();
      await waitClosed('honorificEditModal');
      fresh = await requestCore('user.member.bootstrap', {});
      actual.honorificRestored = String(fresh?.profile?.surname || '') === originalSurname && String(fresh?.profile?.salutation || '').toLowerCase() === originalSalutation;

      if (!await open('editBirthdayButton', 'birthdayEditModal')) throw new Error('生日編輯視窗未開啟。');
      document.getElementById('closeBirthdayEditButton')?.click();
      actual.birthdayClosed = await waitClosed('birthdayEditModal');

      await open('editBirthdayButton', 'birthdayEditModal');
      await setBirthday(nextBirthday);
      document.getElementById('saveBirthdayEditButton')?.click();
      await waitClosed('birthdayEditModal');
      fresh = await requestCore('user.member.bootstrap', {});
      actual.birthdaySaved = String(fresh?.profile?.birthday || '') === nextBirthday;

      await open('editBirthdayButton', 'birthdayEditModal');
      await setBirthday(originalBirthday);
      document.getElementById('saveBirthdayEditButton')?.click();
      await waitClosed('birthdayEditModal');
      fresh = await requestCore('user.member.bootstrap', {});
      actual.birthdayRestored = String(fresh?.profile?.birthday || '') === originalBirthday;

      if (!await open('editPhoneButton', 'phoneEditModal')) throw new Error('電話編輯視窗未開啟。');
      document.getElementById('cancelPhoneEditButton')?.click();
      actual.phoneCancelled = await waitClosed('phoneEditModal');

      await open('editPhoneButton', 'phoneEditModal');
      setFieldValue(document.getElementById('phoneEditInput'), nextPhone);
      document.getElementById('savePhoneEditButton')?.click();
      await waitClosed('phoneEditModal');
      fresh = await requestCore('user.member.bootstrap', {});
      actual.phoneSaved = String(fresh?.profile?.phone || '').replace(/\D/g, '') === nextPhone.replace(/\D/g, '');

      await open('editPhoneButton', 'phoneEditModal');
      setFieldValue(document.getElementById('phoneEditInput'), originalPhone);
      document.getElementById('savePhoneEditButton')?.click();
      await waitClosed('phoneEditModal');
      fresh = await requestCore('user.member.bootstrap', {});
      actual.phoneRestored = String(fresh?.profile?.phone || '').replace(/\D/g, '') === originalPhone.replace(/\D/g, '');
    } finally {
      const fresh = await requestCore('user.member.bootstrap', {}).catch(() => null);
      const p = fresh && fresh.profile || {};
      if (String(p.surname || '') !== originalSurname || String(p.salutation || '').toLowerCase() !== originalSalutation || String(p.birthday || '') !== originalBirthday || String(p.phone || '').replace(/\D/g, '') !== originalPhone.replace(/\D/g, '')) {
        await requestCore('user.member.profile.save', {
          surname: originalSurname,
          salutation: originalSalutation,
          birthday: originalBirthday,
          phone: originalPhone
        }).catch(() => {});
      }
    }

    const ok = Object.values(actual).every(Boolean);
    return ok
      ? pass('已用真人點擊方式完成稱呼、生日、電話的開啟／取消或關閉／儲存／還原。', { allSteps: true, restored: true }, actual)
      : fail('會員資料真人操作流程至少一個步驟異常。', { allSteps: true, restored: true }, actual);
  }

  async function pointsHumanRedeemCase() {
    const fixture = await qaServiceRequest('user.qa.fixture.prepare');
    const actual = { selected: false, cancelClosed: false, reopened: false, redeemed: false, historyVisible: false, cleaned: false };
    try {
      await refreshRealClient();
      const snapshot = await requestCore('user.pointcard.bootstrap', { compact: false });
      window.PointCardTicketOverview?.renderSnapshot?.(snapshot);
      const checkbox = await waitFor(() => document.querySelector('[data-ticket-select="' + fixture.ticketId + '"]'), 4000);
      if (!checkbox) throw new Error('QA 可用票券沒有出現在真人票券總覽。');
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('change', { bubbles: true }));
      const useButton = await waitFor(() => {
        const button = document.querySelector('.ticket-overview-use');
        return button && !button.disabled ? button : null;
      }, 2000);
      actual.selected = Boolean(useButton);
      useButton.click();
      const modal = await waitFor(() => {
        const node = document.getElementById('ticketBatchModal');
        return node && !node.classList.contains('hidden') ? node : null;
      }, 2000);
      if (!modal) throw new Error('使用票券確認視窗未開啟。');
      modal.querySelector('.ticket-batch-cancel')?.click();
      actual.cancelClosed = Boolean(await waitFor(() => modal.classList.contains('hidden'), 1500));
      useButton.click();
      actual.reopened = Boolean(await waitFor(() => !modal.classList.contains('hidden'), 1500));
      modal.querySelector('.ticket-batch-confirm')?.click();
      const completed = await waitFor(() => {
        const confirm = modal.querySelector('.ticket-batch-confirm');
        return confirm && confirm.dataset.mode === 'close' && !confirm.disabled ? confirm : null;
      }, 12000);
      actual.redeemed = Boolean(completed);
      completed?.click();
      await refreshRealClient();
      actual.historyVisible = String(document.getElementById('ticketHistoryList')?.textContent || '').includes('QA 真人操作票券');
    } finally {
      const cleaned = await qaServiceRequest('user.qa.fixture.cleanup', { fixtureTag: fixture.fixtureTag }).catch(() => null);
      actual.cleaned = Boolean(cleaned && cleaned.cleaned);
      await refreshRealClient().catch(() => {});
    }
    const ok = Object.values(actual).every(Boolean);
    return ok
      ? pass('已真人勾選票券、開啟確認、取消一次、再次確認核銷並看到使用紀錄，最後清理 QA 資料。', { allSteps: true }, actual)
      : fail('集點卡真人票券流程至少一個步驟異常。', { allSteps: true }, actual);
  }

  async function eventHumanTicketLifecycleCase() {
    const fixture = await qaServiceRequest('user.qa.fixture.prepare');
    const actual = { opened: false, closeWorked: false, claimed: false, redeemed: false, historyOpened: false, cleaned: false };
    try {
      await refreshRealClient();
      const selector = '[data-event-ticket-id="' + fixture.eventTicketId + '"]';
      let button = await waitFor(() => document.querySelector('#eventList ' + selector), 4000);
      if (!button) throw new Error('QA 活動票券沒有出現在活動票券頁面。');
      button.click();
      const modal = document.getElementById('ticketModal');
      actual.opened = Boolean(await waitFor(() => modal && !modal.classList.contains('hidden'), 1500));
      document.getElementById('closeTicketModal')?.click();
      actual.closeWorked = Boolean(await waitFor(() => modal?.classList.contains('hidden'), 1500));
      button = document.querySelector('#eventList ' + selector);
      button?.click();
      await waitFor(() => modal && !modal.classList.contains('hidden'), 1500);
      const action = document.getElementById('ticketModalAction');
      if (!action || action.disabled) throw new Error('活動票券領取按鈕不可操作。');
      action.click();
      actual.claimed = Boolean(await waitFor(() => !action.disabled && /確認使用/.test(action.textContent || ''), 6000));
      if (!actual.claimed) throw new Error('領券後 UI 未切換成可核銷狀態。');
      action.click();
      actual.redeemed = Boolean(await waitFor(() => !document.getElementById('ticketModalResult')?.classList.contains('hidden'), 6000));
      document.getElementById('closeTicketModal')?.click();
      await refreshRealClient();
      const history = await waitFor(() => document.querySelector('#usedTicketList ' + selector), 3500);
      history?.click();
      actual.historyOpened = Boolean(await waitFor(() => modal && !modal.classList.contains('hidden'), 1500));
      document.getElementById('closeTicketModal')?.click();
    } finally {
      const cleaned = await qaServiceRequest('user.qa.fixture.cleanup', { fixtureTag: fixture.fixtureTag }).catch(() => null);
      actual.cleaned = Boolean(cleaned && cleaned.cleaned);
      await refreshRealClient().catch(() => {});
    }
    const ok = Object.values(actual).every(Boolean);
    return ok
      ? pass('已真人完成活動票券開啟、關閉、領取、核銷、查看使用紀錄並清理 QA 資料。', { allSteps: true }, actual)
      : fail('活動票券真人流程至少一個步驟異常。', { allSteps: true }, actual);
  }

  async function calendarHumanDetailCase() {
    const fixture = await qaServiceRequest('user.qa.fixture.prepare');
    const actual = { dateVisible: false, opened: false, closeWorked: false, overlayCloseWorked: false, cleaned: false };
    try {
      await refreshRealClient();
      const selector = '[data-calendar-date="' + fixture.date + '"]';
      let day = await waitFor(() => document.querySelector(selector), 3500);
      actual.dateVisible = Boolean(day);
      day?.click();
      const modal = document.getElementById('calendarDetailModal');
      actual.opened = Boolean(await waitFor(() => modal && !modal.classList.contains('hidden'), 1500));
      document.getElementById('closeCalendarDetailButton')?.click();
      actual.closeWorked = Boolean(await waitFor(() => modal?.classList.contains('hidden'), 1500));
      day = document.querySelector(selector);
      day?.click();
      await waitFor(() => modal && !modal.classList.contains('hidden'), 1500);
      modal?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      actual.overlayCloseWorked = Boolean(await waitFor(() => modal?.classList.contains('hidden'), 1500));
    } finally {
      const cleaned = await qaServiceRequest('user.qa.fixture.cleanup', { fixtureTag: fixture.fixtureTag }).catch(() => null);
      actual.cleaned = Boolean(cleaned && cleaned.cleaned);
      await refreshRealClient().catch(() => {});
    }
    const ok = Object.values(actual).every(Boolean);
    return ok
      ? pass('已真人點擊含活動的日期、開啟明細、使用關閉鍵與背景關閉並清理 QA 日期。', { allSteps: true }, actual)
      : fail('日曆真人明細流程至少一個步驟異常。', { allSteps: true }, actual);
  }

  function chooseNormalServiceButton(root = document) {
    return Array.from(root.querySelectorAll('.service-choice .service-add-button')).find((button) => {
      const row = button.closest('.service-choice');
      return row && !/加購/.test(row.textContent || '');
    }) || null;
  }

  function firstEnabledBookingDate() {
    return Array.from(document.querySelectorAll('#calendarGrid button.calendar-day:not(:disabled)'))
      .find((button) => !button.classList.contains('holiday-disabled')) || null;
  }

  async function openBookingForSafeDate() {
    let day = firstEnabledBookingDate();
    if (!day) {
      document.getElementById('nextMonthButton')?.click();
      await wait(120);
      day = firstEnabledBookingDate();
    }
    if (!day) throw new Error('目前找不到可開啟預約的安全日期。');
    day.click();
    const panel = document.getElementById('appointmentPanel');
    if (!await waitFor(() => panel && !panel.classList.contains('hidden'), 1800)) throw new Error('預約選擇視窗未開啟。');
    return panel;
  }

  async function bookingHumanControlsCase() {
    const actual = {
      dateOpened: false, dateClosed: false, contactCustom: false, contactMember: false,
      partySizeChanged: true, serviceAdded: false, serviceRemoved: false, addonNotice: true
    };
    const panel = await openBookingForSafeDate();
    actual.dateOpened = !panel.classList.contains('hidden');
    document.getElementById('closeAppointmentButton')?.click();
    actual.dateClosed = Boolean(await waitFor(() => panel.classList.contains('hidden'), 1200));
    await openBookingForSafeDate();

    const custom = document.querySelector('input[name="bookingContactSource"][value="custom"]');
    const member = document.querySelector('input[name="bookingContactSource"][value="member"]');
    custom?.click();
    actual.contactCustom = !document.getElementById('bookingCustomContactFields')?.classList.contains('hidden');
    member?.click();
    actual.contactMember = Boolean(document.getElementById('bookingCustomContactFields')?.classList.contains('hidden'));

    const party = document.getElementById('bookingPartySize');
    if (party && party.options.length >= 2) {
      setFieldValue(party, '2');
      actual.partySizeChanged = document.querySelectorAll('#participantCardList .participant-card').length === 2;
      setFieldValue(party, '1');
      await wait(40);
    }

    const addonButton = Array.from(document.querySelectorAll('.service-choice .service-add-button')).find((button) => /加購/.test(button.closest('.service-choice')?.textContent || ''));
    if (addonButton) {
      addonButton.click();
      const notice = document.getElementById('bookingNoticeModal');
      actual.addonNotice = Boolean(await waitFor(() => notice && !notice.classList.contains('hidden'), 800));
      document.getElementById('confirmBookingNoticeButton')?.click();
      await waitFor(() => notice?.classList.contains('hidden'), 800);
    }

    const add = chooseNormalServiceButton(panel);
    if (add) {
      add.click();
      actual.serviceAdded = Boolean(await waitFor(() => document.querySelector('#selectedServiceList .selected-service-remove'), 1200));
      const remove = document.querySelector('#selectedServiceList .selected-service-remove');
      remove?.click();
      actual.serviceRemoved = Boolean(await waitFor(() => !document.querySelector('#selectedServiceList .selected-service-remove'), 1200));
    }
    document.getElementById('closeAppointmentButton')?.click();
    await waitFor(() => panel.classList.contains('hidden'), 1200);
    const ok = Object.values(actual).every(Boolean);
    return ok
      ? pass('已真人操作日期、預約視窗、聯絡資料來源、多人數量、加購提醒、增加與移除項目。', { allSteps: true }, actual)
      : fail('預約控制項真人操作至少一個步驟異常。', { allSteps: true }, actual);
  }

  async function waitForBookingCardByNote(note, timeoutMs = 8000) {
    return waitFor(() => Array.from(document.querySelectorAll('#bookingList .booking-item')).find((card) => (card.textContent || '').includes(note)), timeoutMs);
  }

  async function chooseAvailableSlot() {
    return waitFor(() => Array.from(document.querySelectorAll('#slotGrid .slot-button')).find((button) => !button.disabled), 7000);
  }

  async function bookingHumanLifecycleCase() {
    const note = 'QA HUMAN E2E ' + Date.now().toString(36);
    const updatedNote = note + ' updated';
    const actual = {
      added: false, slotSelected: false, confirmBack: false, confirmClose: false,
      created: false, historyExpanded: false, editOpened: false, editCancelled: false,
      updated: false, cancelRequested: false, cleaned: false
    };
    let bookingId = '';
    try {
      const panel = await openBookingForSafeDate();
      const add = chooseNormalServiceButton(panel);
      if (!add) return skip('目前沒有可供真人 E2E 的一般預約項目。', { normalService: true }, { normalService: false });
      add.click();
      actual.added = Boolean(await waitFor(() => document.querySelector('#selectedServiceList .selected-service-remove'), 1200));
      setFieldValue(document.getElementById('memberNote'), note);
      const slot = await chooseAvailableSlot();
      if (!slot) return skip('目前找不到可供真人 E2E 的預約時段。', { availableSlot: true }, { availableSlot: false });
      slot.click();
      actual.slotSelected = slot.getAttribute('aria-pressed') === 'true';

      const submit = document.getElementById('submitBookingButton');
      submit?.click();
      const confirmModal = document.getElementById('bookingConfirmModal');
      await waitFor(() => confirmModal && !confirmModal.classList.contains('hidden'), 1500);
      document.getElementById('cancelBookingConfirmButton')?.click();
      actual.confirmBack = Boolean(await waitFor(() => confirmModal?.classList.contains('hidden'), 1200));

      submit?.click();
      await waitFor(() => confirmModal && !confirmModal.classList.contains('hidden'), 1500);
      document.getElementById('closeBookingConfirmButton')?.click();
      actual.confirmClose = Boolean(await waitFor(() => confirmModal?.classList.contains('hidden'), 1200));

      submit?.click();
      await waitFor(() => confirmModal && !confirmModal.classList.contains('hidden'), 1500);
      document.getElementById('confirmBookingButton')?.click();
      let card = await waitForBookingCardByNote(note, 10000);
      actual.created = Boolean(card);
      bookingId = String(card?.dataset.bookingId || '');
      if (!bookingId) throw new Error('真人送出預約後找不到 Booking ID。');

      card?.querySelector('.booking-item-top')?.click();
      await wait(80);
      actual.historyExpanded = Boolean(await waitFor(() => document.querySelector('#bookingList .booking-item[data-booking-id="' + bookingId + '"]')?.dataset.bookingExpanded === '1', 1200));

      let edit = Array.from(card.querySelectorAll('button')).find((button) => button.textContent?.trim() === '修改預約');
      edit?.click();
      actual.editOpened = Boolean(await waitFor(() => !document.getElementById('appointmentPanel')?.classList.contains('hidden'), 1800));
      document.getElementById('cancelEditBookingButton')?.click();
      actual.editCancelled = Boolean(await waitFor(() => document.getElementById('editingBookingNotice')?.classList.contains('hidden'), 1500));

      card = document.querySelector('#bookingList .booking-item[data-booking-id="' + bookingId + '"]');
      edit = Array.from(card?.querySelectorAll('button') || []).find((button) => button.textContent?.trim() === '修改預約');
      edit?.click();
      await waitFor(() => !document.getElementById('appointmentPanel')?.classList.contains('hidden'), 1800);
      setFieldValue(document.getElementById('memberNote'), updatedNote);
      const editSubmit = await waitFor(() => {
        const button = document.getElementById('submitBookingButton');
        return button && !button.disabled ? button : null;
      }, 7000);
      editSubmit?.click();
      await waitFor(() => !document.getElementById('bookingConfirmModal')?.classList.contains('hidden'), 1500);
      document.getElementById('confirmBookingButton')?.click();
      card = await waitForBookingCardByNote(updatedNote, 10000);
      actual.updated = Boolean(card);

      const cancel = Array.from(card?.querySelectorAll('button') || []).find((button) => button.textContent?.trim() === '申請取消');
      if (cancel) {
        const originalConfirm = window.confirm;
        try {
          window.confirm = () => true;
          cancel.click();
        } finally {
          window.confirm = originalConfirm;
        }
        actual.cancelRequested = Boolean(await waitFor(() => /取消待確認/.test(document.querySelector('#bookingList .booking-item[data-booking-id="' + bookingId + '"] .status-badge')?.textContent || ''), 7000));
      }
    } finally {
      if (bookingId) {
        const cleaned = await qaServiceRequest('user.qa.fixture.cleanup', { bookingId }).catch(() => null);
        actual.cleaned = Boolean(cleaned && cleaned.cleaned);
        await refreshRealClient().catch(() => {});
      }
    }
    const ok = Object.values(actual).every(Boolean);
    return ok
      ? pass('已真人完成單人預約增加項目、選時段、返回修改、關閉確認、新增、修改、取消申請與清理。', { allSteps: true }, actual)
      : fail('單人預約真人生命週期至少一個步驟異常。', { allSteps: true }, actual);
  }

  async function bookingHumanGroupLifecycleCase() {
    const party = document.getElementById('bookingPartySize');
    if (!party || party.options.length < 2) {
      return skip('目前多人預約上限不足 2 人。', { partySizeAtLeast: 2 }, { partySize: party ? party.options.length : 0 });
    }
    const note = 'QA HUMAN E2E GROUP ' + Date.now().toString(36);
    const actual = { partyTwo: false, firstAdded: false, secondAdded: false, slotSelected: false, created: false, cleaned: false };
    let bookingId = '';
    try {
      await openBookingForSafeDate();
      setFieldValue(party, '2');
      actual.partyTwo = Boolean(await waitFor(() => document.querySelectorAll('#participantCardList .participant-card').length === 2, 1200));
      const cards = Array.from(document.querySelectorAll('#participantCardList .participant-card'));
      const firstAdd = chooseNormalServiceButton(cards[0] || document);
      firstAdd?.click();
      actual.firstAdded = Boolean(await waitFor(() => cards[0]?.querySelector('.selected-service-remove') || document.querySelector('#participantCardList .participant-card[data-participant-index="0"] .selected-service-remove'), 1200));
      const secondCard = document.querySelector('#participantCardList .participant-card[data-participant-index="1"]');
      if (secondCard && !secondCard.open) secondCard.querySelector('summary')?.click();
      const secondAdd = chooseNormalServiceButton(secondCard || document);
      secondAdd?.click();
      actual.secondAdded = Boolean(await waitFor(() => document.querySelector('#participantCardList .participant-card[data-participant-index="1"] .selected-service-remove'), 1200));
      setFieldValue(document.getElementById('memberNote'), note);
      const slot = await chooseAvailableSlot();
      if (!slot) return skip('目前找不到可容納兩位的安全時段。', { availableGroupSlot: true }, { availableGroupSlot: false });
      slot.click();
      actual.slotSelected = slot.getAttribute('aria-pressed') === 'true';
      document.getElementById('submitBookingButton')?.click();
      await waitFor(() => !document.getElementById('bookingConfirmModal')?.classList.contains('hidden'), 1800);
      document.getElementById('confirmBookingButton')?.click();
      const card = await waitForBookingCardByNote(note, 12000);
      actual.created = Boolean(card && card.dataset.participantDetails === '1');
      bookingId = String(card?.dataset.bookingId || '');
    } finally {
      if (bookingId) {
        const cleaned = await qaServiceRequest('user.qa.fixture.cleanup', { bookingId }).catch(() => null);
        actual.cleaned = Boolean(cleaned && cleaned.cleaned);
        await refreshRealClient().catch(() => {});
      }
      setFieldValue(document.getElementById('bookingPartySize'), '1');
    }
    const ok = Object.values(actual).every(Boolean);
    return ok
      ? pass('已真人操作兩位預約：設定人數、兩位各加項目、選時段、確認送出並清理。', { allSteps: true }, actual)
      : fail('多人預約真人流程至少一個步驟異常。', { allSteps: true }, actual);
  }

  async function buttonCoverageCase() {
    const qaPanel = state.panel;
    const buttons = Array.from(document.querySelectorAll('button')).filter((button) => !qaPanel?.contains(button));
    const navigationIds = new Set(['retryButton','logoutButton','joinMemberButton','refreshProfileButton','refreshTicketButton']);
    const patterns = {
      member: /^(edit|close|cancel|save|profileBirthdayPicker|confirmProfileBirthdayPicker)/,
      points: /^(retryButton|joinMemberButton|logoutButton)$|card-tab|ticket-overview-use|ticket-batch-(cancel|confirm)/,
      event: /^(retryButton|joinMemberButton|logoutButton|closeTicketModal|ticketModalAction|refreshTicketButton)$|ticket-button|event-history-button/,
      calendar: /^(retryButton|joinMemberButton|logoutButton|previousMonthButton|todayButton|nextMonthButton|closeCalendarDetailButton)$|calendar-day/,
      booking: /^(retryButton|joinMemberButton|logoutButton|previousMonthButton|nextMonthButton|closeAppointmentButton|cancelEditBookingButton|submitBookingButton|confirmBookingNoticeButton|closeBookingConfirmButton|cancelBookingConfirmButton|confirmBookingButton|closeBookingHolidayButton)$|calendar-day|service-add-button|selected-service-remove|slot-button|text-danger-button|button-light/
    };
    const mapped = [];
    const unmapped = [];
    const navigation = [];
    for (const button of buttons) {
      const signature = button.id || button.className || (button.textContent || '').trim().slice(0, 40);
      if (navigationIds.has(button.id)) {
        navigation.push(signature);
        continue;
      }
      const pattern = patterns[surface];
      if (pattern && pattern.test([button.id, button.className, (button.textContent || '').trim()].join(' '))) mapped.push(signature);
      else unmapped.push(signature);
    }
    const actual = { totalButtons: buttons.length, mappedFunctional: mapped.length, navigationSessionControls: navigation, unmapped };
    return unmapped.length === 0
      ? pass('目前頁面的功能按鈕都已納入真人操作劇本或明確列為會中斷 Session 的導覽控制。', { unmapped: [] }, actual)
      : fail('發現尚未納入測試劇本的新按鈕，完整測試需補案例。', { unmapped: [] }, actual);
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
    const contact = await expectApiError(
      'user.member.profile.save',
      { birthday: 'not-a-date', phone: 'x' },
      ['INVALID_BIRTHDAY', 'INVALID_PHONE', 'INVALID_']
    );
    const honorific = await expectApiError(
      'user.member.profile.save',
      { surname: '', salutation: 'invalid' },
      ['INVALID_SURNAME', 'INVALID_SALUTATION', 'INVALID_']
    );
    const ok = contact.ok && honorific.ok;
    return ok
      ? pass(
          '會員資料 API 會拒絕無效生日、電話、姓氏與稱謂，不執行資料修改。',
          { contactRejected: true, honorificRejected: true },
          { contact, honorific }
        )
      : fail(
          '會員資料寫入驗證沒有完整拒絕無效輸入。',
          { contactRejected: true, honorificRejected: true },
          { contact, honorific }
        );
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