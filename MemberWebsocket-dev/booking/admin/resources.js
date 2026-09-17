(() => {
  'use strict';

  const state = { config: null, idToken: '', data: null, saving: false };
  const currentScriptUrl = document.currentScript?.src || new URL('./resources.js', window.location.href).toString();

  window.addEventListener('DOMContentLoaded', () => {
    injectPanel();
    loadTechnicianDeleteControls();
    window.addEventListener('booking:technician-deleted', async () => {
      resetTechnicianForm();
      try { await refresh(); } catch (error) { showMessage(error?.message || '技師清單更新失敗，請手動重新整理。', 'error'); }
    });
    boot();
  });

  function loadTechnicianDeleteControls() {
    if (document.querySelector('script[data-booking-technician-delete]')) return;
    const script = document.createElement('script');
    script.src = new URL('../../booking-technician-delete.js?v=booking-technician-delete-20260917-1', currentScriptUrl).toString();
    script.defer = true;
    script.dataset.bookingTechnicianDelete = 'true';
    script.onerror = () => console.error('booking technician delete controls load failed');
    document.head.appendChild(script);
  }

  function injectPanel() {
    const adminView = document.getElementById('adminView');
    const stats = adminView?.querySelector('.stats-row');
    if (!adminView || !stats || document.getElementById('bookingResourcePanel')) return;

    const panel = document.createElement('section');
    panel.id = 'bookingResourcePanel';
    panel.className = 'panel booking-resource-panel';
    panel.setAttribute('aria-labelledby', 'bookingResourceTitle');
    panel.innerHTML = `
      <div class="panel-heading">
        <div>
          <p class="kicker">Capacity & technicians</p>
          <h2 id="bookingResourceTitle">預約人數與技師</h2>
          <p>設定單筆預約最多人數與主要技師；多人預約至少一位必須選擇主要技師。</p>
        </div>
      </div>
      <div class="booking-resource-grid">
        <form id="partySizeForm" class="resource-box" novalidate>
          <strong>預約基本設定</strong>
          <small>會員端可選 1 人至上限；主要技師是每筆預約的必要人員。</small>
          <label>最多人數<input id="maxPartySize" type="number" min="1" max="10" step="1" value="1" required></label>
          <label>主要技師<select id="primaryTechnician"><option value="">請先新增技師</option></select></label>
          <small>不論預約幾位，至少一位必須指定此技師才能送出。</small>
          <button id="savePartySizeButton" class="button button-dark" type="submit">儲存預約設定</button>
        </form>
        <form id="technicianForm" class="resource-box" novalidate>
          <input id="technicianId" type="hidden"><input id="technicianExpectedUpdatedAt" type="hidden">
          <div class="resource-box-heading"><div><strong id="technicianFormTitle">新增技師</strong><small>同一位技師的時段不可重疊；其他預約人可選現場安排。</small></div><button id="newTechnicianButton" class="button button-light" type="button">＋ 新增</button></div>
          <div class="resource-form-row">
            <label>技師名稱<input id="technicianName" type="text" maxlength="80" placeholder="例如：小林" required></label>
            <label>排序<input id="technicianSortOrder" type="number" min="0" max="9999" step="1" value="0" required></label>
          </div>
          <label class="toggle-row"><input id="technicianActive" type="checkbox" checked><span><strong>開放會員選擇</strong><small>主要技師不可直接停用，請先更換主要技師。</small></span></label>
          <button id="saveTechnicianButton" class="button button-dark" type="submit">儲存技師</button>
        </form>
      </div>
      <div id="bookingResourceMessage" class="form-message hidden" role="status" aria-live="polite"></div>
      <div class="resource-list-heading"><strong>技師清單</strong><span id="technicianCount">0</span></div>
      <div id="technicianList" class="technician-list"></div>
      <div id="technicianEmpty" class="empty-state hidden">尚未建立技師。請先新增技師，再設定主要技師。</div>`;
    stats.insertAdjacentElement('afterend', panel);

    document.getElementById('partySizeForm').addEventListener('submit', saveSettings);
    document.getElementById('technicianForm').addEventListener('submit', saveTechnician);
    document.getElementById('newTechnicianButton').addEventListener('click', resetTechnicianForm);
  }

  async function boot() {
    try {
      state.config = await window.BookingSystem.loadConfig();
      state.idToken = await waitForToken();
      await refresh();
    } catch (error) {
      showMessage(error?.message || '無法載入預約人數與技師設定。', 'error');
    }
  }

  async function waitForToken() {
    for (let i = 0; i < 100; i += 1) {
      const token = typeof window.liff?.getIDToken === 'function' ? window.liff.getIDToken() : '';
      if (token) return token;
      await new Promise((resolve) => window.setTimeout(resolve, 100));
    }
    throw new Error('管理端登入尚未完成，請重新整理。');
  }

  async function request(action, payload = {}) {
    const endpoint = `${String(state.config?.supabaseUrl || '').replace(/\/$/, '')}/functions/v1/booking-group-api`;
    const response = await fetch(endpoint, {
      method: 'POST', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', apikey: String(state.config?.supabasePublishableKey || '') },
      body: JSON.stringify({ ...payload, action, clientType: 'admin', idToken: state.idToken }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || data?.ok !== true) {
      const error = new Error(String(data?.error?.message || '預約資源設定失敗。'));
      error.code = String(data?.error?.code || 'API_ERROR');
      throw error;
    }
    return data.data || {};
  }

  async function refresh() {
    state.data = await request('admin.booking.resources.bootstrap');
    document.getElementById('maxPartySize').value = String(state.data.settings?.maxPartySize || 1);
    renderPrimaryOptions();
    renderTechnicians();
  }

  function renderPrimaryOptions() {
    const select = document.getElementById('primaryTechnician');
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
    if (state.saving) return;
    const value = Number(document.getElementById('maxPartySize').value);
    const primaryTechnicianId = String(document.getElementById('primaryTechnician').value || '');
    const hasActive = (state.data?.technicians || []).some((item) => item.isActive);
    if (!Number.isInteger(value) || value < 1 || value > 10) return showMessage('預約人數上限必須介於 1–10 人。', 'error');
    if (hasActive && !primaryTechnicianId) return showMessage('請選擇主要技師。', 'error');
    const button = document.getElementById('savePartySizeButton');
    state.saving = true; button.disabled = true; button.textContent = '儲存中…';
    try {
      const result = await request('admin.booking.resources.settings.save', {
        maxPartySize: value,
        primaryTechnicianId,
        expectedUpdatedAt: state.data?.settings?.updatedAt,
      });
      state.data.settings = result.settings;
      renderPrimaryOptions();
      renderTechnicians();
      const primary = (state.data.technicians || []).find((item) => item.technicianId === result.settings?.primaryTechnicianId);
      showMessage(primary ? `預約設定已儲存；主要技師為 ${primary.name}。` : '預約設定已儲存；尚未設定主要技師。', primary ? 'success' : 'error');
    } catch (error) {
      showMessage(error?.message || '預約設定儲存失敗。', 'error');
      if (error?.code === 'CONFLICT') await refresh();
    } finally {
      state.saving = false; button.disabled = false; button.textContent = '儲存預約設定';
    }
  }

  async function saveTechnician(event) {
    event.preventDefault();
    if (state.saving) return;
    const name = String(document.getElementById('technicianName').value || '').trim();
    if (!name) return showMessage('請輸入技師名稱。', 'error');
    const button = document.getElementById('saveTechnicianButton');
    state.saving = true; button.disabled = true; button.textContent = '儲存中…';
    try {
      const result = await request('admin.booking.resources.technician.save', {
        technicianId: document.getElementById('technicianId').value || undefined,
        expectedUpdatedAt: document.getElementById('technicianExpectedUpdatedAt').value || undefined,
        name,
        sortOrder: Number(document.getElementById('technicianSortOrder').value || 0),
        isActive: document.getElementById('technicianActive').checked,
      });
      const saved = result.technician;
      const index = (state.data.technicians || []).findIndex((item) => item.technicianId === saved.technicianId);
      if (index >= 0) state.data.technicians[index] = saved; else state.data.technicians.push(saved);
      state.data.technicians.sort(sortTechnicians);
      renderPrimaryOptions();
      renderTechnicians();
      editTechnician(saved);
      showMessage(!state.data.settings?.primaryTechnicianId && saved.isActive ? '技師已儲存。請再選擇主要技師並儲存預約設定。' : '技師設定已儲存。', !state.data.settings?.primaryTechnicianId && saved.isActive ? 'error' : 'success');
    } catch (error) {
      showMessage(error?.message || '技師設定儲存失敗。', 'error');
      if (error?.code === 'CONFLICT') await refresh();
    } finally {
      state.saving = false; button.disabled = false; button.textContent = document.getElementById('technicianId').value ? '儲存修改' : '儲存技師';
    }
  }

  function renderTechnicians() {
    const list = document.getElementById('technicianList');
    const rows = state.data?.technicians || [];
    const primaryId = String(state.data?.settings?.primaryTechnicianId || '');
    list.replaceChildren();
    document.getElementById('technicianCount').textContent = String(rows.length);
    document.getElementById('technicianEmpty').classList.toggle('hidden', rows.length > 0);
    rows.forEach((technician) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = `technician-row${technician.isActive ? '' : ' inactive'}`;
      const text = document.createElement('span');
      const name = document.createElement('strong');
      name.textContent = technician.name;
      const meta = document.createElement('small');
      const tags = [`排序 ${technician.sortOrder}`, technician.isActive ? '會員端可選' : '已停用'];
      if (technician.technicianId === primaryId) tags.push('主要技師');
      meta.textContent = tags.join(' · ');
      text.append(name, meta);
      const badge = document.createElement('span');
      badge.className = `service-status ${technician.isActive ? 'active' : 'inactive'}`;
      badge.textContent = technician.technicianId === primaryId ? '主要' : technician.isActive ? '開放' : '關閉';
      row.append(text, badge);
      row.addEventListener('click', () => editTechnician(technician));
      list.appendChild(row);
    });
  }

  function editTechnician(technician) {
    document.getElementById('technicianId').value = technician.technicianId;
    document.getElementById('technicianExpectedUpdatedAt').value = technician.updatedAt || '';
    document.getElementById('technicianName').value = technician.name || '';
    document.getElementById('technicianSortOrder').value = String(technician.sortOrder || 0);
    document.getElementById('technicianActive').checked = Boolean(technician.isActive);
    document.getElementById('technicianFormTitle').textContent = technician.technicianId === state.data?.settings?.primaryTechnicianId ? '編輯主要技師' : '編輯技師';
    document.getElementById('saveTechnicianButton').textContent = '儲存修改';
  }

  function resetTechnicianForm() {
    document.getElementById('technicianForm').reset();
    document.getElementById('technicianId').value = '';
    document.getElementById('technicianExpectedUpdatedAt').value = '';
    document.getElementById('technicianSortOrder').value = '0';
    document.getElementById('technicianActive').checked = true;
    document.getElementById('technicianFormTitle').textContent = '新增技師';
    document.getElementById('saveTechnicianButton').textContent = '儲存技師';
  }

  function sortTechnicians(a, b) {
    return (Number(a?.sortOrder) || 0) - (Number(b?.sortOrder) || 0) || String(a?.name || '').localeCompare(String(b?.name || ''), 'zh-Hant-TW');
  }

  function showMessage(message, type) {
    const el = document.getElementById('bookingResourceMessage');
    if (!el) return;
    el.textContent = message;
    el.className = `form-message ${type || ''}`;
  }
})();