(() => {
  'use strict';

  const state = {
    receiptsByBooking: new Map(),
    metadataByBooking: new Map(),
    selectedBookingId: '',
    selectedExpectedUpdatedAt: '',
    selectedFile: null,
    previewUrl: '',
    cameraStream: null,
    cameraReady: false,
    cameraGeneration: 0,
    photoGeneration: 0,
    busy: false,
    listLoading: false,
  };

  function session() {
    return window.BookingSystem?.getSession?.() || null;
  }

  function newRequestId() {
    const raw = window.crypto?.randomUUID?.() || String(Date.now()) + Math.random().toString(36).slice(2);
    return 'br-' + raw.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 90);
  }

  function humanSize(bytes) {
    const value = Math.max(0, Number(bytes || 0));
    if (value < 1024) return value + ' B';
    if (value < 1024 * 1024) return (value / 1024).toFixed(1) + ' KB';
    return (value / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function ensureModal() {
    let modal = document.getElementById('bookingReceiptModal');
    if (modal) return modal;

    modal = document.createElement('section');
    modal.id = 'bookingReceiptModal';
    modal.className = 'booking-receipt-modal hidden';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'bookingReceiptTitle');
    modal.innerHTML = `
      <div class="booking-receipt-modal-card">
        <div class="booking-receipt-heading">
          <div><p class="kicker">Receipt verification</p><h2 id="bookingReceiptTitle">拍攝收據並送出審核</h2></div>
          <button id="bookingReceiptClose" class="booking-modal-close" type="button" aria-label="關閉">×</button>
        </div>
        <p class="booking-receipt-help">請直接使用相機拍攝本次消費收據。預約確認後即可上傳，不需等待服務時間結束；若重新上傳，會覆蓋這筆預約目前的收據快照。管理端確認前，預約仍維持已確認狀態。</p>
        <div class="booking-receipt-camera">
          <video id="bookingReceiptCamera" class="booking-receipt-camera-video" autoplay playsinline muted></video>
          <canvas id="bookingReceiptCanvas" class="hidden"></canvas>
          <div class="booking-receipt-camera-actions">
            <button id="bookingReceiptCapture" class="button button-dark" type="button" disabled>啟動相機中…</button>
            <button id="bookingReceiptRetake" class="button button-outline hidden" type="button">重新拍攝</button>
          </div>
        </div>
        <div id="bookingReceiptPreviewWrap" class="booking-receipt-preview hidden">
          <img id="bookingReceiptPreview" alt="本次收據預覽">
          <p id="bookingReceiptFileMeta"></p>
        </div>
        <p id="bookingReceiptMessage" class="booking-receipt-message hidden" role="status" aria-live="polite"></p>
        <div class="booking-receipt-actions">
          <button id="bookingReceiptCancel" class="button button-light" type="button">取消</button>
          <button id="bookingReceiptSubmit" class="button button-dark" type="button" disabled>上傳收據並送出審核</button>
        </div>
      </div>`;
    document.body.append(modal);

    modal.querySelector('#bookingReceiptClose').addEventListener('click', closeModal);
    modal.querySelector('#bookingReceiptCancel').addEventListener('click', closeModal);
    modal.querySelector('#bookingReceiptCapture').addEventListener('click', captureFrame);
    modal.querySelector('#bookingReceiptRetake').addEventListener('click', retakePhoto);
    modal.querySelector('#bookingReceiptSubmit').addEventListener('click', submitReceipt);
    modal.addEventListener('click', (event) => {
      if (event.target === modal && !state.busy) closeModal();
    });

    return modal;
  }

  function setMessage(message, error = false) {
    const target = document.getElementById('bookingReceiptMessage');
    if (!target) return;
    target.textContent = String(message || '');
    target.classList.toggle('hidden', !message);
    target.classList.toggle('error', Boolean(error));
  }

  function cleanupPreview() {
    state.previewUrl = '';
  }

  function resetModalState() {
    state.photoGeneration += 1;
    cleanupPreview();
    state.selectedFile = null;
    state.cameraReady = false;
    const wrap = document.getElementById('bookingReceiptPreviewWrap');
    const preview = document.getElementById('bookingReceiptPreview');
    const meta = document.getElementById('bookingReceiptFileMeta');
    const submit = document.getElementById('bookingReceiptSubmit');
    const capture = document.getElementById('bookingReceiptCapture');
    const retake = document.getElementById('bookingReceiptRetake');
    if (preview) preview.removeAttribute('src');
    if (meta) meta.textContent = '';
    if (wrap) wrap.classList.add('hidden');
    if (submit) submit.disabled = true;
    if (capture) { capture.disabled = true; capture.textContent = '啟動相機中…'; capture.classList.remove('hidden'); }
    retake?.classList.add('hidden');
    setMessage('');
  }

  function stopCamera() {
    state.cameraGeneration += 1;
    if (state.cameraStream) {
      state.cameraStream.getTracks().forEach((track) => track.stop());
      state.cameraStream = null;
    }
    state.cameraReady = false;
    const video = document.getElementById('bookingReceiptCamera');
    if (video) video.srcObject = null;
  }

  function closeModal() {
    if (state.busy) return;
    stopCamera();
    resetModalState();
    document.getElementById('bookingReceiptModal')?.classList.add('hidden');
    state.selectedBookingId = '';
    state.selectedExpectedUpdatedAt = '';
  }

  function openModal(bookingId, expectedUpdatedAt) {
    const modal = ensureModal();
    resetModalState();
    state.selectedBookingId = String(bookingId || '');
    state.selectedExpectedUpdatedAt = String(expectedUpdatedAt || '');
    modal.classList.remove('hidden');
    void startCamera();
  }

  async function startCamera() {
    stopCamera();
    const generation = state.cameraGeneration;
    const video = document.getElementById('bookingReceiptCamera');
    const capture = document.getElementById('bookingReceiptCapture');
    if (!video || !capture) return;

    capture.disabled = true;
    capture.textContent = '啟動相機中…';
    setMessage('正在開啟後鏡頭…');

    if (!navigator.mediaDevices?.getUserMedia) {
      capture.disabled = false;
      capture.textContent = '重新嘗試開啟相機';
      setMessage('此瀏覽器無法使用相機拍攝。請改用支援相機權限的瀏覽器或裝置。', true);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      if (generation !== state.cameraGeneration) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      state.cameraStream = stream;
      video.srcObject = stream;
      await video.play();
      if (generation !== state.cameraGeneration) return;
      state.cameraReady = true;
      capture.disabled = false;
      capture.textContent = '拍攝收據';
      setMessage('請將收據完整放入畫面後拍攝。');
    } catch (error) {
      if (generation !== state.cameraGeneration) return;
      stopCamera();
      console.warn('booking receipt camera unavailable', error);
      capture.disabled = false;
      capture.textContent = '重新嘗試開啟相機';
      setMessage('無法開啟相機。請允許相機權限後再試；此流程不支援從檔案或相簿選擇圖片。', true);
    }
  }

  function acceptFile(file) {
    const generation = ++state.photoGeneration;
    cleanupPreview();
    state.selectedFile = file || null;
    const wrap = document.getElementById('bookingReceiptPreviewWrap');
    const preview = document.getElementById('bookingReceiptPreview');
    const meta = document.getElementById('bookingReceiptFileMeta');
    const submit = document.getElementById('bookingReceiptSubmit');
    const capture = document.getElementById('bookingReceiptCapture');
    const retake = document.getElementById('bookingReceiptRetake');

    if (!file) {
      wrap?.classList.add('hidden');
      if (submit) submit.disabled = true;
      return;
    }

    const allowed = new Set(['image/jpeg','image/png','image/webp','image/heic','image/heif']);
    if (!allowed.has(String(file.type || '').toLowerCase())) {
      state.selectedFile = null;
      setMessage('請使用 JPG、PNG、WebP、HEIC 或 HEIF 圖片。', true);
      if (submit) submit.disabled = true;
      return;
    }
    if (file.size < 1 || file.size > 5 * 1024 * 1024) {
      state.selectedFile = null;
      setMessage('收據圖片不可超過 5 MB。', true);
      if (submit) submit.disabled = true;
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (generation !== state.photoGeneration) return;
      state.previewUrl = typeof reader.result === 'string' ? reader.result : '';
      if (preview && state.previewUrl) preview.src = state.previewUrl;
      if (meta) meta.textContent = `${file.name || '收據照片'} · ${humanSize(file.size)}`;
      wrap?.classList.remove('hidden');
      if (submit) submit.disabled = false;
      capture?.classList.add('hidden');
      retake?.classList.remove('hidden');
      stopCamera();
      setMessage('照片已拍攝。確認清楚可辨識後送出，管理端核對前預約不會完成。');
    };
    reader.onerror = () => {
      if (generation !== state.photoGeneration) return;
      state.selectedFile = null;
      setMessage('無法讀取這張圖片，請重新拍攝。', true);
      if (submit) submit.disabled = true;
    };
    reader.readAsDataURL(file);
  }

  function captureFrame() {
    if (state.busy) return;
    if (!state.cameraReady) {
      void startCamera();
      return;
    }

    const video = document.getElementById('bookingReceiptCamera');
    const canvas = document.getElementById('bookingReceiptCanvas');
    if (!video || !canvas || !video.videoWidth || !video.videoHeight) {
      setMessage('相機畫面尚未準備完成，請再試一次。', true);
      return;
    }

    const maxWidth = 1920;
    const scale = Math.min(1, maxWidth / video.videoWidth);
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) {
      setMessage('目前無法擷取相機畫面。', true);
      return;
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const generation = ++state.photoGeneration;
    const capture = document.getElementById('bookingReceiptCapture');
    if (capture) capture.disabled = true;
    canvas.toBlob((blob) => {
      if (generation !== state.photoGeneration) return;
      if (capture) capture.disabled = false;
      if (!blob) {
        setMessage('拍攝失敗，請重新拍攝。', true);
        return;
      }
      const file = new File([blob], `receipt-${Date.now()}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
      acceptFile(file);
    }, 'image/jpeg', 0.88);
  }

  function retakePhoto() {
    if (state.busy) return;
    state.photoGeneration += 1;
    cleanupPreview();
    state.selectedFile = null;
    const wrap = document.getElementById('bookingReceiptPreviewWrap');
    const preview = document.getElementById('bookingReceiptPreview');
    const meta = document.getElementById('bookingReceiptFileMeta');
    const submit = document.getElementById('bookingReceiptSubmit');
    const capture = document.getElementById('bookingReceiptCapture');
    const retake = document.getElementById('bookingReceiptRetake');
    wrap?.classList.add('hidden');
    preview?.removeAttribute('src');
    if (meta) meta.textContent = '';
    if (submit) submit.disabled = true;
    capture?.classList.remove('hidden');
    retake?.classList.add('hidden');
    void startCamera();
  }

  async function uploadSigned(config, prepared, file) {
    if (!window.supabase?.createClient) throw new Error('Supabase Storage SDK 尚未載入。');
    const client = window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const result = await client.storage
      .from('booking-receipts')
      .uploadToSignedUrl(String(prepared.objectPath || ''), String(prepared.uploadToken || ''), file, {
        contentType: String(file.type || '').toLowerCase(),
      });
    if (result.error) throw result.error;
  }

  async function submitReceipt() {
    if (state.busy || !state.selectedFile || !state.selectedBookingId) return;
    const currentSession = session();
    if (!currentSession) return setMessage('登入狀態已失效，請重新整理後再試。', true);

    state.busy = true;
    const submit = document.getElementById('bookingReceiptSubmit');
    const cancel = document.getElementById('bookingReceiptCancel');
    const close = document.getElementById('bookingReceiptClose');
    [submit, cancel, close].forEach((button) => { if (button) button.disabled = true; });

    const file = state.selectedFile;
    const requestId = newRequestId();
    let submitted = false;
    const retake = document.getElementById('bookingReceiptRetake');
    if (retake) retake.disabled = true;
    try {
      setMessage('正在建立安全上傳連結…');
      const prepared = await window.BookingSystem.request(
        currentSession.config,
        'booking',
        currentSession.idToken,
        'user.booking.receipt.prepare',
        {
          bookingId: state.selectedBookingId,
          requestId,
          mimeType: String(file.type || '').toLowerCase(),
          sizeBytes: file.size,
        }
      );

      setMessage('正在上傳收據圖片…');
      await uploadSigned(currentSession.config, prepared, file);

      setMessage('正在驗證圖片並送交管理端確認…');
      const finalized = await window.BookingSystem.request(
        currentSession.config,
        'booking',
        currentSession.idToken,
        'user.booking.receipt.finalize',
        {
          receiptId: prepared.receiptId,
          expectedUpdatedAt: state.selectedExpectedUpdatedAt,
        }
      );

      submitted = true;
      setMessage(finalized.alreadyApplied ? '此收據已送出，正在等待管理端確認。' : '收據已安全送出，請等待管理端核對後完成預約。');
      state.receiptsByBooking.set(state.selectedBookingId, {
        receiptId: String(finalized.receiptId || prepared.receiptId || ''),
        status: String(finalized.status || 'awaiting_review'),
      });
      window.setTimeout(() => {
        state.busy = false;
        [submit, cancel, close].forEach((button) => { if (button) button.disabled = false; });
        if (retake) retake.disabled = false;
        closeModal();
        void refreshListAndDecorate();
      }, 900);
      return;
    } catch (error) {
      setMessage(
        error?.code === 'API_RESPONSE_UNCERTAIN'
          ? '無法確認最後結果。請先重新整理頁面；若已完成，系統不會再次結算。'
          : (error?.message || '收據上傳或送審失敗，請重新拍攝後再試。'),
        true
      );
    } finally {
      if (!submitted) {
        state.busy = false;
        [submit, cancel, close].forEach((button) => { if (button) button.disabled = false; });
        if (retake) retake.disabled = false;
      }
    }
  }

  function decorateCards() {
    document.querySelectorAll('#bookingList [data-booking-id]').forEach((card) => {
      const bookingId = String(card.dataset.bookingId || '');
      const meta = state.metadataByBooking.get(bookingId);
      if (!bookingId || !meta) return;

      card.querySelectorAll('[data-booking-receipt-control]').forEach((node) => node.remove());

      const bound = meta.receipt?.status === 'bound';
      const awaitingReview = meta.receipt?.status === 'awaiting_review';
      const pending = meta.receipt?.status === 'pending_upload';

      if (bound) {
        const note = document.createElement('p');
        note.dataset.bookingReceiptControl = '1';
        note.className = 'booking-receipt-status is-bound';
        note.textContent = '收據已確認 · 服務完成';
        card.append(note);
        return;
      }

      const canSubmitReceipt = Boolean(meta.canSubmitReceipt ?? meta.canComplete);

      if (awaitingReview) {
        const note = document.createElement('p');
        note.dataset.bookingReceiptControl = '1';
        note.className = 'booking-receipt-status';
        note.textContent = '收據已送出 · 等待管理端確認；重新拍攝會覆蓋目前快照';
        card.append(note);
      }

      if (canSubmitReceipt) {
        const actions = document.createElement('div');
        actions.dataset.bookingReceiptControl = '1';
        actions.className = 'booking-actions booking-receipt-card-actions';
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'button button-dark';
        button.textContent = awaitingReview
          ? '重新拍攝並覆蓋收據'
          : pending
            ? '收據上傳未完成，重新拍攝'
            : '拍攝收據送出審核';
        button.addEventListener('click', () => openModal(bookingId, meta.updatedAt));
        actions.append(button);
        card.append(actions);
      }
    });
  }

  async function refreshListAndDecorate() {
    if (state.listLoading) return;
    const currentSession = session();
    if (!currentSession) return;
    state.listLoading = true;
    try {
      const data = await window.BookingSystem.request(
        currentSession.config,
        'booking',
        currentSession.idToken,
        'user.booking.receipt.list'
      );
      state.metadataByBooking.clear();
      (Array.isArray(data.bookings) ? data.bookings : []).forEach((item) => {
        state.metadataByBooking.set(String(item.bookingId || ''), item);
      });
      decorateCards();
    } catch (error) {
      console.warn('booking receipt list failed', error);
    } finally {
      state.listLoading = false;
    }
  }

  window.addEventListener('DOMContentLoaded', ensureModal);
  window.addEventListener('pagehide', () => {
    state.photoGeneration += 1;
    stopCamera();
  });
  window.addEventListener('booking:bookings-rendered', () => { void refreshListAndDecorate(); });
  window.addEventListener('pageshow', () => {
    if (!document.getElementById('bookingView')?.classList.contains('hidden')) void refreshListAndDecorate();
  });
})();
