(() => {
  'use strict';

  const MAX_BATCH_ITEMS = 20;
  const DEFAULT_COLORS = Object.freeze({ holiday: '#D95656', event: '#3182B8', notice: '#D3A12F' });
  const state = {
    config: null,
    items: [],
    selectedIds: new Set(),
    mode: '',
    busy: false
  };

  window.addEventListener('DOMContentLoaded', () => {
    mountBulkActions();
  });

  function mountBulkActions() {
    const calendarCard = document.querySelector('.calendar-card');
    if (!calendarCard || document.getElementById('bulkActionsCard')) return;

    const card = node('section', { id: 'bulkActionsCard', className: 'bulk-actions-card', 'aria-labelledby': 'bulkActionsTitle' });
    const heading = node('div', { className: 'bulk-actions-header' });
    const copy = node('div');
    copy.append(
      node('p', { className: 'eyebrow', textContent: 'Bulk actions' }),
      node('h2', { id: 'bulkActionsTitle', textContent: '批量管理' }),
      node('p', { className: 'bulk-actions-description', textContent: '一次處理最多 20 筆事項。移除採封存，不會硬刪資料。' })
    );

    const actions = node('div', { className: 'bulk-actions-buttons' });
    actions.append(
      actionButton('批量新增', 'primary', () => openBulkModal('create')),
      actionButton('批量修改', 'ghost', () => openBulkModal('update')),
      actionButton('批量移除', 'danger', () => openBulkModal('archive'))
    );
    heading.append(copy, actions);

    const status = node('p', { id: 'bulkActionsStatus', className: 'bulk-actions-status', 'aria-live': 'polite', textContent: '可批量新增、修改或移除日曆事項。' });
    card.append(heading, status);
    calendarCard.insertAdjacentElement('afterend', card);

    document.body.appendChild(buildBulkModal());
  }

  function buildBulkModal() {
    const modal = node('div', {
      id: 'bulkActionsModal',
      className: 'bulk-modal hidden',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': 'bulkModalTitle'
    });
    const card = node('div', { className: 'bulk-modal-card' });
    const header = node('div', { className: 'bulk-modal-header' });
    const copy = node('div');
    copy.append(node('p', { className: 'eyebrow', textContent: 'Bulk editor' }), node('h2', { id: 'bulkModalTitle', textContent: '批量管理' }));
    const close = node('button', { type: 'button', className: 'icon-button compact', 'aria-label': '關閉', textContent: '×' });
    close.addEventListener('click', closeBulkModal);
    header.append(copy, close);

    const content = node('div', { id: 'bulkModalContent', className: 'bulk-modal-content' });
    const message = node('div', { id: 'bulkModalMessage', className: 'form-message hidden', role: 'alert' });
    card.append(header, content, message);
    modal.appendChild(card);

    modal.addEventListener('click', (event) => {
      if (event.target === modal && !state.busy) closeBulkModal();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !modal.classList.contains('hidden') && !state.busy) closeBulkModal();
    });
    return modal;
  }

  function actionButton(label, style, handler) {
    const button = node('button', { type: 'button', className: `button ${style}`, textContent: label });
    button.addEventListener('click', handler);
    return button;
  }

  async function openBulkModal(mode) {
    if (state.busy) return;
    state.mode = mode;
    state.selectedIds.clear();
    clearMessage();
    const modal = document.getElementById('bulkActionsModal');
    const content = document.getElementById('bulkModalContent');
    const title = document.getElementById('bulkModalTitle');
    content.replaceChildren(node('div', { className: 'bulk-loading', textContent: '載入中…' }));
    modal.classList.remove('hidden');
    document.body.classList.add('modal-open');

    try {
      if (mode === 'create') {
        title.textContent = '批量新增事項';
        renderBulkCreate(content);
      } else {
        title.textContent = mode === 'update' ? '批量修改事項' : '批量移除事項';
        await loadItems();
        renderSelectionMode(content, mode);
      }
    } catch (error) {
      showMessage(error && error.message ? error.message : '載入失敗。');
      content.replaceChildren();
    }
  }

  function closeBulkModal() {
    const modal = document.getElementById('bulkActionsModal');
    if (!modal) return;
    modal.classList.add('hidden');
    document.body.classList.remove('modal-open');
    state.selectedIds.clear();
    state.mode = '';
    clearMessage();
  }

  function renderBulkCreate(content) {
    const form = node('form', { className: 'bulk-form', noValidate: true });
    const grid = node('div', { className: 'bulk-form-grid' });

    const dates = textareaField('日期／日期區間', 'bulkCreateDates', '每行一筆：2026-09-01\n多日可用：2026-09-10~2026-09-12', 6);
    dates.wrapper.classList.add('span-2');
    const type = selectField('類型', 'bulkCreateType', [
      ['holiday', '休假日'], ['event', '活動'], ['notice', '公告']
    ], 'event');
    const status = selectField('狀態', 'bulkCreateStatus', [['published', '已發布'], ['draft', '草稿']], 'published');
    const title = inputField('標題', 'bulkCreateTitle', 'text', '例如：會員日活動', 80);
    title.wrapper.classList.add('span-2');
    const color = inputField('顏色', 'bulkCreateColor', 'color');
    color.input.value = DEFAULT_COLORS.event;
    type.select.addEventListener('change', () => { color.input.value = DEFAULT_COLORS[type.select.value] || DEFAULT_COLORS.notice; });

    const allDayWrap = node('label', { className: 'bulk-check-field' });
    const allDay = node('input', { id: 'bulkCreateAllDay', type: 'checkbox', checked: true });
    allDayWrap.append(allDay, node('span', { textContent: '全天' }));
    const startTime = inputField('開始時間', 'bulkCreateStartTime', 'time');
    const endTime = inputField('結束時間', 'bulkCreateEndTime', 'time');
    startTime.wrapper.classList.add('hidden');
    endTime.wrapper.classList.add('hidden');
    allDay.addEventListener('change', () => {
      startTime.wrapper.classList.toggle('hidden', allDay.checked);
      endTime.wrapper.classList.toggle('hidden', allDay.checked);
    });

    const location = inputField('地點', 'bulkCreateLocation', 'text', '選填', 120);
    location.wrapper.classList.add('span-2');
    const description = textareaField('說明', 'bulkCreateDescription', '選填', 4, 1000);
    description.wrapper.classList.add('span-2');

    grid.append(
      dates.wrapper, type.wrapper, status.wrapper, title.wrapper, color.wrapper, allDayWrap,
      startTime.wrapper, endTime.wrapper, location.wrapper, description.wrapper
    );

    const hint = node('p', { className: 'bulk-hint', textContent: `單次最多 ${MAX_BATCH_ITEMS} 筆。每一行日期會建立一個獨立事項。` });
    const submit = actionButton('批量新增', 'primary', () => {});
    submit.type = 'submit';
    const footer = node('div', { className: 'bulk-form-actions' });
    footer.append(submit);
    form.append(grid, hint, footer);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (state.busy) return;
      clearMessage();
      try {
        const ranges = parseDateRanges(dates.textarea.value);
        const itemBase = {
          type: type.select.value,
          status: status.select.value,
          title: title.input.value.trim(),
          color: normalizeColor(color.input.value, type.select.value),
          allDay: allDay.checked,
          startTime: allDay.checked ? '' : startTime.input.value,
          endTime: allDay.checked ? '' : endTime.input.value,
          location: location.input.value.trim(),
          description: description.textarea.value.trim()
        };
        if (!itemBase.title) throw new Error('請輸入標題。');
        if (!itemBase.allDay && (!itemBase.startTime || !itemBase.endTime)) throw new Error('非全天事項需要開始與結束時間。');
        const items = ranges.map((range) => ({ ...itemBase, startDate: range.startDate, endDate: range.endDate }));
        setBusy(true, submit, '新增中…');
        const result = await api('admin.calendar.bulkCreate', { items });
        completeBulkAction(`已新增 ${Number(result.count || items.length)} 筆事項。`);
      } catch (error) {
        showMessage(error && error.message ? error.message : '批量新增失敗。');
      } finally {
        setBusy(false, submit, '批量新增');
      }
    });

    content.replaceChildren(form);
    window.setTimeout(() => dates.textarea.focus(), 0);
  }

  function renderSelectionMode(content, mode) {
    const activeItems = state.items
      .filter((item) => item && item.status !== 'archived')
      .sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)) || String(a.title).localeCompare(String(b.title), 'zh-Hant'));

    if (!activeItems.length) {
      content.replaceChildren(node('div', { className: 'empty-state', textContent: '目前沒有可操作的事項。' }));
      return;
    }

    const wrapper = node('div', { className: 'bulk-selection-layout' });
    const toolbar = node('div', { className: 'bulk-selection-toolbar' });
    const search = node('input', { type: 'search', placeholder: '搜尋標題、日期或類型', 'aria-label': '搜尋事項' });
    const selectedCount = node('span', { className: 'badge', textContent: '已選 0' });
    toolbar.append(search, selectedCount);

    const list = node('div', { className: 'bulk-item-list' });
    const rows = activeItems.map((item) => createSelectableItem(item, selectedCount));
    rows.forEach((row) => list.appendChild(row.element));
    search.addEventListener('input', () => {
      const query = search.value.trim().toLowerCase();
      rows.forEach((row) => {
        row.element.classList.toggle('hidden', Boolean(query) && !row.searchText.includes(query));
      });
    });

    const selectActions = node('div', { className: 'bulk-mini-actions' });
    const selectVisible = actionButton('選取可見', 'ghost', () => {
      rows.forEach((row) => {
        if (!row.element.classList.contains('hidden')) {
          row.checkbox.checked = true;
          state.selectedIds.add(row.item.itemId);
        }
      });
      updateSelectedCount(selectedCount);
    });
    const clear = actionButton('清除選取', 'ghost', () => {
      rows.forEach((row) => { row.checkbox.checked = false; });
      state.selectedIds.clear();
      updateSelectedCount(selectedCount);
    });
    selectActions.append(selectVisible, clear);

    wrapper.append(toolbar, selectActions, list);
    if (mode === 'update') wrapper.appendChild(buildBulkUpdateForm(selectedCount));
    else wrapper.appendChild(buildBulkArchiveActions(selectedCount));
    content.replaceChildren(wrapper);
  }

  function createSelectableItem(item, selectedCount) {
    const label = node('label', { className: 'bulk-item-row' });
    const checkbox = node('input', { type: 'checkbox', value: item.itemId });
    const marker = node('span', { className: 'bulk-item-marker' });
    marker.style.backgroundColor = normalizeColor(item.color, item.type);
    const copy = node('span', { className: 'bulk-item-copy' });
    copy.append(
      node('strong', { textContent: item.title || '未命名事項' }),
      node('small', { textContent: `${item.startDate}${item.endDate && item.endDate !== item.startDate ? ` ~ ${item.endDate}` : ''} · ${typeLabel(item.type)} · ${statusLabel(item.status)}` })
    );
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) state.selectedIds.add(item.itemId);
      else state.selectedIds.delete(item.itemId);
      updateSelectedCount(selectedCount);
    });
    label.append(checkbox, marker, copy);
    return {
      element: label,
      checkbox,
      item,
      searchText: `${item.title || ''} ${item.startDate || ''} ${item.endDate || ''} ${item.type || ''} ${item.status || ''}`.toLowerCase()
    };
  }

  function buildBulkUpdateForm(selectedCount) {
    const section = node('section', { className: 'bulk-update-section' });
    section.append(node('h3', { textContent: '套用共同修改' }), node('p', { className: 'bulk-hint', textContent: '只會修改你啟用的欄位，其餘資料保持原值。' }));
    const grid = node('div', { className: 'bulk-form-grid' });

    const status = selectField('狀態', 'bulkUpdateStatus', [['', '不變'], ['published', '已發布'], ['draft', '草稿']], '');
    const type = selectField('類型', 'bulkUpdateType', [['', '不變'], ['holiday', '休假日'], ['event', '活動'], ['notice', '公告']], '');
    const title = optionalTextField('標題', 'bulkUpdateTitle', 80);
    const location = optionalTextField('地點', 'bulkUpdateLocation', 120);
    const description = optionalTextareaField('說明', 'bulkUpdateDescription', 1000);
    const color = optionalColorField('顏色', 'bulkUpdateColor');

    grid.append(status.wrapper, type.wrapper, title.wrapper, location.wrapper, color.wrapper, description.wrapper);
    const submit = actionButton('套用批量修改', 'primary', () => {});
    submit.type = 'button';
    submit.addEventListener('click', async () => {
      if (state.busy) return;
      clearMessage();
      try {
        const selected = selectedItems();
        if (!selected.length) throw new Error('請先選擇至少 1 筆事項。');
        if (selected.length > MAX_BATCH_ITEMS) throw new Error(`單次最多選擇 ${MAX_BATCH_ITEMS} 筆。`);
        const patch = readBulkPatch({ status, type, title, location, description, color });
        if (!patch.hasChanges) throw new Error('請至少設定一個要修改的欄位。');

        const updates = selected.map((item) => {
          const next = { ...item };
          if (patch.status) next.status = patch.status;
          if (patch.type) next.type = patch.type;
          if (patch.titleEnabled) next.title = patch.title;
          if (patch.locationEnabled) next.location = patch.location;
          if (patch.descriptionEnabled) next.description = patch.description;
          if (patch.colorEnabled) next.color = patch.color;
          return { item: next, expectedUpdatedAt: item.updatedAt };
        });
        setBusy(true, submit, '修改中…');
        const result = await api('admin.calendar.bulkUpdate', { updates });
        completeBulkAction(`已修改 ${Number(result.count || updates.length)} 筆事項。`);
      } catch (error) {
        if (error && error.code === 'CONFLICT') {
          state.items = [];
          showMessage('部分資料已被其他管理者更新，請重新開啟批量修改後再確認。');
        } else {
          showMessage(error && error.message ? error.message : '批量修改失敗。');
        }
      } finally {
        setBusy(false, submit, '套用批量修改');
        updateSelectedCount(selectedCount);
      }
    });
    const footer = node('div', { className: 'bulk-form-actions' });
    footer.appendChild(submit);
    section.append(grid, footer);
    return section;
  }

  function buildBulkArchiveActions(selectedCount) {
    const section = node('section', { className: 'bulk-archive-section' });
    section.append(
      node('h3', { textContent: '批量移除（封存）' }),
      node('p', { className: 'bulk-hint', textContent: '封存後用戶端不會顯示，但資料與 Audit 紀錄會保留。' })
    );
    const submit = actionButton('移除已選事項', 'danger', () => {});
    submit.addEventListener('click', async () => {
      if (state.busy) return;
      clearMessage();
      try {
        const selected = selectedItems();
        if (!selected.length) throw new Error('請先選擇至少 1 筆事項。');
        if (selected.length > MAX_BATCH_ITEMS) throw new Error(`單次最多選擇 ${MAX_BATCH_ITEMS} 筆。`);
        if (!window.confirm(`確定要移除（封存）已選的 ${selected.length} 筆事項嗎？`)) return;
        const items = selected.map((item) => ({ itemId: item.itemId, expectedUpdatedAt: item.updatedAt }));
        setBusy(true, submit, '移除中…');
        const result = await api('admin.calendar.bulkArchive', { items });
        completeBulkAction(`已移除 ${Number(result.count || items.length)} 筆事項。`);
      } catch (error) {
        if (error && error.code === 'CONFLICT') {
          state.items = [];
          showMessage('部分資料已被其他管理者更新，請重新開啟批量移除後再確認。');
        } else {
          showMessage(error && error.message ? error.message : '批量移除失敗。');
        }
      } finally {
        setBusy(false, submit, '移除已選事項');
        updateSelectedCount(selectedCount);
      }
    });
    const footer = node('div', { className: 'bulk-form-actions' });
    footer.appendChild(submit);
    section.appendChild(footer);
    return section;
  }

  function readBulkPatch(fields) {
    const titleEnabled = fields.title.toggle.checked;
    const locationEnabled = fields.location.toggle.checked;
    const descriptionEnabled = fields.description.toggle.checked;
    const colorEnabled = fields.color.toggle.checked;
    const title = fields.title.input.value.trim();
    if (titleEnabled && !title) throw new Error('啟用標題修改時，標題不得為空白。');
    return {
      status: fields.status.select.value,
      type: fields.type.select.value,
      titleEnabled,
      title,
      locationEnabled,
      location: fields.location.input.value.trim(),
      descriptionEnabled,
      description: fields.description.textarea.value.trim(),
      colorEnabled,
      color: normalizeColor(fields.color.input.value, 'event'),
      hasChanges: Boolean(fields.status.select.value || fields.type.select.value || titleEnabled || locationEnabled || descriptionEnabled || colorEnabled)
    };
  }

  function selectedItems() {
    const selected = state.selectedIds;
    return state.items.filter((item) => item && selected.has(item.itemId) && item.status !== 'archived');
  }

  function updateSelectedCount(target) {
    target.textContent = `已選 ${state.selectedIds.size}`;
  }

  async function loadItems() {
    const result = await api('admin.calendar.list');
    state.items = Array.isArray(result.items) ? result.items : [];
  }

  async function api(action, payload = {}) {
    if (!state.config) state.config = await loadConfig();
    if (!window.liff || !window.liff.isLoggedIn()) throw clientError('AUTH_REQUIRED', '管理端登入已失效，請重新整理後登入。');
    const idToken = window.liff.getIDToken() || '';
    if (!idToken) throw clientError('AUTH_REQUIRED', '無法取得 LINE ID token。');

    let response;
    try {
      response = await fetch(state.config.gasWebAppUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        cache: 'no-store',
        redirect: 'follow',
        body: JSON.stringify({ action, clientType: 'admin', idToken, ...payload })
      });
    } catch (_) {
      throw clientError('NETWORK_ERROR', '無法連線 GAS 後端。');
    }

    let data;
    try {
      data = await response.json();
    } catch (_) {
      throw clientError('API_RESPONSE_ERROR', 'GAS 回傳格式錯誤。');
    }
    if (!data || data.ok !== true) {
      const code = data && data.error && data.error.code || 'API_ERROR';
      const details = data && data.error && data.error.details || null;
      const error = clientError(code, rateLimitMessage(code, data && data.error && data.error.message || '後端拒絕此請求。', details));
      error.details = details;
      throw error;
    }
    return data.data || {};
  }

  async function loadConfig() {
    const response = await fetch('../config.json', { cache: 'no-store' });
    if (!response.ok) throw clientError('CONFIG_ERROR', '讀取 config.json 失敗。');
    const config = await response.json();
    const gasUrl = String(config && config.gasWebAppUrl || '').trim();
    if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(gasUrl)) {
      throw clientError('CONFIG_ERROR', 'GAS Web App URL 設定不合法。');
    }
    return config;
  }

  function completeBulkAction(message) {
    state.items = [];
    const status = document.getElementById('bulkActionsStatus');
    if (status) status.textContent = message;
    closeBulkModal();
    const refresh = document.getElementById('refreshButton');
    if (refresh && !refresh.disabled) refresh.click();
  }

  function parseDateRanges(raw) {
    const lines = String(raw || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (!lines.length) throw new Error('請至少輸入 1 筆日期。');
    if (lines.length > MAX_BATCH_ITEMS) throw new Error(`單次最多 ${MAX_BATCH_ITEMS} 筆。`);
    return lines.map((line, index) => {
      const parts = line.split('~').map((part) => part.trim());
      if (parts.length > 2 || !isDateKey(parts[0]) || (parts[1] && !isDateKey(parts[1]))) {
        throw new Error(`第 ${index + 1} 行日期格式不合法。`);
      }
      const startDate = parts[0];
      const endDate = parts[1] || startDate;
      if (endDate < startDate) throw new Error(`第 ${index + 1} 行結束日期不得早於開始日期。`);
      return { startDate, endDate };
    });
  }

  function isDateKey(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }

  function normalizeColor(value, type) {
    const color = String(value || '').trim().toUpperCase();
    return /^#[0-9A-F]{6}$/.test(color) ? color : (DEFAULT_COLORS[type] || DEFAULT_COLORS.notice);
  }

  function typeLabel(type) {
    return ({ holiday: '休假日', event: '活動', notice: '公告' })[type] || '事項';
  }

  function statusLabel(status) {
    return ({ published: '已發布', draft: '草稿', archived: '已封存' })[status] || status || '';
  }

  function setBusy(busy, button, busyLabel) {
    state.busy = busy;
    if (button) {
      if (!button.dataset.defaultLabel) button.dataset.defaultLabel = button.textContent;
      button.disabled = busy;
      button.textContent = busy ? busyLabel : button.dataset.defaultLabel;
    }
  }

  function showMessage(message) {
    const box = document.getElementById('bulkModalMessage');
    if (!box) return;
    box.textContent = message;
    box.classList.remove('hidden');
  }

  function clearMessage() {
    const box = document.getElementById('bulkModalMessage');
    if (!box) return;
    box.textContent = '';
    box.classList.add('hidden');
  }

  function inputField(labelText, id, type, placeholder = '', maxLength = 0) {
    const wrapper = node('label');
    wrapper.appendChild(node('span', { textContent: labelText }));
    const input = node('input', { id, type, placeholder });
    if (maxLength) input.maxLength = maxLength;
    wrapper.appendChild(input);
    return { wrapper, input };
  }

  function textareaField(labelText, id, placeholder = '', rows = 4, maxLength = 0) {
    const wrapper = node('label');
    wrapper.appendChild(node('span', { textContent: labelText }));
    const textarea = node('textarea', { id, placeholder, rows });
    if (maxLength) textarea.maxLength = maxLength;
    wrapper.appendChild(textarea);
    return { wrapper, textarea };
  }

  function selectField(labelText, id, options, value) {
    const wrapper = node('label');
    wrapper.appendChild(node('span', { textContent: labelText }));
    const select = node('select', { id });
    options.forEach(([optionValue, optionLabel]) => {
      select.appendChild(node('option', { value: optionValue, textContent: optionLabel }));
    });
    select.value = value;
    wrapper.appendChild(select);
    return { wrapper, select };
  }

  function optionalTextField(labelText, id, maxLength) {
    const wrapper = node('label', { className: 'bulk-optional-field' });
    const header = node('span', { className: 'bulk-optional-header' });
    const toggle = node('input', { type: 'checkbox', 'aria-label': `啟用${labelText}修改` });
    header.append(toggle, node('span', { textContent: labelText }));
    const input = node('input', { id, type: 'text', disabled: true });
    input.maxLength = maxLength;
    toggle.addEventListener('change', () => { input.disabled = !toggle.checked; if (toggle.checked) input.focus(); });
    wrapper.append(header, input);
    return { wrapper, toggle, input };
  }

  function optionalTextareaField(labelText, id, maxLength) {
    const wrapper = node('label', { className: 'bulk-optional-field span-2' });
    const header = node('span', { className: 'bulk-optional-header' });
    const toggle = node('input', { type: 'checkbox', 'aria-label': `啟用${labelText}修改` });
    header.append(toggle, node('span', { textContent: labelText }));
    const textarea = node('textarea', { id, rows: 3, disabled: true });
    textarea.maxLength = maxLength;
    toggle.addEventListener('change', () => { textarea.disabled = !toggle.checked; if (toggle.checked) textarea.focus(); });
    wrapper.append(header, textarea);
    return { wrapper, toggle, textarea };
  }

  function optionalColorField(labelText, id) {
    const wrapper = node('label', { className: 'bulk-optional-field' });
    const header = node('span', { className: 'bulk-optional-header' });
    const toggle = node('input', { type: 'checkbox', 'aria-label': `啟用${labelText}修改` });
    header.append(toggle, node('span', { textContent: labelText }));
    const input = node('input', { id, type: 'color', value: DEFAULT_COLORS.event, disabled: true });
    toggle.addEventListener('change', () => { input.disabled = !toggle.checked; });
    wrapper.append(header, input);
    return { wrapper, toggle, input };
  }

  function node(tagName, props = {}, ...children) {
    const element = document.createElement(tagName);
    Object.keys(props).forEach((key) => {
      const value = props[key];
      if (key === 'className') element.className = value;
      else if (key === 'textContent') element.textContent = value;
      else if (key === 'checked') element.checked = Boolean(value);
      else if (key === 'disabled') element.disabled = Boolean(value);
      else if (key === 'noValidate') element.noValidate = Boolean(value);
      else if (key === 'rows') element.rows = value;
      else if (key === 'value') element.value = value;
      else if (key in element && !key.startsWith('aria-')) element[key] = value;
      else element.setAttribute(key, String(value));
    });
    children.flat().forEach((child) => {
      if (child) element.appendChild(child);
    });
    return element;
  }

  function clientError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  function rateLimitMessage(code, message, details) {
    if (code !== 'RATE_LIMITED' && code !== 'RATE_LIMIT_BUSY') return message;
    const retryAfterSeconds = Number(details && details.retryAfterSeconds);
    return Number.isInteger(retryAfterSeconds) && retryAfterSeconds > 0
      ? `${message} 約 ${retryAfterSeconds} 秒後可再試。`
      : message;
  }
})();
