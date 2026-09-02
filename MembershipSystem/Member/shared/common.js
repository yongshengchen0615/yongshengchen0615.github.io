(() => {
  'use strict';

  const GAS_URL_PATTERN = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/;

  function clientError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  async function loadConfig() {
    let response;
    try {
      response = await fetch('../config.json', { cache: 'no-store' });
    } catch (_) {
      throw clientError('CONFIG_ERROR', '無法讀取公開設定，請確認網站設定。');
    }
    if (!response.ok) throw clientError('CONFIG_ERROR', '讀取 config.json 失敗。');

    let config;
    try {
      config = await response.json();
    } catch (_) {
      throw clientError('CONFIG_ERROR', 'config.json 格式不正確。');
    }
    return config;
  }

  function validateConfig(config, surface) {
    const gasUrl = String(config && config.gasWebAppUrl || '').trim();
    const key = surface === 'admin' ? 'adminLiffId' : 'userLiffId';
    const liffId = String(config && config[key] || '').trim();

    if (!GAS_URL_PATTERN.test(gasUrl)) {
      throw clientError('CONFIG_ERROR', '尚未正確設定 GAS Web App URL。');
    }
    if (!liffId || liffId.includes('REPLACE_WITH_')) {
      throw clientError('CONFIG_ERROR', `尚未設定 ${surface === 'admin' ? 'Admin' : 'User'} LIFF ID。`);
    }
  }

  async function signIn(config, surface) {
    validateConfig(config, surface);
    if (!window.liff) throw clientError('LIFF_SDK_ERROR', 'LIFF SDK 載入失敗，請確認網路後重試。');

    const liffId = surface === 'admin' ? config.adminLiffId : config.userLiffId;
    try {
      await window.liff.init({ liffId });
    } catch (_) {
      throw clientError('LIFF_INIT_ERROR', `${surface === 'admin' ? 'Admin' : 'User'} LIFF 初始化失敗，請檢查 LIFF ID 與 Endpoint URL。`);
    }

    if (!window.liff.isLoggedIn()) {
      window.liff.login({ redirectUri: window.location.href });
      await new Promise(() => {});
    }

    const idToken = window.liff.getIDToken() || '';
    if (!idToken) throw clientError('AUTH_REQUIRED', '無法取得 LINE ID token，請確認 LIFF 已啟用 openid scope。');
    return idToken;
  }

  async function request(config, clientType, idToken, action, payload = {}) {
    let response;
    try {
      response = await fetch(config.gasWebAppUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        cache: 'no-store',
        redirect: 'follow',
        body: JSON.stringify({ action, clientType, idToken, ...payload })
      });
    } catch (_) {
      throw clientError('NETWORK_ERROR', '目前無法連線資料服務，請檢查網路後重試。');
    }

    let data;
    try {
      data = await response.json();
    } catch (_) {
      throw clientError('API_RESPONSE_ERROR', '資料服務回傳格式錯誤，請確認 GAS 部署的是最新版本。');
    }

    if (!data || data.ok !== true) {
      const error = clientError(
        data && data.error && data.error.code || 'API_ERROR',
        data && data.error && data.error.message || '資料服務拒絕此請求。'
      );
      error.status = Number(data && data.status || response.status || 0);
      error.details = data && data.error && data.error.details || null;
      throw error;
    }
    return data.data || {};
  }

  function logout() {
    try {
      if (window.liff && window.liff.isLoggedIn()) window.liff.logout();
    } finally {
      window.location.reload();
    }
  }

  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value ? String(value) : '—';
    return new Intl.DateTimeFormat('zh-Hant-TW', { year: 'numeric', month: 'short', day: 'numeric' }).format(date);
  }

  function formatDateTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value ? String(value) : '—';
    return new Intl.DateTimeFormat('zh-Hant-TW', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
  }

  function initials(name) {
    const text = String(name || '會員').trim();
    return Array.from(text).slice(0, 2).join('') || '會員';
  }

  window.MemberSystem = Object.freeze({ clientError, loadConfig, validateConfig, signIn, request, logout, formatDate, formatDateTime, initials });
})();
