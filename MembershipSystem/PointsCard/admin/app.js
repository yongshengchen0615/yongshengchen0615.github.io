(function () {
  'use strict';

  const $ = function (id) { return document.getElementById(id); };
  const statusLabels = { active: '有效', suspended: '停權', disabled: '停用' };
  const modeLabels = { single: '單次使用', repeatable: '可重複使用' };
  const voucherStatusLabels = { active: '有效', cancelled: '已停止', expired: '已過期', used: '已使用' };
  const avatarFallback = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="72" height="72"%3E%3Crect width="72" height="72" rx="36" fill="%23dfe5df"/%3E%3Ccircle cx="36" cy="28" r="13" fill="%23173f35" fill-opacity=".3"/%3E%3Cpath d="M14 68c2-14 10-21 22-21s20 7 22 21" fill="%23173f35" fill-opacity=".3"/%3E%3C/svg%3E';
  let members = [];
  let vouchers = [];
  let rewardName = '本期集點獎勵';
  let searchTimer = 0;
  let toastTimer = 0;
  let rewardRetry = null;
  let selectedRewardMember = null;
  let currentQrSvg = '';
  let dashboardRequestSequence = 0;

  function formatNumber(value) {
    return new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 }).format(Number(value || 0));
  }

  function showFatalError(error) {
    $('bootState').classList.add('hidden');
    $('adminApp').classList.add('hidden');
    $('errorMessage').textContent = error && error.message ? error.message : '請確認管理權限後再試。';
    $('errorState').classList.remove('hidden');
  }

  function showToast(message) {
    window.clearTimeout(toastTimer);
    $('toast').textContent = message;
    $('toast').classList.remove('hidden');
    toastTimer = window.setTimeout(function () { $('toast').classList.add('hidden'); }, 3600);
  }

  function showFormError(id, error) {
    const target = $(id);
    target.textContent = error && error.message ? error.message : '操作失敗，請稍後再試。';
    target.classList.remove('hidden');
  }

  function clearFormError(id) {
    $(id).textContent = '';
    $(id).classList.add('hidden');
  }

  function openDialog(dialog) {
    if (!dialog.open) dialog.showModal();
  }

  function closeDialog(dialog) {
    if (dialog.open) dialog.close();
  }

  function createTextButton(label, className, handler, disabled) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'text-button' + (className ? ' ' + className : '');
    button.textContent = label;
    button.disabled = Boolean(disabled);
    button.addEventListener('click', handler);
    return button;
  }

  function renderMetrics(stats) {
    $('metricMembers').textContent = formatNumber(stats.totalMembers);
    $('metricActive').textContent = formatNumber(stats.activeMembers) + ' 位有效會員';
    $('metricStamps').textContent = formatNumber(stats.totalStamps);
    $('metricRewards').textContent = formatNumber(stats.redeemedRewards);
    $('rewardNameMetric').textContent = rewardName;
  }

  function renderMembers() {
    const body = $('memberTableBody');
    body.replaceChildren();
    $('memberEmptyState').classList.toggle('hidden', members.length !== 0);
    members.forEach(function (member) {
      const row = document.createElement('tr');
      const memberTd = document.createElement('td');
      const memberCell = document.createElement('div');
      memberCell.className = 'member-cell';
      const avatar = document.createElement('img');
      avatar.className = 'member-avatar';
      avatar.alt = '';
      avatar.referrerPolicy = 'no-referrer';
      avatar.src = member.pictureUrl || avatarFallback;
      avatar.addEventListener('error', function () { avatar.src = avatarFallback; });
      const memberCopy = document.createElement('div');
      const name = document.createElement('strong');
      name.textContent = member.displayName || 'LINE 會員';
      const number = document.createElement('span');
      number.textContent = member.memberNo;
      memberCopy.append(name, number);
      memberCell.append(avatar, memberCopy);
      memberTd.append(memberCell);

      const statusTd = document.createElement('td');
      const status = document.createElement('span');
      status.className = 'status-badge ' + member.membershipStatus;
      status.textContent = statusLabels[member.membershipStatus] || member.membershipStatus;
      statusTd.append(status);
      const totalTd = document.createElement('td');
      totalTd.textContent = formatNumber(member.totalStamps) + ' 點';
      const rewardsTd = document.createElement('td');
      const rewards = document.createElement('span');
      rewards.className = 'reward-number';
      rewards.textContent = formatNumber(member.availableRewards) + ' 份';
      rewardsTd.append(rewards);
      const joinedTd = document.createElement('td');
      joinedTd.textContent = PointsCard.formatDate(member.joinedAt, '—');
      const actionsTd = document.createElement('td');
      const actions = document.createElement('div');
      actions.className = 'row-actions';
      actions.append(
        createTextButton('兌換', 'accent', function () { openReward(member); }, Number(member.availableRewards) < 1 || member.membershipStatus !== 'active'),
        createTextButton('管理', '', function () { openMember(member); }, false)
      );
      actionsTd.append(actions);
      row.append(memberTd, statusTd, totalTd, rewardsTd, joinedTd, actionsTd);
      body.append(row);
    });
  }

  function effectiveVoucherStatus(voucher) {
    if (voucher.status !== 'active') return voucher.status;
    if (voucher.scanMode === 'single' && Number(voucher.recordCount || 0) > 0) return 'used';
    if (new Date(voucher.expiresAt).getTime() <= Date.now()) return 'expired';
    return 'active';
  }

  function renderVouchers() {
    const body = $('voucherTableBody');
    body.replaceChildren();
    $('voucherEmptyState').classList.toggle('hidden', vouchers.length !== 0);
    vouchers.forEach(function (voucher) {
      const row = document.createElement('tr');
      const idTd = document.createElement('td'); idTd.textContent = voucher.voucherId;
      const stampsTd = document.createElement('td'); stampsTd.textContent = '+' + formatNumber(voucher.stampCount);
      const modeTd = document.createElement('td'); modeTd.textContent = modeLabels[voucher.scanMode] || voucher.scanMode;
      const countTd = document.createElement('td'); countTd.textContent = formatNumber(voucher.recordCount);
      const statusTd = document.createElement('td');
      const state = effectiveVoucherStatus(voucher);
      const status = document.createElement('span'); status.className = 'status-badge ' + state; status.textContent = voucherStatusLabels[state] || state; statusTd.append(status);
      const expiryTd = document.createElement('td'); expiryTd.textContent = PointsCard.formatDateTime(voucher.expiresAt, '—');
      const actionsTd = document.createElement('td');
      const actions = document.createElement('div'); actions.className = 'row-actions';
      actions.append(createTextButton('開啟', '', function () { openVoucher(voucher.voucherId); }, state === 'cancelled'));
      if (state === 'active') actions.append(createTextButton('停止', 'danger', function () { cancelVoucher(voucher); }, false));
      actions.append(createTextButton('刪除', 'danger', function () { deleteVoucher(voucher); }, Number(voucher.recordCount || 0) > 0));
      actionsTd.append(actions);
      row.append(idTd, stampsTd, modeTd, countTd, statusTd, expiryTd, actionsTd);
      body.append(row);
    });
  }

  async function loadDashboard(query) {
    const requestSequence = ++dashboardRequestSequence;
    const result = await PointsCard.callApi('admin.dashboard', { query: query || '', pageSize: 100, voucherLimit: 50 });
    if (requestSequence !== dashboardRequestSequence) return;
    members = result.members || [];
    vouchers = result.vouchers || [];
    rewardName = result.settings && result.settings.rewardName || rewardName;
    renderMetrics(result.stats || {});
    renderMembers();
    renderVouchers();
    $('bootState').classList.add('hidden');
    $('errorState').classList.add('hidden');
    $('adminApp').classList.remove('hidden');
  }

  function openMember(member) {
    clearFormError('memberFormError');
    $('memberDialogTitle').textContent = member.displayName || '管理會員';
    $('memberDialogNumber').textContent = member.memberNo;
    $('memberTargetNo').value = member.memberNo;
    $('memberExpectedUpdatedAt').value = member.updatedAt;
    $('memberStatus').value = member.membershipStatus;
    $('memberTotalStamps').value = formatNumber(member.totalStamps) + ' 點';
    $('memberAvailableRewards').value = formatNumber(member.availableRewards) + ' 份';
    $('memberNote').value = member.note || '';
    openDialog($('memberDialog'));
  }

  async function saveMember() {
    clearFormError('memberFormError');
    $('saveMemberButton').disabled = true;
    try {
      const result = await PointsCard.callApi('admin.member.update', {
        targetMemberNo: $('memberTargetNo').value,
        expectedUpdatedAt: $('memberExpectedUpdatedAt').value,
        membershipStatus: $('memberStatus').value,
        note: $('memberNote').value
      });
      const index = members.findIndex(function (member) { return member.memberNo === result.member.memberNo; });
      if (index >= 0) members[index] = result.member;
      renderMembers();
      closeDialog($('memberDialog'));
      showToast('會員資料已更新。');
    } catch (error) {
      showFormError('memberFormError', error);
    } finally {
      $('saveMemberButton').disabled = false;
    }
  }

  function openReward(member) {
    if (!selectedRewardMember || selectedRewardMember.memberNo !== member.memberNo) rewardRetry = null;
    selectedRewardMember = member;
    clearFormError('rewardFormError');
    $('rewardDialogTitle').textContent = '兌換 ' + rewardName;
    $('rewardMemberMeta').textContent = (member.displayName || 'LINE 會員') + ' · ' + member.memberNo + ' · 可兌換 ' + formatNumber(member.availableRewards) + ' 份';
    $('rewardPreviewName').textContent = rewardName;
    $('rewardNote').value = '';
    openDialog($('rewardDialog'));
  }

  function rewardRequestId(memberNo, note) {
    const fingerprint = memberNo + '|' + note;
    if (rewardRetry && rewardRetry.fingerprint === fingerprint) return rewardRetry.requestId;
    rewardRetry = { fingerprint: fingerprint, requestId: PointsCard.randomHex(16) };
    return rewardRetry.requestId;
  }

  async function redeemReward() {
    if (!selectedRewardMember) return;
    clearFormError('rewardFormError');
    const note = $('rewardNote').value.trim() || '門市現場兌換';
    $('confirmRewardButton').disabled = true;
    try {
      const result = await PointsCard.callApi('admin.reward.redeem', {
        targetMemberNo: selectedRewardMember.memberNo,
        expectedUpdatedAt: selectedRewardMember.updatedAt,
        note: note,
        requestId: rewardRequestId(selectedRewardMember.memberNo, note)
      });
      rewardRetry = null;
      selectedRewardMember = null;
      closeDialog($('rewardDialog'));
      await loadDashboard($('memberSearch').value.trim());
      showToast(result.duplicate ? '此兌換先前已完成，資料已同步。' : '獎勵兌換完成。');
    } catch (error) {
      showFormError('rewardFormError', error);
    } finally {
      $('confirmRewardButton').disabled = false;
    }
  }

  function toLocalDateTimeInput(date) {
    const value = new Date(date);
    const offset = value.getTimezoneOffset() * 60000;
    return new Date(value.getTime() - offset).toISOString().slice(0, 16);
  }

  function resetStampDialog() {
    clearFormError('stampFormError');
    currentQrSvg = '';
    $('stampDialogTitle').textContent = '新增集點 QR Code';
    $('stampDialogDescription').textContent = '建立後交由會員使用 LINE 掃描。';
    $('stampCount').value = '1';
    $('stampMode').value = 'single';
    $('stampExpiresAt').value = toLocalDateTimeInput(Date.now() + 24 * 60 * 60 * 1000);
    $('stampNote').value = '';
    $('stampFields').classList.remove('hidden');
    $('stampResult').classList.add('hidden');
    $('copyStampButton').classList.add('hidden');
    $('downloadStampButton').classList.add('hidden');
    $('createStampButton').classList.remove('hidden');
    $('stampQrCode').replaceChildren();
  }

  function openNewStamp() {
    resetStampDialog();
    openDialog($('stampDialog'));
  }

  function readStampForm() {
    const stampCount = Number($('stampCount').value);
    if (!Number.isInteger(stampCount) || stampCount < 1 || stampCount > 10) throw new Error('集點數量必須是 1 到 10 的整數。');
    const expiry = new Date($('stampExpiresAt').value);
    if (!Number.isFinite(expiry.getTime()) || expiry.getTime() <= Date.now()) throw new Error('到期時間必須晚於現在。');
    return { stampCount: stampCount, scanMode: $('stampMode').value, expiresAt: expiry.toISOString(), note: $('stampNote').value };
  }

  async function buildStampUrl(shareCode) {
    const config = await PointsCard.loadConfig();
    const url = new URL('https://liff.line.me/' + encodeURIComponent(config.LIFF_ID) + '/');
    url.searchParams.set('stamp', shareCode);
    return url.href;
  }

  async function showVoucher(voucher) {
    if (typeof window.qrcode !== 'function') throw new Error('QR Code 元件載入失敗，請重新整理後再試。');
    const url = await buildStampUrl(voucher.shareCode);
    const qr = window.qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    currentQrSvg = qr.createSvgTag({ cellSize: 6, margin: 0, scalable: true });
    $('stampQrCode').innerHTML = currentQrSvg;
    $('stampUrl').value = url;
    $('stampResultMeta').textContent = voucher.voucherId + ' · +' + formatNumber(voucher.stampCount) + ' 點 · ' + (modeLabels[voucher.scanMode] || voucher.scanMode);
    $('stampFields').classList.add('hidden');
    $('stampResult').classList.remove('hidden');
    $('copyStampButton').classList.remove('hidden');
    $('downloadStampButton').classList.remove('hidden');
    $('createStampButton').classList.add('hidden');
  }

  async function createStamp() {
    clearFormError('stampFormError');
    $('createStampButton').disabled = true;
    try {
      const result = await PointsCard.callApi('admin.stamp.create', readStampForm());
      vouchers.unshift(result.voucher);
      renderVouchers();
      await showVoucher(result.voucher);
      $('stampDialogTitle').textContent = '集點 QR Code 已建立';
      $('stampDialogDescription').textContent = '可下載 QR 或複製連結交給會員。';
    } catch (error) {
      showFormError('stampFormError', error);
    } finally {
      $('createStampButton').disabled = false;
    }
  }

  async function openVoucher(voucherId) {
    resetStampDialog();
    $('stampDialogTitle').textContent = '開啟集點 QR Code';
    openDialog($('stampDialog'));
    try {
      const result = await PointsCard.callApi('admin.stamp.open', { voucherId: voucherId });
      await showVoucher(result.voucher);
    } catch (error) {
      showFormError('stampFormError', error);
    }
  }

  async function cancelVoucher(voucher) {
    if (!window.confirm('停止後這組 QR Code 將不能再集點，確定繼續？')) return;
    try {
      await PointsCard.callApi('admin.stamp.cancel', { voucherId: voucher.voucherId, expectedUpdatedAt: voucher.updatedAt });
      await loadDashboard($('memberSearch').value.trim());
      showToast('QR Code 已停止。');
    } catch (error) { showToast(error.message); }
  }

  async function deleteVoucher(voucher) {
    if (!window.confirm('確定刪除這組尚未使用的 QR Code？')) return;
    try {
      await PointsCard.callApi('admin.stamp.delete', { voucherId: voucher.voucherId, expectedUpdatedAt: voucher.updatedAt });
      vouchers = vouchers.filter(function (item) { return item.voucherId !== voucher.voucherId; });
      renderVouchers();
      showToast('QR Code 已刪除。');
    } catch (error) { showToast(error.message); }
  }

  async function copyStampUrl() {
    const value = $('stampUrl').value;
    try {
      await navigator.clipboard.writeText(value);
      showToast('集點連結已複製。');
    } catch (_) {
      $('stampUrl').focus();
      $('stampUrl').select();
      document.execCommand('copy');
      showToast('集點連結已複製。');
    }
  }

  function downloadStampQr() {
    if (!currentQrSvg) return;
    const blob = new Blob([currentQrSvg], { type: 'image/svg+xml;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'points-card-stamp-qr.svg';
    link.click();
    window.setTimeout(function () { URL.revokeObjectURL(link.href); }, 1000);
  }

  function bindEvents() {
    $('retryButton').addEventListener('click', function () { window.location.reload(); });
    $('refreshButton').addEventListener('click', function () {
      $('refreshButton').disabled = true;
      loadDashboard($('memberSearch').value.trim()).catch(showFatalError).finally(function () { $('refreshButton').disabled = false; });
    });
    $('memberSearch').addEventListener('input', function () {
      window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(function () { loadDashboard($('memberSearch').value.trim()).catch(showFatalError); }, 300);
    });
    $('saveMemberButton').addEventListener('click', saveMember);
    $('confirmRewardButton').addEventListener('click', redeemReward);
    $('newStampButton').addEventListener('click', openNewStamp);
    $('createStampButton').addEventListener('click', createStamp);
    $('copyStampButton').addEventListener('click', copyStampUrl);
    $('downloadStampButton').addEventListener('click', downloadStampQr);
  }

  async function init() {
    bindEvents();
    const authenticated = await PointsCard.ensureLiffLogin();
    if (!authenticated) return;
    await loadDashboard('');
  }

  init().catch(showFatalError);
})();
