(() => {
  'use strict';

  const state = { config: null, idToken: '', updatedAt: '', saving: false };

  function extensionUrl() {
    const base = String(state.config && state.config.supabaseUrl || '').replace(/\/$/, '');
    return `${base}/functions/v1/pointcard-extension-api`;
  }

  function normalizeLimit(value) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 1 && parsed <= 50 ? parsed : 1;
  }

  async function extensionRequest(operation, payload = {}) {
    if (!state.config || !state.idToken) throw new Error('尚未取得管理端登入資訊。');
    const response = await fetch(extensionUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: String(state.config.supabasePublishableKey || '') },
      cache: 'no-store',
      body: JSON.stringify({ ...payload, operation, idToken: state.idToken })
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result || result.ok !== true) {
      const error = new Error(result && result.error && result.error.message || '集點卡設定暫時無法完成。');
      error.code = result && result.error && result.error.code || 'API_ERROR';
      throw error;
    }
    return result.data || {};
  }

  function ensurePanel() {
    let panel = document.getElementById('pointCardGlobalTicketSettings');
    if (panel) return panel;
    const settingsPanel = document.getElementById('cardSettingsPanel');
    const workspace = settingsPanel && settingsPanel.querySelector('.card-workspace');
    if (!settingsPanel || !workspace) return null;

    panel = document.createElement('section');
    panel.id = 'pointCardGlobalTicketSettings';
    panel.className = 'tier-settings point-card-global-settings';
    panel.setAttribute('aria-labelledby', 'pointCardGlobalTicketSettingsTitle');
    panel.innerHTML = '<div><p class="kicker">Ticket usage policy</p><h3 id="pointCardGlobalTicketSettingsTitle">集點卡票券使用設定</h3><p>此設定套用所有集點卡票券。會員一次可跨不同集點卡選擇票券，但總張數不可超過這裡設定的上限。</p></div><div class="tier-settings-grid"><label>單次最多使用票券數<input id="globalMaxTicketsPerRedemption" type="number" min="1" max="50" step="1" inputmode="numeric" value="1" required aria-describedby="globalMaxTicketsPerRedemptionHint"><small id="globalMaxTicketsPerRedemptionHint">範圍 1–50 張；這是整次操作的總票券數，不是每張集點卡各自計算。</small></label></div><div id="globalTicketSettingMessage" class="form-message hidden" role="status"></div><div class="tier-settings-actions"><button id="saveGlobalTicketSettingButton" class="button button-dark" type="button">儲存票券使用設定</button></div>';
    settingsPanel.insertBefore(panel, workspace);

    const input = panel.querySelector('#globalMaxTicketsPerRedemption');
    input.addEventListener('change', () => { input.value = String(normalizeLimit(input.value)); });
    panel.querySelector('#saveGlobalTicketSettingButton').addEventListener('click', saveSetting);
    return panel;
  }

  function showMessage(message, error = false) {
    const box = document.getElementById('globalTicketSettingMessage');
    if (!box) return;
    box.textContent = message;
    box.classList.toggle('hidden', !message);
    box.classList.toggle('is-error', Boolean(error));
  }

  async function saveSetting() {
    if (state.saving) return;
    const input = document.getElementById('globalMaxTicketsPerRedemption');
    const button = document.getElementById('saveGlobalTicketSettingButton');
    if (!input || !button) return;
    const maxTicketsPerRedemption = normalizeLimit(input.value);
    input.value = String(maxTicketsPerRedemption);
    state.saving = true;
    button.disabled = true;
    button.textContent = '儲存中…';
    showMessage('');
    try {
      const result = await extensionRequest('admin.settings.save', {
        maxTicketsPerRedemption,
        expectedUpdatedAt: state.updatedAt || ''
      });
      state.updatedAt = String(result.updatedAt || '');
      input.value = String(normalizeLimit(result.maxTicketsPerRedemption));
      showMessage(`已儲存：會員單次最多可使用 ${input.value} 張集點卡票券。`);
    } catch (error) {
      showMessage(error && error.message || '儲存失敗，請重新整理後再試。', true);
    } finally {
      state.saving = false;
      button.disabled = false;
      button.textContent = '儲存票券使用設定';
    }
  }

  async function waitForLogin() {
    state.config = await window.MemberSystem.loadConfig();
    for (let i = 0; i < 80; i += 1) {
      state.idToken = window.liff && typeof window.liff.getIDToken === 'function' ? (window.liff.getIDToken() || '') : '';
      if (state.idToken) return;
      await new Promise((resolve) => window.setTimeout(resolve, 150));
    }
    throw new Error('無法取得管理端登入狀態。');
  }

  async function boot() {
    ensurePanel();
    try {
      await waitForLogin();
      const result = await extensionRequest('admin.settings.get');
      state.updatedAt = String(result.updatedAt || '');
      const input = document.getElementById('globalMaxTicketsPerRedemption');
      if (input) input.value = String(normalizeLimit(result.maxTicketsPerRedemption));
    } catch (error) {
      showMessage(error && error.message || '無法載入票券使用設定。', true);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
