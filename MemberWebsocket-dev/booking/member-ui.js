(() => {
  'use strict';

  if (!window.BookingSystem || typeof window.BookingSystem.memberProfile !== 'function') return;
  if (!window.MembershipProgress || typeof window.MembershipProgress.render !== 'function') return;

  const originalMemberProfile = window.BookingSystem.memberProfile.bind(window.BookingSystem);
  const originalRequest = window.BookingSystem.request.bind(window.BookingSystem);
  const BOOKING_GROUPS = [
    { key: 'reserved', title: '已預約服務', description: '等待確認與已確認的預約服務。' },
    { key: 'completed', title: '已完成的服務', description: '已由管理端確認完成的服務紀錄。' },
    { key: 'cancelled', title: '已取消的服務', description: '已取消或未通過的預約服務。' },
  ];
  let lastProfile = null;
  let renderTimer = null;
  let bookingListObserver = null;
  let bookingHistoryTimer = null;
  let reorganizingBookingHistory = false;

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

  function bookingGroupKey(item) {
    if (item.classList.contains('status-completed')) return 'completed';
    if (item.classList.contains('status-cancelled') || item.classList.contains('status-rejected')) return 'cancelled';
    return 'reserved';
  }

  function createBookingGroup(group, items) {
    const section = document.createElement('section');
    section.className = `booking-service-group booking-service-group-${group.key}`;
    section.dataset.bookingServiceGroup = group.key;
    section.setAttribute('aria-labelledby', `bookingServiceGroupTitle-${group.key}`);

    const heading = document.createElement('div');
    heading.className = 'booking-service-group-heading';
    const text = document.createElement('div');
    const title = document.createElement('h3');
    title.id = `bookingServiceGroupTitle-${group.key}`;
    title.textContent = group.title;
    const description = document.createElement('p');
    description.textContent = group.description;
    const count = document.createElement('span');
    count.className = 'booking-service-group-count';
    count.textContent = `${items.length} 筆`;
    text.append(title, description);
    heading.append(text, count);

    const list = document.createElement('div');
    list.className = 'booking-service-group-list';
    if (items.length) {
      list.append(...items);
    } else {
      const empty = document.createElement('div');
      empty.className = 'booking-service-group-empty';
      empty.textContent = group.key === 'reserved'
        ? '目前沒有已預約服務'
        : group.key === 'completed'
          ? '目前沒有已完成的服務'
          : '目前沒有已取消的服務';
      list.appendChild(empty);
    }

    section.append(heading, list);
    return section;
  }

  function organizeBookingHistory() {
    const bookingList = document.getElementById('bookingList');
    if (!bookingList || reorganizingBookingHistory) return;
    normalizeCompletedServiceLabel(bookingList);

    const directItems = [...bookingList.children].filter((node) => node.classList?.contains('booking-item'));
    if (!directItems.length) return;

    const grouped = new Map(BOOKING_GROUPS.map((group) => [group.key, []]));
    directItems.forEach((item) => grouped.get(bookingGroupKey(item)).push(item));

    reorganizingBookingHistory = true;
    if (bookingListObserver) bookingListObserver.disconnect();
    try {
      bookingList.replaceChildren(...BOOKING_GROUPS.map((group) => createBookingGroup(group, grouped.get(group.key))));
      normalizeCompletedServiceLabel(bookingList);
    } finally {
      reorganizingBookingHistory = false;
      if (bookingListObserver) bookingListObserver.observe(bookingList, { childList: true, subtree: true });
    }
  }

  function scheduleBookingHistoryEnhancement() {
    if (bookingHistoryTimer !== null) window.clearTimeout(bookingHistoryTimer);
    bookingHistoryTimer = window.setTimeout(() => {
      bookingHistoryTimer = null;
      organizeBookingHistory();
    }, 0);
  }

  function installBookingHistoryEnhancement() {
    const bookingList = document.getElementById('bookingList');
    if (!bookingList) return;
    normalizeCompletedServiceLabel(bookingList);
    if (bookingListObserver) bookingListObserver.disconnect();
    bookingListObserver = new MutationObserver(() => scheduleBookingHistoryEnhancement());
    bookingListObserver.observe(bookingList, { childList: true, subtree: true });
    scheduleBookingHistoryEnhancement();
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

  window.addEventListener('DOMContentLoaded', installBookingHistoryEnhancement);
  window.addEventListener('beforeunload', () => {
    if (bookingListObserver) bookingListObserver.disconnect();
    if (bookingHistoryTimer !== null) window.clearTimeout(bookingHistoryTimer);
  });
})();
