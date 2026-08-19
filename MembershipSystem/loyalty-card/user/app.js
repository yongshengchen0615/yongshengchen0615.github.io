(() => {
  'use strict';

  const HANDOFF_KEY = 'loyalty.user.handoff.secret';
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

  function hasUserLiff() {
    const id = String(state.cfg?.userLiffId || '');
    return id.length >= 8 && !id.includes('PASTE_');
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

  async function exchangeLiffIdentity() {
    if (!state.liffReady || !window.liff?.isLoggedIn()) return false;
    const idToken = window.liff.getIDToken();
    if (!idToken) throw new Error('LIFF 未取得 OpenID ID Token，請確認 LIFF scope 包含 openid');
    const result = await state.bridge.call('loginWithLiff', {
      idToken,
      returnPage: 'user'
    });
    state.sessionToken = result.sessionToken;
    return true;
  }

  async function initLiff() {
    if (!hasUserLiff()) return false;
    if (!window.liff) throw new Error('LIFF SDK 載入失敗');
    await window.liff.init({ liffId: state.cfg.userLiffId });
    state.liffReady = true;
    return true;
  }

  async function startLogin() {
    clearNotice();
    const button = $('loginBtn');
    setBusy(button, true);
    try {
      if (hasUserLiff()) {
        if (!state.liffReady) await initLiff();
        if (!window.liff.isLoggedIn()) {
          window.liff.login({ redirectUri: `${window.location.origin}${window.location.pathname}` });
          return;
        }
        await exchangeLiffIdentity();
        await loadUser();
        return;
      }

      const secret = randomBase64Url(32);
      const handoffHash = await sha256Base64Url(secret);
      sessionStorage.setItem(HANDOFF_KEY, secret);
      const result = await state.bridge.call('beginLineLogin', { returnPage: 'user', handoffHash });
      window.location.assign(result.authUrl);
    } catch (error) {
      sessionStorage.removeItem(HANDOFF_KEY);
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
    const data = await state.bridge.call('getMyCard', { sessionToken: state.sessionToken });
    renderUser(data);
  }

  async function logout() {
    const token = state.sessionToken;
    state.sessionToken = '';
    try {
      if (token) await state.bridge.call('logoutSession', { sessionToken: token });
    } catch (_) {}

    if (state.liffReady && window.liff?.isLoggedIn() && !window.liff.isInClient()) {
      window.liff.logout();
    }
    sessionStorage.removeItem(HANDOFF_KEY);
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
      state.bridge = new GasBridge(state.cfg.gasWebAppUrl);
      await state.bridge.mount();

      const params = new URLSearchParams(window.location.search);
      if (params.has('auth_error')) {
        showNotice('LINE 登入未完成，請重新嘗試。', 'error');
        history.replaceState({}, document.title, window.location.pathname);
      }

      if (await completeWebLoginFromUrl()) {
        await loadUser();
        return;
      }

      if (hasUserLiff()) {
        await initLiff();
        if (window.liff.isLoggedIn()) {
          await exchangeLiffIdentity();
          await loadUser();
        }
      }
    } catch (error) {
      $('configNotice').textContent = error.message;
      $('configNotice').classList.remove('hidden');
      showNotice(error.message, 'error');
    }
  }

  init();
})();
