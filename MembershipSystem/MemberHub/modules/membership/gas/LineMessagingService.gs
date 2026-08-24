'use strict';

const MEMBERSHIP_LINE_MESSAGING = Object.freeze({
  channelAccessTokenProperty: 'LINE_MESSAGING_CHANNEL_ACCESS_TOKEN',
  pushEndpoint: 'https://api.line.me/v2/bot/message/push'
});

function createMembershipLineMessagingClient_() {
  const channelAccessToken = String(PropertiesService.getScriptProperties()
    .getProperty(MEMBERSHIP_LINE_MESSAGING.channelAccessTokenProperty) || '').trim();

  return Object.freeze({
    configured: Boolean(channelAccessToken),
    sendTextPush: function (lineTargetId, retryKey, message) {
      if (!channelAccessToken) {
        return { configured: false, accepted: false, retryable: false, errorCode: 'NOT_CONFIGURED' };
      }
      const result = sendMembershipLineTextPushWithToken_(channelAccessToken, lineTargetId, retryKey, message);
      result.configured = true;
      return result;
    }
  });
}

function membershipLineRetryKey_(seed) {
  const value = hashUsageCode_(String(seed || ''));
  return value.slice(0, 8) + '-' + value.slice(8, 12) + '-4' + value.slice(13, 16) +
    '-a' + value.slice(17, 20) + '-' + value.slice(20, 32);
}

function sendMembershipLineTextPushWithToken_(channelAccessToken, lineTargetId, retryKey, message) {
  try {
    const response = UrlFetchApp.fetch(MEMBERSHIP_LINE_MESSAGING.pushEndpoint, {
      method: 'post',
      contentType: 'application/json',
      headers: {
        Authorization: 'Bearer ' + channelAccessToken,
        'X-Line-Retry-Key': retryKey
      },
      payload: JSON.stringify({
        to: lineTargetId,
        messages: [{ type: 'text', text: String(message || '').slice(0, 5000) }]
      }),
      muteHttpExceptions: true
    });
    const responseCode = Number(response.getResponseCode());
    const accepted = (responseCode >= 200 && responseCode < 300) || responseCode === 409;
    return {
      accepted: accepted,
      retryable: !accepted && (responseCode === 429 || responseCode >= 500),
      errorCode: accepted ? '' : 'HTTP_' + responseCode
    };
  } catch (_) {
    return { accepted: false, retryable: true, errorCode: 'NETWORK_ERROR' };
  }
}
