(() => {
  'use strict';

  const MAX_BATCH_ITEMS = 20;
  const DEFAULT_COLORS = Object.freeze({ holiday: '#D95656', event: '#3182B8', notice: '#D3A12F' });
  const state = {
    config: null,
    ranges: [],
    busy: false
  };

  window.addEventListener('DOMContentLoaded', mountBulkCreateUx);

  function mountBulkCreateUx() {
    const original = document.querySelector('#bulkActionsCard .bulk-actions-buttons .button.primary');
    if (!original || document.getElementById('bulkCreateButton')) return;

    const button = original.cloneNode(true);
    button.id = 'bulkCreateButton';
    button.textContent = '批量新增';
    original.replaceWith(button);
    button.addEventListener('click', openBulkCreate);

    const modal = document.getElementById('bulkActionsModal');
    if (modal) {
      modal.addEventListener('click', (event) => {
        if (state.busy && event.target === modal) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      }, true);
    }
    document.addEventListener('keydown', (event) => {
      if (state.busy && event.key === 'Escape' && modal && !modal.classList.contains('hidden')) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }, true);
  }

  function openBulkCreate() {
    if (state.busy) return;
    const modal = document.getElementById('bulkActionsModal');
    const content = document.getElementById('bulkModalContent');
    const title = document.getElementById('bulkModalTitle');
    if (!modal || !content || !title) return;

    state.ranges = [];
    clearMessage();
    title.textContent = '批量新增事項';
    content.replaceChildren(buildCreateForm());
    modal.classList.remove('hidden');
    document.body.classList.add('modal-open');

    window.setTimeout(() => {
      const titleInput = document.getElementById('bulkUxTitle');
      if (titleInput) titleInput.focus();
    }, 0);
  }

  function buildCreateForm() {
    const form = node('form', { className: 'bulk-create-ux-form', noValidate: true });

    const contentSection = stepSection('1', '設定事項內容', '這些設定會套用到下方加入的每一筆日期。');
    const contentGrid = node('div', { className: 'bulk-form-grid' });

    const title = inputField('標題', 'bulkUxTitle', 'text', '例如：會員日活動', 80);
    title.wrapper.classList.add('span-2');
    const type = selectField('類型', 'bulkUxType', [
      ['holiday', '休假日'], ['event', '活動'], ['notice', '公告']
    ], 'event');
    const status = selectField('狀態', 'bulkUxStatus', [['published', '已發布'], ['draft', '草稿']], 'published');
    const color = inputField('顏色', 'bulkUxColor', 'color');
    color.input.value = DEFAULT_COLORS.event;
    type.select.addEventListener('change', () => {
      color.input.value = DEFAULT_COLORS[type.select.value] || DEFAULT_COLORS.notice;
    });

    const allDayWrap = node('label', { className: 'bulk-check-field bulk-create-all-day' });
    const allDay = node('input', { id: 'bulkUxAllDay', type: 'checkbox', checked: true });
    allDayWrap.append(allDay, node('span', { textContent: '全天' }));
    const startTime = inputField('開始時間', 'bulkUxStartTime', 'time');
    const endTime = inputField('結束時間', 'bulkUxEndTime', 'time');
    startTime.wrapper.classList.add('hidden');
    endTime.wrapper.classList.add('hidden');
    allDay.addEventListener('change', () => {
      startTime.wrapper.classList.toggle('hidden', allDay.checked);
      endTime.wrapper.classList.toggle('hidden', allDay.checked);
    });

    const location = inputField('地點', 'bulkUxLocation', 'text', '選填', 120);
    location.wrapper.classList.add('span-2');
    const description = textareaField('說明', 'bulkUxDescription', '選填', 3, 1000);
    description.wrapper.classList.add('span-2');
    contentGrid.append(
      title.wrapper, type.wrapper, status.wrapper, color.wrapper, allDayWrap,
      startTime.wrapper, endTime.wrapper, location.wrapper, description.wrapper
    );
    contentSection.appendChild(contentGrid);

    const dateSection = stepSection('2', '加入日期', '不用輸入任何特殊格式；選好日期後按「加入日期」。');
    const dateBuilder = node('div', { className: 'bulk-date-builder' });
    const today = localDateKey(new Date());
    const tomorrow = addDays(today, 1);
    const startDate = inputField('開始日期', 'bulkUxStartDate', 'date');
    const endDate = inputField('結束日期', 'bulkUxEndDate', 'date');
    startDate.input.min = today;
    endDate.input.min = today;
    startDate.input.value = today;
    endDate.input.value = today;

    startDate.input.addEventListener('change', () => {
      endDate.input.min = startDate.input.value || today;
      if (startDate.input.value && (!endDate.input.value || endDate.input.value < startDate.input.value)) {
        endDate.input.value = startDate.input.value;
      }
    });

    const quickActions = node('div', { className: 'bulk-date-quick-actions' });
    quickActions.append(
      smallButton('今天', () => setDateInputs(startDate.input, endDate.input, today)),
      smallButton('明天', () => setDateInputs(startDate.input, endDate.input, tomorrow))
    );

    const addButton = node('button', { type: 'button', className: 'button primary', textContent: '＋ 加入日期' });
    dateBuilder.append(startDate.wrapper, endDate.wrapper, quickActions, addButton);

    const listHeader = node('div', { className: 'bulk-date-list-header' });
    const count = node('strong', { id: 'bulkUxCount', textContent: `準備新增 0 / ${MAX_BATCH_ITEMS} 筆` });
    const clearButton = node('button', { type: 'button', className: 'link-button', textContent: '清除全部' });
    clearButton.disabled = true;
    listHeader.append(count, clearButton);

    const rangeList = node('div', { id: 'bulkUxRangeList', className: 'bulk-date-list', 'aria-live': 'polite' });
    const empty = node('div', { className: 'bulk-date-empty', textContent: '尚未加入日期。請先選擇上方日期。' });
    rangeList.appendChild(empty);

    const updateList = () => {
      renderRanges(rangeList, count, clearButton, updateSubmitState);
    };

    addButton.addEventListener('click', () => {
      clearMessage();
      try {
        addRange(startDate.input.value, endDate.input.value);
        updateList();
      } catch (error) {
        showMessage(error && error.message ? error.message : '無法加入日期。');
      }
    });
    clearButton.addEventListener('click', () => {
      state.ranges = [];
      updateList();
    });

    dateSection.append(dateBuilder, listHeader, rangeList);

    const confirmSection = stepSection('3', '確認並建立', '確認上方日期清單後，一次送出建立。');
    const summary = node('p', { id: 'bulkUxSummary', className: 'bulk-create-summary', textContent: '請先輸入標題並加入至少 1 筆日期。' });
    const submit = node('button', { id: 'bulkUxSubmit', type: 'submit', className: 'button primary bulk-create-submit', textContent: '建立事項', disabled: true });
    confirmSection.append(summary, submit);

    title.input.addEventListener('input', updateSubmitState);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (state.busy) return;
      clearMessage();
      try {
        const titleValue = title.input.value.trim();
        if (!titleValue) throw new Error('請輸入標題。');
        if (!state.ranges.length) throw new Error('請至少加入 1 筆日期。');
        if (!allDay.checked && (!startTime.input.value || !endTime.input.value)) {
          throw new Error('非全天事項需要開始與結束時間。');
        }

        const base = {
          type: type.select.value,
          status: status.select.value,
          title: titleValue,
          color: normalizeColor(color.input.value, type.select.value),
          allDay: allDay.checked,
          startTime: allDay.checked ? '' : startTime.input.value,
          endTime: allDay.checked ? '' : endTime.input.value,
          location: location.input.value.trim(),
          description: description.textarea.value.trim()
        };
        const items = state.ranges.map((range) => ({ ...base, startDate: range.startDate, endDate: range.endDate }));

        setBusy(true, submit, `建立 ${items.length} 筆中…`);
        const result = await api('admin.calendar.bulkCreate', { items });
        completeAction(`已新增 ${Number(result.count || items.length)} 筆事項。`);
      } catch (error) {
        showMessage(error && error.message ? error.message : '批量新增失敗。');
      } finally {
        setBusy(false, submit, submit.dataset.defaultLabel || '建立事項');
      }
    });

    function updateSubmitState() {
      const ready = Boolean(title.input.value.trim()) && state.ranges.length > 0 && !state.busy;
      submit.disabled = !ready;
      submit.textContent = state.ranges.length ? `建立 ${state.ranges.length} 筆事項` : '建立事項';
      summary.textContent = ready
        ? `將以「${title.input.value.trim()}」建立 ${state.ranges.length} 筆事項。`
        : '請先輸入標題並加入至少 1 筆日期。';
    }

    form.append(contentSection, dateSection, confirmSection);
    return form;
  }

  function addRange(startDate, endDate) {
    if (!isDateKey(startDate) || !isDateKey(endDate)) throw new Error('請選擇開始與結束日期。');
    const today = localDateKey(new Date());
    if (startDate < today || endDate < today) throw new Error('不可新增已經過去的日期。');
    if (endDate < startDate) throw new Error('結束日期不得早於開始日期。');
    if (state.ranges.length >= MAX_BATCH_ITEMS) throw new Error(`單次最多 ${MAX_BATCH_ITEMS} 筆。`);
    const duplicate = state.ranges.some((range) => range.startDate === startDate && range.endDate === endDate);
    if (duplicate) throw new Error('這個日期已經加入清單。');
    state.ranges.push({ startDate, endDate });
    state.ranges.sort((a, b) => a.startDate.localeCompare(b.startDate) || a.endDate.localeCompare(b.endDate));
  }

  function renderRanges(container, count, clearButton, onChange) {
    const fragment = document.createDocumentFragment();
    if (!state.ranges.length) {
      fragment.appendChild(node('div', { className: 'bulk-date-empty', textContent: '尚未加入日期。請先選擇上方日期。' }));
    } else {
      state.ranges.forEach((range, index) => {
        const row = node('div', { className: 'bulk-date-row' });
        const copy = node('div', { className: 'bulk-date-row-copy' });
        copy.append(
          node('strong', { textContent: range.startDate === range.endDate ? formatDate(range.startDate) : `${formatDate(range.startDate)} ～ ${formatDate(range.endDate)}` }),
          node('small', { textContent: range.startDate === range.endDate ? '單日事項' : '跨日事項' })
        );
        const remove = node('button', { type: 'button', className: 'button ghost compact-button', 'aria-label': `移除 ${formatDate(range.startDate)}`, textContent: '移除' });
        remove.addEventListener('click', () => {
          state.ranges.splice(index, 1);
          renderRanges(container, count, clearButton, onChange);
        });
        row.append(copy, remove);
        fragment.appendChild(row);
      });
    }
    container.replaceChildren(fragment);
    count.textContent = `準備新增 ${state.ranges.length} / ${MAX_BATCH_ITEMS} 筆`;
    clearButton.disabled = state.ranges.length === 0;
    if (typeof onChange === 'function') onChange();
  }

  function stepSection(number, title, description) {
    const section = node('section', { className: 'bulk-create-step' });
    const header = node('div', { className: 'bulk-create-step-header' });
    header.append(
      node('span', { className: 'bulk-create-step-number', textContent: number }),
      node('div', {}, node('h3', { textContent: title }), node('p', { textContent: description }))
    );
    section.appendChild(header);
    return section;
  }

  function setDateInputs(startInput, endInput, value) {
    startInput.value = value;
    endInput.value = value;
    endInput.min = value;
    startInput.focus();
  }

  function smallButton(label, handler) {
    const button = node('button', { type: 'button', className: 'button ghost compact-button', textContent: label });
    button.addEventListener('click', handler);
    return button;
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
      throw clientError(data && data.error && data.error.code || 'API_ERROR', data && data.error && data.error.message || '後端拒絕此請求。');
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

  function completeAction(message) {
    const status = document.getElementById('bulkActionsStatus');
    if (status) status.textContent = message;
    const modal = document.getElementById('bulkActionsModal');
    if (modal) modal.classList.add('hidden');
    document.body.classList.remove('modal-open');
    state.ranges = [];
    const refresh = document.getElementById('refreshButton');
    if (refresh && !refresh.disabled) refresh.click();
  }

  function setBusy(busy, button, busyLabel) {
    state.busy = busy;
    const close = document.querySelector('#bulkActionsModal .bulk-modal-header .icon-button');
    if (close) close.disabled = busy;
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

  function normalizeColor(value, type) {
    const color = String(value || '').trim().toUpperCase();
    return /^#[0-9A-F]{6}$/.test(color) ? color : (DEFAULT_COLORS[type] || DEFAULT_COLORS.notice);
  }

  function isDateKey(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }

  function localDateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function addDays(dateKey, days) {
    const date = new Date(`${dateKey}T12:00:00`);
    date.setDate(date.getDate() + days);
    return localDateKey(date);
  }

  function formatDate(dateKey) {
    const date = new Date(`${dateKey}T00:00:00`);
    if (Number.isNaN(date.getTime())) return dateKey;
    return new Intl.DateTimeFormat('zh-TW', { month: 'numeric', day: 'numeric', weekday: 'short' }).format(date);
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
})();