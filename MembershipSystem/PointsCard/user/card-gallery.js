(function () {
  'use strict';

  const switcher = document.getElementById('cardSwitcher');
  const select = document.getElementById('memberCardSelect');
  if (!switcher || !select) return;

  const originalLabel = switcher.querySelector('label');
  if (originalLabel) originalLabel.classList.add('card-select-fallback');

  const heading = document.createElement('div');
  heading.className = 'member-card-gallery-heading';
  const eyebrow = document.createElement('p');
  eyebrow.className = 'eyebrow';
  eyebrow.textContent = 'MY POINTS CARDS';
  const title = document.createElement('h2');
  title.id = 'memberCardGalleryTitle';
  title.textContent = '我的集點卡';
  heading.append(eyebrow, title);

  const list = document.createElement('div');
  list.id = 'memberCardList';
  list.className = 'member-card-list';
  switcher.setAttribute('aria-labelledby', title.id);
  switcher.append(heading, list);

  let rendering = false;

  function cardStatusFromLabel(label) {
    return String(label || '').indexOf('（已過期）') >= 0 ? 'expired' : 'active';
  }

  function cleanCardName(label) {
    return String(label || '').replace(/（已過期）$/, '').trim() || '集點卡';
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
      list.replaceChildren();
      if (!options.length) {
        setSwitcherHidden(true);
        return;
      }

      setSwitcherHidden(false);
      options.forEach(function (option) {
        const selected = option.value === select.value;
        const status = cardStatusFromLabel(option.textContent);
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'member-card-option ' + status + (selected ? ' selected' : '');
        button.dataset.cardId = option.value;
        button.setAttribute('aria-pressed', selected ? 'true' : 'false');
        button.disabled = select.disabled;

        const top = document.createElement('span');
        top.className = 'member-card-option-top';
        const kicker = document.createElement('small');
        kicker.textContent = status === 'expired' ? 'EXPIRED CARD' : 'POINTS CARD';
        const badge = document.createElement('span');
        badge.className = 'member-card-option-badge';
        badge.textContent = selected ? '目前顯示' : (status === 'expired' ? '已過期' : '查看');
        top.append(kicker, badge);

        const name = document.createElement('strong');
        name.textContent = cleanCardName(option.textContent);
        const hint = document.createElement('span');
        hint.className = 'member-card-option-hint';
        hint.textContent = selected ? '下方顯示這張卡的完整進度與票券' : '點擊切換查看這張卡的進度';
        button.append(top, name, hint);
        button.addEventListener('click', function () { chooseCard(option.value); });
        list.append(button);
      });
    } finally {
      rendering = false;
    }
  }

  select.addEventListener('change', function () { window.setTimeout(render, 0); });
  const selectObserver = new MutationObserver(render);
  selectObserver.observe(select, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
  render();
})();
