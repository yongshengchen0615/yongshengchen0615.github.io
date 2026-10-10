(() => {
  'use strict';

  const POINT_CARD_STYLE_KEYS = Object.freeze(['citrus', 'coral', 'lagoon', 'skyline', 'violet', 'berry', 'cocoa', 'lime', 'denim', 'peach']);
  const LEGACY_POINT_CARD_STYLE_MAP = Object.freeze({ forest: 'lagoon', midnight: 'skyline', ocean: 'denim', sunset: 'coral', lavender: 'violet', rose: 'berry', gold: 'citrus', platinum: 'cocoa', mint: 'lime', cherry: 'peach' });

  const state = {
    config: null,
    idToken: '',
    snapshot: null,
    selected: new Set(),
    busy: false,
    initialized: false,
    refreshData: null,
    maxTicketsPerRedemption: 1
  };

  let root = null;
  let selectionText = null;
  let selectionHint = null;
  let useButton = null;
  let groups = null;
  let locationTracker = null;
  let locationName = '';
  let locationNameFix = null;
  let locationGeneration = 0;

  function extensionUrl() {
    return `${String(state.config && state.config.supabaseUrl || '').replace(/\/$/, '')}/functions/v1/pointcard-extension-api`;
  }

  function text(value) {
    return String(value == null ? '' : value);
  }

  function points(value) {
    return Math.max(0, Number(value || 0));
  }

  function safeCardStyle(value) {
    const styleKey = String(value || '').trim().toLowerCase();
    return POINT_CARD_STYLE_KEYS.includes(styleKey) ? styleKey : (LEGACY_POINT_CARD_STYLE_MAP[styleKey] || POINT_CARD_STYLE_KEYS[0]);
  }

  function normalizeLimit(value) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 0 && parsed <= 50 ? parsed : 1;
  }

  function hasRedemptionLimit() {
    return state.maxTicketsPerRedemption > 0;
  }

  function redemptionLimitLabel() {
    return hasRedemptionLimit() ? `${state.maxTicketsPerRedemption} 張` : '不限張數';
  }

  function newRequestId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return `PTR-${window.crypto.randomUUID().replaceAll('-', '')}`;
    }
    return `PTR-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  }


  function stopLiveLocation() {
    locationGeneration += 1;
    locationTracker?.stop();
    locationTracker = null;
    locationName = '';
    locationNameFix = null;
  }

  function liveLocationStatus(message) {
    const status = document.querySelector('#ticketBatchModal [data-live-location-status]');
    if (status) status.textContent = message;
  }

  function liveLocation() {
    if (!window.TicketLiveLocation) throw new Error('GPS 模組尚未載入，請重新開啟票券。');
    if (!locationTracker) locationTracker = window.TicketLiveLocation.create({
      onUpdate: (fix, fresh) => {
        if (locationNameFix && window.TicketLiveLocation.distanceMeters(locationNameFix, fix) > 120) {
          locationName = '';
          locationNameFix = null;
        }
        const position = locationName ? `目前附近：「${locationName}」` : '請確認目前地點名稱';
        liveLocationStatus(`${fresh ? '即時 GPS 已更新' : 'GPS 精度不足或座標已過期'}（約 ±${Math.round(fix.accuracy)} 公尺）。${position}。`);
      },
      onError: liveLocationStatus
    });
    return locationTracker;
  }

  async function currentRedemptionLocation() {
    liveLocationStatus('正在取得最新 GPS，需精度 100 公尺內…');
    return liveLocation().read();
  }

  async function confirmLiveLocationName(fix = null) {
    const generation = locationGeneration;
    const modal = document.getElementById('ticketBatchModal');
    const lookup = modal?.querySelector('[data-live-location-button]');
    if (lookup) lookup.disabled = true;
    try {
      const position = fix || await currentRedemptionLocation();
      liveLocationStatus('正在確認 GPS 所在地點（地圖資料來源：OpenStreetMap）…');
      const name = await window.TicketLiveLocation.placeName(position);
      if (generation !== locationGeneration) return;
      if (window.TicketLiveLocation.distanceMeters(position, liveLocation().latest()) > 120) {
        liveLocationStatus('GPS 位置已有變動，請重新確認地點名稱。');
        return;
      }
      locationName = name;
      locationNameFix = position;
      liveLocationStatus(`GPS 約定位在「${name}」，精度 ±${Math.round(position.accuracy)} 公尺。請確認所在地點，核銷仍由伺服器驗證。`);
    } catch (error) {
      if (generation === locationGeneration) liveLocationStatus(`無法確認地點名稱：${error?.message || '稍後再試'}。GPS 仍可正常進行核銷驗證。`);
    } finally {
      if (lookup && generation === locationGeneration) lookup.disabled = false;
    }
  }

  function hasMemberAuth() {
    const testSessionToken = window.TestModeClient && typeof window.TestModeClient.getSessionToken === 'function'
      ? String(window.TestModeClient.getSessionToken() || '')
      : '';
    return Boolean(state.idToken || testSessionToken);
  }

  async function extensionRequest(operation, payload = {}) {
    if (!state.config || !hasMemberAuth()) {
      const error = new Error('票券登入狀態尚未完成。');
      error.code = 'AUTH_NOT_READY';
      throw error;
    }

    const response = await fetch(extensionUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: String(state.config.supabasePublishableKey || '')
      },
      cache: 'no-store',
      body: JSON.stringify(window.TestModeClient && typeof window.TestModeClient.payload === 'function'
        ? window.TestModeClient.payload({ ...payload, operation, idToken: state.idToken })
        : { ...payload, operation, idToken: state.idToken })
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data || data.ok !== true) {
      const error = new Error(data && data.error && data.error.message || '票券操作暫時無法完成。');
      error.code = data && data.error && data.error.code || 'API_ERROR';
      throw error;
    }
    return data.data || {};
  }

  function ensureUi() {
    const ticketList = document.getElementById('ticketList');
    if (!ticketList) return false;

    root = ticketList;
    let overview = root.querySelector('[data-all-ticket-overview]');
    if (!overview) {
      root.replaceChildren();
      overview = document.createElement('div');
      overview.className = 'ticket-overview-extension';
      overview.dataset.allTicketOverview = 'true';
      overview.innerHTML = '<div class="ticket-overview-toolbar"><div class="ticket-overview-selection"><strong data-ticket-selection>尚未選擇票券</strong><small data-ticket-selection-hint>所有集點卡兌換節點都會顯示；點數不足的票券無法勾選。</small></div><button class="ticket-overview-use" type="button" disabled>使用已選票券</button></div><div class="ticket-overview-error" data-ticket-error hidden></div><div class="ticket-overview-groups"></div>';
      root.append(overview);
      overview.addEventListener('change', handleSelectionChange);
    }

    selectionText = overview.querySelector('[data-ticket-selection]');
    selectionHint = overview.querySelector('[data-ticket-selection-hint]');
    useButton = overview.querySelector('.ticket-overview-use');
    groups = overview.querySelector('.ticket-overview-groups');

    if (useButton && !useButton.dataset.bound) {
      useButton.dataset.bound = 'true';
      useButton.addEventListener('click', openConfirmModal);
    }
    return true;
  }

  function overviewError(message = '') {
    const box = root && root.querySelector('[data-ticket-error]');
    if (!box) return;
    box.hidden = !message;
    box.textContent = message;
  }

  function offersByCard(snapshot) {
    const cards = Array.isArray(snapshot && snapshot.cards) ? snapshot.cards : [];
    const details = snapshot && snapshot.cardDetails && typeof snapshot.cardDetails === 'object'
      ? snapshot.cardDetails
      : {};

    return cards.map((summary) => {
      const detail = details[summary.cardId] || {};
      const card = detail.card && typeof detail.card === 'object' ? { ...summary, ...detail.card } : summary;
      const rewards = Array.isArray(card.rewards)
        ? card.rewards.slice().sort((a, b) => Number(a.thresholdStamps || 0) - Number(b.thresholdStamps || 0))
        : [];
      const tickets = Array.isArray(detail.tickets)
        ? detail.tickets.filter((ticket) => ticket && ticket.status !== 'used')
        : [];
      const cardStamps = points(card.availableStamps ?? card.stamps);
      const matchedTicketIds = new Set();

      const offers = rewards.map((reward) => {
        const thresholdStamps = Math.max(1, Number(reward.thresholdStamps || 0));
        const templateId = String(reward.ticketTemplateId || reward.ticket_template_id || '');
        const rewardTitle = String(reward.rewardTitle || '');
        let ticket = tickets.find((item) => {
          const ticketId = String(item.ticketId || '');
          return ticketId && !matchedTicketIds.has(ticketId)
            && templateId
            && String(item.ticketTemplateId || item.ticket_template_id || '') === templateId;
        }) || null;

        if (!ticket) {
          ticket = tickets.find((item) => {
            const ticketId = String(item.ticketId || '');
            return ticketId && !matchedTicketIds.has(ticketId)
              && Number(item.thresholdStamps || 0) === thresholdStamps
              && (!rewardTitle || String(item.ticketTitle || '') === rewardTitle);
          }) || null;
        }

        if (!ticket) {
          ticket = tickets.find((item) => {
            const ticketId = String(item.ticketId || '');
            return ticketId && !matchedTicketIds.has(ticketId)
              && Number(item.thresholdStamps || 0) === thresholdStamps;
          }) || null;
        }

        const ticketId = String(ticket && ticket.ticketId || '');
        if (ticketId) matchedTicketIds.add(ticketId);

        const reservedForBooking = Boolean(ticket && ticket.reservedForBooking);
        const shortage = Math.max(0, thresholdStamps - cardStamps);
        const expired = Boolean(card.expired);
        const active = String(card.status || 'active') === 'active';
        let statusText = '可勾選使用';
        if (reservedForBooking) statusText = '已預約使用';
        else if (expired) statusText = '集點卡已超過使用期限';
        else if (!active) statusText = '集點卡目前未開放使用';
        else if (shortage > 0) statusText = `點數不足，還差 ${shortage} 點`;
        else if (ticketId && !ticket?.eligibleBookings?.length) statusText = '需先有已確認、尚未完成且符合項目的預約';
        else if (!ticketId) statusText = '已達兌換點數，但票券尚未可用，請更新後再試';

        return {
          cardId: String(card.cardId || summary.cardId || ''),
          cardTitle: String(card.title || '集點卡'),
          cardStyleKey: safeCardStyle(card.styleKey),
          cardStamps,
          ticketId,
          thresholdStamps,
          ticketType: String(ticket ? ticket.ticketType : reward.rewardType || 'coupon'),
          ticketTitle: String(ticket ? ticket.ticketTitle : reward.rewardTitle || '票券'),
          ticketDescription: String(ticket ? ticket.ticketDescription : reward.rewardDescription || '達到此集點節點後即可使用這張票券。'),
          usageMethod: String(ticket ? ticket.usageMethod : reward.usageMethod || ''),
          usageInstructions: String(ticket ? ticket.usageInstructions : reward.usageInstructions || ''),
          prizes: Array.isArray(ticket ? ticket.prizes : reward.prizes) ? (ticket ? ticket.prizes : reward.prizes) : [],
          requiresLocation: Boolean(ticket && ticket.requiresLocation),
          redemptionLocations: Array.isArray(ticket?.redemptionLocations) ? ticket.redemptionLocations : [],
          reservedForBooking,
          eligibleBookings: Array.isArray(ticket?.eligibleBookings) ? ticket.eligibleBookings : [],
          shortage,
          baseCanUse: Boolean(ticketId) && !reservedForBooking && !expired && active && shortage === 0 && Boolean(ticket?.eligibleBookings?.length),
          statusText
        };
      });

      return { card, offers };
    });
  }

  function allOffers() {
    return offersByCard(state.snapshot).flatMap((entry) => entry.offers);
  }

  function selectedTicketsFromIds(ids) {
    return allOffers().filter((offer) => offer.ticketId && ids.has(offer.ticketId));
  }

  function selectedTickets() {
    return selectedTicketsFromIds(state.selected);
  }

  function spendByCard(tickets, spentField = 'thresholdStamps') {
    const grouped = new Map();
    tickets.forEach((ticket) => {
      const cardId = String(ticket.cardId || ticket.cardTitle || 'point-card');
      const current = grouped.get(cardId) || {
        cardId,
        cardTitle: String(ticket.cardTitle || '集點卡'),
        currentStamps: Number.isFinite(Number(ticket.cardStamps)) ? points(ticket.cardStamps) : null,
        points: 0,
        count: 0
      };
      current.points += points(ticket[spentField]);
      current.count += 1;
      grouped.set(cardId, current);
    });
    return [...grouped.values()];
  }

  function selectedSpendMap() {
    const map = new Map();
    selectedTickets().forEach((ticket) => {
      map.set(ticket.cardId, (map.get(ticket.cardId) || 0) + points(ticket.thresholdStamps));
    });
    return map;
  }

  function handleSelectionChange(event) {
    const input = event.target instanceof HTMLInputElement ? event.target.closest('[data-ticket-select]') : null;
    if (!input) return;
    const ticketId = String(input.dataset.ticketSelect || '');
    if (!ticketId) return;
    overviewError('');

    const offer = allOffers().find((item) => item.ticketId === ticketId);
    if (!offer || !offer.baseCanUse) {
      input.checked = false;
      overviewError(offer && offer.statusText || '這張票券目前無法使用。');
      return;
    }

    const nextSelected = new Set(state.selected);
    if (input.checked) nextSelected.add(ticketId);
    else nextSelected.delete(ticketId);

    if (hasRedemptionLimit() && nextSelected.size > state.maxTicketsPerRedemption) {
      input.checked = false;
      overviewError(`單次最多可使用 ${state.maxTicketsPerRedemption} 張票券，請先取消其他票券再選擇。`);
      return;
    }

    const nextTickets = selectedTicketsFromIds(nextSelected);
    const insufficient = spendByCard(nextTickets).find(
      (item) => item.currentStamps !== null && item.points > item.currentStamps
    );
    if (insufficient) {
      input.checked = false;
      overviewError(`${insufficient.cardTitle} 點數不足：目前 ${insufficient.currentStamps} 點，本次已選票券需要 ${insufficient.points} 點。`);
      return;
    }

    state.selected = nextSelected;
    render();
  }

  function updateSummary(totalNodes, currentlyUsable) {
    const ticketSummary = document.getElementById('ticketSummary');
    if (!ticketSummary) return;
    ticketSummary.textContent = totalNodes
      ? `共 ${totalNodes} 個票券節點・目前 ${currentlyUsable} 個可使用・單次使用 ${redemptionLimitLabel()}`
      : '目前所有集點卡都尚未設定票券節點。';
  }

  function createLotteryPrizeOpportunities(offer) {
    if (offer.ticketType !== 'lottery' || !Array.isArray(offer.prizes)) return null;
    const prizes = offer.prizes.filter((prize) => String(prize && prize.prizeTitle || '').trim());
    if (!prizes.length) return null;

    const container = document.createElement('div');
    container.className = 'lottery-prize-opportunities';
    const label = document.createElement('p');
    label.className = 'prize-opportunity-label';
    label.textContent = '有機會獲得';
    const list = document.createElement('ul');
    list.className = 'prize-opportunities';
    list.setAttribute('aria-label', '抽獎可能獲得的獎項');
    prizes.forEach((prize) => {
      const item = document.createElement('li');
      item.className = 'prize-opportunity';
      const title = document.createElement('span');
      title.textContent = String(prize.prizeTitle || '').trim();
      item.append(title);
      list.append(item);
    });
    container.append(label, list);
    return container;
  }

  function render() {
    if (!state.snapshot || !ensureUi() || !groups) return;

    const grouped = offersByCard(state.snapshot);
    const selectableIds = new Set(
      grouped.flatMap((entry) => entry.offers.filter((offer) => offer.baseCanUse).map((offer) => offer.ticketId))
    );
    const retainedSelected = [...state.selected].filter((id) => selectableIds.has(id));
    state.selected = new Set(hasRedemptionLimit()
      ? retainedSelected.slice(0, state.maxTicketsPerRedemption)
      : retainedSelected);

    for (const item of spendByCard(selectedTickets())) {
      if (item.currentStamps !== null && item.points > item.currentStamps) {
        state.selected.clear();
        break;
      }
    }

    const selectedSpend = selectedSpendMap();
    groups.replaceChildren();
    const all = grouped.flatMap((entry) => entry.offers);
    const totalNodes = all.length;
    const currentlyUsable = all.filter((offer) => offer.baseCanUse).length;
    updateSummary(totalNodes, currentlyUsable);

    if (!totalNodes) {
      const empty = document.createElement('div');
      empty.className = 'ticket-empty';
      empty.innerHTML = '<span aria-hidden="true">○</span><p>目前所有集點卡都尚未設定票券節點。</p>';
      groups.append(empty);
      updateSelection();
      return;
    }

    grouped.forEach(({ card, offers }) => {
      if (!offers.length) return;

      const section = document.createElement('section');
      section.className = 'ticket-overview-group';

      const heading = document.createElement('div');
      heading.className = 'ticket-overview-group-heading';
      const title = document.createElement('h3');
      title.textContent = text(card.title || '集點卡');
      const meta = document.createElement('small');
      meta.textContent = `目前可用 ${points(card.availableStamps ?? card.stamps)} 點・共 ${offers.length} 個票券節點`;
      heading.append(title, meta);
      section.append(heading);

      offers.forEach((offer) => {
        const isSelected = Boolean(offer.ticketId && state.selected.has(offer.ticketId));
        const spentOnCard = selectedSpend.get(offer.cardId) || 0;
        const remainingForNewSelection = Math.max(0, offer.cardStamps - spentOnCard);
        const hitGlobalLimit = hasRedemptionLimit() && !isSelected && state.selected.size >= state.maxTicketsPerRedemption;
        const insufficientAfterSelection = !isSelected
          && offer.baseCanUse
          && points(offer.thresholdStamps) > remainingForNewSelection;
        const selectable = isSelected || (offer.baseCanUse && !hitGlobalLimit && !insufficientAfterSelection);

        let statusText = offer.statusText;
        if (offer.baseCanUse && insufficientAfterSelection) {
          statusText = `剩餘可用 ${remainingForNewSelection} 點，無法再勾選此票券`;
        } else if (offer.baseCanUse && hitGlobalLimit) {
          statusText = `已達單次最多 ${state.maxTicketsPerRedemption} 張`;
        } else if (isSelected) {
          statusText = '已選擇';
        }

        const item = document.createElement('article');
        item.className = `member-ticket ui-ticket${offer.baseCanUse ? ' is-ready' : ' locked'}${offer.reservedForBooking ? ' is-reserved' : ''}${isSelected ? ' is-selected' : ''}`;
        item.dataset.cardStyle = safeCardStyle(offer.cardStyleKey);

        const type = document.createElement('span');
        type.className = 'member-ticket-type';
        type.textContent = `${offer.ticketType === 'lottery' ? '抽獎券' : '優惠券'}${offer.requiresLocation ? ' · GPS 定位' : ''}`;

        const name = document.createElement('h3');
        name.textContent = text(offer.ticketTitle || '票券');

        const description = document.createElement('p');
        description.textContent = text(offer.ticketDescription || '達到此集點節點後即可使用。');

        const method = document.createElement('p');
        method.className = 'member-ticket-method';
        method.textContent = `使用方式：${offer.usageMethod || '達標後請向店員出示本券'}`;

        const cost = window.MemberUI.pointTicketDetails({ cardTitle: offer.cardTitle, pointCost: offer.thresholdStamps, pointBalance: offer.cardStamps });

        const footer = document.createElement('div');
        footer.className = 'member-ticket-footer';
        const status = document.createElement('span');
        status.className = 'ticket-state';
        status.textContent = statusText;

        const selectWrap = document.createElement('label');
        selectWrap.className = 'ticket-checkbox-action';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'ticket-overview-check';
        checkbox.dataset.ticketSelect = offer.ticketId;
        checkbox.checked = isSelected;
        checkbox.disabled = state.busy || !selectable || !offer.ticketId;
        checkbox.setAttribute('aria-label', `${offer.ticketTitle}，${statusText}`);
        const selectText = document.createElement('span');
        selectText.textContent = offer.reservedForBooking ? '已預約使用' : isSelected ? '已選' : '選擇';
        selectWrap.append(checkbox, selectText);
        footer.append(status, selectWrap);

        item.append(type, name, description, method);
        const prizeOpportunities = createLotteryPrizeOpportunities(offer);
        if (prizeOpportunities) item.append(prizeOpportunities);
        item.append(cost, footer);
        section.append(item);
      });

      groups.append(section);
    });

    updateSelection();
  }

  function spendSummaryText(tickets) {
    return spendByCard(tickets).map((item) => {
      const balance = item.currentStamps === null ? '' : `（目前 ${item.currentStamps} 點）`;
      return `${item.cardTitle}扣 ${item.points} 點${balance}`;
    }).join('｜');
  }

  function updateSelection() {
    const tickets = selectedTickets();
    const count = tickets.length;
    if (selectionText) {
      selectionText.textContent = count
        ? (hasRedemptionLimit() ? `已選 ${count} / ${state.maxTicketsPerRedemption} 張票券` : `已選 ${count} 張票券・單次不限張數`)
        : `尚未選擇票券・單次使用 ${redemptionLimitLabel()}`;
    }
    if (selectionHint) {
      selectionHint.textContent = count
        ? `預計扣點：${spendSummaryText(tickets)}`
        : '所有節點都會顯示；點數不足或目前不可用的票券會鎖定，不能勾選。';
    }
    if (useButton) {
      useButton.disabled = state.busy || count === 0;
      useButton.textContent = state.busy
        ? '處理中…'
        : count > 1
          ? `使用 ${count} 張票券`
          : '使用已選票券';
    }
  }

  function modalBase() {
    let modal = document.getElementById('ticketBatchModal');
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = 'ticketBatchModal';
    modal.className = 'ticket-batch-modal hidden';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.innerHTML = '<div class="ticket-batch-card"><h2 data-batch-title>確認使用票券</h2><p class="ticket-batch-warning" data-batch-message></p><div class="ticket-batch-list" data-batch-list></div><div class="ticket-batch-actions"><button class="ticket-batch-cancel" type="button">取消</button><button class="ticket-batch-confirm" type="button">確認使用</button></div></div>';
    document.body.append(modal);

    modal.querySelector('.ticket-batch-cancel').addEventListener('click', () => {
      if (!state.busy) { stopLiveLocation(); modal.classList.add('hidden'); }
    });
    modal.addEventListener('click', (event) => {
      if (event.target === modal && !state.busy) { stopLiveLocation(); modal.classList.add('hidden'); }
    });
    modal.querySelector('.ticket-batch-confirm').addEventListener('click', () => {
      const confirm = modal.querySelector('.ticket-batch-confirm');
      if (confirm.dataset.mode === 'close') {
        stopLiveLocation();
        modal.classList.add('hidden');
        return;
      }
      redeemSelected();
    });
    return modal;
  }

  function openConfirmModal() {
    const tickets = selectedTickets();
    if (!tickets.length) return;
    if (hasRedemptionLimit() && tickets.length > state.maxTicketsPerRedemption) {
      overviewError(`單次最多可使用 ${state.maxTicketsPerRedemption} 張票券。`);
      return;
    }

    const insufficient = spendByCard(tickets).find(
      (item) => item.currentStamps !== null && item.points > item.currentStamps
    );
    if (insufficient) {
      overviewError(`${insufficient.cardTitle} 點數不足，請取消部分票券。`);
      return;
    }

    const modal = modalBase();
    modal.querySelector('[data-batch-title]').textContent = tickets.length > 1
      ? `確認同時使用 ${tickets.length} 張票券`
      : '確認使用票券';
    const needsLocation = tickets.some((ticket) => ticket.requiresLocation);
    stopLiveLocation();
    let livePanel = modal.querySelector('[data-live-location-panel]');
    if (!livePanel) {
      livePanel = document.createElement('div');
      livePanel.dataset.liveLocationPanel = '';
      livePanel.className = 'ticket-live-location-panel';
      const status = document.createElement('p');
      status.dataset.liveLocationStatus = '';
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ticket-live-location-confirm';
      button.dataset.liveLocationButton = '';
      button.textContent = '確認目前 GPS 地點名稱（OpenStreetMap）';
      button.addEventListener('click', () => { void confirmLiveLocationName(); });
      livePanel.append(status, button);
      modal.querySelector('[data-batch-list]').before(livePanel);
    }
    livePanel.hidden = !needsLocation;
    if (needsLocation) liveLocationStatus('按「確認目前 GPS 地點名稱」後開始即時更新；僅在開啟核銷視窗期間定位。');
    modal.querySelector('[data-batch-message]').textContent = needsLocation
      ? '此選取包含需 GPS 定位的票券。確認後會讀取目前位置；位置符合指定地點後才會立即扣點與核銷。'
      : '送出後將立即完成扣點與票券核銷，此操作無法取消或復原。';

    let bookingChoice = modal.querySelector('[data-ticket-booking-choice]');
    if (!bookingChoice) { bookingChoice = document.createElement('div'); bookingChoice.dataset.ticketBookingChoice = ''; modal.querySelector('[data-batch-list]').before(bookingChoice); }
    bookingChoice.hidden = false;
    const eligibleBookings = window.TicketBookingChoice?.common(tickets) || [];
    window.TicketBookingChoice?.mount(bookingChoice, eligibleBookings, () => { modal.querySelector('.ticket-batch-confirm').disabled = !window.TicketBookingChoice.selected(bookingChoice); });
    const list = modal.querySelector('[data-batch-list]');
    list.replaceChildren(...tickets.map((ticket) => {
      const line = document.createElement('article');
      line.className = 'ticket-batch-line';
      line.dataset.cardStyle = safeCardStyle(ticket.cardStyleKey);

      const head = document.createElement('div');
      head.className = 'ticket-batch-line-head';
      const cardTitle = document.createElement('strong');
      cardTitle.className = 'ticket-batch-card-title';
      cardTitle.textContent = text(ticket.cardTitle || '集點卡');
      const ticketTitle = document.createElement('span');
      ticketTitle.className = 'ticket-batch-ticket-badge';
      ticketTitle.textContent = text(ticket.ticketTitle || '票券');
      head.append(cardTitle, ticketTitle);

      const spend = document.createElement('div');
      spend.className = 'ticket-batch-spend';
      const spendLabel = document.createElement('span');
      spendLabel.textContent = '從此卡扣除';
      const spendValue = document.createElement('strong');
      const spent = points(ticket.thresholdStamps);
      spendValue.textContent = `${spent} 點`;
      spend.append(spendLabel, spendValue);

      const balance = document.createElement('small');
      balance.className = 'ticket-batch-balance';
      const current = points(ticket.cardStamps);
      balance.textContent = `目前 ${current} 點・使用後 ${Math.max(0, current - spent)} 點`;

      line.append(head, spend, balance);
      return line;
    }));

    modal.querySelector('.ticket-batch-cancel').hidden = false;
    const confirm = modal.querySelector('.ticket-batch-confirm');
    confirm.dataset.mode = 'redeem';
    confirm.disabled = !window.TicketBookingChoice?.selected(bookingChoice);
    confirm.textContent = '確認使用';
    modal.classList.remove('hidden');
    confirm.focus();
  }

  async function redeemSelected() {
    if (state.busy) return;
    const tickets = selectedTickets();
    if (!tickets.length || (hasRedemptionLimit() && tickets.length > state.maxTicketsPerRedemption)) return;

    const insufficient = spendByCard(tickets).find(
      (item) => item.currentStamps !== null && item.points > item.currentStamps
    );
    if (insufficient) {
      overviewError(`${insufficient.cardTitle} 點數不足，請取消部分票券。`);
      return;
    }

    const modal = modalBase();
    const bookingChoice = modal.querySelector('[data-ticket-booking-choice]');
    const bookingId = window.TicketBookingChoice?.selected(bookingChoice);
    if (!bookingId) { overviewError('請選擇這些票券共同符合的已確認預約。'); return; }
    const confirm = modal.querySelector('.ticket-batch-confirm');
    const message = modal.querySelector('[data-batch-message]');
    const cancel = modal.querySelector('.ticket-batch-cancel');
    let redeemed = false;
    let synced = false;
    const needsLocation = tickets.some((ticket) => ticket.requiresLocation);

    state.busy = true;
    window.TicketBookingChoice?.lock(bookingChoice, true);
    confirm.disabled = true;
    confirm.textContent = '使用中…';
    cancel.hidden = true;
    updateSelection();
    render();

    try {
      let location = null;
      if (needsLocation) {
        confirm.textContent = '取得 GPS 中…';
        message.textContent = '正在取得目前位置並確認定位精度…';
        location = await currentRedemptionLocation();
        if (!locationName) await confirmLiveLocationName(location);
        const placeDescription = locationName || '尚無可辨識名稱，請自行確認實際所在地點';
        if (!window.confirm(`GPS 目前推定位置：${placeDescription}（約 ±${Math.round(location.accuracy)} 公尺）。\n確定在此地點使用票券嗎？`)) {
          message.textContent = '已取消這次使用，票券尚未核銷。';
          confirm.dataset.mode = 'redeem';
          confirm.disabled = false;
          confirm.textContent = '確認使用';
          cancel.hidden = false;
          return;
        }
        // Renew the snapshot after confirmation; do not send a stale coordinate.
        location = await currentRedemptionLocation();
        confirm.textContent = '使用中…';
        message.textContent = 'GPS 已更新，正在確認使用地點並核銷票券…';
      }
      const usageKey = bookingId + ':' + tickets.map(ticket => ticket.ticketId).sort().join(',');
      if (state.usageAttempt?.key !== usageKey) state.usageAttempt = { key: usageKey, requestId: newRequestId() };
      const result = await extensionRequest('member.redeem', {
        bookingId,
        ticketIds: tickets.map((ticket) => ticket.ticketId),
        requestId: state.usageAttempt.requestId,
        ...(location ? { location } : {})
      });
      redeemed = true;
      stopLiveLocation();
      state.usageAttempt = null;
      bookingChoice.hidden = true;

      const resultTickets = Array.isArray(result.tickets) ? result.tickets : [];
      modal.querySelector('[data-batch-title]').textContent = `已完成 ${Number(result.ticketCount || resultTickets.length)} 張票券使用`;
      const resultSpend = spendByCard(
        resultTickets.map((ticket) => ({ ...ticket, thresholdStamps: ticket.pointsSpent })),
        'thresholdStamps'
      );
      const resultSpendText = resultSpend.length
        ? '\n' + resultSpend.map((item) => `• ${item.cardTitle}：已扣 ${item.points} 點`).join('\n')
        : '';
      message.textContent = (result.alreadyApplied
        ? '此操作先前已完成，正在同步最新資料。'
        : '票券已完成核銷，正在同步最新資料。') + resultSpendText;

      const list = modal.querySelector('[data-batch-list]');
      list.replaceChildren(...resultTickets.map((ticket) => {
        const line = document.createElement('div');
        line.className = 'ticket-batch-line';
        const prize = ticket.ticketType === 'lottery' && ticket.result && ticket.result.prizeTitle
          ? `｜抽中：${ticket.result.prizeTitle}`
          : '';
        line.textContent = `${ticket.cardTitle}｜${ticket.ticketTitle}｜已扣 ${points(ticket.pointsSpent)} 點${prize}`;
        return line;
      }));

      state.selected.clear();
      confirm.textContent = '同步中…';

      if (typeof state.refreshData !== 'function') {
        throw new Error('票券已完成使用，但頁面同步功能未就緒。');
      }
      await state.refreshData();
      synced = true;

      message.textContent = (result.alreadyApplied
        ? '此操作先前已完成，最新資料已同步。'
        : '票券已完成核銷，最新資料已同步。') + resultSpendText;
      confirm.dataset.mode = 'close';
      confirm.disabled = false;
      confirm.textContent = '關閉';
      overviewError('');
    } catch (error) {
      if (redeemed) {
        message.textContent = '票券已完成使用，但最新資料同步失敗；系統將重新載入以確認最新狀態。';
        confirm.disabled = true;
        cancel.hidden = true;
        window.setTimeout(() => window.location.reload(), 150);
      } else {
        message.textContent = error && error.message || '票券使用失敗，請重新整理後再試。';
        confirm.dataset.mode = 'redeem';
        confirm.disabled = false;
        confirm.textContent = '重新確認';
        cancel.hidden = false;
      }
    } finally {
      state.busy = false;
      window.TicketBookingChoice?.lock(bookingChoice, false);
      if (synced) render();
      else if (!redeemed) {
        updateSelection();
        render();
      }
    }
  }

  async function refreshSettings() {
    if (!state.config || !hasMemberAuth()) {
      const error = new Error('票券登入資訊不完整。');
      error.code = 'AUTH_NOT_READY';
      throw error;
    }
    const setting = await extensionRequest('member.settings.get');
    state.maxTicketsPerRedemption = normalizeLimit(setting.maxTicketsPerRedemption);
    if (state.initialized) render();
    return state.maxTicketsPerRedemption;
  }

  async function initialize({ config, idToken, refreshData } = {}) {
    state.config = config && typeof config === 'object' ? config : null;
    state.idToken = String(idToken || '');
    state.refreshData = typeof refreshData === 'function' ? refreshData : null;
    if (!state.config || !hasMemberAuth()) {
      const error = new Error('票券登入資訊不完整。');
      error.code = 'AUTH_NOT_READY';
      throw error;
    }

    await refreshSettings();
    state.initialized = true;
    ensureUi();
  }

  function renderSnapshot(snapshot) {
    if (!state.initialized) {
      const error = new Error('票券總覽尚未初始化。');
      error.code = 'TICKET_OVERVIEW_NOT_INITIALIZED';
      throw error;
    }
    state.snapshot = snapshot && typeof snapshot === 'object' ? snapshot : { cards: [], cardDetails: {} };
    render();
  }

  window.addEventListener('pagehide', stopLiveLocation);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') stopLiveLocation();
  });
  window.PointCardTicketOverview = Object.freeze({ initialize, refreshSettings, renderSnapshot });
})();