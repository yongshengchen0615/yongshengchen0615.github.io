(() => {
  'use strict';

  const state = {
    config: null,
    idToken: '',
    data: null,
    loading: false,
    savingParty: false,
    savingTechnician: false,
  };

  const ids = {
    section: 'bookingAdminResourceSettings',
    message: 'bookingAdminResourceMessage',
    partyForm: 'bookingAdminPartySizeForm',
    maxPartySize: 'bookingAdminMaxPartySize',
    partySave: 'bookingAdminSavePartySizeButton',
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
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  function init() {
    if (!mount()) return;
    bind();
    observeBookingPanel();
    boot();
  }

  function mount() {
    if (document.getElementById(ids.section)) return true;
    const host = document.querySelector('#bookingPanel .booking-admin-hours-card');
    const settingsForm = document.getElementById('bookingAdminSettingsForm');
    if (!host || !settingsForm) return false;

    const section = document.createElement('section');
    section.id = ids.section;
    section.className = 'booking-admin-resource-settings';
    section.setAttribute('aria-labelledby', 'bookingAdminResourceSettingsTitle');
    section.innerHTML = `
      <div class="booking-admin-section-heading booking-admin-resource-heading">
        <div>
          <p class="kicker">Capacity & technicians</p>
          <h4 id="bookingAdminResourceSettingsTitle">預約人數與技師</h4>
          <p>設定單筆預約最多人數，以及會員端可選擇的預約技師。每位預約人可分別選擇自己的預約項目。</p>
        </div>
        <button id="bookingAdminResourceRefreshButton" class="button button-outline" type="button">更新設定</button>
      </div>

      <div class="booking-admin-resource-grid">
        <form id="${ids.partyForm}" class="booking-admin-resource-box" novalidate>
          <div>
            <strong>單筆預約人數上限</strong>
            <small>會員端可選擇 1 人至此上限；目前支援 1–10 人。</small>
          </div>
          <label>最多人數
            <input id="${ids.maxPartySize}" type="number" min="1" max="10" step="1" value="1" required>
          </label>
          <button id="${ids.partySave}" class="button button-dark" type="submit">儲存人數設定</button>
        </form>

        <form id="${ids.technicianForm}" class="booking-admin-resource-box" novalidate>
          <input id="${ids.technicianId}" type="hidden">
          <input id="${ids.technicianExpectedUpdatedAt}" type="hidden">
          <div class="booking-admin-resource-box-heading">
            <div>
              <strong id="${ids.technicianTitle}">新增技師</strong>
              <small>同一位技師的時段不可重疊；不同技師可在相同時段各自接受預約。</small>
            </div>
            <button id="${ids.technicianNew}" class="button button-outline" type="button">＋ 新增</button>
          </div>
          <div class="booking-admin-resource-fields">
            <label>技師名稱
              <input id="${ids.technicianName}" type="text" maxlength="80" placeholder="例如：小林" required>
            </label>
            <label>顯示排序
              <input id="${ids.technicianSortOrder}" type="number" min="0" max="9999" step="1" value="0" required>
            </label>
          </div>
          <label class="booking-admin-resource-toggle">
            <input id="${ids.technicianActive}" type="checkbox" checked>
            <span><strong>開放會員選擇</strong><small>停用後不出現在新預約選單，既有預約仍保留。</small></span>
          </label>
          <button id="${ids.technicianSave}" class="button button-dark" type="submit">儲存技師</button>
        </form>
      </div>

      <div id="${ids.message}" class="form-message hidden" role="status" aria-live="polite"></div>
      <div class="booking-admin-resource-list-heading">
        <strong>技師清單</strong>
        <span id="${ids.technicianCount}">0</span>
      </div>
      <div id="${ids.technicianList}" class="booking-admin-technician-list"></div>
      <div id="${ids.technicianEmpty}" class="empty-state compact hidden">
        <span aria-hidden="true">○</span><p>尚未建立技師。</p>
      </div>
    `;

    settingsForm.insertAdjacentElement('afterend', section);
    return true;
  }

  function bind() {
    document.getElementById(ids.partyForm)?.addEventListener('submit', savePartySize);
    document.getElementById(ids.technicianForm)?.addEventListener('submit', saveTechnician);
    document.getElementById(ids.technicianNew)?.addEventListener('click', resetTechnicianForm);
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
      state.config = await window.MemberSystem.loadConfig();
      state.idToken = await waitForToken();
      await refresh(false);
    } catch (error) {
      showMessage(error?.message || '無法載入預約人數與技師設定。', 'error');
    }
  }

  async function waitForToken() {
    for (let i = 0; i < 150; i += 1) {
      const token = typeof window.liff?.getIDToken === 'function' ? String(window.liff.getIDToken() || '') : '';
      if (token) return token;
      await new Promise((resolve) => window.setTimeout(resolve, 100));
    }
    throw clientError('AUTH_REQUIRED', '管理端登入尚未完成，請重新整理後再試。');
  }

  async function request(action, payload = {}, write = false) {
    if (!state.config) state.config = await window.MemberSystem.loadConfig();
    if (!state.idToken) state.idToken = await waitForToken();

    const endpoint = `${String(state.config?.supabaseUrl || '').replace(/\/$/, '')}/functions/v1/booking-group-api`;
    if (!state.config?.supabaseUrl || !state.config?.supabasePublishableKey) {
      throw clientError('CONFIG_ERROR', '預約服務設定不完整，請重新整理後再試。');
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), write ? 30000 : 15000);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        cache: 'no-store',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          apikey: String(state.config.supabasePublishableKey),
        },
        body: JSON.stringify({
          ...payload,
          action,
          clientType: 'admin',
          idToken: state.idToken,
        }),
      });

      const text = await response.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch (_) {
        throw clientError('API_RESPONSE_ERROR', '預約設定服務回傳格式不正確。');
      }

      if (!response.ok || data?.ok !== true) {
        throw clientError(
          String(data?.error?.code || 'API_ERROR'),
          String(data?.error?.message || '預約設定服務拒絕此操作。'),
        );
      }
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
    const refreshButton = document.getElementById('bookingAdminResourceRefreshButton');
    if (refreshButton) {
      refreshButton.disabled = true;
      refreshButton.textContent = '更新中…';
    }

    try {
      const data = await request('admin.booking.resources.bootstrap');
      state.data = {
        settings: data.settings || {},
        technicians: Array.isArray(data.technicians) ? data.technicians : [],
      };
      const input = document.getElementById(ids.maxPartySize);
      if (input) input.value = String(Number(state.data.settings.maxPartySize) || 1);
      renderTechnicians();
      if (showFeedback) showMessage('預約人數與技師設定已更新。', 'success');
    } catch (error) {
      showMessage(error?.message || '無法更新預約人數與技師設定。', 'error');
    } finally {
      state.loading = false;
      if (refreshButton) {
        refreshButton.disabled = false;
        refreshButton.textContent = '更新設定';
      }
    }
  }

  async function savePartySize(event) {
    event.preventDefault();
    if (state.savingParty) return;

    const value = Number(document.getElementById(ids.maxPartySize)?.value);
    if (!Number.isInteger(value) || value < 1 || value > 10) {
      showMessage('預約人數上限必須是 1–10 的整數。', 'error');
      return;
    }

    const button = document.getElementById(ids.partySave);
    state.savingParty = true;
    setButtonBusy(button, true, '儲存中…');
    try {
      const result = await request('admin.booking.resources.settings.save', {
        maxPartySize: value,
        expectedUpdatedAt: state.data?.settings?.updatedAt || undefined,
      }, true);
      state.data = state.data || { settings: {}, technicians: [] };
      state.data.settings = result.settings || { ...state.data.settings, maxPartySize: value };
      document.getElementById(ids.maxPartySize).value = String(state.data.settings.maxPartySize || value);
      showMessage(`單筆預約人數上限已更新為 ${value} 人。`, 'success');
    } catch (error) {
      showMessage(error?.code === 'CONFLICT'
        ? '預約人數設定已被其他管理者更新，已重新載入最新資料。'
        : error?.message || '預約人數設定儲存失敗。', 'error');
      if (error?.code === 'CONFLICT') await refresh(false);
    } finally {
      state.savingParty = false;
      setButtonBusy(button, false, '儲存人數設定');
    }
  }

  async function saveTechnician(event) {
    event.preventDefault();
    if (state.savingTechnician) return;

    const name = String(document.getElementById(ids.technicianName)?.value || '').trim();
    const sortOrder = Number(document.getElementById(ids.technicianSortOrder)?.value);
    if (!name) {
      showMessage('請輸入技師名稱。', 'error');
      return;
    }
    if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 9999) {
      showMessage('技師排序必須是 0–9999 的整數。', 'error');
      return;
    }

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
      if (index >= 0) rows[index] = saved;
      else rows.push(saved);
      rows.sort(sortTechnicians);
      state.data.technicians = rows;

      renderTechnicians();
      editTechnician(saved);
      showMessage('技師設定已儲存。', 'success');
    } catch (error) {
      showMessage(error?.code === 'CONFLICT'
        ? '技師資料已被其他管理者更新，已重新載入最新資料。'
        : error?.message || '技師設定儲存失敗。', 'error');
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
      meta.textContent = `排序 ${Number(technician.sortOrder) || 0} · ${technician.isActive ? '會員端可選' : '已停用'}`;
      copy.append(name, meta);

      const badge = document.createElement('span');
      badge.className = `booking-admin-resource-status ${technician.isActive ? 'active' : 'inactive'}`;
      badge.textContent = technician.isActive ? '開放' : '停用';

      row.append(copy, badge);
      row.addEventListener('click', () => editTechnician(technician));
      list.append(row);
    });
  }

  function editTechnician(technician) {
    document.getElementById(ids.technicianId).value = String(technician.technicianId || '');
    document.getElementById(ids.technicianExpectedUpdatedAt).value = String(technician.updatedAt || '');
    document.getElementById(ids.technicianName).value = String(technician.name || '');
    document.getElementById(ids.technicianSortOrder).value = String(Number(technician.sortOrder) || 0);
    document.getElementById(ids.technicianActive).checked = Boolean(technician.isActive);
    document.getElementById(ids.technicianTitle).textContent = '編輯技師';
    document.getElementById(ids.technicianSave).textContent = '儲存修改';
  }

  function resetTechnicianForm() {
    const form = document.getElementById(ids.technicianForm);
    if (!form) return;
    form.reset();
    document.getElementById(ids.technicianId).value = '';
    document.getElementById(ids.technicianExpectedUpdatedAt).value = '';
    document.getElementById(ids.technicianSortOrder).value = '0';
    document.getElementById(ids.technicianActive).checked = true;
    document.getElementById(ids.technicianTitle).textContent = '新增技師';
    document.getElementById(ids.technicianSave).textContent = '儲存技師';
    document.getElementById(ids.technicianName).focus();
  }

  function sortTechnicians(a, b) {
    return (Number(a?.sortOrder) || 0) - (Number(b?.sortOrder) || 0)
      || String(a?.name || '').localeCompare(String(b?.name || ''), 'zh-Hant-TW');
  }

  function setButtonBusy(button, busy, fallbackText) {
    if (!button) return;
    button.disabled = busy;
    button.textContent = busy ? button.textContent : fallbackText;
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