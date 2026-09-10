(() => {
  'use strict';

  const state = {
    month: '',
    selectedDate: '',
    today: '',
    minAdvanceDays: 0,
    minimumDate: '',
    config: null,
    occupancyRequestSeq: 0,
    reloadTimer: 0,
    occupiedByDate: new Map(),
    lastDateTrigger: null,
  };

  const els = {};

  window.addEventListener('DOMContentLoaded', () => {
    [
      'bookingView', 'calendarMonthLabel', 'calendarGrid', 'previousMonthButton', 'nextMonthButton',
      'appointmentPanel', 'appointmentModalTitle', 'selectedDateSummary', 'changeDateButton', 'closeAppointmentButton',
      'bookingDate', 'servicePicker', 'selectedServiceList', 'bookingList', 'bookingConfirmModal'
    ].forEach((id) => { els[id] = document.getElementById(id); });

    if (!els.calendarGrid || !els.bookingDate || !els.servicePicker || !els.appointmentPanel) return;

    state.today = taipeiDate();
    state.minimumDate = state.today;
    state.month = state.today.slice(0, 7);
    renderCalendar();

    els.previousMonthButton?.addEventListener('click', () => changeMonth(-1));
    els.nextMonthButton?.addEventListener('click', () => changeMonth(1));
    els.changeDateButton?.addEventListener('click', () => closeAppointmentModal(true));
    els.closeAppointmentButton?.addEventListener('click', () => closeAppointmentModal(true));
    els.appointmentPanel.addEventListener('click', (event) => {
      if (event.target === els.appointmentPanel && window.matchMedia('(max-width: 768px)').matches) {
        closeAppointmentModal(true);
      }
    });
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      if (els.bookingConfirmModal && !els.bookingConfirmModal.classList.contains('hidden')) return;
      closeAppointmentModal(true);
    });

    window.addEventListener('booking:settings-updated', (event) => {
      applyGlobalSettings(event.detail || {});
    });
    window.addEventListener('booking:created', () => {
      closeAppointmentModal(false);
      scheduleMonthOccupancyReload();
    });

    const syncAfterSelectionEvent = () => window.setTimeout(syncAfterSelectionMutation, 0);
    els.servicePicker.addEventListener('click', syncAfterSelectionEvent);
    els.selectedServiceList?.addEventListener('click', syncAfterSelectionEvent);

    const pickerObserver = new MutationObserver(syncAfterSelectionMutation);
    pickerObserver.observe(els.servicePicker, { childList: true, subtree: true });

    if (els.bookingList) {
      const bookingObserver = new MutationObserver(scheduleMonthOccupancyReload);
      bookingObserver.observe(els.bookingList, { childList: true, subtree: true });
    }

    if (els.bookingView) {
      const viewObserver = new MutationObserver(() => {
        if (!els.bookingView.classList.contains('hidden')) loadMonthOccupancy();
      });
      viewObserver.observe(els.bookingView, { attributes: true, attributeFilter: ['class'] });
      if (!els.bookingView.classList.contains('hidden')) loadMonthOccupancy();
    }
  });

  function taipeiDate() {
    const parts = {};
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date()).forEach((part) => {
      if (part.type !== 'literal') parts[part.type] = part.value;
    });
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  function addDays(date, days) {
    const parsed = new Date(`${date}T00:00:00Z`);
    parsed.setUTCDate(parsed.getUTCDate() + Number(days || 0));
    return parsed.toISOString().slice(0, 10);
  }

  function shiftMonth(key, delta) {
    const [year, month] = String(key).split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1 + delta, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  function changeMonth(delta) {
    const minimumMonth = state.today.slice(0, 7);
    const next = shiftMonth(state.month, delta);
    if (next < minimumMonth) return;
    state.month = next;
    renderCalendar();
    loadMonthOccupancy();
  }

  function applyGlobalSettings(detail) {
    const today = String(detail.today || state.today || taipeiDate()).slice(0, 10);
    const rawDays = Number(detail.settings?.minAdvanceDays ?? state.minAdvanceDays ?? 0);
    const minAdvanceDays = Number.isInteger(rawDays) && rawDays >= 0 && rawDays <= 365 ? rawDays : 0;
    state.today = /^\d{4}-\d{2}-\d{2}$/.test(today) ? today : taipeiDate();
    state.minAdvanceDays = minAdvanceDays;
    state.minimumDate = addDays(state.today, minAdvanceDays);

    const actualDate = String(els.bookingDate?.value || '');
    if (actualDate && actualDate >= state.minimumDate && actualDate !== state.selectedDate) {
      state.selectedDate = actualDate;
      state.month = actualDate.slice(0, 7);
    } else if (state.selectedDate && state.selectedDate < state.minimumDate) {
      state.selectedDate = '';
      if (els.bookingDate) {
        els.bookingDate.value = '';
        els.bookingDate.disabled = true;
        els.bookingDate.dispatchEvent(new Event('change', { bubbles: true }));
      }
      closeAppointmentModal(false);
    }
    renderCalendar();
  }

  function renderCalendar() {
    const today = state.today || taipeiDate();
    const minimumDate = state.minimumDate || today;
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
      const isPast = date < today;
      const isAdvanceBlocked = !isPast && date < minimumDate;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'calendar-day';
      button.dataset.date = date;
      button.setAttribute('role', 'gridcell');
      button.setAttribute('aria-selected', state.selectedDate === date ? 'true' : 'false');
      button.disabled = isPast || isAdvanceBlocked;
      if (isPast) button.classList.add('past-disabled');
      if (isAdvanceBlocked) button.classList.add('advance-disabled');
      if (date === today) button.classList.add('today');
      if (date === state.selectedDate) button.classList.add('selected');

      const number = document.createElement('strong');
      number.className = 'calendar-day-number';
      number.textContent = String(day);
      button.appendChild(number);

      const intervals = state.occupiedByDate.get(date) || [];
      if (intervals.length) {
        button.classList.add('has-booking');
        const list = document.createElement('span');
        list.className = 'calendar-booking-times';
        intervals.slice(0, 2).forEach((interval) => {
          const label = document.createElement('small');
          label.textContent = `${interval.startTime}–${interval.endTime} 已預約`;
          list.appendChild(label);
        });
        if (intervals.length > 2) {
          const more = document.createElement('small');
          more.textContent = `+${intervals.length - 2} 個時段`;
          list.appendChild(more);
        }
        button.appendChild(list);
      }

      if (isAdvanceBlocked) {
        const reason = `需提前 ${state.minAdvanceDays} 天，最早可預約 ${formatDate(minimumDate)}`;
        button.title = reason;
        button.setAttribute('aria-label', `${formatDate(date)}，${reason}`);
      } else if (isPast) {
        button.title = '日期已過，無法預約';
        button.setAttribute('aria-label', `${formatDate(date)}，日期已過，無法預約`);
      } else {
        const occupiedText = intervals.length ? `，已有 ${intervals.length} 個預約時段` : '';
        button.setAttribute('aria-label', `${formatDate(date)}${occupiedText}，可開啟預約`);
        button.addEventListener('click', () => selectDate(date, button));
      }
      els.calendarGrid.appendChild(button);
    }
  }

  async function loadMonthOccupancy() {
    if (!window.BookingSystem || !window.liff || typeof window.liff.isLoggedIn !== 'function' || !window.liff.isLoggedIn()) return;
    const idToken = typeof window.liff.getIDToken === 'function' ? window.liff.getIDToken() : '';
    if (!idToken) return;

    const month = state.month;
    const requestSeq = ++state.occupancyRequestSeq;
    try {
      state.config = state.config || await window.BookingSystem.loadConfig();
      const result = await requestCalendar(state.config, idToken, month);
      if (requestSeq !== state.occupancyRequestSeq || month !== state.month) return;

      if (result.settings || result.today) {
        applyGlobalSettings({ settings: result.settings || {}, today: result.today || state.today });
      }
      if (typeof result.earliestBookingDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(result.earliestBookingDate)) {
        state.minimumDate = result.earliestBookingDate;
      }

      clearMonthEntries(month);
      for (const item of Array.isArray(result.occupiedDates) ? result.occupiedDates : []) {
        const date = String(item?.date || '').slice(0, 10);
        if (!date.startsWith(`${month}-`)) continue;
        const intervals = Array.isArray(item?.intervals)
          ? item.intervals.map((interval) => ({
              startTime: String(interval?.startTime || '').slice(0, 5),
              endTime: String(interval?.endTime || '').slice(0, 5),
            })).filter((interval) => /^\d{2}:\d{2}$/.test(interval.startTime) && /^\d{2}:\d{2}$/.test(interval.endTime))
          : [];
        if (intervals.length) state.occupiedByDate.set(date, intervals);
      }
      renderCalendar();
    } catch (_) {
      // Monthly occupancy is supplemental. Global advance rules also arrive from booking bootstrap.
    }
  }

  async function requestCalendar(config, idToken, month) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 15000);
    try {
      const endpoint = `${String(config.supabaseUrl).replace(/\/$/, '')}/functions/v1/booking-calendar-api`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': String(config.supabasePublishableKey),
        },
        cache: 'no-store',
        signal: controller.signal,
        body: JSON.stringify({ idToken, month }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload || payload.ok !== true) {
        const error = new Error(String(payload?.error?.message || '無法取得本月預約時段。'));
        error.code = String(payload?.error?.code || 'CALENDAR_API_ERROR');
        throw error;
      }
      return payload.data || {};
    } finally {
      window.clearTimeout(timer);
    }
  }

  function clearMonthEntries(month) {
    for (const date of [...state.occupiedByDate.keys()]) {
      if (String(date).startsWith(`${month}-`)) state.occupiedByDate.delete(date);
    }
  }

  function scheduleMonthOccupancyReload() {
    window.clearTimeout(state.reloadTimer);
    state.reloadTimer = window.setTimeout(loadMonthOccupancy, 350);
  }

  function selectDate(date, trigger) {
    if (date < (state.minimumDate || state.today)) return;
    state.selectedDate = date;
    state.lastDateTrigger = trigger || null;
    els.bookingDate.disabled = false;
    els.bookingDate.value = date;
    els.bookingDate.dispatchEvent(new Event('change', { bubbles: true }));
    renderCalendar();
    openAppointmentModal(date);
  }

  function openAppointmentModal(date) {
    if (els.selectedDateSummary) {
      els.selectedDateSummary.textContent = `${formatDate(date)}｜請選擇預約項目與時間`;
    }
    els.appointmentPanel.classList.remove('hidden');
    document.body.classList.add('booking-selection-open');
    window.setTimeout(() => els.closeAppointmentButton?.focus(), 0);
  }

  function closeAppointmentModal(returnFocus) {
    if (!els.appointmentPanel || els.appointmentPanel.classList.contains('hidden')) return;
    els.appointmentPanel.classList.add('hidden');
    document.body.classList.remove('booking-selection-open');
    if (returnFocus) window.setTimeout(() => state.lastDateTrigger?.focus(), 0);
  }

  function syncAfterSelectionMutation() {
    if (!state.selectedDate) return;

    if (!els.bookingDate.value) {
      els.bookingDate.disabled = false;
      els.bookingDate.value = state.selectedDate;
      if (els.selectedDateSummary) els.selectedDateSummary.textContent = `${formatDate(state.selectedDate)}｜請選擇預約項目與時間`;
      return;
    }

    const actualDate = els.bookingDate.value;
    if (actualDate !== state.selectedDate) {
      state.selectedDate = actualDate;
      state.month = actualDate.slice(0, 7);
      renderCalendar();
      loadMonthOccupancy();
    }
    if (els.selectedDateSummary) els.selectedDateSummary.textContent = `${formatDate(actualDate)}｜請選擇預約項目與時間`;
  }

  function formatDate(date) {
    if (window.BookingSystem?.formatDate) return window.BookingSystem.formatDate(date);
    const [year, month, day] = String(date).split('-');
    return `${year}/${month}/${day}`;
  }
})();