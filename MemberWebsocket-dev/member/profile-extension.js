(() => {
  'use strict';

  const REQUEST_TIMEOUT_MS = 15000;
  const PROFILE_ENDPOINT = '/functions/v1/member-profile-api';
  let currentProfile = null;
  let syncTimer = null;
  let syncing = false;

  window.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('profileForm');
    if (form) form.addEventListener('submit', saveExtendedProfile, true);

    const bookingForm = document.getElementById('bookingProfileForm');
    if (bookingForm) bookingForm.addEventListener('submit', saveBookingProfile);
    document.getElementById('editBookingProfileButton')?.addEventListener('click', openBookingProfileEditor);
    document.getElementById('cancelBookingProfileButton')?.addEventListener('click', closeBookingProfileEditor);

    scheduleProfileSync(0);
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
    const phone = rawPhone.replace(/[()\s-]/g, '');

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

  async function saveBookingProfile(event) {
    event.preventDefault();
    const surname = valueOf('bookingSurname');
    const salutation = valueOf('bookingSalutation');
    const rawPhone = valueOf('bookingPhone');
    const phone = rawPhone.replace(/[()\s-]/g, '');
    const birthday = String(currentProfile?.birthday || valueOf('profileBirthday') || '').trim();

    if (!surname) return showBookingMessage('請填寫姓氏。');
    if (!['mr', 'ms'].includes(salutation)) return showBookingMessage('請選擇先生或小姐。');
    if (!/^\+?\d{8,15}$/.test(phone)) return showBookingMessage('請填寫正確的電話。');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birthday)) return showBookingMessage('目前會員生日資料不完整，請重新整理後再試。');

    setBookingSaving(true);
    hideBookingMessage();
    try {
      const { config, idToken } = await resolveSession();
      const result = await requestProfile(config, idToken, 'user.member.profile.save', {
        surname,
        salutation,
        birthday,
        phone: rawPhone,
      });
      currentProfile = result.profile || { ...currentProfile, surname, salutation, birthday, phone: rawPhone };
      applyProfileDisplay(currentProfile);
      closeBookingProfileEditor();
    } catch (error) {
      showBookingMessage(error?.message || '預約資料暫時無法儲存，請稍後再試。');
    } finally {
      setBookingSaving(false);
    }
  }

  function openBookingProfileEditor() {
    if (!currentProfile) return;
    setValue('bookingSurname', String(currentProfile.surname || ''));
    setValue('bookingSalutation', String(currentProfile.salutation || '').toLowerCase());
    setValue('bookingPhone', String(currentProfile.phone || ''));
    hideBookingMessage();
    const form = document.getElementById('bookingProfileForm');
    const button = document.getElementById('editBookingProfileButton');
    if (form) form.classList.remove('hidden');
    if (button) {
      button.setAttribute('aria-expanded', 'true');
      button.classList.add('hidden');
    }
    document.getElementById('bookingSurname')?.focus();
  }

  function closeBookingProfileEditor() {
    const form = document.getElementById('bookingProfileForm');
    const button = document.getElementById('editBookingProfileButton');
    if (form) form.classList.add('hidden');
    if (button) {
      button.setAttribute('aria-expanded', 'false');
      button.classList.remove('hidden');
    }
    hideBookingMessage();
  }

  function scheduleProfileSync(delay = 350) {
    if (syncTimer !== null) window.clearTimeout(syncTimer);
    syncTimer = window.setTimeout(() => {
      syncTimer = null;
      syncExtendedProfile().catch(() => {});
    }, delay);
  }

  async function syncExtendedProfile() {
    if (syncing) return;
    syncing = true;
    try {
      const { config, idToken } = await resolveSession(16);
      const result = await requestProfile(config, idToken, 'user.member.bootstrap');
      currentProfile = result.profile || null;
      applyProfileDisplay(currentProfile);
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
        if (!idToken) throw new Error('LINE 登入尚未完成。');
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
        body: JSON.stringify({ ...payload, action, clientType: 'member', idToken }),
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
    const honorificName = surname && salutationLabel ? `${surname}${salutationLabel}` : '';
    const phone = String(profile.phone || '').trim();

    setValue('profileSurname', surname);
    setValue('profileSalutation', salutation);
    setValue('profilePhone', phone);
    setValue('profileBirthday', String(profile.birthday || ''));
    setValue('bookingSurname', surname);
    setValue('bookingSalutation', salutation);
    setValue('bookingPhone', phone);

    const surnameDisplay = document.getElementById('memberSurname');
    const salutationDisplay = document.getElementById('memberSalutation');
    const phoneDisplay = document.getElementById('memberPhone');
    if (surnameDisplay) surnameDisplay.textContent = honorificName || '未填寫';
    if (salutationDisplay) salutationDisplay.textContent = salutationLabel || '未填寫';
    if (phoneDisplay) phoneDisplay.textContent = phone || '未填寫';
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

  function setSaving(saving) {
    const button = document.getElementById('saveProfileButton');
    if (!button) return;
    button.disabled = saving;
    button.textContent = saving ? '加入中…' : '加入會員並開啟會員卡';
  }

  function setBookingSaving(saving) {
    const button = document.getElementById('saveBookingProfileButton');
    const cancelButton = document.getElementById('cancelBookingProfileButton');
    if (button) {
      button.disabled = saving;
      button.textContent = saving ? '儲存中…' : '儲存預約資料';
    }
    if (cancelButton) cancelButton.disabled = saving;
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

  function showBookingMessage(message) {
    const element = document.getElementById('bookingProfileMessage');
    if (!element) return;
    element.textContent = String(message || '');
    element.classList.remove('hidden');
  }

  function hideBookingMessage() {
    const element = document.getElementById('bookingProfileMessage');
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
