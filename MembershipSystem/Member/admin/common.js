(() => {
  'use strict';

  const GAS_URL_PATTERN = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/;
  const FRESH_LOGIN_QUERY = 'member_system_reauth';
  const READ_RESPONSE_ATTEMPTS = 2;
  const READ_RETRY_DELAY_MS = 400;
  // 一般讀取維持 9 秒總預算；管理端 full bootstrap 因需完整讀取多個資料集，使用獨立 30 秒上限。
  const READ_REQUEST_TIMEOUT_MS = 9000;
  const READ_TOTAL_TIMEOUT_MS = 9000;
  const ADMIN_FULL_BOOTSTRAP_TIMEOUT_MS = 30000;
  const pendingReads = new Map();
  const WRITE_REQUEST_TIMEOUT_MS = 30000;
  const CONFIG_RESPONSE_ATTEMPTS = 2;
  const WRITE_ACTIONS = Object.freeze([
    'user.member.profile.save',
    'admin.member.update',
    'admin.member-tiers.save',
    'admin.pointcards.save',
    'admin.pointcards.reorder',
    'admin.pointcards.archive',
    'admin.pointcards.delete',
    'admin.pointcards.remove',
    'admin.tickets.save',
    'admin.event-tickets.save',
    'admin.event-tickets.delete',
    'admin.calendar-items.save',
    'admin.calendar-items.delete',
    'admin.calendar-items.batch',
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
    const deadline = Date.now() + READ_TOTAL_TIMEOUT_MS;
    let lastError;
    for (let attempt = 0; attempt < CONFIG_RESPONSE_ATTEMPTS; attempt += 1) {
      try {
        const fetched = await fetchWithTimeout('../config.json', { cache: 'no-cache' }, Math.max(1, deadline - Date.now()), (response) => response.text());
        const response = fetched.response;
        if (!response.ok) throw clientError('CONFIG_ERROR', '讀取 config.json 失敗。');
        let config;
        try {
          config = JSON.parse(fetched.body);
        } catch (_) {
          throw clientError('CONFIG_ERROR', 'config.json 格式不正確。');
        }
        if (!config || typeof config !== 'object' || Array.isArray(config)) throw clientError('CONFIG_ERROR', 'config.json 格式不正確。');
        return config;
      } catch (error) {
        lastError = error && error.code === 'CONFIG_ERROR' ? error : clientError('CONFIG_ERROR', '無法讀取公開設定，請確認網路後重試。');
      }
      if (Date.now() + READ_RETRY_DELAY_MS >= deadline) break;
      if (attempt < CONFIG_RESPONSE_ATTEMPTS - 1) await waitForReadRetry(attempt);
    }
    throw lastError || clientError('CONFIG_ERROR', '無法讀取公開設定，請確認網站設定。');
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
      await withTimeout(window.liff.init({ liffId }), 8000, 'LINE 初始化逾時，請重新開啟此頁面。');
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
        await withTimeout(new Promise(() => {}), 8000, '登入跳轉未完成，請重新開啟此頁面。');
      }
      if (!window.liff.isLoggedIn()) {
        redirectToFreshLogin(surface);
        await withTimeout(new Promise(() => {}), 8000, '登入跳轉未完成，請重新開啟此頁面。');
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

  async function fetchWithTimeout(url, options, timeoutMs, readBody) {
    const schedule = typeof window !== 'undefined' && typeof window.setTimeout === 'function'
      ? window.setTimeout.bind(window)
      : typeof setTimeout === 'function' ? setTimeout : null;
    const cancel = typeof window !== 'undefined' && typeof window.clearTimeout === 'function'
      ? window.clearTimeout.bind(window)
      : typeof clearTimeout === 'function' ? clearTimeout : null;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    let timer;
    const requestOptions = controller ? { ...options, signal: controller.signal } : options;
    const requestPromise = (async () => {
      const response = await fetch(url, requestOptions);
      const body = typeof readBody === 'function' ? await readBody(response) : undefined;
      return { response, body };
    })();
    if (!schedule) return requestPromise;
    try {
      return await Promise.race([
        requestPromise,
        new Promise((_, reject) => {
          timer = schedule(() => {
            if (controller) controller.abort();
            reject(clientError('REQUEST_TIMEOUT', '資料服務回應逾時。'));
          }, timeoutMs);
        })
      ]);
    } finally {
      if (timer !== undefined && cancel) cancel(timer);
    }
  }

  // 同一個帳號、API、參數的同時讀取只送一次；寫入前後清除舊請求索引。
  function request(config, clientType, idToken, action, payload = {}) {
    if (WRITE_ACTIONS.includes(action)) {
      pendingReads.clear();
      return sendRequest(config, clientType, idToken, action, payload).finally(() => pendingReads.clear());
    }
    const key = JSON.stringify([config.gasWebAppUrl, clientType, idToken, action, payload]);
    if (pendingReads.has(key)) return pendingReads.get(key);
    const pending = sendRequest(config, clientType, idToken, action, payload).finally(() => {
      if (pendingReads.get(key) === pending) pendingReads.delete(key);
    });
    pendingReads.set(key, pending);
    return pending;
  }

  function withTimeout(promise, timeoutMs, message) {
    const schedule = typeof window.setTimeout === 'function' ? window.setTimeout.bind(window) : typeof setTimeout === 'function' ? setTimeout : null;
    const cancel = typeof window.clearTimeout === 'function' ? window.clearTimeout.bind(window) : typeof clearTimeout === 'function' ? clearTimeout : null;
    if (!schedule) return promise;
    let timer;
    return Promise.race([promise, new Promise((_, reject) => {
      timer = schedule(() => reject(clientError('REQUEST_TIMEOUT', message || '等待逾時。')), timeoutMs);
    })]).finally(() => { if (cancel) cancel(timer); });
  }

  // 將 Tab 焦點保留在目前的對話框內，避免操作到後方的核銷或管理按鈕。
  function bindDialogKeyboard() {
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Tab') return;
      const dialogs = Array.from(document.querySelectorAll('[role="dialog"][aria-modal="true"]')).filter((dialog) => dialog.getClientRects().length);
      const dialog = dialogs[dialogs.length - 1];
      if (!dialog) return;
      const controls = Array.from(dialog.querySelectorAll('button, a[href], input, select, textarea, [tabindex]')).filter((el) => !el.disabled && el.tabIndex >= 0 && el.getClientRects().length);
      const first = controls[0]; const last = controls[controls.length - 1];
      if (!first) { event.preventDefault(); dialog.tabIndex = -1; dialog.focus(); return; }
      if (!dialog.contains(document.activeElement) || (event.shiftKey ? document.activeElement === first : document.activeElement === last)) {
        event.preventDefault(); (event.shiftKey ? last : first).focus();
      }
    });
  }

  async function sendRequest(config, clientType, idToken, action, payload = {}) {
    const isWrite = WRITE_ACTIONS.indexOf(action) !== -1;
    const isFullAdminBootstrap = !isWrite && clientType === 'admin' && action === 'admin.bootstrap' && !Boolean(payload && payload.lazy);
    const attempts = isWrite ? 1 : READ_RESPONSE_ATTEMPTS;
    const readBudgetMs = isFullAdminBootstrap ? ADMIN_FULL_BOOTSTRAP_TIMEOUT_MS : READ_TOTAL_TIMEOUT_MS;
    const readRequestTimeoutMs = isFullAdminBootstrap ? ADMIN_FULL_BOOTSTRAP_TIMEOUT_MS : READ_REQUEST_TIMEOUT_MS;
    const deadline = Date.now() + readBudgetMs;
    let lastError;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      let response;
      let rawResponse = '';
      try {
        const fetched = await fetchWithTimeout(config.gasWebAppUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          cache: 'no-store',
          redirect: 'follow',
          body: JSON.stringify({ ...payload, action, clientType, idToken })
        }, isWrite ? WRITE_REQUEST_TIMEOUT_MS : Math.max(1, Math.min(readRequestTimeoutMs, deadline - Date.now())), (result) => result.text());
        response = fetched.response;
        rawResponse = fetched.body;
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
          data = JSON.parse(rawResponse);
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

      if (isWrite || attempt === attempts - 1 || Date.now() + READ_RETRY_DELAY_MS >= deadline) throw lastError;
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

  function openMemberJoin(config) {
    const memberLiffId = String(config && config.memberLiffId || '').trim();
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(memberLiffId)) return false;
    const url = `https://liff.line.me/${encodeURIComponent(memberLiffId)}`;
    if (window.liff && typeof window.liff.openWindow === 'function') {
      window.liff.openWindow({ url, external: false });
      return true;
    }
    if (window.location && typeof window.location.assign === 'function') window.location.assign(url);
    return true;
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

  window.MemberSystem = Object.freeze({ bindDialogKeyboard, clientError, loadConfig, validateConfig, signIn, request, logout, openMemberJoin, formatDate, formatDateTime, initials });
})();


