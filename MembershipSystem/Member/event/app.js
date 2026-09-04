(() => {
  'use strict';

  const state = { config: null, idToken: '', offers: [], usedTickets: [], pendingEventTicketId: '', processing: false, actionLocked: false, uncertainEventTicketId: '' };
  const els = {};

  window.addEventListener('DOMContentLoaded', () => {
    [
      'app', 'loadingView', 'errorView', 'errorTitle', 'errorMessage', 'retryButton', 'eventView', 'displayName', 'memberTier', 'logoutButton', 'refreshButton', 'eventSummary', 'eventList', 'emptyView', 'usedTicketHistory', 'usedTicketList',
      'ticketModal', 'closeTicketModal', 'ticketModalType', 'ticketModalTitle', 'ticketModalDate', 'ticketModalDescription', 'ticketModalUsageMethod', 'ticketModalUsageInstructions', 'ticketModalPrizes', 'ticketModalStatus', 'ticketModalProcessing', 'ticketModalProcessingText', 'ticketModalResult', 'ticketModalAction', 'refreshTicketButton', 'ticketModalMessage'
    ].forEach((id) => { els[id] = document.getElementById(id); });
    els.retryButton.addEventListener('click', () => window.location.reload());
    els.logoutButton.addEventListener('click', () => window.MemberSystem.logout());
    els.refreshButton.addEventListener('click', () => loadOffers(true));
    els.closeTicketModal.addEventListener('click', closeTicketModal);
    els.ticketModal.addEventListener('click', (event) => { if (event.target === els.ticketModal && !state.processing) closeTicketModal(); });
    els.ticketModalAction.addEventListener('click', handleTicketAction);
    els.refreshTicketButton.addEventListener('click', () => window.location.reload());
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !state.processing) closeTicketModal(); });
    boot();
  });

  async function boot() {
    setView('loading');
    try {
      state.config = await window.MemberSystem.loadConfig();
      state.idToken = await window.MemberSystem.signIn(state.config, 'event');
      await loadOffers(false);
      setView('event');
    } catch (error) { showError(error); } finally { els.app.setAttribute('aria-busy', 'false'); }
  }

  async function loadOffers(showBusy) {
    if (showBusy) { els.refreshButton.disabled = true; els.refreshButton.textContent = '更新中…'; }
    try {
      const result = await window.MemberSystem.request(state.config, 'event', state.idToken, 'user.event.bootstrap');
      state.offers = Array.isArray(result.offers) ? result.offers : [];
      state.usedTickets = Array.isArray(result.usedTickets) ? result.usedTickets : [];
      els.displayName.textContent = String(result.profile && result.profile.displayName || 'LINE 使用者');
      els.memberTier.textContent = `目前會員等級：${String(result.profile && result.profile.tier || '未設定')}`;
      renderOffers();
    } catch (error) { if (!showBusy) throw error; showError(error); } finally { if (showBusy) { els.refreshButton.disabled = false; els.refreshButton.textContent = '↻ 更新'; } }
  }

  function renderOffers() {
    const hasOffers = state.offers.length > 0;
    const hasUsedTickets = state.usedTickets.length > 0;
    const ineligibleOfferCount = state.offers.filter((offer) => !eventTicketTierEligible(offer)).length;
    els.eventList.replaceChildren(...state.offers.map(createOfferCard));
    els.usedTicketList.replaceChildren(...state.usedTickets.map(createOfferCard));
    els.emptyView.classList.toggle('hidden', hasOffers);
    els.usedTicketHistory.classList.toggle('hidden', !hasUsedTickets);
    els.eventSummary.textContent = hasOffers ? `${state.offers.length} 個活動票券 · 領取後由本人使用${ineligibleOfferCount ? ` · ${ineligibleOfferCount} 張尚未達適用等級` : ''}${hasUsedTickets ? ` · ${state.usedTickets.length} 筆已使用紀錄` : ''}` : hasUsedTickets ? `目前沒有開放中的活動 · ${state.usedTickets.length} 筆已使用紀錄` : '目前沒有開放中的活動';
  }

  function createOfferCard(offer) {
    const ticket = ticketForOffer(offer); const history = Boolean(offer.history);
    const eligible = !history && eventTicketTierEligible(offer); const stateLabel = history ? '已使用' : eligible ? availabilityLabel(offer.availability) : '等級不適用';
    const item = document.createElement('article'); item.className = `event-ticket${history ? ' used-ticket' : ''}`; item.style.setProperty('--ticket-accent', safeAccent(ticket.accent));
    const head = document.createElement('div'); head.className = 'event-ticket-head'; const type = document.createElement('span'); type.className = 'event-ticket-type'; type.textContent = ticket.ticketType === 'lottery' ? '活動抽獎券' : '活動優惠券'; const stateBadge = document.createElement('span'); stateBadge.className = `event-ticket-state ${history ? 'used' : eligible ? offer.availability : 'tier-locked'}`; stateBadge.textContent = stateLabel; head.append(type, stateBadge);
    const title = document.createElement('h3'); title.textContent = String(ticket.title || '活動票券');
    const description = document.createElement('p'); description.className = 'event-ticket-description'; description.textContent = String(ticket.description || '查看活動內容與使用說明。');
    const meta = document.createElement('div'); meta.className = 'event-ticket-meta'; const date = document.createElement('span'); const dateLabel = document.createElement('strong'); dateLabel.textContent = history ? '使用時間' : '活動期間'; date.append(dateLabel, document.createTextNode(`　${history ? eventTicketTimestamp(offer.claim && offer.claim.usedAt) : eventDates(ticket)}`)); meta.append(date); if (!history) { const quota = document.createElement('span'); const quotaLabel = document.createElement('strong'); quotaLabel.textContent = '領取方式'; quota.append(quotaLabel, document.createTextNode('　每位會員限領 1 張')); const tiers = document.createElement('span'); const tierLabel = document.createElement('strong'); tierLabel.textContent = '適用等級'; tiers.append(tierLabel, document.createTextNode(`　${eventTicketAllowedTiers(ticket)}`)); meta.append(quota, tiers); }
    const eventTicketId = eventTicketIdForOffer(offer); const action = document.createElement('div'); action.className = 'event-ticket-action'; const hint = document.createElement('small'); hint.textContent = history ? '票券內容與核銷結果已保留' : !eligible ? '目前會員等級無法領取或使用' : offer.claim ? claimLabel(offer.claim.status) : offer.soldOut ? '名額已滿' : offer.availability === 'scheduled' ? '活動開始後即可領取' : offer.availability === 'ended' ? '活動已結束' : '點開查看完整說明'; const button = document.createElement('button'); button.type = 'button'; button.className = `ticket-button${!history && (offer.canClaim || offer.canUse) ? ' accent' : ''}`; button.dataset.eventTicketId = eventTicketId; button.textContent = history ? '查看紀錄' : !eligible ? '查看詳情' : offer.claim ? offer.canUse ? '查看並使用' : '已使用' : offer.canClaim ? '領取票券' : '查看詳情'; button.disabled = !eventTicketId || (!history && Boolean(offer.claim && !offer.canUse && eligible)); button.addEventListener('click', () => openTicketModal(eventTicketId)); action.append(hint, button);
    item.append(head, title, description, meta, action); return item;
  }

  function openTicketModal(eventTicketId) {
    const targetId = String(eventTicketId || '').trim(); const offer = findOffer(targetId); if (!offer) return;
    state.pendingEventTicketId = targetId; state.processing = false; state.actionLocked = targetId === String(state.uncertainEventTicketId || '').trim();
    els.ticketModalResult.classList.add('hidden'); els.ticketModalResult.replaceChildren(); renderTicketModal(offer); if (state.actionLocked) showMessage('無法確認這次操作是否完成。請先重新整理確認；在確認前請勿再次送出。'); else hideMessage(); setProcessing(false); els.ticketModal.classList.remove('hidden'); (offer.history ? els.closeTicketModal : state.actionLocked ? els.refreshTicketButton : els.ticketModalAction).focus();
  }

  function renderTicketModal(offer) {
    const ticket = ticketForOffer(offer); const claim = offer.claim; const history = Boolean(offer.history);
    els.ticketModalType.textContent = ticket.ticketType === 'lottery' ? '活動抽獎券' : '活動優惠券'; els.ticketModalTitle.textContent = String(ticket.title || '活動票券'); els.ticketModalDate.textContent = history ? `已使用：${eventTicketTimestamp(claim && claim.usedAt)}` : eventDates(ticket); els.ticketModalDescription.textContent = String(claim ? claim.ticketDescription : ticket.description || '查看活動內容與使用說明。'); els.ticketModalUsageMethod.textContent = `使用方式：${String(claim ? claim.usageMethod : ticket.usageMethod || '請依活動現場指示使用')}`; els.ticketModalUsageInstructions.textContent = String(claim ? claim.usageInstructions : ticket.usageInstructions || '領取後請在活動期間出示本券。');
    const prizes = claim ? claim.prizes : ticket.prizes; renderPrizes(ticket.ticketType, prizes);
    const eligible = !history && eventTicketTierEligible(offer); const canAct = !state.actionLocked && !history && eligible && ((claim && offer.canUse) || (!claim && offer.canClaim));
    els.ticketModalStatus.textContent = modalStatusText(offer); els.ticketModalAction.textContent = state.actionLocked ? '請重新整理確認' : history ? '這張票券已使用' : !eligible ? '目前等級無法使用' : claim ? offer.canUse ? '確認使用這張票券' : '這張票券已使用' : offer.canClaim ? '領取活動票券' : '目前無法領取'; els.ticketModalAction.disabled = !canAct; els.ticketModalAction.classList.toggle('hidden', history || Boolean(claim && !offer.canUse && eligible) && !state.actionLocked); els.refreshTicketButton.classList.toggle('hidden', !state.actionLocked);
    if (history && claim && claim.ticketType === 'lottery' && claim.result) showRedeemedResult(claim);
  }

  function renderPrizes(ticketType, prizes) {
    if (ticketType !== 'lottery' || !Array.isArray(prizes) || !prizes.length) { els.ticketModalPrizes.classList.add('hidden'); els.ticketModalPrizes.replaceChildren(); return; }
    const heading = document.createElement('strong'); heading.textContent = '有機會獲得'; const list = document.createElement('ul'); prizes.filter((prize) => String(prize && prize.prizeTitle || '').trim()).forEach((prize) => { const item = document.createElement('li'); item.textContent = String(prize.prizeTitle || '').trim(); list.append(item); }); els.ticketModalPrizes.replaceChildren(heading, list); els.ticketModalPrizes.classList.toggle('hidden', !list.children.length);
  }

  function closeTicketModal() { if (state.processing) return; state.pendingEventTicketId = ''; els.ticketModal.classList.add('hidden'); setProcessing(false); hideMessage(); els.ticketModalResult.classList.add('hidden'); els.ticketModalResult.replaceChildren(); }

  async function handleTicketAction() {
    const offer = findOffer(state.pendingEventTicketId); if (!offer || state.processing || state.actionLocked) return;
    if (offer.history) return;
    if (!eventTicketTierEligible(offer)) return;
    if (offer.claim) return redeemTicket(offer);
    return claimTicket(offer);
  }

  async function claimTicket(offer) {
    state.processing = true; els.ticketModalAction.disabled = true; els.ticketModalAction.textContent = '領取中…'; els.ticketModalProcessingText.textContent = '正在確認活動名額，請稍候…'; setProcessing(true); hideMessage();
    try {
      const result = await window.MemberSystem.request(state.config, 'event', state.idToken, 'user.event.ticket.claim', { eventTicketId: offer.ticket.eventTicketId });
      if (result.ticket) { updateOfferClaim(offer.ticket.eventTicketId, result.ticket); renderOffers(); renderTicketModal(findOffer(offer.ticket.eventTicketId)); showMessage(result.alreadyClaimed ? '你已經領取過這張活動票券。' : '活動票券已領取，請在活動期間使用。', true); }
    } catch (error) { handleTicketError(error, '領取票券失敗，請稍後再試。'); } finally { setProcessing(false); state.processing = false; const current = findOffer(offer.ticket.eventTicketId); if (current) renderTicketModal(current); }
  }

  async function redeemTicket(offer) {
    state.processing = true; els.ticketModalAction.disabled = true; els.ticketModalAction.textContent = '使用中…'; els.ticketModalProcessingText.textContent = '正在確認票券與活動期限，請稍候…'; setProcessing(true); hideMessage();
    try {
      const result = await window.MemberSystem.request(state.config, 'event', state.idToken, 'user.event.ticket.redeem', { claimId: offer.claim.claimId });
      if (result.ticket) { updateOfferClaim(offer.ticket.eventTicketId, result.ticket); renderOffers(); setProcessing(false); showRedeemedResult(result.ticket); }
    } catch (error) { handleTicketError(error, '使用票券失敗，請稍後再試。'); } finally { setProcessing(false); state.processing = false; }
  }

  function showRedeemedResult(claim) { els.ticketModalAction.classList.add('hidden'); els.ticketModalResult.classList.remove('hidden'); els.ticketModalResult.textContent = claim.ticketType === 'lottery' && claim.result ? `抽獎完成：${claim.result.prizeTitle || '結果已記錄'}${claim.result.prizeDescription ? `｜${claim.result.prizeDescription}` : ''}` : '這張活動票券已成功使用，請向現場工作人員兌換。'; showMessage('票券已完成核銷。', true); }
  function updateOfferClaim(eventTicketId, claim) { const current = findOffer(eventTicketId); if (String(claim.status || '') === 'used') { state.offers = state.offers.filter((offer) => offer.ticket && offer.ticket.eventTicketId !== eventTicketId); const historyTicket = { ...(current || {}), ticket: ticketForOffer({ ...(current || {}), claim }), claim, availability: 'used', tierEligible: true, canClaim: false, canUse: false, soldOut: false, history: true }; state.usedTickets = [historyTicket, ...state.usedTickets.filter((offer) => !offer.ticket || offer.ticket.eventTicketId !== eventTicketId)]; return; } state.offers = state.offers.map((offer) => offer.ticket && offer.ticket.eventTicketId === eventTicketId ? { ...offer, claim, canClaim: false, canUse: eventTicketTierEligible(offer) && claim.status === 'available', soldOut: false } : offer); }
  function eventTicketIdForOffer(offer) { const ticket = offer && offer.ticket || {}; const claim = offer && offer.claim || {}; return String(ticket.eventTicketId || claim.eventTicketId || '').trim(); }
  function findOffer(eventTicketId) { const targetId = String(eventTicketId || '').trim(); if (!targetId) return null; return state.offers.concat(state.usedTickets).find((offer) => eventTicketIdForOffer(offer) === targetId) || null; }
  function ticketForOffer(offer) { const ticket = offer && offer.ticket || {}; const claim = offer && offer.claim; if (!claim) return ticket; return { ...ticket, title: String(claim.ticketTitle || ticket.title || ''), ticketType: claim.ticketType || ticket.ticketType, description: String(claim.ticketDescription || ticket.description || ''), usageMethod: String(claim.usageMethod || ticket.usageMethod || ''), usageInstructions: String(claim.usageInstructions || ticket.usageInstructions || ''), prizes: Array.isArray(claim.prizes) ? claim.prizes : ticket.prizes }; }
  function modalStatusText(offer) { if (offer.history) return `這張票券已於 ${eventTicketTimestamp(offer.claim && offer.claim.usedAt)} 使用；內容與結果會保留在此紀錄。`; if (!eventTicketTierEligible(offer)) return `這張票券只適用於${eventTicketAllowedTiers(ticketForOffer(offer))}；目前會員等級無法領取或使用。`; if (offer.claim) return offer.canUse ? '你已領取這張票券；確認使用後，票券會立即完成核銷。' : '這張票券已使用。'; if (offer.soldOut) return '這張活動票券已達發放上限。'; if (offer.availability === 'scheduled') return '活動尚未開始，開始後即可領取。'; if (offer.availability === 'ended') return '活動已結束，這張票券目前無法領取。'; return '領取後票券會綁定你的 LINE 會員，且每位會員限領一次。'; }
  function claimLabel(status) { return status === 'used' ? '已使用' : '已領取，可使用'; }
  function eventTicketTierEligible(offer) { return offer && offer.tierEligible !== false; }
  function eventTicketAllowedTiers(ticket) { const labels = ticket && ticket.allowedTierLabels; return Array.isArray(labels) && labels.length ? labels.join('、') : '全部會員等級'; }
  function availabilityLabel(value) { return ({ open: '進行中', scheduled: '即將開始', ended: '已結束' })[value] || '活動票券'; }
  function eventDates(ticket) { const starts = ticket.startsOn || '即日起'; const ends = ticket.endsOn || '不限期'; return `${starts} — ${ends}`; }
  function eventTicketTimestamp(value) { const timestamp = String(value || '').trim(); if (!timestamp) return '時間已記錄'; const date = new Date(timestamp); if (Number.isNaN(date.getTime())) return timestamp; return new Intl.DateTimeFormat('zh-Hant-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date); }
  function setProcessing(processing) { els.ticketModalProcessing.classList.toggle('hidden', !processing); els.ticketModal.setAttribute('aria-busy', String(Boolean(processing))); }
  function showMessage(message, success) { els.ticketModalMessage.textContent = message; els.ticketModalMessage.classList.toggle('success', Boolean(success)); els.ticketModalMessage.classList.remove('hidden'); }
  function hideMessage() { els.ticketModalMessage.textContent = ''; els.ticketModalMessage.classList.add('hidden'); els.ticketModalMessage.classList.remove('success'); }
  function handleTicketError(error, fallback) { const uncertain = error && error.code === 'API_RESPONSE_UNCERTAIN'; if (uncertain) state.uncertainEventTicketId = state.pendingEventTicketId; showMessage(uncertain ? '無法確認這次操作是否完成。請先重新整理確認；在確認前請勿再次送出。' : error && error.message || fallback, false); state.actionLocked = uncertain; els.ticketModalAction.disabled = true; els.refreshTicketButton.classList.toggle('hidden', !uncertain); }
  function safeAccent(value) { return /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value) : '#d86e50'; }
  function setView(view) { els.loadingView.classList.toggle('hidden', view !== 'loading'); els.errorView.classList.toggle('hidden', view !== 'error'); els.eventView.classList.toggle('hidden', view !== 'event'); }
  function showError(error) { els.errorTitle.textContent = error && error.code === 'CONFIG_ERROR' ? '系統尚未完成設定' : '活動票券暫時無法載入'; els.errorMessage.textContent = error && error.message ? error.message : '請稍後重新整理再試。'; setView('error'); }
})();
