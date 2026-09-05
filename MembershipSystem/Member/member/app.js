(() => {
  'use strict';

  const state = { config: null, idToken: '', profile: null, profileSaveLocked: false };
  const els = {};

  window.addEventListener('DOMContentLoaded', () => {
    ['app', 'loadingView', 'errorView', 'errorTitle', 'errorMessage', 'retryButton', 'profileSetupView', 'profileForm', 'profileBirthday', 'profilePhone', 'profileFormMessage', 'saveProfileButton', 'refreshProfileButton', 'memberView', 'brandName', 'displayName', 'logoutButton', 'memberStatus', 'memberInitial', 'memberName', 'memberTier', 'memberCode', 'joinedAt', 'memberBirthday', 'memberPhone', 'serviceMinutesTotal', 'tierProgressMessage', 'nextTierThreshold', 'tierProgressTrack', 'tierProgressBar', 'tierProgressDetail'].forEach((id) => { els[id] = document.getElementById(id); });
    els.retryButton.addEventListener('click', () => window.location.reload());
    els.refreshProfileButton.addEventListener('click', () => window.location.reload());
    els.logoutButton.addEventListener('click', () => window.MemberSystem.logout());
    els.profileForm.addEventListener('submit', saveProfile);
    boot();
  });

  async function boot() {
    setView('loading');
    try {
      state.config = await window.MemberSystem.loadConfig();
      state.idToken = await window.MemberSystem.signIn(state.config, 'member');
      const result = await window.MemberSystem.request(state.config, 'member', state.idToken, 'user.member.bootstrap');
      state.profile = result.profile || {};
      if (!state.profile.profileComplete) return setView('profileSetup');
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
    els.memberBirthday.textContent = String(profile.birthday || '未填寫');
    els.memberPhone.textContent = String(profile.phone || '未填寫');
    renderTierProgress(profile);
    els.memberStatus.textContent = isActive ? '使用中' : '暫停';
    els.memberStatus.parentElement.classList.toggle('inactive', !isActive);
  }

  async function saveProfile(event) {
    event.preventDefault();
    if (state.profileSaveLocked) return showUncertainSaveMessage();
    hideMessage();
    const birthday = String(els.profileBirthday.value || '').trim();
    const phone = String(els.profilePhone.value || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birthday)) return showMessage('請填寫正確的生日。');
    if (!/^\+?\d{8,15}$/.test(phone.replace(/[()\s-]/g, ''))) return showMessage('請填寫正確的電話。');
    setSaving(true);
    try {
      const result = await window.MemberSystem.request(state.config, 'member', state.idToken, 'user.member.profile.save', { birthday, phone });
      state.profile = result.profile || {};
      renderProfile(state.profile);
      setView('member');
    } catch (error) {
      if (error && error.code === 'API_RESPONSE_UNCERTAIN') {
        state.profileSaveLocked = true;
        showUncertainSaveMessage();
      } else {
        showMessage(error && error.message || '資料暫時無法儲存，請稍後再試。');
      }
    } finally {
      setSaving(false);
    }
  }

  function formatServiceMinutes(value) {
    const minutes = Math.max(0, Math.floor(Number(value) || 0));
    return `${minutes} 分鐘`;
  }

  function tierProgressForProfile(profile) {
    const raw = profile && profile.tierProgress || {};
    const serviceMinutesTotal = Math.max(0, Math.floor(Number(raw.serviceMinutesTotal === undefined ? profile && profile.serviceMinutesTotal : raw.serviceMinutesTotal) || 0));
    const currentRequiredServiceMinutes = Math.max(0, Math.floor(Number(raw.currentRequiredServiceMinutes) || 0));
    const nextRequiredServiceMinutes = Math.floor(Number(raw.nextRequiredServiceMinutes));
    const nextTierLabel = String(raw.nextTierLabel || '').trim();
    const hasNextTier = Boolean(nextTierLabel && Number.isInteger(nextRequiredServiceMinutes) && nextRequiredServiceMinutes > currentRequiredServiceMinutes);
    const remainingServiceMinutes = hasNextTier ? Math.max(0, Math.floor(Number(raw.remainingServiceMinutes))) : 0;
    const percent = hasNextTier ? Math.min(100, Math.max(0, (serviceMinutesTotal - currentRequiredServiceMinutes) / (nextRequiredServiceMinutes - currentRequiredServiceMinutes) * 100)) : raw.isHighestTier ? 100 : 0;
    return { serviceMinutesTotal, nextTierLabel, nextRequiredServiceMinutes, remainingServiceMinutes, hasNextTier, isHighestTier: Boolean(raw.isHighestTier), percent };
  }

  function renderTierProgress(profile) {
    const progress = tierProgressForProfile(profile);
    els.serviceMinutesTotal.textContent = `累積 ${formatServiceMinutes(progress.serviceMinutesTotal)}`;
    if (progress.hasNextTier) {
      els.tierProgressMessage.textContent = `距離 ${progress.nextTierLabel} 還需要 ${formatServiceMinutes(progress.remainingServiceMinutes)}`;
      els.nextTierThreshold.textContent = `下一階段門檻 ${formatServiceMinutes(progress.nextRequiredServiceMinutes)}`;
      els.tierProgressDetail.textContent = `再累積 ${formatServiceMinutes(progress.remainingServiceMinutes)}，即可晉級 ${progress.nextTierLabel}。`;
    } else if (progress.isHighestTier) {
      els.tierProgressMessage.textContent = '已達最高會員資格';
      els.nextTierThreshold.textContent = '目前沒有下一個階段';
      els.tierProgressDetail.textContent = '感謝你持續累積服務時間，已享有目前最高會員資格。';
    } else {
      els.tierProgressMessage.textContent = '下一階段資格資訊載入中';
      els.nextTierThreshold.textContent = '請稍後重新整理確認';
      els.tierProgressDetail.textContent = '目前已累積的服務時間已顯示，下一階段門檻將在資料同步後提供。';
    }
    const roundedPercent = Math.round(progress.percent);
    els.tierProgressBar.style.width = `${roundedPercent}%`;
    els.tierProgressTrack.setAttribute('aria-valuenow', String(roundedPercent));
    els.tierProgressTrack.setAttribute('aria-valuetext', progress.hasNextTier ? `距離 ${progress.nextTierLabel} 還需要 ${formatServiceMinutes(progress.remainingServiceMinutes)}` : els.tierProgressMessage.textContent);
  }

  function setSaving(saving) { els.saveProfileButton.disabled = saving || state.profileSaveLocked; els.saveProfileButton.textContent = saving ? '儲存中…' : state.profileSaveLocked ? '請重新整理確認' : '儲存並開啟會員卡'; }
  function showUncertainSaveMessage() { showMessage('無法確認資料是否已儲存。請先重新整理確認；在確認前請勿再次送出。'); els.refreshProfileButton.classList.remove('hidden'); els.saveProfileButton.disabled = true; els.saveProfileButton.textContent = '請重新整理確認'; }
  function showMessage(message) { els.profileFormMessage.textContent = message; els.profileFormMessage.classList.remove('hidden'); }
  function hideMessage() { els.profileFormMessage.textContent = ''; els.profileFormMessage.classList.add('hidden'); if (!state.profileSaveLocked) els.refreshProfileButton.classList.add('hidden'); }

  function setView(view) {
    els.loadingView.classList.toggle('hidden', view !== 'loading');
    els.errorView.classList.toggle('hidden', view !== 'error');
    els.profileSetupView.classList.toggle('hidden', view !== 'profileSetup');
    els.memberView.classList.toggle('hidden', view !== 'member');
  }

  function showError(error) {
    const code = error && error.code;
    els.errorTitle.textContent = code === 'CONFIG_ERROR' ? '系統尚未完成設定' : '會員卡暫時無法載入';
    els.errorMessage.textContent = error && error.message ? error.message : '請稍後重新整理再試。';
    setView('error');
  }
})();
