(() => {
  'use strict';

  const system = window.MemberSystem;
  if (!system || typeof system.request !== 'function') return;

  const originalRequest = system.request.bind(system);
  const PROFILE_ACTIONS = new Set(['user.member.bootstrap', 'user.member.profile.save']);
  const REQUEST_TIMEOUT_MS = 15000;

  system.request = async function requestWithProfileFields(config, clientType, idToken, action, payload = {}) {
    if (!PROFILE_ACTIONS.has(action) || clientType !== 'member') {
      return originalRequest(config, clientType, idToken, action, payload);
    }

    const body = { ...payload, action, clientType, idToken };
    if (action === 'user.member.profile.save') {
      body.surname = String(document.getElementById('profileSurname')?.value || '').trim();
      body.salutation = String(document.getElementById('profileSalutation')?.value || '').trim();
      if (!body.surname) throw clientError('INVALID_SURNAME', '請填寫姓氏。');
      if (!['mr', 'ms'].includes(body.salutation)) throw clientError('INVALID_SALUTATION', '請選擇先生或小姐。');
    }

    const endpoint = `${String(config.supabaseUrl || '').replace(/\/$/, '')}/functions/v1/member-profile-api`;
    const result = await postJson(endpoint, config, body);
    syncProfileFields(result?.profile || {});
    return result;
  };

  async function postJson(endpoint, config, body) {
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
        body: JSON.stringify(body),
      });
      let data;
      try { data = await response.json(); }
      catch { throw clientError('API_INVALID_RESPONSE', '會員資料服務回傳格式不正確。'); }
      if (!response.ok || data?.ok !== true) {
        const apiError = data?.error || {};
        throw clientError(String(apiError.code || 'API_ERROR'), String(apiError.message || '會員資料暫時無法完成操作。'), apiError.details || null);
      }
      return data.data || {};
    } catch (error) {
      if (error?.name === 'AbortError') throw clientError('API_TIMEOUT', '會員資料服務回應逾時，請稍後再試。');
      throw error;
    } finally {
      window.clearTimeout(timer);
    }
  }

  function syncProfileFields(profile) {
    const surname = String(profile.surname || '');
    const salutation = String(profile.salutation || '');
    const birthday = String(profile.birthday || '');
    const phone = String(profile.phone || '');

    setValue('profileSurname', surname);
    setValue('profileSalutation', salutation);
    setValue('profilePhone', phone);
    const birthdayInput = document.getElementById('profileBirthday');
    if (birthdayInput && birthday && !birthdayInput.value) {
      birthdayInput.value = birthday;
      birthdayInput.dispatchEvent(new Event('input', { bubbles: true }));
    }

    const surnameDisplay = document.getElementById('memberSurname');
    const salutationDisplay = document.getElementById('memberSalutation');
    if (surnameDisplay) surnameDisplay.textContent = surname || '未填寫';
    if (salutationDisplay) salutationDisplay.textContent = salutation === 'mr' ? '先生' : salutation === 'ms' ? '小姐' : '未填寫';
  }

  function setValue(id, value) {
    const element = document.getElementById(id);
    if (element && value && !element.value) element.value = value;
  }

  function clientError(code, message, details = null) {
    const error = new Error(message);
    error.code = code;
    error.details = details;
    return error;
  }
})();
