(() => {
  'use strict';

  const current = document.currentScript?.src || new URL('./booking-panel.js', window.location.href).toString();
  const loadStyle = (name, version) => {
    if (document.querySelector(`link[data-booking-panel-style="${name}"]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL(`./${name}?v=${version}`, current).toString();
    link.dataset.bookingPanelStyle = name;
    document.head.appendChild(link);
  };
  const loadSharedResponsive = () => {
    const href = new URL('../responsive.css?v=20260914-time-input-1', current).toString();
    if ([...document.querySelectorAll('link[rel="stylesheet"]')].some((link) => link.href === href)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.dataset.bookingPanelStyle = 'shared-responsive-time-input';
    document.head.appendChild(link);
  };
  const load = (name, version) => new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = new URL(`./${name}?v=${version}`, current).toString();
    script.async = false;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`載入 ${name} 失敗。`));
    document.head.appendChild(script);
  });

  // booking-panel-core.js is dynamically loaded after DOMContentLoaded in some paths.
  // Its auto-open path can synchronously call request helpers before their lexical
  // initialization has completed. Temporarily mask #booking while the core script
  // initializes, then restore and open the tab after the script has fully evaluated.
  const requestedBookingHash = window.location.hash === '#booking';
  const locationWithoutHash = `${window.location.pathname}${window.location.search}`;
  if (requestedBookingHash) {
    window.history.replaceState({}, document.title, locationWithoutHash);
  }

  function restoreBookingHashAndOpen() {
    if (!requestedBookingHash) return;
    if (window.location.hash !== '#booking') {
      window.history.replaceState({}, document.title, `${locationWithoutHash}#booking`);
    }

    let attempts = 0;
    const tryOpen = () => {
      attempts += 1;
      const adminView = document.getElementById('adminView');
      const bookingTab = document.getElementById('bookingTab');
      const authenticated = Boolean(window.liff?.getIDToken?.());
      if (adminView && bookingTab && !adminView.classList.contains('hidden') && authenticated) {
        bookingTab.click();
        return true;
      }
      return attempts >= 300;
    };

    if (tryOpen()) return;
    const timer = window.setInterval(() => {
      if (tryOpen()) window.clearInterval(timer);
    }, 100);
  }

  loadSharedResponsive();
  loadStyle('booking-panel-responsive.css', 'booking-settings-layout-20260918-1');
  loadStyle('booking-summary.css', 'booking-summary-20260918-participants-1');
  loadStyle('booking-resources.css', 'booking-technician-modal-20260918-1');
  loadStyle('../booking-admin-group-details.css', 'booking-group-details-20260918-admin-edit-1');
  loadStyle('ui-polish.css', 'admin-ui-20260916-1');
  loadStyle('ui-polish-responsive.css', 'admin-ui-responsive-20260916-1');

  document.addEventListener('click', (event) => {
    if (!window.matchMedia('(max-width: 768px)').matches) return;
    const button = event.target?.closest?.('#bookingPanel .booking-admin-filter-button');
    if (!button) return;
    window.requestAnimationFrame(() => {
      try { button.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' }); } catch (_) {}
    });
  });

  // Preload DOM decorators before the core panel is mounted. Each decorator is
  // responsible for waiting for its own host element. allSettled prevents one
  // optional feature from blocking every feature loaded after it.
  const preloadExtensions = [
    ['booking-always-open.js', 'booking-always-open-20260917-2'],
    ['booking-cancellation-sync.js', 'booking-card-unified-20260918-1'],
    // Resource controls are independent required modules. They wait for the
    // booking host themselves, so they cannot disappear because another
    // decorator or the core load chain failed.
    ['booking-resources.js', 'booking-technician-modal-20260918-1'],
  ];

  Promise.allSettled(preloadExtensions.map(([name, version]) => load(name, version)))
    .then((results) => {
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          console.error('booking admin extension preload failed', preloadExtensions[index][0], result.reason);
        }
      });
      return load('booking-panel-core.js', 'booking-max-advance-days-20260919-1');
    })
    .then(() => {
      restoreBookingHashAndOpen();
    })
    .catch((error) => console.error('booking admin core load failed', error));
})();