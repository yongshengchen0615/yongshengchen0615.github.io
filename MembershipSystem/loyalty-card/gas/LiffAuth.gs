function loginWithLiff(input) {
  input = input || {};
  const idToken = String(input.idToken || '');
  const returnPage = input.returnPage === 'admin' ? 'admin' : 'user';

  if (idToken.length < 100 || idToken.length > 4096 || idToken.split('.').length !== 3) {
    throw new Error('LIFF ID Token 格式無效');
  }

  const tokenFingerprint = sha256Hex_(idToken).slice(0, 24);
  enforceRateLimit_('liff-login-global', 60, 60);
  enforceRateLimit_('liff-login:' + tokenFingerprint, 5, 60);

  const config = getConfig_();
  const profile = fetchJsonForm_(APP.lineVerifyUrl, {
    id_token: idToken,
    client_id: config.lineChannelId
  });

  if (!profile.sub || String(profile.aud) !== config.lineChannelId) {
    logAudit_('', 'LIFF_LOGIN_FAILED', 'liff:' + tokenFingerprint, 'DENIED', {
      reason: 'identity_verification_failed'
    });
    throw new Error('LIFF 身分驗證失敗');
  }

  if (returnPage === 'admin' && !isActiveAdminLineUser_(String(profile.sub))) {
    logAudit_('', 'ADMIN_LIFF_LOGIN', 'admin-console', 'DENIED', {
      lineUserFingerprint: sha256Hex_(String(profile.sub)).slice(0, 16)
    });
    throw new Error('未授權使用管理端');
  }

  const user = upsertUserFromLine_(profile);
  const session = createSession_(user.userId);

  logAudit_(user.userId, 'LOGIN_SUCCESS', 'user:' + user.userId, 'SUCCESS', {
    via: 'LIFF',
    returnPage: returnPage
  });

  return {
    sessionToken: session.token,
    expiresAt: session.expiresAt,
    returnPage: returnPage
  };
}

function isActiveAdminLineUser_(lineUserId) {
  return rowsAsObjects_(getSheet_(APP.sheets.admins)).some((admin) =>
    String(admin.line_user_id) === String(lineUserId) &&
    String(admin.active).toUpperCase() === 'TRUE' &&
    ['admin', 'staff'].includes(String(admin.role).toLowerCase())
  );
}
