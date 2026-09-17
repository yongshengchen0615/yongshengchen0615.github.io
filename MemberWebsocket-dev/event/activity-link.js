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

  function monthFromDate(value) {
    const match = String(value || '').match(/^\d{4}-(\d{2})-\d{2}$/);
    return match ? Number(match[1]) : 0;
  }

  function birthdayMonth(profile) {
    return monthFromDate(profile && profile.birthday);
  }

  function isBirthdayFixedOffer(offer) {
    return fixedEventTicketId(offer).includes('-birthday-month-');
  }

  function fixedOfferVisibleForMember(offer, profile) {
    if (!isBirthdayFixedOffer(offer)) return true;
    const memberMonth = birthdayMonth(profile);
    const eventMonth = monthFromDate(offer?.ticket?.startsOn);
    return memberMonth > 0 && eventMonth > 0 && memberMonth === eventMonth;
  }

  function normalizeFixedOffers(result) {
    if (!result || !Array.isArray(result.offers)) return result;
    const profile = result.profile && typeof result.profile === 'object' ? result.profile : {};
    return {
      ...result,
      offers: result.offers
        .filter((offer) => !isFixedOffer(offer) || fixedOfferVisibleForMember(offer, profile))
        .map((offer) => {
          if (!isFixedOffer(offer) || offer?.claim) return offer;
          return {
            ...offer,
            canClaim: false,
            canUse: false,
            fixedAutoIssuePending: true,
          };
        }),
    };
  }

  function request(config, clientType, idToken, action, payload = {}) {
    const promise = Promise.resolve(originalRequest(config, clientType, idToken, action, payload));
    if (clientType === 'event' && action === 'user.event.bootstrap') {
      return promise.then((result) => {
        const normalized = normalizeFixedOffers(result);
        window.setTimeout(() => {
          decorateFixedTickets();
          autoOpenFromCalendar();
        }, 0);
        return normalized;
      });
    }
    if (clientType === 'event' && action === 'user.event.ticket.detail') {
      return promise.then((result) => {
        const normalized = result && result.offer
          ? { ...result, offer: normalizeFixedOffers({ profile: result.profile || {}, offers: [result.offer] }).offers[0] || result.offer }
          : result;
        window.setTimeout(() => {
          decorateFixedTickets();
          autoOpenFromCalendar();
        }, 0);
        return normalized;
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

      const stateBadge = card.querySelector('.event-ticket-state');
      const hint = card.querySelector('.event-ticket-action small');
      const isTierLocked = stateBadge?.classList.contains('tier-locked') || String(stateBadge?.textContent || '').includes('等級不適用');
      const buttonText = String(button.textContent || '').trim();
      const hasClaimAction = ['查看並使用', '已使用'].includes(buttonText);
      if (!isTierLocked && !hasClaimAction && buttonText === '查看詳情') {
        if (stateBadge) stateBadge.textContent = '尚未取得';
        if (hint) hint.textContent = '符合固定發放條件時會由系統自動發放';
      }

      if (button instanceof HTMLElement && button.dataset.fixedTicketDecorated !== 'true') {
        button.dataset.fixedTicketDecorated = 'true';
        button.addEventListener('click', () => {
          window.setTimeout(() => {
            const modalType = document.getElementById('ticketModalType');
            if (modalType) modalType.textContent = '固定票券';

            const modalAction = document.getElementById('ticketModalAction');
            const modalStatus = document.getElementById('ticketModalStatus');
            const tierLockedNow = String(modalAction?.textContent || '').includes('等級無法使用');
            if (!tierLockedNow && modalAction && !modalAction.disabled) return;
            if (!tierLockedNow && modalAction && String(modalAction.textContent || '').includes('目前無法領取')) {
              modalAction.textContent = '由系統自動發放';
              modalAction.disabled = true;
              if (modalStatus) modalStatus.textContent = '符合固定票券的發放條件後，系統會自動發到你的會員帳戶，不需要手動領取。';
            }
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
