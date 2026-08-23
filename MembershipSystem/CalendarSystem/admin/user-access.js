(() => {
  'use strict';

  const READY_RETRY_MS = 250;
  const READY_MAX_ATTEMPTS = 60;
  const state = { config: null, idToken: '', users: [], loading: false };

  window.addEventListener('DOMContentLoaded', () => {
    const root = document.getElementById('userAccessCard');
    const list = document.getElementById('userAccessList');
    const status = document.getElementById('userAccessStatus');
    const refresh = document.getElementById('userAccessRefresh');
    if (!root || !list || !status || !refresh) return;

    refresh.addEventListener('click', () => loadUsers(true));
    waitForAdminReady(0);

    async function waitForAdminReady(attempt) {
      const adminView = document.getElementById('adminView');
      let loggedIn = false;
      try {
        loggedIn = Boolean(window.liff && window.liff.isLoggedIn && window.liff.isLoggedIn());
      } catch (_) {}

      if (adminView && !adminView.classList.contains('hidden') && loggedIn) {
        try {
          state.config = await loadConfig();
          state.idToken = window.liff.getIDToken() || '';
          if (!state.idToken) throw new Error('無法取得 LINE ID token。');
          await loadUsers(false);
        } catch (error) {
          setStatus(error && error.message ? error.message : '無法載入用戶使用權限。', true);
        }
        return;
      }

      if (attempt < READY_MAX_ATTEMPTS) {
        window.setTimeout(() => waitForAdminReady(attempt + 1), READY_RETRY_MS);
      }
    }

    async function loadConfig() {
      const response = await fetch('../config.json', { cache: 'no-store' });
      if (!response.ok) throw new Error('讀取 config.json 失敗。');
      const config = await response.json();
      const gasUrl = String(config && config.gasWebAppUrl || '').trim();
      if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(gasUrl)) {
        throw new Error('GAS Web App URL 設定不合法。');
      }
      return config;
    }

    async function loadUsers(showLoading) {
      if (state.loading) return;
      state.loading = true;
      refresh.disabled = true;
      if (showLoading) setStatus('載入中…', false);

      try {
        const result = await api('admin.users.list');
        state.users = Array.isArray(result.users) ? result.users : [];
        renderUsers();
        setStatus(`共 ${state.users.length} 位用戶`, false);
      } catch (error) {
        setStatus(error && error.message ? error.message : '載入用戶失敗。', true);
      } finally {
        state.loading = false;
        refresh.disabled = false;
      }
    }

    function renderUsers() {
      if (!state.users.length) {
        const empty = document.createElement('div');
        empty.className = 'user-access-empty';
        empty.textContent = '目前尚無用戶登入紀錄。';
        list.replaceChildren(empty);
        return;
      }

      const fragment = document.createDocumentFragment();
      state.users.forEach((user) => fragment.appendChild(createUserRow(user)));
      list.replaceChildren(fragment);
    }

    function createUserRow(user) {
      const row = document.createElement('article');
      row.className = 'user-access-row';

      const identity = document.createElement('div');
      identity.className = 'user-access-identity';
      const name = document.createElement('strong');
      name.textContent = String(user.displayName || 'LINE 使用者');
      const meta = document.createElement('span');
      meta.textContent = `${shortUserId(user.lineUserId)} · 最近登入 ${formatDateTime(user.lastLoginAt)}`;
      identity.append(name, meta);

      const controls = document.createElement('div');
      controls.className = 'user-access-controls';
      const select = document.createElement('select');
      select.className = 'user-access-select';
      select.setAttribute('aria-label', `${name.textContent} 使用權限`);
      [['active', '通過'], ['disabled', '停用']].forEach(([value, label]) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        if (value === user.status) option.selected = true;
        select.appendChild(option);
      });

      const save = document.createElement('button');
      save.type = 'button';
      save.className = 'button primary compact-button';
      save.textContent = '儲存';
      save.addEventListener('click', async () => {
        const nextStatus = select.value;
        if (nextStatus === user.status) {
          setStatus('使用權限沒有變更。', false);
          return;
        }

        select.disabled = true;
        save.disabled = true;
        save.textContent = '儲存中…';
        try {
          const result = await api('admin.users.updateStatus', {
            lineUserId: user.lineUserId,
            status: nextStatus,
            expectedUpdatedAt: user.updatedAt
          });
          const updated = result.user;
          const index = state.users.findIndex((entry) => entry.lineUserId === user.lineUserId);
          if (index !== -1 && updated) state.users[index] = updated;
          renderUsers();
          setStatus(nextStatus === 'disabled' ? '用戶已停用。' : '用戶已通過。', false);
        } catch (error) {
          if (error && error.code === 'CONFLICT') await loadUsers(false);
          setStatus(error && error.message ? error.message : '更新使用權限失敗。', true);
        } finally {
          select.disabled = false;
          save.disabled = false;
          save.textContent = '儲存';
        }
      });

      controls.append(select, save);
      row.append(identity, controls);
      return row;
    }

    async function api(action, payload = {}) {
      const response = await fetch(state.config.gasWebAppUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        cache: 'no-store',
        redirect: 'follow',
        body: JSON.stringify({ action, clientType: 'admin', idToken: state.idToken, ...payload })
      });

      let data;
      try {
        data = await response.json();
      } catch (_) {
        throw new Error('GAS 回傳格式錯誤。');
      }
      if (!data || data.ok !== true) {
        const error = new Error(data && data.error && data.error.message || '後端拒絕此請求。');
        error.code = data && data.error && data.error.code || 'API_ERROR';
        throw error;
      }
      return data.data || {};
    }

    function setStatus(message, isError) {
      status.textContent = message;
      status.classList.toggle('error', Boolean(isError));
    }
  });

  function shortUserId(value) {
    const id = String(value || '');
    if (id.length <= 12) return id || '未知 ID';
    return `${id.slice(0, 6)}…${id.slice(-4)}`;
  }

  function formatDateTime(value) {
    const date = new Date(String(value || ''));
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat('zh-TW', {
      timeZone: 'Asia/Taipei',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit'
    }).format(date);
  }
})();
