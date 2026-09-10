(() => {
  'use strict';

  if (!window.BookingSystem || typeof window.BookingSystem.memberProfile !== 'function') return;
  if (!window.MembershipProgress || typeof window.MembershipProgress.render !== 'function') return;

  const originalMemberProfile = window.BookingSystem.memberProfile.bind(window.BookingSystem);
  window.BookingSystem.memberProfile = async (...args) => {
    const profile = await originalMemberProfile(...args);
    const membershipProgress = document.getElementById('membershipProgress');
    if (membershipProgress) window.MembershipProgress.render(membershipProgress, profile);
    return profile;
  };
})();
