(() => {
  'use strict';

  const state = {
    config: null,
    idToken: '',
    data: null,
    loading: false,
    savingSettings: false,
    savingTechnician: false,
    deletingTechnician: false,
    initialized: false,
  };

  const ids = {
    section: 'bookingAdminResourceSettings',
    message: 'bookingAdminResourceMessage',
    settingsForm: 'bookingAdminPartySizeForm',
    maxPartySize: 'bookingAdminMaxPartySize',
    primaryTechnician: 'bookingAdminPrimaryTechnician',
    settingsSave: 'bookingAdminSavePartySizeButton',
    technicianForm: 'bookingAdminTechnicianForm',
    technicianId: 'bookingAdminTechnicianId',
    technicianExpectedUpdatedAt: 'bookingAdminTechnicianExpectedUpdatedAt',
    technicianName: 'bookingAdminTechnicianName',
    technicianSortOrder: 'bookingAdminTechnicianSortOrder',
    technicianActive: 'bookingAdminTechnicianActive',
    technicianTitle: 'bookingAdminTechnicianFormTitle',
    technicianSave: 'bookingAdminSaveTechnicianButton',
    technicianNew: 'bookingAdminNewTechnicianButton',
    technicianList: 'bookingAdminTechnicianList',
    technicianCount: 'bookingAdminTechnicianCount',
    technicianEmpty: 'bookingAdminTechnicianEmpty',
    technicianModal: 'bookingAdminTechnicianModal',
    technicianModalClose: 'bookingAdminTechnicianModalClose',
    technicianModalCancel: 'bookingAdminTechnicianModalCancel',
    technicianModalMessage: 'bookingAdminTechnicianModalMessage',
    technicianDelete: 'bookingAdminDeleteTechnicianButton',
    technicianDeleteConfirm: 'bookingAdminTechnicianDeleteConfirm',
    technicianDeleteConfirmText: 'bookingAdminTechnicianDeleteConfirmText',
    technicianDeleteBack: 'bookingAdminTechnicianDeleteBack',
    technicianDeleteSubmit: 'bookingAdminTechnicianDeleteSubmit',
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  function init() {
    if (startWhenReady()) return;

    const observer = new MutationObserver(() => {
      if (startWhenReady()) observer.disconnect();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.setTimeout(() => observer.disconnect(), 30000);
  }

  function startWhenReady() {
    if (state.initialized) return true;
    if (!mount()) return false;

    state.initialized = true;
    bind();
    observeBookingPanel();
    boot();
    return true;
  }

  function mount() {
    if (document.getElementById(ids.section)) return true;
    const host = document.getElementById('bookingAdminTechnicianMount');
    if (!host) return false;

    const section = document.createElement('section');
    section.id = ids.section;
    section.className = 'booking-admin-resource-settings';
    section.setAttribute('aria-labelledby', 'bookingAdminResourceSettingsTitle');
    section.innerHTML = `
      <div class="booking-admin-section-heading booking-admin-resource-heading">
        <div>
          <p class="kicker">Capacity & technicians</p>
          <h3 id="bookingAdminResourceSettingsTitle">技師設定</h3>
          <p>設定單筆預約最多人數、主要技師與技師清單；新增、修改與刪除技師統一使用小視窗。</p>
        </div>
        <button id="bookingAdminResourceRefreshButton" class="button button-outline" type="button">更新設定</button>
      </div>

      <div class="booking-admin-resource-grid booking-admin-resource-grid-single">
        <form id="${ids.settingsForm}" class="booking-admin-resource-box" novalidate>
          <div>
            <strong>預約基本設定</strong>
            <small>會員端可選擇 1 人至設定上限；主要技師是每筆預約的必要人員。</small>
          </div>
          <label>最多人數
            <input id="${ids.maxPartySize}" type="number" min="1" max="10" step="1" value="1" required>
          </label>
          <label>主要技師
            <select id="${ids.primaryTechnician}" aria-label="主要技師"></select>
            <small>不論預約幾位，至少一位必須指定此技師才能送出。</small>
          </label>
          <button id="${ids.settingsSave}" class="button button-dark" type="submit">儲存預約設定</button>
        </form>
      </div>

      <div id="${ids.message}" class="form-message hidden" role="status" aria-live="polite"></div>
      <div class="booking-admin-resource-list-heading">
        <div><strong>技師清單</strong><span id="${ids.technicianCount}">0</span></div>
        <button id="${ids.technicianNew}" class="button button-dark" type="button">＋ 新增技師</button>
      </div>
      <div id="${ids.technicianList}" class="booking-admin-technician-list"></div>
      <div id="${ids.technicianEmpty}" class="empty-state compact hidden">
        <span aria-hidden="true">○</span><p>尚未建立技師。請先新增技師，再設定主要技師。</p>
      </div>`;

    host.appendChild(section);

    if (!document.getElementById(ids.technicianModal)) {
      const modal = document.createElement('div');
      modal.id = ids.technicianModal;
      modal.className = 'booking-admin-modal hidden';
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      modal.setAttribute('aria-labelledby', ids.technicianTitle);
      modal.innerHTML = `
        <div class="booking-admin-modal-card booking-admin-technician-modal-card">
          <div class="booking-admin-modal-heading">
            <div><p class="kicker">Technician editor</p><h2 id="${ids.technicianTitle}">新增技師</h2></div>
            <button id="${ids.technicianModalClose}" class="booking-admin-modal-close" type="button" aria-label="關閉">×</button>
          </div>

          <form id="${ids.technicianForm}" class="booking-admin-form booking-admin-technician-modal-form" novalidate>
            <input id="${ids.technicianId}" type="hidden">
            <input id="${ids.technicianExpectedUpdatedAt}" type="hidden">
            <div class="booking-admin-form-grid">
              <label>技師名稱
                <input id="${ids.technicianName}" type="text" maxlength="80" placeholder="例如：小林" required>
              </label>
              <label>顯示排序
                <input id="${ids.technicianSortOrder}" type="number" min="0" max="9999" step="1" value="0" required>
              </label>
            </div>
            <label class="booking-admin-toggle">
              <input id="${ids.technicianActive}" type="checkbox" checked>
              <span><strong>開放會員選擇</strong><small>主要技師不可直接停用；請先變更主要技師。</small></span>
            </label>
            <div class="booking-admin-modal-actions booking-admin-technician-modal-actions">
              <button id="${ids.technicianDelete}" class="button button-danger hidden" type="button">刪除技師</button>
              <button id="${ids.technicianModalCancel}" class="button button-outline" type="button">取消</button>
              <button id="${ids.technicianSave}" class="button button-dark" type="submit">儲存技師</button>
            </div>
          </form>

          <section id="${ids.technicianDeleteConfirm}" class="booking-admin-technician-delete-confirm hidden" aria-labelledby="bookingAdminTechnicianDeleteTitle">
            <div>
              <p class="kicker">Delete technician</p>
              <h3 id="bookingAdminTechnicianDeleteTitle">確認刪除技師</h3>
              <p id="${ids.technicianDeleteConfirmText}"></p>
              <small>若已有預約紀錄、目前為主要技師或不符合刪除條件，系統會拒絕刪除並保留資料。</small>
            </div>
            <div class="booking-admin-modal-actions">
              <button id="${ids.technicianDeleteBack}" class="button button-outline" type="button">返回修改</button>
              <button id="${ids.technicianDeleteSubmit}" class="button button-danger" type="button">確認刪除</button>
            </div>
          </section>

          <div id="${ids.technicianModalMessage}" class="form-message hidden" role="status" aria-live="polite"></div>
        </div>`;
      document.body.appendChild(modal);
    }
    return true;
  }

  function bind() {
    document.getElementById(ids.settingsForm)?.addEventListener('submit', saveSettings);
    document.getElementById(ids.technicianForm)?.addEventListener('submit', saveTechnician);
    document.getElementById(ids.technicianNew)?.addEventListener('click', openNewTechnicianModal);
    document.getElementById(ids.technicianModalClose)?.addEventListener('click', closeTechnicianModal);
    document.getElementById(ids.technicianModalCancel)?.addEventListener('click', closeTechnicianModal);
    document.getElementById(ids.technicianDelete)?.addEventListener('click', openDeleteTechnicianConfirm);
    document.getElementById(ids.technicianDeleteBack)?.addEventListener('click', showTechnicianEditor);
    document.getElementById(ids.technicianDeleteSubmit)?.addEventListener('click', deleteTechnician);
    document.getElementById(ids.technicianModal)?.addEventListener('click', (event) => {
      if (event.target === event.currentTarget && window.matchMedia('(max-width: 768px)').matches) closeTechnicianModal();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !document.getElementById(ids.technicianModal)?.classList.contains('hidden')) closeTechnicianModal();
    });
    document.getElementById('bookingAdminResourceRefreshButton')?.addEventListener('click', () => refresh(true));
  }

  function observeBookingPanel() {
    const panel = document.getElementById('bookingPanel');
    if (!panel) return;
    let wasVisible = !panel.classList.contains('hidden');
    const observer = new MutationObserver(() => {
      const visible = !panel.classList.contains('hidden');
      if (visible && !wasVisible) refresh(false);
      wasVisible = visible;
    });
    observer.observe(panel, { attributes: true, attributeFilter: ['class'] });
  }

  async function boot() {
    try {
      state.idToken = await waitForToken();
      await refresh(false);
    } catch (error) {
      showMessage(error?.message || '無法載入預約人數與技師設定。', 'error');
    }
  }

  async function waitForToken() {
    if (!window.MemberAdminSession || typeof window.MemberAdminSession.wait !== 'function') {
      throw clientError('AUTH_REQUIRED', '管理端登入服務尚未準備完成。');
    }
    const session = await window.MemberAdminSession.wait();
    state.config = session.config;
    return String(session.idToken || '');
  }

  async function request(action, payload = {}, write = false) {
    if (!state.config || !state.idToken) state.idToken = await waitForToken();
    const endpoint = `${String(state.config?.supabaseUrl || '').replace(/\/$/, '')}/functions/v1/booking-group-api`;
    if (!state.config?.supabaseUrl || !state.config?.supabasePublishableKey) throw clientError('CONFIG_ERROR', '預約服務設定不完整，請重新整理後再試。');

    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), write ? 30000 : 15000);
    try {
      const response = await fetch(endpoint, {
        method: 'POST', cache: 'no-store', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', apikey: String(state.config.supabasePublishableKey) },
        body: JSON.stringify({ ...payload, action, clientType: 'admin', idToken: state.idToken }),
      });
      const text = await response.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; }
      catch { throw clientError('API_RESPONSE_ERROR', '預約設定服務回傳格式不正確。'); }
      if (!response.ok || data?.ok !== true) throw clientError(String(data?.error?.code || 'API_ERROR'), String(data?.error?.message || '預約設定服務拒絕此操作。'));
      return data.data || {};
    } catch (error) {
      if (error?.name === 'AbortError') throw clientError('TIMEOUT', '預約設定服務逾時，請稍後再試。');
      throw error;
    } finally {
      window.clearTimeout(timer);
    }
  }

  async function refresh(showFeedback) {
    if (state.loading) return;
    state.loading = true;
    const button = document.getElementById('bookingAdminResourceRefreshButton');
    if (button) { button.disabled = true; button.textContent = '更新中…'; }
    try {
      const data = await request('admin.booking.resources.bootstrap');
      state.data = {
        settings: data.settings || {},
        technicians: Array.isArray(data.technicians) ? data.technicians : [],
      };
      document.getElementById(ids.maxPartySize).value = String(Number(state.data.settings.maxPartySize) || 1);
      renderPrimaryOptions();
      renderTechnicians();
      if (showFeedback) showMessage('預約人數、主要技師與技師清單已更新。', 'success');
    } catch (error) {
      showMessage(error?.message || '無法更新預約人數與技師設定。', 'error');
    } finally {
      state.loading = false;
      if (button) { button.disabled = false; button.textContent = '更新設定'; }
    }
  }

  function renderPrimaryOptions() {
    const select = document.getElementById(ids.primaryTechnician);
    if (!select) return;
    const current = String(state.data?.settings?.primaryTechnicianId || '');
    const active = (state.data?.technicians || []).filter((item) => item.isActive).slice().sort(sortTechnicians);
    select.replaceChildren();
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = active.length ? '請選擇主要技師' : '請先新增開放中的技師';
    select.appendChild(empty);
    active.forEach((technician) => {
      const option = document.createElement('option');
      option.value = technician.technicianId;
      option.textContent = technician.name;
      select.appendChild(option);
    });
    select.value = active.some((item) => item.technicianId === current) ? current : '';
    select.disabled = active.length === 0;
  }

  async function saveSettings(event) {
    event.preventDefault();
    if (state.savingSettings) return;
    const value = Number(document.getElementById(ids.maxPartySize)?.value);
    const primaryTechnicianId = String(document.getElementById(ids.primaryTechnician)?.value || '');
    const hasActiveTechnicians = (state.data?.technicians || []).some((item) => item.isActive);
    if (!Number.isInteger(value) || value < 1 || value > 10) return showMessage('預約人數上限必須是 1–10 的整數。', 'error');
    if (hasActiveTechnicians && !primaryTechnicianId) return showMessage('請選擇主要技師。', 'error');

    const button = document.getElementById(ids.settingsSave);
    state.savingSettings = true;
    setButtonBusy(button, true, '儲存中…');
    try {
      const result = await request('admin.booking.resources.settings.save', {
        maxPartySize: value,
        primaryTechnicianId,
        expectedUpdatedAt: state.data?.settings?.updatedAt || undefined,
      }, true);
      state.data = state.data || { settings: {}, technicians: [] };
      state.data.settings = result.settings || { ...state.data.settings, maxPartySize: value, primaryTechnicianId };
      renderPrimaryOptions();
      renderTechnicians();
      const primary = (state.data.technicians || []).find((item) => item.technicianId === state.data.settings.primaryTechnicianId);
      showMessage(primary ? `預約設定已儲存；主要技師為 ${primary.name}。` : '預約人數設定已儲存；尚未設定主要技師。', primary ? 'success' : 'error');
    } catch (error) {
      showMessage(error?.code === 'CONFLICT' ? '預約設定已被其他管理者更新，已重新載入最新資料。' : error?.message || '預約設定儲存失敗。', 'error');
      if (error?.code === 'CONFLICT') await refresh(false);
    } finally {
      state.savingSettings = false;
      setButtonBusy(button, false, '儲存預約設定');
    }
  }

  async function saveTechnician(event) {
    event.preventDefault();
    if (state.savingTechnician) return;
    const name = String(document.getElementById(ids.technicianName)?.value || '').trim();
    const sortOrder = Number(document.getElementById(ids.technicianSortOrder)?.value);
    if (!name) return showMessage('請輸入技師名稱。', 'error');
    if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 9999) return showMessage('技師排序必須是 0–9999 的整數。', 'error');

    const button = document.getElementById(ids.technicianSave);
    state.savingTechnician = true;
    setButtonBusy(button, true, '儲存中…');
    try {
      const result = await request('admin.booking.resources.technician.save', {
        technicianId: document.getElementById(ids.technicianId)?.value || undefined,
        expectedUpdatedAt: document.getElementById(ids.technicianExpectedUpdatedAt)?.value || undefined,
        name,
        sortOrder,
        isActive: Boolean(document.getElementById(ids.technicianActive)?.checked),
      }, true);
      const saved = result.technician;
      if (!saved?.technicianId) throw clientError('API_RESPONSE_ERROR', '無法確認技師儲存結果。');
      state.data = state.data || { settings: {}, technicians: [] };
      const rows = Array.isArray(state.data.technicians) ? state.data.technicians : [];
      const index = rows.findIndex((item) => item.technicianId === saved.technicianId);
      if (index >= 0) rows[index] = saved; else rows.push(saved);
      rows.sort(sortTechnicians);
      state.data.technicians = rows;
      renderPrimaryOptions();
      renderTechnicians();
      closeTechnicianModal(true);
      const needsPrimary = !state.data.settings?.primaryTechnicianId && rows.some((item) => item.isActive);
      showMessage(needsPrimary ? '技師已儲存。請在「主要技師」選擇一位並儲存預約設定。' : '技師設定已儲存。', needsPrimary ? 'error' : 'success');
    } catch (error) {
      showTechnicianModalMessage(error?.code === 'CONFLICT' ? '技師資料已被其他管理者更新，請重新開啟技師資料。' : error?.message || '技師設定儲存失敗。', 'error');
      if (error?.code === 'CONFLICT') await refresh(false);
    } finally {
      state.savingTechnician = false;
      setButtonBusy(button, false, document.getElementById(ids.technicianId)?.value ? '儲存修改' : '儲存技師');
    }
  }

  function renderTechnicians() {
    const list = document.getElementById(ids.technicianList);
    if (!list) return;
    const rows = Array.isArray(state.data?.technicians) ? state.data.technicians.slice().sort(sortTechnicians) : [];
    const primaryId = String(state.data?.settings?.primaryTechnicianId || '');
    list.replaceChildren();
    document.getElementById(ids.technicianCount).textContent = String(rows.length);
    document.getElementById(ids.technicianEmpty).classList.toggle('hidden', rows.length !== 0);
    rows.forEach((technician) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = `booking-admin-technician-row${technician.isActive ? '' : ' inactive'}`;
      row.setAttribute('aria-label', `編輯技師 ${technician.name || ''}`);
      const copy = document.createElement('span');
      const name = document.createElement('strong');
      name.textContent = String(technician.name || '未命名技師');
      const meta = document.createElement('small');
      const tags = [`排序 ${Number(technician.sortOrder) || 0}`, technician.isActive ? '會員端可選' : '已停用'];
      if (technician.technicianId === primaryId) tags.push('主要技師');
      meta.textContent = tags.join(' · ');
      copy.append(name, meta);
      const badge = document.createElement('span');
      badge.className = `booking-admin-resource-status ${technician.isActive ? 'active' : 'inactive'}`;
      badge.textContent = technician.technicianId === primaryId ? '主要' : technician.isActive ? '開放' : '停用';
      row.append(copy, badge);
      row.addEventListener('click', () => openEditTechnicianModal(technician));
      list.append(row);
    });
  }

  function openEditTechnicianModal(technician) {
    const form = document.getElementById(ids.technicianForm);
    if (!form || !technician) return;
    form.reset();
    document.getElementById(ids.technicianId).value = String(technician.technicianId || '');
    document.getElementById(ids.technicianExpectedUpdatedAt).value = String(technician.updatedAt || '');
    document.getElementById(ids.technicianName).value = String(technician.name || '');
    document.getElementById(ids.technicianSortOrder).value = String(Number(technician.sortOrder) || 0);
    document.getElementById(ids.technicianActive).checked = Boolean(technician.isActive);
    document.getElementById(ids.technicianTitle).textContent = technician.technicianId === state.data?.settings?.primaryTechnicianId ? '修改主要技師' : '修改技師';
    document.getElementById(ids.technicianSave).textContent = '儲存修改';
    document.getElementById(ids.technicianDelete).classList.remove('hidden');
    showTechnicianEditor();
    showTechnicianModal();
  }

  function openNewTechnicianModal() {
    const form = document.getElementById(ids.technicianForm);
    if (!form) return;
    form.reset();
    document.getElementById(ids.technicianId).value = '';
    document.getElementById(ids.technicianExpectedUpdatedAt).value = '';
    document.getElementById(ids.technicianSortOrder).value = '0';
    document.getElementById(ids.technicianActive).checked = true;
    document.getElementById(ids.technicianTitle).textContent = '新增技師';
    document.getElementById(ids.technicianSave).textContent = '儲存技師';
    document.getElementById(ids.technicianDelete).classList.add('hidden');
    showTechnicianEditor();
    showTechnicianModal();
  }

  function showTechnicianModal() {
    clearTechnicianModalMessage();
    const modal = document.getElementById(ids.technicianModal);
    modal?.classList.remove('hidden');
    window.requestAnimationFrame(() => document.getElementById(ids.technicianName)?.focus());
  }

  function closeTechnicianModal(force = false) {
    if (!force && (state.savingTechnician || state.deletingTechnician)) return;
    document.getElementById(ids.technicianModal)?.classList.add('hidden');
    showTechnicianEditor();
    clearTechnicianModalMessage();
  }

  function showTechnicianEditor() {
    document.getElementById(ids.technicianForm)?.classList.remove('hidden');
    document.getElementById(ids.technicianDeleteConfirm)?.classList.add('hidden');
    clearTechnicianModalMessage();
  }

  function openDeleteTechnicianConfirm() {
    const technicianId = String(document.getElementById(ids.technicianId)?.value || '');
    if (!technicianId) return;
    const name = String(document.getElementById(ids.technicianName)?.value || '').trim() || '這位技師';
    document.getElementById(ids.technicianDeleteConfirmText).textContent = `確定永久刪除技師「${name}」？此操作不可復原。`;
    document.getElementById(ids.technicianForm)?.classList.add('hidden');
    document.getElementById(ids.technicianDeleteConfirm)?.classList.remove('hidden');
    clearTechnicianModalMessage();
  }

  async function deleteTechnician() {
    if (state.deletingTechnician) return;
    const technicianId = String(document.getElementById(ids.technicianId)?.value || '');
    const expectedUpdatedAt = String(document.getElementById(ids.technicianExpectedUpdatedAt)?.value || '');
    const technicianName = String(document.getElementById(ids.technicianName)?.value || '').trim() || '這位技師';
    if (!technicianId || !expectedUpdatedAt) return showTechnicianModalMessage('無法確認要刪除的技師版本，請重新開啟後再試。', 'error');

    const button = document.getElementById(ids.technicianDeleteSubmit);
    state.deletingTechnician = true;
    setButtonBusy(button, true, '確認刪除');
    if (button) button.textContent = '刪除中…';
    try {
      await deleteTechnicianRequest({ technicianId, expectedUpdatedAt });
      state.data = state.data || { settings: {}, technicians: [] };
      state.data.technicians = (state.data.technicians || []).filter((item) => String(item.technicianId || '') !== technicianId);
      renderPrimaryOptions();
      renderTechnicians();
      closeTechnicianModal(true);
      showMessage(`技師「${technicianName}」已刪除。`, 'success');
      window.dispatchEvent(new CustomEvent('booking:technician-deleted', { detail: { technicianId } }));
    } catch (error) {
      const message = error?.name === 'AbortError'
        ? '技師刪除服務逾時，請稍後再試。'
        : error?.message || '技師刪除失敗。';
      showTechnicianModalMessage(message, 'error');
      if (error?.code === 'CONFLICT') await refresh(false);
    } finally {
      state.deletingTechnician = false;
      setButtonBusy(button, false, '確認刪除');
    }
  }

  async function deleteTechnicianRequest(payload) {
    if (!state.config || !state.idToken) state.idToken = await waitForToken();
    const endpoint = `${String(state.config?.supabaseUrl || '').replace(/\/$/, '')}/functions/v1/booking-technician-delete`;
    if (!state.config?.supabaseUrl || !state.config?.supabasePublishableKey) throw clientError('CONFIG_ERROR', '預約服務設定不完整。');

    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        cache: 'no-store',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', apikey: String(state.config.supabasePublishableKey) },
        body: JSON.stringify({
          action: 'admin.booking.resources.technician.delete',
          clientType: 'admin',
          idToken: state.idToken,
          technicianId: payload.technicianId,
          expectedUpdatedAt: payload.expectedUpdatedAt,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || data?.ok !== true) {
        throw clientError(String(data?.error?.code || 'API_ERROR'), String(data?.error?.message || '技師刪除失敗。'));
      }
      return data.data || {};
    } finally {
      window.clearTimeout(timer);
    }
  }

  function showTechnicianModalMessage(message, type) {
    const element = document.getElementById(ids.technicianModalMessage);
    if (!element) return;
    element.textContent = String(message || '');
    element.className = `form-message${type === 'success' ? ' success' : ''}`;
  }

  function clearTechnicianModalMessage() {
    const element = document.getElementById(ids.technicianModalMessage);
    if (!element) return;
    element.textContent = '';
    element.className = 'form-message hidden';
  }

  function sortTechnicians(a, b) {
    return (Number(a?.sortOrder) || 0) - (Number(b?.sortOrder) || 0) || String(a?.name || '').localeCompare(String(b?.name || ''), 'zh-Hant-TW');
  }

  function setButtonBusy(button, busy, fallbackText) {
    if (!button) return;
    button.disabled = busy;
    if (!busy) button.textContent = fallbackText;
  }

  function showMessage(message, type) {
    const element = document.getElementById(ids.message);
    if (!element) return;
    element.textContent = String(message || '');
    element.className = `form-message${type === 'success' ? ' success' : ''}`;
  }

  function clientError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }
})();