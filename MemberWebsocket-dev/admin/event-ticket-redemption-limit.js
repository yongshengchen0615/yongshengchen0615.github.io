(() => {
  'use strict';

  const state = { config: null, idToken: '', updatedAt: '', saving: false, loading: null };

  function endpoint() {
    return `${String(state.config && state.config.supabaseUrl || '').replace(/\/$/, '')}/functions/v1/event-ticket-extension-api`;
  }

  function normalizeLimit(value) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 1 && parsed <= 50 ? parsed : 1;
  }

  async function request(operation, payload = {}) {
    if (!state.config || !state.idToken) throw new Error('尚未取得管理端登入資訊。');
    const response = await fetch(endpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: String(state.config.supabasePublishableKey || '') },
      cache: 'no-store',
      body: JSON.stringify({ ...payload, operation, idToken: state.idToken })
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result || result.ok !== true) {
      const error = new Error(result && result.error && result.error.message || '活動票券設定暫時無法完成。');
      error.code = result && result.error && result.error.code || 'API_ERROR';
      throw error;
    }
    return result.data || {};
  }

  function ensurePanel() {
    let panel = document.getElementById('eventTicketGlobalUsageSettings');
    if (panel) return panel;
    const eventsPanel = document.getElementById('eventsPanel');
    const workspace = eventsPanel && eventsPanel.querySelector('.card-workspace');
    if (!eventsPanel || !workspace) return null;

    panel = document.createElement('section');
    panel.id = 'eventTicketGlobalUsageSettings';
    panel.className = 'tier-settings event-ticket-global-settings';
    panel.setAttribute('aria-labelledby', 'eventTicketGlobalUsageSettingsTitle');
    panel.innerHTML = '<div><p class="kicker">Ticket usage policy</p><h3 id="eventTicketGlobalUsageSettingsTitle">活動票券使用設定</h3><p>設定每位會員一天內最多可以使用幾張活動票券。每日用量依 Asia/Taipei 日期計算，實際可使用張數仍會受活動期間、會員等級與持有票券數限制。</p></div><div class="tier-settings-grid"><label>每日最多使用活動票券數<input id="eventMaxTicketsPerDay" type="number" min="1" max="50" step="1" inputmode="numeric" value="1" required aria-describedby="eventMaxTicketsPerDayHint"><small id="eventMaxTicketsPerDayHint">範圍 1–50 張；此每日上限套用活動優惠券、活動抽獎券與好友邀請券。</small></label></div><div id="eventTicketSettingMessage" class="form-message hidden" role="status"></div><div class="tier-settings-actions"><button id="saveEventTicketSettingButton" class="button button-dark" type="button">儲存活動票券使用設定</button></div>';
    eventsPanel.insertBefore(panel, workspace);

    const input = panel.querySelector('#eventMaxTicketsPerDay');
    input.addEventListener('change', () => { input.value = String(normalizeLimit(input.value)); });
    panel.querySelector('#saveEventTicketSettingButton').addEventListener('click', saveSetting);
    return panel;
  }

  function showMessage(message, error = false) {
    const box = document.getElementById('eventTicketSettingMessage');
    if (!box) return;
    box.textContent = message;
    box.classList.toggle('hidden', !message);
    box.classList.toggle('is-error', Boolean(error));
  }

  async function saveSetting() {
    if (state.saving) return;
    const input = document.getElementById('eventMaxTicketsPerDay');
    const button = document.getElementById('saveEventTicketSettingButton');
    if (!input || !button) return;
    const maxTicketsPerDay = normalizeLimit(input.value);
    input.value = String(maxTicketsPerDay);
    state.saving = true;
    button.disabled = true;
    button.textContent = '儲存中…';
    showMessage('');
    try {
      const result = await request('admin.settings.save', {
        maxTicketsPerDay,
        expectedUpdatedAt: state.updatedAt || ''
      });
      state.updatedAt = String(result.updatedAt || '');
      input.value = String(normalizeLimit(result.maxTicketsPerDay));
      showMessage(`已儲存：會員每日最多可使用 ${input.value} 張活動票券。`);
    } catch (error) {
      showMessage(error && error.message || '儲存失敗，請重新整理後再試。', true);
    } finally {
      state.saving = false;
      button.disabled = false;
      button.textContent = '儲存活動票券使用設定';
    }
  }

  async function waitForLogin() {
    if (!window.MemberAdminSession || typeof window.MemberAdminSession.wait !== 'function') {
      throw new Error('管理端登入服務尚未準備完成。');
    }
    const session = await window.MemberAdminSession.wait();
    state.config = session.config;
    state.idToken = session.idToken;
  }

  async function loadSetting() {
    if (state.loading) return state.loading;
    state.loading = (async () => {
      const result = await request('admin.settings.get');
      state.updatedAt = String(result.updatedAt || '');
      const input = document.getElementById('eventMaxTicketsPerDay');
      if (input) input.value = String(normalizeLimit(result.maxTicketsPerDay));
    })();
    try { await state.loading; } finally { state.loading = null; }
  }

  async function boot() {
    ensurePanel();
    try {
      await waitForLogin();
      await loadSetting();
      window.addEventListener('member-admin-data-refreshed', () => {
        if (!state.saving) loadSetting().catch((error) => showMessage(error && error.message || '無法同步活動票券使用設定。', true));
      });
    } catch (error) {
      showMessage(error && error.message || '無法載入活動票券使用設定。', true);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
