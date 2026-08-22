(function () {
  'use strict';

  let notices = [];
  let currentNotice = null;
  let loaded = false;
  let loading = false;
  let observer = null;

  function $(id) { return document.getElementById(id); }

  function createDialog() {
    if ($('pointGrantNoticeDialog')) return;
    const dialog = document.createElement('dialog');
    dialog.id = 'pointGrantNoticeDialog';
    dialog.className = 'feedback-dialog';
    dialog.setAttribute('aria-labelledby', 'pointGrantNoticeTitle');

    const seal = document.createElement('div');
    seal.className = 'success-seal';
    seal.setAttribute('aria-hidden', 'true');
    const sealCount = document.createElement('span');
    sealCount.id = 'pointGrantNoticeCount';
    sealCount.textContent = '+1';
    seal.append(sealCount);

    const eyebrow = document.createElement('p');
    eyebrow.className = 'eyebrow';
    eyebrow.textContent = 'POINTS RECEIVED';
    const title = document.createElement('h2');
    title.id = 'pointGrantNoticeTitle';
    title.textContent = '你獲得點數';
    const message = document.createElement('p');
    message.id = 'pointGrantNoticeMessage';
    message.textContent = '店家已發放點數到你的集點卡。';
    const total = document.createElement('p');
    total.id = 'pointGrantNoticeTotal';
    total.className = 'settings-notice';
    const error = document.createElement('p');
    error.id = 'pointGrantNoticeError';
    error.className = 'form-error hidden';
    error.setAttribute('role', 'alert');
    const button = document.createElement('button');
    button.id = 'confirmPointGrantNoticeButton';
    button.className = 'button button-primary';
    button.type = 'button';
    button.textContent = '知道了';
    button.addEventListener('click', acknowledgeCurrentNotice);

    dialog.append(seal, eyebrow, title, message, total, error, button);
    document.body.append(dialog);
    dialog.addEventListener('cancel', function (event) { event.preventDefault(); });
  }

  function showNextNotice() {
    if (!notices.length) {
      currentNotice = null;
      const dialog = $('pointGrantNoticeDialog');
      if (dialog && dialog.open) dialog.close();
      return;
    }
    currentNotice = notices[0];
    $('pointGrantNoticeCount').textContent = '+' + String(Number(currentNotice.stampCount || 0));
    $('pointGrantNoticeTitle').textContent = currentNotice.title || '你獲得點數';
    $('pointGrantNoticeMessage').textContent = currentNotice.message || '店家已發放點數到你的集點卡。';
    $('pointGrantNoticeTotal').textContent = '「' + (currentNotice.cardName || '集點卡') + '」目前累計 ' + String(Number(currentNotice.totalAfter || 0)) + ' 點。';
    $('pointGrantNoticeError').textContent = '';
    $('pointGrantNoticeError').classList.add('hidden');
    $('confirmPointGrantNoticeButton').disabled = false;
    const dialog = $('pointGrantNoticeDialog');
    if (!dialog.open) dialog.showModal();
  }

  async function acknowledgeCurrentNotice() {
    if (!currentNotice) return;
    const button = $('confirmPointGrantNoticeButton');
    const error = $('pointGrantNoticeError');
    button.disabled = true;
    error.textContent = '';
    error.classList.add('hidden');
    try {
      await PointsCard.callApi('member.point-notification.read', {
        notificationId: currentNotice.notificationId
      });
      notices.shift();
      showNextNotice();
    } catch (readError) {
      if (window.PointsCard && typeof PointsCard.reportError === 'function') {
        PointsCard.reportError(readError, { source: 'member-point-notice', action: 'member.point-notification.read' });
      }
      error.textContent = readError && readError.message ? readError.message : '通知狀態暫時無法更新，請稍後再試。';
      error.classList.remove('hidden');
    } finally {
      button.disabled = false;
    }
  }

  async function loadNoticesOnce() {
    if (loaded || loading) return;
    const app = $('memberApp');
    if (!app || app.classList.contains('hidden')) return;
    loading = true;
    try {
      const result = await PointsCard.callApi('member.point-notifications.list', { limit: 10 });
      notices = Array.isArray(result.notifications) ? result.notifications : [];
      loaded = true;
      showNextNotice();
    } catch (error) {
      if (window.PointsCard && typeof PointsCard.reportError === 'function') {
        PointsCard.reportError(error, { source: 'member-point-notice', action: 'member.point-notifications.list' });
      }
    } finally {
      loading = false;
    }
  }

  function init() {
    createDialog();
    const app = $('memberApp');
    if (!app) return;
    loadNoticesOnce();
    observer = new MutationObserver(function () { loadNoticesOnce(); });
    observer.observe(app, { attributes: true, attributeFilter: ['class'] });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
