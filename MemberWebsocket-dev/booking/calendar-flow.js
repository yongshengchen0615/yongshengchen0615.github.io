(() => {
  'use strict';

  const state = {
    month: '',
    selectedDate: '',
    occupiedByDate: new Map(),
  };

  const els = {};

  window.addEventListener('DOMContentLoaded', () => {
    ['calendarMonthLabel', 'calendarGrid', 'previousMonthButton', 'nextMonthButton', 'appointmentPanel', 'selectedDateSummary', 'changeDateButton', 'bookingDate', 'serviceSelect', 'slotGrid']
      .forEach((id) => { els[id] = document.getElementById(id); });

    if (!els.calendarGrid || !els.bookingDate || !els.serviceSelect) return;

    const today = taipeiDate();
    state.month = today.slice(0, 7);
    renderCalendar();

    els.previousMonthButton?.addEventListener('click', () => changeMonth(-1));
    els.nextMonthButton?.addEventListener('click', () => changeMonth(1));
    els.changeDateButton?.addEventListener('click', focusSelectedDate);
    els.serviceSelect.addEventListener('change', syncAfterServiceChange);

    const observer = new MutationObserver(syncOccupiedSlots);
    observer.observe(els.slotGrid, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
  });

  function taipeiDate() {
    const parts = {};
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Taipei',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date()).forEach((part) => {
      if (part.type !== 'literal') parts[part.type] = part.value;
    });
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  function taipeiMinutes() {
    const parts = {};
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Taipei',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date()).forEach((part) => {
      if (part.type !== 'literal') parts[part.type] = part.value;
    });
    return Number(parts.hour || 0) * 60 + Number(parts.minute || 0);
  }

  function timeToMinutes(value) {
    const [hour, minute] = String(value || '').slice(0, 5).split(':').map(Number);
    return Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : -1;
  }

  function shiftMonth(key, delta) {
    const [year, month] = String(key).split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1 + delta, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  function changeMonth(delta) {
    const todayMonth = taipeiDate().slice(0, 7);
    const next = shiftMonth(state.month, delta);
    if (next < todayMonth) return;
    state.month = next;
    renderCalendar();
  }

  function renderCalendar() {
    const today = taipeiDate();
    const [year, month] = state.month.split('-').map(Number);
    const firstDay = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
    const dayCount = new Date(Date.UTC(year, month, 0)).getUTCDate();

    els.calendarMonthLabel.textContent = `${year} 年 ${month} 月`;
    if (els.previousMonthButton) els.previousMonthButton.disabled = state.month <= today.slice(0, 7);
    els.calendarGrid.replaceChildren();

    for (let index = 0; index < 42; index += 1) {
      const day = index - firstDay + 1;
      if (day < 1 || day > dayCount) {
        const blank = document.createElement('span');
        blank.className = 'calendar-day-placeholder';
        blank.setAttribute('aria-hidden', 'true');
        els.calendarGrid.appendChild(blank);
        continue;
      }

      const date = `${state.month}-${String(day).padStart(2, '0')}`;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'calendar-day';
      button.dataset.date = date;
      button.setAttribute('role', 'gridcell');
      button.setAttribute('aria-selected', state.selectedDate === date ? 'true' : 'false');
      button.disabled = date < today;
      if (date === today) button.classList.add('today');
      if (date === state.selectedDate) button.classList.add('selected');

      const number = document.createElement('strong');
      number.className = 'calendar-day-number';
      number.textContent = String(day);
      button.appendChild(number);

      const occupied = state.occupiedByDate.get(date) || [];
      if (occupied.length) {
        button.classList.add('has-booking');
        const times = document.createElement('span');
        times.className = 'calendar-booking-times';
        occupied.slice(0, 2).forEach((time) => {
          const label = document.createElement('small');
          label.textContent = `${time} 已預約`;
          times.appendChild(label);
        });
        if (occupied.length > 2) {
          const more = document.createElement('small');
          more.textContent = `+${occupied.length - 2} 個時段`;
          times.appendChild(more);
        }
        button.appendChild(times);
      }

      if (!button.disabled) button.addEventListener('click', () => selectDate(date));
      els.calendarGrid.appendChild(button);
    }
  }

  function selectDate(date) {
    state.selectedDate = date;
    els.bookingDate.disabled = false;
    els.bookingDate.value = date;
    els.bookingDate.dispatchEvent(new Event('change', { bubbles: true }));
    renderCalendar();

    if (els.appointmentPanel) els.appointmentPanel.classList.remove('hidden');
    if (els.selectedDateSummary) els.selectedDateSummary.textContent = `${formatDate(date)}｜請選擇預約項目與時間`;

    window.setTimeout(() => {
      syncAfterServiceChange();
      els.appointmentPanel?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 0);
  }

  function syncAfterServiceChange() {
    if (!state.selectedDate) return;
    const actualDate = els.bookingDate.value || state.selectedDate;
    if (actualDate !== state.selectedDate) {
      state.selectedDate = actualDate;
      state.month = actualDate.slice(0, 7);
      renderCalendar();
    }
    if (els.selectedDateSummary) els.selectedDateSummary.textContent = `${formatDate(actualDate)}｜請選擇預約項目與時間`;
  }

  function syncOccupiedSlots() {
    if (!state.selectedDate) return;
    const today = taipeiDate();
    const nowMinutes = taipeiMinutes();
    const occupied = [...els.slotGrid.querySelectorAll('.slot-button:disabled')]
      .map((button) => String(button.textContent || '').trim().match(/\d{2}:\d{2}/)?.[0] || '')
      .filter(Boolean)
      .filter((time) => state.selectedDate > today || timeToMinutes(time) > nowMinutes);

    state.occupiedByDate.set(state.selectedDate, [...new Set(occupied)]);
    renderCalendar();
  }

  function focusSelectedDate() {
    const target = state.selectedDate
      ? els.calendarGrid.querySelector(`[data-date="${state.selectedDate}"]`)
      : els.calendarGrid.querySelector('.calendar-day:not(:disabled)');
    target?.focus();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function formatDate(date) {
    if (window.BookingSystem?.formatDate) return window.BookingSystem.formatDate(date);
    const [year, month, day] = String(date).split('-');
    return `${year}/${month}/${day}`;
  }
})();
