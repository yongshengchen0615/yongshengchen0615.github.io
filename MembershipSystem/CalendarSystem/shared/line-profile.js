(() => {
  'use strict';

  const RETRY_DELAY_MS = 250;
  const MAX_READY_CHECKS = 40;

  window.addEventListener('DOMContentLoaded', () => {
    // app.js is loaded before this shared script, so its DOMContentLoaded handler
    // binds first. Keep the hidden compatibility node through that binding, then
    // remove the user-facing logout control without affecting auth-recovery logic.
    const logoutButton = document.getElementById('logoutButton');
    if (logoutButton) logoutButton.remove();

    const avatar = document.getElementById('profileAvatar');
    const fallback = document.getElementById('profileAvatarFallback');
    if (!avatar || !fallback) return;

    let readyChecks = 0;
    let settled = false;

    const showFallback = () => {
      avatar.hidden = true;
      avatar.removeAttribute('src');
      fallback.hidden = false;
    };

    const showAvatar = (pictureUrl) => {
      const safeUrl = safeHttpsImageUrl(pictureUrl);
      if (!safeUrl) {
        showFallback();
        return;
      }

      avatar.onload = () => {
        avatar.hidden = false;
        fallback.hidden = true;
      };
      avatar.onerror = showFallback;
      avatar.src = safeUrl;
    };

    const loadProfile = async () => {
      if (settled) return;

      let loggedIn = false;
      try {
        loggedIn = Boolean(
          window.liff &&
          typeof window.liff.isLoggedIn === 'function' &&
          window.liff.isLoggedIn()
        );
      } catch (_) {
        loggedIn = false;
      }

      if (!loggedIn) {
        readyChecks += 1;
        if (readyChecks < MAX_READY_CHECKS) {
          window.setTimeout(loadProfile, RETRY_DELAY_MS);
        }
        return;
      }

      settled = true;
      try {
        const profile = await window.liff.getProfile();
        showAvatar(profile && profile.pictureUrl);
      } catch (_) {
        showFallback();
      }
    };

    loadProfile();
  });

  function safeHttpsImageUrl(value) {
    if (typeof value !== 'string' || value.length === 0 || value.length > 2048) return '';
    try {
      const url = new URL(value);
      return url.protocol === 'https:' ? url.href : '';
    } catch (_) {
      return '';
    }
  }
})();
