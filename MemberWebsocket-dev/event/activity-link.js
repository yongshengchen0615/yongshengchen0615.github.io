(() => {
  'use strict';

  if (!window.MemberSystem || typeof window.MemberSystem.request !== 'function') return;

  const base = window.MemberSystem;
  const originalRequest = base.request.bind(base);
  let autoOpenHandled = false;

  function fixedEventTicketId(offer) {
    return String(
      offer?.ticket?.eventTicketId ||
      offer?.claim?.eventTicketId ||
      offer?.eventTicketId ||
      ''
    ).trim();
  }

  function isFixedOffer(offer) {
    return fixedEventTicketId(offer).startsWith('FIXED-');
  }

  function keepAutoIssuedFixedOffers(result) {
    if (!result || !Array.isArray(result.offers)) return result;
    return {
      ...result,
      offers: result.offers.filter((offer) => !isFixedOffer(offer) || Boolean(offer && offer.claim)),
    };
  }

  function request(config, clientType, idToken, action, payload = {}) {
    const promise = Promise.resolve(originalRequest(config, clientType, idToken, action, payload));
    if (clientType === 'event' && action === 'user.event.bootstrap') {
      return promise.then((result) => {
        const filtered = keepAutoIssuedFixedOffers(result);
        window.setTimeout(() => {
          decorateFixedTickets();
          autoOpenFromCalendar();
        }, 0);
        return filtered;
      });
    }
    if (clientType === 'event' && action === 'user.event.ticket.detail') {
      return promise.then((result) => {
        window.setTimeout(() => {
          decorateFixedTickets();
          autoOpenFromCalendar();
        }, 0);
        return result;
      });
    }
    return promise;
  }

  window.MemberSystem = Object.freeze({ ...base, request });

  function findTicketButton(eventTicketId) {
    return Array.from(document.querySelectorAll('[data-event-ticket-id]')).find((element) =>
      String(element.dataset.eventTicketId || '') === String(eventTicketId || '') && !element.disabled
    ) || null;
  }

  function decorateFixedTickets() {
    document.querySelectorAll('[data-event-ticket-id^="FIXED-"]').forEach((button) => {
      const card = button.closest('.event-ticket');
      if (!card) return;
      const type = card.querySelector('.event-ticket-type');
      if (type) type.textContent = '固定票券';

      const metaRows = Array.from(card.querySelectorAll('.event-ticket-meta > span'));
      const claimMethod = metaRows.find((row) => String(row.querySelector('strong')?.textContent || '').includes('領取方式'));
      if (claimMethod) {
        const strong = claimMethod.querySelector('strong');
        claimMethod.replaceChildren();
        const label = strong || document.createElement('strong');
        label.textContent = '發放方式';
        claimMethod.append(label, document.createTextNode('　系統自動發放'));
      }

      if (button instanceof HTMLElement && button.dataset.fixedTicketDecorated !== 'true') {
        button.dataset.fixedTicketDecorated = 'true';
        button.addEventListener('click', () => {
          window.setTimeout(() => {
            const modalType = document.getElementById('ticketModalType');
            if (modalType) modalType.textContent = '固定票券';
          }, 0);
        });
      }
    });
  }

  function autoOpenFromCalendar() {
    if (autoOpenHandled) return;
    let params;
    try { params = new URLSearchParams(window.location.search); }
    catch (_) { return; }
    if (params.get('source') !== 'event-ticket-calendar') return;
    const eventTicketId = String(params.get('eventTicketId') || '').trim();
    if (!eventTicketId) return;
    const button = findTicketButton(eventTicketId);
    if (!button) return;
    autoOpenHandled = true;
    button.click();
  }

  window.addEventListener('DOMContentLoaded', () => {
    window.setTimeout(() => {
      decorateFixedTickets();
      autoOpenFromCalendar();
    }, 0);
  });
})();
