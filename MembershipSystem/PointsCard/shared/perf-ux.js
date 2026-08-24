(function () {
  'use strict';

  const ADMIN_CARD_SNAPSHOT_TTL_MS = 5000;
  const NON_MUTATING_ACTIONS = new Set([
    'member.me', 'member.point-notifications.list', 'reward.prepare',
    'admin.dashboard', 'admin.summary', 'admin.cards.list',
    'admin.members.search', 'admin.stamps.list', 'admin.reward-confirmations.list',
    'admin.stamp.open', 'admin.reward-confirm.open'
  ]);
  const nativeFetch = window.fetch.bind(window);
  const NativeResponse = window.Response;
  const NativeURL = window.URL;
  const NativeURLSearchParams = window.URLSearchParams;

  let adminCardsSnapshot = null;
  let adminSummaryInFlight = null;
  let networkStatusTimer = 0;

  function isPointsCardGasRequest(input) {
    try {
      const raw = typeof input === 'string' ? input : (input && input.url);
      const url = new NativeURL(String(raw || ''), window.location.href);
      return url.protocol === 'https:' && url.hostname === 'script.google.com' && /\/macros\/s\/[^/]+\/exec\/?$/.test(url.pathname);
    } catch (_) {
      return false;
    }
  }

  function requestAction(input, options) {
    if (!isPointsCardGasRequest(input)) return '';
    if (!options || String(options.method || 'GET').toUpperCase() !== 'POST') return '';
    const body = options.body;
    if (!body || !(body instanceof NativeURLSearchParams)) return '';
    return String(body.get('action') || '');
  }

  function snapshotFresh() {
    return Boolean(adminCardsSnapshot && Date.now() - adminCardsSnapshot.savedAt <= ADMIN_CARD_SNAPSHOT_TTL_MS);
  }

  function clearAdminCardsSnapshot() {
    adminCardsSnapshot = null;
  }

  function saveAdminCardsSnapshot(cards) {
    if (!Array.isArray(cards)) return;
    adminCardsSnapshot = {
      savedAt: Date.now(),
      cards: cards.slice()
    };
  }

  async function captureAdminCards(action, response) {
    if (!response || typeof response.clone !== 'function') return;
    try {
      const data = await response.clone().json();
      if (!data || data.ok !== true || !data.data) return;
      if (action === 'admin.cards.list') {
        saveAdminCardsSnapshot(data.data.cards);
        return;
      }
      if (action === 'admin.summary' || action === 'admin.dashboard') {
        saveAdminCardsSnapshot(data.data.settings && data.data.settings.cards);
      }
    } catch (_) {}
  }

  function syntheticCardsResponse() {
    if (!snapshotFresh() || typeof NativeResponse !== 'function') return null;
    return new NativeResponse(JSON.stringify({
      ok: true,
      data: { cards: adminCardsSnapshot.cards.slice() }
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
      }
    });
  }

  function fetchAndCapture(input, options, action) {
    return nativeFetch(input, options).then(async function (response) {
      await captureAdminCards(action, response);
      return response;
    });
  }

  window.fetch = function (input, options) {
    const action = requestAction(input, options);
    if (!action) return nativeFetch(input, options);

    if (!NON_MUTATING_ACTIONS.has(action)) clearAdminCardsSnapshot();

    if (action === 'admin.cards.list') {
      const cached = syntheticCardsResponse();
      if (cached) return Promise.resolve(cached);
      if (adminSummaryInFlight) {
        return adminSummaryInFlight.then(function () {
          const summaryCards = syntheticCardsResponse();
          if (summaryCards) return summaryCards;
          return fetchAndCapture(input, options, action);
        });
      }
      return fetchAndCapture(input, options, action);
    }

    if (action === 'admin.summary') {
      const request = fetchAndCapture(input, options, action);
      const gate = request.then(function () { return true; }, function () { return false; });
      adminSummaryInFlight = gate;
      gate.finally(function () {
        if (adminSummaryInFlight === gate) adminSummaryInFlight = null;
      });
      return request;
    }

    if (action === 'admin.dashboard') return fetchAndCapture(input, options, action);
    return nativeFetch(input, options);
  };

  function emitNetworkState(state) {
    document.documentElement.dataset.networkState = state;
    try {
      document.dispatchEvent(new CustomEvent('points-card:network-state', { detail: { state: state } }));
    } catch (_) {}
  }

  function installNetworkStatus() {
    if (!document.body || document.getElementById('pointsCardNetworkStatus')) return;
    const status = document.createElement('div');
    status.id = 'pointsCardNetworkStatus';
    status.className = 'points-card-network-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.hidden = true;
    document.body.append(status);

    function show(message, state, autoHide) {
      window.clearTimeout(networkStatusTimer);
      status.textContent = message;
      status.dataset.state = state;
      status.hidden = false;
      emitNetworkState(state);
      if (autoHide) {
        networkStatusTimer = window.setTimeout(function () {
          status.hidden = true;
        }, 2400);
      }
    }

    function showOffline() {
      show('目前離線，請確認網路連線。', 'offline', false);
    }

    function showOnline() {
      show('網路已恢復連線。', 'online', true);
    }

    window.addEventListener('offline', showOffline);
    window.addEventListener('online', showOnline);
    if (window.navigator && window.navigator.onLine === false) showOffline();
    else emitNetworkState('online');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installNetworkStatus, { once: true });
  else installNetworkStatus();
})();
