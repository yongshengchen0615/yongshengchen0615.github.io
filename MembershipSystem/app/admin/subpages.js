(function () {
  'use strict';

  const PAGE_NAMES = ['overview', 'members', 'grants', 'tiers', 'usage'];

  function normalizePage(value) {
    const page = String(value || '').trim().toLowerCase();
    return PAGE_NAMES.includes(page) ? page : 'overview';
  }

  function pageFromHash() {
    return normalizePage(window.location.hash.replace(/^#/, ''));
  }

  function showPage(page, updateHash) {
    const targetPage = normalizePage(page);

    document.querySelectorAll('[data-admin-page-panel]').forEach((panel) => {
      panel.classList.toggle('hidden', panel.dataset.adminPagePanel !== targetPage);
    });

    document.querySelectorAll('[data-admin-page]').forEach((button) => {
      const active = button.dataset.adminPage === targetPage;
      button.classList.toggle('is-active', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });

    if (updateHash && window.location.hash !== `#${targetPage}`) {
      window.location.hash = targetPage;
    }
  }

  document.querySelectorAll('[data-admin-page]').forEach((button) => {
    button.addEventListener('click', () => showPage(button.dataset.adminPage, true));
  });

  document.querySelectorAll('[data-admin-page-target]').forEach((button) => {
    button.addEventListener('click', () => showPage(button.dataset.adminPageTarget, true));
  });

  window.addEventListener('hashchange', () => showPage(pageFromHash(), false));

  if (!window.location.hash) {
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#overview`);
  }
  showPage(pageFromHash(), false);
})();
