(() => {
  'use strict';

  const baseSystem = window.MemberSystem;
  if (!baseSystem || typeof baseSystem.request !== 'function') return;

  const limitsByCard = new Map();
  let currentConfig = null;
  let currentIdToken = '';
  let syncTimer = 0;

  function endpointFor(config) {
    const root = String(config && config.supabaseUrl || '').replace(/\/$/, '');
    return `${root}/functions/v1/point-ticket-batch-api`;
  }

  async function requestLimits(config, idToken) {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    let timer;
    try {
      if (controller) timer = window.setTimeout(() => controller.abort(), 12000);
      const response = await fetch(endpointFor(config), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': String(config && config.supabasePublishableKey || '')
        },
        cache: 'no-store',
        signal: controller ? controller.signal : undefined,
        body: JSON.stringify({ action: 'admin.pointcards.ticket-limits', idToken })
      });
      const payload = await response.json();
      if (!response.ok || !payload || payload.ok !== true) throw new Error(payload && payload.error && payload.error.message || '無法讀取票券張數上限。');
      const cards = payload.data && Array.isArray(payload.data.cards) ? payload.data.cards : [];
      for (const card of cards) {
        const cardId = String(card.cardId || '');
        const limit = Number(card.maxTicketsPerRedemption || 1);
        if (cardId) limitsByCard.set(cardId, Number.isInteger(limit) && limit >= 1 && limit <= 50 ? limit : 1);
      }
      return cards;
    } finally {
      if (timer) window.clearTimeout(timer);
    }
  }

  function limitInput() {
    return document.getElementById('cardMaxTicketsPerRedemption');
  }

  function normalizedLimit(value) {
    const limit = Number(value);
    return Number.isInteger(limit) && limit >= 1 && limit <= 50 ? limit : 0;
  }

  function syncInputFromCard() {
    const input = limitInput();
    const cardIdField = document.getElementById('cardId');
    if (!input || !cardIdField) return;
    const cardId = String(cardIdField.value || '');
    input.value = String(cardId ? limitsByCard.get(cardId) || 1 : 1);
  }

  function scheduleInputSync(delay = 0) {
    if (syncTimer) window.clearTimeout(syncTimer);
    syncTimer = window.setTimeout(() => {
      syncTimer = 0;
      syncInputFromCard();
    }, delay);
  }

  async function enrichCards(config, idToken, result) {
    currentConfig = config;
    currentIdToken = idToken;
    try { await requestLimits(config, idToken); }
    catch (_) {}
    if (result && Array.isArray(result.cards)) {
      result.cards = result.cards.map((card) => ({
        ...card,
        maxTicketsPerRedemption: limitsByCard.get(String(card.cardId || '')) || 1
      }));
    }
    scheduleInputSync(0);
    return result;
  }

  const wrappedSystem = {
    ...baseSystem,
    request: async function requestWithTicketLimit(config, clientType, idToken, action, payload = {}) {
      let nextPayload = payload;
      let submittedLimit = 0;
      if (clientType === 'admin' && action === 'admin.pointcards.save') {
        const input = limitInput();
        submittedLimit = normalizedLimit(input && input.value);
        if (!submittedLimit) {
          const error = new Error('單次最多使用票券數必須是 1–50 的整數。');
          error.code = 'INVALID_TICKET_USE_LIMIT';
          throw error;
        }
        nextPayload = {
          ...payload,
          card: { ...(payload && payload.card || {}), maxTicketsPerRedemption: submittedLimit }
        };
      }

      const result = await baseSystem.request(config, clientType, idToken, action, nextPayload);
      if (clientType !== 'admin') return result;
      currentConfig = config;
      currentIdToken = idToken;

      if (action === 'admin.bootstrap' || action === 'admin.pointcards.list') {
        return await enrichCards(config, idToken, result);
      }

      if (action === 'admin.pointcards.save' && result && result.card) {
        const cardId = String(result.card.cardId || '');
        if (cardId && submittedLimit) limitsByCard.set(cardId, submittedLimit);
        result.card = { ...result.card, maxTicketsPerRedemption: submittedLimit || 1 };
        scheduleInputSync(0);
      }
      return result;
    }
  };
  window.MemberSystem = Object.freeze(wrappedSystem);

  function injectLimitField() {
    const form = document.getElementById('cardForm');
    const status = document.getElementById('cardStatus');
    if (!form || !status || document.getElementById('cardMaxTicketsPerRedemption')) return;
    const statusGrid = status.closest('.form-grid');
    if (!statusGrid) return;
    const grid = document.createElement('div');
    grid.className = 'form-grid';
    grid.setAttribute('data-point-card-ticket-limit', '');
    grid.innerHTML = '<label>單次最多使用票券數<input id="cardMaxTicketsPerRedemption" name="maxTicketsPerRedemption" type="number" min="1" max="50" step="1" value="1" inputmode="numeric" required><small>1 = 只能單張使用；2 以上可在會員端一次多選，最多 50 張。系統仍會檢查各票券所需點數。</small></label>';
    form.insertBefore(grid, statusGrid);
  }

  window.addEventListener('DOMContentLoaded', () => {
    injectLimitField();
    scheduleInputSync(0);
    const cardList = document.getElementById('cardListItems');
    const newCard = document.getElementById('newCardButton');
    const resetCard = document.getElementById('resetCardButton');
    if (cardList) cardList.addEventListener('click', () => scheduleInputSync(0));
    if (newCard) newCard.addEventListener('click', () => {
      const input = limitInput();
      if (input) input.value = '1';
    });
    if (resetCard) resetCard.addEventListener('click', () => scheduleInputSync(0));
  });

  window.PointCardTicketLimitAdmin = Object.freeze({
    refresh: async () => {
      if (!currentConfig || !currentIdToken) return;
      await requestLimits(currentConfig, currentIdToken);
      syncInputFromCard();
    }
  });
})();
