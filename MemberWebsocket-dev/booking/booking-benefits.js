(() => {
  'use strict';
  let config = null;
  let idToken = '';
  let sequence = 0;
  let timer = null;
  let inFlight = false;
  let queued = false;
  let disposed = false;
  let renderedItems = [];
  const selected = new Map();
  const kinds = { points: '集點卡票券', event: '活動票券', calendar: '會員活動' };
  const el = (id) => document.getElementById(id);
  const keyFor = (kind, id) => `${String(kind || '')}:${String(id || '')}`;

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

  function selectionPayload() {
    return [...selected.values()].map((item) => ({ kind: item.kind, id: item.id }));
  }

  function selectionSummary() {
    return [...selected.values()].map((item) => ({
      kind: item.kind,
      id: item.id,
      title: item.title || kinds[item.kind] || '可用權益',
      status: item.status || 'pending',
    }));
  }

  function emitSelectionChange() {
    window.dispatchEvent(new CustomEvent('booking:benefits-changed', {
      detail: { benefits: selectionPayload(), summary: selectionSummary() },
    }));
  }

  function updateReadyMessage(cardCount) {
    if (!cardCount) {
      state('empty', '目前沒有可用活動或票券，仍可正常預約。');
      return;
    }
    const count = selected.size;
    state('ready', count
      ? `已選擇 ${count} 項；服務完成時由管理端重新驗證並核銷。`
      : `${cardCount} 項權益 · 可勾選本次預約要使用的項目。`);
  }

  function render(items = renderedItems) {
    renderedItems = Array.isArray(items) ? items : [];
    const list = el('bookingBenefitsList');
    if (!list) return;
    list.replaceChildren();

    for (const item of renderedItems) {
      if (!kinds[item?.kind]) continue;
      const selectionId = String(item.selectionId || '');
      const key = keyFor(item.kind, selectionId);
      const isSelected = Boolean(selectionId && selected.has(key));
      const selectable = item.selectable === true && Boolean(selectionId);

      const card = document.createElement('article');
      card.className = `booking-benefit${isSelected ? ' is-selected' : ''}`;

      const meta = document.createElement('p');
      meta.className = 'booking-benefit-meta';
      meta.textContent = `${kinds[item.kind]} · ${String(item.statusLabel || '')}`;

      const title = document.createElement('h3');
      title.textContent = String(item.title || '可用權益');

      const copy = document.createElement('p');
      copy.textContent = String(item.subtitle || '');

      const expires = document.createElement('small');
      expires.textContent = item.endsOn ? `有效至 ${String(item.endsOn).replaceAll('-', '/')}` : '依使用說明適用';

      if (selectionId) {
        const choose = document.createElement('label');
        choose.className = 'booking-benefit-select';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = isSelected;
        input.disabled = !selectable && !isSelected;
        input.setAttribute('aria-label', `本次預約使用${String(item.title || '此權益')}`);
        const label = document.createElement('span');
        label.textContent = selectable ? '本次預約使用' : (isSelected ? '已選擇（可取消）' : '目前不可勾選');
        choose.append(input, label);
        input.addEventListener('change', () => {
          if (input.checked && !selectable) {
            input.checked = false;
            return;
          }
          if (input.checked) {
            selected.set(key, { kind: item.kind, id: selectionId, title: String(item.title || ''), status: 'pending' });
          } else {
            selected.delete(key);
          }
          render(renderedItems);
          emitSelectionChange();
        });
        card.append(meta, title, copy, expires, choose);
      } else {
        card.append(meta, title, copy, expires);
      }

      if (!selectable && item.disabledReason) {
        const reason = document.createElement('small');
        reason.className = 'booking-benefit-disabled-reason';
        reason.textContent = String(item.disabledReason);
        card.appendChild(reason);
      }

      const href = destination(item);
      if (href) {
        const link = document.createElement('a');
        link.className = 'booking-benefit-link';
        link.href = href;
        link.textContent = '查看詳情';
        link.setAttribute('aria-label', `查看${String(item.title || '可用權益')}詳情`);
        card.appendChild(link);
      }
      list.append(card);
    }
    updateReadyMessage(list.children.length);
  }

  function setSelection(items) {
    selected.clear();
    for (const item of Array.isArray(items) ? items : []) {
      const kind = String(item?.kind || item?.benefitKind || '');
      const id = String(item?.id || item?.benefitRef || '');
      if (!kinds[kind] || !id) continue;
      selected.set(keyFor(kind, id), {
        kind, id,
        title: String(item?.title || item?.titleSnapshot || ''),
        status: String(item?.status || 'pending'),
      });
    }
    if (el('bookingBenefitsList')) render(renderedItems);
    emitSelectionChange();
  }

  function clearSelection() {
    if (!selected.size) return;
    selected.clear();
    if (el('bookingBenefitsList')) render(renderedItems);
    emitSelectionChange();
  }

  async function load() {
    if (!config || disposed) return;
    if (inFlight) { queued = true; return; }
    const current = ++sequence;
    inFlight = true;
    state('loading', '正在確認你的可用權益…');
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

  window.BookingBenefits = Object.freeze({
    start,
    invalidate,
    selectionPayload,
    selectionSummary,
    setSelection,
    clearSelection,
  });
})();
