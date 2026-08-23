(function () {
  'use strict';

  const tabs = Array.from(document.querySelectorAll('[data-ticket-tab]'));
  const earnedTab = document.getElementById('earnedTicketsTab');
  const upcomingTab = document.getElementById('upcomingTicketsTab');
  const earnedPanel = document.getElementById('earnedTicketGroup');
  const upcomingPanel = document.getElementById('upcomingTicketGroup');

  if (!tabs.length || !earnedTab || !upcomingTab || !earnedPanel || !upcomingPanel) return;

  function upcomingAvailable() {
    return !upcomingPanel.classList.contains('hidden');
  }

  function activate(tab, moveFocus) {
    if (!tab || (tab === upcomingTab && !upcomingAvailable())) tab = earnedTab;

    tabs.forEach(function (candidate) {
      const selected = candidate === tab;
      candidate.setAttribute('aria-selected', selected ? 'true' : 'false');
      candidate.tabIndex = selected ? 0 : -1;
    });

    earnedPanel.hidden = tab !== earnedTab;
    upcomingPanel.hidden = tab !== upcomingTab;

    if (moveFocus) tab.focus();
  }

  function syncAvailability() {
    const available = upcomingAvailable();
    upcomingTab.setAttribute('aria-disabled', available ? 'false' : 'true');
    if (!available && upcomingTab.getAttribute('aria-selected') === 'true') activate(earnedTab, false);
  }

  tabs.forEach(function (tab, index) {
    tab.addEventListener('click', function () {
      if (tab.getAttribute('aria-disabled') === 'true') return;
      activate(tab, false);
    });

    tab.addEventListener('keydown', function (event) {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const enabled = tabs.filter(function (candidate) { return candidate.getAttribute('aria-disabled') !== 'true'; });
      if (!enabled.length) return;
      let target = tab;
      if (event.key === 'Home') target = enabled[0];
      else if (event.key === 'End') target = enabled[enabled.length - 1];
      else {
        const currentIndex = enabled.indexOf(tab);
        const direction = event.key === 'ArrowRight' ? 1 : -1;
        target = enabled[(currentIndex + direction + enabled.length) % enabled.length];
      }
      activate(target, true);
    });
  });

  const observer = new MutationObserver(syncAvailability);
  observer.observe(upcomingPanel, { attributes: true, attributeFilter: ['class'] });

  syncAvailability();
  activate(earnedTab, false);
})();
