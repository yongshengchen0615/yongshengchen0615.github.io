'use strict';

const LOYALTY_APP_ = Object.freeze({
  service: 'membership-loyalty-gas',
  version: '1.0.0',
  maxRequestBytes: 32 * 1024
});

function doGet(e) {
  return jsonOutput_({
    ok: true,
    result: {
      service: LOYALTY_APP_.service,
      version: LOYALTY_APP_.version,
      schemaVersion: LOYALTY_SCHEMA_VERSION_,
      storageConfigured: Boolean(PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID'))
    }
  });
}

function doPost(e) {
  let requestId = '';
  let action = '';

  try {
    const raw = String((e && e.postData && e.postData.contents) || '');
    const declaredLength = Number((e && e.contentLength) || 0);

    if (!raw || declaredLength > LOYALTY_APP_.maxRequestBytes || raw.length > LOYALTY_APP_.maxRequestBytes) {
      throw AppError_('INVALID_INPUT', 'Invalid request');
    }

    let request;
    try {
      request = JSON.parse(raw);
    } catch (_) {
      throw AppError_('INVALID_INPUT', 'Invalid JSON');
    }

    if (!isPlainObject_(request)) {
      throw AppError_('INVALID_INPUT', 'Invalid request');
    }

    requestId = cleanRequestId_(request.requestId);
    action = String(request.action || '').trim();

    requireProxyAuthorization_(request.proxySecret);

    const payload = isPlainObject_(request.payload) ? request.payload : {};
    const sessionToken = String(request.sessionToken || '');
    const result = dispatchAction_(action, payload, sessionToken, requestId);

    return jsonOutput_({
      ok: true,
      result: result,
      requestId: requestId
    });
  } catch (error) {
    const publicError = toPublicError_(error);
    console.error(
      'loyalty request failed action=%s requestId=%s code=%s',
      String(action || '').slice(0, 80),
      String(requestId || '').slice(0, 80),
      publicError.code
    );
    return jsonOutput_({
      ok: false,
      error: publicError,
      requestId: requestId
    });
  }
}

function dispatchAction_(action, payload, sessionToken, requestId) {
  switch (action) {
    case 'auth.login':
      return loginWithLiff_(payload, requestId);
    case 'auth.logout':
      return logoutSession_(sessionToken, requestId);

    case 'member.profile':
      return getMemberProfileForSession_(sessionToken);
    case 'loyalty.account':
      return getLoyaltyAccountForSession_(sessionToken);
    case 'loyalty.transactions':
      return getLoyaltyTransactionsForSession_(sessionToken, payload);

    case 'loyalty.earn':
      return adminEarnPoints_(sessionToken, payload, requestId);
    case 'loyalty.redeem':
      return adminRedeemPoints_(sessionToken, payload, requestId);

    case 'admin.bootstrap':
      return adminBootstrap_(sessionToken);
    case 'admin.member.search':
      return adminSearchMembers_(sessionToken, payload);
    case 'admin.member.get':
      return adminGetMember_(sessionToken, payload);
    case 'admin.member.transactions':
      return adminGetMemberTransactions_(sessionToken, payload);
    case 'admin.points.adjust':
      return adminAdjustPoints_(sessionToken, payload, requestId);

    default:
      throw AppError_('INVALID_ACTION', 'Unsupported API action');
  }
}

function requireProxyAuthorization_(suppliedSecret) {
  const expectedSecret = PropertiesService.getScriptProperties().getProperty('API_PROXY_SECRET') || '';
  if (expectedSecret.length < 32) {
    throw AppError_('CONFIGURATION_ERROR', 'Service is not configured');
  }
  if (!constantTimeEqual_(String(suppliedSecret || ''), expectedSecret)) {
    throw AppError_('UNAUTHORIZED', 'Request rejected');
  }
}

function jsonOutput_(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

function AppError_(code, message) {
  const error = new Error(String(message || 'Request failed'));
  error.isPublicAppError = true;
  error.code = String(code || 'INTERNAL_ERROR');
  return error;
}

function toPublicError_(error) {
  if (error && error.isPublicAppError) {
    return {
      code: String(error.code || 'INTERNAL_ERROR').slice(0, 80),
      message: String(error.message || 'Request failed').replace(/[\r\n]/g, ' ').slice(0, 180)
    };
  }

  return {
    code: 'INTERNAL_ERROR',
    message: 'Server error'
  };
}

function cleanRequestId_(value) {
  const requestId = String(value || '').trim();
  return /^[A-Za-z0-9_-]{8,100}$/.test(requestId) ? requestId : '';
}

function isPlainObject_(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function constantTimeEqual_(a, b) {
  a = String(a || '');
  b = String(b || '');
  if (a.length !== b.length) return false;

  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
