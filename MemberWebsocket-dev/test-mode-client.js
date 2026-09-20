(() => {
  'use strict';

  const STORAGE_KEY = 'member-test-session-v1';
  let activeSessionToken = '';

  function clientError(code, message, status = 0) {
    const error = new Error(message);
    error.code = code;
    error.status = status;
    return error;
  }

  function endpoint(config) {
    const url = String(config && config.supabaseUrl || '').replace(/\/$/, '');
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url)) {
      throw clientError('CONFIG_ERROR', '測試模式服務設定不完整。');
    }
    return url + '/functions/v1/test-mode-api';
  }

  async function post(config, body) {
    const response = await fetch(endpoint(config), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: String(config && config.supabasePublishableKey || '')
      },
      cache: 'no-store',
      body: JSON.stringify(body || {})
    });
    let payload;
    try { payload = await response.json(); }
    catch { throw clientError('TEST_MODE_RESPONSE_ERROR', '測試模式服務暫時未正常回應。', response.status); }
    if (!response.ok || !payload || payload.ok !== true) {
      const error = clientError(
        payload?.error?.code || 'TEST_MODE_ERROR',
        payload?.error?.message || '測試模式服務拒絕此請求。',
        Number(payload?.status || response.status || 0)
      );
      error.details = payload?.error?.details || null;
      throw error;
    }
    return payload.data || {};
  }

  function readStoredToken() {
    try {
      const raw = window.sessionStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      const token = String(parsed && parsed.token || '');
      const expiresAt = Number(parsed && parsed.expiresAt || 0);
      if (!token || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
        window.sessionStorage.removeItem(STORAGE_KEY);
        return '';
      }
      return token;
    } catch (_) {
      return '';
    }
  }

  function storeToken(token, expiresAt) {
    activeSessionToken = String(token || '');
    try {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
        token: activeSessionToken,
        expiresAt: new Date(expiresAt).getTime()
      }));
    } catch (_) {
      throw clientError('AUTH_STORAGE_UNAVAILABLE', '瀏覽器無法保存本次測試登入狀態。');
    }
  }

  function clearSession() {
    activeSessionToken = '';
    try { window.sessionStorage.removeItem(STORAGE_KEY); } catch (_) {}
  }

  function getSessionToken() {
    if (activeSessionToken) return activeSessionToken;
    activeSessionToken = readStoredToken();
    return activeSessionToken;
  }

  async function status(config) {
    return post(config, { action: 'public.status' });
  }

  async function validateStoredSession(config) {
    const token = getSessionToken();
    if (!token) return null;
    try {
      const result = await post(config, { action: 'session.status', testSessionToken: token });
      activeSessionToken = token;
      return result;
    } catch (_) {
      clearSession();
      return null;
    }
  }

  function selector(accounts, maintenanceMessage) {
    return new Promise((resolve) => {
      const existing = document.getElementById('testModeAccountModal');
      if (existing) existing.remove();

      const modal = document.createElement('section');
      modal.id = 'testModeAccountModal';
      modal.className = 'test-mode-modal';
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      modal.setAttribute('aria-labelledby', 'testModeAccountTitle');

      const card = document.createElement('div');
      card.className = 'test-mode-modal-card';

      const kicker = document.createElement('p');
      kicker.className = 'test-mode-kicker';
      kicker.textContent = 'Test mode';

      const title = document.createElement('h1');
      title.id = 'testModeAccountTitle';
      title.textContent = '選擇測試帳號';

      const description = document.createElement('p');
      description.textContent = String(maintenanceMessage || '').trim() || '目前為測試模式。請直接選擇要登入的虛擬會員帳號。';

      const label = document.createElement('label');
      label.className = 'test-mode-field';
      label.append(document.createTextNode('測試帳號'));

      const select = document.createElement('select');
      select.id = 'testModeAccountSelect';
      select.setAttribute('aria-label', '選擇測試帳號');
      for (const account of accounts) {
        const option = document.createElement('option');
        option.value = String(account.memberId || '');
        option.textContent = [account.displayName, account.memberCode].filter(Boolean).join('｜');
        select.append(option);
      }
      label.append(select);

      const message = document.createElement('p');
      message.className = 'test-mode-message';
      message.setAttribute('role', 'status');
      message.setAttribute('aria-live', 'polite');

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'test-mode-primary-button';
      button.textContent = '登入測試帳號';

      card.append(kicker, title, description, label, message, button);
      modal.append(card);
      document.body.append(modal);

      const finish = () => {
        const memberId = String(select.value || '');
        if (!memberId) {
          message.textContent = '請先選擇測試帳號。';
          return;
        }
        button.disabled = true;
        select.disabled = true;
        message.textContent = '正在建立測試登入…';
        resolve({ memberId, modal, button, select, message });
      };
      button.addEventListener('click', finish);
      select.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          finish();
        }
      });
      window.setTimeout(() => select.focus(), 0);
    });
  }

  async function prepare(config, surface, normalSignIn) {
    if (surface === 'admin') {
      clearSession();
      return { idToken: await normalSignIn(), testSessionToken: '', testAccount: null };
    }

    const mode = await status(config);
    if (!mode.enabled) {
      clearSession();
      return { idToken: await normalSignIn(), testSessionToken: '', testAccount: null };
    }

    const existing = await validateStoredSession(config);
    if (existing && existing.active) {
      return {
        idToken: '',
        testSessionToken: getSessionToken(),
        testAccount: existing.account || null
      };
    }

    const accountsResult = await post(config, {
      action: 'test-mode.accounts',
      clientType: surface
    });

    const accounts = Array.isArray(accountsResult.accounts)
      ? accountsResult.accounts.filter((account) => account && account.memberId)
      : [];
    if (!accounts.length) {
      throw clientError('NO_TEST_ACCOUNTS', '目前尚未建立可登入的測試帳號。', 409);
    }

    const selection = await selector(accounts, mode.maintenanceMessage);
    try {
      const login = await post(config, {
        action: 'test-mode.login',
        clientType: surface,
        memberId: selection.memberId
      });
      storeToken(login.testSessionToken, login.expiresAt);
      selection.modal.remove();
      return {
        idToken: '',
        testSessionToken: getSessionToken(),
        testAccount: login.account || null
      };
    } catch (error) {
      selection.button.disabled = false;
      selection.select.disabled = false;
      selection.message.textContent = error && error.message ? error.message : '測試登入失敗，請重試。';
      throw error;
    }
  }

  function payload(extra = {}) {
    const token = getSessionToken();
    return token ? { ...extra, testSessionToken: token } : { ...extra };
  }

  window.TestModeClient = Object.freeze({
    prepare,
    payload,
    getSessionToken,
    clearSession,
    status
  });
})();