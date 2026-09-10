(() => {
  'use strict';

  if (!window.MemberSystem || typeof window.MemberSystem.request !== 'function') return;

  const base = window.MemberSystem;
  const originalRequest = base.request.bind(base);
  const activityLinks = new Map();
  const activityLinkNames = new Map();
  let linksKnown = false;
  let lastConfig = null;
  let lastIdToken = '';
  let lastSyncedEventTicketId = null;
  let fieldsDirty = false;

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

  function safeActivityLinkName(value) {
    const raw = String(value || '').trim();
    if (raw.length > 120 || /[\u0000-\u001F\u007F]/.test(raw)) return null;
    return raw;
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
      if (!id) return;
      ticket.activityUrl = String(activityLinks.get(id) || '');
      ticket.activityLinkName = String(activityLinkNames.get(id) || '');
    });
    if (result.eventTicket && result.eventTicket.eventTicketId) {
      const id = String(result.eventTicket.eventTicketId);
      result.eventTicket.activityUrl = String(activityLinks.get(id) || result.eventTicket.activityUrl || '');
      result.eventTicket.activityLinkName = String(activityLinkNames.get(id) || result.eventTicket.activityLinkName || '');
    }
    return result;
  }

  function scheduleSelectionSync(force = false) {
    const run = () => syncFieldsFromSelection(force);
    window.setTimeout(run, 0);
    window.setTimeout(run, 80);
  }

  async function refreshLinks(config, idToken) {
    const result = await linkRequest(config, idToken, 'admin.event-ticket-links.list');
    activityLinks.clear();
    activityLinkNames.clear();
    Object.entries(result.activityLinks && typeof result.activityLinks === 'object' ? result.activityLinks : {}).forEach(([id, url]) => {
      activityLinks.set(String(id), String(url || ''));
    });
    Object.entries(result.activityLinkNames && typeof result.activityLinkNames === 'object' ? result.activityLinkNames : {}).forEach(([id, name]) => {
      activityLinkNames.set(String(id), String(name || ''));
    });
    linksKnown = true;
    scheduleSelectionSync(false);
  }

  async function enrichAdminResult(config, idToken, promise) {
    const result = await promise;
    try {
      await refreshLinks(config, idToken);
      return mergeLinks(result);
    } catch (_) {
      linksKnown = false;
      scheduleSelectionSync(false);
      return result;
    }
  }

  function preserveSavedTicketIdentity(result) {
    const ticket = result && result.eventTicket;
    if (!ticket || !ticket.eventTicketId) return;
    const idField = document.getElementById('eventTicketId');
    const expectedField = document.getElementById('eventTicketExpectedUpdatedAt');
    if (idField) idField.value = String(ticket.eventTicketId);
    if (expectedField && ticket.updatedAt) expectedField.value = String(ticket.updatedAt);
    lastSyncedEventTicketId = String(ticket.eventTicketId);
  }

  async function saveTicketAndActivityLink(config, clientType, idToken, action, payload) {
    const urlInput = document.getElementById('eventTicketActivityUrl');
    const nameInput = document.getElementById('eventTicketActivityLinkName');
    const requestedUrl = safeActivityUrl(urlInput && urlInput.value);
    const requestedName = safeActivityLinkName(nameInput && nameInput.value);
    const result = await originalRequest(config, clientType, idToken, action, payload);
    const eventTicketId = String(result && result.eventTicket && result.eventTicket.eventTicketId || '').trim();

    if (!eventTicketId || !urlInput || !nameInput || urlInput.disabled || nameInput.disabled || requestedUrl === null || requestedName === null) {
      return mergeLinks(result);
    }

    const normalizedName = requestedUrl ? requestedName : '';
    const expectedActivityUrl = String(activityLinks.get(eventTicketId) || '');
    const expectedActivityLinkName = String(activityLinkNames.get(eventTicketId) || '');
    try {
      const saved = await linkRequest(config, idToken, 'admin.event-ticket-links.save', {
        eventTicketId,
        activityUrl: requestedUrl,
        activityLinkName: normalizedName,
        expectedActivityUrl,
        expectedActivityLinkName
      });
      activityLinks.set(eventTicketId, String(saved.activityUrl || ''));
      activityLinkNames.set(eventTicketId, String(saved.activityLinkName || ''));
      linksKnown = true;
      fieldsDirty = false;
      lastSyncedEventTicketId = eventTicketId;
      if (result.eventTicket) {
        result.eventTicket.activityUrl = String(saved.activityUrl || '');
        result.eventTicket.activityLinkName = String(saved.activityLinkName || '');
      }
      setFieldStatus(saved.changed ? '活動連結與連結名稱已儲存。' : '活動連結未變更。', false);
      scheduleSelectionSync(true);
      return result;
    } catch (error) {
      preserveSavedTicketIdentity(result);
      fieldsDirty = true;
      const reason = String(error && error.message || '請再儲存一次。');
      setFieldStatus(`活動票券主資料已儲存，但活動連結未完成：${reason}`, true);
      throw clientError(
        error && error.code || 'ACTIVITY_LINK_SAVE_FAILED',
        `活動票券主資料已儲存，但活動連結未完成。${reason}`,
        Number(error && error.status || 0)
      );
    }
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

  function createActivityLinkFields() {
    const form = document.getElementById('eventTicketForm');
    const description = document.getElementById('eventTicketDescription');
    if (!form || !description || document.getElementById('eventTicketActivityUrl')) return;

    const nameLabel = document.createElement('label');
    nameLabel.id = 'eventTicketActivityLinkNameField';
    nameLabel.append(document.createTextNode('連結名稱（選填）'));
    const nameInput = document.createElement('input');
    nameInput.id = 'eventTicketActivityLinkName';
    nameInput.type = 'text';
    nameInput.autocomplete = 'off';
    nameInput.maxLength = 120;
    nameInput.placeholder = '例如：查看活動詳情';
    nameLabel.append(nameInput);

    const urlLabel = document.createElement('label');
    urlLabel.id = 'eventTicketActivityUrlField';
    urlLabel.append(document.createTextNode('活動連結（選填）'));
    const urlInput = document.createElement('input');
    urlInput.id = 'eventTicketActivityUrl';
    urlInput.type = 'url';
    urlInput.inputMode = 'url';
    urlInput.autocomplete = 'url';
    urlInput.maxLength = 2048;
    urlInput.placeholder = 'https://example.com/event';
    urlInput.setAttribute('aria-describedby', 'eventTicketActivityUrlStatus');
    const status = document.createElement('small');
    status.id = 'eventTicketActivityUrlStatus';
    status.className = 'field-help';
    status.textContent = '會員可從活動票券詳情開啟；僅接受 https:// 網址。未填連結名稱時顯示「前往活動連結」。';
    urlLabel.append(urlInput, status);

    const descriptionLabel = description.closest('label');
    descriptionLabel?.insertAdjacentElement('afterend', urlLabel);
    descriptionLabel?.insertAdjacentElement('afterend', nameLabel);

    const markDirty = () => { fieldsDirty = true; };
    nameInput.addEventListener('input', markDirty);
    urlInput.addEventListener('input', markDirty);

    form.addEventListener('submit', (event) => {
      const normalizedUrl = safeActivityUrl(urlInput.value);
      const normalizedName = safeActivityLinkName(nameInput.value);
      let message = '';
      if (normalizedUrl === null) message = '請輸入有效的 https:// 活動連結。';
      else if (normalizedName === null) message = '連結名稱最多 120 個字，且不可包含控制字元。';
      else if (!normalizedUrl && normalizedName) message = '請先輸入活動連結，或清空連結名稱。';
      if (!message) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setFieldStatus(message, true);
      (normalizedUrl === null || (!normalizedUrl && normalizedName) ? urlInput : nameInput).focus();
    }, true);

    form.addEventListener('reset', () => {
      fieldsDirty = false;
      lastSyncedEventTicketId = null;
      scheduleSelectionSync(true);
    });
  }

  function syncFieldsFromSelection(force = false) {
    const urlInput = document.getElementById('eventTicketActivityUrl');
    const nameInput = document.getElementById('eventTicketActivityLinkName');
    if (!urlInput || !nameInput) return;

    const eventTicketId = String(document.getElementById('eventTicketId')?.value || '').trim();
    const selectionChanged = eventTicketId !== lastSyncedEventTicketId;

    // Never overwrite an in-progress draft just because the user clicked elsewhere.
    if (!selectionChanged && !force) return;
    if (!selectionChanged && fieldsDirty) return;

    lastSyncedEventTicketId = eventTicketId;
    fieldsDirty = false;

    if (!eventTicketId) {
      urlInput.disabled = false;
      nameInput.disabled = false;
      urlInput.value = '';
      nameInput.value = '';
      setFieldStatus('會員可從活動票券詳情開啟；僅接受 https:// 網址。未填連結名稱時顯示「前往活動連結」。');
      return;
    }

    if (!linksKnown) {
      urlInput.disabled = true;
      nameInput.disabled = true;
      setFieldStatus('暫時無法讀取既有活動連結；為避免覆蓋資料，已停用此欄位。', true);
      return;
    }

    urlInput.disabled = false;
    nameInput.disabled = false;
    urlInput.value = String(activityLinks.get(eventTicketId) || '');
    nameInput.value = String(activityLinkNames.get(eventTicketId) || '');
    setFieldStatus(urlInput.value ? '已設定活動連結；修改後請儲存票券。' : '尚未設定活動連結。');
  }

  function bindSelectionSync() {
    document.addEventListener('click', (event) => {
      const target = event.target instanceof Element ? event.target.closest('[data-event-ticket-id]') : null;
      if (!target) return;
      fieldsDirty = false;
      lastSyncedEventTicketId = null;
      scheduleSelectionSync(true);
    });
    document.getElementById('newEventTicketButton')?.addEventListener('click', () => {
      fieldsDirty = false;
      lastSyncedEventTicketId = null;
      scheduleSelectionSync(true);
    });
  }

  window.addEventListener('DOMContentLoaded', () => {
    createActivityLinkFields();
    bindSelectionSync();
    if (lastConfig && lastIdToken && !linksKnown) {
      refreshLinks(lastConfig, lastIdToken).catch(() => {
        linksKnown = false;
        scheduleSelectionSync(false);
      });
    } else {
      scheduleSelectionSync(true);
    }
  });
})();
