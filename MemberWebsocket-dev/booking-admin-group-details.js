(() => {
  'use strict';

  const state = {
    config: null,
    bookings: [],
    groups: {},
    loading: null,
    loadedAt: 0,
    observer: null,
    timer: null,
  };
  const CACHE_TTL_MS = 3000;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();

  function mount() {
    state.observer = new MutationObserver(() => schedule(false));
    state.observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('click', (event) => {
      const button = event.target?.closest?.('#refreshButton, #bookingAdminRefreshButton, #bookingTab, [data-booking-filter], .filter-button');
      if (button) schedule(true);
    });
    schedule(true);
  }

  function schedule(force) {
    if (state.timer !== null) window.clearTimeout(state.timer);
    state.timer = window.setTimeout(() => {
      state.timer = null;
      refresh(force).catch((error) => console.warn('booking group admin details unavailable', error?.code || error?.message || 'UNKNOWN_ERROR'));
    }, force ? 80 : 180);
  }

  async function refresh(force) {
    if (!document.querySelector('.booking-card, .booking-admin-booking')) return;
    if (!force && state.bookings.length && Date.now() - state.loadedAt < CACHE_TTL_MS) {
      decorate();
      return;
    }
    if (state.loading) {
      await state.loading;
      decorate();
      return;
    }
    state.loading = load();
    try {
      await state.loading;
      decorate();
    } finally {
      state.loading = null;
    }
  }

  async function load() {
    const bootstrap = await request('booking-api', 'admin.booking.bootstrap');
    const bookings = Array.isArray(bootstrap?.bookings) ? bootstrap.bookings : [];
    const bookingIds = bookings.map((booking) => String(booking.bookingId || '')).filter(Boolean);
    let groups = {};
    if (bookingIds.length) {
      const details = await request('booking-group-details-api', 'admin.booking.group.details', { bookingIds });
      groups = details?.bookingGroups && typeof details.bookingGroups === 'object' ? details.bookingGroups : {};
    }
    state.bookings = bookings;
    state.groups = groups;
    state.loadedAt = Date.now();
  }

  async function request(functionName, action, payload = {}) {
    const system = window.BookingSystem || window.MemberSystem;
    if (!system?.loadConfig) throw clientError('CONFIG_ERROR', '預約管理設定尚未載入。');
    if (!state.config) state.config = await system.loadConfig();
    const idToken = String(window.liff?.getIDToken?.() || '');
    if (!idToken) throw clientError('AUTH_REQUIRED', '管理端登入尚未完成。');
    const endpoint = `${String(state.config?.supabaseUrl || '').replace(/\/$/, '')}/functions/v1/${functionName}`;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        cache: 'no-store',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          apikey: String(state.config?.supabasePublishableKey || ''),
        },
        body: JSON.stringify({ ...payload, action, clientType: 'admin', idToken }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || data?.ok !== true) throw clientError(String(data?.error?.code || 'API_ERROR'), String(data?.error?.message || '預約資料讀取失敗。'));
      return data.data || {};
    } catch (error) {
      if (error?.code) throw error;
      if (error?.name === 'AbortError') throw clientError('API_TIMEOUT', '預約資料服務回應逾時。');
      throw clientError('NETWORK_ERROR', '目前無法連線預約資料服務。');
    } finally {
      window.clearTimeout(timer);
    }
  }

  function decorate() {
    const cards = [...document.querySelectorAll('.booking-admin-booking, .booking-card')]
      .filter((card) => card.querySelector('.booking-admin-booking-heading, .booking-heading'));
    const used = new Set();
    cards.forEach((card) => {
      const booking = findBooking(card, used);
      if (!booking) return;
      const id = String(booking.bookingId || '');
      const group = state.groups[id];
      if (!group || !Array.isArray(group.participants) || !group.participants.length) return;
      used.add(id);
      card.dataset.bookingId = id;
      renderDetails(card, group);
    });
  }

  function findBooking(card, used) {
    const existingId = String(card.dataset.bookingId || '');
    if (existingId) {
      const exact = state.bookings.find((booking) => String(booking.bookingId || '') === existingId && !used.has(existingId));
      if (exact) return exact;
    }
    const text = String(card.textContent || '');
    return state.bookings.find((booking) => {
      const id = String(booking.bookingId || '');
      if (!id || used.has(id)) return false;
      const memberCode = String(booking.memberCode || '').trim();
      const memberName = String(booking.memberDisplayName || '').trim();
      const identityMatches = memberCode ? text.includes(memberCode) : memberName ? text.includes(memberName) : false;
      if (!identityMatches) return false;
      const start = String(booking.startTime || '').slice(0, 5);
      if (start && !text.includes(start)) return false;
      return dateVariants(String(booking.bookingDate || '')).some((value) => value && text.includes(value));
    });
  }

  function dateVariants(date) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    if (!match) return [date];
    const y = match[1], m = Number(match[2]), d = Number(match[3]);
    return [date, `${y}/${match[2]}/${match[3]}`, `${y}/${m}/${d}`];
  }

  function renderDetails(card, group) {
    card.querySelector(':scope > .booking-group-admin-details')?.remove();
    const box = document.createElement('section');
    box.className = 'booking-group-admin-details';
    box.setAttribute('aria-label', '多人預約逐位明細');

    const title = document.createElement('strong');
    title.className = 'booking-group-admin-title';
    title.textContent = `${Number(group.partySize || group.participants.length)} 位預約明細`;
    box.appendChild(title);

    group.participants.forEach((participant, index) => {
      const block = document.createElement('div');
      block.className = 'booking-group-admin-participant';
      const heading = document.createElement('strong');
      heading.textContent = participantLabel(index);
      const items = document.createElement('p');
      items.textContent = `預約項目：${participantItemsLabel(participant.items)}`;
      const tech = document.createElement('p');
      const techName = String(participant.technicianName || '現場安排');
      tech.textContent = `預約技師：${participant.isPrimaryTechnician ? `${techName}（主要技師）` : techName}`;
      const duration = document.createElement('p');
      duration.textContent = `個別總時間：${Number(participant.totalMinutes || 0)} 分鐘${Number(participant.storeServiceMinutes || 0) > 0 ? `（含店內服務 ${Number(participant.storeServiceMinutes)} 分鐘）` : ''}`;
      const amount = document.createElement('p');
      amount.textContent = `個別金額：${formatMoney(participant.amount)}`;
      block.append(heading, items, tech, duration, amount);
      box.appendChild(block);
    });

    const totals = document.createElement('div');
    totals.className = 'booking-group-admin-totals';
    const duration = document.createElement('strong');
    duration.textContent = `整體總服務時間：${Number(group.totalDurationMinutes || 0)} 分鐘`;
    const note = document.createElement('span');
    note.textContent = '（以各預約人最長總時間計）';
    const amount = document.createElement('strong');
    amount.textContent = `總金額：${formatMoney(group.totalAmount)}`;
    totals.append(duration, note, amount);
    box.appendChild(totals);

    const heading = card.querySelector(':scope > .booking-admin-booking-heading, :scope > .booking-heading');
    if (heading) heading.insertAdjacentElement('afterend', box);
    else card.prepend(box);
  }

  function participantItemsLabel(items) {
    const rows = Array.isArray(items) ? items : [];
    if (!rows.length) return '—';
    return rows.map((item) => {
      const title = String(item.serviceTitle || '預約項目');
      const duration = Number(item.unitDurationMinutes || 0);
      const quantity = Math.max(1, Number(item.quantity || 1));
      return `${title}（${duration}分鐘）${quantity > 1 ? ` × ${quantity}` : ''}`;
    }).join('、');
  }

  function participantLabel(index) {
    const names = ['第一', '第二', '第三', '第四', '第五', '第六', '第七', '第八', '第九', '第十'];
    return `${names[index] || `第 ${index + 1} `}位預約`;
  }

  function formatMoney(value) {
    return `NT ${Number(value || 0).toLocaleString('zh-Hant-TW')}`;
  }

  function clientError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }
})();
