(() => {
  'use strict';

  const initialMonth = firstOfMonth(taipeiToday());
  const state = { config: null, idToken: '', profile: null, items: [], initialMonth: initialMonth, visibleMonth: initialMonth, detailTrigger: null, lastWheelNavigationAt: 0, touchStart: null, suppressCalendarDayClickUntil: 0 };
  const els = {};

  window.addEventListener('DOMContentLoaded', () => {
    ['app', 'loadingView', 'errorView', 'errorTitle', 'errorMessage', 'retryButton', 'calendarView', 'displayName', 'membershipProgress', 'logoutButton', 'previousMonthButton', 'nextMonthButton', 'todayButton', 'monthTitle', 'calendarSummary', 'calendarRangeNotice', 'calendarGrid', 'emptyView', 'calendarDetailModal', 'closeCalendarDetailButton', 'calendarDetailTitle', 'calendarDetailDate', 'calendarDetailItems'].forEach((id) => { els[id] = document.getElementById(id); });
    els.retryButton.addEventListener('click', () => window.location.reload());
    els.logoutButton.addEventListener('click', () => window.MemberSystem.logout());
    els.previousMonthButton.addEventListener('click', () => changeMonth(-1));
    els.nextMonthButton.addEventListener('click', () => changeMonth(1));
    els.todayButton.addEventListener('click', showInitialMonth);
    els.calendarGrid.addEventListener('click', handleCalendarDayClick);
    els.calendarGrid.addEventListener('touchstart', handleCalendarTouchStart, { passive: true });
    els.calendarGrid.addEventListener('touchend', handleCalendarTouchEnd, { passive: true });
    els.calendarGrid.addEventListener('wheel', handleCalendarWheel, { passive: false });
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
      await loadCalendar();
      setView('calendar');
    } catch (error) {
      showError(error);
    } finally {
      els.app.setAttribute('aria-busy', 'false');
    }
  }

  function changeMonth(offset) {
    const nextMonth = addMonths(state.visibleMonth, offset);
    if (!isLoadedCalendarMonth(nextMonth)) {
      showCalendarRangeNotice();
      return;
    }
    closeCalendarItemDetail(false);
    state.visibleMonth = nextMonth;
    clearCalendarRangeNotice();
    renderCalendar();
  }

  function showInitialMonth() {
    closeCalendarItemDetail(false);
    state.visibleMonth = state.initialMonth;
    clearCalendarRangeNotice();
    renderCalendar();
  }

  async function loadCalendar() {
    const range = initialCalendarDataRange(state.initialMonth);
    try {
      const result = await window.MemberSystem.request(state.config, 'calendar', state.idToken, 'user.calendar.bootstrap', { rangeStart: range.start, rangeEnd: range.end });
      state.profile = result.profile && typeof result.profile === 'object' ? result.profile : {};
      state.items = Array.isArray(result.items) ? result.items : [];
      els.displayName.textContent = String(state.profile.displayName || 'LINE 使用者');
      window.MembershipProgress.render(els.membershipProgress, state.profile);
      renderCalendar();
    } catch (error) {
      throw error;
    }
  }

  function renderCalendar() {
    const visibleRange = visibleRangeForMonth(state.visibleMonth);
    const monthRange = calendarMonthRange(state.visibleMonth);
    const visibleItems = state.items.filter((item) => calendarItemOverlapsRange(item, monthRange.start, monthRange.end));
    const holidayCount = visibleItems.filter((item) => item.itemType === 'holiday').length;
    const eventCount = visibleItems.filter((item) => item.itemType === 'event').length;
    els.monthTitle.textContent = calendarMonthLabel(state.visibleMonth);
    els.calendarGrid.replaceChildren(...weekdayHeaders(), ...calendarDays(visibleRange));
    els.calendarSummary.textContent = visibleItems.length ? String(visibleItems.length) + ' 個日期 · ' + String(holidayCount) + ' 個休假日 · ' + String(eventCount) + ' 個活動' : '這個月尚未設定日期';
    els.emptyView.classList.toggle('hidden', visibleItems.length !== 0);
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
      const entries = state.items.filter((item) => itemOnDate(item, isoDate));
      const cell = document.createElement(entries.length ? 'button' : 'article');
      cell.className = 'calendar-day' + (current.getUTCMonth() !== state.visibleMonth.getUTCMonth() ? ' outside' : '') + (isoDate === today ? ' today' : '');
      if (entries.length) {
        cell.type = 'button';
        cell.classList.add('has-entries');
        cell.dataset.calendarDate = isoDate;
        cell.setAttribute('aria-haspopup', 'dialog');
        cell.setAttribute('aria-label', `查看${calendarDateLabel(isoDate)}的 ${entries.length} 項日期說明`);
      }
      const number = document.createElement('span');
      number.className = 'day-number';
      number.textContent = String(current.getUTCDate());
      cell.append(number);
      entries.forEach((item) => cell.append(createCalendarItem(item)));
      result.push(cell);
      current.setUTCDate(current.getUTCDate() + 1);
    }
    return result;
  }

  function createCalendarItem(item) {
    const entry = document.createElement('span');
    entry.className = 'calendar-item ' + (item.itemType === 'holiday' ? 'holiday' : 'event');
    entry.style.setProperty('--item-accent', safeAccent(item.accent));
    const marker = document.createElement('i');
    marker.setAttribute('aria-hidden', 'true');
    const title = document.createElement('span');
    title.textContent = String(item.title || (item.itemType === 'holiday' ? '休假日' : '活動'));
    entry.append(marker, title);
    return entry;
  }

  function handleCalendarDayClick(event) {
    if (Date.now() < state.suppressCalendarDayClickUntil) return;
    const trigger = event.target instanceof Element ? event.target.closest('[data-calendar-date]') : null;
    if (!trigger) return;
    const isoDate = String(trigger.dataset.calendarDate || '');
    if (parseIsoDate(isoDate)) openCalendarDateDetails(isoDate, trigger);
  }

  function handleCalendarTouchStart(event) {
    const touch = event.touches && event.touches.length === 1 ? event.touches[0] : null;
    state.touchStart = touch ? { x: touch.clientX, y: touch.clientY } : null;
  }

  function handleCalendarTouchEnd(event) {
    const start = state.touchStart;
    const touch = event.changedTouches && event.changedTouches.length === 1 ? event.changedTouches[0] : null;
    state.touchStart = null;
    if (!start || !touch) return;
    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    if (Math.abs(deltaX) < 48 || Math.abs(deltaX) <= Math.abs(deltaY)) return;
    state.suppressCalendarDayClickUntil = Date.now() + 500;
    changeMonth(deltaX < 0 ? 1 : -1);
  }

  function handleCalendarWheel(event) {
    if (!event.deltaY) return;
    event.preventDefault();
    const now = Date.now();
    if (now - state.lastWheelNavigationAt < 450) return;
    state.lastWheelNavigationAt = now;
    changeMonth(event.deltaY > 0 ? 1 : -1);
  }

  function openCalendarDateDetails(isoDate, trigger) {
    const items = state.items.filter((item) => itemOnDate(item, isoDate));
    if (!items.length) return;
    state.detailTrigger = trigger instanceof HTMLElement ? trigger : null;
    els.calendarDetailTitle.textContent = calendarDateLabel(isoDate);
    els.calendarDetailDate.textContent = `${items.length} 項相關日期說明`;
    els.calendarDetailItems.replaceChildren(...items.map(createCalendarDetailItem));
    els.calendarDetailModal.classList.remove('hidden');
    els.closeCalendarDetailButton.focus();
  }

  function createCalendarDetailItem(item) {
    const detail = document.createElement('section');
    detail.className = 'calendar-detail-item';
    detail.style.setProperty('--item-accent', safeAccent(item.accent));
    const title = document.createElement('h3');
    title.textContent = String(item.title || (item.itemType === 'holiday' ? '休假日' : '活動'));
    const description = document.createElement('p');
    description.textContent = String(item.description || '尚未提供其他說明。');
    detail.append(title, description);
    return detail;
  }

  function closeCalendarItemDetail(restoreFocus = true) {
    if (!els.calendarDetailModal || els.calendarDetailModal.classList.contains('hidden')) return;
    els.calendarDetailModal.classList.add('hidden');
    const trigger = state.detailTrigger;
    state.detailTrigger = null;
    if (restoreFocus && trigger && document.contains(trigger)) trigger.focus();
  }

  function calendarDateLabel(isoDate) {
    const date = parseIsoDate(isoDate);
    return date ? new Intl.DateTimeFormat('zh-Hant-TW', { timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' }).format(date) : '日期說明';
  }

  function itemOnDate(item, date) {
    const startsOn = String(item && item.startsOn || '');
    const endsOn = String(item && item.endsOn || startsOn);
    return Boolean(startsOn && endsOn && startsOn <= date && endsOn >= date);
  }

  function calendarItemOverlapsRange(item, start, end) {
    const startsOn = String(item && item.startsOn || '');
    const endsOn = String(item && item.endsOn || startsOn);
    return Boolean(startsOn && endsOn && startsOn <= end && endsOn >= start);
  }

  function visibleRangeForMonth(month) {
    const first = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1));
    const start = new Date(first);
    start.setUTCDate(start.getUTCDate() - start.getUTCDay());
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 41);
    return { start: toIsoDate(start), end: toIsoDate(end) };
  }

  function calendarMonthRange(month) {
    const start = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1));
    const end = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0));
    return { start: toIsoDate(start), end: toIsoDate(end) };
  }

  function initialCalendarDataRange(month) {
    const previousMonth = addMonths(month, -1);
    const nextMonth = addMonths(month, 1);
    return { start: calendarMonthRange(previousMonth).start, end: calendarMonthRange(nextMonth).end };
  }

  function isLoadedCalendarMonth(month) {
    const distance = (month.getUTCFullYear() - state.initialMonth.getUTCFullYear()) * 12 + month.getUTCMonth() - state.initialMonth.getUTCMonth();
    return distance >= -1 && distance <= 1;
  }

  function showCalendarRangeNotice() {
    const first = calendarMonthLabel(addMonths(state.initialMonth, -1));
    const last = calendarMonthLabel(addMonths(state.initialMonth, 1));
    els.calendarRangeNotice.textContent = `目前僅載入 ${first} 至 ${last} 的資料；請回到這三個月份查看。`;
    els.calendarRangeNotice.classList.remove('hidden');
  }

  function clearCalendarRangeNotice() {
    els.calendarRangeNotice.textContent = '';
    els.calendarRangeNotice.classList.add('hidden');
  }

  function calendarMonthLabel(month) {
    return new Intl.DateTimeFormat('zh-Hant-TW', { timeZone: 'UTC', year: 'numeric', month: 'long' }).format(month);
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
