(() => {
  'use strict';

  const MEMBER_TIER_STYLE_KEYS = Object.freeze(['forest', 'midnight', 'ocean', 'sunset', 'lavender', 'rose', 'gold', 'platinum', 'mint', 'cherry']);
  const state = { config: null, idToken: '', profile: null, profileSaveLocked: false, birthdayPicker: { opener: null } };
  const els = {};

  window.addEventListener('DOMContentLoaded', () => {
    ['app', 'loadingView', 'loadingProgress', 'loadingProgressBar', 'errorView', 'errorTitle', 'errorMessage', 'retryButton', 'profileSetupView', 'profileForm', 'profileBirthday', 'profileBirthdayDisplay', 'profileBirthdayPickerButton', 'profileBirthdayPickerModal', 'profileBirthdayPickerTitle', 'closeProfileBirthdayPicker', 'cancelProfileBirthdayPicker', 'confirmProfileBirthdayPicker', 'profileBirthdayPickerMessage', 'profileBirthdayYear', 'profileBirthdayMonth', 'profileBirthdayDay', 'profilePhone', 'profileFormMessage', 'saveProfileButton', 'refreshProfileButton', 'memberView', 'memberPass', 'brandName', 'displayName', 'logoutButton', 'memberStatus', 'memberInitial', 'memberName', 'memberTier', 'memberCode', 'joinedAt', 'memberBirthday', 'memberPhone', 'membershipProgress'].forEach((id) => { els[id] = document.getElementById(id); });
    els.retryButton.addEventListener('click', () => window.location.reload());
    els.refreshProfileButton.addEventListener('click', () => window.location.reload());
    els.logoutButton.addEventListener('click', () => window.MemberSystem.logout());
    els.profileForm.addEventListener('submit', saveProfile);
    prepareBirthdayPicker();
    els.profileBirthdayPickerButton.addEventListener('click', openBirthdayPicker);
    els.closeProfileBirthdayPicker.addEventListener('click', closeBirthdayPicker);
    els.cancelProfileBirthdayPicker.addEventListener('click', closeBirthdayPicker);
    els.confirmProfileBirthdayPicker.addEventListener('click', confirmBirthdayPicker);
    els.profileBirthdayPickerModal.addEventListener('click', (event) => { if (event.target === els.profileBirthdayPickerModal) closeBirthdayPicker(); });
    els.profileBirthdayYear.addEventListener('change', () => { syncBirthdayDayOptions(); updateBirthdayPickerState(); });
    els.profileBirthdayMonth.addEventListener('change', () => { syncBirthdayDayOptions(); updateBirthdayPickerState(); });
    els.profileBirthdayDay.addEventListener('change', updateBirthdayPickerState);
    els.profileBirthday.addEventListener('input', updateBirthdayInputDisplay);
    els.profileBirthday.addEventListener('change', updateBirthdayInputDisplay);
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeBirthdayPicker(); });
    updateBirthdayInputDisplay();
    boot();
  });

  async function boot() {
    setView('loading');
    setLoginProgress(8);
    try {
      state.config = await window.MemberSystem.loadConfig();
      setLoginProgress(35);
      state.idToken = await window.MemberSystem.signIn(state.config, 'member');
      setLoginProgress(68);
      const result = await window.MemberSystem.request(state.config, 'member', state.idToken, 'user.member.bootstrap');
      setLoginProgress(100);
      state.profile = result.profile || {};
      if (!state.profile.profileComplete || state.profile.membershipRequired) return setView('profileSetup');
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
    const tierStyleKey = safeTierStyle(profile.tierStyleKey);
    MEMBER_TIER_STYLE_KEYS.forEach((styleKey) => els.memberPass.classList.remove(`tier-style-${styleKey}`));
    els.memberPass.classList.add(`tier-style-${tierStyleKey}`);
    els.memberPass.dataset.tierStyle = tierStyleKey;
    els.memberCode.textContent = String(profile.memberCode || '尚未建立');
    els.joinedAt.textContent = window.MemberSystem.formatDate(profile.joinedAt);
    els.memberBirthday.textContent = String(profile.birthday || '未填寫');
    els.memberPhone.textContent = String(profile.phone || '未填寫');
    window.MembershipProgress.render(els.membershipProgress, profile);
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

  function setSaving(saving) { els.saveProfileButton.disabled = saving || state.profileSaveLocked; els.saveProfileButton.textContent = saving ? '加入中…' : state.profileSaveLocked ? '請重新整理確認' : '加入會員並開啟會員卡'; }
  function showUncertainSaveMessage() { showMessage('無法確認資料是否已儲存。請先重新整理確認；在確認前請勿再次送出。'); els.refreshProfileButton.classList.remove('hidden'); els.saveProfileButton.disabled = true; els.saveProfileButton.textContent = '請重新整理確認'; }
  function showMessage(message) { els.profileFormMessage.textContent = message; els.profileFormMessage.classList.remove('hidden'); }
  function hideMessage() { els.profileFormMessage.textContent = ''; els.profileFormMessage.classList.add('hidden'); if (!state.profileSaveLocked) els.refreshProfileButton.classList.add('hidden'); }

  function prepareBirthdayPicker() {
    const currentYear = new Date().getFullYear();
    const yearOptions = [new Option('選擇年份', '')];
    for (let year = currentYear; year >= 1900; year -= 1) yearOptions.push(new Option(`${year} 年`, String(year)));
    const monthOptions = [new Option('選擇月份', '')];
    for (let month = 1; month <= 12; month += 1) monthOptions.push(new Option(`${month} 月`, padDatePart(month)));
    els.profileBirthdayYear.replaceChildren(...yearOptions);
    els.profileBirthdayMonth.replaceChildren(...monthOptions);
    syncBirthdayDayOptions();
  }

  function openBirthdayPicker() {
    state.birthdayPicker.opener = document.activeElement;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(els.profileBirthday.value || '').trim());
    els.profileBirthdayYear.value = match ? match[1] : '';
    els.profileBirthdayMonth.value = match ? match[2] : '';
    syncBirthdayDayOptions();
    els.profileBirthdayDay.value = match ? match[3] : '';
    updateBirthdayPickerState();
    els.profileBirthdayPickerModal.classList.remove('hidden');
    els.profileBirthdayYear.focus();
  }

  function closeBirthdayPicker() {
    if (els.profileBirthdayPickerModal.classList.contains('hidden')) return;
    els.profileBirthdayPickerModal.classList.add('hidden');
    if (state.birthdayPicker.opener instanceof HTMLElement && document.contains(state.birthdayPicker.opener)) state.birthdayPicker.opener.focus();
    state.birthdayPicker.opener = null;
  }

  function syncBirthdayDayOptions() {
    const selectedDay = String(els.profileBirthdayDay.value || '');
    const year = Number(els.profileBirthdayYear.value);
    const month = Number(els.profileBirthdayMonth.value);
    const maxDay = Number.isInteger(year) && year >= 1900 && month >= 1 && month <= 12 ? new Date(Date.UTC(year, month, 0)).getUTCDate() : 31;
    const dayOptions = [new Option('選擇日期', '')];
    for (let day = 1; day <= maxDay; day += 1) dayOptions.push(new Option(`${day} 日`, padDatePart(day)));
    els.profileBirthdayDay.replaceChildren(...dayOptions);
    if (selectedDay && Number(selectedDay) <= maxDay) els.profileBirthdayDay.value = selectedDay;
  }

  function updateBirthdayPickerState() {
    const year = Number(els.profileBirthdayYear.value);
    const month = Number(els.profileBirthdayMonth.value);
    const day = Number(els.profileBirthdayDay.value);
    const date = new Date(Date.UTC(year, month - 1, day));
    const today = new Date();
    const valid = Number.isInteger(year) && year >= 1900 && month >= 1 && month <= 12 && day >= 1 && day <= 31 && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day && date.getTime() <= Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
    els.confirmProfileBirthdayPicker.disabled = !valid;
    els.profileBirthdayPickerMessage.textContent = valid ? '日期已完整選擇，按「完成」套用。' : '請選擇完整的年月日。';
  }

  function confirmBirthdayPicker() {
    if (els.confirmProfileBirthdayPicker.disabled) return;
    const value = `${els.profileBirthdayYear.value}-${els.profileBirthdayMonth.value}-${els.profileBirthdayDay.value}`;
    els.profileBirthday.value = value;
    els.profileBirthday.dispatchEvent(new Event('input', { bubbles: true }));
    closeBirthdayPicker();
  }

  function updateBirthdayInputDisplay() {
    const value = String(els.profileBirthday.value || '').trim();
    els.profileBirthdayDisplay.textContent = value ? formatBirthday(value) : '請選擇生日';
    els.profileBirthdayDisplay.classList.toggle('has-value', Boolean(value));
  }

  function formatBirthday(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    return match ? `${Number(match[1])}年${Number(match[2])}月${Number(match[3])}日` : value;
  }

  function padDatePart(value) { return String(value).padStart(2, '0'); }

  function safeTierStyle(value) { const styleKey = String(value || '').trim(); return MEMBER_TIER_STYLE_KEYS.includes(styleKey) ? styleKey : 'forest'; }

  function setView(view) {
    els.loadingView.classList.toggle('hidden', view !== 'loading');
    els.errorView.classList.toggle('hidden', view !== 'error');
    els.profileSetupView.classList.toggle('hidden', view !== 'profileSetup');
    els.memberView.classList.toggle('hidden', view !== 'member');
  }

  function setLoginProgress(value) {
    const progress = Math.max(0, Math.min(100, Number(value) || 0));
    els.loadingProgress.setAttribute('aria-valuenow', String(progress));
    els.loadingProgressBar.style.width = `${progress}%`;
  }

  function showError(error) {
    const code = error && error.code;
    els.errorTitle.textContent = code === 'CONFIG_ERROR' ? '系統尚未完成設定' : '會員卡暫時無法載入';
    els.errorMessage.textContent = error && error.message ? error.message : '請稍後重新整理再試。';
    setView('error');
  }
})();
