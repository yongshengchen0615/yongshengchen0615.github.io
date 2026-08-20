(function () {
  'use strict';

  const LOGIN_PENDING_KEY = 'points-card.login.pending';
  const INIT_RECOVERY_KEY = 'points-card.liff.recovery';
  const AUTH_REFRESH_KEY = 'points-card.liff.auth-refresh';
  const INIT_RECOVERY_COOLDOWN_MS = 60 * 1000;
  const AUTH_REFRESH_COOLDOWN_MS = 60 * 1000;
  const ID_TOKEN_EXPIRY_SKEW_SECONDS = 30;
  const API_TIMEOUT_MS = 25000;

  let configPromise = null;
  let authenticatedIdToken = '';
  let loginInFlight = false;

  function readSessionValue(key) {
    try { return window.sessionStorage.getItem(key) || ''; }
    catch (_) { return ''; }
  }

  function writeSessionValue(key, value) {
    try { window.sessionStorage.setItem(key, value); }
    catch (_) {}
  }

  function removeSessionValue(key) {
    try { window.sessionStorage.removeItem(key); }
    catch (_) {}
  }

  function validStampCode(value) {
    const code = String(value || '').trim();
    return /^[a-f0-9]{64}$/i.test(code) ? code.toLowerCase() : '';
  }

  function validRequestId(value) {
    const requestId = String(value || '').trim();
    return /^[a-f0-9]{32,64}$/i.test(requestId) ? requestId.toLowerCase() : '';
  }

  function randomHex(bytes) {
    const data = new Uint8Array(bytes || 16);
    window.crypto.getRandomValues(data);
    return Array.from(data, (value) => value.toString(16).padStart(2, '0')).join('');
  }

  function monotonicNow() {
    return window.performance && typeof window.performance.now === 'function' ? window.performance.now() : Date.now();
  }

  function safeErrorContext(context) {
    const source = context || {};
    const result = {};
    ['source', 'action', 'traceId'].forEach(function (key) {
      if (source[key]) result[key] = String(source[key]).slice(0, 120);
    });
    if (Number.isFinite(Number(source.durationMs))) result.durationMs = Math.round(Number(source.durationMs));
    return result;
  }

  function sanitizeErrorMessage(error) {
    return String(error && error.message ? error.message : error || 'Unknown error')
      .replace(/https?:\/\/[^\s)]+/gi, '[url]')
      .replace(/\bU[a-f0-9]{32}\b/gi, '[line-user-id]')
      .replace(/\b[a-f0-9]{32,64}\b/gi, '[hex-token]')
      .replace(/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/g, '[jwt]')
      .slice(0, 500);
  }

  function reportError(error, context) {
    const safeContext = safeErrorContext(context);
    const safeError = new Error(sanitizeErrorMessage(error));
    safeError.name = error && error.name ? String(error.name).slice(0, 80) : 'Error';
    try {
      if (window.Sentry && typeof window.Sentry.captureException === 'function') {
        window.Sentry.captureException(safeError, {
          tags: {
            feature: 'points-card',
            source: safeContext.source || 'frontend',
            action: safeContext.action || 'unknown'
          },
          extra: safeContext
        });
        return;
      }
    } catch (_) {}
    try {
      console.error('PointsCard error', safeContext, safeError.message);
    } catch (_) {}
  }

  async function loadConfig() {
    if (configPromise) return configPromise;
    configPromise = (async function () {
      const response = await fetch(new URL('../shared/config.json', window.location.href), {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        referrerPolicy: 'no-referrer'
      });
      if (!response.ok) throw new Error('無法載入集點卡設定。');
      const config = await response.json();
      const liffId = String(config && config.LIFF_ID || '').trim();
      const gasUrl = String(config && config.GAS_WEB_APP_URL || '').trim();
      if (!liffId || liffId === 'YOUR_LIFF_ID') throw new Error('LIFF_ID 尚未設定。');
      if (!/^https:\/\//i.test(gasUrl) || gasUrl === 'YOUR_GAS_WEB_APP_EXEC_URL') {
        throw new Error('GAS Web App URL 尚未設定。');
      }
      return Object.freeze({ LIFF_ID: liffId, GAS_WEB_APP_URL: gasUrl });
    })().catch(function (error) {
      configPromise = null;
      reportError(error, { source: 'config', action: 'loadConfig' });
      throw error;
    });
    return configPromise;
  }

  function readNavigationState(url) {
    const source = url || new URL(window.location.href);
    const stamp = validStampCode(source.searchParams.get('stamp'));
    return {
      stamp: stamp,
      request: stamp ? validRequestId(source.searchParams.get('request')) : ''
    };
  }

  function readPendingNavigationState() {
    const raw = readSessionValue(LOGIN_PENDING_KEY);
    if (!raw) return { stamp: '', request: '' };
    try {
      const pending = JSON.parse(raw);
      if (!pending || Date.now() - Number(pending.startedAt || 0) > 15 * 60 * 1000) {
        removeSessionValue(LOGIN_PENDING_KEY);
        return { stamp: '', request: '' };
      }
      const stamp = validStampCode(pending.stamp);
      return { stamp: stamp, request: stamp ? validRequestId(pending.request) : '' };
    } catch (_) {
      removeSessionValue(LOGIN_PENDING_KEY);
      return { stamp: '', request: '' };
    }
  }

  function getNavigationState() {
    const direct = readNavigationState();
    return direct.stamp ? direct : readPendingNavigationState();
  }

  function buildCanonicalAppUrl() {
    const url = new URL(window.location.href);
    const navigation = getNavigationState();
    url.search = '';
    url.hash = '';
    if (navigation.stamp) url.searchParams.set('stamp', navigation.stamp);
    if (navigation.stamp && navigation.request) url.searchParams.set('request', navigation.request);
    return url.href;
  }

  function canonicalizeAppUrl() {
    const cleanUrl = buildCanonicalAppUrl();
    if (window.location.href !== cleanUrl) window.history.replaceState(null, '', cleanUrl);
  }

  function clearNavigationState() {
    removeSessionValue(LOGIN_PENDING_KEY);
    const url = new URL(window.location.href);
    url.searchParams.delete('stamp');
    url.searchParams.delete('request');
    window.history.replaceState(null, '', url.href);
  }

  function writePendingLogin() {
    const navigation = getNavigationState();
    writeSessionValue(LOGIN_PENDING_KEY, JSON.stringify({
      stamp: navigation.stamp,
      request: navigation.request,
      startedAt: Date.now()
    }));
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
    return code === 'invalid_request' || message.includes('authorization code') ||
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

  function currentIdTokenExpiry() {
    if (typeof liff.getDecodedIDToken !== 'function') return 0;
    try {
      const decoded = liff.getDecodedIDToken();
      const exp = Number(decoded && decoded.exp);
      return Number.isFinite(exp) ? exp : 0;
    } catch (_) { return 0; }
  }

  function hasFreshIdToken() {
    const exp = currentIdTokenExpiry();
    return !exp || exp > Math.floor(Date.now() / 1000) + ID_TOKEN_EXPIRY_SKEW_SECONDS;
  }

  function startExternalLogin(forceRefresh) {
    if (liff.isInClient()) {
      throw new Error('LINE 登入憑證已過期，請關閉此 LIFF 頁面後重新開啟。');
    }
    if (loginInFlight) return false;
    if (forceRefresh) {
      const lastRefresh = Number(readSessionValue(AUTH_REFRESH_KEY) || 0);
      if (lastRefresh && Date.now() - lastRefresh < AUTH_REFRESH_COOLDOWN_MS) {
        throw new Error('LINE 登入憑證仍為過期狀態，請關閉此分頁後重新開啟。');
      }
      writeSessionValue(AUTH_REFRESH_KEY, String(Date.now()));
    }
    loginInFlight = true;
    writePendingLogin();
    authenticatedIdToken = '';
    try {
      if (forceRefresh && liff.isLoggedIn()) liff.logout();
      liff.login({ redirectUri: buildCanonicalAppUrl() });
      return false;
    } catch (error) {
      loginInFlight = false;
      if (forceRefresh) removeSessionValue(AUTH_REFRESH_KEY);
      throw error;
    }
  }

  async function ensureLiffLogin() {
    const activeConfig = await loadConfig();
    const hadInitArtifacts = captureInitArtifacts();
    try {
      await liff.init({ liffId: activeConfig.LIFF_ID });
    } catch (error) {
      if (recoverFromInitFailure(error, hadInitArtifacts)) return false;
      reportError(error, { source: 'liff', action: 'init' });
      throw error;
    }

    removeSessionValue(INIT_RECOVERY_KEY);
    if (liff.isLoggedIn()) {
      const idToken = liff.getIDToken();
      if (!idToken) throw new Error('LINE 已登入但無法取得 ID Token，請確認 LIFF 已啟用 openid scope。');
      if (!hasFreshIdToken()) return startExternalLogin(true);
      authenticatedIdToken = idToken;
      loginInFlight = false;
      removeSessionValue(AUTH_REFRESH_KEY);
      canonicalizeAppUrl();
      removeSessionValue(LOGIN_PENDING_KEY);
      return true;
    }

    canonicalizeAppUrl();
    if (liff.isInClient()) throw new Error('無法取得本次 LINE 登入狀態，請關閉後重新開啟。');
    return startExternalLogin(false);
  }

  async function callApi(action, payload) {
    const activeConfig = await loadConfig();
    if (!authenticatedIdToken) throw new Error('LINE 登入狀態尚未建立，請重新開啟此頁。');
    if (!hasFreshIdToken()) {
      startExternalLogin(true);
      throw new Error('LINE 登入憑證已過期，正在重新登入。');
    }

    const safeAction = String(action || '');
    const startedAt = monotonicNow();
    const form = new URLSearchParams();
    form.set('action', safeAction);
    form.set('idToken', authenticatedIdToken);
    form.set('payload', JSON.stringify(payload || {}));
    const controller = new AbortController();
    const timeout = window.setTimeout(function () { controller.abort(); }, API_TIMEOUT_MS);
    let response;
    try {
      response = await fetch(activeConfig.GAS_WEB_APP_URL, {
        method: 'POST',
        body: form,
        credentials: 'omit',
        redirect: 'follow',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        signal: controller.signal
      });
    } catch (error) {
      const publicError = error && error.name === 'AbortError'
        ? new Error('集點服務回應逾時；再次嘗試會沿用相同請求，不會重複集點。')
        : new Error('無法連線到集點服務，請確認 GAS Web App 已正確部署。');
      reportError(publicError, {
        source: 'api-network', action: safeAction, durationMs: monotonicNow() - startedAt
      });
      throw publicError;
    } finally {
      window.clearTimeout(timeout);
    }

    const text = await response.text();
    let data;
    try { data = JSON.parse(text); }
    catch (_) {
      const error = new Error('集點服務回傳格式不正確。');
      reportError(error, { source: 'api-response', action: safeAction, durationMs: monotonicNow() - startedAt });
      throw error;
    }
    const traceId = String(data && data.meta && data.meta.traceId || '').slice(0, 64);
    if (!data.ok) {
      const error = new Error(data.error && data.error.message || '集點服務發生錯誤。');
      error.code = data.error && data.error.code;
      error.traceId = traceId;
      reportError(error, {
        source: 'api', action: safeAction, traceId: traceId, durationMs: monotonicNow() - startedAt
      });
      if (error.code === 'UNAUTHENTICATED' && !liff.isInClient()) startExternalLogin(true);
      throw error;
    }
    return data.data;
  }

  function formatDate(value, fallback) {
    if (!value) return fallback || '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
    return new Intl.DateTimeFormat('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  }

  function formatDateTime(value, fallback) {
    if (!value) return fallback || '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat('zh-TW', {
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
    }).format(date);
  }

  window.PointsCard = Object.freeze({
    loadConfig: loadConfig,
    ensureLiffLogin: ensureLiffLogin,
    callApi: callApi,
    reportError: reportError,
    getNavigationState: getNavigationState,
    clearNavigationState: clearNavigationState,
    validStampCode: validStampCode,
    validRequestId: validRequestId,
    randomHex: randomHex,
    formatDate: formatDate,
    formatDateTime: formatDateTime
  });
})();
