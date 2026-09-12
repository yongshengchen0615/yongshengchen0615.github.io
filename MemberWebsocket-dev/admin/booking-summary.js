(() => {
  'use strict';

  const STORE_SERVICE_ID = '00000000-0000-4000-8000-000000000010';
  const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];
  const CACHE_TTL_MS = 3000;
  const state = {
    config: null,
    bookings: [],
    loadedAt: 0,
    loading: null,
    queue: null,
    queueObserver: null,
    rootObserver: null,
    refreshTimer: null,
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();

  function mount() {
    ensureQueueObserver();
    state.rootObserver = new MutationObserver(ensureQueueObserver);
    state.rootObserver.observe(document.body, { childList: true, subtree: true });

    document.addEventListener('click', (event) => {
      const target = event.target?.closest?.('#bookingTab, #bookingAdminRefreshButton, [data-booking-filter]');
      if (!target) return;
      scheduleRefresh(target.id === 'bookingAdminRefreshButton');
    });
  }

  function ensureQueueObserver() {
    const queue = document.getElementById('bookingAdminQueue');
    if (!queue || queue === state.queue) return;

    state.queueObserver?.disconnect();
    state.queue = queue;
    state.queueObserver = new MutationObserver(() => scheduleRefresh(false));
    state.queueObserver.observe(queue, { childList: true, subtree: false });
    scheduleRefresh(false);
  }

  function scheduleRefresh(force) {
    renderImmediateSummaries();
    if (state.refreshTimer !== null) window.clearTimeout(state.refreshTimer);
    state.refreshTimer = window.setTimeout(() => {
      state.refreshTimer = null;
      refreshAndDecorate(Boolean(force)).catch((error) => {
        console.warn('booking summary refresh failed', error?.code || error?.message || 'UNKNOWN_ERROR');
      });
    }, force ? 120 : 180);
  }

  function renderImmediateSummaries() {
    if (!state.queue) return;
    state.queue.querySelectorAll(':scope > .booking-admin-booking').forEach((card) => {
      if (card.classList.contains('booking-summary-normalized')) return;
      const booking = legacyBookingFromCard(card);
      if (!booking) return;

      card.dataset.bookingMemberCode = String(booking.memberCode || '');
      card.dataset.bookingMemberName = String(booking.memberDisplayName || '');
      card.dataset.bookingDate = String(booking.bookingDate || '');
      card.dataset.bookingStartTime = String(booking.startTime || '');
      card.classList.add('booking-summary-normalized', 'booking-summary-provisional');
      renderBookingSummary(card, booking);
    });
  }

  function legacyBookingFromCard(card) {
    const heading = card.querySelector(':scope > .booking-admin-booking-heading');
    const identity = heading?.querySelector(':scope > div');
    const memberDisplayName = String(identity?.querySelector('strong')?.textContent || '').trim();
    const rawMemberCode = String(identity?.querySelector('small')?.textContent || '').trim();
    const memberCode = rawMemberCode === '無會員編號' ? '' : rawMemberCode;
    const timeText = String(card.querySelector(':scope > .booking-admin-time')?.textContent || '').trim();
    const timeMatch = /^(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{2}:\d{2})/.exec(timeText);
    if (!timeMatch || (!memberDisplayName && !memberCode)) return null;

    const bookingDate = `${timeMatch[1]}-${String(Number(timeMatch[2])).padStart(2, '0')}-${String(Number(timeMatch[3])).padStart(2, '0')}`;
    const items = [];
    card.querySelectorAll(':scope > .booking-admin-item-list > li').forEach((item) => {
      const text = String(item.textContent || '').trim();
      if (!text || text.startsWith('店內服務 ')) return;
      const match = /^(.*?)\s+×\s+(\d+)/.exec(text);
      items.push({
        serviceId: '',
        serviceTitle: String(match?.[1] || text).trim(),
        quantity: Math.max(1, Number(match?.[2] || 1)),
      });
    });

    if (!items.length) {
      const title = String(card.querySelector(':scope > h4')?.textContent || '').trim();
      title.split(' + ').map((value) => value.trim()).filter(Boolean).forEach((serviceTitle) => {
        items.push({ serviceId: '', serviceTitle, quantity: 1 });
      });
    }

    return {
      bookingId: '',
      bookingDate,
      startTime: timeMatch[4],
      memberDisplayName: memberDisplayName || memberCode || '會員',
      memberCode,
      contactPhone: '',
      items,
    };
  }

  async function refreshAndDecorate(force) {
    if (!state.queue || !state.queue.querySelector('.booking-admin-booking')) return;

    const cacheFresh = state.bookings.length && Date.now() - state.loadedAt < CACHE_TTL_MS;
    if (!force && cacheFresh) {
      decorateCards();
      return;
    }

    if (state.loading) {
      await state.loading;
      decorateCards();
      return;
    }

    state.loading = loadBookings();
    try {
      await state.loading;
      decorateCards();
    } finally {
      state.loading = null;
    }
  }

  async function loadBookings() {
    const bookingData = await requestFunction('booking-api', 'admin.booking.bootstrap');
    const bookings = Array.isArray(bookingData?.bookings) ? bookingData.bookings : [];
    if (!bookings.length) {
      state.bookings = [];
      state.loadedAt = Date.now();
      return;
    }

    let contacts = [];
    try {
      const contactData = await requestFunction('booking-contact-api', 'admin.booking.contacts', {
        bookingIds: bookings.map((booking) => booking.bookingId),
      });
      contacts = Array.isArray(contactData?.contacts) ? contactData.contacts : [];
    } catch (error) {
      console.warn('booking contact summary unavailable', error?.code || error?.message || 'UNKNOWN_ERROR');
    }

    const contactsById = new Map(contacts.map((contact) => [String(contact.bookingId || ''), contact]));
    state.bookings = bookings.map((booking) => ({
      ...booking,
      ...(contactsById.get(String(booking.bookingId || '')) || {}),
    }));
    state.loadedAt = Date.now();
  }

  async function requestFunction(name, action, payload = {}) {
    if (!state.config) state.config = await window.MemberSystem.loadConfig();
    const idToken = String(window.liff?.getIDToken?.() || '');
    if (!idToken) throw clientError('AUTH_REQUIRED', '管理端登入尚未完成。');

    const endpoint = `${String(state.config.supabaseUrl || '').replace(/\/$/, '')}/functions/v1/${name}`;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        cache: 'no-store',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          apikey: String(state.config.supabasePublishableKey || ''),
        },
        body: JSON.stringify({ ...payload, action, clientType: 'admin', idToken }),
      });
      const text = await response.text();
      let data;
      try { data = JSON.parse(text); }
      catch { throw clientError('API_RESPONSE_ERROR', '預約資料回傳格式不正確。'); }
      if (!response.ok || data?.ok !== true) {
        throw clientError(String(data?.error?.code || 'API_ERROR'), String(data?.error?.message || '預約資料服務拒絕此操作。'));
      }
      return data.data || {};
    } catch (error) {
      if (error?.code) throw error;
      if (error?.name === 'AbortError') throw clientError('API_TIMEOUT', '預約資料服務回應逾時。');
      throw clientError('NETWORK_ERROR', '目前無法連線預約資料服務。');
    } finally {
      window.clearTimeout(timer);
    }
  }

  function decorateCards() {
    if (!state.queue) return;
    const cards = [...state.queue.querySelectorAll(':scope > .booking-admin-booking')];
    const used = new Set();

    cards.forEach((card) => {
      const booking = findBookingForCard(card, used);
      if (!booking) return;

      used.add(String(booking.bookingId || ''));
      card.dataset.bookingId = String(booking.bookingId || '');
      normalizeBookingCard(card, booking);
    });
  }

  function findBookingForCard(card, used) {
    const existingId = String(card.dataset.bookingId || '');
    if (existingId) {
      const exact = state.bookings.find((booking) => String(booking.bookingId || '') === existingId && !used.has(existingId));
      if (exact) return exact;
    }

    const storedCode = String(card.dataset.bookingMemberCode || '');
    const storedName = String(card.dataset.bookingMemberName || '');
    const storedDate = String(card.dataset.bookingDate || '');
    const storedTime = String(card.dataset.bookingStartTime || '');
    if (storedDate && storedTime && (storedCode || storedName)) {
      const stored = state.bookings.find((booking) => {
        const bookingId = String(booking.bookingId || '');
        if (!bookingId || used.has(bookingId)) return false;
        const identityMatches = storedCode
          ? String(booking.memberCode || '') === storedCode
          : String(booking.memberDisplayName || '') === storedName;
        return identityMatches
          && String(booking.bookingDate || '') === storedDate
          && String(booking.startTime || '').slice(0, 5) === storedTime;
      });
      if (stored) return stored;
    }

    const text = String(card.textContent || '');
    return state.bookings.find((booking) => {
      const bookingId = String(booking.bookingId || '');
      if (!bookingId || used.has(bookingId)) return false;
      const identityMatches = booking.memberCode
        ? text.includes(String(booking.memberCode))
        : text.includes(String(booking.memberDisplayName || ''));
      const dateMatches = text.includes(formatLegacyDate(booking.bookingDate));
      const timeMatches = text.includes(String(booking.startTime || '').slice(0, 5));
      return identityMatches && dateMatches && timeMatches;
    });
  }

  function normalizeBookingCard(card, booking) {
    card.classList.add('booking-summary-normalized');
    card.classList.remove('booking-summary-provisional');

    const heading = card.querySelector(':scope > .booking-admin-booking-heading');
    heading?.querySelector(':scope > div')?.remove();
    card.querySelector(':scope > h4')?.remove();
    card.querySelector(':scope > .booking-admin-time')?.remove();
    card.querySelector(':scope > .booking-admin-item-list')?.remove();

    renderBookingSummary(card, booking);
  }

  function renderBookingSummary(card, booking) {
    card.querySelector(':scope > .booking-received-summary')?.remove();
    const summary = document.createElement('div');
    summary.className = 'booking-received-summary';

    const dateTime = document.createElement('p');
    dateTime.className = 'booking-received-datetime';
    dateTime.textContent = `${formatBookingDate(booking.bookingDate)} ${String(booking.startTime || '—').slice(0, 5)}`;
    summary.appendChild(dateTime);

    const name = document.createElement('p');
    name.className = 'booking-received-name';
    name.textContent = bookingContactName(booking);
    summary.appendChild(name);

    const phone = document.createElement('p');
    phone.className = 'booking-received-phone';
    phone.textContent = `電話：${String(booking.contactPhone || '—')}`;
    summary.appendChild(phone);

    const servicesLabel = document.createElement('p');
    servicesLabel.className = 'booking-received-services-label';
    servicesLabel.textContent = '服務項目：';
    summary.appendChild(servicesLabel);

    const services = document.createElement('div');
    services.className = 'booking-received-services';
    const visibleItems = visibleBookingItems(booking);
    if (!visibleItems.length) {
      const empty = document.createElement('span');
      empty.textContent = '尚無會員服務項目';
      services.appendChild(empty);
    } else {
      visibleItems.forEach((item) => {
        const quantity = Math.max(1, Number(item.quantity || 1));
        const title = String(item.serviceTitle || '服務項目').trim();
        for (let index = 0; index < quantity; index += 1) {
          const line = document.createElement('span');
          line.textContent = title;
          services.appendChild(line);
        }
      });
    }
    summary.appendChild(services);

    const copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.className = 'booking-copy-button';
    copyButton.textContent = '複製預約內容';
    copyButton.setAttribute('aria-label', `複製 ${bookingContactName(booking)} 的預約內容`);
    copyButton.addEventListener('click', () => copyBooking(copyButton, booking));
    summary.appendChild(copyButton);

    card.prepend(summary);
  }

  async function copyBooking(button, booking) {
    if (button.disabled) return;
    const originalLabel = button.textContent;
    button.disabled = true;
    try {
      await copyText(buildBookingCopyText(booking));
      button.textContent = '已複製';
    } catch (_) {
      button.textContent = '複製失敗';
    } finally {
      window.setTimeout(() => {
        button.disabled = false;
        button.textContent = originalLabel;
      }, 1500);
    }
  }

  function buildBookingCopyText(booking) {
    const lines = [
      `${formatBookingDate(booking.bookingDate)} ${String(booking.startTime || '—').slice(0, 5)}`,
      bookingContactName(booking),
      `電話：${String(booking.contactPhone || '—')}`,
      '服務項目：',
    ];

    const visibleItems = visibleBookingItems(booking);
    if (!visibleItems.length) {
      lines.push('尚無會員服務項目');
      return lines.join('\n');
    }

    visibleItems.forEach((item) => {
      const quantity = Math.max(1, Number(item.quantity || 1));
      const title = String(item.serviceTitle || '服務項目').trim();
      for (let index = 0; index < quantity; index += 1) lines.push(title);
    });
    return lines.join('\n');
  }

  async function copyText(text) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function' && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    textarea.style.pointerEvents = 'none';
    document.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    const copied = document.execCommand('copy');
    textarea.remove();
    if (!copied) throw new Error('COPY_FAILED');
  }

  function formatBookingDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
    if (!match) return String(value || '—');
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const weekday = WEEKDAY_LABELS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()] || '';
    return `${month}/${day}（${weekday}）`;
  }

  function formatLegacyDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
    return match ? `${Number(match[1])}/${Number(match[2])}/${Number(match[3])}` : String(value || '—');
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

  function salutationLabel(value) {
    return value === 'mr' ? '先生' : value === 'ms' ? '小姐' : '';
  }

  function clientError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }
})();
