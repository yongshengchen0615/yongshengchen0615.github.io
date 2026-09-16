(() => {
  'use strict';

  // Compatibility entrypoint retained by admin/index.html. Load isolated admin extensions here.
  const script = document.createElement('script');
  script.src = './pointcard-redemption-limit.js?v=20260916-1';
  script.defer = true;
  document.head.append(script);
})();
