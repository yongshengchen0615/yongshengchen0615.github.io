(() => {
  'use strict';

  const state = {
    config: null,
    idToken: '',
    data: { today: '', services: [], bookings: [] },
    profile: {},
    selectedSlot: '',
    loadingSlots: false,
    submitting: false,
  };
  const els = {};
  const STATUS_LABELS = {
    pending: '等待管理端確認',
    confirmed: '已確認',
    rejected: '未通過',
    cancelled: '已取消',
  };
  const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

  window.addEventListener('DOMContentLoaded', () => {
    ['loadingView', 'errorView', 'errorMessage', 'retryButton', 'bookingView', 'memberName', 'memberProfileName', 'memberCode', 'memberTier', 'logoutButton', 'bookingForm', 'serviceSelect', 'bookingDate', 'serviceInfo', 'slotHint', 'slotGrid', 'memberNote', 'formMessage', 'submitBookingButton', 'refreshButton', 'bookingList', 'bookingEmpty']
      .forEach((id) => { els[id] = document.getElementById(id); });
    els.retryButton.addEventListener('click', () => window.location.reload());
    els.logoutButton.addEventListener('click', () => window.BookingSystem.logout());
    els.refreshButton.addEventListener('click', refresh);
    els.serviceSelect.addEventListener('change', serviceChanged);
    els.bookingDate.addEventListener('change', dateChanged);
    els.bookingForm.addEventListener('submit', submitBooking);
    boot();
  });

  async function boot() {
    showView('loading');
    try {
      state.config = await window.BookingSystem.loadConfig();
      state.idToken = await window.BookingSystem.signIn(state.config, 'booking');
      const decoded = typeof window.liff?.getDecodedIDToken === 'function' ? window.liff.getDecodedIDToken() : null;
      const fallbackName = String(decoded?.name || 'LINE 會員');
      els.memberName.textContent = fallbackName;
      els.memberProfileName.textContent = fallbackName;
      await refresh(false);
      showView('booking');
    } catch (error) {
      showError(error);
    }
  }

  async function refresh(showMessage = true) {
    setRefreshBusy(true);
    try {
      const [bookingData, profile] = await Promise.all([
        window.BookingSystem.request(state.config, 'member', state.idToken, 'user.booking.bootstrap'),
        window.BookingSystem.memberProfile(state.config, state.idToken),
      ]);
      state.data = bookingData;
      state.profile = profile || {};
      renderMemberProfile();
      renderServices();
      renderBookings();
      if (showMessage) showFormMessage('資料已更新。', 'success');
      if (els.serviceSelect.value && els.bookingDate.value) await loadSlots();
    } catch (error) {
      if (!state.data.today) return showError(error);
      showFormMessage(error?.message || '資料暫時無法更新。', 'error');
    } finally {
      setRefreshBusy(false);
    }
  }

  function renderMemberProfile() {
    const profile = state.profile || {};
    const name = String(profile.displayName || els.memberName.textContent || 'LINE 會員');
    const code = String(profile.memberCode || '—');
    const tier = String(profile.tier || '一般會員');
    els.memberName.textContent = name;
    els.memberProfileName.textContent = name;
    els.memberCode.textContent = code;
    els.memberTier.textContent = tier;
  }

  function renderServices() {
    const current = els.serviceSelect.value;
    const options = [new Option('請選擇預約項目', '')];
    for (const service of state.data.services || []) options.push(new Option(service.title, service.serviceId));
    els.serviceSelect.replaceChildren(...options);
    if ((state.data.services || []).some((service) => service.serviceId === current)) els.serviceSelect.value = current;
    if (!els.serviceSelect.value && state.data.services?.length === 1) els.serviceSelect.value = state.data.services[0].serviceId;
    applyServiceConstraints();
  }

  function selectedService() {
    return (state.data.services || []).find((service) => service.serviceId === els.serviceSelect.value) || null;
  }

  function applyServiceConstraints() {
    const service = selectedService();
    state.selectedSlot = '';
    els.slotGrid.replaceChildren();
    els.submitBookingButton.disabled = true;
    if (!service) {
      els.bookingDate.value = '';
      els.bookingDate.disabled = true;
      els.serviceInfo.classList.add('hidden');
      els.slotHint.textContent = '請先選擇預約項目與日期。';
      return;
    }

    const minimumDate = window.BookingSystem.addDays(state.data.today, service.minAdvanceDays || 0);
    els.bookingDate.min = minimumDate;
    els.bookingDate.disabled = false;
    if (!els.bookingDate.value || els.bookingDate.value < minimumDate) els.bookingDate.value = minimumDate;
    els.serviceInfo.classList.remove('hidden');
    els.serviceInfo.textContent = `${service.title}｜工作時間 ${service.workStartTime}–${service.workEndTime}｜需提前 ${service.minAdvanceDays || 0} 天｜可預約星期${(service.availableWeekdays || []).map((day) => WEEKDAYS[day]).join('、')}`;
  }

  async function serviceChanged() {
    clearFormMessage();
    applyServiceConstraints();
    if (selectedService() && els.bookingDate.value) await loadSlots();
  }

  async function dateChanged() {
    clearFormMessage();
    state.selectedSlot = '';
    await loadSlots();
  }

  async function loadSlots() {
    const service = selectedService();
    const bookingDate = els.bookingDate.value;
    if (!service || !bookingDate || state.loadingSlots) return;
    state.loadingSlots = true;
    state.selectedSlot = '';
    els.submitBookingButton.disabled = true;
    els.slotGrid.replaceChildren();
    els.slotHint.textContent = '正在取得可預約時段…';
    try {
      const result = await window.BookingSystem.request(state.config, 'member', state.idToken, 'user.booking.slots', {
        serviceId: service.serviceId,
        bookingDate,
      });
      renderSlots(result.slots || []);
    } catch (error) {
      els.slotHint.textContent = error?.message || '目前無法取得可預約時段。';
    } finally {
      state.loadingSlots = false;
    }
  }

  function renderSlots(slots) {
    els.slotGrid.replaceChildren();
    const availableCount = slots.filter((slot) => slot.available).length;
    els.slotHint.textContent = slots.length
      ? availableCount ? `共有 ${availableCount} 個可預約時段。` : '這一天目前沒有可預約時段。'
      : '這一天未開放預約。';
    for (const slot of slots) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'slot-button';
      button.textContent = slot.startTime;
      button.disabled = !slot.available;
      button.setAttribute('aria-pressed', 'false');
      if (!slot.available) button.title = '此時段已被預約或已經過期';
      button.addEventListener('click', () => selectSlot(button, slot.startTime));
      els.slotGrid.appendChild(button);
    }
  }

  function selectSlot(button, startTime) {
    state.selectedSlot = startTime;
    els.slotGrid.querySelectorAll('.slot-button').forEach((item) => {
      const selected = item === button;
      item.classList.toggle('selected', selected);
      item.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });
    els.submitBookingButton.disabled = state.submitting || !startTime;
    clearFormMessage();
  }

  async function submitBooking(event) {
    event.preventDefault();
    if (state.submitting) return;
    const service = selectedService();
    const bookingDate = els.bookingDate.value;
    const startTime = state.selectedSlot;
    if (!service || !bookingDate || !startTime) return showFormMessage('請完整選擇預約項目、日期與時間。', 'error');

    const requestId = `BOOK-${crypto.randomUUID()}`;
    state.submitting = true;
    els.submitBookingButton.disabled = true;
    els.submitBookingButton.textContent = '送出中…';
    clearFormMessage();
    try {
      const result = await window.BookingSystem.request(state.config, 'member', state.idToken, 'user.booking.create', {
        requestId,
        serviceId: service.serviceId,
        bookingDate,
        startTime,
        memberNote: els.memberNote.value,
      });
      state.data.bookings = [result.booking, ...(state.data.bookings || []).filter((item) => item.bookingId !== result.booking.bookingId)];
      els.memberNote.value = '';
      state.selectedSlot = '';
      renderBookings();
      showFormMessage('預約已送出，時段已保留，等待管理端確認後才算完成預約。', 'success');
      await loadSlots();
    } catch (error) {
      if (error?.code === 'API_TIMEOUT') {
        try {
          const fresh = await window.BookingSystem.request(state.config, 'member', state.idToken, 'user.booking.bootstrap');
          state.data = fresh;
          renderBookings();
          const recovered = (fresh.bookings || []).find((item) => item.requestId === requestId);
          if (recovered) {
            showFormMessage('預約已成功送出，時段已保留，等待管理端確認。', 'success');
            await loadSlots();
            return;
          }
        } catch (_) {}
      }
      showFormMessage(error?.message || '預約送出失敗，請重新選擇時段後再試。', 'error');
      if (error?.code === 'BOOKING_SLOT_TAKEN') await loadSlots();
    } finally {
      state.submitting = false;
      els.submitBookingButton.textContent = '送出預約';
      els.submitBookingButton.disabled = !state.selectedSlot;
    }
  }

  function renderBookings() {
    const bookings = state.data.bookings || [];
    els.bookingList.replaceChildren();
    els.bookingEmpty.classList.toggle('hidden', bookings.length > 0);
    for (const booking of bookings) {
      const item = document.createElement('article');
      item.className = `booking-item status-${booking.status}`;

      const top = document.createElement('div');
      top.className = 'booking-item-top';
      const titleBox = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = booking.serviceTitle || '預約項目';
      const time = document.createElement('span');
      time.textContent = `${window.BookingSystem.formatDate(booking.bookingDate)} ${booking.startTime}–${booking.endTime}`;
      titleBox.append(title, time);
      const status = document.createElement('span');
      status.className = `status-badge status-${booking.status}`;
      status.textContent = STATUS_LABELS[booking.status] || booking.status;
      top.append(titleBox, status);
      item.appendChild(top);

      if (booking.memberNote) {
        const note = document.createElement('p');
        note.className = 'booking-note';
        note.textContent = `備註：${booking.memberNote}`;
        item.appendChild(note);
      }
      if (booking.adminNote) {
        const adminNote = document.createElement('p');
        adminNote.className = 'booking-note admin-note';
        adminNote.textContent = `管理端說明：${booking.adminNote}`;
        item.appendChild(adminNote);
      }

      if (canCancel(booking)) {
        const actions = document.createElement('div');
        actions.className = 'booking-actions';
        const cancelButton = document.createElement('button');
        cancelButton.type = 'button';
        cancelButton.className = 'text-danger-button';
        cancelButton.textContent = '取消預約';
        cancelButton.addEventListener('click', () => cancelBooking(booking, cancelButton));
        actions.appendChild(cancelButton);
        item.appendChild(actions);
      }
      els.bookingList.appendChild(item);
    }
  }

  function canCancel(booking) {
    return ['pending', 'confirmed'].includes(booking.status) && booking.bookingDate >= state.data.today;
  }

  async function cancelBooking(booking, button) {
    if (!window.confirm(`確定取消 ${booking.serviceTitle} ${booking.bookingDate} ${booking.startTime} 的預約嗎？`)) return;
    button.disabled = true;
    try {
      const result = await window.BookingSystem.request(state.config, 'member', state.idToken, 'user.booking.cancel', { bookingId: booking.bookingId });
      state.data.bookings = (state.data.bookings || []).map((item) => item.bookingId === result.booking.bookingId ? result.booking : item);
      renderBookings();
      showFormMessage('預約已取消，原時段已重新開放。', 'success');
      if (els.bookingDate.value === booking.bookingDate && els.serviceSelect.value === booking.serviceId) await loadSlots();
    } catch (error) {
      button.disabled = false;
      showFormMessage(error?.message || '目前無法取消預約。', 'error');
    }
  }

  function setRefreshBusy(busy) {
    els.refreshButton.disabled = busy;
    els.refreshButton.textContent = busy ? '更新中…' : '更新';
  }

  function showFormMessage(message, type) {
    els.formMessage.textContent = message;
    els.formMessage.className = `form-message ${type || ''}`;
  }

  function clearFormMessage() {
    els.formMessage.textContent = '';
    els.formMessage.className = 'form-message hidden';
  }

  function showView(view) {
    els.loadingView.classList.toggle('hidden', view !== 'loading');
    els.errorView.classList.toggle('hidden', view !== 'error');
    els.bookingView.classList.toggle('hidden', view !== 'booking');
  }

  function showError(error) {
    els.errorMessage.textContent = error?.message || '無法連線預約服務，請稍後再試。';
    showView('error');
  }
})();
