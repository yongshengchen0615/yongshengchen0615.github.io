(function () {
  'use strict';

  const $ = (selector) => document.querySelector(selector);
  let members = [];
  let searchTimer = null;
  const statusLabel = { active: '有效', suspended: '停權', disabled: '停用' };
  const voucherStatusLabel = { issued: '可使用', processing: '處理中', redeemed: '已核銷', cancelled: '已取消', expired: '已過期' };
  const scanModeLabel = { single: '單次掃描', repeatable: '可重複掃描' };

  function formatMinutes(value) {
    return new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 }).format(Number(value || 0));
  }

  function toLocalDateTimeInput(date) {
    const pad = (value) => String(value).padStart(2, '0');
    return [date.getFullYear(), '-', pad(date.getMonth() + 1), '-', pad(date.getDate()), 'T', pad(date.getHours()), ':', pad(date.getMinutes())].join('');
  }

  function formatDateTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date);
  }

  async function loadMembers(query) {
    const result = await Membership.callApi('admin.list', { query: query || '', page: 1, pageSize: 100 });
    members = result.members || [];
    renderMetrics(result.stats || {});
    renderTable(members, result.total || 0);
    $('#adminBoot').classList.add('hidden');
    $('#adminError').classList.add('hidden');
    $('#adminApp').classList.remove('hidden');
  }

  async function loadVouchers() {
    const result = await Membership.callApi('admin.usage.list', { limit: 50 });
    renderVouchers(result.vouchers || []);
  }

  async function loadDashboard() {
    await Promise.all([loadMembers(''), loadVouchers()]);
  }

  function renderMetrics(stats) {
    $('#metricTotal').textContent = Number(stats.total || 0);
    $('#metricActive').textContent = Number(stats.active || 0);
    $('#metricAvailableMinutes').textContent = formatMinutes(stats.availableMinutes);
    $('#metricConsumedMinutes').textContent = formatMinutes(stats.consumedMinutes);
  }

  function renderTable(rows, total) {
    const body = $('#memberTableBody');
    body.replaceChildren();
    $('#resultCount').textContent = `${total} 筆`;
    $('#emptyState').classList.toggle('hidden', rows.length !== 0);

    rows.forEach((member) => {
      const tr = document.createElement('tr');
      const memberTd = document.createElement('td');
      const memberCell = document.createElement('div');
      memberCell.className = 'member-cell';
      const img = document.createElement('img');
      img.alt = '';
      img.src = member.pictureUrl || 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="80" height="80"%3E%3Crect width="100%25" height="100%25" fill="%23eef2f6"/%3E%3C/svg%3E';
      const identity = document.createElement('div');
      const name = document.createElement('strong');
      name.textContent = member.displayName || 'LINE 會員';
      const joined = document.createElement('small');
      joined.textContent = `加入 ${Membership.formatDate(member.joinedAt)}`;
      identity.append(name, joined);
      memberCell.append(img, identity);
      memberTd.append(memberCell);

      const numberTd = document.createElement('td'); numberTd.textContent = member.memberNo;
      const tierTd = document.createElement('td'); tierTd.textContent = String(member.tier || '').toUpperCase();
      const statusTd = document.createElement('td');
      const status = document.createElement('span');
      status.className = `table-status ${member.membershipStatus === 'active' ? '' : member.membershipStatus}`.trim();
      status.textContent = statusLabel[member.membershipStatus] || member.membershipStatus;
      statusTd.append(status);
      const availableTd = document.createElement('td'); availableTd.textContent = `${formatMinutes(member.availableMinutes)} 分鐘`;
      const consumedTd = document.createElement('td'); consumedTd.textContent = `${formatMinutes(member.consumedMinutes)} 分鐘`;
      const expiryTd = document.createElement('td'); expiryTd.textContent = Membership.formatDate(member.expiresAt, '永久');
      const actionTd = document.createElement('td');
      const edit = document.createElement('button');
      edit.className = 'text-button'; edit.type = 'button'; edit.textContent = '編輯';
      edit.addEventListener('click', () => openEdit(member));
      actionTd.append(edit);
      tr.append(memberTd, numberTd, tierTd, statusTd, availableTd, consumedTd, expiryTd, actionTd);
      body.append(tr);
    });
  }

  function renderVouchers(vouchers) {
    const body = $('#voucherTableBody');
    body.replaceChildren();
    $('#voucherEmptyState').classList.toggle('hidden', vouchers.length !== 0);

    vouchers.forEach((voucher) => {
      const tr = document.createElement('tr');
      const idTd = document.createElement('td'); idTd.textContent = voucher.voucherId;
      const modeTd = document.createElement('td');
      modeTd.textContent = voucher.legacyTargeted ? '舊版指定會員' : (scanModeLabel[voucher.scanMode] || voucher.scanMode);
      const minutesTd = document.createElement('td'); minutesTd.textContent = `${formatMinutes(voucher.minutes)} 分鐘`;
      const countTd = document.createElement('td'); countTd.textContent = `${formatMinutes(voucher.redemptionCount)} 次`;
      const statusTd = document.createElement('td');
      const badge = document.createElement('span');
      badge.className = `voucher-status ${voucher.status}`;
      badge.textContent = voucherStatusLabel[voucher.status] || voucher.status;
      statusTd.append(badge);
      const expiryTd = document.createElement('td'); expiryTd.textContent = formatDateTime(voucher.expiresAt);
      const actionTd = document.createElement('td');
      if (voucher.status === 'issued') {
        const cancel = document.createElement('button');
        cancel.className = 'text-button danger-action'; cancel.type = 'button'; cancel.textContent = '取消';
        cancel.addEventListener('click', () => cancelVoucher(voucher.voucherId));
        actionTd.append(cancel);
      } else actionTd.textContent = '—';
      tr.append(idTd, modeTd, minutesTd, countTd, statusTd, expiryTd, actionTd);
      body.append(tr);
    });
  }

  function openEdit(member) {
    $('#editMemberName').textContent = member.displayName || 'LINE 會員';
    $('#editMemberNo').textContent = member.memberNo;
    $('#editTargetMemberNo').value = member.memberNo;
    $('#editExpectedUpdatedAt').value = member.updatedAt;
    $('#editTier').value = member.tier;
    $('#editStatus').value = member.membershipStatus;
    $('#editAvailableMinutes').value = String(Number(member.availableMinutes || 0));
    $('#editConsumedMinutes').value = `${formatMinutes(member.consumedMinutes)} 分鐘`;
    $('#editExpiresAt').value = member.expiresAt ? String(member.expiresAt).slice(0, 10) : '';
    $('#editNote').value = member.note || '';
    $('#editError').classList.add('hidden');
    $('#editDialog').showModal();
  }

  async function saveMember() {
    const button = $('#saveMemberButton');
    button.disabled = true;
    $('#editError').classList.add('hidden');
    try {
      await Membership.callApi('admin.update', {
        targetMemberNo: $('#editTargetMemberNo').value,
        expectedUpdatedAt: $('#editExpectedUpdatedAt').value,
        tier: $('#editTier').value,
        membershipStatus: $('#editStatus').value,
        availableMinutes: $('#editAvailableMinutes').value,
        expiresAt: $('#editExpiresAt').value,
        note: $('#editNote').value
      });
      $('#editDialog').close();
      await loadMembers($('#memberSearch').value.trim());
    } catch (error) {
      $('#editError').textContent = error.message;
      $('#editError').classList.remove('hidden');
    } finally { button.disabled = false; }
  }

  function openUsageDialog() {
    $('#usageMinutes').value = '60';
    $('#usageScanMode').value = 'single';
    $('#usageExpiresAt').value = toLocalDateTimeInput(new Date(Date.now() + 24 * 60 * 60 * 1000));
    $('#usageNote').value = '';
    $('#usageError').classList.add('hidden');
    $('#usageResult').classList.add('hidden');
    $('#copyUsageUrlButton').classList.add('hidden');
    $('#createUsageButton').classList.remove('hidden');
    $('#usageCreateFields').classList.remove('hidden');
    $('#usageQrCode').replaceChildren();
    $('#usageUrl').value = '';
    $('#usageDialog').showModal();
  }

  function buildUsageUrl(token) {
    const url = new URL('../user/', window.location.href);
    url.search = '';
    url.hash = '';
    url.searchParams.set('redeem', token);
    return url.href;
  }

  function renderQrCode(url) {
    if (typeof window.qrcode !== 'function') throw new Error('QR Code 元件載入失敗，請重新整理後再試。');
    const qr = window.qrcode(0, 'M');
    qr.addData(url); qr.make();
    $('#usageQrCode').innerHTML = qr.createSvgTag({ cellSize: 5, margin: 4, scalable: true });
  }

  async function createUsageVoucher() {
    const button = $('#createUsageButton');
    button.disabled = true;
    $('#usageError').classList.add('hidden');
    try {
      const minutes = Number($('#usageMinutes').value);
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > 60000) throw new Error('消費分鐘必須是 1 到 60000 的整數。');
      const expiryValue = $('#usageExpiresAt').value;
      const expiryDate = new Date(expiryValue);
      if (!expiryValue || Number.isNaN(expiryDate.getTime())) throw new Error('請設定有效的 QR Code 到期時間。');

      const result = await Membership.callApi('admin.usage.create', {
        minutes,
        scanMode: $('#usageScanMode').value,
        expiresAt: expiryDate.toISOString(),
        note: $('#usageNote').value
      });
      const url = buildUsageUrl(result.token);
      $('#usageUrl').value = url;
      renderQrCode(url);
      $('#usageCreateFields').classList.add('hidden');
      $('#usageResult').classList.remove('hidden');
      $('#copyUsageUrlButton').classList.remove('hidden');
      $('#createUsageButton').classList.add('hidden');
      await loadVouchers();
    } catch (error) {
      $('#usageError').textContent = error.message;
      $('#usageError').classList.remove('hidden');
    } finally { button.disabled = false; }
  }

  async function copyUsageUrl() {
    const value = $('#usageUrl').value;
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      $('#copyUsageUrlButton').textContent = '已複製';
      window.setTimeout(() => { $('#copyUsageUrlButton').textContent = '複製網址'; }, 1500);
    } catch (_) {
      $('#usageUrl').focus(); $('#usageUrl').select(); document.execCommand('copy');
    }
  }

  async function cancelVoucher(voucherId) {
    if (!window.confirm('確定要停止這個 QR Code 的後續核銷？')) return;
    try {
      await Membership.callApi('admin.usage.cancel', { voucherId });
      await loadVouchers();
    } catch (error) { showAdminError(error); }
  }

  function showAdminError(error) {
    $('#adminBoot').classList.add('hidden');
    $('#adminApp').classList.add('hidden');
    $('#adminErrorMessage').textContent = error && error.message ? error.message : '無法驗證管理權限。';
    $('#adminError').classList.remove('hidden');
  }

  async function initialize() {
    try {
      const loggedIn = await Membership.ensureLiffLogin();
      if (!loggedIn) return;
      await loadDashboard();
    } catch (error) { showAdminError(error); }
  }

  $('#memberSearch').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => loadMembers($('#memberSearch').value.trim()).catch(showAdminError), 300);
  });
  $('#adminRefreshButton').addEventListener('click', () => loadDashboard().catch(showAdminError));
  $('#adminRetryButton').addEventListener('click', () => window.location.reload());
  $('#usageRefreshButton').addEventListener('click', () => loadVouchers().catch(showAdminError));
  $('#newUsageQrButton').addEventListener('click', openUsageDialog);
  $('#saveMemberButton').addEventListener('click', saveMember);
  $('#createUsageButton').addEventListener('click', createUsageVoucher);
  $('#copyUsageUrlButton').addEventListener('click', copyUsageUrl);

  initialize();
})();
