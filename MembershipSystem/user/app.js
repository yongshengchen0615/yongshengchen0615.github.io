(function () {
  'use strict';

  const $ = (selector) => document.querySelector(selector);
  const statusBadgeLabel = { active: '有效', suspended: '停權', disabled: '停用' };
  const tierLabel = { standard: '一般', silver: '銀級', gold: '金級', platinum: '白金', vip: '白金' };
  const tierClasses = ['tier-standard', 'tier-silver', 'tier-gold', 'tier-platinum'];

  let currentMember = null;
  let publicConfig = null;
  let scanInFlight = false;
  let usageRecordInFlight = false;

  function formatMinutes(value) {
    return new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 }).format(Number(value || 0));
  }

  function normalizeTierKey(value) {
    const tier = String(value || '').trim().toLowerCase();
    if (tier === 'vip') return 'platinum';
    return Object.prototype.hasOwnProperty.call(tierLabel, tier) ? tier : 'standard';
  }

  function validCode(value) {
    const text = String(value || '').trim();
    return /^[a-f0-9]{64}$/i.test(text) ? text.toLowerCase() : '';
  }

  function validRequestId(value) {
    const text = String(value || '').trim();
    return /^[a-f0-9]{32,64}$/i.test(text) ? text.toLowerCase() : '';
  }

  function currentUrl() {
    return new URL(window.location.href);
  }

  function isTopLevelWindow() {
    try { return window.top === window.self; }
    catch (_) { return false; }
  }

  function createRequestId() {
    if (!window.crypto || typeof window.crypto.getRandomValues !== 'function') {
      throw new Error('目前瀏覽器無法建立安全的記錄要求，請更換瀏覽器後再試。');
    }
    const bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  function accessKey(access) {
    return access && (access.code || access.token) || '';
  }

  function readAccessFromUrl(url) {
    const source = url || currentUrl();
    const code = validCode(source.searchParams.get('usage'));
    if (code) return { code };
    const token = validCode(source.searchParams.get('redeem'));
    return token ? { token } : null;
  }

  function ensureRequestId(access) {
    const url = currentUrl();
    const directAccess = readAccessFromUrl(url);
    const existingRequestId = accessKey(directAccess) === accessKey(access)
      ? validRequestId(url.searchParams.get('request'))
      : '';
    const requestId = existingRequestId || createRequestId();

    url.searchParams.delete('usage');
    url.searchParams.delete('redeem');
    if (access.code) url.searchParams.set('usage', access.code);
    else url.searchParams.set('redeem', access.token);
    url.searchParams.set('request', requestId);
    window.history.replaceState(null, '', url.href);
    return requestId;
  }

  function clearUsageState() {
    const url = currentUrl();
    url.searchParams.delete('usage');
    url.searchParams.delete('redeem');
    url.searchParams.delete('request');
    window.history.replaceState(null, '', url.href);
  }

  function readAccessFromScannedValue(value) {
    let scannedUrl;
    try { scannedUrl = new URL(String(value || '')); }
    catch (_) { throw new Error('掃描內容不是有效的消費時間網址。'); }

    const expectedMemberUrl = new URL('./', window.location.href);
    const isMemberUrl = scannedUrl.origin === expectedMemberUrl.origin &&
      scannedUrl.pathname === expectedMemberUrl.pathname;
    const expectedLiffPath = publicConfig && publicConfig.LIFF_ID
      ? `/${encodeURIComponent(publicConfig.LIFF_ID)}/`
      : '';
    const isLiffUrl = scannedUrl.origin === 'https://liff.line.me' &&
      scannedUrl.pathname === expectedLiffPath;
    if (!isMemberUrl && !isLiffUrl) {
      throw new Error('此 QR Code 不是本會員系統的消費時間網址。');
    }
    const access = readAccessFromUrl(scannedUrl);
    if (!access) throw new Error('此 QR Code 缺少有效的使用代碼。');
    return access;
  }

  async function loadMember() {
    const result = await Membership.callApi('member.me');
    currentMember = result.member;
    renderMember(currentMember);
  }

  function renderMember(member) {
    const tierKey = normalizeTierKey(member.tier);
    const memberCard = $('.member-card');
    tierClasses.forEach((className) => memberCard.classList.remove(className));
    memberCard.classList.add(`tier-${tierKey}`);

    $('#displayName').textContent = Membership.escapeText(member.displayName) || 'LINE 會員';
    $('#memberNo').textContent = Membership.escapeText(member.memberNo);
    $('#tierLabel').textContent = tierLabel[tierKey];
    $('#statusBadge').textContent = statusBadgeLabel[member.membershipStatus] || '停用';
    $('#joinedAt').textContent = Membership.formatDate(member.joinedAt);
    $('#expiresAt').textContent = Membership.formatDate(member.expiresAt, '永久');
    $('#consumedMinutes').textContent = formatMinutes(member.consumedMinutes);
    $('#avatar').src = member.pictureUrl || 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="80" height="80"%3E%3Crect width="100%25" height="100%25" fill="%23374451"/%3E%3C/svg%3E';
    $('#boot').classList.add('hidden');
    $('#errorState').classList.add('hidden');
    $('#memberApp').classList.remove('hidden');
  }

  function showError(error) {
    hideUsageLoading();
    $('#boot').classList.add('hidden');
    $('#memberApp').classList.add('hidden');
    $('#errorMessage').textContent = error && error.message ? error.message : '請稍後再試。';
    $('#errorState').classList.remove('hidden');
  }

  function showUsageLoading() {
    $('#usageErrorPanel').classList.add('hidden');
    $('#usageLoadingOverlay').classList.remove('hidden');
  }

  function hideUsageLoading() {
    $('#usageLoadingOverlay').classList.add('hidden');
  }

  function showUsageError(error) {
    hideUsageLoading();
    $('#usageErrorMessage').textContent = error && error.message ? error.message : '此 QR Code 目前無法使用。';
    $('#usageErrorPanel').classList.remove('hidden');
  }

  function showUsageSuccess(result) {
    const dialog = $('#usageSuccessDialog');
    $('#usageSuccessTitle').textContent = result.alreadyRecorded ? '此筆時間已記錄' : '消費時間已加入';
    $('#usageSuccessMessage').textContent = result.alreadyRecorded
      ? `此筆已記錄 ${formatMinutes(result.voucher.minutes)} 分鐘，累計消費 ${formatMinutes(result.member.consumedMinutes)} 分鐘。`
      : `本次加入 ${formatMinutes(result.voucher.minutes)} 分鐘，累計消費 ${formatMinutes(result.member.consumedMinutes)} 分鐘。`;
    if (!dialog.open) dialog.showModal();
    $('#confirmUsageSuccessButton').focus();
  }

  async function recordUsageImmediately(accessOverride) {
    const access = accessOverride || readAccessFromUrl();
    if (!access || usageRecordInFlight) return false;

    const requestId = ensureRequestId(access);
    usageRecordInFlight = true;
    showUsageLoading();

    try {
      const result = await Membership.callApi('usage.record', Object.assign({}, access, { requestId }));
      currentMember = result.member;
      renderMember(currentMember);
      clearUsageState();
      hideUsageLoading();
      showUsageSuccess(result);
      return true;
    } catch (error) {
      showUsageError(error);
      return false;
    } finally {
      usageRecordInFlight = false;
      hideUsageLoading();
    }
  }

  function hasLiffScanner() {
    return typeof liff.isApiAvailable === 'function' &&
      liff.isApiAvailable('scanCodeV2') &&
      typeof liff.scanCodeV2 === 'function';
  }

  async function scanWithLineImmediately() {
    if (scanInFlight || usageRecordInFlight) return;
    scanInFlight = true;

    const button = $('#scanQrButton');
    button.disabled = true;
    button.textContent = '正在開啟掃描器…';

    try {
      if (!hasLiffScanner()) {
        throw new Error('目前環境不支援 LINE QR 掃描器，請直接開啟管理端發放連結。');
      }

      const result = await liff.scanCodeV2();
      const access = readAccessFromScannedValue(result && result.value);
      button.textContent = '正在加入消費時間…';
      await recordUsageImmediately(access);
    } catch (error) {
      showUsageError(error);
    } finally {
      scanInFlight = false;
      button.disabled = false;
      button.textContent = '掃描 QR Code';
    }
  }

  async function initialize() {
    if (!isTopLevelWindow()) {
      showError(new Error('請直接開啟會員頁或發放連結，不要從其他網站的內嵌頁面執行。'));
      return;
    }

    try {
      publicConfig = await Membership.loadConfig();
      const loggedIn = await Membership.ensureLiffLogin();
      if (!loggedIn) return;

      const access = readAccessFromUrl();
      if (access) showUsageLoading();

      await loadMember();
      $('#scanQrButton').disabled = false;

      if (access) await recordUsageImmediately(access);
    } catch (error) {
      showError(error);
    }
  }

  $('#refreshButton').addEventListener('click', () => window.location.reload());
  $('#retryButton').addEventListener('click', () => window.location.reload());
  $('#scanQrButton').addEventListener('click', () => scanWithLineImmediately().catch(showUsageError));
  $('#dismissUsageErrorButton').addEventListener('click', () => $('#usageErrorPanel').classList.add('hidden'));
  $('#usageSuccessDialog').addEventListener('cancel', (event) => event.preventDefault());
  $('#confirmUsageSuccessButton').addEventListener('click', () => $('#usageSuccessDialog').close());

  initialize();
})();
