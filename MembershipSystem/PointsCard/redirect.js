(async function () {
  'use strict';

  const status = document.getElementById('status');
  const liffClient = window.PointsCardLiff;
  const CONFIG_HANDOFF_KEY = 'points-card.config.handoff';

  function validStampCode(value) {
    const code = String(value || '').trim();
    return /^[a-f0-9]{64}$/i.test(code) ? code.toLowerCase() : '';
  }

  function validRequestId(value) {
    const requestId = String(value || '').trim();
    return /^[a-f0-9]{32,64}$/i.test(requestId) ? requestId.toLowerCase() : '';
  }

  function saveConfigForNextPage(config) {
    const handoff = {
      loadedAt: Date.now(),
      config: {
        LIFF_ID: String(config && config.LIFF_ID || ''),
        USER_LIFF_ID: String(config && config.USER_LIFF_ID || ''),
        ADMIN_LIFF_ID: String(config && config.ADMIN_LIFF_ID || ''),
        GAS_WEB_APP_URL: String(config && config.GAS_WEB_APP_URL || '')
      }
    };
    try { window.sessionStorage.setItem(CONFIG_HANDOFF_KEY, JSON.stringify(handoff)); }
    catch (_) {}
  }

  try {
    if (!liffClient) throw new Error('LINE LIFF SDK 尚未完成載入。');
    const response = await fetch('./shared/config.json', {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'default',
      redirect: 'error',
      referrerPolicy: 'no-referrer'
    });
    if (!response.ok) throw new Error('無法載入 LIFF 設定。');
    const config = await response.json();
    const userLiffId = String(config && (config.USER_LIFF_ID || config.LIFF_ID) || '').trim();
    if (!userLiffId || /^YOUR_[A-Z0-9_]+$/i.test(userLiffId)) {
      throw new Error('USER_LIFF_ID 尚未設定。');
    }

    // The user page opens immediately after this primary LIFF redirect. Reuse this
    // public, short-lived config once so its first API connection can start sooner.
    saveConfigForNextPage(config);
    await liffClient.init({ liffId: userLiffId });
    const current = new URL(window.location.href);
    if (current.searchParams.has('liff.state')) {
      status.textContent = '正在完成 LINE 導向…';
      return;
    }

    const target = new URL('./user/', current);
    const stampCode = validStampCode(current.searchParams.get('stamp'));
    const requestId = validRequestId(current.searchParams.get('request'));
    if (stampCode) target.searchParams.set('stamp', stampCode);
    if (stampCode && requestId) target.searchParams.set('request', requestId);
    window.location.replace(target.href);
  } catch (error) {
    status.textContent = error && error.message ? error.message : '無法開啟集點卡。';
  }
})();
