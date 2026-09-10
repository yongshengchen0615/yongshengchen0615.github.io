(() => {
  'use strict';

  if (!window.MemberSystem || typeof window.MemberSystem.request !== 'function') return;

  const base = window.MemberSystem;
  const originalRequest = base.request.bind(base);
  const activityLinks = new Map();
  const activityLinkNames = new Map();
  let selectedEventTicketId = '';
  let autoOpenHandled = false;

  function endpoint(config) {
    const baseUrl = String(config && config.supabaseUrl || '').trim();
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(baseUrl)) throw new Error('Supabase URL 設定不正確。');
    return `${baseUrl}/functions/v1/event-ticket-links`;
  }

  function safeActivityUrl(value) {
    const raw = String(value || '').trim();
    if (!raw || raw.length > 2048 || /\s/.test(raw)) return '';
    try {
      const url = new URL(raw);
      if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return '';
      return url.toString();
    } catch (_) {
      return '';
    }
  }

  function safeActivityLinkName(value) {
    const raw = String(value || '').trim();
    if (raw.length > 120 || /[\u0000-\u001F\u007F]/.test(raw)) return '';
    return raw;
  }

  async function linkRequest(config, idToken, eventTicketIds) {
    if (!eventTicketIds.length) return { activityLinks: {}, activityLinkNames: {} };
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = window.setTimeout(() => controller?.abort(), 20000);
    try {
      const response = await fetch(endpoint(config), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': String(config && config.supabasePublishableKey || '')
        },
        cache: 'no-store',
        signal: controller ? controller.signal : undefined,
        body: JSON.stringify({
          action: 'user.event-ticket-links.list',
          clientType: 'event',
          idToken,
          eventTicketIds
        })
      });
      const data = await response.json();
      if (!response.ok || !data || data.ok !== true) return { activityLinks: {}, activityLinkNames: {} };
      return {
        activityLinks: data.data && typeof data.data.activityLinks === 'object' ? data.data.activityLinks : {},
        activityLinkNames: data.data && typeof data.data.activityLinkNames === 'object' ? data.data.activityLinkNames : {}
      };
    } catch (_) {
      return { activityLinks: {}, activityLinkNames: {} };
    } finally {
      window.clearTimeout(timer);
    }
  }

  function ticketIdFromOffer(offer) {
    return String(offer && (offer.ticket && offer.ticket.eventTicketId || offer.claim && offer.claim.eventTicketId) || '').trim();
  }

  function collectTicketIds(result) {
    const rows = []
      .concat(Array.isArray(result && result.offers) ? result.offers : [])
      .concat(Array.isArray(result && result.usedTickets) ? result.usedTickets : []);
    return [...new Set(rows.map(ticketIdFromOffer).filter(Boolean))].slice(0, 100);
  }

  function mergeLinksIntoResult(result) {
    if (!result || typeof result !== 'object') return result;
    const rows = []
      .concat(Array.isArray(result.offers) ? result.offers : [])
      .concat(Array.isArray(result.usedTickets) ? result.usedTickets : []);
    rows.forEach((offer) => {
      const eventTicketId = ticketIdFromOffer(offer);
      if (!offer || !offer.ticket || !eventTicketId) return;
      offer.ticket.activityUrl = String(activityLinks.get(eventTicketId) || '');
      offer.ticket.activityLinkName = String(activityLinkNames.get(eventTicketId) || '');
    });
    if (result.offer && result.offer.ticket) {
      const eventTicketId = ticketIdFromOffer(result.offer);
      if (eventTicketId) {
        result.offer.ticket.activityUrl = String(activityLinks.get(eventTicketId) || '');
        result.offer.ticket.activityLinkName = String(activityLinkNames.get(eventTicketId) || '');
      }
    }
    return result;
  }

  async function enrichEventResult(config, idToken, result) {
    const ids = collectTicketIds(result);
    if (result && result.offer) {
      const id = ticketIdFromOffer(result.offer);
      if (id && !ids.includes(id)) ids.push(id);
    }
    const payload = await linkRequest(config, idToken, ids);
    Object.entries(payload.activityLinks).forEach(([id, url]) => activityLinks.set(String(id), safeActivityUrl(url)));
    Object.entries(payload.activityLinkNames).forEach(([id, name]) => activityLinkNames.set(String(id), safeActivityLinkName(name)));
    mergeLinksIntoResult(result);
    window.setTimeout(() => {
      syncModalActivityLink();
      autoOpenFromCalendar();
    }, 0);
    return result;
  }

  function request(config, clientType, idToken, action, payload = {}) {
    const promise = Promise.resolve(originalRequest(config, clientType, idToken, action, payload));
    if (clientType === 'event' && (action === 'user.event.bootstrap' || action === 'user.event.ticket.detail')) {
      return promise.then((result) => enrichEventResult(config, idToken, result));
    }
    return promise;
  }

  window.MemberSystem = Object.freeze({ ...base, request });

  function ensureModalActivityLink() {
    let link = document.getElementById('ticketModalActivityLink');
    if (link) return link;
    const action = document.getElementById('ticketModalAction');
    if (!action || !action.parentElement) return null;
    link = document.createElement('a');
    link.id = 'ticketModalActivityLink';
    link.className = 'modal-action activity-link-button hidden';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = '前往活動連結';
    action.insertAdjacentElement('beforebegin', link);

    if (!document.getElementById('eventTicketActivityLinkStyle')) {
      const style = document.createElement('style');
      style.id = 'eventTicketActivityLinkStyle';
      style.textContent = '.activity-link-button{display:block;text-align:center;text-decoration:none}.activity-link-button.hidden{display:none!important}';
      document.head.append(style);
    }
    return link;
  }

  function syncModalActivityLink() {
    const link = ensureModalActivityLink();
    if (!link) return;
    const url = safeActivityUrl(activityLinks.get(selectedEventTicketId));
    if (!selectedEventTicketId || !url) {
      link.removeAttribute('href');
      link.removeAttribute('title');
      link.removeAttribute('aria-label');
      link.classList.add('hidden');
      return;
    }
    const name = safeActivityLinkName(activityLinkNames.get(selectedEventTicketId));
    link.href = url;
    link.textContent = '前往活動連結';
    link.title = name || '活動連結';
    link.setAttribute('aria-label', name ? `開啟活動連結：${name}` : '開啟活動連結');
    link.classList.remove('hidden');
  }

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

  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target.closest('[data-event-ticket-id]') : null;
    if (!target) return;
    selectedEventTicketId = String(target.dataset.eventTicketId || '').trim();
    window.setTimeout(syncModalActivityLink, 0);
  }, true);

  window.addEventListener('DOMContentLoaded', () => {
    ensureModalActivityLink();
    syncModalActivityLink();
    window.setTimeout(autoOpenFromCalendar, 0);
  });
})();
