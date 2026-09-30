(() => {
  'use strict';

  const E2E_CONTROL_SRC = './e2e-control.js?v=qa-e2e-20260929-7&lazy=20260929-1';
  let loadPromise = null;

  function showLoadError() {
    const message = document.getElementById('automationTestMessage');
    if (!message) return;
    message.textContent = 'E2E 控制器載入失敗，請重新整理後再試。';
    message.classList.remove('hidden');
    message.classList.add('error');
  }

  function load() {
    const existing = document.querySelector('script[data-admin-e2e-control]');
    if (existing) return loadPromise || Promise.resolve();

    loadPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = E2E_CONTROL_SRC;
      script.dataset.adminE2eControl = 'true';
      script.onload = () => resolve();
      script.onerror = () => {
        loadPromise = null;
        script.remove();
        showLoadError();
        reject(new Error('E2E controller failed to load'));
      };
      document.head.appendChild(script);
    });
    return loadPromise;
  }

  function init() {
    const tab = document.getElementById('testModeTab');
    if (!tab) return;
    const warm = () => { load().catch(() => {}); };
    tab.addEventListener('pointerenter', warm, { once: true, passive: true });
    tab.addEventListener('focus', warm, { once: true });
    tab.addEventListener('click', warm, { once: true });
  }

  window.AdminE2EControlLoader = Object.freeze({ load });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
