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

  loadSharedResponsive();
  loadStyle('booking-panel-responsive.css', 'booking-panel-responsive-20260915-mobile-field-overflow-1');
  loadStyle('booking-summary.css', 'booking-summary-20260912-6');
  loadStyle('ui-polish.css', 'admin-ui-20260916-1');
  loadStyle('ui-polish-responsive.css', 'admin-ui-responsive-20260916-1');
  loadStyle('ui-workflow-polish.css', 'admin-module-workflows-20260916-1');

  document.addEventListener('click', (event) => {
    if (!window.matchMedia('(max-width: 768px)').matches) return;
    const button = event.target?.closest?.('#bookingPanel .booking-admin-filter-button');
    if (!button) return;
    window.requestAnimationFrame(() => {
      try { button.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' }); } catch (_) {}
    });
  });

  const mobileEditorTriggers = [
    '#newCardButton',
    '#newTicketButton',
    '#newEventTicketButton',
    '#newCalendarItemButton',
    '#cardListItems .card-list-item',
    '#ticketListItems .card-list-item',
    '#eventTicketListItems .card-list-item',
    '#calendarItemListItems .card-list-item',
  ].join(',');

  const resolveMobileEditor = (trigger) => {
    if (!trigger) return null;
    if (trigger.matches('#newTicketButton') || trigger.closest('#ticketListItems')) {
      return document.querySelector('#ticketSettingsPanel .editor');
    }
    if (trigger.matches('#newCardButton') || trigger.closest('#cardListItems')) {
      return document.querySelector('#cardSettingsPanel .editor');
    }
    if (trigger.matches('#newEventTicketButton') || trigger.closest('#eventTicketListItems')) {
      return document.querySelector('#eventsPanel .editor');
    }
    if (trigger.matches('#newCalendarItemButton') || trigger.closest('#calendarItemListItems')) {
      return document.querySelector('#calendarPanel .editor');
    }
    return null;
  };

  document.addEventListener('click', (event) => {
    if (!window.matchMedia('(max-width: 760px)').matches) return;
    const trigger = event.target?.closest?.(mobileEditorTriggers);
    if (!trigger) return;
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const editor = resolveMobileEditor(trigger);
        if (!editor || editor.classList.contains('hidden')) return;
        const rect = editor.getBoundingClientRect();
        if (rect.top >= 64 && rect.top <= window.innerHeight * .45) return;
        try { editor.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (_) {}
      });
    });
  });

  load('booking-summary.js', 'booking-summary-20260912-6')
    .then(() => load('booking-panel-core.js', 'booking-panel-core-20260911-1'))
    .then(() => load('booking-cancellation-sync.js', 'booking-cancellation-sync-20260911-2'))
    .catch((error) => console.error('booking admin extension load failed', error));
})();