(() => {
  'use strict';

  if (!window.BookingSystem || typeof window.BookingSystem.memberProfile !== 'function') return;
  if (!window.MembershipProgress || typeof window.MembershipProgress.render !== 'function') return;

  const originalMemberProfile = window.BookingSystem.memberProfile.bind(window.BookingSystem);
  let lastProfile = null;
  let renderTimer = null;

  function renderMembershipProgress() {
    const root = document.getElementById('membershipProgress');
    if (!root || !lastProfile) return;
    window.MembershipProgress.render(root, lastProfile);
  }

  window.BookingSystem.memberProfile = async (...args) => {
    const profile = await originalMemberProfile(...args);
    lastProfile = profile && typeof profile === 'object' ? profile : {};
    if (renderTimer !== null) window.clearTimeout(renderTimer);
    renderTimer = window.setTimeout(() => {
      renderTimer = null;
      renderMembershipProgress();
    }, 0);
    return profile;
  };
})();
