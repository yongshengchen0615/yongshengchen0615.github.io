(function () {
  'use strict';

  const $ = (selector) => document.querySelector(selector);
  const statusBadgeLabel = { active: '有效', suspended: '停權', disabled: '停用' };
  const tierLabel = { standard: '一般', silver: '銀級', gold: '金級', platinum: '白金', vip: '白金' };
  const tierClasses = ['tier-standard', 'tier-silver', 'tier-gold', 'tier-platinum'];
  const REQUIRED_PROFILE_BACKEND_VERSION = '1.8.0';

  let currentMember = null;
  let currentProfile = null;
  let pendingUsageAccess = null;
  let publicConfig = null;
  let scanInFlight = false;
  let usageRecordInFlight = false;
  let profileSaveInFlight = false;

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

  function todayDateValue() {
    const now = new Date();
    const pad = (value) => String(value).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }

  function backendVersionMismatchError() {
    const error = new Error(`會員服務尚未更新到 ${REQUIRED_PROFILE_BACKEND_VERSION}，請先重新部署 GAS Web App 後再試。`);
    error.code = 'BACKEND_VERSION_MISMATCH';
    return error;
  }

  function requireProfileCapability(result) {
    if (!result ||
        !Object.prototype.hasOwnProperty.call(result, 'profile') ||
        !Object.prototype.hasOwnProperty.call(result, 'profileRequired')) {
      throw backendVersionMismatchError();
    }
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
    pendingUsageAccess = null;
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

  function maskPhone(value) {
    const phone = String(value || '').trim();
    if (!phone) return '—';
    if (phone.length <= 7) return phone;
    const prefixLength = phone.charAt(0) === '+' ? Math.min(5, phone.length - 3) : Math.min(4, phone.length - 3);
    const maskedLength = Math.max(3, phone.length - prefixLength - 3);
    return `${phone.slice(0, prefixLength)}${'•'.repeat(maskedLength)}${phone.slice(-3)}`;
  }

  function normalizeBirthDateValue(value) {
    const text = String(value || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
    if (!/^\d{4}-\d{2}-\d{2}T/.test(text)) return '';

    const date = new Date(text);
    if (Number.isNaN(date.getTime())) return '';
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Taipei',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(date).reduce((result, part) => {
      if (part.type === 'year' || part.type === 'month' || part.type === 'day') result[part.type] = part.value;
      return result;
    }, {});
    return parts.year && parts.month && parts.day
      ? `${parts.year}-${parts.month}-${parts.day}`
      : '';
  }

  function formatBirthDate(value) {
    const text = normalizeBirthDateValue(value);
    return text ? text.replace(/-/g, '/') : '—';
  }

  function daysInMonth(year, month) {
    const y = Number(year);
    const m = Number(month);
    if (!Number.isInteger(y) || y < 1 || !Number.isInteger(m) || m < 1 || m > 12) return 0;
    if (m === 2) {
      const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
      return leap ? 29 : 28;
    }
    return [4, 6, 9, 11].includes(m) ? 30 : 31;
  }

  function rebuildBirthDayOptions(prefix, preferredDay) {
    const year = $(`#${prefix}BirthYear`).value.trim();
    const month = $(`#${prefix}BirthMonth`).value;
    const daySelect = $(`#${prefix}BirthDay`);
    const wanted = String(preferredDay || daySelect.value || '');
    const count = /^\d{4}$/.test(year) ? daysInMonth(Number(year), Number(month)) : 0;

    daySelect.replaceChildren(new Option('日', ''));
    for (let day = 1; day <= count; day += 1) {
      const value = String(day).padStart(2, '0');
      daySelect.add(new Option(`${day} 日`, value));
    }
    daySelect.value = wanted && Number(wanted) <= count ? wanted : '';
  }

  function syncBirthDateHidden(prefix) {
    const year = $(`#${prefix}BirthYear`).value.trim();
    const month = $(`#${prefix}BirthMonth`).value;
    const day = $(`#${prefix}BirthDay`).value;
    const hidden = $(`#${prefix}BirthDate`);
    hidden.value = /^\d{4}$/.test(year) && month && day ? `${year}-${month}-${day}` : '';
  }

  function setBirthDateControls(prefix, birthDate) {
    const normalizedBirthDate = normalizeBirthDateValue(birthDate);
    const match = normalizedBirthDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    $(`#${prefix}BirthYear`).value = match ? match[1] : '';
    $(`#${prefix}BirthMonth`).value = match ? match[2] : '';
    rebuildBirthDayOptions(prefix, match ? match[3] : '');
    $(`#${prefix}BirthDay`).value = match ? match[3] : '';
    syncBirthDateHidden(prefix);
  }

  function bindBirthDateControls(prefix) {
    const year = $(`#${prefix}BirthYear`);
    const month = $(`#${prefix}BirthMonth`);
    const day = $(`#${prefix}BirthDay`);

    year.addEventListener('input', () => {
      year.value = year.value.replace(/\D/g, '').slice(0, 4);
      rebuildBirthDayOptions(prefix, day.value);
      syncBirthDateHidden(prefix);
    });
    month.addEventListener('change', () => {
      rebuildBirthDayOptions(prefix, day.value);
      syncBirthDateHidden(prefix);
    });
    day.addEventListener('change', () => syncBirthDateHidden(prefix));
  }

  async function loadMember() {
    const result = await Membership.callApi('member.me');
    requireProfileCapability(result);
    currentMember = result.member;
    currentProfile = result.profile || null;
    return result;
  }

  function renderProfileOnCard(profile) {
    $('#profilePhone').textContent = profile ? maskPhone(profile.phone) : '—';
    $('#profileBirthDate').textContent = profile ? formatBirthDate(profile.birthDate) : '—';
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
    renderProfileOnCard(currentProfile);
    $('#avatar').src = member.pictureUrl || 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="80" height="80"%3E%3Crect width="100%25" height="100%25" fill="%23374451"/%3E%3C/svg%3E';
    $('#boot').classList.add('hidden');
    $('#errorState').classList.add('hidden');
    $('#profileSetup').classList.add('hidden');
    $('#memberApp').classList.remove('hidden');
  }

  function fillProfileFields(prefix, profile) {
    $(`#${prefix}Phone`).value = profile && profile.phone ? profile.phone : '';
    setBirthDateControls(prefix, profile && profile.birthDate ? profile.birthDate : '');
  }

  function showProfileSetup() {
    hideUsageLoading();
    $('#boot').classList.add('hidden');
    $('#errorState').classList.add('hidden');
    $('#memberApp').classList.add('hidden');
    $('#profileSetupError').classList.add('hidden');
    fillProfileFields('profileSetup', currentProfile);
    $('#profileSetup').classList.remove('hidden');
    $('#profileSetupPhone').focus();
  }

  function openProfileDialog() {
    if (!currentProfile) return;
    $('#profileEditError').classList.add('hidden');
    fillProfileFields('profileEdit', currentProfile);
    const dialog = $('#profileDialog');
    if (!dialog.open) dialog.showModal();
    $('#profileEditPhone').focus();
  }

  function readProfilePayload(prefix) {
    const phone = $(`#${prefix}Phone`).value.trim();
    const year = $(`#${prefix}BirthYear`).value.trim();
    const month = $(`#${prefix}BirthMonth`).value;
    const day = $(`#${prefix}BirthDay`).value;
    if (!phone) throw new Error('請輸入電話。');
    if (!/^\d{4}$/.test(year) || Number(year) < 1 || !month || !day) throw new Error('請完整選擇生日的年、月、日。');

    const birthDate = `${year}-${month}-${day}`;
    if (day > String(daysInMonth(Number(year), Number(month))).padStart(2, '0')) {
      throw new Error('生日不是有效日期。');
    }
    if (birthDate > todayDateValue()) throw new Error('生日不可晚於今天。');
    $(`#${prefix}BirthDate`).value = birthDate;

    return {
      phone,
      birthDate,
      expectedUpdatedAt: currentProfile && currentProfile.updatedAt ? currentProfile.updatedAt : ''
    };
  }

  async function saveProfile(mode) {
    if (profileSaveInFlight) return;
    const isInitial = mode === 'initial';
    const prefix = isInitial ? 'profileSetup' : 'profileEdit';
    const button = isInitial ? $('#saveInitialProfileButton') : $('#saveProfileButton');
    const errorNode = isInitial ? $('#profileSetupError') : $('#profileEditError');

    profileSaveInFlight = true;
    button.disabled = true;
    const originalText = button.textContent;
    button.textContent = '儲存中…';
    errorNode.classList.add('hidden');

    try {
      const result = await Membership.callApi('profile.update', readProfilePayload(prefix));
      currentProfile = result.profile;
      renderProfileOnCard(currentProfile);
      if (isInitial) {
        renderMember(currentMember);
        $('#scanQrButton').disabled = false;
        if (pendingUsageAccess) await recordUsageImmediately(pendingUsageAccess);
      } else {
        $('#profileDialog').close();
      }
    } catch (error) {
      const visibleError = error && error.code === 'INVALID_ACTION'
        ? backendVersionMismatchError()
        : error;
      errorNode.textContent = visibleError && visibleError.message ? visibleError.message : '會員資料儲存失敗。';
      errorNode.classList.remove('hidden');
    } finally {
      profileSaveInFlight = false;
      button.disabled = false;
      button.textContent = originalText;
    }
  }

  function showError(error) {
    hideUsageLoading();
    $('#boot').classList.add('hidden');
    $('#profileSetup').classList.add('hidden');
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
    if (error && error.code === 'PROFILE_REQUIRED') {
      currentProfile = null;
      showProfileSetup();
      return;
    }
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
    if (!currentProfile) {
      pendingUsageAccess = access;
      showProfileSetup();
      return false;
    }

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
    if (scanInFlight || usageRecordInFlight || !currentProfile) return;
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

      pendingUsageAccess = readAccessFromUrl();
      const result = await loadMember();
      if (result.profileRequired || !currentProfile) {
        showProfileSetup();
        return;
      }

      renderMember(currentMember);
      $('#scanQrButton').disabled = false;
      if (pendingUsageAccess) await recordUsageImmediately(pendingUsageAccess);
    } catch (error) {
      showError(error);
    }
  }

  bindBirthDateControls('profileSetup');
  bindBirthDateControls('profileEdit');

  $('#refreshButton').addEventListener('click', () => window.location.reload());
  $('#retryButton').addEventListener('click', () => window.location.reload());
  $('#editProfileButton').addEventListener('click', openProfileDialog);
  $('#profileSetupForm').addEventListener('submit', (event) => {
    event.preventDefault();
    saveProfile('initial');
  });
  $('#profileEditForm').addEventListener('submit', (event) => {
    event.preventDefault();
    saveProfile('edit');
  });
  $('#cancelProfileButton').addEventListener('click', () => $('#profileDialog').close());
  $('#scanQrButton').addEventListener('click', () => scanWithLineImmediately().catch(showUsageError));
  $('#dismissUsageErrorButton').addEventListener('click', () => $('#usageErrorPanel').classList.add('hidden'));
  $('#usageSuccessDialog').addEventListener('cancel', (event) => event.preventDefault());
  $('#confirmUsageSuccessButton').addEventListener('click', () => $('#usageSuccessDialog').close());

  initialize();
})();