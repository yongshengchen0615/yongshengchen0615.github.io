(() => {
  'use strict';

  // Compatibility entrypoint retained by admin/index.html. Load isolated admin extensions here.
  const scripts = [
    './pointcard-redemption-limit.js?v=global-ticket-limit-20260916-2',
    './fixed-ticket-admin.js?v=fixed-ticket-20260916-1',
  ];
  scripts.forEach((src) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    document.head.append(script);
  });

  const fixedTicketStyles = document.createElement('link');
  fixedTicketStyles.rel = 'stylesheet';
  fixedTicketStyles.href = './fixed-ticket-admin.css?v=fixed-ticket-20260916-1';
  document.head.append(fixedTicketStyles);
})();
