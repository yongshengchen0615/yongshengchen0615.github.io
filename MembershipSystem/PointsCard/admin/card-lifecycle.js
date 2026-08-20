(function () {
  'use strict';

  const $ = function (id) { return document.getElementById(id); };
  const MAX_CARD_STAMPS = 10000;
  const MAX_REWARD_NODES = 5;
  const MAX_LOTTERY_PRIZES = 8;
  const DEFAULT_REWARD_NODES = [{ stampsRequired: 10, rewardName: '本期優惠券', rewardType: 'coupon', lotteryPrizes: [] }];
  let cards = [];
  let selectedCard = null;
  let supported = false;
  let creating = false;
  let loading = false;
  let readyObserver = null;
  let editorKey = '';

  function toLocalDateTimeInput(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    const offset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 16);
  }

  function setMessage(message, isError) {
    const target = $('cardSettingsMessage');
    target.textContent = message || '';
    target.className = 'settings-message' + (isError ? ' error' : '') + (message ? '' : ' hidden');
  }

  function createFieldLabel(labelText, control) {
    const label = document.createElement('label');
    const text = document.createElement('span');
    text.textContent = labelText;
    label.append(text, control);
    return label;
  }

  function ensureMultiCardFields() {
    const form = document.querySelector('.card-lifecycle-form');
    if (!form || $('cardSelect')) return;

    const selector = document.createElement('select');
    selector.id = 'cardSelect';
    const name = document.createElement('input');
    name.id = 'cardName';
    name.type = 'text';
    name.maxLength = 80;
    name.required = true;
    name.placeholder = '例如：夏季飲品集點卡';
    const description = document.createElement('textarea');
    description.id = 'cardDescription';
    description.maxLength = 500;
    description.rows = 3;
    description.placeholder = '例如：集滿指定點數可獲得本期優惠券。';

    const descriptionLabel = createFieldLabel('集點卡說明', description);
    descriptionLabel.className = 'full-span';
    form.prepend(descriptionLabel);
    form.prepend(createFieldLabel('集點卡名稱（不可重複）', name));
    form.prepend(createFieldLabel('管理集點卡', selector));

    const actions = document.querySelector('.card-lifecycle-actions');
    if (actions && !$('newCardButton')) {
      const add = document.createElement('button');
      add.id = 'newCardButton';
      add.className = 'button button-secondary';
      add.type = 'button';
      add.textContent = '新增集點卡';
      actions.prepend(add);
      add.addEventListener('click', startCreateCard);
    }

    selector.addEventListener('change', function () {
      const cardId = selector.value;
      if (!cardId) return;
      PointsCard.setSelectedCardId(cardId);
      window.location.reload();
    });
  }

  function ensureIntegratedRewardEditor() {
    const section = document.querySelector('.card-lifecycle-section');
    const actions = document.querySelector('.card-lifecycle-actions');
    if (!section || !actions || $('cardRewardEditor')) return;

    const wrapper = document.createElement('section');
    wrapper.id = 'cardRewardEditor';
    wrapper.className = 'integrated-reward-editor';

    const heading = document.createElement('div');
    heading.className = 'section-heading integrated-reward-heading';
    const copy = document.createElement('div');
    const eyebrow = document.createElement('p');
    eyebrow.className = 'eyebrow';
    eyebrow.textContent = 'REWARD NODES';
    const title = document.createElement('h3');
    title.textContent = '獎勵節點';
    const intro = document.createElement('p');
    intro.textContent = '直接在同一份集點卡設定中編輯節點；最大節點就是卡片長度，最高 10,000 點。';
    copy.append(eyebrow, title, intro);
    const add = document.createElement('button');
    add.id = 'cardAddRewardNodeButton';
    add.className = 'button button-secondary';
    add.type = 'button';
    add.textContent = '新增節點';
    add.addEventListener('click', addRewardNode);
    heading.append(copy, add);

    const notice = document.createElement('div');
    notice.id = 'cardRewardSettingsNotice';
    notice.className = 'settings-notice';
    const list = document.createElement('div');
    list.id = 'cardRewardNodeList';
    list.className = 'reward-node-editor';
    wrapper.append(heading, notice, list);
    section.insertBefore(wrapper, actions);
  }

  function installVisibleTabKeyboardNavigation() {
    const tabs = document.querySelector('.admin-tabs');
    if (!tabs || tabs.dataset.integratedKeyboard === '1') return;
    tabs.dataset.integratedKeyboard = '1';
    tabs.addEventListener('keydown', function (event) {
      if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].indexOf(event.key) < 0) return;
      const current = event.target && event.target.closest ? event.target.closest('[data-admin-tab]') : null;
      if (!current) return;
      const visible = Array.from(tabs.querySelectorAll('[data-admin-tab]')).filter(function (tab) {
        return tab.id !== 'admin-tab-reward-nodes' && !tab.hidden;
      });
      if (!visible.length) return;
      const index = Math.max(0, visible.indexOf(current));
      let next = index;
      if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = visible.length - 1;
      else if (event.key === 'ArrowLeft') next = (index - 1 + visible.length) % visible.length;
      else next = (index + 1) % visible.length;
      event.preventDefault();
      event.stopImmediatePropagation();
      visible[next].click();
      visible[next].focus();
    }, true);
  }

  function normalizeCard(value) {
    const status = value && value.status === 'expired' ? 'expired' : 'active';
    return {
      cardId: String(value && value.cardId || ''),
      name: String(value && value.name || ''),
      description: String(value && value.description || ''),
      status: status,
      available: value && value.available === undefined ? status === 'active' : Boolean(value && value.available),
      expiresAt: String(value && value.expiresAt || ''),
      cardSize: Number(value && value.cardSize || 10),
      rewardNodes: Array.isArray(value && value.rewardNodes) && value.rewardNodes.length ? value.rewardNodes : DEFAULT_REWARD_NODES,
      rewardNodesUpdatedAt: String(value && value.rewardNodesUpdatedAt || 'none'),
      rewardSettingsLocked: Boolean(value && value.rewardSettingsLocked),
      createdAt: String(value && value.createdAt || ''),
      updatedAt: String(value && value.updatedAt || '')
    };
  }

  function selectCardFromList() {
    const storedId = typeof PointsCard.getSelectedCardId === 'function' ? PointsCard.getSelectedCardId() : '';
    selectedCard = cards.find(function (card) { return card.cardId === storedId; }) ||
      cards.find(function (card) { return card.available; }) || cards[0] || null;
    if (selectedCard) PointsCard.setSelectedCardId(selectedCard.cardId);
    else PointsCard.setSelectedCardId('');
  }

  function syncExpiryMode() {
    const limited = $('cardExpiryMode').value === 'limited';
    $('cardExpiryField').classList.toggle('hidden', !limited);
    $('cardExpiresAt').required = limited;
    if (limited && !$('cardExpiresAt').value) {
      $('cardExpiresAt').value = toLocalDateTimeInput(Date.now() + 30 * 24 * 60 * 60 * 1000);
    }
  }

  function renderSelector() {
    const selector = $('cardSelect');
    if (!selector) return;
    selector.replaceChildren();
    if (!cards.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = '目前沒有集點卡';
      selector.append(option);
    } else {
      cards.forEach(function (card) {
        const option = document.createElement('option');
        option.value = card.cardId;
        option.textContent = card.name + (card.status === 'expired' ? '（已過期）' : '');
        selector.append(option);
      });
    }
    selector.value = creating ? '' : (selectedCard ? selectedCard.cardId : '');
    selector.disabled = loading || creating || cards.length === 0;
  }

  function prizeWeightBasis(value) {
    if (value == null || String(value).trim() === '') return null;
    const weight = Number(value);
    const basis = Math.round(weight * 100);
    if (!Number.isFinite(weight) || weight < 0 || weight > 100 || Math.abs(weight * 100 - basis) > 0.000001) return null;
    return basis;
  }

  function normalizePrize(value) {
    if (typeof value === 'string') return { name: value, weight: 0 };
    return { name: String(value && value.name || ''), weight: Number(value && value.weight || 0) };
  }

  function syncPrizeRows(container, locked) {
    const rows = Array.from(container.querySelectorAll('.lottery-prize-row'));
    const total = container.querySelector('.lottery-prize-total');
    const bases = rows.map(function (row) { return prizeWeightBasis(row.querySelector('.lottery-prize-weight').value); });
    const invalid = bases.some(function (basis) { return basis == null; });
    const sum = bases.reduce(function (value, basis) { return value + (basis == null ? 0 : basis); }, 0);
    total.textContent = invalid ? '請檢查中獎率' : (sum === 10000 ? '✓ 已分配 100%' : '目前 ' + String(sum / 100) + '%');
    total.classList.toggle('valid', !invalid && sum === 10000);
    total.classList.toggle('invalid', invalid || sum !== 10000);
    rows.forEach(function (row, index) {
      row.querySelector('.lottery-prize-order').textContent = String(index + 1);
      row.querySelector('.remove-prize-button').disabled = locked || rows.length <= 2;
    });
    const add = container.querySelector('.add-prize-button');
    if (add) add.disabled = locked || rows.length >= MAX_LOTTERY_PRIZES;
  }

  function appendPrizeRow(container, prize, locked) {
    const list = container.querySelector('.lottery-prize-list');
    const row = document.createElement('div');
    row.className = 'lottery-prize-row';
    const order = document.createElement('span');
    order.className = 'lottery-prize-order';
    const name = document.createElement('input');
    name.className = 'lottery-prize-name';
    name.type = 'text';
    name.maxLength = 80;
    name.placeholder = '獎項名稱';
    name.value = prize.name || '';
    name.disabled = locked;
    const weightField = document.createElement('div');
    weightField.className = 'lottery-prize-weight-field';
    const weight = document.createElement('input');
    weight.className = 'lottery-prize-weight';
    weight.type = 'number';
    weight.min = '0';
    weight.max = '100';
    weight.step = '0.01';
    weight.value = String(prize.weight == null ? 0 : prize.weight);
    weight.disabled = locked;
    const percent = document.createElement('span');
    percent.textContent = '%';
    weightField.append(weight, percent);
    const remove = document.createElement('button');
    remove.className = 'remove-prize-button';
    remove.type = 'button';
    remove.textContent = '×';
    remove.setAttribute('aria-label', '移除此抽獎獎項');
    remove.disabled = locked;
    remove.addEventListener('click', function () {
      row.remove();
      syncPrizeRows(container, locked);
    });
    weight.addEventListener('input', function () { syncPrizeRows(container, locked); });
    row.append(order, name, weightField, remove);
    list.append(row);
  }

  function createPrizesEditor(node, locked) {
    const field = document.createElement('div');
    field.className = 'reward-node-prizes';
    const header = document.createElement('div');
    header.className = 'lottery-prize-header';
    const intro = document.createElement('div');
    intro.className = 'lottery-prize-intro';
    const title = document.createElement('span');
    title.textContent = '設定開獎結果';
    const hint = document.createElement('small');
    hint.textContent = '同一張抽獎券的中獎率合計必須為 100%。';
    intro.append(title, hint);
    const actions = document.createElement('div');
    actions.className = 'lottery-prize-header-actions';
    const distribute = document.createElement('button');
    distribute.className = 'distribute-prize-button';
    distribute.type = 'button';
    distribute.textContent = '平均分配';
    distribute.disabled = locked;
    const total = document.createElement('strong');
    total.className = 'lottery-prize-total';
    total.setAttribute('role', 'status');
    actions.append(distribute, total);
    header.append(intro, actions);
    const columns = document.createElement('div');
    columns.className = 'lottery-prize-columns';
    ['', '獎項結果', '中獎率', ''].forEach(function (text) {
      const cell = document.createElement('span');
      cell.textContent = text;
      columns.append(cell);
    });
    const list = document.createElement('div');
    list.className = 'lottery-prize-list';
    const add = document.createElement('button');
    add.className = 'add-prize-button';
    add.type = 'button';
    add.textContent = '＋ 新增獎項';
    add.disabled = locked;
    field.append(header, columns, list, add);

    let prizes = Array.isArray(node.lotteryPrizes) ? node.lotteryPrizes.map(normalizePrize) : [];
    if (node.rewardType === 'lottery' && prizes.length < 2) prizes = [{ name: '', weight: 50 }, { name: '', weight: 50 }];
    prizes.forEach(function (prize) { appendPrizeRow(field, prize, locked); });
    add.addEventListener('click', function () {
      if (list.children.length >= MAX_LOTTERY_PRIZES) return;
      appendPrizeRow(field, { name: '', weight: 0 }, locked);
      syncPrizeRows(field, locked);
    });
    distribute.addEventListener('click', function () {
      const rows = Array.from(list.children);
      if (!rows.length) return;
      const equal = Math.floor(10000 / rows.length);
      rows.forEach(function (row, index) {
        const basis = index === rows.length - 1 ? 10000 - equal * index : equal;
        row.querySelector('.lottery-prize-weight').value = String(basis / 100);
      });
      syncPrizeRows(field, locked);
    });
    syncPrizeRows(field, locked);
    return field;
  }

  function appendRewardNode(node, index, locked) {
    const list = $('cardRewardNodeList');
    const row = document.createElement('div');
    row.className = 'reward-node-editor-row';
    const order = document.createElement('span');
    order.className = 'reward-node-order';
    order.textContent = String(index + 1).padStart(2, '0');
    const fields = document.createElement('div');
    fields.className = 'reward-node-editor-fields';

    const point = document.createElement('input');
    point.className = 'reward-node-points';
    point.type = 'number';
    point.min = '1';
    point.max = String(MAX_CARD_STAMPS);
    point.step = '1';
    point.value = String(node.stampsRequired || 1);
    point.disabled = locked;
    const pointLabel = createFieldLabel('點數節點', point);

    const type = document.createElement('select');
    type.className = 'reward-node-type';
    [['coupon', '優惠券'], ['lottery', '抽獎券']].forEach(function (entry) {
      const option = document.createElement('option');
      option.value = entry[0];
      option.textContent = entry[1];
      type.append(option);
    });
    type.value = node.rewardType === 'lottery' ? 'lottery' : 'coupon';
    type.disabled = locked;
    const typeLabel = createFieldLabel('票券類型', type);

    const name = document.createElement('input');
    name.className = 'reward-node-name';
    name.type = 'text';
    name.maxLength = 80;
    name.placeholder = '例如：小點心一份';
    name.value = node.rewardName || '';
    name.disabled = locked;
    const nameLabel = createFieldLabel('票券名稱', name);

    const prizes = createPrizesEditor(node, locked);
    prizes.classList.toggle('hidden', type.value !== 'lottery');
    type.addEventListener('change', function () {
      prizes.classList.toggle('hidden', type.value !== 'lottery');
      if (type.value === 'lottery' && prizes.querySelectorAll('.lottery-prize-row').length < 2) {
        appendPrizeRow(prizes, { name: '', weight: 50 }, locked);
        appendPrizeRow(prizes, { name: '', weight: 50 }, locked);
        syncPrizeRows(prizes, locked);
      }
    });

    const remove = document.createElement('button');
    remove.className = 'remove-node-button';
    remove.type = 'button';
    remove.textContent = '×';
    remove.setAttribute('aria-label', '移除此獎勵節點');
    remove.disabled = locked;
    remove.addEventListener('click', function () {
      if (list.children.length <= 1) return;
      row.remove();
      syncRewardNodeOrders(locked);
    });

    fields.append(pointLabel, typeLabel, nameLabel, prizes);
    row.append(order, fields, remove);
    list.append(row);
  }

  function syncRewardNodeOrders(locked) {
    const rows = Array.from($('cardRewardNodeList').children);
    rows.forEach(function (row, index) {
      row.querySelector('.reward-node-order').textContent = String(index + 1).padStart(2, '0');
      row.querySelector('.remove-node-button').disabled = locked || rows.length <= 1;
    });
    $('cardAddRewardNodeButton').disabled = locked || rows.length >= MAX_REWARD_NODES;
  }

  function renderRewardEditor(force) {
    const effective = creating ? null : selectedCard;
    const key = creating ? 'new' : (effective ? effective.cardId + ':' + effective.updatedAt : 'none');
    if (!force && editorKey === key) return;
    editorKey = key;
    const locked = Boolean(effective && effective.rewardSettingsLocked);
    const nodes = creating ? DEFAULT_REWARD_NODES : (effective ? effective.rewardNodes : DEFAULT_REWARD_NODES);
    const list = $('cardRewardNodeList');
    list.replaceChildren();
    nodes.forEach(function (node, index) { appendRewardNode(node, index, locked); });
    syncRewardNodeOrders(locked || loading || !supported);
    const notice = $('cardRewardSettingsNotice');
    notice.classList.toggle('locked', locked);
    if (creating) notice.textContent = '新集點卡的名稱、期限與獎勵節點會在按下「建立集點卡」時一次儲存。';
    else if (!effective) notice.textContent = '新增集點卡後即可設定獎勵節點。';
    else if (locked) notice.textContent = '這張卡已有票券使用紀錄，獎勵節點已鎖定；名稱、說明與期限仍可一鍵儲存。';
    else notice.textContent = '名稱、說明、期限與獎勵節點共用同一個儲存按鈕，伺服器只寫入一次卡片資料。';
  }

  function addRewardNode() {
    const list = $('cardRewardNodeList');
    if (!list || list.children.length >= MAX_REWARD_NODES) return;
    const values = Array.from(list.querySelectorAll('.reward-node-points')).map(function (input) { return Number(input.value || 0); });
    let nextPoint = Math.min(MAX_CARD_STAMPS, Math.max.apply(Math, [0].concat(values)) + 1);
    while (values.indexOf(nextPoint) >= 0 && nextPoint < MAX_CARD_STAMPS) nextPoint += 1;
    if (values.indexOf(nextPoint) >= 0) {
      nextPoint = 1;
      while (values.indexOf(nextPoint) >= 0 && nextPoint <= MAX_CARD_STAMPS) nextPoint += 1;
    }
    if (nextPoint > MAX_CARD_STAMPS) return;
    appendRewardNode({ stampsRequired: nextPoint, rewardName: '', rewardType: 'coupon', lotteryPrizes: [] }, list.children.length, false);
    syncRewardNodeOrders(false);
  }

  function readRewardNodesForMultiCard() {
    const rows = Array.from($('cardRewardNodeList').querySelectorAll('.reward-node-editor-row'));
    if (!rows.length || rows.length > MAX_REWARD_NODES) throw new Error('請設定 1 至 5 個獎勵節點。');
    const points = new Set();
    return rows.map(function (row) {
      const stampsRequired = Number(row.querySelector('.reward-node-points').value);
      const rewardName = row.querySelector('.reward-node-name').value.trim();
      const rewardType = row.querySelector('.reward-node-type').value;
      if (!Number.isInteger(stampsRequired) || stampsRequired < 1 || stampsRequired > MAX_CARD_STAMPS) {
        throw new Error('節點點數必須是 1 到 10,000 的整數。');
      }
      if (points.has(stampsRequired)) throw new Error('獎勵節點不能使用相同點數。');
      points.add(stampsRequired);
      if (!rewardName) throw new Error('每個節點都必須填寫獎勵名稱。');
      const node = { stampsRequired: stampsRequired, rewardName: rewardName, rewardType: rewardType, lotteryPrizes: [] };
      if (rewardType === 'lottery') {
        const prizes = Array.from(row.querySelectorAll('.lottery-prize-row')).map(function (prizeRow) {
          const name = prizeRow.querySelector('.lottery-prize-name').value.trim();
          const basis = prizeWeightBasis(prizeRow.querySelector('.lottery-prize-weight').value);
          if (!name) throw new Error('每個抽獎獎項都必須填寫名稱。');
          if (basis == null) throw new Error('中獎率必須是 0% 至 100%，最多兩位小數。');
          return { name: name, weight: basis / 100, basis: basis };
        });
        if (prizes.length < 2 || prizes.length > MAX_LOTTERY_PRIZES) throw new Error('每張抽獎券必須設定 2 至 8 個獎項。');
        if (new Set(prizes.map(function (prize) { return prize.name; })).size !== prizes.length) throw new Error('同一張抽獎券不能設定重複獎項。');
        if (prizes.reduce(function (total, prize) { return total + prize.basis; }, 0) !== 10000) throw new Error('同一張抽獎券的中獎率合計必須為 100%。');
        node.lotteryPrizes = prizes.map(function (prize) { return { name: prize.name, weight: prize.weight }; });
      }
      return node;
    });
  }

  function render() {
    ensureMultiCardFields();
    ensureIntegratedRewardEditor();
    installVisibleTabKeyboardNavigation();
    renderSelector();
    const effective = creating ? null : selectedCard;
    const badge = $('cardStatusBadge');
    badge.textContent = creating ? '新增中' : (!effective ? '無集點卡' : (effective.status === 'expired' ? '已過期' : '有效'));
    badge.className = 'status-badge ' + (effective ? effective.status : 'deleted');

    $('cardSettingsTitle').textContent = '集點卡與獎勵設定';
    $('cardName').value = effective ? effective.name : '';
    $('cardDescription').value = effective ? effective.description : '';
    $('cardExpiryMode').value = effective && effective.expiresAt ? 'limited' : 'unlimited';
    $('cardExpiresAt').value = effective && effective.expiresAt ? toLocalDateTimeInput(effective.expiresAt) : '';
    syncExpiryMode();

    const disabled = loading || !supported;
    $('cardName').disabled = disabled;
    $('cardDescription').disabled = disabled;
    $('cardExpiryMode').disabled = disabled;
    $('cardExpiresAt').disabled = disabled;
    $('saveCardSettingsButton').disabled = disabled;
    $('deleteCardButton').disabled = disabled || creating || !effective;
    $('newCardButton').disabled = disabled || creating;
    $('saveCardSettingsButton').textContent = creating ? '建立集點卡' : '儲存集點卡與獎勵設定';

    const newStampButton = $('newStampButton');
    if (newStampButton) newStampButton.disabled = loading || !effective || !effective.available;

    const notice = $('cardSettingsNotice');
    notice.classList.toggle('locked', !effective || (effective && !effective.available));
    if (loading) notice.textContent = '正在讀取集點卡清單。';
    else if (!supported) notice.textContent = '目前 GAS 尚未支援整合集點卡儲存；請部署 PointsCard 2.1.0。';
    else if (creating) notice.textContent = '填完名稱、說明、期限與下方獎勵節點後，只需要按一次「建立集點卡」。';
    else if (!effective) notice.textContent = '目前沒有集點卡。請先新增一張集點卡。';
    else if (effective.status === 'expired') notice.textContent = effective.name + ' 已過期；可調整期限後與獎勵設定一起儲存。';
    else notice.textContent = effective.name + (effective.expiresAt ? ' 有效至 ' + PointsCard.formatDateTime(effective.expiresAt, '—') + '。' : ' 為無期限集點卡。');

    renderRewardEditor(false);
  }

  async function loadCards() {
    if (loading) return;
    loading = true;
    render();
    try {
      const result = await PointsCard.callApi('admin.cards.list');
      cards = (result.cards || []).map(normalizeCard);
      supported = true;
      selectCardFromList();
      creating = false;
      editorKey = '';
    } finally {
      loading = false;
      render();
    }
  }

  function startCreateCard() {
    creating = true;
    editorKey = '';
    setMessage('', false);
    render();
    $('cardName').focus();
  }

  function readExpiry() {
    if ($('cardExpiryMode').value === 'unlimited') return '';
    const expiry = new Date($('cardExpiresAt').value);
    if (!Number.isFinite(expiry.getTime()) || expiry.getTime() <= Date.now()) throw new Error('集點卡到期時間必須晚於現在。');
    return expiry.toISOString();
  }

  function cardNameKey(value) {
    let name = String(value || '').trim();
    if (typeof name.normalize === 'function') name = name.normalize('NFKC');
    return name.replace(/\s+/g, ' ').toLowerCase();
  }

  function hasDuplicateCardName(name) {
    const nameKey = cardNameKey(name);
    const excludedCardId = creating ? '' : String(selectedCard && selectedCard.cardId || '');
    return cards.some(function (card) {
      return card.cardId !== excludedCardId && cardNameKey(card.name) === nameKey;
    });
  }

  function readCardForm() {
    const name = $('cardName').value.trim();
    const description = $('cardDescription').value.trim();
    if (!name) throw new Error('請輸入集點卡名稱。');
    if (name.length > 80) throw new Error('集點卡名稱最多 80 個字。');
    if (hasDuplicateCardName(name)) throw new Error('集點卡名稱不可重複。');
    if (description.length > 500) throw new Error('集點卡說明最多 500 個字。');
    return {
      name: name,
      description: description,
      expiresAt: readExpiry(),
      rewardNodes: readRewardNodesForMultiCard()
    };
  }

  async function saveCardSettings() {
    setMessage('', false);
    $('saveCardSettingsButton').disabled = true;
    try {
      const form = readCardForm();
      let result;
      if (creating) {
        result = await PointsCard.callApi('admin.card.create', form);
        PointsCard.setSelectedCardId(result.card.cardId);
        setMessage('新集點卡與獎勵節點已建立。', false);
      } else {
        if (!selectedCard) throw new Error('請先選擇集點卡。');
        result = await PointsCard.callApi('admin.card.save', Object.assign({}, form, {
          cardId: selectedCard.cardId,
          expectedUpdatedAt: selectedCard.updatedAt
        }));
        PointsCard.setSelectedCardId(result.card.cardId);
        setMessage('集點卡與獎勵設定已一次儲存。', false);
      }
      window.location.reload();
    } catch (error) {
      setMessage(error && error.message ? error.message : '集點卡設定儲存失敗。', true);
      render();
    }
  }

  async function deleteCard() {
    if (!selectedCard) return;
    const confirmed = window.confirm(
      '確定永久刪除「' + selectedCard.name + '」？\n\n' +
      '此操作會刪除這張卡所有會員點數、集點紀錄、集點 QR 與這張卡的票券使用紀錄，無法復原。其他集點卡不受影響。'
    );
    if (!confirmed) return;
    setMessage('', false);
    $('deleteCardButton').disabled = true;
    try {
      await PointsCard.callApi('admin.card.delete', {
        cardId: selectedCard.cardId,
        expectedUpdatedAt: selectedCard.updatedAt
      });
      PointsCard.setSelectedCardId('');
      window.location.reload();
    } catch (error) {
      setMessage(error && error.message ? error.message : '集點卡刪除失敗。', true);
      render();
    }
  }

  function startWhenAdminReady() {
    const adminApp = $('adminApp');
    if (!adminApp) return;
    const start = function () {
      if (adminApp.classList.contains('hidden')) return false;
      if (readyObserver) {
        readyObserver.disconnect();
        readyObserver = null;
      }
      loadCards().catch(function (error) {
        setMessage(error && error.message ? error.message : '無法讀取集點卡清單。', true);
      });
      return true;
    };
    if (start()) return;
    readyObserver = new MutationObserver(start);
    readyObserver.observe(adminApp, { attributes: true, attributeFilter: ['class'] });
  }

  ensureMultiCardFields();
  ensureIntegratedRewardEditor();
  installVisibleTabKeyboardNavigation();
  $('cardExpiryMode').addEventListener('change', syncExpiryMode);
  $('saveCardSettingsButton').addEventListener('click', saveCardSettings);
  $('deleteCardButton').addEventListener('click', deleteCard);
  $('refreshButton').addEventListener('click', function () {
    window.setTimeout(function () {
      editorKey = '';
      loadCards().catch(function (error) { setMessage(error && error.message ? error.message : '無法重新讀取集點卡。', true); });
    }, 150);
  });
  render();
  startWhenAdminReady();
})();
