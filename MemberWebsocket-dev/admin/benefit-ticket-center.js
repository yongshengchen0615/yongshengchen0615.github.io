(() => {
  'use strict';

  const FILTERS = new Set(['all', 'claim', 'automatic']);
  let activeFilter = 'all';
  let listObserver = null;

  function ready(callback) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', callback, { once: true });
    else callback();
  }

  ready(() => {
    const panel = document.getElementById('eventsPanel');
    const list = document.getElementById('eventTicketListItems');
    const filters = document.getElementById('benefitTicketFilters');
    const type = document.getElementById('eventTicketType');
    const newButton = document.getElementById('newEventTicketButton');
    const audience = document.getElementById('eventTicketAllowedTiers');
    if (!panel || !list || !filters || !type || !newButton || !audience) return;

    enhanceListHeading(list);
    enhanceAudienceSelector(audience);
    enhanceTypeField(type);
    ensureFilteredEmptyState(list);

    filters.addEventListener('click', handleFilterClick);
    panel.querySelector('.benefit-center-create-actions')?.addEventListener('click', (event) => {
      const button = event.target instanceof Element ? event.target.closest('[data-benefit-create]') : null;
      if (!button) return;
      createBenefit(String(button.dataset.benefitCreate || 'coupon'));
    });

    type.addEventListener('change', () => {
      updateTypeHint(type);
      updateAudienceContext(type, audience);
    });

    list.addEventListener('click', () => window.setTimeout(() => {
      updateTypeHint(type);
      updateAudienceContext(type, audience);
    }, 0));

    listObserver = new MutationObserver(() => applyFilter());
    listObserver.observe(list, { childList: true });
    applyFilter();
    updateTypeHint(type);
    updateAudienceContext(type, audience);
  });

  function enhanceListHeading(list) {
    const heading = list.closest('.card-list')?.querySelector('.list-heading span:first-child');
    if (heading) heading.textContent = '票券清單';
  }

  function enhanceAudienceSelector(fieldset) {
    if (fieldset.querySelector('.benefit-audience-actions')) return;
    const actions = document.createElement('div');
    actions.className = 'benefit-audience-actions';

    const label = document.createElement('span');
    label.textContent = '快速選擇';

    const all = document.createElement('button');
    all.type = 'button';
    all.className = 'text-button';
    all.textContent = '全部等級';
    all.dataset.audienceAction = 'all';

    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'text-button';
    clear.textContent = '清除';
    clear.dataset.audienceAction = 'clear';

    actions.append(label, all, clear);
    const options = fieldset.querySelector('.event-ticket-tier-options');
    if (options) fieldset.insertBefore(actions, options);
    else fieldset.append(actions);

    actions.addEventListener('click', (event) => {
      const button = event.target instanceof Element ? event.target.closest('[data-audience-action]') : null;
      if (!button) return;
      const checked = button.dataset.audienceAction === 'all';
      fieldset.querySelectorAll('input[name="eventTicketAllowedTierKey"]').forEach((input) => {
        input.checked = checked;
      });
      fieldset.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  function enhanceTypeField(type) {
    const label = type.closest('label');
    if (!label) return;
    for (const node of label.childNodes) {
      if (node.nodeType === Node.TEXT_NODE && String(node.textContent || '').includes('票券類型')) {
        node.textContent = '發放模式 / 票券類型';
        break;
      }
    }
    if (!document.getElementById('benefitTicketModeHint')) {
      const hint = document.createElement('small');
      hint.id = 'benefitTicketModeHint';
      hint.className = 'field-help benefit-ticket-mode-hint';
      hint.setAttribute('aria-live', 'polite');
      label.append(hint);
    }
  }

  function updateTypeHint(type) {
    const hint = document.getElementById('benefitTicketModeHint');
    if (!hint) return;
    if (type.value === 'fixed') {
      hint.textContent = '自動發放：系統依設定週期直接把票券發到符合條件的會員帳戶。';
      hint.dataset.mode = 'automatic';
      return;
    }
    if (type.value === 'lottery') {
      hint.textContent = '活動領取：會員自行領取抽獎券，每位會員限領一張。';
      hint.dataset.mode = 'claim';
      return;
    }
    hint.textContent = '活動領取：會員自行領取優惠券，每位會員限領一張。';
    hint.dataset.mode = 'claim';
  }

  function updateAudienceContext(type, fieldset) {
    const description = fieldset.querySelector('p');
    if (!description) return;
    description.textContent = type.value === 'fixed'
      ? '符合所選會員等級的會員，會依固定週期由系統自動收到這張票券。'
      : '只有所選會員等級可以領取並使用這張活動票券。';
  }

  function createBenefit(mode) {
    const type = document.getElementById('eventTicketType');
    const newButton = document.getElementById('newEventTicketButton');
    if (!type || !newButton) return;
    const next = ['coupon', 'lottery', 'fixed'].includes(mode) ? mode : 'coupon';
    newButton.click();
    window.setTimeout(() => {
      type.value = next;
      type.dispatchEvent(new Event('change', { bubbles: true }));
      updateTypeHint(type);
      const title = document.getElementById('eventTicketTitle');
      if (title instanceof HTMLElement) {
        try { title.focus({ preventScroll: true }); } catch (_) { title.focus(); }
      }
    }, 0);
  }

  function handleFilterClick(event) {
    const button = event.target instanceof Element ? event.target.closest('[data-benefit-filter]') : null;
    if (!button) return;
    const filter = String(button.dataset.benefitFilter || 'all');
    if (!FILTERS.has(filter)) return;
    activeFilter = filter;
    document.querySelectorAll('[data-benefit-filter]').forEach((item) => {
      const selected = item.dataset.benefitFilter === activeFilter;
      item.classList.toggle('active', selected);
      item.setAttribute('aria-selected', selected ? 'true' : 'false');
    });
    applyFilter();
  }

  function classifyTicketNode(node) {
    if (!(node instanceof Element)) return '';
    if (node.matches('[data-fixed-ticket-id]')) return 'automatic';
    if (node.matches('[data-event-ticket-id]')) return 'claim';
    return '';
  }

  function applyFilter() {
    const list = document.getElementById('eventTicketListItems');
    if (!list) return;
    const nodes = Array.from(list.children).filter((node) => classifyTicketNode(node));
    let claim = 0;
    let automatic = 0;
    let visible = 0;

    nodes.forEach((node) => {
      const category = classifyTicketNode(node);
      if (category === 'claim') claim += 1;
      if (category === 'automatic') automatic += 1;
      const show = activeFilter === 'all' || activeFilter === category;
      node.classList.toggle('benefit-ticket-filtered-out', !show);
      node.setAttribute('aria-hidden', show ? 'false' : 'true');
      if (show) visible += 1;
    });

    const total = claim + automatic;
    updateCount('all', total);
    updateCount('claim', claim);
    updateCount('automatic', automatic);

    const resultCount = document.getElementById('eventTicketResultCount');
    if (resultCount) resultCount.textContent = activeFilter === 'all' ? String(total) : `${visible} / ${total}`;

    const standardEmpty = document.getElementById('eventTicketEmptyState');
    if (standardEmpty) standardEmpty.classList.toggle('hidden', total !== 0);

    const filteredEmpty = document.getElementById('benefitTicketFilterEmpty');
    if (filteredEmpty) {
      filteredEmpty.classList.toggle('hidden', total === 0 || visible !== 0);
      const label = activeFilter === 'automatic' ? '自動發放' : '活動領取';
      const text = filteredEmpty.querySelector('p');
      if (text) text.textContent = `目前沒有${label}票券。`;
    }
  }

  function updateCount(filter, value) {
    const target = document.querySelector(`[data-benefit-count="${filter}"]`);
    if (target) target.textContent = String(value);
  }

  function ensureFilteredEmptyState(list) {
    if (document.getElementById('benefitTicketFilterEmpty')) return;
    const empty = document.createElement('div');
    empty.id = 'benefitTicketFilterEmpty';
    empty.className = 'empty-state compact benefit-filter-empty hidden';
    const icon = document.createElement('span');
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '○';
    const text = document.createElement('p');
    text.textContent = '目前沒有符合條件的票券。';
    empty.append(icon, text);
    list.after(empty);
  }
})();
