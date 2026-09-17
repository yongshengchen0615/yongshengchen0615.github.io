(() => {
  'use strict';

  const system = window.BookingSystem;
  if (!system || typeof system.request !== 'function') return;

  const originalRequest = system.request.bind(system);
  const STORE_SERVICE_ID = '00000000-0000-4000-8000-000000000010';
  const TYPE_PREFIX = '__TYPE__:';
  const DEFAULT_STORE_SERVICE_MINUTES = 10;
  const state = {
    config: null,
    idToken: '',
    maxPartySize: 1,
    partySize: 1,
    primaryTechnicianId: '',
    technicians: [],
    participantTechnicians: [],
    services: [],
    primaryItems: [],
    extras: [],
    storeServiceMinutes: DEFAULT_STORE_SERVICE_MINUTES,
    bookingGroups: new Map(),
    editingBookingId: '',
    primaryPicker: null,
    primarySelected: null,
    openCards: new Set([0]),
  };

  system.request = async function groupBookingRequest(config, clientType, idToken, action, payload = {}) {
    if (clientType !== 'member') return originalRequest(config, clientType, idToken, action, payload);
    state.config = config;
    state.idToken = idToken;

    if (action === 'user.booking.bootstrap') {
      const base = await originalRequest(config, clientType, idToken, action, payload);
      const group = await groupRequest('user.booking.group.bootstrap');
      state.maxPartySize = clamp(Number(group.settings?.maxPartySize || 1), 1, 10);
      state.primaryTechnicianId = String(group.settings?.primaryTechnicianId || '');
      state.technicians = Array.isArray(group.technicians) ? group.technicians.filter((item) => item.isActive) : [];
      const storeService = Array.isArray(base.services)
        ? base.services.find((item) => item.serviceId === STORE_SERVICE_ID)
        : null;
      const configuredStoreMinutes = Number(storeService?.durationMinutes ?? DEFAULT_STORE_SERVICE_MINUTES);
      state.storeServiceMinutes = Number.isInteger(configuredStoreMinutes) && configuredStoreMinutes >= 0
        ? configuredStoreMinutes
        : DEFAULT_STORE_SERVICE_MINUTES;
      state.services = Array.isArray(base.services) ? base.services.filter((item) => item.serviceId !== STORE_SERVICE_ID) : [];
      state.bookingGroups = new Map(Object.entries(group.bookingGroups || {}));
      ensureParticipantCount(true);
      base.settings = {
        ...(base.settings || {}),
        maxPartySize: state.maxPartySize,
        primaryTechnicianId: state.primaryTechnicianId,
      };
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
      queueMicrotask(() => {
        updateCardSummaries();
        updateSelectionSummary();
      });
      if (!participants) {
        return {
          settings: { maxPartySize: state.maxPartySize, primaryTechnicianId: state.primaryTechnicianId },
          totalDurationMinutes: 0,
          totalAmount: 0,
          slots: [],
        };
      }
      const result = await groupRequest('user.booking.group.slots', {
        bookingId: payload.bookingId,
        bookingDate: payload.bookingDate,
        participants,
      });
      queueMicrotask(updateSelectionSummary);
      return result;
    }

    if (action === 'user.booking.create' || action === 'user.booking.update') {
      ensureEditingGroup(payload.bookingId);
      const participants = buildParticipants(payload.items, true);
      const result = await groupRequest(action === 'user.booking.create' ? 'user.booking.group.create' : 'user.booking.group.update', {
        ...payload,
        items: undefined,
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
        method: 'POST',
        cache: 'no-store',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          apikey: String(state.config?.supabasePublishableKey || ''),
        },
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
    const selected = document.querySelector('.selected-service-fieldset');
    if (!picker || !selected || document.getElementById('groupBookingFields')) return;
    state.primaryPicker = picker;
    state.primarySelected = selected;

    const section = document.createElement('fieldset');
    section.id = 'groupBookingFields';
    section.className = 'group-booking-fieldset';
    section.innerHTML = `
      <legend>多人預約</legend>
      <div class="group-booking-topline">
        <label>預約人數<select id="bookingPartySize" aria-label="預約人數"></select></label>
      </div>
      <div id="primaryTechnicianRule" class="group-booking-rule" role="note"></div>
      <div id="participantCardList" class="participant-card-list"></div>`;
    picker.insertAdjacentElement('beforebegin', section);
    document.getElementById('bookingPartySize').addEventListener('change', partySizeChanged);
    renderGroupControls();
  }

  function renderGroupControls() {
    const party = document.getElementById('bookingPartySize');
    if (!party) return;
    const previousSize = state.partySize;
    party.replaceChildren();
    for (let value = 1; value <= state.maxPartySize; value += 1) {
      const option = document.createElement('option');
      option.value = String(value);
      option.textContent = `${value} 人`;
      party.appendChild(option);
    }
    state.partySize = clamp(previousSize, 1, state.maxPartySize);
    party.value = String(state.partySize);
    ensureParticipantCount(false);
    renderPrimaryRule();
    renderParticipantCards();
  }

  function renderPrimaryRule() {
    const rule = document.getElementById('primaryTechnicianRule');
    if (!rule) return;
    const primary = technicianById(state.primaryTechnicianId);
    if (!primary) {
      rule.className = 'group-booking-rule error';
      rule.textContent = '管理端尚未設定可用的主要技師，目前無法送出預約。';
      return;
    }
    rule.className = 'group-booking-rule';
    rule.textContent = `預約規則：不論預約幾位，至少一位必須選擇主要技師「${primary.name}」；其他預約人可選其他技師或現場安排。`;
  }

  function partySizeChanged(event) {
    state.partySize = clamp(Number(event.target.value || 1), 1, state.maxPartySize);
    ensureParticipantCount(false);
    renderParticipantCards();
    updateSelectionSummary();
    reloadSlots();
  }

  function ensureParticipantCount(initial) {
    const previous = state.participantTechnicians.slice();
    while (state.participantTechnicians.length < state.partySize) state.participantTechnicians.push('');
    if (state.participantTechnicians.length > state.partySize) state.participantTechnicians.length = state.partySize;
    while (state.extras.length < Math.max(0, state.partySize - 1)) state.extras.push(new Set());
    if (state.extras.length > Math.max(0, state.partySize - 1)) state.extras.length = Math.max(0, state.partySize - 1);

    if (initial || !previous.length) {
      state.participantTechnicians[0] = state.primaryTechnicianId && technicianById(state.primaryTechnicianId) ? state.primaryTechnicianId : '';
    }
  }

  function renderParticipantCards() {
    const root = document.getElementById('participantCardList');
    if (!root) return;
    root.replaceChildren();
    for (let index = 0; index < state.partySize; index += 1) {
      const details = document.createElement('details');
      details.className = 'participant-card';
      details.dataset.participantIndex = String(index);
      details.open = state.openCards.has(index) || index === 0;
      details.addEventListener('toggle', () => {
        if (details.open) state.openCards.add(index); else state.openCards.delete(index);
      });

      const summary = document.createElement('summary');
      const heading = document.createElement('span');
      heading.className = 'participant-heading';
      const title = document.createElement('strong');
      title.textContent = participantLabel(index);
      const meta = document.createElement('span');
      meta.dataset.participantSummary = String(index);
      heading.append(title, meta);
      const chevron = document.createElement('span');
      chevron.className = 'participant-chevron';
      chevron.setAttribute('aria-hidden', 'true');
      chevron.textContent = '⌄';
      summary.append(heading, chevron);
      details.appendChild(summary);

      const body = document.createElement('div');
      body.className = 'participant-card-body';
      body.appendChild(createTechnicianField(index));

      if (index === 0) {
        if (state.primaryPicker) body.appendChild(state.primaryPicker);
        if (state.primarySelected) body.appendChild(state.primarySelected);
      } else {
        body.appendChild(createExtraServicePicker(index));
      }
      details.appendChild(body);
      root.appendChild(details);
    }
    updateCardSummaries();
    updateSelectionSummary();
  }

  function createTechnicianField(index) {
    const wrap = document.createElement('label');
    wrap.className = 'participant-technician-field';
    const text = document.createElement('span');
    text.textContent = '預約技師';
    const select = document.createElement('select');
    select.setAttribute('aria-label', `${participantLabel(index)}預約技師`);

    const onsite = document.createElement('option');
    onsite.value = '';
    onsite.textContent = '現場安排';
    select.appendChild(onsite);

    const selectedElsewhere = new Set(state.participantTechnicians.filter((id, i) => i !== index && id));
    state.technicians.forEach((technician) => {
      const option = document.createElement('option');
      option.value = technician.technicianId;
      option.textContent = technician.technicianId === state.primaryTechnicianId ? `${technician.name}（主要技師）` : technician.name;
      option.disabled = selectedElsewhere.has(technician.technicianId);
      select.appendChild(option);
    });
    select.value = state.participantTechnicians[index] || '';
    select.addEventListener('change', () => {
      state.participantTechnicians[index] = String(select.value || '');
      state.openCards.add(index);
      renderParticipantCards();
      reloadSlots();
    });
    wrap.append(text, select);
    return wrap;
  }

  function createExtraServicePicker(index) {
    const extraIndex = index - 1;
    const selected = state.extras[extraIndex] || new Set();
    const stack = document.createElement('div');
    stack.className = 'participant-service-stack';

    const picker = document.createElement('fieldset');
    picker.className = 'service-picker-fieldset participant-service-picker-fieldset';
    const pickerLegend = document.createElement('legend');
    pickerLegend.textContent = '可選預約項目';
    const pickerHint = document.createElement('p');
    pickerHint.className = 'slot-hint';
    pickerHint.textContent = '相同類型服務會集中在同一區塊；按下「增加」後會加入下方「目前選擇」。';
    const choices = document.createElement('div');
    choices.className = 'service-picker';

    state.services.forEach((service) => {
      const row = document.createElement('article');
      row.className = `service-choice${selected.has(service.serviceId) ? ' selected' : ''}`;
      const main = document.createElement('div');
      main.className = 'service-choice-main';
      const text = document.createElement('span');
      const title = document.createElement('strong');
      title.textContent = service.title;
      const meta = document.createElement('small');
      const serviceType = serviceTypeOf(service);
      meta.textContent = `${serviceType ? `類型 ${serviceType} · ` : ''}服務 ${Number(service.durationMinutes || 0)} 分鐘 · ${formatMoney(service.priceAmount)}`;
      text.append(title, meta);
      main.appendChild(text);

      const addButton = document.createElement('button');
      addButton.type = 'button';
      addButton.className = 'service-add-button';
      addButton.textContent = '增加';
      addButton.setAttribute('aria-label', `${participantLabel(index)}增加 ${service.title}`);
      addButton.addEventListener('click', () => {
        selected.add(service.serviceId);
        state.extras[extraIndex] = selected;
        state.openCards.add(index);
        renderParticipantCards();
        updateSelectionSummary();
        reloadSlots();
      });
      row.append(main, addButton);
      choices.appendChild(row);
    });

    const pickerEmpty = document.createElement('div');
    pickerEmpty.className = `empty-state compact${state.services.length ? ' hidden' : ''}`;
    const pickerEmptyText = document.createElement('strong');
    pickerEmptyText.textContent = '目前沒有開放的預約項目';
    pickerEmpty.appendChild(pickerEmptyText);
    picker.append(pickerLegend, pickerHint, choices, pickerEmpty);

    const selectedFieldset = document.createElement('fieldset');
    selectedFieldset.className = 'selected-service-fieldset participant-selected-service-fieldset';
    const selectedLegend = document.createElement('legend');
    selectedLegend.textContent = '目前選擇';
    const selectedHint = document.createElement('p');
    selectedHint.className = 'slot-hint';
    selectedHint.textContent = '相同類型會集中顯示；每一筆選擇都可單獨移除。';
    const selectedList = document.createElement('div');
    selectedList.className = 'selected-service-list';

    [...selected].forEach((serviceId) => {
      const service = state.services.find((item) => item.serviceId === serviceId);
      if (!service) return;
      const row = document.createElement('article');
      row.className = 'selected-service-item';
      const text = document.createElement('div');
      text.className = 'selected-service-main';
      const title = document.createElement('strong');
      title.textContent = service.title;
      const meta = document.createElement('small');
      const serviceType = serviceTypeOf(service);
      meta.textContent = `${serviceType ? `類型 ${serviceType} · ` : ''}服務 ${Number(service.durationMinutes || 0)} 分鐘 · ${formatMoney(service.priceAmount)}`;
      text.append(title, meta);
      const removeButton = document.createElement('button');
      removeButton.type = 'button';
      removeButton.className = 'selected-service-remove';
      removeButton.textContent = '移除';
      removeButton.setAttribute('aria-label', `${participantLabel(index)}移除 ${service.title}`);
      removeButton.addEventListener('click', () => {
        selected.delete(serviceId);
        state.extras[extraIndex] = selected;
        state.openCards.add(index);
        renderParticipantCards();
        updateSelectionSummary();
        reloadSlots();
      });
      row.append(text, removeButton);
      selectedList.appendChild(row);
    });

    const selectedEmpty = document.createElement('div');
    selectedEmpty.className = `empty-state compact${selected.size ? ' hidden' : ''}`;
    const selectedEmptyTitle = document.createElement('strong');
    selectedEmptyTitle.textContent = '尚未選擇預約項目';
    const selectedEmptyHint = document.createElement('span');
    selectedEmptyHint.textContent = '請從上方可選項目加入。';
    selectedEmpty.append(selectedEmptyTitle, selectedEmptyHint);
    selectedFieldset.append(selectedLegend, selectedHint, selectedList, selectedEmpty);

    stack.append(picker, selectedFieldset);
    return stack;
  }

  function updateCardSummaries() {
    document.querySelectorAll('[data-participant-summary]').forEach((node) => {
      const index = Number(node.dataset.participantSummary || 0);
      const tech = technicianLabel(state.participantTechnicians[index]);
      const count = index === 0 ? countItems(state.primaryItems) : (state.extras[index - 1]?.size || 0);
      node.textContent = `${count ? `已選 ${count} 項` : '尚未選項目'} · ${tech}`;
    });
  }

  function buildParticipants(primaryItems, strict = false) {
    state.primaryItems = (Array.isArray(primaryItems) ? primaryItems : [])
      .filter((item) => item.serviceId !== STORE_SERVICE_ID)
      .map((item) => ({ serviceId: item.serviceId, quantity: Number(item.quantity || 1) }));

    if (!state.primaryItems.length) {
      if (strict) throw clientError('INVALID_BOOKING_ITEMS', '第一位預約尚未選擇預約項目。');
      return null;
    }
    ensureParticipantCount(false);
    const primaryCount = state.participantTechnicians.filter((id) => id && id === state.primaryTechnicianId).length;
    if (!state.primaryTechnicianId || primaryCount < 1) {
      if (strict) throw clientError('BOOKING_PRIMARY_TECHNICIAN_REQUIRED', '至少一位預約必須選擇主要技師。');
      return null;
    }
    const selectedTechs = state.participantTechnicians.filter(Boolean);
    if (new Set(selectedTechs).size !== selectedTechs.length) {
      if (strict) throw clientError('DUPLICATE_PARTICIPANT_TECHNICIAN', '同一位技師不能同時安排給兩位預約人。');
      return null;
    }

    const participants = [{
      technicianId: state.participantTechnicians[0] || null,
      items: state.primaryItems,
    }];
    for (let index = 0; index < state.extras.length; index += 1) {
      const items = [...state.extras[index]].map((serviceId) => ({ serviceId, quantity: 1 }));
      if (!items.length) {
        if (strict) throw clientError('INVALID_BOOKING_ITEMS', `${participantLabel(index + 1)}尚未選擇預約項目。`);
        return null;
      }
      participants.push({
        technicianId: state.participantTechnicians[index + 1] || null,
        items,
      });
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
    const participants = Array.isArray(group.participants) ? group.participants : [];
    state.participantTechnicians = participants.map((participant) => String(participant.technicianId || ''));
    state.primaryItems = Array.isArray(participants[0]?.items)
      ? participants[0].items.map((item) => ({ serviceId: item.serviceId, quantity: Number(item.quantity || 1) }))
      : [];
    state.extras = participants.slice(1).map((participant) => new Set((participant.items || []).map((item) => item.serviceId).filter(Boolean)));
    ensureParticipantCount(false);
    state.openCards = new Set([0]);
    renderGroupControls();
  }

  function resetGroupSelection() {
    state.partySize = 1;
    state.primaryItems = [];
    state.extras = [];
    state.participantTechnicians = [state.primaryTechnicianId && technicianById(state.primaryTechnicianId) ? state.primaryTechnicianId : ''];
    state.openCards = new Set([0]);
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
      technicianName: group.technicianName || '',
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

  function updateSelectionSummary() {
    const root = document.getElementById('selectionSummary');
    if (!root || !state.primaryItems.length) return;
    const metrics = [];
    for (let index = 0; index < state.partySize; index += 1) metrics.push(participantMetrics(index));
    const overallMinutes = metrics.reduce((max, item) => Math.max(max, item.totalMinutes), 0);
    const overallAmount = metrics.reduce((sum, item) => sum + item.amount, 0);
    const minimumDate = String(document.getElementById('bookingDate')?.min || '');

    root.replaceChildren();
    root.classList.remove('hidden');
    root.classList.add('group-selection-summary');
    metrics.forEach((metric, index) => {
      const block = document.createElement('div');
      block.className = 'group-selection-participant';
      const heading = document.createElement('strong');
      heading.textContent = participantLabel(index);
      const services = document.createElement('p');
      services.textContent = `服務項目：${metric.labels.join('、') || '尚未選擇'}`;
      const duration = document.createElement('p');
      duration.textContent = metric.totalMinutes
        ? `總時間：${metric.totalMinutes}分鐘（含店內服務 ${state.storeServiceMinutes} 分鐘）`
        : '總時間：尚未計算';
      block.append(heading, services, duration);
      root.appendChild(block);
    });

    const totals = document.createElement('div');
    totals.className = 'group-selection-totals';
    const duration = document.createElement('strong');
    duration.textContent = `總服務時間：${overallMinutes}分鐘`;
    const durationNote = document.createElement('span');
    durationNote.textContent = '（以各預約人最長總時間計）';
    duration.appendChild(durationNote);
    const amount = document.createElement('p');
    amount.textContent = `總金額：${formatMoney(overallAmount)}`;
    totals.append(duration, amount);
    if (minimumDate) {
      const earliest = document.createElement('p');
      earliest.textContent = `最早可預約 ${system.formatDate(minimumDate)}`;
      totals.appendChild(earliest);
    }
    root.appendChild(totals);
  }

  function participantMetrics(index) {
    const items = participantItems(index);
    let serviceMinutes = 0;
    let amount = 0;
    const labels = [];
    items.forEach((item) => {
      const service = state.services.find((candidate) => candidate.serviceId === item.serviceId);
      if (!service) return;
      const quantity = Math.max(1, Number(item.quantity || 1));
      const duration = Number(service.durationMinutes || 0);
      serviceMinutes += duration * quantity;
      amount += Number(service.priceAmount || 0) * quantity;
      labels.push(`${service.title}（${duration}分鐘）${quantity > 1 ? `×${quantity}` : ''}`);
    });
    return {
      labels,
      amount,
      totalMinutes: items.length ? serviceMinutes + state.storeServiceMinutes : 0,
    };
  }

  function participantItems(index) {
    if (index === 0) return state.primaryItems;
    return [...(state.extras[index - 1] || [])].map((serviceId) => ({ serviceId, quantity: 1 }));
  }

  function decorateConfirmation() {
    const root = document.getElementById('bookingConfirmSummary');
    if (!root) return;
    root.querySelector('[data-group-confirm]')?.remove();
    const box = document.createElement('div');
    box.dataset.groupConfirm = 'true';
    box.className = 'group-confirm-summary';
    const title = document.createElement('strong');
    title.textContent = `本次預約 ${state.partySize} 位`;
    box.appendChild(title);

    const metrics = [];
    for (let index = 0; index < state.partySize; index += 1) {
      const metric = participantMetrics(index);
      metrics.push(metric);
      const card = document.createElement('div');
      card.className = 'group-confirm-participant';
      const heading = document.createElement('strong');
      heading.textContent = participantLabel(index);
      const itemLine = document.createElement('p');
      itemLine.textContent = `項目：${metric.labels.join('、') || '尚未選擇項目'}`;
      const durationLine = document.createElement('p');
      durationLine.textContent = `總時間：${metric.totalMinutes || 0} 分鐘`;
      const techLine = document.createElement('p');
      techLine.textContent = `技師：${technicianLabel(state.participantTechnicians[index])}`;
      card.append(heading, itemLine, durationLine, techLine);
      box.appendChild(card);
    }
    const totalLine = document.createElement('p');
    const overallMinutes = metrics.reduce((max, item) => Math.max(max, item.totalMinutes), 0);
    const overallAmount = metrics.reduce((sum, item) => sum + item.amount, 0);
    totalLine.textContent = `總服務時間：${overallMinutes} 分鐘（以各預約人最長總時間計） · 總金額：${formatMoney(overallAmount)}`;
    box.appendChild(totalLine);
    root.prepend(box);
  }

  function decorateBookingHistory() {
    document.querySelectorAll('.booking-item[data-booking-id]').forEach((node) => {
      const id = String(node.dataset.bookingId || '');
      const group = state.bookingGroups.get(id);
      if (!group) return;
      node.querySelector('[data-group-history]')?.remove();
      const box = document.createElement('div');
      box.dataset.groupHistory = 'true';
      box.className = 'group-history-summary';
      const head = document.createElement('strong');
      head.textContent = `${Number(group.partySize || 1)} 位預約`;
      box.appendChild(head);
      (group.participants || []).forEach((participant, index) => {
        const card = document.createElement('div');
        card.className = 'group-history-participant';
        const title = document.createElement('strong');
        title.textContent = participantLabel(index);
        const items = document.createElement('p');
        items.textContent = `項目：${(participant.items || []).map((item) => item.serviceTitle).filter(Boolean).join('、') || '—'}`;
        const tech = document.createElement('p');
        tech.textContent = `技師：${participant.technicianName || '現場安排'}`;
        card.append(title, items, tech);
        box.appendChild(card);
      });
      const top = node.querySelector('.booking-item-top');
      if (top) top.insertAdjacentElement('afterend', box); else node.prepend(box);
    });
  }

  function participantServiceNames(index) {
    return participantMetrics(index).labels;
  }

  function serviceTypeOf(service) {
    const description = String(service?.description || '');
    return description.startsWith(TYPE_PREFIX) ? description.slice(TYPE_PREFIX.length).trim() : '';
  }

  function formatMoney(value) {
    return `NT ${Number(value || 0).toLocaleString('zh-Hant-TW')}`;
  }

  function participantLabel(index) {
    return `${ordinal(index + 1)}位預約`;
  }

  function ordinal(value) {
    const names = ['第一', '第二', '第三', '第四', '第五', '第六', '第七', '第八', '第九', '第十'];
    return names[value - 1] || `第 ${value} `;
  }

  function technicianLabel(id) {
    if (!id) return '現場安排';
    const tech = technicianById(id);
    if (!tech) return '現場安排';
    return id === state.primaryTechnicianId ? `${tech.name}（主要技師）` : tech.name;
  }

  function technicianById(id) {
    return state.technicians.find((item) => item.technicianId === id) || null;
  }

  function countItems(items) {
    return (Array.isArray(items) ? items : []).reduce((sum, item) => sum + Math.max(1, Number(item.quantity || 1)), 0);
  }

  function reloadSlots() {
    const date = document.getElementById('bookingDate');
    if (date?.value) date.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function clientError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
  }
})();