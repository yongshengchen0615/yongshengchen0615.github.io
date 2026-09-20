(() => {
  'use strict';

  const REQUEST_TIMEOUT_MS = 15000;
  const MIN_RESYNC_INTERVAL_MS = 1500;
  let realtimeClient = null;
  let realtimeChannel = null;
  let publicNoticeClient = null;
  let publicNoticeSequence = 0;
  let presenceContext = null;
  let presenceHooksBound = false;

  function clientError(code, message, details = null) {
    const error = new Error(message);
    error.code = code;
    error.details = details;
    return error;
  }

  async function loadConfig() {
    const depth = window.location.pathname.includes('/booking/admin/') ? '../../config.json' : '../config.json';
    const response = await fetch(`${depth}?v=booking-20260910-3`, { cache: 'no-store' });
    if (!response.ok) throw clientError('CONFIG_LOAD_FAILED', '無法載入系統設定。');
    const config = await response.json();
    if (!config.supabaseUrl || !config.supabasePublishableKey) throw clientError('CONFIG_INVALID', 'Supabase 設定不完整。');
    return config;
  }

  async function signIn(config, clientType) {
    const isAdmin = clientType === 'admin';
    const isBooking = clientType === 'booking';
    const liffId = isAdmin ? config.adminLiffId : isBooking ? config.bookingLiffId : config.memberLiffId;
    const label = isAdmin ? '管理端' : isBooking ? '預約' : '會員';
    if (!liffId) throw clientError('LIFF_CONFIG_MISSING', `尚未設定${label} LIFF ID。`);
    if (!window.liff) throw clientError('LIFF_SDK_MISSING', 'LINE LIFF SDK 尚未載入。');
    await window.liff.init({ liffId });
    if (!window.liff.isLoggedIn()) {
      window.liff.login({ redirectUri: window.location.href });
      return new Promise(() => {});
    }
    const idToken = window.liff.getIDToken();
    if (!idToken) throw clientError('LIFF_ID_TOKEN_MISSING', '無法取得 LINE 登入憑證，請重新登入。');
    if (!isAdmin) await startPresence(config, clientType, idToken);
    return idToken;
  }

  function createPresenceSessionId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    if (!window.crypto || typeof window.crypto.getRandomValues !== 'function') {
      throw clientError('PRESENCE_ID_UNAVAILABLE', '瀏覽器無法建立上下線紀錄識別。');
    }
    const bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  function currentPresenceIdToken(context) {
    try {
      if (context && context.idToken && window.liff && window.liff.isLoggedIn() && typeof window.liff.getIDToken === 'function') {
        return window.liff.getIDToken() || context.idToken;
      }
    } catch (_) {}
    return String(context && context.idToken || '');
  }

  function bindPresenceLifecycle() {
    if (presenceHooksBound) return;
    presenceHooksBound = true;
    window.addEventListener('pagehide', (event) => {
      void stopPresence(event && event.persisted ? 'bfcache' : 'pagehide');
    });
    window.addEventListener('pageshow', (event) => {
      if (!event || !event.persisted || !presenceContext || !presenceContext.closed) return;
      const previous = presenceContext;
      presenceContext = null;
      void startPresence(previous.config, 'booking', currentPresenceIdToken(previous), 'resume');
    });
  }

  function presenceBody(context, event, reason) {
    const payload = {
      sessionId: context.sessionId,
      reason,
      action: 'user.booking.presence.' + event,
      clientType: 'booking',
      idToken: currentPresenceIdToken(context)
    };
    return window.TestModeClient && typeof window.TestModeClient.payload === 'function'
      ? window.TestModeClient.payload(payload)
      : payload;
  }

  function sendPresence(context, event, reason) {
    const endpoint = String(context.config.supabaseFunctionUrl || '').trim();
    if (!endpoint) return Promise.resolve(null);
    return fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': String(context.config.supabasePublishableKey)
      },
      cache: 'no-store',
      keepalive: true,
      body: JSON.stringify(presenceBody(context, event, reason))
    }).catch(() => null);
  }

  async function startPresence(config, clientType, idToken, reason = 'signin') {
    if (clientType !== 'booking') return;
    if (presenceContext && !presenceContext.closed) {
      if (presenceContext.onlineRecorded) return;
      const response = await sendPresence(presenceContext, 'online', reason);
      presenceContext.onlineRecorded = Boolean(response && response.ok);
      return;
    }
    const context = {
      config,
      idToken: String(idToken || ''),
      sessionId: createPresenceSessionId(),
      onlineRecorded: false,
      closed: false
    };
    presenceContext = context;
    bindPresenceLifecycle();
    const response = await sendPresence(context, 'online', reason);
    context.onlineRecorded = Boolean(response && response.ok);
  }

  async function stopPresence(reason = 'pagehide') {
    const context = presenceContext;
    if (!context || context.closed) return;
    context.closed = true;
    await sendPresence(context, 'offline', reason);
  }

  function bookingNoticeElement() {
    const card = document.querySelector('.booking-card[aria-labelledby="bookingTitle"]');
    if (!card) return null;
    return [...card.children].find((node) => (
      node.classList?.contains('service-info')
      && node.getAttribute('role') === 'note'
    )) || null;
  }

  function renderBookingNotice(value) {
    const notice = bookingNoticeElement();
    if (!notice) return;
    const text = String(value ?? '').replace(/\r\n?/g, '\n');
    const visible = text.trim().length > 0;
    notice.classList.toggle('hidden', !visible);
    if (!visible) {
      notice.replaceChildren();
      return;
    }
    const label = document.createElement('strong');
    label.textContent = '預約說明：';
    const body = document.createElement('span');
    body.textContent = text;
    body.style.whiteSpace = 'pre-line';
    body.style.overflowWrap = 'anywhere';
    notice.replaceChildren(label, document.createTextNode(' '), body);
  }

  async function syncPublicBookingNotice(config, preferredValue) {
    const sequence = ++publicNoticeSequence;
    if (typeof preferredValue === 'string') {
      renderBookingNotice(preferredValue);
      return;
    }
    try {
      if (!window.supabase?.createClient) return;
      if (!publicNoticeClient) {
        publicNoticeClient = window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey, {
          auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
        });
      }
      const { data, error } = await publicNoticeClient.rpc('get_booking_public_notice');
      if (error) throw error;
      if (sequence !== publicNoticeSequence) return;
      renderBookingNotice(typeof data === 'string' ? data : '');
    } catch (error) {
      console.warn('booking notice load failed', error);
    }
  }

  async function request(config, clientType, idToken, action, payload = {}) {
    const endpoint = `${String(config.supabaseUrl).replace(/\/$/, '')}/functions/v1/booking-api`;
    const body = window.TestModeClient && typeof window.TestModeClient.payload === 'function'
      ? window.TestModeClient.payload({ ...payload, action, clientType, idToken })
      : { ...payload, action, clientType, idToken };
    const data = await postJson(endpoint, config, body, '預約服務');
    if (clientType === 'member' && action === 'user.booking.bootstrap') {
      const notice = data?.settings && Object.prototype.hasOwnProperty.call(data.settings, 'bookingNotice')
        ? data.settings.bookingNotice
        : undefined;
      void syncPublicBookingNotice(config, typeof notice === 'string' ? notice : undefined);
    }
    return data;
  }

  async function memberProfile(config, idToken) {
    const endpoint = String(config.supabaseFunctionUrl || '').trim();
    if (!endpoint) throw clientError('CONFIG_INVALID', '會員資料服務設定不完整。');
    const requestBody = {
      action: 'user.member.bootstrap',
      clientType: 'member',
      idToken,
    };
    const data = await postJson(endpoint, config,
      window.TestModeClient && typeof window.TestModeClient.payload === 'function'
        ? window.TestModeClient.payload(requestBody)
        : requestBody,
      '會員資料服務');
    return data && data.profile && typeof data.profile === 'object' ? data.profile : {};
  }

  async function postJson(endpoint, config, body, serviceLabel) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': String(config.supabasePublishableKey),
        },
        cache: 'no-store',
        signal: controller.signal,
        body: JSON.stringify(body),
      });
      let data;
      try { data = await response.json(); }
      catch { throw clientError('API_INVALID_RESPONSE', `${serviceLabel}回傳格式不正確。`); }
      if (!response.ok || !data || data.ok !== true) {
        const apiError = data && data.error || {};
        throw clientError(String(apiError.code || 'API_ERROR'), String(apiError.message || `${serviceLabel}暫時無法完成操作。`), apiError.details || null);
      }
      return data.data || {};
    } catch (error) {
      if (error && error.name === 'AbortError') throw clientError('API_TIMEOUT', `${serviceLabel}回應逾時，請稍後再試。`);
      throw error;
    } finally {
      window.clearTimeout(timer);
    }
  }

  function subscribeRealtime(config, onUpdate, scope = 'member') {
    if (typeof onUpdate !== 'function') return () => {};
    const targetScope = scope === 'admin' ? 'admin' : 'member';

    let disposed = false;
    let resyncPending = false;
    let resyncQueued = false;
    let lastResyncAt = 0;
    let subscribedOnce = false;
    let realtimeTimer = null;

    const clearScheduledResync = () => {
      if (realtimeTimer !== null) window.clearTimeout(realtimeTimer);
      realtimeTimer = null;
    };

    const schedule = (delayMs = 450) => {
      if (disposed) return;
      resyncQueued = true;
      if (document.visibilityState === 'hidden' || !navigator.onLine) return;
      if (realtimeTimer !== null) return;
      realtimeTimer = window.setTimeout(() => {
        realtimeTimer = null;
        runResync();
      }, Math.max(0, delayMs));
    };

    const runResync = () => {
      if (disposed) return;
      if (document.visibilityState === 'hidden' || !navigator.onLine) {
        resyncQueued = true;
        return;
      }
      if (resyncPending) {
        resyncQueued = true;
        return;
      }

      const now = Date.now();
      const waitMs = MIN_RESYNC_INTERVAL_MS - (now - lastResyncAt);
      if (waitMs > 0) {
        schedule(waitMs);
        return;
      }

      resyncQueued = false;
      lastResyncAt = now;
      resyncPending = true;
      Promise.resolve().then(() => onUpdate()).catch(() => {}).finally(() => {
        resyncPending = false;
        if (resyncQueued) schedule(0);
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

    if (config.realtimeEnabled !== false && window.supabase && typeof window.supabase.createClient === 'function') {
      if (!realtimeClient) {
        realtimeClient = window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey, {
          auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
        });
      }

      if (!realtimeChannel) {
        realtimeChannel = realtimeClient
          .channel(`booking-${targetScope}-sync`)
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'realtime_events' }, (payload) => {
            const row = payload && payload.new && typeof payload.new === 'object' ? payload.new : {};
            const scope = String(row.scope || '');
            if (scope === 'all' || scope === targetScope) schedule();
          })
          .subscribe((status) => {
            if (status !== 'SUBSCRIBED') return;
            if (subscribedOnce) schedule(0);
            else subscribedOnce = true;
          });
      }
    }

    return () => {
      if (disposed) return;
      disposed = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('online', onOnline);
      clearScheduledResync();
      const channel = realtimeChannel;
      realtimeChannel = null;
      try { if (channel && realtimeClient) Promise.resolve(realtimeClient.removeChannel(channel)).catch(() => {}); } catch (_) {}
    };
  }

  function openMemberJoin(config) {
    const memberLiffId = String(config && config.memberLiffId || '').trim();
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(memberLiffId)) return false;
    const url = `https://liff.line.me/${encodeURIComponent(memberLiffId)}`;
    if (window.liff && typeof window.liff.openWindow === 'function') {
      window.liff.openWindow({ url, external: false });
      return true;
    }
    window.location.href = url;
    return true;
  }

  async function logout() {
    try {
      await Promise.race([
        stopPresence('logout'),
        new Promise((resolve) => window.setTimeout(resolve, 1200))
      ]);
      if (window.TestModeClient && typeof window.TestModeClient.clearSession === 'function') window.TestModeClient.clearSession();
      if (window.liff && window.liff.isLoggedIn()) window.liff.logout();
    } catch (_) {}
    window.location.reload();
  }

  function showNotice(message, options = {}) {
    const modal = document.getElementById('bookingNoticeModal');
    const title = document.getElementById('bookingNoticeTitle');
    const text = document.getElementById('bookingNoticeMessage');
    const confirmButton = document.getElementById('confirmBookingNoticeButton');
    if (!modal || !title || !text || !confirmButton) {
      window.alert(String(message || ''));
      return false;
    }

    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    title.textContent = String(options.title || '提醒');
    text.textContent = String(message || '');
    modal.classList.remove('hidden');
    confirmButton.onclick = () => {
      modal.classList.add('hidden');
      confirmButton.onclick = null;
      if (returnFocus && document.contains(returnFocus)) returnFocus.focus();
    };
    confirmButton.focus();
    return true;
  }

  function formatDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
    return match ? `${Number(match[1])}/${Number(match[2])}/${Number(match[3])}` : String(value || '—');
  }

  function addDays(date, days) {
    const parsed = new Date(`${date}T00:00:00Z`);
    parsed.setUTCDate(parsed.getUTCDate() + Number(days || 0));
    return parsed.toISOString().slice(0, 10);
  }

  window.BookingSystem = { loadConfig, signIn, startPresence, request, memberProfile, subscribeRealtime, openMemberJoin, logout, showNotice, formatDate, addDays, clientError };
})();
