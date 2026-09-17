(() => {
  'use strict';

  const endpointSuffix = '/functions/v1/fixed-ticket-automation';
  const templateById = new Map();
  const originalFetch = window.fetch.bind(window);

  function isFixedTicketRequest(input) {
    const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input || '');
    return url.includes(endpointSuffix);
  }

  function captureTemplates(payload) {
    const data = payload && payload.data && typeof payload.data === 'object' ? payload.data : {};
    const templates = Array.isArray(data.templates) ? data.templates : data.template ? [data.template] : [];
    for (const template of templates) {
      const id = String(template && template.fixedTicketId || '');
      if (id) templateById.set(id, template);
    }
  }

  function ensureControl() {
    const section = document.getElementById('fixedTicketScheduleFields');
    if (!section) return null;
    let input = document.getElementById('fixedTicketCalendarEnabled');
    if (input) return input;

    const block = document.createElement('div');
    block.className = 'fixed-ticket-inline-actions';

    const label = document.createElement('label');
    label.className = 'fixed-ticket-notify';
    input = document.createElement('input');
    input.id = 'fixedTicketCalendarEnabled';
    input.type = 'checkbox';
    label.append(input, document.createTextNode(' 加入會員日曆'));

    const summary = document.createElement('p');
    summary.id = 'fixedTicketCalendarSummary';
    summary.className = 'fixed-ticket-schedule-summary';
    summary.setAttribute('aria-live', 'polite');

    block.append(label);
    const runActions = section.querySelector('.fixed-ticket-inline-actions');
    if (runActions) runActions.before(block, summary);
    else section.append(block, summary);

    input.addEventListener('change', updateSummary);
    updateSummary();
    return input;
  }

  function updateSummary() {
    const input = ensureControl();
    const summary = document.getElementById('fixedTicketCalendarSummary');
    if (!input || !summary) return;
    if (!input.checked) {
      summary.textContent = '此固定票券不會顯示在會員日曆。';
      return;
    }
    const scheduleType = String(document.getElementById('fixedTicketScheduleType')?.value || 'birthday_month');
    summary.textContent = scheduleType === 'birthday_month'
      ? '會加入會員日曆，但只有生日月份相符的當月壽星看得到；其他會員不會收到這筆日曆資料。'
      : '會依固定票券的每個發放週期自動建立或更新會員日曆項目。';
  }

  function syncSelectedTemplate(fixedTicketId) {
    const input = ensureControl();
    if (!input) return;
    const template = templateById.get(String(fixedTicketId || ''));
    input.checked = Boolean(template && template.calendarEnabled);
    updateSummary();
  }

  function resetControl() {
    const input = ensureControl();
    if (input) input.checked = false;
    updateSummary();
  }

  window.fetch = async function fixedTicketCalendarFetch(input, init) {
    if (!isFixedTicketRequest(input)) return originalFetch(input, init);

    let nextInit = init;
    if (init && typeof init.body === 'string') {
      try {
        const body = JSON.parse(init.body);
        if (body && body.action === 'admin.fixed-tickets.save' && body.template && typeof body.template === 'object') {
          const calendarEnabled = Boolean(ensureControl()?.checked);
          body.template = { ...body.template, calendarEnabled };
          nextInit = { ...init, body: JSON.stringify(body) };
        }
      } catch (_) {}
    }

    const response = await originalFetch(input, nextInit);
    try {
      const payload = await response.clone().json();
      captureTemplates(payload);
    } catch (_) {}
    return response;
  };

  function ready() {
    const form = document.getElementById('eventTicketForm');
    if (!form) return;
    ensureControl();

    new MutationObserver(() => ensureControl()).observe(form, { childList: true, subtree: true });

    document.getElementById('fixedTicketScheduleType')?.addEventListener('change', updateSummary);
    form.addEventListener('change', (event) => {
      if (event.target && event.target.id === 'fixedTicketScheduleType') updateSummary();
    });

    document.getElementById('eventTicketListItems')?.addEventListener('click', (event) => {
      const fixed = event.target instanceof Element ? event.target.closest('[data-fixed-ticket-id]') : null;
      if (!fixed) return;
      const id = String(fixed.getAttribute('data-fixed-ticket-id') || '');
      window.setTimeout(() => syncSelectedTemplate(id), 0);
    });

    document.getElementById('newEventTicketButton')?.addEventListener('click', () => window.setTimeout(resetControl, 0));
    document.getElementById('resetEventTicketButton')?.addEventListener('click', () => window.setTimeout(resetControl, 0));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready, { once: true });
  else ready();
})();
