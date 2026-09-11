(() => {
  'use strict';

  const POLL_MS = 12000;
  let config = null;
  let loading = false;
  let mounted = false;
  let realtimeClient = null;
  let realtimeChannel = null;
  let realtimeTimer = null;
  let pollTimer = null;
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
    mounted = true;

    const filter = queuePanel.querySelector('.booking-admin-filter');
    const section = document.createElement('section');
    section.id = 'bookingCancellationReview';
    section.className = 'booking-admin-cancellation-review';
    section.setAttribute('aria-labelledby', 'bookingCancellationReviewTitle');
    section.innerHTML = `
      <div class="booking-admin-section-heading booking-cancellation-heading">
        <div><p class="kicker">Cancellation requests</p><h3 id="bookingCancellationReviewTitle">取消申請確認</h3><p>會員申請取消後，原預約時段仍保留；管理端確認取消後才會重新開放。</p></div>
        <span id="bookingCancellationReviewCount" class="booking-admin-status status-pending">0 筆</span>
      </div>
      <div id="bookingCancellationReviewMessage" class="form-message hidden" role="status" aria-live="polite"></div>
      <div id="bookingCancellationReviewList" class="booking-admin-queue"></div>
      <div id="bookingCancellationReviewEmpty" class="empty-state compact"><span aria-hidden="true">○</span><p>目前沒有待確認的取消申請</p></div>`;
    queuePanel.insertBefore(section, filter || queuePanel.firstChild);

    ['bookingCancellationReviewCount','bookingCancellationReviewMessage','bookingCancellationReviewList','bookingCancellationReviewEmpty'].forEach((id) => { els[id] = document.getElementById(id); });
    injectStyles();
    document.getElementById('bookingAdminRefreshButton')?.addEventListener('click', () => window.setTimeout(() => refresh(false), 150));
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
      .booking-admin-cancellation-review{display:grid;gap:12px;margin:0 0 16px;padding:16px;border:1px solid rgba(177,89,45,.22);border-radius:16px;background:#fffaf5}
      .booking-cancellation-heading{margin:0}.booking-cancellation-card{display:grid;gap:9px;padding:14px;border:1px solid rgba(23,53,46,.12);border-radius:14px;background:#fff}
      .booking-cancellation-top{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.booking-cancellation-top small{display:block;margin-top:3px;color:#718078}
      .booking-cancellation-time{margin:0;color:#566b62;font-size:13px;line-height:1.55}.booking-cancellation-items{margin:0;padding-left:20px;color:#566b62;font-size:13px;line-height:1.6}
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

  async function request(action, payload = {}) {
    const ctx = await context();
    const endpoint = `${String(ctx.config.supabaseUrl || '').replace(/\/$/, '')}/functions/v1/booking-cancellation-api`;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(endpoint, {
        method: 'POST', cache: 'no-store', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', apikey: String(ctx.config.supabasePublishableKey || '') },
        body: JSON.stringify({ ...payload, action, clientType: 'admin', idToken: ctx.idToken }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || data?.ok !== true) throw clientError(String(data?.error?.code || 'API_ERROR'), String(data?.error?.message || '取消申請服務拒絕此操作。'));
      return data.data || {};
    } catch (error) {
      if (error?.code) throw error;
      if (error?.name === 'AbortError') throw clientError('API_TIMEOUT', '取消申請服務回應逾時。');
      throw clientError('NETWORK_ERROR', '目前無法連線取消申請服務。');
    } finally { window.clearTimeout(timer); }
  }

  function waitForAdmin() {
    let attempts = 0;
    const run = async () => {
      attempts += 1;
      if (window.liff?.getIDToken?.()) {
        await refresh(false);
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
          if ((scope === 'admin' || scope === 'all') && type.startsWith('booking.cancellation.')) scheduleRefresh();
        })
        .subscribe((status) => { if (status === 'SUBSCRIBED') scheduleRefresh(); });
    } catch (_) {}
  }

  function setupPolling() {
    if (pollTimer !== null) return;
    pollTimer = window.setInterval(() => {
      if (document.visibilityState === 'visible' && navigator.onLine) refresh(false);
    }, POLL_MS);
  }

  function scheduleRefresh() {
    if (realtimeTimer !== null) return;
    realtimeTimer = window.setTimeout(() => {
      realtimeTimer = null;
      refresh(false);
    }, 350);
  }

  function onVisibilityChange() { if (document.visibilityState === 'visible') refresh(false); }
  function onFocus() { if (document.visibilityState === 'visible') refresh(false); }

  function teardown() {
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('focus', onFocus);
    if (realtimeTimer !== null) window.clearTimeout(realtimeTimer);
    if (pollTimer !== null) window.clearInterval(pollTimer);
    realtimeTimer = null; pollTimer = null;
    if (realtimeClient && realtimeChannel) { try { Promise.resolve(realtimeClient.removeChannel(realtimeChannel)).catch(() => {}); } catch (_) {} }
    realtimeChannel = null; realtimeClient = null;
  }

  async function refresh(showSuccess) {
    if (loading || document.visibilityState === 'hidden') return;
    loading = true;
    try {
      const data = await request('admin.list');
      const rows = Array.isArray(data.requests) ? data.requests : [];
      render(rows);
      if (showSuccess) showMessage('取消申請已更新。', 'success'); else clearMessage();
    } catch (error) {
      showMessage(error?.message || '取消申請同步失敗。', 'error');
    } finally { loading = false; }
  }

  function render(rows) {
    els.bookingCancellationReviewList.replaceChildren();
    els.bookingCancellationReviewCount.textContent = `${rows.length} 筆`;
    els.bookingCancellationReviewEmpty.classList.toggle('hidden', rows.length > 0);
    rows.forEach((row) => els.bookingCancellationReviewList.appendChild(card(row)));
  }

  function card(row) {
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

    const items = (row.items || []).filter((item) => item.serviceTitle);
    if (items.length) {
      const list = document.createElement('ul'); list.className = 'booking-cancellation-items';
      items.forEach((item) => { const li = document.createElement('li'); li.textContent = `${item.serviceTitle} × ${Number(item.quantity || 1)}`; list.appendChild(li); });
      article.appendChild(list);
    }

    const actions = document.createElement('div'); actions.className = 'booking-cancellation-actions';
    const keep = document.createElement('button'); keep.type = 'button'; keep.className = 'button button-outline'; keep.textContent = '保留預約';
    const approve = document.createElement('button'); approve.type = 'button'; approve.className = 'button button-danger'; approve.textContent = '確認取消';
    keep.addEventListener('click', () => review(row, 'admin.reject', actions));
    approve.addEventListener('click', () => review(row, 'admin.approve', actions));
    actions.append(keep, approve); article.appendChild(actions);
    return article;
  }

  async function review(row, action, actions) {
    const approving = action === 'admin.approve';
    const message = approving
      ? `確認取消 ${row.memberDisplayName || '此會員'} ${formatDate(row.bookingDate)} ${row.startTime} 的預約？\n\n確認後原時段會重新開放。`
      : `確定保留 ${row.memberDisplayName || '此會員'} 的原預約？`;
    if (!window.confirm(message)) return;
    actions.querySelectorAll('button').forEach((button) => { button.disabled = true; });
    try {
      await request(action, { bookingId: row.bookingId, expectedUpdatedAt: row.updatedAt });
      showMessage(approving ? '已確認取消，原預約時段已重新開放。' : '已保留預約，取消申請已結束。', 'success');
      await refresh(false);
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
})();
