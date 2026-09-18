(() => {
  'use strict';

  if (!window.BookingSystem || typeof window.BookingSystem.memberProfile !== 'function') return;
  if (!window.MembershipProgress || typeof window.MembershipProgress.render !== 'function') return;

  const originalMemberProfile = window.BookingSystem.memberProfile.bind(window.BookingSystem);
  const originalRequest = window.BookingSystem.request.bind(window.BookingSystem);
  const originalConfirm = window.confirm.bind(window);
  const BOOKING_GROUPS = [
    { key: 'reserved', title: '已預約服務', description: '等待確認、已確認與取消待確認的預約服務。' },
    { key: 'completed', title: '已完成的服務', description: '已由管理端確認完成的服務紀錄。' },
    { key: 'cancelled', title: '已取消的服務', description: '已由管理端確認取消或未通過的預約服務。' },
  ];
  let lastProfile = null;
  let renderTimer = null;
  let bookingListObserver = null;
  let bookingHistoryTimer = null;
  let formMessageObserver = null;
  let reorganizingBookingHistory = false;
  let expandedBookingId = '';

  function membershipRequiredError() {
    if (typeof window.BookingSystem.clientError === 'function') {
      return window.BookingSystem.clientError('MEMBERSHIP_REQUIRED', '請先完成會員加入後再使用預約功能。');
    }
    const error = new Error('請先完成會員加入後再使用預約功能。');
    error.code = 'MEMBERSHIP_REQUIRED';
    return error;
  }

  function clientError(code, message) {
    if (typeof window.BookingSystem.clientError === 'function') return window.BookingSystem.clientError(code, message);
    const error = new Error(message);
    error.code = code;
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

  async function cancellationRequest(config, idToken, action, payload = {}) {
    const endpoint = `${String(config?.supabaseUrl || '').replace(/\/$/, '')}/functions/v1/booking-cancellation-api`;
    if (!endpoint.startsWith('https://')) throw clientError('API_CONFIG_MISSING', '取消申請服務尚未設定。');
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        cache: 'no-store',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          apikey: String(config?.supabasePublishableKey || ''),
        },
        body: JSON.stringify({ ...payload, action, clientType: 'member', idToken }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || data?.ok !== true) {
        throw clientError(String(data?.error?.code || 'API_ERROR'), String(data?.error?.message || '取消申請服務拒絕此操作。'));
      }
      return data.data || {};
    } catch (error) {
      if (error?.code) throw error;
      if (error?.name === 'AbortError') throw clientError('API_TIMEOUT', '取消申請服務回應逾時，請更新後確認申請狀態。');
      throw clientError('NETWORK_ERROR', '目前無法連線取消申請服務。');
    } finally {
      window.clearTimeout(timer);
    }
  }

  function applyCancellationRequests(bookingData, requests) {
    if (!bookingData || !Array.isArray(bookingData.bookings)) return bookingData;
    const pending = new Map((Array.isArray(requests) ? requests : []).map((request) => [request.bookingId, request]));
    return {
      ...bookingData,
      bookings: bookingData.bookings.map((booking) => {
        const request = pending.get(booking.bookingId);
        if (!request) return booking;
        return {
          ...booking,
          baseStatus: booking.status,
          status: 'cancel_requested',
          cancellationRequestedAt: request.cancellationRequestedAt || null,
        };
      }),
    };
  }

  async function enrichBootstrapWithCancellationState(config, idToken, bookingData) {
    try {
      const cancellationData = await cancellationRequest(config, idToken, 'member.list');
      return applyCancellationRequests(bookingData, cancellationData.requests);
    } catch (error) {
      console.warn('booking cancellation state unavailable', error?.code || error?.message || error);
      return bookingData;
    }
  }

  function normalizeBookingUi(root) {
    if (!root) return;
    const badges = [];
    if (root.nodeType === Node.ELEMENT_NODE && root.matches?.('.status-badge')) badges.push(root);
    if (typeof root.querySelectorAll === 'function') badges.push(...root.querySelectorAll('.status-badge'));
    badges.forEach((badge) => {
      if (badge.classList.contains('status-completed') && badge.textContent !== '完成服務') badge.textContent = '完成服務';
      if (badge.classList.contains('status-cancel_requested') && badge.textContent !== '取消待確認') badge.textContent = '取消待確認';
    });

    const buttons = [];
    if (root.nodeType === Node.ELEMENT_NODE && root.matches?.('button')) buttons.push(root);
    if (typeof root.querySelectorAll === 'function') buttons.push(...root.querySelectorAll('button'));
    buttons.forEach((button) => {
      if (button.textContent?.trim() === '取消預約') button.textContent = '申請取消';
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

  function bookingCardId(card) {
    return String(card?.dataset?.bookingId || '');
  }

  function applyBookingCardAccordionState(card, expanded) {
    if (!card) return;
    const top = card.querySelector(':scope > .booking-item-top');
    card.classList.add('booking-history-collapsible');
    card.classList.toggle('is-expanded', expanded);
    card.dataset.bookingExpanded = expanded ? '1' : '0';
    if (top) {
      top.setAttribute('role', 'button');
      top.setAttribute('tabindex', '0');
      top.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      top.setAttribute('aria-label', expanded ? '收合預約詳細資料' : '展開預約詳細資料');
    }
  }

  function syncBookingAccordionState(bookingList) {
    if (!bookingList) return;
    let expandedFound = false;
    const cards = bookingList.querySelectorAll('.booking-item[data-booking-id]');
    cards.forEach((card) => {
      const expanded = Boolean(expandedBookingId) && bookingCardId(card) === expandedBookingId;
      if (expanded) expandedFound = true;
      applyBookingCardAccordionState(card, expanded);
    });
    if (expandedBookingId && !expandedFound) expandedBookingId = '';
  }

  function toggleBookingCard(card) {
    if (!card) return;
    const bookingList = card.closest('#bookingList');
    if (!bookingList) return;
    const id = bookingCardId(card);
    const shouldExpand = !card.classList.contains('is-expanded');
    expandedBookingId = shouldExpand ? id : '';
    bookingList.querySelectorAll('.booking-item[data-booking-id]').forEach((item) => {
      applyBookingCardAccordionState(item, shouldExpand && item === card);
    });
  }

  function handleBookingHistoryClick(event) {
    if (!(event.target instanceof Element)) return;
    if (event.target.closest('button, a, input, select, textarea, label')) return;
    const summarySurface = event.target.closest('.booking-item-top, .member-booking-format-totals');
    if (!summarySurface) return;
    const card = summarySurface.closest('.booking-item[data-booking-id]');
    if (!card) return;
    toggleBookingCard(card);
  }

  function handleBookingHistoryKeydown(event) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (!(event.target instanceof Element) || !event.target.matches('.booking-item-top[role="button"]')) return;
    const card = event.target.closest('.booking-item[data-booking-id]');
    if (!card) return;
    event.preventDefault();
    toggleBookingCard(card);
  }

  function organizeBookingHistory() {
    const bookingList = document.getElementById('bookingList');
    if (!bookingList || reorganizingBookingHistory) return;
    normalizeBookingUi(bookingList);

    const directItems = [...bookingList.children].filter((node) => node.classList?.contains('booking-item'));
    if (!directItems.length) return;

    const grouped = new Map(BOOKING_GROUPS.map((group) => [group.key, []]));
    directItems.forEach((item) => grouped.get(bookingGroupKey(item)).push(item));

    reorganizingBookingHistory = true;
    if (bookingListObserver) bookingListObserver.disconnect();
    try {
      bookingList.replaceChildren(...BOOKING_GROUPS.map((group) => createBookingGroup(group, grouped.get(group.key))));
      normalizeBookingUi(bookingList);
      syncBookingAccordionState(bookingList);
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
    if (bookingList) {
      normalizeBookingUi(bookingList);
      if (bookingListObserver) bookingListObserver.disconnect();
      bookingListObserver = new MutationObserver(() => scheduleBookingHistoryEnhancement());
      bookingListObserver.observe(bookingList, { childList: true, subtree: true });
      bookingList.addEventListener('click', handleBookingHistoryClick);
      bookingList.addEventListener('keydown', handleBookingHistoryKeydown);
      scheduleBookingHistoryEnhancement();
    }

    const formMessage = document.getElementById('formMessage');
    if (formMessage) {
      const normalizeMessage = () => {
        if (formMessage.textContent?.includes('預約已取消')) {
          formMessage.textContent = '已送出取消申請，等待管理端確認；確認前原預約時段仍會保留。';
        }
      };
      normalizeMessage();
      formMessageObserver = new MutationObserver(normalizeMessage);
      formMessageObserver.observe(formMessage, { childList: true, subtree: true, characterData: true });
    }
  }

  window.BookingMemberUI = Object.freeze({
    organizeBookingHistory,
  });

  window.confirm = (message) => {
    const text = String(message ?? '');
    if (text.startsWith('確定取消 ') && text.endsWith(' 的預約嗎？')) {
      return originalConfirm(`${text}\n\n確定取消後會送出申請，需由管理端確認；確認前原預約時段仍會保留。`);
    }
    return originalConfirm(message);
  };

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
    const [config, clientType, idToken, action, payload] = args;
    try {
      if (clientType === 'member' && action === 'user.booking.bootstrap') {
        const bookingData = await originalRequest(...args);
        return await enrichBootstrapWithCancellationState(config, idToken, bookingData);
      }
      if (clientType === 'member' && action === 'user.booking.cancel') {
        const cancellation = await cancellationRequest(config, idToken, 'member.request', { bookingId: payload?.bookingId });
        const fresh = await originalRequest(config, clientType, idToken, 'user.booking.bootstrap');
        const booking = (fresh?.bookings || []).find((item) => item.bookingId === payload?.bookingId);
        if (!booking) throw clientError('BOOKING_NOT_FOUND', '取消申請已送出，但目前無法重新載入這筆預約。');
        return {
          booking: {
            ...booking,
            baseStatus: booking.status,
            status: 'cancel_requested',
            cancellationRequestedAt: cancellation?.request?.cancellationRequestedAt || null,
          },
        };
      }
      return await originalRequest(...args);
    } catch (error) {
      if (error && error.code === 'MEMBERSHIP_REQUIRED') showMembershipRequiredView();
      throw error;
    }
  };

  window.addEventListener('DOMContentLoaded', installBookingHistoryEnhancement);
  window.addEventListener('beforeunload', () => {
    window.confirm = originalConfirm;
    if (bookingListObserver) bookingListObserver.disconnect();
    const bookingList = document.getElementById('bookingList');
    if (bookingList) {
      bookingList.removeEventListener('click', handleBookingHistoryClick);
      bookingList.removeEventListener('keydown', handleBookingHistoryKeydown);
    }
    if (formMessageObserver) formMessageObserver.disconnect();
    if (bookingHistoryTimer !== null) window.clearTimeout(bookingHistoryTimer);
  });
})();
