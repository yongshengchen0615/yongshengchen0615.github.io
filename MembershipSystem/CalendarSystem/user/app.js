'use strict';

const state = {
  config: null,
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
    els.appTitle.textContent = state.config.appName || '營業日曆';
    if (!state.config.apiUrl) throw new Error('尚未設定 GAS API URL。');
    await loadMonth();
  } catch (error) {
    setStatus(error.message || '載入失敗。', true);
    renderCalendar();
    renderEventList();
  }
}

function bindElements() {
  ['appTitle','todayBtn','prevBtn','nextBtn','monthTitle','loadStatus','calendarGrid','eventList','dayDialog','dialogDate','dialogEvents']
    .forEach(id => { els[id] = document.getElementById(id); });
}

function bindActions() {
  els.prevBtn.addEventListener('click', () => changeMonth(-1));
  els.nextBtn.addEventListener('click', () => changeMonth(1));
  els.todayBtn.addEventListener('click', async () => {
    const now = new Date();
    state.cursor = new Date(now.getFullYear(), now.getMonth(), 1);
    await loadMonth();
  });
}

async function loadConfig() {
  const response = await fetch('../config.json', { cache: 'no-store' });
  if (!response.ok) throw new Error('無法讀取 config.json。');
  return response.json();
}

async function changeMonth(delta) {
  state.cursor = new Date(state.cursor.getFullYear(), state.cursor.getMonth() + delta, 1);
  await loadMonth();
}

async function loadMonth() {
  setStatus('載入中…');
  renderMonthHeading();
  try {
    const data = await apiRequest('calendar.month', {
      year: state.cursor.getFullYear(),
      month: state.cursor.getMonth() + 1
    });
    state.events = Array.isArray(data.events) ? data.events : [];
    state.eventsByDate = groupByDate(state.events);
    renderCalendar();
    renderEventList();
    setStatus('');
  } catch (error) {
    state.events = [];
    state.eventsByDate = new Map();
    renderCalendar();
    renderEventList();
    setStatus(error.message || '無法載入日曆。', true);
  }
}

async function apiRequest(action, payload) {
  const body = new URLSearchParams();
  body.set('action', action);
  body.set('payload', JSON.stringify(payload || {}));

  const response = await fetch(state.config.apiUrl, {
    method: 'POST',
    body,
    redirect: 'follow'
  });
  if (!response.ok) throw new Error(`服務連線失敗 (${response.status})`);
  const result = await response.json();
  if (!result.ok) throw new Error(result.error?.message || '服務暫時無法使用。');
  return result.data || {};
}

function groupByDate(events) {
  const map = new Map();
  events.forEach(event => {
    if (!map.has(event.date)) map.set(event.date, []);
    map.get(event.date).push(event);
  });
  return map;
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
    button.setAttribute('role', 'gridcell');
    button.setAttribute('aria-label', buildDayLabel(date, dayEvents));
    const isOutside = date.getMonth() !== month;
    if (isOutside) button.classList.add('outside');
    if (dateKey === todayKey) button.classList.add('today');
    button.addEventListener('click', async () => {
      if (isOutside) {
        state.cursor = new Date(date.getFullYear(), date.getMonth(), 1);
        await loadMonth();
      }
      openDay(dateKey);
    });

    const number = document.createElement('span');
    number.className = 'day-number';
    number.textContent = String(date.getDate());
    button.appendChild(number);

    const markerWrap = document.createElement('span');
    markerWrap.className = 'day-markers';
    dayEvents.slice(0, 2).forEach(event => {
      const marker = document.createElement('span');
      marker.className = `day-marker ${event.type}`;
      marker.textContent = event.title;
      markerWrap.appendChild(marker);
    });
    if (dayEvents.length > 2) {
      const more = document.createElement('span');
      more.className = 'more-marker';
      more.textContent = `另有 ${dayEvents.length - 2} 項`;
      markerWrap.appendChild(more);
    }
    button.appendChild(markerWrap);
    els.calendarGrid.appendChild(button);
  }
}

function renderEventList() {
  els.eventList.textContent = '';
  if (!state.events.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = '本月目前沒有已發布的休假或活動。';
    els.eventList.appendChild(empty);
    return;
  }

  state.events
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title, 'zh-Hant'))
    .forEach(event => {
      const row = document.createElement('article');
      row.className = 'event-row';
      row.addEventListener('click', () => openDay(event.date));
      row.tabIndex = 0;
      row.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') openDay(event.date);
      });

      const date = document.createElement('div');
      date.className = 'event-date';
      date.textContent = formatShortDate(event.date);

      const content = document.createElement('div');
      const title = document.createElement('h3');
      const pill = document.createElement('span');
      pill.className = `type-pill ${event.type}`;
      pill.textContent = event.type === 'holiday' ? '休假' : '活動';
      title.appendChild(pill);
      title.appendChild(document.createTextNode(event.title));
      const desc = document.createElement('p');
      desc.textContent = event.description || '點選日期查看說明。';
      content.append(title, desc);
      row.append(date, content);
      els.eventList.appendChild(row);
    });
}

function openDay(dateKey) {
  const events = state.eventsByDate.get(dateKey) || [];
  els.dialogDate.textContent = formatLongDate(dateKey);
  els.dialogEvents.textContent = '';

  if (!events.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = '當日沒有休假或活動說明。';
    els.dialogEvents.appendChild(empty);
  } else {
    events.forEach(event => {
      const article = document.createElement('article');
      article.className = 'dialog-event';
      const pill = document.createElement('span');
      pill.className = `type-pill ${event.type}`;
      pill.textContent = event.type === 'holiday' ? '休假日' : '活動日';
      const title = document.createElement('h3');
      title.textContent = event.title;
      const desc = document.createElement('p');
      desc.textContent = event.description || '無其他說明。';
      article.append(pill, title, desc);
      els.dialogEvents.appendChild(article);
    });
  }

  if (typeof els.dayDialog.showModal === 'function') els.dayDialog.showModal();
  else els.dayDialog.setAttribute('open', '');
}

function buildDayLabel(date, events) {
  const base = `${date.getFullYear()}年${date.getMonth()+1}月${date.getDate()}日`;
  return events.length ? `${base}，${events.length} 項日曆資訊` : `${base}，無日曆資訊`;
}

function toDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseDateKey(value) {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function formatShortDate(value) {
  const d = parseDateKey(value);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function formatLongDate(value) {
  const d = parseDateKey(value);
  return new Intl.DateTimeFormat('zh-TW', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long'
  }).format(d);
}

function setStatus(message, isError = false) {
  els.loadStatus.textContent = message;
  els.loadStatus.style.color = isError ? '#9d362c' : '';
}
