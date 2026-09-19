(() => {
  'use strict';

  const SUPABASE_URL_PATTERN = /^https:\/\/[a-z0-9-]+\.supabase\.co$/i;
  const SUPABASE_FUNCTION_PATTERN = /^https:\/\/[a-z0-9-]+\.supabase\.co\/functions\/v1\/[A-Za-z0-9_-]+$/i;
  const FRESH_LOGIN_QUERY = 'member_system_reauth';
  const FRESH_LOGIN_MAX_AGE_MS = 5 * 60 * 1000;
  const READ_RETRY_DELAY_MS = 400;
  const READ_TIMEOUT_MS = 12000;
  const BOOTSTRAP_TIMEOUT_MS = 30000;
  const WRITE_TIMEOUT_MS = 30000;
  const pendingReads = new Map();
  const realtimeSubscriptions = new Map();
  let realtimeClient = null;
  let realtimeClientKey = '';

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
    'admin.grant-message-presets.save',
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
    let lastError;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const result = await fetchWithTimeout('../config.json', { cache: 'no-cache' }, READ_TIMEOUT_MS, (response) => response.text());
        if (!result.response.ok) throw clientError('CONFIG_ERROR', '讀取 config.json 失敗。');
        const config = JSON.parse(result.body);
        if (!config || typeof config !== 'object' || Array.isArray(config)) throw clientError('CONFIG_ERROR', 'config.json 格式不正確。');
        return config;
      } catch (error) {
        lastError = error && error.code === 'CONFIG_ERROR' ? error : clientError('CONFIG_ERROR', '無法讀取公開設定，請確認網路後重試。');
        if (attempt === 0) await wait(READ_RETRY_DELAY_MS);
      }
    }
    throw lastError || clientError('CONFIG_ERROR', '無法讀取公開設定。');
  }

  function validateConfig(config, surface) {
    const keys = { member: 'memberLiffId', points: 'pointsLiffId', admin: 'adminLiffId', event: 'eventLiffId', calendar: 'calendarLiffId', booking: 'bookingLiffId' };
    const key = keys[surface];
    const liffId = String(config && config[key] || '').trim();
    const supabaseUrl = String(config && config.supabaseUrl || '').trim();
    const functionUrl = String(config && config.supabaseFunctionUrl || '').trim();
    const publishableKey = String(config && config.supabasePublishableKey || '').trim();

    if (!SUPABASE_URL_PATTERN.test(supabaseUrl) || supabaseUrl.includes('REPLACE_')) {
      throw clientError('CONFIG_ERROR', '尚未設定 Supabase Project URL。');
    }
    if (!SUPABASE_FUNCTION_PATTERN.test(functionUrl) || functionUrl.includes('REPLACE_')) {
      throw clientError('CONFIG_ERROR', '尚未設定 Supabase Edge Function URL。');
    }
    if (!publishableKey || publishableKey.includes('REPLACE_')) {
      throw clientError('CONFIG_ERROR', '尚未設定 Supabase Publishable Key。');
    }
    if (config.realtimeEnabled !== false && (!window.supabase || typeof window.supabase.createClient !== 'function')) {
      throw clientError('CONFIG_ERROR', 'Supabase Realtime SDK 載入失敗。');
    }
    if (!key || !liffId || liffId.includes('REPLACE_WITH_')) {
      const label = surface === 'admin' ? 'Admin' : surface === 'points' ? 'Points' : surface === 'event' ? 'Event' : surface === 'calendar' ? 'Calendar' : surface === 'booking' ? 'Booking' : 'Member';
      throw clientError('CONFIG_ERROR', `尚未設定 ${label} LIFF ID。`);
    }
    const ids = Object.values(keys).map((name) => String(config && config[name] || '').trim()).filter(Boolean);
    if (new Set(ids).size !== ids.length) throw clientError('CONFIG_ERROR', '會員、集點卡、活動票券、日曆、預約與管理端必須使用不同的 LIFF ID。');
  }

  async function signIn(config, surface) {
    validateConfig(config, surface);
    if (!window.liff) throw clientError('LIFF_SDK_ERROR', 'LIFF SDK 載入失敗，請確認網路後重試。');
    const liffId = surface === 'admin' ? config.adminLiffId : surface === 'points' ? config.pointsLiffId : surface === 'event' ? config.eventLiffId : surface === 'calendar' ? config.calendarLiffId : surface === 'booking' ? config.bookingLiffId : config.memberLiffId;

    try {
      await withTimeout(window.liff.init({ liffId }), 8000, 'LINE 初始化逾時，請重新開啟此頁面。');
    } catch (_) {
      throw clientError('LIFF_INIT_ERROR', 'LIFF 初始化失敗，請檢查 LIFF ID 與 Endpoint URL。');
    }

    const inLiffClient = typeof window.liff.isInClient === 'function' && window.liff.isInClient();
    if (inLiffClient) {
      if (!window.liff.isLoggedIn()) throw clientError('AUTH_REQUIRED', 'LINE LIFF 尚未完成登入，請重新開啟此 LIFF。');
    } else {
      const returned = consumeFreshLoginQuery(surface);
      if (!returned) {
        if (window.liff.isLoggedIn()) {
          try { window.liff.logout(); }
          catch (_) { throw clientError('AUTH_LOGOUT_FAILED', '無法清除先前的 LINE 登入，請重新開啟管理端。'); }
          if (window.liff.isLoggedIn()) throw clientError('AUTH_LOGOUT_FAILED', '先前的 LINE 登入尚未清除，請重新開啟管理端。');
        }
        redirectToFreshLogin(surface);
        await withTimeout(new Promise(() => {}), 8000, '登入跳轉未完成，請重新開啟此頁面。');
      }
      if (!window.liff.isLoggedIn()) {
        throw clientError('AUTH_REQUIRED', 'LINE 登入尚未完成，請重新整理後再登入。');
      }
    }

    const idToken = window.liff.getIDToken() || '';
    if (!idToken) throw clientError('AUTH_REQUIRED', '無法取得 LINE ID token，請確認 LIFF 已啟用 openid scope。');
    return idToken;
  }

  function redirectToFreshLogin(surface) {
    const redirectUrl = new URL(window.location.href);
    // Correlate this tab's redirect only; this is not an authentication token.
    let nonce;
    try {
      const bytes = new Uint8Array(16);
      window.crypto.getRandomValues(bytes);
      nonce = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
      window.sessionStorage.setItem(`${FRESH_LOGIN_QUERY}:${surface}`, JSON.stringify({
        nonce, createdAt: Date.now(), pathname: redirectUrl.pathname,
      }));
    } catch (_) {
      throw clientError('AUTH_STORAGE_UNAVAILABLE', '無法建立本次 LINE 登入流程，請允許此網站使用瀏覽器工作階段儲存後重試。');
    }
    redirectUrl.searchParams.set(FRESH_LOGIN_QUERY, `${surface}.${nonce}`);
    window.liff.login({ redirectUri: redirectUrl.toString() });
  }

  function consumeFreshLoginQuery(surface) {
    const current = new URL(window.location.href);
    const marker = current.searchParams.get(FRESH_LOGIN_QUERY);
    if (marker !== null) {
      current.searchParams.delete(FRESH_LOGIN_QUERY);
      window.history.replaceState({}, document.title, current.pathname + current.search + current.hash);
    }
    let pending;
    try {
      const key = `${FRESH_LOGIN_QUERY}:${surface}`;
      const raw = window.sessionStorage.getItem(key);
      // Consume before accepting, so reloading or replaying the URL requires login.
      window.sessionStorage.removeItem(key);
      pending = raw ? JSON.parse(raw) : null;
    } catch (_) { return false; }
    const age = Date.now() - Number(pending && pending.createdAt);
    return Boolean(pending && /^[a-f0-9]{32}$/.test(pending.nonce)
      && marker === `${surface}.${pending.nonce}` && pending.pathname === current.pathname
      && Number.isFinite(age) && age >= 0 && age <= FRESH_LOGIN_MAX_AGE_MS);
  }

  function request(config, clientType, idToken, action, payload = {}) {
    const isWrite = WRITE_ACTIONS.includes(action);
    if (isWrite) {
      pendingReads.clear();
      return sendRequest(config, clientType, idToken, action, payload).finally(() => pendingReads.clear());
    }
    const key = JSON.stringify([config.supabaseFunctionUrl, clientType, idToken, action, payload]);
    if (pendingReads.has(key)) return pendingReads.get(key);
    const pending = sendRequest(config, clientType, idToken, action, payload).finally(() => {
      if (pendingReads.get(key) === pending) pendingReads.delete(key);
    });
    pendingReads.set(key, pending);
    return pending;
  }

  async function sendRequest(config, clientType, idToken, action, payload) {
    validateConfig(config, clientType);
    const isWrite = WRITE_ACTIONS.includes(action);
    const timeoutMs = isWrite ? WRITE_TIMEOUT_MS : isFullBootstrap(clientType, action, payload) ? BOOTSTRAP_TIMEOUT_MS : READ_TIMEOUT_MS;
    const attempts = isWrite ? 1 : 2;
    const deadline = Date.now() + timeoutMs;
    let lastError;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const remaining = isWrite ? WRITE_TIMEOUT_MS : Math.max(1, deadline - Date.now());
      if (!isWrite && remaining <= 1 && attempt > 0) break;
      try {
        const fetched = await fetchWithTimeout(config.supabaseFunctionUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': String(config.supabasePublishableKey)
          },
          cache: 'no-store',
          body: JSON.stringify({ ...payload, action, clientType, idToken })
        }, remaining, (response) => response.text());

        let data;
        try { data = JSON.parse(fetched.body); }
        catch {
          throw clientError(isWrite ? 'API_RESPONSE_UNCERTAIN' : 'API_RESPONSE_ERROR',
            isWrite ? '無法確認這次操作的回應；資料可能已更新，請先重新整理確認，請勿重複送出。' : '資料服務暫時未正常回應。');
        }

        if (!data || data.ok !== true) {
          const error = clientError(data && data.error && data.error.code || 'API_ERROR', data && data.error && data.error.message || '資料服務拒絕此請求。');
          error.status = Number(data && data.status || fetched.response.status || 0);
          error.details = data && data.error && data.error.details || null;
          throw error;
        }
        return data.data || {};
      } catch (error) {
        if (error && error.code && !['REQUEST_TIMEOUT', 'NETWORK_ERROR', 'API_RESPONSE_ERROR'].includes(error.code)) throw error;
        const timedOut = Boolean(error && error.code === 'REQUEST_TIMEOUT');
        lastError = clientError(
          isWrite ? 'API_RESPONSE_UNCERTAIN' : timedOut ? 'SERVICE_TIMEOUT' : 'NETWORK_ERROR',
          isWrite
            ? '無法確認這次操作是否已送達；資料可能已更新，請先重新整理確認，請勿重複送出。'
            : timedOut ? '資料服務回應時間較長，已停止等待；請重新整理後再試。' : '目前無法連線資料服務，請檢查網路後重試。'
        );
      }
      const retryDelay = READ_RETRY_DELAY_MS * (attempt + 1);
      if (attempt < attempts - 1 && (isWrite || Date.now() + retryDelay < deadline)) await wait(retryDelay);
      else break;
    }
    throw lastError || clientError('API_RESPONSE_ERROR', '資料服務暫時未正常回應。');
  }

  function isFullBootstrap(clientType, action, payload) {
    if (action === 'admin.bootstrap') return clientType === 'admin' && !Boolean(payload && payload.lazy);
    return ({ member: 'user.member.bootstrap', points: 'user.pointcard.bootstrap', event: 'user.event.bootstrap', calendar: 'user.calendar.bootstrap' })[clientType] === action;
  }

  function realtimeClientFor(config) {
    if (config.realtimeEnabled === false) return null;
    const key = String(config.supabaseUrl) + '|' + String(config.supabasePublishableKey);
    if (realtimeClient && realtimeClientKey === key) return realtimeClient;
    if (!window.supabase || typeof window.supabase.createClient !== 'function') return null;
    realtimeClient = window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
    });
    realtimeClientKey = key;
    return realtimeClient;
  }

  function subscribeRealtime(config, clientType, onUpdate) {
    validateConfig(config, clientType);
    if (config.realtimeEnabled === false || typeof onUpdate !== 'function') return () => {};
    const existing = realtimeSubscriptions.get(clientType);
    if (existing) return existing.unsubscribe;
    const client = realtimeClientFor(config);
    if (!client) return () => {};

    let disposed = false;
    let timer;
    let pending = false;
    let queued = false;
    let lastRefreshAt = -Infinity;
    let subscribedOnce = false;
    const isPaused = () => document.visibilityState === 'hidden'
      || (typeof navigator !== 'undefined' && navigator.onLine === false);

    // Realtime, reconnect and page-resume signals share one refresh queue.
    // Preserve one trailing refresh when data changes during an active request.
    const schedule = (delayMs = 650) => {
      if (disposed) return;
      queued = true;
      if (pending || timer !== undefined || isPaused()) return;
      const waitMs = Math.max(delayMs, 1500 - (Date.now() - lastRefreshAt));
      timer = window.setTimeout(runRefresh, waitMs);
    };
    const runRefresh = () => {
      timer = undefined;
      if (disposed || isPaused() || pending) return;
      queued = false;
      pending = true;
      lastRefreshAt = Date.now();
      Promise.resolve().then(() => {
        if (!disposed) return onUpdate();
      }).catch(() => {}).finally(() => {
        pending = false;
        if (queued && !disposed) schedule(0);
      });
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') schedule(0);
    };
    const onPageShow = () => schedule(0);
    const onOnline = () => schedule(0);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('online', onOnline);

    const channel = client
      .channel(`member-system-${clientType}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'realtime_events' }, (payload) => {
        const row = payload && payload.new && typeof payload.new === 'object' ? payload.new : {};
        const scope = String(row.scope || '');
        if (scope === 'all' || scope === clientType) schedule();
      })
      .subscribe((status) => {
        if (status !== 'SUBSCRIBED') return;
        if (subscribedOnce) schedule(0);
        else subscribedOnce = true;
      });

    const unsubscribe = () => {
      if (disposed) return;
      disposed = true;
      if (timer !== undefined) window.clearTimeout(timer);
      queued = false;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('online', onOnline);
      realtimeSubscriptions.delete(clientType);
      try { Promise.resolve(client.removeChannel(channel)).catch(() => {}); } catch (_) {}
    };
    realtimeSubscriptions.set(clientType, { unsubscribe });
    return unsubscribe;
  }

  async function fetchWithTimeout(url, options, timeoutMs, readBody) {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const schedule = typeof window.setTimeout === 'function' ? window.setTimeout.bind(window) : typeof setTimeout === 'function' ? setTimeout : null;
    const cancel = typeof window.clearTimeout === 'function' ? window.clearTimeout.bind(window) : typeof clearTimeout === 'function' ? clearTimeout : null;
    let timer;
    const requestOptions = controller ? { ...options, signal: controller.signal } : options;
    if (!schedule) throw clientError('NETWORK_ERROR', '瀏覽器不支援計時器。');
    try {
      return await Promise.race([
        (async () => {
          const response = await fetch(url, requestOptions);
          return { response, body: typeof readBody === 'function' ? await readBody(response) : undefined };
        })(),
        new Promise((_, reject) => {
          timer = schedule(() => {
            if (controller) controller.abort();
            reject(clientError('REQUEST_TIMEOUT', '資料服務回應逾時。'));
          }, timeoutMs);
        })
      ]);
    } catch (error) {
      if (error && error.code) throw error;
      throw clientError('NETWORK_ERROR', '目前無法連線資料服務。');
    } finally {
      if (timer !== undefined) window.clearTimeout(timer);
    }
  }

  function withTimeout(promise, timeoutMs, message) {
    const schedule = typeof window.setTimeout === 'function' ? window.setTimeout.bind(window) : typeof setTimeout === 'function' ? setTimeout : null;
    const cancel = typeof window.clearTimeout === 'function' ? window.clearTimeout.bind(window) : typeof clearTimeout === 'function' ? clearTimeout : null;
    if (!schedule) return promise;
    let timer;
    return Promise.race([
      promise,
      new Promise((_, reject) => { timer = schedule(() => reject(clientError('REQUEST_TIMEOUT', message || '等待逾時。')), timeoutMs); })
    ]).finally(() => { if (timer !== undefined && cancel) cancel(timer); });
  }

  function wait(ms) {
    const schedule = typeof window.setTimeout === 'function' ? window.setTimeout.bind(window) : typeof setTimeout === 'function' ? setTimeout : null;
    return schedule ? new Promise((resolve) => schedule(resolve, ms)) : Promise.resolve();
  }

  function bindDialogKeyboard() {
    // 保留既有呼叫介面；焦點管理統一由共用 dialog-accessibility.js 初始化。
  }

  function logout() {
    try { if (window.liff && window.liff.isLoggedIn()) window.liff.logout(); }
    finally { window.location.reload(); }
  }

  function openMemberJoin(config) {
    const memberLiffId = String(config && config.memberLiffId || '').trim();
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(memberLiffId)) return false;
    const url = `https://liff.line.me/${encodeURIComponent(memberLiffId)}`;
    if (window.liff && typeof window.liff.openWindow === 'function') {
      window.liff.openWindow({ url, external: false });
      return true;
    }
    window.location.assign(url);
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

  function loadBookingAdminPanelExtension() {
    if (document.querySelector('script[data-booking-admin-panel-extension]')) return;
    const script = document.createElement('script');
    script.src = './booking-panel.js?v=booking-workbench-20260910';
    script.dataset.bookingAdminPanelExtension = 'true';
    document.head.appendChild(script);
  }

  try {
    if (window.indexedDB && typeof window.indexedDB.deleteDatabase === 'function') {
      window.indexedDB.deleteDatabase('MembershipSystemSyncCache');
    }
  } catch (_) {}

  window.MemberSystem = Object.freeze({
    bindDialogKeyboard, clientError, loadConfig, validateConfig, signIn, request,
    subscribeRealtime, logout, openMemberJoin, formatDate, formatDateTime, initials
  });
})();
