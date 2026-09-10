(() => {
  'use strict';

  const TAB_IDS = ['services', 'confirmation'];
  let activeTab = 'services';

  window.addEventListener('DOMContentLoaded', () => {
    const workspace = document.querySelector('.workspace-grid');
    const servicePanel = document.querySelector('.workspace-grid > .panel[aria-labelledby="serviceEditorTitle"]');
    const confirmationPanel = document.querySelector('.workspace-grid > .panel[aria-labelledby="bookingQueueTitle"]');
    if (!workspace || !servicePanel || !confirmationPanel) return;

    servicePanel.id = 'servicePanel';
    confirmationPanel.id = 'confirmationPanel';
    servicePanel.classList.add('booking-tab-panel');
    confirmationPanel.classList.add('booking-tab-panel');
    servicePanel.setAttribute('role', 'tabpanel');
    confirmationPanel.setAttribute('role', 'tabpanel');

    const nav = document.createElement('nav');
    nav.id = 'bookingSubtabs';
    nav.className = 'booking-subtabs';
    nav.setAttribute('role', 'tablist');
    nav.setAttribute('aria-label', '預約管理分類');
    nav.innerHTML = `
      <button id="servicesTab" class="subtab-button" type="button" role="tab" aria-controls="servicePanel" data-admin-tab="services">
        <span>預約項目</span><span id="serviceTabCount" class="subtab-count">0</span>
      </button>
      <button id="confirmationTab" class="subtab-button" type="button" role="tab" aria-controls="confirmationPanel" data-admin-tab="confirmation">
        <span>預約確認</span><span id="confirmationTabCount" class="subtab-count">0</span>
      </button>`;
    workspace.before(nav);

    servicePanel.setAttribute('aria-labelledby', 'servicesTab');
    confirmationPanel.setAttribute('aria-labelledby', 'confirmationTab');

    nav.querySelectorAll('.subtab-button').forEach((button) => {
      button.addEventListener('click', () => setTab(button.dataset.adminTab || 'services'));
    });
    nav.addEventListener('keydown', handleKeydown);

    const initialTab = window.location.hash === '#confirmation' ? 'confirmation' : 'services';
    setTab(initialTab, false);
    updateCounts();

    const countObserver = new MutationObserver(updateCounts);
    ['serviceCount', 'pendingCount'].forEach((id) => {
      const target = document.getElementById(id);
      if (target) countObserver.observe(target, { childList: true, characterData: true, subtree: true });
    });

    document.getElementById('newServiceButton')?.addEventListener('click', () => setTab('services'));
    document.getElementById('serviceList')?.addEventListener('click', () => setTab('services'));
  });

  function setTab(tab, updateHistory = true) {
    const resolved = TAB_IDS.includes(tab) ? tab : 'services';
    activeTab = resolved;
    const isServices = resolved === 'services';
    const servicePanel = document.getElementById('servicePanel');
    const confirmationPanel = document.getElementById('confirmationPanel');
    const servicesTab = document.getElementById('servicesTab');
    const confirmationTab = document.getElementById('confirmationTab');
    if (!servicePanel || !confirmationPanel || !servicesTab || !confirmationTab) return;

    servicePanel.classList.toggle('hidden', !isServices);
    confirmationPanel.classList.toggle('hidden', isServices);
    servicesTab.classList.toggle('active', isServices);
    confirmationTab.classList.toggle('active', !isServices);
    servicesTab.setAttribute('aria-selected', isServices ? 'true' : 'false');
    confirmationTab.setAttribute('aria-selected', isServices ? 'false' : 'true');
    servicesTab.tabIndex = isServices ? 0 : -1;
    confirmationTab.tabIndex = isServices ? -1 : 0;

    if (updateHistory && window.history?.replaceState) {
      const hash = isServices ? '#services' : '#confirmation';
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${hash}`);
    }
  }

  function handleKeydown(event) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const current = Math.max(0, TAB_IDS.indexOf(activeTab));
    let next = current;
    if (event.key === 'ArrowRight') next = (current + 1) % TAB_IDS.length;
    if (event.key === 'ArrowLeft') next = (current - 1 + TAB_IDS.length) % TAB_IDS.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = TAB_IDS.length - 1;
    setTab(TAB_IDS[next]);
    document.getElementById(TAB_IDS[next] === 'services' ? 'servicesTab' : 'confirmationTab')?.focus();
  }

  function updateCounts() {
    const serviceCount = Number(document.getElementById('serviceCount')?.textContent || 0);
    const pendingCount = Number(document.getElementById('pendingCount')?.textContent || 0);
    const serviceTabCount = document.getElementById('serviceTabCount');
    const confirmationTabCount = document.getElementById('confirmationTabCount');
    const confirmationTab = document.getElementById('confirmationTab');
    if (serviceTabCount) serviceTabCount.textContent = String(Number.isFinite(serviceCount) ? serviceCount : 0);
    if (confirmationTabCount) {
      confirmationTabCount.textContent = String(Number.isFinite(pendingCount) ? pendingCount : 0);
      confirmationTabCount.classList.toggle('attention', pendingCount > 0);
    }
    if (confirmationTab) confirmationTab.setAttribute('aria-label', pendingCount > 0 ? `預約確認，${pendingCount} 筆待確認` : '預約確認，目前沒有待確認預約');
  }
})();
