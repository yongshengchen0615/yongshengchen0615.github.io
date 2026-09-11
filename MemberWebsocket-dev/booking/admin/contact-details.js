(() => {
  'use strict';

  const system = window.BookingSystem;
  if (!system || typeof system.request !== 'function') return;

  const originalRequest = system.request.bind(system);
  const REQUEST_TIMEOUT_MS = 15000;
  const STORE_SERVICE_ID = '00000000-0000-4000-8000-000000000010';
  let latestBookings = [];

  system.request = async function requestWithContactDetails(config, clientType, idToken, action, payload = {}) {
    const result = await originalRequest(config, clientType, idToken, action, payload);
    if (clientType !== 'admin' || action !== 'admin.booking.bootstrap') return result;

    result.services = Array.isArray(result?.services)
      ? result.services.filter((service) => String(service?.serviceId || '') !== STORE_SERVICE_ID)
      : [];

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
    queueMicrotask(injectBookingSummaries);
    return result;
  };

  window.addEventListener('DOMContentLoaded', () => {
    const queue = document.getElementById('bookingQueue');
    if (queue) new MutationObserver(injectBookingSummaries).observe(queue, { childList: true, subtree: false });
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
      if (error?.name === 'AbortError') throw clientError('API_TIMEOUT', '預約聯絡資料服務回應逾時，請稍後再試。');
      throw error;
    } finally {
      window.clearTimeout(timer);
    }
  }

  function injectBookingSummaries() {
    const cards = [...document.querySelectorAll('#bookingQueue > .booking-card')];
    const used = new Set();

    cards.forEach((card) => {
      card.querySelector('.booking-received-summary')?.remove();
      card.querySelector('.booking-contact-admin')?.remove();

      const booking = findBookingForCard(card, used);
      if (!booking) return;
      used.add(booking.bookingId);
      card.dataset.bookingId = String(booking.bookingId || '');
      normalizeBookingCard(card, booking);
    });
  }

  function findBookingForCard(card, used) {
    const existingId = String(card.dataset.bookingId || '');
    if (existingId) {
      const exact = latestBookings.find((item) => String(item.bookingId || '') === existingId && !used.has(item.bookingId));
      if (exact) return exact;
    }

    const text = String(card.textContent || '');
    return latestBookings.find((item) => {
      if (used.has(item.bookingId)) return false;
      const identityMatches = item.memberCode ? text.includes(item.memberCode) : text.includes(item.memberDisplayName || '');
      const dateMatches = text.includes(system.formatDate(item.bookingDate));
      const originalRangeMatches = text.includes(`${item.startTime}–${item.endTime}`);
      const startTimeMatches = text.includes(`開始時間：${item.startTime}`) || text.includes(String(item.startTime || ''));
      return identityMatches && dateMatches && (originalRangeMatches || startTimeMatches);
    });
  }

  function normalizeBookingCard(card, booking) {
    const visibleItems = visibleBookingItems(booking);
    const displayName = bookingContactName(booking);

    const heading = card.querySelector('.booking-heading');
    const headingIdentity = heading?.querySelector('div');
    const headingName = headingIdentity?.querySelector('strong');
    const headingCode = headingIdentity?.querySelector('small');
    if (headingName) headingName.textContent = displayName;
    if (headingCode) headingCode.hidden = true;

    const legacyServiceHeading = card.querySelector('h3');
    if (legacyServiceHeading) legacyServiceHeading.hidden = true;

    const directList = [...card.children].find((element) => element.tagName === 'UL');
    directList?.remove();

    const summary = document.createElement('div');
    summary.className = 'booking-received-summary';

    const phone = document.createElement('p');
    const phoneLabel = document.createElement('strong');
    phoneLabel.textContent = '電話：';
    phone.append(phoneLabel, document.createTextNode(String(booking.contactPhone || '未填寫')));
    summary.appendChild(phone);

    const servicesLabel = document.createElement('p');
    servicesLabel.className = 'booking-received-services-label';
    const servicesLabelStrong = document.createElement('strong');
    servicesLabelStrong.textContent = '服務項目：';
    servicesLabel.appendChild(servicesLabelStrong);
    summary.appendChild(servicesLabel);

    const services = document.createElement('div');
    services.className = 'booking-received-services';
    if (!visibleItems.length) {
      const empty = document.createElement('span');
      empty.textContent = '尚無會員服務項目';
      services.appendChild(empty);
    } else {
      visibleItems.forEach((item) => {
        const line = document.createElement('span');
        const quantity = Math.max(1, Number(item.quantity || 1));
        line.textContent = `${String(item.serviceTitle || '服務項目').trim()}${quantity > 1 ? ` × ${quantity}` : ''}`;
        services.appendChild(line);
      });
    }
    summary.appendChild(services);

    if (heading) heading.insertAdjacentElement('afterend', summary);
    else card.prepend(summary);

    const time = card.querySelector('.booking-time');
    if (time) {
      time.textContent = `預約日期：${system.formatDate(booking.bookingDate)}　｜　開始時間：${booking.startTime || '—'}`;
    }
  }

  function bookingContactName(booking) {
    const surname = String(booking?.contactSurname || '').trim();
    const label = salutationLabel(booking?.contactSalutation);
    if (surname && label) return `${surname}${label}`;
    return String(booking?.memberDisplayName || booking?.memberCode || '會員');
  }

  function visibleBookingItems(booking) {
    return Array.isArray(booking?.items)
      ? booking.items.filter((item) => String(item?.serviceId || '') !== STORE_SERVICE_ID)
      : [];
  }

  function salutationLabel(value) { return value === 'mr' ? '先生' : value === 'ms' ? '小姐' : ''; }
  function clientError(code, message) { const error = new Error(message); error.code = code; return error; }
})();
