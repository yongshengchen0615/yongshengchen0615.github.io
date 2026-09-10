(() => {
  'use strict';

  const API_NAME = 'booking-admin-api';
  const state = { config: null, data: { serviceTypes: [], services: [] }, selected: new Set(), busy: false };
  const els = {};

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();

  function mount() {
    const retry = () => {
      if (!document.getElementById('bookingAdminSettingsForm') || !document.getElementById('bookingAdminServicesPanel')) {
        window.setTimeout(retry, 100);
        return;
      }
      setupTypeManager();
      setupServiceManager();
      setupModal();
      refresh();
    };
    retry();
  }

  function setupTypeManager() {
    const legacy = document.getElementById('bookingAdminServiceTypes');
    if (legacy) {
      legacy.closest('label')?.classList.add('hidden');
      els.legacyTypes = legacy;
    }
    const form = document.getElementById('bookingAdminSettingsForm');
    const message = document.getElementById('bookingAdminSettingsMessage');
    const section = document.createElement('section');
    section.className = 'booking-admin-type-manager';
    section.innerHTML = `
      <div class="booking-admin-section-heading">
        <div><strong>項目類型</strong><p>統一管理可供預約項目選擇的類型。</p></div>
        <button id="bookingCrudNewType" class="button button-outline" type="button">＋ 新增類型</button>
      </div>
      <div id="bookingCrudTypeList" class="booking-admin-service-list"></div>
      <div id="bookingCrudTypeEmpty" class="empty-state compact hidden"><span aria-hidden="true">○</span><p>尚未建立項目類型</p></div>`;
    form.insertBefore(section, message);
    els.typeList = section.querySelector('#bookingCrudTypeList');
    els.typeEmpty = section.querySelector('#bookingCrudTypeEmpty');
    section.querySelector('#bookingCrudNewType').addEventListener('click', () => openTypeModal());
  }

  function setupServiceManager() {
    const panel = document.getElementById('bookingAdminServicesPanel');
    document.getElementById('bookingAdminNewServiceButton')?.classList.add('hidden');
    document.getElementById('bookingAdminServiceList')?.classList.add('hidden');
    document.getElementById('bookingAdminServiceEmpty')?.classList.add('hidden');
    document.getElementById('bookingAdminServiceListCount')?.parentElement?.classList.add('hidden');

    const manager = document.createElement('div');
    manager.className = 'booking-admin-crud-manager';
    manager.innerHTML = `
      <div class="booking-admin-actions" style="justify-content:flex-start;margin:0 0 12px">
        <button id="bookingCrudNewService" class="button button-dark" type="button">＋ 新增項目</button>
        <button id="bookingCrudBatchAdd" class="button button-outline" type="button">批次新增</button>
        <button id="bookingCrudBatchEdit" class="button button-outline" type="button">批次修改</button>
        <button id="bookingCrudBatchDelete" class="button button-danger" type="button">批次刪除</button>
      </div>
      <div id="bookingCrudServiceMessage" class="form-message hidden" role="status"></div>
      <div id="bookingCrudServiceList" class="booking-admin-service-list"></div>
      <div id="bookingCrudServiceEmpty" class="empty-state compact hidden"><span aria-hidden="true">○</span><p>尚未建立預約項目</p></div>`;
    panel.appendChild(manager);
    els.serviceList = manager.querySelector('#bookingCrudServiceList');
    els.serviceEmpty = manager.querySelector('#bookingCrudServiceEmpty');
    els.serviceMessage = manager.querySelector('#bookingCrudServiceMessage');
    els.batchEdit = manager.querySelector('#bookingCrudBatchEdit');
    els.batchDelete = manager.querySelector('#bookingCrudBatchDelete');
    manager.querySelector('#bookingCrudNewService').addEventListener('click', () => openServiceModal());
    manager.querySelector('#bookingCrudBatchAdd').addEventListener('click', () => openBatchModal('create'));
    els.batchEdit.addEventListener('click', () => openBatchModal('update'));
    els.batchDelete.addEventListener('click', batchDelete);
  }

  function setupModal() {
    const modal = document.createElement('div');
    modal.id = 'bookingCrudModal';
    modal.className = 'booking-admin-modal hidden';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.innerHTML = `<div class="booking-admin-modal-card"><div class="booking-admin-modal-heading"><h2 id="bookingCrudModalTitle">管理</h2><button id="bookingCrudModalClose" class="booking-admin-modal-close" type="button" aria-label="關閉">×</button></div><div id="bookingCrudModalBody"></div></div>`;
    document.body.appendChild(modal);
    els.modal = modal;
    els.modalTitle = modal.querySelector('#bookingCrudModalTitle');
    els.modalBody = modal.querySelector('#bookingCrudModalBody');
    modal.querySelector('#bookingCrudModalClose').addEventListener('click', closeModal);
    modal.addEventListener('click', (event) => { if (event.target === modal && window.matchMedia('(max-width:768px)').matches) closeModal(); });
  }

  async function context() {
    if (!state.config) state.config = await window.MemberSystem.loadConfig();
    const idToken = String(window.liff?.getIDToken?.() || '');
    if (!idToken) throw new Error('管理端登入尚未完成。');
    return { config: state.config, idToken };
  }

  async function request(action, payload = {}) {
    const { config, idToken } = await context();
    const endpoint = `${String(config.supabaseUrl || '').replace(/\/$/, '')}/functions/v1/${API_NAME}`;
    const response = await fetch(endpoint, {
      method: 'POST', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', apikey: String(config.supabasePublishableKey || '') },
      body: JSON.stringify({ ...payload, action, clientType: 'admin', idToken }),
    });
    let data;
    try { data = await response.json(); } catch { throw new Error('預約管理服務回傳格式不正確。'); }
    if (!response.ok || data?.ok !== true) throw new Error(data?.error?.message || '預約管理操作失敗。');
    return data.data || {};
  }

  async function refresh() {
    try {
      const data = await request('admin.booking.manage.bootstrap');
      state.data.serviceTypes = Array.isArray(data.serviceTypes) ? data.serviceTypes : [];
      state.data.services = Array.isArray(data.services) ? data.services : [];
      state.selected = new Set([...state.selected].filter((id) => state.data.services.some((s) => s.serviceId === id)));
      syncLegacyTypes();
      renderTypes();
      renderServices();
      document.getElementById('bookingAdminServiceCount').textContent = String(state.data.services.length);
    } catch (error) {
      showMessage(els.serviceMessage, error.message || '資料載入失敗。', 'error');
    }
  }

  function syncLegacyTypes() {
    if (els.legacyTypes) els.legacyTypes.value = state.data.serviceTypes.map((t) => t.name).join('\n');
    const oldSelect = document.getElementById('bookingAdminServiceType');
    if (oldSelect) {
      const current = oldSelect.value;
      oldSelect.replaceChildren(new Option('請選擇項目類型', ''));
      state.data.serviceTypes.forEach((type) => oldSelect.appendChild(new Option(type.name, type.name)));
      oldSelect.value = current;
    }
  }

  function renderTypes() {
    els.typeList.replaceChildren();
    els.typeEmpty.classList.toggle('hidden', state.data.serviceTypes.length > 0);
    state.data.serviceTypes.forEach((type) => {
      const row = document.createElement('div');
      row.className = 'booking-admin-service-row';
      row.style.cursor = 'default';
      row.innerHTML = `<span><strong></strong><small>共用項目類型</small></span><span class="booking-admin-actions" style="margin:0"></span>`;
      row.querySelector('strong').textContent = type.name;
      const actions = row.querySelector('.booking-admin-actions');
      actions.append(button('修改', 'button button-outline', () => openTypeModal(type)), button('刪除', 'button button-danger', () => deleteType(type)));
      els.typeList.appendChild(row);
    });
  }

  function renderServices() {
    els.serviceList.replaceChildren();
    els.serviceEmpty.classList.toggle('hidden', state.data.services.length > 0);
    state.data.services.forEach((service) => {
      const row = document.createElement('div');
      row.className = `booking-admin-service-row${service.isActive ? '' : ' inactive'}`;
      row.style.cursor = 'default';
      const left = document.createElement('span');
      left.style.gridTemplateColumns = 'auto 1fr'; left.style.alignItems = 'start'; left.style.columnGap = '9px';
      const check = document.createElement('input');
      check.type = 'checkbox'; check.checked = state.selected.has(service.serviceId);
      check.style.width = '18px'; check.style.height = '18px'; check.style.marginTop = '2px';
      check.addEventListener('change', () => { check.checked ? state.selected.add(service.serviceId) : state.selected.delete(service.serviceId); updateBatchButtons(); });
      const text = document.createElement('span');
      const title = document.createElement('strong'); title.textContent = service.title;
      const meta = document.createElement('small'); meta.textContent = `類型 ${service.serviceType || '未設定'} · ${service.durationMinutes} 分鐘 · NT$${Number(service.priceAmount || 0).toLocaleString('zh-Hant-TW')} · ${service.isActive ? '開放' : '停用'}`;
      text.append(title, meta); left.append(check, text);
      const actions = document.createElement('span'); actions.className = 'booking-admin-actions'; actions.style.margin = '0';
      actions.append(button('修改', 'button button-outline', () => openServiceModal(service)), button('刪除', 'button button-danger', () => deleteService(service)));
      row.append(left, actions); els.serviceList.appendChild(row);
    });
    updateBatchButtons();
  }

  function updateBatchButtons() {
    const count = state.selected.size;
    els.batchEdit.disabled = count === 0;
    els.batchDelete.disabled = count === 0;
    els.batchEdit.textContent = count ? `批次修改（${count}）` : '批次修改';
    els.batchDelete.textContent = count ? `批次刪除（${count}）` : '批次刪除';
  }

  function openTypeModal(type = null) {
    els.modalTitle.textContent = type ? '修改項目類型' : '新增項目類型';
    els.modalBody.innerHTML = `<form class="booking-admin-form"><label>項目類型名稱<input id="bookingCrudTypeName" maxlength="80" required></label><div id="bookingCrudModalMessage" class="form-message hidden"></div><div class="booking-admin-modal-actions"><button class="button button-outline" type="button" data-cancel>取消</button><button class="button button-dark" type="submit">${type ? '儲存修改' : '新增類型'}</button></div></form>`;
    const input = els.modalBody.querySelector('#bookingCrudTypeName'); input.value = type?.name || '';
    els.modalBody.querySelector('[data-cancel]').addEventListener('click', closeModal);
    els.modalBody.querySelector('form').addEventListener('submit', async (event) => {
      event.preventDefault(); const name = input.value.trim(); if (!name) return;
      await runModalAction(async () => request(type ? 'admin.booking.type.update' : 'admin.booking.type.create', type ? { typeId: type.id, name } : { name }));
    });
    showModal(); input.focus();
  }

  async function deleteType(type) {
    if (!window.confirm(`確定刪除項目類型「${type.name}」？\n如果仍有預約項目使用，系統會拒絕刪除。`)) return;
    await runPageAction(async () => request('admin.booking.type.delete', { typeId: type.id }));
  }

  function serviceFields(service = {}) {
    const options = ['<option value="">請選擇項目類型</option>', ...state.data.serviceTypes.map((t) => `<option value="${escapeAttr(t.name)}">${escapeHtml(t.name)}</option>`)].join('');
    return `<label>預約項目名稱<input data-field="title" maxlength="100" required value="${escapeAttr(service.title || '')}"></label><label>項目類型<select data-field="serviceType" required>${options}</select></label><label>服務時間（分鐘）<input data-field="durationMinutes" type="number" min="1" max="720" step="1" required value="${Number(service.durationMinutes || 30)}"></label><label>價格（NT$）<input data-field="priceAmount" type="number" min="0" max="10000000" step="1" required value="${Number(service.priceAmount || 0)}"></label><label class="booking-admin-toggle"><input data-field="isActive" type="checkbox" ${service.isActive === false ? '' : 'checked'}><span><strong>開放會員預約</strong></span></label>`;
  }

  function openServiceModal(service = null) {
    if (!state.data.serviceTypes.length) { window.alert('請先新增至少一個「項目類型」。'); return; }
    els.modalTitle.textContent = service ? '修改預約項目' : '新增預約項目';
    els.modalBody.innerHTML = `<form class="booking-admin-form">${serviceFields(service || {})}<div id="bookingCrudModalMessage" class="form-message hidden"></div><div class="booking-admin-modal-actions"><button class="button button-outline" type="button" data-cancel>取消</button><button class="button button-dark" type="submit">儲存</button></div></form>`;
    const form = els.modalBody.querySelector('form'); form.querySelector('[data-field="serviceType"]').value = service?.serviceType || '';
    form.querySelector('[data-cancel]').addEventListener('click', closeModal);
    form.addEventListener('submit', async (event) => {
      event.preventDefault(); const payload = readServiceForm(form);
      if (service) { payload.serviceId = service.serviceId; payload.expectedUpdatedAt = service.updatedAt || ''; }
      await runModalAction(async () => request('admin.booking.service.save', payload));
    });
    showModal();
  }

  function readServiceForm(form) {
    return { title: form.querySelector('[data-field="title"]').value.trim(), serviceType: form.querySelector('[data-field="serviceType"]').value, durationMinutes: Number(form.querySelector('[data-field="durationMinutes"]').value), priceAmount: Number(form.querySelector('[data-field="priceAmount"]').value), isActive: form.querySelector('[data-field="isActive"]').checked };
  }

  async function deleteService(service) {
    if (!window.confirm(`確定刪除預約項目「${service.title}」？\n既有預約紀錄會保留。`)) return;
    await runPageAction(async () => request('admin.booking.service.delete', { serviceId: service.serviceId, expectedUpdatedAt: service.updatedAt || '' }));
  }

  function openBatchModal(mode) {
    if (!state.data.serviceTypes.length) { window.alert('請先新增至少一個「項目類型」。'); return; }
    const source = mode === 'update' ? state.data.services.filter((s) => state.selected.has(s.serviceId)) : [{}, {}];
    if (mode === 'update' && !source.length) return;
    els.modalTitle.textContent = mode === 'create' ? '批次新增預約項目' : `批次修改預約項目（${source.length}）`;
    els.modalBody.innerHTML = `<form class="booking-admin-form"><div id="bookingCrudBatchRows"></div>${mode === 'create' ? '<button id="bookingCrudAddBatchRow" class="button button-outline" type="button">＋ 新增一列</button>' : ''}<div id="bookingCrudModalMessage" class="form-message hidden"></div><div class="booking-admin-modal-actions"><button class="button button-outline" type="button" data-cancel>取消</button><button class="button button-dark" type="submit">套用批次操作</button></div></form>`;
    const rows = els.modalBody.querySelector('#bookingCrudBatchRows'); source.forEach((service) => appendBatchRow(rows, service, mode));
    els.modalBody.querySelector('#bookingCrudAddBatchRow')?.addEventListener('click', () => appendBatchRow(rows, {}, mode));
    els.modalBody.querySelector('[data-cancel]').addEventListener('click', closeModal);
    els.modalBody.querySelector('form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const operations = [...rows.querySelectorAll('[data-batch-row]')].map((row) => { const payload = readServiceForm(row); if (mode === 'update') { payload.serviceId = row.dataset.serviceId; payload.expectedUpdatedAt = row.dataset.updatedAt || ''; } return { op: mode, ...payload }; });
      if (!operations.length) return;
      await runModalAction(async () => request('admin.booking.services.batch', { operations }));
    });
    showModal();
  }

  function appendBatchRow(container, service, mode) {
    const row = document.createElement('div'); row.dataset.batchRow = '1'; row.dataset.serviceId = service.serviceId || ''; row.dataset.updatedAt = service.updatedAt || '';
    row.style.cssText = 'padding:12px 0;border-bottom:1px solid rgba(23,53,46,.1);display:grid;gap:10px'; row.innerHTML = serviceFields(service); row.querySelector('[data-field="serviceType"]').value = service.serviceType || '';
    if (mode === 'create') row.appendChild(button('移除此列', 'button button-outline', () => row.remove()));
    container.appendChild(row);
  }

  async function batchDelete() {
    const services = state.data.services.filter((s) => state.selected.has(s.serviceId));
    if (!services.length || !window.confirm(`確定批次刪除 ${services.length} 個預約項目？\n既有預約紀錄會保留。`)) return;
    const operations = services.map((s) => ({ op: 'delete', serviceId: s.serviceId, expectedUpdatedAt: s.updatedAt || '' }));
    await runPageAction(async () => request('admin.booking.services.batch', { operations }));
  }

  async function runModalAction(fn) {
    if (state.busy) return; state.busy = true; const message = els.modalBody.querySelector('#bookingCrudModalMessage');
    try { await fn(); els.modal.classList.add('hidden'); await refresh(); document.getElementById('bookingAdminRefreshButton')?.click(); }
    catch (error) { showMessage(message, error.message || '操作失敗。', 'error'); }
    finally { state.busy = false; }
  }

  async function runPageAction(fn) {
    if (state.busy) return; state.busy = true; clearMessage(els.serviceMessage);
    try { await fn(); state.selected.clear(); await refresh(); document.getElementById('bookingAdminRefreshButton')?.click(); }
    catch (error) { showMessage(els.serviceMessage, error.message || '操作失敗。', 'error'); }
    finally { state.busy = false; }
  }

  function button(text, className, handler) { const b = document.createElement('button'); b.type = 'button'; b.className = className; b.textContent = text; b.addEventListener('click', handler); return b; }
  function showModal() { els.modal.classList.remove('hidden'); }
  function closeModal() { if (!state.busy) els.modal.classList.add('hidden'); }
  function showMessage(el, text, type) { if (!el) return; el.textContent = text; el.className = `form-message ${type || ''}`; }
  function clearMessage(el) { if (!el) return; el.textContent = ''; el.className = 'form-message hidden'; }
  function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function escapeAttr(value) { return escapeHtml(value); }
})();
