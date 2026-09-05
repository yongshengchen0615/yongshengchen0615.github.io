(() => {
  'use strict';

  const GAS_URL_PATTERN = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/;
  const FRESH_LOGIN_QUERY = 'member_system_reauth';
  const READ_RESPONSE_ATTEMPTS = 2;
  const READ_RETRY_DELAY_MS = 400;
  const REQUEST_TIMEOUT_MS = 15000;
  const WRITE_ACTIONS = Object.freeze([
    'user.member.profile.save',
    'admin.member.update',
    'admin.member-tiers.save',
    'admin.pointcards.save',
    'admin.pointcards.archive',
    'admin.pointcards.delete',
    'admin.pointcards.remove',
    'admin.tickets.save',
    'admin.event-tickets.save',
    'admin.event-tickets.delete',
    'admin.calendar-items.save',
    'admin.calendar-items.delete',
    'admin.stamps.add',
    'admin.service_minutes.add',
    'admin.member-grants.add',
    'user.pointcard.ticket.redeem',
    'user.event.ticket.claim',
    'user.event.ticket.redeem'
  ]);

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
    const keys = { member: 'memberLiffId', points: 'pointsLiffId', admin: 'adminLiffId', event: 'eventLiffId', calendar: 'calendarLiffId' };
    const key = keys[surface];
    const liffId = String(config && config[key] || '').trim();

    if (!GAS_URL_PATTERN.test(gasUrl)) {
      throw clientError('CONFIG_ERROR', '尚未正確設定 GAS Web App URL。');
    }
    if (!key || !liffId || liffId.includes('REPLACE_WITH_')) {
      throw clientError('CONFIG_ERROR', `尚未設定 ${surface === 'admin' ? 'Admin' : surface === 'points' ? 'Points' : surface === 'event' ? 'Event' : surface === 'calendar' ? 'Calendar' : 'Member'} LIFF ID。`);
    }
    const configuredLiffIds = Object.keys(keys).map((name) => String(config && config[keys[name]] || '').trim()).filter(Boolean);
    if (new Set(configuredLiffIds).size !== configuredLiffIds.length) throw clientError('CONFIG_ERROR', '會員、集點卡、活動票券、日曆與管理端必須使用不同的 LIFF ID。');
  }

  async function signIn(config, surface) {
    validateConfig(config, surface);
    if (!window.liff) throw clientError('LIFF_SDK_ERROR', 'LIFF SDK 載入失敗，請確認網路後重試。');

    const liffId = surface === 'admin' ? config.adminLiffId : surface === 'points' ? config.pointsLiffId : surface === 'event' ? config.eventLiffId : surface === 'calendar' ? config.calendarLiffId : config.memberLiffId;
    try {
      await window.liff.init({ liffId });
    } catch (_) {
      const label = surface === 'admin' ? 'Admin' : surface === 'points' ? 'Points' : surface === 'event' ? 'Event' : surface === 'calendar' ? 'Calendar' : 'Member';
      throw clientError('LIFF_INIT_ERROR', `${label} LIFF 初始化失敗，請檢查 LIFF ID 與 Endpoint URL。`);
    }

    const inLiffClient = typeof window.liff.isInClient === 'function' && window.liff.isInClient();
    if (inLiffClient) {
      if (!window.liff.isLoggedIn()) {
        throw clientError('AUTH_REQUIRED', 'LINE LIFF 尚未完成登入，請重新開啟此 LIFF。');
      }
    } else {
      const returnedFromLogin = consumeFreshLoginQuery(surface);
      if (!returnedFromLogin) {
        if (window.liff.isLoggedIn()) {
          try { window.liff.logout(); } catch (_) {}
        }
        redirectToFreshLogin(surface);
        await new Promise(() => {});
      }
      if (!window.liff.isLoggedIn()) {
        redirectToFreshLogin(surface);
        await new Promise(() => {});
      }
    }

    const idToken = window.liff.getIDToken() || '';
    if (!idToken) throw clientError('AUTH_REQUIRED', '無法取得 LINE ID token，請確認 LIFF 已啟用 openid scope。');
    return idToken;
  }

  function redirectToFreshLogin(surface) {
    const redirectUrl = new URL(window.location.href);
    redirectUrl.searchParams.set(FRESH_LOGIN_QUERY, surface);
    window.liff.login({ redirectUri: redirectUrl.toString() });
  }

  function consumeFreshLoginQuery(surface) {
    const currentUrl = new URL(window.location.href);
    if (currentUrl.searchParams.get(FRESH_LOGIN_QUERY) !== surface) return false;
    currentUrl.searchParams.delete(FRESH_LOGIN_QUERY);
    window.history.replaceState({}, document.title, currentUrl.pathname + currentUrl.search + currentUrl.hash);
    return true;
  }

  async function fetchWithTimeout(url, options) {
    if (typeof AbortController === 'undefined') return fetch(url, options);
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      window.clearTimeout(timer);
    }
  }

  async function request(config, clientType, idToken, action, payload = {}) {
    const isWrite = WRITE_ACTIONS.indexOf(action) !== -1;
    const attempts = isWrite ? 1 : READ_RESPONSE_ATTEMPTS;
    let lastError;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      let response;
      try {
        response = await fetchWithTimeout(config.gasWebAppUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          cache: 'no-store',
          redirect: 'follow',
          body: JSON.stringify({ action, clientType, idToken, ...payload })
        });
      } catch (_) {
        lastError = clientError(
          isWrite ? 'API_RESPONSE_UNCERTAIN' : 'NETWORK_ERROR',
          isWrite
            ? '無法確認這次操作是否已送達；資料可能已更新，請先重新整理確認，請勿重複送出。'
            : '目前無法連線資料服務，請檢查網路後重試。'
        );
      }

      if (!lastError) {
        let data;
        try {
          data = JSON.parse(await response.text());
        } catch (_) {
          lastError = clientError(
            isWrite ? 'API_RESPONSE_UNCERTAIN' : 'API_RESPONSE_ERROR',
            isWrite
              ? '無法確認這次操作的回應；資料可能已更新，請先重新整理確認，請勿重複送出。'
              : '資料服務暫時未正常回應，已自動重試仍失敗，請稍後重新整理。'
          );
          lastError.status = Number(response && response.status || 0);
        }

        if (!lastError) {
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
      }

      if (isWrite || attempt === attempts - 1) throw lastError;
      await waitForReadRetry(attempt);
      lastError = null;
    }
    throw lastError || clientError('API_RESPONSE_ERROR', '資料服務暫時未正常回應，請稍後重新整理。');
  }

  function waitForReadRetry(attempt) {
    return new Promise((resolve) => {
      const delay = READ_RETRY_DELAY_MS * (attempt + 1);
      if (typeof window !== 'undefined' && typeof window.setTimeout === 'function') {
        window.setTimeout(resolve, delay);
      } else if (typeof setTimeout === 'function') {
        setTimeout(resolve, delay);
      } else {
        resolve();
      }
    });
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
