(() => {
  'use strict';

  const MAX_VISIBLE_MS = 45000;
  const state = {
    active: false,
    stage: '',
    sawSyncing: false,
    timeoutId: 0
  };

  window.addEventListener('DOMContentLoaded', mountOperationLoading);

  function mountOperationLoading() {
    if (document.getElementById('calendarOperationLoading')) return;
    document.body.appendChild(buildOverlay());

    document.addEventListener('submit', handleSubmitCapture, true);
    document.addEventListener('click', handleClickCapture, true);

    observeBulkMessage();
    observeBulkModal();
    observeSyncStatus();
  }

  function buildOverlay() {
    const overlay = node('div', {
      id: 'calendarOperationLoading',
      className: 'operation-loading hidden',
      role: 'status',
      'aria-live': 'polite',
      'aria-atomic': 'true',
      'aria-hidden': 'true'
    });

    const card = node('div', { className: 'operation-loading-card' });
    const spinner = node('div', { className: 'operation-loading-spinner', 'aria-hidden': 'true' });
    const copy = node('div', { className: 'operation-loading-copy' });
    copy.append(
      node('p', { className: 'operation-loading-eyebrow', textContent: 'CalendarSystem' }),
      node('h2', { id: 'operationLoadingTitle', textContent: '處理中' }),
      node('p', { id: 'operationLoadingMessage', textContent: '正在處理你的操作。' })
    );

    const meta = node('div', { className: 'operation-loading-meta' });
    meta.append(
      node('span', { id: 'operationLoadingCount', className: 'operation-loading-count hidden' }),
      node('span', { id: 'operationLoadingState', textContent: '請勿關閉此畫面' })
    );

    const progress = node('div', { className: 'operation-loading-progress', 'aria-hidden': 'true' });
    progress.appendChild(node('span', { className: 'operation-loading-progress-bar' }));

    card.append(spinner, copy, meta, progress);
    overlay.appendChild(card);
    return overlay;
  }

  function handleSubmitCapture(event) {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || !form.matches('.bulk-create-ux-form')) return;

    const count = document.querySelectorAll('#bulkUxRangeList .bulk-date-row').length;
    if (!count) return;

    showLoading({
      stage: 'bulk-write',
      title: `正在建立 ${count} 筆事項`,
      message: '資料正在送往日曆服務，完成後會自動同步最新內容。',
      countLabel: `${count} 筆`
    });
  }

  function handleClickCapture(event) {
    const button = event.target instanceof Element ? event.target.closest('button') : null;
    if (!button || button.disabled) return;

    if (button.id === 'refreshButton') {
      if (state.active) {
        beginSyncStage();
        return;
      }
      showLoading({
        stage: 'sync',
        title: '正在同步日曆',
        message: '正在取得最新的日曆資料。',
        countLabel: ''
      });
      return;
    }

    const bulkModal = button.closest('#bulkActionsModal');
    if (!bulkModal) return;

    const label = String(button.textContent || '').trim();
    const count = selectedBulkCount();
    if (!count) return;

    if (label.includes('套用批量修改')) {
      showBulkLoadingAfterAction(button, {
        stage: 'bulk-write',
        title: `正在修改 ${count} 筆事項`,
        message: '正在套用共同修改，完成後會自動同步最新內容。',
        countLabel: `${count} 筆`
      });
    } else if (label.includes('批量移除')) {
      showBulkLoadingAfterAction(button, {
        stage: 'bulk-write',
        title: `正在移除 ${count} 筆事項`,
        message: '正在封存選取事項，完成後會自動同步最新內容。',
        countLabel: `${count} 筆`
      });
    }
  }

  function showBulkLoadingAfterAction(button, options) {
    window.setTimeout(() => {
      if (!button.isConnected || !button.disabled || state.active) return;
      showLoading(options);
    }, 0);
  }

  function selectedBulkCount() {
    return document.querySelectorAll('#bulkActionsModal .bulk-item-row input[type="checkbox"]:checked').length;
  }

  function observeBulkMessage() {
    const target = document.getElementById('bulkModalMessage');
    if (!target) return;
    const observer = new MutationObserver(() => {
      if (!state.active || state.stage !== 'bulk-write') return;
      const hasError = !target.classList.contains('hidden') && Boolean(String(target.textContent || '').trim());
      if (hasError) hideLoading();
    });
    observer.observe(target, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class'] });
  }

  function observeBulkModal() {
    const target = document.getElementById('bulkActionsModal');
    if (!target) return;
    const observer = new MutationObserver(() => {
      if (!state.active || state.stage !== 'bulk-write') return;
      if (target.classList.contains('hidden')) beginSyncStage();
    });
    observer.observe(target, { attributes: true, attributeFilter: ['class'] });
  }

  function observeSyncStatus() {
    const target = document.getElementById('syncStatus');
    if (!target) return;
    const observer = new MutationObserver(() => {
      if (!state.active || state.stage !== 'sync') return;
      const text = String(target.textContent || '').trim();
      if (text.startsWith('同步中')) {
        state.sawSyncing = true;
        return;
      }
      if (!state.sawSyncing) return;

      if (text.startsWith('已同步')) {
        finishLoading('同步完成', '日曆已更新為最新資料。', false);
      } else if (text.startsWith('同步失敗')) {
        finishLoading('同步失敗', '操作可能已完成，但重新載入失敗。請稍後再按「同步資料」。', true);
      }
    });
    observer.observe(target, { childList: true, subtree: true, characterData: true });
  }

  function beginSyncStage() {
    if (!state.active) return;
    state.stage = 'sync';
    state.sawSyncing = false;
    updateOverlay('正在同步日曆', '寫入完成，正在取得最新的日曆資料。', '');
  }

  function showLoading(options) {
    const overlay = document.getElementById('calendarOperationLoading');
    if (!overlay) return;

    state.active = true;
    state.stage = options.stage || 'working';
    state.sawSyncing = false;
    window.clearTimeout(state.timeoutId);

    updateOverlay(options.title || '處理中', options.message || '正在處理你的操作。', options.countLabel || '');
    overlay.classList.remove('hidden', 'is-error', 'is-complete');
    overlay.setAttribute('aria-hidden', 'false');
    document.body.classList.add('operation-loading-open');

    state.timeoutId = window.setTimeout(() => {
      if (!state.active) return;
      hideLoading();
    }, MAX_VISIBLE_MS);
  }

  function updateOverlay(title, message, countLabel) {
    const titleNode = document.getElementById('operationLoadingTitle');
    const messageNode = document.getElementById('operationLoadingMessage');
    const countNode = document.getElementById('operationLoadingCount');
    const stateNode = document.getElementById('operationLoadingState');
    if (titleNode) titleNode.textContent = title;
    if (messageNode) messageNode.textContent = message;
    if (countNode) {
      countNode.textContent = countLabel;
      countNode.classList.toggle('hidden', !countLabel);
    }
    if (stateNode) stateNode.textContent = '請勿關閉此畫面';
  }

  function finishLoading(title, message, isError) {
    const overlay = document.getElementById('calendarOperationLoading');
    if (!overlay) return;
    updateOverlay(title, message, '');
    overlay.classList.toggle('is-error', Boolean(isError));
    overlay.classList.toggle('is-complete', !isError);
    const stateNode = document.getElementById('operationLoadingState');
    if (stateNode) stateNode.textContent = isError ? '可稍後重新同步' : '完成';
    window.clearTimeout(state.timeoutId);
    state.timeoutId = window.setTimeout(hideLoading, isError ? 1500 : 450);
  }

  function hideLoading() {
    const overlay = document.getElementById('calendarOperationLoading');
    state.active = false;
    state.stage = '';
    state.sawSyncing = false;
    window.clearTimeout(state.timeoutId);
    state.timeoutId = 0;
    if (!overlay) return;
    overlay.classList.add('hidden');
    overlay.classList.remove('is-error', 'is-complete');
    overlay.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('operation-loading-open');
  }

  function node(tagName, props = {}, ...children) {
    const element = document.createElement(tagName);
    Object.keys(props).forEach((key) => {
      const value = props[key];
      if (key === 'className') element.className = value;
      else if (key === 'textContent') element.textContent = value;
      else if (key in element && !key.startsWith('aria-')) element[key] = value;
      else element.setAttribute(key, String(value));
    });
    children.flat().forEach((child) => {
      if (child) element.appendChild(child);
    });
    return element;
  }
})();
