(() => {
  'use strict';

  const cfg = window.LOYALTY_CONFIG || {};
  const page = document.body.dataset.page === 'admin' ? 'admin' : 'user';
  const HANDOFF_KEY = 'loyalty.handoff.secret';

  const $ = (id) => document.getElementById(id);

  class GasBridge {
    constructor(url) {
      this.url = url;
      this.iframe = null;
      this.ready = false;
      this.pending = new Map();
      this.counter = 0;
      this.readyPromise = new Promise((resolve, reject) => {
        this.resolveReady = resolve;
        this.rejectReady = reject;
      });
    }

    mount() {
      const iframe = document.createElement('iframe');
      iframe.src = `${this.url}${this.url.includes('?') ? '&' : '?'}mode=bridge`;
      iframe.hidden = true;
      iframe.setAttribute('aria-hidden', 'true');
      iframe.tabIndex = -1;
      document.body.appendChild(iframe);
      this.iframe = iframe;

      window.addEventListener('message', (event) => {
        if (!this.iframe || event.source !== this.iframe.contentWindow) return;
        const message = event.data || {};
        if (message.type === 'loyalty-bridge-ready') {
          this.ready = true;
          this.resolveReady();
          return;
        }
        if (message.type !== 'loyalty-rpc-result' || !message.id) return;
        const pending = this.pending.get(message.id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(message.id);
        if (message.ok) pending.resolve(message.result);
        else pending.reject(new Error(message.error || '伺服器發生錯誤'));
      });

      setTimeout(() => {
        if (!this.ready) this.rejectReady(new Error('無法連線 GAS 後端'));
      }, 12000);
      return this.readyPromise;
    }

    async call(method, payload = {}) {
      await this.readyPromise;
      const id = `rpc_${Date.now()}_${++this.counter}`;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pending.delete(id);
          reject(new Error('伺服器回應逾時'));
        }, 20000);
        this.pending.set(id, { resolve, reject, timer });
        this.iframe.contentWindow.postMessage({
          type: 'loyalty-rpc',
          id,
          method,
          payload
        }, '*');
      });
    }
  }

  const state = {
    bridge: null,
    sessionToken: '',
    selectedUserId: '',
    rewardTarget: 10
  };

  function isConfigured() {
    return typeof cfg.gasWebAppUrl === 'string' &&
      /^https:\/\/script\.google\.com\/macros\/s\//.test(cfg.gasWebAppUrl) &&
      !cfg.gasWebAppUrl.includes('PASTE_');
  }

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

  function showConfigNotice() {
    const el = $('configNotice');
    if (!el) return;
    el.textContent = '尚未設定 GAS Web App URL。請先依 README 部署 GAS，並更新 config.js。';
    el.classList.remove('hidden');
  }

  function setBusy(button, busy) {
    if (button) button.disabled = Boolean(busy);
  }

  function randomBase64Url(bytes = 32) {
    const data = new Uint8Array(bytes);
    crypto.getRandomValues(data);
    let binary = '';
    data.forEach((value) => { binary += String.fromCharCode(value); });
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  async function sha256Base64Url(value) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    let binary = '';
    new Uint8Array(digest).forEach((v) => { binary += String.fromCharCode(v); });
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  async function startLogin() {
    clearNotice();
    const button = $('loginBtn');
    setBusy(button, true);
    try {
      const secret = randomBase64Url(32);
      const handoffHash = await sha256Base64Url(secret);
      sessionStorage.setItem(HANDOFF_KEY, secret);
      const result = await state.bridge.call('beginLineLogin', { returnPage: page, handoffHash });
      window.location.assign(result.authUrl);
    } catch (error) {
      sessionStorage.removeItem(HANDOFF_KEY);
      showNotice(error.message, 'error');
      setBusy(button, false);
    }
  }

  async function completeLoginFromUrl() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('auth') !== 'complete') return false;
    const flowId = params.get('flow') || '';
    const secret = sessionStorage.getItem(HANDOFF_KEY) || '';
    history.replaceState({}, document.title, window.location.pathname);
    if (!flowId || !secret) throw new Error('登入交接資訊遺失，請重新登入');
    const result = await state.bridge.call('completeLogin', { flowId, handoffSecret: secret });
    sessionStorage.removeItem(HANDOFF_KEY);
    state.sessionToken = result.sessionToken;
    return true;
  }

  function renderHistory(target, transactions) {
    if (!target) return;
    if (!transactions || transactions.length === 0) {
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

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[ch]));
  }

  function renderUser(data) {
    $('loggedOut')?.classList.add('hidden');
    $('memberArea')?.classList.remove('hidden');
    $('memberName').textContent = data.member.displayName || 'LINE 會員';
    $('cardCode').textContent = `卡號 ${data.card.cardCode}`;
    $('balance').textContent = String(data.card.balance);
    $('memberAvatar').src = data.member.pictureUrl || 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="80" height="80"%3E%3Crect width="100%25" height="100%25" fill="%23e9edef"/%3E%3C/svg%3E';
    state.rewardTarget = data.settings.stampsPerReward || 10;
    const remainder = Number(data.card.balance) % state.rewardTarget;
    const left = remainder === 0 && Number(data.card.balance) > 0 ? 0 : state.rewardTarget - remainder;
    $('rewardHint').textContent = left === 0 ? '已可兌換一份獎勵' : `再 ${left} 點可兌換`;
    $('stampGrid').innerHTML = Array.from({ length: state.rewardTarget }, (_, index) =>
      `<div class="stamp ${index < remainder || (remainder === 0 && Number(data.card.balance) >= state.rewardTarget) ? 'active' : ''}">${index + 1}</div>`
    ).join('');
    renderHistory($('historyList'), data.transactions);
  }

  async function loadUser() {
    const data = await state.bridge.call('getMyCard', { sessionToken: state.sessionToken });
    renderUser(data);
  }

  function renderSearchResults(items) {
    const box = $('searchResults');
    if (!box) return;
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
    const query = $('searchInput').value.trim();
    const button = $('searchBtn');
    setBusy(button, true);
    try {
      const result = await state.bridge.call('adminSearchMembers', {
        sessionToken: state.sessionToken,
        query
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
    const data = await state.bridge.call('adminGetMember', {
      sessionToken: state.sessionToken,
      userId
    });
    state.selectedUserId = data.member.userId;
    state.rewardTarget = data.settings.stampsPerReward || 10;
    $('emptySelection').classList.add('hidden');
    $('memberEditor').classList.remove('hidden');
    $('selectedName').textContent = data.member.displayName;
    $('selectedCardCode').textContent = data.card.cardCode;
    $('selectedBalance').textContent = String(data.card.balance);
    $('redeemBtn').textContent = `兌換獎勵 (-${state.rewardTarget})`;
    renderHistory($('selectedHistory'), data.transactions);
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
    const payload = {
      sessionToken: state.sessionToken,
      userId: state.selectedUserId,
      action,
      amount,
      reason,
      idempotencyKey: randomBase64Url(18)
    };
    document.querySelectorAll('.point-action').forEach((el) => { el.disabled = true; });
    try {
      const result = await state.bridge.call('adminAdjustPoints', payload);
      showNotice(`完成：目前 ${result.balance} 點`);
      $('reasonInput').value = '';
      await selectMember(state.selectedUserId);
    } catch (error) {
      showNotice(error.message, 'error');
    } finally {
      document.querySelectorAll('.point-action').forEach((el) => { el.disabled = false; });
    }
  }

  async function loadAdmin() {
    const data = await state.bridge.call('adminBootstrap', { sessionToken: state.sessionToken });
    $('loggedOut')?.classList.add('hidden');
    $('adminArea')?.classList.remove('hidden');
    $('adminName').textContent = `${data.admin.displayName} · ${data.admin.role}`;
    state.rewardTarget = data.settings.stampsPerReward || 10;
  }

  async function logout() {
    const token = state.sessionToken;
    state.sessionToken = '';
    try {
      if (token) await state.bridge.call('logoutSession', { sessionToken: token });
    } catch (_) {
      // Local logout still succeeds if server revocation cannot be reached.
    }
    window.location.reload();
  }

  function bindEvents() {
    $('loginBtn')?.addEventListener('click', startLogin);
    $('logoutBtn')?.addEventListener('click', logout);
    $('refreshBtn')?.addEventListener('click', () => loadUser().catch((e) => showNotice(e.message, 'error')));
    $('searchBtn')?.addEventListener('click', searchMembers);
    $('searchInput')?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') searchMembers();
    });
    document.querySelectorAll('.point-action').forEach((button) => {
      button.addEventListener('click', () => adjustPoints(button));
    });
  }

  async function init() {
    bindEvents();
    if (!isConfigured()) {
      showConfigNotice();
      setBusy($('loginBtn'), true);
      return;
    }

    state.bridge = new GasBridge(cfg.gasWebAppUrl);
    try {
      await state.bridge.mount();
      const params = new URLSearchParams(window.location.search);
      if (params.has('auth_error')) {
        showNotice('LINE 登入未完成，請重新嘗試。', 'error');
        history.replaceState({}, document.title, window.location.pathname);
      }
      await completeLoginFromUrl();
      if (!state.sessionToken) return;
      if (page === 'admin') await loadAdmin();
      else await loadUser();
    } catch (error) {
      if (/未授權|工作階段|登入/.test(error.message)) {
        state.sessionToken = '';
      }
      showNotice(error.message, 'error');
    }
  }

  init();
})();
