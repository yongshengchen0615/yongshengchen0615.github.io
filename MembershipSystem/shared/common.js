(function () {
  'use strict';

  const currentScriptSrc = document.currentScript && document.currentScript.src;
  const configUrl = currentScriptSrc
    ? new URL('./config.json', currentScriptSrc).href
    : new URL('../shared/config.json', window.location.href).href;

  let config = null;
  let configPromise = null;

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

      if (!response.ok) {
        throw new Error('會員系統設定檔不存在或無法讀取。');
      }

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

  async function ensureLiffLogin() {
    const activeConfig = await loadConfig();
    await liff.init({ liffId: activeConfig.LIFF_ID });
    if (!liff.isLoggedIn()) {
      liff.login({ redirectUri: window.location.href });
      return false;
    }
    if (!liff.getIDToken()) {
      throw new Error('無法取得 LINE ID Token，請確認 LIFF 已啟用 openid scope。');
    }
    return true;
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
    return new Intl.DateTimeFormat('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  }

  function escapeText(value) {
    return value == null ? '' : String(value);
  }

  window.Membership = Object.freeze({ loadConfig, ensureLiffLogin, callApi, formatDate, escapeText });
})();
