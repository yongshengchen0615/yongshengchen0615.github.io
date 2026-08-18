(function () {
  'use strict';

  const $ = (selector) => document.querySelector(selector);
  let members = [];
  let usageMemberChoices = [];
  let searchTimer = null;
  let usageSearchTimer = null;
  const statusLabel = { active: '有效', suspended: '停權', disabled: '停用' };
  const voucherStatusLabel = { issued: '可使用', processing: '處理中', redeemed: '已核銷', cancelled: '已取消', expired: '已過期' };

  function formatHours(minutes) {
    const value = Number(minutes || 0) / 60;
    return new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 2 }).format(value);
  }

  function toInputHours(minutes) {
    return String(Number(minutes || 0) / 60);
  }

  function toLocalDateTimeInput(date) {
    const pad = (value) => String(value).padStart(2, '0');
    return [date.getFullYear(), '-', pad(date.getMonth() + 1), '-', pad(date.getDate()), 'T', pad(date.getHours()), ':', pad(date.getMinutes())].join('');
  }

  async function loadMembers(query) {
    const result = await Membership.callApi('admin.list', { query: query || '', page: 1, pageSize: 100 });
    members = result.members;
    renderMetrics(result.stats);
    renderTable(members, result.total);
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
    $('#metricTotal').textContent = stats.total;
    $('#metricActive').textContent = stats.active;
    $('#metricAvailableHours').textContent = formatHours(stats.availableMinutes);
    $('#metricConsumedHours').textContent = formatHours(stats.consumedMinutes);
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
      const availableTd = document.createElement('td'); availableTd.textContent = `${formatHours(member.availableMinutes)} 小時`;
      const consumedTd = document.createElement('td'); consumedTd.textContent = `${formatHours(member.consumedMinutes)} 小時`;
      const expiryTd = document.createElement('td'); expiryTd.textContent = Membership.formatDate(member.expiresAt, '永久');
      const actionTd = document.createElement('td');
      const actionGroup = document.createElement('div'); actionGroup.className = 'row-actions';

      const edit = document.createElement('button');
      edit.className = 'text-button'; edit.type = 'button'; edit.textContent = '編輯';
      edit.addEventListener('click', () => openEdit(member));
      const issue = document.createElement('button');
      issue.className = 'text-button'; issue.type = 'button'; issue.textContent = '發放核銷';
      issue.disabled = member.membershipStatus !== 'active' || Number(member.availableMinutes || 0) <= 0;
      issue.addEventListener('click', () => openUsageDialog(member).catch(showAdminError));

      actionGroup.append(edit, issue);
      actionTd.append(actionGroup);
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
      const memberTd = document.createElement('td'); memberTd.textContent = voucher.targetMemberNo;
      const hoursTd = document.createElement('td'); hoursTd.textContent = `${formatHours(voucher.minutes)} 小時`;
      const statusTd = document.createElement('td');
      const badge = document.createElement('span'); badge.className = `voucher-status ${voucher.status}`; badge.textContent = voucherStatusLabel[voucher.status] || voucher.status; statusTd.append(badge);
      const expiryTd = document.createElement('td');
      expiryTd.textContent = new Intl.DateTimeFormat('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(voucher.expiresAt));
      const actionTd = document.createElement('td');
      if (voucher.status === 'issued') {
        const cancel = document.createElement('button');
        cancel.className = 'text-button danger-action'; cancel.type = 'button'; cancel.textContent = '取消';
        cancel.addEventListener('click', () => cancelVoucher(voucher.voucherId));
        actionTd.append(cancel);
      } else actionTd.textContent = '—';
      tr.append(idTd, memberTd, hoursTd, statusTd, expiryTd, actionTd);
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
    $('#editAvailableHours').value = toInputHours(member.availableMinutes);
    $('#editConsumedHours').value = `${formatHours(member.consumedMinutes)} 小時`;
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
        availableHours: $('#editAvailableHours').value,
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

  function selectedUsageMember() {
    const memberNo = $('#usageTargetMemberNo').value;
    return usageMemberChoices.find((member) => member.memberNo === memberNo) || null;
  }

  function updateUsageMemberSummary() {
    const member = selectedUsageMember();
    if (!member) {
      $('#usageMemberSummary').textContent = '請先選擇要發放的會員。';
      return;
    }
    $('#usageMemberSummary').textContent = `${member.displayName || 'LINE 會員'} · ${member.memberNo} · 可用 ${formatHours(member.availableMinutes)} 小時`;
  }

  function populateUsageMemberSelect(rows, preferredMemberNo) {
    usageMemberChoices = rows || [];
    const select = $('#usageTargetMemberNo');
    select.replaceChildren();

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = usageMemberChoices.length ? '請選擇會員' : '找不到會員';
    select.append(placeholder);

    usageMemberChoices.forEach((member) => {
      const option = document.createElement('option');
      option.value = member.memberNo;
      option.textContent = `${member.memberNo} — ${member.displayName || 'LINE 會員'} — 可用 ${formatHours(member.availableMinutes)} 小時`;
      option.disabled = member.membershipStatus !== 'active' || Number(member.availableMinutes || 0) <= 0;
      select.append(option);
    });

    if (preferredMemberNo && usageMemberChoices.some((member) => member.memberNo === preferredMemberNo)) {
      select.value = preferredMemberNo;
    }
    updateUsageMemberSummary();
  }

  async function searchUsageMembers(query, preferredMemberNo) {
    const result = await Membership.callApi('admin.list', { query: query || '', page: 1, pageSize: 50 });
    populateUsageMemberSelect(result.members || [], preferredMemberNo || '');
  }

  async function openUsageDialog(member) {
    $('#usageHours').value = '1';
    $('#usageExpiresAt').value = toLocalDateTimeInput(new Date(Date.now() + 24 * 60 * 60 * 1000));
    $('#usageNote').value = '';
    $('#usageMemberSearch').value = member ? member.memberNo : '';
    $('#usageError').classList.add('hidden');
    $('#usageResult').classList.add('hidden');
    $('#copyUsageUrlButton').classList.add('hidden');
    $('#createUsageButton').classList.remove('hidden');
    $('#usageCreateFields').classList.remove('hidden');
    $('#usageQrCode').replaceChildren();
    $('#usageUrl').value = '';
    $('#usageDialog').showModal();

    try {
      await searchUsageMembers(member ? member.memberNo : '', member ? member.memberNo : '');
    } catch (error) {
      $('#usageError').textContent = error.message;
      $('#usageError').classList.remove('hidden');
    }
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
      const targetMemberNo = $('#usageTargetMemberNo').value;
      if (!targetMemberNo) throw new Error('請先選擇要發放的會員。');
      const expiryValue = $('#usageExpiresAt').value;
      const expiryDate = new Date(expiryValue);
      if (!expiryValue || Number.isNaN(expiryDate.getTime())) throw new Error('請設定有效的核銷券到期時間。');

      const result = await Membership.callApi('admin.usage.create', {
        targetMemberNo,
        hours: $('#usageHours').value,
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
    if (!window.confirm('確定要取消這張尚未使用的時數核銷券？')) return;
    try {
      await Membership.callApi('admin.usage.cancel', { voucherId });
      await Promise.all([loadVouchers(), loadMembers($('#memberSearch').value.trim())]);
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
  $('#usageMemberSearch').addEventListener('input', () => {
    clearTimeout(usageSearchTimer);
    usageSearchTimer = setTimeout(() => {
      searchUsageMembers($('#usageMemberSearch').value.trim()).catch((error) => {
        $('#usageError').textContent = error.message;
        $('#usageError').classList.remove('hidden');
      });
    }, 300);
  });
  $('#usageTargetMemberNo').addEventListener('change', updateUsageMemberSummary);
  $('#adminRefreshButton').addEventListener('click', () => loadDashboard().catch(showAdminError));
  $('#adminRetryButton').addEventListener('click', () => window.location.reload());
  $('#usageRefreshButton').addEventListener('click', () => loadVouchers().catch(showAdminError));
  $('#newUsageQrButton').addEventListener('click', () => openUsageDialog(null));
  $('#saveMemberButton').addEventListener('click', saveMember);
  $('#createUsageButton').addEventListener('click', createUsageVoucher);
  $('#copyUsageUrlButton').addEventListener('click', copyUsageUrl);

  initialize();
})();
