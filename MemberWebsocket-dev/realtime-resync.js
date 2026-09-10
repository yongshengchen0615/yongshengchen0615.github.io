(() => {
  'use strict';

  if (!window.MemberSystem || typeof window.MemberSystem.subscribeRealtime !== 'function') return;

  const base = window.MemberSystem;
  const originalSubscribeRealtime = base.subscribeRealtime.bind(base);
  const MIN_RESYNC_INTERVAL_MS = 1500;

  function subscribeRealtime(config, clientType, onUpdate) {
    if (typeof onUpdate !== 'function') return originalSubscribeRealtime(config, clientType, onUpdate);

    const unsubscribeRealtime = originalSubscribeRealtime(config, clientType, onUpdate);
    let disposed = false;
    let lastResyncAt = 0;
    let resyncPending = false;

    const resync = () => {
      if (disposed || document.visibilityState === 'hidden' || !navigator.onLine) return;
      const now = Date.now();
      if (resyncPending || now - lastResyncAt < MIN_RESYNC_INTERVAL_MS) return;
      lastResyncAt = now;
      resyncPending = true;
      Promise.resolve(onUpdate()).catch(() => {}).finally(() => { resyncPending = false; });
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') resync();
    };
    const onPageShow = () => resync();
    const onOnline = () => resync();

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('online', onOnline);

    return () => {
      if (disposed) return;
      disposed = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('online', onOnline);
      if (typeof unsubscribeRealtime === 'function') unsubscribeRealtime();
    };
  }

  window.MemberSystem = Object.freeze({ ...base, subscribeRealtime });
})();
