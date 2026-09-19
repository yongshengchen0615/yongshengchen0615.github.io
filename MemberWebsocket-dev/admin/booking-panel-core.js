(() => {
  'use strict';

  const STORE_SERVICE_ID = '00000000-0000-4000-8000-000000000010';
  const PRIMARY_TAB_IDS = ['membersTab', 'cardsTab', 'eventsTab', 'calendarTab'];
  const PRIMARY_PANEL_IDS = ['membersPanel', 'cardsPanel', 'eventsPanel', 'calendarPanel'];
  const STATUS_LABELS = { pending: '待確認', confirmed: '已確認', completed: '服務已完成', rejected: '未通過', cancelled: '已取消' };
  const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];
  const state = {
    config: null,
    booking: { settings: {}, bookings: [], groups: {}, technicians: [], primaryTechnicianId: '' },
    catalog: { serviceTypes: [], services: [] },
    filter: 'pending',
    subtab: 'technicians',
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
        <div><p class="kicker">Booking operations</p><h2>預約管理</h2><p>技師、預約項目、共用設定與用戶預約分頁管理，降低單頁資訊密度。</p></div>
        <div class="heading-actions"><span id="bookingAdminSyncStatus" class="sync-status">尚未同步</span></div>
      </div>

      <section class="booking-admin-stats" aria-label="預約概況">
        <div><span>預約項目</span><strong id="bookingAdminServiceCount">0</strong><small>目前可管理項目</small></div>
        <div><span>待確認</span><strong id="bookingAdminPendingCount">0</strong><small>需管理端確認</small></div>
        <div><span>已確認</span><strong id="bookingAdminConfirmedCount">0</strong><small>完成預約</small></div>
      </section>

      <nav class="booking-admin-filter booking-admin-subtabs" role="tablist" aria-label="預約管理分類">
        <button id="bookingAdminTechniciansSubtab" class="booking-admin-filter-button active" type="button" role="tab" aria-selected="true" aria-controls="bookingAdminTechniciansPanel">技師設定</button>
        <button id="bookingAdminServicesSubtab" class="booking-admin-filter-button" type="button" role="tab" aria-selected="false" aria-controls="bookingAdminServicesPanel">預約項目</button>
        <button id="bookingAdminSettingsSubtab" class="booking-admin-filter-button" type="button" role="tab" aria-selected="false" aria-controls="bookingAdminSettingsPanel">預約共用設定</button>
        <button id="bookingAdminQueueSubtab" class="booking-admin-filter-button" type="button" role="tab" aria-selected="false" aria-controls="bookingAdminQueuePanel">用戶預約<span id="bookingAdminQueueSubtabCount"></span></button>
      </nav>

      <div class="booking-admin-subtab-panels">
        <section id="bookingAdminTechniciansPanel" class="booking-admin-card" role="tabpanel" aria-labelledby="bookingAdminTechniciansSubtab">
          <div id="bookingAdminTechnicianMount" class="booking-admin-technician-mount"></div>
        </section>

        <section id="bookingAdminServicesPanel" class="booking-admin-card hidden" role="tabpanel" aria-labelledby="bookingAdminServicesSubtab">
          <div class="booking-admin-section-heading"><div><p class="kicker">Booking catalog</p><h3>預約項目</h3><p>項目類型與實際預約項目集中在同一頁管理。</p></div></div>
          <div class="booking-admin-catalog-section">
            <div class="booking-admin-list-heading booking-admin-list-heading-first"><strong>項目類型</strong><button id="bookingAdminNewTypeButton" class="button button-outline" type="button">＋ 新增類型</button></div>
            <div id="bookingAdminTypeMessage" class="form-message hidden" role="status"></div>
            <div id="bookingAdminTypeList" class="booking-admin-service-list"></div>
            <div id="bookingAdminTypeEmpty" class="empty-state compact hidden"><span aria-hidden="true">○</span><p>尚未建立項目類型</p></div>
          </div>
          <div class="booking-admin-catalog-section booking-admin-catalog-services">
            <div class="booking-admin-list-heading"><strong>預約項目</strong></div>
            <div class="booking-admin-actions booking-admin-service-actions">
              <button id="bookingAdminNewServiceButton" class="button button-dark" type="button">＋ 新增項目</button>
              <button id="bookingAdminBatchAddButton" class="button button-outline" type="button">批次新增</button>
              <button id="bookingAdminBatchEditButton" class="button button-outline" type="button" disabled>批次修改</button>
              <button id="bookingAdminBatchDeleteButton" class="button button-danger" type="button" disabled>批次刪除</button>
            </div>
            <div id="bookingAdminServiceMessage" class="form-message hidden" role="status"></div>
            <div id="bookingAdminServiceList" class="booking-admin-service-list"></div>
            <div id="bookingAdminServiceEmpty" class="empty-state compact hidden"><span aria-hidden="true">○</span><p>尚未建立預約項目</p></div>
          </div>
        </section>

        <section id="bookingAdminSettingsPanel" class="booking-admin-card booking-admin-settings-panel hidden" role="tabpanel" aria-labelledby="bookingAdminSettingsSubtab">
          <div class="booking-admin-section-heading"><div><p class="kicker">Booking settings</p><h3 id="bookingAdminHoursTitle">預約共用設定</h3><p>集中管理所有預約共同使用的工作時間、可預約日期範圍與會員端說明。</p></div></div>
          <form id="bookingAdminSettingsForm" class="booking-admin-form booking-admin-settings-form" novalidate>
            <div class="booking-admin-settings-layout">
              <section class="booking-admin-settings-block booking-admin-settings-hours" aria-labelledby="bookingAdminWorkingHoursHeading">
                <div class="booking-admin-settings-block-heading">
                  <div><span class="booking-admin-settings-eyebrow">營業時段</span><h4 id="bookingAdminWorkingHoursHeading">工作時間</h4></div>
                  <span class="booking-admin-settings-badge">每日共用</span>
                </div>
                <div class="booking-admin-form-grid booking-admin-global-settings-grid booking-admin-time-grid">
                  <label class="booking-admin-settings-field"><span>開始工作時間</span><input id="bookingAdminStartTime" type="time" step="1800" value="09:00" required><small>會員端可選擇的第一個開始時段。</small></label>
                  <label class="booking-admin-settings-field"><span>結束工作時間</span><input id="bookingAdminEndTime" type="time" step="1800" value="17:00" required><small>最後可安排服務的工作時間上限。</small></label>
                </div>
              </section>

              <section class="booking-admin-settings-block booking-admin-settings-rule" aria-labelledby="bookingAdminAdvanceRuleHeading">
                <div class="booking-admin-settings-block-heading">
                  <div><span class="booking-admin-settings-eyebrow">預約限制</span><h4 id="bookingAdminAdvanceRuleHeading">提前預約</h4></div>
                </div>
                <label class="booking-admin-settings-field">
                  <span>需要提前幾天預約</span>
                  <div class="booking-admin-number-field"><input id="bookingAdminAdvanceDays" type="number" min="0" max="365" step="1" value="0" required><span aria-hidden="true">天</span></div>
                  <small>設定 0 天時，可預約今天尚未經過的開始時段。</small>
                </label>
                <label class="booking-admin-settings-field">
                  <span>最多可預約幾天內</span>
                  <div class="booking-admin-number-field"><input id="bookingAdminMaxAdvanceDays" type="number" min="0" max="365" step="1" value="0" required><span aria-hidden="true">天</span></div>
                  <small>例如 20 代表最遠可預約今天起 20 天內；設定 0 代表不限制最遠日期。</small>
                </label>
              </section>

              <section class="booking-admin-settings-block booking-admin-settings-notice" aria-labelledby="bookingAdminNoticeHeading">
                <div class="booking-admin-settings-block-heading">
                  <div><span class="booking-admin-settings-eyebrow">會員端內容</span><h4 id="bookingAdminNoticeHeading">預約說明</h4></div>
                  <span class="booking-admin-settings-badge">所有項目套用</span>
                </div>
                <label class="booking-admin-settings-field booking-admin-settings-notice-field">
                  <span>顯示給會員的預約說明（可換行）</span>
                  <textarea id="bookingAdminNotice" maxlength="2000" rows="5" placeholder="例如：\n請於預約時間前 10 分鐘抵達。\n如需取消或更改時間，請提前聯繫。"></textarea>
                  <small>最多 2,000 字；會員端會依原本換行顯示。</small>
                </label>
              </section>
            </div>
            <div id="bookingAdminSettingsMessage" class="form-message hidden" role="status" aria-live="polite"></div>
            <div class="booking-admin-settings-actions">
              <p><strong>儲存後立即套用</strong><span>這些設定會套用到所有預約項目，不需逐項調整。</span></p>
              <button id="bookingAdminSaveSettingsButton" class="button button-dark" type="submit">儲存預約設定</button>
            </div>
          </form>
        </section>

        <section id="bookingAdminQueuePanel" class="booking-admin-card hidden" role="tabpanel" aria-labelledby="bookingAdminQueueSubtab">
          <div class="booking-admin-section-heading"><div><p class="kicker">Member bookings</p><h3>用戶預約</h3><p>查看待確認、已確認與已完成預約；管理員可依現場實際服務修改項目與預約狀態。</p></div></div>
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
    setSubtab('technicians');
    openHashWhenAdminReady();
  }

  function cacheElements() {
    [
      'bookingTab','bookingPanel','bookingAdminSyncStatus','bookingAdminSettingsForm','bookingAdminStartTime','bookingAdminEndTime','bookingAdminAdvanceDays','bookingAdminMaxAdvanceDays','bookingAdminNotice','bookingAdminSettingsMessage','bookingAdminSaveSettingsButton',
      'bookingAdminNewTypeButton','bookingAdminTypeMessage','bookingAdminTypeList','bookingAdminTypeEmpty','bookingAdminServiceCount','bookingAdminPendingCount','bookingAdminConfirmedCount',
      'bookingAdminTechniciansSubtab','bookingAdminServicesSubtab','bookingAdminSettingsSubtab','bookingAdminQueueSubtab','bookingAdminQueueSubtabCount','bookingAdminTechniciansPanel','bookingAdminServicesPanel','bookingAdminSettingsPanel','bookingAdminQueuePanel','bookingAdminNewServiceButton','bookingAdminBatchAddButton','bookingAdminBatchEditButton','bookingAdminBatchDeleteButton','bookingAdminServiceMessage','bookingAdminServiceList','bookingAdminServiceEmpty','bookingAdminQueue','bookingAdminQueueEmpty',
      'bookingAdminCrudModal','bookingAdminCrudModalTitle','bookingAdminCrudModalBody','bookingAdminCrudModalClose'
    ].forEach((id) => { els[id] = document.getElementById(id); });
  }

  function bindEvents() {
    els.bookingTab.addEventListener('click', activateBookingPanel);
    PRIMARY_TAB_IDS.forEach((id) => document.getElementById(id)?.addEventListener('click', deactivateBookingPanel));
    els.bookingAdminSettingsForm.addEventListener('submit', saveSettings);
    els.bookingAdminNewTypeButton.addEventListener('click', () => openTypeModal(null));
    els.bookingAdminTechniciansSubtab.addEventListener('click', () => setSubtab('technicians'));
    els.bookingAdminServicesSubtab.addEventListener('click', () => setSubtab('services'));
    els.bookingAdminSettingsSubtab.addEventListener('click', () => setSubtab('settings'));
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
    const allowed = ['technicians', 'services', 'settings', 'queue'];
    state.subtab = allowed.includes(subtab) ? subtab : 'technicians';
    const tabs = {
      technicians: [els.bookingAdminTechniciansSubtab, els.bookingAdminTechniciansPanel],
      services: [els.bookingAdminServicesSubtab, els.bookingAdminServicesPanel],
      settings: [els.bookingAdminSettingsSubtab, els.bookingAdminSettingsPanel],
      queue: [els.bookingAdminQueueSubtab, els.bookingAdminQueuePanel],
    };
    Object.entries(tabs).forEach(([key, pair]) => {
      const [tab, panel] = pair;
      const active = key === state.subtab;
      tab?.classList.toggle('active', active);
      tab?.setAttribute('aria-selected', String(active));
      panel?.classList.toggle('hidden', !active);
    });
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
  const contactRequest = (action, payload = {}) => requestFunction('booking-contact-api', action, payload, false);
  const groupDetailsRequest = (action, payload = {}) => requestFunction('booking-group-details-api', action, payload, false);
  const resourceRequest = (action, payload = {}) => requestFunction('booking-group-api', action, payload, false);
  function clientError(code, message) { const error = new Error(message); error.code = code; return error; }

  async function refreshAll(showSuccess) {
    if (state.loading) return;
    state.loading = true;
    setSyncStatus('同步預約資料中…');
    try {
      const [booking, catalog, resources] = await Promise.all([
        bookingRequest('admin.booking.bootstrap'),
        manageRequest('admin.booking.manage.bootstrap'),
        resourceRequest('admin.booking.resources.bootstrap'),
      ]);
      const rawBookings = Array.isArray(booking.bookings) ? booking.bookings : [];
      const bookingIds = rawBookings.map((item) => String(item.bookingId || '')).filter(Boolean);
      const [contactData, groupData] = bookingIds.length
        ? await Promise.all([
            contactRequest('admin.booking.contacts', { bookingIds }),
            groupDetailsRequest('admin.booking.group.details', { bookingIds }),
          ])
        : [{ contacts: [] }, { bookingGroups: {} }];
      const contacts = Array.isArray(contactData.contacts) ? contactData.contacts : [];
      const contactsById = new Map(contacts.map((item) => [String(item.bookingId || ''), item]));
      const bookings = rawBookings.map((item) => ({
        ...item,
        ...(contactsById.get(String(item.bookingId || '')) || {}),
      }));
      state.booking = {
        settings: { ...(booking.settings || {}), ...(catalog.settings || {}), ...(resources.settings || {}) },
        bookings,
        groups: groupData?.bookingGroups && typeof groupData.bookingGroups === 'object' ? groupData.bookingGroups : {},
        technicians: Array.isArray(resources.technicians) ? resources.technicians : [],
        primaryTechnicianId: String(resources.settings?.primaryTechnicianId || groupData?.primaryTechnicianId || ''),
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
    }
  }
  function renderAll() { renderSettings(); renderTypes(); renderServices(); renderStats(); renderBookings(); }
  function renderSettings() {
    const settings = state.booking.settings || {};
    els.bookingAdminStartTime.value = String(settings.workStartTime || '09:00');
    els.bookingAdminEndTime.value = String(settings.workEndTime || '17:00');
    els.bookingAdminAdvanceDays.value = String(Number(settings.minAdvanceDays || 0));
    els.bookingAdminMaxAdvanceDays.value = String(Number(settings.maxAdvanceDays || 0));
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
    const maxAdvanceDays = Number(els.bookingAdminMaxAdvanceDays.value);
    const bookingNotice = String(els.bookingAdminNotice.value || '').replace(/\r\n?/g, '\n');
    if (!Number.isInteger(minAdvanceDays) || minAdvanceDays < 0 || minAdvanceDays > 365) return showMessage(els.bookingAdminSettingsMessage, '提前預約天數必須介於 0–365 天。', 'error');
    if (!Number.isInteger(maxAdvanceDays) || maxAdvanceDays < 0 || maxAdvanceDays > 365) return showMessage(els.bookingAdminSettingsMessage, '最遠可預約天數必須介於 0–365 天；0 代表不限制。', 'error');
    if (maxAdvanceDays > 0 && maxAdvanceDays < minAdvanceDays) return showMessage(els.bookingAdminSettingsMessage, '最遠可預約天數不可小於需要提前的天數。', 'error');
    if (bookingNotice.length > 2000) return showMessage(els.bookingAdminSettingsMessage, '預約說明不可超過 2,000 字。', 'error');
    state.busy = true; clearMessage(els.bookingAdminSettingsMessage);
    try {
      const result = await manageRequest('admin.booking.settings.save', {
        workStartTime: els.bookingAdminStartTime.value,
        workEndTime: els.bookingAdminEndTime.value,
        minAdvanceDays,
        maxAdvanceDays,
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
      const bookingId = String(booking.bookingId || '');
      const storedGroup = state.booking.groups?.[bookingId];
      const hasStoredParticipants = Boolean(storedGroup && Array.isArray(storedGroup.participants) && storedGroup.participants.length);
      const group = groupForDisplay(storedGroup, booking);
      const card = document.createElement('article');
      card.className = 'booking-admin-booking booking-summary-normalized';
      card.dataset.bookingId = bookingId;
      card.dataset.bookingMemberCode = String(booking.memberCode || '');
      card.dataset.bookingMemberName = String(booking.memberDisplayName || '');
      card.dataset.bookingDate = String(booking.bookingDate || '');
      card.dataset.bookingStartTime = String(booking.startTime || '').slice(0, 5);
      card.dataset.bookingCopyItems = JSON.stringify(bookingVisibleItems(booking).map((item) => ({
        serviceTitle: String(item?.serviceTitle || '預約項目').trim(),
        quantity: Math.max(1, Number(item?.quantity || 1)),
      })));
      card.dataset.bookingCopyGroup = JSON.stringify({
        partySize: Math.max(1, Number(group?.partySize || group?.participants?.length || 1)),
        participants: (group?.participants || []).map((participant) => ({
          technicianName: String(participant?.technicianName || '現場安排'),
          items: Array.isArray(participant?.items) ? participant.items.map((item) => ({
            serviceTitle: String(item?.serviceTitle || '預約項目').trim(),
            quantity: Math.max(1, Number(item?.quantity || 1)),
          })) : [],
        })),
      });
      card.dataset.bookingCopyContactName = bookingContactName(booking);
      card.dataset.bookingCopyPhone = String(booking.contactPhone || '—');

      card.appendChild(renderBookingSummary(booking, group, hasStoredParticipants));

      const heading = document.createElement('div');
      heading.className = 'booking-admin-booking-heading';
      const status = document.createElement('span');
      status.className = `booking-admin-status status-${booking.status}`;
      status.textContent = STATUS_LABELS[booking.status] || booking.status;
      heading.appendChild(status);
      card.appendChild(heading);

      if (booking.memberNote) appendNote(card, `會員備註：${booking.memberNote}`, false);
      if (booking.adminNote) appendNote(card, `管理端說明：${booking.adminNote}`, true);
      const cancellationPending = Boolean(booking.cancellationRequestedAt && !booking.cancellationReviewedAt);
      if (cancellationPending) appendNote(card, '會員已提出取消申請，請至「取消申請」分頁選擇保留預約或確認取消；審核完成前不可修改、確認或完成此預約。', true);

      if (canEditBooking(booking)) {
        const note = document.createElement('label');
        note.className = 'booking-admin-note-field';
        note.textContent = '管理端說明（選填）';
        const textarea = document.createElement('textarea');
        textarea.maxLength = 500;
        textarea.rows = 2;
        textarea.value = booking.adminNote || '';
        note.appendChild(textarea);
        card.appendChild(note);

        const actions = document.createElement('div');
        actions.className = 'booking-admin-actions';
        if (!hasStoredParticipants) {
          actions.append(actionButton('修改服務項目', 'button button-outline', () => openBookingItemsModal(booking)));
        }
        if (booking.status === 'pending') {
          actions.append(
            actionButton('不通過', 'button button-outline', () => updateBookingStatus(booking, 'rejected', textarea.value)),
            actionButton('確認預約', 'button button-dark', () => updateBookingStatus(booking, 'confirmed', textarea.value)),
          );
        } else {
          actions.append(
            actionButton('確認服務完成', 'button button-dark', () => updateBookingStatus(booking, 'completed', textarea.value)),
            actionButton('取消預約', 'button button-danger', () => updateBookingStatus(booking, 'cancelled', textarea.value)),
          );
        }
        card.appendChild(actions);
      }

      els.bookingAdminQueue.appendChild(card);
    });
  }

  function canEditBooking(booking) {
    return Boolean(
      (booking?.status === 'pending' || booking?.status === 'confirmed')
      && !(booking?.cancellationRequestedAt && !booking?.cancellationReviewedAt)
    );
  }

  function groupForDisplay(group, booking) {
    if (group && Array.isArray(group.participants) && group.participants.length) return group;
    const items = bookingVisibleItems(booking);
    if (!items.length) return { partySize: 1, participants: [] };
    return {
      partySize: 1,
      participants: [{
        position: 1,
        technicianId: '',
        technicianName: '現場安排',
        isPrimaryTechnician: false,
        items,
      }],
      totalDurationMinutes: Number(booking?.totalDurationMinutes || 0),
      totalAmount: Number(booking?.totalAmount || 0),
    };
  }

  function renderBookingSummary(booking, group, hasStoredParticipants) {
    const summary = document.createElement('div');
    summary.className = 'booking-received-summary';

    const memberMeta = document.createElement('div');
    memberMeta.className = 'booking-member-meta';
    memberMeta.append(
      summaryMetaItem('LINE 名稱', String(booking.memberDisplayName || '未取得')),
      summaryMetaItem('會員編號', String(booking.memberCode || '未取得')),
      summaryMetaItem('總服務時間', `${Math.max(0, Number(group?.totalDurationMinutes || booking.totalDurationMinutes || 0))} 分鐘`),
      summaryMetaItem('總金額', formatMoney(Number(group?.totalAmount ?? booking.totalAmount ?? 0))),
    );
    summary.appendChild(memberMeta);

    const dateTime = document.createElement('p');
    dateTime.className = 'booking-received-datetime';
    dateTime.textContent = `${formatBookingDateSummary(booking.bookingDate)} ${String(booking.startTime || '—').slice(0, 5)}`;
    summary.appendChild(dateTime);

    const contactName = document.createElement('p');
    contactName.className = 'booking-received-name';
    contactName.textContent = bookingContactName(booking);
    summary.appendChild(contactName);

    const phone = document.createElement('p');
    phone.className = 'booking-received-phone';
    phone.textContent = `電話：${String(booking.contactPhone || '—')}`;
    summary.appendChild(phone);

    summary.appendChild(renderParticipantDetails(booking, group, hasStoredParticipants));

    const copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.className = 'booking-copy-button';
    copyButton.textContent = '複製預約內容';
    copyButton.setAttribute('aria-label', `複製 ${bookingContactName(booking)} 的預約內容`);
    summary.appendChild(copyButton);

    return summary;
  }

  function summaryMetaItem(label, value) {
    const item = document.createElement('div');
    item.className = 'booking-member-meta-item';
    const key = document.createElement('span');
    key.className = 'booking-member-meta-label';
    key.textContent = label;
    const content = document.createElement('strong');
    content.textContent = value;
    item.append(key, content);
    return item;
  }

  function renderParticipantDetails(booking, group, hasStoredParticipants) {
    const box = document.createElement('section');
    box.className = 'booking-group-admin-details';
    box.setAttribute('aria-label', '逐位預約明細');
    const participants = Array.isArray(group?.participants) ? group.participants : [];

    if (!participants.length) {
      const empty = document.createElement('p');
      empty.textContent = '逐位預約明細尚未建立。';
      box.appendChild(empty);
      return box;
    }

    participants.forEach((participant, index) => {
      const block = document.createElement('div');
      block.className = 'booking-group-admin-participant';

      const heading = document.createElement('strong');
      heading.textContent = participantLabel(index);
      const items = document.createElement('p');
      items.textContent = `預約項目：${participantItemsLabel(participant.items)}`;
      const tech = document.createElement('p');
      const techName = String(participant.technicianName || '現場安排').replace(/（主要技師）/g, '').trim() || '現場安排';
      tech.textContent = `預約技師：${techName}`;
      block.append(heading, items, tech);

      if (hasStoredParticipants && canEditBooking(booking)) {
        const actions = document.createElement('div');
        actions.className = 'booking-admin-actions';
        actions.style.margin = '4px 0 0';
        actions.append(
          actionButton('修改此位項目', 'button button-outline', () => openParticipantItemsEditor(booking, group, index)),
          actionButton('修改此位技師', 'button button-outline', () => openParticipantTechnicianEditor(booking, group, index)),
        );
        block.appendChild(actions);
      }

      box.appendChild(block);
    });

    return box;
  }

  function openParticipantItemsEditor(booking, group, participantIndex) {
    if (!canEditBooking(booking)) return window.alert('這筆預約目前無法修改服務項目。');
    const participant = group?.participants?.[participantIndex];
    const services = (state.catalog.services || []).filter((service) => service.serviceId !== STORE_SERVICE_ID);
    if (!participant || !services.length) return window.alert('目前沒有可供管理員選擇的服務項目。');

    const current = new Map((participant.items || []).map((item) => [String(item.serviceId || ''), Math.max(1, Number(item.quantity || 1))]));
    els.bookingAdminCrudModalTitle.textContent = `${participantLabel(participantIndex)}｜修改項目`;
    els.bookingAdminCrudModalBody.innerHTML = '<form class="booking-admin-form"><p class="booking-admin-time">只修改這一位的預約項目與數量；系統會重新計算整筆預約時間。</p><div data-participant-item-rows style="display:grid;gap:10px"></div><div data-modal-message class="form-message hidden"></div><div class="booking-admin-modal-actions"><button data-cancel class="button button-outline" type="button">取消</button><button class="button button-dark" type="submit">儲存修改</button></div></form>';
    const form = els.bookingAdminCrudModalBody.querySelector('form');
    const rows = form.querySelector('[data-participant-item-rows]');

    services.forEach((service) => {
      const row = document.createElement('label');
      row.className = 'booking-admin-toggle';
      row.style.alignItems = 'center';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = String(service.serviceId || '');
      checkbox.checked = current.has(checkbox.value);
      const text = document.createElement('span');
      const title = document.createElement('strong');
      title.textContent = `${service.title}${service.isActive ? '' : '（目前停用）'}`;
      const meta = document.createElement('small');
      meta.textContent = `${Number(service.durationMinutes || 0)} 分鐘／份 · ${formatMoney(service.priceAmount)}`;
      text.append(title, meta);
      const quantity = document.createElement('select');
      quantity.innerHTML = '<option value="1">1 份</option><option value="2">2 份</option>';
      quantity.value = String(current.get(checkbox.value) || 1);
      quantity.disabled = !checkbox.checked;
      checkbox.addEventListener('change', () => { quantity.disabled = !checkbox.checked; });
      row.append(checkbox, text, quantity);
      rows.appendChild(row);
    });

    form.querySelector('[data-cancel]').addEventListener('click', closeModal);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const selected = [...rows.querySelectorAll('input[type="checkbox"]:checked')].map((checkbox) => ({
        serviceId: checkbox.value,
        quantity: Number(checkbox.closest('label')?.querySelector('select')?.value || 1),
      }));
      if (!selected.length) return showMessage(form.querySelector('[data-modal-message]'), '請至少選擇一個預約項目。', 'error');

      const participants = (group.participants || []).map((person, index) => ({
        position: Number(person.position || index + 1),
        items: index === participantIndex
          ? selected
          : (person.items || []).map((item) => ({
              serviceId: String(item.serviceId || ''),
              quantity: Math.max(1, Number(item.quantity || 1)),
            })),
      }));

      await runModalAction(async () => operationsRequest('admin.booking.participants.items.update', {
        bookingId: booking.bookingId,
        expectedUpdatedAt: booking.updatedAt,
        participants,
      }, true));
    });
    showModal();
  }

  function openParticipantTechnicianEditor(booking, group, participantIndex) {
    if (!canEditBooking(booking)) return window.alert('這筆預約目前無法修改預約技師。');
    const participant = group?.participants?.[participantIndex];
    if (!participant) return;

    const technicians = (state.booking.technicians || [])
      .filter((item) => item.isActive || String(item.technicianId || '') === String(participant.technicianId || ''))
      .slice()
      .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0) || String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hant'));
    if (!technicians.length) return window.alert('目前沒有可用技師，請先到預約人數與技師設定新增技師。');

    els.bookingAdminCrudModalTitle.textContent = `${participantLabel(participantIndex)}｜修改技師`;
    els.bookingAdminCrudModalBody.innerHTML = '<form class="booking-admin-form"><p class="booking-admin-time">同一筆多人預約不可重複指定同一位技師，且至少一位必須指定主要技師。儲存時會重新檢查技師時段衝突。</p><label>預約技師<select data-participant-technician></select></label><div data-modal-message class="form-message hidden"></div><div class="booking-admin-modal-actions"><button data-cancel class="button button-outline" type="button">取消</button><button class="button button-dark" type="submit">儲存修改</button></div></form>';
    const form = els.bookingAdminCrudModalBody.querySelector('form');
    const select = form.querySelector('[data-participant-technician]');
    const onsite = document.createElement('option');
    onsite.value = '';
    onsite.textContent = '現場安排';
    select.appendChild(onsite);

    technicians.forEach((technician) => {
      const option = document.createElement('option');
      option.value = String(technician.technicianId || '');
      const primary = option.value && option.value === String(state.booking.primaryTechnicianId || '');
      option.textContent = `${String(technician.name || '未命名技師')}${primary ? '（主要技師）' : ''}${technician.isActive ? '' : '（目前停用）'}`;
      option.disabled = technician.isActive === false && option.value !== String(participant.technicianId || '');
      select.appendChild(option);
    });
    select.value = String(participant.technicianId || '');

    form.querySelector('[data-cancel]').addEventListener('click', closeModal);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const participants = (group.participants || []).map((person, index) => ({
        position: Number(person.position || index + 1),
        technicianId: index === participantIndex ? String(select.value || '') : String(person.technicianId || ''),
      }));
      const selectedIds = participants.map((person) => person.technicianId).filter(Boolean);
      if (new Set(selectedIds).size !== selectedIds.length) {
        return showMessage(form.querySelector('[data-modal-message]'), '同一筆多人預約不可重複指定同一位技師。', 'error');
      }
      const primaryTechnicianId = String(state.booking.primaryTechnicianId || '');
      if (primaryTechnicianId && !selectedIds.includes(primaryTechnicianId)) {
        return showMessage(form.querySelector('[data-modal-message]'), '至少一位預約人必須指定主要技師。', 'error');
      }

      await runModalAction(async () => operationsRequest('admin.booking.participants.technicians.update', {
        bookingId: booking.bookingId,
        expectedUpdatedAt: booking.updatedAt,
        participants,
      }, true));
    });
    showModal();
  }

  function participantItemsLabel(items) {
    const rows = Array.isArray(items) ? items : [];
    if (!rows.length) return '—';
    return rows.map((item) => {
      const title = String(item?.serviceTitle || '預約項目');
      const quantity = Math.max(1, Number(item?.quantity || 1));
      return quantity > 1 ? `${title} × ${quantity}` : title;
    }).join('、');
  }

  function participantLabel(index) {
    const names = ['第一', '第二', '第三', '第四', '第五', '第六', '第七', '第八', '第九', '第十'];
    return `${names[index] || `第 ${index + 1} `}位預約`;
  }

  function bookingContactName(booking) {
    const surname = String(booking?.contactSurname || '').trim();
    const label = salutationLabel(booking?.contactSalutation);
    if (surname && label) return `${surname}${label}`;
    return '未取得預約人資料';
  }

  function salutationLabel(value) {
    if (value === 'mr') return '先生';
    if (value === 'ms') return '小姐';
    return '';
  }

  function formatBookingDateSummary(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
    if (!match) return String(value || '—');
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const weekday = WEEKDAY_LABELS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()] || '';
    return `${month}/${day}（${weekday}）`;
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
