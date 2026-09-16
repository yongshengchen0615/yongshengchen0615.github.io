(() => {
  'use strict';

  const MEMBERSHIP_TIER_STYLE_KEYS = Object.freeze(['forest', 'midnight', 'ocean', 'sunset', 'lavender', 'rose', 'gold', 'platinum', 'mint', 'cherry']);

  function wholeMinutes(value) {
    return Math.max(0, Math.floor(Number(value) || 0));
  }

  function formatMinutes(value) {
    return `${wholeMinutes(value)} 分鐘`;
  }

  function progressForProfile(profile) {
    const safeProfile = profile && typeof profile === 'object' ? profile : {};
    const raw = safeProfile.tierProgress && typeof safeProfile.tierProgress === 'object' ? safeProfile.tierProgress : {};
    const serviceMinutesTotal = wholeMinutes(raw.serviceMinutesTotal === undefined ? safeProfile.serviceMinutesTotal : raw.serviceMinutesTotal);
    const currentRequiredServiceMinutes = wholeMinutes(raw.currentRequiredServiceMinutes);
    const nextRequiredServiceMinutes = Math.floor(Number(raw.nextRequiredServiceMinutes));
    const nextTierLabel = String(raw.nextTierLabel || '').trim();
    const hasNextTier = Boolean(nextTierLabel && Number.isInteger(nextRequiredServiceMinutes) && nextRequiredServiceMinutes > currentRequiredServiceMinutes);
    const remainingServiceMinutes = hasNextTier ? wholeMinutes(raw.remainingServiceMinutes === undefined ? nextRequiredServiceMinutes - serviceMinutesTotal : raw.remainingServiceMinutes) : 0;
    const percent = hasNextTier
      ? Math.min(100, Math.max(0, (serviceMinutesTotal - currentRequiredServiceMinutes) / (nextRequiredServiceMinutes - currentRequiredServiceMinutes) * 100))
      : raw.isHighestTier ? 100 : 0;
    return { serviceMinutesTotal, nextTierLabel, nextRequiredServiceMinutes, remainingServiceMinutes, hasNextTier, isHighestTier: Boolean(raw.isHighestTier), percent };
  }

  function setText(root, selector, value) {
    const element = root.querySelector(selector);
    if (element) element.textContent = value;
  }

  function tierStyleKeyForProfile(profile) {
    const styleKey = String(profile && profile.tierStyleKey || '').trim();
    return MEMBERSHIP_TIER_STYLE_KEYS.includes(styleKey) ? styleKey : 'forest';
  }

  function applyTierStyle(root, profile) {
    if (typeof root.setAttribute === 'function') root.setAttribute('data-membership-tier-style', tierStyleKeyForProfile(profile));
  }

  function render(root, profile) {
    if (!root || typeof root.querySelector !== 'function') return;
    applyTierStyle(root, profile);
    const progress = progressForProfile(profile);
    const currentTier = String(profile && profile.tier || '一般會員');
    const currentTierText = `目前會員階級：${currentTier}`;
    let summaryText = `累積 ${formatMinutes(progress.serviceMinutesTotal)}・下一階段資料載入中`;
    let remainingText = '下一階段資料載入中';

    if (progress.hasNextTier) {
      summaryText = `累積 ${formatMinutes(progress.serviceMinutesTotal)}・下一階段 ${progress.nextTierLabel} ${formatMinutes(progress.nextRequiredServiceMinutes)}`;
      remainingText = `距離 ${progress.nextTierLabel} 還需要 ${formatMinutes(progress.remainingServiceMinutes)}`;
    } else if (progress.isHighestTier) {
      summaryText = `累積 ${formatMinutes(progress.serviceMinutesTotal)}・已達最高會員階級`;
      remainingText = '已達最高會員階級';
    }

    const roundedPercent = Math.round(progress.percent);
    setText(root, '[data-membership-current-tier]', currentTierText);
    setText(root, '[data-membership-summary]', summaryText);
    setText(root, '[data-membership-remaining]', remainingText);
    const track = root.querySelector('[data-membership-progress-track]');
    const bar = root.querySelector('[data-membership-progress-bar]');
    if (bar) bar.style.width = `${roundedPercent}%`;
    if (track) {
      track.setAttribute('aria-valuenow', String(roundedPercent));
      track.setAttribute('aria-valuetext', remainingText);
    }
  }

  window.MembershipProgress = Object.freeze({ render });
})();

(() => {
  'use strict';

  const baseSystem = window.MemberSystem;
  if (!baseSystem || typeof baseSystem.request !== 'function') return;

  let context = null;
  let overview = null;
  let loadTimer = 0;
  let loading = false;
  let redeeming = false;
  let uncertainRequest = null;
  let notice = '';
  let noticeKind = '';
  const selectedTicketIds = new Set();

  function endpointFor(config) {
    const root = String(config && config.supabaseUrl || '').replace(/\/$/, '');
    return `${root}/functions/v1/point-ticket-batch-api`;
  }

  function apiError(payload, status) {
    const error = new Error(payload && payload.error && payload.error.message || '票券服務暫時無法完成操作。');
    error.code = payload && payload.error && payload.error.code || 'API_ERROR';
    error.status = Number(payload && payload.status || status || 0);
    return error;
  }

  async function batchRequest(config, idToken, action, payload = {}, timeoutMs = 20000) {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    let timer;
    try {
      if (controller) timer = window.setTimeout(() => controller.abort(), timeoutMs);
      const response = await fetch(endpointFor(config), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': String(config && config.supabasePublishableKey || '')
        },
        cache: 'no-store',
        signal: controller ? controller.signal : undefined,
        body: JSON.stringify({ ...payload, action, idToken })
      });
      let body;
      try { body = await response.json(); }
      catch { throw new Error('票券服務回應格式不正確。'); }
      if (!response.ok || !body || body.ok !== true) throw apiError(body, response.status);
      return body.data || {};
    } catch (error) {
      if (error && error.name === 'AbortError') {
        const timeoutError = new Error('票券服務回應逾時；若剛才有確認使用，請先更新確認結果。');
        timeoutError.code = 'API_RESPONSE_UNCERTAIN';
        throw timeoutError;
      }
      if (error && error.code) throw error;
      const networkError = new Error('目前無法連線票券服務；若剛才有確認使用，請先更新確認結果。');
      networkError.code = 'API_RESPONSE_UNCERTAIN';
      throw networkError;
    } finally {
      if (timer) window.clearTimeout(timer);
    }
  }

  function allTickets() {
    const result = [];
    for (const card of overview && Array.isArray(overview.cards) ? overview.cards : []) {
      for (const ticket of Array.isArray(card.tickets) ? card.tickets : []) {
        result.push({ card, ticket });
      }
    }
    return result;
  }

  function cardSelection(card) {
    const ids = new Set((Array.isArray(card.tickets) ? card.tickets : []).map((ticket) => String(ticket.ticketId || '')));
    const selected = allTickets().filter((entry) => entry.card === card && ids.has(String(entry.ticket.ticketId || '')) && selectedTicketIds.has(String(entry.ticket.ticketId || '')));
    return {
      count: selected.length,
      cost: selected.reduce((sum, entry) => sum + Math.max(0, Number(entry.ticket.thresholdStamps || 0)), 0)
    };
  }

  function sanitizeSelections() {
    const valid = new Set(allTickets().map((entry) => String(entry.ticket.ticketId || '')));
    for (const id of [...selectedTicketIds]) if (!valid.has(id)) selectedTicketIds.delete(id);
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function ticketMeta(ticket) {
    const type = String(ticket.ticketType || '') === 'lottery' ? '抽獎券' : '優惠券';
    return `${type} · 使用 ${Math.max(0, Number(ticket.thresholdStamps || 0))} 點`;
  }

  function renderNotice() {
    if (!notice) return '';
    return `<p class="multi-ticket-notice ${noticeKind === 'success' ? 'is-success' : noticeKind === 'error' ? 'is-error' : ''}" role="status">${escapeHtml(notice)}</p>`;
  }

  function renderOverview() {
    const list = document.getElementById('ticketList');
    const summary = document.getElementById('ticketSummary');
    const empty = document.getElementById('ticketEmpty');
    if (!list || !summary || !empty || !overview) return;

    sanitizeSelections();
    const cards = Array.isArray(overview.cards) ? overview.cards : [];
    const total = cards.reduce((sum, card) => sum + Number(card.availableTicketCount || 0), 0);
    const selectedCount = selectedTicketIds.size;
    summary.textContent = `${total} 張可用 · 已選 ${selectedCount} 張`;
    empty.classList.toggle('hidden', total > 0);
    if (!total) {
      list.innerHTML = renderNotice();
      if (!notice) empty.querySelector('p').textContent = '目前沒有可使用的集點卡票券。';
      return;
    }

    const groups = cards.filter((card) => Number(card.availableTicketCount || 0) > 0).map((card) => {
      const selection = cardSelection(card);
      const maxTickets = Math.max(1, Number(card.maxTicketsPerRedemption || 1));
      const tickets = (Array.isArray(card.tickets) ? card.tickets : []).map((ticket) => {
        const ticketId = String(ticket.ticketId || '');
        const checked = selectedTicketIds.has(ticketId);
        const wouldExceedCount = !checked && selection.count >= maxTickets;
        const wouldExceedPoints = !checked && selection.cost + Number(ticket.thresholdStamps || 0) > Number(card.stamps || 0);
        const disabled = redeeming || wouldExceedCount || wouldExceedPoints;
        const description = String(ticket.ticketDescription || '').trim();
        const method = String(ticket.usageMethod || '').trim();
        return `<label class="multi-ticket-item${checked ? ' is-selected' : ''}${disabled && !checked ? ' is-disabled' : ''}">
          <input type="checkbox" data-multi-ticket-id="${escapeHtml(ticketId)}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
          <span class="multi-ticket-check" aria-hidden="true"></span>
          <span class="multi-ticket-copy">
            <strong>${escapeHtml(ticket.ticketTitle || '票券')}</strong>
            <span class="multi-ticket-meta">${escapeHtml(ticketMeta(ticket))}</span>
            ${description ? `<span class="multi-ticket-description">${escapeHtml(description)}</span>` : ''}
            ${method ? `<span class="multi-ticket-method">使用方式：${escapeHtml(method)}</span>` : ''}
          </span>
        </label>`;
      }).join('');
      return `<section class="multi-ticket-group" data-card-id="${escapeHtml(card.cardId || '')}">
        <header class="multi-ticket-group-heading">
          <div><strong>${escapeHtml(card.title || '集點卡')}</strong><span>目前 ${Math.max(0, Number(card.stamps || 0))} 點 · ${Number(card.availableTicketCount || 0)} 張可用</span></div>
          <span class="multi-ticket-limit">單次最多 ${maxTickets} 張</span>
        </header>
        <div class="multi-ticket-items">${tickets}</div>
      </section>`;
    }).join('');

    list.innerHTML = `${renderNotice()}${groups}<div class="multi-ticket-actions">
      <div><strong>已選 ${selectedCount} 張</strong><span>${selectedCount ? '可跨不同集點卡一起確認；各卡仍依自己的上限與點數檢查。' : '勾選一張即可單張使用，也可依各集點卡上限多選。'}</span></div>
      <button class="ticket-confirm-button multi-ticket-redeem-button" type="button" data-multi-ticket-redeem ${selectedCount && !redeeming ? '' : 'disabled'}>${redeeming ? '正在使用票券…' : `使用選取票券${selectedCount ? `（${selectedCount}）` : ''}`}</button>
    </div>`;
  }

  function setNotice(message, kind = '') {
    notice = String(message || '');
    noticeKind = kind;
    renderOverview();
  }

  async function loadOverview() {
    if (!context || loading || redeeming) return;
    loading = true;
    try {
      const result = await batchRequest(context.config, context.idToken, 'user.pointcard.tickets.overview');
      overview = result;
      if (!uncertainRequest) {
        notice = '';
        noticeKind = '';
      }
      renderOverview();
    } catch (error) {
      const list = document.getElementById('ticketList');
      if (list && !overview) list.innerHTML = `<p class="multi-ticket-notice is-error" role="status">${escapeHtml(error && error.message || '票券總覽載入失敗。')}</p>`;
    } finally {
      loading = false;
    }
  }

  function scheduleOverview(delay = 0) {
    if (loadTimer) window.clearTimeout(loadTimer);
    loadTimer = window.setTimeout(() => {
      loadTimer = 0;
      loadOverview().catch(() => {});
    }, delay);
  }

  function updateContext(config, idToken) {
    if (!config || !idToken) return;
    context = { config, idToken };
  }

  const wrappedSystem = {
    ...baseSystem,
    request: async function requestWithTicketOverview(config, clientType, idToken, action, payload = {}) {
      const result = await baseSystem.request(config, clientType, idToken, action, payload);
      if (clientType === 'points') {
        updateContext(config, idToken);
        if (action === 'user.pointcard.bootstrap' || action === 'user.pointcard.ticket.redeem') scheduleOverview(0);
      }
      return result;
    }
  };
  window.MemberSystem = Object.freeze(wrappedSystem);

  function selectedEntries() {
    const byId = new Map(allTickets().map((entry) => [String(entry.ticket.ticketId || ''), entry]));
    return [...selectedTicketIds].map((id) => byId.get(id)).filter(Boolean);
  }

  function validateSelection() {
    const entries = selectedEntries();
    if (!entries.length) return '請先選擇至少一張票券。';
    const cards = new Map();
    for (const entry of entries) {
      const cardId = String(entry.card.cardId || '');
      const group = cards.get(cardId) || { card: entry.card, count: 0, cost: 0 };
      group.count += 1;
      group.cost += Math.max(0, Number(entry.ticket.thresholdStamps || 0));
      cards.set(cardId, group);
    }
    for (const group of cards.values()) {
      const max = Math.max(1, Number(group.card.maxTicketsPerRedemption || 1));
      if (group.count > max) return `${group.card.title || '集點卡'} 單次最多只能使用 ${max} 張票券。`;
      if (group.cost > Number(group.card.stamps || 0)) return `${group.card.title || '集點卡'} 的點數不足以同時使用目前選取的票券。`;
    }
    return '';
  }

  function newRequestId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return `PTR-${window.crypto.randomUUID().replace(/-/g, '')}`;
    return `PTR-${Date.now()}-${Math.random().toString(36).slice(2, 14)}`;
  }

  function lotteryResultLabel(ticket) {
    if (String(ticket.ticketType || '') !== 'lottery') return '';
    const result = ticket && ticket.result && typeof ticket.result === 'object' ? ticket.result : {};
    const title = String(result.prizeTitle || result.title || result.name || '').trim();
    return title ? `${ticket.ticketTitle || '抽獎券'}：${title}` : `${ticket.ticketTitle || '抽獎券'} 已完成抽獎`;
  }

  async function redeemSelected() {
    if (redeeming || !context) return;
    const validation = validateSelection();
    if (validation) return setNotice(validation, 'error');
    const entries = selectedEntries();
    const count = entries.length;
    const totalPoints = entries.reduce((sum, entry) => sum + Math.max(0, Number(entry.ticket.thresholdStamps || 0)), 0);
    if (!window.confirm(`確認使用 ${count} 張票券？\n合計將依各集點卡扣除 ${totalPoints} 點。\n票券使用後無法復原。`)) return;

    const ticketIds = entries.map((entry) => String(entry.ticket.ticketId || ''));
    const sameUncertain = uncertainRequest && uncertainRequest.ticketIds.length === ticketIds.length && uncertainRequest.ticketIds.every((id, index) => id === ticketIds[index]);
    const requestId = sameUncertain ? uncertainRequest.requestId : newRequestId();
    redeeming = true;
    setNotice('正在一次核銷選取的票券，請勿重複操作。');
    try {
      const result = await batchRequest(context.config, context.idToken, 'user.pointcard.tickets.redeem', { ticketIds, requestId }, 30000);
      uncertainRequest = null;
      overview = result.overview || overview;
      selectedTicketIds.clear();
      const redeemed = Array.isArray(result.redeemedTickets) ? result.redeemedTickets : [];
      const lotteryResults = redeemed.map(lotteryResultLabel).filter(Boolean);
      notice = lotteryResults.length
        ? `已成功使用 ${count} 張票券。${lotteryResults.join('；')}`
        : `已成功使用 ${count} 張票券。`;
      noticeKind = 'success';
      renderOverview();
      const refreshButton = document.getElementById('refreshButton');
      if (refreshButton && typeof refreshButton.click === 'function') window.setTimeout(() => refreshButton.click(), 50);
    } catch (error) {
      if (error && error.code === 'API_RESPONSE_UNCERTAIN') {
        uncertainRequest = { requestId, ticketIds:[...ticketIds] };
        setNotice(`${error.message} 再按一次「使用選取票券」會使用相同操作識別碼確認，不會重複扣點。`, 'error');
      } else {
        uncertainRequest = null;
        setNotice(error && error.message || '票券使用失敗，請重新整理後再試。', 'error');
        scheduleOverview(0);
      }
    } finally {
      redeeming = false;
      renderOverview();
    }
  }

  document.addEventListener('change', (event) => {
    const input = event.target instanceof Element ? event.target.closest('[data-multi-ticket-id]') : null;
    if (!input || !(input instanceof HTMLInputElement) || !overview || redeeming) return;
    const ticketId = String(input.dataset.multiTicketId || '');
    if (!ticketId) return;
    if (input.checked) selectedTicketIds.add(ticketId);
    else selectedTicketIds.delete(ticketId);
    uncertainRequest = null;
    notice = '';
    noticeKind = '';
    const validation = validateSelection();
    if (validation) {
      selectedTicketIds.delete(ticketId);
      notice = validation;
      noticeKind = 'error';
    }
    renderOverview();
  });

  document.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest('[data-multi-ticket-redeem]') : null;
    if (!button) return;
    event.preventDefault();
    redeemSelected().catch(() => {});
  });
})();
