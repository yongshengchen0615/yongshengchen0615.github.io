(function () {
  'use strict';

  const $ = (selector) => document.querySelector(selector);
  const statusCopy = {
    active: { badge: '有效', title: '會員資格有效', description: '此會員卡目前可正常使用。' },
    suspended: { badge: '停權', title: '會員資格已停權', description: '此會員目前暫停使用，若有疑問請聯絡管理員。' },
    disabled: { badge: '停用', title: '會員資格已停用', description: '此會員卡目前不可使用，若有疑問請聯絡管理員。' }
  };

  async function loadMember() {
    const result = await Membership.callApi('member.me');
    renderMember(result.member, result.isAdmin);
  }

  function renderMember(member, isAdmin) {
    const copy = statusCopy[member.membershipStatus] || statusCopy.disabled;
    $('#displayName').textContent = Membership.escapeText(member.displayName) || 'LINE 會員';
    $('#memberNo').textContent = Membership.escapeText(member.memberNo);
    $('#tierLabel').textContent = Membership.escapeText(member.tier || 'standard').toUpperCase();
    $('#statusBadge').textContent = copy.badge;
    $('#joinedAt').textContent = Membership.formatDate(member.joinedAt);
    $('#expiresAt').textContent = Membership.formatDate(member.expiresAt, '永久');
    $('#statusTitle').textContent = copy.title;
    $('#statusDescription').textContent = copy.description;
    $('#avatar').src = member.pictureUrl || 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="80" height="80"%3E%3Crect width="100%25" height="100%25" fill="%23374451"/%3E%3C/svg%3E';
    $('#adminLink').classList.toggle('hidden', !isAdmin);
    $('#boot').classList.add('hidden');
    $('#errorState').classList.add('hidden');
    $('#memberApp').classList.remove('hidden');
  }

  function showError(error) {
    $('#boot').classList.add('hidden');
    $('#memberApp').classList.add('hidden');
    $('#errorMessage').textContent = error && error.message ? error.message : '請稍後再試。';
    $('#errorState').classList.remove('hidden');
  }

  async function initialize() {
    try {
      const loggedIn = await Membership.ensureLiffLogin();
      if (!loggedIn) return;
      await loadMember();
    } catch (error) {
      showError(error);
    }
  }

  $('#refreshButton').addEventListener('click', async () => {
    $('#refreshButton').disabled = true;
    try { await loadMember(); } catch (error) { showError(error); }
    finally { $('#refreshButton').disabled = false; }
  });
  $('#retryButton').addEventListener('click', () => window.location.reload());
  $('#logoutButton').addEventListener('click', () => {
    if (liff.isLoggedIn()) liff.logout();
    window.location.href = './index.html';
  });

  initialize();
})();
