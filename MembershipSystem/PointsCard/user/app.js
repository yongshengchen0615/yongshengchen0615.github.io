(function () {
  'use strict';

  const $ = function (id) { return document.getElementById(id); };
  const terminalStampErrors = new Set([
    'INVALID_STAMP_CODE', 'VOUCHER_NOT_FOUND', 'VOUCHER_USED', 'VOUCHER_EXPIRED',
    'VOUCHER_INACTIVE', 'MEMBER_INACTIVE'
  ]);
  let currentMember = null;
  let currentActivity = [];
  let stampRequestInFlight = false;

  const avatarFallback = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"%3E%3Crect width="96" height="96" rx="48" fill="%23dfe6df"/%3E%3Ccircle cx="48" cy="38" r="17" fill="%23173f35" fill-opacity=".35"/%3E%3Cpath d="M19 88c3-18 14-27 29-27s26 9 29 27" fill="%23173f35" fill-opacity=".35"/%3E%3C/svg%3E';

  function formatNumber(value) {
    return new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 }).format(Number(value || 0));
  }

  function normalizeRewardContract(member) {
    const normalized = Object.assign({}, member);
    const cardSize = Number(normalized.cardSize || normalized.stampsPerReward || 10);
    if (!Array.isArray(normalized.rewardNodes) || !normalized.rewardNodes.length) {
      normalized.rewardNodes = [{
        nodeId: 'node-' + cardSize,
        stampsRequired: cardSize,
        rewardName: normalized.rewardName || '本期集點獎勵',
        state: Number(normalized.availableRewards || 0) > 0 ? 'available' : 'pending'
      }];
    }
    if (!Array.isArray(normalized.availableRewardNodes)) {
      normalized.availableRewardNodes = Number(normalized.availableRewards || 0) > 0 ? [{
        entitlementOrdinal: Number(normalized.redeemedRewards || 0) + 1,
        stampsRequired: cardSize,
        rewardName: normalized.rewardName || '本期集點獎勵',
        cycleNumber: Math.max(1, Math.floor(Number(normalized.totalStamps || 0) / cardSize))
      }] : [];
    }
    normalized.nextAvailableReward = normalized.nextAvailableReward || normalized.availableRewardNodes[0] || null;
    normalized.stampsUntilNextReward = normalized.stampsUntilNextReward == null ? Number(normalized.stampsUntilReward || 0) : Number(normalized.stampsUntilNextReward);
    normalized.cardSize = cardSize;
    normalized.displayCycleNumber = normalized.displayCycleNumber || Math.max(1, Math.ceil(Number(normalized.totalStamps || 0) / cardSize));
    return normalized;
  }

  function showFatalError(error) {
    $('bootState').classList.add('hidden');
    $('memberApp').classList.add('hidden');
    $('errorMessage').textContent = error && error.message ? error.message : '請稍後再試。';
    $('errorState').classList.remove('hidden');
  }

  function createStamp(index, active, justAdded, rewardNode) {
    const stamp = document.createElement('div');
    stamp.className = 'stamp' + (active ? ' active' : '') + (justAdded ? ' just-added' : '') +
      (rewardNode ? ' reward-node ' + rewardNode.state : '');
    stamp.setAttribute('aria-label', '第 ' + (index + 1) + ' 格' + (active ? '，已集點' : '，尚未集點') +
      (rewardNode ? '，獎勵：' + rewardNode.rewardName : ''));
    if (active) {
      const symbol = document.createElement('span');
      symbol.className = 'stamp-symbol';
      symbol.textContent = rewardNode ? '✦' : 'P';
      stamp.append(symbol);
    }
    const number = document.createElement('span');
    number.className = 'stamp-index';
    number.textContent = String(index + 1).padStart(2, '0');
    stamp.append(number);
    return stamp;
  }

  function renderStampGrid(member, animateLatest) {
    const total = Number(member.cardSize || member.stampsPerReward || 10);
    const filled = Number(member.visualStamps || 0);
    const rewardNodes = Array.isArray(member.rewardNodes) ? member.rewardNodes : [];
    const grid = $('stampGrid');
    grid.replaceChildren();
    for (let index = 0; index < total; index += 1) {
      const rewardNode = rewardNodes.find(function (node) { return Number(node.stampsRequired) === index + 1; }) || null;
      grid.append(createStamp(index, index < filled, Boolean(animateLatest && index === filled - 1), rewardNode));
    }
    $('visualStampCount').textContent = formatNumber(filled);
    $('stampsPerReward').textContent = formatNumber(total);
    $('displayCycleNumber').textContent = formatNumber(member.displayCycleNumber || 1);
  }

  function renderRewardNodes(member) {
    const target = $('rewardNodeMap');
    target.replaceChildren();
    (member.rewardNodes || []).forEach(function (node) {
      const row = document.createElement('div');
      row.className = 'reward-node-item ' + node.state;
      const point = document.createElement('span');
      point.className = 'node-point';
      point.textContent = node.stampsRequired + ' 點';
      const name = document.createElement('strong');
      name.textContent = node.rewardName;
      const state = document.createElement('span');
      state.className = 'reward-node-state';
      state.textContent = node.state === 'redeemed' ? '已兌換' : (node.state === 'available' ? '可兌換' : '未達成');
      row.append(point, name, state);
      target.append(row);
    });
  }

  function renderAvailableRewards(member) {
    const target = $('availableRewardList');
    target.replaceChildren();
    (member.availableRewardNodes || []).slice(0, 3).forEach(function (reward) {
      const item = document.createElement('span');
      item.textContent = '第 ' + reward.cycleNumber + ' 張 · ' + reward.stampsRequired + ' 點 — ' + reward.rewardName;
      target.append(item);
    });
    if (Number(member.availableRewards || 0) > 3) {
      const more = document.createElement('span');
      more.textContent = '另有 ' + formatNumber(member.availableRewards - 3) + ' 份獎勵';
      target.append(more);
    }
  }

  function renderMember(member, animateLatest) {
    member = normalizeRewardContract(member);
    currentMember = member;
    $('displayName').textContent = member.displayName || '會員';
    $('avatar').src = member.pictureUrl || avatarFallback;
    $('avatar').onerror = function () { $('avatar').src = avatarFallback; };
    $('memberNo').textContent = member.memberNo || '—';
    $('totalStamps').textContent = formatNumber(member.totalStamps);
    $('redeemedRewards').textContent = formatNumber(member.redeemedRewards);
    $('joinedAt').textContent = PointsCard.formatDate(member.joinedAt, '—');
    $('availableRewards').textContent = formatNumber(member.availableRewards);
    $('rewardReady').classList.toggle('hidden', Number(member.availableRewards || 0) < 1);
    renderAvailableRewards(member);

    const active = member.membershipStatus === 'active';
    $('scanStampButton').disabled = !active || stampRequestInFlight;
    $('memberStatusText').textContent = active
      ? '今天也來收集一枚好心情。'
      : '這張集點卡目前暫停使用，請洽店家確認。';

    const nextReward = member.nextReward;
    $('progressMessage').textContent = Number(member.availableRewards || 0) > 0
      ? '已有 ' + formatNumber(member.availableRewards) + ' 份獎勵待兌換'
      : (nextReward ? '再集 ' + formatNumber(member.stampsUntilNextReward) + ' 點獲得 ' + nextReward.rewardName :
        '再集 ' + formatNumber(member.stampsUntilNextReward) + ' 點獲得 ' + (member.rewardName || '本期獎勵'));
    renderStampGrid(member, animateLatest);
    renderRewardNodes(member);
  }

  function activityLabel(item) {
    if (item.type === 'reward') return '兌換 ' + (item.rewardName || '集點獎勵');
    return '集點 +' + formatNumber(item.stampCount);
  }

  function renderActivity(activity) {
    currentActivity = Array.isArray(activity) ? activity : [];
    $('activityCount').textContent = currentActivity.length + ' 筆';
    $('emptyActivity').classList.toggle('hidden', currentActivity.length !== 0);
    const list = $('activityList');
    list.replaceChildren();
    currentActivity.forEach(function (item) {
      const row = document.createElement('article');
      row.className = 'activity-item' + (item.type === 'reward' ? ' reward' : '');
      const icon = document.createElement('span');
      icon.className = 'activity-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = item.type === 'reward' ? '✦' : 'P';
      const copy = document.createElement('div');
      copy.className = 'activity-copy';
      const title = document.createElement('strong');
      title.textContent = activityLabel(item);
      const meta = document.createElement('span');
      meta.textContent = (item.note || (item.type === 'reward' ? '店員完成兌換' : '店家 QR Code')) + ' · ' + PointsCard.formatDateTime(item.createdAt, '—');
      copy.append(title, meta);
      const value = document.createElement('span');
      value.className = 'activity-value';
      value.textContent = item.type === 'reward' ? '已使用' : '+' + formatNumber(item.stampCount);
      row.append(icon, copy, value);
      list.append(row);
    });
  }

  async function loadMember() {
    const result = await PointsCard.callApi('member.me');
    renderMember(result.member, false);
    renderActivity(result.activity);
    $('bootState').classList.add('hidden');
    $('errorState').classList.add('hidden');
    $('memberApp').classList.remove('hidden');
    return result;
  }

  function openDialog(dialog) {
    if (dialog.open) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }

  function closeDialog(dialog) {
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
  }

  async function recordStamp(stampCode, requestId, fromNavigation) {
    if (stampRequestInFlight) return;
    stampRequestInFlight = true;
    $('scanStampButton').disabled = true;
    $('processingOverlay').classList.remove('hidden');
    try {
      const result = await PointsCard.callApi('stamp.record', {
        stampCode: stampCode,
        requestId: requestId
      });
      if (fromNavigation) PointsCard.clearNavigationState();
      renderMember(result.member, !result.duplicate);
      renderActivity(result.activity);
      $('successSealCount').textContent = '+' + formatNumber(result.stampCount);
      const unlockedNames = (result.unlockedRewards || []).map(function (reward) { return reward.rewardName; });
      $('successMessage').textContent = result.duplicate
        ? '這次請求先前已完成，集點卡已同步為最新狀態。'
        : '已加入 ' + formatNumber(result.stampCount) + ' 點；' + (unlockedNames.length
          ? '新獲得：' + unlockedNames.join('、') + '。'
          : '距離下一份獎勵還差 ' + formatNumber(currentMember.stampsUntilNextReward) + ' 點。');
      openDialog($('successDialog'));
    } catch (error) {
      if (fromNavigation && terminalStampErrors.has(error.code)) PointsCard.clearNavigationState();
      $('stampErrorMessage').textContent = error && error.message ? error.message : '請確認 QR Code 後再試一次。';
      openDialog($('stampErrorDialog'));
    } finally {
      stampRequestInFlight = false;
      $('processingOverlay').classList.add('hidden');
      $('scanStampButton').disabled = !currentMember || currentMember.membershipStatus !== 'active';
    }
  }

  async function scanStampCode() {
    if (!window.liff || typeof liff.scanCodeV2 !== 'function') {
      throw new Error('目前環境不支援相機掃描，請直接開啟店家提供的集點連結。');
    }
    const result = await liff.scanCodeV2();
    const raw = String(result && result.value || '').trim();
    let scannedUrl;
    try { scannedUrl = new URL(raw); }
    catch (_) { throw new Error('這不是有效的集點卡 QR Code。'); }

    const config = await PointsCard.loadConfig();
    const expectedLiffPath = '/' + encodeURIComponent(config.LIFF_ID) + '/';
    const currentRoot = new URL('../', window.location.href);
    const isLiffUrl = scannedUrl.origin === 'https://liff.line.me' && scannedUrl.pathname === expectedLiffPath;
    const isCurrentAppUrl = scannedUrl.origin === currentRoot.origin && scannedUrl.pathname.indexOf(currentRoot.pathname) === 0;
    const stampCode = PointsCard.validStampCode(scannedUrl.searchParams.get('stamp'));
    if ((!isLiffUrl && !isCurrentAppUrl) || !stampCode) throw new Error('這不是本店發行的集點 QR Code。');
    await recordStamp(stampCode, PointsCard.randomHex(16), false);
  }

  function bindEvents() {
    $('retryButton').addEventListener('click', function () { window.location.reload(); });
    $('refreshButton').addEventListener('click', function () {
      $('refreshButton').disabled = true;
      loadMember().catch(showFatalError).finally(function () { $('refreshButton').disabled = false; });
    });
    $('scanStampButton').addEventListener('click', function () {
      scanStampCode().catch(function (error) {
        $('stampErrorMessage').textContent = error.message;
        openDialog($('stampErrorDialog'));
      });
    });
    $('confirmSuccessButton').addEventListener('click', function () { closeDialog($('successDialog')); });
    $('confirmStampErrorButton').addEventListener('click', function () { closeDialog($('stampErrorDialog')); });
  }

  async function init() {
    bindEvents();
    const authenticated = await PointsCard.ensureLiffLogin();
    if (!authenticated) return;
    await loadMember();
    const navigation = PointsCard.getNavigationState();
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
