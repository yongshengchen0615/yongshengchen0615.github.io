(function () {
  'use strict';

  const $ = (selector) => document.querySelector(selector);
  let members = [];
  let memberTotal = 0;
  let vouchers = [];
  let dashboardStats = { total: 0, active: 0, consumedMinutes: 0 };
  let searchTimer = null;
  let currentQrSvg = '';
  let currentQrVoucherId = '';
  let publicConfig = null;
  const statusLabel = { active: '有效', suspended: '停權', disabled: '停用' };
  const tierLabel = { standard: '一般', silver: '銀級', gold: '金級', platinum: '白金', vip: '白金' };
  const voucherStatusLabel = { issued: '可使用', redeemed: '已記錄', cancelled: '已停止', expired: '已過期' };
  const scanModeLabel = { single: '單次掃描', repeatable: '可重複掃描' };

  function formatMinutes(value) {
    return new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 }).format(Number(value || 0));
  }

  function normalizeTierKey(value) {
    const tier = String(value || '').trim().toLowerCase();
    if (tier === 'vip') return 'platinum';
    return Object.prototype.hasOwnProperty.call(tierLabel, tier) ? tier : 'standard';
  }

  function tierForMinutes(value, thresholds) {
    const minutes = Math.max(0, Math.floor(Number(value || 0)));
    if (minutes >= Number(thresholds.platinum || Infinity)) return 'platinum';
    if (minutes >= Number(thresholds.gold || Infinity)) return 'gold';
    if (minutes >= Number(thresholds.silver || Infinity)) return 'silver';
    return 'standard';
  }

  function toLocalDateTimeInput(date) {
    const pad = (value) => String(value).padStart(2, '0');
    return [date.getFullYear(), '-', pad(date.getMonth() + 1), '-', pad(date.getDate()), 'T', pad(date.getHours()), ':', pad(date.getMinutes())].join('');
  }

  function formatDateTime(value) {
    if (!value) return '永久';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date);
  }

  function syncUsageExpiryMode() {
    const mode = $('#usageExpiryMode').value;
    const expiryInput = $('#usageExpiresAt');
    const timed = mode === 'timed';
    expiryInput.disabled = !timed;
    expiryInput.required = timed;
    if (timed && !expiryInput.value) {
      expiryInput.value = toLocalDateTimeInput(new Date(Date.now() + 24 * 60 * 60 * 1000));
    }
  }

  function showAdminApp() {
    $('#adminBoot').classList.add('hidden');
    $('#adminError').classList.add('hidden');
    $('#adminApp').classList.remove('hidden');
  }

  async function loadMembers(query) {
    const result = await Membership.callApi('admin.list', { query: query || '', page: 1, pageSize: 100 });
    members = result.members || [];
    memberTotal = Number(result.total || 0);
    renderMetrics(result.stats || {});
    renderTable(members, memberTotal);
    showAdminApp();
  }

  async function loadVouchers() {
    const result = await Membership.callApi('admin.usage.list', { limit: 50 });
    vouchers = result.vouchers || [];
    renderVouchers(vouchers);
  }

  async function loadDashboardLegacy() {
    const [memberResult, tierResult, voucherResult] = await Promise.all([
      Membership.callApi('admin.list', { query: '', page: 1, pageSize: 100 }),
      Membership.callApi('admin.tier.get'),
      Membership.callApi('admin.usage.list', { limit: 50 })
    ]);
    members = memberResult.members || [];
    memberTotal = Number(memberResult.total || 0);
    vouchers = voucherResult.vouchers || [];
    renderMetrics(memberResult.stats || {});
    renderTable(members, memberTotal);
    renderTierSettings(tierResult.thresholds || {});
    renderVouchers(vouchers);
    showAdminApp();
  }

  async function loadDashboard() {
    let result;
    try {
      result = await Membership.callApi('admin.dashboard', {
        query: '', page: 1, pageSize: 100, voucherLimit: 50
      });
    } catch (error) {
      // Rollout compatibility: GitHub Pages may publish before the new GAS
      // deployment. Only fall back when the old backend does not know the new
      // read-only aggregate action; all other errors keep their real meaning.
      if (error && error.code === 'INVALID_ACTION') {
        await loadDashboardLegacy();
        return;
      }
      throw error;
    }

    members = result.members || [];
    memberTotal = Number(result.total || 0);
    vouchers = result.vouchers || [];
    renderMetrics(result.stats || {});
    renderTable(members, memberTotal);
    renderTierSettings(result.thresholds || {});
    renderVouchers(vouchers);
    showAdminApp();
  }

  function renderMetrics(stats) {
    dashboardStats = Object.assign({}, dashboardStats, stats || {});
    $('#metricTotal').textContent = Number(dashboardStats.total || 0);
    $('#metricActive').textContent = Number(dashboardStats.active || 0);
    $('#metricConsumedMinutes').textContent = formatMinutes(dashboardStats.consumedMinutes);
  }

  function renderTierSettings(thresholds) {
    $('#tierStandardThreshold').value = '0';
    $('#tierSilverThreshold').value = String(Number(thresholds.silver || 0));
    $('#tierGoldThreshold').value = String(Number(thresholds.gold || 0));
    $('#tierPlatinumThreshold').value = String(Number(thresholds.platinum || 0));
  }

  function readTierThresholdInput(selector, label) {
    const value = Number($(selector).value);
    if (!Number.isInteger(value) || value < 1 || value > 10000000) {
      throw new Error(`${label}門檻必須是 1 到 10000000 的整數分鐘。`);
    }
    return value;
  }

  async function saveTierSettings() {
    const button = $('#saveTierSettingsButton');
    const message = $('#tierSettingsMessage');
    button.disabled = true;
    message.classList.add('hidden');
    message.classList.remove('error');

    try {
      const silver = readTierThresholdInput('#tierSilverThreshold', '銀級');
      const gold = readTierThresholdInput('#tierGoldThreshold', '金級');
      const platinum = readTierThresholdInput('#tierPlatinumThreshold', '白金');
      if (!(silver < gold && gold < platinum)) {
        throw new Error('會員等級門檻必須依序為：銀級 < 金級 < 白金。');
      }

      const result = await Membership.callApi('admin.tier.update', { silver, gold, platinum });
      const thresholds = result.thresholds || {};
      renderTierSettings(thresholds);
      members = members.map((member) => Object.assign({}, member, {
        tier: tierForMinutes(member.consumedMinutes, thresholds)
      }));
      renderTable(members, memberTotal);
      message.textContent = `門檻已更新，重新計算 ${formatMinutes(result.updatedMembers)} 位會員的等級。`;
      message.classList.remove('hidden');
    } catch (error) {
      message.textContent = error && error.message ? error.message : '會員等級門檻更新失敗。';
      message.classList.add('error');
      message.classList.remove('hidden');
    } finally {
      button.disabled = false;
    }
  }

  function renderTable(rows, total) {
    const body = $('#memberTableBody');
    body.replaceChildren();
    $('#resultCount').textContent = `${total} 筆`;
    $('#emptyState').classList.toggle('hidden', rows.length !== 0);

    rows.forEach((member) => {
      const tr = document.createElement('tr');
      const memberTd = document.createElement('td');
      const memberCell = document.createElement('div'); memberCell.className = 'member-cell';
      const img = document.createElement('img'); img.alt = ''; img.src = member.pictureUrl || 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="80" height="80"%3E%3Crect width="100%25" height="100%25" fill="%23eef2f6"/%3E%3C/svg%3E';
      const identity = document.createElement('div');
      const name = document.createElement('strong'); name.textContent = member.displayName || 'LINE 會員';
      const joined = document.createElement('small'); joined.textContent = `加入 ${Membership.formatDate(member.joinedAt)}`;
      identity.append(name, joined); memberCell.append(img, identity); memberTd.append(memberCell);

      const numberTd = document.createElement('td'); numberTd.textContent = member.memberNo;
      const tierTd = document.createElement('td');
      const tierKey = normalizeTierKey(member.tier);
      const tier = document.createElement('span'); tier.className = `tier-badge tier-${tierKey}`; tier.textContent = tierLabel[tierKey]; tierTd.append(tier);
      const statusTd = document.createElement('td');
      const status = document.createElement('span'); status.className = `table-status ${member.membershipStatus === 'active' ? '' : member.membershipStatus}`.trim(); status.textContent = statusLabel[member.membershipStatus] || member.membershipStatus; statusTd.append(status);
      const consumedTd = document.createElement('td'); consumedTd.textContent = `${formatMinutes(member.consumedMinutes)} 分鐘`;
      const expiryTd = document.createElement('td'); expiryTd.textContent = Membership.formatDate(member.expiresAt, '永久');
      const actionTd = document.createElement('td');
      const edit = document.createElement('button'); edit.className = 'text-button'; edit.type = 'button'; edit.textContent = '編輯'; edit.addEventListener('click', () => openEdit(member)); actionTd.append(edit);
      tr.append(memberTd, numberTd, tierTd, statusTd, consumedTd, expiryTd, actionTd);
      body.append(tr);
    });
  }

  function isVoucherEditable(voucher) {
    return !voucher.legacyTargeted && voucher.status === 'issued' && Number(voucher.recordCount || 0) === 0;
  }

  function renderVouchers(rows) {
    const body = $('#voucherTableBody');
    body.replaceChildren();
    $('#voucherEmptyState').classList.toggle('hidden', rows.length !== 0);

    rows.forEach((voucher) => {
      const tr = document.createElement('tr');
      const idTd = document.createElement('td'); idTd.textContent = voucher.voucherId;
      const modeTd = document.createElement('td'); modeTd.textContent = voucher.legacyTargeted ? '舊版指定會員' : (scanModeLabel[voucher.scanMode] || voucher.scanMode);
      const minutesTd = document.createElement('td'); minutesTd.textContent = `${formatMinutes(voucher.minutes)} 分鐘`;
      const countTd = document.createElement('td'); countTd.textContent = `${formatMinutes(voucher.recordCount)} 次`;
      const statusTd = document.createElement('td');
      const badge = document.createElement('span'); badge.className = `voucher-status ${voucher.status}`; badge.textContent = voucherStatusLabel[voucher.status] || voucher.status; statusTd.append(badge);
      const expiryTd = document.createElement('td'); expiryTd.textContent = formatDateTime(voucher.expiresAt);
      const actionTd = document.createElement('td');
      const group = document.createElement('div'); group.className = 'row-actions';

      const open = document.createElement('button'); open.className = 'text-button'; open.type = 'button'; open.textContent = '開啟'; open.addEventListener('click', () => openExistingUsage(voucher.voucherId)); group.append(open);

      const edit = document.createElement('button'); edit.className = 'text-button'; edit.type = 'button'; edit.textContent = '修改'; edit.disabled = !isVoucherEditable(voucher); edit.title = edit.disabled ? '只有尚未使用且目前有效的 QR Code 可以修改' : '修改 QR Code'; edit.addEventListener('click', () => openUsageEdit(voucher)); group.append(edit);

      if (voucher.status === 'issued') {
        const cancel = document.createElement('button'); cancel.className = 'text-button danger-action'; cancel.type = 'button'; cancel.textContent = '停止'; cancel.addEventListener('click', () => cancelVoucher(voucher.voucherId)); group.append(cancel);
      }

      const remove = document.createElement('button'); remove.className = 'text-button danger-action'; remove.type = 'button'; remove.textContent = '刪除'; remove.disabled = Number(voucher.recordCount || 0) > 0 || voucher.legacyTargeted; remove.title = remove.disabled ? '已有消費紀錄或為舊版 QR，不能刪除' : '刪除這個 QR Code'; remove.addEventListener('click', () => deleteVoucher(voucher)); group.append(remove);

      actionTd.append(group);
      tr.append(idTd, modeTd, minutesTd, countTd, statusTd, expiryTd, actionTd);
      body.append(tr);
    });
  }

  function upsertVoucher(voucher) {
    const index = vouchers.findIndex((item) => item.voucherId === voucher.voucherId);
    if (index === -1) vouchers.unshift(voucher);
    else vouchers[index] = voucher;
    renderVouchers(vouchers);
  }

  function removeVoucher(voucherId) {
    vouchers = vouchers.filter((voucher) => voucher.voucherId !== voucherId);
    renderVouchers(vouchers);
  }

  function openEdit(member) {
    $('#editMemberName').textContent = member.displayName || 'LINE 會員';
    $('#editMemberNo').textContent = member.memberNo;
    $('#editTargetMemberNo').value = member.memberNo;
    $('#editExpectedUpdatedAt').value = member.updatedAt;
    $('#editTier').value = tierLabel[normalizeTierKey(member.tier)];
    $('#editStatus').value = member.membershipStatus;
    $('#editConsumedMinutes').value = `${formatMinutes(member.consumedMinutes)} 分鐘`;
    $('#editExpiresAt').value = member.expiresAt ? String(member.expiresAt).slice(0, 10) : '';
    $('#editNote').value = member.note || '';
    $('#editError').classList.add('hidden');
    $('#editDialog').showModal();
  }

  async function saveMember() {
    const button = $('#saveMemberButton'); button.disabled = true; $('#editError').classList.add('hidden');
    try {
      const result = await Membership.callApi('admin.update', {
        targetMemberNo: $('#editTargetMemberNo').value,
        expectedUpdatedAt: $('#editExpectedUpdatedAt').value,
        membershipStatus: $('#editStatus').value,
        expiresAt: $('#editExpiresAt').value,
        note: $('#editNote').value
      });
      const updated = result.member;
      const index = members.findIndex((member) => member.memberNo === updated.memberNo);
      if (index !== -1) {
        const previous = members[index];
        if (previous.membershipStatus !== updated.membershipStatus) {
          let active = Number(dashboardStats.active || 0);
          if (previous.membershipStatus === 'active') active = Math.max(0, active - 1);
          if (updated.membershipStatus === 'active') active += 1;
          dashboardStats.active = active;
          renderMetrics(dashboardStats);
        }
        members[index] = updated;
      }
      renderTable(members, memberTotal);
      $('#editDialog').close();
    } catch (error) {
      $('#editError').textContent = error.message; $('#editError').classList.remove('hidden');
    } finally { button.disabled = false; }
  }

  function resetUsageDialog() {
    currentQrSvg = ''; currentQrVoucherId = '';
    $('#usageVoucherId').value = '';
    $('#usageExpectedUpdatedAt').value = '';
    $('#usageError').classList.add('hidden');
    $('#usageResult').classList.add('hidden');
    $('#copyUsageUrlButton').classList.add('hidden');
    $('#downloadUsageQrButton').classList.add('hidden');
    $('#createUsageButton').classList.add('hidden');
    $('#updateUsageButton').classList.add('hidden');
    $('#usageCreateFields').classList.add('hidden');
    $('#usageQrCode').replaceChildren();
    $('#usageUrl').value = '';
    $('#usageResultMeta').textContent = '';
  }

  function setUsageFields(voucher) {
    $('#usageMinutes').value = String(voucher.minutes || 60);
    $('#usageScanMode').value = voucher.scanMode || 'single';
    const timed = Boolean(voucher.expiresAt);
    $('#usageExpiryMode').value = timed ? 'timed' : 'permanent';
    $('#usageExpiresAt').value = timed ? toLocalDateTimeInput(new Date(voucher.expiresAt)) : '';
    $('#usageNote').value = voucher.note || '';
    syncUsageExpiryMode();
  }

  function openUsageDialog() {
    resetUsageDialog();
    $('#usageDialogTitle').textContent = '新增消費時間 QR Code';
    $('#usageDialogDescription').textContent = '掃描後只會記錄會員本次消費時間。';
    $('#usageMinutes').value = '60'; $('#usageScanMode').value = 'single';
    $('#usageExpiryMode').value = 'timed';
    $('#usageExpiresAt').value = toLocalDateTimeInput(new Date(Date.now() + 24 * 60 * 60 * 1000)); $('#usageNote').value = '';
    syncUsageExpiryMode();
    $('#usageCreateFields').classList.remove('hidden'); $('#createUsageButton').classList.remove('hidden');
    $('#usageDialog').showModal();
  }

  function openUsageEdit(voucher) {
    if (!isVoucherEditable(voucher)) return;
    resetUsageDialog();
    $('#usageDialogTitle').textContent = '修改消費時間 QR Code';
    $('#usageDialogDescription').textContent = '只有尚未產生消費紀錄且目前有效的 QR Code 可以修改。';
    $('#usageVoucherId').value = voucher.voucherId;
    $('#usageExpectedUpdatedAt').value = voucher.updatedAt || '';
    setUsageFields(voucher);
    $('#usageCreateFields').classList.remove('hidden');
    $('#updateUsageButton').classList.remove('hidden');
    $('#usageDialog').showModal();
  }

  function buildUsageUrl(shareCode) {
    if (!publicConfig || !publicConfig.LIFF_ID) throw new Error('LIFF 設定尚未載入，請重新整理後再試。');
    const url = new URL(`https://liff.line.me/${encodeURIComponent(publicConfig.LIFF_ID)}/`);
    url.searchParams.set('usage', shareCode);
    return url.href;
  }

  function renderQrCode(url) {
    if (typeof window.qrcode !== 'function') throw new Error('QR Code 元件載入失敗，請重新整理後再試。');
    const qr = window.qrcode(0, 'M'); qr.addData(url); qr.make();
    currentQrSvg = qr.createSvgTag({ cellSize: 5, margin: 4, scalable: true });
    $('#usageQrCode').innerHTML = currentQrSvg;
  }

  function showUsageResult(voucher, shareCode) {
    currentQrVoucherId = voucher.voucherId;
    const url = buildUsageUrl(shareCode);
    const expiryLabel = voucher.expiresAt ? `到期 ${formatDateTime(voucher.expiresAt)}` : '無期限';
    $('#usageUrl').value = url;
    $('#usageResultMeta').textContent = `${voucher.voucherId} · ${scanModeLabel[voucher.scanMode] || voucher.scanMode} · ${formatMinutes(voucher.minutes)} 分鐘 · ${expiryLabel} · 已記錄 ${formatMinutes(voucher.recordCount)} 次`;
    renderQrCode(url);
    $('#usageCreateFields').classList.add('hidden'); $('#createUsageButton').classList.add('hidden'); $('#updateUsageButton').classList.add('hidden');
    $('#usageResult').classList.remove('hidden'); $('#copyUsageUrlButton').classList.remove('hidden'); $('#downloadUsageQrButton').classList.remove('hidden');
  }

  async function openExistingUsage(voucherId) {
    resetUsageDialog();
    $('#usageDialogTitle').textContent = 'QR Code 詳細';
    $('#usageDialogDescription').textContent = '可再次顯示、下載 QR Code 或複製發放連結。';
    $('#usageDialog').showModal();
    try {
      const result = await Membership.callApi('admin.usage.open', { voucherId });
      upsertVoucher(result.voucher);
      showUsageResult(result.voucher, result.shareCode);
    } catch (error) {
      $('#usageError').textContent = error.message; $('#usageError').classList.remove('hidden');
    }
  }

  function readUsageForm() {
    const minutes = Number($('#usageMinutes').value);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 60000) throw new Error('消費分鐘必須是 1 到 60000 的整數。');

    const expiryMode = $('#usageExpiryMode').value;
    let expiresAt = '';
    if (expiryMode === 'timed') {
      const expiryValue = $('#usageExpiresAt').value;
      const expiryDate = new Date(expiryValue);
      if (!expiryValue || Number.isNaN(expiryDate.getTime())) throw new Error('請設定有效的 QR Code 到期時間。');
      if (expiryDate.getTime() <= Date.now()) throw new Error('QR Code 到期時間必須晚於現在。');
      expiresAt = expiryDate.toISOString();
    } else if (expiryMode !== 'permanent') {
      throw new Error('請選擇有效的 QR Code 期限設定。');
    }

    return {
      minutes,
      scanMode: $('#usageScanMode').value,
      expiresAt,
      note: $('#usageNote').value
    };
  }

  async function createUsageVoucher() {
    const button = $('#createUsageButton'); button.disabled = true; $('#usageError').classList.add('hidden');
    try {
      const result = await Membership.callApi('admin.usage.create', readUsageForm());
      upsertVoucher(result.voucher);
      showUsageResult(result.voucher, result.shareCode);
    } catch (error) {
      $('#usageError').textContent = error.message; $('#usageError').classList.remove('hidden');
    } finally { button.disabled = false; }
  }

  async function updateUsageVoucher() {
    const button = $('#updateUsageButton'); button.disabled = true; $('#usageError').classList.add('hidden');
    try {
      const payload = Object.assign(readUsageForm(), {
        voucherId: $('#usageVoucherId').value,
        expectedUpdatedAt: $('#usageExpectedUpdatedAt').value
      });
      const result = await Membership.callApi('admin.usage.update', payload);
      upsertVoucher(result.voucher);
      showUsageResult(result.voucher, result.shareCode);
    } catch (error) {
      $('#usageError').textContent = error.message; $('#usageError').classList.remove('hidden');
    } finally { button.disabled = false; }
  }

  async function copyUsageUrl() {
    const value = $('#usageUrl').value; if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      $('#copyUsageUrlButton').textContent = '已複製';
      window.setTimeout(() => { $('#copyUsageUrlButton').textContent = '複製發放連結'; }, 1500);
    } catch (_) {
      $('#usageUrl').focus(); $('#usageUrl').select(); document.execCommand('copy');
    }
  }

  function downloadUsageQr() {
    if (!currentQrSvg || !currentQrVoucherId) return;
    const blob = new Blob([currentQrSvg], { type: 'image/svg+xml;charset=utf-8' });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl; link.download = `${currentQrVoucherId}.svg`; document.body.append(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  }

  async function cancelVoucher(voucherId) {
    if (!window.confirm('確定要停止這個 QR Code 的後續消費時間記錄？')) return;
    try {
      const result = await Membership.callApi('admin.usage.cancel', { voucherId });
      upsertVoucher(result.voucher);
    } catch (error) { window.alert(error.message || '停止 QR Code 失敗。'); }
  }

  async function deleteVoucher(voucher) {
    if (!voucher || Number(voucher.recordCount || 0) > 0 || voucher.legacyTargeted) return;
    if (!window.confirm(`確定要刪除 ${voucher.voucherId}？刪除後原發放連結將永久失效。`)) return;
    try {
      const result = await Membership.callApi('admin.usage.delete', {
        voucherId: voucher.voucherId,
        expectedUpdatedAt: voucher.updatedAt
      });
      removeVoucher(result.voucherId || voucher.voucherId);
    } catch (error) {
      window.alert(error.message || '刪除 QR Code 失敗。');
    }
  }

  function showAdminError(error) {
    $('#adminBoot').classList.add('hidden'); $('#adminApp').classList.add('hidden');
    $('#adminErrorMessage').textContent = error && error.message ? error.message : '無法驗證管理權限。'; $('#adminError').classList.remove('hidden');
  }

  async function initialize() {
    try {
      publicConfig = await Membership.loadConfig();
      const loggedIn = await Membership.ensureLiffLogin();
      if (!loggedIn) return;
      await loadDashboard();
    } catch (error) { showAdminError(error); }
  }

  $('#memberSearch').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => loadMembers($('#memberSearch').value.trim()).catch(showAdminError), 300); });
  $('#adminRefreshButton').addEventListener('click', () => loadDashboard().catch(showAdminError));
  $('#adminRetryButton').addEventListener('click', () => window.location.reload());
  $('#saveTierSettingsButton').addEventListener('click', saveTierSettings);
  $('#usageRefreshButton').addEventListener('click', () => loadVouchers().catch(showAdminError));
  $('#newUsageQrButton').addEventListener('click', openUsageDialog);
  $('#saveMemberButton').addEventListener('click', saveMember);
  $('#createUsageButton').addEventListener('click', createUsageVoucher);
  $('#updateUsageButton').addEventListener('click', updateUsageVoucher);
  $('#copyUsageUrlButton').addEventListener('click', copyUsageUrl);
  $('#downloadUsageQrButton').addEventListener('click', downloadUsageQr);
  $('#usageExpiryMode').addEventListener('change', syncUsageExpiryMode);

  initialize();
})();