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
      protectUnsafeGroupEdits(card, group);
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
    card.querySelectorAll('.booking-group-admin-details').forEach((node) => node.remove());

    const box = document.createElement('section');
    box.className = 'booking-group-admin-details';
    box.setAttribute('aria-label', '逐位預約明細');

    group.participants.forEach((participant, index) => {
      const block = document.createElement('div');
      block.className = 'booking-group-admin-participant';

      const heading = document.createElement('strong');
      heading.textContent = participantLabel(index);

      const items = document.createElement('p');
      items.textContent = `預約項目：${participantItemsLabel(participant.items)}`;

      const tech = document.createElement('p');
      const techName = String(participant.technicianName || '現場安排').replace(/（主要技師）/g, '').trim() || '現場安排';
      tech.textContent = `預約技師：${techName}`;

      block.append(heading, items, tech);
      box.appendChild(block);
    });

    const summary = card.querySelector(':scope > .booking-received-summary');
    const copyButton = summary?.querySelector(':scope > .booking-copy-button');
    if (summary) {
      if (copyButton) summary.insertBefore(box, copyButton);
      else summary.appendChild(box);
      return;
    }

    const heading = card.querySelector(':scope > .booking-admin-booking-heading, :scope > .booking-heading');
    if (heading) heading.insertAdjacentElement('afterend', box);
    else card.prepend(box);
  }

  function protectUnsafeGroupEdits(card, group) {
    if (Number(group.partySize || group.participants.length) <= 1) return;
    [...card.querySelectorAll('button')].forEach((button) => {
      const label = String(button.textContent || '').trim();
      if (!label.includes('修改服務項目') && !label.includes('現場改單')) return;
      button.disabled = true;
      button.title = '多人預約必須逐位修改服務項目，舊的整筆合併改單功能已停用以保護資料一致性。';
      button.setAttribute('aria-label', `${label}（多人預約暫停使用）`);
    });
  }

  function participantItemsLabel(items) {
    const rows = Array.isArray(items) ? items : [];
    if (!rows.length) return '—';
    return rows.map((item) => {
      const title = String(item.serviceTitle || '預約項目');
      const quantity = Math.max(1, Number(item.quantity || 1));
      return quantity > 1 ? `${title} × ${quantity}` : title;
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