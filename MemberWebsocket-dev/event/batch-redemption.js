(() => {
  'use strict';

  const state = {
    config: null,
    idToken: '',
    maxTicketsPerRedemption: 1,
    offers: [],
    selected: new Set(),
    busy: false,
    refreshPromise: null,
    initialized: false
  };

  let toolbar = null;
  let selectionText = null;
  let selectionHint = null;
  let useButton = null;
  let messageBox = null;
  let observer = null;

  function endpoint() {
    return `${String(state.config && state.config.supabaseUrl || '').replace(/\/$/, '')}/functions/v1/event-ticket-extension-api`;
  }

  function testSessionToken() {
    return window.TestModeClient && typeof window.TestModeClient.getSessionToken === 'function'
      ? String(window.TestModeClient.getSessionToken() || '')
      : '';
  }

  function normalizeLimit(value) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 1 && parsed <= 50 ? parsed : 1;
  }

  async function extensionRequest(operation, payload = {}) {
    const response = await fetch(endpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: String(state.config && state.config.supabasePublishableKey || '') },
      cache: 'no-store',
      body: JSON.stringify({
        ...payload,
        operation,
        idToken: state.idToken,
        testSessionToken: testSessionToken()
      })
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result || result.ok !== true) {
      const error = new Error(result && result.error && result.error.message || '活動票券服務暫時無法完成操作。');
      error.code = result && result.error && result.error.code || 'API_ERROR';
      throw error;
    }
    return result.data || {};
  }

  function offerEventTicketId(offer) {
    return String(offer && offer.ticket && offer.ticket.eventTicketId || offer && offer.claim && offer.claim.eventTicketId || '').trim();
  }

  function offerClaimId(offer) {
    return String(offer && offer.claim && offer.claim.claimId || '').trim();
  }

  function usableOffers() {
    return state.offers.filter((offer) => Boolean(offer && !offer.history && offer.claim && offer.canUse && offerClaimId(offer)));
  }

  function selectedOffers() {
    const ids = state.selected;
    return usableOffers().filter((offer) => ids.has(offerClaimId(offer)));
  }

  function ensureToolbar() {
    if (toolbar && document.contains(toolbar)) return toolbar;
    const eventToolbar = document.querySelector('.event-toolbar');
    if (!eventToolbar) return null;
    toolbar = document.createElement('section');
    toolbar.className = 'event-batch-toolbar';
    toolbar.setAttribute('aria-label', '活動票券多張使用');
    toolbar.innerHTML = '<div class="event-batch-copy"><strong data-event-batch-selection>尚未選擇票券</strong><small data-event-batch-hint>勾選已領取且目前可用的活動票券，可一次確認使用。</small></div><button class="event-batch-use-button" type="button" disabled>使用已選票券</button><p class="event-batch-message hidden" role="status" aria-live="polite"></p>';
    eventToolbar.insertAdjacentElement('afterend', toolbar);
    selectionText = toolbar.querySelector('[data-event-batch-selection]');
    selectionHint = toolbar.querySelector('[data-event-batch-hint]');
    useButton = toolbar.querySelector('.event-batch-use-button');
    messageBox = toolbar.querySelector('.event-batch-message');
    useButton.addEventListener('click', redeemSelected);
    return toolbar;
  }

  function showMessage(message = '', error = false) {
    ensureToolbar();
    if (!messageBox) return;
    messageBox.textContent = message;
    messageBox.classList.toggle('hidden', !message);
    messageBox.classList.toggle('is-error', Boolean(error));
  }

  function updateToolbar() {
    ensureToolbar();
    if (!toolbar) return;
    const usableCount = usableOffers().length;
    const selectedCount = state.selected.size;
    selectionText.textContent = selectedCount
      ? `已選 ${selectedCount} / ${state.maxTicketsPerRedemption} 張`
      : `單次最多可使用 ${state.maxTicketsPerRedemption} 張`;
    selectionHint.textContent = usableCount
      ? `目前有 ${usableCount} 張已領取且可使用；最多同時選擇 ${state.maxTicketsPerRedemption} 張。`
      : '目前沒有已領取且可立即使用的活動票券。';
    useButton.disabled = state.busy || selectedCount < 1 || selectedCount > state.maxTicketsPerRedemption;
    useButton.textContent = state.busy ? '核銷中…' : selectedCount > 1 ? `使用已選 ${selectedCount} 張` : '使用已選票券';
  }

  function findCard(eventTicketId) {
    const buttons = document.querySelectorAll('#eventList [data-event-ticket-id]');
    for (const button of buttons) {
      if (String(button.dataset.eventTicketId || '') === eventTicketId) return button.closest('.event-ticket');
    }
    return null;
  }

  function decorateCards() {
    const usable = usableOffers();
    const usableByEvent = new Map(usable.map((offer) => [offerEventTicketId(offer), offer]));

    document.querySelectorAll('#eventList .event-ticket').forEach((card) => {
      const button = card.querySelector('[data-event-ticket-id]');
      const eventTicketId = String(button && button.dataset.eventTicketId || '');
      const offer = usableByEvent.get(eventTicketId);
      const existing = card.querySelector('[data-event-batch-select]');
      if (!offer) {
        existing && existing.remove();
        return;
      }

      const claimId = offerClaimId(offer);
      let control = existing;
      if (!control) {
        control = document.createElement('label');
        control.className = 'event-batch-select';
        control.dataset.eventBatchSelect = 'true';
        control.innerHTML = '<input type="checkbox"><span>加入本次使用</span>';
        const action = card.querySelector('.event-ticket-action') || card;
        action.insertBefore(control, action.firstChild);
        control.querySelector('input').addEventListener('change', handleSelectionChange);
      }
      const input = control.querySelector('input');
      input.dataset.claimId = claimId;
      input.checked = state.selected.has(claimId);
      input.disabled = state.busy || (!input.checked && state.selected.size >= state.maxTicketsPerRedemption);
    });
    updateToolbar();
  }

  function handleSelectionChange(event) {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    const claimId = String(input.dataset.claimId || '');
    if (!claimId) return;
    showMessage('');
    if (input.checked) {
      if (state.selected.size >= state.maxTicketsPerRedemption) {
        input.checked = false;
        showMessage(`單次最多可使用 ${state.maxTicketsPerRedemption} 張活動票券。`, true);
      } else {
        state.selected.add(claimId);
      }
    } else {
      state.selected.delete(claimId);
    }
    decorateCards();
  }

  function currentLocation() {
    if (!navigator.geolocation) return Promise.reject(new Error('此裝置無法定位，需要定位的票券尚未核銷。'));
    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (position) => resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          observedAt: new Date(position.timestamp).toISOString()
        }),
        () => reject(new Error('定位遭拒或逾時，票券尚未核銷。請允許定位後重試。')),
        { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
      );
    });
  }

  function requestId() {
    if (crypto && typeof crypto.randomUUID === 'function') return 'EVB-' + crypto.randomUUID().replaceAll('-', '');
    return 'EVB-' + Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  async function redeemSelected() {
    if (state.busy) return;
    const offers = selectedOffers();
    if (!offers.length) return;
    if (offers.length > state.maxTicketsPerRedemption) {
      showMessage(`單次最多可使用 ${state.maxTicketsPerRedemption} 張活動票券。`, true);
      return;
    }

    const titles = offers.map((offer) => String(offer.ticket && offer.ticket.title || '活動票券'));
    const requiresLocation = offers.some((offer) => Boolean(offer.ticket && offer.ticket.requiresLocation));
    if (!window.confirm(`確定現在一次使用 ${offers.length} 張活動票券？\n\n${titles.map((title) => '・' + title).join('\n')}\n\n確認後將立即核銷且無法復原。`)) return;

    state.busy = true;
    decorateCards();
    showMessage(requiresLocation ? '正在取得定位並確認票券使用條件…' : '正在確認票券使用條件…');

    try {
      const location = requiresLocation ? await currentLocation() : null;
      const result = await extensionRequest('member.redeem', {
        claimIds: offers.map(offerClaimId),
        requestId: requestId(),
        location
      });
      state.selected.clear();
      const count = Number(result.ticketCount || offers.length);
      const lotteryResults = Array.isArray(result.tickets)
        ? result.tickets.filter((ticket) => ticket && ticket.ticketType === 'lottery' && ticket.result)
        : [];
      const extra = lotteryResults.length
        ? ' ' + lotteryResults.map((ticket) => `${ticket.ticketTitle}：${ticket.result.prizeTitle || '結果已記錄'}`).join('；')
        : '';
      showMessage(`已成功使用 ${count} 張活動票券。${extra}`);
      window.dispatchEvent(new CustomEvent('event-ticket:batch-redeemed', { detail: result }));
      await refreshSnapshot();
      window.setTimeout(() => {
        const refresh = document.getElementById('todayUsableTicketCount');
        if (refresh) window.dispatchEvent(new Event('focus'));
      }, 100);
    } catch (error) {
      showMessage(error && error.message || '活動票券核銷失敗，請重新整理後再試。', true);
    } finally {
      state.busy = false;
      decorateCards();
    }
  }

  async function refreshSnapshot() {
    if (!state.config || !state.idToken) return;
    if (state.refreshPromise) return state.refreshPromise;
    state.refreshPromise = (async () => {
      const [setting, snapshot] = await Promise.all([
        extensionRequest('member.settings.get'),
        window.MemberSystem.request(state.config, 'event', state.idToken, 'user.event.bootstrap', { compact: false })
      ]);
      state.maxTicketsPerRedemption = normalizeLimit(setting.maxTicketsPerRedemption);
      state.offers = Array.isArray(snapshot && snapshot.offers) ? snapshot.offers : [];
      const validClaims = new Set(usableOffers().map(offerClaimId));
      for (const claimId of [...state.selected]) if (!validClaims.has(claimId)) state.selected.delete(claimId);
      ensureToolbar();
      decorateCards();
    })();
    try { await state.refreshPromise; } finally { state.refreshPromise = null; }
  }

  function connectObserver() {
    const list = document.getElementById('eventList');
    if (!list || observer) return;
    observer = new MutationObserver(() => {
      window.setTimeout(() => {
        decorateCards();
        if (!state.busy) refreshSnapshot().catch(() => {});
      }, 0);
    });
    observer.observe(list, { childList: true });
  }

  async function initialize() {
    const session = window.MemberSystem && typeof window.MemberSystem.getSession === 'function'
      ? window.MemberSystem.getSession('event')
      : null;
    if (!session) return;
    state.config = session.config;
    state.idToken = session.idToken;
    ensureToolbar();
    connectObserver();
    try {
      await refreshSnapshot();
      state.initialized = true;
    } catch (error) {
      showMessage(error && error.message || '活動票券多張使用設定暫時無法載入。', true);
    }
  }

  window.addEventListener('user-tour:ready', (event) => {
    if (event && event.detail && event.detail.surface === 'event') initialize();
  });
  window.addEventListener('focus', () => {
    if (state.initialized && !state.busy) refreshSnapshot().catch(() => {});
  });
  window.addEventListener('event-ticket:batch-redeemed', () => {
    if (!state.busy) refreshSnapshot().catch(() => {});
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      ensureToolbar();
      connectObserver();
      initialize();
    }, { once: true });
  } else {
    ensureToolbar();
    connectObserver();
    initialize();
  }
})();
