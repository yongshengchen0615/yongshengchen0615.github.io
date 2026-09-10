(() => {
  'use strict';

  const state = {
    config: null,
    idToken: '',
    data: { today: '', services: [], bookings: [] },
    filter: 'pending',
    savingService: false,
    refreshing: false,
  };
  const els = {};
  const STATUS_LABELS = { pending: '待確認', confirmed: '已確認', rejected: '未通過', cancelled: '已取消' };
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
      meta.textContent = `${service.workStartTime}–${service.workEndTime}｜提前 ${service.minAdvanceDays} 天｜星期${(service.availableWeekdays || []).map((day) => WEEKDAY_LABELS[day]).join('、')}`;
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
      showServiceMessage('預約項目已儲存。會員端會依新的工作時間產生 30 分鐘時段。', 'success');
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
    state.filter = ['pending', 'confirmed', 'all'].includes(filter) ? filter : 'pending';
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
    service.textContent = booking.serviceTitle || '預約項目';
    const time = document.createElement('p');
    time.className = 'booking-time';
    time.textContent = `${window.BookingSystem.formatDate(booking.bookingDate)}　${booking.startTime}–${booking.endTime}`;
    article.append(heading, service, time);

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
      noteInput.placeholder = booking.status === 'pending' ? '確認或拒絕時可提供會員說明' : '取消已確認預約時可提供原因';
      noteLabel.appendChild(noteInput);
      article.appendChild(noteLabel);

      const actions = document.createElement('div');
      actions.className = 'booking-actions';
      if (booking.status === 'pending') {
        const reject = actionButton('拒絕', 'danger', () => updateStatus(booking, 'rejected', noteInput.value, actions));
        const confirm = actionButton('確認預約', 'primary', () => updateStatus(booking, 'confirmed', noteInput.value, actions));
        actions.append(reject, confirm);
      } else {
        const cancel = actionButton('取消已確認預約', 'danger', () => updateStatus(booking, 'cancelled', noteInput.value, actions));
        actions.append(cancel);
      }
      article.appendChild(actions);
    }
    return article;
  }

  function actionButton(label, kind, handler) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `button ${kind === 'primary' ? 'button-dark' : 'button-danger'}`;
    button.textContent = label;
    button.addEventListener('click', handler);
    return button;
  }

  async function updateStatus(booking, nextStatus, adminNote, actionContainer) {
    const confirmText = nextStatus === 'confirmed'
      ? `確認 ${booking.memberDisplayName || '此會員'} 的 ${booking.bookingDate} ${booking.startTime} 預約？`
      : nextStatus === 'rejected' ? '確定拒絕這筆預約？此時段會重新開放。' : '確定取消這筆已確認預約？此時段會重新開放。';
    if (!window.confirm(confirmText)) return;
    actionContainer.querySelectorAll('button').forEach((button) => { button.disabled = true; });
    try {
      const result = await window.BookingSystem.request(state.config, 'admin', state.idToken, 'admin.booking.status.update', {
        bookingId: booking.bookingId,
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
