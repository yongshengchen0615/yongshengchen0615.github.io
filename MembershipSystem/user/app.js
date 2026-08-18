(function () {
  'use strict';

  const $ = (selector) => document.querySelector(selector);
  const statusCopy = {
    active: { badge: '有效', title: '會員資格有效', description: '此會員卡目前可正常使用。' },
    suspended: { badge: '停權', title: '會員資格已停權', description: '此會員目前暫停使用，若有疑問請聯絡管理員。' },
    disabled: { badge: '停用', title: '會員資格已停用', description: '此會員卡目前不可使用，若有疑問請聯絡管理員。' }
  };
  const MAX_QR_IMAGE_BYTES = 10 * 1024 * 1024;
  const MAX_QR_DECODE_DIMENSION = 1600;
  const CAMERA_DECODE_DIMENSION = 960;

  let currentMember = null;
  let redeemToken = '';
  let cameraStream = null;
  let cameraFrameId = 0;
  let cameraScanning = false;

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
    stopBrowserCamera();
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

  function setScannerStatus(message, isError) {
    $('#scannerStatus').textContent = message;
    $('#scannerStatus').classList.toggle('danger-text', Boolean(isError));
  }

  function hasLocalQrDecoder() {
    return typeof window.jsQR === 'function';
  }

  function hasBrowserCamera() {
    return Boolean(navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function');
  }

  function hasLiffScanner() {
    return typeof liff.isApiAvailable === 'function' && liff.isApiAvailable('scanCodeV2');
  }

  function stopBrowserCamera() {
    cameraScanning = false;
    if (cameraFrameId) {
      window.cancelAnimationFrame(cameraFrameId);
      cameraFrameId = 0;
    }
    if (cameraStream) {
      cameraStream.getTracks().forEach((track) => track.stop());
      cameraStream = null;
    }
    const video = $('#scannerVideo');
    if (video) video.srcObject = null;
  }

  function closeScannerPanel() {
    stopBrowserCamera();
    $('#scannerPanel').classList.add('hidden');
  }

  async function acceptScannedValue(value) {
    const token = readTokenFromScannedValue(value);
    closeScannerPanel();
    $('#scanHint').textContent = '已讀取核銷 QR Code，請確認下方時數。';
    await loadRedeemPreview(token);
  }

  function decodeCanvas(canvas) {
    if (!hasLocalQrDecoder()) {
      throw new Error('QR 解析元件未載入，請改用 LINE 掃描器或直接開啟核銷網址。');
    }
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('目前瀏覽器無法讀取 QR 圖片。');
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    return window.jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'attemptBoth' });
  }

  function drawSourceToCanvas(source, sourceWidth, sourceHeight, maxDimension) {
    const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const canvas = $('#scannerCanvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('目前瀏覽器無法使用 QR 解析畫布。');
    context.drawImage(source, 0, 0, width, height);
    return canvas;
  }

  function scanCameraFrame() {
    if (!cameraScanning || !cameraStream) return;
    const video = $('#scannerVideo');

    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth && video.videoHeight) {
      try {
        const canvas = drawSourceToCanvas(video, video.videoWidth, video.videoHeight, CAMERA_DECODE_DIMENSION);
        const result = decodeCanvas(canvas);
        if (result && result.data) {
          cameraScanning = false;
          acceptScannedValue(result.data).catch((error) => {
            setScannerStatus(error.message, true);
            cameraScanning = Boolean(cameraStream);
            if (cameraScanning) cameraFrameId = window.requestAnimationFrame(scanCameraFrame);
          });
          return;
        }
      } catch (error) {
        setScannerStatus(error.message, true);
        stopBrowserCamera();
        return;
      }
    }

    cameraFrameId = window.requestAnimationFrame(scanCameraFrame);
  }

  async function startBrowserCamera() {
    stopBrowserCamera();
    if (!hasLocalQrDecoder()) {
      setScannerStatus('QR 解析元件未載入。可改用 LINE 掃描器或直接開啟核銷網址。', true);
      return;
    }
    if (!hasBrowserCamera()) {
      setScannerStatus('此裝置沒有提供瀏覽器相機 API，請改用「選擇 QR 圖片」或直接開啟核銷網址。', true);
      return;
    }

    $('#startCameraButton').disabled = true;
    setScannerStatus('正在要求相機權限…', false);

    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' } }
      });
      const video = $('#scannerVideo');
      video.srcObject = cameraStream;
      await video.play();
      cameraScanning = true;
      setScannerStatus('請將 QR Code 對準相機。', false);
      cameraFrameId = window.requestAnimationFrame(scanCameraFrame);
    } catch (error) {
      stopBrowserCamera();
      const permissionDenied = error && (error.name === 'NotAllowedError' || error.name === 'SecurityError');
      setScannerStatus(
        permissionDenied
          ? '無法使用相機權限。請改用「選擇 QR 圖片」或直接開啟核銷網址。'
          : '無法啟動此裝置的相機。請改用「選擇 QR 圖片」或直接開啟核銷網址。',
        true
      );
    } finally {
      $('#startCameraButton').disabled = false;
    }
  }

  function loadImageElement(file) {
    return new Promise((resolve, reject) => {
      const objectUrl = URL.createObjectURL(file);
      const image = new Image();
      image.onload = function () {
        URL.revokeObjectURL(objectUrl);
        resolve(image);
      };
      image.onerror = function () {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('無法讀取選擇的圖片。'));
      };
      image.src = objectUrl;
    });
  }

  async function decodeQrImageFile(file) {
    if (!file) return;
    if (!file.type || !file.type.startsWith('image/')) throw new Error('請選擇圖片檔案。');
    if (file.size > MAX_QR_IMAGE_BYTES) throw new Error('QR 圖片不可超過 10 MB。');
    if (!hasLocalQrDecoder()) throw new Error('QR 解析元件未載入，請改用 LINE 掃描器或直接開啟核銷網址。');

    let source;
    let shouldClose = false;
    if (typeof window.createImageBitmap === 'function') {
      source = await window.createImageBitmap(file);
      shouldClose = typeof source.close === 'function';
    } else {
      source = await loadImageElement(file);
    }

    try {
      const width = source.width || source.naturalWidth;
      const height = source.height || source.naturalHeight;
      if (!width || !height) throw new Error('無法取得圖片尺寸。');
      const canvas = drawSourceToCanvas(source, width, height, MAX_QR_DECODE_DIMENSION);
      const result = decodeCanvas(canvas);
      if (!result || !result.data) throw new Error('圖片中找不到可辨識的 QR Code。');
      await acceptScannedValue(result.data);
    } finally {
      if (shouldClose) source.close();
    }
  }

  async function handleQrImageSelection(event) {
    const input = event.currentTarget;
    const file = input.files && input.files[0];
    if (!file) return;
    stopBrowserCamera();
    setScannerStatus('正在解析 QR 圖片…', false);

    try {
      await decodeQrImageFile(file);
    } catch (error) {
      setScannerStatus(error.message || '無法解析 QR 圖片。', true);
    } finally {
      input.value = '';
    }
  }

  async function scanWithLiff() {
    if (!hasLiffScanner()) {
      setScannerStatus('此環境沒有提供 LINE QR 掃描器，請使用瀏覽器相機或選擇 QR 圖片。', true);
      return;
    }

    stopBrowserCamera();
    $('#useLiffScannerButton').disabled = true;
    setScannerStatus('正在開啟 LINE QR 掃描器…', false);

    try {
      const result = await liff.scanCodeV2();
      await acceptScannedValue(result && result.value);
    } catch (error) {
      setScannerStatus(error && error.message ? error.message : 'LINE QR 掃描器未能讀取 QR Code。', true);
    } finally {
      $('#useLiffScannerButton').disabled = false;
    }
  }

  async function openScannerPanel() {
    $('#scannerPanel').classList.remove('hidden');
    $('#useLiffScannerButton').classList.toggle('hidden', !hasLiffScanner());
    $('#scanHint').textContent = '可使用瀏覽器相機、QR 圖片或支援時的 LINE 掃描器。';
    setScannerStatus('正在準備瀏覽器相機；若無法使用，可直接選擇 QR 圖片。', false);
    await startBrowserCamera();
  }

  function configureScanner() {
    $('#scanQrButton').disabled = false;
    $('#scanHint').textContent = '支援瀏覽器相機、拍照/選擇 QR 圖片；LINE 掃描器可用時也可使用。';
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
  $('#scanQrButton').addEventListener('click', () => openScannerPanel().catch((error) => setScannerStatus(error.message, true)));
  $('#closeScannerButton').addEventListener('click', closeScannerPanel);
  $('#startCameraButton').addEventListener('click', () => startBrowserCamera().catch((error) => setScannerStatus(error.message, true)));
  $('#qrImageInput').addEventListener('change', handleQrImageSelection);
  $('#useLiffScannerButton').addEventListener('click', scanWithLiff);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopBrowserCamera();
  });
  window.addEventListener('pagehide', stopBrowserCamera);

  initialize();
})();
