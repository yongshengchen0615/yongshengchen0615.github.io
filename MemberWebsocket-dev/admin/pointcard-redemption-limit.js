(() => {
  'use strict';

  const state = { config: null, idToken: '', limits: new Map(), activeCardId: '', ready: false };
  const originalFetch = window.fetch.bind(window);

  function extensionUrl(config) {
    const base = String(config && config.supabaseUrl || '').replace(/\/$/, '');
    return `${base}/functions/v1/pointcard-extension-api`;
  }

  async function extensionRequest(operation) {
    if (!state.config || !state.idToken) throw new Error('尚未取得管理端登入資訊。');
    const response = await originalFetch(extensionUrl(state.config), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: String(state.config.supabasePublishableKey || '') },
      cache: 'no-store',
      body: JSON.stringify({ operation, idToken: state.idToken })
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload || payload.ok !== true) throw new Error(payload && payload.error && payload.error.message || '無法讀取票券使用上限。');
    return payload.data || {};
  }

  function normalizeLimit(value) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 1 && parsed <= 50 ? parsed : 1;
  }

  function injectField() {
    if (document.getElementById('cardMaxTicketsPerRedemption')) return;
    const form = document.getElementById('cardForm');
    const rewardEditor = form && form.querySelector('.reward-editor');
    if (!form || !rewardEditor) return;
    const wrapper = document.createElement('div');
    wrapper.className = 'form-grid';
    const label = document.createElement('label');
    label.textContent = '單次最多可使用票券數';
    const input = document.createElement('input');
    input.id = 'cardMaxTicketsPerRedemption';
    input.name = 'maxTicketsPerRedemption';
    input.type = 'number';
    input.min = '1';
    input.max = '50';
    input.step = '1';
    input.value = '1';
    input.required = true;
    input.inputMode = 'numeric';
    input.setAttribute('aria-describedby', 'cardMaxTicketsPerRedemptionHint');
    const hint = document.createElement('small');
    hint.id = 'cardMaxTicketsPerRedemptionHint';
    hint.textContent = '會員單次核銷此集點卡時，可同時選擇 1–50 張；後端會再次驗證。';
    label.append(input, hint);
    wrapper.append(label);
    form.insertBefore(wrapper, rewardEditor);
    input.addEventListener('change', () => { input.value = String(normalizeLimit(input.value)); });
  }

  function syncField() {
    injectField();
    const cardId = String(document.getElementById('cardId')?.value || '');
    const input = document.getElementById('cardMaxTicketsPerRedemption');
    if (!input) return;
    if (cardId !== state.activeCardId) {
      state.activeCardId = cardId;
      input.value = String(cardId ? normalizeLimit(state.limits.get(cardId)) : 1);
    }
  }

  function patchFetch() {
    window.fetch = async function patchedFetch(input, init) {
      let savedLimit = null;
      let requestedCardId = '';
      if (init && typeof init.body === 'string') {
        try {
          const body = JSON.parse(init.body);
          if (body && body.action === 'admin.pointcards.save' && body.card && typeof body.card === 'object') {
            const field = document.getElementById('cardMaxTicketsPerRedemption');
            savedLimit = normalizeLimit(field && field.value);
            body.card.maxTicketsPerRedemption = savedLimit;
            requestedCardId = String(body.card.cardId || '');
            init = { ...init, body: JSON.stringify(body) };
            if (requestedCardId) state.limits.set(requestedCardId, savedLimit);
          }
        } catch (_) {}
      }
      const response = await originalFetch(input, init);
      if (savedLimit !== null) {
        response.clone().json().then((payload) => {
          const savedCardId = String(payload && payload.data && payload.data.card && payload.data.card.cardId || requestedCardId || '');
          if (!savedCardId) return;
          state.limits.set(savedCardId, savedLimit);
          state.activeCardId = '__refresh__';
          window.setTimeout(syncField, 0);
        }).catch(() => {});
      }
      return response;
    };
  }

  async function boot() {
    injectField();
    patchFetch();
    const timer = window.setInterval(syncField, 200);
    try {
      state.config = await window.MemberSystem.loadConfig();
      for (let i = 0; i < 60; i += 1) {
        state.idToken = window.liff && typeof window.liff.getIDToken === 'function' ? (window.liff.getIDToken() || '') : '';
        if (state.idToken) break;
        await new Promise((resolve) => window.setTimeout(resolve, 150));
      }
      if (!state.idToken) return;
      const result = await extensionRequest('admin.limits.list');
      (Array.isArray(result.limits) ? result.limits : []).forEach((item) => state.limits.set(String(item.cardId || ''), normalizeLimit(item.maxTicketsPerRedemption)));
      state.activeCardId = '__refresh__';
      syncField();
      state.ready = true;
    } catch (_) {
      // 主管理功能仍可使用；欄位預設 1，實際儲存仍由資料庫驗證。
    }
    window.addEventListener('beforeunload', () => window.clearInterval(timer), { once: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
