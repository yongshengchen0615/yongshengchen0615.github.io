(() => {
  'use strict';

  const state = { receiptByBooking: new Map(), loading: false, currentBooking: null, confirming: false, queueObserver: null, queueObserverTarget: null };

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
        <div id="adminBookingReceiptSummary" class="admin-booking-receipt-summary hidden"></div>
        <div id="adminBookingReceiptLoading" class="admin-booking-receipt-loading">正在建立安全檢視連結…</div>
        <img id="adminBookingReceiptImage" class="admin-booking-receipt-image hidden" alt="會員拍攝的預約收據快照">
        <p id="adminBookingReceiptMessage" class="form-message hidden" role="alert"></p>
        <div class="booking-admin-modal-actions">
          <button id="adminBookingReceiptConfirm" class="button button-dark hidden" type="button">確認收據並完成預約</button>
        </div>
      </div>`;
    document.body.append(modal);
    modal.querySelector('#adminBookingReceiptClose').addEventListener('click', closeViewer);
    modal.querySelector('#adminBookingReceiptConfirm').addEventListener('click', confirmReceipt);
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
    modal.querySelector('#adminBookingReceiptConfirm')?.classList.add('hidden');
    state.currentBooking = null;
    modal.classList.add('hidden');
  }

  function renderBookingSummary(host, booking) {
    if (!host) return;
    host.replaceChildren();
    if (!booking || typeof booking !== 'object') {
      host.classList.add('hidden');
      return;
    }

    const member = booking.member && typeof booking.member === 'object' ? booking.member : {};
    const memberName = String(member.displayName || '').trim()
      || [String(member.surname || '').trim(), String(member.salutation || '').trim()].filter(Boolean).join('')
      || '會員';
    const nextDay = booking.startsNextDay ? '（翌日結束）' : '';
    const rows = [
      ['會員', memberName + (member.memberCode ? ' · ' + member.memberCode : '')],
      ['預約日期', String(booking.bookingDate || '')],
      ['服務時間', String(booking.startTime || '') + '–' + String(booking.endTime || '') + nextDay],
      ['預約狀態', String(booking.status || '')],
    ];

    const list = document.createElement('dl');
    list.className = 'admin-booking-receipt-facts';
    rows.forEach(([label, value]) => {
      const dt = document.createElement('dt');
      const dd = document.createElement('dd');
      dt.textContent = label;
      dd.textContent = value || '—';
      list.append(dt, dd);
    });
    host.append(list);

    const items = Array.isArray(booking.items) ? booking.items : [];
    const heading = document.createElement('strong');
    heading.textContent = '預約項目';
    host.append(heading);
    if (!items.length) {
      const empty = document.createElement('p');
      empty.textContent = '此預約沒有可顯示的項目明細。';
      host.append(empty);
    } else {
      const ul = document.createElement('ul');
      ul.className = 'admin-booking-receipt-items';
      items.forEach((item) => {
        const li = document.createElement('li');
        const qty = Math.max(1, Number(item?.quantity || 1));
        li.textContent = String(item?.title || '預約項目') + (qty > 1 ? ' ×' + qty : '');
        ul.append(li);
      });
      host.append(ul);
    }
    host.classList.remove('hidden');
  }

  async function openViewer(bookingId) {
    const currentSession = session();
    if (!currentSession) return;
    const modal = ensureViewer();
    const loading = modal.querySelector('#adminBookingReceiptLoading');
    const image = modal.querySelector('#adminBookingReceiptImage');
    const message = modal.querySelector('#adminBookingReceiptMessage');
    const meta = modal.querySelector('#adminBookingReceiptMeta');
    const summary = modal.querySelector('#adminBookingReceiptSummary');
    const confirm = modal.querySelector('#adminBookingReceiptConfirm');
    const receipt = state.receiptByBooking.get(String(bookingId || ''));

    state.currentBooking = null;
    confirm?.classList.add('hidden');
    modal.classList.remove('hidden');
    loading.classList.remove('hidden');
    image.classList.add('hidden');
    message.classList.add('hidden');
    summary?.classList.add('hidden');
    if (summary) summary.replaceChildren();
    meta.textContent = receipt?.status === 'awaiting_review'
      ? '狀態：等待管理端確認'
      : receipt?.boundAt
        ? '完成時間：' + new Date(receipt.boundAt).toLocaleString('zh-Hant-TW')
        : '';

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
      state.currentBooking = data.booking && typeof data.booking === 'object' ? data.booking : null;
      renderBookingSummary(summary, data.booking);
      if (receipt?.status === 'awaiting_review' && state.currentBooking?.status === 'confirmed') confirm?.classList.remove('hidden');
      loading.classList.add('hidden');
    } catch (error) {
      loading.classList.add('hidden');
      message.textContent = error?.message || '目前無法載入收據快照。';
      message.classList.remove('hidden');
    }
  }

  async function confirmReceipt() {
    if (state.confirming || !state.currentBooking) return;
    const currentSession = session();
    if (!currentSession) return;
    const bookingId = String(state.currentBooking.bookingId || '');
    const expectedUpdatedAt = String(state.currentBooking.updatedAt || '');
    if (!bookingId || !expectedUpdatedAt) return;

    const modal = ensureViewer();
    const button = modal.querySelector('#adminBookingReceiptConfirm');
    const message = modal.querySelector('#adminBookingReceiptMessage');
    const card = Array.from(document.querySelectorAll('#bookingAdminQueue [data-booking-id]'))
      .find((item) => String(item.dataset.bookingId || '') === bookingId);
    const adminNote = String(card?.querySelector('textarea')?.value || '').slice(0, 500);

    state.confirming = true;
    if (button) { button.disabled = true; button.textContent = '確認中…'; }
    message?.classList.add('hidden');
    try {
      await window.MemberSystem.request(
        currentSession.config,
        'admin',
        currentSession.idToken,
        'admin.booking.status.complete',
        { bookingId, expectedUpdatedAt, adminNote }
      );
      const receipt = state.receiptByBooking.get(bookingId);
      if (receipt) {
        receipt.status = 'bound';
        receipt.boundAt = new Date().toISOString();
      }
      if (message) {
        message.textContent = '收據已確認，預約已完成並完成結算。';
        message.classList.remove('hidden');
      }
      button?.classList.add('hidden');
      window.setTimeout(() => {
        void refresh();
        window.dispatchEvent(new CustomEvent('member-admin:booking-focus', { detail: { bookingId } }));
      }, 250);
    } catch (error) {
      if (message) {
        message.textContent = error?.message || '目前無法確認收據並完成預約。';
        message.classList.remove('hidden');
      }
    } finally {
      state.confirming = false;
      if (button) { button.disabled = false; button.textContent = '確認收據並完成預約'; }
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
          if (button.dataset.bookingReceiptComplete === '1' || button.textContent?.includes('確認服務完成')) {
            button.dataset.bookingReceiptComplete = '1';
            button.disabled = true;
            button.textContent = receipt?.status === 'awaiting_review' ? '請先查看收據確認' : '等待會員上傳收據';
            button.title = receipt?.status === 'awaiting_review'
              ? '請先查看會員拍攝的收據，確認內容正確後再完成預約。'
              : '會員尚未送出收據，管理端不可直接完成預約。';
          }
        });
      }

      if (!receipt || !['awaiting_review', 'bound'].includes(String(receipt.status || ''))) return;
      const host = actions || card;
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.adminBookingReceiptControl = '1';
      button.className = 'button button-outline';
      button.textContent = receipt.status === 'awaiting_review' ? '查看收據並確認' : '查看收據快照';
      button.addEventListener('click', () => openViewer(bookingId));
      host.append(button);
    });
  }

  function ensureQueueObserver() {
    const queue = document.getElementById('bookingAdminQueue');
    if (!queue || state.queueObserverTarget === queue || typeof MutationObserver !== 'function') return;

    state.queueObserver?.disconnect();
    state.queueObserverTarget = queue;
    state.queueObserver = new MutationObserver(() => {
      window.setTimeout(decorateCards, 0);
    });
    // Observe only direct booking-card replacement. Receipt controls are added inside
    // each card, so subtree=false prevents the observer from triggering itself.
    state.queueObserver.observe(queue, { childList: true });
    decorateCards();
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

  window.addEventListener('DOMContentLoaded', () => {
    ensureViewer();
    ensureQueueObserver();
  });
  window.addEventListener('member-admin-ready', () => {
    ensureQueueObserver();
    void refresh();
  });
  window.addEventListener('member-admin-data-refreshed', () => {
    ensureQueueObserver();
    void refresh();
  });
  window.addEventListener('member-admin:booking-snapshot', () => {
    ensureQueueObserver();
    void refresh();
  });
  window.addEventListener('member-admin:booking-focus', () => {
    ensureQueueObserver();
    window.setTimeout(decorateCards, 0);
  });
})();
