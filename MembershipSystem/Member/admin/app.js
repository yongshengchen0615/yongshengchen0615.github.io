(() => {
  'use strict';

  const state = { config: null, idToken: '', members: [], memberPage: { page: 1, pageSize: 100, total: 0, totalPages: 1, query: '' }, memberSearchTimer: null, memberRequestVersion: 0, cards: [], tickets: [], stats: {}, activePanel: 'members', selectedCardId: '', selectedTicketId: '', stampRequestId: '', serviceTimeRequestId: '' };
  const els = {};

  window.addEventListener('DOMContentLoaded', () => {
    [
      'app', 'loadingView', 'errorView', 'errorTitle', 'errorMessage', 'pendingBox', 'pendingUserId', 'retryButton', 'adminView', 'displayName', 'roleLabel', 'logoutButton',
      'membersTab', 'cardsTab', 'ticketsTab', 'memberCount', 'activeMemberCount', 'activeCardCount', 'todayEntryCount', 'membersPanel', 'cardsPanel', 'ticketsPanel', 'syncStatus', 'refreshButton',
      'memberSearch', 'memberResultCount', 'memberTableBody', 'memberEmptyState', 'memberPagination', 'memberPrevPageButton', 'memberPageStatus', 'memberNextPageButton',
      'newCardButton', 'cardResultCount', 'cardListItems', 'cardEmptyState', 'editorKicker', 'editorTitle', 'editorStatus', 'cardForm', 'cardId', 'cardExpectedUpdatedAt', 'cardTitle', 'cardDescription', 'cardStatus', 'cardExpiryMode', 'cardExpiresOnField', 'cardExpiresOn', 'cardAccent', 'accentValue', 'rewardRows', 'addRewardButton', 'rewardEditorHint', 'cardFormMessage', 'resetCardButton', 'archiveCardButton', 'deleteCardButton', 'saveCardButton',
      'newTicketButton', 'ticketResultCount', 'ticketListItems', 'ticketEmptyState', 'ticketEditorKicker', 'ticketEditorTitle', 'ticketEditorStatus', 'ticketForm', 'ticketTemplateId', 'ticketExpectedUpdatedAt', 'ticketTitle', 'ticketType', 'ticketDescription', 'ticketUsageMethod', 'ticketUsageInstructions', 'ticketStatus', 'ticketPrizeEditor', 'ticketPrizeRows', 'addTicketPrizeButton', 'balanceTicketPrizesButton', 'ticketPrizeTotal', 'ticketFormMessage', 'resetTicketButton', 'saveTicketButton',
      'memberModal', 'closeMemberModal', 'memberForm', 'memberLineUserId', 'memberExpectedUpdatedAt', 'memberIdentity', 'memberTier', 'memberStatus', 'memberFormMessage', 'cancelMemberButton', 'saveMemberButton',
      'stampModal', 'closeStampModal', 'stampForm', 'stampMemberId', 'stampMemberName', 'stampCardId', 'stampAmount', 'stampNote', 'stampFormMessage', 'cancelStampButton', 'saveStampButton',
      'serviceTimeModal', 'closeServiceTimeModal', 'serviceTimeForm', 'serviceTimeMemberId', 'serviceTimeMemberName', 'serviceTimeMinutes', 'serviceTimeNote', 'serviceTimeFormMessage', 'cancelServiceTimeButton', 'saveServiceTimeButton'
    ].forEach((id) => { els[id] = document.getElementById(id); });
    bindEvents();
    boot();
  });

  function bindEvents() {
    els.retryButton.addEventListener('click', () => window.location.reload());
    els.logoutButton.addEventListener('click', () => window.MemberSystem.logout());
    els.membersTab.addEventListener('click', () => switchPanel('members'));
    els.cardsTab.addEventListener('click', () => switchPanel('cards'));
    els.ticketsTab.addEventListener('click', () => switchPanel('tickets'));
    els.refreshButton.addEventListener('click', () => refreshData(true).catch((error) => { els.syncStatus.textContent = error && error.message || '同步失敗，請稍後再試。'; els.syncStatus.classList.add('error'); }));
    els.memberSearch.addEventListener('input', scheduleMemberSearch);
    els.memberPrevPageButton.addEventListener('click', () => loadMembersPage(state.memberPage.page - 1, state.memberPage.query));
    els.memberNextPageButton.addEventListener('click', () => loadMembersPage(state.memberPage.page + 1, state.memberPage.query));
    els.memberTableBody.addEventListener('click', handleMemberTableClick);
    els.newCardButton.addEventListener('click', resetCardForm);
    els.cardListItems.addEventListener('click', (event) => { const button = event.target instanceof Element ? event.target.closest('[data-card-id]') : null; if (button) loadCardForm(button.dataset.cardId); });
    els.addRewardButton.addEventListener('click', addRewardRow);
    els.rewardRows.addEventListener('input', updateRewardEditorHint);
    els.rewardRows.addEventListener('change', updateRewardEditorHint);
    els.rewardRows.addEventListener('click', (event) => { const button = event.target instanceof Element ? event.target.closest('[data-remove-reward]') : null; if (button) { button.closest('[data-reward-row]')?.remove(); updateRewardEditorHint(); } });
    els.cardExpiryMode.addEventListener('change', updateCardExpiryUI);
    els.cardAccent.addEventListener('input', updateAccentValue);
    els.cardForm.addEventListener('submit', saveCard);
    els.resetCardButton.addEventListener('click', resetCardForm);
    els.archiveCardButton.addEventListener('click', archiveCard);
    els.deleteCardButton.addEventListener('click', deleteCard);
    els.newTicketButton.addEventListener('click', resetTicketForm);
    els.ticketListItems.addEventListener('click', (event) => { const button = event.target instanceof Element ? event.target.closest('[data-ticket-template-id]') : null; if (button) loadTicketForm(button.dataset.ticketTemplateId); });
    els.ticketType.addEventListener('change', updateTicketTypeUI);
    els.ticketPrizeRows.addEventListener('input', updateTicketPrizeTotal);
    els.ticketPrizeRows.addEventListener('click', (event) => { const button = event.target instanceof Element ? event.target.closest('[data-remove-ticket-prize]') : null; if (button) { button.closest('[data-ticket-prize-row]')?.remove(); updateTicketPrizeTotal(); } });
    els.addTicketPrizeButton.addEventListener('click', () => { renderTicketPrizeRows([...collectTicketPrizes(), defaultPrize(0)]); });
    els.balanceTicketPrizesButton.addEventListener('click', balanceTicketPrizes);
    els.ticketForm.addEventListener('submit', saveTicket);
    els.resetTicketButton.addEventListener('click', resetTicketForm);
    els.memberForm.addEventListener('submit', saveMember);
    els.cancelMemberButton.addEventListener('click', closeMemberModal);
    els.closeMemberModal.addEventListener('click', closeMemberModal);
    els.memberModal.addEventListener('click', (event) => { if (event.target === els.memberModal) closeMemberModal(); });
    els.stampForm.addEventListener('submit', saveStamp);
    els.cancelStampButton.addEventListener('click', closeStampModal);
    els.closeStampModal.addEventListener('click', closeStampModal);
    els.stampModal.addEventListener('click', (event) => { if (event.target === els.stampModal) closeStampModal(); });
    els.serviceTimeForm.addEventListener('submit', saveServiceTime);
    els.cancelServiceTimeButton.addEventListener('click', closeServiceTimeModal);
    els.closeServiceTimeModal.addEventListener('click', closeServiceTimeModal);
    els.serviceTimeModal.addEventListener('click', (event) => { if (event.target === els.serviceTimeModal) closeServiceTimeModal(); });
    document.addEventListener('keydown', (event) => { if (event.key !== 'Escape') return; closeMemberModal(); closeStampModal(); closeServiceTimeModal(); });
  }

  async function boot() {
    setView('loading');
    try {
      state.config = await window.MemberSystem.loadConfig();
      state.idToken = await window.MemberSystem.signIn(state.config, 'admin');
      await refreshData(false);
      setView('admin');
    } catch (error) { handleBootError(error); } finally { els.app.setAttribute('aria-busy', 'false'); }
  }

  async function refreshData(showBusy) {
    if (showBusy) { els.refreshButton.disabled = true; els.syncStatus.textContent = '同步中…'; }
    try {
      const result = await window.MemberSystem.request(state.config, 'admin', state.idToken, 'admin.bootstrap', memberPagePayload(state.memberPage.page, state.memberPage.query));
      state.members = Array.isArray(result.members) ? result.members : [];
      applyMemberPage(result.memberPage, state.memberPage);
      state.cards = Array.isArray(result.cards) ? result.cards : [];
      state.tickets = Array.isArray(result.tickets) ? result.tickets : [];
      state.stats = result.stats || {};
      els.displayName.textContent = String(result.profile && result.profile.displayName || '管理員');
      els.roleLabel.textContent = String(result.role || 'Admin');
      renderAll();
      els.syncStatus.textContent = `已同步 · ${new Date().toLocaleTimeString('zh-Hant-TW', { hour: '2-digit', minute: '2-digit' })}`;
      els.syncStatus.classList.remove('error');
    } finally { if (showBusy) els.refreshButton.disabled = false; }
  }

  function renderAll() {
    els.memberCount.textContent = String(state.stats.memberCount ?? state.members.length);
    els.activeMemberCount.textContent = String(state.stats.activeMemberCount ?? state.members.filter((member) => member.status === 'active').length);
    els.activeCardCount.textContent = String(state.stats.activeCardCount ?? state.cards.filter((card) => card.status === 'active').length);
    els.todayEntryCount.textContent = String(state.stats.todayEntryCount ?? 0);
    renderMembers(); renderCardList(); renderTicketList();
    if (state.selectedCardId && state.cards.some((card) => card.cardId === state.selectedCardId)) loadCardForm(state.selectedCardId); else if (!els.cardId.value) resetCardForm();
    if (state.selectedTicketId && state.tickets.some((ticket) => ticket.ticketTemplateId === state.selectedTicketId)) loadTicketForm(state.selectedTicketId); else if (!els.ticketTemplateId.value) resetTicketForm();
  }

  function renderMembers() {
    const members = state.members;
    const page = state.memberPage;
    els.memberResultCount.textContent = `共 ${page.total} 位會員`;
    els.memberTableBody.replaceChildren(...members.map((member) => {
      const row = document.createElement('tr');
      const memberCell = document.createElement('td'); memberCell.append(createMemberIdentity(member));
      const tierCell = document.createElement('td'); const tier = document.createElement('span'); tier.className = 'tier-text'; tier.textContent = String(member.tier || '一般會員'); tierCell.append(tier);
      const statusCell = document.createElement('td'); const status = document.createElement('span'); status.className = `status-pill${member.status === 'active' ? '' : ' disabled'}`; status.textContent = member.status === 'active' ? '啟用中' : '已停用'; statusCell.append(status);
      const serviceTimeCell = document.createElement('td'); serviceTimeCell.textContent = formatServiceMinutes(member.serviceMinutesTotal);
      const dateCell = document.createElement('td'); dateCell.textContent = window.MemberSystem.formatDate(member.joinedAt);
      const actionsCell = document.createElement('td'); actionsCell.className = 'align-right'; const actions = document.createElement('div'); actions.className = 'row-actions'; actions.append(actionButton('編輯', 'edit-member', member.lineUserId), actionButton('＋ 集點', 'add-stamp', member.lineUserId, true), actionButton('＋ 服務時間', 'add-service-time', member.lineUserId)); actionsCell.append(actions);
      row.append(memberCell, tierCell, statusCell, serviceTimeCell, dateCell, actionsCell); return row;
    }));
    els.memberEmptyState.classList.toggle('hidden', members.length !== 0);
    renderMemberPagination();
  }

  function memberPagePayload(page, query) { return { memberPage: Math.max(1, Number(page) || 1), memberPageSize: state.memberPage.pageSize || 100, memberQuery: String(query || '').trim() }; }
  function applyMemberPage(value, fallback) {
    const source = value && typeof value === 'object' ? value : fallback || {};
    const pageSize = Math.max(1, Number(source.pageSize) || 100);
    const total = Math.max(0, Number(source.total) || 0);
    const totalPages = Math.max(1, Number(source.totalPages) || Math.ceil(total / pageSize) || 1);
    state.memberPage = { page: Math.min(Math.max(1, Number(source.page) || 1), totalPages), pageSize, total, totalPages, query: String(source.query || '').trim() };
  }
  function renderMemberPagination() {
    const page = state.memberPage;
    els.memberPagination.classList.toggle('hidden', page.totalPages <= 1);
    els.memberPrevPageButton.disabled = page.page <= 1;
    els.memberNextPageButton.disabled = page.page >= page.totalPages;
    els.memberPageStatus.textContent = `第 ${page.page} / ${page.totalPages} 頁`;
  }
  function scheduleMemberSearch() {
    if (state.memberSearchTimer) window.clearTimeout(state.memberSearchTimer);
    const query = String(els.memberSearch.value || '').trim().toLowerCase();
    if (query === state.memberPage.query) return;
    state.memberSearchTimer = window.setTimeout(() => {
      state.memberSearchTimer = null;
      loadMembersPage(1, query).catch((error) => { setSyncStatus(error && error.message || '搜尋會員失敗，請稍後再試。', true); });
    }, 250);
  }
  async function loadMembersPage(page, query) {
    const requestVersion = ++state.memberRequestVersion;
    els.memberPrevPageButton.disabled = true;
    els.memberNextPageButton.disabled = true;
    try {
      const result = await window.MemberSystem.request(state.config, 'admin', state.idToken, 'admin.members.list', memberPagePayload(page, query));
      if (requestVersion !== state.memberRequestVersion) return;
      state.members = Array.isArray(result.members) ? result.members : [];
      applyMemberPage(result.memberPage, state.memberPage);
      renderMembers();
    } catch (error) {
      if (requestVersion === state.memberRequestVersion) renderMemberPagination();
      throw error;
    }
  }

  function createMemberIdentity(member) {
    const wrapper = document.createElement('div'); wrapper.className = 'member-cell'; const avatar = document.createElement('span'); avatar.className = 'member-avatar'; avatar.textContent = window.MemberSystem.initials(member.displayName); const copy = document.createElement('div'); const name = document.createElement('strong'); name.textContent = String(member.displayName || 'LINE 使用者'); const code = document.createElement('small'); code.textContent = String(member.memberCode || '尚未建立'); copy.append(name, code); wrapper.append(avatar, copy); return wrapper;
  }

  function actionButton(label, action, value, accent) { const button = document.createElement('button'); button.type = 'button'; button.className = `small-button${accent ? ' accent' : ''}`; button.dataset.action = action; button.dataset.value = String(value || ''); button.textContent = label; return button; }
  function handleMemberTableClick(event) { const button = event.target instanceof Element ? event.target.closest('[data-action]') : null; if (!button) return; const member = state.members.find((item) => item.lineUserId === button.dataset.value); if (!member) return; if (button.dataset.action === 'edit-member') openMemberModal(member); if (button.dataset.action === 'add-stamp') openStampModal(member); if (button.dataset.action === 'add-service-time') openServiceTimeModal(member); }

  function renderCardList() {
    els.cardResultCount.textContent = String(state.cards.length); els.cardEmptyState.classList.toggle('hidden', state.cards.length !== 0);
    els.cardListItems.replaceChildren(...state.cards.map((card) => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'card-list-item'; button.dataset.cardId = String(card.cardId); button.setAttribute('aria-selected', String(card.cardId) === state.selectedCardId ? 'true' : 'false'); button.style.setProperty('--card-accent', safeAccent(card.accent));
      const title = document.createElement('strong'); const dot = document.createElement('i'); title.append(dot, document.createTextNode(String(card.title || '未命名集點卡')));
      const meta = document.createElement('small'); const expiry = card.expiryMode === 'date' && card.expiresOn ? `到期 ${card.expiresOn}` : '無期限'; meta.textContent = `${Array.isArray(card.rewards) ? card.rewards.length : 0} 個兌換節點 · ${expiry} · ${statusLabel(card.status)}`;
      button.append(title, meta); return button;
    }));
  }

  function loadCardForm(cardId) {
    const card = state.cards.find((item) => item.cardId === cardId); if (!card) return;
    state.selectedCardId = cardId; els.cardId.value = String(card.cardId); els.cardExpectedUpdatedAt.value = String(card.updatedAt || ''); els.cardTitle.value = String(card.title || ''); els.cardDescription.value = String(card.description || ''); els.cardStatus.value = String(card.status || 'draft'); els.cardExpiryMode.value = String(card.expiryMode || 'unlimited'); els.cardExpiresOn.value = String(card.expiresOn || ''); updateCardExpiryUI(); els.cardAccent.value = safeAccent(card.accent); updateAccentValue(); renderRewardRows(card.rewards && card.rewards.length ? card.rewards : [defaultReward(5)]); els.editorKicker.textContent = 'Edit points card'; els.editorTitle.textContent = String(card.title || '編輯集點卡'); updateEditorStatus(els.editorStatus, card.status); els.archiveCardButton.disabled = card.status === 'archived'; els.archiveCardButton.textContent = card.status === 'archived' ? '已封存集點卡' : '封存集點卡'; els.deleteCardButton.disabled = false; hideMessage(els.cardFormMessage); renderCardList();
  }

  function resetCardForm() {
    state.selectedCardId = ''; els.cardForm.reset(); els.cardId.value = ''; els.cardExpectedUpdatedAt.value = ''; els.cardStatus.value = 'draft'; els.cardExpiryMode.value = 'unlimited'; els.cardExpiresOn.value = ''; els.cardAccent.value = '#e47845'; updateCardExpiryUI(); updateAccentValue(); renderRewardRows([defaultReward(5)]); els.editorKicker.textContent = 'Create points card'; els.editorTitle.textContent = '新增集點卡'; updateEditorStatus(els.editorStatus, 'draft'); els.archiveCardButton.disabled = true; els.archiveCardButton.textContent = '先儲存後才能封存'; els.deleteCardButton.disabled = true; hideMessage(els.cardFormMessage); renderCardList();
  }

  function defaultReward(thresholdStamps) { return { thresholdStamps, consumeStamps: thresholdStamps, ticketTemplateId: '' }; }
  function updateCardExpiryUI() { const limited = els.cardExpiryMode.value === 'date'; els.cardExpiresOnField.classList.toggle('hidden', !limited); els.cardExpiresOn.required = limited; }
  function validateCardExpiry(mode, expiresOn) { if (mode === 'unlimited') return ''; if (mode !== 'date' || !/^\d{4}-\d{2}-\d{2}$/.test(expiresOn)) return '請選擇有效的集點卡到期日。'; const parts = expiresOn.split('-').map(Number); const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2])); return date.getUTCFullYear() === parts[0] && date.getUTCMonth() === parts[1] - 1 && date.getUTCDate() === parts[2] ? '' : '請選擇有效的集點卡到期日。'; }

  function activeTicketOptions(currentTicketTemplateId) {
    const tickets = state.tickets.filter((ticket) => ticket.status === 'active' || ticket.ticketTemplateId === currentTicketTemplateId);
    return [['', state.tickets.some((ticket) => ticket.status === 'active') ? '請選擇票券' : '請先到「票券」頁新增並啟用票券']].concat(tickets.map((ticket) => [ticket.ticketTemplateId, `${ticket.title || '未命名票券'} · ${ticket.ticketType === 'lottery' ? '抽獎券' : '優惠券'}${ticket.status === 'active' ? '' : '（未啟用）'}`]));
  }

  function renderRewardRows(rewards) { els.rewardRows.replaceChildren(...rewards.map((reward, index) => createRewardRow(reward, index))); updateRewardEditorHint(); }
  function createRewardRow(reward, index) {
    const row = document.createElement('article'); row.className = 'reward-row-editor'; row.dataset.rewardRow = 'true';
    const heading = document.createElement('div'); heading.className = 'reward-row-heading'; const label = document.createElement('strong'); label.textContent = `節點 ${index + 1}`; const summary = document.createElement('span'); summary.className = 'reward-row-summary'; summary.dataset.rewardSummary = 'true'; const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'text-button remove-reward'; remove.dataset.removeReward = 'true'; remove.textContent = '刪除'; heading.append(label, summary, remove);
    const grid = document.createElement('div'); grid.className = 'reward-row-grid'; grid.append(fieldLabel('需要集到', 'number', reward.thresholdStamps, { field: 'thresholdStamps', min: '1', max: '100', step: '1', suffix: '點' }), fieldLabel('兌換消耗', 'number', reward.consumeStamps === undefined ? reward.thresholdStamps : reward.consumeStamps, { field: 'consumeStamps', min: '1', max: '100', step: '1', suffix: '點' }), fieldLabel('選擇票券', 'select', reward.ticketTemplateId, { field: 'ticketTemplateId', options: activeTicketOptions(String(reward.ticketTemplateId || '')) })); row.append(heading, grid); return row;
  }
  function fieldLabel(labelText, type, value, options) {
    const label = document.createElement('label'); label.dataset.fieldLabel = options.field; const caption = document.createElement('span'); caption.textContent = labelText; label.append(caption); let input;
    if (type === 'select') { input = document.createElement('select'); (options.options || []).forEach(([optionValue, optionLabel]) => { const option = document.createElement('option'); option.value = optionValue; option.textContent = optionLabel; input.append(option); }); input.value = String(value || ''); } else { input = document.createElement('input'); input.type = type; input.value = value === undefined || value === null ? '' : String(value); if (options.min) input.min = options.min; if (options.max) input.max = options.max; if (options.step) input.step = options.step; if (options.maxlength) input.maxLength = Number(options.maxlength); if (options.placeholder) input.placeholder = options.placeholder; }
    input.dataset.field = options.field; if (options.suffix) { const suffix = document.createElement('span'); suffix.className = 'field-suffix'; suffix.textContent = options.suffix; label.append(input, suffix); } else label.append(input); return label;
  }
  function addRewardRow() { const rewards = collectRewards(); const highest = rewards.reduce((max, reward) => Math.max(max, Number(reward.thresholdStamps) || 0), 0); rewards.push(defaultReward(Math.min(100, highest + 5 || 5))); renderRewardRows(rewards); els.rewardRows.querySelector('[data-reward-row]:last-child [data-field="ticketTemplateId"]')?.focus(); }
  function collectRewards() { return Array.from(els.rewardRows.querySelectorAll('[data-reward-row]')).map((row) => ({ thresholdStamps: Number(row.querySelector('[data-field="thresholdStamps"]')?.value), consumeStamps: Number(row.querySelector('[data-field="consumeStamps"]')?.value), ticketTemplateId: String(row.querySelector('[data-field="ticketTemplateId"]')?.value || '').trim() })); }
  function updateRewardEditorHint() {
    const rewards = collectRewards(); const duplicate = rewards.some((reward, index) => rewards.findIndex((item) => item.thresholdStamps === reward.thresholdStamps) !== index); const invalidConsume = rewards.some((reward) => !Number.isInteger(reward.consumeStamps) || reward.consumeStamps < 1 || reward.consumeStamps > reward.thresholdStamps); const missingTicket = rewards.some((reward) => !reward.ticketTemplateId);
    els.rewardRows.querySelectorAll('[data-reward-row]').forEach((row) => { const threshold = Number(row.querySelector('[data-field="thresholdStamps"]')?.value); const consume = Number(row.querySelector('[data-field="consumeStamps"]')?.value); const ticket = state.tickets.find((item) => item.ticketTemplateId === row.querySelector('[data-field="ticketTemplateId"]')?.value); const summary = row.querySelector('[data-reward-summary]'); if (summary) summary.textContent = Number.isInteger(threshold) && threshold > 0 ? `集到 ${threshold} 點 · 兌換消耗 ${Number.isInteger(consume) && consume > 0 ? consume : '—'} 點 · ${ticket ? ticket.title : '尚未選擇票券'}` : '請先設定點數節點'; });
    els.rewardEditorHint.textContent = duplicate ? '有節點使用相同點數，請調整後再儲存。' : invalidConsume ? '兌換消耗點數必須至少 1 點，且不可超過需要集到的點數。' : missingTicket ? '每個節點都要選擇一張已啟用票券。' : `${rewards.length} 個兌換節點 · 票券內容請統一在「票券」頁管理。`; els.rewardEditorHint.classList.toggle('warning', duplicate || invalidConsume || missingTicket);
  }
  function validateRewardEditor(title, rewards) { if (!title || title.length > 80) return '請填寫卡片名稱（最多 80 字）。'; if (!rewards.length || rewards.length > 30) return '請至少設定 1 個兌換節點，最多 30 個節點。'; const thresholds = new Set(); for (const reward of rewards) { if (!Number.isInteger(reward.thresholdStamps) || reward.thresholdStamps < 1 || reward.thresholdStamps > 100) return '需要集到的點數必須是 1–100 的整數。'; if (thresholds.has(reward.thresholdStamps)) return '每個點數只能設定一個節點。'; thresholds.add(reward.thresholdStamps); if (!Number.isInteger(reward.consumeStamps) || reward.consumeStamps < 1 || reward.consumeStamps > reward.thresholdStamps) return '兌換消耗點數必須至少 1 點，且不可超過需要集到的點數。'; if (!reward.ticketTemplateId) return '請為每個節點選擇一張票券。'; } return ''; }
  async function saveCard(event) {
    event.preventDefault(); hideMessage(els.cardFormMessage);
    const rewards = collectRewards(); const expiryMode = String(els.cardExpiryMode.value || 'unlimited'); const expiresOn = String(els.cardExpiresOn.value || '').trim();
    const validationMessage = validateRewardEditor(String(els.cardTitle.value || '').trim(), rewards) || validateCardExpiry(expiryMode, expiresOn);
    if (validationMessage) return showMessage(els.cardFormMessage, validationMessage);
    setSaving(els.saveCardButton, true);
    try {
      const result = await window.MemberSystem.request(state.config, 'admin', state.idToken, 'admin.pointcards.save', { card: { cardId: els.cardId.value, title: String(els.cardTitle.value || '').trim(), description: String(els.cardDescription.value || '').trim(), rewardTitle: '', rewards, status: els.cardStatus.value, expiryMode, expiresOn, accent: safeAccent(els.cardAccent.value) }, expectedUpdatedAt: els.cardExpectedUpdatedAt.value });
      if (result.card) { state.cards = replaceById(state.cards, result.card, 'cardId'); loadCardForm(result.card.cardId); }
      if (await refreshAfterSuccessfulWrite('集點卡已儲存', els.cardFormMessage)) showMessage(els.cardFormMessage, '已儲存，會員端下次更新時會看到最新設定。', true);
    } catch (error) { handleActionError(error, els.cardFormMessage); } finally { setSaving(els.saveCardButton, false); }
  }

  async function archiveCard() {
    const cardId = String(els.cardId.value || '').trim();
    if (!cardId || els.archiveCardButton.disabled) return;
    if (!window.confirm('封存後不再接受新的集點；會員端會同步隱藏這張卡與相關票券，但所有資料與歷史紀錄都會保留。確定要封存嗎？')) return;
    const originalText = els.archiveCardButton.textContent;
    els.archiveCardButton.disabled = true; els.archiveCardButton.textContent = '封存中…';
    try {
      const result = await window.MemberSystem.request(state.config, 'admin', state.idToken, 'admin.pointcards.archive', { cardId, expectedUpdatedAt: els.cardExpectedUpdatedAt.value });
      if (result.card) state.cards = replaceById(state.cards, result.card, 'cardId');
      if (result.card) loadCardForm(result.card.cardId);
      if (await refreshAfterSuccessfulWrite('集點卡已封存，所有資料仍保留', els.cardFormMessage)) showMessage(els.cardFormMessage, '集點卡已封存；會員端不再顯示，資料與歷史紀錄仍保留。', true);
    } catch (error) { handleActionError(error, els.cardFormMessage); } finally { if (els.cardId.value === cardId && els.cardStatus.value !== 'archived') { els.archiveCardButton.disabled = false; els.archiveCardButton.textContent = originalText; } }
  }

  async function deleteCard() {
    const cardId = String(els.cardId.value || '').trim();
    const cardTitle = String(els.cardTitle.value || '這張集點卡').trim();
    if (!cardId || els.deleteCardButton.disabled) return;
    if (!window.confirm(`永久刪除「${cardTitle}」後，集點卡、節點、票券、餘額、點數流水與相關歷史都會移除，無法復原。要繼續嗎？`)) return;
    if (!window.confirm('最後確認：這是永久刪除，不是封存。確定要刪除嗎？')) return;
    const originalText = els.deleteCardButton.textContent;
    els.deleteCardButton.disabled = true; els.deleteCardButton.textContent = '刪除中…';
    try {
      await window.MemberSystem.request(state.config, 'admin', state.idToken, 'admin.pointcards.delete', { cardId, expectedUpdatedAt: els.cardExpectedUpdatedAt.value });
      state.cards = state.cards.filter((card) => card.cardId !== cardId); state.selectedCardId = ''; resetCardForm();
      if (await refreshAfterSuccessfulWrite('集點卡已永久刪除', els.cardFormMessage)) showMessage(els.cardFormMessage, '集點卡與所有相關資料已永久刪除。', true);
    } catch (error) { handleActionError(error, els.cardFormMessage); } finally { if (els.cardId.value === cardId) { els.deleteCardButton.disabled = false; els.deleteCardButton.textContent = originalText; } }
  }

  function renderTicketList() {
    els.ticketResultCount.textContent = String(state.tickets.length); els.ticketEmptyState.classList.toggle('hidden', state.tickets.length !== 0);
    els.ticketListItems.replaceChildren(...state.tickets.map((ticket) => { const button = document.createElement('button'); button.type = 'button'; button.className = 'card-list-item'; button.dataset.ticketTemplateId = String(ticket.ticketTemplateId); button.setAttribute('aria-selected', String(ticket.ticketTemplateId) === state.selectedTicketId ? 'true' : 'false'); const title = document.createElement('strong'); title.textContent = String(ticket.title || '未命名票券'); const meta = document.createElement('small'); meta.textContent = `${ticket.ticketType === 'lottery' ? '抽獎券' : '優惠券'} · ${statusLabel(ticket.status)}`; button.append(title, meta); return button; }));
  }
  function loadTicketForm(ticketTemplateId) { const ticket = state.tickets.find((item) => item.ticketTemplateId === ticketTemplateId); if (!ticket) return; state.selectedTicketId = ticketTemplateId; els.ticketTemplateId.value = String(ticket.ticketTemplateId); els.ticketExpectedUpdatedAt.value = String(ticket.updatedAt || ''); els.ticketTitle.value = String(ticket.title || ''); els.ticketType.value = ticket.ticketType === 'lottery' ? 'lottery' : 'coupon'; els.ticketDescription.value = String(ticket.description || ''); els.ticketUsageMethod.value = String(ticket.usageMethod || ''); els.ticketUsageInstructions.value = String(ticket.usageInstructions || ''); els.ticketStatus.value = String(ticket.status || 'draft'); renderTicketPrizeRows(ticket.prizes && ticket.prizes.length ? ticket.prizes : [defaultPrize()]); updateTicketTypeUI(); els.ticketEditorKicker.textContent = 'Edit ticket'; els.ticketEditorTitle.textContent = String(ticket.title || '編輯票券'); updateEditorStatus(els.ticketEditorStatus, ticket.status); hideMessage(els.ticketFormMessage); renderTicketList(); }
  function resetTicketForm() { state.selectedTicketId = ''; els.ticketForm.reset(); els.ticketTemplateId.value = ''; els.ticketExpectedUpdatedAt.value = ''; els.ticketType.value = 'coupon'; els.ticketStatus.value = 'draft'; renderTicketPrizeRows([defaultPrize()]); updateTicketTypeUI(); els.ticketEditorKicker.textContent = 'Create ticket'; els.ticketEditorTitle.textContent = '新增票券'; updateEditorStatus(els.ticketEditorStatus, 'draft'); hideMessage(els.ticketFormMessage); renderTicketList(); }
  function defaultPrize(rate) { return { prizeTitle: '', prizeDescription: '', winRate: rate === undefined ? 100 : rate }; }
  function updateTicketTypeUI() { const lottery = els.ticketType.value === 'lottery'; els.ticketPrizeEditor.classList.toggle('hidden', !lottery); if (lottery && !els.ticketPrizeRows.children.length) renderTicketPrizeRows([defaultPrize()]); }
  function renderTicketPrizeRows(prizes) { els.ticketPrizeRows.replaceChildren(...prizes.map((prize, index) => { const row = document.createElement('div'); row.className = 'prize-row'; row.dataset.ticketPrizeRow = 'true'; row.append(fieldLabel(`獎項 ${index + 1} 名稱`, 'text', prize.prizeTitle, { field: 'ticketPrizeTitle', maxlength: '100', placeholder: '例如：免費蛋糕' }), fieldLabel('中獎機率', 'number', prize.winRate, { field: 'ticketPrizeRate', min: '0', max: '100', step: '0.01', suffix: '%' })); const description = fieldLabel('獎項說明（選填）', 'text', prize.prizeDescription, { field: 'ticketPrizeDescription', maxlength: '240', placeholder: '例如：可兌換任一蛋糕' }); description.classList.add('prize-description-field'); const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'text-button remove-prize'; remove.dataset.removeTicketPrize = 'true'; remove.textContent = '刪除'; row.append(description, remove); return row; })); updateTicketPrizeTotal(); }
  function collectTicketPrizes() { return Array.from(els.ticketPrizeRows.querySelectorAll('[data-ticket-prize-row]')).map((row) => ({ prizeTitle: String(row.querySelector('[data-field="ticketPrizeTitle"]')?.value || '').trim(), prizeDescription: String(row.querySelector('[data-field="ticketPrizeDescription"]')?.value || '').trim(), winRate: Number(row.querySelector('[data-field="ticketPrizeRate"]')?.value) })); }
  function updateTicketPrizeTotal() { const total = Math.round(collectTicketPrizes().reduce((sum, prize) => sum + (Number.isFinite(prize.winRate) ? prize.winRate : 0), 0) * 100); els.ticketPrizeTotal.textContent = `機率合計 ${formatRate(total / 100)}%${total === 10000 ? ' ✓' : '／還差 ' + formatRate((10000 - total) / 100) + '%'}`; els.ticketPrizeTotal.classList.toggle('warning', total !== 10000); }
  function balanceTicketPrizes() { const rows = Array.from(els.ticketPrizeRows.querySelectorAll('[data-ticket-prize-row]')); if (!rows.length) return; const base = Math.floor(10000 / rows.length); const remainder = 10000 - base * rows.length; rows.forEach((row, index) => { row.querySelector('[data-field="ticketPrizeRate"]').value = String((base + (index < remainder ? 1 : 0)) / 100); }); updateTicketPrizeTotal(); }
  function validateTicket(ticket) { if (!ticket.title || ticket.title.length > 100) return '請填寫票券名稱（最多 100 字）。'; if (!ticket.description || ticket.description.length > 240) return '請填寫票券說明（最多 240 字）。'; if (!ticket.usageMethod || ticket.usageMethod.length > 120) return '請填寫使用方式（最多 120 字）。'; if (!ticket.usageInstructions || ticket.usageInstructions.length > 500) return '請填寫使用說明（最多 500 字）。'; if (ticket.ticketType !== 'lottery') return ''; if (!ticket.prizes.length || ticket.prizes.length > 30) return '抽獎券至少要設定 1 個獎項，最多 30 個獎項。'; let total = 0; for (const prize of ticket.prizes) { if (!prize.prizeTitle || prize.prizeTitle.length > 100) return '每個抽獎獎項都需要填寫名稱。'; if (prize.prizeDescription.length > 240) return '獎項說明最多 240 字。'; if (!Number.isFinite(prize.winRate) || prize.winRate < 0 || prize.winRate > 100) return '每個獎項機率必須介於 0–100%。'; total += Math.round(prize.winRate * 100); } return total === 10000 ? '' : '同一張抽獎券的獎項機率合計必須正好是 100%。'; }
  async function saveTicket(event) {
    event.preventDefault(); hideMessage(els.ticketFormMessage);
    const ticket = { ticketTemplateId: els.ticketTemplateId.value, title: String(els.ticketTitle.value || '').trim(), ticketType: els.ticketType.value, description: String(els.ticketDescription.value || '').trim(), usageMethod: String(els.ticketUsageMethod.value || '').trim(), usageInstructions: String(els.ticketUsageInstructions.value || '').trim(), status: els.ticketStatus.value, prizes: els.ticketType.value === 'lottery' ? collectTicketPrizes() : [] };
    const validationMessage = validateTicket(ticket);
    if (validationMessage) return showMessage(els.ticketFormMessage, validationMessage);
    setSaving(els.saveTicketButton, true);
    try {
      const result = await window.MemberSystem.request(state.config, 'admin', state.idToken, 'admin.tickets.save', { ticket, expectedUpdatedAt: els.ticketExpectedUpdatedAt.value });
      if (result.ticket) { state.tickets = replaceById(state.tickets, result.ticket, 'ticketTemplateId'); loadTicketForm(result.ticket.ticketTemplateId); }
      if (await refreshAfterSuccessfulWrite('票券已儲存', els.ticketFormMessage)) showMessage(els.ticketFormMessage, '票券已儲存；集點卡節點現在可以選擇它。', true);
    } catch (error) { handleActionError(error, els.ticketFormMessage); } finally { setSaving(els.saveTicketButton, false); }
  }
  function formatRate(value) { const rate = Number(value); return Number.isFinite(rate) ? String(Number(rate.toFixed(2))) : '0'; }

  function openMemberModal(member) { els.memberLineUserId.value = String(member.lineUserId); els.memberExpectedUpdatedAt.value = String(member.updatedAt || ''); els.memberIdentity.textContent = `${member.displayName || 'LINE 使用者'} · ${member.memberCode || '尚未建立'}`; els.memberTier.value = String(member.tier || '一般會員'); els.memberStatus.value = member.status === 'active' ? 'active' : 'disabled'; hideMessage(els.memberFormMessage); els.memberModal.classList.remove('hidden'); els.memberTier.focus(); }
  function closeMemberModal() { els.memberModal.classList.add('hidden'); }
  async function saveMember(event) { event.preventDefault(); hideMessage(els.memberFormMessage); setSaving(els.saveMemberButton, true); try { const result = await window.MemberSystem.request(state.config, 'admin', state.idToken, 'admin.member.update', { lineUserId: els.memberLineUserId.value, tier: String(els.memberTier.value || '').trim() || '一般會員', status: els.memberStatus.value, expectedUpdatedAt: els.memberExpectedUpdatedAt.value }); if (result.member) state.members = replaceById(state.members, result.member, 'lineUserId'); closeMemberModal(); renderAll(); } catch (error) { handleActionError(error, els.memberFormMessage); } finally { setSaving(els.saveMemberButton, false); } }
  function openStampModal(member) { state.stampRequestId = createRequestId(); els.stampMemberId.value = String(member.lineUserId); els.stampMemberName.textContent = `${member.displayName || 'LINE 使用者'} · ${member.memberCode || '尚未建立'}`; els.stampCardId.replaceChildren(...state.cards.filter((card) => card.status === 'active' && !card.expired).map((card) => { const option = document.createElement('option'); option.value = String(card.cardId); option.textContent = String(card.title || '未命名集點卡'); return option; })); els.stampAmount.value = '1'; els.stampNote.value = ''; hideMessage(els.stampFormMessage); els.stampModal.classList.remove('hidden'); els.stampCardId.focus(); }
  function closeStampModal() { state.stampRequestId = ''; els.stampModal.classList.add('hidden'); }
  async function saveStamp(event) {
    event.preventDefault(); hideMessage(els.stampFormMessage);
    const amount = Number(els.stampAmount.value);
    if (!els.stampCardId.value || !Number.isInteger(amount) || amount < 1 || amount > 100) return showMessage(els.stampFormMessage, '請選擇啟用中的集點卡，並輸入 1–100 的整數點數。');
    setSaving(els.saveStampButton, true);
    try {
      await window.MemberSystem.request(state.config, 'admin', state.idToken, 'admin.stamps.add', { lineUserId: els.stampMemberId.value, cardId: els.stampCardId.value, amount, note: String(els.stampNote.value || '').trim(), requestId: state.stampRequestId || (state.stampRequestId = createRequestId()) });
      closeStampModal();
      if (await refreshAfterSuccessfulWrite('點數已發放', null)) setSyncStatus(`已發放 ${amount} 點 · 已同步`, false);
    } catch (error) { handleActionError(error, els.stampFormMessage); } finally { setSaving(els.saveStampButton, false); }
  }

  function openServiceTimeModal(member) { state.serviceTimeRequestId = createRequestId(); els.serviceTimeMemberId.value = String(member.lineUserId); els.serviceTimeMemberName.textContent = `${member.displayName || 'LINE 使用者'} · ${member.memberCode || '尚未建立'} · 目前 ${formatServiceMinutes(member.serviceMinutesTotal)}`; els.serviceTimeMinutes.value = '30'; els.serviceTimeNote.value = ''; hideMessage(els.serviceTimeFormMessage); els.serviceTimeModal.classList.remove('hidden'); els.serviceTimeMinutes.focus(); }
  function closeServiceTimeModal() { state.serviceTimeRequestId = ''; els.serviceTimeModal.classList.add('hidden'); }
  async function saveServiceTime(event) {
    event.preventDefault(); hideMessage(els.serviceTimeFormMessage);
    const minutes = Number(els.serviceTimeMinutes.value);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) return showMessage(els.serviceTimeFormMessage, '請輸入 1–1440 的整數分鐘數。');
    setSaving(els.saveServiceTimeButton, true);
    try {
      const result = await window.MemberSystem.request(state.config, 'admin', state.idToken, 'admin.service_minutes.add', { lineUserId: els.serviceTimeMemberId.value, minutes, note: String(els.serviceTimeNote.value || '').trim(), requestId: state.serviceTimeRequestId || (state.serviceTimeRequestId = createRequestId()) });
      if (result.member) state.members = replaceById(state.members, result.member, 'lineUserId');
      closeServiceTimeModal();
      if (await refreshAfterSuccessfulWrite('服務時間已登錄', null)) setSyncStatus(`已登錄 ${formatServiceMinutes(minutes)} · 已同步`, false);
    } catch (error) { handleActionError(error, els.serviceTimeFormMessage); } finally { setSaving(els.saveServiceTimeButton, false); }
  }

  function switchPanel(panel) { state.activePanel = panel; ['members', 'cards', 'tickets'].forEach((name) => { const selected = name === panel; els[`${name}Tab`].setAttribute('aria-selected', String(selected)); els[`${name}Panel`].classList.toggle('hidden', !selected); }); }
  function updateAccentValue() { els.accentValue.textContent = safeAccent(els.cardAccent.value).toUpperCase(); }
  function updateEditorStatus(element, status) { element.textContent = statusLabel(status); element.className = `editor-status ${status}`; }
  function statusLabel(status) { return ({ active: '啟用中', draft: '草稿', archived: '已封存', disabled: '已停用' })[status] || '未設定'; }
  function safeAccent(value) { return /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value) : '#e47845'; }
  function replaceById(items, next, key) { return items.some((item) => item[key] === next[key]) ? items.map((item) => item[key] === next[key] ? next : item) : [next, ...items]; }
  function createRequestId() { if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID(); return `request-${Date.now()}-${Math.random().toString(36).slice(2, 14)}`; }
  function formatServiceMinutes(value) { return `${Math.max(0, Math.floor(Number(value) || 0))} 分鐘`; }
  function setSaving(button, saving) { button.disabled = saving; if (saving) { button.dataset.originalText = button.textContent; button.textContent = '儲存中…'; } else button.textContent = button.dataset.originalText || button.textContent; }
  function showMessage(element, message, success) { element.textContent = message; element.classList.toggle('success', Boolean(success)); element.classList.remove('hidden'); }
  function hideMessage(element) { element.textContent = ''; element.classList.add('hidden'); element.classList.remove('success'); }
  function setSyncStatus(message, error) { els.syncStatus.textContent = message; els.syncStatus.classList.toggle('error', Boolean(error)); }
  async function refreshAfterSuccessfulWrite(successMessage, messageElement) {
    try { await refreshData(false); return true; } catch (_) {
      const message = `${successMessage}；資料已完成更新，但畫面同步失敗，請重新整理確認。`;
      if (messageElement) showMessage(messageElement, message, true);
      setSyncStatus('資料已更新，但畫面同步失敗，請重新整理確認。', true);
      return false;
    }
  }
  function handleActionError(error, element) { showMessage(element, error && error.code === 'API_RESPONSE_UNCERTAIN' ? '無法確認這次操作的回應；資料可能已更新，請先重新整理確認，請勿重複送出。' : error && error.code === 'CONFLICT' ? '資料已被另一位管理者更新，請重新整理後再儲存。' : error && error.message || '操作失敗，請稍後再試。'); }
  function handleBootError(error) { if (error && error.code === 'ADMIN_PENDING') { els.pendingUserId.textContent = String(error.details && error.details.lineUserId || '請查看 Admins 資料表'); els.pendingBox.classList.remove('hidden'); showError('此 LINE 帳號尚未授權', 'GAS 已記錄這次管理端登入，但目前不允許進入管理功能。'); return; } if (error && error.code === 'ADMIN_FORBIDDEN') { showError('沒有管理端權限', '此 LINE 帳號未啟用管理權限，請檢查 Admins 的 role 與 status。'); return; } showError(error && error.code === 'CONFIG_ERROR' ? '系統尚未完成設定' : '暫時無法進入管理端', error && error.message || '請稍後重新整理。'); }
  function setView(view) { els.loadingView.classList.toggle('hidden', view !== 'loading'); els.errorView.classList.toggle('hidden', view !== 'error'); els.adminView.classList.toggle('hidden', view !== 'admin'); }
  function showError(title, message) { els.errorTitle.textContent = title; els.errorMessage.textContent = message; setView('error'); }
})();
