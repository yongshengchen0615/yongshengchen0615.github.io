(() => {
  'use strict';

  const POLL_MS = 12000;
  const MODE_CORE = 'core';
  const MODE_REQUESTS = 'requests';
  const MODE_CANCELLED = 'cancelled';
  let config = null;
  let loading = false;
  let mounted = false;
  let realtimeClient = null;
  let realtimeChannel = null;
  let realtimeTimer = null;
  let pollTimer = null;
  let activeMode = MODE_CORE;
  let requestRows = [];
  let cancelledRows = [];
  const els = {};

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', waitForBookingPanel);
  else waitForBookingPanel();

  function waitForBookingPanel() {
    let attempts = 0;
    const run = () => {
      attempts += 1;
      const queuePanel = document.getElementById('bookingAdminQueuePanel');
      if (queuePanel) return mount(queuePanel);
      if (attempts < 100) window.setTimeout(run, 100);
    };
    run();
  }

  function mount(queuePanel) {
    if (mounted || document.getElementById('bookingCancellationReview')) return;
    const filter = queuePanel.querySelector('.booking-admin-filter');
    const coreQueue = document.getElementById('bookingAdminQueue');
    const coreEmpty = document.getElementById('bookingAdminQueueEmpty');
    if (!filter || !coreQueue || !coreEmpty) return;
    mounted = true;

    const requestButton = document.createElement('button');
    requestButton.id = 'bookingCancellationRequestFilter';
    requestButton.className = 'booking-admin-filter-button';
    requestButton.type = 'button';
    requestButton.textContent = '取消申請';

    const cancelledButton = document.createElement('button');
    cancelledButton.id = 'bookingCancelledFilter';
    cancelledButton.className = 'booking-admin-filter-button';
    cancelledButton.type = 'button';
    cancelledButton.textContent = '已取消';

    const confirmedButton = filter.querySelector('[data-booking-filter="confirmed"]');
    if (confirmedButton) {
      confirmedButton.insertAdjacentElement('afterend', requestButton);
      requestButton.insertAdjacentElement('afterend', cancelledButton);
    } else {
      filter.append(requestButton, cancelledButton);
    }

    const section = document.createElement('section');
    section.id = 'bookingCancellationReview';
    section.className = 'booking-admin-cancellation-review hidden';
    section.setAttribute('aria-labelledby', 'bookingCancellationReviewTitle');
    section.innerHTML = `
      <div class="booking-admin-section-heading booking-cancellation-heading">
        <div><p id="bookingCancellationReviewKicker" class="kicker">Cancellation requests</p><h3 id="bookingCancellationReviewTitle">取消申請</h3><p id="bookingCancellationReviewDescription">會員申請取消後，原預約時段仍保留；管理端確認取消後才會重新開放。</p></div>
        <span id="bookingCancellationReviewCount" class="booking-admin-status status-pending">0 筆</span>
      </div>
      <div id="bookingCancellationReviewMessage" class="form-message hidden" role="status" aria-live="polite"></div>
      <div id="bookingCancellationReviewList" class="booking-admin-queue"></div>
      <div id="bookingCancellationReviewEmpty" class="empty-state compact"><span aria-hidden="true">○</span><p>目前沒有待確認的取消申請</p></div>`;
    filter.insertAdjacentElement('afterend', section);

    els.filter = filter;
    els.coreQueue = coreQueue;
    els.coreEmpty = coreEmpty;
    els.requestButton = requestButton;
    els.cancelledButton = cancelledButton;
    ['bookingCancellationReview','bookingCancellationReviewKicker','bookingCancellationReviewTitle','bookingCancellationReviewDescription','bookingCancellationReviewCount','bookingCancellationReviewMessage','bookingCancellationReviewList','bookingCancellationReviewEmpty'].forEach((id) => { els[id] = document.getElementById(id); });

    injectStyles();
    requestButton.addEventListener('click', () => activateMode(MODE_REQUESTS));
    cancelledButton.addEventListener('click', () => activateMode(MODE_CANCELLED));
    filter.querySelectorAll('[data-booking-filter]').forEach((button) => button.addEventListener('click', () => activateMode(MODE_CORE)));
    document.getElementById('bookingAdminRefreshButton')?.addEventListener('click', () => window.setTimeout(() => refresh(false, true), 150));
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', onFocus);
    window.addEventListener('beforeunload', teardown);
    waitForAdmin();
  }

  function injectStyles() {
    if (document.getElementById('bookingCancellationReviewStyles')) return;
    const style = document.createElement('style');
    style.id = 'bookingCancellationReviewStyles';
    style.textContent = `
      .booking-admin-cancellation-review{display:grid;gap:12px;margin:14px 0 0;padding:16px;border:1px solid rgba(177,89,45,.22);border-radius:16px;background:#fffaf5}
      .booking-admin-cancellation-review.hidden{display:none!important}
      .booking-cancellation-heading{margin:0}.booking-cancellation-card{display:grid;gap:9px;padding:14px;border:1px solid rgba(23,53,46,.12);border-radius:14px;background:#fff}
      .booking-cancellation-top{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.booking-cancellation-top small{display:block;margin-top:3px;color:#718078}
      .booking-cancellation-time{margin:0;color:#566b62;font-size:13px;line-height:1.55}.booking-cancellation-items{margin:0;padding-left:20px;color:#566b62;font-size:13px;line-height:1.6}
      .booking-cancellation-note{margin:0;padding:9px 11px;border-radius:10px;background:rgba(23,53,46,.05);color:#566b62;font-size:13px;line-height:1.55;white-space:pre-wrap}
      .booking-cancellation-actions{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap}.booking-cancellation-actions .button{min-width:110px}
      @media(max-width:600px){.booking-cancellation-top{display:grid}.booking-cancellation-actions{display:grid;grid-template-columns:1fr 1fr}.booking-cancellation-actions .button{width:100%;min-width:0}}
    `;
    document.head.appendChild(style);
  }

  async function context() {
    if (!config) config = await window.MemberSystem.loadConfig();
    const idToken = String(window.liff?.getIDToken?.() || '');
    if (!idToken) throw clientError('AUTH_REQUIRED', '管理端登入尚未完成。');
    return { config, idToken };
  }

  function clientError(code, message) { const error = new Error(message); error.code = code; return error; }

  async function requestFunction(functionName, action, payload = {}) {
    const ctx = await context();
    const endpoint = `${String(ctx.config.supabaseUrl || '').replace(/\/$/, '')}/functions/v1/${functionName}`;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(endpoint, {
        method: 'POST', cache: 'no-store', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', apikey: String(ctx.config.supabasePublishableKey || '') },
        body: JSON.stringify({ ...payload, action, clientType: 'admin', idToken: ctx.idToken }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || data?.ok !== true) throw clientError(String(data?.error?.code || 'API_ERROR'), String(data?.error?.message || '預約服務拒絕此操作。'));
      return data.data || {};
    } catch (error) {
      if (error?.code) throw error;
      if (error?.name === 'AbortError') throw clientError('API_TIMEOUT', '預約服務回應逾時。');
      throw clientError('NETWORK_ERROR', '目前無法連線預約服務。');
    } finally { window.clearTimeout(timer); }
  }

  const cancellationRequest = (action, payload = {}) => requestFunction('booking-cancellation-api', action, payload);
  const bookingRequest = (action, payload = {}) => requestFunction('booking-api', action, payload);

  function waitForAdmin() {
    let attempts = 0;
    const run = async () => {
      attempts += 1;
      if (window.liff?.getIDToken?.()) {
        await refresh(false, true);
        await setupRealtime();
        setupPolling();
        return;
      }
      if (attempts < 80) window.setTimeout(run, 250);
    };
    run();
  }

  async function setupRealtime() {
    try {
      const ctx = await context();
      if (ctx.config.realtimeEnabled === false || !window.supabase?.createClient || realtimeChannel) return;
      realtimeClient = window.supabase.createClient(ctx.config.supabaseUrl, ctx.config.supabasePublishableKey, {
        auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
      });
      realtimeChannel = realtimeClient
        .channel('booking-cancellation-admin-sync')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'realtime_events' }, (payload) => {
          const row = payload?.new || {};
          const scope = String(row.scope || '');
          const type = String(row.event_type || '');
          if ((scope === 'admin' || scope === 'all') && (type.startsWith('booking.cancellation.') || type.startsWith('booking.'))) scheduleRefresh();
        })
        .subscribe((status) => { if (status === 'SUBSCRIBED') scheduleRefresh(); });
    } catch (_) {}
  }

  function setupPolling() {
    if (pollTimer !== null) return;
    pollTimer = window.setInterval(() => {
      if (document.visibilityState === 'visible' && navigator.onLine) refresh(false, activeMode !== MODE_CORE);
    }, POLL_MS);
  }

  function scheduleRefresh() {
    if (realtimeTimer !== null) return;
    realtimeTimer = window.setTimeout(() => {
      realtimeTimer = null;
      refresh(false, true);
    }, 350);
  }

  function onVisibilityChange() { if (document.visibilityState === 'visible') refresh(false, activeMode !== MODE_CORE); }
  function onFocus() { if (document.visibilityState === 'visible') refresh(false, activeMode !== MODE_CORE); }

  function teardown() {
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('focus', onFocus);
    if (realtimeTimer !== null) window.clearTimeout(realtimeTimer);
    if (pollTimer !== null) window.clearInterval(pollTimer);
    realtimeTimer = null; pollTimer = null;
    if (realtimeClient && realtimeChannel) { try { Promise.resolve(realtimeClient.removeChannel(realtimeChannel)).catch(() => {}); } catch (_) {} }
    realtimeChannel = null; realtimeClient = null;
  }

  function activateMode(mode) {
    activeMode = [MODE_REQUESTS, MODE_CANCELLED].includes(mode) ? mode : MODE_CORE;
    els.requestButton.classList.toggle('active', activeMode === MODE_REQUESTS);
    els.cancelledButton.classList.toggle('active', activeMode === MODE_CANCELLED);

    if (activeMode === MODE_CORE) {
      els.bookingCancellationReview.classList.add('hidden');
      els.coreQueue.classList.remove('hidden');
      if (!els.coreQueue.children.length) els.coreEmpty.classList.remove('hidden');
      return;
    }

    els.filter.querySelectorAll('[data-booking-filter]').forEach((button) => button.classList.remove('active'));
    els.coreQueue.classList.add('hidden');
    els.coreEmpty.classList.add('hidden');
    els.bookingCancellationReview.classList.remove('hidden');
    renderActiveMode();
    refresh(false, activeMode === MODE_CANCELLED);
  }

  async function refresh(showSuccess, includeBookings) {
    if (loading || document.visibilityState === 'hidden') return;
    loading = true;
    const errors = [];
    try {
      try {
        const data = await cancellationRequest('admin.list');
        requestRows = Array.isArray(data.requests) ? data.requests : [];
      } catch (error) {
        errors.push(error?.message || '取消申請同步失敗。');
      }

      if (includeBookings) {
        try {
          const data = await bookingRequest('admin.booking.bootstrap');
          cancelledRows = (Array.isArray(data.bookings) ? data.bookings : []).filter((booking) => booking.status === 'cancelled');
        } catch (error) {
          errors.push(error?.message || '已取消預約同步失敗。');
        }
      }

      updateFilterLabels();
      if (activeMode !== MODE_CORE) renderActiveMode();
      if (errors.length) showMessage(errors.join(' '), 'error');
      else if (showSuccess) showMessage('取消預約資料已更新。', 'success');
      else clearMessage();
    } finally { loading = false; }
  }

  function updateFilterLabels() {
    els.requestButton.textContent = requestRows.length ? `取消申請（${requestRows.length}）` : '取消申請';
    els.cancelledButton.textContent = cancelledRows.length ? `已取消（${cancelledRows.length}）` : '已取消';
  }

  function renderActiveMode() {
    if (activeMode === MODE_REQUESTS) renderRequests();
    else if (activeMode === MODE_CANCELLED) renderCancelled();
  }

  function renderRequests() {
    els.bookingCancellationReviewKicker.textContent = 'Cancellation requests';
    els.bookingCancellationReviewTitle.textContent = '取消申請';
    els.bookingCancellationReviewDescription.textContent = '會員申請取消後，原預約時段仍保留；管理端確認取消後才會重新開放。';
    els.bookingCancellationReviewCount.className = 'booking-admin-status status-pending';
    renderRows(requestRows, '目前沒有待確認的取消申請', requestCard);
  }

  function renderCancelled() {
    els.bookingCancellationReviewKicker.textContent = 'Cancelled bookings';
    els.bookingCancellationReviewTitle.textContent = '已取消';
    els.bookingCancellationReviewDescription.textContent = '顯示已完成取消的預約紀錄；此分頁僅供查詢，不會重新開放或變更其他預約。';
    els.bookingCancellationReviewCount.className = 'booking-admin-status status-cancelled';
    renderRows(cancelledRows, '目前沒有已取消的預約', cancelledCard);
  }

  function renderRows(rows, emptyText, cardFactory) {
    els.bookingCancellationReviewList.replaceChildren();
    els.bookingCancellationReviewCount.textContent = `${rows.length} 筆`;
    const emptyParagraph = els.bookingCancellationReviewEmpty.querySelector('p');
    if (emptyParagraph) emptyParagraph.textContent = emptyText;
    els.bookingCancellationReviewEmpty.classList.toggle('hidden', rows.length > 0);
    rows.forEach((row) => els.bookingCancellationReviewList.appendChild(cardFactory(row)));
  }

  function requestCard(row) {
    const article = document.createElement('article'); article.className = 'booking-cancellation-card';
    const top = document.createElement('div'); top.className = 'booking-cancellation-top';
    const identity = document.createElement('div');
    const name = document.createElement('strong'); name.textContent = row.memberDisplayName || '會員';
    const code = document.createElement('small'); code.textContent = row.memberCode || '無會員編號';
    identity.append(name, code);
    const badge = document.createElement('span'); badge.className = 'booking-admin-status status-pending'; badge.textContent = '取消待確認';
    top.append(identity, badge); article.appendChild(top);

    const time = document.createElement('p'); time.className = 'booking-cancellation-time';
    time.textContent = `${formatDate(row.bookingDate)} ${row.startTime}–${row.endTime} · 原狀態：${row.sourceStatus === 'confirmed' ? '已確認' : '待確認'} · 申請時間：${formatDateTime(row.cancellationRequestedAt)}`;
    article.appendChild(time);

    appendItems(article, row.items || []);
    if (row.memberNote) appendNote(article, `會員備註：${row.memberNote}`);
    if (row.cancellationReason) appendNote(article, `取消原因：${row.cancellationReason}`);

    const actions = document.createElement('div'); actions.className = 'booking-cancellation-actions';
    const keep = document.createElement('button'); keep.type = 'button'; keep.className = 'button button-outline'; keep.textContent = '保留預約';
    const approve = document.createElement('button'); approve.type = 'button'; approve.className = 'button button-danger'; approve.textContent = '確認取消';
    keep.addEventListener('click', () => review(row, 'admin.reject', actions));
    approve.addEventListener('click', () => review(row, 'admin.approve', actions));
    actions.append(keep, approve); article.appendChild(actions);
    return article;
  }

  function cancelledCard(row) {
    const article = document.createElement('article'); article.className = 'booking-cancellation-card';
    const top = document.createElement('div'); top.className = 'booking-cancellation-top';
    const identity = document.createElement('div');
    const name = document.createElement('strong'); name.textContent = row.memberDisplayName || '會員';
    const code = document.createElement('small'); code.textContent = row.memberCode || '無會員編號';
    identity.append(name, code);
    const badge = document.createElement('span'); badge.className = 'booking-admin-status status-cancelled'; badge.textContent = '已取消';
    top.append(identity, badge); article.appendChild(top);

    const title = document.createElement('strong');
    title.textContent = bookingDisplayTitle(row);
    article.appendChild(title);

    const time = document.createElement('p'); time.className = 'booking-cancellation-time';
    const duration = Number(row.totalDurationMinutes || 0);
    const amount = formatMoney(row.totalAmount);
    time.textContent = `${formatDate(row.bookingDate)} ${row.startTime}–${row.endTime}${duration ? ` · 原預約 ${duration} 分鐘` : ''}${amount ? ` · 總額 ${amount}` : ''} · 最後更新：${formatDateTime(row.updatedAt)}`;
    article.appendChild(time);

    appendItems(article, row.items || []);
    if (row.memberNote) appendNote(article, `會員備註：${row.memberNote}`);
    if (row.adminNote) appendNote(article, `管理端說明：${row.adminNote}`);
    return article;
  }

  function appendItems(article, items) {
    const visibleItems = (Array.isArray(items) ? items : []).filter((item) => item.serviceTitle);
    if (!visibleItems.length) return;
    const list = document.createElement('ul'); list.className = 'booking-cancellation-items';
    visibleItems.forEach((item) => {
      const li = document.createElement('li');
      const quantity = Number(item.quantity || 1);
      li.textContent = `${item.serviceTitle} × ${quantity}`;
      list.appendChild(li);
    });
    article.appendChild(list);
  }

  function appendNote(article, text) {
    const note = document.createElement('p'); note.className = 'booking-cancellation-note'; note.textContent = text; article.appendChild(note);
  }

  function bookingDisplayTitle(booking) {
    const titles = (Array.isArray(booking?.items) ? booking.items : []).map((item) => item.serviceTitle).filter(Boolean);
    return titles.length ? titles.join(' + ') : booking?.serviceTitle || '預約項目';
  }

  async function review(row, action, actions) {
    const approving = action === 'admin.approve';
    const message = approving
      ? `確認取消 ${row.memberDisplayName || '此會員'} ${formatDate(row.bookingDate)} ${row.startTime} 的預約？\n\n確認後原時段會重新開放。`
      : `確定保留 ${row.memberDisplayName || '此會員'} 的原預約？`;
    if (!window.confirm(message)) return;
    actions.querySelectorAll('button').forEach((button) => { button.disabled = true; });
    try {
      await cancellationRequest(action, { bookingId: row.bookingId, expectedUpdatedAt: row.updatedAt });
      showMessage(approving ? '已確認取消，原預約時段已重新開放。' : '已保留預約，取消申請已結束。', 'success');
      await refresh(false, true);
      document.getElementById('bookingAdminRefreshButton')?.click();
    } catch (error) {
      showMessage(error?.message || '取消申請處理失敗。', 'error');
      actions.querySelectorAll('button').forEach((button) => { button.disabled = false; });
    }
  }

  function showMessage(message, type) { els.bookingCancellationReviewMessage.textContent = message; els.bookingCancellationReviewMessage.className = `form-message ${type}`; }
  function clearMessage() { els.bookingCancellationReviewMessage.textContent = ''; els.bookingCancellationReviewMessage.className = 'form-message hidden'; }
  function formatDate(value) { const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '')); return match ? `${Number(match[1])}/${Number(match[2])}/${Number(match[3])}` : String(value || '—'); }
  function formatDateTime(value) { if (!value) return '—'; const date = new Date(value); return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('zh-Hant-TW', { timeZone: 'Asia/Taipei', hour12: false }); }
  function formatMoney(value) { const amount = Number(value || 0); return Number.isFinite(amount) ? `NT$${Math.round(amount).toLocaleString('zh-Hant-TW')}` : ''; }
})();
