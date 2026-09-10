(() => {
  'use strict';

  const MAX_BATCH_ITEMS = 20;
  const state = { config: null, items: [], selectedIds: new Set(), busy: false, mode: '' };

  window.addEventListener('DOMContentLoaded', mount);

  function mount() {
    const calendarCard = document.querySelector('.calendar-card');
    if (!calendarCard || document.getElementById('bulkActionsCard')) return;

    const card = el('section', { id: 'bulkActionsCard', className: 'bulk-actions-card', 'aria-labelledby': 'bulkActionsTitle' });
    const header = el('div', { className: 'bulk-actions-header' });
    const copy = el('div');
    copy.append(
      el('p', { className: 'eyebrow', text: 'Bulk actions' }),
      el('h2', { id: 'bulkActionsTitle', text: '批量管理' }),
      el('p', { className: 'bulk-actions-description', text: '一次處理最多 20 筆事項。移除採封存，不會硬刪資料。' })
    );
    const buttons = el('div', { className: 'bulk-actions-buttons' });
    buttons.append(
      button('批量新增', 'primary', () => {}),
      button('批量修改', 'ghost', () => openModal('update')),
      button('批量移除', 'danger', () => openModal('archive'))
    );
    header.append(copy, buttons);
    card.append(header, el('p', { id: 'bulkActionsStatus', className: 'bulk-actions-status', 'aria-live': 'polite', text: '可批量新增、修改或移除日曆事項。' }));
    calendarCard.insertAdjacentElement('afterend', card);
    document.body.appendChild(buildModal());

    window.CalendarSystemAdminTransport = Object.freeze({ api, loadConfig });
  }

  function buildModal() {
    const modal = el('div', { id: 'bulkActionsModal', className: 'bulk-modal hidden', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'bulkModalTitle' });
    const card = el('div', { className: 'bulk-modal-card' });
    const header = el('div', { className: 'bulk-modal-header' });
    const copy = el('div');
    copy.append(el('p', { className: 'eyebrow', text: 'Bulk editor' }), el('h2', { id: 'bulkModalTitle', text: '批量管理' }));
    const close = button('×', 'icon-button compact', closeModal);
    close.setAttribute('aria-label', '關閉');
    header.append(copy, close);
    card.append(header, el('div', { id: 'bulkModalContent', className: 'bulk-modal-content' }), el('div', { id: 'bulkModalMessage', className: 'form-message hidden', role: 'alert' }));
    modal.appendChild(card);
    modal.addEventListener('click', (event) => { if (event.target === modal && !state.busy) closeModal(); });
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !modal.classList.contains('hidden') && !state.busy) closeModal(); });
    return modal;
  }

  async function openModal(mode) {
    if (state.busy) return;
    state.mode = mode;
    state.selectedIds.clear();
    clearMessage();
    const modal = document.getElementById('bulkActionsModal');
    const content = document.getElementById('bulkModalContent');
    const title = document.getElementById('bulkModalTitle');
    title.textContent = mode === 'update' ? '批量修改事項' : '批量移除事項';
    content.replaceChildren(el('div', { className: 'bulk-loading', text: '載入中…' }));
    modal.classList.remove('hidden');
    document.body.classList.add('modal-open');
    try {
      const result = await api('admin.calendar.list');
      state.items = Array.isArray(result.items) ? result.items : [];
      renderSelection(content, mode);
    } catch (error) {
      content.replaceChildren();
      showMessage(error.message || '載入失敗。');
    }
  }

  function closeModal() {
    const modal = document.getElementById('bulkActionsModal');
    if (modal) modal.classList.add('hidden');
    document.body.classList.remove('modal-open');
    state.selectedIds.clear();
    state.mode = '';
    clearMessage();
  }

  function renderSelection(content, mode) {
    const items = state.items.filter((item) => item && item.status !== 'archived')
      .sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)) || String(a.title).localeCompare(String(b.title), 'zh-Hant'));
    if (!items.length) {
      content.replaceChildren(el('div', { className: 'empty-state', text: '目前沒有可操作的事項。' }));
      return;
    }

    const wrap = el('div', { className: 'bulk-selection-layout' });
    const toolbar = el('div', { className: 'bulk-selection-toolbar' });
    const search = el('input', { type: 'search', placeholder: '搜尋標題、日期或類型', 'aria-label': '搜尋事項' });
    const count = el('span', { className: 'badge', text: '已選 0' });
    toolbar.append(search, count);
    const list = el('div', { className: 'bulk-item-list' });
    const rows = items.map((item) => buildRow(item, count));
    rows.forEach((row) => list.appendChild(row.element));
    search.addEventListener('input', () => {
      const q = search.value.trim().toLowerCase();
      rows.forEach((row) => row.element.classList.toggle('hidden', Boolean(q) && !row.searchText.includes(q)));
    });

    const mini = el('div', { className: 'bulk-mini-actions' });
    mini.append(
      button('選取可見', 'ghost', () => {
        rows.forEach((row) => {
          if (!row.element.classList.contains('hidden')) {
            row.checkbox.checked = true;
            state.selectedIds.add(row.item.itemId);
          }
        });
        updateCount(count);
      }),
      button('清除選取', 'ghost', () => {
        rows.forEach((row) => { row.checkbox.checked = false; });
        state.selectedIds.clear();
        updateCount(count);
      })
    );

    wrap.append(toolbar, mini, list, mode === 'update' ? buildUpdatePanel(count) : buildArchivePanel(count));
    content.replaceChildren(wrap);
  }

  function buildRow(item, count) {
    const row = el('label', { className: 'bulk-item-row' });
    const checkbox = el('input', { type: 'checkbox', value: item.itemId });
    const marker = el('span', { className: 'bulk-item-marker' });
    marker.style.backgroundColor = normalizeColor(item.color);
    const copy = el('span', { className: 'bulk-item-copy' });
    copy.append(
      el('strong', { text: item.title || '未命名事項' }),
      el('small', { text: `${item.startDate}${item.endDate !== item.startDate ? ` ~ ${item.endDate}` : ''} · ${typeLabel(item.type)} · ${statusLabel(item.status)}` })
    );
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) state.selectedIds.add(item.itemId);
      else state.selectedIds.delete(item.itemId);
      updateCount(count);
    });
    row.append(checkbox, marker, copy);
    return { element: row, checkbox, item, searchText: `${item.title} ${item.startDate} ${item.endDate} ${item.type} ${item.status}`.toLowerCase() };
  }

  function buildUpdatePanel(count) {
    const section = el('section', { className: 'bulk-update-section' });
    section.append(el('h3', { text: '套用共同修改' }), el('p', { className: 'bulk-hint', text: '只會修改你啟用的欄位，其餘資料保持原值。' }));
    const status = select([['', '狀態不變'], ['published', '已發布'], ['draft', '草稿']]);
    const type = select([['', '類型不變'], ['holiday', '休假日'], ['event', '活動'], ['notice', '公告']]);
    const title = optionalField('標題', 'text', 80);
    const location = optionalField('地點', 'text', 120);
    const description = optionalField('說明', 'textarea', 1000);
    const color = optionalField('顏色', 'color', 7);
    const grid = el('div', { className: 'bulk-form-grid' });
    grid.append(status.wrap, type.wrap, title.wrap, location.wrap, color.wrap, description.wrap);
    const submit = button('套用批量修改', 'primary', async () => {
      if (state.busy) return;
      try {
        clearMessage();
        const selected = selectedItems();
        validateSelection(selected);
        const hasChanges = Boolean(status.input.value || type.input.value || title.toggle.checked || location.toggle.checked || description.toggle.checked || color.toggle.checked);
        if (!hasChanges) throw new Error('請至少設定一個要修改的欄位。');
        if (title.toggle.checked && !title.input.value.trim()) throw new Error('啟用標題修改時，標題不得為空白。');
        const updates = selected.map((item) => ({
          item: {
            ...item,
            status: status.input.value || item.status,
            type: type.input.value || item.type,
            title: title.toggle.checked ? title.input.value.trim() : item.title,
            location: location.toggle.checked ? location.input.value.trim() : item.location,
            description: description.toggle.checked ? description.input.value.trim() : item.description,
            color: color.toggle.checked ? normalizeColor(color.input.value) : item.color
          },
          expectedUpdatedAt: item.updatedAt
        }));
        setBusy(true, submit, '修改中…');
        const result = await api('admin.calendar.bulkUpdate', { updates });
        complete(`已修改 ${Number(result.count || updates.length)} 筆事項。`);
      } catch (error) {
        showMessage(error.code === 'CONFLICT' ? '部分資料已被其他管理者更新，請重新開啟後再確認。' : (error.message || '批量修改失敗。'));
      } finally {
        setBusy(false, submit, '套用批量修改');
        updateCount(count);
      }
    });
    section.append(grid, el('div', { className: 'bulk-form-actions' }, submit));
    return section;
  }

  function buildArchivePanel(count) {
    const section = el('section', { className: 'bulk-archive-section' });
    section.append(el('h3', { text: '批量移除（封存）' }), el('p', { className: 'bulk-hint', text: '封存後用戶端不會顯示，但資料與 Audit 紀錄會保留。' }));
    const submit = button('移除已選事項', 'danger', async () => {
      if (state.busy) return;
      try {
        clearMessage();
        const selected = selectedItems();
        validateSelection(selected);
        if (!window.confirm(`確定要移除（封存）已選的 ${selected.length} 筆事項嗎？`)) return;
        const items = selected.map((item) => ({ itemId: item.itemId, expectedUpdatedAt: item.updatedAt }));
        setBusy(true, submit, '移除中…');
        const result = await api('admin.calendar.bulkArchive', { items });
        complete(`已移除 ${Number(result.count || items.length)} 筆事項。`);
      } catch (error) {
        showMessage(error.code === 'CONFLICT' ? '部分資料已被其他管理者更新，請重新開啟後再確認。' : (error.message || '批量移除失敗。'));
      } finally {
        setBusy(false, submit, '移除已選事項');
        updateCount(count);
      }
    });
    section.append(el('div', { className: 'bulk-form-actions' }, submit));
    return section;
  }

  function validateSelection(items) {
    if (!items.length) throw new Error('請先選擇至少 1 筆事項。');
    if (items.length > MAX_BATCH_ITEMS) throw new Error(`單次最多選擇 ${MAX_BATCH_ITEMS} 筆。`);
  }

  function selectedItems() {
    return state.items.filter((item) => item && item.status !== 'archived' && state.selectedIds.has(item.itemId));
  }

  function updateCount(target) { target.textContent = `已選 ${state.selectedIds.size}`; }

  async function api(action, payload = {}) {
    if (!state.config) state.config = await loadConfig();
    if (!window.liff || !window.liff.isLoggedIn()) throw clientError('AUTH_REQUIRED', '管理端登入已失效，請重新整理後登入。');
    const idToken = window.liff.getIDToken() || '';
    if (!idToken) throw clientError('AUTH_REQUIRED', '無法取得 LINE ID token。');
    let response;
    try {
      response = await fetch(state.config.supabaseFunctionUrl, {
        method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, cache: 'no-store',
        body: JSON.stringify({ action, clientType: 'admin', idToken, ...payload })
      });
    } catch (_) {
      throw clientError('NETWORK_ERROR', '無法連線 Supabase 日曆服務。');
    }
    let data;
    try { data = await response.json(); }
    catch (_) { throw clientError('API_RESPONSE_ERROR', 'Supabase 日曆服務回傳格式錯誤。'); }
    if (!data || data.ok !== true) {
      const error = clientError(data?.error?.code || 'API_ERROR', rateLimitMessage(data?.error?.code, data?.error?.message || '後端拒絕此請求。', data?.error?.details));
      error.details = data?.error?.details || null;
      throw error;
    }
    return data.data || {};
  }

  async function loadConfig() {
    const response = await fetch('../config.json', { cache: 'no-store' });
    if (!response.ok) throw clientError('CONFIG_ERROR', '讀取 config.json 失敗。');
    const config = await response.json();
    if (!/^https:\/\/[a-z0-9]+\.supabase\.co\/functions\/v1\/[a-z0-9-]+$/i.test(String(config.supabaseFunctionUrl || ''))) {
      throw clientError('CONFIG_ERROR', 'Supabase Edge Function URL 設定不合法。');
    }
    return config;
  }

  function complete(message) {
    const status = document.getElementById('bulkActionsStatus');
    if (status) status.textContent = message;
    closeModal();
    const refresh = document.getElementById('refreshButton');
    if (refresh && !refresh.disabled) refresh.click();
  }

  function setBusy(busy, target, label) {
    state.busy = busy;
    if (!target) return;
    target.disabled = busy;
    target.textContent = busy ? label : (target.dataset.label || target.textContent);
  }

  function button(text, style, handler) {
    const className = style.includes('button') ? style : `button ${style}`;
    const target = el('button', { type: 'button', className, text });
    target.dataset.label = text;
    target.addEventListener('click', handler);
    return target;
  }

  function select(options) {
    const wrap = el('label');
    const input = el('select');
    options.forEach(([value, label]) => input.appendChild(el('option', { value, text: label })));
    wrap.appendChild(input);
    return { wrap, input };
  }

  function optionalField(label, kind, maxLength) {
    const wrap = el('label', { className: `bulk-optional-field${kind === 'textarea' ? ' span-2' : ''}` });
    const head = el('span', { className: 'bulk-optional-header' });
    const toggle = el('input', { type: 'checkbox', 'aria-label': `啟用${label}修改` });
    head.append(toggle, el('span', { text: label }));
    const input = kind === 'textarea' ? el('textarea', { rows: 3, disabled: true }) : el('input', { type: kind, disabled: true });
    if (maxLength) input.maxLength = maxLength;
    if (kind === 'color') input.value = '#3182B8';
    toggle.addEventListener('change', () => { input.disabled = !toggle.checked; });
    wrap.append(head, input);
    return { wrap, toggle, input };
  }

  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    Object.entries(props).forEach(([key, value]) => {
      if (key === 'className') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'disabled') node.disabled = Boolean(value);
      else if (key === 'rows') node.rows = value;
      else if (key in node && !key.startsWith('aria-')) node[key] = value;
      else node.setAttribute(key, String(value));
    });
    children.flat().forEach((child) => { if (child) node.appendChild(child); });
    return node;
  }

  function normalizeColor(value) {
    const color = String(value || '').trim().toUpperCase();
    return /^#[0-9A-F]{6}$/.test(color) ? color : '#3182B8';
  }
  function typeLabel(value) { return ({ holiday: '休假日', event: '活動', notice: '公告' })[value] || '事項'; }
  function statusLabel(value) { return ({ published: '已發布', draft: '草稿', archived: '已封存' })[value] || value || ''; }
  function showMessage(message) { const box = document.getElementById('bulkModalMessage'); if (box) { box.textContent = message; box.classList.remove('hidden'); } }
  function clearMessage() { const box = document.getElementById('bulkModalMessage'); if (box) { box.textContent = ''; box.classList.add('hidden'); } }
  function clientError(code, message) { const error = new Error(message); error.code = code; return error; }
  function rateLimitMessage(code, message, details) {
    if (code !== 'RATE_LIMITED' && code !== 'RATE_LIMIT_BUSY') return message;
    const seconds = Number(details?.retryAfterSeconds);
    return Number.isInteger(seconds) && seconds > 0 ? `${message} 約 ${seconds} 秒後可再試。` : message;
  }
})();
