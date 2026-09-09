(() => {
  'use strict';

  const POINT_CARD_STYLE_KEYS = Object.freeze(['forest', 'midnight', 'ocean', 'sunset', 'lavender', 'rose', 'gold', 'platinum', 'mint', 'cherry']);
  const state = { config: null, idToken: '', bootstrapVersion: '', cacheScope: '', profile: null, cards: [], cardDetails: Object.create(null), detailLoadingCardId: '', tickets: [], history: [], historyTotal: 0, activeCardId: '', pendingTicketId: '', redeeming: false, uncertainTicketId: '', ticketModalOpener: null };
  const els = {};
  const LOGIN_PROGRESS_TICK_MS = 650;
  let loginProgressTimer = null;
  let loginProgressValue = 8;

  window.addEventListener('DOMContentLoaded', () => {
    window.MemberSystem.bindDialogKeyboard();
    [
      'app', 'loadingView', 'loadingProgress', 'loadingProgressBar', 'loadingProgressText', 'loadingStatus', 'errorView', 'errorTitle', 'errorMessage', 'joinMemberButton', 'retryButton', 'pointsView', 'displayName', 'logoutButton', 'refreshButton', 'membershipProgress', 'cardTabs', 'emptyView', 'activeCardView', 'activeCardTitle', 'activeCardStatus', 'cardGuidancePanel', 'cardUsageMethod', 'cardUsageInstructions', 'cardBenefitDescription', 'progressCount', 'progressMessage', 'remainingMessage', 'cardExpiry', 'ticketSummary', 'ticketList', 'ticketEmpty',
      'ticketHistorySummary', 'ticketHistoryList', 'ticketHistoryEmpty', 'ticketModal', 'closeTicketModal', 'ticketModalTicketName', 'ticketModalDescription', 'ticketModalUsageMethod', 'ticketModalUsageInstructions', 'ticketModalCost', 'ticketModalProcessing', 'confirmTicketUseButton', 'refreshTicketButton', 'ticketModalResult', 'ticketModalMessage'
    ].forEach((id) => { els[id] = document.getElementById(id); });
    els.retryButton.addEventListener('click', () => window.location.reload());
    els.joinMemberButton.addEventListener('click', () => window.MemberSystem.openMemberJoin(state.config));
    els.logoutButton.addEventListener('click', () => window.MemberSystem.logout());
    els.refreshButton.addEventListener('click', () => loadCards(true));
    els.cardTabs.addEventListener('click', (event) => { const tab = event.target instanceof Element ? event.target.closest('[data-card-id]') : null; if (tab) selectCard(tab.dataset.cardId); });
    els.cardTabs.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || !state.cards.length) return;
      event.preventDefault();
      const current = state.cards.findIndex((card) => card.cardId === state.activeCardId);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? state.cards.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + state.cards.length) % state.cards.length;
      const cardId = state.cards[next].cardId;
      selectCard(cardId).then(() => {
        if (state.activeCardId !== cardId) return;
        const tab = Array.from(els.cardTabs.children).find((button) => button.dataset.cardId === cardId);
        if (tab) tab.focus();
      });
    });
    els.ticketList.addEventListener('click', (event) => { const button = event.target instanceof Element ? event.target.closest('[data-use-ticket]') : null; if (button) openTicketModal(button.dataset.useTicket); });
    els.closeTicketModal.addEventListener('click', closeTicketModal);
    els.ticketModal.addEventListener('click', (event) => { if (event.target === els.ticketModal && !state.redeeming) closeTicketModal(); });
    els.confirmTicketUseButton.addEventListener('click', () => { if (state.pendingTicketId) redeemTicket(state.pendingTicketId); });
    els.refreshTicketButton.addEventListener('click', () => window.location.reload());
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !state.redeeming) closeTicketModal(); });
    boot();
  });

  async function boot() {
    setView('loading');
    try {
      startLoginProgress('正在取得開啟設定…', 18);
      state.config = await window.MemberSystem.loadConfig();
      startLoginProgress('正在驗證 LINE 身分…', 48);
      state.idToken = await window.MemberSystem.signIn(state.config, 'points');
      startLoginProgress('正在同步集點卡與票券…', 92);
      await loadCards(false);
      await completeLoginProgress('集點卡資料已準備完成');
      setView('points');
    } catch (error) { stopLoginProgress(); showError(error); } finally { stopLoginProgress(); els.app.setAttribute('aria-busy', 'false'); }
  }

  async function loadCards(showBusy, bypassSnapshot) {
    if (showBusy) { setInlineStatus('正在更新集點卡…'); els.refreshButton.disabled = true; els.refreshButton.textContent = '更新中…'; }
    const requestVersion = (state.loadVersion || 0) + 1;
    state.loadVersion = requestVersion;
    try {
      const cached = bypassSnapshot ? null : await window.MemberSystem.readSyncSnapshot('points');
      const payload = { compact: true, includeActiveCard: true, activeCardId: state.activeCardId };
      if (cached) { payload.knownRevision = cached.revision; payload.knownCacheScope = cached.cacheScope; }
      const result = await window.MemberSystem.request(state.config, 'points', state.idToken, 'user.pointcard.bootstrap', payload);
      if (requestVersion !== state.loadVersion) return;
      if (result.unchanged) {
        const confirmed = cached && cached.cacheScope === result.cacheScope && cached.revision === result.revision ? cached : null;
        if (!confirmed) return loadCards(showBusy, true);
        applyCardsSnapshot(confirmed.payload, result);
      } else {
        applyCardsSnapshot(result, result);
      }
      await ensureActiveCardDetail();
      if (requestVersion !== state.loadVersion) return;
      renderCards();
      if (showBusy) setInlineStatus('集點卡已更新。');
      void persistCardsSnapshot();
    } catch (error) { if (!showBusy) throw error; handleReadError(error); } finally { if (showBusy) { els.refreshButton.disabled = false; els.refreshButton.textContent = '↻ 更新'; } }
  }

  function applyCardsSnapshot(payload, sync) {
    state.bootstrapVersion = String(sync && (sync.revision || sync.version) || '');
    state.cacheScope = String(sync && sync.cacheScope || '');
    state.profile = payload && payload.profile && typeof payload.profile === 'object' ? payload.profile : {};
    state.cards = Array.isArray(payload && payload.cards) ? payload.cards : [];
    state.cardDetails = payload && payload.cardDetails && typeof payload.cardDetails === 'object' ? payload.cardDetails : Object.create(null);
    state.history = Array.isArray(payload && payload.history) ? payload.history : [];
    const historyTotal = Number(payload && payload.historyTotal);
    state.historyTotal = Number.isInteger(historyTotal) && historyTotal >= state.history.length ? historyTotal : state.history.length;
    if (!state.cards.some((card) => card.cardId === state.activeCardId)) state.activeCardId = state.cards[0] ? state.cards[0].cardId : '';
    els.displayName.textContent = String(state.profile.displayName || 'LINE 使用者');
    window.MembershipProgress.render(els.membershipProgress, state.profile);
  }

  function activeCard() {
    const summary = state.cards.find((card) => card.cardId === state.activeCardId) || state.cards[0] || null;
    if (!summary) return null;
    const detail = state.cardDetails[summary.cardId];
    state.tickets = detail && Array.isArray(detail.tickets) ? detail.tickets : [];
    return detail && detail.card ? { ...summary, ...detail.card } : summary;
  }

  async function ensureActiveCardDetail() {
    const cardId = String(state.activeCardId || '');
    if (!cardId || state.cardDetails[cardId]) return;
    const details = state.cardDetails;
    state.detailLoadingCardId = cardId;
    renderCards();
    try {
      const result = await window.MemberSystem.request(state.config, 'points', state.idToken, 'user.pointcard.detail', { cardId });
      if (!result.card || String(result.card.cardId) !== cardId) throw new Error('集點卡明細回應不完整。');
      // 更新或核銷後的快照不得被舊請求覆寫。
      if (details !== state.cardDetails) return;
      details[cardId] = { card: result.card, tickets: Array.isArray(result.tickets) ? result.tickets : [] };
    } finally {
      if (details === state.cardDetails && state.detailLoadingCardId === cardId) state.detailLoadingCardId = '';
    }
  }

  async function selectCard(cardId) {
    const nextCardId = String(cardId || '');
    if (!state.cards.some((card) => card.cardId === nextCardId)) return;
    if (nextCardId === state.activeCardId && state.cardDetails[nextCardId]) return;
    state.activeCardId = nextCardId;
    setInlineStatus('');
    try {
      await ensureActiveCardDetail();
      if (state.activeCardId !== nextCardId) return;
      renderCards();
      void persistCardsSnapshot();
    } catch (error) {
      if (state.activeCardId === nextCardId) { renderCards(); handleReadError(error); }
    }
  }

  function setInlineStatus(message, error = false) {
    const status = document.getElementById('syncNotice');
    status.textContent = message;
    status.classList.toggle('hidden', !message);
    status.classList.toggle('is-error', error);
  }

  function handleReadError(error) {
    if (/^(AUTH_|MEMBERSHIP_REQUIRED|MEMBER_)/.test(String(error && error.code || ''))) return showError(error);
    setInlineStatus('更新失敗，畫面保留上次資料。請按「更新」重試；票券狀態以使用時驗證為準。', true);
  }

  function persistCardsSnapshot() {
    if (!state.bootstrapVersion || !state.cacheScope) return Promise.resolve(false);
    return window.MemberSystem.writeSyncSnapshot('points', state.bootstrapVersion, state.cacheScope, {
      profile: state.profile, cards: state.cards, cardDetails: state.cardDetails, history: state.history, historyTotal: state.historyTotal
    });
  }

  function renderCards() {
    const hasCards = state.cards.length > 0;
    els.emptyView.classList.toggle('hidden', hasCards);
    els.activeCardView.classList.toggle('hidden', !hasCards);
    els.cardTabs.replaceChildren(...state.cards.map((card) => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'card-tab'; button.dataset.cardId = card.cardId; button.dataset.cardStyle = safeCardStyle(card.styleKey); button.setAttribute('role', 'tab'); button.setAttribute('aria-selected', String(card.cardId === state.activeCardId)); button.tabIndex = card.cardId === state.activeCardId ? 0 : -1; button.setAttribute('aria-controls', 'activeCardView'); button.style.setProperty('--card-accent', safeAccent(card.accent)); const title = document.createElement('strong'); title.textContent = String(card.title || '未命名集點卡'); const meta = document.createElement('span'); meta.textContent = `${Number(card.stamps || 0)} 點`; button.append(title, meta); return button;
    }));
    renderHistory();
    if (!hasCards) { els.cardGuidancePanel.classList.add('hidden'); els.ticketList.replaceChildren(); els.ticketSummary.textContent = ''; return; }
    const card = activeCard();
    if (!card) return;
    renderActiveCard(card); renderTickets(card);
  }

  function renderActiveCard(card) {
    const stamps = Math.max(0, Number(card.stamps || 0));
    const ticketOfferCount = Array.isArray(card.rewards) ? ticketOffersForCard(card).length : Math.max(0, Number(card.rewardCount || 0));
    els.activeCardView.dataset.cardStyle = safeCardStyle(card.styleKey);
    els.activeCardView.style.setProperty('--card-accent', safeAccent(card.accent));
    els.activeCardTitle.textContent = String(card.title || '集點卡');
    els.activeCardStatus.textContent = card.expired ? '已超過期限' : card.status === 'archived' ? '已停止集點' : '進行中';
    els.progressCount.textContent = String(stamps);
    els.progressMessage.textContent = card.expired ? '這張集點卡已超過使用期限' : card.status === 'archived' ? '這張卡已停止集點' : '點數會持續累積，達標後系統會將票券放進下方。';
    els.remainingMessage.textContent = ticketOfferCount ? `已設定 ${ticketOfferCount} 種兌換票券` : '尚未設定兌換票券';
    els.cardExpiry.textContent = card.expiryMode === 'date' && card.expiresOn ? `${card.expired ? '已於' : '使用期限至'} ${card.expiresOn}` : '使用期限：無期限';
    renderCardGuidance(card);
  }

  function renderCardGuidance(card) {
    const fields = [[els.cardUsageMethod, card.usageMethod], [els.cardUsageInstructions, card.usageInstructions], [els.cardBenefitDescription, card.benefitDescription]];
    let visibleCount = 0;
    fields.forEach(([output, value]) => { const text = String(value || '').trim(); output.textContent = text; const item = output.closest('[data-card-guidance-item]'); if (item) item.classList.toggle('hidden', !text); if (text) visibleCount += 1; });
    els.cardGuidancePanel.classList.toggle('hidden', visibleCount === 0);
  }

  function renderTickets(card) {
    if (!state.cardDetails[card.cardId]) {
      els.ticketSummary.textContent = state.detailLoadingCardId === card.cardId ? '正在載入這張集點卡的票券明細…' : '明細尚未載入，請再次選取此卡或按「更新」。'; els.ticketEmpty.classList.add('hidden'); els.ticketList.replaceChildren(); return;
    }
    const offers = ticketOffersForCard(card);
    els.ticketSummary.textContent = offers.length ? `共 ${offers.length} 種票券；持續集點即可解鎖，點數足夠即可使用。` : '店家尚未為這張集點卡設定兌換票券。';
    els.ticketEmpty.classList.toggle('hidden', offers.length !== 0);
    els.ticketList.replaceChildren(...offers.map((offer) => createTicketCard(offer)));
  }


  function renderHistory() {
    const history = Array.isArray(state.history) ? state.history.slice().sort((a, b) => String(b.occurredAt || '').localeCompare(String(a.occurredAt || ''))) : [];
    const latestHistory = history.slice(0, 5);
    els.ticketHistorySummary.textContent = state.historyTotal ? `共 ${state.historyTotal} 筆 · 展開查看最新 ${latestHistory.length} 筆` : '尚無使用紀錄';
    els.ticketHistoryEmpty.classList.toggle('hidden', state.historyTotal !== 0);
    els.ticketHistoryList.replaceChildren(...latestHistory.map((activity) => createHistoryCard(activity)));
  }

  function createHistoryCard(activity) {
    const item = document.createElement('li'); item.className = 'ticket-history-item';
    const heading = document.createElement('div'); heading.className = 'ticket-history-heading';
    const titleWrap = document.createElement('div');
    const type = document.createElement('span'); type.className = 'member-ticket-type'; type.textContent = activity.ticketType === 'lottery' ? '抽獎券已使用' : '優惠券已使用';
    const title = document.createElement('h3'); title.textContent = String(activity.ticketTitle || '票券');
    titleWrap.append(type, title);
    const time = document.createElement('time'); time.dateTime = String(activity.occurredAt || ''); time.textContent = activity.occurredAt ? window.MemberSystem.formatDateTime(activity.occurredAt) : '時間未記錄';
    heading.append(titleWrap, time);

    const details = document.createElement('div'); details.className = 'ticket-history-details';
    if (activity.cardTitle) { const card = document.createElement('p'); card.textContent = `集點卡：${activity.cardTitle}`; details.append(card); }
    const points = document.createElement('p'); points.className = 'ticket-history-points'; points.textContent = `本次實際扣除 ${Math.max(0, Number(activity.pointsSpent || 0))} 點`; details.append(points);
    if (activity.ticketType === 'lottery') {
      const result = document.createElement('p'); result.className = 'ticket-history-result'; result.textContent = `本次抽獎結果：${activity.result && activity.result.prizeTitle ? activity.result.prizeTitle : '結果已記錄'}`; details.append(result);
      if (activity.result && activity.result.prizeDescription) { const description = document.createElement('p'); description.textContent = String(activity.result.prizeDescription); details.append(description); }
    } else {
      const result = document.createElement('p'); result.className = 'ticket-history-result'; result.textContent = '票券核銷完成'; details.append(result);
    }
    const reference = document.createElement('small'); reference.className = 'ticket-history-reference'; reference.textContent = `紀錄編號：${String(activity.referenceId || activity.ticketId || '—')}`;
    item.append(heading, details, reference); return item;
  }

  function ticketOffersForCard(card) {
    const stamps = Math.max(0, Number(card.stamps || 0));
    const rewards = Array.isArray(card.rewards) ? card.rewards.slice().sort((a, b) => Number(a.thresholdStamps || 0) - Number(b.thresholdStamps || 0)) : [];
    const tickets = state.tickets.filter((ticket) => ticket.cardId === card.cardId && ticket.status !== 'used');
    return rewards.map((reward) => {
      const thresholdStamps = Math.max(1, Number(reward.thresholdStamps || 0));
      const ticket = tickets.find((item) => Number(item.thresholdStamps || 0) === thresholdStamps) || null;
      const canUse = Boolean(ticket) && !card.expired && card.status === 'active' && stamps >= thresholdStamps;
      const prizeSource = ticket ? ticket.prizes : reward.prizes;
      return {
        ticket,
        thresholdStamps,
        ticketType: String(ticket ? ticket.ticketType : reward.rewardType || 'coupon'),
        ticketTitle: String(ticket ? ticket.ticketTitle : reward.rewardTitle || '票券'),
        ticketDescription: String(ticket ? ticket.ticketDescription : reward.rewardDescription || '達標後即可查看並使用這張票券。'),
        usageMethod: String(ticket ? ticket.usageMethod : reward.usageMethod || '達標後請向店員出示本券'),
        prizes: Array.isArray(prizeSource) ? prizeSource : [],
        canUse,
        unlockShortage: Math.max(0, thresholdStamps - stamps)
      };
    });
  }

  function createTicketCard(offer) {
    const item = document.createElement('article'); item.className = `member-ticket${offer.canUse ? ' is-ready' : ' locked'}`;
    const type = document.createElement('span'); type.className = 'member-ticket-type'; type.textContent = offer.ticketType === 'lottery' ? '抽獎券' : '優惠券';
    const title = document.createElement('h3'); title.textContent = offer.ticketTitle;
    const description = document.createElement('p'); description.textContent = offer.ticketDescription;
    const method = document.createElement('p'); method.className = 'member-ticket-method'; method.textContent = `使用方式：${offer.usageMethod}`;
    const footer = document.createElement('div'); footer.className = 'member-ticket-footer'; const status = document.createElement('span'); status.className = 'ticket-state';
    if (offer.canUse) { status.textContent = `集滿 ${offer.thresholdStamps} 點可使用`; const button = document.createElement('button'); button.type = 'button'; button.className = 'small-ticket-button'; button.dataset.useTicket = offer.ticket.ticketId; button.textContent = '查看並使用'; footer.append(status, button); } else { status.textContent = offer.unlockShortage ? `再集 ${offer.unlockShortage} 點即可解鎖` : '目前無法使用'; footer.append(status); }
    const prizeOpportunities = createLotteryPrizeOpportunities(offer);
    item.append(type, title, description, method); if (prizeOpportunities) item.append(prizeOpportunities); item.append(footer); return item;
  }

  function createLotteryPrizeOpportunities(offer) {
    if (offer.ticketType !== 'lottery' || !Array.isArray(offer.prizes)) return null;
    const prizes = offer.prizes.filter((prize) => String(prize && prize.prizeTitle || '').trim());
    if (!prizes.length) return null;
    const container = document.createElement('div'); container.className = 'lottery-prize-opportunities';
    const label = document.createElement('p'); label.className = 'prize-opportunity-label'; label.textContent = '有機會獲得';
    const list = document.createElement('ul'); list.className = 'prize-opportunities'; list.setAttribute('aria-label', '抽獎可能獲得的獎項');
    prizes.forEach((prize) => { const item = document.createElement('li'); item.className = 'prize-opportunity'; const title = document.createElement('span'); title.textContent = String(prize.prizeTitle || '').trim(); item.append(title); list.append(item); });
    container.append(label, list); return container;
  }

  function openTicketModal(ticketId) {
    const ticket = state.tickets.find((item) => item.ticketId === ticketId); if (!ticket || ticket.status === 'used') return;
    state.pendingTicketId = ticketId; state.redeeming = false; state.ticketModalOpener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    els.ticketModalTicketName.textContent = `${ticket.ticketType === 'lottery' ? '抽獎券' : '優惠券'}｜${ticket.ticketTitle || '票券'}`;
    els.ticketModalDescription.textContent = String(ticket.ticketDescription || '此票券尚未提供額外說明。');
    els.ticketModalUsageMethod.textContent = `使用方式：${ticket.usageMethod || '請向店員出示本券'}`;
    els.ticketModalUsageInstructions.textContent = String(ticket.usageInstructions || '確認使用後，系統會扣除對應點數並將票券標記為已使用。');
    els.ticketModalCost.textContent = `確認使用會扣除 ${Number(ticket.thresholdStamps || 0)} 點，使用後無法復原。`;
    const needsConfirmation = ticketId === state.uncertainTicketId;
    els.confirmTicketUseButton.disabled = needsConfirmation; els.confirmTicketUseButton.textContent = needsConfirmation ? '請重新整理確認' : '確認使用這張票券'; els.confirmTicketUseButton.classList.remove('hidden'); els.refreshTicketButton.classList.toggle('hidden', !needsConfirmation); els.ticketModalResult.replaceChildren(); setTicketProcessing(false);
    if (needsConfirmation) showTicketMessage('無法確認票券是否已使用。請先重新整理確認；在確認前請勿再次使用。'); else hideTicketMessage();
    els.ticketModal.classList.remove('hidden'); (needsConfirmation ? els.refreshTicketButton : els.confirmTicketUseButton).focus();
  }

  function closeTicketModal() { if (state.redeeming) return; state.pendingTicketId = ''; els.ticketModal.classList.add('hidden'); els.ticketModalResult.replaceChildren(); setTicketProcessing(false); hideTicketMessage(); const opener = state.ticketModalOpener; state.ticketModalOpener = null; if (opener instanceof HTMLElement && document.contains(opener)) opener.focus(); }

  async function redeemTicket(ticketId) {
    const ticket = state.tickets.find((item) => item.ticketId === ticketId); if (!ticket || state.redeeming || ticketId === state.uncertainTicketId) return;
    state.redeeming = true; els.confirmTicketUseButton.disabled = true; els.confirmTicketUseButton.textContent = '使用中…'; els.ticketModalCost.textContent = '正在確認票券與可用點數…'; setTicketProcessing(true);
    try {
      const result = await window.MemberSystem.request(state.config, 'points', state.idToken, 'user.pointcard.ticket.redeem', { ticketId });
      const redeemed = result.ticket; state.bootstrapVersion = ''; state.cacheScope = ''; window.MemberSystem.clearSyncSnapshots(); state.tickets = state.tickets.filter((item) => item.ticketId !== ticketId); if (Array.isArray(result.nextTickets)) state.tickets = state.tickets.concat(result.nextTickets); if (state.cardDetails[state.activeCardId]) state.cardDetails[state.activeCardId].tickets = state.tickets; if (result.activity) { const isNewHistory = !state.history.some((item) => item.activityId === result.activity.activityId); state.history = [result.activity].concat(state.history.filter((item) => item.activityId !== result.activity.activityId)).slice(0, 5); if (isNewHistory) state.historyTotal += 1; } if (result.balance) updateCardBalance(result.balance); renderCards(); setTicketProcessing(false); await showRedeemedTicket(redeemed); state.pendingTicketId = '';
    } catch (error) {
      setTicketProcessing(false);
      const responseUncertain = error && error.code === 'API_RESPONSE_UNCERTAIN';
      if (responseUncertain) state.uncertainTicketId = ticketId;
      showTicketMessage(responseUncertain ? '無法確認票券是否已使用。請先重新整理確認；在確認前請勿再次使用。' : error && error.message || '票券使用失敗，請稍後再試。');
      els.confirmTicketUseButton.disabled = responseUncertain;
      els.confirmTicketUseButton.textContent = responseUncertain ? '請重新整理確認' : '重新確認使用';
      els.refreshTicketButton.classList.toggle('hidden', !responseUncertain);
    } finally { setTicketProcessing(false); state.redeeming = false; }
  }

  async function showRedeemedTicket(ticket) {
    els.confirmTicketUseButton.classList.add('hidden');
    if (ticket.ticketType === 'lottery') {
      els.ticketModalCost.textContent = '開獎中，請稍候…'; const reveal = document.createElement('div'); reveal.className = 'lottery-reveal'; reveal.textContent = '✦ 抽獎中 ✦'; els.ticketModalResult.replaceChildren(reveal); await new Promise((resolve) => window.setTimeout(resolve, 1350)); const result = ticket.result; els.ticketModalCost.textContent = `開獎完成；本次已扣除 ${Math.max(0, Number(ticket.thresholdStamps || 0))} 點。`; const resultBox = document.createElement('div'); resultBox.className = 'lottery-result'; const label = document.createElement('span'); label.textContent = '本次抽獎結果'; const title = document.createElement('strong'); title.textContent = result && result.prizeTitle || '本次抽獎結果已記錄'; resultBox.append(label, title); if (result && result.prizeDescription) { const description = document.createElement('p'); description.textContent = result.prizeDescription; resultBox.append(description); } els.ticketModalResult.replaceChildren(resultBox);
    } else { els.ticketModalCost.textContent = `核銷完成；本次已扣除 ${Math.max(0, Number(ticket.thresholdStamps || 0))} 點，請向店員兌換。`; const resultBox = document.createElement('div'); resultBox.className = 'ticket-success'; resultBox.textContent = '這張票券已成功使用。'; els.ticketModalResult.replaceChildren(resultBox); }
    showTicketMessage('票券已完成核銷；票券結果與實際扣點已保存到使用紀錄。', true);
  }

  function updateCardBalance(balance) { const cardId = String(balance.cardId || ''); const stamps = Number(balance.stamps || 0); const updatedAt = String(balance.updatedAt || ''); state.cards = state.cards.map((card) => card.cardId === cardId ? { ...card, stamps: Math.max(0, stamps), updatedAt: updatedAt || card.updatedAt || '' } : card); if (state.cardDetails[cardId] && state.cardDetails[cardId].card) state.cardDetails[cardId].card = { ...state.cardDetails[cardId].card, stamps: Math.max(0, stamps), updatedAt: updatedAt || state.cardDetails[cardId].card.updatedAt || '' }; }
  function setTicketProcessing(processing) { els.ticketModalProcessing.classList.toggle('hidden', !processing); els.ticketModal.setAttribute('aria-busy', String(Boolean(processing))); }
  function showTicketMessage(message, success) { els.ticketModalMessage.textContent = message; els.ticketModalMessage.classList.toggle('success', Boolean(success)); els.ticketModalMessage.classList.remove('hidden'); }
  function hideTicketMessage() { els.ticketModalMessage.textContent = ''; els.ticketModalMessage.classList.add('hidden'); els.ticketModalMessage.classList.remove('success'); }
  function safeAccent(value) { return /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value) : '#e47845'; }
  function safeCardStyle(value) { const styleKey = String(value || '').trim().toLowerCase(); return POINT_CARD_STYLE_KEYS.includes(styleKey) ? styleKey : 'forest'; }
  function setView(view) { els.loadingView.classList.toggle('hidden', view !== 'loading'); els.errorView.classList.toggle('hidden', view !== 'error'); els.pointsView.classList.toggle('hidden', view !== 'points'); }
  function startLoginProgress(status, ceiling) { stopLoginProgress(); const maximum = Math.max(loginProgressValue, Math.min(98, Number(ceiling) || loginProgressValue)); setLoginProgress(loginProgressValue, status); loginProgressTimer = window.setInterval(() => { const remaining = maximum - loginProgressValue; if (remaining <= 0) return stopLoginProgress(); setLoginProgress(Math.min(maximum, loginProgressValue + Math.max(1, Math.ceil(remaining * .12))), status); }, LOGIN_PROGRESS_TICK_MS); }
  function stopLoginProgress() { if (loginProgressTimer !== null) window.clearInterval(loginProgressTimer); loginProgressTimer = null; }
  function completeLoginProgress(status) {
    stopLoginProgress();
    // 資料就緒便交還操作，不讓裝飾性動畫阻塞主要畫面。
    setLoginProgress(100, status);
    return Promise.resolve();
  }

  function setLoginProgress(value, status) { const progress = Math.max(loginProgressValue, Math.max(0, Math.min(100, Math.round(Number(value) || 0)))); loginProgressValue = progress; els.loadingProgress.setAttribute('aria-valuenow', String(progress)); els.loadingProgress.setAttribute('aria-valuetext', `${progress}%`); els.loadingProgressBar.style.width = `${progress}%`; els.loadingProgressText.textContent = `${progress}%`; if (status) els.loadingStatus.textContent = status; }
  function showError(error) { const membershipRequired = error && error.code === 'MEMBERSHIP_REQUIRED'; els.errorTitle.textContent = error && error.code === 'CONFIG_ERROR' ? '系統尚未完成設定' : membershipRequired ? '請先加入會員' : '集點卡暫時無法載入'; els.errorMessage.textContent = membershipRequired ? '加入會員並完成會員資料後，才能使用集點卡與票券功能。' : error && error.message ? error.message : '請稍後重新整理再試。'; els.joinMemberButton.classList.toggle('hidden', !membershipRequired); els.retryButton.classList.toggle('hidden', membershipRequired); setView('error'); }
})();

