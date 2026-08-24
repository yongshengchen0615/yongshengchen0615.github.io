(function () {
  'use strict';

  const NOTICE_API_TIMEOUT_MS = 32000;
  let notices = [];
  let currentNotice = null;
  let loaded = false;
  let loading = false;
  let surfaceObserver = null;
  let presentationRetryScheduled = false;

  function $(id) { return document.getElementById(id); }

  function scheduleRetryPresentation() {
    if (presentationRetryScheduled) return;
    presentationRetryScheduled = true;
    window.setTimeout(function () {
      presentationRetryScheduled = false;
      retryPresentation();
    }, 0);
  }

  function withNoticeApiTimeout(request) {
    let timeout = 0;
    const timeoutPromise = new Promise(function (_, reject) {
      timeout = window.setTimeout(function () {
        const error = new Error('通知服務回應逾時，請稍後再試。');
        error.code = 'CLIENT_TIMEOUT';
        reject(error);
      }, NOTICE_API_TIMEOUT_MS);
    });
    return Promise.race([
      request,
      timeoutPromise
    ]).finally(function () { window.clearTimeout(timeout); });
  }

  function openNoticeDialog(dialog) {
    if (!dialog || dialog.open) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }

  function closeNoticeDialog(dialog) {
    if (!dialog || !dialog.open) return;
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
  }

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
    dialog.addEventListener('close', scheduleRetryPresentation);
  }

  function canPresentNotices() {
    const app = $('memberApp');
    if (!app || app.classList.contains('hidden')) return false;
    const navigation = PointsCard.getNavigationState();
    if (navigation && navigation.stamp) return false;
    const processing = $('processingOverlay');
    if (processing && !processing.classList.contains('hidden')) return false;
    return !document.querySelector('dialog[open]:not(#pointGrantNoticeDialog)');
  }

  function showNextNotice() {
    if (!notices.length) {
      currentNotice = null;
      closeNoticeDialog($('pointGrantNoticeDialog'));
      return;
    }
    if (!canPresentNotices()) return;

    const nextNotice = notices[0];
    const dialog = $('pointGrantNoticeDialog');
    if (dialog && dialog.open && currentNotice && currentNotice.notificationId === nextNotice.notificationId) return;

    currentNotice = nextNotice;
    $('pointGrantNoticeCount').textContent = '+' + String(Number(currentNotice.stampCount || 0));
    $('pointGrantNoticeTitle').textContent = currentNotice.title || '你獲得點數';
    $('pointGrantNoticeMessage').textContent = currentNotice.message || '店家已發放點數到你的集點卡。';
    $('pointGrantNoticeTotal').textContent = '「' + (currentNotice.cardName || '集點卡') + '」目前累計 ' + String(Number(currentNotice.totalAfter || 0)) + ' 點。';
    $('pointGrantNoticeError').textContent = '';
    $('pointGrantNoticeError').classList.add('hidden');
    $('confirmPointGrantNoticeButton').disabled = false;
    openNoticeDialog(dialog);
  }

  async function acknowledgeCurrentNotice() {
    if (!currentNotice) return;
    const button = $('confirmPointGrantNoticeButton');
    const error = $('pointGrantNoticeError');
    button.disabled = true;
    error.textContent = '';
    error.classList.add('hidden');
    try {
      await withNoticeApiTimeout(PointsCard.callApi('member.point-notification.read', {
        notificationId: currentNotice.notificationId
      }));
      notices.shift();
      currentNotice = null;
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
    if (loaded || loading || !canPresentNotices()) {
      if (loaded) showNextNotice();
      return;
    }
    loading = true;
    try {
      const result = await withNoticeApiTimeout(PointsCard.callApi('member.point-notifications.list', { limit: 10 }));
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

  function retryPresentation() {
    if (loaded) showNextNotice();
    else loadNoticesOnce();
  }

  function bindPresentationSignals(app) {
    document.querySelectorAll('dialog').forEach(function (dialog) {
      if (dialog.id !== 'pointGrantNoticeDialog') dialog.addEventListener('close', scheduleRetryPresentation);
    });

    if (typeof MutationObserver !== 'function') return;
    surfaceObserver = new MutationObserver(scheduleRetryPresentation);
    surfaceObserver.observe(app, { attributes: true, attributeFilter: ['class'] });
    const processing = $('processingOverlay');
    if (processing) surfaceObserver.observe(processing, { attributes: true, attributeFilter: ['class'] });
  }

  function init() {
    createDialog();
    const app = $('memberApp');
    if (!app) return;
    bindPresentationSignals(app);
    scheduleRetryPresentation();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
