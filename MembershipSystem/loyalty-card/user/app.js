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

    async call(action, payload = {}, sessionToken = '') {
      return this.request(`${this.baseUrl}/rpc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          payload,
          sessionToken,
          requestId: `web_${randomBase64Url(12)}`
        })
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

        let body = {};
        try {
          body = await response.json();
        } catch (_) {}

        if (!response.ok || body.ok !== true) {
          const message = body && body.error && body.error.message
            ? body.error.message
            : `API request failed (${response.status})`;
          throw new Error(String(message));
        }

        return body.result;
      } catch (error) {
        if (error && error.name === 'AbortError') {
          throw new Error('API 回應逾時，請稍後重試');
        }
        throw error;
      } finally {
        clearTimeout(timer);
      }
    }
  }

  const state = {
    config: null,
    api: null,
    sessionToken: '',
    liffReady: false
  };

  function randomBase64Url(bytes = 18) {
    const data = new Uint8Array(bytes);
    crypto.getRandomValues(data);
    let binary = '';
    data.forEach((value) => {
      binary += String.fromCharCode(value);
    });
    return btoa(binary)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[char]));
  }

  function showNotice(message, kind = 'info') {
    const el = $('statusNotice');
    el.textContent = String(message || '');
    el.className = `notice${kind === 'error' ? ' notice-error' : ''}`;
  }

  function clearNotice() {
    $('statusNotice').className = 'notice hidden';
    $('statusNotice').textContent = '';
  }

  function setLoading(loading) {
    $('loadingState').classList.toggle('hidden', !loading);
    $('refreshBtn').disabled = loading;
    $('loginBtn').disabled = loading;
  }

  async function loadConfig() {
    const response = await fetch('../config.json', {
      cache: 'no-store',
      credentials: 'same-origin'
    });
    if (!response.ok) throw new Error('無法載入 config.json');

    const config = await response.json();
    const apiProxyUrl = String(config.apiProxyUrl || '');
    const userLiffId = String(config.userLiffId || '');

    if (!/^https:\/\//.test(apiProxyUrl)) {
      throw new Error('尚未設定 API Proxy URL');
    }
    if (userLiffId.length < 8) {
      throw new Error('尚未設定 User LIFF ID');
    }

    return Object.freeze(config);
  }

  async function initLiff() {
    if (!window.liff) throw new Error('LIFF SDK 載入失敗');
    await window.liff.init({ liffId: state.config.userLiffId });
    state.liffReady = true;
  }

  async function loginWithCurrentLiffIdentity() {
    if (!state.liffReady || !window.liff.isLoggedIn()) {
      throw new Error('尚未完成 LINE 登入');
    }

    const idToken = window.liff.getIDToken();
    if (!idToken) {
      throw new Error('LIFF 未取得 ID Token，請確認 LIFF scope 包含 openid');
    }

    const result = await state.api.call('auth.login', {
      idToken,
      audience: 'user'
    });

    state.sessionToken = String(result.sessionToken || '');
    if (!state.sessionToken) throw new Error('後端沒有建立有效 Session');
  }

  async function startLogin() {
    clearNotice();
    setLoading(true);

    try {
      if (!state.liffReady) await initLiff();

      if (!window.liff.isLoggedIn()) {
        window.liff.login({
          redirectUri: `${window.location.origin}${window.location.pathname}`
        });
        return;
      }

      await loginWithCurrentLiffIdentity();
      await loadMemberDashboard();
    } catch (error) {
      state.sessionToken = '';
      showNotice(error.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  async function loadMemberDashboard() {
    if (!state.sessionToken) throw new Error('Session 已失效，請重新登入');

    setLoading(true);
    clearNotice();

    try {
      const [profile, account, transactionResult] = await Promise.all([
        state.api.call('member.profile', {}, state.sessionToken),
        state.api.call('loyalty.account', {}, state.sessionToken),
        state.api.call('loyalty.transactions', { limit: 30 }, state.sessionToken)
      ]);

      renderDashboard(profile, account, transactionResult.transactions || []);
      $('loggedOut').classList.add('hidden');
      $('memberArea').classList.remove('hidden');
    } finally {
      setLoading(false);
    }
  }

  function renderDashboard(profile, account, transactions) {
    $('memberName').textContent = profile.displayName || '會員';
    $('cardCode').textContent = account.cardCode ? `卡號 ${account.cardCode}` : '';
    $('balance').textContent = String(Number(account.pointsBalance || 0));
    $('accountUpdatedAt').textContent = account.updatedAt
      ? `最後更新：${account.updatedAt}`
      : '';

    $('memberAvatar').src = profile.pictureUrl ||
      'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="80" height="80"%3E%3Crect width="100%25" height="100%25" fill="%23e9edef"/%3E%3C/svg%3E';

    renderProgress(
      Number(account.pointsBalance || 0),
      Number(account.rewardTarget || 10)
    );
    renderTransactions(transactions);
  }

  function renderProgress(balance, rewardTarget) {
    const target = Number.isInteger(rewardTarget) && rewardTarget > 0
      ? rewardTarget
      : 10;

    const remainder = balance % target;
    const completedCycle = balance > 0 && remainder === 0;
    const filled = completedCycle ? target : remainder;
    const percent = Math.max(0, Math.min(100, (filled / target) * 100));

    $('progressBar').style.width = `${percent}%`;
    $('progressText').textContent = `${filled} / ${target}`;

    if (completedCycle || balance >= target) {
      $('rewardHint').textContent = completedCycle
        ? '已達兌換門檻'
        : `本輪再 ${target - remainder} 點達成`;
    } else {
      $('rewardHint').textContent = `再 ${target - remainder} 點達成`;
    }

    const visualCount = Math.min(target, 50);
    const visualFilled = completedCycle
      ? visualCount
      : Math.floor((remainder / target) * visualCount);

    $('stampGrid').innerHTML = Array.from({ length: visualCount }, (_, index) => (
      `<div class="stamp${index < visualFilled ? ' active' : ''}">${index + 1}</div>`
    )).join('');
  }

  function renderTransactions(transactions) {
    const target = $('historyList');
    if (!Array.isArray(transactions) || transactions.length === 0) {
      target.innerHTML = '<p class="muted">目前沒有交易紀錄。</p>';
      return;
    }

    target.innerHTML = transactions.map((transaction) => {
      const points = Number(transaction.points || 0);
      const sign = points > 0 ? '+' : '';
      const cssClass = points >= 0 ? 'positive' : 'negative';
      return `
        <div class="history-item">
          <div>
            <div class="history-title">${escapeHtml(transactionLabel(transaction.type))}</div>
            <p class="history-meta">${escapeHtml(transaction.reason || '—')} · ${escapeHtml(transaction.createdAt || '')}</p>
            <p class="history-balance">餘額 ${Number(transaction.balanceBefore || 0)} → ${Number(transaction.balanceAfter || 0)}</p>
          </div>
          <div class="delta ${cssClass}">${sign}${points}</div>
        </div>
      `;
    }).join('');
  }

  function transactionLabel(type) {
    return ({
      EARN: '集點',
      DEDUCT: '扣點',
      REDEEM: '兌換'
    })[String(type || '').toUpperCase()] || '點數異動';
  }

  async function logout() {
    const token = state.sessionToken;
    state.sessionToken = '';

    try {
      if (token) {
        await state.api.call('auth.logout', {}, token);
      }
    } catch (_) {}

    if (state.liffReady && window.liff.isLoggedIn() && !window.liff.isInClient()) {
      window.liff.logout();
    }

    $('memberArea').classList.add('hidden');
    $('loggedOut').classList.remove('hidden');
    showNotice('已登出目前工作階段。');
  }

  function bindEvents() {
    $('loginBtn').addEventListener('click', startLogin);
    $('logoutBtn').addEventListener('click', logout);
    $('refreshBtn').addEventListener('click', () => {
      loadMemberDashboard().catch((error) => {
        showNotice(error.message, 'error');
      });
    });
  }

  async function init() {
    bindEvents();

    try {
      state.config = await loadConfig();
      state.api = new ApiClient(state.config.apiProxyUrl);
      await state.api.health();
      await initLiff();

      if (window.liff.isLoggedIn()) {
        await loginWithCurrentLiffIdentity();
        await loadMemberDashboard();
      }
    } catch (error) {
      state.sessionToken = '';
      $('configNotice').textContent = error.message;
      $('configNotice').classList.remove('hidden');
      showNotice(error.message, 'error');
    }
  }

  window.addEventListener('pagehide', () => {
    state.sessionToken = '';
  });

  init();
})();
