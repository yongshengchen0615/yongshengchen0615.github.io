(function () {
  'use strict';

  const $ = function (id) { return document.getElementById(id); };
  const statusLabels = { active: '有效', suspended: '停權', disabled: '停用' };
  const modeLabels = { single: '單次使用', 'per-member': '每位會員一次', repeatable: '可重複使用' };
  const voucherStatusLabels = { active: '有效', cancelled: '已停止', expired: '已過期', used: '已使用', deleted: '已刪除' };
  const rewardTypeLabels = { coupon: '優惠券', lottery: '抽獎券' };
  const avatarFallback = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 72 72"%3E%3Crect width="72" height="72" rx="36" fill="%23dfe5df"/%3E%3Ccircle cx="36" cy="28" r="13" fill="%23173f35" fill-opacity=".3"/%3E%3Cpath d="M14 68c2-14 10-21 22-21s20 7 22 21" fill="%23173f35" fill-opacity=".3"/%3E%3C/svg%3E';
  const adminTabNames = ['overview', 'reward-nodes', 'reward-confirmations', 'members', 'stamp-qr'];

  let members = [];
  let vouchers = [];
  let rewardConfirmations = [];
  let rewardSettings = {
    rewardNodes: [{ nodeId: 'node-10', stampsRequired: 10, rewardName: '本期優惠券', rewardType: 'coupon', lotteryPrizes: [] }],
    cardSize: 10,
    rewardNodesUpdatedAt: 'legacy',
    rewardSettingsLocked: false
  };
  let activeAdminTab = 'overview';
  let authenticated = false;
  let searchTimer = 0;
  let toastTimer = 0;
  let rewardRetry = null;
  let selectedRewardMember = null;
  let currentQrSvg = '';
  let currentRewardConfirmationQrSvg = '';
  let memberRequestSequence = 0;
  const loaded = {
    summary: false,
    members: false,
    vouchers: false,
    rewardConfirmations: false
  };

  function formatNumber(value) {
    return new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 }).format(Number(value || 0));
  }

  function reportError(error, context) {
    if (window.PointsCard && typeof PointsCard.reportError === 'function') {
      PointsCard.reportError(error, context || { source: 'admin' });
    }
  }

  function lotteryWeightBasis(value) {
    if (value == null || String(value).trim() === '') return null;
    const weight = Number(value);
    const basis = Math.round(weight * 100);
    if (!Number.isFinite(weight) || weight < 0 || weight > 100 || Math.abs((weight * 100) - basis) > 0.000001) return null;
    return basis;
  }

  function normalizeLotteryPrizesForEditor(value) {
    if (!Array.isArray(value)) return [];
    if (value.every(function (prize) { return typeof prize === 'string'; })) {
      const equalBasis = value.length ? Math.floor(10000 / value.length) : 0;
      return value.map(function (name, index) {
        const basis = index === value.length - 1 ? 10000 - (equalBasis * index) : equalBasis;
        return { name: name, weight: basis / 100 };
      });
    }
    return value.map(function (prize) {
      return {
        name: prize && prize.name != null ? String(prize.name) : '',
        weight: prize && prize.weight != null ? Number(prize.weight) : 0
      };
    });
  }

  function normalizeRewardSettings(value) {
    const source = value || {};
    const supported = Array.isArray(source.rewardNodes) && source.rewardNodes.length > 0;
    const ticketTypesSupported = source.rewardTicketTypesSupported === true;
    const lotteryWeightsSupported = source.rewardLotteryWeightsSupported === true;
    const cardSize = Number(source.cardSize || source.stampsPerReward || 10);
    return Object.assign({}, source, {
      rewardNodes: (supported ? source.rewardNodes : [{
        nodeId: 'node-' + cardSize,
        stampsRequired: cardSize,
        rewardName: source.rewardName || '本期集點獎勵'
      }]).map(function (node) {
        return Object.assign({}, node, {
          rewardType: node.rewardType === 'lottery' ? 'lottery' : 'coupon',
          lotteryPrizes: normalizeLotteryPrizesForEditor(node.lotteryPrizes)
        });
      }),
      cardSize: cardSize,
      rewardNodesUpdatedAt: source.rewardNodesUpdatedAt || 'legacy',
      rewardSettingsLocked: supported && ticketTypesSupported && lotteryWeightsSupported ? Boolean(source.rewardSettingsLocked) : true,
      rewardNodesSupported: supported,
      rewardTicketTypesSupported: ticketTypesSupported,
      rewardLotteryWeightsSupported: lotteryWeightsSupported
    });
  }

  function normalizeAdminMemberRewards(member) {
    const normalized = Object.assign({}, member);
    if (!normalized.nextAvailableReward && Number(normalized.availableRewards || 0) > 0) {
      const cardSize = Number(normalized.cardSize || normalized.stampsPerReward || rewardSettings.cardSize || 10);
      normalized.nextAvailableReward = {
        entitlementOrdinal: Number(normalized.redeemedRewards || 0) + 1,
        stampsRequired: cardSize,
        rewardName: normalized.rewardName || '本期集點獎勵',
        rewardType: 'coupon',
        cycleNumber: Math.max(1, Math.floor(Number(normalized.totalStamps || 0) / cardSize))
      };
    }
    return normalized;
  }

  function showFatalError(error) {
    reportError(error, { source: 'admin', action: 'fatal' });
    $('bootState').classList.add('hidden');
    $('adminApp').classList.add('hidden');
    $('errorMessage').textContent = error && error.message ? error.message : '請確認管理權限後再試。';
    $('errorState').classList.remove('hidden');
  }

  function showToast(message) {
    window.clearTimeout(toastTimer);
    $('toast').textContent = message;
    $('toast').classList.remove('hidden');
    toastTimer = window.setTimeout(function () { $('toast').classList.add('hidden'); }, 3600);
  }

  function showFormError(id, error) {
    const target = $(id);
    target.textContent = error && error.message ? error.message : '操作失敗，請稍後再試。';
    target.classList.remove('hidden');
  }

  function clearFormError(id) {
    $(id).textContent = '';
    $(id).classList.add('hidden');
  }

  function selectAdminTab(tabName, focusTab) {
    const nextTab = adminTabNames.indexOf(tabName) >= 0 ? tabName : 'overview';
    activeAdminTab = nextTab;
    let selectedTab = null;
    document.querySelectorAll('[data-admin-tab]').forEach(function (tab) {
      const selected = tab.dataset.adminTab === nextTab;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      if (selected) selectedTab = tab;
    });
    document.querySelectorAll('[data-admin-panel]').forEach(function (panel) {
      panel.hidden = panel.dataset.adminPanel !== nextTab;
    });
    if (selectedTab && focusTab) {
      selectedTab.focus();
      if (typeof selectedTab.scrollIntoView === 'function') {
        const reduceMotion = typeof window.matchMedia === 'function'
          && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        selectedTab.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'nearest', inline: 'nearest' });
      }
    }
    if (authenticated) {
      loadAdminTab(nextTab, false).catch(function (error) {
        reportError(error, { source: 'admin-tab', action: nextTab });
        showToast(error.message || '資料載入失敗。');
      });
    }
  }

  function handleAdminTabKeydown(event) {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].indexOf(event.key) < 0) return;
    event.preventDefault();
    const currentIndex = Math.max(0, adminTabNames.indexOf(activeAdminTab));
    let nextIndex = currentIndex;
    if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = adminTabNames.length - 1;
    else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + adminTabNames.length) % adminTabNames.length;
    else nextIndex = (currentIndex + 1) % adminTabNames.length;
    selectAdminTab(adminTabNames[nextIndex], true);
  }

  function openDialog(dialog) {
    if (!dialog.open) dialog.showModal();
  }

  function closeDialog(dialog) {
    if (dialog.open) dialog.close();
  }

  function createTextButton(label, className, handler, disabled) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'text-button' + (className ? ' ' + className : '');
    button.textContent = label;
    button.disabled = Boolean(disabled);
    button.addEventListener('click', handler);
    return button;
  }

  function setTableCellLabels(cells, labels) {
    cells.forEach(function (cell, index) {
      cell.dataset.label = labels[index] || '';
    });
  }

  function renderMetrics(stats) {
    $('metricMembers').textContent = formatNumber(stats.totalMembers);
    $('metricActive').textContent = formatNumber(stats.activeMembers) + ' 位有效會員';
    $('metricStamps').textContent = formatNumber(stats.totalStamps);
    $('metricRewards').textContent = formatNumber(stats.redeemedRewards);
    $('rewardNameMetric').textContent = rewardSettings.rewardNodes.length + ' 個節點 · 滿卡 ' + rewardSettings.cardSize + ' 點';
  }

  async function loadSummary() {
    const result = await PointsCard.callApi('admin.summary');
    rewardSettings = normalizeRewardSettings(result.settings || rewardSettings);
    renderMetrics(result.stats || {});
    renderRewardSettings();
    loaded.summary = true;
    $('bootState').classList.add('hidden');
    $('errorState').classList.add('hidden');
    $('adminApp').classList.remove('hidden');
    return result;
  }

  async function loadMembers(query) {
    const requestSequence = ++memberRequestSequence;
    const result = await PointsCard.callApi('admin.members.search', {
      query: query || '',
      page: 1,
      pageSize: 100
    });
    if (requestSequence !== memberRequestSequence) return result;
    members = (result.members || []).map(normalizeAdminMemberRewards);
    loaded.members = true;
    renderMembers();
    return result;
  }

  async function loadVouchers() {
    const result = await PointsCard.callApi('admin.stamps.list', { limit: 50 });
    vouchers = result.vouchers || [];
    loaded.vouchers = true;
    renderVouchers();
    return result;
  }

  async function loadRewardConfirmations() {
    const result = await PointsCard.callApi('admin.reward-confirmations.list', { limit: 50 });
    rewardConfirmations = result.rewardConfirmations || [];
    loaded.rewardConfirmations = true;
    renderRewardConfirmations();
    return result;
  }

  async function loadAdminTab(tabName, force) {
    if (tabName === 'overview' || tabName === 'reward-nodes') {
      if (force || !loaded.summary) await loadSummary();
      return;
    }
    if (tabName === 'members') {
      if (force || !loaded.members) await loadMembers($('memberSearch').value.trim());
      return;
    }
    if (tabName === 'stamp-qr') {
      if (force || !loaded.vouchers) await loadVouchers();
      return;
    }
    if (tabName === 'reward-confirmations') {
      if (force || !loaded.rewardConfirmations) await loadRewardConfirmations();
    }
  }

  function syncLotteryPrizeControls(prizesField) {
    const rows = Array.from(prizesField.querySelectorAll('.lottery-prize-row'));
    const bases = rows.map(function (row) {
      return lotteryWeightBasis(row.querySelector('.lottery-prize-weight').value);
    });
    const hasInvalidWeight = bases.some(function (basis) { return basis == null; });
    const totalBasis = bases.reduce(function (total, basis) { return total + (basis == null ? 0 : basis); }, 0);
    const total = prizesField.querySelector('.lottery-prize-total');
    if (hasInvalidWeight) total.textContent = '請檢查中獎率';
    else if (totalBasis === 10000) total.textContent = '✓ 已分配 100%';
    else if (totalBasis < 10000) total.textContent = '尚需分配 ' + String((10000 - totalBasis) / 100) + '%';
    else total.textContent = '超出 ' + String((totalBasis - 10000) / 100) + '%';
    total.classList.toggle('valid', !hasInvalidWeight && totalBasis === 10000);
    total.classList.toggle('invalid', hasInvalidWeight || totalBasis !== 10000);
    total.setAttribute('aria-label', total.textContent);
    rows.forEach(function (row, index) {
      row.querySelector('.lottery-prize-order').textContent = String(index + 1);
      row.querySelector('.remove-prize-button').disabled = Boolean(rewardSettings.rewardSettingsLocked) || rows.length <= 2;
    });
    prizesField.querySelector('.add-prize-button').disabled = Boolean(rewardSettings.rewardSettingsLocked) || rows.length >= 8;
  }

  function appendLotteryPrizeRow(prizesField, prize) {
    const locked = Boolean(rewardSettings.rewardSettingsLocked);
    const list = prizesField.querySelector('.lottery-prize-list');
    const prizeRow = document.createElement('div');
    prizeRow.className = 'lottery-prize-row';
    const prizeOrder = document.createElement('span');
    prizeOrder.className = 'lottery-prize-order';
    const nameInput = document.createElement('input');
    nameInput.className = 'lottery-prize-name';
    nameInput.type = 'text';
    nameInput.maxLength = 80;
    nameInput.placeholder = '獎項名稱';
    nameInput.setAttribute('aria-label', '抽獎獎項名稱');
    nameInput.value = prize && prize.name ? prize.name : '';
    nameInput.disabled = locked;
    const weightField = document.createElement('div');
    weightField.className = 'lottery-prize-weight-field';
    const weightInput = document.createElement('input');
    weightInput.className = 'lottery-prize-weight';
    weightInput.type = 'number';
    weightInput.min = '0';
    weightInput.max = '100';
    weightInput.step = '0.01';
    weightInput.inputMode = 'decimal';
    weightInput.setAttribute('aria-label', '中獎率百分比');
    weightInput.value = String(prize && prize.weight != null ? prize.weight : 0);
    weightInput.disabled = locked;
    const percent = document.createElement('span');
    percent.textContent = '%';
    weightField.append(weightInput, percent);
    const remove = document.createElement('button');
    remove.className = 'remove-prize-button';
    remove.type = 'button';
    remove.setAttribute('aria-label', '移除此抽獎獎項');
    remove.textContent = '×';
    remove.disabled = locked;
    remove.addEventListener('click', function () {
      prizeRow.remove();
      syncLotteryPrizeControls(prizesField);
    });
    weightInput.addEventListener('input', function () { syncLotteryPrizeControls(prizesField); });
    prizeRow.append(prizeOrder, nameInput, weightField, remove);
    list.append(prizeRow);
  }

  function appendRewardNodeEditor(node, index) {
    const locked = Boolean(rewardSettings.rewardSettingsLocked);
    const row = document.createElement('div');
    row.className = 'reward-node-editor-row';
    const order = document.createElement('span');
    order.className = 'reward-node-order';
    order.textContent = String(index + 1).padStart(2, '0');
    const fields = document.createElement('div');
    fields.className = 'reward-node-editor-fields';
    const pointLabel = document.createElement('label');
    pointLabel.textContent = '點數節點';
    const pointInput = document.createElement('input');
    pointInput.className = 'reward-node-points';
    pointInput.type = 'number';
    pointInput.min = '1';
    pointInput.max = '20';
    pointInput.step = '1';
    pointInput.inputMode = 'numeric';
    pointInput.value = String(node.stampsRequired || '');
    pointInput.disabled = locked;
    pointLabel.append(pointInput);
    const typeLabel = document.createElement('label');
    typeLabel.textContent = '票券類型';
    const typeSelect = document.createElement('select');
    typeSelect.className = 'reward-node-type';
    [['coupon', '優惠券'], ['lottery', '抽獎券']].forEach(function (optionValue) {
      const option = document.createElement('option');
      option.value = optionValue[0];
      option.textContent = optionValue[1];
      typeSelect.append(option);
    });
    typeSelect.value = node.rewardType === 'lottery' ? 'lottery' : 'coupon';
    typeSelect.disabled = locked;
    typeLabel.append(typeSelect);
    const rewardLabel = document.createElement('label');
    rewardLabel.textContent = '票券名稱';
    const rewardInput = document.createElement('input');
    rewardInput.className = 'reward-node-name';
    rewardInput.type = 'text';
    rewardInput.maxLength = 80;
    rewardInput.placeholder = '例如：小點心一份';
    rewardInput.value = node.rewardName || '';
    rewardInput.disabled = locked;
    rewardLabel.append(rewardInput);
    const prizesField = document.createElement('div');
    prizesField.className = 'reward-node-prizes';
    const prizesHeader = document.createElement('div');
    prizesHeader.className = 'lottery-prize-header';
    const prizesIntro = document.createElement('div');
    prizesIntro.className = 'lottery-prize-intro';
    const prizesTitle = document.createElement('span');
    prizesTitle.textContent = '設定開獎結果';
    const prizesHint = document.createElement('small');
    prizesHint.textContent = '每列是一個結果；0% 會保留獎項但不會抽中。';
    prizesIntro.append(prizesTitle, prizesHint);
    const prizesActions = document.createElement('div');
    prizesActions.className = 'lottery-prize-header-actions';
    const distributePrizes = document.createElement('button');
    distributePrizes.className = 'distribute-prize-button';
    distributePrizes.type = 'button';
    distributePrizes.textContent = '平均分配';
    distributePrizes.disabled = locked;
    const prizesTotal = document.createElement('strong');
    prizesTotal.className = 'lottery-prize-total';
    prizesTotal.setAttribute('role', 'status');
    prizesTotal.setAttribute('aria-live', 'polite');
    prizesActions.append(distributePrizes, prizesTotal);
    prizesHeader.append(prizesIntro, prizesActions);
    const prizesColumns = document.createElement('div');
    prizesColumns.className = 'lottery-prize-columns';
    ['','獎項結果','中獎率',''].forEach(function (text) {
      const span = document.createElement('span');
      span.textContent = text;
      prizesColumns.append(span);
    });
    const prizesList = document.createElement('div');
    prizesList.className = 'lottery-prize-list';
    const addPrize = document.createElement('button');
    addPrize.className = 'add-prize-button';
    addPrize.type = 'button';
    addPrize.textContent = '＋ 新增獎項';
    addPrize.addEventListener('click', function () {
      if (prizesList.children.length >= 8) return;
      appendLotteryPrizeRow(prizesField, { name: '', weight: 0 });
      syncLotteryPrizeControls(prizesField);
    });
    distributePrizes.addEventListener('click', function () {
      const rows = Array.from(prizesList.children);
      if (!rows.length) return;
      const equalBasis = Math.floor(10000 / rows.length);
      rows.forEach(function (prizeRow, prizeIndex) {
        const basis = prizeIndex === rows.length - 1 ? 10000 - (equalBasis * prizeIndex) : equalBasis;
        prizeRow.querySelector('.lottery-prize-weight').value = String(basis / 100);
      });
      syncLotteryPrizeControls(prizesField);
    });
    prizesField.append(prizesHeader, prizesColumns, prizesList, addPrize);
    (node.lotteryPrizes || []).forEach(function (prize) { appendLotteryPrizeRow(prizesField, prize); });
    function syncPrizeField() {
      const isLottery = typeSelect.value === 'lottery';
      prizesField.classList.toggle('hidden', !isLottery);
      if (isLottery && prizesList.children.length === 0) {
        appendLotteryPrizeRow(prizesField, { name: '', weight: 50 });
        appendLotteryPrizeRow(prizesField, { name: '', weight: 50 });
      }
      syncLotteryPrizeControls(prizesField);
    }
    typeSelect.addEventListener('change', syncPrizeField);
    syncPrizeField();
    const remove = document.createElement('button');
    remove.className = 'remove-node-button';
    remove.type = 'button';
    remove.setAttribute('aria-label', '移除此獎勵節點');
    remove.textContent = '×';
    remove.disabled = locked || $('rewardNodeList').children.length < 1;
    remove.addEventListener('click', function () {
      row.remove();
      renderRewardNodeOrders();
    });
    fields.append(pointLabel, typeLabel, rewardLabel, prizesField);
    row.append(order, fields, remove);
    $('rewardNodeList').append(row);
  }

  function renderRewardNodeOrders() {
    const rows = Array.from($('rewardNodeList').children);
    rows.forEach(function (row, index) {
      row.querySelector('.reward-node-order').textContent = String(index + 1).padStart(2, '0');
      row.querySelector('.remove-node-button').disabled = Boolean(rewardSettings.rewardSettingsLocked) || rows.length === 1;
    });
    $('addRewardNodeButton').disabled = Boolean(rewardSettings.rewardSettingsLocked) || rows.length >= 5;
  }

  function renderRewardSettings() {
    const locked = Boolean(rewardSettings.rewardSettingsLocked);
    $('rewardNodeList').replaceChildren();
    (rewardSettings.rewardNodes || []).forEach(appendRewardNodeEditor);
    renderRewardNodeOrders();
    $('addRewardNodeButton').disabled = locked || rewardSettings.rewardNodes.length >= 5;
    $('saveRewardNodesButton').disabled = locked;
    $('rewardSettingsNotice').classList.remove('hidden');
    $('rewardSettingsNotice').classList.toggle('locked', locked);
    if (!rewardSettings.rewardNodesSupported || !rewardSettings.rewardTicketTypesSupported || !rewardSettings.rewardLotteryWeightsSupported) {
      $('rewardSettingsNotice').textContent = '目前 GAS 尚未支援抽獎權重；請先完成 PointsCard 1.3.0 部署。';
    } else if (locked) {
      $('rewardSettingsNotice').textContent = '已有獎勵兌換紀錄，節點已鎖定，避免改變既有兌換順序。';
    } else {
      $('rewardSettingsNotice').textContent = '每個獎項的中獎率可設為 0% 至 100%，同一張抽獎券合計必須為 100%。儲存後會套用目前累計點數，完成第一筆票券使用後即鎖定。';
    }
  }

  function addRewardNode() {
    const rows = $('rewardNodeList').children;
    if (rows.length >= 5) return;
    const values = new Set(Array.from(rows).map(function (row) { return Number(row.querySelector('.reward-node-points').value || 0); }));
    let nextPoint = 1;
    while (nextPoint <= 20 && values.has(nextPoint)) nextPoint += 1;
    if (nextPoint > 20) return;
    appendRewardNodeEditor({ stampsRequired: nextPoint, rewardName: '', rewardType: 'coupon', lotteryPrizes: [] }, rows.length);
    renderRewardNodeOrders();
  }

  function readRewardNodes() {
    const nodes = Array.from($('rewardNodeList').children).map(function (row) {
      const rewardType = row.querySelector('.reward-node-type').value;
      const lotteryPrizes = rewardType === 'lottery' ? Array.from(row.querySelectorAll('.lottery-prize-row')).map(function (prizeRow) {
        const weightBasis = lotteryWeightBasis(prizeRow.querySelector('.lottery-prize-weight').value);
        return {
          name: prizeRow.querySelector('.lottery-prize-name').value.trim(),
          weight: weightBasis == null ? null : weightBasis / 100,
          weightBasis: weightBasis
        };
      }) : [];
      return {
        stampsRequired: Number(row.querySelector('.reward-node-points').value),
        rewardName: row.querySelector('.reward-node-name').value.trim(),
        rewardType: rewardType,
        lotteryPrizes: lotteryPrizes
      };
    });
    if (!nodes.length || nodes.length > 5) throw new Error('請設定 1 至 5 個獎勵節點。');
    const points = new Set();
    nodes.forEach(function (node) {
      if (!Number.isInteger(node.stampsRequired) || node.stampsRequired < 1 || node.stampsRequired > 20) throw new Error('節點點數必須是 1 到 20 的整數。');
      if (!node.rewardName) throw new Error('每個節點都必須填寫獎勵名稱。');
      if (node.rewardType === 'lottery' && (node.lotteryPrizes.length < 2 || node.lotteryPrizes.length > 8)) throw new Error('每張抽獎券必須設定 2 至 8 個獎項。');
      if (node.rewardType === 'lottery' && node.lotteryPrizes.some(function (prize) { return !prize.name; })) throw new Error('每個抽獎獎項都必須填寫名稱。');
      if (node.rewardType === 'lottery' && node.lotteryPrizes.some(function (prize) { return prize.weightBasis == null; })) throw new Error('中獎率必須是 0% 至 100%，最多兩位小數。');
      if (node.rewardType === 'lottery' && new Set(node.lotteryPrizes.map(function (prize) { return prize.name; })).size !== node.lotteryPrizes.length) throw new Error('同一張抽獎券不能設定重複獎項。');
      if (node.rewardType === 'lottery' && node.lotteryPrizes.reduce(function (total, prize) { return total + prize.weightBasis; }, 0) !== 10000) throw new Error('同一張抽獎券的中獎率合計必須為 100%。');
      node.lotteryPrizes = node.lotteryPrizes.map(function (prize) { return { name: prize.name, weight: prize.weight }; });
      if (points.has(node.stampsRequired)) throw new Error('獎勵節點不能使用相同點數。');
      points.add(node.stampsRequired);
    });
    return nodes;
  }

  async function saveRewardNodes() {
    $('rewardSettingsMessage').classList.add('hidden');
    $('saveRewardNodesButton').disabled = true;
    try {
      const result = await PointsCard.callApi('admin.reward-nodes.update', {
        expectedUpdatedAt: rewardSettings.rewardNodesUpdatedAt,
        rewardNodes: readRewardNodes()
      });
      rewardSettings = normalizeRewardSettings(result.settings);
      renderRewardSettings();
      await loadSummary();
      if (loaded.members) await loadMembers($('memberSearch').value.trim());
      $('rewardSettingsMessage').textContent = '獎勵節點已更新。';
      $('rewardSettingsMessage').className = 'settings-message';
      showToast('獎勵節點已更新。');
    } catch (error) {
      $('rewardSettingsMessage').textContent = error.message;
      $('rewardSettingsMessage').className = 'settings-message error';
      $('saveRewardNodesButton').disabled = Boolean(rewardSettings.rewardSettingsLocked);
    }
  }

  function renderMembers() {
    const body = $('memberTableBody');
    body.replaceChildren();
    $('memberEmptyState').classList.toggle('hidden', members.length !== 0);
    members.forEach(function (member) {
      const row = document.createElement('tr');
      const memberTd = document.createElement('td');
      const memberCell = document.createElement('div');
      memberCell.className = 'member-cell';
      const avatar = document.createElement('img');
      avatar.className = 'member-avatar';
      avatar.alt = '';
      avatar.referrerPolicy = 'no-referrer';
      avatar.src = member.pictureUrl || avatarFallback;
      avatar.addEventListener('error', function () { avatar.src = avatarFallback; });
      const memberCopy = document.createElement('div');
      const name = document.createElement('strong');
      name.textContent = member.displayName || 'LINE 會員';
      const number = document.createElement('span');
      number.textContent = member.memberNo;
      memberCopy.append(name, number);
      memberCell.append(avatar, memberCopy);
      memberTd.append(memberCell);
      const statusTd = document.createElement('td');
      const status = document.createElement('span');
      status.className = 'status-badge ' + member.membershipStatus;
      status.textContent = statusLabels[member.membershipStatus] || member.membershipStatus;
      statusTd.append(status);
      const totalTd = document.createElement('td');
      totalTd.textContent = formatNumber(member.totalStamps) + ' 點';
      const rewardsTd = document.createElement('td');
      const rewards = document.createElement('span');
      rewards.className = 'reward-number';
      rewards.textContent = formatNumber(member.availableRewards) + ' 份';
      rewardsTd.append(rewards);
      const joinedTd = document.createElement('td');
      joinedTd.textContent = PointsCard.formatDate(member.joinedAt, '—');
      const actionsTd = document.createElement('td');
      const actions = document.createElement('div');
      actions.className = 'row-actions';
      actions.append(
        createTextButton('兌換', 'accent', function () { openReward(member); }, Number(member.availableRewards) < 1 || member.membershipStatus !== 'active'),
        createTextButton('管理', '', function () { openMember(member); }, false)
      );
      actionsTd.append(actions);
      setTableCellLabels(
        [memberTd, statusTd, totalTd, rewardsTd, joinedTd, actionsTd],
        ['會員', '狀態', '累計集點', '可兌換', '加入日期', '操作']
      );
      row.append(memberTd, statusTd, totalTd, rewardsTd, joinedTd, actionsTd);
      body.append(row);
    });
  }

  function effectiveVoucherStatus(voucher) {
    if (voucher.status !== 'active') return voucher.status;
    if (voucher.scanMode === 'single' && Number(voucher.recordCount || 0) > 0) return 'used';
    if (voucher.expiresAt && new Date(voucher.expiresAt).getTime() <= Date.now()) return 'expired';
    return 'active';
  }

  function renderVouchers() {
    const body = $('voucherTableBody');
    body.replaceChildren();
    $('voucherEmptyState').classList.toggle('hidden', vouchers.length !== 0);
    vouchers.forEach(function (voucher) {
      const row = document.createElement('tr');
      const idTd = document.createElement('td'); idTd.textContent = voucher.voucherId;
      const stampsTd = document.createElement('td'); stampsTd.textContent = '+' + formatNumber(voucher.stampCount);
      const modeTd = document.createElement('td'); modeTd.textContent = modeLabels[voucher.scanMode] || voucher.scanMode;
      const countTd = document.createElement('td'); countTd.textContent = formatNumber(voucher.recordCount);
      const statusTd = document.createElement('td');
      const state = effectiveVoucherStatus(voucher);
      const status = document.createElement('span'); status.className = 'status-badge ' + state; status.textContent = voucherStatusLabels[state] || state; statusTd.append(status);
      const expiryTd = document.createElement('td'); expiryTd.textContent = voucher.expiresAt ? PointsCard.formatDateTime(voucher.expiresAt, '—') : '無期限';
      const actionsTd = document.createElement('td');
      const actions = document.createElement('div'); actions.className = 'row-actions';
      actions.append(createTextButton('開啟', '', function () { openVoucher(voucher); }, state === 'cancelled' || state === 'deleted'));
      if (state === 'active') actions.append(createTextButton('停止', 'danger', function () { cancelVoucher(voucher); }, false));
      actions.append(createTextButton('刪除', 'danger', function () { deleteVoucher(voucher); }, false));
      actionsTd.append(actions);
      setTableCellLabels(
        [idTd, stampsTd, modeTd, countTd, statusTd, expiryTd, actionsTd],
        ['QR Code', '點數', '模式', '使用次數', '狀態', '到期時間', '操作']
      );
      row.append(idTd, stampsTd, modeTd, countTd, statusTd, expiryTd, actionsTd);
      body.append(row);
    });
  }

  function effectiveRewardConfirmationStatus(confirmation) {
    if (confirmation.status !== 'active') return confirmation.status;
    if (new Date(confirmation.expiresAt).getTime() <= Date.now()) return 'expired';
    return 'active';
  }

  function renderRewardConfirmations() {
    const body = $('rewardConfirmationTableBody');
    body.replaceChildren();
    $('rewardConfirmationEmptyState').classList.toggle('hidden', rewardConfirmations.length !== 0);
    rewardConfirmations.forEach(function (confirmation) {
      const row = document.createElement('tr');
      const idTd = document.createElement('td'); idTd.textContent = confirmation.confirmationId;
      const countTd = document.createElement('td'); countTd.textContent = formatNumber(confirmation.recordCount);
      const statusTd = document.createElement('td');
      const state = effectiveRewardConfirmationStatus(confirmation);
      const status = document.createElement('span');
      status.className = 'status-badge ' + state;
      status.textContent = voucherStatusLabels[state] || state;
      statusTd.append(status);
      const expiryTd = document.createElement('td'); expiryTd.textContent = PointsCard.formatDateTime(confirmation.expiresAt, '—');
      const actionsTd = document.createElement('td');
      const actions = document.createElement('div'); actions.className = 'row-actions';
      actions.append(createTextButton('開啟', '', function () { openRewardConfirmation(confirmation.confirmationId); }, state !== 'active'));
      if (state === 'active') actions.append(createTextButton('停止', 'danger', function () { cancelRewardConfirmation(confirmation); }, false));
      actions.append(createTextButton('刪除', 'danger', function () { deleteRewardConfirmation(confirmation); }, Number(confirmation.recordCount || 0) > 0));
      actionsTd.append(actions);
      setTableCellLabels(
        [idTd, countTd, statusTd, expiryTd, actionsTd],
        ['QR Code', '使用次數', '狀態', '到期時間', '操作']
      );
      row.append(idTd, countTd, statusTd, expiryTd, actionsTd);
      body.append(row);
    });
  }

  function openMember(member) {
    clearFormError('memberFormError');
    $('memberDialogTitle').textContent = member.displayName || '管理會員';
    $('memberDialogNumber').textContent = member.memberNo;
    $('memberTargetNo').value = member.memberNo;
    $('memberExpectedUpdatedAt').value = member.updatedAt;
    $('memberStatus').value = member.membershipStatus;
    $('memberTotalStamps').value = formatNumber(member.totalStamps) + ' 點';
    $('memberAvailableRewards').value = formatNumber(member.availableRewards) + ' 份';
    $('memberNote').value = member.note || '';
    openDialog($('memberDialog'));
  }

  async function saveMember() {
    clearFormError('memberFormError');
    $('saveMemberButton').disabled = true;
    try {
      const result = await PointsCard.callApi('admin.member.update', {
        targetMemberNo: $('memberTargetNo').value,
        expectedUpdatedAt: $('memberExpectedUpdatedAt').value,
        membershipStatus: $('memberStatus').value,
        note: $('memberNote').value
      });
      const index = members.findIndex(function (member) { return member.memberNo === result.member.memberNo; });
      if (index >= 0) members[index] = normalizeAdminMemberRewards(result.member);
      renderMembers();
      await loadSummary();
      closeDialog($('memberDialog'));
      showToast('會員資料已更新。');
    } catch (error) {
      showFormError('memberFormError', error);
    } finally {
      $('saveMemberButton').disabled = false;
    }
  }

  function openReward(member) {
    const reward = member.nextAvailableReward;
    if (!reward) return;
    if (!selectedRewardMember || selectedRewardMember.memberNo !== member.memberNo ||
      !selectedRewardMember.nextAvailableReward || selectedRewardMember.nextAvailableReward.entitlementOrdinal !== reward.entitlementOrdinal) rewardRetry = null;
    selectedRewardMember = member;
    clearFormError('rewardFormError');
    $('rewardDialogTitle').textContent = '兌換 ' + reward.rewardName;
    $('rewardMemberMeta').textContent = (member.displayName || 'LINE 會員') + ' · ' + member.memberNo + ' · 可兌換 ' + formatNumber(member.availableRewards) + ' 份';
    $('rewardPreviewName').textContent = reward.rewardName;
    $('rewardNodeMeta').textContent = (rewardTypeLabels[reward.rewardType] || '優惠券') + ' · ' + reward.stampsRequired + ' 點節點';
    $('rewardNote').value = '';
    openDialog($('rewardDialog'));
  }

  function rewardRequestId(memberNo, rewardOrdinal, note) {
    const fingerprint = memberNo + '|' + rewardOrdinal + '|' + note;
    if (rewardRetry && rewardRetry.fingerprint === fingerprint) return rewardRetry.requestId;
    rewardRetry = { fingerprint: fingerprint, requestId: PointsCard.randomHex(16) };
    return rewardRetry.requestId;
  }

  async function redeemReward() {
    if (!selectedRewardMember || !selectedRewardMember.nextAvailableReward) return;
    clearFormError('rewardFormError');
    const note = $('rewardNote').value.trim() || '門市現場兌換';
    const reward = selectedRewardMember.nextAvailableReward;
    $('confirmRewardButton').disabled = true;
    try {
      const result = await PointsCard.callApi('admin.reward.redeem', {
        targetMemberNo: selectedRewardMember.memberNo,
        expectedUpdatedAt: selectedRewardMember.updatedAt,
        expectedRewardOrdinal: reward.entitlementOrdinal,
        expectedRewardNodesUpdatedAt: rewardSettings.rewardNodesUpdatedAt,
        note: note,
        requestId: rewardRequestId(selectedRewardMember.memberNo, reward.entitlementOrdinal, note)
      });
      rewardRetry = null;
      selectedRewardMember = null;
      closeDialog($('rewardDialog'));
      await Promise.all([loadMembers($('memberSearch').value.trim()), loadSummary()]);
      showToast(result.duplicate ? '此兌換先前已完成，資料已同步。' : '獎勵兌換完成。');
    } catch (error) {
      showFormError('rewardFormError', error);
    } finally {
      $('confirmRewardButton').disabled = false;
    }
  }

  function toLocalDateTimeInput(date) {
    const value = new Date(date);
    const offset = value.getTimezoneOffset() * 60000;
    return new Date(value.getTime() - offset).toISOString().slice(0, 16);
  }

  function syncStampExpiryMode() {
    const limited = $('stampExpiryMode').value === 'limited';
    $('stampExpiryField').classList.toggle('hidden', !limited);
    $('stampExpiresAt').required = limited;
    if (limited && !$('stampExpiresAt').value) {
      $('stampExpiresAt').value = toLocalDateTimeInput(Date.now() + 24 * 60 * 60 * 1000);
    }
  }

  function resetStampDialog() {
    clearFormError('stampFormError');
    currentQrSvg = '';
    $('stampDialogTitle').textContent = '新增集點 QR Code';
    $('stampDialogDescription').textContent = '預設每位會員只能使用一次；可選擇設定到期時間或無期限。';
    $('stampCount').value = '1';
    $('stampMode').value = 'per-member';
    $('stampExpiryMode').value = 'limited';
    $('stampExpiresAt').value = toLocalDateTimeInput(Date.now() + 24 * 60 * 60 * 1000);
    $('stampNote').value = '';
    syncStampExpiryMode();
    $('stampFields').classList.remove('hidden');
    $('stampResult').classList.add('hidden');
    $('stampUrlField').classList.remove('hidden');
    $('copyStampButton').classList.add('hidden');
    $('downloadStampButton').classList.add('hidden');
    $('createStampButton').classList.remove('hidden');
    $('stampQrCode').replaceChildren();
    $('stampResultMeta').textContent = '';
    $('stampUrl').value = '';
  }

  function openNewStamp() {
    resetStampDialog();
    openDialog($('stampDialog'));
  }

  function readStampForm() {
    const stampCount = Number($('stampCount').value);
    if (!Number.isInteger(stampCount) || stampCount < 1 || stampCount > 10) throw new Error('集點數量必須是 1 到 10 的整數。');
    if ($('stampExpiryMode').value === 'unlimited') {
      return { stampCount: stampCount, scanMode: $('stampMode').value, expiresAt: '', note: $('stampNote').value };
    }
    const expiry = new Date($('stampExpiresAt').value);
    if (!Number.isFinite(expiry.getTime()) || expiry.getTime() <= Date.now()) throw new Error('到期時間必須晚於現在。');
    return { stampCount: stampCount, scanMode: $('stampMode').value, expiresAt: expiry.toISOString(), note: $('stampNote').value };
  }

  async function buildStampUrl(shareCode) {
    const config = await PointsCard.loadConfig();
    const url = new URL('https://liff.line.me/' + encodeURIComponent(config.LIFF_ID) + '/');
    url.searchParams.set('stamp', shareCode);
    return url.href;
  }

  function showStampLoadingState() {
    currentQrSvg = '';
    $('stampFields').classList.add('hidden');
    $('stampResult').classList.remove('hidden');
    $('stampUrlField').classList.add('hidden');
    $('copyStampButton').classList.add('hidden');
    $('downloadStampButton').classList.add('hidden');
    $('createStampButton').classList.add('hidden');
    $('stampQrCode').replaceChildren();
    const spinner = document.createElement('div');
    spinner.className = 'spinner';
    spinner.setAttribute('aria-hidden', 'true');
    $('stampQrCode').append(spinner);
    $('stampResultMeta').textContent = '正在載入 QR Code…';
    $('stampUrl').value = '';
  }

  async function showVoucher(voucher) {
    if (typeof window.qrcode !== 'function') throw new Error('QR Code 元件載入失敗，請重新整理後再試。');
    const url = await buildStampUrl(voucher.shareCode);
    const qr = window.qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    currentQrSvg = qr.createSvgTag({ cellSize: 6, margin: 0, scalable: true });
    $('stampQrCode').innerHTML = currentQrSvg;
    $('stampUrl').value = url;
    const expiryLabel = voucher.expiresAt ? '到期 ' + PointsCard.formatDateTime(voucher.expiresAt, '—') : '無期限';
    $('stampResultMeta').textContent = voucher.voucherId + ' · +' + formatNumber(voucher.stampCount) + ' 點 · ' + (modeLabels[voucher.scanMode] || voucher.scanMode) + ' · ' + expiryLabel;
    $('stampFields').classList.add('hidden');
    $('stampResult').classList.remove('hidden');
    $('stampUrlField').classList.remove('hidden');
    $('copyStampButton').classList.remove('hidden');
    $('downloadStampButton').classList.remove('hidden');
    $('createStampButton').classList.add('hidden');
  }

  async function createStamp() {
    clearFormError('stampFormError');
    $('createStampButton').disabled = true;
    try {
      const result = await PointsCard.callApi('admin.stamp.create', readStampForm());
      if (loaded.vouchers) {
        vouchers.unshift(result.voucher);
        renderVouchers();
      }
      await showVoucher(result.voucher);
      $('stampDialogTitle').textContent = '集點 QR Code 已建立';
      $('stampDialogDescription').textContent = '可下載 QR 或複製連結交給會員。';
    } catch (error) {
      showFormError('stampFormError', error);
    } finally {
      $('createStampButton').disabled = false;
    }
  }

  async function openVoucher(voucher) {
    resetStampDialog();
    $('stampDialogTitle').textContent = '開啟集點 QR Code';
    $('stampDialogDescription').textContent = '正在讀取 QR Code 資料，完成後會自動顯示。';
    showStampLoadingState();
    openDialog($('stampDialog'));
    try {
      const result = await PointsCard.callApi('admin.stamp.open', { cardId: voucher.cardId, voucherId: voucher.voucherId });
      await showVoucher(result.voucher);
      $('stampDialogDescription').textContent = 'QR Code 已載入，可下載或複製連結。';
    } catch (error) {
      $('stampResult').classList.add('hidden');
      showFormError('stampFormError', error);
    }
  }

  async function cancelVoucher(voucher) {
    if (!window.confirm('停止後這組 QR Code 將不能再集點，確定繼續？')) return;
    try {
      await PointsCard.callApi('admin.stamp.cancel', { cardId: voucher.cardId, voucherId: voucher.voucherId, expectedUpdatedAt: voucher.updatedAt });
      await loadVouchers();
      showToast('QR Code 已停止。');
    } catch (error) { showToast(error.message); }
  }

  async function deleteVoucher(voucher) {
    const hasHistory = Number(voucher.recordCount || 0) > 0;
    const message = hasHistory
      ? '這組 QR Code 已有集點紀錄。刪除後會立即停止並從清單移除，但歷史集點與稽核紀錄會保留。確定刪除？'
      : '確定刪除這組集點 QR Code？';
    if (!window.confirm(message)) return;
    try {
      await PointsCard.callApi('admin.stamp.delete', { cardId: voucher.cardId, voucherId: voucher.voucherId, expectedUpdatedAt: voucher.updatedAt });
      vouchers = vouchers.filter(function (item) { return item.voucherId !== voucher.voucherId; });
      renderVouchers();
      showToast(hasHistory ? 'QR Code 已刪除，歷史集點紀錄已保留。' : 'QR Code 已刪除。');
    } catch (error) { showToast(error.message); }
  }

  async function copyText(value, targetId, message) {
    try {
      await navigator.clipboard.writeText(value);
    } catch (_) {
      const target = $(targetId);
      target.focus();
      target.select();
      document.execCommand('copy');
    }
    showToast(message);
  }

  function downloadSvg(svg, filename) {
    if (!svg) return;
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    window.setTimeout(function () { URL.revokeObjectURL(link.href); }, 1000);
  }

  function resetRewardConfirmationDialog() {
    clearFormError('rewardConfirmationFormError');
    currentRewardConfirmationQrSvg = '';
    $('rewardConfirmationDialogTitle').textContent = '新增店家確認 QR';
    $('rewardConfirmationDialogDescription').textContent = '建立後由店員在現場展示，會員掃描後才能使用票券。';
    $('rewardConfirmationExpiresAt').value = toLocalDateTimeInput(Date.now() + 7 * 24 * 60 * 60 * 1000);
    $('rewardConfirmationNote').value = '';
    $('rewardConfirmationFields').classList.remove('hidden');
    $('rewardConfirmationResult').classList.add('hidden');
    $('copyRewardConfirmationButton').classList.add('hidden');
    $('downloadRewardConfirmationButton').classList.add('hidden');
    $('createRewardConfirmationButton').classList.remove('hidden');
    $('rewardConfirmationQrCode').replaceChildren();
  }

  function openNewRewardConfirmation() {
    resetRewardConfirmationDialog();
    openDialog($('rewardConfirmationDialog'));
  }

  function readRewardConfirmationForm() {
    const expiry = new Date($('rewardConfirmationExpiresAt').value);
    if (!Number.isFinite(expiry.getTime()) || expiry.getTime() <= Date.now()) throw new Error('到期時間必須晚於現在。');
    return { expiresAt: expiry.toISOString(), note: $('rewardConfirmationNote').value.trim() };
  }

  async function buildRewardConfirmationUrl(shareCode) {
    const config = await PointsCard.loadConfig();
    const url = new URL('https://liff.line.me/' + encodeURIComponent(config.LIFF_ID) + '/');
    url.searchParams.set('rewardConfirm', shareCode);
    return url.href;
  }

  async function showRewardConfirmation(confirmation) {
    if (typeof window.qrcode !== 'function') throw new Error('QR Code 元件載入失敗，請重新整理後再試。');
    const url = await buildRewardConfirmationUrl(confirmation.shareCode);
    const qr = window.qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    currentRewardConfirmationQrSvg = qr.createSvgTag({ cellSize: 6, margin: 0, scalable: true });
    $('rewardConfirmationQrCode').innerHTML = currentRewardConfirmationQrSvg;
    $('rewardConfirmationUrl').value = url;
    $('rewardConfirmationResultMeta').textContent = confirmation.confirmationId + ' · 到期 ' + PointsCard.formatDateTime(confirmation.expiresAt, '—');
    $('rewardConfirmationFields').classList.add('hidden');
    $('rewardConfirmationResult').classList.remove('hidden');
    $('copyRewardConfirmationButton').classList.remove('hidden');
    $('downloadRewardConfirmationButton').classList.remove('hidden');
    $('createRewardConfirmationButton').classList.add('hidden');
  }

  async function createRewardConfirmation() {
    clearFormError('rewardConfirmationFormError');
    $('createRewardConfirmationButton').disabled = true;
    try {
      const result = await PointsCard.callApi('admin.reward-confirm.create', readRewardConfirmationForm());
      if (loaded.rewardConfirmations) {
        rewardConfirmations.unshift(result.confirmation);
        renderRewardConfirmations();
      }
      await showRewardConfirmation(result.confirmation);
      $('rewardConfirmationDialogTitle').textContent = '店家確認 QR 已建立';
      $('rewardConfirmationDialogDescription').textContent = '請只在門市現場展示，外流時立即停止。';
    } catch (error) {
      showFormError('rewardConfirmationFormError', error);
    } finally {
      $('createRewardConfirmationButton').disabled = false;
    }
  }

  async function openRewardConfirmation(confirmationId) {
    resetRewardConfirmationDialog();
    $('rewardConfirmationDialogTitle').textContent = '開啟店家確認 QR';
    openDialog($('rewardConfirmationDialog'));
    try {
      const result = await PointsCard.callApi('admin.reward-confirm.open', { confirmationId: confirmationId });
      await showRewardConfirmation(result.confirmation);
    } catch (error) {
      showFormError('rewardConfirmationFormError', error);
    }
  }

  async function cancelRewardConfirmation(confirmation) {
    if (!window.confirm('停止後會員將無法使用這組 QR 確認票券，確定繼續？')) return;
    try {
      await PointsCard.callApi('admin.reward-confirm.cancel', {
        confirmationId: confirmation.confirmationId,
        expectedUpdatedAt: confirmation.updatedAt
      });
      await loadRewardConfirmations();
      showToast('店家確認 QR 已停止。');
    } catch (error) { showToast(error.message); }
  }

  async function deleteRewardConfirmation(confirmation) {
    if (!window.confirm('確定刪除這組尚未使用的店家確認 QR？')) return;
    try {
      await PointsCard.callApi('admin.reward-confirm.delete', {
        confirmationId: confirmation.confirmationId,
        expectedUpdatedAt: confirmation.updatedAt
      });
      rewardConfirmations = rewardConfirmations.filter(function (item) { return item.confirmationId !== confirmation.confirmationId; });
      renderRewardConfirmations();
      showToast('店家確認 QR 已刪除。');
    } catch (error) { showToast(error.message); }
  }

  function bindEvents() {
    $('retryButton').addEventListener('click', function () { window.location.reload(); });
    $('refreshButton').addEventListener('click', function () {
      $('refreshButton').disabled = true;
      Promise.all([loadSummary(), loadAdminTab(activeAdminTab, true)])
        .catch(showFatalError)
        .finally(function () { $('refreshButton').disabled = false; });
    });
    $('memberSearch').addEventListener('input', function () {
      window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(function () {
        loadMembers($('memberSearch').value.trim()).catch(function (error) {
          reportError(error, { source: 'admin-search', action: 'members' });
          showToast(error.message || '會員搜尋失敗。');
        });
      }, 300);
    });
    $('saveMemberButton').addEventListener('click', saveMember);
    $('addRewardNodeButton').addEventListener('click', addRewardNode);
    $('saveRewardNodesButton').addEventListener('click', saveRewardNodes);
    $('confirmRewardButton').addEventListener('click', redeemReward);
    $('newStampButton').addEventListener('click', openNewStamp);
    $('stampExpiryMode').addEventListener('change', syncStampExpiryMode);
    $('createStampButton').addEventListener('click', createStamp);
    $('copyStampButton').addEventListener('click', function () { copyText($('stampUrl').value, 'stampUrl', '集點連結已複製。'); });
    $('downloadStampButton').addEventListener('click', function () { downloadSvg(currentQrSvg, 'points-card-stamp-qr.svg'); });
    $('newRewardConfirmationButton').addEventListener('click', openNewRewardConfirmation);
    $('createRewardConfirmationButton').addEventListener('click', createRewardConfirmation);
    $('copyRewardConfirmationButton').addEventListener('click', function () { copyText($('rewardConfirmationUrl').value, 'rewardConfirmationUrl', '確認連結已複製。'); });
    $('downloadRewardConfirmationButton').addEventListener('click', function () { downloadSvg(currentRewardConfirmationQrSvg, 'points-card-reward-confirmation-qr.svg'); });
    document.querySelectorAll('[data-admin-tab]').forEach(function (tab) {
      tab.addEventListener('click', function () { selectAdminTab(tab.dataset.adminTab, false); });
      tab.addEventListener('keydown', handleAdminTabKeydown);
    });
    selectAdminTab(activeAdminTab, false);
  }

  async function init() {
    bindEvents();
    const loggedIn = await PointsCard.ensureLiffLogin();
    if (!loggedIn) return;
    authenticated = true;
    await loadSummary();
  }

  init().catch(showFatalError);
})();
