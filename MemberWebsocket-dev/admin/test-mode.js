(() => {
  'use strict';

  const els = {};
  let loaded = false;
  let loading = null;

  window.addEventListener('DOMContentLoaded', () => {
    [
      'testModeTab', 'testModePanel', 'testModeForm', 'systemMaintenanceEnabled', 'testModeEnabled',
      'testModeMaintenanceMessage',
      'testModeAddAccountCount', 'saveTestModeButton', 'testModeFormMessage',
      'testModeAccountCount', 'testModeAccountList', 'testModeAccountEmpty',
      'systemMaintenanceBadge', 'testModeStatusBadge', 'testModeDirectLoginBadge'
    ].forEach((id) => { els[id] = document.getElementById(id); });

    if (!els.testModeTab || !els.testModeForm) return;
    els.testModeTab.addEventListener('click', () => load().catch(showError));
    els.testModeForm.addEventListener('submit', save);
    document.querySelectorAll('[data-test-account-count]').forEach((button) => {
      button.addEventListener('click', () => {
        const value = Number(button.dataset.testAccountCount || 0);
        if (!Number.isInteger(value) || value < 0 || value > 50) return;
        els.testModeAddAccountCount.value = String(value);
        els.testModeAddAccountCount.focus();
      });
    });
    window.addEventListener('member-admin-ready', () => {
      if (els.testModeTab.getAttribute('aria-selected') === 'true') load().catch(showError);
    });
  });

  function apiUrl(config) {
    const base = String(config && config.supabaseUrl || '').replace(/\/$/, '');
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(base)) {
      throw new Error('測試模式服務設定不完整。');
    }
    return base + '/functions/v1/test-mode-api';
  }

  async function request(action, payload = {}) {
    const session = await window.MemberAdminSession.wait();
    const response = await fetch(apiUrl(session.config), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: String(session.config.supabasePublishableKey || '')
      },
      cache: 'no-store',
      body: JSON.stringify({
        ...payload,
        action,
        clientType: 'admin',
        idToken: session.idToken
      })
    });

    let body;
    try { body = await response.json(); }
    catch { throw new Error('測試模式服務暫時未正常回應。'); }
    if (!response.ok || !body || body.ok !== true) {
      const error = new Error(body?.error?.message || '測試模式服務拒絕此操作。');
      error.code = body?.error?.code || 'TEST_MODE_ERROR';
      throw error;
    }
    return body.data || {};
  }

  async function load(force = false) {
    if (loaded && !force) return;
    if (loading) return loading;
    setMessage('正在讀取測試模式設定…');
    loading = request('admin.test-mode.bootstrap')
      .then((data) => {
        render(data);
        loaded = true;
        setMessage('');
      })
      .finally(() => { loading = null; });
    return loading;
  }

  async function save(event) {
    event.preventDefault();
    const addAccountCount = Number(els.testModeAddAccountCount.value || 0);
    if (!Number.isInteger(addAccountCount) || addAccountCount < 0 || addAccountCount > 50) {
      return setMessage('本次新增測試帳號數量必須是 0–50 的整數。', true);
    }
    const maintenanceMessage = String(els.testModeMaintenanceMessage.value || '').trim();
    if (maintenanceMessage.length > 500) {
      return setMessage('系統維護訊息不可超過 500 字。', true);
    }

    setBusy(true);
    setMessage('正在儲存並建立測試帳號…');
    try {
      const data = await request('admin.test-mode.save', {
        enabled: els.testModeEnabled.checked,
        maintenanceEnabled: els.systemMaintenanceEnabled.checked,
        maintenanceMessage,
        addAccountCount
      });
      render(data);
      els.testModeAddAccountCount.value = '0';
      const created = Number(data.createdAccountCount || 0);
      setMessage(created > 0 ? '設定已儲存，已建立 ' + created + ' 個測試帳號。' : '測試模式設定已儲存。');
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  }

  function render(data) {
    const settings = data && data.settings && typeof data.settings === 'object' ? data.settings : {};
    const accounts = Array.isArray(data && data.accounts) ? data.accounts : [];
    const enabled = Boolean(settings.enabled);
    const maintenanceEnabled = Boolean(settings.maintenanceEnabled);

    els.systemMaintenanceEnabled.checked = maintenanceEnabled;
    els.testModeEnabled.checked = enabled;
    els.testModeMaintenanceMessage.value = String(settings.maintenanceMessage || '');
    els.testModeAccountCount.textContent = accounts.length + ' 個';
    els.testModeAccountList.replaceChildren(...accounts.map(renderAccount));
    els.testModeAccountEmpty.classList.toggle('hidden', accounts.length !== 0);

    updateStatusBadge(
      els.systemMaintenanceBadge,
      maintenanceEnabled ? '系統維護：啟用中' : '系統維護：未啟用',
      maintenanceEnabled ? 'is-warning' : 'is-off'
    );
    updateStatusBadge(
      els.testModeStatusBadge,
      enabled ? '測試模式：啟用中' : '測試模式：未啟用',
      enabled ? 'is-warning' : 'is-off'
    );
    const pcLoginAvailable = enabled && !maintenanceEnabled;
    updateStatusBadge(
      els.testModeDirectLoginBadge,
      pcLoginAvailable ? 'PC 測試登入：可用' : maintenanceEnabled ? 'PC 測試登入：系統維護中' : 'PC 測試登入：停用',
      pcLoginAvailable ? 'is-active' : maintenanceEnabled ? 'is-warning' : 'is-off'
    );
  }

  function updateStatusBadge(element, text, stateClass) {
    if (!element) return;
    element.textContent = text;
    element.className = 'test-mode-status-badge ' + stateClass;
  }

  function renderAccount(account) {
    const row = document.createElement('div');
    row.className = 'test-account-row';

    const identity = document.createElement('div');
    identity.className = 'test-account-identity';

    const avatar = document.createElement('span');
    avatar.className = 'test-account-avatar';
    const displayName = String(account.displayName || '測試會員');
    avatar.textContent = displayName.trim().slice(0, 1) || '測';

    const copy = document.createElement('div');
    copy.className = 'test-account-copy';
    const name = document.createElement('strong');
    name.textContent = displayName;
    const code = document.createElement('small');
    code.textContent = String(account.memberCode || '');
    copy.append(name, code);
    identity.append(avatar, copy);

    const available = account.status === 'active' && account.membershipStatus === 'active';
    const status = document.createElement('span');
    status.className = 'test-account-status' + (available ? '' : ' is-disabled');
    status.textContent = available ? '可登入' : '不可登入';

    row.append(identity, status);
    return row;
  }

  function setBusy(busy) {
    els.saveTestModeButton.disabled = busy;
    els.systemMaintenanceEnabled.disabled = busy;
    els.testModeEnabled.disabled = busy;
    els.testModeMaintenanceMessage.disabled = busy;
    els.testModeAddAccountCount.disabled = busy;
    document.querySelectorAll('[data-test-account-count]').forEach((button) => {
      button.disabled = busy;
    });
  }

  function setMessage(message, error = false) {
    els.testModeFormMessage.textContent = String(message || '');
    els.testModeFormMessage.classList.toggle('hidden', !message);
    els.testModeFormMessage.classList.toggle('error', Boolean(error));
  }

  function showError(error) {
    setMessage(error && error.message ? error.message : '測試模式操作失敗，請稍後再試。', true);
  }
})();