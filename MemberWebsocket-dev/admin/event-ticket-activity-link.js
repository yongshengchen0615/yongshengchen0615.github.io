(() => {
  'use strict';

  if (!window.MemberSystem || typeof window.MemberSystem.request !== 'function') return;

  const base = window.MemberSystem;
  const originalRequest = base.request.bind(base);
  const activityLinks = new Map();
  let linksKnown = false;
  let lastConfig = null;
  let lastIdToken = '';

  function safeActivityUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (raw.length > 2048 || /\s/.test(raw)) return null;
    try {
      const url = new URL(raw);
      if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return null;
      return url.toString();
    } catch (_) {
      return null;
    }
  }

  function endpoint(config) {
    const baseUrl = String(config && config.supabaseUrl || '').trim();
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(baseUrl)) throw clientError('CONFIG_ERROR', 'Supabase URL 設定不正確。');
    return `${baseUrl}/functions/v1/event-ticket-links`;
  }

  function clientError(code, message, status = 0) {
    const error = new Error(message);
    error.code = code;
    error.status = status;
    return error;
  }

  async function linkRequest(config, idToken, action, payload = {}) {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = window.setTimeout(() => controller?.abort(), 30000);
    let response;
    let text;
    try {
      response = await fetch(endpoint(config), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': String(config && config.supabasePublishableKey || '')
        },
        cache: 'no-store',
        signal: controller ? controller.signal : undefined,
        body: JSON.stringify({ ...payload, action, clientType: 'admin', idToken })
      });
      text = await response.text();
    } catch (_) {
      throw clientError('ACTIVITY_LINK_UNAVAILABLE', '活動連結服務暫時無法連線。');
    } finally {
      window.clearTimeout(timer);
    }
    let data;
    try { data = JSON.parse(text); }
    catch { throw clientError('ACTIVITY_LINK_UNAVAILABLE', '活動連結服務回應格式異常。'); }
    if (!data || data.ok !== true) {
      throw clientError(
        data && data.error && data.error.code || 'ACTIVITY_LINK_ERROR',
        data && data.error && data.error.message || '活動連結服務拒絕此請求。',
        Number(data && data.status || response.status || 0)
      );
    }
    return data.data || {};
  }

  function mergeLinks(result) {
    if (!result || typeof result !== 'object') return result;
    const rows = Array.isArray(result.eventTickets) ? result.eventTickets : [];
    rows.forEach((ticket) => {
      const id = String(ticket && ticket.eventTicketId || '').trim();
      if (id) ticket.activityUrl = String(activityLinks.get(id) || '');
    });
    if (result.eventTicket && result.eventTicket.eventTicketId) {
      const id = String(result.eventTicket.eventTicketId);
      result.eventTicket.activityUrl = String(activityLinks.get(id) || result.eventTicket.activityUrl || '');
    }
    return result;
  }

  async function refreshLinks(config, idToken) {
    const result = await linkRequest(config, idToken, 'admin.event-ticket-links.list');
    activityLinks.clear();
    Object.entries(result.activityLinks && typeof result.activityLinks === 'object' ? result.activityLinks : {}).forEach(([id, url]) => {
      activityLinks.set(String(id), String(url || ''));
    });
    linksKnown = true;
    syncFieldFromSelection(true);
  }

  async function enrichAdminResult(config, idToken, promise) {
    const result = await promise;
    try {
      await refreshLinks(config, idToken);
      return mergeLinks(result);
    } catch (_) {
      linksKnown = false;
      syncFieldFromSelection(true);
      return result;
    }
  }

  async function saveTicketAndActivityLink(config, clientType, idToken, action, payload) {
    const input = document.getElementById('eventTicketActivityUrl');
    const requestedUrl = safeActivityUrl(input && input.value);
    const result = await originalRequest(config, clientType, idToken, action, payload);
    const eventTicketId = String(result && result.eventTicket && result.eventTicket.eventTicketId || '').trim();
    if (!eventTicketId || !input || input.disabled || requestedUrl === null) return mergeLinks(result);

    const expectedActivityUrl = String(activityLinks.get(eventTicketId) || '');
    try {
      const saved = await linkRequest(config, idToken, 'admin.event-ticket-links.save', {
        eventTicketId,
        activityUrl: requestedUrl,
        expectedActivityUrl
      });
      activityLinks.set(eventTicketId, String(saved.activityUrl || ''));
      linksKnown = true;
      if (result.eventTicket) result.eventTicket.activityUrl = String(saved.activityUrl || '');
      setFieldStatus(saved.changed ? '活動連結已儲存。' : '活動連結未變更。', false);
    } catch (error) {
      setFieldStatus(`活動票券已儲存，但活動連結未更新：${String(error && error.message || '請重新整理後再試')}`, true);
    }
    window.setTimeout(() => syncFieldFromSelection(true), 0);
    return result;
  }

  function request(config, clientType, idToken, action, payload = {}) {
    if (clientType === 'admin') {
      lastConfig = config;
      lastIdToken = idToken;
    }
    if (clientType === 'admin' && action === 'admin.bootstrap') {
      return enrichAdminResult(config, idToken, originalRequest(config, clientType, idToken, action, payload));
    }
    if (clientType === 'admin' && action === 'admin.event-tickets.list') {
      return enrichAdminResult(config, idToken, originalRequest(config, clientType, idToken, action, payload));
    }
    if (clientType === 'admin' && action === 'admin.event-tickets.save') {
      return saveTicketAndActivityLink(config, clientType, idToken, action, payload);
    }
    return originalRequest(config, clientType, idToken, action, payload);
  }

  window.MemberSystem = Object.freeze({ ...base, request });

  function setFieldStatus(message, error = false) {
    const status = document.getElementById('eventTicketActivityUrlStatus');
    if (!status) return;
    status.textContent = String(message || '');
    status.classList.toggle('warning', Boolean(error));
  }

  function createActivityUrlField() {
    const form = document.getElementById('eventTicketForm');
    const description = document.getElementById('eventTicketDescription');
    if (!form || !description || document.getElementById('eventTicketActivityUrl')) return;

    const label = document.createElement('label');
    label.id = 'eventTicketActivityUrlField';
    label.append(document.createTextNode('活動連結（選填）'));
    const input = document.createElement('input');
    input.id = 'eventTicketActivityUrl';
    input.type = 'url';
    input.inputMode = 'url';
    input.autocomplete = 'url';
    input.maxLength = 2048;
    input.placeholder = 'https://example.com/event';
    input.setAttribute('aria-describedby', 'eventTicketActivityUrlStatus');
    const status = document.createElement('small');
    status.id = 'eventTicketActivityUrlStatus';
    status.className = 'field-help';
    status.textContent = '會員可從活動票券詳情開啟；僅接受 https:// 網址。';
    label.append(input, status);
    description.closest('label')?.insertAdjacentElement('afterend', label);

    form.addEventListener('submit', (event) => {
      const normalized = safeActivityUrl(input.value);
      if (normalized !== null) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setFieldStatus('請輸入有效的 https:// 活動連結。', true);
      input.focus();
    }, true);
    form.addEventListener('reset', () => window.setTimeout(() => syncFieldFromSelection(true), 0));
  }

  function syncFieldFromSelection(force = false) {
    const input = document.getElementById('eventTicketActivityUrl');
    if (!input) return;
    const eventTicketId = String(document.getElementById('eventTicketId')?.value || '').trim();
    if (!eventTicketId) {
      input.disabled = false;
      input.value = '';
      setFieldStatus('會員可從活動票券詳情開啟；僅接受 https:// 網址。');
      return;
    }
    if (!linksKnown) {
      input.disabled = true;
      if (force) setFieldStatus('暫時無法讀取既有活動連結；為避免覆蓋資料，已停用此欄位。', true);
      return;
    }
    input.disabled = false;
    input.value = String(activityLinks.get(eventTicketId) || '');
    setFieldStatus(input.value ? '已設定活動連結；儲存票券時會一併更新。' : '尚未設定活動連結。');
  }

  function bindSelectionSync() {
    document.addEventListener('click', () => window.setTimeout(() => syncFieldFromSelection(false), 0));
    document.getElementById('eventTicketForm')?.addEventListener('focusin', () => syncFieldFromSelection(false));
    document.getElementById('newEventTicketButton')?.addEventListener('click', () => window.setTimeout(() => syncFieldFromSelection(true), 0));
  }

  window.addEventListener('DOMContentLoaded', () => {
    createActivityUrlField();
    bindSelectionSync();
    if (lastConfig && lastIdToken && !linksKnown) {
      refreshLinks(lastConfig, lastIdToken).catch(() => {
        linksKnown = false;
        syncFieldFromSelection(true);
      });
    } else {
      syncFieldFromSelection(true);
    }
  });
})();
