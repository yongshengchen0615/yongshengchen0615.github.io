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
          throw new Error('API 回應逾時；重試相同操作時會沿用原 idempotency key');
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
    liffReady: false,
    selectedUserId: '',
    rewardTarget: 10,
    maxAdjustment: 1000,
    retryMutation: null
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
    $('loginBtn').disabled = loading;
    $('searchBtn').disabled = loading;
    $('refreshMemberBtn').disabled = loading;
  }

  function setMutationBusy(busy) {
    document.querySelectorAll('.mutation-btn').forEach((button) => {
      button.disabled = busy;
    });
    $('amountInput').disabled = busy;
    $('reasonInput').disabled = busy;
  }

  async function loadConfig() {
    const response = await fetch('../config.json', {
      cache: 'no-store',
      credentials: 'same-origin'
    });
    if (!response.ok) throw new Error('無法載入 config.json');

    const config = await response.json();
    if (!/^https:\/\//.test(String(config.apiProxyUrl || ''))) {
      throw new Error('尚未設定 API Proxy URL');
    }
    if (String(config.adminLiffId || '').length < 8) {
      throw new Error('尚未設定 Admin LIFF ID');
    }

    return Object.freeze(config);
  }

  async function initLiff() {
    if (!window.liff) throw new Error('LIFF SDK 載入失敗');
    await window.liff.init({ liffId: state.config.adminLiffId });
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
      audience: 'admin'
    });

    state.sessionToken = String(result.sessionToken || '');
    if (!state.sessionToken) throw new Error('後端沒有建立有效 Admin Session');
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
      await loadAdmin();
    } catch (error) {
      state.sessionToken = '';
      showNotice(error.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  async function loadAdmin() {
    const result = await state.api.call('admin.bootstrap', {}, state.sessionToken);

    state.rewardTarget = Number(result.settings.rewardTarget || 10);
    state.maxAdjustment = Number(result.settings.maxAdjustment || 1000);

    $('adminName').textContent = `${result.admin.displayName} · ${result.admin.role}`;
    $('amountInput').max = String(state.maxAdjustment);
    $('mutationHint').textContent =
      `單次最多 ${state.maxAdjustment} 點；兌換按鈕目前使用 ${state.rewardTarget} 點。`;

    $('loggedOut').classList.add('hidden');
    $('adminArea').classList.remove('hidden');
  }

  async function searchMembers() {
    clearNotice();
    setLoading(true);

    try {
      const result = await state.api.call('admin.member.search', {
        query: $('searchInput').value.trim()
      }, state.sessionToken);
      renderSearchResults(result.members || []);
    } catch (error) {
      showNotice(error.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  function renderSearchResults(members) {
    const target = $('searchResults');

    if (!Array.isArray(members) || members.length === 0) {
      target.innerHTML = '<p class="muted">找不到符合條件的會員。</p>';
      return;
    }

    target.innerHTML = members.map((member) => `
      <button class="search-result" type="button" data-user-id="${escapeHtml(member.userId)}">
        <strong>${escapeHtml(member.displayName)}</strong>
        <span>${escapeHtml(member.cardCode || member.userId)} · ${Number(member.pointsBalance || 0)} 點</span>
      </button>
    `).join('');

    target.querySelectorAll('[data-user-id]').forEach((button) => {
      button.addEventListener('click', () => {
        selectMember(button.dataset.userId).catch((error) => {
          showNotice(error.message, 'error');
        });
      });
    });
  }

  async function selectMember(userId) {
    state.selectedUserId = '';
    state.retryMutation = null;
    clearNotice();
    setLoading(true);

    try {
      const [memberResult, transactionResult] = await Promise.all([
        state.api.call('admin.member.get', { userId }, state.sessionToken),
        state.api.call('admin.member.transactions', { userId, limit: 50 }, state.sessionToken)
      ]);

      state.selectedUserId = memberResult.member.userId;
      $('selectedName').textContent = memberResult.member.displayName;
      $('selectedIdentity').textContent =
        `${memberResult.account.cardCode} · ${memberResult.member.userId}`;
      $('selectedBalance').textContent =
        String(Number(memberResult.account.pointsBalance || 0));

      $('emptySelection').classList.add('hidden');
      $('memberEditor').classList.remove('hidden');
      renderTransactions(transactionResult.transactions || []);
    } finally {
      setLoading(false);
    }
  }

  function renderTransactions(transactions) {
    const target = $('selectedHistory');

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

  function getAmount() {
    const amount = Number($('amountInput').value);
    if (!Number.isInteger(amount) || amount < 1 || amount > state.maxAdjustment) {
      throw new Error(`點數必須是 1 到 ${state.maxAdjustment} 的整數`);
    }
    return amount;
  }

  function getIdempotencyKey(fingerprint) {
    if (state.retryMutation && state.retryMutation.fingerprint === fingerprint) {
      return state.retryMutation.key;
    }

    const key = randomBase64Url(18);
    state.retryMutation = { fingerprint, key };
    return key;
  }

  async function performMutation(apiAction, operation, amount, fallbackReason = '') {
    if (!state.selectedUserId) {
      throw new Error('請先選擇會員');
    }

    let reason = $('reasonInput').value.trim();
    if (!reason && fallbackReason) reason = fallbackReason;
    if (reason.length < 3) {
      throw new Error('請填寫至少 3 個字的操作原因');
    }

    const fingerprint = [
      state.selectedUserId,
      apiAction,
      operation || '',
      amount,
      reason
    ].join('|');

    const idempotencyKey = getIdempotencyKey(fingerprint);
    const payload = {
      userId: state.selectedUserId,
      amount,
      reason,
      idempotencyKey
    };

    if (operation) payload.operation = operation;

    setMutationBusy(true);
    clearNotice();

    try {
      const result = await state.api.call(
        apiAction,
        payload,
        state.sessionToken
      );

      state.retryMutation = null;
      $('selectedBalance').textContent =
        String(Number(result.account.pointsBalance || 0));
      $('reasonInput').value = '';

      showNotice(
        result.duplicate
          ? `此請求已處理過；目前餘額 ${result.account.pointsBalance} 點`
          : `完成；目前餘額 ${result.account.pointsBalance} 點`
      );

      await refreshSelectedMember();
    } catch (error) {
      showNotice(error.message, 'error');
      throw error;
    } finally {
      setMutationBusy(false);
    }
  }

  async function refreshSelectedMember() {
    if (!state.selectedUserId) return;
    const userId = state.selectedUserId;

    const [memberResult, transactionResult] = await Promise.all([
      state.api.call('admin.member.get', { userId }, state.sessionToken),
      state.api.call('admin.member.transactions', { userId, limit: 50 }, state.sessionToken)
    ]);

    $('selectedBalance').textContent =
      String(Number(memberResult.account.pointsBalance || 0));
    renderTransactions(transactionResult.transactions || []);
  }

  async function logout() {
    const token = state.sessionToken;
    state.sessionToken = '';
    state.selectedUserId = '';
    state.retryMutation = null;

    try {
      if (token) await state.api.call('auth.logout', {}, token);
    } catch (_) {}

    if (state.liffReady && window.liff.isLoggedIn() && !window.liff.isInClient()) {
      window.liff.logout();
    }

    window.location.reload();
  }

  function bindEvents() {
    $('loginBtn').addEventListener('click', startLogin);
    $('logoutBtn').addEventListener('click', logout);
    $('searchBtn').addEventListener('click', searchMembers);
    $('searchInput').addEventListener('keydown', (event) => {
      if (event.key === 'Enter') searchMembers();
    });

    $('refreshMemberBtn').addEventListener('click', () => {
      refreshSelectedMember().catch((error) => {
        showNotice(error.message, 'error');
      });
    });

    $('earnBtn').addEventListener('click', () => {
      try {
        const amount = getAmount();
        performMutation('loyalty.earn', '', amount).catch(() => {});
      } catch (error) {
        showNotice(error.message, 'error');
      }
    });

    $('increaseBtn').addEventListener('click', () => {
      try {
        const amount = getAmount();
        performMutation('admin.points.adjust', 'EARN', amount).catch(() => {});
      } catch (error) {
        showNotice(error.message, 'error');
      }
    });

    $('decreaseBtn').addEventListener('click', () => {
      try {
        const amount = getAmount();
        performMutation('admin.points.adjust', 'DEDUCT', amount).catch(() => {});
      } catch (error) {
        showNotice(error.message, 'error');
      }
    });

    $('redeemBtn').addEventListener('click', () => {
      performMutation(
        'loyalty.redeem',
        '',
        state.rewardTarget,
        '管理端兌換獎勵'
      ).catch(() => {});
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
        await loadAdmin();
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
    state.retryMutation = null;
  });

  init();
})();
