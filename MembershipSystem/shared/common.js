(function () {
  'use strict';

  const currentScriptSrc = document.currentScript && document.currentScript.src;
  const configUrl = currentScriptSrc
    ? new URL('./config.json', currentScriptSrc).href
    : new URL('../shared/config.json', window.location.href).href;

  const LOGIN_PENDING_KEY = 'membership.login.pending';
  const INIT_RECOVERY_KEY = 'membership.liff.recovery';
  const LOGIN_PENDING_TTL_MS = 10 * 60 * 1000;
  const INIT_RECOVERY_COOLDOWN_MS = 30 * 1000;

  let config = null;
  let configPromise = null;
  let loginInFlight = false;
  let authenticatedIdToken = '';

  function assertConfigured(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('會員系統設定格式不正確。');
    }
    if (!value.LIFF_ID || value.LIFF_ID === 'YOUR_LIFF_ID') {
      throw new Error('尚未設定 LIFF_ID。');
    }
    if (!value.GAS_WEB_APP_URL || value.GAS_WEB_APP_URL === 'YOUR_GAS_WEB_APP_URL') {
      throw new Error('尚未設定 GAS_WEB_APP_URL。');
    }
    try {
      const url = new URL(value.GAS_WEB_APP_URL);
      if (url.protocol !== 'https:' || !url.pathname.endsWith('/exec')) throw new Error();
    } catch (_) {
      throw new Error('GAS_WEB_APP_URL 必須是 Apps Script Web App 的 HTTPS /exec 網址。');
    }
  }

  async function loadConfig() {
    if (config) return config;
    if (configPromise) return configPromise;

    configPromise = (async function () {
      let response;
      try {
        response = await fetch(configUrl, {
          method: 'GET',
          credentials: 'same-origin',
          cache: 'no-store',
          redirect: 'error',
          referrerPolicy: 'no-referrer'
        });
      } catch (_) {
        throw new Error('無法載入會員系統設定檔。');
      }

      if (!response.ok) throw new Error('會員系統設定檔不存在或無法讀取。');

      let parsed;
      try { parsed = await response.json(); }
      catch (_) { throw new Error('會員系統設定檔不是有效 JSON。'); }

      assertConfigured(parsed);
      config = Object.freeze({
        LIFF_ID: String(parsed.LIFF_ID),
        GAS_WEB_APP_URL: String(parsed.GAS_WEB_APP_URL)
      });
      return config;
    })();

    try {
      return await configPromise;
    } catch (error) {
      configPromise = null;
      throw error;
    }
  }

  function readSessionValue(key) {
    try { return window.sessionStorage.getItem(key) || ''; }
    catch (_) { return ''; }
  }

  function writeSessionValue(key, value) {
    try { window.sessionStorage.setItem(key, value); return true; }
    catch (_) { return false; }
  }

  function removeSessionValue(key) {
    try { window.sessionStorage.removeItem(key); }
    catch (_) { /* best effort only */ }
  }

  function validUsageCode(value) {
    const code = String(value || '').trim();
    return /^[a-f0-9]{64}$/i.test(code) ? code.toLowerCase() : '';
  }

  function validRequestId(value) {
    const requestId = String(value || '').trim();
    return /^[a-f0-9]{32,64}$/i.test(requestId) ? requestId.toLowerCase() : '';
  }

  function readNavigationState(url) {
    const source = url || new URL(window.location.href);
    const usage = validUsageCode(source.searchParams.get('usage'));
    const redeem = usage ? '' : validUsageCode(source.searchParams.get('redeem'));
    if (!usage && !redeem) return { usage: '', redeem: '', request: '' };
    return {
      usage,
      redeem,
      request: validRequestId(source.searchParams.get('request'))
    };
  }

  function readPendingLogin() {
    const raw = readSessionValue(LOGIN_PENDING_KEY);
    if (!raw) return null;
    try {
      const pending = JSON.parse(raw);
      if (!pending || typeof pending !== 'object') return null;
      const age = Date.now() - Number(pending.startedAt || 0);
      if (!Number.isFinite(age) || age < 0 || age > LOGIN_PENDING_TTL_MS) return null;
      if (pending.pathname !== window.location.pathname) return null;
      return pending;
    } catch (_) {
      return null;
    }
  }

  function readPendingNavigationState() {
    const pending = readPendingLogin();
    if (!pending) return { usage: '', redeem: '', request: '' };
    const usage = validUsageCode(pending.usage);
    const redeem = usage ? '' : validUsageCode(pending.redeem);
    if (!usage && !redeem) return { usage: '', redeem: '', request: '' };
    return { usage, redeem, request: validRequestId(pending.request) };
  }

  function currentNavigationState() {
    const direct = readNavigationState();
    return direct.usage || direct.redeem ? direct : readPendingNavigationState();
  }

  function appendNavigationState(url, state) {
    if (state.usage) url.searchParams.set('usage', state.usage);
    else if (state.redeem) url.searchParams.set('redeem', state.redeem);
    if ((state.usage || state.redeem) && state.request) {
      url.searchParams.set('request', state.request);
    }
    return url;
  }

  function buildCanonicalAppUrl() {
    const current = new URL(window.location.href);
    const clean = new URL(current.origin + current.pathname);
    return appendNavigationState(clean, currentNavigationState()).href;
  }

  function canonicalizeAppUrl() {
    const cleanUrl = buildCanonicalAppUrl();
    if (window.location.href !== cleanUrl) {
      window.history.replaceState(null, '', cleanUrl);
    }
  }

  function writePendingLogin() {
    const current = new URL(buildCanonicalAppUrl());
    const navigation = readNavigationState(current);
    writeSessionValue(LOGIN_PENDING_KEY, JSON.stringify({
      pathname: current.pathname,
      usage: navigation.usage,
      redeem: navigation.redeem,
      request: navigation.request,
      startedAt: Date.now()
    }));
  }

  function clearPendingLogin() {
    removeSessionValue(LOGIN_PENDING_KEY);
  }

  function captureInitArtifacts() {
    const params = new URL(window.location.href).searchParams;
    return params.has('state') || params.has('code') || params.has('response') ||
      params.has('error') || params.has('liff.state') || params.has('liffClientId') ||
      params.has('liffRedirectUri');
  }

  function shouldRecoverInitFailure(error, hadInitArtifacts) {
    if (!hadInitArtifacts) return false;
    const code = String(error && error.code || '').toLowerCase();
    const message = String(error && error.message || '').toLowerCase();
    return code === 'invalid_request' ||
      message.includes('authorization code') ||
      (message.includes('invalid') && message.includes('code'));
  }

  function recoverFromInitFailure(error, hadInitArtifacts) {
    if (!shouldRecoverInitFailure(error, hadInitArtifacts)) return false;

    const lastRecovery = Number(readSessionValue(INIT_RECOVERY_KEY) || 0);
    if (lastRecovery && Date.now() - lastRecovery < INIT_RECOVERY_COOLDOWN_MS) {
      throw new Error('LINE 登入 callback 已失效，請重新開啟此頁。');
    }

    writeSessionValue(INIT_RECOVERY_KEY, String(Date.now()));
    window.location.replace(buildCanonicalAppUrl());
    return true;
  }

  function establishAuthenticatedContext() {
    if (!liff.isLoggedIn()) return false;
    const idToken = liff.getIDToken();
    if (!idToken) {
      throw new Error('LINE 已登入但無法取得 ID Token，請確認 LIFF 已啟用 openid scope。');
    }
    authenticatedIdToken = idToken;
    loginInFlight = false;
    clearPendingLogin();
    return true;
  }

  async function ensureLiffLogin() {
    const activeConfig = await loadConfig();
    const hadInitArtifacts = captureInitArtifacts();

    try {
      await liff.init({ liffId: activeConfig.LIFF_ID });
    } catch (error) {
      if (recoverFromInitFailure(error, hadInitArtifacts)) return false;
      throw error;
    }

    removeSessionValue(INIT_RECOVERY_KEY);

    // Capture the authenticated credential before normalizing the URL. Keep it
    // only in this document's memory; GAS still verifies it with LINE per API call.
    if (establishAuthenticatedContext()) {
      canonicalizeAppUrl();
      return true;
    }

    canonicalizeAppUrl();

    // A LIFF Browser session should have been authenticated by liff.init().
    if (liff.isInClient()) {
      throw new Error('無法取得本次 LINE 登入狀態，請關閉後重新開啟。');
    }

    if (loginInFlight) return false;
    loginInFlight = true;
    writePendingLogin();

    try {
      liff.login({ redirectUri: buildCanonicalAppUrl() });
      return false;
    } catch (error) {
      loginInFlight = false;
      throw error;
    }
  }

  async function callApi(action, payload) {
    const activeConfig = await loadConfig();
    const idToken = authenticatedIdToken;
    if (!idToken) throw new Error('LINE 登入狀態尚未建立，請重新開啟此頁。');

    const form = new URLSearchParams();
    form.set('action', action);
    form.set('idToken', idToken);
    form.set('payload', JSON.stringify(payload || {}));

    let response;
    try {
      response = await fetch(activeConfig.GAS_WEB_APP_URL, {
        method: 'POST',
        body: form,
        credentials: 'omit',
        redirect: 'follow',
        cache: 'no-store',
        referrerPolicy: 'no-referrer'
      });
    } catch (_) {
      throw new Error('無法連線到會員服務，請確認 GAS Web App 已部署為可公開存取。');
    }

    const text = await response.text();
    let data;
    try { data = JSON.parse(text); }
    catch (_) { throw new Error('會員服務回傳格式不正確。'); }
    if (!data.ok) {
      const error = new Error((data.error && data.error.message) || '會員服務發生錯誤。');
      error.code = data.error && data.error.code;
      throw error;
    }
    return data.data;
  }

  function formatDate(value, fallback) {
    if (!value) return fallback || '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
    return new Intl.DateTimeFormat('zh-TW', {
      year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(date);
  }

  function escapeText(value) {
    return value == null ? '' : String(value);
  }

  window.Membership = Object.freeze({
    loadConfig,
    ensureLiffLogin,
    callApi,
    formatDate,
    escapeText
  });
})();
