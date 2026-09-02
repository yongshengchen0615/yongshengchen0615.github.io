(() => {
  'use strict';

  const state = { config: null, idToken: '', members: [], cards: [], stats: {}, activePanel: 'members', selectedCardId: '' };
  const els = {};

  window.addEventListener('DOMContentLoaded', () => {
    ['app', 'loadingView', 'errorView', 'errorTitle', 'errorMessage', 'pendingBox', 'pendingUserId', 'retryButton', 'adminView', 'displayName', 'roleLabel', 'logoutButton', 'membersTab', 'cardsTab', 'memberCount', 'activeMemberCount', 'activeCardCount', 'todayEntryCount', 'membersPanel', 'cardsPanel', 'syncStatus', 'refreshButton', 'memberSearch', 'memberResultCount', 'memberTableBody', 'memberEmptyState', 'newCardButton', 'cardResultCount', 'cardListItems', 'cardEmptyState', 'editorKicker', 'editorTitle', 'editorStatus', 'cardForm', 'cardId', 'cardExpectedUpdatedAt', 'cardTitle', 'cardDescription', 'cardTargetStamps', 'cardRewardTitle', 'cardStatus', 'cardAccent', 'accentValue', 'cardFormMessage', 'resetCardButton', 'saveCardButton', 'memberModal', 'closeMemberModal', 'memberForm', 'memberLineUserId', 'memberExpectedUpdatedAt', 'memberIdentity', 'memberTier', 'memberStatus', 'memberFormMessage', 'cancelMemberButton', 'saveMemberButton', 'stampModal', 'closeStampModal', 'stampForm', 'stampMemberId', 'stampMemberName', 'stampCardId', 'stampAmount', 'stampNote', 'stampFormMessage', 'cancelStampButton', 'saveStampButton'].forEach((id) => { els[id] = document.getElementById(id); });
    bindEvents();
    boot();
  });

  function bindEvents() {
    els.retryButton.addEventListener('click', () => window.location.reload());
    els.logoutButton.addEventListener('click', () => window.MemberSystem.logout());
    els.membersTab.addEventListener('click', () => switchPanel('members'));
    els.cardsTab.addEventListener('click', () => switchPanel('cards'));
    els.refreshButton.addEventListener('click', () => refreshData(true).catch((error) => { els.syncStatus.textContent = error && error.message || '同步失敗，請稍後再試。'; els.syncStatus.classList.add('error'); }));
    els.memberSearch.addEventListener('input', renderMembers);
    els.memberTableBody.addEventListener('click', handleMemberTableClick);
    els.newCardButton.addEventListener('click', () => resetCardForm());
    els.cardListItems.addEventListener('click', (event) => { const button = event.target instanceof Element ? event.target.closest('[data-card-id]') : null; if (button) loadCardForm(button.dataset.cardId); });
    els.cardAccent.addEventListener('input', updateAccentValue);
    els.cardForm.addEventListener('submit', saveCard);
    els.resetCardButton.addEventListener('click', resetCardForm);
    els.memberForm.addEventListener('submit', saveMember);
    els.cancelMemberButton.addEventListener('click', closeMemberModal);
    els.closeMemberModal.addEventListener('click', closeMemberModal);
    els.memberModal.addEventListener('click', (event) => { if (event.target === els.memberModal) closeMemberModal(); });
    els.stampForm.addEventListener('submit', saveStamp);
    els.cancelStampButton.addEventListener('click', closeStampModal);
    els.closeStampModal.addEventListener('click', closeStampModal);
    els.stampModal.addEventListener('click', (event) => { if (event.target === els.stampModal) closeStampModal(); });
    document.addEventListener('keydown', (event) => { if (event.key !== 'Escape') return; if (!els.memberModal.classList.contains('hidden')) closeMemberModal(); if (!els.stampModal.classList.contains('hidden')) closeStampModal(); });
  }

  async function boot() {
    setView('loading');
    try {
      state.config = await window.MemberSystem.loadConfig();
      state.idToken = await window.MemberSystem.signIn(state.config, 'admin');
      await refreshData(false);
      setView('admin');
    } catch (error) {
      handleBootError(error);
    } finally { els.app.setAttribute('aria-busy', 'false'); }
  }

  async function refreshData(showBusy) {
    if (showBusy) { els.refreshButton.disabled = true; els.syncStatus.textContent = '同步中…'; }
    try {
      const result = await window.MemberSystem.request(state.config, 'admin', state.idToken, 'admin.bootstrap');
      state.members = Array.isArray(result.members) ? result.members : [];
      state.cards = Array.isArray(result.cards) ? result.cards : [];
      state.stats = result.stats || {};
      state.displayName = String(result.profile && result.profile.displayName || '管理員');
      els.displayName.textContent = state.displayName;
      els.roleLabel.textContent = String(result.role || 'Admin');
      renderAll();
      els.syncStatus.textContent = `已同步 · ${new Date().toLocaleTimeString('zh-Hant-TW', { hour: '2-digit', minute: '2-digit' })}`;
    } finally {
      if (showBusy) els.refreshButton.disabled = false;
    }
  }

  function renderAll() {
    els.memberCount.textContent = String(state.stats.memberCount ?? state.members.length);
    els.activeMemberCount.textContent = String(state.stats.activeMemberCount ?? state.members.filter((member) => member.status === 'active').length);
    els.activeCardCount.textContent = String(state.stats.activeCardCount ?? state.cards.filter((card) => card.status === 'active').length);
    els.todayEntryCount.textContent = String(state.stats.todayEntryCount ?? 0);
    renderMembers();
    renderCardList();
    if (state.selectedCardId && state.cards.some((card) => card.cardId === state.selectedCardId)) loadCardForm(state.selectedCardId); else if (!els.cardId.value) resetCardForm();
  }

  function renderMembers() {
    const query = String(els.memberSearch.value || '').trim().toLowerCase();
    const members = state.members.filter((member) => !query || `${member.displayName} ${member.memberCode}`.toLowerCase().includes(query));
    els.memberResultCount.textContent = `${members.length} 位會員`;
    els.memberTableBody.replaceChildren(...members.map((member) => {
      const row = document.createElement('tr');
      const memberCell = document.createElement('td'); memberCell.append(createMemberIdentity(member));
      const tierCell = document.createElement('td'); const tier = document.createElement('span'); tier.className = 'tier-text'; tier.textContent = String(member.tier || '一般會員'); tierCell.append(tier);
      const statusCell = document.createElement('td'); const status = document.createElement('span'); status.className = `status-pill${member.status === 'active' ? '' : ' disabled'}`; status.textContent = member.status === 'active' ? '啟用中' : '已停用'; statusCell.append(status);
      const dateCell = document.createElement('td'); dateCell.textContent = window.MemberSystem.formatDate(member.joinedAt);
      const actionsCell = document.createElement('td'); actionsCell.className = 'align-right'; const actions = document.createElement('div'); actions.className = 'row-actions'; actions.append(actionButton('編輯', 'edit-member', member.lineUserId), actionButton('＋ 集點', 'add-stamp', member.lineUserId, true)); actionsCell.append(actions);
      row.append(memberCell, tierCell, statusCell, dateCell, actionsCell); return row;
    }));
    els.memberEmptyState.classList.toggle('hidden', members.length !== 0);
  }

  function createMemberIdentity(member) {
    const wrapper = document.createElement('div'); wrapper.className = 'member-cell'; const avatar = document.createElement('span'); avatar.className = 'member-avatar'; avatar.textContent = window.MemberSystem.initials(member.displayName); const copy = document.createElement('div'); const name = document.createElement('strong'); name.textContent = String(member.displayName || 'LINE 使用者'); const code = document.createElement('small'); code.textContent = String(member.memberCode || '尚未建立'); copy.append(name, code); wrapper.append(avatar, copy); return wrapper;
  }

  function actionButton(label, action, value, accent) { const button = document.createElement('button'); button.type = 'button'; button.className = `small-button${accent ? ' accent' : ''}`; button.dataset.action = action; button.dataset.value = String(value || ''); button.textContent = label; return button; }

  function handleMemberTableClick(event) {
    const button = event.target instanceof Element ? event.target.closest('[data-action]') : null; if (!button) return; const member = state.members.find((item) => item.lineUserId === button.dataset.value); if (!member) return; if (button.dataset.action === 'edit-member') openMemberModal(member); if (button.dataset.action === 'add-stamp') openStampModal(member);
  }

  function renderCardList() {
    els.cardResultCount.textContent = String(state.cards.length); els.cardEmptyState.classList.toggle('hidden', state.cards.length !== 0);
    els.cardListItems.replaceChildren(...state.cards.map((card) => { const button = document.createElement('button'); button.type = 'button'; button.className = 'card-list-item'; button.dataset.cardId = String(card.cardId); button.setAttribute('aria-selected', String(card.cardId) === state.selectedCardId ? 'true' : 'false'); button.style.setProperty('--card-accent', safeAccent(card.accent)); const title = document.createElement('strong'); const dot = document.createElement('i'); title.append(dot, document.createTextNode(String(card.title || '未命名集點卡'))); const meta = document.createElement('small'); meta.textContent = `${Number(card.targetStamps || 0)} 點 · ${statusLabel(card.status)}`; button.append(title, meta); return button; }));
  }

  function loadCardForm(cardId) {
    const card = state.cards.find((item) => item.cardId === cardId); if (!card) return; state.selectedCardId = cardId; els.cardId.value = String(card.cardId); els.cardExpectedUpdatedAt.value = String(card.updatedAt || ''); els.cardTitle.value = String(card.title || ''); els.cardDescription.value = String(card.description || ''); els.cardTargetStamps.value = String(card.targetStamps || 10); els.cardRewardTitle.value = String(card.rewardTitle || ''); els.cardStatus.value = String(card.status || 'draft'); els.cardAccent.value = safeAccent(card.accent); updateAccentValue(); els.editorKicker.textContent = 'Edit reward card'; els.editorTitle.textContent = String(card.title || '編輯集點卡'); updateEditorStatus(card.status); renderCardList();
  }

  function resetCardForm() { state.selectedCardId = ''; els.cardForm.reset(); els.cardId.value = ''; els.cardExpectedUpdatedAt.value = ''; els.cardTargetStamps.value = '10'; els.cardStatus.value = 'draft'; els.cardAccent.value = '#e47845'; updateAccentValue(); els.editorKicker.textContent = 'Create reward card'; els.editorTitle.textContent = '新增集點卡'; updateEditorStatus('draft'); hideMessage(els.cardFormMessage); renderCardList(); }

  async function saveCard(event) {
    event.preventDefault(); hideMessage(els.cardFormMessage); const title = String(els.cardTitle.value || '').trim(); const rewardTitle = String(els.cardRewardTitle.value || '').trim(); const targetStamps = Number(els.cardTargetStamps.value); if (!title || !rewardTitle || !Number.isInteger(targetStamps) || targetStamps < 1 || targetStamps > 100) { showMessage(els.cardFormMessage, '請填寫卡片名稱、完成點數（1–100）與完成後回饋。'); return; }
    setSaving(els.saveCardButton, true); try { const result = await window.MemberSystem.request(state.config, 'admin', state.idToken, 'admin.pointcards.save', { card: { cardId: els.cardId.value, title, description: String(els.cardDescription.value || '').trim(), targetStamps, rewardTitle, status: els.cardStatus.value, accent: safeAccent(els.cardAccent.value) }, expectedUpdatedAt: els.cardExpectedUpdatedAt.value }); const saved = result.card; state.cards = saved ? replaceById(state.cards, saved, 'cardId') : state.cards; state.selectedCardId = saved && saved.cardId || ''; renderAll(); if (saved) loadCardForm(saved.cardId); showMessage(els.cardFormMessage, '已儲存，會員端下次更新時會看到最新設定。', true); } catch (error) { handleActionError(error, els.cardFormMessage); } finally { setSaving(els.saveCardButton, false); }
  }

  function openMemberModal(member) { els.memberLineUserId.value = String(member.lineUserId); els.memberExpectedUpdatedAt.value = String(member.updatedAt || ''); els.memberIdentity.textContent = `${member.displayName || 'LINE 使用者'} · ${member.memberCode || '尚未建立'}`; els.memberTier.value = String(member.tier || '一般會員'); els.memberStatus.value = member.status === 'active' ? 'active' : 'disabled'; hideMessage(els.memberFormMessage); els.memberModal.classList.remove('hidden'); els.memberTier.focus(); }
  function closeMemberModal() { els.memberModal.classList.add('hidden'); }
  async function saveMember(event) { event.preventDefault(); hideMessage(els.memberFormMessage); setSaving(els.saveMemberButton, true); try { const result = await window.MemberSystem.request(state.config, 'admin', state.idToken, 'admin.member.update', { lineUserId: els.memberLineUserId.value, tier: String(els.memberTier.value || '').trim() || '一般會員', status: els.memberStatus.value, expectedUpdatedAt: els.memberExpectedUpdatedAt.value }); if (result.member) state.members = replaceById(state.members, result.member, 'lineUserId'); closeMemberModal(); renderAll(); } catch (error) { handleActionError(error, els.memberFormMessage); } finally { setSaving(els.saveMemberButton, false); } }

  function openStampModal(member) { els.stampMemberId.value = String(member.lineUserId); els.stampMemberName.textContent = `${member.displayName || 'LINE 使用者'} · ${member.memberCode || '尚未建立'}`; els.stampCardId.replaceChildren(...state.cards.filter((card) => card.status === 'active').map((card) => { const option = document.createElement('option'); option.value = String(card.cardId); option.textContent = String(card.title || '未命名集點卡'); return option; })); els.stampAmount.value = '1'; els.stampNote.value = ''; hideMessage(els.stampFormMessage); els.stampModal.classList.remove('hidden'); els.stampCardId.focus(); }
  function closeStampModal() { els.stampModal.classList.add('hidden'); }
  async function saveStamp(event) { event.preventDefault(); hideMessage(els.stampFormMessage); const amount = Number(els.stampAmount.value); if (!els.stampCardId.value || !Number.isInteger(amount) || amount < 1 || amount > 100) { showMessage(els.stampFormMessage, '請選擇啟用中的集點卡，並輸入 1–100 的整數點數。'); return; } setSaving(els.saveStampButton, true); try { await window.MemberSystem.request(state.config, 'admin', state.idToken, 'admin.stamps.add', { lineUserId: els.stampMemberId.value, cardId: els.stampCardId.value, amount, note: String(els.stampNote.value || '').trim() }); await refreshData(false); closeStampModal(); } catch (error) { handleActionError(error, els.stampFormMessage); } finally { setSaving(els.saveStampButton, false); } }

  function switchPanel(panel) { state.activePanel = panel; const members = panel === 'members'; els.membersTab.setAttribute('aria-selected', String(members)); els.cardsTab.setAttribute('aria-selected', String(!members)); els.membersPanel.classList.toggle('hidden', !members); els.cardsPanel.classList.toggle('hidden', members); }
  function updateAccentValue() { els.accentValue.textContent = safeAccent(els.cardAccent.value).toUpperCase(); }
  function updateEditorStatus(status) { els.editorStatus.textContent = statusLabel(status); els.editorStatus.className = `editor-status ${status}`; }
  function statusLabel(status) { return ({ active: '啟用中', draft: '草稿', archived: '已封存', disabled: '已停用' })[status] || '未設定'; }
  function safeAccent(value) { return /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value) : '#e47845'; }
  function replaceById(items, next, key) { return items.some((item) => item[key] === next[key]) ? items.map((item) => item[key] === next[key] ? next : item) : [next, ...items]; }
  function setSaving(button, saving) { button.disabled = saving; if (saving) button.dataset.originalText = button.textContent, button.textContent = '儲存中…'; else button.textContent = button.dataset.originalText || button.textContent; }
  function showMessage(element, message, success) { element.textContent = message; element.classList.toggle('success', Boolean(success)); element.classList.remove('hidden'); }
  function hideMessage(element) { element.textContent = ''; element.classList.add('hidden'); element.classList.remove('success'); }
  function handleActionError(error, element) { showMessage(element, error && error.code === 'CONFLICT' ? '資料已被另一位管理者更新，請重新整理後再儲存。' : error && error.message || '操作失敗，請稍後再試。'); }
  function handleBootError(error) { if (error && error.code === 'ADMIN_PENDING') { els.pendingUserId.textContent = String(error.details && error.details.lineUserId || '請查看 Admins 資料表'); els.pendingBox.classList.remove('hidden'); showError('此 LINE 帳號尚未授權', 'GAS 已記錄這次管理端登入，但目前不允許進入管理功能。'); return; } if (error && error.code === 'ADMIN_FORBIDDEN') { showError('沒有管理端權限', '此 LINE 帳號未啟用管理權限，請檢查 Admins 的 role 與 status。'); return; } showError(error && error.code === 'CONFIG_ERROR' ? '系統尚未完成設定' : '暫時無法進入管理端', error && error.message || '請稍後重新整理。'); }
  function setView(view) { els.loadingView.classList.toggle('hidden', view !== 'loading'); els.errorView.classList.toggle('hidden', view !== 'error'); els.adminView.classList.toggle('hidden', view !== 'admin'); }
  function showError(title, message) { els.errorTitle.textContent = title; els.errorMessage.textContent = message; setView('error'); }
})();
