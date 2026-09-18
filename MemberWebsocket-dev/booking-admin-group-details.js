(() => {
  'use strict';

  const state = {
    config: null,
    bookings: [],
    services: [],
    groups: {},
    technicians: [],
    primaryTechnicianId: '',
    loading: null,
    loadedAt: 0,
    observer: null,
    timer: null,
  };
  const CACHE_TTL_MS = 3000;
  const STORE_SERVICE_ID = '00000000-0000-4000-8000-000000000010';

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
    const [bootstrap, resources] = await Promise.all([
      request('booking-api', 'admin.booking.bootstrap'),
      request('booking-group-api', 'admin.booking.resources.bootstrap'),
    ]);
    const bookings = Array.isArray(bootstrap?.bookings) ? bootstrap.bookings : [];
    const services = Array.isArray(bootstrap?.services) ? bootstrap.services : [];
    const bookingIds = bookings.map((booking) => String(booking.bookingId || '')).filter(Boolean);
    let groups = {};
    if (bookingIds.length) {
      const details = await request('booking-group-details-api', 'admin.booking.group.details', { bookingIds });
      groups = details?.bookingGroups && typeof details.bookingGroups === 'object' ? details.bookingGroups : {};
    }
    state.bookings = bookings;
    state.services = services;
    state.groups = groups;
    state.technicians = Array.isArray(resources?.technicians) ? resources.technicians : [];
    state.primaryTechnicianId = String(resources?.settings?.primaryTechnicianId || '');
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
      const storedGroup = state.groups[id];
      const hasStoredParticipants = Boolean(storedGroup && Array.isArray(storedGroup.participants) && storedGroup.participants.length);
      const group = groupForDisplay(storedGroup, booking);
      if (!group) return;
      used.add(id);
      card.dataset.bookingId = id;
      renderDetails(card, group, booking, hasStoredParticipants);
      protectUnsafeGroupEdits(card, group, hasStoredParticipants);
    });
  }

  function groupForDisplay(group, booking) {
    if (group && Array.isArray(group.participants) && group.participants.length) return group;

    const items = Array.isArray(booking?.items)
      ? booking.items.filter((item) => String(item?.serviceId || '') !== STORE_SERVICE_ID)
      : [];
    if (!items.length) return null;

    return {
      partySize: 1,
      participants: [{
        technicianName: '現場安排',
        isPrimaryTechnician: false,
        items,
      }],
    };
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

  function renderDetails(card, group, booking, hasStoredParticipants) {
    card.querySelectorAll('.booking-group-admin-details').forEach((node) => node.remove());
    card.dataset.bookingCopyGroup = JSON.stringify({
      partySize: Math.max(1, Number(group?.partySize || group?.participants?.length || 1)),
      participants: (group?.participants || []).map((participant) => ({
        technicianName: String(participant?.technicianName || '現場安排'),
        items: Array.isArray(participant?.items) ? participant.items.map((item) => ({
          serviceTitle: String(item?.serviceTitle || '預約項目').trim(),
          quantity: Math.max(1, Number(item?.quantity || 1)),
        })) : [],
      })),
    });

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

      if (hasStoredParticipants && canEditBooking(booking)) {
        const itemEdit = document.createElement('button');
        itemEdit.type = 'button';
        itemEdit.className = 'booking-group-admin-edit-button';
        itemEdit.textContent = '修改此位項目';
        itemEdit.addEventListener('click', () => openParticipantEditor(booking, group, index));

        const technicianEdit = document.createElement('button');
        technicianEdit.type = 'button';
        technicianEdit.className = 'booking-group-admin-edit-button';
        technicianEdit.textContent = '修改此位技師';
        technicianEdit.addEventListener('click', () => openParticipantTechnicianEditor(booking, group, index));

        block.append(itemEdit, technicianEdit);
      }
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

  function canEditBooking(booking) {
    if (!booking || !['pending', 'confirmed'].includes(String(booking.status || ''))) return false;
    return !(booking.cancellationRequestedAt && !booking.cancellationReviewedAt);
  }

  function protectUnsafeGroupEdits(card, group, hasStoredParticipants) {
    if (!hasStoredParticipants) return;
    [...card.querySelectorAll('button')].forEach((button) => {
      const label = String(button.textContent || '').trim();
      if (!label.includes('修改服務項目') && !label.includes('現場改單')) return;
      button.hidden = true;
      button.disabled = true;
      button.title = '此預約使用逐位項目資料，請使用每位預約明細中的「修改此位項目」。';
    });
  }

  function editableServices() {
    return (state.services || []).filter((service) => String(service.serviceId || '') !== STORE_SERVICE_ID);
  }

  function openParticipantEditor(booking, group, participantIndex) {
    if (!canEditBooking(booking)) {
      window.alert('這筆預約目前無法修改服務項目。');
      return;
    }
    const participant = group?.participants?.[participantIndex];
    if (!participant) return;
    const services = editableServices();
    if (!services.length) {
      window.alert('目前沒有可選擇的預約項目。');
      return;
    }

    document.querySelectorAll('.booking-group-admin-edit-modal').forEach((node) => node.remove());

    const overlay = document.createElement('div');
    overlay.className = 'booking-group-admin-edit-modal';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', `${participantLabel(participantIndex)}修改服務項目`);

    const panel = document.createElement('div');
    panel.className = 'booking-group-admin-edit-panel';

    const header = document.createElement('div');
    header.className = 'booking-group-admin-edit-heading';
    const titleBox = document.createElement('div');
    const kicker = document.createElement('small');
    kicker.textContent = 'Booking participant';
    const title = document.createElement('h3');
    title.textContent = `${participantLabel(participantIndex)}｜修改項目`;
    titleBox.append(kicker, title);
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'booking-group-admin-edit-close';
    close.textContent = '×';
    close.setAttribute('aria-label', '關閉');
    close.addEventListener('click', () => overlay.remove());
    header.append(titleBox, close);

    const hint = document.createElement('p');
    hint.className = 'booking-group-admin-edit-hint';
    hint.textContent = '只修改這一位的預約項目與數量；系統會重新計算整筆預約結束時間，技師與日期不變。';

    const form = document.createElement('form');
    form.className = 'booking-group-admin-edit-form';
    const rows = document.createElement('div');
    rows.className = 'booking-group-admin-edit-rows';
    const current = new Map((participant.items || []).map((item) => [String(item.serviceId || ''), Math.max(1, Number(item.quantity || 1))]));

    services.forEach((service) => {
      const serviceId = String(service.serviceId || '');
      if (!serviceId) return;
      const row = document.createElement('label');
      row.className = 'booking-group-admin-edit-row';

      const check = document.createElement('input');
      check.type = 'checkbox';
      check.value = serviceId;
      check.checked = current.has(serviceId);

      const copy = document.createElement('span');
      copy.className = 'booking-group-admin-edit-copy';
      const name = document.createElement('strong');
      name.textContent = `${String(service.title || '預約項目')}${service.isActive === false ? '（目前停用）' : ''}`;
      const meta = document.createElement('small');
      meta.textContent = `${Number(service.durationMinutes || 0)} 分鐘｜${formatMoney(service.priceAmount)}`;
      copy.append(name, meta);

      const quantity = document.createElement('select');
      quantity.setAttribute('aria-label', `${String(service.title || '預約項目')}數量`);
      quantity.innerHTML = '<option value="1">1 份</option><option value="2">2 份</option>';
      quantity.value = String(current.get(serviceId) || 1);
      quantity.disabled = !check.checked;
      check.addEventListener('change', () => { quantity.disabled = !check.checked; });

      row.append(check, copy, quantity);
      rows.appendChild(row);
    });

    const message = document.createElement('div');
    message.className = 'booking-group-admin-edit-message';
    message.setAttribute('aria-live', 'polite');

    const actions = document.createElement('div');
    actions.className = 'booking-group-admin-edit-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'booking-group-admin-edit-secondary';
    cancel.textContent = '取消';
    cancel.addEventListener('click', () => overlay.remove());
    const save = document.createElement('button');
    save.type = 'submit';
    save.className = 'booking-group-admin-edit-primary';
    save.textContent = '儲存修改';
    actions.append(cancel, save);

    form.append(rows, message, actions);
    panel.append(header, hint, form);
    overlay.appendChild(panel);
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) overlay.remove();
    });
    document.body.appendChild(overlay);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      message.textContent = '';
      const selected = [...rows.querySelectorAll('input[type="checkbox"]:checked')].map((checkbox) => {
        const row = checkbox.closest('.booking-group-admin-edit-row');
        return {
          serviceId: checkbox.value,
          quantity: Number(row?.querySelector('select')?.value || 1),
        };
      });
      if (!selected.length) {
        message.textContent = '請至少選擇一個預約項目。';
        return;
      }

      const participants = (group.participants || []).map((person, index) => ({
        position: Number(person.position || index + 1),
        items: index === participantIndex
          ? selected
          : (person.items || []).map((item) => ({
              serviceId: String(item.serviceId || ''),
              quantity: Math.max(1, Number(item.quantity || 1)),
            })),
      }));
      if (participants.some((person) => !person.position || !person.items.length || person.items.some((item) => !item.serviceId))) {
        message.textContent = '預約明細不完整，請更新資料後再試。';
        return;
      }

      save.disabled = true;
      cancel.disabled = true;
      rows.querySelectorAll('input,select').forEach((control) => { control.disabled = true; });
      save.textContent = '儲存中…';
      try {
        await request('booking-admin-operations', 'admin.booking.participants.items.update', {
          bookingId: booking.bookingId,
          expectedUpdatedAt: booking.updatedAt,
          participants,
        });
        overlay.remove();
        await refresh(true);
      } catch (error) {
        message.textContent = error?.message || '修改預約項目失敗。';
        save.disabled = false;
        cancel.disabled = false;
        rows.querySelectorAll('input[type="checkbox"]').forEach((control) => { control.disabled = false; });
        rows.querySelectorAll('.booking-group-admin-edit-row').forEach((row) => {
          const checkbox = row.querySelector('input[type="checkbox"]');
          const select = row.querySelector('select');
          if (select) select.disabled = !checkbox?.checked;
        });
        save.textContent = '儲存修改';
        if (error?.code === 'BOOKING_CONFLICT') {
          await refresh(true).catch(() => {});
        }
      }
    });
  }

  function openParticipantTechnicianEditor(booking, group, participantIndex) {
    if (!canEditBooking(booking)) {
      window.alert('這筆預約目前無法修改預約技師。');
      return;
    }
    const participant = group?.participants?.[participantIndex];
    if (!participant) return;

    const technicians = (state.technicians || [])
      .filter((technician) => technician.isActive || String(technician.technicianId || '') === String(participant.technicianId || ''))
      .slice()
      .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0) || String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hant'));

    if (!technicians.length) {
      window.alert('目前沒有可用技師，請先到預約人數與技師設定新增技師。');
      return;
    }

    document.querySelectorAll('.booking-group-admin-edit-modal').forEach((node) => node.remove());

    const overlay = document.createElement('div');
    overlay.className = 'booking-group-admin-edit-modal';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', `${participantLabel(participantIndex)}修改預約技師`);

    const panel = document.createElement('div');
    panel.className = 'booking-group-admin-edit-panel';

    const header = document.createElement('div');
    header.className = 'booking-group-admin-edit-heading';
    const titleBox = document.createElement('div');
    const kicker = document.createElement('small');
    kicker.textContent = 'Booking technician';
    const title = document.createElement('h3');
    title.textContent = `${participantLabel(participantIndex)}｜修改技師`;
    titleBox.append(kicker, title);

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'booking-group-admin-edit-close';
    close.textContent = '×';
    close.setAttribute('aria-label', '關閉');
    close.addEventListener('click', () => overlay.remove());
    header.append(titleBox, close);

    const hint = document.createElement('p');
    hint.className = 'booking-group-admin-edit-hint';
    hint.textContent = '同一筆多人預約不可重複指定同一位技師，且至少一位必須指定主要技師。儲存時會重新檢查技師時段衝突。';

    const form = document.createElement('form');
    form.className = 'booking-group-admin-edit-form';

    const label = document.createElement('label');
    label.className = 'booking-group-admin-technician-field';
    const labelText = document.createElement('strong');
    labelText.textContent = '預約技師';

    const select = document.createElement('select');
    select.setAttribute('aria-label', '預約技師');
    const onsite = document.createElement('option');
    onsite.value = '';
    onsite.textContent = '現場安排';
    select.appendChild(onsite);

    technicians.forEach((technician) => {
      const option = document.createElement('option');
      option.value = String(technician.technicianId || '');
      const isPrimary = option.value && option.value === String(state.primaryTechnicianId || '');
      option.textContent = `${String(technician.name || '未命名技師')}${isPrimary ? '（主要技師）' : ''}${technician.isActive === false ? '（目前停用）' : ''}`;
      option.disabled = technician.isActive === false && option.value !== String(participant.technicianId || '');
      select.appendChild(option);
    });
    select.value = String(participant.technicianId || '');
    label.append(labelText, select);

    const message = document.createElement('div');
    message.className = 'booking-group-admin-edit-message';
    message.setAttribute('aria-live', 'polite');

    const actions = document.createElement('div');
    actions.className = 'booking-group-admin-edit-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'booking-group-admin-edit-secondary';
    cancel.textContent = '取消';
    cancel.addEventListener('click', () => overlay.remove());

    const save = document.createElement('button');
    save.type = 'submit';
    save.className = 'booking-group-admin-edit-primary';
    save.textContent = '儲存修改';
    actions.append(cancel, save);

    form.append(label, message, actions);
    panel.append(header, hint, form);
    overlay.appendChild(panel);
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) overlay.remove();
    });
    document.body.appendChild(overlay);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      message.textContent = '';

      const participants = (group.participants || []).map((person, index) => ({
        position: Number(person.position || index + 1),
        technicianId: index === participantIndex ? String(select.value || '') : String(person.technicianId || ''),
      }));

      if (participants.some((person) => !person.position)) {
        message.textContent = '預約明細不完整，請更新資料後再試。';
        return;
      }

      const selectedIds = participants.map((person) => person.technicianId).filter(Boolean);
      if (new Set(selectedIds).size !== selectedIds.length) {
        message.textContent = '同一筆多人預約不可重複指定同一位技師。';
        return;
      }

      const primaryTechnicianId = String(state.primaryTechnicianId || '');
      if (primaryTechnicianId && !selectedIds.includes(primaryTechnicianId)) {
        message.textContent = '至少一位預約人必須指定主要技師。';
        return;
      }

      save.disabled = true;
      cancel.disabled = true;
      select.disabled = true;
      save.textContent = '儲存中…';
      try {
        await request('booking-admin-operations', 'admin.booking.participants.technicians.update', {
          bookingId: booking.bookingId,
          expectedUpdatedAt: booking.updatedAt,
          participants,
        });
        overlay.remove();
        await refresh(true);
      } catch (error) {
        message.textContent = error?.message || '修改預約技師失敗。';
        save.disabled = false;
        cancel.disabled = false;
        select.disabled = false;
        save.textContent = '儲存修改';
        if (error?.code === 'BOOKING_CONFLICT') {
          await refresh(true).catch(() => {});
        }
      }
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