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

  async function requestCalendar(config, idToken, action, payload) {
    const supabaseUrl = String(config && config.supabaseUrl || '').replace(/\/$/, '');
    const publishableKey = String(config && config.supabasePublishableKey || '');
    if (!supabaseUrl || !publishableKey) throw new Error('會員日曆服務設定尚未完成。');

    let response;
    try {
      response = await fetch(`${supabaseUrl}/functions/v1/member-calendar-api`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: publishableKey
        },
        cache: 'no-store',
        body: JSON.stringify({ ...payload, action, clientType: 'calendar', idToken })
      });
    } catch {
      throw new Error('目前無法連線活動日曆服務，請檢查網路後重試。');
    }

    let data;
    try { data = await response.json(); }
    catch { throw new Error('活動日曆服務暫時未正常回應。'); }
    if (!response.ok || !data || data.ok !== true) {
      const error = new Error(String(data && data.error && data.error.message || '活動日曆服務拒絕此請求。'));
      error.code = String(data && data.error && data.error.code || 'API_ERROR');
      error.status = Number(data && data.status || response.status || 0);
      throw error;
    }
    return data.data || {};
  }

  function request(config, clientType, idToken, action, payload = {}) {
    if (clientType === 'calendar' && (action === 'user.calendar.bootstrap' || action === 'user.calendar.date.details')) {
      return requestCalendar(config, idToken, action, payload).then(decorateCalendarPayload);
    }
    return Promise.resolve(originalRequest(config, clientType, idToken, action, payload)).then((result) => {
      if (clientType === 'calendar' && (action === 'user.calendar.bootstrap' || action === 'user.calendar.date.details')) {
        return decorateCalendarPayload(result);
      }
      return result;
    });
  }

  window.MemberSystem = Object.freeze({ ...base, request });
})();
