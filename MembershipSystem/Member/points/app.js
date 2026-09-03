(() => {
  'use strict';

  const state = { config: null, idToken: '', cards: [], tickets: [], activeCardId: '', pendingTicketId: '', redeeming: false };
  const els = {};

  window.addEventListener('DOMContentLoaded', () => {
    [
      'app', 'loadingView', 'errorView', 'errorTitle', 'errorMessage', 'retryButton', 'pointsView', 'displayName', 'logoutButton', 'refreshButton', 'cardTabs', 'emptyView', 'activeCardView', 'activeCardTitle', 'activeCardDescription', 'activeCardStatus', 'progressCount', 'progressMessage', 'remainingMessage', 'rewardTitle', 'cardExpiry', 'updatedAt', 'ticketSummary', 'ticketList', 'ticketEmpty',
      'ticketModal', 'closeTicketModal', 'ticketModalTicketName', 'ticketModalDescription', 'ticketModalUsageMethod', 'ticketModalUsageInstructions', 'ticketModalCost', 'confirmTicketUseButton', 'ticketModalResult', 'ticketModalMessage'
    ].forEach((id) => { els[id] = document.getElementById(id); });
    els.retryButton.addEventListener('click', () => window.location.reload());
    els.logoutButton.addEventListener('click', () => window.MemberSystem.logout());
    els.refreshButton.addEventListener('click', () => loadCards(true));
    els.cardTabs.addEventListener('click', (event) => { const tab = event.target instanceof Element ? event.target.closest('[data-card-id]') : null; if (tab) { state.activeCardId = tab.dataset.cardId; renderCards(); } });
    els.ticketList.addEventListener('click', (event) => { const button = event.target instanceof Element ? event.target.closest('[data-use-ticket]') : null; if (button) openTicketModal(button.dataset.useTicket); });
    els.closeTicketModal.addEventListener('click', closeTicketModal);
    els.ticketModal.addEventListener('click', (event) => { if (event.target === els.ticketModal && !state.redeeming) closeTicketModal(); });
    els.confirmTicketUseButton.addEventListener('click', () => { if (state.pendingTicketId) redeemTicket(state.pendingTicketId); });
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !state.redeeming) closeTicketModal(); });
    boot();
  });

  async function boot() {
    setView('loading');
    try {
      state.config = await window.MemberSystem.loadConfig();
      state.idToken = await window.MemberSystem.signIn(state.config, 'points');
      await loadCards(false);
      setView('points');
    } catch (error) { showError(error); } finally { els.app.setAttribute('aria-busy', 'false'); }
  }

  async function loadCards(showBusy) {
    if (showBusy) { els.refreshButton.disabled = true; els.refreshButton.textContent = '更新中…'; }
    try {
      const result = await window.MemberSystem.request(state.config, 'points', state.idToken, 'user.pointcard.bootstrap');
      state.cards = Array.isArray(result.cards) ? result.cards : [];
      state.tickets = Array.isArray(result.tickets) ? result.tickets : [];
      els.displayName.textContent = String(result.profile && result.profile.displayName || 'LINE 使用者');
      if (!state.cards.some((card) => card.cardId === state.activeCardId)) state.activeCardId = state.cards[0] ? state.cards[0].cardId : '';
      renderCards();
    } catch (error) { if (!showBusy) throw error; showError(error); } finally { if (showBusy) { els.refreshButton.disabled = false; els.refreshButton.textContent = '↻ 更新'; } }
  }

  function renderCards() {
    const hasCards = state.cards.length > 0;
    els.emptyView.classList.toggle('hidden', hasCards);
    els.activeCardView.classList.toggle('hidden', !hasCards);
    els.cardTabs.replaceChildren(...state.cards.map((card) => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'card-tab'; button.dataset.cardId = card.cardId; button.setAttribute('role', 'tab'); button.setAttribute('aria-selected', String(card.cardId === state.activeCardId)); button.style.setProperty('--card-accent', safeAccent(card.accent)); const title = document.createElement('strong'); title.textContent = String(card.title || '未命名集點卡'); const meta = document.createElement('span'); meta.textContent = `${Number(card.stamps || 0)} 點`; button.append(title, meta); return button;
    }));
    if (!hasCards) { els.ticketList.replaceChildren(); els.ticketSummary.textContent = ''; return; }
    const card = state.cards.find((item) => item.cardId === state.activeCardId) || state.cards[0];
    renderActiveCard(card); renderTickets(card);
  }

  function renderActiveCard(card) {
    const stamps = Math.max(0, Number(card.stamps || 0));
    const ticketOfferCount = ticketOffersForCard(card).length;
    els.activeCardView.style.setProperty('--card-accent', safeAccent(card.accent));
    els.activeCardTitle.textContent = String(card.title || '集點卡');
    els.activeCardDescription.textContent = String(card.description || '每次消費後由店家為你累積點數。');
    els.activeCardStatus.textContent = card.expired ? '已超過期限' : card.status === 'archived' ? '已停止集點' : '進行中';
    els.progressCount.textContent = String(stamps);
    els.progressMessage.textContent = card.expired ? '這張集點卡已超過使用期限' : card.status === 'archived' ? '這張卡已停止集點' : '點數會持續累積，達標後系統會將票券放進下方。';
    els.remainingMessage.textContent = ticketOfferCount ? `已設定 ${ticketOfferCount} 種兌換票券` : '尚未設定兌換票券';
    els.rewardTitle.textContent = '票券總覽';
    els.cardExpiry.textContent = card.expiryMode === 'date' && card.expiresOn ? `${card.expired ? '已於' : '使用期限至'} ${card.expiresOn}` : '使用期限：無期限';
    els.updatedAt.textContent = card.updatedAt ? `更新於 ${window.MemberSystem.formatDateTime(card.updatedAt)}` : '尚未更新';
  }

  function renderTickets(card) {
    const offers = ticketOffersForCard(card);
    els.ticketSummary.textContent = offers.length ? `共 ${offers.length} 種票券；持續集點即可解鎖，點數足夠即可使用。` : '店家尚未為這張集點卡設定兌換票券。';
    els.ticketEmpty.classList.toggle('hidden', offers.length !== 0);
    els.ticketList.replaceChildren(...offers.map((offer) => createTicketCard(offer)));
  }

  function ticketOffersForCard(card) {
    const stamps = Math.max(0, Number(card.stamps || 0));
    const rewards = Array.isArray(card.rewards) ? card.rewards.slice().sort((a, b) => Number(a.thresholdStamps || 0) - Number(b.thresholdStamps || 0)) : [];
    const tickets = state.tickets.filter((ticket) => ticket.cardId === card.cardId && ticket.status !== 'used');
    return rewards.map((reward) => {
      const thresholdStamps = Math.max(1, Number(reward.thresholdStamps || 0));
      const ticket = tickets.find((item) => Number(item.thresholdStamps || 0) === thresholdStamps) || null;
      const consumeStamps = Math.max(1, Number(ticket ? ticket.consumeStamps : reward.consumeStamps || thresholdStamps));
      const canUse = Boolean(ticket) && !card.expired && card.status === 'active' && stamps >= consumeStamps;
      return {
        ticket,
        thresholdStamps,
        consumeStamps,
        ticketType: String(ticket ? ticket.ticketType : reward.rewardType || 'coupon'),
        ticketTitle: String(ticket ? ticket.ticketTitle : reward.rewardTitle || '票券'),
        ticketDescription: String(ticket ? ticket.ticketDescription : reward.rewardDescription || '達標後即可查看並使用這張票券。'),
        usageMethod: String(ticket ? ticket.usageMethod : reward.usageMethod || '達標後請向店員出示本券'),
        canUse,
        unlockShortage: Math.max(0, thresholdStamps - stamps),
        useShortage: Math.max(0, consumeStamps - stamps)
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
    if (offer.canUse) { status.textContent = `使用會扣除 ${offer.consumeStamps} 點`; const button = document.createElement('button'); button.type = 'button'; button.className = 'small-ticket-button'; button.dataset.useTicket = offer.ticket.ticketId; button.textContent = '查看並使用'; footer.append(status, button); } else { status.textContent = offer.unlockShortage ? `再集 ${offer.unlockShortage} 點即可解鎖` : offer.useShortage ? `再集 ${offer.useShortage} 點即可使用` : '目前無法使用'; footer.append(status); }
    item.append(type, title, description, method, footer); return item;
  }

  function openTicketModal(ticketId) {
    const ticket = state.tickets.find((item) => item.ticketId === ticketId); if (!ticket || ticket.status === 'used') return;
    state.pendingTicketId = ticketId; state.redeeming = false;
    els.ticketModalTicketName.textContent = `${ticket.ticketType === 'lottery' ? '抽獎券' : '優惠券'}｜${ticket.ticketTitle || '票券'}`;
    els.ticketModalDescription.textContent = String(ticket.ticketDescription || '此票券尚未提供額外說明。');
    els.ticketModalUsageMethod.textContent = `使用方式：${ticket.usageMethod || '請向店員出示本券'}`;
    els.ticketModalUsageInstructions.textContent = String(ticket.usageInstructions || '確認使用後，系統會扣除對應點數並將票券標記為已使用。');
    els.ticketModalCost.textContent = `確認使用會扣除 ${Number(ticket.consumeStamps || 0)} 點，使用後無法復原。`;
    els.confirmTicketUseButton.disabled = false; els.confirmTicketUseButton.textContent = '確認使用這張票券'; els.confirmTicketUseButton.classList.remove('hidden'); els.ticketModalResult.replaceChildren(); hideTicketMessage(); els.ticketModal.classList.remove('hidden'); els.confirmTicketUseButton.focus();
  }

  function closeTicketModal() { if (state.redeeming) return; state.pendingTicketId = ''; els.ticketModal.classList.add('hidden'); els.ticketModalResult.replaceChildren(); hideTicketMessage(); }

  async function redeemTicket(ticketId) {
    const ticket = state.tickets.find((item) => item.ticketId === ticketId); if (!ticket || state.redeeming) return;
    state.redeeming = true; els.confirmTicketUseButton.disabled = true; els.confirmTicketUseButton.textContent = '使用中…'; els.ticketModalCost.textContent = '正在確認票券與可用點數…';
    try {
      const result = await window.MemberSystem.request(state.config, 'points', state.idToken, 'user.pointcard.ticket.redeem', { ticketId });
      const redeemed = result.ticket; state.tickets = state.tickets.filter((item) => item.ticketId !== ticketId); if (Array.isArray(result.nextTickets)) state.tickets = state.tickets.concat(result.nextTickets); if (result.balance) updateCardBalance(result.balance); renderCards(); await showRedeemedTicket(redeemed); state.pendingTicketId = '';
    } catch (error) {
      const responseUncertain = error && error.code === 'API_RESPONSE_UNCERTAIN';
      showTicketMessage(responseUncertain ? '無法確認票券是否已使用；請重新整理確認，請勿再次使用。' : error && error.message || '票券使用失敗，請稍後再試。');
      els.confirmTicketUseButton.disabled = responseUncertain;
      els.confirmTicketUseButton.textContent = responseUncertain ? '請重新整理確認' : '重新確認使用';
    } finally { state.redeeming = false; }
  }

  async function showRedeemedTicket(ticket) {
    els.confirmTicketUseButton.classList.add('hidden');
    if (ticket.ticketType === 'lottery') {
      els.ticketModalCost.textContent = '開獎中，請稍候…'; const reveal = document.createElement('div'); reveal.className = 'lottery-reveal'; reveal.textContent = '✦ 抽獎中 ✦'; els.ticketModalResult.replaceChildren(reveal); await new Promise((resolve) => window.setTimeout(resolve, 1350)); const result = ticket.result; els.ticketModalCost.textContent = '開獎完成'; const resultBox = document.createElement('div'); resultBox.className = 'lottery-result'; const label = document.createElement('span'); label.textContent = '恭喜你抽中'; const title = document.createElement('strong'); title.textContent = result && result.prizeTitle || '本次抽獎結果已記錄'; resultBox.append(label, title); if (result && result.prizeDescription) { const description = document.createElement('p'); description.textContent = result.prizeDescription; resultBox.append(description); } els.ticketModalResult.replaceChildren(resultBox);
    } else { els.ticketModalCost.textContent = '核銷完成，請向店員兌換。'; const resultBox = document.createElement('div'); resultBox.className = 'ticket-success'; resultBox.textContent = '這張票券已成功使用。'; els.ticketModalResult.replaceChildren(resultBox); }
    showTicketMessage('票券已完成核銷。', true);
  }

  function updateCardBalance(balance) { const cardId = String(balance.cardId || ''); const stamps = Number(balance.stamps || 0); state.cards = state.cards.map((card) => card.cardId === cardId ? { ...card, stamps: Math.max(0, stamps), updatedAt: String(balance.updatedAt || card.updatedAt || '') } : card); }
  function showTicketMessage(message, success) { els.ticketModalMessage.textContent = message; els.ticketModalMessage.classList.toggle('success', Boolean(success)); els.ticketModalMessage.classList.remove('hidden'); }
  function hideTicketMessage() { els.ticketModalMessage.textContent = ''; els.ticketModalMessage.classList.add('hidden'); els.ticketModalMessage.classList.remove('success'); }
  function safeAccent(value) { return /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value) : '#e47845'; }
  function setView(view) { els.loadingView.classList.toggle('hidden', view !== 'loading'); els.errorView.classList.toggle('hidden', view !== 'error'); els.pointsView.classList.toggle('hidden', view !== 'points'); }
  function showError(error) { els.errorTitle.textContent = error && error.code === 'CONFIG_ERROR' ? '系統尚未完成設定' : '集點卡暫時無法載入'; els.errorMessage.textContent = error && error.message ? error.message : '請稍後重新整理再試。'; setView('error'); }
})();
