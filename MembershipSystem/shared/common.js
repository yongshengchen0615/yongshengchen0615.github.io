(function () {
  'use strict';

  const currentScriptSrc = document.currentScript && document.currentScript.src;
  const configUrl = currentScriptSrc
    ? new URL('./config.json', currentScriptSrc).href
    : new URL('../shared/config.json', window.location.href).href;

  const LOGIN_PENDING_KEY = 'membership.login.pending';
  const INIT_RECOVERY_KEY = 'membership.reauth.recovery';
  const LOGIN_PENDING_TTL_MS = 10 * 60 * 1000;
  const INIT_RECOVERY_COOLDOWN_MS = 30 * 1000;

  let config = null;
  let configPromise = null;
  let loginInFlight = false;

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
    if (direct.usage || direct.redeem) return direct;
    return readPendingNavigationState();
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
    const pending = {
      pathname: current.pathname,
      usage: navigation.usage,
      redeem: navigation.redeem,
      request: navigation.request,
      startedAt: Date.now()
    };
    writeSessionValue(LOGIN_PENDING_KEY, JSON.stringify(pending));
  }

  function clearPendingLogin() {
    removeSessionValue(LOGIN_PENDING_KEY);
  }

  function captureInitArtifacts() {
    const params = new URL(window.location.href).searchParams;
    return {
      hasArtifacts: params.has('state') || params.has('code') || params.has('response') ||
        params.has('error') || params.has('liff.state') || params.has('liffClientId') ||
        params.has('liffRedirectUri')
    };
  }

  function shouldRecoverInitFailure(error, initArtifacts) {
    if (!initArtifacts || !initArtifacts.hasArtifacts) return false;
    const code = String(error && error.code || '').toLowerCase();
    const message = String(error && error.message || '').toLowerCase();
    return code === 'invalid_request' ||
      message.indexOf('authorization code') !== -1 ||
      (message.indexOf('invalid') !== -1 && message.indexOf('code') !== -1);
  }

  function recoverFromInitFailure(error, initArtifacts) {
    if (!shouldRecoverInitFailure(error, initArtifacts)) return false;

    const lastRecovery = Number(readSessionValue(INIT_RECOVERY_KEY) || 0);
    if (lastRecovery && Date.now() - lastRecovery < INIT_RECOVERY_COOLDOWN_MS) {
      throw new Error('LINE 登入 callback 已失效，請重新開啟會員頁。');
    }

    writeSessionValue(INIT_RECOVERY_KEY, String(Date.now()));
    const cleanUrl = buildCanonicalAppUrl();
    window.location.replace(cleanUrl);
    return true;
  }

  async function ensureLiffLogin() {
    const activeConfig = await loadConfig();
    const initArtifacts = captureInitArtifacts();

    try {
      await liff.init({ liffId: activeConfig.LIFF_ID });
    } catch (error) {
      if (recoverFromInitFailure(error, initArtifacts)) return false;
      throw error;
    }

    removeSessionValue(INIT_RECOVERY_KEY);

    // LIFF restores additional path/query information during initialization.
    // Only normalize the URL after liff.init() resolves.
    canonicalizeAppUrl();

    // Standard LIFF flow: never force-logout a valid external-browser session.
    if (liff.isLoggedIn()) {
      const idToken = liff.getIDToken();
      if (!idToken) {
        throw new Error('LINE 已登入但無法取得 ID Token，請確認 LIFF scope 已啟用 openid。');
      }
      loginInFlight = false;
      clearPendingLogin();
      return true;
    }

    // LIFF Browser should already be authenticated by liff.init().
    if (liff.isInClient()) {
      throw new Error('無法取得本次 LINE 登入狀態，請關閉後重新開啟。');
    }

    if (loginInFlight) return false;
    loginInFlight = true;

    // Preserve only validated application parameters across the external-browser login callback.
    canonicalizeAppUrl();
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
    const idToken = liff.getIDToken();
    if (!idToken) throw new Error('LINE 登入已失效，請重新登入。');

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
