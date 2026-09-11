(() => {
  'use strict';

  const STORE_SERVICE_ID = '00000000-0000-4000-8000-000000000010';
  const PRIMARY_TAB_IDS = ['membersTab', 'cardsTab', 'eventsTab', 'calendarTab'];
  const PRIMARY_PANEL_IDS = ['membersPanel', 'cardsPanel', 'eventsPanel', 'calendarPanel'];
  const STATUS_LABELS = { pending: '待確認', confirmed: '已確認', completed: '服務已完成', rejected: '未通過', cancelled: '已取消' };
  const state = {
    config: null,
    booking: { settings: {}, bookings: [] },
    catalog: { serviceTypes: [], services: [] },
    filter: 'pending',
    subtab: 'services',
    selected: new Set(),
    loading: false,
    busy: false,
    realtimeClient: null,
    realtimeChannel: null,
    realtimeTimer: null,
  };
  const els = {};

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();

  function mount() {
    const nav = document.querySelector('#adminView .surface-nav');
    const adminView = document.getElementById('adminView');
    if (!nav || !adminView || document.getElementById('bookingTab')) return;

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
        <div><p class="kicker">Booking operations</p><h2>預約管理</h2><p>共用設定、項目類型、預約項目與預約確認分開管理。</p></div>
        <div class="heading-actions"><span id="bookingAdminSyncStatus" class="sync-status">尚未同步</span><button id="bookingAdminRefreshButton" class="button button-outline" type="button">更新預約</button></div>
      </div>

      <section class="booking-admin-card booking-admin-hours-card" aria-labelledby="bookingAdminHoursTitle">
        <div class="booking-admin-section-heading"><div><p class="kicker">Booking settings</p><h3 id="bookingAdminHoursTitle">預約共用設定</h3><p>工作時間、提前預約天數與會員端預約說明套用到所有預約項目。</p></div></div>
        <form id="bookingAdminSettingsForm" class="booking-admin-form booking-admin-settings-form" novalidate>
          <div class="booking-admin-form-grid booking-admin-global-settings-grid">
            <label>開始工作時間<input id="bookingAdminStartTime" type="time" step="1800" value="09:00" required></label>
            <label>結束工作時間<input id="bookingAdminEndTime" type="time" step="1800" value="17:00" required></label>
            <label>需要提前幾天預約<input id="bookingAdminAdvanceDays" type="number" min="0" max="365" step="1" value="0" required><small>0 = 可預約今天尚未經過的開始時段。</small></label>
            <label style="grid-column:1/-1">預約說明（可換行）<textarea id="bookingAdminNotice" maxlength="2000" rows="5" placeholder="例如：\n請於預約時間前 10 分鐘抵達。\n如需取消或更改時間，請提前聯繫。"></textarea><small>最多 2,000 字；會員端會依原本換行顯示。</small></label>
          </div>
          <div id="bookingAdminSettingsMessage" class="form-message hidden" role="status" aria-live="polite"></div>
          <div class="booking-admin-inline-actions"><button id="bookingAdminSaveSettingsButton" class="button button-dark" type="submit">儲存預約設定</button></div>
        </form>

        <div class="booking-admin-list-heading"><strong>項目類型</strong><button id="bookingAdminNewTypeButton" class="button button-outline" type="button">＋ 新增類型</button></div>
        <div id="bookingAdminTypeMessage" class="form-message hidden" role="status"></div>
        <div id="bookingAdminTypeList" class="booking-admin-service-list"></div>
        <div id="bookingAdminTypeEmpty" class="empty-state compact hidden"><span aria-hidden="true">○</span><p>尚未建立項目類型</p></div>
      </section>

      <section class="booking-admin-stats" aria-label="預約概況">
        <div><span>預約項目</span><strong id="bookingAdminServiceCount">0</strong><small>目前可管理項目</small></div>
        <div><span>待確認</span><strong id="bookingAdminPendingCount">0</strong><small>需管理端確認</small></div>
        <div><span>已確認</span><strong id="bookingAdminConfirmedCount">0</strong><small>完成預約</small></div>
      </section>

      <nav class="booking-admin-filter booking-admin-subtabs" role="tablist" aria-label="預約管理分類">
        <button id="bookingAdminServicesSubtab" class="booking-admin-filter-button active" type="button" role="tab" aria-selected="true" aria-controls="bookingAdminServicesPanel">預約項目</button>
        <button id="bookingAdminQueueSubtab" class="booking-admin-filter-button" type="button" role="tab" aria-selected="false" aria-controls="bookingAdminQueuePanel">預約確認<span id="bookingAdminQueueSubtabCount"></span></button>
      </nav>

      <div class="booking-admin-subtab-panels">
        <section id="bookingAdminServicesPanel" class="booking-admin-card" role="tabpanel" aria-labelledby="bookingAdminServicesSubtab">
          <div class="booking-admin-section-heading"><div><p class="kicker">Booking services</p><h3>預約項目</h3><p>可單筆新增、修改、刪除，也可勾選後批次修改或批次刪除。</p></div></div>
          <div class="booking-admin-actions" style="justify-content:flex-start;margin:0 0 14px">
            <button id="bookingAdminNewServiceButton" class="button button-dark" type="button">＋ 新增項目</button>
            <button id="bookingAdminBatchAddButton" class="button button-outline" type="button">批次新增</button>
            <button id="bookingAdminBatchEditButton" class="button button-outline" type="button" disabled>批次修改</button>
            <button id="bookingAdminBatchDeleteButton" class="button button-danger" type="button" disabled>批次刪除</button>
          </div>
          <div id="bookingAdminServiceMessage" class="form-message hidden" role="status"></div>
          <div id="bookingAdminServiceList" class="booking-admin-service-list"></div>
          <div id="bookingAdminServiceEmpty" class="empty-state compact hidden"><span aria-hidden="true">○</span><p>尚未建立預約項目</p></div>
        </section>

        <section id="bookingAdminQueuePanel" class="booking-admin-card hidden" role="tabpanel" aria-labelledby="bookingAdminQueueSubtab">
          <div class="booking-admin-section-heading"><div><p class="kicker">Confirmation queue</p><h3>預約確認</h3><p>待確認預約會先佔用整段時間；管理員可依現場實際服務修改項目，再確認服務完成。</p></div></div>
          <div class="booking-admin-filter" role="group" aria-label="預約狀態篩選">
            <button class="booking-admin-filter-button active" data-booking-filter="pending" type="button">待確認</button>
            <button class="booking-admin-filter-button" data-booking-filter="confirmed" type="button">已確認</button><button class="booking-admin-filter-button" data-booking-filter="completed" type="button">已完成</button>
            <button class="booking-admin-filter-button" data-booking-filter="all" type="button">全部</button>
          </div>
          <div id="bookingAdminQueue" class="booking-admin-queue"></div>
          <div id="bookingAdminQueueEmpty" class="empty-state compact hidden"><span aria-hidden="true">○</span><p>目前沒有符合條件的預約</p></div>
        </section>
      </div>`;
    adminView.appendChild(panel);

    const modal = document.createElement('div');
    modal.id = 'bookingAdminCrudModal';
    modal.className = 'booking-admin-modal hidden';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.innerHTML = `<div class="booking-admin-modal-card"><div class="booking-admin-modal-heading"><div><p class="kicker">Booking editor</p><h2 id="bookingAdminCrudModalTitle">管理</h2></div><button id="bookingAdminCrudModalClose" class="booking-admin-modal-close" type="button" aria-label="關閉">×</button></div><div id="bookingAdminCrudModalBody"></div></div>`;
    document.body.appendChild(modal);

    cacheElements();
    bindEvents();
    setSubtab('services');
    openHashWhenAdminReady();
  }

  function cacheElements() {
    [
      'bookingTab','bookingPanel','bookingAdminSyncStatus','bookingAdminRefreshButton','bookingAdminSettingsForm','bookingAdminStartTime','bookingAdminEndTime','bookingAdminAdvanceDays','bookingAdminNotice','bookingAdminSettingsMessage','bookingAdminSaveSettingsButton',
      'bookingAdminNewTypeButton','bookingAdminTypeMessage','bookingAdminTypeList','bookingAdminTypeEmpty','bookingAdminServiceCount','bookingAdminPendingCount','bookingAdminConfirmedCount',
      'bookingAdminServicesSubtab','bookingAdminQueueSubtab','bookingAdminQueueSubtabCount','bookingAdminServicesPanel','bookingAdminQueuePanel','bookingAdminNewServiceButton','bookingAdminBatchAddButton','bookingAdminBatchEditButton','bookingAdminBatchDeleteButton','bookingAdminServiceMessage','bookingAdminServiceList','bookingAdminServiceEmpty','bookingAdminQueue','bookingAdminQueueEmpty',
      'bookingAdminCrudModal','bookingAdminCrudModalTitle','bookingAdminCrudModalBody','bookingAdminCrudModalClose'
    ].forEach((id) => { els[id] = document.getElementById(id); });
  }

  function bindEvents() {
    els.bookingTab.addEventListener('click', activateBookingPanel);
    PRIMARY_TAB_IDS.forEach((id) => document.getElementById(id)?.addEventListener('click', deactivateBookingPanel));
    els.bookingAdminRefreshButton.addEventListener('click', () => refreshAll(true));
    els.bookingAdminSettingsForm.addEventListener('submit', saveSettings);
    els.bookingAdminNewTypeButton.addEventListener('click', () => openTypeModal(null));
    els.bookingAdminServicesSubtab.addEventListener('click', () => setSubtab('services'));
    els.bookingAdminQueueSubtab.addEventListener('click', () => setSubtab('queue'));
    els.bookingAdminNewServiceButton.addEventListener('click', () => openServiceModal(null));
    els.bookingAdminBatchAddButton.addEventListener('click', () => openBatchModal('create'));
    els.bookingAdminBatchEditButton.addEventListener('click', () => openBatchModal('update'));
    els.bookingAdminBatchDeleteButton.addEventListener('click', batchDelete);
    els.bookingAdminCrudModalClose.addEventListener('click', closeModal);
    els.bookingAdminCrudModal.addEventListener('click', (event) => { if (event.target === els.bookingAdminCrudModal && window.matchMedia('(max-width:768px)').matches) closeModal(); });
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeModal(); });
    document.querySelectorAll('[data-booking-filter]').forEach((button) => button.addEventListener('click', () => setFilter(button.dataset.bookingFilter || 'pending')));
    window.addEventListener('beforeunload', teardownRealtime);
  }

  function setSubtab(subtab) {
    state.subtab = subtab === 'queue' ? 'queue' : 'services';
    const queue = state.subtab === 'queue';
    els.bookingAdminServicesSubtab.classList.toggle('active', !queue);
    els.bookingAdminServicesSubtab.setAttribute('aria-selected', String(!queue));
    els.bookingAdminQueueSubtab.classList.toggle('active', queue);
    els.bookingAdminQueueSubtab.setAttribute('aria-selected', String(queue));
    els.bookingAdminServicesPanel.classList.toggle('hidden', queue);
    els.bookingAdminQueuePanel.classList.toggle('hidden', !queue);
  }

  function activateBookingPanel() {
    PRIMARY_TAB_IDS.forEach((id) => document.getElementById(id)?.setAttribute('aria-selected', 'false'));
    PRIMARY_PANEL_IDS.forEach((id) => document.getElementById(id)?.classList.add('hidden'));
    els.bookingTab.setAttribute('aria-selected', 'true');
    els.bookingPanel.classList.remove('hidden');
    setSubtab(state.subtab);
    if (window.location.hash !== '#booking') window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.search}#booking`);
    if (!state.loading) refreshAll(false);
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
      if (!adminView.classList.contains('hidden') && window.liff?.getIDToken?.()) { activateBookingPanel(); return true; }
      return false;
    };
    if (tryOpen()) return;
    const observer = new MutationObserver(() => { if (tryOpen()) observer.disconnect(); });
    observer.observe(adminView, { attributes: true, attributeFilter: ['class'] });
    window.setTimeout(() => observer.disconnect(), 30000);
  }

  async function context() {
    if (!state.config) state.config = await window.MemberSystem.loadConfig();
    const idToken = String(window.liff?.getIDToken?.() || '');
    if (!idToken) throw clientError('AUTH_REQUIRED', '管理端登入尚未完成，請重新整理後再試。');
    return { config: state.config, idToken };
  }

  async function requestFunction(name, action, payload = {}, write = false) {
    const { config, idToken } = await context();
    const endpoint = `${String(config.supabaseUrl || '').replace(/\/$/, '')}/functions/v1/${name}`;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), write ? 30000 : 15000);
    try {
      const response = await fetch(endpoint, {
        method: 'POST', cache: 'no-store', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', apikey: String(config.supabasePublishableKey || '') },
        body: JSON.stringify({ ...payload, action, clientType: 'admin', idToken }),
      });
      const text = await response.text();
      let data;
      try { data = JSON.parse(text); } catch { throw clientError(write ? 'API_RESPONSE_UNCERTAIN' : 'API_RESPONSE_ERROR', '預約服務回傳格式不正確。'); }
      if (!response.ok || data?.ok !== true) throw clientError(String(data?.error?.code || 'API_ERROR'), String(data?.error?.message || '預約服務拒絕此操作。'));
      return data.data || {};
    } catch (error) {
      if (error?.code) throw error;
      throw clientError(write ? 'API_RESPONSE_UNCERTAIN' : 'NETWORK_ERROR', write ? '無法確認操作是否已送達；請先更新資料確認。' : '目前無法連線預約服務。');
    } finally { window.clearTimeout(timer); }
  }

  const bookingRequest = (action, payload = {}, write = false) => requestFunction('booking-api', action, payload, write);
  const manageRequest = (action, payload = {}, write = false) => requestFunction('booking-admin-api', action, payload, write);
  const operationsRequest = (action, payload = {}, write = false) => requestFunction('booking-admin-operations', action, payload, write);
  function clientError(code, message) { const error = new Error(message); error.code = code; return error; }

  async function refreshAll(showSuccess) {
    if (state.loading) return;
    state.loading = true;
    els.bookingAdminRefreshButton.disabled = true;
    setSyncStatus('同步預約資料中…');
    try {
      const [booking, catalog] = await Promise.all([
        bookingRequest('admin.booking.bootstrap'),
        manageRequest('admin.booking.manage.bootstrap'),
      ]);
      state.booking = {
        settings: { ...(booking.settings || {}), ...(catalog.settings || {}) },
        bookings: Array.isArray(booking.bookings) ? booking.bookings : [],
      };
      state.catalog = { serviceTypes: Array.isArray(catalog.serviceTypes) ? catalog.serviceTypes : [], services: Array.isArray(catalog.services) ? catalog.services : [] };
      state.selected = new Set([...state.selected].filter((id) => state.catalog.services.some((service) => service.serviceId === id)));
      renderAll();
      setupRealtime();
      setSyncStatus(showSuccess ? '預約資料已更新' : `已同步 · ${new Date().toLocaleTimeString('zh-Hant-TW', { hour: '2-digit', minute: '2-digit' })}`);
    } catch (error) {
      setSyncStatus(error?.message || '預約資料同步失敗', true);
      showMessage(els.bookingAdminServiceMessage, error?.message || '預約資料同步失敗', 'error');
    } finally {
      state.loading = false;
      els.bookingAdminRefreshButton.disabled = false;
    }
  }

  function renderAll() { renderSettings(); renderTypes(); renderServices(); renderStats(); renderBookings(); }
  function renderSettings() {
    const settings = state.booking.settings || {};
    els.bookingAdminStartTime.value = String(settings.workStartTime || '09:00');
    els.bookingAdminEndTime.value = String(settings.workEndTime || '17:00');
    els.bookingAdminAdvanceDays.value = String(Number(settings.minAdvanceDays || 0));
    els.bookingAdminNotice.value = String(settings.bookingNotice || '');
  }
  function renderStats() {
    const bookings = state.booking.bookings || [];
    const pending = bookings.filter((booking) => booking.status === 'pending').length;
    els.bookingAdminServiceCount.textContent = String(state.catalog.services.length);
    els.bookingAdminPendingCount.textContent = String(pending);
    els.bookingAdminConfirmedCount.textContent = String(bookings.filter((booking) => booking.status === 'confirmed').length);
    els.bookingAdminQueueSubtabCount.textContent = pending ? `（${pending}）` : '';
    els.bookingTab.dataset.pendingCount = String(pending);
  }

  function renderTypes() {
    const rows = state.catalog.serviceTypes || [];
    els.bookingAdminTypeList.replaceChildren();
    els.bookingAdminTypeEmpty.classList.toggle('hidden', rows.length > 0);
    rows.forEach((type) => {
      const row = document.createElement('div');
      row.className = 'booking-admin-service-row';
      row.style.cursor = 'default';
      const content = document.createElement('span');
      const title = document.createElement('strong'); title.textContent = type.name;
      const small = document.createElement('small'); small.textContent = '共用項目類型';
      content.append(title, small);
      const actions = document.createElement('span'); actions.className = 'booking-admin-actions'; actions.style.margin = '0';
      actions.append(actionButton('修改', 'button button-outline', () => openTypeModal(type)), actionButton('刪除', 'button button-danger', () => deleteType(type)));
      row.append(content, actions); els.bookingAdminTypeList.appendChild(row);
    });
  }

  function renderServices() {
    const rows = state.catalog.services || [];
    els.bookingAdminServiceList.replaceChildren();
    els.bookingAdminServiceEmpty.classList.toggle('hidden', rows.length > 0);
    rows.forEach((service) => {
      const row = document.createElement('div');
      row.className = `booking-admin-service-row${service.isActive ? '' : ' inactive'}`;
      row.style.cursor = 'default';
      const left = document.createElement('span');
      left.style.gridTemplateColumns = 'auto 1fr'; left.style.alignItems = 'start'; left.style.columnGap = '10px';
      const check = document.createElement('input');
      check.type = 'checkbox'; check.checked = state.selected.has(service.serviceId); check.setAttribute('aria-label', `選取 ${service.title}`);
      check.style.width = '18px'; check.style.height = '18px'; check.style.marginTop = '2px';
      check.addEventListener('change', () => { check.checked ? state.selected.add(service.serviceId) : state.selected.delete(service.serviceId); updateBatchButtons(); });
      const text = document.createElement('span');
      const title = document.createElement('strong'); title.textContent = service.title;
      const meta = document.createElement('small'); meta.textContent = `類型 ${service.serviceType || '未設定'} · ${service.durationMinutes} 分鐘 · ${formatMoney(service.priceAmount)} · ${service.isActive ? '開放' : '停用'}`;
      text.append(title, meta); left.append(check, text);
      const actions = document.createElement('span'); actions.className = 'booking-admin-actions'; actions.style.margin = '0';
      actions.append(actionButton('修改', 'button button-outline', () => openServiceModal(service)), actionButton('刪除', 'button button-danger', () => deleteService(service)));
      row.append(left, actions); els.bookingAdminServiceList.appendChild(row);
    });
    updateBatchButtons();
  }

  function updateBatchButtons() {
    const count = state.selected.size;
    els.bookingAdminBatchEditButton.disabled = count === 0;
    els.bookingAdminBatchDeleteButton.disabled = count === 0;
    els.bookingAdminBatchEditButton.textContent = count ? `批次修改（${count}）` : '批次修改';
    els.bookingAdminBatchDeleteButton.textContent = count ? `批次刪除（${count}）` : '批次刪除';
  }

  async function saveSettings(event) {
    event.preventDefault();
    if (state.busy) return;
    const minAdvanceDays = Number(els.bookingAdminAdvanceDays.value);
    const bookingNotice = String(els.bookingAdminNotice.value || '').replace(/\r\n?/g, '\n');
    if (!Number.isInteger(minAdvanceDays) || minAdvanceDays < 0 || minAdvanceDays > 365) return showMessage(els.bookingAdminSettingsMessage, '提前預約天數必須介於 0–365 天。', 'error');
    if (bookingNotice.length > 2000) return showMessage(els.bookingAdminSettingsMessage, '預約說明不可超過 2,000 字。', 'error');
    state.busy = true; clearMessage(els.bookingAdminSettingsMessage);
    try {
      const result = await manageRequest('admin.booking.settings.save', {
        workStartTime: els.bookingAdminStartTime.value,
        workEndTime: els.bookingAdminEndTime.value,
        minAdvanceDays,
        bookingNotice,
        expectedUpdatedAt: state.booking.settings?.updatedAt || '',
      }, true);
      state.booking.settings = result.settings || state.booking.settings;
      renderSettings(); showMessage(els.bookingAdminSettingsMessage, '預約共用設定已儲存。', 'success');
    } catch (error) { showMessage(els.bookingAdminSettingsMessage, error?.message || '儲存失敗。', 'error'); }
    finally { state.busy = false; }
  }

  function openTypeModal(type) {
    els.bookingAdminCrudModalTitle.textContent = type ? '修改項目類型' : '新增項目類型';
    els.bookingAdminCrudModalBody.innerHTML = `<form class="booking-admin-form"><label>項目類型名稱<input data-type-name maxlength="80" required></label><div data-modal-message class="form-message hidden"></div><div class="booking-admin-modal-actions"><button data-cancel class="button button-outline" type="button">取消</button><button class="button button-dark" type="submit">${type ? '儲存修改' : '新增類型'}</button></div></form>`;
    const form = els.bookingAdminCrudModalBody.querySelector('form');
    const input = form.querySelector('[data-type-name]'); input.value = type?.name || '';
    form.querySelector('[data-cancel]').addEventListener('click', closeModal);
    form.addEventListener('submit', async (event) => {
      event.preventDefault(); const name = input.value.trim(); if (!name) return;
      await runModalAction(async () => manageRequest(type ? 'admin.booking.type.update' : 'admin.booking.type.create', type ? { typeId: type.id, name } : { name }, true));
    });
    showModal(); input.focus();
  }

  async function deleteType(type) {
    if (!window.confirm(`確定刪除項目類型「${type.name}」？\n若仍有預約項目使用，系統會拒絕刪除。`)) return;
    await runPageAction(els.bookingAdminTypeMessage, async () => manageRequest('admin.booking.type.delete', { typeId: type.id }, true));
  }

  function serviceFormHtml(service = {}) {
    const options = ['<option value="">請選擇項目類型</option>', ...(state.catalog.serviceTypes || []).map((type) => `<option value="${escapeAttr(type.name)}">${escapeHtml(type.name)}</option>`)].join('');
    return `<label>預約項目名稱<input data-field="title" maxlength="100" required value="${escapeAttr(service.title || '')}"></label><label>項目類型<select data-field="serviceType" required>${options}</select></label><label>服務時間（分鐘）<input data-field="durationMinutes" type="number" min="1" max="720" step="1" required value="${Number(service.durationMinutes || 30)}"></label><label>價格（NT$）<input data-field="priceAmount" type="number" min="0" max="10000000" step="1" required value="${Number(service.priceAmount || 0)}"></label><label class="booking-admin-toggle"><input data-field="isActive" type="checkbox" ${service.isActive === false ? '' : 'checked'}><span><strong>開放會員預約</strong><small>關閉後會員端不再顯示，既有預約紀錄仍保留。</small></span></label>`;
  }

  function openServiceModal(service) {
    if (!state.catalog.serviceTypes.length) return window.alert('請先新增至少一個項目類型。');
    els.bookingAdminCrudModalTitle.textContent = service ? '修改預約項目' : '新增預約項目';
    els.bookingAdminCrudModalBody.innerHTML = `<form class="booking-admin-form">${serviceFormHtml(service || {})}<div data-modal-message class="form-message hidden"></div><div class="booking-admin-modal-actions"><button data-cancel class="button button-outline" type="button">取消</button><button class="button button-dark" type="submit">儲存預約項目</button></div></form>`;
    const form = els.bookingAdminCrudModalBody.querySelector('form');
    form.querySelector('[data-field="serviceType"]').value = service?.serviceType || '';
    form.querySelector('[data-cancel]').addEventListener('click', closeModal);
    form.addEventListener('submit', async (event) => {
      event.preventDefault(); const payload = readServiceForm(form);
      if (service) { payload.serviceId = service.serviceId; payload.expectedUpdatedAt = service.updatedAt || ''; }
      await runModalAction(async () => manageRequest('admin.booking.service.save', payload, true));
    });
    showModal();
  }

  function readServiceForm(form) {
    return {
      title: form.querySelector('[data-field="title"]').value.trim(),
      serviceType: form.querySelector('[data-field="serviceType"]').value,
      durationMinutes: Number(form.querySelector('[data-field="durationMinutes"]').value),
      priceAmount: Number(form.querySelector('[data-field="priceAmount"]').value),
      isActive: form.querySelector('[data-field="isActive"]').checked,
    };
  }

  async function deleteService(service) {
    if (!window.confirm(`確定刪除預約項目「${service.title}」？\n既有預約紀錄會保留。`)) return;
    await runPageAction(els.bookingAdminServiceMessage, async () => manageRequest('admin.booking.service.delete', { serviceId: service.serviceId, expectedUpdatedAt: service.updatedAt || '' }, true));
  }

  function openBatchModal(mode) {
    if (!state.catalog.serviceTypes.length) return window.alert('請先新增至少一個項目類型。');
    const source = mode === 'update' ? state.catalog.services.filter((service) => state.selected.has(service.serviceId)) : [{}, {}];
    if (mode === 'update' && !source.length) return;
    els.bookingAdminCrudModalTitle.textContent = mode === 'create' ? '批次新增預約項目' : `批次修改預約項目（${source.length}）`;
    els.bookingAdminCrudModalBody.innerHTML = `<form class="booking-admin-form"><div data-batch-rows></div>${mode === 'create' ? '<button data-add-row class="button button-outline" type="button">＋ 新增一列</button>' : ''}<div data-modal-message class="form-message hidden"></div><div class="booking-admin-modal-actions"><button data-cancel class="button button-outline" type="button">取消</button><button class="button button-dark" type="submit">套用批次操作</button></div></form>`;
    const form = els.bookingAdminCrudModalBody.querySelector('form');
    const rows = form.querySelector('[data-batch-rows]');
    source.forEach((service) => appendBatchRow(rows, service, mode));
    form.querySelector('[data-add-row]')?.addEventListener('click', () => appendBatchRow(rows, {}, mode));
    form.querySelector('[data-cancel]').addEventListener('click', closeModal);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const operations = [...rows.querySelectorAll('[data-batch-row]')].map((row) => {
        const payload = readServiceForm(row);
        if (mode === 'update') { payload.serviceId = row.dataset.serviceId; payload.expectedUpdatedAt = row.dataset.updatedAt || ''; }
        return { op: mode, ...payload };
      });
      if (!operations.length) return;
      await runModalAction(async () => manageRequest('admin.booking.services.batch', { operations }, true));
    });
    showModal();
  }

  function appendBatchRow(container, service, mode) {
    const row = document.createElement('div');
    row.dataset.batchRow = '1'; row.dataset.serviceId = service.serviceId || ''; row.dataset.updatedAt = service.updatedAt || '';
    row.style.cssText = 'padding:12px 0;border-bottom:1px solid rgba(23,53,46,.1);display:grid;gap:10px';
    row.innerHTML = serviceFormHtml(service);
    row.querySelector('[data-field="serviceType"]').value = service.serviceType || '';
    if (mode === 'create') row.appendChild(actionButton('移除此列', 'button button-outline', () => row.remove()));
    container.appendChild(row);
  }

  async function batchDelete() {
    const selected = state.catalog.services.filter((service) => state.selected.has(service.serviceId));
    if (!selected.length || !window.confirm(`確定批次刪除 ${selected.length} 個預約項目？\n既有預約紀錄會保留。`)) return;
    const operations = selected.map((service) => ({ op: 'delete', serviceId: service.serviceId, expectedUpdatedAt: service.updatedAt || '' }));
    await runPageAction(els.bookingAdminServiceMessage, async () => manageRequest('admin.booking.services.batch', { operations }, true));
  }

  async function runModalAction(fn) {
    if (state.busy) return;
    state.busy = true;
    const message = els.bookingAdminCrudModalBody.querySelector('[data-modal-message]');
    try { await fn(); els.bookingAdminCrudModal.classList.add('hidden'); state.selected.clear(); await refreshAll(true); }
    catch (error) { showMessage(message, error?.message || '操作失敗。', 'error'); }
    finally { state.busy = false; }
  }

  async function runPageAction(messageElement, fn) {
    if (state.busy) return;
    state.busy = true; clearMessage(messageElement);
    try { await fn(); state.selected.clear(); await refreshAll(true); }
    catch (error) { showMessage(messageElement, error?.message || '操作失敗。', 'error'); }
    finally { state.busy = false; }
  }

  function bookingVisibleItems(booking) { return Array.isArray(booking?.items) ? booking.items.filter((item) => item.serviceId !== STORE_SERVICE_ID) : []; }
  function bookingStoreItem(booking) { return Array.isArray(booking?.items) ? booking.items.find((item) => item.serviceId === STORE_SERVICE_ID) : null; }
  function bookingDisplayTitle(booking) {
    const titles = bookingVisibleItems(booking).map((item) => item.serviceTitle).filter(Boolean);
    return titles.length ? titles.join(' + ') : booking.serviceTitle || '預約項目';
  }

  function openBookingItemsModal(booking) {
    const services = (state.catalog.services || []).filter((service) => service.serviceId !== STORE_SERVICE_ID);
    if (!services.length) return window.alert('目前沒有可供管理員選擇的服務項目。');
    const current = new Map(bookingVisibleItems(booking).map((item) => [item.serviceId, Number(item.quantity || 1)]));
    els.bookingAdminCrudModalTitle.textContent = `現場改單｜${booking.memberDisplayName || '會員'}`;
    els.bookingAdminCrudModalBody.innerHTML = `<form class="booking-admin-form"><p class="booking-admin-time">只修改這筆預約的實際服務項目與數量；原預約日期與時段會保留，不會重新排程。</p><div data-booking-item-rows style="display:grid;gap:10px"></div><div data-modal-message class="form-message hidden"></div><div class="booking-admin-modal-actions"><button data-cancel class="button button-outline" type="button">取消</button><button class="button button-dark" type="submit">儲存現場改單</button></div></form>`;
    const form = els.bookingAdminCrudModalBody.querySelector('form');
    const rows = form.querySelector('[data-booking-item-rows]');
    services.forEach((service) => {
      const row = document.createElement('label');
      row.className = 'booking-admin-toggle';
      row.style.alignItems = 'center';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.dataset.bookingService = service.serviceId;
      checkbox.checked = current.has(service.serviceId);
      const text = document.createElement('span');
      const title = document.createElement('strong'); title.textContent = `${service.title}${service.isActive ? '' : '（目前停用）'}`;
      const meta = document.createElement('small'); meta.textContent = `${Number(service.durationMinutes || 0)} 分鐘／份 · ${formatMoney(service.priceAmount)}`;
      text.append(title, meta);
      const quantity = document.createElement('select');
      quantity.dataset.bookingQuantity = service.serviceId;
      quantity.setAttribute('aria-label', `${service.title} 數量`);
      quantity.innerHTML = '<option value="1">1 份</option><option value="2">2 份</option>';
      quantity.value = String(current.get(service.serviceId) || 1);
      quantity.disabled = !checkbox.checked;
      checkbox.addEventListener('change', () => { quantity.disabled = !checkbox.checked; });
      row.append(checkbox, text, quantity);
      rows.appendChild(row);
    });
    form.querySelector('[data-cancel]').addEventListener('click', closeModal);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const items = [...form.querySelectorAll('[data-booking-service]:checked')].map((checkbox) => ({
        serviceId: checkbox.dataset.bookingService,
        quantity: Number(form.querySelector(`[data-booking-quantity="${checkbox.dataset.bookingService}"]`)?.value || 1),
      }));
      if (!items.length) return showMessage(form.querySelector('[data-modal-message]'), '請至少選擇一個實際服務項目。', 'error');
      await runModalAction(async () => operationsRequest('admin.booking.items.update', {
        bookingId: booking.bookingId,
        expectedUpdatedAt: booking.updatedAt,
        items,
      }, true));
    });
    showModal();
  }

  function renderBookings() {
    const bookings = (state.booking.bookings || []).filter((booking) => state.filter === 'all' || booking.status === state.filter);
    els.bookingAdminQueue.replaceChildren();
    els.bookingAdminQueueEmpty.classList.toggle('hidden', bookings.length > 0);
    bookings.forEach((booking) => {
      const card = document.createElement('article'); card.className = 'booking-admin-booking';
      const heading = document.createElement('div'); heading.className = 'booking-admin-booking-heading';
      const member = document.createElement('div');
      const memberName = document.createElement('strong'); memberName.textContent = booking.memberDisplayName || '會員';
      const code = document.createElement('small'); code.textContent = booking.memberCode || '無會員編號'; member.append(memberName, code);
      const status = document.createElement('span'); status.className = `booking-admin-status status-${booking.status}`; status.textContent = STATUS_LABELS[booking.status] || booking.status;
      heading.append(member, status); card.appendChild(heading);
      const title = document.createElement('h4'); title.textContent = bookingDisplayTitle(booking); card.appendChild(title);
      const storeItem = bookingStoreItem(booking); const storeMinutes = storeItem ? Number(storeItem.unitDurationMinutes || 10) * Number(storeItem.quantity || 1) : 0;
      const scheduledMinutes = Number(booking.totalDurationMinutes || 0);
      const currentMinutes = Array.isArray(booking.items) && booking.items.length ? booking.items.reduce((sum, item) => sum + Number(item.unitDurationMinutes || 0) * Number(item.quantity || 1), 0) : scheduledMinutes;
      const durationText = currentMinutes !== scheduledMinutes ? `目前項目共 ${currentMinutes} 分鐘${storeMinutes ? `（含店內服務 ${storeMinutes} 分鐘）` : ''} · 原排程佔用 ${scheduledMinutes} 分鐘` : `預約佔用 ${scheduledMinutes} 分鐘${storeMinutes ? `（含店內服務 ${storeMinutes} 分鐘）` : ''}`;
      const time = document.createElement('p'); time.className = 'booking-admin-time'; time.textContent = `${formatDate(booking.bookingDate)} ${booking.startTime}–${booking.endTime} · ${durationText} · 總額 ${formatMoney(booking.totalAmount)}`; card.appendChild(time);
      const items = bookingVisibleItems(booking);
      if (items.length || storeItem) {
        const list = document.createElement('ul'); list.className = 'booking-admin-item-list';
        items.forEach((item) => { const li = document.createElement('li'); li.textContent = `${item.serviceTitle} × ${item.quantity}（${item.unitDurationMinutes} 分鐘/份 · ${formatMoney(item.unitPriceAmount)}/份）`; list.appendChild(li); });
        if (storeItem) { const li = document.createElement('li'); li.textContent = `店內服務 ${storeMinutes} 分鐘：肩頸服務、龜苓膏、熱茶（不計入會員累積消費服務時數／會員階級）`; list.appendChild(li); }
        card.appendChild(list);
      }
      if (booking.memberNote) appendNote(card, `會員備註：${booking.memberNote}`, false);
      if (booking.adminNote) appendNote(card, `管理端說明：${booking.adminNote}`, true);
      if (booking.status === 'pending' || booking.status === 'confirmed') {
        const note = document.createElement('label'); note.className = 'booking-admin-note-field'; note.textContent = '管理端說明（選填）';
        const textarea = document.createElement('textarea'); textarea.maxLength = 500; textarea.rows = 2; textarea.value = booking.adminNote || ''; note.appendChild(textarea); card.appendChild(note);
        const actions = document.createElement('div'); actions.className = 'booking-admin-actions';
        actions.append(actionButton('修改服務項目', 'button button-outline', () => openBookingItemsModal(booking)));
        if (booking.status === 'pending') {
          actions.append(actionButton('不通過', 'button button-outline', () => updateBookingStatus(booking, 'rejected', textarea.value)), actionButton('確認預約', 'button button-dark', () => updateBookingStatus(booking, 'confirmed', textarea.value)));
        } else {
          actions.append(actionButton('確認服務完成', 'button button-dark', () => updateBookingStatus(booking, 'completed', textarea.value)), actionButton('取消預約', 'button button-danger', () => updateBookingStatus(booking, 'cancelled', textarea.value)));
        }
        card.appendChild(actions);
      }
      els.bookingAdminQueue.appendChild(card);
    });
  }

  async function updateBookingStatus(booking, status, adminNote) {
    if (status === 'completed' && !window.confirm(`確認 ${booking.memberDisplayName || '此會員'} 的服務已完成？\n系統不再要求等待原預約結束時間；完成後不可修改或取消。`)) return;
    await runPageAction(els.bookingAdminServiceMessage, async () => {
      if (status === 'completed') {
        return operationsRequest('admin.booking.status.complete', { bookingId: booking.bookingId, expectedUpdatedAt: booking.updatedAt, adminNote }, true);
      }
      return bookingRequest('admin.booking.status.update', { bookingId: booking.bookingId, expectedUpdatedAt: booking.updatedAt, status, adminNote }, true);
    });
  }
  function setFilter(filter) {
    state.filter = ['pending','confirmed','completed','all'].includes(filter) ? filter : 'pending';
    document.querySelectorAll('[data-booking-filter]').forEach((button) => button.classList.toggle('active', button.dataset.bookingFilter === state.filter));
    renderBookings();
  }

  function setupRealtime() {
    if (state.realtimeChannel || state.config?.realtimeEnabled === false || !window.supabase?.createClient) return;
    state.realtimeClient = window.supabase.createClient(state.config.supabaseUrl, state.config.supabasePublishableKey, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } });
    const schedule = () => {
      if (state.realtimeTimer !== null) return;
      state.realtimeTimer = window.setTimeout(() => { state.realtimeTimer = null; if (!state.loading && !state.busy) refreshAll(false); }, 500);
    };
    state.realtimeChannel = state.realtimeClient.channel('booking-admin-sync-v2').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'realtime_events' }, (payload) => {
      const row = payload?.new || {}; const scope = String(row.scope || ''); const type = String(row.event_type || '');
      if ((scope === 'all' || scope === 'admin') && type.startsWith('booking.')) schedule();
    }).subscribe();
  }
  function teardownRealtime() {
    if (state.realtimeTimer !== null) window.clearTimeout(state.realtimeTimer);
    state.realtimeTimer = null;
    if (state.realtimeClient && state.realtimeChannel) { try { Promise.resolve(state.realtimeClient.removeChannel(state.realtimeChannel)).catch(() => {}); } catch (_) {} }
    state.realtimeChannel = null;
  }

  function actionButton(label, className, handler) { const button = document.createElement('button'); button.type = 'button'; button.className = className; button.textContent = label; button.addEventListener('click', handler); return button; }
  function appendNote(card, text, admin) { const note = document.createElement('p'); note.className = `booking-admin-note${admin ? ' admin' : ''}`; note.textContent = text; card.appendChild(note); }
  function showModal() { els.bookingAdminCrudModal.classList.remove('hidden'); }
  function closeModal() { if (!state.busy) els.bookingAdminCrudModal.classList.add('hidden'); }
  function setSyncStatus(message, error) { els.bookingAdminSyncStatus.textContent = message; els.bookingAdminSyncStatus.classList.toggle('error', Boolean(error)); }
  function showMessage(element, message, type) { if (!element) return; element.textContent = message; element.className = `form-message ${type || ''}`; }
  function clearMessage(element) { if (!element) return; element.textContent = ''; element.className = 'form-message hidden'; }
  function formatDate(value) { const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '')); return match ? `${Number(match[1])}/${Number(match[2])}/${Number(match[3])}` : String(value || '—'); }
  function formatMoney(value) { const amount = Number(value || 0); return `NT$${Number.isFinite(amount) ? Math.max(0, Math.trunc(amount)).toLocaleString('zh-Hant-TW') : '0'}`; }
  function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char])); }
  function escapeAttr(value) { return escapeHtml(value); }
})();
