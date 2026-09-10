(() => {
  'use strict';

  if (!window.MemberSystem || typeof window.MemberSystem.subscribeRealtime !== 'function') return;

  const base = window.MemberSystem;
  const originalRequest = typeof base.request === 'function' ? base.request.bind(base) : null;
  const originalSubscribeRealtime = base.subscribeRealtime.bind(base);
  const MIN_RESYNC_INTERVAL_MS = 1500;

  function parseIsoDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
    if (!match) return null;
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    return date.getUTCFullYear() === Number(match[1])
      && date.getUTCMonth() === Number(match[2]) - 1
      && date.getUTCDate() === Number(match[3])
      ? date
      : null;
  }

  function toIsoDate(date) {
    return date.toISOString().slice(0, 10);
  }

  function isManagedEventTicketCalendarItem(item) {
    if (!item || String(item.itemType || '') !== 'event') return false;
    try {
      const url = new URL(String(item.linkUrl || ''), window.location.href);
      return url.searchParams.get('source') === 'event-ticket-calendar'
        && Boolean(String(url.searchParams.get('eventTicketId') || '').trim());
    } catch (_) {
      return false;
    }
  }

  function holidayDateSet(items) {
    const dates = new Set();
    (items || []).forEach((item) => {
      if (!item || String(item.itemType || '') !== 'holiday') return;
      const status = String(item.status || '');
      if (status && status !== 'active') return;
      const start = parseIsoDate(item.startsOn);
      const end = parseIsoDate(item.endsOn || item.startsOn);
      if (!start || !end || end < start) return;
      const current = new Date(start);
      let guard = 0;
      while (current <= end && guard < 370) {
        dates.add(toIsoDate(current));
        current.setUTCDate(current.getUTCDate() + 1);
        guard += 1;
      }
    });
    return dates;
  }

  function splitManagedEventAroundHolidays(item, holidays) {
    if (!isManagedEventTicketCalendarItem(item)) return [item];
    const start = parseIsoDate(item.startsOn);
    const end = parseIsoDate(item.endsOn || item.startsOn);
    if (!start || !end || end < start) return [item];

    const segments = [];
    let segmentStart = '';
    let segmentEnd = '';
    const current = new Date(start);
    let guard = 0;

    const pushSegment = () => {
      if (!segmentStart) return;
      segments.push({
        ...item,
        startsOn: segmentStart,
        endsOn: segmentEnd === segmentStart ? '' : segmentEnd,
        calendarDisplaySourceId: String(item.calendarItemId || '')
      });
      segmentStart = '';
      segmentEnd = '';
    };

    while (current <= end && guard < 370) {
      const date = toIsoDate(current);
      if (holidays.has(date)) {
        pushSegment();
      } else {
        if (!segmentStart) segmentStart = date;
        segmentEnd = date;
      }
      current.setUTCDate(current.getUTCDate() + 1);
      guard += 1;
    }
    pushSegment();
    return segments;
  }

  function applyCalendarHolidayDisplayRules(result) {
    if (!result || typeof result !== 'object' || !Array.isArray(result.items)) return result;
    const holidays = holidayDateSet(result.items);
    if (!holidays.size) return result;
    const items = result.items.flatMap((item) => splitManagedEventAroundHolidays(item, holidays));
    return { ...result, items };
  }

  function request(config, clientType, idToken, action, payload) {
    if (!originalRequest) return Promise.reject(new Error('MemberSystem request unavailable.'));
    return Promise.resolve(originalRequest(config, clientType, idToken, action, payload)).then((result) => (
      clientType === 'calendar' && action === 'user.calendar.bootstrap'
        ? applyCalendarHolidayDisplayRules(result)
        : result
    ));
  }

  function subscribeRealtime(config, clientType, onUpdate) {
    if (typeof onUpdate !== 'function') return originalSubscribeRealtime(config, clientType, onUpdate);

    const unsubscribeRealtime = originalSubscribeRealtime(config, clientType, onUpdate);
    let disposed = false;
    let lastResyncAt = 0;
    let resyncPending = false;

    const resync = () => {
      if (disposed || document.visibilityState === 'hidden' || !navigator.onLine) return;
      const now = Date.now();
      if (resyncPending || now - lastResyncAt < MIN_RESYNC_INTERVAL_MS) return;
      lastResyncAt = now;
      resyncPending = true;
      Promise.resolve(onUpdate()).catch(() => {}).finally(() => { resyncPending = false; });
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') resync();
    };
    const onPageShow = () => resync();
    const onOnline = () => resync();

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('online', onOnline);

    return () => {
      if (disposed) return;
      disposed = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('online', onOnline);
      if (typeof unsubscribeRealtime === 'function') unsubscribeRealtime();
    };
  }

  window.MemberSystem = Object.freeze({ ...base, request, subscribeRealtime });
})();
