(() => {
  'use strict';

  const DEFAULT_COLORS = Object.freeze({ holiday: '#D95656', event: '#3182B8', notice: '#D3A12F' });
  const state = {
    config: null,
    idToken: '',
    profile: null,
    role: '',
    items: [],
    viewMonth: startOfMonth(new Date()),
    selectedDate: dateKey(new Date()),
    saving: false
  };

  const els = {};

  window.addEventListener('DOMContentLoaded', () => {
    bindElements();
    bindEvents();
    boot();
  });

  function bindElements() {
    [
      'app', 'loadingView', 'errorView', 'errorTitle', 'errorMessage', 'pendingBox',
      'pendingUserId', 'retryButton', 'adminView', 'displayName', 'logoutButton',
      'prevMonth', 'nextMonth', 'todayButton', 'monthTitle', 'refreshButton', 'calendarGrid',
      'dayModal', 'closeModalButton', 'modalTitle', 'dayItemCount', 'dayItemsList',
      'itemForm', 'itemId', 'expectedUpdatedAt', 'formTitle', 'cancelEditButton', 'archiveButton',
      'type', 'status', 'title', 'startDate', 'endDate', 'color', 'allDay', 'startTimeLabel',
      'endTimeLabel', 'startTime', 'endTime', 'location', 'description', 'formMessage', 'saveButton'
    ].forEach((id) => { els[id] = document.getElementById(id); });
  }

  function bindEvents() {
    els.retryButton.addEventListener('click', () => window.location.reload());
    els.logoutButton.addEventListener('click', () => {
      try {
        if (window.liff && window.liff.isLoggedIn()) window.liff.logout();
      } finally {
        window.location.reload();
      }
    });

    els.prevMonth.addEventListener('click', () => {
      state.viewMonth = new Date(state.viewMonth.getFullYear(), state.viewMonth.getMonth() - 1, 1);
      renderCalendar();
    });
    els.nextMonth.addEventListener('click', () => {
      state.viewMonth = new Date(state.viewMonth.getFullYear(), state.viewMonth.getMonth() + 1, 1);
      renderCalendar();
    });
    els.todayButton.addEventListener('click', () => {
      const today = new Date();
      state.viewMonth = startOfMonth(today);
      state.selectedDate = dateKey(today);
      renderCalendar();
    });
    els.refreshButton.addEventListener('click', refreshItems);

    els.closeModalButton.addEventListener('click', closeDayModal);
    els.dayModal.addEventListener('click', (event) => {
      if (event.target === els.dayModal) closeDayModal();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !els.dayModal.classList.contains('hidden')) closeDayModal();
    });

    els.allDay.addEventListener('change', updateTimeVisibility);
    els.type.addEventListener('change', () => {
      if (!els.itemId.value) els.color.value = defaultColor(els.type.value);
    });
    document.querySelectorAll('.color-swatch').forEach((button) => {
      button.addEventListener('click', () => {
        const color = safeColor(button.dataset.color, els.type.value);
        els.color.value = color;
      });
    });
    els.itemForm.addEventListener('submit', handleSubmit);
    els.cancelEditButton.addEventListener('click', () => resetFormForDate(state.selectedDate));
    els.archiveButton.addEventListener('click', archiveEditingItem);
  }

  async function boot() {
    setView('loading');
    try {
      state.config = await loadConfig();
      await initializeLiff();
      state.idToken = window.liff.getIDToken() || '';
      if (!state.idToken) {
        throw clientError('AUTH_REQUIRED', '無法取得 LINE ID token。請確認 Admin LIFF 已啟用 openid scope。');
      }

      const result = await api('admin.bootstrap');
      state.profile = result.profile || null;
      state.role = result.role || '';
      state.items = Array.isArray(result.items) ? result.items : [];
      els.displayName.textContent = state.profile && state.profile.displayName ? state.profile.displayName : '管理員';
      setView('admin');
      renderCalendar();
    } catch (error) {
      handleBootError(error);
    } finally {
      els.app.setAttribute('aria-busy', 'false');
    }
  }

  async function loadConfig() {
    const response = await fetch('../config.json', { cache: 'no-store' });
    if (!response.ok) throw clientError('CONFIG_ERROR', '讀取 config.json 失敗。');
    const config = await response.json();
    validatePublicConfig(config);
    return config;
  }

  function validatePublicConfig(config) {
    const gasUrl = String(config && config.gasWebAppUrl || '').trim();
    const liffId = String(config && config.adminLiffId || '').trim();
    if (!gasUrl || gasUrl.includes('REPLACE_WITH_') || !/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(gasUrl)) {
      throw clientError('CONFIG_ERROR', '尚未正確設定 GAS Web App URL。');
    }
    if (!liffId || liffId.includes('REPLACE_WITH_')) {
      throw clientError('CONFIG_ERROR', '尚未設定 Admin LIFF ID。');
    }
  }

  async function initializeLiff() {
    if (!window.liff) throw clientError('LIFF_SDK_ERROR', 'LIFF SDK 載入失敗，請確認網路後重試。');
    try {
      await window.liff.init({ liffId: state.config.adminLiffId });
    } catch (error) {
      throw clientError('LIFF_INIT_ERROR', 'Admin LIFF 初始化失敗，請檢查 LIFF ID 與 Endpoint URL。');
    }

    if (!window.liff.isLoggedIn()) {
      window.liff.login({ redirectUri: cleanRedirectUri() });
      await new Promise(() => {});
    }
  }

  async function api(action, payload = {}) {
    const body = {
      action,
      clientType: 'admin',
      idToken: state.idToken,
      ...payload
    };

    let response;
    try {
      response = await fetch(state.config.gasWebAppUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        cache: 'no-store',
        redirect: 'follow',
        body: JSON.stringify(body)
      });
    } catch (error) {
      throw clientError('NETWORK_ERROR', '無法連線 GAS 後端，請檢查 Web App 部署與網路。');
    }

    let data;
    try {
      data = await response.json();
    } catch (error) {
      throw clientError('API_RESPONSE_ERROR', 'GAS 回傳格式錯誤，請確認部署的是最新版本。');
    }

    if (!data || data.ok !== true) {
      const error = clientError(data && data.error && data.error.code || 'API_ERROR', data && data.error && data.error.message || '後端拒絕此請求。');
      error.status = Number(data && data.status || 0);
      error.details = data && data.error && data.error.details || null;
      throw error;
    }

    return data.data || {};
  }

  function handleBootError(error) {
    if (error && error.code === 'ADMIN_PENDING') {
      els.pendingUserId.textContent = String(error.details && error.details.lineUserId || '請查看 Admins 資料表');
      els.pendingBox.classList.remove('hidden');
      showError('此 LINE 帳號尚未授權', 'GAS 已記錄這次管理端登入，但目前不允許進入管理功能。');
      return;
    }
    if (error && error.code === 'ADMIN_FORBIDDEN') {
      showError('沒有管理端權限', '此 LINE 帳號未啟用管理權限。請檢查 Admins 的 role 與 status。');
      return;
    }
    if (error && error.code === 'CONFIG_ERROR') {
      showError('系統尚未完成設定', error.message);
      return;
    }

    const authCodes = new Set(['AUTH_REQUIRED', 'AUTH_INVALID', 'AUTH_EXPIRED', 'AUTH_CHANNEL_MISMATCH']);
    if (authCodes.has(error && error.code)) {
      try {
        if (window.liff && window.liff.isLoggedIn()) window.liff.logout();
      } catch (_) {}
      showError('LINE 登入已失效', 'LINE 身分驗證未通過。請重新整理後重新登入。');
      return;
    }
    showError('暫時無法進入管理端', error && error.message ? error.message : '請稍後重新整理。');
  }

  function setView(view) {
    els.loadingView.classList.toggle('hidden', view !== 'loading');
    els.errorView.classList.toggle('hidden', view !== 'error');
    els.adminView.classList.toggle('hidden', view !== 'admin');
  }

  function showError(title, message) {
    els.errorTitle.textContent = title;
    els.errorMessage.textContent = message;
    setView('error');
  }

  function renderCalendar() {
    const year = state.viewMonth.getFullYear();
    const month = state.viewMonth.getMonth();
    els.monthTitle.textContent = new Intl.DateTimeFormat('zh-TW', { year: 'numeric', month: 'long' }).format(state.viewMonth);

    const first = new Date(year, month, 1);
    const gridStart = new Date(year, month, 1 - first.getDay());
    const todayKey = dateKey(new Date());
    const fragment = document.createDocumentFragment();

    for (let i = 0; i < 42; i += 1) {
      const date = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
      const key = dateKey(date);
      const dayItems = itemsForDate(key);

      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'day-cell';
      cell.setAttribute('aria-label', `${formatDate(date)}，${dayItems.length} 個事項`);
      if (date.getMonth() !== month) cell.classList.add('outside');
      if (key === todayKey) cell.classList.add('today');

      const number = document.createElement('span');
      number.className = 'day-number';
      number.textContent = String(date.getDate());
      cell.appendChild(number);

      if (dayItems.length) {
        const container = document.createElement('span');
        container.className = 'calendar-items';
        dayItems.slice(0, 3).forEach((item) => {
          const chip = document.createElement('span');
          chip.className = `calendar-chip ${item.status === 'draft' ? 'draft' : ''}`;
          chip.textContent = item.title;
          applyItemColor(chip, item.color, item.type, true);
          container.appendChild(chip);
        });
        if (dayItems.length > 3) {
          const more = document.createElement('span');
          more.className = 'more-count';
          more.textContent = `+${dayItems.length - 3}`;
          container.appendChild(more);
        }
        cell.appendChild(container);
      }

      cell.addEventListener('click', () => openDayModal(key));
      fragment.appendChild(cell);
    }

    els.calendarGrid.replaceChildren(fragment);
  }

  function openDayModal(key) {
    state.selectedDate = key;
    const date = parseDateKey(key);
    els.modalTitle.textContent = `${formatDate(date)} 事項`;
    resetFormForDate(key);
    renderDayItems();
    els.dayModal.classList.remove('hidden');
    document.body.classList.add('modal-open');
    window.setTimeout(() => els.title.focus(), 0);
  }

  function closeDayModal() {
    els.dayModal.classList.add('hidden');
    document.body.classList.remove('modal-open');
    clearFormMessage();
  }

  function renderDayItems() {
    const items = itemsForDate(state.selectedDate);
    els.dayItemCount.textContent = String(items.length);

    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = '這一天尚未建立事項。';
      els.dayItemsList.replaceChildren(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    items.forEach((item) => {
      const row = document.createElement('article');
      row.className = 'day-item-row';

      const marker = document.createElement('span');
      marker.className = 'day-item-marker';
      marker.style.backgroundColor = safeColor(item.color, item.type);

      const copy = document.createElement('div');
      copy.className = 'day-item-copy';
      const title = document.createElement('h4');
      title.className = 'day-item-title';
      title.textContent = item.title;
      const meta = document.createElement('p');
      meta.className = 'day-item-meta';
      const time = item.allDay ? '全天' : `${item.startTime || ''}${item.endTime ? `–${item.endTime}` : ''}`;
      meta.textContent = [typeLabel(item.type), statusLabel(item.status), time].filter(Boolean).join(' · ');
      copy.append(title, meta);

      const actions = document.createElement('div');
      actions.className = 'day-item-actions';
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'button ghost';
      edit.textContent = '編輯';
      edit.addEventListener('click', () => beginEdit(item));
      actions.appendChild(edit);

      row.append(marker, copy, actions);
      fragment.appendChild(row);
    });

    els.dayItemsList.replaceChildren(fragment);
  }

  function itemsForDate(key) {
    return state.items
      .filter((item) => item && item.status !== 'archived' && item.startDate <= key && item.endDate >= key)
      .sort((a, b) => {
        if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
        return String(a.startTime || '').localeCompare(String(b.startTime || '')) || String(a.title || '').localeCompare(String(b.title || ''), 'zh-Hant');
      });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (state.saving) return;
    clearFormMessage();

    const item = readForm();
    const validationMessage = validateForm(item);
    if (validationMessage) {
      showFormMessage(validationMessage);
      return;
    }

    state.saving = true;
    els.saveButton.disabled = true;
    els.saveButton.textContent = '儲存中…';

    try {
      if (item.itemId) {
        await api('admin.calendar.update', { item, expectedUpdatedAt: els.expectedUpdatedAt.value });
      } else {
        await api('admin.calendar.create', { item });
      }
      await refreshItems(false);
      resetFormForDate(state.selectedDate);
      renderDayItems();
    } catch (error) {
      if (error && error.code === 'CONFLICT') {
        showFormMessage('這筆資料已被其他管理者更新。已重新載入，請重新編輯。');
        await refreshItems(false);
        renderDayItems();
      } else {
        showFormMessage(error && error.message ? error.message : '儲存失敗。');
      }
    } finally {
      state.saving = false;
      els.saveButton.disabled = false;
      els.saveButton.textContent = els.itemId.value ? '儲存變更' : '新增事項';
    }
  }

  function readForm() {
    return {
      itemId: els.itemId.value.trim(),
      type: els.type.value,
      status: els.status.value,
      title: els.title.value.trim(),
      startDate: els.startDate.value,
      endDate: els.endDate.value,
      color: safeColor(els.color.value, els.type.value),
      allDay: els.allDay.checked,
      startTime: els.allDay.checked ? '' : els.startTime.value,
      endTime: els.allDay.checked ? '' : els.endTime.value,
      location: els.location.value.trim(),
      description: els.description.value.trim()
    };
  }

  function validateForm(item) {
    if (!item.title) return '請輸入標題。';
    if (!item.startDate || !item.endDate) return '請選擇開始與結束日期。';
    if (item.endDate < item.startDate) return '結束日期不得早於開始日期。';
    if (!/^#[0-9A-F]{6}$/.test(item.color)) return '顏色格式不合法。';
    if (!item.allDay && (!item.startTime || !item.endTime)) return '非全天項目需要開始與結束時間。';
    if (!item.allDay && item.startDate === item.endDate && item.endTime <= item.startTime) return '同一天的結束時間必須晚於開始時間。';
    return '';
  }

  function beginEdit(item) {
    els.itemId.value = item.itemId;
    els.expectedUpdatedAt.value = item.updatedAt || '';
    els.type.value = item.type;
    els.status.value = item.status === 'draft' ? 'draft' : 'published';
    els.title.value = item.title || '';
    els.startDate.value = item.startDate || state.selectedDate;
    els.endDate.value = item.endDate || state.selectedDate;
    els.color.value = safeColor(item.color, item.type);
    els.allDay.checked = Boolean(item.allDay);
    els.startTime.value = item.startTime || '';
    els.endTime.value = item.endTime || '';
    els.location.value = item.location || '';
    els.description.value = item.description || '';
    els.formTitle.textContent = '編輯事項';
    els.saveButton.textContent = '儲存變更';
    els.cancelEditButton.classList.remove('hidden');
    els.archiveButton.classList.remove('hidden');
    updateTimeVisibility();
    clearFormMessage();
    els.title.focus();
  }

  async function archiveEditingItem() {
    const itemId = els.itemId.value.trim();
    if (!itemId) return;
    const item = state.items.find((entry) => entry.itemId === itemId);
    if (!item) return;
    if (!window.confirm(`確定要封存「${item.title}」嗎？封存後用戶端不會顯示。`)) return;

    try {
      await api('admin.calendar.archive', {
        itemId: item.itemId,
        expectedUpdatedAt: els.expectedUpdatedAt.value
      });
      await refreshItems(false);
      resetFormForDate(state.selectedDate);
      renderDayItems();
    } catch (error) {
      if (error && error.code === 'CONFLICT') {
        showFormMessage('這筆資料已被其他管理者更新，請重新確認後再操作。');
        await refreshItems(false);
        renderDayItems();
      } else {
        showFormMessage(error && error.message ? error.message : '封存失敗。');
      }
    }
  }

  async function refreshItems(showButtonState = true) {
    if (showButtonState) els.refreshButton.disabled = true;
    try {
      const result = await api('admin.calendar.list');
      state.items = Array.isArray(result.items) ? result.items : [];
      renderCalendar();
      if (!els.dayModal.classList.contains('hidden')) renderDayItems();
    } catch (error) {
      if (!els.dayModal.classList.contains('hidden')) {
        showFormMessage(error && error.message ? error.message : '重新載入失敗。');
      } else {
        window.alert(error && error.message ? error.message : '重新載入失敗。');
      }
    } finally {
      if (showButtonState) els.refreshButton.disabled = false;
    }
  }

  function resetFormForDate(key) {
    els.itemForm.reset();
    els.itemId.value = '';
    els.expectedUpdatedAt.value = '';
    els.type.value = 'event';
    els.status.value = 'published';
    els.startDate.value = key;
    els.endDate.value = key;
    els.color.value = defaultColor('event');
    els.allDay.checked = true;
    els.startTime.value = '';
    els.endTime.value = '';
    els.formTitle.textContent = '新增事項';
    els.saveButton.textContent = '新增事項';
    els.cancelEditButton.classList.add('hidden');
    els.archiveButton.classList.add('hidden');
    updateTimeVisibility();
    clearFormMessage();
  }

  function updateTimeVisibility() {
    const hidden = els.allDay.checked;
    els.startTimeLabel.classList.toggle('hidden', hidden);
    els.endTimeLabel.classList.toggle('hidden', hidden);
  }

  function showFormMessage(message) {
    els.formMessage.textContent = message;
    els.formMessage.classList.remove('hidden');
  }

  function clearFormMessage() {
    els.formMessage.textContent = '';
    els.formMessage.classList.add('hidden');
  }

  function safeColor(value, type) {
    const normalized = String(value || '').trim().toUpperCase();
    return /^#[0-9A-F]{6}$/.test(normalized) ? normalized : defaultColor(type);
  }

  function defaultColor(type) {
    return DEFAULT_COLORS[type] || DEFAULT_COLORS.notice;
  }

  function applyItemColor(element, value, type, includeTextColor) {
    const color = safeColor(value, type);
    element.style.backgroundColor = color;
    if (includeTextColor) element.style.color = readableTextColor(color);
  }

  function readableTextColor(color) {
    const hex = safeColor(color, 'notice').substring(1);
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    return ((r * 299 + g * 587 + b * 114) / 1000) >= 155 ? '#172019' : '#FFFFFF';
  }

  function typeLabel(type) {
    return ({ holiday: '休假日', event: '活動', notice: '公告' })[type] || '公告';
  }

  function statusLabel(status) {
    return ({ published: '已發布', draft: '草稿', archived: '已封存' })[status] || status;
  }

  function cleanRedirectUri() {
    const url = new URL(window.location.href);
    url.hash = '';
    ['code', 'state', 'liffClientId', 'liffRedirectUri'].forEach((name) => url.searchParams.delete(name));
    return url.toString();
  }

  function clientError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  function startOfMonth(date) {
    return new Date(date.getFullYear(), date.getMonth(), 1);
  }

  function dateKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function parseDateKey(key) {
    const [y, m, d] = String(key).split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function formatDate(date) {
    return new Intl.DateTimeFormat('zh-TW', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' }).format(date);
  }
})();
