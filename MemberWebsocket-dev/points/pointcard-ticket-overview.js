(() => {
  'use strict';

  const state = { config: null, idToken: '', snapshot: null, selected: new Set(), busy: false };
  let root = null;
  let selectionText = null;
  let selectionHint = null;
  let useButton = null;
  let groups = null;

  function extensionUrl() {
    return `${String(state.config && state.config.supabaseUrl || '').replace(/\/$/, '')}/functions/v1/pointcard-extension-api`;
  }

  function escapeText(value) { return String(value == null ? '' : value); }
  function newRequestId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return `PTR-${window.crypto.randomUUID().replaceAll('-', '')}`;
    return `PTR-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  }

  async function extensionRequest(operation, payload = {}) {
    const response = await fetch(extensionUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: String(state.config.supabasePublishableKey || '') },
      cache: 'no-store',
      body: JSON.stringify({ ...payload, operation, idToken: state.idToken })
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data || data.ok !== true) {
      const error = new Error(data && data.error && data.error.message || '票券操作暫時無法完成。');
      error.code = data && data.error && data.error.code || 'API_ERROR';
      throw error;
    }
    return data.data || {};
  }

  function buildUi() {
    const panel = document.querySelector('.tickets-panel');
    const originalList = document.getElementById('ticketList');
    const originalEmpty = document.getElementById('ticketEmpty');
    const originalSummary = document.getElementById('ticketSummary');
    if (!panel || root) return;
    if (originalList) originalList.hidden = true;
    if (originalEmpty) originalEmpty.hidden = true;
    if (originalSummary) originalSummary.hidden = true;

    root = document.createElement('div');
    root.className = 'ticket-overview-extension';
    root.innerHTML = '<div class="ticket-overview-toolbar"><div class="ticket-overview-selection"><strong data-ticket-selection>尚未選擇票券</strong><small data-ticket-selection-hint>可選擇 1 張或多張；實際單次上限依各集點卡設定。</small></div><button class="ticket-overview-use" type="button" disabled>使用已選票券</button></div><div class="ticket-overview-error" data-ticket-error hidden></div><div class="ticket-overview-groups"></div>';
    panel.append(root);
    selectionText = root.querySelector('[data-ticket-selection]');
    selectionHint = root.querySelector('[data-ticket-selection-hint]');
    useButton = root.querySelector('.ticket-overview-use');
    groups = root.querySelector('.ticket-overview-groups');
    useButton.addEventListener('click', openConfirmModal);
    root.addEventListener('change', (event) => {
      const input = event.target instanceof HTMLInputElement ? event.target.closest('[data-ticket-select]') : null;
      if (!input) return;
      const ticketId = String(input.dataset.ticketSelect || '');
      if (!ticketId) return;
      if (input.checked) state.selected.add(ticketId); else state.selected.delete(ticketId);
      updateSelection();
    });
  }

  function availableByCard(snapshot) {
    const cards = Array.isArray(snapshot && snapshot.cards) ? snapshot.cards : [];
    const details = snapshot && snapshot.cardDetails && typeof snapshot.cardDetails === 'object' ? snapshot.cardDetails : {};
    return cards.map((card) => {
      const detail = details[card.cardId] || {};
      const tickets = Array.isArray(detail.tickets) ? detail.tickets.filter((ticket) => ticket && ticket.status !== 'used') : [];
      return { card: detail.card && typeof detail.card === 'object' ? { ...card, ...detail.card } : card, tickets };
    });
  }

  function ticketDescription(ticket) {
    const parts = [];
    if (ticket.ticketDescription) parts.push(ticket.ticketDescription);
    if (ticket.usageMethod) parts.push(`使用方式：${ticket.usageMethod}`);
    return parts.join('\n');
  }

  function render() {
    buildUi();
    if (!groups || !state.snapshot) return;
    const grouped = availableByCard(state.snapshot);
    const availableIds = new Set(grouped.flatMap((entry) => entry.tickets.map((ticket) => String(ticket.ticketId || ''))));
    state.selected = new Set([...state.selected].filter((id) => availableIds.has(id)));
    groups.replaceChildren();

    const total = grouped.reduce((sum, entry) => sum + entry.tickets.length, 0);
    if (!total) {
      const empty = document.createElement('div');
      empty.className = 'ticket-empty';
      empty.innerHTML = '<span aria-hidden="true">○</span><p>目前沒有可使用的集點卡票券。</p>';
      groups.append(empty);
      updateSelection();
      return;
    }

    grouped.forEach(({ card, tickets }) => {
      if (!tickets.length) return;
      const section = document.createElement('section');
      section.className = 'ticket-overview-group';
      const heading = document.createElement('div');
      heading.className = 'ticket-overview-group-heading';
      const title = document.createElement('h3');
      title.textContent = escapeText(card.title || '集點卡');
      const meta = document.createElement('small');
      meta.textContent = `目前 ${Math.max(0, Number(card.stamps || 0))} 點・可用 ${tickets.length} 張`;
      heading.append(title, meta);
      section.append(heading);

      tickets.forEach((ticket) => {
        const item = document.createElement('label');
        item.className = 'ticket-overview-item';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'ticket-overview-check';
        checkbox.dataset.ticketSelect = String(ticket.ticketId || '');
        checkbox.checked = state.selected.has(String(ticket.ticketId || ''));
        checkbox.disabled = state.busy;
        const content = document.createElement('span');
        content.className = 'ticket-overview-content';
        const row = document.createElement('span');
        row.className = 'ticket-overview-title-row';
        const name = document.createElement('strong');
        name.textContent = escapeText(ticket.ticketTitle || '票券');
        const badge = document.createElement('span');
        badge.className = 'ticket-overview-badge';
        badge.textContent = ticket.ticketType === 'lottery' ? '抽獎券' : '優惠券';
        row.append(name, badge);
        const description = document.createElement('p');
        description.textContent = ticketDescription(ticket) || '可使用票券';
        const cost = document.createElement('span');
        cost.className = 'ticket-overview-meta';
        cost.textContent = `使用需扣 ${Math.max(0, Number(ticket.thresholdStamps || 0))} 點`;
        content.append(row, description, cost);
        item.append(checkbox, content);
        section.append(item);
      });
      groups.append(section);
    });
    updateSelection();
  }

  function selectedTickets() {
    const grouped = availableByCard(state.snapshot);
    const all = grouped.flatMap(({ card, tickets }) => tickets.map((ticket) => ({ ...ticket, cardTitle: card.title || '集點卡' })));
    return all.filter((ticket) => state.selected.has(String(ticket.ticketId || '')));
  }

  function updateSelection() {
    const tickets = selectedTickets();
    const count = tickets.length;
    const points = tickets.reduce((sum, ticket) => sum + Math.max(0, Number(ticket.thresholdStamps || 0)), 0);
    if (selectionText) selectionText.textContent = count ? `已選 ${count} 張票券` : '尚未選擇票券';
    if (selectionHint) selectionHint.textContent = count ? `預計合計扣除 ${points} 點（各集點卡分別計算餘額與單次上限）` : '可選擇 1 張或多張；實際單次上限依各集點卡設定。';
    if (useButton) { useButton.disabled = state.busy || count === 0; useButton.textContent = state.busy ? '處理中…' : count > 1 ? `使用 ${count} 張票券` : '使用已選票券'; }
  }

  function modalBase() {
    let modal = document.getElementById('ticketBatchModal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'ticketBatchModal';
    modal.className = 'ticket-batch-modal hidden';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.innerHTML = '<div class="ticket-batch-card"><h2 data-batch-title>確認使用票券</h2><p data-batch-message></p><div class="ticket-batch-list" data-batch-list></div><div class="ticket-batch-actions"><button class="ticket-batch-cancel" type="button">取消</button><button class="ticket-batch-confirm" type="button">確認使用</button></div></div>';
    document.body.append(modal);
    modal.querySelector('.ticket-batch-cancel').addEventListener('click', () => { if (!state.busy) modal.classList.add('hidden'); });
    modal.addEventListener('click', (event) => { if (event.target === modal && !state.busy) modal.classList.add('hidden'); });
    modal.querySelector('.ticket-batch-confirm').addEventListener('click', redeemSelected);
    return modal;
  }

  function openConfirmModal() {
    const tickets = selectedTickets();
    if (!tickets.length) return;
    const modal = modalBase();
    modal.querySelector('[data-batch-title]').textContent = tickets.length > 1 ? `確認同時使用 ${tickets.length} 張票券` : '確認使用票券';
    modal.querySelector('[data-batch-message]').textContent = '送出後會立即扣除各票券所需點數並完成核銷；此操作不可取消。';
    const list = modal.querySelector('[data-batch-list]');
    list.replaceChildren(...tickets.map((ticket) => {
      const line = document.createElement('div'); line.className = 'ticket-batch-line';
      line.textContent = `${ticket.cardTitle}｜${ticket.ticketTitle}｜${Math.max(0, Number(ticket.thresholdStamps || 0))} 點`;
      return line;
    }));
    modal.querySelector('.ticket-batch-cancel').hidden = false;
    const confirm = modal.querySelector('.ticket-batch-confirm'); confirm.disabled = false; confirm.textContent = '確認使用';
    modal.classList.remove('hidden');
    confirm.focus();
  }

  async function redeemSelected() {
    if (state.busy) return;
    const tickets = selectedTickets();
    if (!tickets.length) return;
    const modal = modalBase();
    const confirm = modal.querySelector('.ticket-batch-confirm');
    const message = modal.querySelector('[data-batch-message]');
    const cancel = modal.querySelector('.ticket-batch-cancel');
    state.busy = true; confirm.disabled = true; confirm.textContent = '使用中…'; cancel.hidden = true; updateSelection(); render();
    try {
      const result = await extensionRequest('member.redeem', { ticketIds: tickets.map((ticket) => ticket.ticketId), requestId: newRequestId() });
      const resultTickets = Array.isArray(result.tickets) ? result.tickets : [];
      modal.querySelector('[data-batch-title]').textContent = `已完成 ${Number(result.ticketCount || resultTickets.length)} 張票券使用`;
      message.textContent = result.alreadyApplied ? '此操作先前已完成，以下為已確認的使用結果。' : '票券已完成核銷。';
      const list = modal.querySelector('[data-batch-list]');
      list.replaceChildren(...resultTickets.map((ticket) => {
        const line = document.createElement('div'); line.className = 'ticket-batch-line';
        const prize = ticket.ticketType === 'lottery' && ticket.result && ticket.result.prizeTitle ? `｜抽中：${ticket.result.prizeTitle}` : '';
        line.textContent = `${ticket.cardTitle}｜${ticket.ticketTitle}${prize}`;
        return line;
      }));
      confirm.disabled = false; confirm.textContent = '完成並更新';
      confirm.onclick = () => window.location.reload();
      state.selected.clear();
    } catch (error) {
      message.textContent = error && error.message || '票券使用失敗，請重新整理後再試。';
      confirm.disabled = false; confirm.textContent = '重新確認'; cancel.hidden = false;
      confirm.onclick = null;
    } finally {
      state.busy = false; updateSelection(); render();
    }
  }

  async function waitForLogin() {
    state.config = await window.MemberSystem.loadConfig();
    for (let i = 0; i < 80; i += 1) {
      const visible = document.getElementById('pointsView') && !document.getElementById('pointsView').classList.contains('hidden');
      state.idToken = window.liff && typeof window.liff.getIDToken === 'function' ? (window.liff.getIDToken() || '') : '';
      if (visible && state.idToken) return;
      await new Promise((resolve) => window.setTimeout(resolve, 150));
    }
    throw new Error('無法取得集點卡登入狀態。');
  }

  async function refreshSnapshot() {
    state.snapshot = await window.MemberSystem.request(state.config, 'points', state.idToken, 'user.pointcard.bootstrap', { compact: false });
    render();
  }

  async function boot() {
    buildUi();
    try { await waitForLogin(); await refreshSnapshot(); }
    catch (error) {
      const box = root && root.querySelector('[data-ticket-error]');
      if (box) { box.hidden = false; box.textContent = error && error.message || '票券總覽暫時無法載入。'; }
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
