(() => {
  'use strict';

  const state = {
    config: null,
    idToken: '',
    data: { today: '', settings: {}, services: [], bookings: [] },
    profile: {},
    selections: [],
    selectedSlot: null,
    loadingSlots: false,
    slotRequestSequence: 0,
    submitting: false,
    realtimeUnsubscribe: null,
  };
  const els = {};
  const STATUS_LABELS = {
    pending: '等待管理端確認',
    confirmed: '已確認',
    rejected: '未通過',
    cancelled: '已取消',
  };

  window.addEventListener('DOMContentLoaded', () => {
    [
      'loadingView', 'errorView', 'errorTitle', 'errorMessage', 'joinMemberButton', 'retryButton', 'bookingView',
      'memberName', 'memberProfileName', 'memberCode', 'memberTier', 'logoutButton', 'workHoursBadge',
      'bookingForm', 'servicePicker', 'serviceEmpty', 'selectedServiceList', 'selectedServiceEmpty', 'selectionSummary',
      'bookingDate', 'slotHint', 'slotGrid', 'memberNote', 'formMessage', 'submitBookingButton', 'refreshButton',
      'bookingList', 'bookingEmpty', 'bookingConfirmModal', 'closeBookingConfirmButton', 'cancelBookingConfirmButton',
      'bookingConfirmSummary', 'bookingConfirmMessage', 'confirmBookingButton'
    ].forEach((id) => { els[id] = document.getElementById(id); });

    els.retryButton.addEventListener('click', () => window.location.reload());
    els.joinMemberButton.addEventListener('click', () => window.BookingSystem.openMemberJoin(state.config));
    els.logoutButton.addEventListener('click', () => window.BookingSystem.logout());
    els.refreshButton.addEventListener('click', () => refresh(true));
    els.bookingDate.addEventListener('change', dateChanged);
    els.bookingForm.addEventListener('submit', openConfirmation);
    els.closeBookingConfirmButton.addEventListener('click', closeConfirmation);
    els.cancelBookingConfirmButton.addEventListener('click', closeConfirmation);
    els.confirmBookingButton.addEventListener('click', confirmBooking);
    els.bookingConfirmModal.addEventListener('click', (event) => {
      if (event.target === els.bookingConfirmModal && window.matchMedia('(max-width: 768px)').matches) closeConfirmation();
    });
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeConfirmation(); });
    window.addEventListener('beforeunload', () => { if (state.realtimeUnsubscribe) state.realtimeUnsubscribe(); });
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
      state.realtimeUnsubscribe = window.BookingSystem.subscribeRealtime(state.config, () => refresh(false));
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
      state.data = bookingData || state.data;
      state.profile = profile || {};
      pruneSelections();
      renderMemberProfile();
      renderSettings();
      renderServices();
      renderBookings();
      applySelectionConstraints(false);
      if (selectedItems().length && els.bookingDate.value) await loadSlots();
      if (showMessage) showFormMessage('資料已更新。', 'success');
    } catch (error) {
      if (!state.data.today) return showError(error);
      showFormMessage(error?.message || '資料暫時無法更新。', 'error');
    } finally {
      setRefreshBusy(false);
    }
  }

  function pruneSelections() {
    const valid = new Set((state.data.services || []).map((service) => service.serviceId));
    state.selections = state.selections.filter((selection) => valid.has(selection.serviceId));
  }

  function renderMemberProfile() {
    const profile = state.profile || {};
    const name = String(profile.displayName || els.memberName.textContent || 'LINE 會員');
    els.memberName.textContent = name;
    els.memberProfileName.textContent = name;
    els.memberCode.textContent = String(profile.memberCode || '—');
    els.memberTier.textContent = String(profile.tier || '一般會員');
  }

  function renderSettings() {
    const settings = state.data.settings || {};
    els.workHoursBadge.textContent = settings.workStartTime && settings.workEndTime
      ? `${settings.workStartTime}–${settings.workEndTime}`
      : '上班時間未設定';
  }

  function renderServices() {
    const services = state.data.services || [];
    els.servicePicker.replaceChildren();
    els.serviceEmpty.classList.toggle('hidden', services.length > 0);

    services.forEach((service, index) => {
      const alreadySelected = state.selections.some((selection) => selection.serviceId === service.serviceId);
      const row = document.createElement('article');
      row.className = `service-choice${alreadySelected ? ' selected' : ''}`;
      row.dataset.serviceIndex = String(index);

      const main = document.createElement('div');
      main.className = 'service-choice-main';
      const text = document.createElement('span');
      const title = document.createElement('strong');
      title.textContent = service.title;
      const meta = document.createElement('small');
      meta.textContent = `服務 ${service.durationMinutes} 分鐘${service.minAdvanceDays ? ` · 需提前 ${service.minAdvanceDays} 天` : ''}`;
      text.append(title, meta);
      if (service.description) {
        const description = document.createElement('small');
        description.textContent = service.description;
        text.append(description);
      }
      main.appendChild(text);

      const addButton = document.createElement('button');
      addButton.type = 'button';
      addButton.className = 'service-add-button';
      addButton.textContent = '增加';
      addButton.setAttribute('aria-label', `增加 ${service.title}`);
      addButton.addEventListener('click', () => addSelection(service));

      row.append(main, addButton);
      els.servicePicker.appendChild(row);
    });

    renderSelectedServices();
  }

  function renderSelectedServices() {
    const rows = selectedServiceRows();
    els.selectedServiceList.replaceChildren();
    els.selectedServiceEmpty.classList.toggle('hidden', rows.length > 0);

    rows.forEach((item) => {
      const row = document.createElement('article');
      row.className = 'selected-service-item';

      const text = document.createElement('div');
      text.className = 'selected-service-main';
      const title = document.createElement('strong');
      title.textContent = item.service.title;
      const meta = document.createElement('small');
      meta.textContent = `服務 ${item.service.durationMinutes} 分鐘${item.service.minAdvanceDays ? ` · 需提前 ${item.service.minAdvanceDays} 天` : ''}`;
      text.append(title, meta);

      const removeButton = document.createElement('button');
      removeButton.type = 'button';
      removeButton.className = 'selected-service-remove';
      removeButton.textContent = '移除';
      removeButton.setAttribute('aria-label', `移除 ${item.service.title}`);
      removeButton.addEventListener('click', () => removeSelection(item.selectionId));

      row.append(text, removeButton);
      els.selectedServiceList.appendChild(row);
    });
  }

  function addSelection(service) {
    const duplicateCount = state.selections.filter((selection) => selection.serviceId === service.serviceId).length;
    if (duplicateCount >= 2) {
      showFormMessage(`${service.title} 已加入兩次，無法再重複加入。`, 'error');
      return;
    }
    if (duplicateCount > 0 && !window.confirm(`${service.title} 已有選擇，是否要再加入？`)) return;

    state.selections.push({
      selectionId: crypto.randomUUID(),
      serviceId: service.serviceId,
    });
    selectionChanged();
  }

  function removeSelection(selectionId) {
    const index = state.selections.findIndex((selection) => selection.selectionId === selectionId);
    if (index < 0) return;
    state.selections.splice(index, 1);
    selectionChanged();
  }

  function selectedItems() {
    const counts = new Map();
    for (const selection of state.selections) {
      counts.set(selection.serviceId, (counts.get(selection.serviceId) || 0) + 1);
    }
    return [...counts.entries()]
      .filter(([, count]) => count >= 1 && count <= 2)
      .map(([serviceId, count]) => ({ serviceId, quantity: count }));
  }

  function selectedServiceRows() {
    const byId = new Map((state.data.services || []).map((service) => [service.serviceId, service]));
    return state.selections
      .map((selection) => ({ ...selection, service: byId.get(selection.serviceId) }))
      .filter((item) => item.service);
  }

  function totalDurationMinutes() {
    return selectedServiceRows().reduce((sum, item) => sum + Number(item.service.durationMinutes || 0), 0);
  }

  function maxAdvanceDays() {
    return selectedServiceRows().reduce((max, item) => Math.max(max, Number(item.service.minAdvanceDays || 0)), 0);
  }

  function selectionChanged() {
    clearFormMessage();
    state.selectedSlot = null;
    renderServices();
    applySelectionConstraints(true);
  }

  function applySelectionConstraints(loadAfter) {
    const rows = selectedServiceRows();
    els.slotGrid.replaceChildren();
    state.selectedSlot = null;
    els.submitBookingButton.disabled = true;
    if (!rows.length) {
      els.bookingDate.value = '';
      els.bookingDate.disabled = true;
      els.selectionSummary.classList.add('hidden');
      els.slotHint.textContent = '請先選擇至少一個預約項目。';
      return;
    }

    const total = totalDurationMinutes();
    const advanceDays = maxAdvanceDays();
    const minimumDate = window.BookingSystem.addDays(state.data.today, advanceDays);
    els.bookingDate.min = minimumDate;
    els.bookingDate.disabled = false;
    if (!els.bookingDate.value || els.bookingDate.value < minimumDate) els.bookingDate.value = minimumDate;
    els.selectionSummary.classList.remove('hidden');
    els.selectionSummary.textContent = `已選 ${rows.length} 個項目 · 總服務時間 ${total} 分鐘 · 最早可預約 ${window.BookingSystem.formatDate(minimumDate)}`;
    els.slotHint.textContent = '正在計算整段服務時間可使用的時段…';
    if (loadAfter && els.bookingDate.value) loadSlots();
  }

  async function dateChanged() {
    clearFormMessage();
    state.selectedSlot = null;
    await loadSlots();
  }

  async function loadSlots() {
    const items = selectedItems();
    const bookingDate = els.bookingDate.value;
    if (!items.length || !bookingDate) return;
    const requestSequence = ++state.slotRequestSequence;
    state.loadingSlots = true;
    const previouslySelected = state.selectedSlot?.startTime || '';
    state.selectedSlot = null;
    els.submitBookingButton.disabled = true;
    els.slotGrid.replaceChildren();
    els.slotHint.textContent = '正在取得可預約時段…';
    try {
      const result = await window.BookingSystem.request(state.config, 'member', state.idToken, 'user.booking.slots', {
        items,
        bookingDate,
      });
      if (requestSequence !== state.slotRequestSequence) return;
      renderSlots(result.slots || [], previouslySelected, Number(result.totalDurationMinutes || totalDurationMinutes()));
    } catch (error) {
      if (requestSequence !== state.slotRequestSequence) return;
      els.slotHint.textContent = error?.message || '目前無法取得可預約時段。';
    } finally {
      if (requestSequence === state.slotRequestSequence) state.loadingSlots = false;
    }
  }

  function renderSlots(slots, previouslySelected, totalDuration) {
    els.slotGrid.replaceChildren();
    const availableCount = slots.filter((slot) => slot.available).length;
    els.slotHint.textContent = slots.length
      ? availableCount
        ? `總服務 ${totalDuration} 分鐘，共有 ${availableCount} 個可開始時段。已被其他預約重疊的時間不可選。`
        : '這一天目前沒有可容納完整服務時間的時段。'
      : '這一天沒有可預約時段。';

    for (const slot of slots) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'slot-button';
      button.textContent = `${slot.startTime}–${slot.endTime}`;
      button.disabled = !slot.available;
      button.setAttribute('aria-pressed', 'false');
      if (!slot.available) button.title = '這段時間與其他預約重疊、已經過期或超出上班時間';
      button.addEventListener('click', () => selectSlot(button, slot));
      els.slotGrid.appendChild(button);
      if (slot.available && slot.startTime === previouslySelected) selectSlot(button, slot);
    }
  }

  function selectSlot(button, slot) {
    state.selectedSlot = { startTime: slot.startTime, endTime: slot.endTime };
    els.slotGrid.querySelectorAll('.slot-button').forEach((item) => {
      const selected = item === button;
      item.classList.toggle('selected', selected);
      item.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });
    els.submitBookingButton.disabled = state.submitting || !state.selectedSlot;
    clearFormMessage();
  }

  function openConfirmation(event) {
    event.preventDefault();
    if (state.submitting) return;
    const items = selectedServiceRows();
    if (!items.length || !els.bookingDate.value || !state.selectedSlot) {
      return showFormMessage('請完整選擇預約項目、日期與時間。', 'error');
    }
    renderConfirmation(items);
    clearConfirmMessage();
    els.bookingConfirmModal.classList.remove('hidden');
    els.confirmBookingButton.focus();
  }

  function renderConfirmation(items) {
    const fragment = document.createDocumentFragment();
    const time = document.createElement('p');
    time.className = 'booking-confirm-time';
    time.textContent = `${window.BookingSystem.formatDate(els.bookingDate.value)} ${state.selectedSlot.startTime}–${state.selectedSlot.endTime}`;
    fragment.appendChild(time);

    const list = document.createElement('ul');
    for (const item of items) {
      const li = document.createElement('li');
      li.textContent = `${item.service.title}（${item.service.durationMinutes} 分鐘）`;
      list.appendChild(li);
    }
    fragment.appendChild(list);

    const total = document.createElement('strong');
    total.textContent = `總服務時間：${totalDurationMinutes()} 分鐘`;
    fragment.appendChild(total);
    if (els.memberNote.value.trim()) {
      const note = document.createElement('p');
      note.textContent = `備註：${els.memberNote.value.trim()}`;
      fragment.appendChild(note);
    }
    els.bookingConfirmSummary.replaceChildren(fragment);
  }

  function closeConfirmation() {
    if (state.submitting || els.bookingConfirmModal.classList.contains('hidden')) return;
    els.bookingConfirmModal.classList.add('hidden');
    clearConfirmMessage();
    els.submitBookingButton.focus();
  }

  async function confirmBooking() {
    if (state.submitting) return;
    const items = selectedItems();
    const bookingDate = els.bookingDate.value;
    const startTime = state.selectedSlot?.startTime || '';
    if (!items.length || !bookingDate || !startTime) {
      showConfirmMessage('預約內容已變更，請返回重新選擇。', 'error');
      return;
    }

    const requestId = `BOOK-${crypto.randomUUID()}`;
    state.submitting = true;
    els.confirmBookingButton.disabled = true;
    els.confirmBookingButton.textContent = '送出中…';
    els.submitBookingButton.disabled = true;
    clearConfirmMessage();
    try {
      const result = await window.BookingSystem.request(state.config, 'member', state.idToken, 'user.booking.create', {
        requestId,
        items,
        bookingDate,
        startTime,
        memberNote: els.memberNote.value,
      });
      state.data.bookings = [result.booking, ...(state.data.bookings || []).filter((item) => item.bookingId !== result.booking.bookingId)];
      els.bookingConfirmModal.classList.add('hidden');
      els.memberNote.value = '';
      state.selections = [];
      state.selectedSlot = null;
      renderServices();
      applySelectionConstraints(false);
      renderBookings();
      showFormMessage('預約已送出，整段服務時間已保留，等待管理端確認。', 'success');
    } catch (error) {
      if (error?.code === 'API_TIMEOUT') {
        try {
          const fresh = await window.BookingSystem.request(state.config, 'member', state.idToken, 'user.booking.bootstrap');
          state.data = fresh;
          renderBookings();
          const recovered = (fresh.bookings || []).find((item) => item.requestId === requestId);
          if (recovered) {
            els.bookingConfirmModal.classList.add('hidden');
            state.selections = [];
            state.selectedSlot = null;
            renderServices();
            applySelectionConstraints(false);
            showFormMessage('預約已成功送出，整段時間已保留，等待管理端確認。', 'success');
            return;
          }
        } catch (_) {}
      }
      showConfirmMessage(error?.message || '預約送出失敗，請返回重新選擇時間。', 'error');
      if (error?.code === 'BOOKING_SLOT_TAKEN') {
        await loadSlots();
        showConfirmMessage('這段時間剛被其他會員預約，請返回選擇其他時間。', 'error');
      }
    } finally {
      state.submitting = false;
      els.confirmBookingButton.disabled = false;
      els.confirmBookingButton.textContent = '確認送出';
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
      time.textContent = `${window.BookingSystem.formatDate(booking.bookingDate)} ${booking.startTime}–${booking.endTime} · ${booking.totalDurationMinutes || 0} 分鐘`;
      titleBox.append(title, time);
      const status = document.createElement('span');
      status.className = `status-badge status-${booking.status}`;
      status.textContent = STATUS_LABELS[booking.status] || booking.status;
      top.append(titleBox, status);
      item.appendChild(top);

      if (Array.isArray(booking.items) && booking.items.length) {
        const serviceList = document.createElement('ul');
        serviceList.className = 'booking-service-items';
        booking.items.forEach((service) => {
          const repeat = Math.max(1, Number(service.quantity || 1));
          for (let index = 0; index < repeat; index += 1) {
            const li = document.createElement('li');
            li.textContent = service.serviceTitle;
            serviceList.appendChild(li);
          }
        });
        item.appendChild(serviceList);
      }
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
    if (!window.confirm(`確定取消 ${booking.serviceTitle} ${booking.bookingDate} ${booking.startTime}–${booking.endTime} 的預約嗎？`)) return;
    button.disabled = true;
    try {
      const result = await window.BookingSystem.request(state.config, 'member', state.idToken, 'user.booking.cancel', { bookingId: booking.bookingId });
      state.data.bookings = (state.data.bookings || []).map((item) => item.bookingId === result.booking.bookingId ? result.booking : item);
      renderBookings();
      showFormMessage('預約已取消，原本佔用的整段時間已重新開放。', 'success');
      if (selectedItems().length && els.bookingDate.value === booking.bookingDate) await loadSlots();
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

  function showConfirmMessage(message, type) {
    els.bookingConfirmMessage.textContent = message;
    els.bookingConfirmMessage.className = `form-message ${type || ''}`;
  }

  function clearConfirmMessage() {
    els.bookingConfirmMessage.textContent = '';
    els.bookingConfirmMessage.className = 'form-message hidden';
  }

  function showView(view) {
    els.loadingView.classList.toggle('hidden', view !== 'loading');
    els.errorView.classList.toggle('hidden', view !== 'error');
    els.bookingView.classList.toggle('hidden', view !== 'booking');
  }

  function showError(error) {
    const membershipRequired = error && error.code === 'MEMBERSHIP_REQUIRED';
    els.errorTitle.textContent = membershipRequired ? '請先加入會員' : '預約功能暫時無法使用';
    els.errorMessage.textContent = membershipRequired
      ? '加入會員並完成會員資料後，才能使用預約功能。'
      : error?.message || '無法連線預約服務，請稍後再試。';
    els.joinMemberButton.classList.toggle('hidden', !membershipRequired);
    els.retryButton.classList.toggle('hidden', membershipRequired);
    showView('error');
  }
})();