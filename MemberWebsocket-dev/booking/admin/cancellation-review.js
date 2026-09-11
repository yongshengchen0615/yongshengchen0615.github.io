(() => {
  'use strict';

  const FALLBACK_SYNC_MS = 4000;
  let config = null;
  let loading = false;
  let mounted = false;
  let pollTimer = null;
  let realtimeUnsubscribe = null;
  const els = {};

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();

  function mount() {
    if (mounted) return;
    const queuePanel = document.querySelector('.queue-panel');
    const filterRow = queuePanel?.querySelector('.filter-row');
    if (!queuePanel || !filterRow) return;
    mounted = true;

    const style = document.createElement('style');
    style.textContent = `
      .cancellation-review{margin:0 0 18px;padding:16px;border:1px solid rgba(177,89,45,.2);border-radius:16px;background:#fffaf5}
      .cancellation-review-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:12px}
      .cancellation-review-heading h3{margin:0;font-size:18px}.cancellation-review-heading p{margin:5px 0 0;color:#718078;font-size:13px;line-height:1.5}
      .cancellation-review-count{display:inline-flex;min-width:42px;justify-content:center;padding:5px 9px;border-radius:999px;background:#fff0e6;color:#9b4d23;font-size:11px;font-weight:850}
      .cancellation-review-list{display:grid;gap:10px}.cancellation-review-card{display:grid;gap:9px;padding:13px;border:1px solid rgba(23,53,46,.11);border-radius:13px;background:#fff}
      .cancellation-review-top{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.cancellation-review-top strong{font-size:15px}.cancellation-review-top small{display:block;margin-top:3px;color:#718078}
      .cancellation-review-time,.cancellation-review-items{margin:0;color:#566b62;font-size:13px;line-height:1.55}.cancellation-review-items{padding-left:20px}
      .cancellation-review-actions{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap}.cancellation-review-empty{padding:14px;text-align:center;color:#7b867f;font-size:13px}
      .cancellation-review-message{margin:0 0 10px;padding:10px 12px;border-radius:10px;font-size:13px}.cancellation-review-message.error{background:#fff0ec;color:#a54330}.cancellation-review-message.success{background:#edf7f0;color:#28633d}
      @media(max-width:600px){.cancellation-review-heading,.cancellation-review-top{display:grid}.cancellation-review-actions{display:grid;grid-template-columns:1fr 1fr}.cancellation-review-actions .button{width:100%}}
    `;
    document.head.appendChild(style);

    const section = document.createElement('section');
    section.className = 'cancellation-review';
    section.setAttribute('aria-labelledby', 'cancellationReviewTitle');
    section.innerHTML = `
      <div class="cancellation-review-heading">
        <div><p class="kicker">Cancellation requests</p><h3 id="cancellationReviewTitle">取消申請確認</h3><p>會員申請取消後，原預約時段仍會保留；只有管理端確認取消後才會重新開放。</p></div>
        <span id="cancellationReviewCount" class="cancellation-review-count">0</span>
      </div>
      <div id="cancellationReviewMessage" class="cancellation-review-message hidden" role="status" aria-live="polite"></div>
      <div id="cancellationReviewList" class="cancellation-review-list"></div>
      <div id="cancellationReviewEmpty" class="cancellation-review-empty">目前沒有待確認的取消申請。</div>
      <div style="display:flex;justify-content:flex-end;margin-top:10px"><button id="cancellationReviewRefresh" class="button button-light" type="button">更新取消申請</button></div>`;
    queuePanel.insertBefore(section, filterRow);

    ['cancellationReviewCount','cancellationReviewMessage','cancellationReviewList','cancellationReviewEmpty','cancellationReviewRefresh'].forEach((id) => { els[id] = document.getElementById(id); });
    els.cancellationReviewRefresh.addEventListener('click', () => refresh(true));
    document.getElementById('refreshButton')?.addEventListener('click', () => window.setTimeout(() => refresh(false), 100));
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('beforeunload', teardownSync);
    waitForAdminAndRefresh();
  }

  async function context() {
    if (!config) config = await window.BookingSystem.loadConfig();
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

  function waitForAdminAndRefresh() {
    let attempts = 0;
    const run = async () => {
      attempts += 1;
      if (window.liff?.getIDToken?.()) {
        await refresh(false);
        await setupSync();
        return;
      }
      if (attempts < 60) window.setTimeout(run, 500);
    };
    run();
  }

  async function setupSync() {
    if (pollTimer !== null || realtimeUnsubscribe) return;
    try {
      const ctx = await context();
      if (typeof window.BookingSystem.subscribeRealtime === 'function') {
        realtimeUnsubscribe = window.BookingSystem.subscribeRealtime(ctx.config, () => refresh(false));
      }
    } catch (_) {}
    pollTimer = window.setInterval(() => {
      if (document.visibilityState === 'visible' && navigator.onLine) refresh(false);
    }, FALLBACK_SYNC_MS);
  }

  function teardownSync() {
    if (pollTimer !== null) window.clearInterval(pollTimer);
    pollTimer = null;
    if (typeof realtimeUnsubscribe === 'function') realtimeUnsubscribe();
    realtimeUnsubscribe = null;
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    window.removeEventListener('focus', handleFocus);
  }

  function handleVisibilityChange() {
    if (document.visibilityState === 'visible') refresh(false);
  }

  function handleFocus() {
    if (document.visibilityState === 'visible') refresh(false);
  }

  async function refresh(showSuccess) {
    if (loading || document.visibilityState === 'hidden') return;
    loading = true;
    els.cancellationReviewRefresh.disabled = true;
    try {
      const data = await request('admin.list');
      render(Array.isArray(data.requests) ? data.requests : []);
      if (showSuccess) showMessage('取消申請已更新。', 'success'); else clearMessage();
    } catch (error) {
      showMessage(error?.message || '取消申請載入失敗。', 'error');
    } finally {
      loading = false;
      els.cancellationReviewRefresh.disabled = false;
    }
  }

  function render(requests) {
    els.cancellationReviewList.replaceChildren();
    els.cancellationReviewCount.textContent = String(requests.length);
    els.cancellationReviewEmpty.classList.toggle('hidden', requests.length > 0);
    requests.forEach((requestRow) => els.cancellationReviewList.appendChild(card(requestRow)));
  }

  function card(requestRow) {
    const article = document.createElement('article');
    article.className = 'cancellation-review-card';
    const top = document.createElement('div'); top.className = 'cancellation-review-top';
    const identity = document.createElement('div');
    const name = document.createElement('strong'); name.textContent = requestRow.memberDisplayName || '會員';
    const code = document.createElement('small'); code.textContent = requestRow.memberCode || '無會員編號';
    identity.append(name, code);
    const badge = document.createElement('span'); badge.className = 'status-badge status-pending'; badge.textContent = '取消待確認';
    top.append(identity, badge);

    const time = document.createElement('p'); time.className = 'cancellation-review-time';
    time.textContent = `${formatDate(requestRow.bookingDate)} ${requestRow.startTime}–${requestRow.endTime} · 原狀態：${requestRow.sourceStatus === 'confirmed' ? '已確認' : '待確認'}`;
    article.append(top, time);

    const items = (requestRow.items || []).filter((item) => item.serviceTitle);
    if (items.length) {
      const list = document.createElement('ul'); list.className = 'cancellation-review-items';
      items.forEach((item) => { const li = document.createElement('li'); li.textContent = `${item.serviceTitle} × ${Number(item.quantity || 1)}`; list.appendChild(li); });
      article.appendChild(list);
    }

    const requestedAt = document.createElement('p'); requestedAt.className = 'cancellation-review-time';
    requestedAt.textContent = `申請時間：${formatDateTime(requestRow.cancellationRequestedAt)}`;
    article.appendChild(requestedAt);

    const actions = document.createElement('div'); actions.className = 'cancellation-review-actions';
    const keep = document.createElement('button'); keep.type = 'button'; keep.className = 'button button-light'; keep.textContent = '保留預約';
    const approve = document.createElement('button'); approve.type = 'button'; approve.className = 'button button-dark'; approve.textContent = '確認取消';
    keep.addEventListener('click', () => review(requestRow, 'admin.reject', actions));
    approve.addEventListener('click', () => review(requestRow, 'admin.approve', actions));
    actions.append(keep, approve); article.appendChild(actions);
    return article;
  }

  async function review(requestRow, action, actions) {
    const approving = action === 'admin.approve';
    const message = approving
      ? `確認取消 ${requestRow.memberDisplayName || '此會員'} ${formatDate(requestRow.bookingDate)} ${requestRow.startTime} 的預約？\n\n確認後原時段會重新開放。`
      : `確定不取消 ${requestRow.memberDisplayName || '此會員'} 的預約並保留原時段？`;
    if (!window.confirm(message)) return;
    actions.querySelectorAll('button').forEach((button) => { button.disabled = true; });
    try {
      await request(action, { bookingId: requestRow.bookingId, expectedUpdatedAt: requestRow.updatedAt });
      showMessage(approving ? '已確認取消，原預約時段已重新開放。' : '已保留預約，取消申請已結束。', 'success');
      await refresh(false);
      document.getElementById('refreshButton')?.click();
    } catch (error) {
      showMessage(error?.message || '取消申請處理失敗。', 'error');
      actions.querySelectorAll('button').forEach((button) => { button.disabled = false; });
    }
  }

  function showMessage(message, type) { els.cancellationReviewMessage.textContent = message; els.cancellationReviewMessage.className = `cancellation-review-message ${type}`; }
  function clearMessage() { els.cancellationReviewMessage.textContent = ''; els.cancellationReviewMessage.className = 'cancellation-review-message hidden'; }
  function formatDate(value) { const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '')); return match ? `${Number(match[1])}/${Number(match[2])}/${Number(match[3])}` : String(value || '—'); }
  function formatDateTime(value) { if (!value) return '—'; const date = new Date(value); return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('zh-Hant-TW', { timeZone: 'Asia/Taipei', hour12: false }); }
})();
