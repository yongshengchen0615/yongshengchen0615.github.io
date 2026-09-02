(() => {
  'use strict';

  const state = { config: null, idToken: '', members: [], cards: [], stats: {}, activePanel: 'members', selectedCardId: '' };
  const els = {};

  window.addEventListener('DOMContentLoaded', () => {
    ['app', 'loadingView', 'errorView', 'errorTitle', 'errorMessage', 'pendingBox', 'pendingUserId', 'retryButton', 'adminView', 'displayName', 'roleLabel', 'logoutButton', 'membersTab', 'cardsTab', 'memberCount', 'activeMemberCount', 'activeCardCount', 'todayEntryCount', 'membersPanel', 'cardsPanel', 'syncStatus', 'refreshButton', 'memberSearch', 'memberResultCount', 'memberTableBody', 'memberEmptyState', 'newCardButton', 'cardResultCount', 'cardListItems', 'cardEmptyState', 'editorKicker', 'editorTitle', 'editorStatus', 'cardForm', 'cardId', 'cardExpectedUpdatedAt', 'cardTitle', 'cardDescription', 'cardTargetStamps', 'cardRewardTitle', 'cardStatus', 'cardAccent', 'accentValue', 'rewardRows', 'addRewardButton', 'rewardEditorHint', 'cardFormMessage', 'resetCardButton', 'saveCardButton', 'memberModal', 'closeMemberModal', 'memberForm', 'memberLineUserId', 'memberExpectedUpdatedAt', 'memberIdentity', 'memberTier', 'memberStatus', 'memberFormMessage', 'cancelMemberButton', 'saveMemberButton', 'stampModal', 'closeStampModal', 'stampForm', 'stampMemberId', 'stampMemberName', 'stampCardId', 'stampAmount', 'stampNote', 'stampFormMessage', 'cancelStampButton', 'saveStampButton'].forEach((id) => { els[id] = document.getElementById(id); });
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
    els.addRewardButton.addEventListener('click', addRewardRow);
    els.rewardRows.addEventListener('input', handleRewardRowsInput);
    els.rewardRows.addEventListener('change', handleRewardRowsInput);
    els.rewardRows.addEventListener('click', (event) => { const button = event.target instanceof Element ? event.target.closest('[data-remove-reward]') : null; if (button) { button.closest('[data-reward-row]').remove(); updateRewardEditorHint(); } });
    els.cardTargetStamps.addEventListener('input', updateRewardEditorHint);
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
    els.cardListItems.replaceChildren(...state.cards.map((card) => { const button = document.createElement('button'); button.type = 'button'; button.className = 'card-list-item'; button.dataset.cardId = String(card.cardId); button.setAttribute('aria-selected', String(card.cardId) === state.selectedCardId ? 'true' : 'false'); button.style.setProperty('--card-accent', safeAccent(card.accent)); const title = document.createElement('strong'); const dot = document.createElement('i'); title.append(dot, document.createTextNode(String(card.title || '未命名集點卡'))); const meta = document.createElement('small'); meta.textContent = `${Number(card.targetStamps || 0)} 點 · ${Array.isArray(card.rewards) ? card.rewards.length : 0} 個節點 · ${statusLabel(card.status)}`; button.append(title, meta); return button; }));
  }

  function loadCardForm(cardId) {
    const card = state.cards.find((item) => item.cardId === cardId); if (!card) return; state.selectedCardId = cardId; els.cardId.value = String(card.cardId); els.cardExpectedUpdatedAt.value = String(card.updatedAt || ''); els.cardTitle.value = String(card.title || ''); els.cardDescription.value = String(card.description || ''); els.cardTargetStamps.value = String(card.targetStamps || 10); els.cardRewardTitle.value = String(card.rewardTitle || ''); els.cardStatus.value = String(card.status || 'draft'); els.cardAccent.value = safeAccent(card.accent); updateAccentValue(); renderRewardRows(card.rewards && card.rewards.length ? card.rewards : [legacyRewardFromCard(card)]); els.editorKicker.textContent = 'Edit reward card'; els.editorTitle.textContent = String(card.title || '編輯集點卡'); updateEditorStatus(card.status); renderCardList();
  }

  function resetCardForm() { state.selectedCardId = ''; els.cardForm.reset(); els.cardId.value = ''; els.cardExpectedUpdatedAt.value = ''; els.cardTargetStamps.value = '10'; els.cardStatus.value = 'draft'; els.cardAccent.value = '#e47845'; els.cardRewardTitle.value = ''; updateAccentValue(); renderRewardRows([defaultReward(10)]); els.editorKicker.textContent = 'Create reward card'; els.editorTitle.textContent = '新增集點卡'; updateEditorStatus('draft'); hideMessage(els.cardFormMessage); renderCardList(); }

  async function saveCard(event) {
    event.preventDefault(); hideMessage(els.cardFormMessage); const title = String(els.cardTitle.value || '').trim(); const targetStamps = Number(els.cardTargetStamps.value); const rewards = collectRewards(); const validationMessage = validateRewardEditor(title, targetStamps, rewards); if (validationMessage) { showMessage(els.cardFormMessage, validationMessage); return; }
    const rewardTitle = rewards[rewards.length - 1].rewardTitle;
    setSaving(els.saveCardButton, true); try { const result = await window.MemberSystem.request(state.config, 'admin', state.idToken, 'admin.pointcards.save', { card: { cardId: els.cardId.value, title, description: String(els.cardDescription.value || '').trim(), targetStamps, rewardTitle, rewards, status: els.cardStatus.value, accent: safeAccent(els.cardAccent.value) }, expectedUpdatedAt: els.cardExpectedUpdatedAt.value }); const saved = result.card; state.cards = saved ? replaceById(state.cards, saved, 'cardId') : state.cards; state.selectedCardId = saved && saved.cardId || ''; renderAll(); if (saved) loadCardForm(saved.cardId); showMessage(els.cardFormMessage, '已儲存，會員端下次更新時會看到最新設定。', true); } catch (error) { handleActionError(error, els.cardFormMessage); } finally { setSaving(els.saveCardButton, false); }
  }

  function defaultReward(thresholdStamps) { return { thresholdStamps, rewardType: 'coupon', rewardTitle: '', rewardDescription: '', lotteryWinRate: 0 }; }
  function legacyRewardFromCard(card) { return { thresholdStamps: Number(card.targetStamps || 10), rewardType: 'coupon', rewardTitle: String(card.rewardTitle || ''), rewardDescription: '', lotteryWinRate: 0 }; }
  function renderRewardRows(rewards) { els.rewardRows.replaceChildren(...rewards.map((reward, index) => createRewardRow(reward, index))); updateRewardEditorHint(); }
  function createRewardRow(reward, index) {
    const row = document.createElement('article'); row.className = 'reward-row-editor'; row.dataset.rewardRow = 'true';
    const heading = document.createElement('div'); heading.className = 'reward-row-heading'; const label = document.createElement('strong'); label.textContent = `節點 ${index + 1}`; const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'text-button remove-reward'; remove.dataset.removeReward = 'true'; remove.setAttribute('aria-label', `刪除節點 ${index + 1}`); remove.textContent = '刪除'; heading.append(label, remove);
    const grid = document.createElement('div'); grid.className = 'reward-row-grid';
    grid.append(fieldLabel('達到點數', 'number', reward.thresholdStamps, { field: 'thresholdStamps', min: '1', max: '100', step: '1', suffix: '點' }), fieldLabel('獎勵類型', 'select', reward.rewardType, { field: 'rewardType', options: [['coupon', '優惠券'], ['lottery', '抽獎券']] }));
    grid.append(fieldLabel('獎勵名稱', 'text', reward.rewardTitle, { field: 'rewardTitle', maxlength: '100', placeholder: '例如：免費兌換中杯咖啡' }), fieldLabel('獎勵說明（選填）', 'text', reward.rewardDescription, { field: 'rewardDescription', maxlength: '240', placeholder: '例如：限平日使用' }));
    const lotteryField = fieldLabel('中獎率', 'number', reward.lotteryWinRate, { field: 'lotteryWinRate', min: '0', max: '100', step: '0.01', suffix: '%', hidden: reward.rewardType !== 'lottery' }); lotteryField.classList.add('lottery-rate-field'); grid.append(lotteryField);
    row.append(heading, grid); return row;
  }
  function fieldLabel(labelText, type, value, options) {
    const label = document.createElement('label'); label.className = options.hidden ? 'hidden' : ''; label.dataset.fieldLabel = options.field;
    const caption = document.createElement('span'); caption.textContent = labelText; label.append(caption);
    let input;
    if (type === 'select') { input = document.createElement('select'); (options.options || []).forEach(([optionValue, optionLabel]) => { const option = document.createElement('option'); option.value = optionValue; option.textContent = optionLabel; input.append(option); }); input.value = String(value || 'coupon'); } else { input = document.createElement('input'); input.type = type; input.value = value === undefined || value === null ? '' : String(value); if (options.min) input.min = options.min; if (options.max) input.max = options.max; if (options.step) input.step = options.step; if (options.maxlength) input.maxLength = Number(options.maxlength); if (options.placeholder) input.placeholder = options.placeholder; }
    input.dataset.field = options.field; if (options.suffix) { const suffix = document.createElement('span'); suffix.className = 'field-suffix'; suffix.textContent = options.suffix; label.append(input, suffix); } else label.append(input); return label;
  }
  function addRewardRow() { const rewards = collectRewards(); rewards.push(defaultReward(Number(els.cardTargetStamps.value) || 10)); renderRewardRows(rewards); const rows = els.rewardRows.querySelectorAll('[data-reward-row]'); const lastInput = rows[rows.length - 1] && rows[rows.length - 1].querySelector('[data-field="rewardTitle"]'); if (lastInput) lastInput.focus(); }
  function collectRewards() { return Array.from(els.rewardRows.querySelectorAll('[data-reward-row]')).map((row) => ({ thresholdStamps: Number(row.querySelector('[data-field="thresholdStamps"]')?.value), rewardType: String(row.querySelector('[data-field="rewardType"]')?.value || 'coupon'), rewardTitle: String(row.querySelector('[data-field="rewardTitle"]')?.value || '').trim(), rewardDescription: String(row.querySelector('[data-field="rewardDescription"]')?.value || '').trim(), lotteryWinRate: Number(row.querySelector('[data-field="lotteryWinRate"]')?.value) })); }
  function handleRewardRowsInput(event) { const row = event.target.closest('[data-reward-row]'); if (!row) return; if (event.target.dataset.field === 'rewardType') { const rateField = row.querySelector('[data-field-label="lotteryWinRate"]'); const lottery = event.target.value === 'lottery'; rateField.classList.toggle('hidden', !lottery); if (!lottery) rateField.querySelector('[data-field="lotteryWinRate"]').value = '0'; } updateRewardEditorHint(); }
  function updateRewardEditorHint() { const rewards = collectRewards(); const target = Number(els.cardTargetStamps.value); const duplicate = rewards.some((reward, index) => rewards.findIndex((item) => item.thresholdStamps === reward.thresholdStamps) !== index); els.rewardEditorHint.textContent = duplicate ? '有節點使用相同點數，請調整後再儲存。' : rewards.length ? `${rewards.length} 個節點 · 最後一個節點為 ${Math.max(...rewards.map((reward) => reward.thresholdStamps || 0)) || '—'} 點${Number.isInteger(target) ? `／完成點數 ${target} 點` : ''}` : '請至少新增 1 個節點。'; els.rewardEditorHint.classList.toggle('warning', duplicate); }
  function validateRewardEditor(title, target, rewards) { if (!title || title.length > 80) return '請填寫卡片名稱（最多 80 字）。'; if (!Number.isInteger(target) || target < 1 || target > 100) return '完成點數必須是 1–100 的整數。'; if (!rewards.length || rewards.length > 30) return '請至少設定 1 個節點，最多 30 個節點。'; const thresholds = new Set(); for (const reward of rewards) { if (!Number.isInteger(reward.thresholdStamps) || reward.thresholdStamps < 1 || reward.thresholdStamps > target) return '節點點數必須是整數，且不可超過完成點數。'; if (thresholds.has(reward.thresholdStamps)) return '每個點數只能設定一個節點。'; thresholds.add(reward.thresholdStamps); if (!reward.rewardTitle || reward.rewardTitle.length > 100) return '每個節點都需要填寫獎勵名稱。'; if (reward.rewardDescription.length > 240) return '獎勵說明最多 240 字。'; if (reward.rewardType === 'lottery' && (!Number.isFinite(reward.lotteryWinRate) || reward.lotteryWinRate < 0 || reward.lotteryWinRate > 100)) return '抽獎券中獎率必須介於 0–100%。'; } return ''; }

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
