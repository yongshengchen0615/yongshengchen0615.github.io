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
    selectedUserId: '',
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

  function randomBase64Url(bytes = 18) {
    const data = new Uint8Array(bytes);
    crypto.getRandomValues(data);
    let binary = '';
    data.forEach((value) => { binary += String.fromCharCode(value); });
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  async function loadConfig() {
    const response = await fetch('../config.json', { cache: 'no-store', credentials: 'same-origin' });
    if (!response.ok) throw new Error('無法載入 config.json');
    const cfg = await response.json();
    const apiUrl = String(cfg.apiProxyUrl || '');
    if (!/^https:\/\//.test(apiUrl) || apiUrl.includes('PASTE_')) {
      throw new Error('尚未設定 API Proxy URL');
    }
    const liffId = String(cfg.adminLiffId || '');
    if (liffId.length < 8 || liffId.includes('PASTE_')) {
      throw new Error('尚未設定 Admin LIFF ID');
    }
    return Object.freeze(cfg);
  }

  async function initLiff() {
    if (!window.liff) throw new Error('LIFF SDK 載入失敗');
    await window.liff.init({ liffId: state.cfg.adminLiffId });
    state.liffReady = true;
  }

  async function exchangeLiffIdentity() {
    if (!state.liffReady || !window.liff?.isLoggedIn()) return false;
    const idToken = window.liff.getIDToken();
    if (!idToken) throw new Error('LIFF 未取得 OpenID ID Token，請確認 LIFF scope 包含 openid');
    const result = await state.api.call('loginWithLiff', { idToken, returnPage: 'admin' });
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
      await loadAdmin();
    } catch (error) {
      state.sessionToken = '';
      showNotice(error.message, 'error');
      setBusy(button, false);
    }
  }

  function renderHistory(transactions) {
    const target = $('selectedHistory');
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

  async function loadAdmin() {
    const data = await state.api.call('adminBootstrap', { sessionToken: state.sessionToken });
    $('loggedOut').classList.add('hidden');
    $('adminArea').classList.remove('hidden');
    $('adminName').textContent = `${data.admin.displayName} · ${data.admin.role}`;
    state.rewardTarget = Number(data.settings.stampsPerReward || 10);
  }

  function renderSearchResults(items) {
    const box = $('searchResults');
    if (!items.length) {
      box.innerHTML = '<p class="muted">找不到會員。</p>';
      return;
    }
    box.innerHTML = items.map((item) => `
      <button class="search-result" type="button" data-user-id="${escapeHtml(item.userId)}">
        <strong>${escapeHtml(item.displayName)}</strong>
        <span>${escapeHtml(item.cardCode)} · ${Number(item.balance)} 點</span>
      </button>
    `).join('');
    box.querySelectorAll('[data-user-id]').forEach((button) => {
      button.addEventListener('click', () => selectMember(button.dataset.userId));
    });
  }

  async function searchMembers() {
    clearNotice();
    const button = $('searchBtn');
    setBusy(button, true);
    try {
      const result = await state.api.call('adminSearchMembers', {
        sessionToken: state.sessionToken,
        query: $('searchInput').value.trim()
      });
      renderSearchResults(result.members || []);
    } catch (error) {
      showNotice(error.message, 'error');
    } finally {
      setBusy(button, false);
    }
  }

  async function selectMember(userId) {
    clearNotice();
    try {
      const data = await state.api.call('adminGetMember', {
        sessionToken: state.sessionToken,
        userId
      });
      state.selectedUserId = data.member.userId;
      state.rewardTarget = Number(data.settings.stampsPerReward || 10);
      $('emptySelection').classList.add('hidden');
      $('memberEditor').classList.remove('hidden');
      $('selectedName').textContent = data.member.displayName;
      $('selectedCardCode').textContent = data.card.cardCode;
      $('selectedBalance').textContent = String(data.card.balance);
      $('redeemBtn').textContent = `兌換獎勵 (-${state.rewardTarget})`;
      renderHistory(data.transactions || []);
    } catch (error) {
      showNotice(error.message, 'error');
    }
  }

  async function adjustPoints(button) {
    if (!state.selectedUserId) return;
    clearNotice();
    const action = button.dataset.action;
    const amount = Number(button.dataset.amount || 0);
    const reason = $('reasonInput').value.trim();
    if (action !== 'redeem' && reason.length < 3) {
      showNotice('集點或扣點請填寫至少 3 個字的操作原因', 'error');
      return;
    }

    document.querySelectorAll('.point-action').forEach((el) => { el.disabled = true; });
    try {
      const result = await state.api.call('adminAdjustPoints', {
        sessionToken: state.sessionToken,
        userId: state.selectedUserId,
        action,
        amount,
        reason,
        idempotencyKey: randomBase64Url(18)
      });
      showNotice(`完成：目前 ${result.balance} 點`);
      $('reasonInput').value = '';
      await selectMember(state.selectedUserId);
    } catch (error) {
      showNotice(error.message, 'error');
    } finally {
      document.querySelectorAll('.point-action').forEach((el) => { el.disabled = false; });
    }
  }

  async function logout() {
    const token = state.sessionToken;
    state.sessionToken = '';
    try {
      if (token) await state.api.call('logoutSession', { sessionToken: token });
    } catch (_) {}
    if (state.liffReady && window.liff?.isLoggedIn() && !window.liff.isInClient()) window.liff.logout();
    window.location.reload();
  }

  function bindEvents() {
    $('loginBtn').addEventListener('click', startLogin);
    $('logoutBtn').addEventListener('click', logout);
    $('searchBtn').addEventListener('click', searchMembers);
    $('searchInput').addEventListener('keydown', (event) => {
      if (event.key === 'Enter') searchMembers();
    });
    document.querySelectorAll('.point-action').forEach((button) => {
      button.addEventListener('click', () => adjustPoints(button));
    });
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
        await loadAdmin();
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
