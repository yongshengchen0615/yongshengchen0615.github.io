const APP = Object.freeze({
  sheets: {
    users: 'Users',
    accounts: 'LoyaltyAccounts',
    transactions: 'Transactions',
    sessions: 'Sessions',
    admins: 'Admins',
    audit: 'AuditLogs',
    settings: 'Settings'
  },
  headers: {
    Users: ['user_id', 'line_user_id', 'display_name', 'picture_url', 'status', 'created_at', 'last_login_at'],
    LoyaltyAccounts: ['account_id', 'user_id', 'card_code', 'balance', 'status', 'created_at', 'updated_at'],
    Transactions: ['transaction_id', 'user_id', 'delta', 'type', 'reason', 'idempotency_key', 'actor_user_id', 'balance_after', 'created_at'],
    Sessions: ['session_hash', 'user_id', 'expires_at', 'revoked_at', 'created_at', 'last_seen_at'],
    Admins: ['line_user_id', 'role', 'active', 'created_at'],
    AuditLogs: ['event_id', 'actor_user_id', 'action', 'target', 'result', 'metadata', 'created_at'],
    Settings: ['key', 'value', 'updated_at']
  },
  lineAuthorizeUrl: 'https://access.line.me/oauth2/v2.1/authorize',
  lineTokenUrl: 'https://api.line.me/oauth2/v2.1/token',
  lineVerifyUrl: 'https://api.line.me/oauth2/v2.1/verify',
  oauthTtlSeconds: 600,
  handoffTtlSeconds: 180,
  defaultSessionHours: 12,
  defaultRewardTarget: 10,
  maxAdjustment: 100
});

function doGet(e) {
  const params = (e && e.parameter) || {};
  if (params.route === 'oauth-callback') return handleOauthCallback_(params);
  if (params.mode === 'bridge') return serveBridge_();
  return HtmlService.createHtmlOutput(
    '<!doctype html><html><head><meta charset="utf-8"><title>Loyalty Card API</title></head>' +
    '<body><h1>Loyalty Card GAS backend</h1><p>Backend is running.</p></body></html>'
  );
}

function serveBridge_() {
  const config = getConfig_();
  const template = HtmlService.createTemplateFromFile('Bridge');
  template.allowedOrigin = config.publicOrigin;
  return template.evaluate()
    .setTitle('Loyalty Bridge')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function beginLineLogin(input) {
  input = input || {};
  const config = getConfig_();
  const returnPage = input.returnPage === 'admin' ? 'admin' : 'user';
  const handoffHash = String(input.handoffHash || '');
  if (!/^[A-Za-z0-9_-]{43}$/.test(handoffHash)) throw new Error('Invalid login handoff');

  const state = randomUrlSafe_(32);
  const nonce = randomUrlSafe_(32);
  const verifier = randomUrlSafe_(64);
  const challenge = sha256Base64Url_(verifier);
  CacheService.getScriptCache().put('oauth:' + state, JSON.stringify({
    nonce,
    verifier,
    handoffHash,
    returnPage,
    createdAt: Date.now()
  }), APP.oauthTtlSeconds);

  const callbackUrl = getCallbackUrl_(config);
  return {
    flowId: state,
    authUrl: APP.lineAuthorizeUrl + '?' + formEncode_({
      response_type: 'code',
      client_id: config.lineChannelId,
      redirect_uri: callbackUrl,
      state,
      scope: 'profile openid',
      nonce,
      code_challenge: challenge,
      code_challenge_method: 'S256'
    })
  };
}

function completeLogin(input) {
  input = input || {};
  const flowId = String(input.flowId || '');
  const handoffSecret = String(input.handoffSecret || '');
  if (!/^[A-Za-z0-9_-]{30,100}$/.test(flowId) || !/^[A-Za-z0-9_-]{43}$/.test(handoffSecret)) {
    throw new Error('登入交接資訊無效');
  }

  const cache = CacheService.getScriptCache();
  const raw = cache.get('handoff:' + flowId);
  if (!raw) throw new Error('登入交接已過期，請重新登入');
  const record = JSON.parse(raw);
  if (!constantTimeEqual_(sha256Base64Url_(handoffSecret), record.handoffHash)) {
    logAudit_('', 'LOGIN_HANDOFF_FAILED', 'flow:' + flowId.slice(0, 8), 'DENIED', {});
    throw new Error('登入交接驗證失敗');
  }

  cache.remove('handoff:' + flowId);
  const session = createSession_(record.userId);
  logAudit_(record.userId, 'LOGIN_SUCCESS', 'user:' + record.userId, 'SUCCESS', { via: 'LINE' });
  return {
    sessionToken: session.token,
    expiresAt: session.expiresAt,
    returnPage: record.returnPage
  };
}

function getMyCard(input) {
  const session = requireSession_(input && input.sessionToken);
  return getMemberBundle_(session.userId, false);
}

function logoutSession(input) {
  const token = String((input && input.sessionToken) || '');
  if (!token) return { ok: true };
  const hash = sha256Hex_(token);
  const sheet = getSheet_(APP.sheets.sessions);
  const values = sheet.getDataRange().getValues();
  const now = isoNow_();
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][0]) === hash && !values[i][3]) {
      sheet.getRange(i + 1, 4).setValue(now);
      logAudit_(String(values[i][1]), 'LOGOUT', 'session', 'SUCCESS', {});
      break;
    }
  }
  return { ok: true };
}

function adminBootstrap(input) {
  const admin = requireAdmin_(input && input.sessionToken);
  return {
    admin: { displayName: admin.displayName, role: admin.role },
    settings: getPublicSettings_()
  };
}

function adminSearchMembers(input) {
  input = input || {};
  requireAdmin_(input.sessionToken);
  const query = String(input.query || '').trim().toLowerCase().slice(0, 80);
  const users = rowsAsObjects_(getSheet_(APP.sheets.users));
  const accounts = rowsAsObjects_(getSheet_(APP.sheets.accounts));
  const accountByUser = indexBy_(accounts, 'user_id');

  const members = users
    .filter((user) => String(user.status) === 'ACTIVE')
    .filter((user) => {
      if (!query) return true;
      const account = accountByUser[String(user.user_id)] || {};
      return String(user.display_name || '').toLowerCase().includes(query) ||
        String(account.card_code || '').toLowerCase().includes(query);
    })
    .slice(0, 20)
    .map((user) => {
      const account = accountByUser[String(user.user_id)] || {};
      return {
        userId: String(user.user_id),
        displayName: String(user.display_name || 'LINE 會員'),
        cardCode: String(account.card_code || ''),
        balance: Number(account.balance || 0)
      };
    });
  return { members };
}

function adminGetMember(input) {
  input = input || {};
  requireAdmin_(input.sessionToken);
  return getMemberBundle_(String(input.userId || ''), true);
}

function adminAdjustPoints(input) {
  input = input || {};
  const admin = requireAdmin_(input.sessionToken);
  enforceRateLimit_('adjust:' + admin.userId, 30, 60);

  const targetUserId = String(input.userId || '');
  const action = String(input.action || '');
  const amount = Number(input.amount || 0);
  const reason = cleanText_(input.reason || '', 120);
  const idempotencyKey = String(input.idempotencyKey || '');

  if (!/^usr_[A-Za-z0-9]+$/.test(targetUserId)) throw new Error('會員識別碼無效');
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(idempotencyKey)) throw new Error('請求識別碼無效');
  if (!['earn', 'remove', 'redeem'].includes(action)) throw new Error('不支援的點數操作');
  if (action !== 'redeem' && reason.length < 3) throw new Error('請填寫至少 3 個字的操作原因');
  if (action !== 'redeem' && (!Number.isInteger(amount) || amount < 1 || amount > APP.maxAdjustment)) {
    throw new Error('單次點數異動必須介於 1 到 ' + APP.maxAdjustment);
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const existing = findTransactionByIdempotency_(idempotencyKey);
    if (existing) return { balance: Number(existing.balance_after), duplicate: true };

    const user = findByField_(getSheet_(APP.sheets.users), 'user_id', targetUserId);
    if (!user || String(user.status) !== 'ACTIVE') throw new Error('會員不存在或帳號不可操作');

    const accountsSheet = getSheet_(APP.sheets.accounts);
    const accountMatch = findByFieldWithRow_(accountsSheet, 'user_id', targetUserId);
    if (!accountMatch || String(accountMatch.object.status) !== 'ACTIVE') throw new Error('集點卡不可操作');

    const settings = getPublicSettings_();
    const current = Number(accountMatch.object.balance || 0);
    let delta = 0;
    let type = '';
    let normalizedReason = reason;
    if (action === 'earn') {
      delta = amount;
      type = 'EARN';
    } else if (action === 'remove') {
      delta = -amount;
      type = 'ADJUST';
      if (current + delta < 0) throw new Error('點數不足，不能扣成負數');
    } else {
      delta = -Number(settings.stampsPerReward);
      type = 'REDEEM';
      normalizedReason = normalizedReason || '兌換獎勵';
      if (current + delta < 0) throw new Error('點數不足，尚不能兌換');
    }

    const maxBalance = Number(getSetting_('max_balance', '9999'));
    const next = current + delta;
    if (next > maxBalance) throw new Error('點數超過系統上限');

    const balanceColumn = headerIndex_(accountsSheet, 'balance') + 1;
    const updatedColumn = headerIndex_(accountsSheet, 'updated_at') + 1;
    accountsSheet.getRange(accountMatch.row, balanceColumn).setValue(next);
    accountsSheet.getRange(accountMatch.row, updatedColumn).setValue(isoNow_());

    appendObject_(getSheet_(APP.sheets.transactions), {
      transaction_id: 'tx_' + compactUuid_(),
      user_id: targetUserId,
      delta,
      type,
      reason: safeCellText_(normalizedReason),
      idempotency_key: idempotencyKey,
      actor_user_id: admin.userId,
      balance_after: next,
      created_at: isoNow_()
    });

    logAudit_(admin.userId, 'POINTS_' + type, 'user:' + targetUserId, 'SUCCESS', {
      delta,
      balanceAfter: next,
      reason: normalizedReason.slice(0, 80)
    });
    return { balance: next, duplicate: false };
  } catch (error) {
    logAudit_(admin.userId, 'POINTS_' + action.toUpperCase(), 'user:' + targetUserId, 'FAILED', {
      message: String(error.message || error).slice(0, 120)
    });
    throw error;
  } finally {
    lock.releaseLock();
  }
}

function handleOauthCallback_(params) {
  const config = getConfig_();
  const state = String(params.state || '');
  const cache = CacheService.getScriptCache();

  if (params.error) {
    let returnPage = 'user';
    const errorFlow = state ? cache.get('oauth:' + state) : '';
    if (errorFlow) {
      try { returnPage = JSON.parse(errorFlow).returnPage === 'admin' ? 'admin' : 'user'; } catch (_) {}
      cache.remove('oauth:' + state);
    }
    return redirectToPublic_(config, returnPage, { auth_error: 'line_denied' });
  }
  if (!state || !params.code) return redirectToPublic_(config, 'user', { auth_error: 'invalid_callback' });

  const raw = cache.get('oauth:' + state);
  if (!raw) return redirectToPublic_(config, 'user', { auth_error: 'expired_state' });
  cache.remove('oauth:' + state);

  try {
    const oauth = JSON.parse(raw);
    const tokenResponse = fetchJsonForm_(APP.lineTokenUrl, {
      grant_type: 'authorization_code',
      code: String(params.code),
      redirect_uri: getCallbackUrl_(config),
      client_id: config.lineChannelId,
      client_secret: config.lineChannelSecret,
      code_verifier: oauth.verifier
    });
    if (!tokenResponse.id_token) throw new Error('LINE did not return an ID token');

    const profile = fetchJsonForm_(APP.lineVerifyUrl, {
      id_token: tokenResponse.id_token,
      client_id: config.lineChannelId,
      nonce: oauth.nonce
    });
    if (!profile.sub || String(profile.aud) !== config.lineChannelId) throw new Error('LINE identity verification failed');

    const user = upsertUserFromLine_(profile);
    cache.put('handoff:' + state, JSON.stringify({
      userId: user.userId,
      handoffHash: oauth.handoffHash,
      returnPage: oauth.returnPage
    }), APP.handoffTtlSeconds);
    return redirectToPublic_(config, oauth.returnPage, { auth: 'complete', flow: state });
  } catch (error) {
    logAudit_('', 'LOGIN_FAILED', 'flow:' + state.slice(0, 8), 'FAILED', {
      message: String(error.message || error).slice(0, 120)
    });
    return redirectToPublic_(config, 'user', { auth_error: 'login_failed' });
  }
}

function upsertUserFromLine_(profile) {
  const lineUserId = String(profile.sub);
  const displayName = cleanText_(profile.name || 'LINE 會員', 80);
  const pictureUrl = /^https:\/\//.test(String(profile.picture || '')) ? String(profile.picture) : '';
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const usersSheet = getSheet_(APP.sheets.users);
    const match = findByFieldWithRow_(usersSheet, 'line_user_id', lineUserId);
    if (match) {
      if (String(match.object.status) !== 'ACTIVE') throw new Error('帳號目前無法登入');
      setFieldByRow_(usersSheet, match.row, 'display_name', safeCellText_(displayName));
      setFieldByRow_(usersSheet, match.row, 'picture_url', safeCellText_(pictureUrl));
      setFieldByRow_(usersSheet, match.row, 'last_login_at', isoNow_());
      return { userId: String(match.object.user_id) };
    }

    const userId = 'usr_' + compactUuid_();
    appendObject_(usersSheet, {
      user_id: userId,
      line_user_id: lineUserId,
      display_name: safeCellText_(displayName),
      picture_url: safeCellText_(pictureUrl),
      status: 'ACTIVE',
      created_at: isoNow_(),
      last_login_at: isoNow_()
    });
    appendObject_(getSheet_(APP.sheets.accounts), {
      account_id: 'acct_' + compactUuid_(),
      user_id: userId,
      card_code: generateUniqueCardCode_(),
      balance: 0,
      status: 'ACTIVE',
      created_at: isoNow_(),
      updated_at: isoNow_()
    });
    return { userId };
  } finally {
    lock.releaseLock();
  }
}

function createSession_(userId) {
  const token = randomUrlSafe_(48);
  const hash = sha256Hex_(token);
  const hours = Number(getSetting_('session_hours', String(APP.defaultSessionHours)));
  const expires = new Date(Date.now() + hours * 3600 * 1000).toISOString();
  appendObject_(getSheet_(APP.sheets.sessions), {
    session_hash: hash,
    user_id: userId,
    expires_at: expires,
    revoked_at: '',
    created_at: isoNow_(),
    last_seen_at: isoNow_()
  });
  return { token, expiresAt: expires };
}

function requireSession_(token) {
  token = String(token || '');
  if (token.length < 40) throw new Error('未登入或工作階段已失效');
  const hash = sha256Hex_(token);
  const sheet = getSheet_(APP.sheets.sessions);
  const values = sheet.getDataRange().getValues();
  const headers = values[0] || [];
  const hashIndex = headers.indexOf('session_hash');
  const userIndex = headers.indexOf('user_id');
  const expiresIndex = headers.indexOf('expires_at');
  const revokedIndex = headers.indexOf('revoked_at');
  const seenIndex = headers.indexOf('last_seen_at');

  for (let i = 1; i < values.length; i++) {
    if (String(values[i][hashIndex]) !== hash) continue;
    if (values[i][revokedIndex]) throw new Error('工作階段已撤銷，請重新登入');
    if (new Date(values[i][expiresIndex]).getTime() <= Date.now()) throw new Error('工作階段已過期，請重新登入');
    const userId = String(values[i][userIndex]);
    const user = findByField_(getSheet_(APP.sheets.users), 'user_id', userId);
    if (!user || String(user.status) !== 'ACTIVE') throw new Error('帳號目前無法使用');
    if (seenIndex >= 0) sheet.getRange(i + 1, seenIndex + 1).setValue(isoNow_());
    return { userId, user };
  }
  throw new Error('未登入或工作階段已失效');
}

function requireAdmin_(token) {
  const session = requireSession_(token);
  const user = session.user;
  const lineUserId = String(user.line_user_id || '');
  const admins = rowsAsObjects_(getSheet_(APP.sheets.admins));
  const record = admins.find((admin) =>
    String(admin.line_user_id) === lineUserId &&
    String(admin.active).toUpperCase() === 'TRUE' &&
    ['admin', 'staff'].includes(String(admin.role).toLowerCase())
  );
  if (!record) {
    logAudit_(session.userId, 'ADMIN_ACCESS', 'admin-console', 'DENIED', {});
    throw new Error('未授權使用管理端');
  }
  return {
    userId: session.userId,
    lineUserId,
    displayName: String(user.display_name || '管理員'),
    role: String(record.role).toLowerCase()
  };
}

function getMemberBundle_(userId, includeAdminContext) {
  const user = findByField_(getSheet_(APP.sheets.users), 'user_id', userId);
  if (!user || String(user.status) !== 'ACTIVE') throw new Error('會員不存在或帳號不可使用');
  const account = findByField_(getSheet_(APP.sheets.accounts), 'user_id', userId);
  if (!account || String(account.status) !== 'ACTIVE') throw new Error('集點卡不存在或不可使用');
  const transactions = rowsAsObjects_(getSheet_(APP.sheets.transactions))
    .filter((tx) => String(tx.user_id) === userId)
    .slice(-20)
    .reverse()
    .map((tx) => ({
      delta: Number(tx.delta || 0),
      type: String(tx.type || ''),
      typeLabel: transactionTypeLabel_(String(tx.type || '')),
      reason: String(tx.reason || ''),
      createdAt: formatTaipei_(tx.created_at)
    }));
  return {
    member: {
      userId: String(user.user_id),
      displayName: String(user.display_name || 'LINE 會員'),
      pictureUrl: String(user.picture_url || ''),
      ...(includeAdminContext ? { status: String(user.status) } : {})
    },
    card: {
      cardCode: String(account.card_code),
      balance: Number(account.balance || 0),
      status: String(account.status)
    },
    transactions,
    settings: getPublicSettings_()
  };
}

function transactionTypeLabel_(type) {
  return ({ EARN: '集點', ADJUST: '點數調整', REDEEM: '兌換獎勵' })[type] || '點數異動';
}

function getPublicSettings_() {
  return { stampsPerReward: Number(getSetting_('stamps_per_reward', String(APP.defaultRewardTarget))) };
}

function enforceRateLimit_(key, max, windowSeconds) {
  const cache = CacheService.getScriptCache();
  const bucket = 'rate:' + key + ':' + Math.floor(Date.now() / (windowSeconds * 1000));
  const count = Number(cache.get(bucket) || 0) + 1;
  cache.put(bucket, String(count), windowSeconds + 5);
  if (count > max) throw new Error('操作過於頻繁，請稍後再試');
}

function fetchJsonForm_(url, payload) {
  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/x-www-form-urlencoded',
    payload: formEncode_(payload),
    muteHttpExceptions: true
  });
  const code = response.getResponseCode();
  let body = {};
  try { body = JSON.parse(response.getContentText() || '{}'); } catch (_) {}
  if (code < 200 || code >= 300) throw new Error('External authentication request failed (' + code + ')');
  return body;
}

function getConfig_() {
  const props = PropertiesService.getScriptProperties();
  const config = {
    lineChannelId: props.getProperty('LINE_CHANNEL_ID') || '',
    lineChannelSecret: props.getProperty('LINE_CHANNEL_SECRET') || '',
    publicOrigin: props.getProperty('PUBLIC_ORIGIN') || '',
    publicBaseUrl: props.getProperty('PUBLIC_BASE_URL') || '',
    webAppUrl: props.getProperty('WEB_APP_URL') || ''
  };
  Object.keys(config).forEach((key) => {
    if (!config[key]) throw new Error('Missing Script Property: ' + key);
  });
  if (!/^https:\/\//.test(config.publicOrigin) || !/^https:\/\//.test(config.publicBaseUrl) || !/^https:\/\/script\.google\.com\/macros\/s\//.test(config.webAppUrl)) {
    throw new Error('Invalid deployment URL configuration');
  }
  const normalizedOrigin = config.publicOrigin.replace(/\/$/, '');
  if (config.publicBaseUrl !== normalizedOrigin && !config.publicBaseUrl.startsWith(normalizedOrigin + '/')) {
    throw new Error('PUBLIC_BASE_URL origin mismatch');
  }
  return config;
}

function getCallbackUrl_(config) {
  return config.webAppUrl + (config.webAppUrl.includes('?') ? '&' : '?') + 'route=oauth-callback';
}

function redirectToPublic_(config, page, params) {
  const base = page === 'admin'
    ? config.publicBaseUrl.replace(/\/$/, '') + '/admin/'
    : config.publicBaseUrl.replace(/\/$/, '') + '/';
  const query = formEncode_(params || {});
  const target = base + (query ? '?' + query : '');
  const safeTarget = JSON.stringify(target).replace(/</g, '\\u003c');
  return HtmlService.createHtmlOutput(
    '<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer">' +
    '<title>Returning…</title></head><body><p>登入處理完成，正在返回…</p>' +
    '<script>window.top.location.replace(' + safeTarget + ');<\/script></body></html>'
  );
}

function getSpreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('Missing Script Property: SPREADSHEET_ID. Run setupLoyaltyCard_ first.');
  return SpreadsheetApp.openById(id);
}

function getSheet_(name) {
  const sheet = getSpreadsheet_().getSheetByName(name);
  if (!sheet) throw new Error('Missing sheet: ' + name);
  return sheet;
}

function rowsAsObjects_(sheet) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0].map(String);
  return values.slice(1).filter((row) => row.some((v) => v !== '')).map((row) => {
    const obj = {};
    headers.forEach((header, index) => { obj[header] = row[index]; });
    return obj;
  });
}

function findByField_(sheet, field, value) {
  const match = findByFieldWithRow_(sheet, field, value);
  return match ? match.object : null;
}

function findByFieldWithRow_(sheet, field, value) {
  const values = sheet.getDataRange().getValues();
  if (!values.length) return null;
  const headers = values[0].map(String);
  const index = headers.indexOf(field);
  if (index < 0) throw new Error('Missing field: ' + field);
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][index]) === String(value)) {
      const object = {};
      headers.forEach((header, col) => { object[header] = values[i][col]; });
      return { row: i + 1, object };
    }
  }
  return null;
}

function findTransactionByIdempotency_(idempotencyKey) {
  return findByField_(getSheet_(APP.sheets.transactions), 'idempotency_key', idempotencyKey);
}

function appendObject_(sheet, object) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  sheet.appendRow(headers.map((header) => object[header] === undefined ? '' : object[header]));
}

function setFieldByRow_(sheet, row, field, value) {
  sheet.getRange(row, headerIndex_(sheet, field) + 1).setValue(value);
}

function headerIndex_(sheet, field) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  const index = headers.indexOf(field);
  if (index < 0) throw new Error('Missing field: ' + field);
  return index;
}

function indexBy_(rows, field) {
  return rows.reduce((acc, row) => {
    acc[String(row[field])] = row;
    return acc;
  }, {});
}

function getSetting_(key, fallback) {
  const row = findByField_(getSheet_(APP.sheets.settings), 'key', key);
  return row ? String(row.value) : fallback;
}

function generateUniqueCardCode_() {
  const sheet = getSheet_(APP.sheets.accounts);
  for (let i = 0; i < 5; i++) {
    const code = 'LC-' + compactUuid_().slice(0, 8).toUpperCase();
    if (!findByField_(sheet, 'card_code', code)) return code;
  }
  throw new Error('Unable to generate unique card code');
}

function logAudit_(actorUserId, action, target, result, metadata) {
  try {
    appendObject_(getSheet_(APP.sheets.audit), {
      event_id: 'audit_' + compactUuid_(),
      actor_user_id: actorUserId || '',
      action: safeCellText_(action),
      target: safeCellText_(target),
      result: safeCellText_(result),
      metadata: safeCellText_(JSON.stringify(metadata || {}).slice(0, 500)),
      created_at: isoNow_()
    });
  } catch (error) {
    console.error('Audit write failed: %s', error.message);
  }
}

function setupLoyaltyCard_() {
  const props = PropertiesService.getScriptProperties();
  let spreadsheetId = props.getProperty('SPREADSHEET_ID');
  let spreadsheet;
  if (spreadsheetId) {
    spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  } else {
    spreadsheet = SpreadsheetApp.create('MembershipSystem Loyalty Card DB');
    spreadsheetId = spreadsheet.getId();
    props.setProperty('SPREADSHEET_ID', spreadsheetId);
  }

  Object.keys(APP.headers).forEach((sheetName) => {
    let sheet = spreadsheet.getSheetByName(sheetName);
    if (!sheet) sheet = spreadsheet.insertSheet(sheetName);
    const headers = APP.headers[sheetName];
    const current = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
    if (current.every((v) => v === '')) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.setFrozenRows(1);
    } else if (headers.some((header, index) => String(current[index] || '') !== header)) {
      throw new Error('Existing sheet schema mismatch: ' + sheetName);
    }
  });

  const defaultSheet = spreadsheet.getSheetByName('Sheet1');
  if (defaultSheet && spreadsheet.getSheets().length > 1) spreadsheet.deleteSheet(defaultSheet);
  seedSetting_('stamps_per_reward', String(APP.defaultRewardTarget));
  seedSetting_('session_hours', String(APP.defaultSessionHours));
  seedSetting_('max_balance', '9999');
  return { spreadsheetId, spreadsheetUrl: spreadsheet.getUrl() };
}

function seedSetting_(key, value) {
  const sheet = getSheet_(APP.sheets.settings);
  if (!findByField_(sheet, 'key', key)) {
    appendObject_(sheet, { key, value, updated_at: isoNow_() });
  }
}

function isoNow_() {
  return new Date().toISOString();
}

function formatTaipei_(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (isNaN(date.getTime())) return String(value);
  return Utilities.formatDate(date, 'Asia/Taipei', 'yyyy/MM/dd HH:mm');
}

function compactUuid_() {
  return Utilities.getUuid().replace(/-/g, '');
}

function randomUrlSafe_(bytes) {
  let text = '';
  while (text.length < bytes * 2) text += compactUuid_();
  return sha256Base64Url_(text + Date.now() + Math.random()).slice(0, Math.max(43, bytes));
}

function sha256Base64Url_(value) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(value), Utilities.Charset.UTF_8);
  return Utilities.base64EncodeWebSafe(digest).replace(/=+$/g, '');
}

function sha256Hex_(value) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(value), Utilities.Charset.UTF_8);
  return digest.map((b) => ('0' + ((b + 256) % 256).toString(16)).slice(-2)).join('');
}

function constantTimeEqual_(a, b) {
  a = String(a || '');
  b = String(b || '');
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function formEncode_(object) {
  return Object.keys(object)
    .filter((key) => object[key] !== undefined && object[key] !== null && object[key] !== '')
    .map((key) => encodeURIComponent(key) + '=' + encodeURIComponent(String(object[key])))
    .join('&');
}

function cleanText_(value, maxLength) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function safeCellText_(value) {
  const text = String(value == null ? '' : value);
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}
