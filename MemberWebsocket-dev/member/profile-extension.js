(() => {
  'use strict';

  const REQUEST_TIMEOUT_MS = 15000;
  const PROFILE_ENDPOINT = '/functions/v1/member-profile-api';
  let currentProfile = null;
  let syncTimer = null;
  let syncing = false;
  let modalOpener = null;

  window.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('profileForm');
    if (form) form.addEventListener('submit', saveExtendedProfile, true);

    document.getElementById('editHonorificButton')?.addEventListener('click', openHonorificModal);
    document.getElementById('closeHonorificEditButton')?.addEventListener('click', () => closeProfileModal('honorific'));
    document.getElementById('cancelHonorificEditButton')?.addEventListener('click', () => closeProfileModal('honorific'));
    document.getElementById('saveHonorificEditButton')?.addEventListener('click', saveHonorificProfile);

    document.getElementById('editPhoneButton')?.addEventListener('click', openPhoneModal);
    document.getElementById('closePhoneEditButton')?.addEventListener('click', () => closeProfileModal('phone'));
    document.getElementById('cancelPhoneEditButton')?.addEventListener('click', () => closeProfileModal('phone'));
    document.getElementById('savePhoneEditButton')?.addEventListener('click', savePhoneProfile);

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      if (!document.getElementById('honorificEditModal')?.classList.contains('hidden')) closeProfileModal('honorific');
      else if (!document.getElementById('phoneEditModal')?.classList.contains('hidden')) closeProfileModal('phone');
    });

    scheduleProfileSync(0);
    window.addEventListener('member-test-session-ready', () => scheduleProfileSync(0));
    window.addEventListener('member-profile-ready', (event) => {
      const profile = event?.detail?.profile;
      if (!profile || typeof profile !== 'object') return;
      currentProfile = profile;
      applyProfileDisplay(profile);
    });
    window.addEventListener('pageshow', () => scheduleProfileSync(0));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') scheduleProfileSync(0);
    });
  });

  async function saveExtendedProfile(event) {
    event.preventDefault();
    event.stopImmediatePropagation();

    const surname = valueOf('profileSurname');
    const salutation = valueOf('profileSalutation');
    const birthday = valueOf('profileBirthday');
    const rawPhone = valueOf('profilePhone');
    const phone = normalizePhone(rawPhone);

    if (!surname) return showMessage('請填寫姓氏。');
    if (!['mr', 'ms'].includes(salutation)) return showMessage('請選擇先生或小姐。');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birthday)) return showMessage('請填寫正確的生日。');
    if (!/^\+?\d{8,15}$/.test(phone)) return showMessage('請填寫正確的電話。');

    const button = document.getElementById('saveProfileButton');
    if (button?.disabled) return;
    setSaving(true);
    hideMessage();

    try {
      const { config, idToken } = await resolveSession();
      const result = await requestProfile(config, idToken, 'user.member.profile.save', {
        surname,
        salutation,
        birthday,
        phone: rawPhone,
      });
      currentProfile = result.profile || null;
      applyProfileDisplay(currentProfile);
      window.location.reload();
    } catch (error) {
      showMessage(error?.message || '會員資料暫時無法儲存，請稍後再試。');
      setSaving(false);
    }
  }

  async function openHonorificModal(event) {
    modalOpener = event?.currentTarget || document.activeElement;
    closeProfileModal('phone', false);
    openProfileModal('honorific');
    showModalMessage('honorific', '正在同步會員資料…');
    try {
      const profile = await fetchCurrentProfile(4);
      hideModalMessage('honorific');
      setValue('honorificSurnameInput', String(profile.surname || ''));
      setValue('honorificSalutationSelect', String(profile.salutation || '').toLowerCase());
      document.getElementById('honorificSurnameInput')?.focus();
    } catch (error) {
      showModalMessage('honorific', error?.message || '會員資料尚在同步，請稍後再試。');
    }
  }

  async function openPhoneModal(event) {
    modalOpener = event?.currentTarget || document.activeElement;
    closeProfileModal('honorific', false);
    openProfileModal('phone');
    showModalMessage('phone', '正在同步會員資料…');
    try {
      const profile = await fetchCurrentProfile(4);
      hideModalMessage('phone');
      setValue('phoneEditInput', String(profile.phone || ''));
      document.getElementById('phoneEditInput')?.focus();
    } catch (error) {
      showModalMessage('phone', error?.message || '會員資料尚在同步，請稍後再試。');
    }
  }

  function openProfileModal(type) {
    const modal = document.getElementById(type === 'honorific' ? 'honorificEditModal' : 'phoneEditModal');
    if (!modal) return;
    modal.classList.remove('hidden');
    document.body.classList.add('profile-modal-open');
  }

  function closeProfileModal(type, restoreFocus = true) {
    const modal = document.getElementById(type === 'honorific' ? 'honorificEditModal' : 'phoneEditModal');
    if (!modal || modal.classList.contains('hidden')) return;
    modal.classList.add('hidden');
    hideModalMessage(type);
    if (document.getElementById('honorificEditModal')?.classList.contains('hidden') && document.getElementById('phoneEditModal')?.classList.contains('hidden')) {
      document.body.classList.remove('profile-modal-open');
    }
    if (restoreFocus && modalOpener instanceof HTMLElement && document.contains(modalOpener)) modalOpener.focus();
    if (restoreFocus) modalOpener = null;
  }

  async function saveHonorificProfile() {
    const surname = valueOf('honorificSurnameInput');
    const salutation = valueOf('honorificSalutationSelect').toLowerCase();

    if (!surname) return showModalMessage('honorific', '請填寫姓氏。');
    if (!['mr', 'ms'].includes(salutation)) return showModalMessage('honorific', '請選擇先生或小姐。');

    setModalSaving('honorific', true);
    hideModalMessage('honorific');
    try {
      const result = await saveProfilePayload({ surname, salutation });
      currentProfile = result.profile || { ...(currentProfile || {}), surname, salutation };
      applyProfileDisplay(currentProfile);
      closeProfileModal('honorific');
    } catch (error) {
      showModalMessage('honorific', error?.message || '稱呼暫時無法儲存，請稍後再試。');
    } finally {
      setModalSaving('honorific', false);
    }
  }

  async function savePhoneProfile() {
    const rawPhone = valueOf('phoneEditInput');
    const phone = normalizePhone(rawPhone);

    if (!/^\+?\d{8,15}$/.test(phone)) return showModalMessage('phone', '請填寫正確的電話。');

    setModalSaving('phone', true);
    hideModalMessage('phone');
    try {
      const result = await saveProfilePayload({ phone: rawPhone });
      currentProfile = result.profile || { ...(currentProfile || {}), phone: rawPhone };
      applyProfileDisplay(currentProfile);
      closeProfileModal('phone');
    } catch (error) {
      showModalMessage('phone', error?.message || '電話暫時無法儲存，請稍後再試。');
    } finally {
      setModalSaving('phone', false);
    }
  }

  async function saveProfilePayload(payload) {
    const { config, idToken } = await resolveSession();
    return requestProfile(config, idToken, 'user.member.profile.save', payload);
  }

  function scheduleProfileSync(delay = 350) {
    if (syncTimer !== null) window.clearTimeout(syncTimer);
    syncTimer = window.setTimeout(() => {
      syncTimer = null;
      syncExtendedProfile().catch(() => {});
    }, delay);
  }

  async function fetchCurrentProfile(attempts = 1) {
    const { config, idToken } = await resolveSession(attempts);
    const result = await requestProfile(config, idToken, 'user.member.bootstrap');
    const profile = result.profile && typeof result.profile === 'object' ? result.profile : null;
    if (!profile) throw new Error('會員資料尚在同步，請稍後再試。');
    currentProfile = profile;
    applyProfileDisplay(profile);
    return profile;
  }

  async function ensureCurrentProfile() {
    if (currentProfile && typeof currentProfile === 'object') return currentProfile;
    return fetchCurrentProfile(16);
  }

  async function syncExtendedProfile() {
    if (syncing) return;
    syncing = true;
    try {
      await fetchCurrentProfile(16);
    } finally {
      syncing = false;
    }
  }

  async function resolveSession(attempts = 1) {
    let lastError;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const system = window.MemberSystem;
        if (!system || typeof system.loadConfig !== 'function') throw new Error('會員系統尚未準備完成。');
        const config = await system.loadConfig();
        const idToken = typeof window.liff?.getIDToken === 'function' ? String(window.liff.getIDToken() || '') : '';
        const testSessionToken = window.TestModeClient && typeof window.TestModeClient.getSessionToken === 'function'
          ? window.TestModeClient.getSessionToken()
          : '';
        if (!idToken && !testSessionToken) throw new Error('登入尚未完成。');
        return { config, idToken };
      } catch (error) {
        lastError = error;
        if (attempt < attempts - 1) await wait(350);
      }
    }
    throw lastError || new Error('LINE 登入尚未完成。');
  }

  async function requestProfile(config, idToken, action, payload = {}) {
    const endpoint = `${String(config.supabaseUrl || '').replace(/\/$/, '')}${PROFILE_ENDPOINT}`;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: String(config.supabasePublishableKey || ''),
        },
        cache: 'no-store',
        signal: controller.signal,
        body: JSON.stringify(window.TestModeClient && typeof window.TestModeClient.payload === 'function'
          ? window.TestModeClient.payload({ ...payload, action, clientType: 'member', idToken })
          : { ...payload, action, clientType: 'member', idToken }),
      });
      let data;
      try { data = await response.json(); }
      catch { throw clientError('API_INVALID_RESPONSE', '會員資料服務回傳格式不正確。'); }
      if (!response.ok || data?.ok !== true) {
        const apiError = data?.error || {};
        throw clientError(String(apiError.code || 'API_ERROR'), String(apiError.message || '會員資料暫時無法完成操作。'));
      }
      return data.data || {};
    } catch (error) {
      if (error?.name === 'AbortError') throw clientError('API_TIMEOUT', '會員資料服務回應逾時，請稍後再試。');
      throw error;
    } finally {
      window.clearTimeout(timer);
    }
  }

  function applyProfileDisplay(profile) {
    if (!profile || typeof profile !== 'object') return;
    const surname = String(profile.surname || '').trim();
    const salutation = String(profile.salutation || '').trim().toLowerCase();
    const salutationLabel = salutation === 'mr' ? '先生' : salutation === 'ms' ? '小姐' : '';
    const honorificName = surname && salutationLabel ? `${surname}${salutationLabel}` : surname || salutationLabel;
    const phone = String(profile.phone || '').trim();

    setValue('profileSurname', surname);
    setValue('profileSalutation', salutation);
    setValue('profilePhone', phone);
    setValue('profileBirthday', String(profile.birthday || ''));
    setValue('honorificSurnameInput', surname);
    setValue('honorificSalutationSelect', salutation);
    setValue('phoneEditInput', phone);

    const honorificDisplay = document.getElementById('memberHonorificName');
    const phoneDisplay = document.getElementById('memberPhone');
    if (honorificDisplay) honorificDisplay.textContent = honorificName || '未填寫';
    if (phoneDisplay) phoneDisplay.textContent = phone || '未填寫';
  }

  function setModalSaving(type, saving) {
    const saveButton = document.getElementById(type === 'honorific' ? 'saveHonorificEditButton' : 'savePhoneEditButton');
    const cancelButton = document.getElementById(type === 'honorific' ? 'cancelHonorificEditButton' : 'cancelPhoneEditButton');
    const closeButton = document.getElementById(type === 'honorific' ? 'closeHonorificEditButton' : 'closePhoneEditButton');
    const inputs = type === 'honorific'
      ? [document.getElementById('honorificSurnameInput'), document.getElementById('honorificSalutationSelect')]
      : [document.getElementById('phoneEditInput')];

    if (saveButton) {
      saveButton.disabled = saving;
      saveButton.textContent = saving ? '儲存中…' : '儲存';
    }
    if (cancelButton) cancelButton.disabled = saving;
    if (closeButton) closeButton.disabled = saving;
    inputs.forEach((input) => { if (input) input.disabled = saving; });
  }

  function showModalMessage(type, message) {
    const element = document.getElementById(type === 'honorific' ? 'honorificEditMessage' : 'phoneEditMessage');
    if (!element) return;
    element.textContent = String(message || '');
    element.classList.remove('hidden');
  }

  function hideModalMessage(type) {
    const element = document.getElementById(type === 'honorific' ? 'honorificEditMessage' : 'phoneEditMessage');
    if (!element) return;
    element.textContent = '';
    element.classList.add('hidden');
  }

  function valueOf(id) {
    return String(document.getElementById(id)?.value || '').trim();
  }

  function setValue(id, value) {
    const element = document.getElementById(id);
    if (!element) return;
    if (element.value !== value) {
      element.value = value;
      if (id === 'profileBirthday') element.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  function normalizePhone(value) {
    return String(value || '').replace(/[()\s-]/g, '');
  }

  function setSaving(saving) {
    const button = document.getElementById('saveProfileButton');
    if (!button) return;
    button.disabled = saving;
    button.textContent = saving ? '加入中…' : '加入會員並開啟會員卡';
  }

  function showMessage(message) {
    const element = document.getElementById('profileFormMessage');
    if (!element) return;
    element.textContent = String(message || '');
    element.classList.remove('hidden');
  }

  function hideMessage() {
    const element = document.getElementById('profileFormMessage');
    if (!element) return;
    element.textContent = '';
    element.classList.add('hidden');
  }

  function clientError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  function wait(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }
})();
