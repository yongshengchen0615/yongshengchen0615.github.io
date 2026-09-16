(() => {
  'use strict';

  // Compatibility entrypoint retained by admin/index.html. Load isolated admin extensions here.
  const scripts = [
    './pointcard-redemption-limit.js?v=global-ticket-limit-20260916-2',
    './birthday-benefits.js?v=birthday-benefits-20260916-1',
  ];
  scripts.forEach((src) => {
    const script = document.createElement('script');
    script.src = src;
    script.defer = true;
    document.head.append(script);
  });

  const birthdayStyles = document.createElement('link');
  birthdayStyles.rel = 'stylesheet';
  birthdayStyles.href = './birthday-benefits.css?v=birthday-benefits-20260916-1';
  document.head.append(birthdayStyles);
})();
