'use strict';

const state = {
  config: null,
  idToken: '',
  token: sessionStorage.getItem('calendarAdminToken') || '',
  cursor: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  events: [],
  eventsByDate: new Map()
};

const els = {};

document.addEventListener('DOMContentLoaded', init);

async function init() {
  bindElements();
  bindActions();

  try {
    state.config = await loadConfig();
    validateConfig(state.config);

    const loggedIn = await ensureAdminLiffLogin();
    if (!loggedIn) return;

    showLineAuthMessage('管理端 LINE 身分已登入。');
    els.adminTokenInput.disabled = false;
    els.loginBtn.disabled = false;

    if (state.token) {
      els.adminTokenInput.value = state.token;
      await authenticate();
    }
  } catch (error) {
    showLineAuthMessage(error && error.message ? error.message : '管理端 LINE 登入失敗。', true);
    showAuthMessage('請先完成管理端 LINE 登入。', true);
  }
}

function bindElements() {
  [
    'authPanel','lineAuthStatus','adminTokenInput','loginBtn','logoutBtn','authMessage','workspace',
    'prevBtn','nextBtn','todayBtn','reloadBtn','monthTitle','calendarGrid',
    'eventForm','eventId','eventDate','eventType','eventStatus','eventTitle',
    'eventDescription','saveBtn','formMessage','resetBtn','editorTitle',
    'adminEventList','eventCount'
  ].forEach(id => { els[id] = document.getElementById(id); });
}

function bindActions() {
  els.loginBtn.addEventListener('click', authenticate);
  els.adminTokenInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') authenticate();
  });
  els.logoutBtn.addEventListener('click', logout);
  els.prevBtn.addEventListener('click', () => changeMonth(-1));
  els.nextBtn.addEventListener('click', () => changeMonth(1));
  els.todayBtn.addEventListener('click', async () => {
    const now = new Date();
    state.cursor = new Date(now.getFullYear(), now.getMonth(), 1);
    await loadMonth();
  });
  els.reloadBtn.addEventListener('click', loadMonth);
  els.resetBtn.addEventListener('click', resetForm);
  els.eventForm.addEventListener('submit', saveEvent);
}

async function loadConfig() {
  const response = await fetch('../config.json', {
    cache: 'no-store',
    credentials: 'same-origin',
    redirect: 'error',
    referrerPolicy: 'no-referrer'
  });
  if (!response.ok) throw new Error('無法讀取 config.json。');
  return response.json();
}

function validateConfig(config) {
  const apiUrl = String(config && config.apiUrl || '').trim();
  const adminLiffId = String(config && config.adminLiffId || '').trim();
  if (!/^https:\/\/.+/i.test(apiUrl)) throw new Error('尚未設定 GAS API URL。');
  if (!adminLiffId || /^YOUR_[A-Z0-9_]+$/i.test(adminLiffId)) {
    throw new Error('尚未設定管理端 LIFF ID。');
  }
}

async function ensureAdminLiffLogin() {
  if (!window.liff || typeof window.liff.init !== 'function') {
    throw new Error('LINE LIFF SDK 載入失敗。');
  }

  await window.liff.init({ liffId: state.config.adminLiffId });

  if (!window.liff.isLoggedIn()) {
    if (window.liff.isInClient()) {
      throw new Error('無法取得管理端 LINE 登入狀態，請關閉頁面後重新開啟。');
    }
    window.liff.login({ redirectUri: canonicalUrl() });
    return false;
  }

  const idToken = window.liff.getIDToken();
  if (!idToken) {
    throw new Error('無法取得管理端 LINE ID Token，請確認管理端 LIFF 已啟用 openid scope。');
  }

  state.idToken = idToken;
  canonicalizeUrl();
  return true;
}

function canonicalUrl() {
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  return url.href;
}

function canonicalizeUrl() {
  const cleanUrl = canonicalUrl();
  if (window.location.href !== cleanUrl) {
    window.history.replaceState(null, '', cleanUrl);
  }
}

async function authenticate() {
  const token = els.adminTokenInput.value.trim();
  if (!state.idToken) return showAuthMessage('管理端 LINE 登入尚未完成。', true);
  if (!token) return showAuthMessage('請輸入管理憑證。', true);
  if (!state.config || !state.config.apiUrl) return showAuthMessage('尚未設定 GAS API URL。', true);

  state.token = token;
  els.loginBtn.disabled = true;
  showAuthMessage('驗證中…');
  try {
    await apiRequest('admin.events.list', {
      year: state.cursor.getFullYear(),
      month: state.cursor.getMonth() + 1
    }, true);
    sessionStorage.setItem('calendarAdminToken', token);
    els.authPanel.classList.add('is-hidden');
    els.workspace.classList.remove('is-hidden');
    showAuthMessage('');
    await loadMonth();
  } catch (error) {
    sessionStorage.removeItem('calendarAdminToken');
    state.token = '';
    handleAuthFailure(error);
  } finally {
    els.loginBtn.disabled = !state.idToken;
  }
}

function logout() {
  sessionStorage.removeItem('calendarAdminToken');
  state.token = '';
  els.adminTokenInput.value = '';
  els.workspace.classList.add('is-hidden');
  els.authPanel.classList.remove('is-hidden');
  resetForm();
  showAuthMessage('已清除本分頁的管理憑證；管理端 LINE 登入仍維持。');
}

function handleAuthFailure(error) {
  const message = error && error.message ? error.message : '管理端驗證失敗。';
  if (isLineAuthError(error)) {
    state.idToken = '';
    els.adminTokenInput.disabled = true;
    els.loginBtn.disabled = true;
    els.workspace.classList.add('is-hidden');
    els.authPanel.classList.remove('is-hidden');
    showLineAuthMessage(message, true);
    showAuthMessage('管理端 LINE 身分驗證已失效，請重新整理後再登入。', true);
    return;
  }
  logout();
  showAuthMessage(message, true);
}

async function changeMonth(delta) {
  state.cursor = new Date(state.cursor.getFullYear(), state.cursor.getMonth() + delta, 1);
  await loadMonth();
}

async function loadMonth() {
  renderMonthHeading();
  setFormMessage('讀取中…');
  try {
    const data = await apiRequest('admin.events.list', {
      year: state.cursor.getFullYear(),
      month: state.cursor.getMonth() + 1
    }, true);
    state.events = Array.isArray(data.events) ? data.events : [];
    state.eventsByDate = groupByDate(state.events);
    renderCalendar();
    renderAdminEventList();
    setFormMessage('');
  } catch (error) {
    if (isAuthError(error)) {
      handleAuthFailure(error);
      return;
    }
    state.events = [];
    state.eventsByDate = new Map();
    renderCalendar();
    renderAdminEventList();
    setFormMessage(error && error.message ? error.message : '讀取失敗。', true);
  }
}

async function saveEvent(event) {
  event.preventDefault();
  els.saveBtn.disabled = true;
  setFormMessage('儲存中…');
  const payload = {
    eventId: els.eventId.value.trim(),
    date: els.eventDate.value,
    type: els.eventType.value,
    status: els.eventStatus.value,
    title: els.eventTitle.value.trim(),
    description: els.eventDescription.value.trim()
  };

  try {
    const result = await apiRequest('admin.event.save', payload, true);
    setFormMessage(result.created ? '已新增日期設定。' : '已更新日期設定。', false, true);
    state.cursor = monthCursorFromDate(result.event.date);
    resetForm(false);
    await loadMonth();
  } catch (error) {
    if (isAuthError(error)) {
      handleAuthFailure(error);
      return;
    }
    setFormMessage(error && error.message ? error.message : '儲存失敗。', true);
  } finally {
    els.saveBtn.disabled = false;
  }
}

async function archiveEvent(eventId) {
  const target = state.events.find(item => item.eventId === eventId);
  if (!target) return;
  if (!confirm(`確定要封存「${target.title}」？封存後用戶端將不再顯示。`)) return;

  try {
    await apiRequest('admin.event.delete', { eventId }, true);
    if (els.eventId.value === eventId) resetForm();
    await loadMonth();
    setFormMessage('已封存日期設定。', false, true);
  } catch (error) {
    if (isAuthError(error)) {
      handleAuthFailure(error);
      return;
    }
    setFormMessage(error && error.message ? error.message : '封存失敗。', true);
  }
}

async function apiRequest(action, payload, admin) {
  if (!state.idToken) {
    const error = new Error('管理端 LINE 登入狀態已失效。');
    error.code = 'UNAUTHENTICATED';
    throw error;
  }

  const body = new URLSearchParams();
  body.set('action', action);
  body.set('idToken', state.idToken);
  body.set('payload', JSON.stringify(payload || {}));
  if (admin) body.set('adminToken', state.token);

  const response = await fetch(state.config.apiUrl, {
    method: 'POST',
    body,
    redirect: 'follow',
    referrerPolicy: 'no-referrer'
  });
  if (!response.ok) throw new Error(`服務連線失敗 (${response.status})`);
  const result = await response.json();
  if (!result.ok) {
    const error = new Error(result.error && result.error.message || '服務暫時無法使用。');
    error.code = result.error && result.error.code || '';
    throw error;
  }
  return result.data || {};
}

function renderMonthHeading() {
  els.monthTitle.textContent = `${state.cursor.getFullYear()} 年 ${state.cursor.getMonth() + 1} 月`;
}

function renderCalendar() {
  renderMonthHeading();
  els.calendarGrid.textContent = '';

  const year = state.cursor.getFullYear();
  const month = state.cursor.getMonth();
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - first.getDay());
  const todayKey = toDateKey(new Date());

  for (let i = 0; i < 42; i += 1) {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const dateKey = toDateKey(date);
    const dayEvents = state.eventsByDate.get(dateKey) || [];

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'day-cell';
    if (date.getMonth() !== month) button.classList.add('outside');
    if (dateKey === todayKey) button.classList.add('today');
    button.addEventListener('click', () => {
      if (date.getMonth() !== month) {
        state.cursor = new Date(date.getFullYear(), date.getMonth(), 1);
        loadMonth();
      }
      resetForm();
      els.eventDate.value = dateKey;
      els.eventTitle.focus();
    });

    const number = document.createElement('span');
    number.className = 'day-number';
    number.textContent = String(date.getDate());
    button.appendChild(number);

    const wrap = document.createElement('span');
    wrap.className = 'day-markers';
    dayEvents.slice(0, 3).forEach(item => {
      const marker = document.createElement('span');
      marker.className = `marker ${item.type} ${item.status === 'draft' ? 'draft' : ''}`;
      marker.textContent = item.title;
      wrap.appendChild(marker);
    });
    button.appendChild(wrap);
    els.calendarGrid.appendChild(button);
  }
}

function renderAdminEventList() {
  els.adminEventList.textContent = '';
  els.eventCount.textContent = String(state.events.length);

  if (!state.events.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = '本月尚未建立休假或活動。';
    els.adminEventList.appendChild(empty);
    return;
  }

  state.events
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title, 'zh-Hant'))
    .forEach(item => {
      const article = document.createElement('article');
      article.className = 'admin-event';

      const top = document.createElement('div');
      top.className = 'admin-event-top';
      const text = document.createElement('div');
      const title = document.createElement('h4');
      title.textContent = `${formatShortDate(item.date)} · ${item.title}`;
      const description = document.createElement('p');
      description.textContent = item.description || '無說明';
      text.append(title, description);

      const pillWrap = document.createElement('div');
      const pill = document.createElement('span');
      pill.className = `pill ${item.type}`;
      pill.textContent = item.type === 'holiday' ? '休假' : '活動';
      pillWrap.appendChild(pill);
      if (item.status === 'draft') {
        const draft = document.createElement('span');
        draft.className = 'pill draft';
        draft.textContent = '草稿';
        draft.style.marginLeft = '5px';
        pillWrap.appendChild(draft);
      }
      top.append(text, pillWrap);

      const actions = document.createElement('div');
      actions.className = 'admin-event-actions';
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'button button-ghost';
      edit.textContent = '編輯';
      edit.addEventListener('click', () => editEvent(item));
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'button button-danger';
      del.textContent = '封存';
      del.addEventListener('click', () => archiveEvent(item.eventId));
      actions.append(edit, del);

      article.append(top, actions);
      els.adminEventList.appendChild(article);
    });
}

function editEvent(item) {
  els.eventId.value = item.eventId;
  els.eventDate.value = item.date;
  els.eventType.value = item.type;
  els.eventStatus.value = item.status;
  els.eventTitle.value = item.title;
  els.eventDescription.value = item.description || '';
  els.editorTitle.textContent = '編輯日期設定';
  els.eventTitle.focus();
}

function resetForm(clearMessage = true) {
  els.eventForm.reset();
  els.eventId.value = '';
  els.eventStatus.value = 'published';
  els.editorTitle.textContent = '新增日期設定';
  if (clearMessage) setFormMessage('');
}

function groupByDate(events) {
  const map = new Map();
  events.forEach(item => {
    if (!map.has(item.date)) map.set(item.date, []);
    map.get(item.date).push(item);
  });
  return map;
}

function toDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function monthCursorFromDate(value) {
  const [year, month] = value.split('-').map(Number);
  return new Date(year, month - 1, 1);
}

function formatShortDate(value) {
  const [, month, day] = value.split('-');
  return `${Number(month)}/${Number(day)}`;
}

function showLineAuthMessage(message, isError = false) {
  els.lineAuthStatus.textContent = message;
  els.lineAuthStatus.className = `message${isError ? ' error' : ' success'}`;
}

function showAuthMessage(message, isError = false) {
  els.authMessage.textContent = message;
  els.authMessage.className = `message${isError ? ' error' : ''}`;
}

function setFormMessage(message, isError = false, isSuccess = false) {
  els.formMessage.textContent = message;
  els.formMessage.className = `message${isError ? ' error' : isSuccess ? ' success' : ''}`;
}

function isLineAuthError(error) {
  return Boolean(error && (error.code === 'UNAUTHENTICATED' || error.code === 'AUTH_SERVICE_UNAVAILABLE' || error.code === 'CONFIGURATION_ERROR'));
}

function isAuthError(error) {
  return Boolean(error && (
    isLineAuthError(error) ||
    error.code === 'UNAUTHORIZED' ||
    error.code === 'ADMIN_NOT_CONFIGURED'
  ));
}
