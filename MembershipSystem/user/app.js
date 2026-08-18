(function () {
  'use strict';

  const $ = (selector) => document.querySelector(selector);
  const statusCopy = {
    active: { badge: '有效', title: '會員資格有效', description: '此會員卡目前可正常使用。' },
    suspended: { badge: '停權', title: '會員資格已停權', description: '此會員目前暫停使用，若有疑問請聯絡管理員。' },
    disabled: { badge: '停用', title: '會員資格已停用', description: '此會員卡目前不可使用，若有疑問請聯絡管理員。' }
  };

  let currentMember = null;
  let redeemToken = '';

  function formatHours(minutes) {
    const value = Number(minutes || 0) / 60;
    return new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 2 }).format(value);
  }

  function formatDateTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat('zh-TW', {
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
    }).format(date);
  }

  function validateRedeemToken(value) {
    const token = String(value || '').trim();
    return /^[a-f0-9]{64}$/i.test(token) ? token.toLowerCase() : '';
  }

  function readRedeemToken() {
    return validateRedeemToken(new URL(window.location.href).searchParams.get('redeem') || '');
  }

  function readTokenFromScannedValue(value) {
    let scannedUrl;
    try {
      scannedUrl = new URL(String(value || ''));
    } catch (_) {
      throw new Error('掃描內容不是有效的時數核銷網址。');
    }

    const expectedUrl = new URL('./', window.location.href);
    if (scannedUrl.origin !== expectedUrl.origin || scannedUrl.pathname !== expectedUrl.pathname) {
      throw new Error('此 QR Code 不是本會員系統的時數核銷網址。');
    }

    const token = validateRedeemToken(scannedUrl.searchParams.get('redeem'));
    if (!token) throw new Error('此 QR Code 缺少有效的核銷 token。');
    return token;
  }

  function clearRedeemTokenFromUrl() {
    const url = new URL(window.location.href);
    url.searchParams.delete('redeem');
    window.history.replaceState(null, '', url.href);
  }

  async function loadMember() {
    const result = await Membership.callApi('member.me');
    currentMember = result.member;
    renderMember(currentMember);
  }

  function renderMember(member) {
    const copy = statusCopy[member.membershipStatus] || statusCopy.disabled;
    $('#displayName').textContent = Membership.escapeText(member.displayName) || 'LINE 會員';
    $('#memberNo').textContent = Membership.escapeText(member.memberNo);
    $('#tierLabel').textContent = Membership.escapeText(member.tier || 'standard').toUpperCase();
    $('#statusBadge').textContent = copy.badge;
    $('#joinedAt').textContent = Membership.formatDate(member.joinedAt);
    $('#expiresAt').textContent = Membership.formatDate(member.expiresAt, '永久');
    $('#availableHours').textContent = formatHours(member.availableMinutes);
    $('#consumedHours').textContent = formatHours(member.consumedMinutes);
    $('#statusTitle').textContent = copy.title;
    $('#statusDescription').textContent = copy.description;
    $('#avatar').src = member.pictureUrl || 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="80" height="80"%3E%3Crect width="100%25" height="100%25" fill="%23374451"/%3E%3C/svg%3E';
    $('#boot').classList.add('hidden');
    $('#errorState').classList.add('hidden');
    $('#memberApp').classList.remove('hidden');
  }

  function showError(error) {
    $('#boot').classList.add('hidden');
    $('#memberApp').classList.add('hidden');
    $('#errorMessage').textContent = error && error.message ? error.message : '請稍後再試。';
    $('#errorState').classList.remove('hidden');
  }

  function showRedeemError(error) {
    $('#redeemLoading').classList.add('hidden');
    $('#redeemReady').classList.add('hidden');
    $('#redeemResult').classList.remove('hidden');
    $('#redeemResultTitle').textContent = '無法核銷';
    $('#redeemResultMessage').textContent = error && error.message ? error.message : '此核銷券目前無法使用。';
  }

  async function loadRedeemPreview(tokenOverride) {
    redeemToken = validateRedeemToken(tokenOverride) || readRedeemToken();
    if (!redeemToken) return;

    $('#redeemPanel').classList.remove('hidden');
    $('#redeemLoading').classList.remove('hidden');
    $('#redeemReady').classList.add('hidden');
    $('#redeemResult').classList.add('hidden');

    try {
      const result = await Membership.callApi('usage.preview', { token: redeemToken });
      const voucher = result.voucher;
      $('#redeemHours').textContent = formatHours(voucher.minutes);
      $('#redeemVoucherId').textContent = voucher.voucherId;
      $('#redeemExpiresAt').textContent = formatDateTime(voucher.expiresAt);
      $('#redeemDescription').textContent = voucher.note
        ? `${voucher.note}。確認後會立即從你的可用時數扣除。`
        : '確認後會立即從你的可用時數扣除。';
      $('#redeemLoading').classList.add('hidden');
      $('#redeemReady').classList.remove('hidden');
    } catch (error) {
      showRedeemError(error);
    }
  }

  async function redeemUsage() {
    if (!redeemToken) return;
    const button = $('#redeemButton');
    button.disabled = true;

    try {
      const result = await Membership.callApi('usage.redeem', { token: redeemToken });
      currentMember = result.member;
      renderMember(currentMember);
      $('#redeemReady').classList.add('hidden');
      $('#redeemLoading').classList.add('hidden');
      $('#redeemResult').classList.remove('hidden');
      $('#redeemResultTitle').textContent = result.alreadyRedeemed ? '此核銷已完成' : '核銷完成';
      $('#redeemResultMessage').textContent =
        `已消費 ${formatHours(result.voucher.minutes)} 小時，剩餘 ${formatHours(result.member.availableMinutes)} 小時。`;
      clearRedeemTokenFromUrl();
      redeemToken = '';
    } catch (error) {
      showRedeemError(error);
    } finally {
      button.disabled = false;
    }
  }

  async function scanUsageQrCode() {
    const button = $('#scanQrButton');
    if (typeof liff.isApiAvailable !== 'function' || !liff.isApiAvailable('scanCodeV2')) {
      $('#scanHint').textContent = '目前環境不支援 LIFF QR 掃描器，請改用手機相機開啟管理端發放的網址。';
      return;
    }

    button.disabled = true;
    $('#scanHint').textContent = '正在開啟 QR Code 掃描器…';

    try {
      const result = await liff.scanCodeV2();
      const token = readTokenFromScannedValue(result && result.value);
      $('#scanHint').textContent = '已讀取核銷 QR Code，請確認下方時數。';
      await loadRedeemPreview(token);
    } catch (error) {
      $('#scanHint').textContent = error && error.message
        ? error.message
        : '未能讀取 QR Code，請再試一次或使用核銷網址。';
    } finally {
      button.disabled = false;
    }
  }

  function configureScanner() {
    const available = typeof liff.isApiAvailable === 'function' && liff.isApiAvailable('scanCodeV2');
    $('#scanQrButton').disabled = !available;
    if (!available) {
      $('#scanHint').textContent = '目前環境不支援 LIFF QR 掃描器，仍可直接開啟管理端發放的核銷網址。';
    }
  }

  async function initialize() {
    try {
      const loggedIn = await Membership.ensureLiffLogin();
      if (!loggedIn) return;
      await loadMember();
      configureScanner();
      await loadRedeemPreview();
    } catch (error) {
      showError(error);
    }
  }

  $('#refreshButton').addEventListener('click', () => window.location.reload());
  $('#retryButton').addEventListener('click', () => window.location.reload());
  $('#redeemButton').addEventListener('click', redeemUsage);
  $('#scanQrButton').addEventListener('click', scanUsageQrCode);

  initialize();
})();
