(() => {
  'use strict';

  const DEFAULT_COLORS = Object.freeze({ holiday: '#D95656', event: '#3182B8', notice: '#D3A12F' });
  const state = {
    config: null,
    idToken: '',
    profile: null,
    items: [],
    viewMonth: startOfMonth(new Date()),
    selectedDate: dateKey(new Date())
  };

  const els = {};

  window.addEventListener('DOMContentLoaded', () => {
    bindElements();
    bindEvents();
    boot();
  });

  function bindElements() {
    [
      'app', 'loadingView', 'errorView', 'errorTitle', 'errorMessage', 'retryButton',
      'calendarView', 'displayName', 'logoutButton', 'prevMonth', 'nextMonth',
      'todayButton', 'monthTitle', 'calendarGrid', 'selectedDayModal', 'closeSelectedDayButton',
      'selectedDateTitle', 'selectedCount', 'agendaList'
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

    els.closeSelectedDayButton.addEventListener('click', closeSelectedDayModal);
    els.selectedDayModal.addEventListener('click', (event) => {
      if (event.target === els.selectedDayModal) closeSelectedDayModal();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !els.selectedDayModal.classList.contains('hidden')) {
        closeSelectedDayModal();
      }
    });
  }

  async function boot() {
    setView('loading');
    try {
      state.config = await loadConfig();
      await initializeLiff();
      state.idToken = window.liff.getIDToken() || '';
      if (!state.idToken) {
        throw clientError('LINE_AUTH_ERROR', '無法取得 LINE ID token。請確認 User LIFF 已啟用 openid scope。');
      }

      const result = await api('user.bootstrap');
      state.profile = result.profile;
      state.items = Array.isArray(result.items) ? result.items : [];

      els.displayName.textContent = state.profile && state.profile.displayName
        ? state.profile.displayName
        : 'LINE 使用者';

      setView('calendar');
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

    validatePublicConfig(config, 'userLiffId');
    return config;
  }

  function validatePublicConfig(config, liffKey) {
    const gasUrl = String(config && config.gasWebAppUrl || '').trim();
    const liffId = String(config && config[liffKey] || '').trim();

    if (!gasUrl || gasUrl.includes('REPLACE_WITH_') || !/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(gasUrl)) {
      throw clientError('CONFIG_ERROR', '尚未正確設定 GAS Web App URL。');
    }
    if (!liffId || liffId.includes('REPLACE_WITH_')) {
      throw clientError('CONFIG_ERROR', '尚未設定 User LIFF ID。');
    }
  }

  async function initializeLiff() {
    if (!window.liff) throw clientError('LIFF_SDK_ERROR', 'LIFF SDK 載入失敗，請確認網路後重試。');

    try {
      await window.liff.init({ liffId: state.config.userLiffId });
    } catch (error) {
      throw clientError('LIFF_INIT_ERROR', 'User LIFF 初始化失敗，請檢查 LIFF ID 與 Endpoint URL。');
    }

    if (!window.liff.isLoggedIn()) {
      window.liff.login({ redirectUri: cleanRedirectUri() });
      await new Promise(() => {});
    }
  }

  async function api(action, payload = {}) {
    const body = {
      action,
      clientType: 'user',
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
    const authCodes = new Set(['AUTH_REQUIRED', 'AUTH_INVALID', 'AUTH_EXPIRED', 'AUTH_CHANNEL_MISMATCH']);
    if (authCodes.has(error && error.code)) {
      try {
        if (window.liff && window.liff.isLoggedIn()) window.liff.logout();
      } catch (_) {}
      showError('LINE 登入已失效', 'LINE 身分驗證未通過。請按重新整理後重新登入。');
      return;
    }

    if (error && error.code === 'CONFIG_ERROR') {
      showError('系統尚未完成設定', error.message);
      return;
    }

    showError('暫時無法載入日曆', error && error.message ? error.message : '請稍後重新整理。');
  }

  function setView(view) {
    els.loadingView.classList.toggle('hidden', view !== 'loading');
    els.errorView.classList.toggle('hidden', view !== 'error');
    els.calendarView.classList.toggle('hidden', view !== 'calendar');
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
      cell.dataset.date = key;
      cell.setAttribute('aria-label', `${formatDate(date)}，${dayItems.length} 個行程`);
      if (date.getMonth() !== month) cell.classList.add('outside');
      if (key === todayKey) cell.classList.add('today');
      if (key === state.selectedDate) cell.classList.add('selected');

      const number = document.createElement('span');
      number.className = 'day-number';
      number.textContent = String(date.getDate());
      cell.appendChild(number);

      if (dayItems.length) {
        const items = document.createElement('span');
        items.className = 'day-items';
        dayItems.slice(0, 2).forEach((item) => {
          const chip = document.createElement('span');
          chip.className = 'day-item';
          chip.textContent = item.title;
          applyItemColor(chip, item.color, item.type, true);
          items.appendChild(chip);
        });
        if (dayItems.length > 2) {
          const more = document.createElement('span');
          more.className = 'more-count';
          more.textContent = `+${dayItems.length - 2}`;
          items.appendChild(more);
        }
        cell.appendChild(items);
      }

      cell.addEventListener('click', () => openSelectedDayModal(key, date));
      fragment.appendChild(cell);
    }

    els.calendarGrid.replaceChildren(fragment);
  }

  function openSelectedDayModal(key, date) {
    state.selectedDate = key;
    state.viewMonth = startOfMonth(date);
    renderCalendar();
    renderAgenda();
    els.selectedDayModal.classList.remove('hidden');
    document.body.classList.add('modal-open');
    window.setTimeout(() => els.closeSelectedDayButton.focus(), 0);
  }

  function closeSelectedDayModal() {
    els.selectedDayModal.classList.add('hidden');
    document.body.classList.remove('modal-open');
    const trigger = document.querySelector(`.day-cell[data-date="${state.selectedDate}"]`);
    if (trigger) trigger.focus();
  }

  function renderAgenda() {
    const date = parseDateKey(state.selectedDate);
    const items = itemsForDate(state.selectedDate);
    els.selectedDateTitle.textContent = `${formatDate(date)} 行程`;
    els.selectedCount.textContent = String(items.length);

    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = '這一天目前沒有公告行程。';
      els.agendaList.replaceChildren(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    items.forEach((item) => {
      const row = document.createElement('article');
      row.className = 'agenda-item';

      const marker = document.createElement('span');
      marker.className = 'agenda-marker';
      marker.style.backgroundColor = safeColor(item.color, item.type);

      const content = document.createElement('div');
      const title = document.createElement('h3');
      title.className = 'agenda-title';
      title.textContent = item.title;
      content.appendChild(title);

      const metaParts = [typeLabel(item.type)];
      if (!item.allDay && item.startTime) {
        metaParts.push(item.endTime ? `${item.startTime}–${item.endTime}` : item.startTime);
      } else {
        metaParts.push('全天');
      }
      if (item.location) metaParts.push(item.location);

      const meta = document.createElement('p');
      meta.className = 'agenda-meta';
      meta.textContent = metaParts.join(' · ');
      content.appendChild(meta);

      if (item.description) {
        const description = document.createElement('p');
        description.className = 'agenda-description';
        description.textContent = item.description;
        content.appendChild(description);
      }

      row.append(marker, content);
      fragment.appendChild(row);
    });

    els.agendaList.replaceChildren(fragment);
  }

  function itemsForDate(key) {
    return state.items
      .filter((item) => item && item.status === 'published' && item.startDate <= key && item.endDate >= key)
      .sort((a, b) => {
        if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
        return String(a.startTime || '').localeCompare(String(b.startTime || '')) || String(a.title || '').localeCompare(String(b.title || ''), 'zh-Hant');
      });
  }

  function safeColor(value, type) {
    const normalized = String(value || '').trim().toUpperCase();
    return /^#[0-9A-F]{6}$/.test(normalized) ? normalized : (DEFAULT_COLORS[type] || DEFAULT_COLORS.notice);
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
    return new Intl.DateTimeFormat('zh-TW', { month: 'long', day: 'numeric', weekday: 'short' }).format(date);
  }
})();
