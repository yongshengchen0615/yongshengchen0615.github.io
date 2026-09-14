(() => {
  'use strict';

  function normalizeBookingNotice() {
    const card = document.querySelector('.booking-card[aria-labelledby="bookingTitle"]');
    if (!card) return;

    const candidates = [...card.children].filter((node) => (
      node instanceof HTMLElement
      && node.classList.contains('service-info')
      && node.getAttribute('role') === 'note'
      && (
        node.id === 'bookingNotice'
        || node.id === 'bookingPublicNotice'
        || node.classList.contains('booking-shop-notice')
        || /預約說明/.test(node.textContent || '')
      )
    ));
    if (!candidates.length) return;

    // On older cached pages calendar-flow.js may append a second
    // "店家預約說明" block. Prefer the original static notice if present.
    const canonical = candidates.find((node) => node.id === 'bookingPublicNotice')
      || candidates.find((node) => !node.classList.contains('booking-shop-notice'))
      || candidates[0];

    for (const node of candidates) {
      if (node !== canonical) node.remove();
    }

    canonical.id = 'bookingNotice';
    canonical.classList.remove('booking-shop-notice');
    const label = canonical.querySelector('strong');
    if (label) label.textContent = '預約說明：';
  }

  function install() {
    normalizeBookingNotice();
    const card = document.querySelector('.booking-card[aria-labelledby="bookingTitle"]');
    if (!card) return;
    const observer = new MutationObserver(() => normalizeBookingNotice());
    observer.observe(card, { childList: true });
    window.addEventListener('pagehide', () => observer.disconnect(), { once: true });
  }

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', install, { once: true });
  } else {
    install();
  }
})();
