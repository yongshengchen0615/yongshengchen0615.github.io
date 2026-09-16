(() => {
  'use strict';

  // Compatibility entrypoint retained by admin/index.html. Load isolated admin extensions here.
  const script = document.createElement('script');
  script.src = './pointcard-redemption-limit.js?v=global-ticket-limit-20260916-2';
  script.defer = true;
  document.head.append(script);
})();
