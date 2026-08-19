(function () {
  'use strict';

  const $ = (selector) => document.querySelector(selector);
  const statusLabels = { active: '有效', suspended: '停權', disabled: '停用' };
  let dashboard = null;
  let selectedMember = null;
  let toastTimer = null;

  function showToast(message) {
    const node = $('#toast');
    node.textContent = message;
    node.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => node.classList.add('hidden'), 2800);
  }

  function showError(error) {
    $('#boot').classList.add('hidden');
    $('#app').classList.add('hidden');
    $('#errorMessage').textContent = error && error.message ? error.message : '請稍後再試。';
    $('#errorState').classList.remove('hidden');
  }

  function setDefaultExpiry() {
    const d = new Date(Date.now() + 60 * 60 * 1000);
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    $('#voucherExpiresAt').value = local;
  }

  function localDateToIso(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new Error('請選擇有效的到期時間。');
    return date.toISOString();
  }

  function render(data) {
    dashboard = data;
    $('#metricMembers').textContent = data.stats.totalMembers;
    $('#metricActive').textContent = data.stats.activeMembers;
    $('#metricBalance').textContent = new Intl.NumberFormat('zh-TW').format(data.stats.pointsBalance);
    $('#metricEarned').textContent = new Intl.NumberFormat('zh-TW').format(data.stats.lifetimeEarned);
    $('#targetPointsInput').value = data.settings.targetPoints;
    $('#rewardTitleInput').value = data.settings.rewardTitle;
    $('#rewardDialogTitle').textContent = data.settings.rewardTitle;
    $('#rewardCost').textContent = data.settings.targetPoints;
    renderMembers(data.members || []);
    renderVouchers(data.vouchers || []);
    renderTransactions(data.transactions || []);
    $('#boot').classList.add('hidden');
    $('#errorState').classList.add('hidden');
    $('#app').classList.remove('hidden');
  }

  function renderMembers(members) {
    const tbody = $('#memberRows');
    tbody.replaceChildren();
    $('#memberEmpty').classList.toggle('hidden', members.length > 0);
    members.forEach((member) => {
      const tr = document.createElement('tr');
      const memberTd = document.createElement('td');
      memberTd.className = 'member-cell';
      const name = document.createElement('strong');
      name.textContent = member.displayName || 'LINE 會員';
      const no = document.createElement('span');
      no.textContent = member.pointMemberNo;
      memberTd.append(name, no);
      const pointsTd = document.createElement('td');
      pointsTd.className = 'points-value';
      pointsTd.textContent = member.pointsBalance;
      const earnedTd = document.createElement('td');
      earnedTd.textContent = member.lifetimeEarned;
      const statusTd = document.createElement('td');
      const select = document.createElement('select');
      select.className = 'status-select';
      Object.keys(statusLabels).forEach((value) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = statusLabels[value];
        option.selected = value === member.status;
        select.appendChild(option);
      });
      select.addEventListener('change', async () => {
        const previous = member.status;
        try {
          const result = await PointCard.callApi('admin.member.status', {
            pointMemberNo: member.pointMemberNo,
            status: select.value,
            expectedUpdatedAt: member.updatedAt
          });
          replaceMember(result.member);
          showToast('會員狀態已更新。');
        } catch (error) {
          select.value = previous;
          showToast(error.message || '狀態更新失敗。');
        }
      });
      statusTd.appendChild(select);
      const actionTd = document.createElement('td');
      const actions = document.createElement('div');
      actions.className = 'row-actions';
      const adjust = document.createElement('button');
      adjust.type = 'button';
      adjust.className = 'small-button';
      adjust.textContent = '調整點數';
      adjust.addEventListener('click', () => openAdjust(member));
      const redeem = document.createElement('button');
      redeem.type = 'button';
      redeem.className = 'small-button warn';
      redeem.textContent = '兌換獎勵';
      redeem.disabled = member.pointsBalance < dashboard.settings.targetPoints;
      redeem.addEventListener('click', () => openReward(member));
      actions.append(adjust, redeem);
      actionTd.appendChild(actions);
      tr.append(memberTd, pointsTd, earnedTd, statusTd, actionTd);
      tbody.appendChild(tr);
    });
  }

  function renderVouchers(vouchers) {
    const tbody = $('#voucherRows');
    tbody.replaceChildren();
    vouchers.forEach((voucher) => {
      const tr = document.createElement('tr');
      [voucher.voucherId, `${voucher.points} 點`, voucher.statusLabel, PointCard.formatDate(voucher.expiresAt)].forEach((text) => {
        const td = document.createElement('td');
        td.textContent = text;
        tr.appendChild(td);
      });
      const action = document.createElement('td');
      if (voucher.status === 'issued') {
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'small-button danger';
        cancel.textContent = '停止';
        cancel.addEventListener('click', async () => {
          try {
            const result = await PointCard.callApi('admin.voucher.cancel', { voucherId: voucher.voucherId });
            upsertVoucher(result.voucher);
            showToast('集點碼已停止。');
          } catch (error) {
            showToast(error.message || '停止失敗。');
          }
        });
        action.appendChild(cancel);
      } else {
        action.textContent = '—';
      }
      tr.appendChild(action);
      tbody.appendChild(tr);
    });
  }

  function renderTransactions(items) {
    const list = $('#transactionList');
    list.replaceChildren();
    items.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'tx-row';
      const main = document.createElement('div');
      main.className = 'tx-main';
      const title = document.createElement('strong');
      title.textContent = `${item.pointMemberNo} · ${item.label}`;
      const meta = document.createElement('span');
      meta.textContent = `${PointCard.formatDate(item.createdAt)} · 餘額 ${item.balanceAfter} 點`;
      main.append(title, meta);
      const delta = document.createElement('div');
      const value = Number(item.pointsDelta || 0);
      delta.className = `tx-delta ${value >= 0 ? 'positive' : 'negative'}`;
      delta.textContent = `${value >= 0 ? '+' : ''}${value}`;
      row.append(main, delta);
      list.appendChild(row);
    });
  }

  function recomputeStats() {
    const members = dashboard.members || [];
    dashboard.stats = {
      totalMembers: members.length,
      activeMembers: members.filter((m) => m.status === 'active').length,
      pointsBalance: members.reduce((sum, m) => sum + Number(m.pointsBalance || 0), 0),
      lifetimeEarned: members.reduce((sum, m) => sum + Number(m.lifetimeEarned || 0), 0)
    };
  }

  function replaceMember(member) {
    const index = dashboard.members.findIndex((item) => item.pointMemberNo === member.pointMemberNo);
    if (index >= 0) dashboard.members[index] = member;
    else dashboard.members.unshift(member);
    recomputeStats();
    render(dashboard);
  }

  function upsertVoucher(voucher) {
    const index = dashboard.vouchers.findIndex((item) => item.voucherId === voucher.voucherId);
    if (index >= 0) dashboard.vouchers[index] = voucher;
    else dashboard.vouchers.unshift(voucher);
    renderVouchers(dashboard.vouchers);
  }

  function openAdjust(member) {
    selectedMember = member;
    $('#adjustMemberLabel').textContent = `${member.displayName || 'LINE 會員'} · ${member.pointMemberNo} · 目前 ${member.pointsBalance} 點`;
    $('#adjustDelta').value = '';
    $('#adjustNote').value = '';
    $('#adjustError').classList.add('hidden');
    $('#adjustDialog').showModal();
  }

  function openReward(member) {
    selectedMember = member;
    $('#rewardMemberLabel').textContent = `${member.displayName || 'LINE 會員'} · ${member.pointMemberNo} · 目前 ${member.pointsBalance} 點`;
    $('#rewardNote').value = '';
    $('#rewardError').classList.add('hidden');
    $('#rewardDialog').showModal();
  }

  async function loadDashboard() {
    const result = await PointCard.callApi('admin.dashboard');
    render(result);
  }

  async function saveSettings() {
    const targetPoints = Number($('#targetPointsInput').value);
    const rewardTitle = $('#rewardTitleInput').value.trim();
    const button = $('#saveSettingsButton');
    button.disabled = true;
    try {
      const result = await PointCard.callApi('admin.settings.update', { targetPoints, rewardTitle });
      dashboard.settings = result.settings;
      render(dashboard);
      $('#settingsMessage').textContent = '集點規則已更新。';
      $('#settingsMessage').classList.remove('hidden');
    } catch (error) {
      $('#settingsMessage').textContent = error.message || '設定更新失敗。';
      $('#settingsMessage').classList.remove('hidden');
    } finally {
      button.disabled = false;
    }
  }

  async function createVoucher(event) {
    event.preventDefault();
    const button = $('#createVoucherButton');
    button.disabled = true;
    try {
      const points = Number($('#voucherPoints').value);
      const expiresAt = localDateToIso($('#voucherExpiresAt').value);
      const note = $('#voucherNote').value.trim();
      const result = await PointCard.callApi('admin.voucher.create', { points, expiresAt, note, requestId: PointCard.createRequestId() });
      upsertVoucher(result.voucher);
      const userUrl = new URL('../user/', window.location.href);
      userUrl.searchParams.set('claim', result.claimCode);
      $('#shareUrl').value = userUrl.href;
      $('#sharePoints').textContent = `${result.voucher.points} 點`;
      $('#shareBox').classList.remove('hidden');
      showToast('一次性集點碼已建立。');
    } catch (error) {
      showToast(error.message || '集點碼建立失敗。');
    } finally {
      button.disabled = false;
    }
  }

  async function initialize() {
    try {
      await PointCard.loadConfig();
      const loggedIn = await PointCard.ensureLiffLogin();
      if (!loggedIn) return;
      setDefaultExpiry();
      await loadDashboard();
    } catch (error) {
      showError(error);
    }
  }

  $('#retryButton').addEventListener('click', () => window.location.reload());
  $('#refreshButton').addEventListener('click', () => window.location.reload());
  $('#saveSettingsButton').addEventListener('click', saveSettings);
  $('#voucherForm').addEventListener('submit', createVoucher);
  $('#copyShareButton').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText($('#shareUrl').value);
      showToast('集點連結已複製。');
    } catch (_) {
      $('#shareUrl').select();
      document.execCommand('copy');
      showToast('集點連結已複製。');
    }
  });
  $('#cancelAdjustButton').addEventListener('click', () => $('#adjustDialog').close());
  $('#cancelRewardButton').addEventListener('click', () => $('#rewardDialog').close());

  $('#adjustForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!selectedMember) return;
    $('#adjustError').classList.add('hidden');
    try {
      const result = await PointCard.callApi('admin.member.adjust', {
        pointMemberNo: selectedMember.pointMemberNo,
        delta: Number($('#adjustDelta').value),
        note: $('#adjustNote').value.trim(),
        expectedUpdatedAt: selectedMember.updatedAt,
        requestId: PointCard.createRequestId()
      });
      $('#adjustDialog').close();
      replaceMember(result.member);
      dashboard.transactions.unshift(result.transaction);
      dashboard.transactions = dashboard.transactions.slice(0, 50);
      renderTransactions(dashboard.transactions);
      showToast('點數已調整。');
    } catch (error) {
      $('#adjustError').textContent = error.message || '點數調整失敗。';
      $('#adjustError').classList.remove('hidden');
    }
  });

  $('#rewardForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!selectedMember) return;
    $('#rewardError').classList.add('hidden');
    try {
      const result = await PointCard.callApi('admin.reward.redeem', {
        pointMemberNo: selectedMember.pointMemberNo,
        note: $('#rewardNote').value.trim(),
        expectedUpdatedAt: selectedMember.updatedAt,
        requestId: PointCard.createRequestId()
      });
      $('#rewardDialog').close();
      replaceMember(result.member);
      dashboard.transactions.unshift(result.transaction);
      dashboard.transactions = dashboard.transactions.slice(0, 50);
      renderTransactions(dashboard.transactions);
      showToast('獎勵兌換已記錄。');
    } catch (error) {
      $('#rewardError').textContent = error.message || '兌獎失敗。';
      $('#rewardError').classList.remove('hidden');
    }
  });

  initialize();
})();
