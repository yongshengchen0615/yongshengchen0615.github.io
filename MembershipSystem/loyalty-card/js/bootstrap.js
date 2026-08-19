(() => {
  'use strict';

  const bootstrapScript = document.currentScript;
  const configPath = document.body.dataset.config;

  async function boot() {
    if (!configPath) throw new Error('Missing data-config path');
    const response = await fetch(configPath, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'same-origin'
    });
    if (!response.ok) throw new Error(`Unable to load config.json (${response.status})`);

    const config = await response.json();
    window.LOYALTY_CONFIG = Object.freeze(config);

    const appScript = document.createElement('script');
    appScript.src = new URL('./app.js', bootstrapScript.src).href;
    appScript.async = false;
    document.body.appendChild(appScript);
  }

  boot().catch((error) => {
    const notice = document.getElementById('configNotice');
    if (notice) {
      notice.textContent = `設定載入失敗：${error.message}`;
      notice.classList.remove('hidden');
    }
    const loginButton = document.getElementById('loginBtn');
    if (loginButton) loginButton.disabled = true;
  });
})();
