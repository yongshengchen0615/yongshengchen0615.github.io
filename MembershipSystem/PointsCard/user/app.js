(function () {
  'use strict';

  const $ = function (id) { return document.getElementById(id); };
  const terminalStampErrors = new Set([
    'INVALID_STAMP_CODE', 'VOUCHER_NOT_FOUND', 'VOUCHER_USED', 'VOUCHER_EXPIRED',
    'VOUCHER_INACTIVE', 'MEMBER_INACTIVE', 'CARD_UNAVAILABLE'
  ]);
  const terminalRewardErrors = new Set([
    'INVALID_REWARD_CONFIRMATION_CODE', 'REWARD_CONFIRMATION_NOT_FOUND',
    'REWARD_CONFIRMATION_INACTIVE', 'REWARD_CONFIRMATION_EXPIRED',
    'REWARD_NOT_AVAILABLE', 'CARD_NOT_FOUND', 'MEMBER_INACTIVE', 'CONFLICT'
  ]);
  const rewardTypeLabels = { coupon: '優惠券', lottery: '抽獎券' };
  const MAX_GRID_STAMPS = 60;
  let currentMember = null;
  let selectedTicket = null;
  let stampRequestInFlight = false;
  let rewardClaimInFlight = false;
  let rewardClaimRetry = null;
  let lotteryPhraseInterval = 0;
  let lotterySymbolInterval = 0;
  let lotterySettleTimeout = 0;
  let lotteryRevealTimeout = 0;
  const dialogPageScrollPositions = new WeakMap();

  const avatarFallback = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"%3E%3Crect width="96" height="96" rx="48" fill="%23dfe6df"/%3E%3Ccircle cx="48" cy="38" r="17" fill="%23173f35" fill-opacity=".35"/%3E%3Cpath d="M19 88c3-18 14-27 29-27s26 9 29 27" fill="%23173f35" fill-opacity=".35"/%3E%3C/svg%3E';

  function formatNumber(value) {
    return new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 }).format(Number(value || 0));
  }

  function normalizeTicket(ticket, fallbackType) {
    return Object.assign({}, ticket, {
      cardId: String(ticket && ticket.cardId || ''),
      rewardType: ticket && ticket.rewardType === 'lottery' ? 'lottery' : (fallbackType || 'coupon'),
      lotteryPrizes: lotteryPrizeNames(ticket)
    });
  }

  function lotteryPrizeNames(ticket) {
    if (!ticket || ticket.rewardType !== 'lottery' || !Array.isArray(ticket.lotteryPrizes)) return [];
    const names = ticket.lotteryPrizes.map(function (prize) {
      if (typeof prize === 'string') return prize.trim();
      if (!prize) return '';
      return String(prize.name || '').trim();
    }).filter(Boolean).slice(0, 8);
    return names.filter(function (name, index) { return names.indexOf(name) === index; });
  }

  function appendLotteryPrizeSummary(container, ticket) {
    const prizes = lotteryPrizeNames(ticket);
    if (!prizes.length) return;
    const summary = document.createElement('span');
    summary.className = 'lottery-prize-summary';
    const label = document.createElement('span');
    label.className = 'lottery-prize-label';
    label.textContent = '抽獎獎項';
    const values = document.createElement('span');
    values.className = 'lottery-prize-values';
    values.textContent = prizes.join('、');
    summary.append(label, values);
    container.append(summary);
  }

  function normalizeCardSummary(card) {
    const source = card && typeof card === 'object' ? card : {};
    const status = source.status === 'expired' ? 'expired' : (source.status === 'deleted' ? 'deleted' : 'active');
    return {
      cardId: String(source.cardId || ''),
      name: String(source.name || '集點卡'),
      description: String(source.description || ''),
      status: status,
      available: source.available === undefined ? status === 'active' : Boolean(source.available),
      expiresAt: String(source.expiresAt || ''),
      cardSize: Number(source.cardSize || 10),
      totalStamps: Number(source.totalStamps || 0),
      redeemedRewards: Number(source.redeemedRewards || 0),
      updatedAt: String(source.updatedAt || '')
    };
  }

  function normalizeRewardContract(member) {
    const normalized = Object.assign({}, member);
    const cardSize = Number(normalized.cardSize || normalized.stampsPerReward || 10);
    normalized.cards = Array.isArray(normalized.cards) ? normalized.cards.map(normalizeCardSummary) : [];
    const cardSource = normalized.card && typeof normalized.card === 'object' ? normalized.card : {};
    const cardStatus = ['active', 'expired', 'deleted'].indexOf(String(cardSource.status || '')) >= 0 ? String(cardSource.status) : 'active';
    normalized.card = {
      cardId: String(cardSource.cardId || normalized.cardId || normalized.selectedCardId || ''),
      name: String(cardSource.name || normalized.name || '集點卡'),
      description: String(cardSource.description || normalized.description || ''),
      status: cardStatus,
      available: cardSource.available === undefined ? cardStatus === 'active' : Boolean(cardSource.available),
      expiresAt: String(cardSource.expiresAt || ''),
      updatedAt: String(cardSource.updatedAt || 'legacy') || 'legacy'
    };
    normalized.selectedCardId = String(normalized.selectedCardId || normalized.card.cardId || '');
    if (!Array.isArray(normalized.rewardNodes) || !normalized.rewardNodes.length) {
      normalized.rewardNodes = [{
        nodeId: 'node-' + cardSize,
        stampsRequired: cardSize,
        rewardName: normalized.rewardName || '本期優惠券',
        rewardType: 'coupon',
        state: Number(normalized.availableRewards || 0) > 0 ? 'available' : 'pending'
      }];
    }
    normalized.rewardNodes = normalized.rewardNodes.map(function (node) { return normalizeTicket(node, 'coupon'); });
    if (!Array.isArray(normalized.availableRewardNodes)) {
      normalized.availableRewardNodes = Number(normalized.availableRewards || 0) > 0 ? [{
        entitlementOrdinal: Number(normalized.redeemedRewards || 0) + 1,
        stampsRequired: cardSize,
        rewardName: normalized.rewardName || '本期優惠券',
        rewardType: 'coupon',
        cardId: normalized.card.cardId
      }] : [];
    }
    normalized.availableRewardNodes = normalized.availableRewardNodes.map(function (ticket) { return normalizeTicket(ticket, 'coupon'); });
    if (!Array.isArray(normalized.upcomingRewardNodes)) {
      normalized.upcomingRewardNodes = normalized.rewardNodes.filter(function (node) { return node.state === 'pending'; });
      if (!normalized.upcomingRewardNodes.length && normalized.nextReward) normalized.upcomingRewardNodes = [normalized.nextReward];
    }
    normalized.upcomingRewardNodes = normalized.upcomingRewardNodes.map(function (ticket) { return normalizeTicket(ticket, 'coupon'); });
    normalized.nextAvailableReward = normalized.nextAvailableReward ? normalizeTicket(normalized.nextAvailableReward, 'coupon') : normalized.availableRewardNodes[0] || null;
    normalized.nextReward = normalized.nextReward ? normalizeTicket(normalized.nextReward, 'coupon') : normalized.upcomingRewardNodes[0] || null;
    normalized.stampsUntilNextReward = normalized.stampsUntilNextReward == null ? Number(normalized.stampsUntilReward || 0) : Number(normalized.stampsUntilNextReward);
    normalized.cardSize = cardSize;
    return normalized;
  }

  function showFatalError(error) {
    $('bootState').classList.add('hidden');
    $('memberApp').classList.add('hidden');
    $('errorMessage').textContent = error && error.message ? error.message : '請稍後再試。';
    $('errorState').classList.remove('hidden');
  }

  function showProcessing(mode) {
    const rewardMode = mode === 'reward';
    $('processingEyebrow').textContent = rewardMode ? 'VERIFYING TICKET' : 'STAMPING';
    $('processingTitle').textContent = rewardMode ? '正在確認店家與票券' : '正在蓋上新印章';
    $('processingMessage').textContent = rewardMode ? '確認成功後票券會立即使用，請勿重複操作。' : '驗證 QR Code 與集點紀錄，請勿重複操作。';
    $('processingOverlay').classList.remove('hidden');
  }

  function hideProcessing() { $('processingOverlay').classList.add('hidden'); }

  function createStamp(index, active, justAdded, rewardNode) {
    const stamp = document.createElement('div');
    stamp.className = 'stamp' + (active ? ' active' : '') + (justAdded ? ' just-added' : '') +
      (rewardNode ? ' reward-node ' + rewardNode.state + ' ' + rewardNode.rewardType : '');
    stamp.setAttribute('aria-label', '第 ' + (index + 1) + ' 格' + (active ? '，已集點' : '，尚未集點') +
      (rewardNode ? '，' + rewardTypeLabels[rewardNode.rewardType] + '：' + rewardNode.rewardName : ''));
    if (active) {
      const symbol = document.createElement('span');
      symbol.className = 'stamp-symbol';
      symbol.textContent = rewardNode ? (rewardNode.rewardType === 'lottery' ? '?' : '%') : 'P';
      stamp.append(symbol);
    }
    const number = document.createElement('span');
    number.className = 'stamp-index';
    number.textContent = String(index + 1).padStart(2, '0');
    stamp.append(number);
    return stamp;
  }

  function renderLargeCardProgress(member, grid, total, filled, rewardNodes) {
    grid.classList.add('stamp-grid-large');
    const summary = document.createElement('div');
    summary.className = 'stamp-progress-summary';
    const copy = document.createElement('div');
    const label = document.createElement('span');
    label.textContent = '本輪集點進度';
    const value = document.createElement('strong');
    value.textContent = formatNumber(filled) + ' / ' + formatNumber(total) + ' 點';
    copy.append(label, value);
    const progress = document.createElement('progress');
    progress.max = Math.max(1, total);
    progress.value = Math.max(0, Math.min(total, filled));
    progress.setAttribute('aria-label', '本輪已集 ' + filled + ' 點，共 ' + total + ' 點');
    summary.append(copy, progress);

    const milestones = document.createElement('div');
    milestones.className = 'stamp-milestones';
    rewardNodes.forEach(function (node) {
      const item = document.createElement('div');
      item.className = 'stamp-milestone ' + (node.state || 'pending');
      const point = document.createElement('strong');
      point.textContent = formatNumber(node.stampsRequired) + ' 點';
      const reward = document.createElement('span');
      reward.textContent = node.rewardName;
      item.append(point, reward);
      milestones.append(item);
    });
    grid.append(summary, milestones);
  }

  function renderStampGrid(member, animateLatest) {
    const total = Number(member.cardSize || member.stampsPerReward || 10);
    const filled = Number(member.visualStamps || 0);
    const rewardNodes = Array.isArray(member.rewardNodes) ? member.rewardNodes : [];
    const grid = $('stampGrid');
    grid.replaceChildren();
    grid.classList.toggle('stamp-grid-large', total > MAX_GRID_STAMPS);
    if (total > MAX_GRID_STAMPS) {
      renderLargeCardProgress(member, grid, total, filled, rewardNodes);
      return;
    }
    for (let index = 0; index < total; index += 1) {
      const rewardNode = rewardNodes.find(function (node) { return Number(node.stampsRequired) === index + 1; }) || null;
      grid.append(createStamp(index, index < filled, Boolean(animateLatest && index === filled - 1), rewardNode));
    }
  }

  function createEarnedTicket(ticket) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'reward-ticket ' + ticket.rewardType;
    const mark = document.createElement('span');
    mark.className = 'ticket-mark';
    mark.textContent = ticket.rewardType === 'lottery' ? '?' : '%';
    const copy = document.createElement('span');
    copy.className = 'ticket-copy';
    const type = document.createElement('small');
    type.textContent = rewardTypeLabels[ticket.rewardType];
    const name = document.createElement('strong');
    name.textContent = ticket.rewardName;
    const meta = document.createElement('span');
    meta.textContent = formatNumber(ticket.stampsRequired) + ' 點節點';
    copy.append(type, name, meta);
    appendLotteryPrizeSummary(copy, ticket);
    const action = document.createElement('span');
    action.className = 'ticket-action';
    action.textContent = '開啟 ↗';
    button.append(mark, copy, action);
    button.addEventListener('click', function () { openTicket(ticket); });
    return button;
  }

  function createUpcomingTicket(ticket) {
    const row = document.createElement('article');
    row.className = 'upcoming-ticket ' + ticket.rewardType;
    const mark = document.createElement('span');
    mark.className = 'upcoming-mark';
    mark.textContent = ticket.rewardType === 'lottery' ? '?' : '%';
    const copy = document.createElement('div');
    const type = document.createElement('small');
    type.textContent = rewardTypeLabels[ticket.rewardType];
    const name = document.createElement('strong');
    name.textContent = ticket.rewardName;
    copy.append(type, name);
    appendLotteryPrizeSummary(copy, ticket);
    const remaining = document.createElement('span');
    remaining.className = 'upcoming-remaining';
    remaining.textContent = '再 ' + formatNumber(ticket.stampsUntilReward || 0) + ' 點';
    row.append(mark, copy, remaining);
    return row;
  }

  function renderTickets(member, cardAvailable) {
    const earned = member.availableRewardNodes || [];
    const upcoming = cardAvailable ? (member.upcomingRewardNodes || []) : [];
    $('earnedTicketCount').textContent = formatNumber(earned.length) + ' 張可使用';
    $('earnedTicketEmpty').classList.toggle('hidden', earned.length !== 0);
    const earnedList = $('earnedTicketList');
    earnedList.replaceChildren();
    earned.forEach(function (ticket) { earnedList.append(createEarnedTicket(ticket)); });
    $('upcomingTicketGroup').classList.toggle('hidden', !cardAvailable);
    const upcomingList = $('upcomingTicketList');
    upcomingList.replaceChildren();
    upcoming.slice(0, 5).forEach(function (ticket) { upcomingList.append(createUpcomingTicket(ticket)); });
  }

  function renderCardSelector(member) {
    const select = $('memberCardSelect');
    select.replaceChildren();
    (member.cards || []).forEach(function (card) {
      const option = document.createElement('option');
      option.value = card.cardId;
      option.textContent = card.name + (card.status === 'expired' ? '（已過期）' : '');
      option.dataset.cardName = card.name;
      option.dataset.status = card.status;
      option.dataset.totalStamps = String(card.totalStamps || 0);
      select.append(option);
    });
    select.value = member.selectedCardId || member.card.cardId || '';
    $('cardSwitcher').classList.toggle('hidden', (member.cards || []).length < 2);
    select.disabled = stampRequestInFlight || rewardClaimInFlight;
  }

  function renderMember(member, animateLatest) {
    member = normalizeRewardContract(member);
    currentMember = member;
    $('displayName').textContent = member.displayName || '會員';
    $('avatar').src = member.pictureUrl || avatarFallback;
    $('avatar').onerror = function () { $('avatar').src = avatarFallback; };
    $('memberNo').textContent = member.memberNo || '—';
    renderCardSelector(member);

    const active = member.membershipStatus === 'active';
    const cardAvailable = member.card.available === true;
    $('stampCard').classList.toggle('hidden', !cardAvailable);
    $('noCardState').classList.toggle('hidden', cardAvailable);
    $('scanStampButton').disabled = !active || !cardAvailable || stampRequestInFlight;
    $('cardTitle').textContent = member.card.name || '集點卡';
    $('cardDescription').textContent = member.card.description || '';
    $('cardDescription').classList.toggle('hidden', !member.card.description);

    if (!cardAvailable) {
      $('memberStatusText').textContent = '目前沒有可用集點卡。';
      const hasAlternative = (member.cards || []).some(function (card) { return card.available; });
      $('noCardMessage').textContent = member.card.status === 'expired'
        ? (hasAlternative ? '這張集點卡已到期，請切換其他可用集點卡。' : '目前的集點卡已到期。')
        : '店家目前沒有開放中的集點卡。';
    } else {
      $('memberStatusText').textContent = active ? '今天也來收集一枚好心情。' : '這張集點卡目前暫停使用，請洽店家確認。';
      renderStampGrid(member, animateLatest);
    }
    renderTickets(member, cardAvailable);
  }

  async function loadMember() {
    const result = await PointsCard.callApi('member.me');
    renderMember(result.member, false);
    $('bootState').classList.add('hidden');
    $('errorState').classList.add('hidden');
    $('memberApp').classList.remove('hidden');
    return result;
  }

  async function switchCard(cardId) {
    if (!cardId || stampRequestInFlight || rewardClaimInFlight) return;
    PointsCard.setSelectedCardId(cardId);
    $('memberCardSelect').disabled = true;
    $('cardWorkspace').classList.add('is-switching');
    $('cardWorkspace').setAttribute('aria-busy', 'true');
    try { await loadMember(); }
    finally {
      $('memberCardSelect').disabled = false;
      $('cardWorkspace').classList.remove('is-switching');
      $('cardWorkspace').setAttribute('aria-busy', 'false');
    }
  }

  function openDialog(dialog) {
    if (dialog.open) return;
    const position = { left: window.pageXOffset || window.scrollX || 0, top: window.pageYOffset || window.scrollY || 0 };
    dialogPageScrollPositions.set(dialog, position);
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    window.requestAnimationFrame(function () {
      dialog.scrollTop = 0;
      const scrollArea = dialog.querySelector('[data-dialog-scroll]');
      if (scrollArea) scrollArea.scrollTop = 0;
      window.scrollTo(position.left, position.top);
    });
  }

  function closeDialog(dialog) {
    const position = dialogPageScrollPositions.get(dialog);
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
    if (position) {
      window.requestAnimationFrame(function () {
        window.scrollTo(position.left, position.top);
        dialogPageScrollPositions.delete(dialog);
      });
    }
  }

  function openTicket(ticket) {
    selectedTicket = ticket;
    $('ticketDialog').classList.toggle('lottery', ticket.rewardType === 'lottery');
    $('ticketDialogMark').textContent = ticket.rewardType === 'lottery' ? '?' : '%';
    $('ticketDialogType').textContent = ticket.rewardType === 'lottery' ? 'LUCKY DRAW TICKET' : 'COUPON';
    $('ticketDialogTitle').textContent = ticket.rewardName;
    $('ticketDialogMeta').textContent = formatNumber(ticket.stampsRequired) + ' 點節點已解鎖';
    const prizeNames = lotteryPrizeNames(ticket);
    const prizeList = $('ticketPrizeList');
    prizeList.replaceChildren();
    prizeNames.forEach(function (name) {
      const item = document.createElement('li');
      item.textContent = name;
      prizeList.append(item);
    });
    $('ticketPrizePanel').classList.toggle('hidden', prizeNames.length === 0);
    $('scanRewardButton').disabled = rewardClaimInFlight;
    openDialog($('ticketDialog'));
  }

  async function recordStamp(stampCode, requestId, fromNavigation) {
    if (stampRequestInFlight) return;
    stampRequestInFlight = true;
    $('scanStampButton').disabled = true;
    $('memberCardSelect').disabled = true;
    showProcessing('stamp');
    try {
      const result = await PointsCard.callApi('stamp.record', { stampCode: stampCode, requestId: requestId });
      if (fromNavigation) PointsCard.clearNavigationState();
      renderMember(result.member, !result.duplicate);
      $('successSealCount').textContent = '+' + formatNumber(result.stampCount);
      const unlockedNames = (result.unlockedRewards || []).map(function (reward) { return reward.rewardName; });
      $('successMessage').textContent = result.duplicate
        ? '這次請求先前已完成，集點卡已同步為最新狀態。'
        : '已加入 ' + formatNumber(result.stampCount) + ' 點；' + (unlockedNames.length ? '新獲得：' + unlockedNames.join('、') + '。' : '距離下一張票券還差 ' + formatNumber(currentMember.stampsUntilNextReward) + ' 點。');
      openDialog($('successDialog'));
    } catch (error) {
      if (fromNavigation && terminalStampErrors.has(error.code)) PointsCard.clearNavigationState();
      if (error && error.code === 'CARD_UNAVAILABLE') {
        try { await loadMember(); } catch (_) {}
        return;
      }
      $('stampErrorMessage').textContent = error && error.message ? error.message : '請確認 QR Code 後再試一次。';
      openDialog($('stampErrorDialog'));
    } finally {
      stampRequestInFlight = false;
      hideProcessing();
      $('memberCardSelect').disabled = false;
      $('scanStampButton').disabled = !currentMember || currentMember.membershipStatus !== 'active' || !currentMember.card.available;
    }
  }

  async function scanAppUrl(queryName, errorMessage) {
    if (!window.liff || typeof liff.scanCodeV2 !== 'function') throw new Error('目前環境不支援相機掃描，請使用支援掃碼的 LINE LIFF 開啟。');
    const result = await liff.scanCodeV2();
    const raw = String(result && result.value || '').trim();
    let scannedUrl;
    try { scannedUrl = new URL(raw); }
    catch (_) { throw new Error(errorMessage); }
    const config = await PointsCard.loadConfig();
    const expectedLiffPath = '/' + encodeURIComponent(config.LIFF_ID) + '/';
    const currentRoot = new URL('../', window.location.href);
    const isLiffUrl = scannedUrl.origin === 'https://liff.line.me' && scannedUrl.pathname === expectedLiffPath;
    const isCurrentAppUrl = scannedUrl.origin === currentRoot.origin && scannedUrl.pathname.indexOf(currentRoot.pathname) === 0;
    const code = String(scannedUrl.searchParams.get(queryName) || '').trim().toLowerCase();
    if ((!isLiffUrl && !isCurrentAppUrl) || !/^[a-f0-9]{64}$/.test(code)) throw new Error(errorMessage);
    return code;
  }

  async function scanStampCode() {
    if (!currentMember || !currentMember.card.available) throw new Error('目前沒有可用集點卡。');
    const stampCode = await scanAppUrl('stamp', '這不是本店發行的集點 QR Code。');
    await recordStamp(stampCode, PointsCard.randomHex(16), false);
  }

  function rewardRequestId(ticket, confirmationCode) {
    const fingerprint = (ticket.cardId || currentMember.selectedCardId || '') + '|' + ticket.entitlementOrdinal + '|' + confirmationCode;
    if (rewardClaimRetry && rewardClaimRetry.fingerprint === fingerprint) return rewardClaimRetry.requestId;
    rewardClaimRetry = { fingerprint: fingerprint, requestId: PointsCard.randomHex(16) };
    return rewardClaimRetry.requestId;
  }

  function clearLotteryAnimationTimers() {
    window.clearInterval(lotteryPhraseInterval);
    window.clearInterval(lotterySymbolInterval);
    window.clearTimeout(lotterySettleTimeout);
    window.clearTimeout(lotteryRevealTimeout);
    lotteryPhraseInterval = 0;
    lotterySymbolInterval = 0;
    lotterySettleTimeout = 0;
    lotteryRevealTimeout = 0;
  }

  function revealLotteryResult(claimedReward) {
    clearLotteryAnimationTimers();
    $('lotteryStage').className = 'lottery-stage revealed';
    $('lotterySymbol').textContent = '★';
    $('lotteryTitle').textContent = '你的開獎結果';
    $('lotteryResultText').textContent = claimedReward.lotteryResult || '請洽店員確認結果';
    $('confirmLotteryButton').disabled = false;
  }

  function playLotteryAnimation(claimedReward) {
    clearLotteryAnimationTimers();
    const lotteryStage = $('lotteryStage');
    lotteryStage.className = 'lottery-stage drawing';
    $('lotterySymbol').textContent = '✦';
    $('lotteryTitle').textContent = '正在開獎';
    $('lotteryResultText').textContent = '幸運轉盤啟動…';
    $('confirmLotteryButton').disabled = true;
    openDialog($('lotteryDialog'));
    const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion) {
      lotteryRevealTimeout = window.setTimeout(function () { revealLotteryResult(claimedReward); }, 80);
      return;
    }

    const phrases = ['獎項正在飛快轉動…', '好運慢慢靠近…', '再轉最後一圈…'];
    const symbols = ['✦', '◆', '●', '✶', '◇', '★'];
    let phraseIndex = 0;
    let symbolIndex = 0;
    lotteryPhraseInterval = window.setInterval(function () {
      $('lotteryResultText').textContent = phrases[phraseIndex++ % phrases.length];
    }, 560);
    lotterySymbolInterval = window.setInterval(function () {
      $('lotterySymbol').textContent = symbols[symbolIndex++ % symbols.length];
    }, 120);
    lotterySettleTimeout = window.setTimeout(function () {
      window.clearInterval(lotteryPhraseInterval);
      window.clearInterval(lotterySymbolInterval);
      lotteryStage.className = 'lottery-stage settling';
      $('lotterySymbol').textContent = '✦';
      $('lotteryTitle').textContent = '就快揭曉';
      $('lotteryResultText').textContent = '好運正在停下來…';
    }, 1720);
    lotteryRevealTimeout = window.setTimeout(function () { revealLotteryResult(claimedReward); }, 2380);
  }

  async function claimSelectedReward(confirmationCode) {
    if (!selectedTicket || rewardClaimInFlight) return;
    const ticket = selectedTicket;
    rewardClaimInFlight = true;
    $('scanRewardButton').disabled = true;
    $('memberCardSelect').disabled = true;
    showProcessing('reward');
    try {
      const result = await PointsCard.callApi('reward.claim', {
        cardId: ticket.cardId || currentMember.selectedCardId || currentMember.card.cardId,
        confirmationCode: confirmationCode,
        expectedRewardOrdinal: ticket.entitlementOrdinal,
        expectedRewardNodesUpdatedAt: currentMember.rewardNodesUpdatedAt || '',
        requestId: rewardRequestId(ticket, confirmationCode)
      });
      rewardClaimRetry = null;
      selectedTicket = null;
      renderMember(result.member, false);
      closeDialog($('ticketDialog'));
      if (result.claimedReward.rewardType === 'lottery') playLotteryAnimation(result.claimedReward);
      else {
        $('couponResultTitle').textContent = result.claimedReward.rewardName || '優惠已確認';
        $('couponResultMessage').textContent = '票券已完成核銷，請向店員出示此畫面。';
        openDialog($('couponResultDialog'));
      }
    } catch (error) {
      if (terminalRewardErrors.has(error.code)) rewardClaimRetry = null;
      $('rewardErrorMessage').textContent = error && error.message ? error.message : '請確認店家 QR Code 後再試一次。';
      openDialog($('rewardErrorDialog'));
    } finally {
      rewardClaimInFlight = false;
      hideProcessing();
      $('memberCardSelect').disabled = false;
      $('scanRewardButton').disabled = false;
    }
  }

  async function scanRewardConfirmation() {
    if (!selectedTicket) return;
    try {
      const confirmationCode = await scanAppUrl('rewardConfirm', '這不是本店的票券確認 QR Code。');
      await claimSelectedReward(confirmationCode);
    } catch (error) {
      $('rewardErrorMessage').textContent = error && error.message ? error.message : '請確認店家 QR Code 後再試一次。';
      openDialog($('rewardErrorDialog'));
    }
  }

  function bindEvents() {
    $('retryButton').addEventListener('click', function () { window.location.reload(); });
    $('refreshButton').addEventListener('click', function () {
      $('refreshButton').disabled = true;
      loadMember().catch(showFatalError).finally(function () { $('refreshButton').disabled = false; });
    });
    $('memberCardSelect').addEventListener('change', function () {
      switchCard($('memberCardSelect').value).catch(showFatalError);
    });
    $('scanStampButton').addEventListener('click', function () {
      scanStampCode().catch(function (error) { $('stampErrorMessage').textContent = error.message; openDialog($('stampErrorDialog')); });
    });
    $('scanRewardButton').addEventListener('click', scanRewardConfirmation);
    $('closeTicketButton').addEventListener('click', function () { closeDialog($('ticketDialog')); });
    $('confirmSuccessButton').addEventListener('click', function () { closeDialog($('successDialog')); });
    $('confirmStampErrorButton').addEventListener('click', function () { closeDialog($('stampErrorDialog')); });
    $('confirmRewardErrorButton').addEventListener('click', function () { closeDialog($('rewardErrorDialog')); });
    $('confirmCouponResultButton').addEventListener('click', function () { closeDialog($('couponResultDialog')); });
    $('confirmLotteryButton').addEventListener('click', function () { closeDialog($('lotteryDialog')); });
    $('lotteryDialog').addEventListener('cancel', function (event) { if ($('confirmLotteryButton').disabled) event.preventDefault(); });
    $('lotteryDialog').addEventListener('close', clearLotteryAnimationTimers);
  }

  async function init() {
    bindEvents();
    const authenticated = await PointsCard.ensureLiffLogin();
    if (!authenticated) return;
    await loadMember();
    const navigation = PointsCard.getNavigationState();
    if (navigation.stamp && currentMember && !currentMember.cards.length) {
      PointsCard.clearNavigationState();
      return;
    }
    if (navigation.stamp) {
      const requestId = navigation.request || PointsCard.randomHex(16);
      if (!navigation.request) {
        const url = new URL(window.location.href);
        url.searchParams.set('request', requestId);
        window.history.replaceState(null, '', url.href);
      }
      await recordStamp(navigation.stamp, requestId, true);
    }
  }

  init().catch(showFatalError);
})();
