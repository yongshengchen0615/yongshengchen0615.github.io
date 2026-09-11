(() => {
  'use strict';

  if (!window.BookingSystem || typeof window.BookingSystem.memberProfile !== 'function') return;
  if (!window.MembershipProgress || typeof window.MembershipProgress.render !== 'function') return;

  const originalMemberProfile = window.BookingSystem.memberProfile.bind(window.BookingSystem);
  const originalRequest = window.BookingSystem.request.bind(window.BookingSystem);
  let lastProfile = null;
  let renderTimer = null;
  let bookingListObserver = null;

  function membershipRequiredError() {
    if (typeof window.BookingSystem.clientError === 'function') {
      return window.BookingSystem.clientError('MEMBERSHIP_REQUIRED', '請先完成會員加入後再使用預約功能。');
    }
    const error = new Error('請先完成會員加入後再使用預約功能。');
    error.code = 'MEMBERSHIP_REQUIRED';
    return error;
  }

  function showMembershipRequiredView() {
    const loadingView = document.getElementById('loadingView');
    const bookingView = document.getElementById('bookingView');
    const errorView = document.getElementById('errorView');
    const errorTitle = document.getElementById('errorTitle');
    const errorMessage = document.getElementById('errorMessage');
    const joinMemberButton = document.getElementById('joinMemberButton');
    const retryButton = document.getElementById('retryButton');

    if (loadingView) loadingView.classList.add('hidden');
    if (bookingView) bookingView.classList.add('hidden');
    if (errorView) errorView.classList.remove('hidden');
    if (errorTitle) errorTitle.textContent = '請先加入會員';
    if (errorMessage) errorMessage.textContent = '加入會員並完成會員資料後，才能使用預約功能。';
    if (joinMemberButton) joinMemberButton.classList.remove('hidden');
    if (retryButton) retryButton.classList.add('hidden');
  }

  function renderMembershipProgress() {
    const root = document.getElementById('membershipProgress');
    if (!root || !lastProfile) return;
    window.MembershipProgress.render(root, lastProfile);
  }

  function normalizeCompletedServiceLabel(root) {
    if (!root) return;
    const badges = [];
    if (root.nodeType === Node.ELEMENT_NODE && root.matches?.('.status-badge.status-completed')) badges.push(root);
    if (typeof root.querySelectorAll === 'function') badges.push(...root.querySelectorAll('.status-badge.status-completed'));
    badges.forEach((badge) => {
      if (badge.textContent !== '完成服務') badge.textContent = '完成服務';
    });
  }

  function installCompletedServiceCopy() {
    const bookingList = document.getElementById('bookingList');
    if (!bookingList) return;
    normalizeCompletedServiceLabel(bookingList);
    if (bookingListObserver) bookingListObserver.disconnect();
    bookingListObserver = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => normalizeCompletedServiceLabel(node));
      });
    });
    bookingListObserver.observe(bookingList, { childList: true, subtree: true });
  }

  window.BookingSystem.memberProfile = async (...args) => {
    const profile = await originalMemberProfile(...args);
    lastProfile = profile && typeof profile === 'object' ? profile : {};
    if (lastProfile.membershipRequired === true) {
      showMembershipRequiredView();
      throw membershipRequiredError();
    }
    if (renderTimer !== null) window.clearTimeout(renderTimer);
    renderTimer = window.setTimeout(() => {
      renderTimer = null;
      renderMembershipProgress();
    }, 0);
    return profile;
  };

  window.BookingSystem.request = async (...args) => {
    try {
      return await originalRequest(...args);
    } catch (error) {
      if (error && error.code === 'MEMBERSHIP_REQUIRED') showMembershipRequiredView();
      throw error;
    }
  };

  window.addEventListener('DOMContentLoaded', installCompletedServiceCopy);
  window.addEventListener('beforeunload', () => {
    if (bookingListObserver) bookingListObserver.disconnect();
  });
})();
