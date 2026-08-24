(function () {
  'use strict';

  const switcher = document.getElementById('cardSwitcher');
  const select = document.getElementById('memberCardSelect');
  const tabs = document.getElementById('memberCardTabs');
  const workspace = document.getElementById('cardWorkspace');
  if (!switcher || !select || !tabs || !workspace) return;

  let rendering = false;
  let keyboardFocusCardId = '';
  const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function pointLabel(value) {
    const points = Number(value || 0);
    return (Number.isFinite(points) ? points : 0).toLocaleString('zh-TW') + ' 點';
  }

  function chooseCard(cardId) {
    if (!cardId || select.disabled || select.value === cardId) return;
    select.value = cardId;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function setSwitcherHidden(hidden) {
    if (switcher.classList.contains('hidden') === hidden) return;
    switcher.classList.toggle('hidden', hidden);
  }

  function render() {
    if (rendering) return;
    rendering = true;
    try {
      const options = Array.from(select.options).filter(function (option) { return Boolean(option.value); });
      tabs.replaceChildren();
      if (options.length < 2) {
        setSwitcherHidden(true);
        workspace.removeAttribute('aria-labelledby');
        return;
      }

      setSwitcherHidden(false);
      options.forEach(function (option, index) {
        const selected = option.value === select.value;
        const status = option.dataset.status === 'expired' ? 'expired' : (option.dataset.status === 'deleted' ? 'deleted' : 'active');
        const button = document.createElement('button');
        button.type = 'button';
        button.id = 'memberCardTab' + index;
        button.className = 'member-card-tab ' + status + (selected ? ' selected' : '');
        button.dataset.cardId = option.value;
        button.setAttribute('role', 'tab');
        button.setAttribute('aria-selected', selected ? 'true' : 'false');
        button.setAttribute('aria-controls', workspace.id);
        button.tabIndex = selected ? 0 : -1;
        button.disabled = select.disabled;

        const statusDot = document.createElement('span');
        statusDot.className = 'member-card-tab-status';
        statusDot.setAttribute('aria-hidden', 'true');
        const copy = document.createElement('span');
        copy.className = 'member-card-tab-copy';
        const name = document.createElement('strong');
        name.textContent = String(option.dataset.cardName || option.textContent || '集點卡')
          .replace(/（已過期）$/, '').replace(/（已刪除，票券保留）$/, '').trim();
        const meta = document.createElement('small');
        meta.textContent = status === 'expired' ? '已過期 · ' + pointLabel(option.dataset.totalStamps) :
          (status === 'deleted' ? '已刪除 · 票券保留' : pointLabel(option.dataset.totalStamps));
        copy.append(name, meta);
        button.append(statusDot, copy);
        button.addEventListener('click', function () { chooseCard(option.value); });
        tabs.append(button);
        if (selected) workspace.setAttribute('aria-labelledby', button.id);
      });
      if (keyboardFocusCardId && !select.disabled) {
        const focusTarget = Array.from(tabs.children).find(function (tab) { return tab.dataset.cardId === keyboardFocusCardId; });
        keyboardFocusCardId = '';
        if (focusTarget) focusTarget.focus();
      }
    } finally {
      rendering = false;
    }
  }

  tabs.addEventListener('keydown', function (event) {
    const tabButtons = Array.from(tabs.querySelectorAll('[role="tab"]:not(:disabled)'));
    const currentIndex = tabButtons.indexOf(document.activeElement);
    if (currentIndex < 0) return;
    let nextIndex = currentIndex;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabButtons.length;
    else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabButtons.length) % tabButtons.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = tabButtons.length - 1;
    else return;
    event.preventDefault();
    const nextTab = tabButtons[nextIndex];
    keyboardFocusCardId = nextTab.dataset.cardId;
    nextTab.focus();
    nextTab.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'nearest', inline: 'center' });
    chooseCard(nextTab.dataset.cardId);
  });

  select.addEventListener('change', function () { window.setTimeout(render, 0); });
  const selectObserver = new MutationObserver(render);
  selectObserver.observe(select, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
  render();
})();
