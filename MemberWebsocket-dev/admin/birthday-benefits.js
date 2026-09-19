(() => {
  'use strict';

  const TIER_OPTIONS = [
    ['general', '一般會員'],
    ['silver', '銀級會員'],
    ['gold', '金級會員'],
    ['platinum', '白金會員'],
  ];
  let config = null;
  let busy = false;

  function ready(callback) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', callback, { once: true });
    else callback();
  }

  ready(() => {
    const panel = document.getElementById('eventsPanel');
    if (!panel || document.getElementById('birthdayBenefitSettings')) return;
    const section = document.createElement('section');
    section.id = 'birthdayBenefitSettings';
    section.className = 'birthday-benefit-settings';
    section.setAttribute('aria-labelledby', 'birthdayBenefitTitle');
    section.innerHTML = `
      <div class="birthday-benefit-heading">
        <div>
          <p class="kicker">Birthday automation</p>
          <h3 id="birthdayBenefitTitle">壽星優惠自動發放</h3>
          <p>依會員生日月份自動建立當月活動票券；同一會員每年最多發放一次。</p>
        </div>
        <div class="birthday-benefit-summary" id="birthdayBenefitSummary">讀取設定中…</div>
      </div>
      <form id="birthdayBenefitForm" novalidate>
        <div class="birthday-benefit-toggle-row">
          <label class="birthday-benefit-toggle"><input id="birthdayBenefitEnabled" type="checkbox"><span>啟用壽星優惠</span></label>
          <label class="birthday-benefit-toggle"><input id="birthdayBenefitNotifyLine" type="checkbox"><span>發放後傳送 LINE 通知</span></label>
        </div>
        <div class="birthday-benefit-grid">
          <label>票券名稱<input id="birthdayBenefitTitleTemplate" maxlength="100" required placeholder="🎂 {month}月壽星專屬優惠"><small>可使用 {month} 代表生日月份</small></label>
          <label>識別色<input id="birthdayBenefitAccent" type="color" value="#df6b4d"></label>
          <label class="wide">優惠說明<textarea id="birthdayBenefitDescription" maxlength="240" rows="3" required></textarea></label>
          <label>使用方式<input id="birthdayBenefitUsageMethod" maxlength="120" required></label>
          <label>使用說明<textarea id="birthdayBenefitUsageInstructions" maxlength="500" rows="3" required></textarea></label>
        </div>
        <fieldset class="birthday-benefit-tiers"><legend>適用會員等級</legend><div id="birthdayBenefitTierOptions"></div></fieldset>
        <div id="birthdayBenefitMessage" class="form-message hidden" role="alert"></div>
        <div class="birthday-benefit-actions">
          <button id="birthdayBenefitRunButton" class="button button-outline" type="button">立即檢查本月壽星</button>
          <button id="birthdayBenefitSaveButton" class="button button-dark" type="submit">儲存壽星優惠設定</button>
        </div>
      </form>`;

    const heading = panel.querySelector('.panel-heading');
    if (heading && heading.nextSibling) panel.insertBefore(section, heading.nextSibling);
    else panel.prepend(section);

    const tierOptions = document.getElementById('birthdayBenefitTierOptions');
    TIER_OPTIONS.forEach(([value, labelText]) => {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'checkbox'; input.value = value; input.dataset.birthdayTier = 'true';
      label.append(input, document.createTextNode(labelText));
      tierOptions.append(label);
    });

    document.getElementById('birthdayBenefitForm').addEventListener('submit', saveSettings);
    document.getElementById('birthdayBenefitRunButton').addEventListener('click', runNow);
    loadSettings();
  });

  async function adminSession() {
    if (!window.MemberAdminSession || typeof window.MemberAdminSession.wait !== 'function') throw new Error('管理端登入服務尚未準備完成。');
    return window.MemberAdminSession.wait();
  }

  async function loadConfig() {
    if (config) return config;
    config = (await adminSession()).config;
    return config;
  }

  async function request(action, payload = {}) {
    const session = await adminSession();
    const currentConfig = session.config;
    config = currentConfig;
    const idToken = String(session.idToken || '');
    if (!idToken) throw new Error('LINE 管理端登入尚未完成。');
    const endpoint = `${String(currentConfig.supabaseUrl || '').replace(/\/$/, '')}/functions/v1/birthday-benefits`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: String(currentConfig.supabasePublishableKey || '') },
      cache: 'no-store',
      body: JSON.stringify({ action, idToken, ...payload }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.ok !== true) throw new Error(String(data?.error?.message || '壽星優惠服務暫時無法完成操作。'));
    return data.data || {};
  }

  async function loadSettings() {
    setBusy(true, '讀取設定中…');
    try {
      const data = await request('admin.birthday-benefit.get');
      applySettings(data.settings || {});
      updateSummary(data.current || {});
      hideMessage();
    } catch (error) {
      showMessage(error?.message || '壽星優惠設定載入失敗。');
    } finally {
      setBusy(false);
    }
  }

  function applySettings(settings) {
    document.getElementById('birthdayBenefitEnabled').checked = Boolean(settings.enabled);
    document.getElementById('birthdayBenefitNotifyLine').checked = Boolean(settings.notifyLine);
    document.getElementById('birthdayBenefitTitleTemplate').value = String(settings.titleTemplate || '🎂 {month}月壽星專屬優惠');
    document.getElementById('birthdayBenefitDescription').value = String(settings.description || '生日快樂！這是你的當月專屬生日優惠。');
    document.getElementById('birthdayBenefitUsageMethod').value = String(settings.usageMethod || '使用時請出示本活動票券。');
    document.getElementById('birthdayBenefitUsageInstructions').value = String(settings.usageInstructions || '限本人於生日當月使用一次，逾期失效。');
    document.getElementById('birthdayBenefitAccent').value = /^#[0-9a-f]{6}$/i.test(String(settings.accent || '')) ? settings.accent : '#df6b4d';
    const allowed = Array.isArray(settings.allowedTierKeys) ? settings.allowedTierKeys : TIER_OPTIONS.map(([key]) => key);
    document.querySelectorAll('[data-birthday-tier]').forEach((input) => { input.checked = allowed.includes(input.value); });
  }

  function collectSettings() {
    return {
      enabled: document.getElementById('birthdayBenefitEnabled').checked,
      notifyLine: document.getElementById('birthdayBenefitNotifyLine').checked,
      titleTemplate: String(document.getElementById('birthdayBenefitTitleTemplate').value || '').trim(),
      description: String(document.getElementById('birthdayBenefitDescription').value || '').trim(),
      usageMethod: String(document.getElementById('birthdayBenefitUsageMethod').value || '').trim(),
      usageInstructions: String(document.getElementById('birthdayBenefitUsageInstructions').value || '').trim(),
      accent: String(document.getElementById('birthdayBenefitAccent').value || '').trim(),
      allowedTierKeys: Array.from(document.querySelectorAll('[data-birthday-tier]:checked')).map((input) => input.value),
    };
  }

  function validate(settings) {
    if (!settings.titleTemplate || settings.titleTemplate.length > 100) return '請填寫票券名稱（最多 100 字）。';
    if (!settings.description || settings.description.length > 240) return '請填寫優惠說明（最多 240 字）。';
    if (!settings.usageMethod || settings.usageMethod.length > 120) return '請填寫使用方式（最多 120 字）。';
    if (!settings.usageInstructions || settings.usageInstructions.length > 500) return '請填寫使用說明（最多 500 字）。';
    if (!settings.allowedTierKeys.length) return '請至少選擇一個適用會員等級。';
    return '';
  }

  async function saveSettings(event) {
    event.preventDefault();
    if (busy) return;
    const settings = collectSettings();
    const error = validate(settings);
    if (error) return showMessage(error);
    setBusy(true, '儲存中…'); hideMessage();
    try {
      const data = await request('admin.birthday-benefit.save', { settings });
      applySettings(data.settings || settings);
      updateSummary(data.current || {});
      showMessage('壽星優惠設定已儲存。', true);
    } catch (requestError) {
      showMessage(requestError?.message || '壽星優惠設定儲存失敗。');
    } finally {
      setBusy(false);
    }
  }

  async function runNow() {
    if (busy) return;
    setBusy(true, '檢查中…'); hideMessage();
    try {
      const data = await request('admin.birthday-benefit.run');
      updateSummary(data.current || {});
      const run = data.run || {};
      if (run.enabled === false) showMessage('目前壽星優惠尚未啟用，因此沒有發放票券。');
      else showMessage(`本次完成：新增 ${Number(run.issued || 0)} 張壽星票券，排入 ${Number(run.queued || 0)} 則 LINE 通知。`, true);
    } catch (error) {
      showMessage(error?.message || '本月壽星檢查失敗。');
    } finally {
      setBusy(false);
    }
  }

  function updateSummary(current) {
    const summary = document.getElementById('birthdayBenefitSummary');
    if (!summary) return;
    const year = Number(current.year || 0), month = Number(current.month || 0), count = Number(current.issuedCount || 0);
    summary.textContent = year && month ? `${year} 年 ${month} 月已發放 ${count} 張` : '尚無本月統計';
  }

  function setBusy(value, label) {
    busy = value;
    const save = document.getElementById('birthdayBenefitSaveButton');
    const run = document.getElementById('birthdayBenefitRunButton');
    if (save) { save.disabled = value; save.textContent = value && label === '儲存中…' ? '儲存中…' : '儲存壽星優惠設定'; }
    if (run) { run.disabled = value; run.textContent = value && label === '檢查中…' ? '檢查中…' : '立即檢查本月壽星'; }
    document.getElementById('birthdayBenefitSettings')?.setAttribute('aria-busy', String(value));
  }

  function showMessage(message, success = false) {
    const element = document.getElementById('birthdayBenefitMessage');
    if (!element) return;
    element.textContent = String(message || '');
    element.classList.remove('hidden');
    element.classList.toggle('success', success);
  }

  function hideMessage() {
    const element = document.getElementById('birthdayBenefitMessage');
    if (!element) return;
    element.textContent = '';
    element.classList.add('hidden');
    element.classList.remove('success');
  }
})();
