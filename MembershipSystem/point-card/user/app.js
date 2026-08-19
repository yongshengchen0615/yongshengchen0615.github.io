(function () {
  'use strict';

  const $ = (selector) => document.querySelector(selector);
  const statusLabels = { active: '有效', suspended: '停權', disabled: '停用' };
  let state = null;
  let publicConfig = null;
  let claimInFlight = false;
  let scanInFlight = false;

  function validCode(value) {
    const text = String(value || '').trim().toLowerCase();
    return /^[a-f0-9]{64}$/.test(text) ? text : '';
  }

  function validRequestId(value) {
    const text = String(value || '').trim().toLowerCase();
    return /^[a-f0-9]{32,64}$/.test(text) ? text : '';
  }

  function currentUrl() { return new URL(window.location.href); }

  function readClaimFromUrl(url) {
    return validCode((url || currentUrl()).searchParams.get('claim'));
  }

  function ensureRequestId(code) {
    const url = currentUrl();
    const sameClaim = validCode(url.searchParams.get('claim')) === code;
    const existing = sameClaim ? validRequestId(url.searchParams.get('request')) : '';
    const requestId = existing || PointCard.createRequestId();
    url.searchParams.set('claim', code);
    url.searchParams.set('request', requestId);
    history.replaceState(null, '', url.href);
    return requestId;
  }

  function clearClaimUrl() {
    const url = currentUrl();
    url.searchParams.delete('claim');
    url.searchParams.delete('request');
    history.replaceState(null, '', url.href);
  }

  function renderStamps(balance, target) {
    const grid = $('#stampGrid');
    grid.replaceChildren();
    const count = Math.max(1, Math.min(Number(target || 10), 30));
    const filled = Math.min(Number(balance || 0), count);
    for (let i = 1; i <= count; i += 1) {
      const stamp = document.createElement('div');
      stamp.className = `stamp${i <= filled ? ' filled' : ''}`;
      stamp.textContent = i <= filled ? '✓' : i;
      grid.appendChild(stamp);
    }
  }

  function renderState(data) {
    state = data;
    const member = data.member;
    const settings = data.settings;
    const balance = Number(member.pointsBalance || 0);
    const target = Number(settings.targetPoints || 10);
    const rewardsReady = Math.floor(balance / target);
    const remaining = balance >= target ? 0 : target - balance;

    $('#displayName').textContent = member.displayName || 'LINE 會員';
    $('#pointMemberNo').textContent = member.pointMemberNo;
    $('#statusBadge').textContent = statusLabels[member.status] || '停用';
    $('#pointsBalance').textContent = new Intl.NumberFormat('zh-TW').format(balance);
    $('#targetPoints').textContent = target;
    $('#rewardTitle').textContent = settings.rewardTitle;
    $('#progressLabel').textContent = `${Math.min(balance, target)} / ${target}`;
    renderStamps(balance, target);

    if (rewardsReady > 0) {
      $('#rewardReadyBadge').classList.remove('hidden');
      $('#rewardReadyBadge').textContent = `可兌換 ${rewardsReady} 份`;
      $('#rewardSummary').textContent = `目前可兌換 ${rewardsReady} 份「${settings.rewardTitle}」，請由工作人員在管理端完成兌獎。`;
    } else {
      $('#rewardReadyBadge').classList.add('hidden');
      $('#rewardSummary').textContent = `再集 ${remaining} 點即可兌換「${settings.rewardTitle}」。`;
    }

    renderHistory(data.transactions || []);
    $('#boot').classList.add('hidden');
    $('#errorState').classList.add('hidden');
    $('#app').classList.remove('hidden');
  }

  function renderHistory(items) {
    const list = $('#historyList');
    list.replaceChildren();
    $('#historyEmpty').classList.toggle('hidden', items.length > 0);
    items.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'history-item';

      const main = document.createElement('div');
      main.className = 'history-main';
      const title = document.createElement('strong');
      title.textContent = item.label || '點數異動';
      const meta = document.createElement('span');
      meta.textContent = `${PointCard.formatDate(item.createdAt)} · 餘額 ${item.balanceAfter} 點`;
      main.append(title, meta);

      const points = document.createElement('div');
      const delta = Number(item.pointsDelta || 0);
      points.className = `history-points ${delta >= 0 ? 'positive' : 'negative'}`;
      points.textContent = `${delta >= 0 ? '+' : ''}${delta}`;

      row.append(main, points);
      list.appendChild(row);
    });
  }

  function showMessage(kind, title, body) {
    const icon = $('#messageIcon');
    icon.classList.toggle('error', kind === 'error');
    icon.textContent = kind === 'error' ? '!' : '✓';
    $('#messageEyebrow').textContent = kind === 'error' ? 'POINT CARD ERROR' : 'POINTS ADDED';
    $('#messageTitle').textContent = title;
    $('#messageBody').textContent = body;
    $('#messageOverlay').classList.remove('hidden');
    $('#messageConfirmButton').focus();
  }

  function showError(error) {
    $('#boot').classList.add('hidden');
    $('#app').classList.add('hidden');
    $('#errorMessage').textContent = error && error.message ? error.message : '請稍後再試。';
    $('#errorState').classList.remove('hidden');
  }

  async function loadMember() {
    const result = await PointCard.callApi('member.me');
    renderState(result);
    return result;
  }

  async function claimPoints(code) {
    if (!code || claimInFlight) return false;
    claimInFlight = true;
    $('#loadingOverlay').classList.remove('hidden');

    try {
      const requestId = ensureRequestId(code);
      const result = await PointCard.callApi('points.claim', { code, requestId });
      renderState(result.dashboard);
      clearClaimUrl();
      const tx = result.transaction;
      showMessage('success', result.alreadyClaimed ? '此筆點數已加入' : '集點成功', `本次 ${tx.pointsDelta >= 0 ? '+' : ''}${tx.pointsDelta} 點，目前共 ${result.dashboard.member.pointsBalance} 點。`);
      return true;
    } catch (error) {
      showMessage('error', '無法加入點數', error && error.message ? error.message : '此集點碼目前無法使用。');
      return false;
    } finally {
      claimInFlight = false;
      $('#loadingOverlay').classList.add('hidden');
    }
  }

  function readScannedClaim(value) {
    let url;
    try { url = new URL(String(value || '')); }
    catch (_) { throw new Error('掃描內容不是有效的集點網址。'); }

    const expected = new URL('./', window.location.href);
    const config = publicConfig;
    const samePage = url.origin === expected.origin && url.pathname === expected.pathname;
    const liffPath = config && config.LIFF_ID ? `/${encodeURIComponent(config.LIFF_ID)}/` : '';
    const sameLiff = url.origin === 'https://liff.line.me' && url.pathname === liffPath;
    if (!samePage && !sameLiff) throw new Error('此 QR Code 不是本集點卡系統的網址。');

    const code = validCode(url.searchParams.get('claim'));
    if (!code) throw new Error('此 QR Code 缺少有效集點碼。');
    return code;
  }

  async function scan() {
    if (scanInFlight || claimInFlight) return;
    scanInFlight = true;
    const button = $('#scanButton');
    const original = button.textContent;
    button.disabled = true;
    button.textContent = '正在開啟掃描器…';
    try {
      if (typeof liff.isApiAvailable !== 'function' || !liff.isApiAvailable('scanCodeV2') || typeof liff.scanCodeV2 !== 'function') {
        throw new Error('目前環境不支援 LINE QR 掃描器，請直接開啟管理端分享的集點連結。');
      }
      const scanned = await liff.scanCodeV2();
      const code = readScannedClaim(scanned && scanned.value);
      await claimPoints(code);
    } catch (error) {
      showMessage('error', '無法掃描集點碼', error && error.message ? error.message : '掃描失敗。');
    } finally {
      scanInFlight = false;
      button.disabled = false;
      button.textContent = original;
    }
  }

  async function initialize() {
    try {
      publicConfig = await PointCard.loadConfig();
      const loggedIn = await PointCard.ensureLiffLogin();
      if (!loggedIn) return;
      await loadMember();
      const code = readClaimFromUrl();
      if (code) await claimPoints(code);
    } catch (error) {
      showError(error);
    }
  }

  $('#refreshButton').addEventListener('click', () => window.location.reload());
  $('#retryButton').addEventListener('click', () => window.location.reload());
  $('#scanButton').addEventListener('click', () => scan());
  $('#messageConfirmButton').addEventListener('click', () => $('#messageOverlay').classList.add('hidden'));

  initialize();
})();
