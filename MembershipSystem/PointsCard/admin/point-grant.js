(function () {
  'use strict';

  const MAX_GRANT_POINTS = 100;
  let currentTarget = null;
  let grantRetry = null;
  let observer = null;

  function $(id) { return document.getElementById(id); }

  function createDialog() {
    if ($('pointGrantDialog')) return;
    const dialog = document.createElement('dialog');
    dialog.id = 'pointGrantDialog';
    dialog.className = 'admin-dialog';
    dialog.setAttribute('aria-labelledby', 'pointGrantDialogTitle');

    const form = document.createElement('form');
    form.method = 'dialog';
    const header = document.createElement('header');
    header.className = 'dialog-header';
    const copy = document.createElement('div');
    const eyebrow = document.createElement('p');
    eyebrow.className = 'eyebrow';
    eyebrow.textContent = 'MANUAL POINT GRANT';
    const title = document.createElement('h2');
    title.id = 'pointGrantDialogTitle';
    title.textContent = '發放點數';
    const meta = document.createElement('p');
    meta.id = 'pointGrantMemberMeta';
    meta.textContent = '—';
    copy.append(eyebrow, title, meta);
    const close = document.createElement('button');
    close.className = 'close-button';
    close.value = 'cancel';
    close.type = 'button';
    close.setAttribute('aria-label', '關閉');
    close.textContent = '×';
    header.append(copy, close);

    const grid = document.createElement('div');
    grid.className = 'form-grid';
    const amountLabel = document.createElement('label');
    const amountText = document.createElement('span');
    amountText.textContent = '發放點數';
    const amount = document.createElement('input');
    amount.id = 'pointGrantAmount';
    amount.type = 'number';
    amount.min = '1';
    amount.max = String(MAX_GRANT_POINTS);
    amount.step = '1';
    amount.value = '1';
    amount.inputMode = 'numeric';
    amount.required = true;
    amountLabel.append(amountText, amount);

    const cardLabel = document.createElement('label');
    const cardText = document.createElement('span');
    cardText.textContent = '發放到集點卡';
    const cardName = document.createElement('input');
    cardName.id = 'pointGrantCardName';
    cardName.type = 'text';
    cardName.readOnly = true;
    cardLabel.append(cardText, cardName);

    const reasonLabel = document.createElement('label');
    reasonLabel.className = 'full-span';
    const reasonText = document.createElement('span');
    reasonText.textContent = '發放原因';
    const reason = document.createElement('textarea');
    reason.id = 'pointGrantReason';
    reason.maxLength = 200;
    reason.rows = 3;
    reason.required = true;
    reason.placeholder = '例如：活動補發、消費回饋、客服補點';
    reasonLabel.append(reasonText, reason);
    grid.append(amountLabel, cardLabel, reasonLabel);

    const hint = document.createElement('p');
    hint.className = 'settings-notice';
    hint.textContent = '發放後會立即增加會員點數、建立一次性會員通知，並嘗試透過 LINE 官方帳號提醒。';
    const error = document.createElement('p');
    error.id = 'pointGrantFormError';
    error.className = 'form-error hidden';
    error.setAttribute('role', 'alert');

    const footer = document.createElement('footer');
    footer.className = 'dialog-actions';
    const cancel = document.createElement('button');
    cancel.className = 'button button-secondary';
    cancel.value = 'cancel';
    cancel.type = 'button';
    cancel.textContent = '取消';
    const submit = document.createElement('button');
    submit.id = 'submitPointGrantButton';
    submit.className = 'button button-primary';
    submit.type = 'button';
    submit.textContent = '確認發放';
    footer.append(cancel, submit);

    form.append(header, grid, hint, error, footer);
    dialog.append(form);
    document.body.append(dialog);
    close.addEventListener('click', function () { dialog.close('cancel'); });
    cancel.addEventListener('click', function () { dialog.close('cancel'); });
    submit.addEventListener('click', submitPointGrant);
    dialog.addEventListener('close', function () {
      currentTarget = null;
      grantRetry = null;
      error.textContent = '';
      error.classList.add('hidden');
    });
  }

  function selectedCardName() {
    const selector = $('cardSelect');
    if (selector && selector.selectedOptions && selector.selectedOptions.length) {
      return String(selector.selectedOptions[0].textContent || '').replace(/（已過期）$/, '');
    }
    return '目前選取的集點卡';
  }

  function openPointGrant(memberNo, displayName) {
    createDialog();
    currentTarget = { memberNo: memberNo, displayName: displayName };
    grantRetry = null;
    $('pointGrantDialogTitle').textContent = '發放點數給 ' + (displayName || '會員');
    $('pointGrantMemberMeta').textContent = memberNo;
    $('pointGrantCardName').value = selectedCardName();
    $('pointGrantAmount').value = '1';
    $('pointGrantReason').value = '';
    $('pointGrantFormError').textContent = '';
    $('pointGrantFormError').classList.add('hidden');
    $('pointGrantDialog').showModal();
  }

  function grantRequestId(memberNo, cardId, amount, reason) {
    const fingerprint = [memberNo, cardId, amount, reason].join('|');
    if (grantRetry && grantRetry.fingerprint === fingerprint) return grantRetry.requestId;
    grantRetry = { fingerprint: fingerprint, requestId: PointsCard.randomHex(16) };
    return grantRetry.requestId;
  }

  async function submitPointGrant() {
    if (!currentTarget) return;
    const amount = Number($('pointGrantAmount').value);
    const reason = String($('pointGrantReason').value || '').trim();
    const cardId = PointsCard.getSelectedCardId();
    const error = $('pointGrantFormError');
    error.textContent = '';
    error.classList.add('hidden');
    if (!cardId) {
      error.textContent = '請先選擇要發放點數的集點卡。';
      error.classList.remove('hidden');
      return;
    }
    if (!Number.isInteger(amount) || amount < 1 || amount > MAX_GRANT_POINTS) {
      error.textContent = '發放點數必須是 1 到 100 的整數。';
      error.classList.remove('hidden');
      return;
    }
    if (!reason) {
      error.textContent = '請填寫發放原因。';
      error.classList.remove('hidden');
      return;
    }

    const button = $('submitPointGrantButton');
    button.disabled = true;
    try {
      const result = await PointsCard.callApi('admin.points.grant', {
        targetMemberNo: currentTarget.memberNo,
        stampCount: amount,
        reason: reason,
        requestId: grantRequestId(currentTarget.memberNo, cardId, amount, reason)
      });
      grantRetry = null;
      $('pointGrantDialog').close();
      const pushMessage = result.pushStatus === 'sent'
        ? '，LINE 官方帳號提醒已送出。'
        : result.pushStatus === 'not-configured'
          ? '；點數已發放，但尚未設定 LINE 官方帳號推播。'
          : '；點數已發放，LINE 提醒暫未送達。';
      const toast = $('toast');
      if (toast) {
        toast.textContent = (result.duplicate ? '此筆發點先前已完成' : '已發放 ' + result.stampCount + ' 點') + pushMessage;
        toast.classList.remove('hidden');
      }
      const refresh = $('refreshButton');
      if (refresh && !refresh.disabled) refresh.click();
    } catch (grantError) {
      if (window.PointsCard && typeof PointsCard.reportError === 'function') {
        PointsCard.reportError(grantError, { source: 'admin-point-grant', action: 'admin.points.grant' });
      }
      error.textContent = grantError && grantError.message ? grantError.message : '發點失敗，請稍後再試。';
      error.classList.remove('hidden');
    } finally {
      button.disabled = false;
    }
  }

  function bindMemberRows() {
    const body = $('memberTableBody');
    if (!body) return;
    Array.from(body.querySelectorAll('tr')).forEach(function (row) {
      if (row.dataset.pointGrantBound === '1') return;
      const memberCell = row.querySelector('.member-cell');
      const actions = row.querySelector('.row-actions');
      const status = row.querySelector('.status-badge');
      if (!memberCell || !actions) return;
      const displayName = memberCell.querySelector('strong');
      const memberNo = memberCell.querySelector('span');
      if (!memberNo || !memberNo.textContent) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'text-button accent';
      button.textContent = '發點';
      button.disabled = !status || !status.classList.contains('active');
      button.addEventListener('click', function () {
        openPointGrant(String(memberNo.textContent || '').trim(), String(displayName && displayName.textContent || 'LINE 會員').trim());
      });
      actions.prepend(button);
      row.dataset.pointGrantBound = '1';
    });
  }

  function init() {
    createDialog();
    const body = $('memberTableBody');
    if (!body) return;
    bindMemberRows();
    observer = new MutationObserver(bindMemberRows);
    observer.observe(body, { childList: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
