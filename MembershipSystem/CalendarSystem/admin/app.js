(() => {
  'use strict';

  const state = {
    config: null,
    idToken: '',
    profile: null,
    role: '',
    items: [],
    saving: false
  };

  const els = {};

  window.addEventListener('DOMContentLoaded', () => {
    bindElements();
    bindEvents();
    setDefaultDates();
    boot();
  });

  function bindElements() {
    [
      'app', 'loadingView', 'errorView', 'errorTitle', 'errorMessage', 'pendingBox',
      'pendingUserId', 'retryButton', 'adminView', 'displayName', 'logoutButton',
      'itemForm', 'itemId', 'expectedUpdatedAt', 'formTitle', 'cancelEditButton',
      'type', 'status', 'title', 'startDate', 'endDate', 'allDay', 'startTimeLabel',
      'endTimeLabel', 'startTime', 'endTime', 'location', 'description', 'formMessage',
      'saveButton', 'filterStatus', 'refreshButton', 'itemsList'
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
    els.allDay.addEventListener('change', updateTimeVisibility);
    els.itemForm.addEventListener('submit', handleSubmit);
    els.cancelEditButton.addEventListener('click', resetForm);
    els.filterStatus.addEventListener('change', renderItems);
    els.refreshButton.addEventListener('click', refreshItems);
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
      renderItems();
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
        await api('admin.calendar.update', {
          item,
          expectedUpdatedAt: els.expectedUpdatedAt.value
        });
      } else {
        await api('admin.calendar.create', { item });
      }
      await refreshItems();
      resetForm();
    } catch (error) {
      if (error && error.code === 'CONFLICT') {
        showFormMessage('這筆資料已被其他管理者更新。已重新載入清單，請重新編輯。');
        await refreshItems();
      } else {
        showFormMessage(error && error.message ? error.message : '儲存失敗。');
      }
    } finally {
      state.saving = false;
      els.saveButton.disabled = false;
      els.saveButton.textContent = els.itemId.value ? '儲存變更' : '新增';
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
    if (!item.allDay && (!item.startTime || !item.endTime)) return '非全天項目需要開始與結束時間。';
    if (!item.allDay && item.startDate === item.endDate && item.endTime <= item.startTime) return '同一天的結束時間必須晚於開始時間。';
    return '';
  }

  async function refreshItems() {
    els.refreshButton.disabled = true;
    try {
      const result = await api('admin.calendar.list');
      state.items = Array.isArray(result.items) ? result.items : [];
      renderItems();
    } catch (error) {
      showFormMessage(error && error.message ? error.message : '重新載入失敗。');
    } finally {
      els.refreshButton.disabled = false;
    }
  }

  function renderItems() {
    const filter = els.filterStatus.value;
    const items = state.items
      .filter((item) => filter === 'all' || item.status === filter)
      .sort((a, b) => String(b.startDate || '').localeCompare(String(a.startDate || '')) || String(a.title || '').localeCompare(String(b.title || ''), 'zh-Hant'));

    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = '目前沒有符合條件的日曆項目。';
      els.itemsList.replaceChildren(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    items.forEach((item) => fragment.appendChild(buildItemCard(item)));
    els.itemsList.replaceChildren(fragment);
  }

  function buildItemCard(item) {
    const card = document.createElement('article');
    card.className = 'item-card';

    const accent = document.createElement('div');
    accent.className = `item-accent ${safeType(item.type)}`;

    const body = document.createElement('div');
    body.className = 'item-body';

    const titleRow = document.createElement('div');
    titleRow.className = 'item-title-row';

    const title = document.createElement('h3');
    title.className = 'item-title';
    title.textContent = item.title;

    const typeChip = document.createElement('span');
    typeChip.className = 'type-chip';
    typeChip.textContent = typeLabel(item.type);

    const statusChip = document.createElement('span');
    statusChip.className = `status-chip ${safeStatus(item.status)}`;
    statusChip.textContent = statusLabel(item.status);

    titleRow.append(title, typeChip, statusChip);
    body.appendChild(titleRow);

    const meta = document.createElement('p');
    meta.className = 'item-meta';
    const dateRange = item.startDate === item.endDate ? item.startDate : `${item.startDate} → ${item.endDate}`;
    const time = item.allDay ? '全天' : `${item.startTime || ''}${item.endTime ? `–${item.endTime}` : ''}`;
    meta.textContent = [dateRange, time, item.location].filter(Boolean).join(' · ');
    body.appendChild(meta);

    if (item.description) {
      const description = document.createElement('p');
      description.className = 'item-description';
      description.textContent = item.description;
      body.appendChild(description);
    }

    const actions = document.createElement('div');
    actions.className = 'item-actions';

    if (item.status !== 'archived') {
      const editButton = document.createElement('button');
      editButton.type = 'button';
      editButton.className = 'button ghost';
      editButton.textContent = '編輯';
      editButton.addEventListener('click', () => beginEdit(item));

      const archiveButton = document.createElement('button');
      archiveButton.type = 'button';
      archiveButton.className = 'button danger';
      archiveButton.textContent = '封存';
      archiveButton.addEventListener('click', () => archiveItem(item));
      actions.append(editButton, archiveButton);
    }

    card.append(accent, body, actions);
    return card;
  }

  function beginEdit(item) {
    els.itemId.value = item.itemId;
    els.expectedUpdatedAt.value = item.updatedAt || '';
    els.type.value = item.type;
    els.status.value = item.status === 'draft' ? 'draft' : 'published';
    els.title.value = item.title || '';
    els.startDate.value = item.startDate || '';
    els.endDate.value = item.endDate || '';
    els.allDay.checked = Boolean(item.allDay);
    els.startTime.value = item.startTime || '';
    els.endTime.value = item.endTime || '';
    els.location.value = item.location || '';
    els.description.value = item.description || '';
    els.formTitle.textContent = '編輯日曆項目';
    els.saveButton.textContent = '儲存變更';
    els.cancelEditButton.classList.remove('hidden');
    updateTimeVisibility();
    clearFormMessage();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function archiveItem(item) {
    if (!window.confirm(`確定要封存「${item.title}」嗎？封存後用戶端不會顯示。`)) return;
    try {
      await api('admin.calendar.archive', {
        itemId: item.itemId,
        expectedUpdatedAt: item.updatedAt || ''
      });
      if (els.itemId.value === item.itemId) resetForm();
      await refreshItems();
    } catch (error) {
      if (error && error.code === 'CONFLICT') {
        showFormMessage('這筆資料已被其他管理者更新，請重新確認後再操作。');
        await refreshItems();
      } else {
        showFormMessage(error && error.message ? error.message : '封存失敗。');
      }
    }
  }

  function resetForm() {
    els.itemForm.reset();
    els.itemId.value = '';
    els.expectedUpdatedAt.value = '';
    els.status.value = 'published';
    els.type.value = 'holiday';
    els.allDay.checked = true;
    setDefaultDates();
    updateTimeVisibility();
    els.formTitle.textContent = '新增日曆項目';
    els.saveButton.textContent = '新增';
    els.cancelEditButton.classList.add('hidden');
    clearFormMessage();
  }

  function setDefaultDates() {
    const today = dateKey(new Date());
    if (els.startDate && !els.startDate.value) els.startDate.value = today;
    if (els.endDate && !els.endDate.value) els.endDate.value = today;
  }

  function updateTimeVisibility() {
    const hidden = els.allDay.checked;
    els.startTimeLabel.classList.toggle('hidden', hidden);
    els.endTimeLabel.classList.toggle('hidden', hidden);
    if (hidden) {
      els.startTime.value = '';
      els.endTime.value = '';
    }
  }

  function showFormMessage(message) {
    els.formMessage.textContent = message;
    els.formMessage.classList.remove('hidden');
  }

  function clearFormMessage() {
    els.formMessage.textContent = '';
    els.formMessage.classList.add('hidden');
  }

  function safeType(type) {
    return ['holiday', 'event', 'notice'].includes(type) ? type : 'notice';
  }

  function safeStatus(status) {
    return ['published', 'draft', 'archived'].includes(status) ? status : 'draft';
  }

  function typeLabel(type) {
    return ({ holiday: '休假日', event: '活動', notice: '公告' })[type] || '公告';
  }

  function statusLabel(status) {
    return ({ published: '已發布', draft: '草稿', archived: '已封存' })[status] || '草稿';
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

  function dateKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
})();
