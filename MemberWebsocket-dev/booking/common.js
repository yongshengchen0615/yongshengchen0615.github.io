(() => {
  'use strict';

  const REQUEST_TIMEOUT_MS = 15000;

  function clientError(code, message, details = null) {
    const error = new Error(message);
    error.code = code;
    error.details = details;
    return error;
  }

  async function loadConfig() {
    const depth = window.location.pathname.includes('/booking/admin/') ? '../../config.json' : '../config.json';
    const response = await fetch(`${depth}?v=booking-20260910`, { cache: 'no-store' });
    if (!response.ok) throw clientError('CONFIG_LOAD_FAILED', '無法載入系統設定。');
    const config = await response.json();
    if (!config.supabaseUrl || !config.supabasePublishableKey) throw clientError('CONFIG_INVALID', 'Supabase 設定不完整。');
    return config;
  }

  async function signIn(config, clientType) {
    const isAdmin = clientType === 'admin';
    const liffId = isAdmin ? config.adminLiffId : config.memberLiffId;
    if (!liffId) throw clientError('LIFF_CONFIG_MISSING', isAdmin ? '尚未設定管理端 LIFF ID。' : '尚未設定會員 LIFF ID。');
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
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const endpoint = `${String(config.supabaseUrl).replace(/\/$/, '')}/functions/v1/booking-api`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': String(config.supabasePublishableKey),
        },
        cache: 'no-store',
        signal: controller.signal,
        body: JSON.stringify({ ...payload, action, clientType, idToken }),
      });
      let data;
      try { data = await response.json(); }
      catch { throw clientError('API_INVALID_RESPONSE', '預約服務回傳格式不正確。'); }
      if (!response.ok || !data || data.ok !== true) {
        const apiError = data && data.error || {};
        throw clientError(String(apiError.code || 'API_ERROR'), String(apiError.message || '預約服務暫時無法完成操作。'), apiError.details || null);
      }
      return data.data || {};
    } catch (error) {
      if (error && error.name === 'AbortError') throw clientError('API_TIMEOUT', '預約服務回應逾時，請稍後再試。');
      throw error;
    } finally {
      window.clearTimeout(timer);
    }
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

  window.BookingSystem = { loadConfig, signIn, request, logout, formatDate, addDays, clientError };
})();
