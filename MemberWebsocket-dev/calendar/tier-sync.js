(() => {
  'use strict';

  if (!window.MemberSystem || typeof window.MemberSystem.request !== 'function') return;

  const base = window.MemberSystem;
  const originalRequest = base.request.bind(base);
  const TIER_KEYS = Object.freeze(['general', 'silver', 'gold', 'platinum']);
  const TIER_LABELS = Object.freeze({
    general: '一般會員',
    silver: '銀級會員',
    gold: '金級會員',
    platinum: '白金會員'
  });

  function normalizedTierKeys(item) {
    const keys = Array.isArray(item && item.allowedTierKeys)
      ? item.allowedTierKeys.filter((key) => TIER_KEYS.includes(String(key)))
      : [];
    return keys.length ? [...new Set(keys.map(String))] : [...TIER_KEYS];
  }

  function decorateCalendarPayload(result) {
    if (!result || typeof result !== 'object') return result;
    const profile = result.profile && typeof result.profile === 'object' ? result.profile : {};
    const memberTierKey = String(profile.tierKey || 'general');
    if (!Array.isArray(result.items)) return result;

    return {
      ...result,
      items: result.items.map((item) => {
        if (!item || typeof item !== 'object' || item.itemType !== 'event') return item;
        const allowedTierKeys = normalizedTierKeys(item);
        return {
          ...item,
          allowedTierKeys,
          allowedTierLabels: allowedTierKeys.map((key) => TIER_LABELS[key]).filter(Boolean),
          tierEligible: allowedTierKeys.includes(memberTierKey)
        };
      })
    };
  }

  function request(config, clientType, idToken, action, payload = {}) {
    return Promise.resolve(originalRequest(config, clientType, idToken, action, payload)).then((result) => {
      if (clientType === 'calendar' && (action === 'user.calendar.bootstrap' || action === 'user.calendar.date.details')) {
        return decorateCalendarPayload(result);
      }
      return result;
    });
  }

  window.MemberSystem = Object.freeze({ ...base, request });
})();
