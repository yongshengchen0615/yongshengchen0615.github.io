(function () {
  'use strict';

  const $ = function (id) { return document.getElementById(id); };
  const MAX_CARD_STAMPS = 10000;
  let cards = [];
  let selectedCard = null;
  let supported = false;
  let creating = false;
  let loading = false;
  let readyObserver = null;
  let rewardObserver = null;

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

  function ensureMultiCardFields() {
    if ($('cardSelect')) return;
    const form = document.querySelector('.card-lifecycle-form');
    if (!form) return;

    const selectorLabel = document.createElement('label');
    const selectorText = document.createElement('span');
    selectorText.textContent = '管理集點卡';
    const selector = document.createElement('select');
    selector.id = 'cardSelect';
    selectorLabel.append(selectorText, selector);

    const nameLabel = document.createElement('label');
    const nameText = document.createElement('span');
    nameText.textContent = '集點卡名稱';
    const name = document.createElement('input');
    name.id = 'cardName';
    name.type = 'text';
    name.maxLength = 80;
    name.required = true;
    name.placeholder = '例如：夏季飲品集點卡';
    nameLabel.append(nameText, name);

    const descriptionLabel = document.createElement('label');
    descriptionLabel.className = 'full-span';
    const descriptionText = document.createElement('span');
    descriptionText.textContent = '集點卡說明';
    const description = document.createElement('textarea');
    description.id = 'cardDescription';
    description.maxLength = 500;
    description.rows = 3;
    description.placeholder = '例如：集滿指定點數可獲得本期優惠券。';
    descriptionLabel.append(descriptionText, description);

    form.prepend(descriptionLabel);
    form.prepend(nameLabel);
    form.prepend(selectorLabel);

    const actions = document.querySelector('.card-lifecycle-actions');
    if (actions) {
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
      rewardNodes: Array.isArray(value && value.rewardNodes) ? value.rewardNodes : [],
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
    if (selectedCard && typeof PointsCard.setSelectedCardId === 'function') PointsCard.setSelectedCardId(selectedCard.cardId);
    if (!selectedCard && typeof PointsCard.setSelectedCardId === 'function') PointsCard.setSelectedCardId('');
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

  function render() {
    ensureMultiCardFields();
    renderSelector();
    const effective = creating ? null : selectedCard;
    const badge = $('cardStatusBadge');
    badge.textContent = creating ? '新增中' : (!effective ? '無集點卡' : (effective.status === 'expired' ? '已過期' : '有效'));
    badge.className = 'status-badge ' + (effective ? effective.status : 'deleted');

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
    $('saveCardSettingsButton').textContent = creating ? '建立集點卡' : '儲存集點卡設定';

    const newStampButton = $('newStampButton');
    if (newStampButton) newStampButton.disabled = loading || !effective || !effective.available;

    const notice = $('cardSettingsNotice');
    notice.classList.toggle('locked', !effective || (effective && !effective.available));
    if (loading) {
      notice.textContent = '正在讀取集點卡清單。';
    } else if (!supported) {
      notice.textContent = '目前 GAS 尚未支援多集點卡；請先部署 PointsCard 2.0.0。';
    } else if (creating) {
      notice.textContent = '建立新集點卡後，可到「獎勵節點」設定這張卡自己的優惠券或抽獎券節點。';
    } else if (!effective) {
      notice.textContent = '目前沒有集點卡。新增後會員端才會顯示可用集點卡。';
    } else if (effective.status === 'expired') {
      notice.textContent = effective.name + ' 已過期；會員仍可切換查看其他有效集點卡。';
    } else if (effective.expiresAt) {
      notice.textContent = effective.name + ' 有效，到期時間：' + PointsCard.formatDateTime(effective.expiresAt, '—') + '。';
    } else {
      notice.textContent = effective.name + ' 有效，期限為無期限。';
    }
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
    } finally {
      loading = false;
      render();
      patchRewardNodeInputs();
    }
  }

  function startCreateCard() {
    creating = true;
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

  function readCardForm() {
    const name = $('cardName').value.trim();
    const description = $('cardDescription').value.trim();
    if (!name) throw new Error('請輸入集點卡名稱。');
    if (name.length > 80) throw new Error('集點卡名稱最多 80 個字。');
    if (description.length > 500) throw new Error('集點卡說明最多 500 個字。');
    return { name: name, description: description, expiresAt: readExpiry() };
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
        setMessage('新集點卡已建立。', false);
      } else {
        if (!selectedCard) throw new Error('請先選擇集點卡。');
        result = await PointsCard.callApi('admin.card.update', Object.assign({}, form, {
          cardId: selectedCard.cardId,
          expectedUpdatedAt: selectedCard.updatedAt
        }));
        PointsCard.setSelectedCardId(result.card.cardId);
        setMessage('集點卡設定已更新。', false);
      }
      window.location.reload();
    } catch (error) {
      setMessage(error && error.message ? error.message : '集點卡設定更新失敗。', true);
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

  function patchRewardNodeInputs() {
    document.querySelectorAll('.reward-node-points').forEach(function (input) {
      input.max = String(MAX_CARD_STAMPS);
      input.setAttribute('aria-description', '節點點數上限 10000');
    });
    const title = $('rewardNodesTitle');
    if (title && title.parentElement) {
      const intro = title.parentElement.querySelector('p:last-child');
      if (intro && intro !== title) intro.textContent = '設定目前集點卡在不同點數發放的獎勵；最大節點就是卡片長度，節點最高 10,000 點。';
    }
  }

  function readRewardNodesForMultiCard() {
    const rows = Array.from(document.querySelectorAll('#rewardNodeList .reward-node-editor-row'));
    if (!rows.length || rows.length > 5) throw new Error('請設定 1 至 5 個獎勵節點。');
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
          const rawWeight = Number(prizeRow.querySelector('.lottery-prize-weight').value);
          const basis = Math.round(rawWeight * 100);
          if (!name) throw new Error('每個抽獎獎項都必須填寫名稱。');
          if (!Number.isFinite(rawWeight) || rawWeight < 0 || rawWeight > 100 || Math.abs(rawWeight * 100 - basis) > 0.000001) {
            throw new Error('中獎率必須是 0% 至 100%，最多兩位小數。');
          }
          return { name: name, weight: basis / 100, basis: basis };
        });
        if (prizes.length < 2 || prizes.length > 8) throw new Error('每張抽獎券必須設定 2 至 8 個獎項。');
        if (new Set(prizes.map(function (prize) { return prize.name; })).size !== prizes.length) throw new Error('同一張抽獎券不能設定重複獎項。');
        if (prizes.reduce(function (total, prize) { return total + prize.basis; }, 0) !== 10000) throw new Error('同一張抽獎券的中獎率合計必須為 100%。');
        node.lotteryPrizes = prizes.map(function (prize) { return { name: prize.name, weight: prize.weight }; });
      }
      return node;
    });
  }

  async function saveRewardNodesForMultiCard(event) {
    if (!supported || !selectedCard) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const button = $('saveRewardNodesButton');
    const message = $('rewardSettingsMessage');
    button.disabled = true;
    try {
      const result = await PointsCard.callApi('admin.reward-nodes.update', {
        cardId: selectedCard.cardId,
        expectedUpdatedAt: selectedCard.rewardNodesUpdatedAt,
        rewardNodes: readRewardNodesForMultiCard()
      });
      if (result.settings && result.settings.card && result.settings.card.cardId) PointsCard.setSelectedCardId(result.settings.card.cardId);
      message.textContent = '這張集點卡的獎勵節點已更新。';
      message.className = 'settings-message';
      window.location.reload();
    } catch (error) {
      message.textContent = error && error.message ? error.message : '獎勵節點更新失敗。';
      message.className = 'settings-message error';
      button.disabled = Boolean(selectedCard.rewardSettingsLocked);
    }
  }

  function observeRewardEditor() {
    const list = $('rewardNodeList');
    if (!list || rewardObserver) return;
    rewardObserver = new MutationObserver(patchRewardNodeInputs);
    rewardObserver.observe(list, { childList: true, subtree: true });
    patchRewardNodeInputs();
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
      observeRewardEditor();
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
  $('cardExpiryMode').addEventListener('change', syncExpiryMode);
  $('saveCardSettingsButton').addEventListener('click', saveCardSettings);
  $('deleteCardButton').addEventListener('click', deleteCard);
  $('saveRewardNodesButton').addEventListener('click', saveRewardNodesForMultiCard, true);
  $('refreshButton').addEventListener('click', function () {
    window.setTimeout(function () {
      loadCards().catch(function (error) { setMessage(error && error.message ? error.message : '無法重新讀取集點卡。', true); });
    }, 150);
  });
  render();
  startWhenAdminReady();
})();
