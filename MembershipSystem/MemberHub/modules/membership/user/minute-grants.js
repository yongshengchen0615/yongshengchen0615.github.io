(function () {
  'use strict';

  const $ = (selector) => document.querySelector(selector);
  const tierLabel = { standard: '一般', silver: '銀級', gold: '金級', platinum: '白金', vip: '白金' };

  function formatMinutes(value) {
    return new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 }).format(Number(value || 0));
  }

  function formatDateTime(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat('zh-TW', {
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
    }).format(date);
  }

  function renderGrants(grants) {
    const list = $('#minuteGrantHistoryList');
    list.replaceChildren();
    $('#minuteGrantHistoryEmpty').classList.toggle('hidden', grants.length !== 0);

    grants.forEach((grant) => {
      const item = document.createElement('article');
      item.className = 'member-grant-item';

      const top = document.createElement('div');
      top.className = 'member-grant-item-top';
      const amount = document.createElement('strong');
      amount.textContent = `+${formatMinutes(grant.minutes)} 分鐘`;
      const date = document.createElement('time');
      date.textContent = formatDateTime(grant.grantedAt);
      top.append(amount, date);

      const reason = document.createElement('p');
      reason.textContent = `發放原因：${grant.reason || '—'}`;
      const meta = document.createElement('small');
      meta.textContent = `發放後累計 ${formatMinutes(grant.consumedAfterMinutes)} 分鐘｜${tierLabel[grant.tierAfter] || grant.tierAfter}會員`;
      item.append(top, reason, meta);
      list.append(item);
    });
  }

  async function loadHistory() {
    const button = $('#loadMinuteGrantHistoryButton');
    const message = $('#minuteGrantHistoryMessage');
    button.disabled = true;
    button.textContent = '載入中…';
    message.classList.add('hidden');
    try {
      const result = await Membership.callApi('member.minutes.grants.list', { limit: 20 });
      renderGrants(result.grants || []);
      button.textContent = '更新發放紀錄';
    } catch (error) {
      message.textContent = error && error.code === 'INVALID_ACTION'
        ? '會員服務尚未更新分鐘發放紀錄功能，請稍後再試。'
        : (error && error.message ? error.message : '無法載入分鐘發放紀錄。');
      message.classList.remove('hidden');
      button.textContent = '重新載入';
    } finally {
      button.disabled = false;
    }
  }

  $('#loadMinuteGrantHistoryButton').addEventListener('click', loadHistory);
})();
