(() => {
  'use strict';
  let config = null;
  let idToken = '';
  let sequence = 0;
  let timer = null;
  let inFlight = false;
  let queued = false;
  let disposed = false;
  const kinds = { points: '集點卡票券', event: '活動票券', calendar: '會員活動' };
  const el = (id) => document.getElementById(id);

  function state(value, message) {
    const section = el('bookingBenefits');
    if (!section) return;
    section.dataset.state = value;
    el('bookingBenefitsStatus').textContent = message;
    el('bookingBenefitsRetry').classList.toggle('hidden', value !== 'error');
    el('bookingBenefitsList').setAttribute('aria-busy', String(value === 'loading'));
  }

  function destination(item) {
    const surface = { points: 'points', event: 'event', calendar: 'calendar' }[item.kind];
    if (!surface) return '';
    const url = new URL(`../${surface}/`, window.location.href);
    if (item.kind === 'event') {
      url.searchParams.set('source', 'event-ticket-calendar');
      url.searchParams.set('eventTicketId', String(item.id || ''));
    }
    return url.href;
  }

  function render(items) {
    const list = el('bookingBenefitsList');
    list.replaceChildren();
    for (const item of items) {
      if (!kinds[item?.kind]) continue;
      const card = document.createElement('article');
      card.className = 'booking-benefit';
      const meta = document.createElement('p');
      meta.className = 'booking-benefit-meta';
      meta.textContent = `${kinds[item.kind]} · ${String(item.statusLabel || '')}`;
      const title = document.createElement('h3');
      title.textContent = String(item.title || '可用權益');
      const copy = document.createElement('p');
      copy.textContent = String(item.subtitle || '');
      const expires = document.createElement('small');
      expires.textContent = item.endsOn ? `有效至 ${String(item.endsOn).replaceAll('-', '/')}` : '依使用說明適用';
      const link = document.createElement('a');
      link.className = 'booking-benefit-link';
      link.href = destination(item);
      // Viewing is navigation only; claiming/redemption requires the existing
      // destination's explicit confirmation and server-side authorization.
      link.textContent = '查看詳情';
      link.setAttribute('aria-label', `查看${String(item.title || '可用權益')}詳情`);
      card.append(meta, title, copy, expires, link);
      list.append(card);
    }
    state(list.children.length ? 'ready' : 'empty', list.children.length
      ? `${list.children.length} 項可用權益 · 查看詳情後再決定領取或使用`
      : '目前沒有可用活動或票券，仍可正常預約。');
  }

  async function load() {
    if (!config || disposed) return;
    if (inFlight) { queued = true; return; }
    const current = ++sequence;
    inFlight = true;
    state('loading', '正在確認你的可用權益…');
    // Hide stale recommendations immediately while authoritative data reloads.
    el('bookingBenefitsList')?.replaceChildren();
    try {
      const result = await window.BookingSystem.bookingBenefits(config, idToken);
      if (current !== sequence || disposed) return;
      render(Array.isArray(result?.items) ? result.items : []);
    } catch (_) {
      if (current !== sequence || disposed) return;
      state('error', '活動與票券暫時無法載入，仍可正常預約。');
    } finally {
      inFlight = false;
      if (queued && !disposed) { queued = false; invalidate(); }
    }
  }

  function invalidate() {
    if (!config || disposed) return;
    if (inFlight) {
      sequence += 1;
      queued = true;
      return;
    }
    if (timer !== null) return;
    state('loading', '正在更新可用權益…');
    el('bookingBenefitsList')?.replaceChildren();
    timer = window.setTimeout(() => { timer = null; void load(); }, 450);
  }

  function start(nextConfig, token) {
    if (config || !el('bookingBenefits')) return;
    config = nextConfig;
    idToken = token;
    el('bookingBenefitsRetry')?.addEventListener('click', () => {
      if (timer !== null) { window.clearTimeout(timer); timer = null; }
      void load();
    });
    void load();
  }

  // Date eligibility changes at Taipei midnight. Realtime and page resume cover
  // other changes without adding a polling loop to every member's booking page.
  let freshness = null;
  function scheduleMidnight() {
    const day = 86_400_000;
    const localTime = (Date.now() + 8 * 3_600_000) % day;
    freshness = window.setTimeout(() => {
      if (document.visibilityState !== 'hidden' && navigator.onLine) invalidate();
      scheduleMidnight();
    }, day - localTime + 1000);
  }
  scheduleMidnight();
  window.addEventListener('pagehide', (event) => {
    if (event.persisted) return;
    disposed = true;
    sequence += 1;
    window.clearTimeout(freshness);
    if (timer !== null) window.clearTimeout(timer);
  });
  window.BookingBenefits = Object.freeze({ start, invalidate });
})();
