(function () {
  'use strict';

  const $ = (selector) => document.querySelector(selector);
  const tierLabel = { standard: '一般', silver: '銀級', gold: '金級', platinum: '白金', vip: '白金' };
  const statusLabel = { active: '有效', suspended: '停權', disabled: '停用' };
  const pushLabel = { sent: '已推播', failed: '推播失敗', not_configured: '未設定推播', pending: '等待推播' };
  const pointGrantLabel = {
    recorded: '已入點', pending: '等待同步', failed: '同步失敗',
    not_configured: '尚未設定', not_requested: '未要求同步'
  };
  let selectedMember = null;
  let pendingRequestId = '';
  let pendingRequestFingerprint = '';
  let adminReady = false;
  let grantsLoaded = false;
  let pointCardsLoading = null;

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

  function normalizeTierFromLabel(value) {
    const label = String(value || '').trim();
    const match = Object.keys(tierLabel).find((key) => tierLabel[key] === label);
    return match === 'vip' ? 'platinum' : (match || 'standard');
  }

  function parseDisplayedMinutes(value) {
    const digits = String(value || '').replace(/[^0-9]/g, '');
    return digits ? Number(digits) : 0;
  }

  function memberFromEditDialog() {
    const memberNo = $('#editTargetMemberNo').value.trim();
    if (!memberNo) return null;
    return {
      memberNo,
      displayName: $('#editMemberName').textContent.trim() || 'LINE 會員',
      tier: normalizeTierFromLabel($('#editTier').value),
      membershipStatus: $('#editStatus').value,
      consumedMinutes: parseDisplayedMinutes($('#editConsumedMinutes').value),
      expiresAt: $('#editExpiresAt').value || '',
      updatedAt: $('#editExpectedUpdatedAt').value || ''
    };
  }

  function isMemberEligibleForGrant(member) {
    if (!member || member.membershipStatus !== 'active') return false;
    if (!member.expiresAt) return true;
    const expiresAt = new Date(`${String(member.expiresAt).slice(0, 10)}T23:59:59+08:00`);
    return !Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() >= Date.now();
  }

  function showGrantMessage(message, isError) {
    const node = $('#minuteGrantMessage');
    node.textContent = message || '';
    node.classList.toggle('error', Boolean(isError));
    node.classList.toggle('hidden', !message);
  }

  function ensureHistoryMessage() {
    let node = $('#minuteGrantHistoryMessage');
    if (node) return node;
    node = document.createElement('p');
    node.id = 'minuteGrantHistoryMessage';
    node.className = 'minute-grant-message hidden';
    node.setAttribute('role', 'status');
    const heading = document.querySelector('.minute-grant-history-heading');
    if (heading) heading.insertAdjacentElement('afterend', node);
    return node;
  }

  function showHistoryMessage(message, isError) {
    const node = ensureHistoryMessage();
    if (!node) return;
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

  function resetGrantRequestState() {
    pendingRequestId = '';
    pendingRequestFingerprint = '';
  }

  function selectedPointsCardId() {
    const select = $('#minuteGrantPointsCard');
    return select && !select.disabled ? String(select.value || '').trim() : '';
  }

  function syncGrantSubmitAvailability() {
    const button = $('#minuteGrantSubmitButton');
    if (button) button.disabled = !isMemberEligibleForGrant(selectedMember) || !selectedPointsCardId();
  }

  function resetPointCardSelection() {
    const select = $('#minuteGrantPointsCard');
    if (!select) return;
    const option = document.createElement('option');
    option.value = '';
    option.textContent = '請先開啟會員資料';
    select.replaceChildren(option);
    select.disabled = true;
  }

  function renderPointCardOptions(cards) {
    const select = $('#minuteGrantPointsCard');
    if (!select) return;
    const previousValue = String(select.value || '').trim();
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = cards.length ? '請選擇集點卡' : '目前沒有可發放的有效集點卡';
    select.replaceChildren(placeholder);
    cards.forEach((card) => {
      const option = document.createElement('option');
      option.value = card.cardId;
      option.textContent = card.name;
      select.append(option);
    });
    select.disabled = cards.length === 0;
    if (previousValue && cards.some((card) => card.cardId === previousValue)) select.value = previousValue;
    updatePointsPreview();
    syncGrantSubmitAvailability();
  }

  async function loadPointCards() {
    if (pointCardsLoading) return pointCardsLoading;
    const select = $('#minuteGrantPointsCard');
    if (!select) return [];
    const loadingOption = document.createElement('option');
    loadingOption.value = '';
    loadingOption.textContent = '正在讀取可發放集點卡…';
    select.replaceChildren(loadingOption);
    select.disabled = true;
    updatePointsPreview();
    syncGrantSubmitAvailability();
    pointCardsLoading = Membership.callApi('admin.minutes.points.cards.list', {})
      .then((result) => {
        const cards = Array.isArray(result.cards) ? result.cards : [];
        renderPointCardOptions(cards);
        return cards;
      })
      .catch((error) => {
        resetPointCardSelection();
        updatePointsPreview();
        syncGrantSubmitAvailability();
        showGrantMessage(backendErrorMessage(error), true);
        return [];
      })
      .finally(() => { pointCardsLoading = null; });
    return pointCardsLoading;
  }

  function updatePointsPreview() {
    const preview = $('#minuteGrantPointsPreview');
    if (!preview) return;
    const minutes = Number($('#minuteGrantMinutes').value);
    const pointsPerServiceMinutes = Number($('#minuteGrantPointsPerServiceMinutes').value);
    const points = Number.isInteger(minutes) && Number.isInteger(pointsPerServiceMinutes) && pointsPerServiceMinutes > 0
      ? Math.floor(minutes / pointsPerServiceMinutes)
      : 0;
    const pointsCardId = selectedPointsCardId();
    const select = $('#minuteGrantPointsCard');
    const cardName = pointsCardId && select && select.selectedOptions[0]
      ? select.selectedOptions[0].textContent.trim()
      : '';
    preview.classList.toggle('error', points < 1 || points > 100 || !pointsCardId);
    if (points < 1) {
      preview.textContent = '本次服務分鐘不足換算 1 點；請調整服務分鐘或每點服務時間。';
    } else if (points > 100) {
      preview.textContent = '本次會換算 ' + formatMinutes(points) + ' 點，超過單次最多 100 點；請調整換算規則。';
    } else if (!pointsCardId) {
      preview.textContent = '請選擇要同步發放的集點卡。';
    } else {
      preview.textContent = '本次將同步發放 ' + formatMinutes(points) + ' 點到「' + cardName + '」。';
    }
  }

  function setSelectedMember(member, options) {
    const settings = Object.assign({ resetForm: false, preserveMessage: false }, options || {});
    const previousMemberNo = selectedMember && selectedMember.memberNo;
    selectedMember = member || null;
    $('#minuteGrantTargetMemberNo').value = selectedMember ? selectedMember.memberNo : '';

    if (!selectedMember || previousMemberNo !== selectedMember.memberNo) {
      resetGrantRequestState();
    }

    if (settings.resetForm) {
      $('#minuteGrantMinutes').value = '60';
      $('#minuteGrantPointsPerServiceMinutes').value = '60';
      $('#minuteGrantReason').value = '';
      updatePointsPreview();
      if (!settings.preserveMessage) showGrantMessage('', false);
    }

    const card = $('#minuteGrantSelectedMember');
    if (!selectedMember) {
      card.classList.add('hidden');
      card.replaceChildren();
      $('#minuteGrantSubmitButton').disabled = true;
      return;
    }

    const name = document.createElement('strong');
    name.textContent = selectedMember.displayName || 'LINE 會員';
    const meta = document.createElement('span');
    meta.textContent = `${selectedMember.memberNo}｜${tierLabel[selectedMember.tier] || '一般'}｜累計 ${formatMinutes(selectedMember.consumedMinutes)} 分鐘｜${statusLabel[selectedMember.membershipStatus] || selectedMember.membershipStatus}`;
    card.replaceChildren(name, meta);
    card.classList.remove('hidden');

    const eligible = isMemberEligibleForGrant(selectedMember);
    syncGrantSubmitAvailability();
    if (!eligible && !settings.preserveMessage) {
      showGrantMessage('此會員目前不是有效可用狀態，無法發放累計消費分鐘。', true);
    }
  }

  function syncGrantResultToEditDialog(member) {
    if (!member || $('#editTargetMemberNo').value !== member.memberNo) return;
    $('#editExpectedUpdatedAt').value = member.updatedAt || $('#editExpectedUpdatedAt').value;
    $('#editTier').value = tierLabel[member.tier] || tierLabel.standard;
    $('#editConsumedMinutes').value = `${formatMinutes(member.consumedMinutes)} 分鐘`;
    $('#editStatus').value = member.membershipStatus;
    $('#editExpiresAt').value = member.expiresAt ? String(member.expiresAt).slice(0, 10) : '';
  }

  function selectMemberFromOpenDialog() {
    const dialog = $('#editDialog');
    if (!dialog || !dialog.open) return;
    const member = memberFromEditDialog();
    if (!member) return;
    setSelectedMember(member, { resetForm: true });
    loadPointCards();
  }

  function prepareMemberDialogGrantUi() {
    const panel = document.querySelector('.minute-grant-form-panel');
    const editForm = $('#editForm');
    const editError = $('#editError');
    if (!panel || !editForm || !editError) return;

    panel.classList.add('member-minute-grant-panel');
    const title = $('#minuteGrantFormTitle');
    if (title) title.textContent = '發放服務分鐘與同步集點';
    const description = panel.querySelector(':scope > p');
    if (description) {
      description.textContent = '發放對象固定為目前開啟的會員；只能對有效且未過期的會員發放。請設定本次每幾分鐘服務換 1 點與目標集點卡；換算規則、卡片、發放原因與稽核都會保留。';
    }

    const searchInput = $('#minuteGrantMemberSearch');
    const searchField = searchInput ? searchInput.closest('label') : null;
    if (searchField) searchField.classList.add('hidden');
    const searchResults = $('#minuteGrantMemberResults');
    if (searchResults) searchResults.classList.add('hidden');

    editForm.insertBefore(panel, editError);

    const grantGrid = document.querySelector('.minute-grant-grid');
    if (grantGrid) grantGrid.classList.add('minute-grant-history-only');

    const navButton = document.querySelector('[data-admin-page="grants"]');
    if (navButton) navButton.textContent = '發放紀錄';

    const pageTitle = $('#minuteGrantPageTitle');
    if (pageTitle) pageTitle.textContent = '分鐘與集點發放紀錄';
    const pageHeadingText = pageTitle && pageTitle.parentElement ? pageTitle.parentElement.querySelector('p') : null;
    if (pageHeadingText) pageHeadingText.textContent = '分鐘與集點發放請先到會員列表點選會員；此頁保留最近紀錄、集點同步重試與 LINE 推播補送。';

    const overviewCard = document.querySelector('[data-admin-page-target="grants"]');
    if (overviewCard) {
      const strong = overviewCard.querySelector('strong');
      const small = overviewCard.querySelector('small');
      const action = overviewCard.querySelector('.overview-link-action');
      if (strong) strong.textContent = '分鐘與集點發放紀錄';
      if (small) small.textContent = '查看分鐘與同步集點紀錄、等級變化與 LINE 推播結果；實際發放請從會員列表進入。';
      if (action) action.textContent = '查看發放紀錄 →';
    }

    const membersHeading = $('#membersPageTitle');
    const membersDescription = membersHeading && membersHeading.parentElement ? membersHeading.parentElement.querySelector('p') : null;
    if (membersDescription) {
      membersDescription.textContent = '搜尋會員；點選「編輯」開啟小視窗，可管理會員資料、發放累計消費分鐘並同步集點。';
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

  function renderPointGrantStatus(grant, cell) {
    const status = grant.pointGrantStatus || 'not_requested';
    const badge = document.createElement('span');
    badge.className = `grant-push-status ${status}`;
    badge.textContent = pointGrantLabel[status] || status;
    cell.append(badge);
    if (grant.pointsGranted > 0) {
      const detail = document.createElement('small');
      detail.textContent = `${formatMinutes(grant.pointsGranted)} 點｜每 ${formatMinutes(grant.pointsPerServiceMinutes)} 分鐘 1 點${grant.pointsCardName ? `｜${grant.pointsCardName}` : ''}`;
      cell.append(detail);
    }
    if (grant.pointGrantErrorCode) {
      const error = document.createElement('small');
      error.textContent = grant.pointGrantErrorCode;
      cell.append(error);
    }
    if (grant.pointsGranted > 0 && status !== 'recorded') {
      const retry = document.createElement('button');
      retry.className = 'text-button';
      retry.type = 'button';
      retry.textContent = '重試集點';
      retry.addEventListener('click', () => retryPoints(grant.grantId, retry));
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
      const points = document.createElement('td'); points.className = 'grant-push-cell'; renderPointGrantStatus(grant, points);
      const reason = document.createElement('td'); reason.textContent = grant.reason || '—';
      const total = document.createElement('td'); total.textContent = `${formatMinutes(grant.consumedAfterMinutes)} 分鐘`;
      const tier = document.createElement('td');
      tier.textContent = grant.tierBefore === grant.tierAfter
        ? (tierLabel[grant.tierAfter] || grant.tierAfter)
        : `${tierLabel[grant.tierBefore] || grant.tierBefore} → ${tierLabel[grant.tierAfter] || grant.tierAfter}`;
      const push = document.createElement('td'); push.className = 'grant-push-cell'; renderPushStatus(grant, push);
      tr.append(time, member, minutes, points, reason, total, tier, push);
      body.append(tr);
    });
  }

  async function loadGrants() {
    if (!adminReady) return;
    const button = $('#minuteGrantRefreshButton');
    if (button) button.disabled = true;
    showHistoryMessage('', false);
    try {
      const result = await Membership.callApi('admin.minutes.grants.list', { limit: 50 });
      renderGrantRows(result.grants || []);
      grantsLoaded = true;
    } catch (error) {
      showHistoryMessage(backendErrorMessage(error), true);
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function retryPush(grantId, button) {
    button.disabled = true;
    try {
      const result = await Membership.callApi('admin.minutes.push.retry', { grantId });
      if (result.pushStatus === 'sent') showHistoryMessage('LINE 官方帳號推播已成功補送。', false);
      else showHistoryMessage(`推播仍未成功：${result.pushErrorCode || result.pushStatus}`, true);
      await loadGrants();
    } catch (error) {
      showHistoryMessage(backendErrorMessage(error), true);
    } finally {
      button.disabled = false;
    }
  }

  async function retryPoints(grantId, button) {
    button.disabled = true;
    try {
      const result = await Membership.callApi('admin.minutes.points.retry', { grantId });
      if (result.pointGrantStatus === 'recorded') {
        showHistoryMessage(`已同步發放 ${formatMinutes(result.grant.pointsGranted)} 點到 ${result.grant.pointsCardName || '集點卡'}。`, false);
      } else {
        showHistoryMessage(`集點同步仍未成功：${result.pointGrantErrorCode || result.pointGrantStatus}`, true);
      }
      await loadGrants();
    } catch (error) {
      showHistoryMessage(backendErrorMessage(error), true);
    } finally {
      button.disabled = false;
    }
  }

  async function submitGrant() {
    const button = $('#minuteGrantSubmitButton');
    const memberNo = $('#minuteGrantTargetMemberNo').value;
    const minutes = Number($('#minuteGrantMinutes').value);
    const pointsPerServiceMinutes = Number($('#minuteGrantPointsPerServiceMinutes').value);
    const pointsCardId = selectedPointsCardId();
    const reason = $('#minuteGrantReason').value.trim();

    if (!selectedMember || !memberNo || selectedMember.memberNo !== memberNo) {
      showGrantMessage('請先從會員列表開啟要發放的會員。', true);
      return;
    }
    if (!isMemberEligibleForGrant(selectedMember)) {
      showGrantMessage('此會員目前不是有效可用狀態，無法發放累計消費分鐘。', true);
      return;
    }
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 60000) {
      showGrantMessage('發放分鐘必須是 1 到 60000 的整數。', true);
      return;
    }
    if (!Number.isInteger(pointsPerServiceMinutes) || pointsPerServiceMinutes < 1 || pointsPerServiceMinutes > 60000) {
      showGrantMessage('每點服務時間必須是 1 到 60000 的整數。', true);
      return;
    }
    const pointsGranted = Math.floor(minutes / pointsPerServiceMinutes);
    if (pointsGranted < 1 || pointsGranted > 100) {
      showGrantMessage('依目前換算，本次必須同步發放 1 到 100 點；請調整服務分鐘或每點服務時間。', true);
      return;
    }
    if (!pointsCardId) {
      showGrantMessage('請選擇要同步發放的集點卡。', true);
      return;
    }
    if (!reason) {
      showGrantMessage('請輸入發放原因；此原因會顯示於會員端與 LINE 推播。', true);
      return;
    }

    const fingerprint = `${memberNo}\n${minutes}\n${pointsPerServiceMinutes}\n${pointsCardId}\n${reason}`;
    if (!pendingRequestId || pendingRequestFingerprint !== fingerprint) {
      pendingRequestId = createRequestId();
      pendingRequestFingerprint = fingerprint;
    }

    button.disabled = true;
    showGrantMessage('', false);
    try {
      const result = await Membership.callApi('admin.minutes.grant', {
        targetMemberNo: memberNo,
        minutes,
        pointsPerServiceMinutes,
        pointsCardId,
        reason,
        requestId: pendingRequestId
      });
      const grant = result.grant;
      const pointMessage = grant.pointGrantStatus === 'recorded'
        ? `，已同步發放 ${formatMinutes(grant.pointsGranted)} 點到 ${grant.pointsCardName || '集點卡'}`
        : `；分鐘已發放，但集點卡尚未同步（${grant.pointGrantErrorCode || grant.pointGrantStatus}），可到「發放紀錄」重試集點`;
      if (result.pushStatus === 'sent') {
        showGrantMessage(`已發放 ${formatMinutes(grant.minutes)} 分鐘${pointMessage}，並完成 LINE 官方帳號推播。`, grant.pointGrantStatus !== 'recorded');
      } else if (result.pushStatus === 'not_configured') {
        showGrantMessage(`已發放 ${formatMinutes(grant.minutes)} 分鐘${pointMessage}，但尚未設定 LINE Messaging Channel Access Token；可到「發放紀錄」補送推播。`, true);
      } else {
        showGrantMessage(`已發放 ${formatMinutes(grant.minutes)} 分鐘${pointMessage}，但 LINE 推播失敗（${result.pushErrorCode || result.pushStatus}）；可到「發放紀錄」重試。`, true);
      }

      resetGrantRequestState();
      $('#minuteGrantMinutes').value = '60';
      $('#minuteGrantPointsPerServiceMinutes').value = '60';
      $('#minuteGrantReason').value = '';
      updatePointsPreview();
      setSelectedMember(result.member, { preserveMessage: true });
      syncGrantResultToEditDialog(result.member);
      grantsLoaded = false;

      // Refresh through the existing admin dashboard path so the private member
      // list state in app.js is replaced with the server-authoritative values.
      const refreshButton = $('#adminRefreshButton');
      if (refreshButton) refreshButton.click();
      if (window.location.hash === '#grants') await loadGrants();
    } catch (error) {
      showGrantMessage(backendErrorMessage(error), true);
    } finally {
      syncGrantSubmitAvailability();
    }
  }

  function onAdminReady() {
    if (adminReady) return;
    adminReady = true;
    if (window.location.hash === '#grants') loadGrants();
  }

  prepareMemberDialogGrantUi();
  ensureHistoryMessage();

  const editDialog = $('#editDialog');
  const editDialogObserver = new MutationObserver(() => {
    if (editDialog.open) selectMemberFromOpenDialog();
  });
  editDialogObserver.observe(editDialog, { attributes: true, attributeFilter: ['open'] });
  editDialog.addEventListener('close', () => {
    selectedMember = null;
    $('#minuteGrantTargetMemberNo').value = '';
    $('#minuteGrantSelectedMember').classList.add('hidden');
    $('#minuteGrantSelectedMember').replaceChildren();
    $('#minuteGrantMinutes').value = '60';
    $('#minuteGrantPointsPerServiceMinutes').value = '60';
    $('#minuteGrantReason').value = '';
    resetPointCardSelection();
    updatePointsPreview();
    showGrantMessage('', false);
    resetGrantRequestState();
  });

  $('#minuteGrantSubmitButton').addEventListener('click', submitGrant);
  $('#minuteGrantRefreshButton').addEventListener('click', loadGrants);
  $('#minuteGrantMinutes').addEventListener('input', updatePointsPreview);
  $('#minuteGrantPointsPerServiceMinutes').addEventListener('input', updatePointsPreview);
  $('#minuteGrantPointsCard').addEventListener('change', () => {
    resetGrantRequestState();
    updatePointsPreview();
    syncGrantSubmitAvailability();
  });
  updatePointsPreview();
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
