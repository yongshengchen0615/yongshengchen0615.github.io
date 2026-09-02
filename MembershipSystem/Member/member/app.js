(() => {
  'use strict';

  const state = { config: null, idToken: '', profile: null };
  const els = {};

  window.addEventListener('DOMContentLoaded', () => {
    ['app', 'loadingView', 'errorView', 'errorTitle', 'errorMessage', 'retryButton', 'memberView', 'brandName', 'displayName', 'logoutButton', 'memberStatus', 'memberInitial', 'memberName', 'memberTier', 'memberCode', 'joinedAt', 'benefitList', 'statusTitle', 'statusMessage', 'statusLineText', 'syncedAt'].forEach((id) => { els[id] = document.getElementById(id); });
    els.retryButton.addEventListener('click', () => window.location.reload());
    els.logoutButton.addEventListener('click', () => window.MemberSystem.logout());
    boot();
  });

  async function boot() {
    setView('loading');
    try {
      state.config = await window.MemberSystem.loadConfig();
      state.idToken = await window.MemberSystem.signIn(state.config, 'user');
      const result = await window.MemberSystem.request(state.config, 'user', state.idToken, 'user.member.bootstrap');
      state.profile = result.profile || {};
      renderProfile(state.profile);
      setView('member');
    } catch (error) {
      showError(error);
    } finally {
      els.app.setAttribute('aria-busy', 'false');
    }
  }

  function renderProfile(profile) {
    const brandName = String(state.config.brandName || 'Lumen Club');
    const displayName = String(profile.displayName || 'LINE 使用者');
    const status = String(profile.status || 'active').toLowerCase();
    const isActive = status === 'active';
    els.brandName.textContent = brandName;
    els.displayName.textContent = displayName;
    els.memberInitial.textContent = window.MemberSystem.initials(displayName);
    els.memberName.textContent = displayName;
    els.memberTier.textContent = String(profile.tier || '一般會員');
    els.memberCode.textContent = String(profile.memberCode || '尚未建立');
    els.joinedAt.textContent = window.MemberSystem.formatDate(profile.joinedAt);
    els.memberStatus.textContent = isActive ? '使用中' : '暫停';
    els.memberStatus.parentElement.classList.toggle('inactive', !isActive);
    els.statusTitle.textContent = isActive ? '會員狀態良好' : '會員資格暫停';
    els.statusMessage.textContent = isActive ? '你的會員資格目前正常，可以使用所有已開通的權益。' : '目前無法使用部分會員權益，請聯絡店家確認帳戶狀態。';
    els.statusLineText.textContent = isActive ? 'Active member' : 'Membership paused';

    const benefits = Array.isArray(profile.benefits) && profile.benefits.length
      ? profile.benefits
      : ['會員專屬活動通知', '消費可累積集點進度', '優先享有新方案與回饋'];
    els.benefitList.replaceChildren(...benefits.slice(0, 6).map((benefit) => {
      const item = document.createElement('li');
      item.textContent = String(benefit);
      return item;
    }));
    els.syncedAt.textContent = `剛剛同步 · ${new Date().toLocaleTimeString('zh-Hant-TW', { hour: '2-digit', minute: '2-digit' })}`;
  }

  function setView(view) {
    els.loadingView.classList.toggle('hidden', view !== 'loading');
    els.errorView.classList.toggle('hidden', view !== 'error');
    els.memberView.classList.toggle('hidden', view !== 'member');
  }

  function showError(error) {
    const code = error && error.code;
    els.errorTitle.textContent = code === 'CONFIG_ERROR' ? '系統尚未完成設定' : '會員卡暫時無法載入';
    els.errorMessage.textContent = error && error.message ? error.message : '請稍後重新整理再試。';
    setView('error');
  }
})();
