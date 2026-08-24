(() => {
  'use strict';
  const entry = document.body.dataset.entry === 'admin' ? 'admin' : 'user';
  window.location.replace(`./${entry}/`);
})();

