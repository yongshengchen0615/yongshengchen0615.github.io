(() => {
  'use strict';

  const state = { receiptByBooking: new Map(), loading: false };

  function session() {
    return window.MemberSystem?.getSession?.('admin') || null;
  }

  function ensureViewer() {
    let modal = document.getElementById('adminBookingReceiptModal');
    if (modal) return modal;
    modal = document.createElement('section');
    modal.id = 'adminBookingReceiptModal';
    modal.className = 'admin-booking-receipt-modal hidden';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'adminBookingReceiptTitle');
    modal.innerHTML = `
      <div class="admin-booking-receipt-card">
        <div class="admin-booking-receipt-heading">
          <div><p class="kicker">Receipt snapshot</p><h2 id="adminBookingReceiptTitle">預約收據快照</h2></div>
          <button id="adminBookingReceiptClose" class="close-button" type="button" aria-label="關閉">×</button>
        </div>
        <p id="adminBookingReceiptMeta" class="admin-booking-receipt-meta"></p>
        <div id="adminBookingReceiptLoading" class="admin-booking-receipt-loading">正在建立安全檢視連結…</div>
        <img id="adminBookingReceiptImage" class="admin-booking-receipt-image hidden" alt="預約完成時的收據快照">
        <p id="adminBookingReceiptMessage" class="form-message hidden" role="alert"></p>
      </div>`;
    document.body.append(modal);
    modal.querySelector('#adminBookingReceiptClose').addEventListener('click', closeViewer);
    modal.addEventListener('click', (event) => { if (event.target === modal) closeViewer(); });
    return modal;
  }

  function closeViewer() {
    const modal = document.getElementById('adminBookingReceiptModal');
    if (!modal) return;
    const image = modal.querySelector('#adminBookingReceiptImage');
    if (image) {
      image.removeAttribute('src');
      image.classList.add('hidden');
    }
    modal.classList.add('hidden');
  }

  async function openViewer(bookingId) {
    const currentSession = session();
    if (!currentSession) return;
    const modal = ensureViewer();
    const loading = modal.querySelector('#adminBookingReceiptLoading');
    const image = modal.querySelector('#adminBookingReceiptImage');
    const message = modal.querySelector('#adminBookingReceiptMessage');
    const meta = modal.querySelector('#adminBookingReceiptMeta');
    const receipt = state.receiptByBooking.get(String(bookingId || ''));

    modal.classList.remove('hidden');
    loading.classList.remove('hidden');
    image.classList.add('hidden');
    message.classList.add('hidden');
    meta.textContent = receipt?.boundAt ? '完成時間：' + new Date(receipt.boundAt).toLocaleString('zh-Hant-TW') : '';

    try {
      const data = await window.MemberSystem.request(
        currentSession.config,
        'admin',
        currentSession.idToken,
        'admin.booking.receipt.url',
        { bookingId: String(bookingId || '') }
      );
      image.src = String(data.signedUrl || '');
      image.classList.remove('hidden');
      loading.classList.add('hidden');
    } catch (error) {
      loading.classList.add('hidden');
      message.textContent = error?.message || '目前無法載入收據快照。';
      message.classList.remove('hidden');
    }
  }

  function decorateCards() {
    document.querySelectorAll('#bookingAdminQueue [data-booking-id]').forEach((card) => {
      const bookingId = String(card.dataset.bookingId || '');
      if (!bookingId) return;
      card.querySelectorAll('[data-admin-booking-receipt-control]').forEach((node) => node.remove());

      const receipt = state.receiptByBooking.get(bookingId);
      const actions = card.querySelector('.booking-admin-actions');

      if (actions) {
        Array.from(actions.querySelectorAll('button')).forEach((button) => {
          if (button.textContent?.includes('確認服務完成')) {
            button.disabled = true;
            button.textContent = '由會員拍攝收據完成';
            button.title = '完成預約需由會員拍攝並安全綁定收據，管理端不可略過此驗證。';
          }
        });
      }

      if (!receipt) return;
      const host = actions || card;
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.adminBookingReceiptControl = '1';
      button.className = 'button button-outline';
      button.textContent = '查看收據快照';
      button.addEventListener('click', () => openViewer(bookingId));
      host.append(button);
    });
  }

  async function refresh() {
    if (state.loading) return;
    const currentSession = session();
    if (!currentSession) return;
    state.loading = true;
    try {
      const data = await window.MemberSystem.request(
        currentSession.config,
        'admin',
        currentSession.idToken,
        'admin.booking.receipt.list'
      );
      state.receiptByBooking.clear();
      (Array.isArray(data.receipts) ? data.receipts : []).forEach((receipt) => {
        state.receiptByBooking.set(String(receipt.bookingId || ''), receipt);
      });
      decorateCards();
    } catch (error) {
      console.warn('admin booking receipt list failed', error);
    } finally {
      state.loading = false;
    }
  }

  window.addEventListener('DOMContentLoaded', ensureViewer);
  window.addEventListener('member-admin-ready', () => { void refresh(); });
  window.addEventListener('member-admin-data-refreshed', () => { void refresh(); });
  window.addEventListener('member-admin:booking-snapshot', () => { void refresh(); });
  window.addEventListener('member-admin:booking-focus', () => { window.setTimeout(decorateCards, 0); });
})();
