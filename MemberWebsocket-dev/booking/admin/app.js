(() => {
  'use strict';

  const STORE_SERVICE_ID = '00000000-0000-4000-8000-000000000010';
  const state = {
    config: null,
    idToken: '',
    data: { today: '', services: [], bookings: [] },
    filter: 'pending',
    savingService: false,
    refreshing: false,
  };
  const els = {};
  const STATUS_LABELS = { pending: '待確認', confirmed: '已確認', completed: '服務已完成', rejected: '未通過', cancelled: '已取消' };
  const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

  window.addEventListener('DOMContentLoaded', () => {
    ['loadingView', 'errorView', 'errorMessage', 'pendingBox', 'pendingUserId', 'retryButton', 'adminView', 'adminName', 'logoutButton', 'serviceCount', 'pendingCount', 'confirmedCount', 'newServiceButton', 'serviceForm', 'serviceId', 'expectedUpdatedAt', 'serviceTitle', 'serviceDescription', 'workStartTime', 'workEndTime', 'minAdvanceDays', 'serviceActive', 'serviceFormMessage', 'saveServiceButton', 'serviceListCount', 'serviceList', 'serviceEmpty', 'refreshButton', 'bookingQueue', 'bookingEmpty']
      .forEach((id) => { els[id] = document.getElementById(id); });
    els.retryButton.addEventListener('click', () => window.location.reload());
    els.logoutButton.addEventListener('click', () => window.BookingSystem.logout());
    els.newServiceButton.addEventListener('click', resetServiceForm);
    els.serviceForm.addEventListener('submit', saveService);
    els.refreshButton.addEventListener('click', refresh);
    document.querySelectorAll('.filter-button').forEach((button) => button.addEventListener('click', () => setFilter(button.dataset.filter || 'pending')));
    boot();
  });

  async function boot() {
    showView('loading');
    try {
      state.config = await window.BookingSystem.loadConfig();
      state.idToken = await window.BookingSystem.signIn(state.config, 'admin');
      const decoded = typeof window.liff?.getDecodedIDToken === 'function' ? window.liff.getDecodedIDToken() : null;
      els.adminName.textContent = String(decoded?.name || '管理員');
      await refresh();
      showView('admin');
    } catch (error) {
      showError(error);
    }
  }

  async function refresh() {
    if (state.refreshing) return;
    state.refreshing = true;
    els.refreshButton.disabled = true;
    els.refreshButton.textContent = '更新中…';
    try {
      state.data = await window.BookingSystem.request(state.config, 'admin', state.idToken, 'admin.booking.bootstrap');
      renderAll();
    } catch (error) {
      if (!state.data.today) throw error;
      showServiceMessage(error?.message || '資料暫時無法更新。', 'error');
    } finally {
      state.refreshing = false;
      els.refreshButton.disabled = false;
      els.refreshButton.textContent = '更新資料';
    }
  }

  async function requestOperations(action, payload = {}) {
    const endpoint = `${String(state.config?.supabaseUrl || '').replace(/\/$/, '')}/functions/v1/booking-admin-operations`;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        cache: 'no-store',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          apikey: String(state.config?.supabasePublishableKey || ''),
        },
        body: JSON.stringify({ ...payload, action, clientType: 'admin', idToken: state.idToken }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || data?.ok !== true) {
        const error = new Error(String(data?.error?.message || '預約管理操作失敗。'));
        error.code = String(data?.error?.code || 'API_ERROR');
        throw error;
      }
      return data.data || {};
    } catch (error) {
      if (error?.code) throw error;
      throw new Error('目前無法連線預約管理服務，請更新資料後再試。');
    } finally {
      window.clearTimeout(timer);
    }
  }

  function renderAll() {
    renderStats();
    renderServices();
    renderBookings();
  }

  function renderStats() {
    const services = state.data.services || [];
    const bookings = state.data.bookings || [];
    els.serviceCount.textContent = String(services.length);
    els.pendingCount.textContent = String(bookings.filter((item) => item.status === 'pending').length);
    els.confirmedCount.textContent = String(bookings.filter((item) => item.status === 'confirmed').length);
  }

  function renderServices() {
    const services = state.data.services || [];
    els.serviceList.replaceChildren();
    els.serviceListCount.textContent = String(services.length);
    els.serviceEmpty.classList.toggle('hidden', services.length > 0);
    for (const service of services) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = `service-row${service.isActive ? '' : ' inactive'}`;
      row.addEventListener('click', () => editService(service));

      const text = document.createElement('span');
      const title = document.createElement('strong');
      title.textContent = service.title;
      const meta = document.createElement('small');
      meta.textContent = `${service.workStartTime || '—'}–${service.workEndTime || '—'}｜提前 ${service.minAdvanceDays ?? 0} 天｜星期${(service.availableWeekdays || []).map((day) => WEEKDAY_LABELS[day]).join('、')}`;
      text.append(title, meta);

      const badge = document.createElement('span');
      badge.className = `service-status ${service.isActive ? 'active' : 'inactive'}`;
      badge.textContent = service.isActive ? '開放' : '關閉';
      row.append(text, badge);
      els.serviceList.appendChild(row);
    }
  }

  function editService(service) {
    els.serviceId.value = service.serviceId;
    els.expectedUpdatedAt.value = service.updatedAt || '';
    els.serviceTitle.value = service.title || '';
    els.serviceDescription.value = service.description || '';
    els.workStartTime.value = service.workStartTime || '09:00';
    els.workEndTime.value = service.workEndTime || '17:00';
    els.minAdvanceDays.value = String(service.minAdvanceDays ?? 0);
    els.serviceActive.checked = Boolean(service.isActive);
    const enabled = new Set((service.availableWeekdays || []).map(Number));
    document.querySelectorAll('input[name="weekday"]').forEach((checkbox) => { checkbox.checked = enabled.has(Number(checkbox.value)); });
    els.saveServiceButton.textContent = '儲存修改';
    clearServiceMessage();
    els.serviceTitle.focus();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function resetServiceForm() {
    els.serviceForm.reset();
    els.serviceId.value = '';
    els.expectedUpdatedAt.value = '';
    els.workStartTime.value = '09:00';
    els.workEndTime.value = '17:00';
    els.minAdvanceDays.value = '0';
    els.serviceActive.checked = true;
    document.querySelectorAll('input[name="weekday"]').forEach((checkbox) => { checkbox.checked = true; });
    els.saveServiceButton.textContent = '儲存預約項目';
    clearServiceMessage();
    els.serviceTitle.focus();
  }

  async function saveService(event) {
    event.preventDefault();
    if (state.savingService) return;
    const weekdays = [...document.querySelectorAll('input[name="weekday"]:checked')].map((checkbox) => Number(checkbox.value));
    if (!els.serviceTitle.value.trim()) return showServiceMessage('請輸入預約項目名稱。', 'error');
    if (!weekdays.length) return showServiceMessage('請至少選擇一個開放預約星期。', 'error');
    if (!/^\d{2}:(00|30)$/.test(els.workStartTime.value) || !/^\d{2}:(00|30)$/.test(els.workEndTime.value)) return showServiceMessage('工作時間必須以 30 分鐘為單位。', 'error');

    state.savingService = true;
    els.saveServiceButton.disabled = true;
    els.saveServiceButton.textContent = '儲存中…';
    clearServiceMessage();
    try {
      const result = await window.BookingSystem.request(state.config, 'admin', state.idToken, 'admin.booking.service.save', {
        serviceId: els.serviceId.value || undefined,
        expectedUpdatedAt: els.expectedUpdatedAt.value || undefined,
        title: els.serviceTitle.value,
        description: els.serviceDescription.value,
        workStartTime: els.workStartTime.value,
        workEndTime: els.workEndTime.value,
        minAdvanceDays: Number(els.minAdvanceDays.value),
        availableWeekdays: weekdays,
        isActive: els.serviceActive.checked,
      });
      const saved = result.service;
      const index = (state.data.services || []).findIndex((item) => item.serviceId === saved.serviceId);
      if (index >= 0) state.data.services[index] = saved;
      else state.data.services.push(saved);
      renderStats();
      renderServices();
      editService(saved);
      showServiceMessage('預約項目已儲存。', 'success');
    } catch (error) {
      showServiceMessage(error?.message || '預約項目儲存失敗。', 'error');
      if (error?.code === 'CONFLICT') await refresh();
    } finally {
      state.savingService = false;
      els.saveServiceButton.disabled = false;
      els.saveServiceButton.textContent = els.serviceId.value ? '儲存修改' : '儲存預約項目';
    }
  }

  function setFilter(filter) {
    state.filter = ['pending', 'confirmed', 'completed', 'all'].includes(filter) ? filter : 'pending';
    document.querySelectorAll('.filter-button').forEach((button) => button.classList.toggle('active', button.dataset.filter === state.filter));
    renderBookings();
  }

  function renderBookings() {
    const all = state.data.bookings || [];
    const bookings = state.filter === 'all' ? all : all.filter((item) => item.status === state.filter);
    els.bookingQueue.replaceChildren();
    els.bookingEmpty.classList.toggle('hidden', bookings.length > 0);
    for (const booking of bookings) els.bookingQueue.appendChild(bookingCard(booking));
  }

  function visibleBookingItems(booking) {
    return Array.isArray(booking?.items) ? booking.items.filter((item) => item.serviceId !== STORE_SERVICE_ID) : [];
  }

  function bookingCard(booking) {
    const article = document.createElement('article');
    article.className = `booking-card status-${booking.status}`;

    const heading = document.createElement('div');
    heading.className = 'booking-heading';
    const identity = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = booking.memberDisplayName || booking.memberCode || '會員';
    const code = document.createElement('small');
    code.textContent = booking.memberCode || '';
    identity.append(title, code);
    const badge = document.createElement('span');
    badge.className = `status-badge status-${booking.status}`;
    badge.textContent = STATUS_LABELS[booking.status] || booking.status;
    heading.append(identity, badge);

    const service = document.createElement('h3');
    service.textContent = visibleBookingItems(booking).map((item) => item.serviceTitle).filter(Boolean).join(' + ') || booking.serviceTitle || '預約項目';
    const time = document.createElement('p');
    time.className = 'booking-time';
    const scheduledMinutes = Number(booking.totalDurationMinutes || 0);
    const currentMinutes = Array.isArray(booking.items) && booking.items.length
      ? booking.items.reduce((sum, item) => sum + Number(item.unitDurationMinutes || 0) * Number(item.quantity || 1), 0)
      : scheduledMinutes;
    const durationText = currentMinutes !== scheduledMinutes
      ? `目前項目共 ${currentMinutes} 分鐘 · 原排程佔用 ${scheduledMinutes} 分鐘`
      : `目前項目共 ${currentMinutes} 分鐘`;
    time.textContent = `${window.BookingSystem.formatDate(booking.bookingDate)}　${booking.startTime}–${booking.endTime}（原預約時段） · ${durationText}`;
    article.append(heading, service, time);

    const items = visibleBookingItems(booking);
    if (items.length) {
      const list = document.createElement('ul');
      items.forEach((item) => {
        const row = document.createElement('li');
        row.textContent = `${item.serviceTitle} × ${Number(item.quantity || 1)}｜${Number(item.unitDurationMinutes || 0)} 分鐘/份｜NT$${Number(item.unitPriceAmount || 0).toLocaleString('zh-Hant-TW')}/份`;
        list.appendChild(row);
      });
      article.appendChild(list);
    }

    if (booking.memberNote) {
      const memberNote = document.createElement('p');
      memberNote.className = 'note member-note';
      memberNote.textContent = `會員備註：${booking.memberNote}`;
      article.appendChild(memberNote);
    }
    if (booking.adminNote && !['pending'].includes(booking.status)) {
      const currentAdminNote = document.createElement('p');
      currentAdminNote.className = 'note admin-note';
      currentAdminNote.textContent = `管理端說明：${booking.adminNote}`;
      article.appendChild(currentAdminNote);
    }

    if (booking.status === 'pending' || booking.status === 'confirmed') {
      const noteLabel = document.createElement('label');
      noteLabel.className = 'admin-note-field';
      noteLabel.textContent = '管理端說明（選填）';
      const noteInput = document.createElement('textarea');
      noteInput.rows = 2;
      noteInput.maxLength = 500;
      noteInput.value = booking.adminNote || '';
      noteInput.placeholder = booking.status === 'pending' ? '確認或拒絕時可提供會員說明' : '完成或取消預約時可提供說明';
      noteLabel.appendChild(noteInput);
      article.appendChild(noteLabel);

      const actions = document.createElement('div');
      actions.className = 'booking-actions';
      actions.append(actionButton('修改服務項目', 'secondary', () => toggleBookingItemEditor(booking, article)));
      if (booking.status === 'pending') {
        const reject = actionButton('拒絕', 'danger', () => updateStatus(booking, 'rejected', noteInput.value, actions));
        const confirm = actionButton('確認預約', 'primary', () => updateStatus(booking, 'confirmed', noteInput.value, actions));
        actions.append(reject, confirm);
      } else {
        const complete = actionButton('確認服務完成', 'primary', () => updateStatus(booking, 'completed', noteInput.value, actions));
        const cancel = actionButton('取消已確認預約', 'danger', () => updateStatus(booking, 'cancelled', noteInput.value, actions));
        actions.append(complete, cancel);
      }
      article.appendChild(actions);
    }
    return article;
  }

  function toggleBookingItemEditor(booking, article) {
    const existing = article.querySelector('[data-booking-item-editor]');
    if (existing) { existing.remove(); return; }
    const services = (state.data.services || []).filter((service) => service.serviceId !== STORE_SERVICE_ID);
    if (!services.length) return window.alert('目前沒有可選擇的服務項目。');
    const current = new Map(visibleBookingItems(booking).map((item) => [item.serviceId, Number(item.quantity || 1)]));
    const editor = document.createElement('div');
    editor.dataset.bookingItemEditor = '1';
    editor.className = 'admin-note-field';
    const heading = document.createElement('strong');
    heading.textContent = '現場實際服務項目';
    const hint = document.createElement('small');
    hint.textContent = '修改項目與數量不會改變原預約日期與佔用時段。';
    editor.append(heading, hint);

    services.forEach((service) => {
      const row = document.createElement('label');
      const check = document.createElement('input');
      check.type = 'checkbox';
      check.dataset.serviceId = service.serviceId;
      check.checked = current.has(service.serviceId);
      const label = document.createElement('span');
      label.textContent = `${service.title}${service.isActive ? '' : '（目前停用）'}｜${Number(service.durationMinutes || 0)} 分鐘｜NT$${Number(service.priceAmount || 0).toLocaleString('zh-Hant-TW')}`;
      const quantity = document.createElement('select');
      quantity.dataset.quantityFor = service.serviceId;
      quantity.innerHTML = '<option value="1">1 份</option><option value="2">2 份</option>';
      quantity.value = String(current.get(service.serviceId) || 1);
      quantity.disabled = !check.checked;
      check.addEventListener('change', () => { quantity.disabled = !check.checked; });
      row.append(check, label, quantity);
      editor.appendChild(row);
    });

    const editorActions = document.createElement('div');
    editorActions.className = 'booking-actions';
    const save = actionButton('儲存現場改單', 'primary', async () => {
      const selected = [...editor.querySelectorAll('input[data-service-id]:checked')].map((check) => ({
        serviceId: check.dataset.serviceId,
        quantity: Number(editor.querySelector(`select[data-quantity-for="${check.dataset.serviceId}"]`)?.value || 1),
      }));
      if (!selected.length) return window.alert('請至少選擇一個服務項目。');
      editor.querySelectorAll('button,input,select').forEach((control) => { control.disabled = true; });
      try {
        const result = await requestOperations('admin.booking.items.update', {
          bookingId: booking.bookingId,
          expectedUpdatedAt: booking.updatedAt,
          items: selected,
        });
        state.data.bookings = (state.data.bookings || []).map((item) => item.bookingId === result.booking.bookingId ? result.booking : item);
        renderStats();
        renderBookings();
      } catch (error) {
        window.alert(error?.message || '修改服務項目失敗。');
        await refresh();
      }
    });
    const cancel = actionButton('取消修改', 'secondary', () => editor.remove());
    editorActions.append(save, cancel);
    editor.appendChild(editorActions);
    article.appendChild(editor);
  }

  function actionButton(label, kind, handler) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `button ${kind === 'primary' ? 'button-dark' : kind === 'danger' ? 'button-danger' : 'button-light'}`;
    button.textContent = label;
    button.addEventListener('click', handler);
    return button;
  }

  async function updateStatus(booking, nextStatus, adminNote, actionContainer) {
    const confirmText = nextStatus === 'completed' ? '確認這筆服務已完成？系統不要求等待原預約結束時間；完成後不可修改或取消。' : nextStatus === 'confirmed'
      ? `確認 ${booking.memberDisplayName || '此會員'} 的 ${booking.bookingDate} ${booking.startTime} 預約？`
      : nextStatus === 'rejected' ? '確定拒絕這筆預約？此時段會重新開放。' : '確定取消這筆已確認預約？此時段會重新開放。';
    if (!window.confirm(confirmText)) return;
    actionContainer.querySelectorAll('button').forEach((button) => { button.disabled = true; });
    try {
      const result = nextStatus === 'completed'
        ? await requestOperations('admin.booking.status.complete', {
            bookingId: booking.bookingId,
            expectedUpdatedAt: booking.updatedAt,
            adminNote,
          })
        : await window.BookingSystem.request(state.config, 'admin', state.idToken, 'admin.booking.status.update', {
            bookingId: booking.bookingId,
            expectedUpdatedAt: booking.updatedAt,
            status: nextStatus,
            adminNote,
          });
      state.data.bookings = (state.data.bookings || []).map((item) => item.bookingId === result.booking.bookingId ? result.booking : item);
      renderStats();
      renderBookings();
    } catch (error) {
      window.alert(error?.message || '預約狀態更新失敗。');
      await refresh();
    }
  }

  function showServiceMessage(message, type) {
    els.serviceFormMessage.textContent = message;
    els.serviceFormMessage.className = `form-message ${type || ''}`;
  }

  function clearServiceMessage() {
    els.serviceFormMessage.textContent = '';
    els.serviceFormMessage.className = 'form-message hidden';
  }

  function showView(view) {
    els.loadingView.classList.toggle('hidden', view !== 'loading');
    els.errorView.classList.toggle('hidden', view !== 'error');
    els.adminView.classList.toggle('hidden', view !== 'admin');
  }

  function showError(error) {
    els.errorMessage.textContent = error?.message || '預約管理暫時無法載入。';
    if (error?.code === 'ADMIN_PENDING' && error.details?.lineUserId) {
      els.pendingUserId.textContent = error.details.lineUserId;
      els.pendingBox.classList.remove('hidden');
    }
    showView('error');
  }
})();
