(() => {
  'use strict';

  const current = document.currentScript?.src || new URL('./booking-panel.js', window.location.href).toString();
  const load = (name, version) => new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = new URL(`./${name}?v=${version}`, current).toString();
    script.async = false;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`載入 ${name} 失敗。`));
    document.head.appendChild(script);
  });

  load('booking-panel-core.js', 'booking-panel-core-20260911-1')
    .then(() => load('booking-cancellation-sync.js', 'booking-cancellation-sync-20260911-1'))
    .catch((error) => console.error('booking admin extension load failed', error));
})();
