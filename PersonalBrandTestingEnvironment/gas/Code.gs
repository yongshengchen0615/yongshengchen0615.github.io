/**
 * PERSONA MEMBERS - Google Apps Script backend
 *
 * Required Script Properties:
 * - LINE_CHANNEL_ID: LINE Login channel ID used by the LIFF app
 * - SPREADSHEET_ID: Google Sheet ID that stores member rows
 * - ALLOWED_ORIGINS: comma-separated frontend origins, e.g.
 *   https://example.github.io,http://localhost:8080
 *
 * Optional:
 * - SHEET_NAME: defaults to "Members"
 * - MAX_VERIFY_REQUESTS_PER_MINUTE: defaults to 120 (1-1000)
 */

var API_VERSION = "1.0.0";
var DEFAULT_SHEET_NAME = "Members";
var LINE_VERIFY_URL = "https://api.line.me/oauth2/v2.1/verify";
var MAX_ID_TOKEN_LENGTH = 6000;

var MEMBER_HEADERS = [
  "member_id",
  "line_user_id",
  "display_name",
  "picture_url",
  "email",
  "status",
  "joined_at",
  "updated_at",
  "last_login_at",
  "login_count",
  "context_type",
  "context_os",
  "context_language",
  "in_liff_client",
  "view_type",
  "last_token_iat",
  "last_request_id",
];

var MEMBER_COLUMN = {
  memberId: 1,
  lineUserId: 2,
  displayName: 3,
  pictureUrl: 4,
  email: 5,
  status: 6,
  joinedAt: 7,
  updatedAt: 8,
  lastLoginAt: 9,
  loginCount: 10,
  contextType: 11,
  contextOs: 12,
  contextLanguage: 13,
  inLiffClient: 14,
  viewType: 15,
  lastTokenIat: 16,
  lastRequestId: 17,
};

function doGet(e) {
  var action = e && e.parameter ? String(e.parameter.action || "") : "";
  var requestId = e && e.parameter ? String(e.parameter.requestId || "") : "";

  if (!action || action === "health") {
    return jsonResponse_({
      ok: true,
      requestId: requestId,
      data: {
        service: "member-api",
        version: API_VERSION,
        timestamp: new Date().toISOString(),
      },
    });
  }

  return jsonResponse_({
    ok: false,
    requestId: requestId,
    code: "METHOD_NOT_ALLOWED",
    message: "此操作必須使用 POST。",
  });
}

function doPost(e) {
  var request = {};
  var result;

  try {
    request = parseRequest_(e);
    validateRequestEnvelope_(request);

    // callbackOrigin is client-provided, so this is an operational allowlist,
    // not authentication. The verified LINE ID token remains the authority.
    if (!isAllowedRequestOrigin_(request.callbackOrigin)) {
      throw appError_("ORIGIN_NOT_ALLOWED", "目前網站來源未被 GAS 允許。");
    }

    result = handleMemberRequest_(request);
    result.ok = true;
  } catch (error) {
    result = errorResult_(error);
  }

  result.requestId = String(request.requestId || "");

  if (request.transport === "bridge") {
    return bridgeResponse_(result, request);
  }

  return jsonResponse_(result);
}

/**
 * Run once from the Apps Script editor after setting Script Properties.
 * It validates configuration, creates the Members sheet and formats columns.
 */
function setup() {
  var config = getConfig_();
  var lock = LockService.getScriptLock();

  if (!lock.tryLock(10000)) {
    throw new Error("Could not acquire setup lock. Try again in a few seconds.");
  }

  try {
    var sheet = getOrCreateMemberSheet_(config);
    applySheetColumnFormats_(sheet);
    SpreadsheetApp.flush();
    return {
      ok: true,
      spreadsheetId: config.spreadsheetId,
      sheetName: sheet.getName(),
      columns: MEMBER_HEADERS.length,
    };
  } finally {
    lock.releaseLock();
  }
}

function handleMemberRequest_(request) {
  var config = getConfig_();
  var identity = verifyLineIdToken_(request.idToken, config.lineChannelId);

  if (request.action === "upsertMember") {
    return upsertMember_(identity, request, config);
  }

  if (request.action === "deleteMember") {
    return deleteMember_(identity, request, config);
  }

  throw appError_("UNSUPPORTED_ACTION", "不支援的會員操作。");
}

function verifyLineIdToken_(idToken, expectedChannelId) {
  var response;

  if (!isJwtLike_(idToken)) {
    throw appError_("INVALID_TOKEN", "LINE 登入憑證格式不正確，請重新登入。");
  }

  enforceLineVerificationRateLimit_();

  try {
    response = UrlFetchApp.fetch(LINE_VERIFY_URL, {
      method: "post",
      contentType: "application/x-www-form-urlencoded",
      payload: {
        id_token: idToken,
        client_id: expectedChannelId,
      },
      muteHttpExceptions: true,
    });
  } catch (_error) {
    throw appError_("LINE_UNAVAILABLE", "目前無法向 LINE 驗證登入狀態，請稍後再試。");
  }

  var responseCode = response.getResponseCode();
  if (responseCode === 400) {
    throw appError_("INVALID_TOKEN", "LINE 登入憑證無效或已過期，請重新登入。");
  }
  if (responseCode === 429) {
    throw appError_("LINE_RATE_LIMITED", "LINE 驗證請求過於頻繁，請稍後再試。");
  }
  if (responseCode !== 200) {
    throw appError_("LINE_UNAVAILABLE", "LINE 驗證服務暫時無法使用，請稍後再試。");
  }

  var claims;
  try {
    claims = JSON.parse(response.getContentText());
  } catch (_error) {
    throw appError_("LINE_RESPONSE_ERROR", "LINE 驗證服務回傳了無法識別的資料。");
  }

  var nowSeconds = Math.floor(Date.now() / 1000);
  if (
    !claims ||
    !claims.sub ||
    String(claims.aud || "") !== expectedChannelId ||
    Number(claims.exp || 0) <= nowSeconds ||
    Number(claims.iat || 0) <= 0 ||
    String(claims.iss || "") !== "https://access.line.me"
  ) {
    throw appError_("INVALID_TOKEN", "LINE 登入憑證驗證失敗，請重新登入。");
  }

  return {
    lineUserId: limitText_(claims.sub, 128),
    displayName: limitText_(claims.name || "LINE 會員", 100),
    pictureUrl: normalizeHttpsUrl_(claims.picture),
    email: limitText_(claims.email || "", 254),
    tokenIssuedAt: Math.floor(Number(claims.iat)),
  };
}

function upsertMember_(identity, request, config) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    throw appError_("BUSY", "會員資料正在同步，請稍後再試。");
  }

  try {
    var deletedTokenIat = getMemberDeletionTombstone_(identity.lineUserId);
    if (deletedTokenIat && identity.tokenIssuedAt <= deletedTokenIat) {
      throw appError_("MEMBER_DELETED", "會員資料剛完成刪除，請重新登入後再建立會員。");
    }

    var sheet = getOrCreateMemberSheet_(config);
    var rowNumber = findMemberRow_(sheet, identity.lineUserId);
    var now = new Date();
    var context = normalizeContext_(request.context);
    var created = rowNumber === 0;
    var row;
    var isDuplicate = false;
    var recentOutcome = getRecentRequestOutcome_(identity.lineUserId, request.action, request.requestId);
    var responseCreated = created;

    if (created) {
      row = createMemberRow_(identity, request.requestId, context, now);
      sheet.appendRow(row);
      rowNumber = sheet.getLastRow();
      applyMemberRowFormats_(sheet, rowNumber);
    } else {
      row = sheet.getRange(rowNumber, 1, 1, MEMBER_HEADERS.length).getValues()[0];

      // A timed-out fetch may be repeated through the iframe bridge. The same
      // request ID must not increase the login count twice.
      isDuplicate =
        String(row[MEMBER_COLUMN.lastRequestId - 1] || "") === request.requestId ||
        Boolean(recentOutcome);
      responseCreated =
        recentOutcome === "created" ||
        (!recentOutcome &&
          String(row[MEMBER_COLUMN.lastRequestId - 1] || "") === request.requestId &&
          Number(row[MEMBER_COLUMN.loginCount - 1]) === 1);

      if (!isDuplicate) {
        var isNewLoginSession =
          Number(row[MEMBER_COLUMN.lastTokenIat - 1] || 0) !== identity.tokenIssuedAt;
        row[MEMBER_COLUMN.displayName - 1] = safeSheetText_(identity.displayName);
        row[MEMBER_COLUMN.pictureUrl - 1] = safeSheetText_(identity.pictureUrl);
        row[MEMBER_COLUMN.email - 1] = safeSheetText_(identity.email);
        row[MEMBER_COLUMN.status - 1] = "active";
        row[MEMBER_COLUMN.updatedAt - 1] = now;
        if (isNewLoginSession) {
          row[MEMBER_COLUMN.lastLoginAt - 1] = now;
          row[MEMBER_COLUMN.loginCount - 1] =
            Math.max(0, Number(row[MEMBER_COLUMN.loginCount - 1]) || 0) + 1;
        }
        row[MEMBER_COLUMN.contextType - 1] = safeSheetText_(context.type);
        row[MEMBER_COLUMN.contextOs - 1] = safeSheetText_(context.os);
        row[MEMBER_COLUMN.contextLanguage - 1] = safeSheetText_(context.language);
        row[MEMBER_COLUMN.inLiffClient - 1] = context.inClient;
        row[MEMBER_COLUMN.viewType - 1] = safeSheetText_(context.viewType);
        row[MEMBER_COLUMN.lastTokenIat - 1] = identity.tokenIssuedAt;
        row[MEMBER_COLUMN.lastRequestId - 1] = request.requestId;
        sheet.getRange(rowNumber, 1, 1, MEMBER_HEADERS.length).setValues([row]);
        applyMemberRowFormats_(sheet, rowNumber);
      }
    }

    if (created || !isDuplicate) {
      SpreadsheetApp.flush();
    }

    if (!isDuplicate) {
      markRequestProcessed_(
        identity.lineUserId,
        request.action,
        request.requestId,
        created ? "created" : "updated"
      );
    }

    return {
      data: {
        created: responseCreated,
        member: memberResponseFromRow_(row, identity, context),
      },
    };
  } catch (error) {
    if (error && error.appCode) throw error;
    throw appError_("SPREADSHEET_ERROR", "會員試算表目前無法使用，請稍後再試。");
  } finally {
    lock.releaseLock();
  }
}

function deleteMember_(identity, request, config) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    throw appError_("BUSY", "會員資料正在處理，請稍後再試。");
  }

  try {
    if (wasRequestRecentlyProcessed_(identity.lineUserId, request.action, request.requestId)) {
      return {
        data: {
          deleted: true,
          duplicate: true,
        },
      };
    }

    var sheet = getOrCreateMemberSheet_(config);
    var rowNumber = findMemberRow_(sheet, identity.lineUserId);

    if (rowNumber > 0) {
      sheet.deleteRow(rowNumber);
      SpreadsheetApp.flush();
    }

    markMemberDeleted_(identity.lineUserId, identity.tokenIssuedAt);
    markRequestProcessed_(identity.lineUserId, request.action, request.requestId, "deleted");

    return {
      data: {
        deleted: rowNumber > 0,
      },
    };
  } catch (error) {
    if (error && error.appCode) throw error;
    throw appError_("SPREADSHEET_ERROR", "目前無法刪除會員資料，請稍後再試。");
  } finally {
    lock.releaseLock();
  }
}

function createMemberRow_(identity, requestId, context, now) {
  return [
    "MBR-" + Utilities.getUuid().replace(/-/g, "").slice(0, 10).toUpperCase(),
    safeSheetText_(identity.lineUserId),
    safeSheetText_(identity.displayName),
    safeSheetText_(identity.pictureUrl),
    safeSheetText_(identity.email),
    "active",
    now,
    now,
    now,
    1,
    safeSheetText_(context.type),
    safeSheetText_(context.os),
    safeSheetText_(context.language),
    context.inClient,
    safeSheetText_(context.viewType),
    identity.tokenIssuedAt,
    requestId,
  ];
}

function memberResponseFromRow_(row, identity, context) {
  return {
    memberId: String(row[MEMBER_COLUMN.memberId - 1] || ""),
    displayName: identity.displayName,
    pictureUrl: identity.pictureUrl,
    email: identity.email,
    status: String(row[MEMBER_COLUMN.status - 1] || "active"),
    joinedAt: toIsoString_(row[MEMBER_COLUMN.joinedAt - 1]),
    updatedAt: toIsoString_(row[MEMBER_COLUMN.updatedAt - 1]),
    lastLoginAt: toIsoString_(row[MEMBER_COLUMN.lastLoginAt - 1]),
    loginCount: Math.max(0, Number(row[MEMBER_COLUMN.loginCount - 1]) || 0),
    loginContext: context,
  };
}

function getConfig_() {
  var properties = PropertiesService.getScriptProperties();
  var lineChannelId = String(properties.getProperty("LINE_CHANNEL_ID") || "").trim();
  var spreadsheetId = String(properties.getProperty("SPREADSHEET_ID") || "").trim();
  var sheetName = String(properties.getProperty("SHEET_NAME") || DEFAULT_SHEET_NAME).trim();
  var allowedOrigins = getAllowedOrigins_();

  if (!/^\d{6,}$/.test(lineChannelId) || !spreadsheetId || !sheetName || allowedOrigins.length === 0) {
    throw appError_(
      "CONFIG_ERROR",
      "GAS 尚未完成 LINE_CHANNEL_ID、SPREADSHEET_ID、SHEET_NAME 或 ALLOWED_ORIGINS 設定。"
    );
  }

  return {
    lineChannelId: lineChannelId,
    spreadsheetId: spreadsheetId,
    sheetName: sheetName.slice(0, 80),
    allowedOrigins: allowedOrigins,
  };
}

function getOrCreateMemberSheet_(config) {
  var spreadsheet;
  try {
    spreadsheet = SpreadsheetApp.openById(config.spreadsheetId);
  } catch (_error) {
    throw appError_("SPREADSHEET_ERROR", "無法開啟會員試算表，請檢查 SPREADSHEET_ID 與權限。");
  }

  var sheet = spreadsheet.getSheetByName(config.sheetName);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(config.sheetName);
  }

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, MEMBER_HEADERS.length).setValues([MEMBER_HEADERS]);
    sheet.setFrozenRows(1);
    sheet
      .getRange(1, 1, 1, MEMBER_HEADERS.length)
      .setBackground("#073b29")
      .setFontColor("#ffffff")
      .setFontWeight("bold");
    sheet.autoResizeColumns(1, MEMBER_HEADERS.length);
    applySheetColumnFormats_(sheet);
    return sheet;
  }

  var existingHeaders = sheet.getRange(1, 1, 1, MEMBER_HEADERS.length).getDisplayValues()[0];
  for (var i = 0; i < MEMBER_HEADERS.length; i += 1) {
    if (existingHeaders[i] !== MEMBER_HEADERS[i]) {
      throw appError_(
        "SCHEMA_MISMATCH",
        "Members 工作表欄位與程式版本不相符，請勿手動調整第一列欄位。"
      );
    }
  }

  return sheet;
}

function applySheetColumnFormats_(sheet) {
  var rowCount = Math.max(sheet.getMaxRows() - 1, 1);
  var textColumns = [1, 2, 3, 4, 5, 6, 11, 12, 13, 15, 17];

  textColumns.forEach(function (column) {
    sheet.getRange(2, column, rowCount, 1).setNumberFormat("@");
  });

  [7, 8, 9].forEach(function (column) {
    sheet.getRange(2, column, rowCount, 1).setNumberFormat("yyyy-mm-dd hh:mm:ss");
  });
  sheet.getRange(2, MEMBER_COLUMN.lastTokenIat, rowCount, 1).setNumberFormat("0");
}

function applyMemberRowFormats_(sheet, rowNumber) {
  sheet.getRange(rowNumber, MEMBER_COLUMN.memberId, 1, 6).setNumberFormat("@");
  sheet.getRange(rowNumber, MEMBER_COLUMN.joinedAt, 1, 3).setNumberFormat("yyyy-mm-dd hh:mm:ss");
  sheet.getRange(rowNumber, MEMBER_COLUMN.contextType, 1, 3).setNumberFormat("@");
  sheet.getRange(rowNumber, MEMBER_COLUMN.viewType).setNumberFormat("@");
  sheet.getRange(rowNumber, MEMBER_COLUMN.lastTokenIat).setNumberFormat("0");
  sheet.getRange(rowNumber, MEMBER_COLUMN.lastRequestId).setNumberFormat("@");
}

function findMemberRow_(sheet, lineUserId) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;

  var match = sheet
    .getRange(2, MEMBER_COLUMN.lineUserId, lastRow - 1, 1)
    .createTextFinder(lineUserId)
    .matchEntireCell(true)
    .matchCase(true)
    .findNext();

  return match ? match.getRow() : 0;
}

function parseRequest_(e) {
  if (!e) throw appError_("INVALID_REQUEST", "沒有收到請求內容。");

  if (e.parameter && String(e.parameter.transport || "") === "bridge") {
    return {
      action: String(e.parameter.action || ""),
      idToken: String(e.parameter.idToken || ""),
      requestId: String(e.parameter.requestId || ""),
      requestSecret: String(e.parameter.requestSecret || ""),
      callbackOrigin: normalizeOrigin_(e.parameter.callbackOrigin),
      context: parseContext_(e.parameter.context),
      transport: "bridge",
    };
  }

  var contents = e.postData && e.postData.contents ? e.postData.contents : "";
  if (!contents) throw appError_("INVALID_REQUEST", "請求內容是空的。");

  var parsed;
  try {
    parsed = JSON.parse(contents);
  } catch (_error) {
    throw appError_("INVALID_JSON", "請求內容不是有效的 JSON。");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw appError_("INVALID_REQUEST", "請求內容必須是 JSON 物件。");
  }

  return {
    action: String(parsed.action || ""),
    idToken: String(parsed.idToken || ""),
    requestId: String(parsed.requestId || ""),
    requestSecret: "",
    callbackOrigin: normalizeOrigin_(parsed.callbackOrigin),
    context: normalizeContext_(parsed.context),
    transport: "fetch",
  };
}

function validateRequestEnvelope_(request) {
  if (!/^[a-zA-Z0-9-]{10,80}$/.test(request.requestId || "")) {
    throw appError_("INVALID_REQUEST_ID", "請求識別碼格式不正確。");
  }

  if (request.action !== "upsertMember" && request.action !== "deleteMember") {
    throw appError_("UNSUPPORTED_ACTION", "不支援的會員操作。");
  }

  if (!request.idToken || request.idToken.length > MAX_ID_TOKEN_LENGTH || !isJwtLike_(request.idToken)) {
    throw appError_("INVALID_TOKEN", "LINE 登入憑證缺少或格式不正確。");
  }

  if (request.transport === "bridge" && !/^[a-f0-9]{48}$/.test(request.requestSecret || "")) {
    throw appError_("INVALID_BRIDGE", "安全回應通道格式不正確。");
  }
}

function parseContext_(value) {
  if (!value) return normalizeContext_({});
  try {
    return normalizeContext_(JSON.parse(String(value)));
  } catch (_error) {
    return normalizeContext_({});
  }
}

function normalizeContext_(context) {
  context = context && typeof context === "object" ? context : {};
  return {
    type: limitText_(context.type, 40),
    os: limitText_(context.os, 40),
    language: limitText_(context.language, 40),
    inClient: context.inClient === true || String(context.inClient) === "true",
    viewType: limitText_(context.viewType, 40),
  };
}

function isAllowedRequestOrigin_(requestedOrigin) {
  if (!requestedOrigin || !isValidOrigin_(requestedOrigin)) return false;

  return getAllowedOrigins_().indexOf(requestedOrigin) !== -1;
}

function getAllowedOrigins_() {
  var raw = String(
    PropertiesService.getScriptProperties().getProperty("ALLOWED_ORIGINS") || ""
  );
  return raw
    .split(",")
    .map(normalizeOrigin_)
    .filter(function (origin) {
      return Boolean(origin && isValidOrigin_(origin));
    });

}

function isValidOrigin_(origin) {
  return /^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(?::\d+)?$/i.test(origin);
}

function normalizeOrigin_(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function requestCacheKey_(lineUserId, action, requestId) {
  return "member-request:" + lineUserId + ":" + action + ":" + requestId;
}

function memberDeletionCacheKey_(lineUserId) {
  return "member-deleted:" + lineUserId;
}

function getMemberDeletionTombstone_(lineUserId) {
  try {
    return Number(CacheService.getScriptCache().get(memberDeletionCacheKey_(lineUserId)) || 0);
  } catch (_error) {
    return 0;
  }
}

function markMemberDeleted_(lineUserId, tokenIssuedAt) {
  try {
    CacheService.getScriptCache().put(
      memberDeletionCacheKey_(lineUserId),
      String(tokenIssuedAt || 0),
      3700
    );
  } catch (_error) {
    // Best-effort tombstone. The Sheet deletion remains authoritative.
  }
}

function getRecentRequestOutcome_(lineUserId, action, requestId) {
  try {
    return String(
      CacheService.getScriptCache().get(requestCacheKey_(lineUserId, action, requestId)) || ""
    );
  } catch (_error) {
    return "";
  }
}

function wasRequestRecentlyProcessed_(lineUserId, action, requestId) {
  return Boolean(getRecentRequestOutcome_(lineUserId, action, requestId));
}

function markRequestProcessed_(lineUserId, action, requestId, outcome) {
  try {
    CacheService.getScriptCache().put(
      requestCacheKey_(lineUserId, action, requestId),
      String(outcome || "processed"),
      600
    );
  } catch (_error) {
    // The last_request_id sheet column still provides a local fallback if the
    // best-effort Apps Script cache is unavailable.
  }
}

function isJwtLike_(value) {
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(String(value || ""));
}

function enforceLineVerificationRateLimit_() {
  var lock;
  var acquired = false;

  try {
    var properties = PropertiesService.getScriptProperties();
    var configuredLimit = Number(properties.getProperty("MAX_VERIFY_REQUESTS_PER_MINUTE") || 120);
    var limit = Math.max(1, Math.min(1000, Math.floor(configuredLimit) || 120));
    var minuteBucket = Math.floor(Date.now() / 60000);
    var cacheKey = "line-verify-count:" + minuteBucket;
    lock = LockService.getScriptLock();
    acquired = lock.tryLock(1000);

    if (!acquired) {
      throw appError_("BUSY", "會員驗證請求較多，請稍後再試。");
    }

    var cache = CacheService.getScriptCache();
    var count = Math.max(0, Number(cache.get(cacheKey)) || 0);
    if (count >= limit) {
      throw appError_("LINE_RATE_LIMITED", "會員驗證請求已達暫時上限，請稍後再試。");
    }
    cache.put(cacheKey, String(count + 1), 120);
  } catch (error) {
    if (error && error.appCode) throw error;
    // Rate limiting is best-effort. Identity validation still happens at LINE.
  } finally {
    if (acquired && lock) lock.releaseLock();
  }
}

function bridgeResponse_(result, request) {
  var targetOrigin = isValidOrigin_(request.callbackOrigin) ? request.callbackOrigin : "";
  var secret = /^[a-f0-9]{48}$/.test(request.requestSecret || "") ? request.requestSecret : "";

  if (!targetOrigin || !secret) {
    return HtmlService.createHtmlOutput("<!doctype html><meta charset=\"utf-8\"><title>Invalid bridge</title>")
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  var message = {
    type: "MEMBER_GAS_RESPONSE",
    requestId: String(request.requestId || ""),
    requestSecret: secret,
    result: result,
  };
  var html =
    "<!doctype html><html><head><meta charset=\"utf-8\"><title>Member sync</title></head>" +
    "<body><script>window.top.postMessage(" +
    safeJsonForHtml_(message) +
    "," +
    safeJsonForHtml_(targetOrigin) +
    ");<\/script></body></html>";

  return HtmlService.createHtmlOutput(html).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function jsonResponse_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}

function safeJsonForHtml_(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function errorResult_(error) {
  var code = error && error.appCode ? error.appCode : "INTERNAL_ERROR";
  var message = error && error.publicMessage ? error.publicMessage : "後台發生未預期的錯誤。";

  // Do not log request bodies or LINE tokens.
  console.error("Member API error code: " + code);

  return {
    ok: false,
    code: code,
    message: message,
  };
}

function appError_(code, publicMessage) {
  var error = new Error(publicMessage);
  error.appCode = code;
  error.publicMessage = publicMessage;
  return error;
}

function safeSheetText_(value) {
  var text = String(value == null ? "" : value);
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function limitText_(value, maxLength) {
  return String(value == null ? "" : value).trim().slice(0, maxLength || 200);
}

function normalizeHttpsUrl_(value) {
  var url = limitText_(value, 2000);
  return /^https:\/\//i.test(url) ? url : "";
}

function toIsoString_(value) {
  var date = value instanceof Date ? value : new Date(value);
  return isNaN(date.getTime()) ? "" : date.toISOString();
}
