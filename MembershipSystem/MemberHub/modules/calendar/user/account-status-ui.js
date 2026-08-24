(() => {
  'use strict';

  window.addEventListener('DOMContentLoaded', () => {
    const errorTitle = document.getElementById('errorTitle');
    const errorMessage = document.getElementById('errorMessage');
    const retryButton = document.getElementById('retryButton');
    if (!errorTitle || !errorMessage || !retryButton) return;

    const enhanceDisabledMessage = () => {
      const message = String(errorMessage.textContent || '').trim();
      if (!message.includes('此帳號目前不可使用日曆服務')) return;

      errorTitle.textContent = '帳號已停用';
      errorMessage.textContent = '此帳號的日曆使用權限目前已停用。如需恢復使用，請聯絡管理員。';
      retryButton.textContent = '重新檢查';
    };

    const observer = new MutationObserver(enhanceDisabledMessage);
    observer.observe(errorMessage, { childList: true, characterData: true, subtree: true });
    enhanceDisabledMessage();
  });
})();
