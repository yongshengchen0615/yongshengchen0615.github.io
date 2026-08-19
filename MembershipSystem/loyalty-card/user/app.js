(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  class ApiClient {
    constructor(baseUrl) {
      this.baseUrl = String(baseUrl || '').replace(/\/$/, '');
    }

    async health() {
      return this.request(`${this.baseUrl}/health`, { method: 'GET' });
    }

    async call(method, payload = {}) {
      return this.request(`${this.baseUrl}/rpc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method, payload })
      });
    }

    async request(url, options) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20000);
      try {
        const response = await fetch(url, {
          ...options,
          cache: 'no-store',
          credentials: 'omit',
          signal: controller.signal
        });
        let data = {};
        try { data = await response.json(); } catch (_) {}
        if (!response.ok || data.ok !== true) {
          throw new Error(String(data.error || `API request failed (${response.status})`));
        }
        return data.result;
      } catch (error) {
        if (error?.name === 'AbortError') throw new Error('API 回應逾時');
        throw error;
      } finally {
        clearTimeout(timer);
      }
    }
  }

  const state = {
    cfg: null,
    api: null,
    sessionToken: '',
    rewardTarget: 10,
    liffReady: false
  };

  function showNotice(message, kind = 'info') {
    const el = $('statusNotice');
    if (!el) return;
    el.textContent = message;
    el.className = `notice${kind === 'error' ? ' notice-error' : ''}`;
  }

  function clearNotice() {
    const el = $('statusNotice');
    if (el) el.className = 'notice hidden';
  }

  function setBusy(button, busy) {
    if (button) button.disabled = Boolean(busy);
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[ch]));
  }

  async function loadConfig() {
    const response = await fetch('../config.json', { cache: 'no-store', credentials: 'same-origin' });
    if (!response.ok) throw new Error('無法載入 config.json');
    const cfg = await response.json();
    const apiUrl = String(cfg.apiProxyUrl || '');
    if (!/^https:\/\//.test(apiUrl) || apiUrl.includes('PASTE_')) {
      throw new Error('尚未設定 API Proxy URL');
    }
    const liffId = String(cfg.userLiffId || '');
    if (liffId.length < 8 || liffId.includes('PASTE_')) {
      throw new Error('尚未設定 User LIFF ID');
    }
    return Object.freeze(cfg);
  }

  async function initLiff() {
    if (!window.liff) throw new Error('LIFF SDK 載入失敗');
    await window.liff.init({ liffId: state.cfg.userLiffId });
    state.liffReady = true;
  }

  async function exchangeLiffIdentity() {
    if (!state.liffReady || !window.liff?.isLoggedIn()) return false;
    const idToken = window.liff.getIDToken();
    if (!idToken) throw new Error('LIFF 未取得 OpenID ID Token，請確認 LIFF scope 包含 openid');
    const result = await state.api.call('loginWithLiff', {
      idToken,
      returnPage: 'user'
    });
    state.sessionToken = result.sessionToken;
    return true;
  }

  async function startLogin() {
    clearNotice();
    const button = $('loginBtn');
    setBusy(button, true);
    try {
      if (!state.liffReady) await initLiff();
      if (!window.liff.isLoggedIn()) {
        window.liff.login({ redirectUri: `${window.location.origin}${window.location.pathname}` });
        return;
      }
      await exchangeLiffIdentity();
      await loadUser();
    } catch (error) {
      state.sessionToken = '';
      showNotice(error.message, 'error');
      setBusy(button, false);
    }
  }

  function renderHistory(transactions) {
    const target = $('historyList');
    if (!transactions?.length) {
      target.innerHTML = '<p class="muted">目前沒有點數紀錄。</p>';
      return;
    }
    target.innerHTML = transactions.map((tx) => {
      const delta = Number(tx.delta || 0);
      const cls = delta >= 0 ? 'positive' : 'negative';
      const sign = delta > 0 ? '+' : '';
      return `<div class="history-item">
        <div>
          <div class="history-title">${escapeHtml(tx.typeLabel || tx.type || '點數異動')}</div>
          <p class="history-meta">${escapeHtml(tx.reason || '—')} · ${escapeHtml(tx.createdAt || '')}</p>
        </div>
        <div class="delta ${cls}">${sign}${delta}</div>
      </div>`;
    }).join('');
  }

  function renderUser(data) {
    $('loggedOut').classList.add('hidden');
    $('memberArea').classList.remove('hidden');
    $('memberName').textContent = data.member.displayName || 'LINE 會員';
    $('cardCode').textContent = `卡號 ${data.card.cardCode}`;
    $('balance').textContent = String(data.card.balance);
    $('memberAvatar').src = data.member.pictureUrl || 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="80" height="80"%3E%3Crect width="100%25" height="100%25" fill="%23e9edef"/%3E%3C/svg%3E';
    state.rewardTarget = Number(data.settings.stampsPerReward || 10);
    const balance = Number(data.card.balance || 0);
    const remainder = balance % state.rewardTarget;
    const left = remainder === 0 && balance > 0 ? 0 : state.rewardTarget - remainder;
    $('rewardHint').textContent = left === 0 ? '已可兌換一份獎勵' : `再 ${left} 點可兌換`;
    $('stampGrid').innerHTML = Array.from({ length: state.rewardTarget }, (_, index) =>
      `<div class="stamp ${index < remainder || (remainder === 0 && balance >= state.rewardTarget) ? 'active' : ''}">${index + 1}</div>`
    ).join('');
    renderHistory(data.transactions || []);
  }

  async function loadUser() {
    const data = await state.api.call('getMyCard', { sessionToken: state.sessionToken });
    renderUser(data);
  }

  async function logout() {
    const token = state.sessionToken;
    state.sessionToken = '';
    try {
      if (token) await state.api.call('logoutSession', { sessionToken: token });
    } catch (_) {}

    if (state.liffReady && window.liff?.isLoggedIn() && !window.liff.isInClient()) {
      window.liff.logout();
    }
    $('memberArea').classList.add('hidden');
    $('loggedOut').classList.remove('hidden');
    showNotice(window.liff?.isInClient?.()
      ? '此工作階段已登出；LIFF 內重新整理時 LINE 可能再次自動驗證身分。'
      : '已登出。');
  }

  function bindEvents() {
    $('loginBtn').addEventListener('click', startLogin);
    $('logoutBtn').addEventListener('click', logout);
    $('refreshBtn').addEventListener('click', () => loadUser().catch((e) => showNotice(e.message, 'error')));
  }

  async function init() {
    bindEvents();
    try {
      state.cfg = await loadConfig();
      state.api = new ApiClient(state.cfg.apiProxyUrl);
      await state.api.health();
      await initLiff();
      if (window.liff.isLoggedIn()) {
        await exchangeLiffIdentity();
        await loadUser();
      }
    } catch (error) {
      state.sessionToken = '';
      $('configNotice').textContent = error.message;
      $('configNotice').classList.remove('hidden');
      showNotice(error.message, 'error');
    }
  }

  init();
})();
