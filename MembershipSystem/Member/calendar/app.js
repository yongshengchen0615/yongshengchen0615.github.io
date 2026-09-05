(() => {
  'use strict';

  const state = { config: null, idToken: '', items: [], visibleMonth: firstOfMonth(taipeiToday()), detailTrigger: null };
  const els = {};

  window.addEventListener('DOMContentLoaded', () => {
    ['app', 'loadingView', 'errorView', 'errorTitle', 'errorMessage', 'retryButton', 'calendarView', 'displayName', 'logoutButton', 'previousMonthButton', 'nextMonthButton', 'todayButton', 'monthTitle', 'calendarSummary', 'calendarGrid', 'emptyView', 'calendarDetailModal', 'closeCalendarDetailButton', 'calendarDetailType', 'calendarDetailAccent', 'calendarDetailTitle', 'calendarDetailDate', 'calendarDetailDescription'].forEach((id) => { els[id] = document.getElementById(id); });
    els.retryButton.addEventListener('click', () => window.location.reload());
    els.logoutButton.addEventListener('click', () => window.MemberSystem.logout());
    els.previousMonthButton.addEventListener('click', () => changeMonth(-1));
    els.nextMonthButton.addEventListener('click', () => changeMonth(1));
    els.todayButton.addEventListener('click', () => { state.visibleMonth = firstOfMonth(taipeiToday()); loadCalendar(true); });
    els.calendarGrid.addEventListener('click', handleCalendarItemClick);
    els.closeCalendarDetailButton.addEventListener('click', closeCalendarItemDetail);
    els.calendarDetailModal.addEventListener('click', (event) => { if (event.target === els.calendarDetailModal) closeCalendarItemDetail(); });
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeCalendarItemDetail(); });
    boot();
  });

  async function boot() {
    setView('loading');
    try {
      state.config = await window.MemberSystem.loadConfig();
      state.idToken = await window.MemberSystem.signIn(state.config, 'calendar');
      await loadCalendar(false);
      setView('calendar');
    } catch (error) {
      showError(error);
    } finally {
      els.app.setAttribute('aria-busy', 'false');
    }
  }

  async function changeMonth(offset) {
    state.visibleMonth = addMonths(state.visibleMonth, offset);
    await loadCalendar(true);
  }

  async function loadCalendar(showBusy) {
    closeCalendarItemDetail(false);
    if (showBusy) {
      els.previousMonthButton.disabled = true;
      els.nextMonthButton.disabled = true;
      els.calendarSummary.textContent = '同步中…';
    }
    try {
      const range = visibleRangeForMonth(state.visibleMonth);
      const result = await window.MemberSystem.request(state.config, 'calendar', state.idToken, 'user.calendar.bootstrap', { rangeStart: range.start, rangeEnd: range.end });
      state.items = Array.isArray(result.items) ? result.items : [];
      els.displayName.textContent = String(result.profile && result.profile.displayName || 'LINE 使用者');
      renderCalendar();
    } catch (error) {
      if (!showBusy) throw error;
      showError(error);
    } finally {
      if (showBusy) {
        els.previousMonthButton.disabled = false;
        els.nextMonthButton.disabled = false;
      }
    }
  }

  function renderCalendar() {
    const range = visibleRangeForMonth(state.visibleMonth);
    els.monthTitle.textContent = new Intl.DateTimeFormat('zh-Hant-TW', { timeZone: 'UTC', year: 'numeric', month: 'long' }).format(state.visibleMonth);
    els.calendarGrid.replaceChildren(...weekdayHeaders(), ...calendarDays(range));
    const holidayCount = state.items.filter((item) => item.itemType === 'holiday').length;
    const eventCount = state.items.filter((item) => item.itemType === 'event').length;
    els.calendarSummary.textContent = state.items.length ? String(state.items.length) + ' 個日期 · ' + String(holidayCount) + ' 個休假日 · ' + String(eventCount) + ' 個活動' : '這段期間尚未設定日期';
    els.emptyView.classList.toggle('hidden', state.items.length !== 0);
  }

  function weekdayHeaders() {
    return ['日', '一', '二', '三', '四', '五', '六'].map((label) => {
      const heading = document.createElement('div');
      heading.className = 'weekday';
      heading.textContent = label;
      return heading;
    });
  }

  function calendarDays(range) {
    const result = [];
    let current = parseIsoDate(range.start);
    const end = parseIsoDate(range.end);
    const today = taipeiToday();
    while (current && end && current <= end) {
      const isoDate = toIsoDate(current);
      const cell = document.createElement('article');
      cell.className = 'calendar-day' + (current.getUTCMonth() !== state.visibleMonth.getUTCMonth() ? ' outside' : '') + (isoDate === today ? ' today' : '');
      const number = document.createElement('span');
      number.className = 'day-number';
      number.textContent = String(current.getUTCDate());
      cell.append(number);
      const entries = state.items.filter((item) => itemOnDate(item, isoDate));
      entries.forEach((item) => cell.append(createCalendarItem(item)));
      result.push(cell);
      current.setUTCDate(current.getUTCDate() + 1);
    }
    return result;
  }

  function createCalendarItem(item) {
    const entry = document.createElement('button');
    entry.type = 'button';
    entry.className = 'calendar-item ' + (item.itemType === 'holiday' ? 'holiday' : 'event');
    entry.dataset.calendarItemId = String(item.calendarItemId || '');
    entry.setAttribute('aria-haspopup', 'dialog');
    entry.setAttribute('aria-label', `查看${String(item.title || (item.itemType === 'holiday' ? '休假日' : '活動'))}的日期說明`);
    entry.style.setProperty('--item-accent', safeAccent(item.accent));
    const marker = document.createElement('i');
    marker.setAttribute('aria-hidden', 'true');
    const title = document.createElement('span');
    title.textContent = String(item.title || (item.itemType === 'holiday' ? '休假日' : '活動'));
    entry.append(marker, title);
    return entry;
  }

  function handleCalendarItemClick(event) {
    const trigger = event.target instanceof Element ? event.target.closest('[data-calendar-item-id]') : null;
    if (!trigger) return;
    const item = state.items.find((value) => String(value.calendarItemId || '') === String(trigger.dataset.calendarItemId || ''));
    if (item) openCalendarItemDetail(item, trigger);
  }

  function openCalendarItemDetail(item, trigger) {
    state.detailTrigger = trigger instanceof HTMLElement ? trigger : null;
    const isHoliday = item.itemType === 'holiday';
    els.calendarDetailType.textContent = isHoliday ? '休假日' : '活動';
    els.calendarDetailType.className = 'calendar-detail-type ' + (isHoliday ? 'holiday' : 'event');
    els.calendarDetailAccent.style.background = safeAccent(item.accent);
    els.calendarDetailTitle.textContent = String(item.title || (isHoliday ? '休假日' : '活動'));
    els.calendarDetailDate.textContent = calendarItemDateRange(item.startsOn, item.endsOn);
    els.calendarDetailDescription.textContent = String(item.description || '尚未提供其他說明。');
    els.calendarDetailModal.classList.remove('hidden');
    els.closeCalendarDetailButton.focus();
  }

  function closeCalendarItemDetail(restoreFocus = true) {
    if (!els.calendarDetailModal || els.calendarDetailModal.classList.contains('hidden')) return;
    els.calendarDetailModal.classList.add('hidden');
    const trigger = state.detailTrigger;
    state.detailTrigger = null;
    if (restoreFocus && trigger && document.contains(trigger)) trigger.focus();
  }

  function calendarItemDateRange(startsOn, endsOn) {
    const start = parseIsoDate(startsOn);
    const end = parseIsoDate(endsOn || startsOn);
    const format = (date) => new Intl.DateTimeFormat('zh-Hant-TW', { timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' }).format(date);
    if (!start || !end) return '日期未設定';
    return startsOn === (endsOn || startsOn) ? format(start) : `${format(start)} 至 ${format(end)}`;
  }

  function itemOnDate(item, date) {
    const startsOn = String(item && item.startsOn || '');
    const endsOn = String(item && item.endsOn || startsOn);
    return Boolean(startsOn && endsOn && startsOn <= date && endsOn >= date);
  }

  function visibleRangeForMonth(month) {
    const first = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1));
    const start = new Date(first);
    start.setUTCDate(start.getUTCDate() - start.getUTCDay());
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 41);
    return { start: toIsoDate(start), end: toIsoDate(end) };
  }

  function taipeiToday() {
    const values = {};
    new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).forEach((part) => { if (part.type !== 'literal') values[part.type] = part.value; });
    return values.year + '-' + values.month + '-' + values.day;
  }

  function firstOfMonth(value) {
    const date = parseIsoDate(value);
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  }

  function addMonths(date, amount) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + Number(amount || 0), 1));
  }

  function parseIsoDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
    if (!match) return null;
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    return date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() === Number(match[2]) - 1 && date.getUTCDate() === Number(match[3]) ? date : null;
  }

  function toIsoDate(date) {
    return date.toISOString().slice(0, 10);
  }

  function safeAccent(value) {
    return /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value) : '#df6b4d';
  }

  function setView(view) {
    els.loadingView.classList.toggle('hidden', view !== 'loading');
    els.errorView.classList.toggle('hidden', view !== 'error');
    els.calendarView.classList.toggle('hidden', view !== 'calendar');
  }

  function showError(error) {
    els.errorTitle.textContent = error && error.code === 'CONFIG_ERROR' ? '系統尚未完成設定' : '活動日曆暫時無法載入';
    els.errorMessage.textContent = error && error.message ? error.message : '請稍後重新整理再試。';
    setView('error');
  }
})();
