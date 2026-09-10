(() => {
  'use strict';

  const REQUEST_TIMEOUT_MS = 15000;
  const MIN_RESYNC_INTERVAL_MS = 1500;
  let realtimeClient = null;
  let realtimeChannel = null;
  let realtimeTimer = null;

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
    return idToken;
  }

  async function request(config, clientType, idToken, action, payload = {}) {
    const endpoint = `${String(config.supabaseUrl).replace(/\/$/, '')}/functions/v1/booking-api`;
    return postJson(endpoint, config, { ...payload, action, clientType, idToken }, '預約服務');
  }

  async function memberProfile(config, idToken) {
    const endpoint = String(config.supabaseFunctionUrl || '').trim();
    if (!endpoint) throw clientError('CONFIG_INVALID', '會員資料服務設定不完整。');
    const data = await postJson(endpoint, config, {
      action: 'user.member.bootstrap',
      clientType: 'member',
      idToken,
    }, '會員資料服務');
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

  function subscribeRealtime(config, onUpdate) {
    if (typeof onUpdate !== 'function') return () => {};

    let disposed = false;
    let resyncPending = false;
    let lastResyncAt = 0;
    let subscribedOnce = false;

    const runResync = () => {
      if (disposed || document.visibilityState === 'hidden' || !navigator.onLine) return;
      const now = Date.now();
      if (resyncPending || now - lastResyncAt < MIN_RESYNC_INTERVAL_MS) return;
      lastResyncAt = now;
      resyncPending = true;
      Promise.resolve(onUpdate()).catch(() => {}).finally(() => { resyncPending = false; });
    };

    const schedule = () => {
      if (disposed || realtimeTimer !== null) return;
      realtimeTimer = window.setTimeout(() => {
        realtimeTimer = null;
        runResync();
      }, 450);
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') runResync();
    };
    const onPageShow = () => runResync();
    const onOnline = () => runResync();

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
          .channel('booking-member-sync')
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'realtime_events' }, (payload) => {
            const row = payload && payload.new && typeof payload.new === 'object' ? payload.new : {};
            const scope = String(row.scope || '');
            if (scope === 'all' || scope === 'member') schedule();
          })
          .subscribe((status) => {
            if (status !== 'SUBSCRIBED') return;
            if (subscribedOnce) runResync();
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
      if (realtimeTimer !== null) window.clearTimeout(realtimeTimer);
      realtimeTimer = null;
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
    try { if (window.liff && window.liff.isLoggedIn()) window.liff.logout(); } catch (_) {}
    window.location.reload();
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

  window.BookingSystem = { loadConfig, signIn, request, memberProfile, subscribeRealtime, openMemberJoin, logout, formatDate, addDays, clientError };
})();
