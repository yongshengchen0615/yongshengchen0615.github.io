(() => {
  'use strict';

  const system = window.BookingSystem;
  if (!system || typeof system.request !== 'function') return;

  const originalRequest = system.request.bind(system);
  const STORE_SERVICE_ID = '00000000-0000-4000-8000-000000000010';
  const state = {
    config: null,
    idToken: '',
    maxPartySize: 1,
    partySize: 1,
    technicians: [],
    technicianId: '',
    services: [],
    extras: [],
    bookingGroups: new Map(),
    editingBookingId: '',
  };

  system.request = async function groupBookingRequest(config, clientType, idToken, action, payload = {}) {
    if (clientType !== 'member') return originalRequest(config, clientType, idToken, action, payload);
    state.config = config;
    state.idToken = idToken;

    if (action === 'user.booking.bootstrap') {
      const base = await originalRequest(config, clientType, idToken, action, payload);
      const group = await groupRequest('user.booking.group.bootstrap');
      state.maxPartySize = clamp(Number(group.settings?.maxPartySize || 1), 1, 10);
      state.technicians = Array.isArray(group.technicians) ? group.technicians.filter((item) => item.isActive) : [];
      state.services = Array.isArray(base.services) ? base.services.filter((item) => item.serviceId !== STORE_SERVICE_ID) : [];
      state.bookingGroups = new Map(Object.entries(group.bookingGroups || {}));
      if (!state.technicianId || !state.technicians.some((item) => item.technicianId === state.technicianId)) {
        state.technicianId = state.technicians[0]?.technicianId || '';
      }
      base.settings = { ...(base.settings || {}), maxPartySize: state.maxPartySize };
      base.technicians = state.technicians;
      base.bookings = (base.bookings || []).map((booking) => normalizeBookingForMember(booking, state.bookingGroups.get(booking.bookingId)));
      queueMicrotask(() => {
        renderGroupControls();
        decorateBookingHistory();
      });
      return base;
    }

    if (action === 'user.booking.slots') {
      ensureEditingGroup(payload.bookingId);
      const participants = buildParticipants(payload.items);
      if (!participants) return { settings: { maxPartySize: state.maxPartySize }, totalDurationMinutes: 0, totalAmount: 0, slots: [] };
      return groupRequest('user.booking.group.slots', {
        bookingId: payload.bookingId,
        bookingDate: payload.bookingDate,
        technicianId: state.technicianId,
        participants,
      });
    }

    if (action === 'user.booking.create' || action === 'user.booking.update') {
      ensureEditingGroup(payload.bookingId);
      const participants = buildParticipants(payload.items, true);
      const result = await groupRequest(action === 'user.booking.create' ? 'user.booking.group.create' : 'user.booking.group.update', {
        ...payload,
        items: undefined,
        technicianId: state.technicianId,
        participants,
        ...contactPayload(),
      });
      if (result?.booking) {
        const groupMeta = {
          technicianId: result.booking.technicianId,
          technicianName: result.booking.technicianName,
          partySize: result.booking.partySize,
          participants: result.booking.participants || participants,
        };
        state.bookingGroups.set(result.booking.bookingId, groupMeta);
        result.booking = normalizeBookingForMember(result.booking, groupMeta);
        resetGroupSelection();
      }
      return result;
    }

    if (action === 'user.booking.cancel') {
      const result = await originalRequest(config, clientType, idToken, action, payload);
      if (result?.booking) result.booking = normalizeBookingForMember(result.booking, state.bookingGroups.get(result.booking.bookingId));
      return result;
    }

    return originalRequest(config, clientType, idToken, action, payload);
  };

  window.addEventListener('DOMContentLoaded', () => {
    injectGroupControls();
    document.getElementById('bookingForm')?.addEventListener('submit', () => window.setTimeout(decorateConfirmation, 0));
    document.addEventListener('click', (event) => {
      const button = event.target instanceof Element ? event.target.closest('button') : null;
      if (!button) return;
      if (button.id === 'cancelEditBookingButton') {
        state.editingBookingId = '';
        resetGroupSelection();
        return;
      }
      if (button.textContent?.trim() !== '修改預約') return;
      const bookingId = String(button.closest('.booking-item')?.dataset.bookingId || '');
      if (!bookingId) return;
      state.editingBookingId = bookingId;
      applyBookingGroup(bookingId);
    }, true);
    window.addEventListener('booking:created', () => {
      state.editingBookingId = '';
      resetGroupSelection();
      queueMicrotask(decorateBookingHistory);
    });
    const list = document.getElementById('bookingList');
    if (list) new MutationObserver(decorateBookingHistory).observe(list, { childList: true, subtree: true });
  });

  async function groupRequest(action, payload = {}) {
    const endpoint = `${String(state.config?.supabaseUrl || '').replace(/\/$/, '')}/functions/v1/booking-group-api`;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(endpoint, {
        method: 'POST', cache: 'no-store', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', apikey: String(state.config?.supabasePublishableKey || '') },
        body: JSON.stringify({ ...payload, action, clientType: 'member', idToken: state.idToken }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || data?.ok !== true) {
        const error = new Error(String(data?.error?.message || '多人預約服務暫時無法完成操作。'));
        error.code = String(data?.error?.code || 'API_ERROR');
        error.details = data?.error?.details || null;
        throw error;
      }
      return data.data || {};
    } catch (error) {
      if (error?.name === 'AbortError') {
        const timeout = new Error('多人預約服務回應逾時，請稍後再試。');
        timeout.code = 'API_TIMEOUT';
        throw timeout;
      }
      throw error;
    } finally {
      window.clearTimeout(timer);
    }
  }

  function injectGroupControls() {
    const picker = document.querySelector('.service-picker-fieldset');
    if (!picker || document.getElementById('groupBookingFields')) return;
    const section = document.createElement('fieldset');
    section.id = 'groupBookingFields';
    section.className = 'group-booking-fieldset';
    section.innerHTML = `
      <legend>預約人數與技師</legend>
      <div class="group-booking-topline">
        <label>預約人數<select id="bookingPartySize" aria-label="預約人數"></select></label>
        <label>預約技師<select id="bookingTechnician" aria-label="預約技師"></select></label>
      </div>
      <p class="slot-hint">第 1 位使用下方原本的項目選擇；第 2 位起可在這裡分別設定服務項目。</p>
      <div id="extraParticipantList" class="extra-participant-list"></div>`;
    picker.insertAdjacentElement('beforebegin', section);
    document.getElementById('bookingPartySize').addEventListener('change', partySizeChanged);
    document.getElementById('bookingTechnician').addEventListener('change', technicianChanged);
    renderGroupControls();
  }

  function renderGroupControls() {
    const party = document.getElementById('bookingPartySize');
    const tech = document.getElementById('bookingTechnician');
    if (!party || !tech) return;

    const previousSize = state.partySize;
    party.replaceChildren();
    for (let value = 1; value <= state.maxPartySize; value += 1) {
      const option = document.createElement('option'); option.value = String(value); option.textContent = `${value} 人`; party.appendChild(option);
    }
    state.partySize = clamp(previousSize, 1, state.maxPartySize);
    party.value = String(state.partySize);

    tech.replaceChildren();
    if (!state.technicians.length) {
      const option = document.createElement('option'); option.value = ''; option.textContent = '目前沒有可預約技師'; tech.appendChild(option); tech.disabled = true;
      state.technicianId = '';
    } else {
      tech.disabled = false;
      state.technicians.forEach((item) => {
        const option = document.createElement('option'); option.value = item.technicianId; option.textContent = item.name; tech.appendChild(option);
      });
      if (!state.technicians.some((item) => item.technicianId === state.technicianId)) state.technicianId = state.technicians[0].technicianId;
      tech.value = state.technicianId;
    }
    ensureExtraCount();
    renderExtraParticipants();
  }

  function partySizeChanged(event) {
    state.partySize = clamp(Number(event.target.value || 1), 1, state.maxPartySize);
    ensureExtraCount();
    renderExtraParticipants();
    reloadSlots();
  }

  function technicianChanged(event) {
    state.technicianId = String(event.target.value || '');
    reloadSlots();
  }

  function ensureExtraCount() {
    const count = Math.max(0, state.partySize - 1);
    while (state.extras.length < count) state.extras.push(new Set());
    if (state.extras.length > count) state.extras.length = count;
  }

  function renderExtraParticipants() {
    const root = document.getElementById('extraParticipantList');
    if (!root) return;
    root.replaceChildren();
    state.extras.forEach((selected, extraIndex) => {
      const card = document.createElement('section'); card.className = 'participant-card';
      const heading = document.createElement('div'); heading.className = 'participant-heading';
      const title = document.createElement('strong'); title.textContent = `第 ${extraIndex + 2} 位預約人`;
      const count = document.createElement('span'); count.textContent = selected.size ? `已選 ${selected.size} 項` : '尚未選擇';
      heading.append(title, count); card.appendChild(heading);
      const choices = document.createElement('div'); choices.className = 'participant-service-grid';
      state.services.forEach((service) => {
        const label = document.createElement('label'); label.className = `participant-service-option${selected.has(service.serviceId) ? ' selected' : ''}`;
        const input = document.createElement('input'); input.type = 'checkbox'; input.checked = selected.has(service.serviceId); input.value = service.serviceId;
        const text = document.createElement('span'); const strong = document.createElement('strong'); strong.textContent = service.title;
        const small = document.createElement('small'); small.textContent = `${Number(service.durationMinutes || 0)} 分鐘 · NT$${Number(service.priceAmount || 0).toLocaleString('zh-Hant-TW')}`;
        text.append(strong, small); label.append(input, text);
        input.addEventListener('change', () => {
          if (input.checked) selected.add(service.serviceId); else selected.delete(service.serviceId);
          renderExtraParticipants(); reloadSlots();
        });
        choices.appendChild(label);
      });
      card.appendChild(choices); root.appendChild(card);
    });
  }

  function buildParticipants(primaryItems, strict = false) {
    if (!state.technicianId) {
      if (strict) throw clientError('BOOKING_TECHNICIAN_REQUIRED', '請先選擇預約技師。');
      return null;
    }
    const primary = (Array.isArray(primaryItems) ? primaryItems : [])
      .filter((item) => item.serviceId !== STORE_SERVICE_ID)
      .map((item) => ({ serviceId: item.serviceId, quantity: Number(item.quantity || 1) }));
    if (!primary.length) {
      if (strict) throw clientError('INVALID_BOOKING_ITEMS', '第 1 位預約人尚未選擇預約項目。');
      return null;
    }
    ensureExtraCount();
    const participants = [{ items: primary }];
    for (let index = 0; index < state.extras.length; index += 1) {
      const items = [...state.extras[index]].map((serviceId) => ({ serviceId, quantity: 1 }));
      if (!items.length) {
        if (strict) throw clientError('INVALID_BOOKING_ITEMS', `第 ${index + 2} 位預約人尚未選擇預約項目。`);
        return null;
      }
      participants.push({ items });
    }
    return participants;
  }

  function ensureEditingGroup(bookingId) {
    const id = String(bookingId || state.editingBookingId || '');
    if (!id || id === state.editingBookingId) return;
    state.editingBookingId = id;
    applyBookingGroup(id);
  }

  function applyBookingGroup(bookingId) {
    const group = state.bookingGroups.get(bookingId);
    if (!group) return;
    state.partySize = clamp(Number(group.partySize || 1), 1, state.maxPartySize);
    state.technicianId = String(group.technicianId || state.technicianId || '');
    const participants = Array.isArray(group.participants) ? group.participants : [];
    state.extras = participants.slice(1).map((participant) => new Set((participant.items || []).map((item) => item.serviceId).filter(Boolean)));
    ensureExtraCount();
    renderGroupControls();
  }

  function resetGroupSelection() {
    state.partySize = 1;
    state.extras = [];
    if (!state.technicians.some((item) => item.technicianId === state.technicianId)) state.technicianId = state.technicians[0]?.technicianId || '';
    renderGroupControls();
  }

  function normalizeBookingForMember(booking, group) {
    if (!booking || !group) return booking;
    const store = Array.isArray(booking.items) ? booking.items.find((item) => item.serviceId === STORE_SERVICE_ID) : null;
    const participantOneItems = Array.isArray(group.participants?.[0]?.items) ? group.participants[0].items : [];
    return {
      ...booking,
      partySize: Number(group.partySize || 1),
      technicianId: group.technicianId || '',
      technicianName: group.technicianName || '店家安排',
      participants: group.participants || [],
      items: [...participantOneItems, ...(store ? [store] : [])],
    };
  }

  function contactPayload() {
    const source = String(document.querySelector('input[name="bookingContactSource"]:checked')?.value || 'member');
    if (source !== 'custom') return { contactSource: 'member' };
    return {
      contactSource: 'custom',
      contactSurname: String(document.getElementById('bookingContactSurname')?.value || '').trim(),
      contactSalutation: String(document.getElementById('bookingContactSalutation')?.value || '').trim(),
      contactPhone: String(document.getElementById('bookingContactPhone')?.value || '').trim(),
    };
  }

  function decorateConfirmation() {
    const root = document.getElementById('bookingConfirmSummary');
    if (!root || root.querySelector('[data-group-confirm]')) return;
    const box = document.createElement('div'); box.dataset.groupConfirm = 'true'; box.className = 'group-confirm-summary';
    const tech = state.technicians.find((item) => item.technicianId === state.technicianId);
    const title = document.createElement('strong'); title.textContent = `預約 ${state.partySize} 人 · 技師：${tech?.name || '未選擇'}`; box.appendChild(title);
    state.extras.forEach((selected, index) => {
      const names = [...selected].map((id) => state.services.find((service) => service.serviceId === id)?.title).filter(Boolean);
      const row = document.createElement('p'); row.textContent = `第 ${index + 2} 位：${names.join('、') || '尚未選擇項目'}`; box.appendChild(row);
    });
    root.prepend(box);
  }

  function decorateBookingHistory() {
    document.querySelectorAll('.booking-item[data-booking-id]').forEach((node) => {
      const id = String(node.dataset.bookingId || '');
      const group = state.bookingGroups.get(id);
      if (!group || node.querySelector('[data-group-history]')) return;
      const box = document.createElement('div'); box.dataset.groupHistory = 'true'; box.className = 'group-history-summary';
      const head = document.createElement('strong'); head.textContent = `${Number(group.partySize || 1)} 人 · 技師：${group.technicianName || '店家安排'}`; box.appendChild(head);
      (group.participants || []).forEach((participant, index) => {
        const p = document.createElement('p'); p.textContent = `第 ${index + 1} 位：${(participant.items || []).map((item) => item.serviceTitle).filter(Boolean).join('、') || '—'}`; box.appendChild(p);
      });
      const top = node.querySelector('.booking-item-top');
      if (top) top.insertAdjacentElement('afterend', box); else node.prepend(box);
    });
  }

  function reloadSlots() {
    const date = document.getElementById('bookingDate');
    if (date?.value) date.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function clientError(code, message) { const error = new Error(message); error.code = code; return error; }
  function clamp(value, min, max) { return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min)); }
})();