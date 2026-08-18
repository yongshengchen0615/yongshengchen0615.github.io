(function () {
  'use strict';

  const $ = (selector) => document.querySelector(selector);
  const statusCopy = {
    active: { badge: '有效', title: '會員資格有效', description: '此會員卡目前可正常使用。' },
    suspended: { badge: '停權', title: '會員資格已停權', description: '此會員目前暫停使用，若有疑問請聯絡管理員。' },
    disabled: { badge: '停用', title: '會員資格已停用', description: '此會員卡目前不可使用，若有疑問請聯絡管理員。' }
  };
  const scanModeLabel = { single: '單次掃描', repeatable: '可重複掃描' };
  const MAX_QR_IMAGE_BYTES = 10 * 1024 * 1024;
  const MAX_QR_DECODE_DIMENSION = 1600;
  const CAMERA_DECODE_DIMENSION = 960;
  const QR_DECODER_SCRIPT_URL = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';

  let currentMember = null;
  let usageAccess = null;
  let usageRequestId = '';
  let cameraStream = null;
  let cameraFrameId = 0;
  let cameraScanning = false;
  let qrWorker = null;
  let qrRequestSequence = 0;
  const pendingQrDecodes = new Map();

  function formatMinutes(value) { return new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 }).format(Number(value || 0)); }
  function formatDateTime(value) {
    const date = new Date(value); if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date);
  }
  function validCode(value) { const text = String(value || '').trim(); return /^[a-f0-9]{64}$/i.test(text) ? text.toLowerCase() : ''; }
  function validRequestId(value) { const text = String(value || '').trim(); return /^[a-f0-9]{32,64}$/i.test(text) ? text.toLowerCase() : ''; }
  function currentUrl() { return new URL(window.location.href); }

  function createRequestId() {
    if (!window.crypto || typeof window.crypto.getRandomValues !== 'function') throw new Error('目前瀏覽器無法建立安全的記錄要求，請更換瀏覽器後再試。');
    const bytes = new Uint8Array(16); window.crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  function readAccessFromUrl() {
    const url = currentUrl();
    const code = validCode(url.searchParams.get('usage'));
    if (code) return { code };
    const token = validCode(url.searchParams.get('redeem'));
    return token ? { token } : null;
  }

  function accessKey(access) { return access && (access.code || access.token) || ''; }

  function persistUsageState(access, requestId) {
    const url = currentUrl();
    url.searchParams.delete('usage'); url.searchParams.delete('redeem');
    if (access.code) url.searchParams.set('usage', access.code); else url.searchParams.set('redeem', access.token);
    url.searchParams.set('request', requestId);
    window.history.replaceState(null, '', url.href);
  }

  function ensureRequestId(access) {
    const existingAccess = readAccessFromUrl();
    const existingRequest = accessKey(existingAccess) === accessKey(access) ? validRequestId(currentUrl().searchParams.get('request')) : '';
    usageRequestId = existingRequest || createRequestId();
    persistUsageState(access, usageRequestId);
  }

  function clearUsageStateFromUrl() {
    const url = currentUrl();
    url.searchParams.delete('usage'); url.searchParams.delete('redeem'); url.searchParams.delete('request');
    window.history.replaceState(null, '', url.href);
  }

  function readAccessFromScannedValue(value) {
    let scannedUrl;
    try { scannedUrl = new URL(String(value || '')); }
    catch (_) { throw new Error('掃描內容不是有效的消費時間網址。'); }
    const expected = new URL('./', window.location.href);
    if (scannedUrl.origin !== expected.origin || scannedUrl.pathname !== expected.pathname) throw new Error('此 QR Code 不是本會員系統的消費時間網址。');
    const code = validCode(scannedUrl.searchParams.get('usage'));
    if (code) return { code };
    const token = validCode(scannedUrl.searchParams.get('redeem'));
    if (token) return { token };
    throw new Error('此 QR Code 缺少有效的使用代碼。');
  }

  async function loadMember() {
    const result = await Membership.callApi('member.me'); currentMember = result.member; renderMember(currentMember);
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
    $('#statusTitle').textContent = copy.title; $('#statusDescription').textContent = copy.description;
    $('#avatar').src = member.pictureUrl || 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="80" height="80"%3E%3Crect width="100%25" height="100%25" fill="%23374451"/%3E%3C/svg%3E';
    $('#boot').classList.add('hidden'); $('#errorState').classList.add('hidden'); $('#memberApp').classList.remove('hidden');
  }

  function showError(error) {
    stopBrowserCamera(); $('#boot').classList.add('hidden'); $('#memberApp').classList.add('hidden');
    $('#errorMessage').textContent = error && error.message ? error.message : '請稍後再試。'; $('#errorState').classList.remove('hidden');
  }

  function showUsageError(error) {
    $('#usageLoading').classList.add('hidden'); $('#usageReady').classList.add('hidden'); $('#usageResult').classList.remove('hidden');
    $('#usageResultTitle').textContent = '無法記錄'; $('#usageResultMessage').textContent = error && error.message ? error.message : '此 QR Code 目前無法使用。';
  }

  async function loadUsagePreview(accessOverride) {
    usageAccess = accessOverride || readAccessFromUrl();
    if (!usageAccess) return;
    ensureRequestId(usageAccess);
    $('#usagePanel').classList.remove('hidden'); $('#usageLoading').classList.remove('hidden'); $('#usageReady').classList.add('hidden'); $('#usageResult').classList.add('hidden');
    try {
      const result = await Membership.callApi('usage.preview', usageAccess);
      const voucher = result.voucher;
      $('#usageMinutes').textContent = formatMinutes(voucher.minutes);
      $('#usageVoucherId').textContent = voucher.voucherId;
      $('#usageMode').textContent = voucher.legacyTargeted ? '舊版單次掃描' : (scanModeLabel[voucher.scanMode] || voucher.scanMode);
      $('#usageExpiresAt').textContent = formatDateTime(voucher.expiresAt);
      const modeCopy = voucher.scanMode === 'repeatable'
        ? '此 QR Code 可重複記錄；每次確認都會新增一筆消費時間。'
        : '此 QR Code 只允許成功記錄一次消費時間。';
      $('#usageDescription').textContent = voucher.note ? `${voucher.note}。${modeCopy}` : modeCopy;
      $('#usageLoading').classList.add('hidden'); $('#usageReady').classList.remove('hidden');
    } catch (error) { showUsageError(error); }
  }

  async function recordUsage() {
    if (!usageAccess || !usageRequestId) return;
    const button = $('#recordUsageButton'); button.disabled = true;
    try {
      const result = await Membership.callApi('usage.record', Object.assign({}, usageAccess, { requestId: usageRequestId }));
      currentMember = result.member; renderMember(currentMember);
      $('#usageReady').classList.add('hidden'); $('#usageLoading').classList.add('hidden'); $('#usageResult').classList.remove('hidden');
      $('#usageResultTitle').textContent = result.alreadyRecorded ? '此筆時間已記錄' : '記錄完成';
      $('#usageResultMessage').textContent = `本次記錄 ${formatMinutes(result.voucher.minutes)} 分鐘，累計消費 ${formatMinutes(result.member.consumedMinutes)} 分鐘。`;
      clearUsageStateFromUrl(); usageAccess = null; usageRequestId = '';
    } catch (error) { showUsageError(error); }
    finally { button.disabled = false; }
  }

  function setScannerStatus(message, isError) { $('#scannerStatus').textContent = message; $('#scannerStatus').classList.toggle('danger-text', Boolean(isError)); }
  function canUseWorkerDecoder() { return typeof window.Worker === 'function' && typeof window.Blob === 'function' && window.URL && typeof window.URL.createObjectURL === 'function'; }
  function rejectPendingQrDecodes(error) { pendingQrDecodes.forEach((pending) => pending.reject(error)); pendingQrDecodes.clear(); }
  function stopQrWorker() { if (qrWorker) { qrWorker.terminate(); qrWorker = null; } rejectPendingQrDecodes(new Error('QR 解析已停止。')); }

  function getQrWorker() {
    if (qrWorker) return qrWorker;
    if (!canUseWorkerDecoder()) throw new Error('此瀏覽器無法啟動本機 QR 解析器。');
    const workerSource = [
      "'use strict';", 'self.importScripts(' + JSON.stringify(QR_DECODER_SCRIPT_URL) + ');',
      'self.onmessage = function (event) {', '  var message = event.data || {};', '  try {',
      "    var decoder = self.jsQR || (typeof jsQR === 'function' ? jsQR : null);", "    if (!decoder) throw new Error('QR decoder unavailable');",
      '    var pixels = new Uint8ClampedArray(message.pixels);', "    var result = decoder(pixels, message.width, message.height, { inversionAttempts: 'attemptBoth' });",
      "    self.postMessage({ id: message.id, data: result && result.data ? result.data : '' });", '  } catch (error) {',
      "    self.postMessage({ id: message.id, error: error && error.message ? error.message : 'QR decode failed' });", '  }', '};'
    ].join('\n');
    const workerUrl = window.URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
    qrWorker = new Worker(workerUrl); window.URL.revokeObjectURL(workerUrl);
    qrWorker.onmessage = function (event) {
      const message = event.data || {}; const pending = pendingQrDecodes.get(message.id); if (!pending) return;
      pendingQrDecodes.delete(message.id); if (message.error) pending.reject(new Error('QR 解析失敗。')); else pending.resolve(message.data || '');
    };
    qrWorker.onerror = function () {
      rejectPendingQrDecodes(new Error('QR 解析元件載入失敗，請改用 LINE 掃描器或直接開啟發放連結。'));
      if (qrWorker) qrWorker.terminate(); qrWorker = null;
    };
    return qrWorker;
  }

  function hasBrowserCamera() { return Boolean(navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function'); }
  function hasLiffScanner() { return typeof liff.isApiAvailable === 'function' && liff.isApiAvailable('scanCodeV2'); }
  function stopBrowserCamera() {
    cameraScanning = false;
    if (cameraFrameId) { window.cancelAnimationFrame(cameraFrameId); cameraFrameId = 0; }
    if (cameraStream) { cameraStream.getTracks().forEach((track) => track.stop()); cameraStream = null; }
    const video = $('#scannerVideo'); if (video) video.srcObject = null;
  }
  function closeScannerPanel() { stopBrowserCamera(); $('#scannerPanel').classList.add('hidden'); }

  async function acceptScannedValue(value) {
    const access = readAccessFromScannedValue(value); closeScannerPanel();
    $('#scanHint').textContent = '已讀取 QR Code，請確認下方消費分鐘。'; await loadUsagePreview(access);
  }

  function decodeCanvas(canvas) {
    const context = canvas.getContext('2d', { willReadFrequently: true }); if (!context) return Promise.reject(new Error('目前瀏覽器無法讀取 QR 圖片。'));
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height); const id = ++qrRequestSequence; const worker = getQrWorker();
    return new Promise((resolve, reject) => {
      pendingQrDecodes.set(id, { resolve, reject });
      worker.postMessage({ id, width: imageData.width, height: imageData.height, pixels: imageData.data.buffer }, [imageData.data.buffer]);
    });
  }

  function drawSourceToCanvas(source, sourceWidth, sourceHeight, maxDimension) {
    const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * scale)); const height = Math.max(1, Math.round(sourceHeight * scale));
    const canvas = $('#scannerCanvas'); canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true }); if (!context) throw new Error('目前瀏覽器無法使用 QR 解析畫布。');
    context.drawImage(source, 0, 0, width, height); return canvas;
  }

  async function scanCameraFrame() {
    if (!cameraScanning || !cameraStream) return;
    const video = $('#scannerVideo');
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth && video.videoHeight) {
      try {
        const decodedValue = await decodeCanvas(drawSourceToCanvas(video, video.videoWidth, video.videoHeight, CAMERA_DECODE_DIMENSION));
        if (!cameraScanning || !cameraStream) return;
        if (decodedValue) {
          cameraScanning = false;
          acceptScannedValue(decodedValue).catch((error) => { setScannerStatus(error.message, true); cameraScanning = Boolean(cameraStream); if (cameraScanning) cameraFrameId = window.requestAnimationFrame(scanCameraFrame); });
          return;
        }
      } catch (error) { setScannerStatus(error.message, true); stopBrowserCamera(); return; }
    }
    cameraFrameId = window.requestAnimationFrame(scanCameraFrame);
  }

  async function startBrowserCamera() {
    stopBrowserCamera();
    if (!canUseWorkerDecoder()) { setScannerStatus('此瀏覽器無法啟動 QR 解析器，請改用 LINE 掃描器或發放連結。', true); return; }
    if (!hasBrowserCamera()) { setScannerStatus('此裝置沒有瀏覽器相機 API，請改用 QR 圖片或發放連結。', true); return; }
    $('#startCameraButton').disabled = true; setScannerStatus('正在要求相機權限…', false);
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' } } });
      const video = $('#scannerVideo'); video.srcObject = cameraStream; await video.play(); cameraScanning = true;
      setScannerStatus('請將 QR Code 對準相機。', false); cameraFrameId = window.requestAnimationFrame(scanCameraFrame);
    } catch (error) {
      stopBrowserCamera(); const denied = error && (error.name === 'NotAllowedError' || error.name === 'SecurityError');
      setScannerStatus(denied ? '無法使用相機權限，請改用 QR 圖片或發放連結。' : '無法啟動相機，請改用 QR 圖片或發放連結。', true);
    } finally { $('#startCameraButton').disabled = false; }
  }

  function loadImageElement(file) {
    return new Promise((resolve, reject) => {
      const objectUrl = URL.createObjectURL(file); const image = new Image();
      image.onload = function () { URL.revokeObjectURL(objectUrl); resolve(image); };
      image.onerror = function () { URL.revokeObjectURL(objectUrl); reject(new Error('無法讀取選擇的圖片。')); };
      image.src = objectUrl;
    });
  }

  async function decodeQrImageFile(file) {
    if (!file) return;
    if (!file.type || !file.type.startsWith('image/')) throw new Error('請選擇圖片檔案。');
    if (file.size > MAX_QR_IMAGE_BYTES) throw new Error('QR 圖片不可超過 10 MB。');
    if (!canUseWorkerDecoder()) throw new Error('此瀏覽器無法啟動 QR 解析器，請改用 LINE 掃描器或發放連結。');
    let source; let shouldClose = false;
    if (typeof window.createImageBitmap === 'function') { source = await window.createImageBitmap(file); shouldClose = typeof source.close === 'function'; }
    else source = await loadImageElement(file);
    try {
      const width = source.width || source.naturalWidth; const height = source.height || source.naturalHeight;
      if (!width || !height) throw new Error('無法取得圖片尺寸。');
      const decodedValue = await decodeCanvas(drawSourceToCanvas(source, width, height, MAX_QR_DECODE_DIMENSION));
      if (!decodedValue) throw new Error('圖片中找不到可辨識的 QR Code。');
      await acceptScannedValue(decodedValue);
    } finally { if (shouldClose) source.close(); }
  }

  async function handleQrImageSelection(event) {
    const input = event.currentTarget; const file = input.files && input.files[0]; if (!file) return;
    stopBrowserCamera(); setScannerStatus('正在解析 QR 圖片…', false);
    try { await decodeQrImageFile(file); } catch (error) { setScannerStatus(error.message || '無法解析 QR 圖片。', true); } finally { input.value = ''; }
  }

  async function scanWithLiff() {
    if (!hasLiffScanner()) { setScannerStatus('此環境沒有提供 LINE QR 掃描器，請使用瀏覽器相機或 QR 圖片。', true); return; }
    stopBrowserCamera(); $('#useLiffScannerButton').disabled = true; setScannerStatus('正在開啟 LINE QR 掃描器…', false);
    try { const result = await liff.scanCodeV2(); await acceptScannedValue(result && result.value); }
    catch (error) { setScannerStatus(error && error.message ? error.message : 'LINE QR 掃描器未能讀取 QR Code。', true); }
    finally { $('#useLiffScannerButton').disabled = false; }
  }

  function openScannerPanel() {
    stopBrowserCamera(); $('#scannerPanel').classList.remove('hidden'); $('#useLiffScannerButton').classList.toggle('hidden', !hasLiffScanner());
    $('#scanHint').textContent = '可使用瀏覽器相機、QR 圖片或支援時的 LINE 掃描器。'; setScannerStatus('請選擇「使用相機掃描」或「選擇 QR 圖片」。', false);
  }

  function configureScanner() { $('#scanQrButton').disabled = false; }

  async function initialize() {
    try {
      const loggedIn = await Membership.ensureLiffLogin(); if (!loggedIn) return;
      await loadMember(); configureScanner(); await loadUsagePreview();
    } catch (error) { showError(error); }
  }

  $('#refreshButton').addEventListener('click', () => window.location.reload());
  $('#retryButton').addEventListener('click', () => window.location.reload());
  $('#recordUsageButton').addEventListener('click', recordUsage);
  $('#scanQrButton').addEventListener('click', openScannerPanel);
  $('#closeScannerButton').addEventListener('click', closeScannerPanel);
  $('#startCameraButton').addEventListener('click', () => startBrowserCamera().catch((error) => setScannerStatus(error.message, true)));
  $('#qrImageInput').addEventListener('change', handleQrImageSelection);
  $('#useLiffScannerButton').addEventListener('click', scanWithLiff);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopBrowserCamera(); });
  window.addEventListener('pagehide', () => { stopBrowserCamera(); stopQrWorker(); });

  initialize();
})();
