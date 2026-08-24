(function () {
  'use strict';

  const $ = (selector) => document.querySelector(selector);
  const tierLabel = { standard: '一般', silver: '銀級', gold: '金級', platinum: '白金', vip: '白金' };
  const statusLabel = { active: '有效', suspended: '停權', disabled: '停用' };
  const pushLabel = { sent: '已推播', failed: '推播失敗', not_configured: '未設定推播', pending: '等待推播' };
  let searchTimer = null;
  let selectedMember = null;
  let pendingRequestId = '';
  let pendingRequestFingerprint = '';
  let adminReady = false;
  let grantsLoaded = false;

  function formatMinutes(value) {
    return new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 }).format(Number(value || 0));
  }

  function formatDateTime(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat('zh-TW', {
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
    }).format(date);
  }

  function createRequestId() {
    if (!window.crypto || typeof window.crypto.getRandomValues !== 'function') {
      throw new Error('目前瀏覽器無法建立安全的發放要求，請更換瀏覽器後再試。');
    }
    const bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  function showMessage(message, isError) {
    const node = $('#minuteGrantMessage');
    node.textContent = message || '';
    node.classList.toggle('error', Boolean(isError));
    node.classList.toggle('hidden', !message);
  }

  function backendErrorMessage(error) {
    if (error && error.code === 'INVALID_ACTION') {
      return '目前 GAS Web App 尚未更新分鐘發放功能，請同步最新 gas 程式碼並重新部署 Web App。';
    }
    return error && error.message ? error.message : '分鐘發放操作失敗。';
  }

  function setSelectedMember(member) {
    selectedMember = member || null;
    $('#minuteGrantTargetMemberNo').value = selectedMember ? selectedMember.memberNo : '';
    const card = $('#minuteGrantSelectedMember');
    if (!selectedMember) {
      card.classList.add('hidden');
      card.replaceChildren();
      return;
    }

    const name = document.createElement('strong');
    name.textContent = selectedMember.displayName || 'LINE 會員';
    const meta = document.createElement('span');
    meta.textContent = `${selectedMember.memberNo}｜${tierLabel[selectedMember.tier] || '一般'}｜累計 ${formatMinutes(selectedMember.consumedMinutes)} 分鐘｜${statusLabel[selectedMember.membershipStatus] || selectedMember.membershipStatus}`;
    card.replaceChildren(name, meta);
    card.classList.remove('hidden');
  }

  function renderMemberSearchResults(rows) {
    const container = $('#minuteGrantMemberResults');
    container.replaceChildren();
    if (!rows.length) {
      const empty = document.createElement('div');
      empty.className = 'grant-search-empty';
      empty.textContent = '找不到符合條件的會員。';
      container.append(empty);
      return;
    }

    rows.forEach((member) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'grant-member-option';
      const name = document.createElement('strong');
      name.textContent = member.displayName || 'LINE 會員';
      const meta = document.createElement('span');
      meta.textContent = `${member.memberNo}｜${tierLabel[member.tier] || '一般'}｜累計 ${formatMinutes(member.consumedMinutes)} 分鐘｜${statusLabel[member.membershipStatus] || member.membershipStatus}`;
      button.append(name, meta);
      if (member.membershipStatus !== 'active') {
        button.disabled = true;
        button.title = '只能對有效會員發放累計消費分鐘';
      } else {
        button.addEventListener('click', () => {
          setSelectedMember(member);
          container.replaceChildren();
          $('#minuteGrantMemberSearch').value = `${member.displayName || 'LINE 會員'} (${member.memberNo})`;
        });
      }
      container.append(button);
    });
  }

  async function searchMembers() {
    const query = $('#minuteGrantMemberSearch').value.trim();
    if (!query) {
      $('#minuteGrantMemberResults').replaceChildren();
      setSelectedMember(null);
      return;
    }
    try {
      const result = await Membership.callApi('admin.list', { query, page: 1, pageSize: 10 });
      renderMemberSearchResults(result.members || []);
    } catch (error) {
      showMessage(backendErrorMessage(error), true);
    }
  }

  function renderPushStatus(grant, cell) {
    const badge = document.createElement('span');
    const status = grant.pushStatus || 'pending';
    badge.className = `grant-push-status ${status}`;
    badge.textContent = pushLabel[status] || status;
    cell.append(badge);
    if (grant.pushErrorCode) {
      const error = document.createElement('small');
      error.textContent = grant.pushErrorCode;
      cell.append(error);
    }
    if (status === 'failed' || status === 'not_configured') {
      const retry = document.createElement('button');
      retry.className = 'text-button';
      retry.type = 'button';
      retry.textContent = '重試推播';
      retry.addEventListener('click', () => retryPush(grant.grantId, retry));
      cell.append(retry);
    }
  }

  function renderGrantRows(grants) {
    const body = $('#minuteGrantTableBody');
    body.replaceChildren();
    $('#minuteGrantEmptyState').classList.toggle('hidden', grants.length !== 0);
    grants.forEach((grant) => {
      const tr = document.createElement('tr');
      const time = document.createElement('td'); time.textContent = formatDateTime(grant.grantedAt);
      const member = document.createElement('td'); member.textContent = `${grant.memberDisplayName || 'LINE 會員'} (${grant.memberNo})`;
      const minutes = document.createElement('td'); minutes.textContent = `${formatMinutes(grant.minutes)} 分鐘`;
      const reason = document.createElement('td'); reason.textContent = grant.reason || '—';
      const total = document.createElement('td'); total.textContent = `${formatMinutes(grant.consumedAfterMinutes)} 分鐘`;
      const tier = document.createElement('td');
      tier.textContent = grant.tierBefore === grant.tierAfter
        ? (tierLabel[grant.tierAfter] || grant.tierAfter)
        : `${tierLabel[grant.tierBefore] || grant.tierBefore} → ${tierLabel[grant.tierAfter] || grant.tierAfter}`;
      const push = document.createElement('td'); push.className = 'grant-push-cell'; renderPushStatus(grant, push);
      tr.append(time, member, minutes, reason, total, tier, push);
      body.append(tr);
    });
  }

  async function loadGrants() {
    if (!adminReady) return;
    const button = $('#minuteGrantRefreshButton');
    if (button) button.disabled = true;
    try {
      const result = await Membership.callApi('admin.minutes.grants.list', { limit: 50 });
      renderGrantRows(result.grants || []);
      grantsLoaded = true;
    } catch (error) {
      showMessage(backendErrorMessage(error), true);
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function retryPush(grantId, button) {
    button.disabled = true;
    try {
      const result = await Membership.callApi('admin.minutes.push.retry', { grantId });
      if (result.pushStatus === 'sent') showMessage('LINE 官方帳號推播已成功補送。', false);
      else showMessage(`推播仍未成功：${result.pushErrorCode || result.pushStatus}`, true);
      await loadGrants();
    } catch (error) {
      showMessage(backendErrorMessage(error), true);
    } finally {
      button.disabled = false;
    }
  }

  async function submitGrant() {
    const button = $('#minuteGrantSubmitButton');
    const memberNo = $('#minuteGrantTargetMemberNo').value;
    const minutes = Number($('#minuteGrantMinutes').value);
    const reason = $('#minuteGrantReason').value.trim();
    if (!selectedMember || !memberNo) {
      showMessage('請先搜尋並選擇要發放的會員。', true);
      return;
    }
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 60000) {
      showMessage('發放分鐘必須是 1 到 60000 的整數。', true);
      return;
    }
    if (!reason) {
      showMessage('請輸入發放原因；此原因會顯示於會員端與 LINE 推播。', true);
      return;
    }

    const fingerprint = `${memberNo}\n${minutes}\n${reason}`;
    if (!pendingRequestId || pendingRequestFingerprint !== fingerprint) {
      pendingRequestId = createRequestId();
      pendingRequestFingerprint = fingerprint;
    }

    button.disabled = true;
    showMessage('', false);
    try {
      const result = await Membership.callApi('admin.minutes.grant', {
        targetMemberNo: memberNo,
        minutes,
        reason,
        requestId: pendingRequestId
      });
      const grant = result.grant;
      if (result.pushStatus === 'sent') {
        showMessage(`已發放 ${formatMinutes(grant.minutes)} 分鐘，並完成 LINE 官方帳號推播。`, false);
      } else if (result.pushStatus === 'not_configured') {
        showMessage(`已發放 ${formatMinutes(grant.minutes)} 分鐘，但尚未設定 LINE Messaging Channel Access Token；可設定後於下方重試推播。`, true);
      } else {
        showMessage(`已發放 ${formatMinutes(grant.minutes)} 分鐘，但 LINE 推播失敗（${result.pushErrorCode || result.pushStatus}）；可於下方重試。`, true);
      }
      pendingRequestId = '';
      pendingRequestFingerprint = '';
      $('#minuteGrantMinutes').value = '60';
      $('#minuteGrantReason').value = '';
      selectedMember = Object.assign({}, selectedMember, {
        consumedMinutes: result.member.consumedMinutes,
        tier: result.member.tier,
        updatedAt: result.member.updatedAt
      });
      setSelectedMember(selectedMember);
      await loadGrants();
    } catch (error) {
      showMessage(backendErrorMessage(error), true);
    } finally {
      button.disabled = false;
    }
  }

  function onAdminReady() {
    if (adminReady) return;
    adminReady = true;
    if (window.location.hash === '#grants') loadGrants();
  }

  $('#minuteGrantMemberSearch').addEventListener('input', () => {
    clearTimeout(searchTimer);
    if (selectedMember) setSelectedMember(null);
    searchTimer = window.setTimeout(searchMembers, 300);
  });
  $('#minuteGrantSubmitButton').addEventListener('click', submitGrant);
  $('#minuteGrantRefreshButton').addEventListener('click', loadGrants);
  window.addEventListener('hashchange', () => {
    if (window.location.hash === '#grants' && adminReady && !grantsLoaded) loadGrants();
  });

  const adminApp = $('#adminApp');
  if (!adminApp.classList.contains('hidden')) onAdminReady();
  const observer = new MutationObserver(() => {
    if (!adminApp.classList.contains('hidden')) {
      onAdminReady();
      observer.disconnect();
    }
  });
  observer.observe(adminApp, { attributes: true, attributeFilter: ['class'] });
})();
