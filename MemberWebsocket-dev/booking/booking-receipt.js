(() => {
  'use strict';

  const state = {
    receiptsByBooking: new Map(),
    metadataByBooking: new Map(),
    selectedBookingId: '',
    selectedExpectedUpdatedAt: '',
    selectedFile: null,
    previewUrl: '',
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
          <div><p class="kicker">Receipt verification</p><h2 id="bookingReceiptTitle">拍攝收據並完成預約</h2></div>
          <button id="bookingReceiptClose" class="booking-modal-close" type="button" aria-label="關閉">×</button>
        </div>
        <p class="booking-receipt-help">請拍攝本次消費收據。圖片成功安全上傳並綁定後，系統才會完成預約與既有結算。</p>
        <label class="booking-receipt-file-label">
          <span>拍攝或選擇收據圖片</span>
          <input id="bookingReceiptFile" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" capture="environment">
        </label>
        <div id="bookingReceiptPreviewWrap" class="booking-receipt-preview hidden">
          <img id="bookingReceiptPreview" alt="本次收據預覽">
          <p id="bookingReceiptFileMeta"></p>
        </div>
        <p id="bookingReceiptMessage" class="booking-receipt-message hidden" role="status" aria-live="polite"></p>
        <div class="booking-receipt-actions">
          <button id="bookingReceiptCancel" class="button button-light" type="button">取消</button>
          <button id="bookingReceiptSubmit" class="button button-dark" type="button" disabled>確認上傳並完成預約</button>
        </div>
      </div>`;
    document.body.append(modal);

    modal.querySelector('#bookingReceiptClose').addEventListener('click', closeModal);
    modal.querySelector('#bookingReceiptCancel').addEventListener('click', closeModal);
    modal.querySelector('#bookingReceiptFile').addEventListener('change', fileChanged);
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
    if (state.previewUrl) {
      try { URL.revokeObjectURL(state.previewUrl); } catch (_) {}
      state.previewUrl = '';
    }
  }

  function resetModalState() {
    cleanupPreview();
    state.selectedFile = null;
    const input = document.getElementById('bookingReceiptFile');
    const wrap = document.getElementById('bookingReceiptPreviewWrap');
    const preview = document.getElementById('bookingReceiptPreview');
    const meta = document.getElementById('bookingReceiptFileMeta');
    const submit = document.getElementById('bookingReceiptSubmit');
    if (input) input.value = '';
    if (preview) preview.removeAttribute('src');
    if (meta) meta.textContent = '';
    if (wrap) wrap.classList.add('hidden');
    if (submit) submit.disabled = true;
    setMessage('');
  }

  function closeModal() {
    if (state.busy) return;
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
    modal.querySelector('#bookingReceiptFile')?.focus();
  }

  function fileChanged(event) {
    cleanupPreview();
    const file = event.target.files?.[0] || null;
    state.selectedFile = file;
    const wrap = document.getElementById('bookingReceiptPreviewWrap');
    const preview = document.getElementById('bookingReceiptPreview');
    const meta = document.getElementById('bookingReceiptFileMeta');
    const submit = document.getElementById('bookingReceiptSubmit');

    if (!file) {
      wrap?.classList.add('hidden');
      if (submit) submit.disabled = true;
      return;
    }

    const allowed = new Set(['image/jpeg','image/png','image/webp','image/heic','image/heif']);
    if (!allowed.has(String(file.type || '').toLowerCase())) {
      state.selectedFile = null;
      event.target.value = '';
      setMessage('請使用 JPG、PNG、WebP、HEIC 或 HEIF 圖片。', true);
      if (submit) submit.disabled = true;
      return;
    }
    if (file.size < 1 || file.size > 5 * 1024 * 1024) {
      state.selectedFile = null;
      event.target.value = '';
      setMessage('收據圖片不可超過 5 MB。', true);
      if (submit) submit.disabled = true;
      return;
    }

    state.previewUrl = URL.createObjectURL(file);
    if (preview) preview.src = state.previewUrl;
    if (meta) meta.textContent = `${file.name || '收據照片'} · ${humanSize(file.size)}`;
    wrap?.classList.remove('hidden');
    if (submit) submit.disabled = false;
    setMessage('請確認照片清楚可辨識，再完成上傳。');
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

      setMessage('正在驗證圖片並完成預約…');
      const completed = await window.BookingSystem.request(
        currentSession.config,
        'booking',
        currentSession.idToken,
        'user.booking.receipt.finalize',
        {
          receiptId: prepared.receiptId,
          expectedUpdatedAt: state.selectedExpectedUpdatedAt,
        }
      );

      setMessage(completed.alreadyApplied ? '此預約已完成，收據綁定狀態已確認。' : '收據已安全綁定，預約完成與結算已完成。');
      state.receiptsByBooking.set(state.selectedBookingId, {
        receiptId: String(completed.receiptId || prepared.receiptId || ''),
        status: 'bound',
      });
      window.setTimeout(() => {
        state.busy = false;
        [submit, cancel, close].forEach((button) => { if (button) button.disabled = false; });
        closeModal();
        void refreshListAndDecorate();
      }, 900);
      return;
    } catch (error) {
      setMessage(
        error?.code === 'API_RESPONSE_UNCERTAIN'
          ? '無法確認最後結果。請先重新整理頁面；若已完成，系統不會再次結算。'
          : (error?.message || '收據上傳或完成預約失敗，請重新拍攝後再試。'),
        true
      );
    } finally {
      if (state.busy) {
        state.busy = false;
        [submit, cancel, close].forEach((button) => { if (button) button.disabled = false; });
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
      const pending = meta.receipt?.status === 'pending_upload';

      if (bound) {
        const note = document.createElement('p');
        note.dataset.bookingReceiptControl = '1';
        note.className = 'booking-receipt-status is-bound';
        note.textContent = '收據已綁定 · 服務完成';
        card.append(note);
        return;
      }

      if (meta.canComplete) {
        const actions = document.createElement('div');
        actions.dataset.bookingReceiptControl = '1';
        actions.className = 'booking-actions booking-receipt-card-actions';
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'button button-dark';
        button.textContent = pending ? '收據上傳未完成，重新處理' : '拍攝收據並完成預約';
        button.addEventListener('click', () => openModal(bookingId, meta.updatedAt));
        actions.append(button);
        card.append(actions);
      } else if (meta.status === 'confirmed') {
        const note = document.createElement('p');
        note.dataset.bookingReceiptControl = '1';
        note.className = 'booking-receipt-status';
        note.textContent = '服務時間結束後即可拍攝收據並完成預約。';
        card.append(note);
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
  window.addEventListener('booking:bookings-rendered', () => { void refreshListAndDecorate(); });
  window.addEventListener('pageshow', () => {
    if (!document.getElementById('bookingView')?.classList.contains('hidden')) void refreshListAndDecorate();
  });
})();
