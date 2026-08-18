(function () {
  'use strict';

  const $ = (selector) => document.querySelector(selector);
  const statusCopy = {
    active: { badge: '有效', title: '會員資格有效', description: '此會員卡目前可正常使用。' },
    suspended: { badge: '停權', title: '會員資格已停權', description: '此會員目前暫停使用，若有疑問請聯絡管理員。' },
    disabled: { badge: '停用', title: '會員資格已停用', description: '此會員卡目前不可使用，若有疑問請聯絡管理員。' }
  };

  let currentMember = null;
  let publicConfig = null;
  let scanInFlight = false;

  function formatMinutes(value) {
    return new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 }).format(Number(value || 0));
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
    const copy = statusCopy[member.membershipStatus] || statusCopy.disabled;
    $('#displayName').textContent = Membership.escapeText(member.displayName) || 'LINE 會員';
    $('#memberNo').textContent = Membership.escapeText(member.memberNo);
    $('#tierLabel').textContent = Membership.escapeText(member.tier || 'standard').toUpperCase();
    $('#statusBadge').textContent = copy.badge;
    $('#joinedAt').textContent = Membership.formatDate(member.joinedAt);
    $('#expiresAt').textContent = Membership.formatDate(member.expiresAt, '永久');
    $('#consumedMinutes').textContent = formatMinutes(member.consumedMinutes);
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

  function showUsageLoading() {
    $('#usagePanel').classList.remove('hidden');
    $('#usageLoading').classList.remove('hidden');
    $('#usageResult').classList.add('hidden');
  }

  function showUsageError(error) {
    $('#usageLoading').classList.add('hidden');
    $('#usageResult').classList.remove('hidden');
    $('#usageResultTitle').textContent = '無法記錄';
    $('#usageResultMessage').textContent = error && error.message ? error.message : '此 QR Code 目前無法使用。';
  }

  async function recordUsageImmediately(accessOverride) {
    const access = accessOverride || readAccessFromUrl();
    if (!access) return false;
    const requestId = ensureRequestId(access);
    showUsageLoading();

    try {
      const result = await Membership.callApi('usage.record', Object.assign({}, access, { requestId }));
      currentMember = result.member;
      renderMember(currentMember);
      $('#usageLoading').classList.add('hidden');
      $('#usageResult').classList.remove('hidden');
      $('#usageResultTitle').textContent = result.alreadyRecorded ? '此筆時間已記錄' : '消費時間已加入';
      $('#usageResultMessage').textContent = `本次加入 ${formatMinutes(result.voucher.minutes)} 分鐘，累計消費 ${formatMinutes(result.member.consumedMinutes)} 分鐘。`;
      clearUsageState();
      return true;
    } catch (error) {
      showUsageError(error);
      return false;
    }
  }

  function hasLiffScanner() {
    return typeof liff.isApiAvailable === 'function' &&
      liff.isApiAvailable('scanCodeV2') &&
      typeof liff.scanCodeV2 === 'function';
  }

  async function scanWithLineImmediately() {
    if (scanInFlight) return;
    scanInFlight = true;

    const button = $('#scanQrButton');
    button.disabled = true;

    try {
      if (!hasLiffScanner()) {
        $('#scanHint').textContent = '目前環境不支援 LINE QR 掃描器，請直接開啟管理端發放連結。';
        return;
      }

      $('#scanHint').textContent = '正在開啟 LINE QR 掃描器…';
      const result = await liff.scanCodeV2();
      const access = readAccessFromScannedValue(result && result.value);
      $('#scanHint').textContent = 'QR Code 已讀取，正在加入消費時間…';
      const recorded = await recordUsageImmediately(access);
      if (recorded) $('#scanHint').textContent = '消費時間已加入。';
    } catch (error) {
      $('#scanHint').textContent = error && error.message ? error.message : 'LINE QR 掃描器未能讀取 QR Code。';
    } finally {
      scanInFlight = false;
      button.disabled = false;
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
      await loadMember();
      $('#scanQrButton').disabled = false;

      const access = readAccessFromUrl();
      if (access) await recordUsageImmediately(access);
    } catch (error) {
      showError(error);
    }
  }

  $('#refreshButton').addEventListener('click', () => window.location.reload());
  $('#retryButton').addEventListener('click', () => window.location.reload());
  $('#scanQrButton').addEventListener('click', () => scanWithLineImmediately().catch(showUsageError));

  initialize();
})();
