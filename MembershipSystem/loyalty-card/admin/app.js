(() => {
  'use strict';

  const HANDOFF_KEY = 'loyalty.admin.handoff.secret';
  const $ = (id) => document.getElementById(id);

  class GasBridge {
    constructor(url) {
      this.url = url;
      this.iframe = null;
      this.pending = new Map();
      this.counter = 0;
      this.ready = false;
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
        this.iframe.contentWindow.postMessage({ type: 'loyalty-rpc', id, method, payload }, '*');
      });
    }
  }

  const state = {
    cfg: null,
    bridge: null,
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

  async function loadConfig() {
    const response = await fetch('../config.json', { cache: 'no-store', credentials: 'same-origin' });
    if (!response.ok) throw new Error('無法載入 config.json');
    const cfg = await response.json();
    if (!/^https:\/\/script\.google\.com\/macros\/s\//.test(String(cfg.gasWebAppUrl || '')) ||
        String(cfg.gasWebAppUrl).includes('PASTE_')) {
      throw new Error('尚未設定 GAS Web App URL');
    }
    return Object.freeze(cfg);
  }

  function hasAdminLiff() {
    const id = String(state.cfg?.adminLiffId || '');
    return id.length >= 8 && !id.includes('PASTE_');
  }

  async function initLiff() {
    if (!hasAdminLiff()) return false;
    if (!window.liff) throw new Error('LIFF SDK 載入失敗');
    await window.liff.init({ liffId: state.cfg.adminLiffId });
    state.liffReady = true;
    return true;
  }

  async function exchangeLiffIdentity() {
    if (!state.liffReady || !window.liff?.isLoggedIn()) return false;
    const idToken = window.liff.getIDToken();
    if (!idToken) throw new Error('LIFF 未取得 OpenID ID Token，請確認 LIFF scope 包含 openid');
    const result = await state.bridge.call('loginWithLiff', { idToken, returnPage: 'admin' });
    state.sessionToken = result.sessionToken;
    return true;
  }

  async function completeWebLoginFromUrl() {
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

  async function startLogin() {
    clearNotice();
    const button = $('loginBtn');
    setBusy(button, true);
    try {
      if (hasAdminLiff()) {
        if (!state.liffReady) await initLiff();
        if (!window.liff.isLoggedIn()) {
          window.liff.login({ redirectUri: `${window.location.origin}${window.location.pathname}` });
          return;
        }
        await exchangeLiffIdentity();
        await loadAdmin();
        return;
      }

      const secret = randomBase64Url(32);
      const handoffHash = await sha256Base64Url(secret);
      sessionStorage.setItem(HANDOFF_KEY, secret);
      const result = await state.bridge.call('beginLineLogin', { returnPage: 'admin', handoffHash });
      window.location.assign(result.authUrl);
    } catch (error) {
      sessionStorage.removeItem(HANDOFF_KEY);
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
    const data = await state.bridge.call('adminBootstrap', { sessionToken: state.sessionToken });
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
      const result = await state.bridge.call('adminSearchMembers', {
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
      const data = await state.bridge.call('adminGetMember', {
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
      const result = await state.bridge.call('adminAdjustPoints', {
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
      if (token) await state.bridge.call('logoutSession', { sessionToken: token });
    } catch (_) {}
    if (state.liffReady && window.liff?.isLoggedIn() && !window.liff.isInClient()) window.liff.logout();
    sessionStorage.removeItem(HANDOFF_KEY);
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
      state.bridge = new GasBridge(state.cfg.gasWebAppUrl);
      await state.bridge.mount();

      const params = new URLSearchParams(window.location.search);
      if (params.has('auth_error')) {
        showNotice('LINE 登入未完成，請重新嘗試。', 'error');
        history.replaceState({}, document.title, window.location.pathname);
      }

      if (await completeWebLoginFromUrl()) {
        await loadAdmin();
        return;
      }

      if (hasAdminLiff()) {
        await initLiff();
        if (window.liff.isLoggedIn()) {
          await exchangeLiffIdentity();
          await loadAdmin();
        }
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
