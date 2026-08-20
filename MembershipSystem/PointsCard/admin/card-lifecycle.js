(function () {
  'use strict';

  const $ = function (id) { return document.getElementById(id); };
  let card = { status: 'active', available: true, expiresAt: '', updatedAt: 'legacy' };
  let supported = false;
  let loading = false;
  let readyObserver = null;

  function toLocalDateTimeInput(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    const offset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 16);
  }

  function normalizeCard(settings) {
    const source = settings && settings.card ? settings.card : {};
    const status = ['active', 'expired', 'deleted'].indexOf(String(source.status || '')) >= 0
      ? String(source.status)
      : 'active';
    supported = Boolean(settings && settings.cardLifecycleSupported === true && settings.card);
    card = {
      status: status,
      available: source.available === undefined ? status === 'active' : Boolean(source.available),
      expiresAt: String(source.expiresAt || ''),
      updatedAt: String(source.updatedAt || 'legacy') || 'legacy'
    };
  }

  function setMessage(message, isError) {
    const target = $('cardSettingsMessage');
    target.textContent = message || '';
    target.className = 'settings-message' + (isError ? ' error' : '') + (message ? '' : ' hidden');
  }

  function syncExpiryMode() {
    const limited = $('cardExpiryMode').value === 'limited';
    $('cardExpiryField').classList.toggle('hidden', !limited);
    $('cardExpiresAt').required = limited;
    if (limited && !$('cardExpiresAt').value) {
      $('cardExpiresAt').value = toLocalDateTimeInput(Date.now() + 30 * 24 * 60 * 60 * 1000);
    }
  }

  function cardStatusLabel(status) {
    if (status === 'deleted') return '已刪除';
    if (status === 'expired') return '已過期';
    return '有效';
  }

  function render() {
    const badge = $('cardStatusBadge');
    badge.textContent = cardStatusLabel(card.status);
    badge.className = 'status-badge ' + card.status;

    $('cardExpiryMode').value = card.expiresAt ? 'limited' : 'unlimited';
    $('cardExpiresAt').value = card.expiresAt ? toLocalDateTimeInput(card.expiresAt) : '';
    syncExpiryMode();

    $('cardExpiryMode').disabled = !supported || loading;
    $('cardExpiresAt').disabled = !supported || loading;
    $('saveCardSettingsButton').disabled = !supported || loading;
    $('deleteCardButton').disabled = !supported || loading || card.status === 'deleted';
    $('saveCardSettingsButton').textContent = card.available ? '儲存集點卡設定' : '重新啟用集點卡';

    const newStampButton = $('newStampButton');
    if (newStampButton) newStampButton.disabled = loading || (supported && !card.available);

    const notice = $('cardSettingsNotice');
    notice.classList.toggle('locked', supported && !card.available);
    if (loading) {
      notice.textContent = '正在讀取集點卡設定。';
    } else if (!supported) {
      notice.textContent = '目前 GAS 尚未支援集點卡期限與刪除；請先部署 PointsCard 1.4.0。';
    } else if (card.status === 'deleted') {
      notice.textContent = '集點卡已刪除。會員端會顯示「目前沒有可用集點卡」；既有點數與已獲得票券仍保留。儲存設定可重新啟用。';
    } else if (card.status === 'expired') {
      notice.textContent = '集點卡已過期。會員端會顯示「目前沒有可用集點卡」；改為未來期限或無期限即可重新啟用。';
    } else if (card.expiresAt) {
      notice.textContent = '集點卡目前有效，到期時間：' + PointsCard.formatDateTime(card.expiresAt, '—') + '。';
    } else {
      notice.textContent = '集點卡目前有效，期限設定為無期限。';
    }
  }

  async function loadCardSettings() {
    if (loading) return;
    loading = true;
    render();
    try {
      const result = await PointsCard.callApi('admin.summary');
      normalizeCard(result.settings || {});
    } finally {
      loading = false;
      render();
    }
  }

  function readExpiry() {
    if ($('cardExpiryMode').value === 'unlimited') return '';
    const expiry = new Date($('cardExpiresAt').value);
    if (!Number.isFinite(expiry.getTime()) || expiry.getTime() <= Date.now()) {
      throw new Error('集點卡到期時間必須晚於現在。');
    }
    return expiry.toISOString();
  }

  async function saveCardSettings() {
    setMessage('', false);
    $('saveCardSettingsButton').disabled = true;
    try {
      const result = await PointsCard.callApi('admin.card.update', {
        expectedUpdatedAt: card.updatedAt,
        expiresAt: readExpiry()
      });
      card = result.card;
      supported = true;
      render();
      setMessage(card.expiresAt ? '集點卡期限已更新。' : '集點卡已設為無期限。', false);
    } catch (error) {
      setMessage(error && error.message ? error.message : '集點卡設定更新失敗。', true);
      render();
    }
  }

  async function deleteCard() {
    const confirmed = window.confirm('確定刪除目前集點卡？刪除後會員端會顯示「目前沒有可用集點卡」，新的集點會被拒絕；既有點數、已獲得票券與稽核紀錄會保留。');
    if (!confirmed) return;
    setMessage('', false);
    $('deleteCardButton').disabled = true;
    try {
      const result = await PointsCard.callApi('admin.card.delete', {
        expectedUpdatedAt: card.updatedAt
      });
      card = result.card;
      supported = true;
      render();
      setMessage('集點卡已刪除；會員端不再顯示可用集點卡。', false);
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
      loadCardSettings().catch(function (error) {
        setMessage(error && error.message ? error.message : '無法讀取集點卡設定。', true);
      });
      return true;
    };
    if (start()) return;
    readyObserver = new MutationObserver(start);
    readyObserver.observe(adminApp, { attributes: true, attributeFilter: ['class'] });
  }

  $('cardExpiryMode').addEventListener('change', syncExpiryMode);
  $('saveCardSettingsButton').addEventListener('click', saveCardSettings);
  $('deleteCardButton').addEventListener('click', deleteCard);
  $('refreshButton').addEventListener('click', function () {
    window.setTimeout(function () {
      loadCardSettings().catch(function (error) {
        setMessage(error && error.message ? error.message : '無法重新讀取集點卡設定。', true);
      });
    }, 150);
  });

  render();
  startWhenAdminReady();
})();
