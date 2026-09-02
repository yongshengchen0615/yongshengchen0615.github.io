(() => {
  'use strict';

  const state = { config: null, idToken: '', displayName: '', cards: [], tickets: [], selectedCardId: '', activeChallenge: null };
  const els = {};

  window.addEventListener('DOMContentLoaded', () => {
    ['app', 'loadingView', 'errorView', 'errorTitle', 'errorMessage', 'retryButton', 'pointsView', 'displayName', 'logoutButton', 'refreshButton', 'cardTabs', 'emptyView', 'activeCardView', 'activeCardTitle', 'activeCardDescription', 'activeCardStatus', 'progressCount', 'targetCount', 'progressBar', 'progressMessage', 'remainingMessage', 'rewardTitle', 'cardExpiry', 'updatedAt', 'milestonesPanel', 'milestoneList', 'milestonesSummary', 'ticketModal', 'closeTicketModal', 'ticketModalTicketName', 'ticketModalHint', 'ticketChoices', 'ticketModalMessage'].forEach((id) => { els[id] = document.getElementById(id); });
    els.retryButton.addEventListener('click', () => window.location.reload());
    els.logoutButton.addEventListener('click', () => window.MemberSystem.logout());
    els.refreshButton.addEventListener('click', () => loadCards(true).catch(() => { els.refreshButton.textContent = '更新失敗'; window.setTimeout(() => { els.refreshButton.innerHTML = '<span aria-hidden="true">↻</span> 更新'; }, 1200); }));
    els.milestoneList.addEventListener('click', (event) => { const target = event.target instanceof Element ? event.target.closest('[data-use-ticket]') : null; if (target) openTicketModal(target.dataset.useTicket); });
    els.closeTicketModal.addEventListener('click', closeTicketModal);
    els.ticketModal.addEventListener('click', (event) => { if (event.target === els.ticketModal) closeTicketModal(); });
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !els.ticketModal.classList.contains('hidden')) closeTicketModal(); });
    els.cardTabs.addEventListener('click', (event) => {
      const target = event.target instanceof Element ? event.target.closest('[data-card-id]') : null;
      if (!target) return;
      state.selectedCardId = target.dataset.cardId || '';
      renderCards();
    });
    boot();
  });

  async function boot() {
    setView('loading');
    try {
      state.config = await window.MemberSystem.loadConfig();
      state.idToken = await window.MemberSystem.signIn(state.config, 'points');
      await loadCards(false);
      setView('points');
    } catch (error) {
      showError(error);
    } finally {
      els.app.setAttribute('aria-busy', 'false');
    }
  }

  async function loadCards(showBusy) {
    if (showBusy) els.refreshButton.disabled = true;
    try {
      const result = await window.MemberSystem.request(state.config, 'points', state.idToken, 'user.pointcard.bootstrap');
      state.displayName = String(result.profile && result.profile.displayName || 'LINE 使用者');
      state.cards = Array.isArray(result.cards) ? result.cards : [];
      state.tickets = Array.isArray(result.tickets) ? result.tickets : [];
      if (!state.cards.some((card) => card.cardId === state.selectedCardId)) state.selectedCardId = state.cards[0] ? state.cards[0].cardId : '';
      els.displayName.textContent = state.displayName;
      renderCards();
      if (showBusy) els.refreshButton.textContent = '✓ 已更新';
    } finally {
      if (showBusy) {
        window.setTimeout(() => { els.refreshButton.innerHTML = '<span aria-hidden="true">↻</span> 更新'; }, 1100);
        els.refreshButton.disabled = false;
      }
    }
  }

  function renderCards() {
    els.cardTabs.replaceChildren(...state.cards.map((card) => {
      const button = document.createElement('button');
      button.className = 'card-tab';
      button.type = 'button';
      button.dataset.cardId = String(card.cardId || '');
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', String(card.cardId) === state.selectedCardId ? 'true' : 'false');
      const title = document.createElement('strong'); title.textContent = String(card.title || '未命名集點卡');
      const progress = document.createElement('small'); progress.textContent = `${Number(card.stamps || 0)} / ${Number(card.targetStamps || 0)} 點`;
      button.append(title, progress);
      return button;
    }));
    const hasCards = state.cards.length > 0;
    els.cardTabs.classList.toggle('hidden', !hasCards);
    els.emptyView.classList.toggle('hidden', hasCards);
    els.activeCardView.classList.toggle('hidden', !hasCards);
    els.milestonesPanel.classList.toggle('hidden', !hasCards);
    if (hasCards) renderActiveCard(state.cards.find((card) => card.cardId === state.selectedCardId) || state.cards[0]);
  }

  function renderActiveCard(card) {
    const stamps = Math.max(0, Number(card.stamps || 0));
    const target = Math.max(1, Number(card.targetStamps || 1));
    const complete = stamps >= target;
    const percent = Math.min(100, Math.round((stamps / target) * 100));
    els.activeCardTitle.textContent = String(card.title || '未命名集點卡');
    els.activeCardDescription.textContent = String(card.description || '完成集點後即可兌換專屬回饋。');
    els.activeCardStatus.textContent = card.expired ? '已過期' : card.status === 'archived' ? '已停止' : complete ? '已達成' : '進行中';
    els.progressCount.textContent = String(stamps);
    els.targetCount.textContent = String(target);
    els.progressBar.style.width = `${percent}%`;
    els.progressBar.parentElement.setAttribute('aria-valuemax', String(target));
    els.progressBar.parentElement.setAttribute('aria-valuenow', String(Math.min(stamps, target)));
    els.progressMessage.textContent = card.expired ? '這張集點卡已超過使用期限' : card.status === 'archived' ? '這張卡已停止集點' : complete ? '恭喜，已達成兌換條件' : stamps ? '保持這個節奏，繼續累積' : '開始累積你的第一點';
    els.remainingMessage.textContent = card.expired ? '目前無法再使用' : card.status === 'archived' ? '集點卡已移除' : complete ? '可以向店家兌換' : `還差 ${target - stamps} 點`;
    els.rewardTitle.textContent = String(card.rewardTitle || '專屬回饋');
    els.cardExpiry.textContent = card.expiryMode === 'date' && card.expiresOn ? `${card.expired ? '已於' : '使用期限至'} ${card.expiresOn}` : '使用期限：無期限';
    els.updatedAt.textContent = card.updatedAt ? `更新於 ${window.MemberSystem.formatDateTime(card.updatedAt)}` : '尚未更新';
    renderMilestones(card, stamps);
  }

  function renderMilestones(card, stamps) {
    const rewards = Array.isArray(card.rewards) ? card.rewards.slice().sort((a, b) => Number(a.thresholdStamps || 0) - Number(b.thresholdStamps || 0)) : [];
    els.milestonesSummary.textContent = rewards.length ? `${rewards.length} 個回饋節點` : '尚未設定節點';
    els.milestoneList.replaceChildren(...rewards.map((reward) => {
      const threshold = Number(reward.thresholdStamps || 0);
      const consume = Number(reward.consumeStamps || threshold);
      const ticket = state.tickets.find((item) => item.cardId === card.cardId && item.thresholdStamps === Number(reward.thresholdStamps || 0));
      const earned = stamps >= threshold || Boolean(ticket);
      const item = document.createElement('article'); item.className = `milestone-item${earned ? ' reached' : ''}`;
      const marker = document.createElement('span'); marker.className = 'milestone-marker'; marker.textContent = earned ? '✓' : String(reward.thresholdStamps || '—');
      const copy = document.createElement('div'); const title = document.createElement('strong'); title.textContent = String(reward.rewardTitle || '節點回饋'); const meta = document.createElement('small'); meta.textContent = `${rewardTypeLabel(reward.rewardType)} · 需集 ${threshold} 點 · 使用消耗 ${consume} 點 · ${earned ? '已達成' : `還差 ${Math.max(0, threshold - stamps)} 點`}`; copy.append(title, meta); if (reward.rewardDescription) { const description = document.createElement('p'); description.textContent = String(reward.rewardDescription); copy.append(description); } if (String(reward.rewardType) === 'lottery') { const prizeLabel = document.createElement('p'); prizeLabel.className = 'prize-opportunity-label'; prizeLabel.textContent = '可能獲得'; copy.append(prizeLabel); const prizeList = document.createElement('ul'); prizeList.className = 'prize-opportunities'; (Array.isArray(reward.prizes) ? reward.prizes : []).forEach((prize) => { const prizeItem = document.createElement('li'); prizeItem.className = 'prize-opportunity'; const prizeName = document.createElement('span'); prizeName.textContent = String(prize.prizeTitle || '未命名獎項'); prizeItem.append(prizeName); prizeList.append(prizeItem); }); if (prizeList.children.length) copy.append(prizeList); }
      const action = document.createElement('div'); action.className = 'milestone-action'; if (card.expired) { const expired = document.createElement('span'); expired.className = 'ticket-used'; expired.textContent = '已過期'; action.append(expired); } else if (ticket) { if (ticket.status === 'locked') { const locked = document.createElement('span'); locked.className = 'ticket-used'; locked.textContent = '已鎖定'; action.append(locked); } else if (stamps < consume) { const insufficient = document.createElement('span'); insufficient.className = 'ticket-used'; insufficient.textContent = '點數不足'; action.append(insufficient); } else { const useButton = document.createElement('button'); useButton.type = 'button'; useButton.className = 'small-ticket-button'; useButton.dataset.useTicket = ticket.ticketId; useButton.textContent = '使用這張券'; action.append(useButton); } } item.append(marker, copy, action); return item;
    }));
  }
  function rewardTypeLabel(type) { return type === 'lottery' ? '抽獎券' : '優惠券'; }

  function openTicketModal(ticketId) { const ticket = state.tickets.find((item) => item.ticketId === ticketId); if (!ticket || ticket.status !== 'available') return; els.ticketModal.classList.remove('hidden'); els.ticketModalTicketName.textContent = `${ticket.ticketType === 'lottery' ? '抽獎券' : '優惠券'}｜${ticket.ticketTitle || '節點回饋'}`; hideTicketMessage(); startTicketChallenge(ticketId); }
  function closeTicketModal() { els.ticketModal.classList.add('hidden'); state.activeChallenge = null; els.ticketChoices.replaceChildren(); hideTicketMessage(); }
  async function startTicketChallenge(ticketId, retryMessage) { const ticket = state.tickets.find((item) => item.ticketId === ticketId); if (!ticket) return; state.activeChallenge = null; els.ticketModalHint.textContent = retryMessage || `本次兌換會消耗 ${Number(ticket.consumeStamps || ticket.thresholdStamps || 0)} 點。請將畫面交給店員，店員點選正確號碼。`; const loading = document.createElement('button'); loading.type = 'button'; loading.className = 'ticket-choice loading'; loading.disabled = true; loading.textContent = '正在準備號碼…'; els.ticketChoices.replaceChildren(loading); try { const result = await window.MemberSystem.request(state.config, 'points', state.idToken, 'user.pointcard.ticket.challenge', { ticketId }); state.activeChallenge = { ticketId, challengeId: result.challengeId }; els.ticketChoices.replaceChildren(...(Array.isArray(result.options) ? result.options : []).map((option) => { const button = document.createElement('button'); button.type = 'button'; button.className = 'ticket-choice'; button.dataset.ticketCode = String(option); button.textContent = String(option); button.addEventListener('click', handleTicketChoice); return button; })); } catch (error) { showTicketMessage(error && error.message || '暫時無法準備票券，請稍後再試。'); els.ticketChoices.replaceChildren(); } }
  async function handleTicketChoice(event) { const button = event.currentTarget; const challenge = state.activeChallenge; if (!challenge) return; Array.from(els.ticketChoices.querySelectorAll('button')).forEach((item) => { item.disabled = true; }); els.ticketModalHint.textContent = '正在確認號碼…'; try { const result = await window.MemberSystem.request(state.config, 'points', state.idToken, 'user.pointcard.ticket.redeem', { ticketId: challenge.ticketId, challengeId: challenge.challengeId, selectedCode: button.dataset.ticketCode }); const redeemed = result.ticket; state.tickets = state.tickets.filter((ticket) => ticket.ticketId !== challenge.ticketId); if (result.balance) updateCardBalance(result.balance); renderCards(); await showRedeemedTicket(redeemed); } catch (error) { const details = error && error.details || {}; if (error && error.code === 'TICKET_CODE_INCORRECT' && details.ticketStatus !== 'locked') { await startTicketChallenge(challenge.ticketId, `號碼不正確，請再選一次（剩餘 ${Number(details.remainingAttempts || 0)} 次）。`); } else { if (details.ticketStatus === 'locked') { state.tickets = state.tickets.map((ticket) => ticket.ticketId === challenge.ticketId ? { ...ticket, status: 'locked' } : ticket); renderCards(); } showTicketMessage(error && error.message || '票券核銷失敗，請稍後再試。'); } } }
  async function showRedeemedTicket(ticket) { state.activeChallenge = null; if (ticket.ticketType === 'lottery') { els.ticketModalHint.textContent = '開獎中，請稍候…'; const reveal = document.createElement('div'); reveal.className = 'lottery-reveal'; reveal.textContent = '✦ 抽獎中 ✦'; els.ticketChoices.replaceChildren(reveal); await new Promise((resolve) => window.setTimeout(resolve, 1350)); const result = ticket.result; els.ticketModalHint.textContent = '開獎完成'; const resultBox = document.createElement('div'); resultBox.className = 'lottery-result'; const label = document.createElement('span'); label.textContent = '恭喜你抽中'; const title = document.createElement('strong'); title.textContent = result && result.prizeTitle || '本次抽獎結果已記錄'; resultBox.append(label, title); if (result && result.prizeDescription) { const description = document.createElement('p'); description.textContent = result.prizeDescription; resultBox.append(description); } els.ticketChoices.replaceChildren(resultBox); } else { els.ticketModalHint.textContent = '核銷完成'; const resultBox = document.createElement('div'); resultBox.className = 'ticket-success'; resultBox.textContent = '優惠券已成功使用，請向店員兌換。'; els.ticketChoices.replaceChildren(resultBox); } showTicketMessage('這張票券已完成核銷。', true); }
  function updateCardBalance(balance) { const cardId = String(balance.cardId || ''); const stamps = Number(balance.stamps || 0); state.cards = state.cards.map((card) => card.cardId === cardId ? { ...card, stamps: Math.max(0, stamps), updatedAt: String(balance.updatedAt || card.updatedAt || '') } : card); }
  function showTicketMessage(message, success) { els.ticketModalMessage.textContent = message; els.ticketModalMessage.classList.toggle('success', Boolean(success)); els.ticketModalMessage.classList.remove('hidden'); }
  function hideTicketMessage() { els.ticketModalMessage.textContent = ''; els.ticketModalMessage.classList.add('hidden'); els.ticketModalMessage.classList.remove('success'); }

  function setView(view) {
    els.loadingView.classList.toggle('hidden', view !== 'loading');
    els.errorView.classList.toggle('hidden', view !== 'error');
    els.pointsView.classList.toggle('hidden', view !== 'points');
  }

  function showError(error) {
    els.errorTitle.textContent = error && error.code === 'CONFIG_ERROR' ? '系統尚未完成設定' : '集點卡暫時無法載入';
    els.errorMessage.textContent = error && error.message ? error.message : '請稍後重新整理再試。';
    setView('error');
  }
})();
