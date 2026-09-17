(() => {
  'use strict';

  const SERVICE_ACTIVE_SELECTOR = '#bookingAdminCrudModalBody input[data-field="isActive"]';
  const TECHNICIAN_ACTIVE_SELECTOR = '#bookingAdminTechnicianActive';

  function forceAlwaysOpen(root = document) {
    root.querySelectorAll?.(SERVICE_ACTIVE_SELECTOR).forEach((input) => {
      input.checked = true;
      input.closest('label')?.classList.add('hidden');
    });

    root.querySelectorAll?.(TECHNICIAN_ACTIVE_SELECTOR).forEach((input) => {
      input.checked = true;
      input.closest('label')?.classList.add('hidden');
    });
  }

  document.addEventListener('submit', (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    if (form.closest('#bookingAdminCrudModalBody') || form.id === 'bookingAdminTechnicianForm') {
      forceAlwaysOpen(form);
    }
  }, true);

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach((node) => {
        if (node instanceof Element) forceAlwaysOpen(node);
      });
    }
    forceAlwaysOpen(document);
  });

  const start = () => {
    forceAlwaysOpen(document);
    observer.observe(document.body, { childList: true, subtree: true });
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
