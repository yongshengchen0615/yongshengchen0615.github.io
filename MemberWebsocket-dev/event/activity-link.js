(() => {
  'use strict';

  if (!window.MemberSystem || typeof window.MemberSystem.request !== 'function') return;

  const base = window.MemberSystem;
  const originalRequest = base.request.bind(base);
  let autoOpenHandled = false;

  function request(config, clientType, idToken, action, payload = {}) {
    const promise = Promise.resolve(originalRequest(config, clientType, idToken, action, payload));
    if (clientType === 'event' && (action === 'user.event.bootstrap' || action === 'user.event.ticket.detail')) {
      return promise.then((result) => {
        window.setTimeout(autoOpenFromCalendar, 0);
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
    window.setTimeout(autoOpenFromCalendar, 0);
  });
})();
