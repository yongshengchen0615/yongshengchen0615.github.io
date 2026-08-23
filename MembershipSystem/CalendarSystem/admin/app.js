'use strict';

const FRESH_LOGIN_PARAM = 'calendar_reauth';

const state = {
  config: null,
  idToken: '',
  profile: null,
  cursor: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  events: [],
  eventsByDate: new Map()
};

const els = {};

document.addEventListener('DOMContentLoaded', init);

async function init() {
  bindElements();
  bindActions();
  showBoot('正在確認管理端 LINE 身分…');

  try {
    state.config = await loadConfig();
    validateConfig(state.config);
    const loggedIn = await ensureAdminLiffLogin();
    if (!loggedIn) return;
    await checkAuthorization();
  } catch (error) {
    showError(error && error.message ? error.message : '管理端 LINE 登入失敗。');
  }
}

function bindElements() {
  [
    'adminIdentity','refreshPermissionBtn','bootPanel','bootMessage','permissionPanel','errorPanel','errorMessage','workspace',
    'prevBtn','nextBtn','todayBtn','reloadBtn','monthTitle','calendarGrid',
    'eventForm','eventId','eventDate','eventType','eventStatus','eventTitle',
    'eventDescription','saveBtn','formMessage','resetBtn','editorTitle',
    'adminEventList','eventCount'
  ].forEach(id => { els[id] = document.getElementById(id); });
}

function bindActions() {
  els.refreshPermissionBtn.addEventListener('click', checkAuthorization);
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

  // LIFF Browser authenticates automatically during liff.init().
  // External browsers are forced through a fresh LINE Login on every page entry.
  if (!window.liff.isInClient()) {
    const freshReturn = new URL(window.location.href).searchParams.get(FRESH_LOGIN_PARAM) === '1';
    if (!freshReturn) {
      const redirectUri = freshLoginUrl();
      if (window.liff.isLoggedIn()) {
        window.liff.logout();
        window.location.replace(redirectUri);
        return false;
      }
      window.liff.login({ redirectUri });
      return false;
    }

    if (!window.liff.isLoggedIn()) {
      window.liff.login({ redirectUri: freshLoginUrl() });
      return false;
    }
  } else if (!window.liff.isLoggedIn()) {
    throw new Error('無法取得管理端 LINE 登入狀態，請關閉頁面後重新開啟。');
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

function freshLoginUrl() {
  const url = new URL(canonicalUrl());
  url.searchParams.set(FRESH_LOGIN_PARAM, '1');
  return url.href;
}

function canonicalizeUrl() {
  const cleanUrl = canonicalUrl();
  if (window.location.href !== cleanUrl) window.history.replaceState(null, '', cleanUrl);
}

async function checkAuthorization() {
  if (!state.idToken) return showError('管理端 LINE 登入狀態已失效，請重新整理。');
  els.refreshPermissionBtn.disabled = true;
  showBoot('正在讀取 AdminPermissions 權限…');

  try {
    const data = await apiRequest('admin.session', {});
    state.profile = data.profile || null;
    renderIdentity();

    const authorization = data.authorization || {};
    if (authorization.canManageCalendar === true && authorization.status === 'active') {
      showWorkspace();
      await loadMonth();
      return;
    }

    showPermissionRequired();
  } catch (error) {
    showError(error && error.message ? error.message : '無法確認管理權限。');
  } finally {
    els.refreshPermissionBtn.disabled = false;
  }
}

function renderIdentity() {
  const profile = state.profile || {};
  els.adminIdentity.textContent = profile.displayName || 'LINE 管理員';
  els.adminIdentity.hidden = false;
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
    });
    state.events = Array.isArray(data.events) ? data.events : [];
    state.eventsByDate = groupByDate(state.events);
    renderCalendar();
    renderAdminEventList();
    setFormMessage('');
  } catch (error) {
    if (isPermissionError(error)) {
      showPermissionRequired();
      return;
    }
    if (isLineAuthError(error)) {
      state.idToken = '';
      showError(error.message || '管理端 LINE 登入已失效。');
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
    const result = await apiRequest('admin.event.save', payload);
    setFormMessage(result.created ? '已新增日期設定。' : '已更新日期設定。', false, true);
    state.cursor = monthCursorFromDate(result.event.date);
    resetForm(false);
    await loadMonth();
  } catch (error) {
    if (isPermissionError(error)) return showPermissionRequired();
    if (isLineAuthError(error)) {
      state.idToken = '';
      return showError(error.message || '管理端 LINE 登入已失效。');
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
    await apiRequest('admin.event.delete', { eventId });
    if (els.eventId.value === eventId) resetForm();
    await loadMonth();
    setFormMessage('已封存日期設定。', false, true);
  } catch (error) {
    if (isPermissionError(error)) return showPermissionRequired();
    if (isLineAuthError(error)) {
      state.idToken = '';
      return showError(error.message || '管理端 LINE 登入已失效。');
    }
    setFormMessage(error && error.message ? error.message : '封存失敗。', true);
  }
}

async function apiRequest(action, payload) {
  if (!state.idToken) {
    const error = new Error('管理端 LINE 登入狀態已失效。');
    error.code = 'UNAUTHENTICATED';
    throw error;
  }

  const body = new URLSearchParams();
  body.set('action', action);
  body.set('idToken', state.idToken);
  body.set('payload', JSON.stringify(payload || {}));

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
    button.addEventListener('click', async () => {
      if (date.getMonth() !== month) {
        state.cursor = new Date(date.getFullYear(), date.getMonth(), 1);
        await loadMonth();
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

function setFormMessage(message, isError = false, isSuccess = false) {
  els.formMessage.textContent = message;
  els.formMessage.className = `message${isError ? ' error' : isSuccess ? ' success' : ''}`;
}

function showBoot(message) {
  els.bootMessage.textContent = message || '正在確認管理端 LINE 身分…';
  els.bootPanel.classList.remove('is-hidden');
  els.permissionPanel.classList.add('is-hidden');
  els.errorPanel.classList.add('is-hidden');
  els.workspace.classList.add('is-hidden');
}

function showPermissionRequired() {
  els.bootPanel.classList.add('is-hidden');
  els.errorPanel.classList.add('is-hidden');
  els.workspace.classList.add('is-hidden');
  els.permissionPanel.classList.remove('is-hidden');
}

function showWorkspace() {
  els.bootPanel.classList.add('is-hidden');
  els.permissionPanel.classList.add('is-hidden');
  els.errorPanel.classList.add('is-hidden');
  els.workspace.classList.remove('is-hidden');
}

function showError(message) {
  els.errorMessage.textContent = String(message || '請稍後再試。');
  els.bootPanel.classList.add('is-hidden');
  els.permissionPanel.classList.add('is-hidden');
  els.workspace.classList.add('is-hidden');
  els.errorPanel.classList.remove('is-hidden');
}

function isPermissionError(error) {
  return error && (error.code === 'FORBIDDEN' || error.code === 'DATA_INTEGRITY_ERROR');
}

function isLineAuthError(error) {
  return error && (error.code === 'UNAUTHENTICATED' || error.code === 'AUTH_SERVICE_UNAVAILABLE');
}
