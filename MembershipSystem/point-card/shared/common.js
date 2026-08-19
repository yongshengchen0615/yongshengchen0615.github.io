(function () {
  'use strict';

  let configPromise = null;
  let authenticatedIdToken = '';

  function safeText(value) {
    return value == null ? '' : String(value);
  }

  async function loadConfig() {
    if (!configPromise) {
      configPromise = fetch('../shared/config.json', {
        cache: 'no-store',
        credentials: 'omit',
        referrerPolicy: 'no-referrer'
      }).then(async (response) => {
        if (!response.ok) throw new Error('無法讀取集點卡設定。');
        const config = await response.json();
        const liffId = safeText(config.LIFF_ID).trim();
        const gasUrl = safeText(config.GAS_WEB_APP_URL).trim();
        if (!liffId) throw new Error('集點卡 LIFF_ID 尚未設定。');
        if (!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(gasUrl)) {
          throw new Error('集點卡 GAS_WEB_APP_URL 尚未設定或格式不正確。');
        }
        return Object.freeze({ LIFF_ID: liffId, GAS_WEB_APP_URL: gasUrl });
      });
    }
    return configPromise;
  }

  async function ensureLiffLogin() {
    const config = await loadConfig();
    if (!window.liff) throw new Error('LINE LIFF SDK 載入失敗。');

    await liff.init({ liffId: config.LIFF_ID });
    if (!liff.isLoggedIn()) {
      liff.login({ redirectUri: window.location.href });
      return false;
    }

    const idToken = liff.getIDToken();
    if (!idToken) throw new Error('無法取得 LINE 登入憑證，請重新開啟頁面。');
    authenticatedIdToken = idToken;
    return true;
  }

  async function callApi(action, payload) {
    const config = await loadConfig();
    if (!authenticatedIdToken) throw new Error('LINE 登入狀態尚未建立。');

    const form = new URLSearchParams();
    form.set('action', safeText(action));
    form.set('idToken', authenticatedIdToken);
    form.set('payload', JSON.stringify(payload || {}));

    let response;
    try {
      response = await fetch(config.GAS_WEB_APP_URL, {
        method: 'POST',
        body: form,
        credentials: 'omit',
        redirect: 'follow',
        cache: 'no-store',
        referrerPolicy: 'no-referrer'
      });
    } catch (_) {
      throw new Error('無法連線到集點卡服務，請確認 GAS Web App 已部署。');
    }

    const text = await response.text();
    let data;
    try { data = JSON.parse(text); }
    catch (_) { throw new Error('集點卡服務回傳格式不正確。'); }

    if (!data.ok) {
      const error = new Error(data.error && data.error.message ? data.error.message : '集點卡服務發生錯誤。');
      error.code = data.error && data.error.code;
      throw error;
    }
    return data.data;
  }

  function formatDate(value, fallback) {
    if (!value) return fallback || '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return safeText(value).slice(0, 10);
    return new Intl.DateTimeFormat('zh-TW', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit'
    }).format(date);
  }

  function createRequestId() {
    if (!window.crypto || typeof window.crypto.getRandomValues !== 'function') {
      throw new Error('瀏覽器無法建立安全的操作識別碼。');
    }
    const bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  window.PointCard = Object.freeze({
    loadConfig,
    ensureLiffLogin,
    callApi,
    formatDate,
    createRequestId,
    safeText
  });
})();
