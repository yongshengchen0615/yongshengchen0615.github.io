(async function () {
  'use strict';

  const status = document.getElementById('status');

  function validStampCode(value) {
    const code = String(value || '').trim();
    return /^[a-f0-9]{64}$/i.test(code) ? code.toLowerCase() : '';
  }

  function validRequestId(value) {
    const requestId = String(value || '').trim();
    return /^[a-f0-9]{32,64}$/i.test(requestId) ? requestId.toLowerCase() : '';
  }

  try {
    const response = await fetch('./shared/config.json', {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      referrerPolicy: 'no-referrer'
    });
    if (!response.ok) throw new Error('無法載入 LIFF 設定。');
    const config = await response.json();
    if (!config || !config.LIFF_ID || config.LIFF_ID === 'YOUR_LIFF_ID') {
      throw new Error('LIFF_ID 尚未設定。');
    }

    await liff.init({ liffId: String(config.LIFF_ID) });
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
