(() => {
  'use strict';

  const TIER_KEYS = ['general', 'silver', 'gold', 'platinum'];
  const WEEKDAYS = { 1: '星期一', 2: '星期二', 3: '星期三', 4: '星期四', 5: '星期五', 6: '星期六', 7: '星期日' };
  let config = null;
  let templates = [];
  let selectedFixedTicketId = '';
  let selectedUpdatedAt = '';
  let busy = false;
  let renderingList = false;

  function ready(callback) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', callback, { once: true });
    else callback();
  }

  ready(() => {
    document.getElementById('birthdayBenefitSettings')?.remove();

    const form = document.getElementById('eventTicketForm');
    const type = document.getElementById('eventTicketType');
    const dateRange = document.querySelector('#eventTicketForm .date-range-control');
    if (!form || !type || !dateRange || document.getElementById('fixedTicketScheduleFields')) return;

    if (!Array.from(type.options).some((option) => option.value === 'fixed')) {
      type.append(new Option('固定票券', 'fixed'));
    }

    const section = document.createElement('section');
    section.id = 'fixedTicketScheduleFields';
    section.className = 'fixed-ticket-schedule hidden';
    section.setAttribute('aria-labelledby', 'fixedTicketScheduleTitle');
    section.innerHTML = `
      <div class="fixed-ticket-schedule-heading">
        <div>
          <p class="kicker">Automatic issue</p>
          <h4 id="fixedTicketScheduleTitle">固定發放週期</h4>
          <p>系統會直接把票券發到符合條件的會員帳戶，不需要會員自行領取。</p>
        </div>
        <label class="fixed-ticket-notify"><input id="fixedTicketNotifyLine" type="checkbox" checked> 發放後傳送 LINE 通知</label>
      </div>
      <div class="form-grid fixed-ticket-schedule-grid">
        <label>發放週期
          <select id="fixedTicketScheduleType">
            <option value="birthday_month">會員生日當月 1 號</option>
            <option value="yearly">每年</option>
            <option value="monthly">每月</option>
            <option value="weekly">每週</option>
          </select>
        </label>
        <label id="fixedTicketYearlyMonthField" class="hidden">每年月份
          <select id="fixedTicketScheduleMonth"></select>
        </label>
        <label id="fixedTicketScheduleDayField" class="hidden">發放日期
          <input id="fixedTicketScheduleDay" type="number" min="1" max="31" step="1" value="1">
        </label>
        <label id="fixedTicketWeekdayField" class="hidden">每週發放日
          <select id="fixedTicketScheduleWeekday">
            <option value="1">星期一</option><option value="2">星期二</option><option value="3">星期三</option>
            <option value="4">星期四</option><option value="5">星期五</option><option value="6">星期六</option><option value="7">星期日</option>
          </select>
        </label>
      </div>
      <p id="fixedTicketScheduleSummary" class="fixed-ticket-schedule-summary" aria-live="polite"></p>
      <div class="fixed-ticket-inline-actions">
        <button id="fixedTicketRunButton" class="button button-outline" type="button" disabled>立即檢查發放</button>
      </div>`;
    form.insertBefore(section, dateRange);

    const month = document.getElementById('fixedTicketScheduleMonth');
    for (let value = 1; value <= 12; value += 1) month.append(new Option(`${value} 月`, String(value)));
    month.value = '1';

    type.addEventListener('change', () => {
      if (type.value !== 'fixed') {
        selectedFixedTicketId = '';
        selectedUpdatedAt = '';
      }
      updateFixedUI();
    });
    document.getElementById('fixedTicketScheduleType').addEventListener('change', updateFixedScheduleUI);
    document.getElementById('fixedTicketScheduleMonth').addEventListener('change', updateFixedScheduleUI);
    document.getElementById('fixedTicketScheduleDay').addEventListener('input', updateFixedScheduleUI);
    document.getElementById('fixedTicketScheduleWeekday').addEventListener('change', updateFixedScheduleUI);
    document.getElementById('fixedTicketRunButton').addEventListener('click', runFixedNow);

    form.addEventListener('submit', (event) => {
      if (type.value !== 'fixed') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      saveFixedTicket();
    }, true);

    const deleteButton = document.getElementById('deleteEventTicketButton');
    deleteButton?.addEventListener('click', (event) => {
      if (!selectedFixedTicketId) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      deleteFixedTicket();
    }, true);

    document.getElementById('newEventTicketButton')?.addEventListener('click', () => window.setTimeout(resetFixedState, 0));
    document.getElementById('resetEventTicketButton')?.addEventListener('click', () => window.setTimeout(resetFixedState, 0));

    const list = document.getElementById('eventTicketListItems');
    list?.addEventListener('click', (event) => {
      const fixed = event.target instanceof Element ? event.target.closest('[data-fixed-ticket-id]') : null;
      if (fixed) {
        event.preventDefault();
        loadFixedTicket(String(fixed.dataset.fixedTicketId || ''));
        return;
      }
      const regular = event.target instanceof Element ? event.target.closest('[data-event-ticket-id]') : null;
      if (regular) {
        selectedFixedTicketId = '';
        selectedUpdatedAt = '';
        window.setTimeout(updateFixedUI, 0);
      }
    });

    if (list) {
      const observer = new MutationObserver(() => {
        if (!renderingList) window.queueMicrotask(renderFixedList);
      });
      observer.observe(list, { childList: true });
    }

    updateFixedUI();
    loadTemplates();
  });

  async function loadConfig() {
    if (config) return config;
    config = await window.MemberSystem.loadConfig();
    return config;
  }

  async function waitForAdminIdToken() {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const idToken = typeof window.liff?.getIDToken === 'function' ? String(window.liff.getIDToken() || '') : '';
      if (idToken) return idToken;
      await new Promise((resolve) => window.setTimeout(resolve, 100));
    }
    throw new Error('LINE 管理端登入尚未完成，請重新整理後再試。');
  }

  async function request(action, payload = {}) {
    const currentConfig = await loadConfig();
    const idToken = await waitForAdminIdToken();
    const endpoint = `${String(currentConfig.supabaseUrl || '').replace(/\/$/, '')}/functions/v1/fixed-ticket-automation`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: String(currentConfig.supabasePublishableKey || '') },
      cache: 'no-store',
      body: JSON.stringify({ action, idToken, ...payload }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.ok !== true) throw new Error(String(data?.error?.message || '固定票券服務暫時無法完成操作。'));
    return data.data || {};
  }

  async function loadTemplates() {
    try {
      const data = await request('admin.fixed-tickets.list');
      templates = Array.isArray(data.templates) ? data.templates : [];
      renderFixedList();
    } catch (error) {
      showMessage(error?.message || '固定票券設定載入失敗。');
    }
  }

  function renderFixedList() {
    const list = document.getElementById('eventTicketListItems');
    if (!list || renderingList) return;
    renderingList = true;
    try {
      list.querySelectorAll('[data-fixed-ticket-id]').forEach((node) => node.remove());
      list.querySelectorAll('[data-event-ticket-id^="FIXED-"]').forEach((node) => node.remove());

      const nodes = templates.map((template) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'card-list-item fixed-ticket-list-item';
        button.dataset.fixedTicketId = String(template.fixedTicketId || '');
        button.setAttribute('aria-selected', String(template.fixedTicketId || '') === selectedFixedTicketId ? 'true' : 'false');
        const title = document.createElement('strong');
        title.textContent = String(template.title || '未命名固定票券');
        const meta = document.createElement('small');
        meta.textContent = `固定票券 · ${scheduleLabel(template)} · ${statusLabel(template.status)}`;
        button.append(title, meta);
        return button;
      });
      for (let index = nodes.length - 1; index >= 0; index -= 1) list.prepend(nodes[index]);

      const regularCount = list.querySelectorAll('[data-event-ticket-id]:not([data-event-ticket-id^="FIXED-"])').length;
      const total = regularCount + templates.length;
      const count = document.getElementById('eventTicketResultCount');
      if (count) count.textContent = String(total);
      document.getElementById('eventTicketEmptyState')?.classList.toggle('hidden', total !== 0);
    } finally {
      window.setTimeout(() => { renderingList = false; }, 0);
    }
  }

  function statusLabel(status) {
    return status === 'active' ? '啟用中' : status === 'archived' ? '已封存' : '草稿';
  }

  function scheduleLabel(template) {
    if (template.scheduleType === 'birthday_month') return '生日當月 1 號';
    if (template.scheduleType === 'yearly') return `每年 ${Number(template.scheduleMonth || 1)}/${Number(template.scheduleDay || 1)}`;
    if (template.scheduleType === 'monthly') return `每月 ${Number(template.scheduleDay || 1)} 日`;
    return `每週${WEEKDAYS[Number(template.scheduleWeekday || 1)]?.replace('星期', '') || '一'}`;
  }

  function resetFixedState() {
    selectedFixedTicketId = '';
    selectedUpdatedAt = '';
    const type = document.getElementById('eventTicketType');
    if (type?.value === 'fixed') type.value = 'coupon';
    updateFixedUI();
    renderFixedList();
  }

  function loadFixedTicket(fixedTicketId) {
    const template = templates.find((item) => String(item.fixedTicketId || '') === fixedTicketId);
    if (!template) return;
    selectedFixedTicketId = fixedTicketId;
    selectedUpdatedAt = String(template.updatedAt || '');

    document.getElementById('eventTicketId').value = '';
    document.getElementById('eventTicketExpectedUpdatedAt').value = selectedUpdatedAt;
    document.getElementById('eventTicketTitle').value = String(template.title || '');
    document.getElementById('eventTicketType').value = 'fixed';
    document.getElementById('eventTicketStatus').value = String(template.status || 'draft');
    document.getElementById('eventTicketDescription').value = String(template.description || '');
    document.getElementById('eventTicketUsageMethod').value = String(template.usageMethod || '');
    document.getElementById('eventTicketUsageInstructions').value = String(template.usageInstructions || '');
    document.getElementById('eventTicketStartsOn').value = '';
    document.getElementById('eventTicketEndsOn').value = '';
    document.getElementById('eventTicketQuota').value = String(Number(template.quota || 0));
    document.getElementById('eventTicketAccent').value = /^#[0-9a-f]{6}$/i.test(String(template.accent || '')) ? template.accent : '#df6b4d';
    document.getElementById('eventTicketAccentValue').textContent = String(document.getElementById('eventTicketAccent').value || '#df6b4d').toUpperCase();
    document.querySelectorAll('#eventTicketAllowedTiers input[name="eventTicketAllowedTierKey"]').forEach((input) => {
      input.checked = (Array.isArray(template.allowedTierKeys) ? template.allowedTierKeys : TIER_KEYS).includes(input.value);
    });
    document.getElementById('eventTicketAllowedTiers')?.dispatchEvent(new Event('change', { bubbles: true }));

    document.getElementById('fixedTicketScheduleType').value = String(template.scheduleType || 'birthday_month');
    document.getElementById('fixedTicketScheduleMonth').value = String(Number(template.scheduleMonth || 1));
    document.getElementById('fixedTicketScheduleDay').value = String(Number(template.scheduleDay || 1));
    document.getElementById('fixedTicketScheduleWeekday').value = String(Number(template.scheduleWeekday || 1));
    document.getElementById('fixedTicketNotifyLine').checked = Boolean(template.notifyLine);

    document.getElementById('eventTicketEditorKicker').textContent = 'Edit fixed ticket';
    document.getElementById('eventTicketEditorTitle').textContent = String(template.title || '編輯固定票券');
    document.getElementById('deleteEventTicketButton').disabled = false;
    updateFixedUI();
    renderFixedList();
    hideMessage();
  }

  function updateFixedUI() {
    const fixed = document.getElementById('eventTicketType')?.value === 'fixed';
    const section = document.getElementById('fixedTicketScheduleFields');
    section?.classList.toggle('hidden', !fixed);
    document.querySelector('#eventTicketForm .date-range-control')?.classList.toggle('hidden', fixed);
    if (fixed) {
      document.getElementById('eventTicketStartsOn').value = '';
      document.getElementById('eventTicketEndsOn').value = '';
      document.getElementById('eventTicketPrizeEditor')?.classList.add('hidden');
    }

    const save = document.getElementById('saveEventTicketButton');
    if (save && !busy) save.textContent = fixed ? '儲存固定票券' : '儲存活動票券';
    const del = document.getElementById('deleteEventTicketButton');
    if (del && selectedFixedTicketId) {
      del.disabled = false;
      del.textContent = '刪除目前固定票券';
    } else if (del && !fixed) {
      del.textContent = '刪除目前票券';
    }

    const note = document.querySelector('.event-ticket-note');
    if (note) note.textContent = fixed
      ? '固定票券由系統依週期自動發放；同一會員在同一週期只會取得一張。已發出的票券保留當下內容。'
      : '已領取的會員會保留當下的票券說明；之後修改設定只影響新領取的票券。';

    document.getElementById('fixedTicketRunButton').disabled = busy || !selectedFixedTicketId;
    updateFixedScheduleUI();
  }

  function updateFixedScheduleUI() {
    const type = String(document.getElementById('fixedTicketScheduleType')?.value || 'birthday_month');
    document.getElementById('fixedTicketYearlyMonthField')?.classList.toggle('hidden', type !== 'yearly');
    document.getElementById('fixedTicketScheduleDayField')?.classList.toggle('hidden', !['yearly', 'monthly'].includes(type));
    document.getElementById('fixedTicketWeekdayField')?.classList.toggle('hidden', type !== 'weekly');

    const month = Number(document.getElementById('fixedTicketScheduleMonth')?.value || 1);
    const day = Number(document.getElementById('fixedTicketScheduleDay')?.value || 1);
    const weekday = Number(document.getElementById('fixedTicketScheduleWeekday')?.value || 1);
    const summary = document.getElementById('fixedTicketScheduleSummary');
    if (!summary) return;

    if (type === 'birthday_month') {
      summary.textContent = '每年在會員生日月份的 1 號自動發放，有效至當月底。若會員在生日月 1 號後才新加入，只要本年度尚未取得這張票券就會補發；已持有但尚未使用不會重複發。';
    } else if (type === 'yearly') {
      summary.textContent = `每年 ${month}/${day} 進入新週期並自動發放；若該月沒有 ${day} 日，會以當月最後一天計算。`;
    } else if (type === 'monthly') {
      summary.textContent = `每月 ${day} 日進入新週期並自動發放；若當月沒有 ${day} 日，會以當月最後一天計算。`;
    } else {
      summary.textContent = `每週${WEEKDAYS[weekday] || '星期一'}進入新週期並自動發放。`;
    }
  }

  function collectTemplate() {
    const scheduleType = String(document.getElementById('fixedTicketScheduleType').value || 'birthday_month');
    return {
      fixedTicketId: selectedFixedTicketId,
      title: String(document.getElementById('eventTicketTitle').value || '').trim(),
      description: String(document.getElementById('eventTicketDescription').value || '').trim(),
      usageMethod: String(document.getElementById('eventTicketUsageMethod').value || '').trim(),
      usageInstructions: String(document.getElementById('eventTicketUsageInstructions').value || '').trim(),
      status: String(document.getElementById('eventTicketStatus').value || ''),
      scheduleType,
      scheduleMonth: scheduleType === 'yearly' ? Number(document.getElementById('fixedTicketScheduleMonth').value) : null,
      scheduleDay: ['yearly', 'monthly'].includes(scheduleType) ? Number(document.getElementById('fixedTicketScheduleDay').value) : null,
      scheduleWeekday: scheduleType === 'weekly' ? Number(document.getElementById('fixedTicketScheduleWeekday').value) : null,
      quota: Number(document.getElementById('eventTicketQuota').value || 0),
      accent: String(document.getElementById('eventTicketAccent').value || '#df6b4d'),
      allowedTierKeys: Array.from(document.querySelectorAll('#eventTicketAllowedTiers input[name="eventTicketAllowedTierKey"]:checked')).map((input) => input.value),
      notifyLine: document.getElementById('fixedTicketNotifyLine').checked,
    };
  }

  function validateTemplate(template) {
    if (!template.title || template.title.length > 100) return '請填寫固定票券名稱（最多 100 字）。';
    if (!template.description || template.description.length > 240) return '請填寫票券說明（最多 240 字）。';
    if (!template.usageMethod || template.usageMethod.length > 120) return '請填寫使用方式（最多 120 字）。';
    if (!template.usageInstructions || template.usageInstructions.length > 500) return '請填寫使用說明（最多 500 字）。';
    if (!['active', 'draft', 'archived'].includes(template.status)) return '請選擇公開狀態。';
    if (!template.allowedTierKeys.length) return '請至少選擇一個適用會員等級。';
    if (!Number.isInteger(template.quota) || template.quota < 0 || template.quota > 1000000) return '總發放上限必須是 0–1,000,000 的整數。';
    if (template.scheduleType === 'yearly' && (!Number.isInteger(template.scheduleMonth) || template.scheduleMonth < 1 || template.scheduleMonth > 12)) return '請選擇每年發放月份。';
    if (['yearly', 'monthly'].includes(template.scheduleType) && (!Number.isInteger(template.scheduleDay) || template.scheduleDay < 1 || template.scheduleDay > 31)) return '發放日期必須是 1–31。';
    if (template.scheduleType === 'weekly' && (!Number.isInteger(template.scheduleWeekday) || template.scheduleWeekday < 1 || template.scheduleWeekday > 7)) return '請選擇每週發放日。';
    return '';
  }

  async function saveFixedTicket() {
    if (busy) return;
    const template = collectTemplate();
    const error = validateTemplate(template);
    if (error) return showMessage(error);
    setBusy(true);
    hideMessage();
    try {
      const data = await request('admin.fixed-tickets.save', { template, expectedUpdatedAt: selectedUpdatedAt });
      templates = Array.isArray(data.templates) ? data.templates : templates;
      const saved = data.template || template;
      selectedFixedTicketId = String(saved.fixedTicketId || selectedFixedTicketId);
      selectedUpdatedAt = String(saved.updatedAt || '');
      renderFixedList();
      loadFixedTicket(selectedFixedTicketId);
      const run = data.run || {};
      const issued = Number(run.issued || 0);
      showMessage(issued ? `固定票券已儲存，本次自動發放 ${issued} 張。` : '固定票券已儲存。', true);
    } catch (error) {
      showMessage(error?.message || '固定票券儲存失敗。');
    } finally {
      setBusy(false);
    }
  }

  async function runFixedNow() {
    if (busy || !selectedFixedTicketId) return;
    setBusy(true);
    hideMessage();
    try {
      const data = await request('admin.fixed-tickets.run', { fixedTicketId: selectedFixedTicketId });
      templates = Array.isArray(data.templates) ? data.templates : templates;
      renderFixedList();
      const run = data.run || {};
      showMessage(`檢查完成：新增 ${Number(run.issued || 0)} 張固定票券，排入 ${Number(run.queued || 0)} 則 LINE 通知。`, true);
    } catch (error) {
      showMessage(error?.message || '固定票券發放檢查失敗。');
    } finally {
      setBusy(false);
    }
  }

  async function deleteFixedTicket() {
    if (busy || !selectedFixedTicketId) return;
    const template = templates.find((item) => String(item.fixedTicketId || '') === selectedFixedTicketId);
    if (!window.confirm(`確定要刪除「${String(template?.title || '這張固定票券')}」嗎？已發出的票券與使用紀錄會保留。`)) return;
    setBusy(true);
    hideMessage();
    try {
      const data = await request('admin.fixed-tickets.delete', { fixedTicketId: selectedFixedTicketId, expectedUpdatedAt: selectedUpdatedAt });
      templates = Array.isArray(data.templates) ? data.templates : templates.filter((item) => String(item.fixedTicketId || '') !== selectedFixedTicketId);
      selectedFixedTicketId = '';
      selectedUpdatedAt = '';
      document.getElementById('resetEventTicketButton')?.click();
      renderFixedList();
      showMessage('固定票券已刪除；已發出的會員票券與歷史紀錄仍保留。', true);
    } catch (error) {
      showMessage(error?.message || '固定票券刪除失敗。');
    } finally {
      setBusy(false);
    }
  }

  function setBusy(value) {
    busy = value;
    const save = document.getElementById('saveEventTicketButton');
    if (save && document.getElementById('eventTicketType')?.value === 'fixed') {
      save.disabled = value;
      save.textContent = value ? '儲存中…' : '儲存固定票券';
    }
    const run = document.getElementById('fixedTicketRunButton');
    if (run) run.disabled = value || !selectedFixedTicketId;
  }

  function showMessage(message, success = false) {
    const element = document.getElementById('eventTicketFormMessage');
    if (!element) return;
    element.textContent = String(message || '');
    element.classList.remove('hidden');
    element.classList.toggle('success', success);
  }

  function hideMessage() {
    const element = document.getElementById('eventTicketFormMessage');
    if (!element) return;
    element.textContent = '';
    element.classList.add('hidden');
    element.classList.remove('success');
  }
})();
