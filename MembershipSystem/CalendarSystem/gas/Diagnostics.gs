'use strict';

/**
 * Apps Script editor-only diagnostics for CalendarSystem.
 * These functions are intentionally NOT routed through doGet/doPost.
 * They never accept, return, store, or log a real LINE ID token.
 */
function diagnoseLineAuthService() {
  const properties = PropertiesService.getScriptProperties();
  const userChannelId = String(properties.getProperty('USER_LINE_LOGIN_CHANNEL_ID') || '').trim();
  const legacyUserChannelId = String(properties.getProperty('LINE_LOGIN_CHANNEL_ID') || '').trim();
  const adminChannelId = String(properties.getProperty('ADMIN_LINE_LOGIN_CHANNEL_ID') || '').trim();
  const effectiveUserChannelId = userChannelId || legacyUserChannelId;
  const channelId = adminChannelId || effectiveUserChannelId;

  const result = {
    checkedAt: new Date().toISOString(),
    userChannelConfigured: /^\d{6,20}$/.test(effectiveUserChannelId),
    adminChannelConfigured: /^\d{6,20}$/.test(adminChannelId),
    externalRequestReachable: false,
    httpStatus: null,
    status: 'UNKNOWN',
    requiresAuthorization: false,
    errorName: '',
    errorMessage: ''
  };

  if (!/^\d{6,20}$/.test(channelId)) {
    result.status = 'CONFIGURATION_ERROR';
    result.errorMessage = 'LINE Login Channel ID 尚未正確設定。';
    return result;
  }

  try {
    // An intentionally invalid token is sufficient to prove GAS can reach LINE.
    // Any HTTP response (including 400/401) means UrlFetchApp and network access work.
    const response = UrlFetchApp.fetch('https://api.line.me/oauth2/v2.1/verify', {
      method: 'post',
      payload: {
        id_token: 'calendar_diagnostic_invalid_token',
        client_id: channelId
      },
      muteHttpExceptions: true,
      followRedirects: false
    });

    result.externalRequestReachable = true;
    result.httpStatus = response.getResponseCode();
    result.status = 'REACHABLE';
    return result;
  } catch (error) {
    const message = String(error && error.message || error || '').slice(0, 1000);
    result.status = 'EXTERNAL_REQUEST_FAILED';
    result.errorName = String(error && error.name || 'Error').slice(0, 100);
    result.errorMessage = message;
    result.requiresAuthorization = /permission|authoriz|required permissions|script\.external_request/i.test(message);
    return result;
  }
}

/**
 * One-shot editor diagnostic for both storage and LINE outbound connectivity.
 * Storage probing is delegated to diagnoseCalendarStorage(), which creates and
 * deletes a temporary probe sheet without writing member data.
 */
function diagnoseCalendarSystem() {
  const storage = typeof diagnoseCalendarStorage === 'function'
    ? diagnoseCalendarStorage()
    : { status: 'UNAVAILABLE', errorMessage: 'diagnoseCalendarStorage() 不存在。' };

  return {
    checkedAt: new Date().toISOString(),
    storage: storage,
    lineAuthService: diagnoseLineAuthService()
  };
}
