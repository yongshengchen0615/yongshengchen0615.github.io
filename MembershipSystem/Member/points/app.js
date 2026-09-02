(() => {
  'use strict';

  const state = { config: null, idToken: '', displayName: '', cards: [], tickets: [], selectedCardId: '' };
  const els = {};

  window.addEventListener('DOMContentLoaded', () => {
    ['app', 'loadingView', 'errorView', 'errorTitle', 'errorMessage', 'retryButton', 'pointsView', 'displayName', 'logoutButton', 'refreshButton', 'cardTabs', 'emptyView', 'activeCardView', 'activeCardTitle', 'activeCardDescription', 'activeCardStatus', 'progressCount', 'progressMessage', 'remainingMessage', 'rewardTitle', 'cardExpiry', 'updatedAt', 'milestonesPanel', 'milestoneList', 'milestonesSummary', 'ticketModal', 'closeTicketModal', 'ticketModalTicketName', 'ticketModalHint', 'ticketChoices', 'ticketModalMessage'].forEach((id) => { els[id] = document.getElementById(id); });
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
      const progress = document.createElement('small'); progress.textContent = `${Number(card.stamps || 0)} 點`;
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
    const rewards = Array.isArray(card.rewards) ? card.rewards : [];
    const earnedThresholds = new Set(state.tickets.filter((ticket) => ticket.cardId === card.cardId).map((ticket) => Number(ticket.thresholdStamps || 0)));
    const nextReward = rewards.find((reward) => Number(reward.thresholdStamps || 0) > stamps && !earnedThresholds.has(Number(reward.thresholdStamps || 0)));
    els.activeCardTitle.textContent = String(card.title || '未命名集點卡');
    els.activeCardDescription.textContent = String(card.description || '持續集點，達到節點後即可取得兌換票券。');
    els.activeCardStatus.textContent = card.expired ? '已過期' : card.status === 'archived' ? '已停止' : '持續累積';
    els.progressCount.textContent = String(stamps);
    els.progressMessage.textContent = card.expired ? '這張集點卡已超過使用期限' : card.status === 'archived' ? '這張卡已停止集點' : stamps ? '持續累積，達到節點即可取得兌換票券' : '開始累積你的第一點';
    els.remainingMessage.textContent = card.expired ? '目前無法再使用' : card.status === 'archived' ? '集點卡已移除' : nextReward ? `下一個節點：${Number(nextReward.thresholdStamps)} 點` : '目前節點票券皆已取得，繼續累積';
    els.rewardTitle.textContent = '請查看下方兌換票券節點';
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
      const shortage = Math.max(0, consume - stamps);
      const availability = earned ? (shortage ? `已取得票券 · 還差 ${shortage} 點可兌換` : '已取得票券') : `還差 ${Math.max(0, threshold - stamps)} 點`;
      const item = document.createElement('article'); item.className = `milestone-item${earned ? ' reached' : ''}`;
      const marker = document.createElement('span'); marker.className = 'milestone-marker'; marker.textContent = earned ? '✓' : String(reward.thresholdStamps || '—');
      const copy = document.createElement('div'); const title = document.createElement('strong'); title.textContent = String(reward.rewardTitle || '節點回饋'); const meta = document.createElement('small'); meta.textContent = `${rewardTypeLabel(reward.rewardType)} · 需集 ${threshold} 點 · 使用消耗 ${consume} 點 · ${availability}`; copy.append(title, meta); if (reward.rewardDescription) { const description = document.createElement('p'); description.textContent = String(reward.rewardDescription); copy.append(description); } if (String(reward.rewardType) === 'lottery') { const prizeLabel = document.createElement('p'); prizeLabel.className = 'prize-opportunity-label'; prizeLabel.textContent = '可獲得的獎項'; copy.append(prizeLabel); const prizeList = document.createElement('ul'); prizeList.className = 'prize-opportunities'; prizeList.setAttribute('aria-label', '可獲得的獎項'); (Array.isArray(reward.prizes) ? reward.prizes : []).forEach((prize) => { const prizeItem = document.createElement('li'); prizeItem.className = 'prize-opportunity'; const prizeName = document.createElement('span'); prizeName.textContent = String(prize.prizeTitle || '未命名獎項'); prizeItem.append(prizeName); prizeList.append(prizeItem); }); if (prizeList.children.length) copy.append(prizeList); }
      const action = document.createElement('div'); action.className = 'milestone-action'; if (card.expired) { const expired = document.createElement('span'); expired.className = 'ticket-used'; expired.textContent = '已過期'; action.append(expired); } else if (ticket) { if (shortage) { const insufficient = document.createElement('span'); insufficient.className = 'ticket-used'; insufficient.textContent = `點數不足 · 還差 ${shortage} 點`; action.append(insufficient); } else { const useButton = document.createElement('button'); useButton.type = 'button'; useButton.className = 'small-ticket-button'; useButton.dataset.useTicket = ticket.ticketId; useButton.textContent = '使用這張券'; action.append(useButton); } } item.append(marker, copy, action); return item;
    }));
  }
  function rewardTypeLabel(type) { return type === 'lottery' ? '抽獎券' : '優惠券'; }

  function openTicketModal(ticketId) {
    const ticket = state.tickets.find((item) => item.ticketId === ticketId);
    if (!ticket || ticket.status === 'used') return;
    els.ticketModal.classList.remove('hidden');
    els.ticketModalTicketName.textContent = `${ticket.ticketType === 'lottery' ? '抽獎券' : '優惠券'}｜${ticket.ticketTitle || '節點回饋'}`;
    els.ticketModalHint.textContent = '確認後會立即使用這張票券。';
    hideTicketMessage();
    redeemTicket(ticketId);
  }
  function closeTicketModal() {
    els.ticketModal.classList.add('hidden');
    els.ticketChoices.replaceChildren();
    hideTicketMessage();
  }
  async function redeemTicket(ticketId) {
    const ticket = state.tickets.find((item) => item.ticketId === ticketId);
    if (!ticket) return;
    els.ticketModalHint.textContent = '正在使用票券…';
    const loading = document.createElement('div');
    loading.className = 'ticket-choice loading';
    loading.textContent = '正在確認票券…';
    els.ticketChoices.replaceChildren(loading);
    try {
      const result = await window.MemberSystem.request(state.config, 'points', state.idToken, 'user.pointcard.ticket.redeem', { ticketId });
      const redeemed = result.ticket;
      state.tickets = state.tickets.filter((item) => item.ticketId !== ticketId);
      if (Array.isArray(result.nextTickets)) state.tickets = state.tickets.concat(result.nextTickets);
      if (result.balance) updateCardBalance(result.balance);
      renderCards();
      await showRedeemedTicket(redeemed);
    } catch (error) {
      els.ticketChoices.replaceChildren();
      showTicketMessage(error && error.message || '票券使用失敗，請稍後再試。');
    }
  }
  async function showRedeemedTicket(ticket) { if (ticket.ticketType === 'lottery') { els.ticketModalHint.textContent = '開獎中，請稍候…'; const reveal = document.createElement('div'); reveal.className = 'lottery-reveal'; reveal.textContent = '✦ 抽獎中 ✦'; els.ticketChoices.replaceChildren(reveal); await new Promise((resolve) => window.setTimeout(resolve, 1350)); const result = ticket.result; els.ticketModalHint.textContent = '開獎完成'; const resultBox = document.createElement('div'); resultBox.className = 'lottery-result'; const label = document.createElement('span'); label.textContent = '恭喜你抽中'; const title = document.createElement('strong'); title.textContent = result && result.prizeTitle || '本次抽獎結果已記錄'; resultBox.append(label, title); if (result && result.prizeDescription) { const description = document.createElement('p'); description.textContent = result.prizeDescription; resultBox.append(description); } els.ticketChoices.replaceChildren(resultBox); } else { els.ticketModalHint.textContent = '核銷完成'; const resultBox = document.createElement('div'); resultBox.className = 'ticket-success'; resultBox.textContent = '優惠券已成功使用，請向店員兌換。'; els.ticketChoices.replaceChildren(resultBox); } showTicketMessage('這張票券已完成核銷。', true); }
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
