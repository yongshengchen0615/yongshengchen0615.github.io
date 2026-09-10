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
    holidaysByDate: new Map(),
    lastDateTrigger: null,
    holidayTrigger: null,
  };

  const els = {};

  window.addEventListener('DOMContentLoaded', () => {
    [
      'bookingView', 'calendarMonthLabel', 'calendarGrid', 'previousMonthButton', 'nextMonthButton',
      'appointmentPanel', 'appointmentModalTitle', 'selectedDateSummary', 'changeDateButton', 'closeAppointmentButton',
      'bookingDate', 'servicePicker', 'selectedServiceList', 'bookingList', 'bookingConfirmModal'
    ].forEach((id) => { els[id] = document.getElementById(id); });

    if (!els.calendarGrid || !els.bookingDate || !els.servicePicker || !els.appointmentPanel) return;

    ensureHolidayUi();
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
      if (els.holidayModal && !els.holidayModal.classList.contains('hidden')) {
        closeHolidayNotice(true);
        return;
      }
      closeAppointmentModal(true);
    });

    window.addEventListener('booking:settings-updated', (event) => {
      applyGlobalSettings(event.detail || {});
      scheduleMonthOccupancyReload();
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

  function ensureHolidayUi() {
    const bookingCard = els.calendarGrid.closest('.booking-card');
    const calendarShell = els.calendarGrid.closest('.calendar-shell');
    if (bookingCard && calendarShell && !document.getElementById('bookingNotice')) {
      const notice = document.createElement('div');
      notice.id = 'bookingNotice';
      notice.className = 'service-info booking-shop-notice hidden';
      notice.setAttribute('role', 'note');
      const heading = document.createElement('strong');
      heading.textContent = '店家預約說明：';
      const body = document.createElement('span');
      body.dataset.bookingNoticeText = '1';
      notice.append(heading, body);
      bookingCard.insertBefore(notice, calendarShell);
      els.bookingNotice = notice;
      els.bookingNoticeText = body;
    } else {
      els.bookingNotice = document.getElementById('bookingNotice');
      els.bookingNoticeText = els.bookingNotice?.querySelector('[data-booking-notice-text]') || null;
    }

    const legend = els.calendarGrid.parentElement?.querySelector('.calendar-legend');
    if (legend && !legend.querySelector('[data-holiday-legend]')) {
      const item = document.createElement('span');
      item.dataset.holidayLegend = '1';
      const dot = document.createElement('i');
      dot.className = 'legend-dot holiday-dot';
      dot.setAttribute('aria-hidden', 'true');
      item.append(dot, document.createTextNode('休假日（點選查看）'));
      legend.appendChild(item);
    }

    if (!document.getElementById('bookingHolidayModal')) {
      const modal = document.createElement('div');
      modal.id = 'bookingHolidayModal';
      modal.className = 'booking-modal hidden';
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      modal.setAttribute('aria-labelledby', 'bookingHolidayTitle');
      modal.innerHTML = `
        <div class="booking-modal-card booking-holiday-modal-card">
          <div class="booking-modal-heading">
            <div><p class="kicker">Holiday</p><h2 id="bookingHolidayTitle">休假日，無法預約</h2></div>
            <button id="closeBookingHolidayButton" class="booking-modal-close" type="button" aria-label="關閉休假提示">×</button>
          </div>
          <p id="bookingHolidayDate" class="booking-holiday-date"></p>
          <div id="bookingHolidayDetails" class="booking-holiday-details"></div>
          <div class="booking-modal-actions"><button id="ackBookingHolidayButton" class="button button-dark" type="button">知道了</button></div>
        </div>`;
      document.body.appendChild(modal);
      els.holidayModal = modal;
      els.holidayDate = modal.querySelector('#bookingHolidayDate');
      els.holidayDetails = modal.querySelector('#bookingHolidayDetails');
      els.closeHolidayButton = modal.querySelector('#closeBookingHolidayButton');
      els.ackHolidayButton = modal.querySelector('#ackBookingHolidayButton');
      els.closeHolidayButton.addEventListener('click', () => closeHolidayNotice(true));
      els.ackHolidayButton.addEventListener('click', () => closeHolidayNotice(true));
      modal.addEventListener('click', (event) => {
        if (event.target === modal && window.matchMedia('(max-width: 768px)').matches) closeHolidayNotice(true);
      });
    } else {
      els.holidayModal = document.getElementById('bookingHolidayModal');
      els.holidayDate = document.getElementById('bookingHolidayDate');
      els.holidayDetails = document.getElementById('bookingHolidayDetails');
      els.closeHolidayButton = document.getElementById('closeBookingHolidayButton');
      els.ackHolidayButton = document.getElementById('ackBookingHolidayButton');
    }

    if (!document.getElementById('bookingHolidayStyles')) {
      const style = document.createElement('style');
      style.id = 'bookingHolidayStyles';
      style.textContent = `
        .booking-shop-notice{white-space:normal}.booking-shop-notice>span{display:block;margin-top:6px;white-space:pre-wrap;overflow-wrap:anywhere}
        .calendar-day.holiday-disabled{border-color:rgba(166,70,55,.28);background:#fff2ee;color:#8a4036;cursor:pointer}
        .calendar-day.holiday-disabled:hover{border-color:rgba(166,70,55,.5);background:#ffebe5}
        .calendar-day.holiday-disabled .calendar-day-number{color:#8a4036}
        .calendar-holiday-label{display:block;margin-top:5px;font-size:10px;font-weight:850;line-height:1.25;color:#9a493c}
        .calendar-legend .holiday-dot{background:#c76b59}
        .booking-holiday-date{margin:0 0 12px;color:#66746d;font-weight:700}
        .booking-holiday-details{display:grid;gap:10px;margin:0 0 18px}
        .booking-holiday-detail{padding:12px;border-radius:12px;background:#fff4ef;border:1px solid rgba(166,70,55,.14)}
        .booking-holiday-detail strong{display:block;color:#793b32}.booking-holiday-detail p{margin:5px 0 0;white-space:pre-wrap;overflow-wrap:anywhere;color:#6e5b56;line-height:1.55}
      `;
      document.head.appendChild(style);
    }
  }

  function renderBookingNotice(value) {
    if (!els.bookingNotice || !els.bookingNoticeText) return;
    const text = String(value || '').replace(/\r\n?/g, '\n');
    els.bookingNoticeText.textContent = text;
    els.bookingNotice.classList.toggle('hidden', !text.trim());
  }

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
    closeHolidayNotice(false);
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
    if (Object.prototype.hasOwnProperty.call(detail.settings || {}, 'bookingNotice')) {
      renderBookingNotice(detail.settings.bookingNotice);
    }

    const actualDate = String(els.bookingDate?.value || '');
    if (actualDate && actualDate >= state.minimumDate && actualDate !== state.selectedDate && !state.holidaysByDate.has(actualDate)) {
      state.selectedDate = actualDate;
      state.month = actualDate.slice(0, 7);
    } else if (state.selectedDate && (state.selectedDate < state.minimumDate || state.holidaysByDate.has(state.selectedDate))) {
      clearSelectedDate();
      closeAppointmentModal(false);
    }
    renderCalendar();
  }

  function clearSelectedDate() {
    state.selectedDate = '';
    if (els.bookingDate) {
      els.bookingDate.value = '';
      els.bookingDate.disabled = true;
      els.bookingDate.dispatchEvent(new Event('change', { bubbles: true }));
    }
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
      const holidays = state.holidaysByDate.get(date) || [];
      const isHoliday = holidays.length > 0;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'calendar-day';
      button.dataset.date = date;
      button.setAttribute('role', 'gridcell');
      button.setAttribute('aria-selected', state.selectedDate === date ? 'true' : 'false');
      button.disabled = isPast || (isAdvanceBlocked && !isHoliday);
      if (isPast) button.classList.add('past-disabled');
      if (isAdvanceBlocked && !isHoliday) button.classList.add('advance-disabled');
      if (isHoliday) button.classList.add('holiday-disabled');
      if (date === today) button.classList.add('today');
      if (date === state.selectedDate) button.classList.add('selected');

      const number = document.createElement('strong');
      number.className = 'calendar-day-number';
      number.textContent = String(day);
      button.appendChild(number);

      if (isHoliday) {
        const label = document.createElement('span');
        label.className = 'calendar-holiday-label';
        label.textContent = holidays.length === 1 ? (holidays[0].title || '休假日') : `休假日 · ${holidays.length} 項`;
        button.appendChild(label);
      }

      const intervals = state.occupiedByDate.get(date) || [];
      if (intervals.length && !isHoliday) {
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

      if (isPast) {
        button.title = isHoliday ? '休假日；日期已過，無法預約' : '日期已過，無法預約';
        button.setAttribute('aria-label', `${formatDate(date)}，${button.title}`);
      } else if (isHoliday) {
        button.title = '休假日，無法預約；點選查看說明';
        button.setAttribute('aria-label', `${formatDate(date)}，休假日，無法預約，點選查看休假說明`);
        button.addEventListener('click', () => showHolidayNotice(date, holidays, button));
      } else if (isAdvanceBlocked) {
        const reason = `需提前 ${state.minAdvanceDays} 天，最早可預約 ${formatDate(minimumDate)}`;
        button.title = reason;
        button.setAttribute('aria-label', `${formatDate(date)}，${reason}`);
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
      for (const raw of Array.isArray(result.holidays) ? result.holidays : []) {
        addHolidayToMonth(month, raw);
      }
      if (state.selectedDate && state.holidaysByDate.has(state.selectedDate)) {
        clearSelectedDate();
        closeAppointmentModal(false);
      }
      renderCalendar();
    } catch (_) {
      // Monthly occupancy/holiday decorations are supplemental. Booking creation remains protected server-side.
    }
  }

  function addHolidayToMonth(month, raw) {
    const startsOn = String(raw?.startsOn || '').slice(0, 10);
    const endsOn = String(raw?.endsOn || startsOn).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startsOn) || !/^\d{4}-\d{2}-\d{2}$/.test(endsOn) || endsOn < startsOn) return;
    const holiday = {
      calendarItemId: String(raw?.calendarItemId || ''),
      title: String(raw?.title || '休假日').slice(0, 200),
      description: String(raw?.description || '').slice(0, 2000),
      startsOn,
      endsOn,
    };
    let date = startsOn < `${month}-01` ? `${month}-01` : startsOn;
    const monthEndExclusive = `${shiftMonth(month, 1)}-01`;
    let guard = 0;
    while (date <= endsOn && date < monthEndExclusive && guard < 32) {
      if (date.startsWith(`${month}-`)) {
        const rows = state.holidaysByDate.get(date) || [];
        if (!rows.some((item) => item.calendarItemId && item.calendarItemId === holiday.calendarItemId)) rows.push(holiday);
        else if (!holiday.calendarItemId && !rows.some((item) => item.title === holiday.title && item.startsOn === holiday.startsOn && item.endsOn === holiday.endsOn)) rows.push(holiday);
        state.holidaysByDate.set(date, rows);
      }
      date = addDays(date, 1);
      guard += 1;
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
    for (const date of [...state.holidaysByDate.keys()]) {
      if (String(date).startsWith(`${month}-`)) state.holidaysByDate.delete(date);
    }
  }

  function scheduleMonthOccupancyReload() {
    window.clearTimeout(state.reloadTimer);
    state.reloadTimer = window.setTimeout(loadMonthOccupancy, 350);
  }

  function selectDate(date, trigger) {
    if (date < (state.minimumDate || state.today)) return;
    const holidays = state.holidaysByDate.get(date) || [];
    if (holidays.length) {
      showHolidayNotice(date, holidays, trigger);
      return;
    }
    state.selectedDate = date;
    state.lastDateTrigger = trigger || null;
    els.bookingDate.disabled = false;
    els.bookingDate.value = date;
    els.bookingDate.dispatchEvent(new Event('change', { bubbles: true }));
    renderCalendar();
    openAppointmentModal(date);
  }

  function showHolidayNotice(date, holidays, trigger) {
    closeAppointmentModal(false);
    state.holidayTrigger = trigger instanceof HTMLElement ? trigger : null;
    if (els.holidayDate) els.holidayDate.textContent = `${formatDate(date)}｜此日休假，無法預約`;
    if (els.holidayDetails) {
      els.holidayDetails.replaceChildren(...holidays.map((holiday) => {
        const item = document.createElement('section');
        item.className = 'booking-holiday-detail';
        const title = document.createElement('strong');
        title.textContent = holiday.title || '休假日';
        item.appendChild(title);
        const description = String(holiday.description || '').trim();
        if (description) {
          const text = document.createElement('p');
          text.textContent = description;
          item.appendChild(text);
        }
        return item;
      }));
    }
    els.holidayModal?.classList.remove('hidden');
    window.setTimeout(() => els.closeHolidayButton?.focus(), 0);
  }

  function closeHolidayNotice(returnFocus) {
    if (!els.holidayModal || els.holidayModal.classList.contains('hidden')) return;
    els.holidayModal.classList.add('hidden');
    const trigger = state.holidayTrigger;
    state.holidayTrigger = null;
    if (returnFocus && trigger && document.contains(trigger)) window.setTimeout(() => trigger.focus(), 0);
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
    if (state.holidaysByDate.has(actualDate)) {
      clearSelectedDate();
      closeAppointmentModal(false);
      return;
    }
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