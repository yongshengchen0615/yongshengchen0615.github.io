(() => {
  'use strict';

  const system = window.BookingSystem;
  if (!system || typeof system.request !== 'function') return;

  const originalRequest = system.request.bind(system);
  const REQUEST_TIMEOUT_MS = 15000;
  let latestBookings = [];

  system.request = async function requestWithContactDetails(config, clientType, idToken, action, payload = {}) {
    const result = await originalRequest(config, clientType, idToken, action, payload);
    if (clientType !== 'admin' || action !== 'admin.booking.bootstrap') return result;

    const bookings = Array.isArray(result?.bookings) ? result.bookings : [];
    if (!bookings.length) {
      latestBookings = [];
      return result;
    }

    const endpoint = `${String(config.supabaseUrl || '').replace(/\/$/, '')}/functions/v1/booking-contact-api`;
    const contacts = await postJson(endpoint, config, {
      action: 'admin.booking.contacts',
      clientType: 'admin',
      idToken,
      bookingIds: bookings.map((item) => item.bookingId),
    });
    const byId = new Map((contacts.contacts || []).map((item) => [item.bookingId, item]));
    result.bookings = bookings.map((item) => ({ ...item, ...(byId.get(item.bookingId) || {}) }));
    latestBookings = result.bookings;
    queueMicrotask(injectContactRows);
    return result;
  };

  window.addEventListener('DOMContentLoaded', () => {
    const queue = document.getElementById('bookingQueue');
    if (queue) new MutationObserver(injectContactRows).observe(queue, { childList: true, subtree: false });
  });

  async function postJson(endpoint, config, body) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: String(config.supabasePublishableKey || '') },
        cache: 'no-store',
        signal: controller.signal,
        body: JSON.stringify(body),
      });
      let data;
      try { data = await response.json(); }
      catch { throw clientError('API_INVALID_RESPONSE', '預約聯絡資料服務回傳格式不正確。'); }
      if (!response.ok || data?.ok !== true) {
        const apiError = data?.error || {};
        throw clientError(String(apiError.code || 'API_ERROR'), String(apiError.message || '預約聯絡資料暫時無法讀取。'));
      }
      return data.data || {};
    } catch (error) {
      if (error?.name === 'AbortError') throw clientError('API_TIMEOUT', '預約聯絡資料服務回應逾時。');
      throw error;
    } finally {
      window.clearTimeout(timer);
    }
  }

  function injectContactRows() {
    const cards = [...document.querySelectorAll('#bookingQueue > .booking-card')];
    const used = new Set();
    cards.forEach((card) => {
      card.querySelector('.booking-contact-admin')?.remove();
      const text = String(card.textContent || '');
      const booking = latestBookings.find((item) => {
        if (used.has(item.bookingId)) return false;
        const identityMatches = item.memberCode ? text.includes(item.memberCode) : text.includes(item.memberDisplayName || '');
        const dateMatches = text.includes(system.formatDate(item.bookingDate));
        const timeMatches = text.includes(`${item.startTime}–${item.endTime}`);
        return identityMatches && dateMatches && timeMatches;
      });
      if (!booking) return;
      used.add(booking.bookingId);

      const row = document.createElement('p');
      row.className = 'booking-contact-admin';
      const label = salutationLabel(booking.contactSalutation);
      const sourceLabel = booking.contactSource === 'custom' ? '本次另填' : '會員資料';
      const safeName = booking.contactSurname && label ? `${booking.contactSurname}${label}` : '資料未完整';
      row.innerHTML = `<strong>預約聯絡：</strong>${escapeHtml(safeName)}｜${escapeHtml(booking.contactPhone || '未填寫')}<span class="booking-contact-source-label">${sourceLabel}</span>`;
      const heading = card.querySelector('.booking-heading');
      if (heading) heading.insertAdjacentElement('afterend', row);
      else card.prepend(row);
    });
  }

  function salutationLabel(value) { return value === 'mr' ? '先生' : value === 'ms' ? '小姐' : ''; }
  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }
  function clientError(code, message) { const error = new Error(message); error.code = code; return error; }
})();
