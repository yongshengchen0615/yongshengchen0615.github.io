(() => {
  'use strict';

  const state = { config: null, idToken: '', displayName: '', cards: [], selectedCardId: '' };
  const els = {};

  window.addEventListener('DOMContentLoaded', () => {
    ['app', 'loadingView', 'errorView', 'errorTitle', 'errorMessage', 'retryButton', 'pointsView', 'displayName', 'logoutButton', 'refreshButton', 'cardTabs', 'emptyView', 'activeCardView', 'activeCardTitle', 'activeCardDescription', 'activeCardStatus', 'progressCount', 'targetCount', 'progressBar', 'progressMessage', 'remainingMessage', 'rewardTitle', 'updatedAt'].forEach((id) => { els[id] = document.getElementById(id); });
    els.retryButton.addEventListener('click', () => window.location.reload());
    els.logoutButton.addEventListener('click', () => window.MemberSystem.logout());
    els.refreshButton.addEventListener('click', () => loadCards(true).catch(() => { els.refreshButton.textContent = '更新失敗'; window.setTimeout(() => { els.refreshButton.innerHTML = '<span aria-hidden="true">↻</span> 更新'; }, 1200); }));
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
    if (hasCards) renderActiveCard(state.cards.find((card) => card.cardId === state.selectedCardId) || state.cards[0]);
  }

  function renderActiveCard(card) {
    const stamps = Math.max(0, Number(card.stamps || 0));
    const target = Math.max(1, Number(card.targetStamps || 1));
    const complete = stamps >= target;
    const percent = Math.min(100, Math.round((stamps / target) * 100));
    els.activeCardTitle.textContent = String(card.title || '未命名集點卡');
    els.activeCardDescription.textContent = String(card.description || '完成集點後即可兌換專屬回饋。');
    els.activeCardStatus.textContent = complete ? '已達成' : '進行中';
    els.progressCount.textContent = String(stamps);
    els.targetCount.textContent = String(target);
    els.progressBar.style.width = `${percent}%`;
    els.progressBar.parentElement.setAttribute('aria-valuemax', String(target));
    els.progressBar.parentElement.setAttribute('aria-valuenow', String(Math.min(stamps, target)));
    els.progressMessage.textContent = complete ? '恭喜，已達成兌換條件' : stamps ? '保持這個節奏，繼續累積' : '開始累積你的第一點';
    els.remainingMessage.textContent = complete ? '可以向店家兌換' : `還差 ${target - stamps} 點`;
    els.rewardTitle.textContent = String(card.rewardTitle || '專屬回饋');
    els.updatedAt.textContent = card.updatedAt ? `更新於 ${window.MemberSystem.formatDateTime(card.updatedAt)}` : '尚未更新';
  }

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
