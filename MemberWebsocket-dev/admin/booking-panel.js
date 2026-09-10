(() => {
  'use strict';

  const PRIMARY_TAB_IDS = ['membersTab', 'cardsTab', 'eventsTab', 'calendarTab'];
  const PRIMARY_PANEL_IDS = ['membersPanel', 'cardsPanel', 'eventsPanel', 'calendarPanel'];
  const STATUS_LABELS = { pending: '待確認', confirmed: '已確認', rejected: '未通過', cancelled: '已取消' };
  const WRITE_ACTIONS = new Set(['admin.booking.settings.save', 'admin.booking.service.save', 'admin.booking.status.update']);
  const state = {
    config: null,
    data: { settings: {}, services: [], bookings: [] },
    filter: 'pending',
    loaded: false,
    loading: false,
    savingSettings: false,
    savingService: false,
    writeLocked: false,
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
        <div><p class="kicker">Booking operations</p><h2>預約管理</h2><p>上班時間為全域設定；每個項目只設定服務時間。會員端會依總服務分鐘數與既有預約自動排除衝突。</p></div>
        <div class="heading-actions"><span id="bookingAdminSyncStatus" class="sync-status">尚未同步</span><button id="bookingAdminRefreshButton" class="button button-outline" type="button">更新預約</button></div>
      </div>

      <section class="booking-admin-stats" aria-label="預約概況">
        <div><span>預約項目</span><strong id="bookingAdminServiceCount">0</strong><small>已建立項目</small></div>
        <div><span>待確認</span><strong id="bookingAdminPendingCount">0</strong><small>需管理端確認</small></div>
        <div><span>已確認</span><strong id="bookingAdminConfirmedCount">0</strong><small>完成預約</small></div>
      </section>

      <section class="booking-admin-card booking-admin-hours-card" aria-labelledby="bookingAdminHoursTitle">
        <div class="booking-admin-section-heading"><div><p class="kicker">Working hours</p><h3 id="bookingAdminHoursTitle">管理員上班時間</h3><p>所有預約項目共用這段時間。會員選擇的總服務時間必須完整落在上班時間內。</p></div></div>
        <form id="bookingAdminSettingsForm" class="booking-admin-form booking-admin-settings-form" novalidate>
          <div class="booking-admin-form-grid">
            <label>開始工作時間<input id="bookingAdminStartTime" type="time" step="1800" value="09:00" required></label>
            <label>結束工作時間<input id="bookingAdminEndTime" type="time" step="1800" value="17:00" required></label>
          </div>
          <div id="bookingAdminSettingsMessage" class="form-message hidden" role="status" aria-live="polite"></div>
          <div class="booking-admin-inline-actions"><button id="bookingAdminSaveSettingsButton" class="button button-dark" type="submit">儲存上班時間</button></div>
        </form>
      </section>

      <div class="booking-admin-workspace">
        <section class="booking-admin-card" aria-labelledby="bookingAdminServiceTitle">
          <div class="booking-admin-section-heading"><div><p class="kicker">Booking services</p><h3 id="bookingAdminServiceTitle">預約項目</h3><p>項目服務時間會直接參與會員端可預約時間與衝突計算。</p></div><button id="bookingAdminNewServiceButton" class="button button-dark" type="button">＋ 新增項目</button></div>
          <div class="booking-admin-list-heading"><strong>已建立項目</strong><span id="bookingAdminServiceListCount">0</span></div>
          <div id="bookingAdminServiceList" class="booking-admin-service-list"></div>
          <div id="bookingAdminServiceEmpty" class="empty-state compact hidden"><span aria-hidden="true">○</span><p>尚未建立預約項目</p></div>
        </section>

        <section class="booking-admin-card" aria-labelledby="bookingAdminQueueTitle">
          <div class="booking-admin-section-heading"><div><p class="kicker">Confirmation queue</p><h3 id="bookingAdminQueueTitle">預約確認</h3><p>待確認預約也會立即佔用整段時間；取消或未通過後才重新開放。</p></div></div>
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

    const modal = document.createElement('div');
    modal.id = 'bookingAdminServiceModal';
    modal.className = 'booking-admin-modal hidden';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'bookingAdminServiceModalTitle');
    modal.innerHTML = `
      <div class="booking-admin-modal-card">
        <div class="booking-admin-modal-heading"><div><p class="kicker">Booking service</p><h2 id="bookingAdminServiceModalTitle">新增預約項目</h2></div><button id="bookingAdminCloseServiceModal" class="booking-admin-modal-close" type="button" aria-label="關閉">×</button></div>
        <form id="bookingAdminServiceForm" class="booking-admin-form" novalidate>
          <input id="bookingAdminServiceId" type="hidden"><input id="bookingAdminExpectedUpdatedAt" type="hidden">
          <label>預約項目名稱<input id="bookingAdminServiceName" type="text" maxlength="100" placeholder="例如：腳底按摩" required></label>
          <label>項目說明<textarea id="bookingAdminDescription" maxlength="1000" rows="3" placeholder="會員選擇此項目時顯示的說明"></textarea></label>
          <div class="booking-admin-form-grid">
            <label>項目服務時間（分鐘）<input id="bookingAdminDurationMinutes" type="number" min="1" max="720" step="1" value="30" required><small>例如 40 分鐘服務請輸入 40。預約數量 2 會計算為 80 分鐘。</small></label>
            <label>需要提前幾天預約<input id="bookingAdminAdvanceDays" type="number" min="0" max="365" step="1" value="0" required><small>0 = 可預約今天尚未經過的開始時段。</small></label>
          </div>
          <label class="booking-admin-toggle"><input id="bookingAdminActive" type="checkbox" checked><span><strong>開放會員預約</strong><small>關閉後會員端不再顯示此項目，既有預約紀錄仍保留。</small></span></label>
          <div id="bookingAdminServiceMessage" class="form-message hidden" role="status" aria-live="polite"></div>
          <div class="booking-admin-modal-actions"><button id="bookingAdminCancelServiceButton" class="button button-outline" type="button">取消</button><button id="bookingAdminSaveServiceButton" class="button button-dark" type="submit">儲存預約項目</button></div>
        </form>
      </div>`;
    document.body.appendChild(modal);

    cacheElements();
    bindEvents();
    openHashWhenAdminReady();
  }

  function cacheElements() {
    [
      'bookingTab', 'bookingPanel', 'bookingAdminSyncStatus', 'bookingAdminRefreshButton', 'bookingAdminServiceCount', 'bookingAdminPendingCount', 'bookingAdminConfirmedCount',
      'bookingAdminSettingsForm', 'bookingAdminStartTime', 'bookingAdminEndTime', 'bookingAdminSettingsMessage', 'bookingAdminSaveSettingsButton',
      'bookingAdminNewServiceButton', 'bookingAdminServiceListCount', 'bookingAdminServiceList', 'bookingAdminServiceEmpty', 'bookingAdminQueue', 'bookingAdminQueueEmpty',
      'bookingAdminServiceModal', 'bookingAdminServiceModalTitle', 'bookingAdminCloseServiceModal', 'bookingAdminCancelServiceButton', 'bookingAdminServiceForm',
      'bookingAdminServiceId', 'bookingAdminExpectedUpdatedAt', 'bookingAdminServiceName', 'bookingAdminDescription', 'bookingAdminDurationMinutes',
      'bookingAdminAdvanceDays', 'bookingAdminActive', 'bookingAdminServiceMessage', 'bookingAdminSaveServiceButton'
    ].forEach((id) => { els[id] = document.getElementById(id); });
  }

  function bindEvents() {
    els.bookingTab.addEventListener('click', activateBookingPanel);
    PRIMARY_TAB_IDS.forEach((id) => document.getElementById(id)?.addEventListener('click', deactivateBookingPanel));
    els.bookingAdminRefreshButton.addEventListener('click', () => refreshBookingData(true));
    els.bookingAdminSettingsForm.addEventListener('submit', saveSettings);
    els.bookingAdminNewServiceButton.addEventListener('click', () => openServiceModal(null));
    els.bookingAdminCloseServiceModal.addEventListener('click', closeServiceModal);
    els.bookingAdminCancelServiceButton.addEventListener('click', closeServiceModal);
    els.bookingAdminServiceForm.addEventListener('submit', saveService);
    els.bookingAdminServiceModal.addEventListener('click', (event) => {
      if (event.target === els.bookingAdminServiceModal && window.matchMedia('(max-width: 768px)').matches) closeServiceModal();
    });
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeServiceModal(); });
    document.querySelectorAll('[data-booking-filter]').forEach((button) => button.addEventListener('click', () => setFilter(button.dataset.bookingFilter || 'pending')));
    window.addEventListener('beforeunload', teardownRealtime);
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
    catch { throw clientError(isWrite ? 'API_RESPONSE_UNCERTAIN' : 'API_RESPONSE_ERROR', isWrite ? '無法確認操作結果；請先更新資料確認。' : '預約服務回傳格式不正確。'); }
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
        settings: result.settings || {},
        services: Array.isArray(result.services) ? result.services : [],
        bookings: Array.isArray(result.bookings) ? result.bookings : [],
      };
      state.loaded = true;
      state.writeLocked = false;
      renderAll();
      setupRealtime();
      setSyncStatus(showSuccess ? '預約資料已更新' : `已同步 · ${new Date().toLocaleTimeString('zh-Hant-TW', { hour: '2-digit', minute: '2-digit' })}`);
    } catch (error) {
      setSyncStatus(error?.message || '預約資料同步失敗', true);
    } finally {
      state.loading = false;
      els.bookingAdminRefreshButton.disabled = false;
      applyWriteLock();
    }
  }

  function renderAll() {
    renderStats();
    renderSettings();
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

  function renderSettings() {
    const settings = state.data.settings || {};
    els.bookingAdminStartTime.value = String(settings.workStartTime || '09:00');
    els.bookingAdminEndTime.value = String(settings.workEndTime || '17:00');
  }

  function renderServices() {
    const services = state.data.services || [];
    els.bookingAdminServiceListCount.textContent = String(services.length);
    els.bookingAdminServiceEmpty.classList.toggle('hidden', services.length > 0);
    els.bookingAdminServiceList.replaceChildren();
    services.forEach((service) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `booking-admin-service-row${service.isActive ? '' : ' inactive'}`;
      const content = document.createElement('span');
      const title = document.createElement('strong');
      title.textContent = service.title;
      const meta = document.createElement('small');
      meta.textContent = `服務 ${service.durationMinutes} 分鐘 · 提前 ${service.minAdvanceDays || 0} 天`;
      content.append(title, meta);
      if (service.description) {
        const description = document.createElement('small');
        description.textContent = service.description;
        content.appendChild(description);
      }
      const status = document.createElement('span');
      status.className = `booking-admin-service-status ${service.isActive ? 'active' : 'inactive'}`;
      status.textContent = service.isActive ? '開放' : '停用';
      button.append(content, status);
      button.addEventListener('click', () => openServiceModal(service));
      els.bookingAdminServiceList.appendChild(button);
    });
  }

  function openServiceModal(service) {
    if (state.writeLocked) return;
    const editing = Boolean(service);
    els.bookingAdminServiceModalTitle.textContent = editing ? '編輯預約項目' : '新增預約項目';
    els.bookingAdminServiceId.value = editing ? service.serviceId : '';
    els.bookingAdminExpectedUpdatedAt.value = editing ? service.updatedAt || '' : '';
    els.bookingAdminServiceName.value = editing ? service.title || '' : '';
    els.bookingAdminDescription.value = editing ? service.description || '' : '';
    els.bookingAdminDurationMinutes.value = String(editing ? service.durationMinutes || 30 : 30);
    els.bookingAdminAdvanceDays.value = String(editing ? service.minAdvanceDays || 0 : 0);
    els.bookingAdminActive.checked = editing ? service.isActive !== false : true;
    clearMessage(els.bookingAdminServiceMessage);
    els.bookingAdminServiceModal.classList.remove('hidden');
    els.bookingAdminServiceName.focus();
  }

  function closeServiceModal() {
    if (state.savingService || els.bookingAdminServiceModal.classList.contains('hidden')) return;
    els.bookingAdminServiceModal.classList.add('hidden');
    clearMessage(els.bookingAdminServiceMessage);
  }

  async function saveSettings(event) {
    event.preventDefault();
    if (state.savingSettings || state.writeLocked) return;
    state.savingSettings = true;
    els.bookingAdminSaveSettingsButton.disabled = true;
    els.bookingAdminSaveSettingsButton.textContent = '儲存中…';
    clearMessage(els.bookingAdminSettingsMessage);
    try {
      const result = await bookingRequest('admin.booking.settings.save', {
        workStartTime: els.bookingAdminStartTime.value,
        workEndTime: els.bookingAdminEndTime.value,
        expectedUpdatedAt: state.data.settings?.updatedAt || '',
      });
      state.data.settings = result.settings || state.data.settings;
      renderSettings();
      showMessage(els.bookingAdminSettingsMessage, '上班時間已儲存，會員端可預約時間會即時更新。', 'success');
    } catch (error) {
      handleWriteError(error, els.bookingAdminSettingsMessage);
    } finally {
      state.savingSettings = false;
      els.bookingAdminSaveSettingsButton.textContent = '儲存上班時間';
      applyWriteLock();
    }
  }

  async function saveService(event) {
    event.preventDefault();
    if (state.savingService || state.writeLocked) return;
    state.savingService = true;
    els.bookingAdminSaveServiceButton.disabled = true;
    els.bookingAdminSaveServiceButton.textContent = '儲存中…';
    clearMessage(els.bookingAdminServiceMessage);
    try {
      const result = await bookingRequest('admin.booking.service.save', {
        serviceId: els.bookingAdminServiceId.value,
        expectedUpdatedAt: els.bookingAdminExpectedUpdatedAt.value,
        title: els.bookingAdminServiceName.value,
        description: els.bookingAdminDescription.value,
        durationMinutes: Number(els.bookingAdminDurationMinutes.value),
        minAdvanceDays: Number(els.bookingAdminAdvanceDays.value),
        isActive: els.bookingAdminActive.checked,
      });
      const saved = result.service;
      state.data.services = [
        ...(state.data.services || []).filter((service) => service.serviceId !== saved.serviceId),
        saved,
      ].sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
      renderStats();
      renderServices();
      els.bookingAdminServiceModal.classList.add('hidden');
      setSyncStatus('預約項目已儲存');
    } catch (error) {
      handleWriteError(error, els.bookingAdminServiceMessage);
    } finally {
      state.savingService = false;
      els.bookingAdminSaveServiceButton.textContent = '儲存預約項目';
      applyWriteLock();
    }
  }

  function renderBookings() {
    const bookings = (state.data.bookings || []).filter((booking) => state.filter === 'all' || booking.status === state.filter);
    els.bookingAdminQueue.replaceChildren();
    els.bookingAdminQueueEmpty.classList.toggle('hidden', bookings.length > 0);
    bookings.forEach((booking) => {
      const card = document.createElement('article');
      card.className = 'booking-admin-booking';
      const heading = document.createElement('div');
      heading.className = 'booking-admin-booking-heading';
      const member = document.createElement('div');
      const memberName = document.createElement('strong');
      memberName.textContent = booking.memberDisplayName || '會員';
      const code = document.createElement('small');
      code.textContent = booking.memberCode || '無會員編號';
      member.append(memberName, code);
      const status = document.createElement('span');
      status.className = `booking-admin-status status-${booking.status}`;
      status.textContent = STATUS_LABELS[booking.status] || booking.status;
      heading.append(member, status);
      card.appendChild(heading);

      const title = document.createElement('h4');
      title.textContent = booking.serviceTitle || '預約項目';
      card.appendChild(title);
      const time = document.createElement('p');
      time.className = 'booking-admin-time';
      time.textContent = `${formatDate(booking.bookingDate)} ${booking.startTime}–${booking.endTime} · 共 ${booking.totalDurationMinutes || 0} 分鐘`;
      card.appendChild(time);

      if (Array.isArray(booking.items) && booking.items.length) {
        const list = document.createElement('ul');
        list.className = 'booking-admin-item-list';
        booking.items.forEach((item) => {
          const li = document.createElement('li');
          li.textContent = `${item.serviceTitle} × ${item.quantity}（${item.unitDurationMinutes} 分鐘/份）`;
          list.appendChild(li);
        });
        card.appendChild(list);
      }
      if (booking.memberNote) appendNote(card, `會員備註：${booking.memberNote}`, false);
      if (booking.adminNote) appendNote(card, `管理端說明：${booking.adminNote}`, true);

      if (booking.status === 'pending' || booking.status === 'confirmed') {
        const noteLabel = document.createElement('label');
        noteLabel.className = 'booking-admin-note-field';
        noteLabel.textContent = '管理端說明（選填）';
        const textarea = document.createElement('textarea');
        textarea.maxLength = 500;
        textarea.rows = 2;
        textarea.value = booking.adminNote || '';
        noteLabel.appendChild(textarea);
        card.appendChild(noteLabel);

        const actions = document.createElement('div');
        actions.className = 'booking-admin-actions';
        if (booking.status === 'pending') {
          actions.append(
            statusButton('不通過', 'button button-outline', () => updateBookingStatus(booking, 'rejected', textarea.value)),
            statusButton('確認預約', 'button button-dark', () => updateBookingStatus(booking, 'confirmed', textarea.value))
          );
        } else {
          actions.append(statusButton('取消預約', 'button button-danger', () => updateBookingStatus(booking, 'cancelled', textarea.value)));
        }
        card.appendChild(actions);
      }
      els.bookingAdminQueue.appendChild(card);
    });
  }

  function appendNote(card, text, admin) {
    const note = document.createElement('p');
    note.className = `booking-admin-note${admin ? ' admin' : ''}`;
    note.textContent = text;
    card.appendChild(note);
  }

  function statusButton(label, className, handler) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = label;
    button.disabled = state.writeLocked;
    button.addEventListener('click', handler);
    return button;
  }

  async function updateBookingStatus(booking, nextStatus, adminNote) {
    if (state.writeLocked) return;
    try {
      const result = await bookingRequest('admin.booking.status.update', {
        bookingId: booking.bookingId,
        status: nextStatus,
        adminNote,
      });
      state.data.bookings = (state.data.bookings || []).map((item) => item.bookingId === result.booking.bookingId ? result.booking : item);
      renderStats();
      renderBookings();
      setSyncStatus('預約狀態已更新');
    } catch (error) {
      if (error?.code === 'API_RESPONSE_UNCERTAIN') {
        state.writeLocked = true;
        applyWriteLock();
      }
      setSyncStatus(error?.message || '預約狀態更新失敗', true);
    }
  }

  function setFilter(filter) {
    state.filter = ['pending', 'confirmed', 'all'].includes(filter) ? filter : 'pending';
    document.querySelectorAll('[data-booking-filter]').forEach((button) => button.classList.toggle('active', button.dataset.bookingFilter === state.filter));
    renderBookings();
  }

  function handleWriteError(error, messageElement) {
    if (error?.code === 'API_RESPONSE_UNCERTAIN') {
      state.writeLocked = true;
      showMessage(messageElement, `${error.message} 已暫停寫入，請按「更新預約」確認資料後再繼續。`, 'error');
    } else {
      showMessage(messageElement, error?.message || '儲存失敗。', 'error');
    }
  }

  function applyWriteLock() {
    const locked = state.writeLocked;
    els.bookingAdminSaveSettingsButton.disabled = locked || state.savingSettings;
    els.bookingAdminNewServiceButton.disabled = locked;
    els.bookingAdminSaveServiceButton.disabled = locked || state.savingService;
    els.bookingPanel.querySelectorAll('.booking-admin-actions button').forEach((button) => { button.disabled = locked; });
  }

  function setupRealtime() {
    if (state.realtimeChannel || state.config?.realtimeEnabled === false || !window.supabase?.createClient) return;
    state.realtimeClient = window.supabase.createClient(state.config.supabaseUrl, state.config.supabasePublishableKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
    });
    const schedule = () => {
      if (state.realtimeTimer !== null) return;
      state.realtimeTimer = window.setTimeout(() => {
        state.realtimeTimer = null;
        refreshBookingData(false);
      }, 450);
    };
    state.realtimeChannel = state.realtimeClient
      .channel('booking-admin-sync')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'realtime_events' }, (payload) => {
        const row = payload && payload.new && typeof payload.new === 'object' ? payload.new : {};
        const scope = String(row.scope || '');
        const type = String(row.event_type || '');
        if ((scope === 'all' || scope === 'admin') && type.startsWith('booking.')) schedule();
      })
      .subscribe();
  }

  function teardownRealtime() {
    if (state.realtimeTimer !== null) window.clearTimeout(state.realtimeTimer);
    state.realtimeTimer = null;
    if (state.realtimeClient && state.realtimeChannel) {
      try { Promise.resolve(state.realtimeClient.removeChannel(state.realtimeChannel)).catch(() => {}); } catch (_) {}
    }
    state.realtimeChannel = null;
  }

  function setSyncStatus(message, isError) {
    els.bookingAdminSyncStatus.textContent = message;
    els.bookingAdminSyncStatus.classList.toggle('error', Boolean(isError));
  }

  function showMessage(element, message, type) {
    element.textContent = message;
    element.className = `form-message ${type || ''}`;
  }

  function clearMessage(element) {
    element.textContent = '';
    element.className = 'form-message hidden';
  }

  function formatDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
    return match ? `${Number(match[1])}/${Number(match[2])}/${Number(match[3])}` : String(value || '—');
  }
})();
