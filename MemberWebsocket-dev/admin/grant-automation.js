(() => {
  'use strict';

  if (!window.MemberSystem || typeof window.MemberSystem.request !== 'function') return;

  const base = window.MemberSystem;
  const originalRequest = base.request.bind(base);
  const calendarCache = new Map();
  let lastCalendarItemId = null;

  function cacheCalendarResult(result) {
    if (!result || typeof result !== 'object') return result;
    const rows = Array.isArray(result.calendarItems) ? result.calendarItems : [];
    rows.forEach((item) => {
      if (item && item.calendarItemId) calendarCache.set(String(item.calendarItemId), item);
    });
    if (result.calendarItem && result.calendarItem.calendarItemId) {
      calendarCache.set(String(result.calendarItem.calendarItemId), result.calendarItem);
    }
    return result;
  }

  function clientError(code, message, status = 0, details = null) {
    const error = new Error(message);
    error.code = code;
    error.status = status;
    error.details = details;
    return error;
  }

  async function automationRequest(config, idToken, action, payload) {
    const url = String(config && config.supabaseGrantAutomationUrl || '').trim();
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/functions\/v1\/grant-automation$/i.test(url)) {
      throw clientError('CONFIG_ERROR', '尚未設定發放自動化 Edge Function URL。');
    }
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = window.setTimeout(() => { if (controller) controller.abort(); }, 30000);
    let response;
    let text;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': String(config.supabasePublishableKey || '') },
        cache: 'no-store',
        signal: controller ? controller.signal : undefined,
        body: JSON.stringify({ ...payload, action, clientType: 'admin', idToken })
      });
      text = await response.text();
    } catch (_) {
      throw clientError('API_RESPONSE_UNCERTAIN', '無法確認這次操作是否已送達；請先重新整理確認，請勿重複送出。');
    } finally {
      window.clearTimeout(timer);
    }
    let data;
    try { data = JSON.parse(text); }
    catch { throw clientError('API_RESPONSE_UNCERTAIN', '資料服務回應格式異常；請先重新整理確認，請勿重複送出。'); }
    if (!data || data.ok !== true) {
      throw clientError(data && data.error && data.error.code || 'API_ERROR', data && data.error && data.error.message || '資料服務拒絕此請求。', Number(data && data.status || response.status || 0), data && data.error && data.error.details || null);
    }
    return cacheCalendarResult(data.data || {});
  }

  function selectedNotificationMode() {
    const selected = document.querySelector('input[name="grantNotificationMode"]:checked');
    return selected ? String(selected.value) : 'immediate';
  }

  function scheduledAtIso() {
    const input = document.getElementById('grantNotificationScheduledAt');
    const value = String(input && input.value || '').trim();
    if (!value) return '';
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return value;
    return `${value}:00+08:00`;
  }

  function decorateGrantPayload(payload) {
    return {
      ...payload,
      notificationMode: selectedNotificationMode(),
      scheduledAt: selectedNotificationMode() === 'scheduled' ? scheduledAtIso() : ''
    };
  }

  function decorateCalendarPayload(payload) {
    const item = payload && payload.calendarItem && typeof payload.calendarItem === 'object' ? payload.calendarItem : {};
    const enabled = Boolean(document.getElementById('calendarBonusPointsEnabled')?.checked) && String(item.itemType || '') === 'event';
    const amount = enabled ? Number(document.getElementById('calendarBonusPoints')?.value || 0) : 0;
    return {
      ...payload,
      calendarItem: { ...item, bonusPointsEnabled: enabled, bonusPoints: amount }
    };
  }

  function request(config, clientType, idToken, action, payload = {}) {
    if (clientType === 'admin' && action === 'admin.member-grants.add') {
      return automationRequest(config, idToken, action, decorateGrantPayload(payload));
    }
    if (clientType === 'admin' && action === 'admin.calendar-items.save') {
      return automationRequest(config, idToken, action, decorateCalendarPayload(payload));
    }
    return Promise.resolve(originalRequest(config, clientType, idToken, action, payload)).then(cacheCalendarResult);
  }

  window.MemberSystem = Object.freeze({ ...base, request });

  function createGrantNotificationControls() {
    const form = document.getElementById('grantForm');
    const selector = form && form.querySelector('.grant-message-selector');
    if (!form || !selector || document.getElementById('grantNotificationControls')) return;
    const fieldset = document.createElement('fieldset');
    fieldset.id = 'grantNotificationControls';
    fieldset.className = 'grant-option';
    fieldset.innerHTML = `
      <legend>LINE 訊息傳送</legend>
      <div class="grant-option-fields">
        <div class="form-grid">
          <label class="grant-toggle"><input type="radio" name="grantNotificationMode" value="immediate" checked>立即傳送</label>
          <label class="grant-toggle"><input type="radio" name="grantNotificationMode" value="scheduled">預約傳送</label>
          <label class="grant-toggle"><input type="radio" name="grantNotificationMode" value="none">不傳送</label>
        </div>
        <label id="grantNotificationScheduledField" class="hidden">預約傳送時間（台灣時間）
          <input id="grantNotificationScheduledAt" type="datetime-local" step="60">
          <small class="field-help">點數與服務時間會立即入帳，只有 LINE 訊息延後傳送。</small>
        </label>
        <p id="grantNotificationHint" class="editor-hint">目前設定：發放完成後立即傳送 LINE 訊息。</p>
      </div>`;
    selector.insertAdjacentElement('afterend', fieldset);
    fieldset.addEventListener('change', updateGrantNotificationControls);
    form.addEventListener('reset', () => window.setTimeout(() => {
      const immediate = form.querySelector('input[name="grantNotificationMode"][value="immediate"]');
      if (immediate) immediate.checked = true;
      const scheduled = document.getElementById('grantNotificationScheduledAt');
      if (scheduled) scheduled.value = '';
      updateGrantNotificationControls();
    }, 0));
    updateGrantNotificationControls();
  }

  function updateGrantNotificationControls() {
    const mode = selectedNotificationMode();
    const field = document.getElementById('grantNotificationScheduledField');
    const input = document.getElementById('grantNotificationScheduledAt');
    const hint = document.getElementById('grantNotificationHint');
    if (field) field.classList.toggle('hidden', mode !== 'scheduled');
    if (input) {
      input.disabled = mode !== 'scheduled';
      input.required = mode === 'scheduled';
    }
    if (hint) {
      hint.textContent = mode === 'scheduled'
        ? '點數與服務時間立即入帳；LINE 訊息會在指定時間傳送。'
        : mode === 'none'
          ? '點數與服務時間照常入帳，本次不傳送 LINE 訊息。'
          : '發放完成後立即傳送 LINE 訊息。';
    }
  }

  function createCalendarBonusControls() {
    const form = document.getElementById('calendarItemForm');
    const linkFields = document.getElementById('calendarItemEventLinkFields');
    if (!form || !linkFields || document.getElementById('calendarBonusPointsControls')) return;
    const section = document.createElement('section');
    section.id = 'calendarBonusPointsControls';
    section.className = 'calendar-event-link-fields';
    section.innerHTML = `
      <div><p class="kicker">Event bonus</p><h4>活動加贈點數</h4><p>活動生效期間，管理員發放集點時會自動把加贈點數加入每張本次發放的集點卡，並在會員訊息中說明。</p></div>
      <label class="grant-toggle"><input id="calendarBonusPointsEnabled" type="checkbox">此活動啟用加贈點數</label>
      <label id="calendarBonusPointsField" class="hidden">每張本次發放集點卡額外增加
        <input id="calendarBonusPoints" type="number" min="1" max="100" step="1" value="1">
        <small class="field-help">可設定 1–100 點；多個同日有效活動會累加。</small>
      </label>`;
    linkFields.insertAdjacentElement('afterend', section);
    document.getElementById('calendarBonusPointsEnabled')?.addEventListener('change', updateCalendarBonusControls);
    document.getElementById('calendarItemType')?.addEventListener('change', () => {
      if (String(document.getElementById('calendarItemType')?.value || '') !== 'event') {
        const enabled = document.getElementById('calendarBonusPointsEnabled');
        if (enabled) enabled.checked = false;
      }
      updateCalendarBonusControls();
    });
    form.addEventListener('reset', () => window.setTimeout(() => syncCalendarBonusFromSelection(true), 0));
    updateCalendarBonusControls();
  }

  function updateCalendarBonusControls() {
    const isEvent = String(document.getElementById('calendarItemType')?.value || '') === 'event';
    const enabled = document.getElementById('calendarBonusPointsEnabled');
    const field = document.getElementById('calendarBonusPointsField');
    const input = document.getElementById('calendarBonusPoints');
    if (enabled) enabled.disabled = !isEvent;
    const active = isEvent && Boolean(enabled && enabled.checked);
    if (field) field.classList.toggle('hidden', !active);
    if (input) {
      input.disabled = !active;
      input.required = active;
    }
  }

  function syncCalendarBonusFromSelection(force = false) {
    const id = String(document.getElementById('calendarItemId')?.value || '').trim();
    if (!force && id === lastCalendarItemId) return;
    lastCalendarItemId = id;
    const item = id ? calendarCache.get(id) : null;
    const enabled = document.getElementById('calendarBonusPointsEnabled');
    const points = document.getElementById('calendarBonusPoints');
    if (enabled) enabled.checked = Boolean(item && item.itemType === 'event' && item.bonusPointsEnabled);
    if (points) points.value = String(item && Number(item.bonusPoints) > 0 ? Number(item.bonusPoints) : 1);
    updateCalendarBonusControls();
  }

  function bindCalendarSelectionSync() {
    document.addEventListener('click', () => window.setTimeout(() => syncCalendarBonusFromSelection(false), 0));
    document.getElementById('calendarItemForm')?.addEventListener('focusin', () => syncCalendarBonusFromSelection(false));
    document.getElementById('newCalendarItemButton')?.addEventListener('click', () => window.setTimeout(() => syncCalendarBonusFromSelection(true), 0));
  }

  window.addEventListener('DOMContentLoaded', () => {
    createGrantNotificationControls();
    createCalendarBonusControls();
    bindCalendarSelectionSync();
    window.setTimeout(() => syncCalendarBonusFromSelection(true), 0);
  });
})();
