(() => {
  'use strict';

  const PRIMARY_TAB_IDS = ['membersTab', 'cardsTab', 'eventsTab', 'calendarTab'];
  const PRIMARY_PANEL_IDS = ['membersPanel', 'cardsPanel', 'eventsPanel', 'calendarPanel'];
  const STATUS_LABELS = { pending: '待確認', confirmed: '已確認', rejected: '未通過', cancelled: '已取消' };
  const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];
  const WRITE_ACTIONS = new Set(['admin.booking.service.save', 'admin.booking.status.update']);
  const state = {
    config: null,
    data: { services: [], bookings: [] },
    filter: 'pending',
    loaded: false,
    loading: false,
    savingService: false,
    writeLocked: false,
  };
  const els = {};

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();

  function mount() {
    const nav = document.querySelector('#adminView .surface-nav');
    const adminView = document.getElementById('adminView');
    if (!nav || !adminView || document.getElementById('bookingTab')) return;

    loadStylesheet();

    const tab = document.createElement('button');
    tab.id = 'bookingTab';
    tab.className = 'surface-tab';
    tab.type = 'button';
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', 'false');
    tab.setAttribute('aria-controls', 'bookingPanel');
    tab.textContent = '預約';
    nav.appendChild(tab);

    const panel = document.createElement('section');
    panel.id = 'bookingPanel';
    panel.className = 'panel hidden';
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', 'bookingTab');
    panel.innerHTML = `
      <div class="panel-heading booking-admin-heading">
        <div><p class="kicker">Booking operations</p><h2>預約管理</h2><p>設定會員可預約項目、工作時間、提前預約天數，並確認會員送出的預約。</p></div>
        <div class="heading-actions"><span id="bookingAdminSyncStatus" class="sync-status">尚未同步</span><button id="bookingAdminRefreshButton" class="button button-outline" type="button">更新預約</button></div>
      </div>

      <section class="booking-admin-stats" aria-label="預約概況">
        <div><span>預約項目</span><strong id="bookingAdminServiceCount">0</strong><small>已建立項目</small></div>
        <div><span>待確認</span><strong id="bookingAdminPendingCount">0</strong><small>需管理端確認</small></div>
        <div><span>已確認</span><strong id="bookingAdminConfirmedCount">0</strong><small>完成預約</small></div>
      </section>

      <div class="booking-admin-workspace">
        <section class="booking-admin-card" aria-labelledby="bookingAdminServiceTitle">
          <div class="booking-admin-section-heading"><div><p class="kicker">Booking services</p><h3 id="bookingAdminServiceTitle">預約項目設定</h3><p>工作時間需以 30 分鐘為邊界；會員端會自動產生 30 分鐘預約時段。</p></div><button id="bookingAdminNewServiceButton" class="button button-outline" type="button">＋ 新增項目</button></div>
          <form id="bookingAdminServiceForm" class="booking-admin-form" novalidate>
            <input id="bookingAdminServiceId" type="hidden"><input id="bookingAdminExpectedUpdatedAt" type="hidden">
            <label>預約項目名稱<input id="bookingAdminServiceName" type="text" maxlength="100" placeholder="例如：諮詢服務" required></label>
            <label>項目說明<textarea id="bookingAdminDescription" maxlength="1000" rows="3" placeholder="會員選擇此項目時顯示的說明"></textarea></label>
            <div class="booking-admin-form-grid">
              <label>開始工作時間<input id="bookingAdminStartTime" type="time" step="1800" value="09:00" required></label>
              <label>結束工作時間<input id="bookingAdminEndTime" type="time" step="1800" value="17:00" required></label>
            </div>
            <label>需要提前幾天預約<input id="bookingAdminAdvanceDays" type="number" min="0" max="365" step="1" value="0" required><small>0 = 可預約今天尚未經過的時段；2 = 最早只能預約兩天後。</small></label>
            <fieldset class="booking-admin-weekdays"><legend>開放預約星期</legend><div>
              <label><input type="checkbox" name="bookingAdminWeekday" value="1" checked>一</label>
              <label><input type="checkbox" name="bookingAdminWeekday" value="2" checked>二</label>
              <label><input type="checkbox" name="bookingAdminWeekday" value="3" checked>三</label>
              <label><input type="checkbox" name="bookingAdminWeekday" value="4" checked>四</label>
              <label><input type="checkbox" name="bookingAdminWeekday" value="5" checked>五</label>
              <label><input type="checkbox" name="bookingAdminWeekday" value="6" checked>六</label>
              <label><input type="checkbox" name="bookingAdminWeekday" value="0" checked>日</label>
            </div></fieldset>
            <label class="booking-admin-toggle"><input id="bookingAdminActive" type="checkbox" checked><span><strong>開放會員預約</strong><small>關閉後會員端不再顯示此項目，既有預約紀錄仍保留。</small></span></label>
            <div id="bookingAdminServiceMessage" class="form-message hidden" role="status" aria-live="polite"></div>
            <button id="bookingAdminSaveServiceButton" class="button button-dark" type="submit">儲存預約項目</button>
          </form>
          <div class="booking-admin-list-heading"><strong>已建立項目</strong><span id="bookingAdminServiceListCount">0</span></div>
          <div id="bookingAdminServiceList" class="booking-admin-service-list"></div>
          <div id="bookingAdminServiceEmpty" class="empty-state compact hidden"><span aria-hidden="true">○</span><p>尚未建立預約項目</p></div>
        </section>

        <section class="booking-admin-card" aria-labelledby="bookingAdminQueueTitle">
          <div class="booking-admin-section-heading"><div><p class="kicker">Confirmation queue</p><h3 id="bookingAdminQueueTitle">預約確認</h3><p>會員送出後先保留時段；管理端按「確認預約」後才算完成。</p></div></div>
          <div class="booking-admin-filter" role="group" aria-label="預約狀態篩選">
            <button class="booking-admin-filter-button active" data-booking-filter="pending" type="button">待確認</button>
            <button class="booking-admin-filter-button" data-booking-filter="confirmed" type="button">已確認</button>
            <button class="booking-admin-filter-button" data-booking-filter="all" type="button">全部</button>
          </div>
          <div id="bookingAdminQueue" class="booking-admin-queue"></div>
          <div id="bookingAdminQueueEmpty" class="empty-state compact hidden"><span aria-hidden="true">○</span><p>目前沒有符合條件的預約</p></div>
        </section>
      </div>`;
    adminView.appendChild(panel);

    cacheElements();
    bindEvents();
    openHashWhenAdminReady();
  }

  function loadStylesheet() {
    if (document.querySelector('link[data-booking-admin-panel-style]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = './booking-panel.css?v=booking-workbench-20260910';
    link.dataset.bookingAdminPanelStyle = 'true';
    document.head.appendChild(link);
  }

  function cacheElements() {
    [
      'bookingTab', 'bookingPanel', 'bookingAdminSyncStatus', 'bookingAdminRefreshButton', 'bookingAdminServiceCount', 'bookingAdminPendingCount', 'bookingAdminConfirmedCount',
      'bookingAdminNewServiceButton', 'bookingAdminServiceForm', 'bookingAdminServiceId', 'bookingAdminExpectedUpdatedAt', 'bookingAdminServiceName', 'bookingAdminDescription',
      'bookingAdminStartTime', 'bookingAdminEndTime', 'bookingAdminAdvanceDays', 'bookingAdminActive', 'bookingAdminServiceMessage', 'bookingAdminSaveServiceButton',
      'bookingAdminServiceListCount', 'bookingAdminServiceList', 'bookingAdminServiceEmpty', 'bookingAdminQueue', 'bookingAdminQueueEmpty'
    ].forEach((id) => { els[id] = document.getElementById(id); });
  }

  function bindEvents() {
    els.bookingTab.addEventListener('click', activateBookingPanel);
    PRIMARY_TAB_IDS.forEach((id) => document.getElementById(id)?.addEventListener('click', deactivateBookingPanel));
    els.bookingAdminRefreshButton.addEventListener('click', () => refreshBookingData(true));
    els.bookingAdminNewServiceButton.addEventListener('click', resetServiceForm);
    els.bookingAdminServiceForm.addEventListener('submit', saveService);
    document.querySelectorAll('[data-booking-filter]').forEach((button) => button.addEventListener('click', () => setFilter(button.dataset.bookingFilter || 'pending')));
  }

  function activateBookingPanel() {
    PRIMARY_TAB_IDS.forEach((id) => document.getElementById(id)?.setAttribute('aria-selected', 'false'));
    PRIMARY_PANEL_IDS.forEach((id) => document.getElementById(id)?.classList.add('hidden'));
    els.bookingTab.setAttribute('aria-selected', 'true');
    els.bookingPanel.classList.remove('hidden');
    if (window.location.hash !== '#booking') window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.search}#booking`);
    if (!state.loaded && !state.loading) refreshBookingData(false);
  }

  function deactivateBookingPanel() {
    els.bookingTab.setAttribute('aria-selected', 'false');
    els.bookingPanel.classList.add('hidden');
    if (window.location.hash === '#booking') window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.search}`);
  }

  function openHashWhenAdminReady() {
    if (window.location.hash !== '#booking') return;
    const adminView = document.getElementById('adminView');
    const tryOpen = () => {
      if (!adminView.classList.contains('hidden') && window.liff?.getIDToken?.()) {
        activateBookingPanel();
        return true;
      }
      return false;
    };
    if (tryOpen()) return;
    const observer = new MutationObserver(() => { if (tryOpen()) observer.disconnect(); });
    observer.observe(adminView, { attributes: true, attributeFilter: ['class'] });
    window.setTimeout(() => observer.disconnect(), 30000);
  }

  async function adminContext() {
    if (!state.config) state.config = await window.MemberSystem.loadConfig();
    const idToken = String(window.liff?.getIDToken?.() || '');
    if (!idToken) throw clientError('AUTH_REQUIRED', '管理端登入尚未完成，請重新整理後再試。');
    return { config: state.config, idToken };
  }

  async function bookingRequest(action, payload = {}) {
    const { config, idToken } = await adminContext();
    const isWrite = WRITE_ACTIONS.has(action);
    const endpoint = `${String(config.supabaseUrl || '').replace(/\/$/, '')}/functions/v1/booking-api`;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), isWrite ? 30000 : 15000);
    let response;
    let text;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': String(config.supabasePublishableKey || '') },
        cache: 'no-store',
        signal: controller.signal,
        body: JSON.stringify({ ...payload, action, clientType: 'admin', idToken }),
      });
      text = await response.text();
    } catch (_) {
      if (isWrite) throw clientError('API_RESPONSE_UNCERTAIN', '無法確認這次預約管理操作是否已送達；請先更新資料確認，請勿重複送出。');
      throw clientError('NETWORK_ERROR', '目前無法連線預約服務，請檢查網路後重試。');
    } finally {
      window.clearTimeout(timer);
    }

    let data;
    try { data = JSON.parse(text); }
    catch {
      throw clientError(isWrite ? 'API_RESPONSE_UNCERTAIN' : 'API_RESPONSE_ERROR', isWrite ? '無法確認操作結果；請先更新資料確認。' : '預約服務回傳格式不正確。');
    }
    if (!response.ok || !data || data.ok !== true) {
      const apiError = data && data.error || {};
      const error = clientError(String(apiError.code || 'API_ERROR'), String(apiError.message || '預約服務拒絕此操作。'));
      error.details = apiError.details || null;
      error.status = Number(data && data.status || response.status || 0);
      throw error;
    }
    return data.data || {};
  }

  function clientError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  async function refreshBookingData(showSuccess) {
    if (state.loading) return;
    state.loading = true;
    els.bookingAdminRefreshButton.disabled = true;
    setSyncStatus('同步預約資料中…');
    try {
      const result = await bookingRequest('admin.booking.bootstrap');
      state.data = {
        services: Array.isArray(result.services) ? result.services : [],
        bookings: Array.isArray(result.bookings) ? result.bookings : [],
      };
      state.loaded = true;
      state.writeLocked = false;
      renderAll();
      setSyncStatus(showSuccess ? '預約資料已更新' : `已同步 · ${new Date().toLocaleTimeString('zh-Hant-TW', { hour: '2-digit', minute: '2-digit' })}`);
    } catch (error) {
      setSyncStatus(error?.message || '預約資料同步失敗', true);
      showServiceMessage(error?.message || '預約資料暫時無法載入。', 'error');
    } finally {
      state.loading = false;
      els.bookingAdminRefreshButton.disabled = false;
      applyWriteLock();
    }
  }

  function renderAll() {
    renderStats();
    renderServices();
    renderBookings();
  }

  function renderStats() {
    const services = state.data.services || [];
    const bookings = state.data.bookings || [];
    const pending = bookings.filter((booking) => booking.status === 'pending').length;
    els.bookingAdminServiceCount.textContent = String(services.length);
    els.bookingAdminPendingCount.textContent = String(pending);
    els.bookingAdminConfirmedCount.textContent = String(bookings.filter((booking) => booking.status === 'confirmed').length);
    els.bookingTab.dataset.pendingCount = String(pending);
    els.bookingTab.setAttribute('aria-label', pending ? `預約，${pending} 筆待確認` : '預約');
  }

  function renderServices() {
    const services = state.data.services || [];
    els.bookingAdminServiceList.replaceChildren();
    els.bookingAdminServiceListCount.textContent = String(services.length);
    els.bookingAdminServiceEmpty.classList.toggle('hidden', services.length > 0);
    services.forEach((service) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `booking-admin-service-row${service.isActive ? '' : ' inactive'}`;
      button.addEventListener('click', () => editService(service));
      const body = document.createElement('span');
      const title = document.createElement('strong');
      title.textContent = String(service.title || '未命名項目');
      const meta = document.createElement('small');
      meta.textContent = `${service.workStartTime}–${service.workEndTime}｜提前 ${service.minAdvanceDays || 0} 天｜星期${(service.availableWeekdays || []).map((day) => WEEKDAY_LABELS[Number(day)]).join('、')}`;
      body.append(title, meta);
      const badge = document.createElement('span');
      badge.className = `booking-admin-service-status ${service.isActive ? 'active' : 'inactive'}`;
      badge.textContent = service.isActive ? '開放' : '關閉';
      button.append(body, badge);
      els.bookingAdminServiceList.appendChild(button);
    });
  }

  function editService(service) {
    els.bookingAdminServiceId.value = String(service.serviceId || '');
    els.bookingAdminExpectedUpdatedAt.value = String(service.updatedAt || '');
    els.bookingAdminServiceName.value = String(service.title || '');
    els.bookingAdminDescription.value = String(service.description || '');
    els.bookingAdminStartTime.value = String(service.workStartTime || '09:00');
    els.bookingAdminEndTime.value = String(service.workEndTime || '17:00');
    els.bookingAdminAdvanceDays.value = String(service.minAdvanceDays ?? 0);
    els.bookingAdminActive.checked = Boolean(service.isActive);
    const enabled = new Set((service.availableWeekdays || []).map(Number));
    document.querySelectorAll('input[name="bookingAdminWeekday"]').forEach((checkbox) => { checkbox.checked = enabled.has(Number(checkbox.value)); });
    els.bookingAdminSaveServiceButton.textContent = '儲存修改';
    clearServiceMessage();
    els.bookingAdminServiceName.focus();
  }

  function resetServiceForm() {
    els.bookingAdminServiceForm.reset();
    els.bookingAdminServiceId.value = '';
    els.bookingAdminExpectedUpdatedAt.value = '';
    els.bookingAdminStartTime.value = '09:00';
    els.bookingAdminEndTime.value = '17:00';
    els.bookingAdminAdvanceDays.value = '0';
    els.bookingAdminActive.checked = true;
    document.querySelectorAll('input[name="bookingAdminWeekday"]').forEach((checkbox) => { checkbox.checked = true; });
    els.bookingAdminSaveServiceButton.textContent = '儲存預約項目';
    clearServiceMessage();
    els.bookingAdminServiceName.focus();
  }

  async function saveService(event) {
    event.preventDefault();
    if (state.savingService || state.writeLocked) return;
    const weekdays = [...document.querySelectorAll('input[name="bookingAdminWeekday"]:checked')].map((checkbox) => Number(checkbox.value));
    const startTime = els.bookingAdminStartTime.value;
    const endTime = els.bookingAdminEndTime.value;
    const advanceDays = Number(els.bookingAdminAdvanceDays.value);
    if (!els.bookingAdminServiceName.value.trim()) return showServiceMessage('請輸入預約項目名稱。', 'error');
    if (!weekdays.length) return showServiceMessage('請至少選擇一個開放預約星期。', 'error');
    if (!/^\d{2}:(00|30)$/.test(startTime) || !/^\d{2}:(00|30)$/.test(endTime) || timeMinutes(endTime) <= timeMinutes(startTime)) return showServiceMessage('工作時間必須以 30 分鐘為單位，且結束時間需晚於開始時間。', 'error');
    if (!Number.isInteger(advanceDays) || advanceDays < 0 || advanceDays > 365) return showServiceMessage('提前預約天數必須是 0–365 的整數。', 'error');

    state.savingService = true;
    els.bookingAdminSaveServiceButton.disabled = true;
    els.bookingAdminSaveServiceButton.textContent = '儲存中…';
    clearServiceMessage();
    try {
      const result = await bookingRequest('admin.booking.service.save', {
        serviceId: els.bookingAdminServiceId.value || undefined,
        expectedUpdatedAt: els.bookingAdminExpectedUpdatedAt.value || undefined,
        title: els.bookingAdminServiceName.value,
        description: els.bookingAdminDescription.value,
        workStartTime: startTime,
        workEndTime: endTime,
        minAdvanceDays: advanceDays,
        availableWeekdays: weekdays,
        isActive: els.bookingAdminActive.checked,
      });
      const saved = result.service;
      const index = state.data.services.findIndex((service) => service.serviceId === saved.serviceId);
      if (index >= 0) state.data.services[index] = saved;
      else state.data.services.push(saved);
      renderStats();
      renderServices();
      editService(saved);
      showServiceMessage('預約項目已儲存，會員端會依工作時間產生 30 分鐘時段。', 'success');
    } catch (error) {
      if (error?.code === 'API_RESPONSE_UNCERTAIN') lockWrites(error.message);
      showServiceMessage(error?.message || '預約項目儲存失敗。', 'error');
      if (error?.code === 'CONFLICT') await refreshBookingData(false);
    } finally {
      state.savingService = false;
      els.bookingAdminSaveServiceButton.textContent = els.bookingAdminServiceId.value ? '儲存修改' : '儲存預約項目';
      applyWriteLock();
    }
  }

  function timeMinutes(value) {
    const [hours, minutes] = String(value || '').split(':').map(Number);
    return hours * 60 + minutes;
  }

  function setFilter(filter) {
    state.filter = ['pending', 'confirmed', 'all'].includes(filter) ? filter : 'pending';
    document.querySelectorAll('[data-booking-filter]').forEach((button) => button.classList.toggle('active', button.dataset.bookingFilter === state.filter));
    renderBookings();
  }

  function renderBookings() {
    const all = state.data.bookings || [];
    const bookings = state.filter === 'all' ? all : all.filter((booking) => booking.status === state.filter);
    els.bookingAdminQueue.replaceChildren();
    els.bookingAdminQueueEmpty.classList.toggle('hidden', bookings.length > 0);
    bookings.forEach((booking) => els.bookingAdminQueue.appendChild(createBookingCard(booking)));
  }

  function createBookingCard(booking) {
    const article = document.createElement('article');
    article.className = `booking-admin-booking status-${booking.status}`;
    const heading = document.createElement('div');
    heading.className = 'booking-admin-booking-heading';
    const identity = document.createElement('div');
    const memberName = document.createElement('strong');
    memberName.textContent = booking.memberDisplayName || booking.memberCode || '會員';
    const memberCode = document.createElement('small');
    memberCode.textContent = booking.memberCode || '';
    identity.append(memberName, memberCode);
    const badge = document.createElement('span');
    badge.className = `booking-admin-status status-${booking.status}`;
    badge.textContent = STATUS_LABELS[booking.status] || booking.status;
    heading.append(identity, badge);

    const service = document.createElement('h4');
    service.textContent = booking.serviceTitle || '預約項目';
    const time = document.createElement('p');
    time.className = 'booking-admin-time';
    time.textContent = `${formatDate(booking.bookingDate)}　${booking.startTime}–${booking.endTime}`;
    article.append(heading, service, time);

    if (booking.memberNote) article.append(noteParagraph(`會員備註：${booking.memberNote}`, 'member'));
    if (booking.adminNote && booking.status !== 'pending') article.append(noteParagraph(`管理端說明：${booking.adminNote}`, 'admin'));

    if (booking.status === 'pending' || booking.status === 'confirmed') {
      const label = document.createElement('label');
      label.className = 'booking-admin-note-field';
      const caption = document.createElement('span');
      caption.textContent = '管理端說明（選填）';
      const input = document.createElement('textarea');
      input.rows = 2;
      input.maxLength = 500;
      input.value = booking.adminNote || '';
      input.placeholder = booking.status === 'pending' ? '確認或拒絕時可提供會員說明' : '取消已確認預約時可提供原因';
      label.append(caption, input);
      article.appendChild(label);

      const actions = document.createElement('div');
      actions.className = 'booking-admin-actions';
      if (booking.status === 'pending') {
        actions.append(
          actionButton('拒絕', 'button-danger', () => updateBookingStatus(booking, 'rejected', input.value, actions)),
          actionButton('確認預約', 'button-dark', () => updateBookingStatus(booking, 'confirmed', input.value, actions))
        );
      } else {
        actions.append(actionButton('取消已確認預約', 'button-danger', () => updateBookingStatus(booking, 'cancelled', input.value, actions)));
      }
      article.appendChild(actions);
    }
    return article;
  }

  function noteParagraph(text, kind) {
    const paragraph = document.createElement('p');
    paragraph.className = `booking-admin-note ${kind}`;
    paragraph.textContent = text;
    return paragraph;
  }

  function actionButton(label, className, handler) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `button ${className}`;
    button.textContent = label;
    button.disabled = state.writeLocked;
    button.addEventListener('click', handler);
    return button;
  }

  async function updateBookingStatus(booking, status, adminNote, actionContainer) {
    if (state.writeLocked) return;
    const message = status === 'confirmed'
      ? `確認 ${booking.memberDisplayName || '此會員'} 的 ${booking.bookingDate} ${booking.startTime} 預約？`
      : status === 'rejected' ? '確定拒絕這筆預約？此時段會重新開放。' : '確定取消這筆已確認預約？此時段會重新開放。';
    if (!window.confirm(message)) return;
    actionContainer.querySelectorAll('button').forEach((button) => { button.disabled = true; });
    try {
      const result = await bookingRequest('admin.booking.status.update', { bookingId: booking.bookingId, status, adminNote });
      state.data.bookings = state.data.bookings.map((item) => item.bookingId === result.booking.bookingId ? result.booking : item);
      renderStats();
      renderBookings();
      setSyncStatus(status === 'confirmed' ? '預約已確認' : status === 'rejected' ? '預約已拒絕' : '預約已取消');
    } catch (error) {
      if (error?.code === 'API_RESPONSE_UNCERTAIN') lockWrites(error.message);
      window.alert(error?.message || '預約狀態更新失敗。');
      if (!state.writeLocked) await refreshBookingData(false);
    }
  }

  function formatDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
    return match ? `${Number(match[1])}/${Number(match[2])}/${Number(match[3])}` : String(value || '—');
  }

  function lockWrites(message) {
    state.writeLocked = true;
    setSyncStatus(message || '操作結果尚未確認，請更新資料後再操作。', true);
    applyWriteLock();
  }

  function applyWriteLock() {
    const locked = state.writeLocked;
    els.bookingAdminSaveServiceButton.disabled = locked || state.savingService;
    els.bookingAdminNewServiceButton.disabled = locked;
    els.bookingAdminQueue.querySelectorAll('button').forEach((button) => { button.disabled = locked; });
  }

  function showServiceMessage(message, type) {
    els.bookingAdminServiceMessage.textContent = String(message || '');
    els.bookingAdminServiceMessage.className = `form-message ${type || ''}`;
  }

  function clearServiceMessage() {
    els.bookingAdminServiceMessage.textContent = '';
    els.bookingAdminServiceMessage.className = 'form-message hidden';
  }

  function setSyncStatus(message, error = false) {
    els.bookingAdminSyncStatus.textContent = String(message || '');
    els.bookingAdminSyncStatus.classList.toggle('error', Boolean(error));
  }
})();
