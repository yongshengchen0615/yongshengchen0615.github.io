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
 * - ADMIN_LINE_USER_IDS: comma-separated verified LINE user IDs allowed to
 *   access administrator actions; admin actions stay disabled when omitted
 */

var API_VERSION = "1.1.0";
var DEFAULT_SHEET_NAME = "Members";
var LINE_VERIFY_URL = "https://api.line.me/oauth2/v2.1/verify";
var MAX_ID_TOKEN_LENGTH = 6000;
var DEFAULT_ADMIN_PAGE_SIZE = 50;
var MAX_ADMIN_PAGE_SIZE = 100;

var LEGACY_MEMBER_HEADERS = [
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

var MEMBER_HEADERS = LEGACY_MEMBER_HEADERS.concat([
  "access_updated_at",
  "access_updated_by",
  "last_access_request_id",
]);

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
  accessUpdatedAt: 18,
  accessUpdatedBy: 19,
  lastAccessRequestId: 20,
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
      adminCount: config.adminLineUserIds.length,
      adminConfigured: config.adminConfigValid && config.adminLineUserIds.length > 0,
      warning:
        config.adminConfigValid && config.adminLineUserIds.length > 0
          ? ""
          : "ADMIN_LINE_USER_IDS 尚未正確設定，管理員功能將保持關閉。",
      accessStatuses: ["pending", "approved", "denied"],
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

  if (request.action === "adminListMembers") {
    requireAdmin_(identity, config);
    return adminListMembers_(identity, request, config);
  }

  if (request.action === "adminSetMemberAccess") {
    requireAdmin_(identity, config);
    return adminSetMemberAccess_(identity, request, config);
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

    var access = memberAccessFromRow_(row);

    return {
      data: {
        created: responseCreated,
        access: access,
        member: access.allowed ? memberResponseFromRow_(row, identity, context) : null,
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

function adminListMembers_(adminIdentity, request, config) {
  requireAdmin_(adminIdentity, config);

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    throw appError_("BUSY", "會員資料正在更新，請稍後再試。");
  }

  try {
    var sheet = getOrCreateMemberSheet_(config);
    var lastRow = sheet.getLastRow();
    var rows =
      lastRow < 2
        ? []
        : sheet.getRange(2, 1, lastRow - 1, MEMBER_HEADERS.length).getValues();
    var metrics = {
      all: rows.length,
      pending: 0,
      approved: 0,
      denied: 0,
    };
    var members = rows.map(function (row) {
      var status = normalizeAccessStatus_(row[MEMBER_COLUMN.status - 1]);
      metrics[status] += 1;
      return adminMemberResponseFromRow_(row);
    });

    members.sort(function (left, right) {
      return dateSortValue_(right.joinedAt) - dateSortValue_(left.joinedAt);
    });

    var page = Math.max(1, Math.floor(Number(request.page) || 1));
    var pageSize = Math.max(
      1,
      Math.min(MAX_ADMIN_PAGE_SIZE, Math.floor(Number(request.pageSize) || DEFAULT_ADMIN_PAGE_SIZE))
    );
    var total = members.length;
    var startIndex = (page - 1) * pageSize;

    return {
      data: {
        members: members.slice(startIndex, startIndex + pageSize),
        metrics: metrics,
        pagination: {
          page: page,
          pageSize: pageSize,
          total: total,
          totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
        },
        admin: {
          displayName: adminIdentity.displayName,
          pictureUrl: adminIdentity.pictureUrl,
        },
      },
    };
  } catch (error) {
    if (error && error.appCode) throw error;
    throw appError_("SPREADSHEET_ERROR", "目前無法讀取會員清單，請稍後再試。");
  } finally {
    lock.releaseLock();
  }
}

function adminSetMemberAccess_(adminIdentity, request, config) {
  requireAdmin_(adminIdentity, config);

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    throw appError_("BUSY", "會員權限正在更新，請稍後再試。");
  }

  try {
    var sheet = getOrCreateMemberSheet_(config);
    var rowNumber = findMemberRowByMemberId_(sheet, request.targetMemberId);
    if (!rowNumber) {
      throw appError_("MEMBER_NOT_FOUND", "找不到指定的會員。");
    }

    var row = sheet.getRange(rowNumber, 1, 1, MEMBER_HEADERS.length).getValues()[0];
    var currentStatus = normalizeAccessStatus_(row[MEMBER_COLUMN.status - 1]);
    var lastAccessRequestId = String(row[MEMBER_COLUMN.lastAccessRequestId - 1] || "");

    if (lastAccessRequestId === request.requestId) {
      if (currentStatus !== request.accessStatus) {
        throw appError_(
          "REQUEST_ID_CONFLICT",
          "同一請求識別碼不可用於不同的權限變更。"
        );
      }

      return {
        data: {
          member: adminMemberResponseFromRow_(row),
          duplicate: true,
        },
      };
    }

    var currentAccessUpdatedAt = toIsoString_(row[MEMBER_COLUMN.accessUpdatedAt - 1]);
    var expectedAccessUpdatedAt = String(request.expectedAccessUpdatedAt || "");
    if (currentAccessUpdatedAt !== expectedAccessUpdatedAt) {
      throw appError_(
        "ACCESS_CONFLICT",
        "會員狀態已由其他管理員更新，請重新整理清單後再試。"
      );
    }

    var now = new Date();
    row[MEMBER_COLUMN.status - 1] = request.accessStatus;
    row[MEMBER_COLUMN.updatedAt - 1] = now;
    row[MEMBER_COLUMN.accessUpdatedAt - 1] = now;
    row[MEMBER_COLUMN.accessUpdatedBy - 1] = safeSheetText_(adminIdentity.lineUserId);
    row[MEMBER_COLUMN.lastAccessRequestId - 1] = request.requestId;

    sheet.getRange(rowNumber, 1, 1, MEMBER_HEADERS.length).setValues([row]);
    applyMemberRowFormats_(sheet, rowNumber);
    SpreadsheetApp.flush();

    return {
      data: {
        member: adminMemberResponseFromRow_(row),
        duplicate: false,
      },
    };
  } catch (error) {
    if (error && error.appCode) throw error;
    throw appError_("SPREADSHEET_ERROR", "目前無法更新會員權限，請稍後再試。");
  } finally {
    lock.releaseLock();
  }
}

function adminMemberResponseFromRow_(row) {
  return {
    memberId: String(row[MEMBER_COLUMN.memberId - 1] || ""),
    displayName: String(row[MEMBER_COLUMN.displayName - 1] || "LINE 會員"),
    pictureUrl: normalizeHttpsUrl_(row[MEMBER_COLUMN.pictureUrl - 1]),
    email: String(row[MEMBER_COLUMN.email - 1] || ""),
    status: normalizeAccessStatus_(row[MEMBER_COLUMN.status - 1]),
    joinedAt: toIsoString_(row[MEMBER_COLUMN.joinedAt - 1]),
    updatedAt: toIsoString_(row[MEMBER_COLUMN.updatedAt - 1]),
    lastLoginAt: toIsoString_(row[MEMBER_COLUMN.lastLoginAt - 1]),
    loginCount: Math.max(0, Number(row[MEMBER_COLUMN.loginCount - 1]) || 0),
    accessUpdatedAt: toIsoString_(row[MEMBER_COLUMN.accessUpdatedAt - 1]),
  };
}

function createMemberRow_(identity, requestId, context, now) {
  return [
    "MBR-" + Utilities.getUuid().replace(/-/g, "").slice(0, 10).toUpperCase(),
    safeSheetText_(identity.lineUserId),
    safeSheetText_(identity.displayName),
    safeSheetText_(identity.pictureUrl),
    safeSheetText_(identity.email),
    "pending",
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
    "",
    "",
    "",
  ];
}

function memberAccessFromRow_(row) {
  var status = normalizeAccessStatus_(row[MEMBER_COLUMN.status - 1]);
  return {
    status: status,
    allowed: status === "approved",
  };
}

function memberResponseFromRow_(row, identity, context) {
  return {
    memberId: String(row[MEMBER_COLUMN.memberId - 1] || ""),
    displayName: identity.displayName,
    pictureUrl: identity.pictureUrl,
    email: identity.email,
    status: normalizeAccessStatus_(row[MEMBER_COLUMN.status - 1]),
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
  var adminConfig = getAdminConfig_(properties);

  if (
    !/^\d{6,}$/.test(lineChannelId) ||
    !spreadsheetId ||
    !sheetName ||
    allowedOrigins.length === 0
  ) {
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
    adminLineUserIds: adminConfig.lineUserIds,
    adminConfigValid: adminConfig.valid,
  };
}

function getAdminLineUserIds_(properties) {
  return getAdminConfig_(properties).lineUserIds;
}

function getAdminConfig_(properties) {
  properties = properties || PropertiesService.getScriptProperties();
  var raw = String(properties.getProperty("ADMIN_LINE_USER_IDS") || "");
  var values = raw
    .split(",")
    .map(function (value) {
      return String(value || "").trim();
    })
    .filter(Boolean);
  var unique = [];
  var valid = true;

  values.forEach(function (lineUserId) {
    if (!/^U[0-9a-f]{32}$/i.test(lineUserId)) {
      valid = false;
      return;
    }
    if (unique.indexOf(lineUserId) === -1) unique.push(lineUserId);
  });

  return {
    lineUserIds: unique,
    valid: valid,
  };
}

function requireAdmin_(identity, config) {
  var adminLineUserIds = config && Array.isArray(config.adminLineUserIds)
    ? config.adminLineUserIds
    : [];
  var lineUserId = identity ? String(identity.lineUserId || "") : "";

  if (!config || config.adminConfigValid === false || adminLineUserIds.length === 0) {
    throw appError_(
      "ADMIN_CONFIG_ERROR",
      "管理員白名單尚未完成設定。"
    );
  }

  if (!lineUserId || adminLineUserIds.indexOf(lineUserId) === -1) {
    throw appError_("ADMIN_FORBIDDEN", "目前帳號沒有管理員權限。");
  }
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
    styleMemberHeader_(sheet, 1, MEMBER_HEADERS.length);
    sheet.autoResizeColumns(1, MEMBER_HEADERS.length);
    applySheetColumnFormats_(sheet);
    return sheet;
  }

  var lastColumn = sheet.getLastColumn();
  if (lastColumn === LEGACY_MEMBER_HEADERS.length) {
    var legacyHeaders = sheet
      .getRange(1, 1, 1, LEGACY_MEMBER_HEADERS.length)
      .getDisplayValues()[0];
    assertMemberHeadersMatch_(legacyHeaders, LEGACY_MEMBER_HEADERS);

    var appendedHeaders = MEMBER_HEADERS.slice(LEGACY_MEMBER_HEADERS.length);
    sheet
      .getRange(1, LEGACY_MEMBER_HEADERS.length + 1, 1, appendedHeaders.length)
      .setValues([appendedHeaders]);
    styleMemberHeader_(sheet, LEGACY_MEMBER_HEADERS.length + 1, appendedHeaders.length);
    sheet.autoResizeColumns(LEGACY_MEMBER_HEADERS.length + 1, appendedHeaders.length);
    applySheetColumnFormats_(sheet);
    SpreadsheetApp.flush();
    return sheet;
  }

  if (lastColumn !== MEMBER_HEADERS.length) throwMemberSchemaMismatch_();

  var existingHeaders = sheet.getRange(1, 1, 1, MEMBER_HEADERS.length).getDisplayValues()[0];
  assertMemberHeadersMatch_(existingHeaders, MEMBER_HEADERS);

  return sheet;
}

function assertMemberHeadersMatch_(actualHeaders, expectedHeaders) {
  for (var i = 0; i < expectedHeaders.length; i += 1) {
    if (actualHeaders[i] !== expectedHeaders[i]) throwMemberSchemaMismatch_();
  }
}

function throwMemberSchemaMismatch_() {
  throw appError_(
    "SCHEMA_MISMATCH",
    "Members 工作表欄位與程式版本不相符，請勿手動調整第一列欄位。"
  );
}

function styleMemberHeader_(sheet, startColumn, columnCount) {
  sheet
    .getRange(1, startColumn, 1, columnCount)
    .setBackground("#073b29")
    .setFontColor("#ffffff")
    .setFontWeight("bold");
}

function applySheetColumnFormats_(sheet) {
  var rowCount = Math.max(sheet.getMaxRows() - 1, 1);
  var textColumns = [1, 2, 3, 4, 5, 6, 11, 12, 13, 15, 17, 19, 20];

  textColumns.forEach(function (column) {
    sheet.getRange(2, column, rowCount, 1).setNumberFormat("@");
  });

  [7, 8, 9, MEMBER_COLUMN.accessUpdatedAt].forEach(function (column) {
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
  sheet.getRange(rowNumber, MEMBER_COLUMN.accessUpdatedAt).setNumberFormat("yyyy-mm-dd hh:mm:ss");
  sheet.getRange(rowNumber, MEMBER_COLUMN.accessUpdatedBy).setNumberFormat("@");
  sheet.getRange(rowNumber, MEMBER_COLUMN.lastAccessRequestId).setNumberFormat("@");
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

function findMemberRowByMemberId_(sheet, memberId) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;

  var match = sheet
    .getRange(2, MEMBER_COLUMN.memberId, lastRow - 1, 1)
    .createTextFinder(memberId)
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
      targetMemberId: String(e.parameter.targetMemberId || "").trim(),
      accessStatus: String(e.parameter.accessStatus || "").trim().toLowerCase(),
      expectedAccessUpdatedAt: String(e.parameter.expectedAccessUpdatedAt || "").trim(),
      page: optionalNumber_(e.parameter.page, 1),
      pageSize: optionalNumber_(e.parameter.pageSize, DEFAULT_ADMIN_PAGE_SIZE),
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
    targetMemberId: String(parsed.targetMemberId || "").trim(),
    accessStatus: String(parsed.accessStatus || "").trim().toLowerCase(),
    expectedAccessUpdatedAt: String(parsed.expectedAccessUpdatedAt || "").trim(),
    page: optionalNumber_(parsed.page, 1),
    pageSize: optionalNumber_(parsed.pageSize, DEFAULT_ADMIN_PAGE_SIZE),
    transport: "fetch",
  };
}

function validateRequestEnvelope_(request) {
  if (!/^[a-zA-Z0-9-]{10,80}$/.test(request.requestId || "")) {
    throw appError_("INVALID_REQUEST_ID", "請求識別碼格式不正確。");
  }

  if (
    ["upsertMember", "deleteMember", "adminListMembers", "adminSetMemberAccess"].indexOf(
      request.action
    ) === -1
  ) {
    throw appError_("UNSUPPORTED_ACTION", "不支援的會員操作。");
  }

  if (!request.idToken || request.idToken.length > MAX_ID_TOKEN_LENGTH || !isJwtLike_(request.idToken)) {
    throw appError_("INVALID_TOKEN", "LINE 登入憑證缺少或格式不正確。");
  }

  if (request.transport === "bridge" && !/^[a-f0-9]{48}$/.test(request.requestSecret || "")) {
    throw appError_("INVALID_BRIDGE", "安全回應通道格式不正確。");
  }

  if (request.action === "adminListMembers") {
    if (!isPositiveInteger_(request.page)) {
      throw appError_("INVALID_PAGE", "頁碼格式不正確。");
    }
    if (!isPositiveInteger_(request.pageSize) || request.pageSize > MAX_ADMIN_PAGE_SIZE) {
      throw appError_("INVALID_PAGE_SIZE", "每頁筆數必須介於 1 到 100。");
    }
  }

  if (request.action === "adminSetMemberAccess") {
    if (!/^MBR-[A-Z0-9]{10}$/.test(request.targetMemberId || "")) {
      throw appError_("INVALID_MEMBER_ID", "會員識別碼格式不正確。");
    }
    if (request.accessStatus !== "approved" && request.accessStatus !== "denied") {
      throw appError_("INVALID_ACCESS_STATUS", "會員權限狀態只能設為 approved 或 denied。");
    }
    if (
      request.expectedAccessUpdatedAt &&
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(request.expectedAccessUpdatedAt)
    ) {
      throw appError_("INVALID_ACCESS_VERSION", "會員權限版本格式不正確。");
    }
  }
}

function optionalNumber_(value, fallback) {
  return value === undefined || value === null || value === "" ? fallback : Number(value);
}

function isPositiveInteger_(value) {
  var number = Number(value);
  return number >= 1 && number !== Infinity && Math.floor(number) === number;
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

function normalizeAccessStatus_(value) {
  var status = String(value || "").trim().toLowerCase();
  if (status === "approved" || status === "active") return "approved";
  if (status === "denied") return "denied";
  return "pending";
}

function dateSortValue_(value) {
  var date = value instanceof Date ? value : new Date(value);
  var timestamp = date.getTime();
  return isNaN(timestamp) ? 0 : timestamp;
}

function toIsoString_(value) {
  var date = value instanceof Date ? value : new Date(value);
  return isNaN(date.getTime()) ? "" : date.toISOString();
}
