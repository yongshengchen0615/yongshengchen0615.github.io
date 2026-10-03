(() => {
  'use strict';
  const key = 'booking-accessible-mode';
  const el = id => document.getElementById(id);
  let enabled = false;
  function setMode(value) {
    enabled = Boolean(value);
    document.body.classList.toggle('booking-accessible-mode', enabled);
    el('bookingAccessiblePanel')?.classList.toggle('hidden', !enabled);
    const toggle = el('bookingAccessibleToggle');
    toggle?.setAttribute('aria-pressed', String(enabled));
    if (toggle) toggle.textContent = enabled ? '返回一般預約模式' : '開啟無障礙模式（大字・拍收據）';
    try { localStorage.setItem(key, enabled ? '1' : '0'); } catch { /* Preference is optional. */ }
    if (enabled) { renderTickets(window.BookingBenefits?.getItems?.() || []); void window.BookingReceipts?.refresh?.(); }
  }
  function renderTickets(items) {
    const host = el('bookingAccessibleTickets');
    if (!host) return;
    host.replaceChildren();
    const tickets = (Array.isArray(items) ? items : []).filter(item => ['points','event'].includes(item.kind) && item.selectable === true && !item.reservedForBooking);
    tickets.forEach(item => {
      const card = document.createElement('article');
      const title = document.createElement('h4'); title.textContent = String(item.title || '可用票券');
      const status = document.createElement('p'); status.textContent = item.claimRequired ? '符合領取資格・尚未領取' : '目前持有・可供核對使用';
      const condition = document.createElement('p'); condition.textContent = String(item.conditionLabel || item.subtitle || '依票券使用條件核對');
      const expiry = document.createElement('p'); expiry.textContent = item.endsOn ? `有效至 ${item.endsOn}` : '依票券有效期限使用';
      card.append(title,status,condition,expiry); host.append(card);
    });
    if (el('bookingAccessibleTicketsStatus')) el('bookingAccessibleTicketsStatus').textContent = tickets.length ? `目前有 ${tickets.length} 項可用／可領取票券。` : '目前沒有可用票券。';
  }
  function renderStatus(submissions) {
    const status = el('bookingAccessibleStatus');
    if (!status) return;
    const latest = (Array.isArray(submissions) ? submissions : []).find(r => ['awaiting_review','bound'].includes(r.status) || r.dismissed);
    if (!latest) { status.textContent = '尚未送出收據。'; return; }
    if (latest.status === 'awaiting_review') {
      status.textContent = '收據已送出，等待管理員登記。再次拍攝會取代目前待登記收據。';
    } else if (latest.dismissed) {
      status.textContent = '管理員請您重新提供收據，請確認內容後再次拍攝。';
    } else {
      const settlement = Array.isArray(latest.settlement) ? latest.settlement[0] : latest.settlement;
      const minutes = Number(settlement?.service_minutes || 0);
      const rewards = Array.isArray(settlement?.reward_details) ? settlement.reward_details : [];
      const points = rewards.reduce((sum, reward) => sum + Math.max(0,Number(reward.points || 0)),0);
      status.textContent = `管理員已登記完成${settlement ? `：累積服務 ${minutes} 分鐘，獲得 ${points} 點。` : '，點數與服務時間已依規則記錄。'}`;
    }
  }
  window.addEventListener('DOMContentLoaded', () => {
    el('bookingAccessibleToggle')?.addEventListener('click', () => setMode(!enabled));
    el('bookingAccessibleUpload')?.addEventListener('click', () => window.BookingReceipts?.openAccessible?.());
    el('bookingAccessibleRefresh')?.addEventListener('click', () => {
      el('bookingAccessibleStatus').textContent = '正在更新登記狀態…';
      window.BookingBenefits?.syncNow?.(); void window.BookingReceipts?.refresh?.();
    });
    try { enabled = localStorage.getItem(key) === '1'; } catch { /* Storage unavailable. */ }
    setMode(enabled);
  });
  window.addEventListener('booking:benefits-loaded', event => renderTickets(event.detail?.items));
  window.addEventListener('booking:receipts-updated', event => renderStatus(event.detail?.submissions));
  window.addEventListener('booking:receipt-load-error', () => {
    if (el('bookingAccessibleStatus')) el('bookingAccessibleStatus').textContent = '暫時無法更新收據狀態，請按「更新登記狀態與票券」重試。';
  });
  window.addEventListener('booking:accessible-receipt-submitted', () => {
    el('bookingAccessibleStatus').textContent = '收據已送出，等待管理員登記。';
  });
  window.addEventListener('booking:view-shown', () => { if (enabled) void window.BookingReceipts?.refresh?.(); });
})();
