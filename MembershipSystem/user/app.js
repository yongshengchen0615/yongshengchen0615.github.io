(function () {
  'use strict';

  const $ = (selector) => document.querySelector(selector);
  const statusCopy = {
    active: { badge: '有效', title: '會員資格有效', description: '此會員卡目前可正常使用。' },
    suspended: { badge: '停權', title: '會員資格已停權', description: '此會員目前暫停使用，若有疑問請聯絡管理員。' },
    disabled: { badge: '停用', title: '會員資格已停用', description: '此會員卡目前不可使用，若有疑問請聯絡管理員。' }
  };
  const USAGE_PENDING_KEY = 'membership.usage.pending';
  const USAGE_PENDING_TTL_MS = 10 * 60 * 1000;
  const LIFF_RECOVERY_KEY = 'membership.reauth.recovery';

  let currentMember = null;
  let usageAccess = null;
  let usageRequestId = '';

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

  function readPendingUsageState() {
    let raw = '';
    try { raw = window.sessionStorage.getItem(USAGE_PENDING_KEY) || ''; }
    catch (_) { return null; }
    if (!raw) return null;

    try {
      const pending = JSON.parse(raw);
      if (!pending || pending.pathname !== window.location.pathname) return null;
      const age = Date.now() - Number(pending.savedAt || 0);
      if (!Number.isFinite(age) || age < 0 || age > USAGE_PENDING_TTL_MS) return null;
      const code = validCode(pending.code);
      const token = validCode(pending.token);
      const access = code ? { code } : token ? { token } : null;
      if (!access) return null;
      return { access, requestId: validRequestId(pending.requestId) };
    } catch (_) {
      return null;
    }
  }

  function writePendingUsageState(access, requestId) {
    const payload = {
      pathname: window.location.pathname,
      code: access && access.code ? validCode(access.code) : '',
      token: access && access.token ? validCode(access.token) : '',
      requestId: validRequestId(requestId),
      savedAt: Date.now()
    };
    if (!payload.code && !payload.token) return;
    try { window.sessionStorage.setItem(USAGE_PENDING_KEY, JSON.stringify(payload)); }
    catch (_) { /* URL state remains the primary retry path when storage is unavailable. */ }
  }

  function clearPendingUsageState() {
    try { window.sessionStorage.removeItem(USAGE_PENDING_KEY); }
    catch (_) { /* best effort only */ }
  }

  function captureBootUsageState() {
    const url = currentUrl();
    const access = readAccessFromUrl(url);
    if (!access) return null;
    const state = { access, requestId: validRequestId(url.searchParams.get('request')) };
    writePendingUsageState(state.access, state.requestId);
    return state;
  }

  function hasAuthCallbackOrRecoveryAtBoot() {
    const url = currentUrl();
    const params = url.searchParams;
    if (params.has('state') || params.has('code') || params.has('response') || params.has('error') ||
        params.has('liffClientId') || params.has('liffRedirectUri')) return true;
    try { return Boolean(window.sessionStorage.getItem(LIFF_RECOVERY_KEY)); }
    catch (_) { return false; }
  }

  function persistUsageState(access, requestId) {
    const url = currentUrl();
    url.searchParams.delete('usage');
    url.searchParams.delete('redeem');
    if (access.code) url.searchParams.set('usage', access.code);
    else url.searchParams.set('redeem', access.token);
    url.searchParams.set('request', requestId);
    window.history.replaceState(null, '', url.href);
    writePendingUsageState(access, requestId);
  }

  function ensureRequestId(access, preferredRequestId) {
    const directAccess = readAccessFromUrl();
    const directRequestId = accessKey(directAccess) === accessKey(access)
      ? validRequestId(currentUrl().searchParams.get('request'))
      : '';
    const pending = readPendingUsageState();
    const pendingRequestId = pending && accessKey(pending.access) === accessKey(access)
      ? pending.requestId
      : '';
    usageRequestId = validRequestId(preferredRequestId) || directRequestId || pendingRequestId || createRequestId();
    persistUsageState(access, usageRequestId);
    return usageRequestId;
  }

  function clearUsageState() {
    const url = currentUrl();
    url.searchParams.delete('usage');
    url.searchParams.delete('redeem');
    url.searchParams.delete('request');
    window.history.replaceState(null, '', url.href);
    clearPendingUsageState();
  }

  function readAccessFromScannedValue(value) {
    let scannedUrl;
    try { scannedUrl = new URL(String(value || '')); }
    catch (_) { throw new Error('掃描內容不是有效的消費時間網址。'); }

    const expected = new URL('./', window.location.href);
    if (scannedUrl.origin !== expected.origin || scannedUrl.pathname !== expected.pathname) {
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

  async function recordUsageImmediately(accessOverride, preferredRequestId) {
    usageAccess = accessOverride || readAccessFromUrl();
    if (!usageAccess) return false;
    ensureRequestId(usageAccess, preferredRequestId);
    showUsageLoading();

    try {
      const result = await Membership.callApi('usage.record', Object.assign({}, usageAccess, { requestId: usageRequestId }));
      currentMember = result.member;
      renderMember(currentMember);
      $('#usageLoading').classList.add('hidden');
      $('#usageResult').classList.remove('hidden');
      $('#usageResultTitle').textContent = result.alreadyRecorded ? '此筆時間已記錄' : '消費時間已加入';
      $('#usageResultMessage').textContent = `本次加入 ${formatMinutes(result.voucher.minutes)} 分鐘，累計消費 ${formatMinutes(result.member.consumedMinutes)} 分鐘。`;
      clearUsageState();
      usageAccess = null;
      usageRequestId = '';
      return true;
    } catch (error) {
      showUsageError(error);
      return false;
    }
  }

  function hasLiffScanner() {
    return typeof liff.isApiAvailable === 'function' && liff.isApiAvailable('scanCodeV2') && typeof liff.scanCodeV2 === 'function';
  }

  async function scanWithLineImmediately() {
    const button = $('#scanQrButton');
    button.disabled = true;

    if (!hasLiffScanner()) {
      $('#scanHint').textContent = '目前環境不支援 LINE QR 掃描器，請直接開啟管理端發放連結。';
      button.disabled = false;
      return;
    }

    $('#scanHint').textContent = '正在開啟 LINE QR 掃描器…';
    try {
      const result = await liff.scanCodeV2();
      const access = readAccessFromScannedValue(result && result.value);
      $('#scanHint').textContent = 'QR Code 已讀取，正在加入消費時間…';
      const recorded = await recordUsageImmediately(access, '');
      if (recorded) $('#scanHint').textContent = '消費時間已加入。';
    } catch (error) {
      $('#scanHint').textContent = error && error.message ? error.message : 'LINE QR 掃描器未能讀取 QR Code。';
    } finally {
      button.disabled = false;
    }
  }

  async function initialize() {
    const bootUsageState = captureBootUsageState();
    const recoverPendingAfterAuth = hasAuthCallbackOrRecoveryAtBoot();

    try {
      const loggedIn = await Membership.ensureLiffLogin();
      if (!loggedIn) return;
      await loadMember();
      $('#scanQrButton').disabled = false;

      const pending = readPendingUsageState();
      const automaticState = bootUsageState || (recoverPendingAfterAuth ? pending : null);
      if (automaticState && automaticState.access) {
        await recordUsageImmediately(automaticState.access, automaticState.requestId);
      }
    } catch (error) {
      showError(error);
    }
  }

  $('#refreshButton').addEventListener('click', () => window.location.reload());
  $('#retryButton').addEventListener('click', () => window.location.reload());
  $('#scanQrButton').addEventListener('click', () => scanWithLineImmediately().catch(showUsageError));

  initialize();
})();
