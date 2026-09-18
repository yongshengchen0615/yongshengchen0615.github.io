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
  loadStyle('booking-panel-responsive.css', 'booking-panel-responsive-20260915-mobile-field-overflow-1');
  loadStyle('booking-summary.css', 'booking-summary-20260918-participants-1');
  loadStyle('booking-resources.css', 'booking-primary-tech-20260917-3');
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

  load('booking-summary.js', 'booking-participant-contact-20260918-1')
    .then(() => load('../booking-admin-group-details.js', 'booking-group-details-20260918-admin-edit-1'))
    .then(() => load('booking-panel-core.js', 'booking-lifecycle-20260918-1'))
    .then(() => {
      restoreBookingHashAndOpen();
      return load('booking-resources.js', 'booking-resource-mount-20260918-1');
    })
    .then(() => load('../booking-technician-delete.js', 'booking-technician-delete-20260917-1'))
    .then(() => load('booking-always-open.js', 'booking-always-open-20260917-2'))
    .then(() => load('booking-cancellation-sync.js', 'booking-cancellation-format-20260918-1'))
    .catch((error) => console.error('booking admin extension load failed', error));
})();