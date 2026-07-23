/**
 * PERSONA MEMBERS - isolated administrator Google Apps Script backend
 *
 * Required Script Properties:
 * - LINE_CHANNEL_ID: must be 2010791619 (the administrator LINE Login channel)
 * - SPREADSHEET_ID: Google Sheet ID shared with the member backend
 * - ALLOWED_ORIGINS: comma-separated frontend origins
 *
 * Optional Script Properties:
 * - SHEET_NAME: defaults to "Members"
 * - ADMIN_SHEET_NAME: defaults to "Admins"
 * - POINT_TYPE_SHEET_NAME: defaults to "PointTypes"
 * - POINT_CAMPAIGN_SHEET_NAME: defaults to "PointCampaigns"
 * - POINT_REDEMPTION_SHEET_NAME: defaults to "PointRedemptions"
 * - POINT_CARD_SETTING_SHEET_NAME: defaults to "PointCardSettings"
 * - LOTTERY_TYPE_SHEET_NAME: defaults to "LotteryTypes"
 * - LOTTERY_PRIZE_SHEET_NAME: defaults to "LotteryPrizes"
 * - LOTTERY_DRAW_SHEET_NAME: defaults to "LotteryDraws"
 * - MEMBER_LIFF_URL: defaults to the member LIFF URL
 * - MAX_VERIFY_REQUESTS_PER_MINUTE: defaults to 120 (1-1000)
 *
 * setup() creates POINT_CLAIM_SECRET when it is missing. Normal API requests
 * fail closed until that secret exists and is valid.
 *
 * Administrator approval is deliberately manual. A verified administrator
 * channel login creates an Admins row with status "pending". Only a spreadsheet
 * owner can change that cell to "approved"; no API accepts an administrator
 * status field.
 */

var API_VERSION = "1.5.0";
var SERVICE_NAME = "member-admin-api";
var REQUIRED_LINE_CHANNEL_ID = "2010791619";
var DEFAULT_SHEET_NAME = "Members";
var DEFAULT_ADMIN_SHEET_NAME = "Admins";
var DEFAULT_POINT_TYPES_SHEET_NAME = "PointTypes";
var DEFAULT_POINT_CAMPAIGNS_SHEET_NAME = "PointCampaigns";
var DEFAULT_POINT_REDEMPTIONS_SHEET_NAME = "PointRedemptions";
var DEFAULT_POINT_CARD_SETTINGS_SHEET_NAME = "PointCardSettings";
var DEFAULT_LOTTERY_TYPES_SHEET_NAME = "LotteryTypes";
var DEFAULT_LOTTERY_PRIZES_SHEET_NAME = "LotteryPrizes";
var DEFAULT_LOTTERY_DRAWS_SHEET_NAME = "LotteryDraws";
var DEFAULT_MEMBER_LIFF_URL = "https://liff.line.me/2010787602-kaiSm2eq";
var LINE_VERIFY_URL = "https://api.line.me/oauth2/v2.1/verify";
var MAX_ID_TOKEN_LENGTH = 6000;
var DEFAULT_ADMIN_PAGE_SIZE = 50;
var MAX_ADMIN_PAGE_SIZE = 100;
var MAX_POINT_VALUE = 9999;
var MAX_POINT_HISTORY_ENTRIES = 50;
var MAX_LOTTERY_DRAW_HISTORY_ENTRIES = 50;
var DEFAULT_POINT_CARD_TARGET = 5;
var LEGACY_LOTTERY_TICKET_COST = 5;
var DEFAULT_LOTTERY_TYPE_ID = "LTY-DEFAULT001";
var DEFAULT_LOTTERY_TYPE_NAME = "經典轉盤";
var DEFAULT_POINT_CARD_SETTING_VERSION = "PCS-DEFAULT00001";
var MIN_LOTTERY_PRIZES = 2;
var MAX_LOTTERY_PRIZES = 12;
var MAX_CAMPAIGN_LIFETIME_MS = 366 * 24 * 60 * 60 * 1000;
var ADMIN_ACTIONS = [
  "adminListMembers",
  "adminSetMemberAccess",
  "adminListPointTypes",
  "adminListPointHistory",
  "adminCreatePointType",
  "adminDeletePointType",
  "adminCreatePointCampaign",
  "adminGetLotteryConfig",
  "adminSavePointCardSetting",
  "adminCreateLotteryType",
  "adminDeleteLotteryType",
  "adminSaveLotteryConfig",
  "adminListLotteryDraws",
];

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

var ACCESS_AUDIT_MEMBER_HEADERS = LEGACY_MEMBER_HEADERS.concat([
  "access_updated_at",
  "access_updated_by",
  "last_access_request_id",
]);

// Preserve the former 21-column Members schema and append member-editable
// profile fields. This backend never reads admin_status as authorization.
var PRE_PROFILE_MEMBER_HEADERS = ACCESS_AUDIT_MEMBER_HEADERS.concat(["admin_status"]);
var MEMBER_HEADERS = PRE_PROFILE_MEMBER_HEADERS.concat(["phone", "birthday"]);

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
  adminStatus: 21,
  phone: 22,
  birthday: 23,
};

var ADMIN_HEADERS = [
  "admin_id",
  "line_user_id",
  "display_name",
  "picture_url",
  "email",
  "status",
  "requested_at",
  "updated_at",
  "last_login_at",
  "login_count",
  "last_token_iat",
  "last_request_id",
];

var ADMIN_COLUMN = {
  adminId: 1,
  lineUserId: 2,
  displayName: 3,
  pictureUrl: 4,
  email: 5,
  status: 6,
  requestedAt: 7,
  updatedAt: 8,
  lastLoginAt: 9,
  loginCount: 10,
  lastTokenIat: 11,
  lastRequestId: 12,
};

var LEGACY_POINT_TYPE_HEADERS = [
  "point_type_id",
  "label",
  "points",
  "status",
  "created_at",
  "updated_at",
  "created_by",
  "last_request_id",
];

var POINT_TYPE_HEADERS = LEGACY_POINT_TYPE_HEADERS.concat([
  "expiry_mode",
  "redemption_mode",
  "deleted_by",
  "delete_request_id",
]);

var POINT_TYPE_COLUMN = {
  pointTypeId: 1,
  label: 2,
  points: 3,
  status: 4,
  createdAt: 5,
  updatedAt: 6,
  createdBy: 7,
  lastRequestId: 8,
  expiryMode: 9,
  redemptionMode: 10,
  deletedBy: 11,
  deleteRequestId: 12,
};

var LEGACY_POINT_CAMPAIGN_HEADERS = [
  "campaign_id",
  "point_type_id",
  "label_snapshot",
  "points_snapshot",
  "claim_hash",
  "status",
  "expires_at",
  "created_at",
  "created_by",
  "last_request_id",
];

var POINT_CAMPAIGN_HEADERS = LEGACY_POINT_CAMPAIGN_HEADERS.concat([
  "expiry_mode_snapshot",
  "redemption_mode_snapshot",
]);

var POINT_CAMPAIGN_COLUMN = {
  campaignId: 1,
  pointTypeId: 2,
  labelSnapshot: 3,
  pointsSnapshot: 4,
  claimHash: 5,
  status: 6,
  expiresAt: 7,
  createdAt: 8,
  createdBy: 9,
  lastRequestId: 10,
  expiryModeSnapshot: 11,
  redemptionModeSnapshot: 12,
};

var LEGACY_POINT_REDEMPTION_HEADERS = [
  "redemption_id",
  "campaign_id",
  "point_type_id",
  "member_id",
  "line_user_id",
  "points",
  "balance_after",
  "redeemed_at",
  "request_id",
];

var POINT_REDEMPTION_HEADERS = LEGACY_POINT_REDEMPTION_HEADERS.concat([
  "redemption_mode_snapshot",
]);

var POINT_REDEMPTION_COLUMN = {
  redemptionId: 1,
  campaignId: 2,
  pointTypeId: 3,
  memberId: 4,
  lineUserId: 5,
  points: 6,
  balanceAfter: 7,
  redeemedAt: 8,
  requestId: 9,
  redemptionModeSnapshot: 10,
};

var POINT_CARD_SETTING_HEADERS = [
  "setting_version",
  "target_points",
  "effective_at",
  "updated_by",
  "last_request_id",
];

var POINT_CARD_SETTING_COLUMN = {
  settingVersion: 1,
  targetPoints: 2,
  effectiveAt: 3,
  updatedBy: 4,
  lastRequestId: 5,
};

var LOTTERY_TYPE_HEADERS = [
  "lottery_type_id",
  "name",
  "status",
  "created_at",
  "updated_at",
  "created_by",
  "deleted_at",
  "deleted_by",
  "last_request_id",
];

var LOTTERY_TYPE_COLUMN = {
  lotteryTypeId: 1,
  name: 2,
  status: 3,
  createdAt: 4,
  updatedAt: 5,
  createdBy: 6,
  deletedAt: 7,
  deletedBy: 8,
  lastRequestId: 9,
};

var LEGACY_LOTTERY_PRIZE_HEADERS = [
  "config_version",
  "prize_id",
  "label",
  "color",
  "probability_basis_points",
  "sort_order",
  "status",
  "updated_at",
  "updated_by",
  "last_request_id",
];

var LOTTERY_PRIZE_HEADERS = LEGACY_LOTTERY_PRIZE_HEADERS.concat([
  "lottery_type_id",
]);

var LOTTERY_PRIZE_COLUMN = {
  configVersion: 1,
  prizeId: 2,
  label: 3,
  color: 4,
  probabilityBasisPoints: 5,
  sortOrder: 6,
  status: 7,
  updatedAt: 8,
  updatedBy: 9,
  lastRequestId: 10,
  lotteryTypeId: 11,
};

var LEGACY_LOTTERY_DRAW_HEADERS = [
  "draw_id",
  "config_version",
  "prize_id",
  "prize_label_snapshot",
  "prize_color_snapshot",
  "probability_basis_points_snapshot",
  "member_id",
  "line_user_id",
  "points_spent",
  "balance_before",
  "balance_after",
  "drawn_at",
  "request_id",
];

var LOTTERY_DRAW_HEADERS = LEGACY_LOTTERY_DRAW_HEADERS.concat([
  "lottery_type_id",
  "card_setting_version",
  "card_round_key",
]);

var LOTTERY_DRAW_COLUMN = {
  drawId: 1,
  configVersion: 2,
  prizeId: 3,
  prizeLabelSnapshot: 4,
  prizeColorSnapshot: 5,
  probabilityBasisPointsSnapshot: 6,
  memberId: 7,
  lineUserId: 8,
  pointsSpent: 9,
  balanceBefore: 10,
  balanceAfter: 11,
  drawnAt: 12,
  requestId: 13,
  lotteryTypeId: 14,
  cardSettingVersion: 15,
  cardRoundKey: 16,
};

function doGet(e) {
  var action = e && e.parameter ? String(e.parameter.action || "") : "";
  var requestId = e && e.parameter ? String(e.parameter.requestId || "") : "";

  if (!action || action === "health") {
    return jsonResponse_({
      ok: true,
      requestId: requestId,
      data: {
        service: SERVICE_NAME,
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

    // callbackOrigin is client-provided and therefore only an operational
    // allowlist. The verified LINE ID token plus the Admins row are authority.
    if (!isAllowedRequestOrigin_(request.callbackOrigin)) {
      throw appError_("ORIGIN_NOT_ALLOWED", "目前網站來源未被 GAS 允許。");
    }

    result = handleAdminRequest_(request);
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

/** Run once in the Apps Script editor after configuring Script Properties. */
function setup() {
  var lock = LockService.getScriptLock();

  if (!lock.tryLock(10000)) {
    throw new Error("Could not acquire setup lock. Try again in a few seconds.");
  }

  try {
    ensurePointClaimSecretForSetup_();
    var config = getConfig_();
    var spreadsheet = openSpreadsheet_(config);
    var memberSheet = getOrCreateMemberSheet_(spreadsheet, config);
    var adminSheet = getOrCreateAdminSheet_(spreadsheet, config);
    var pointTypeSheet = getOrCreatePointTypeSheet_(spreadsheet, config);
    var pointCampaignSheet = getOrCreatePointCampaignSheet_(spreadsheet, config);
    var pointRedemptionSheet = getOrCreatePointRedemptionSheet_(spreadsheet, config);
    var pointCardSettingSheet = getOrCreatePointCardSettingSheet_(spreadsheet, config);
    var lotteryTypeSheet = getOrCreateLotteryTypeSheet_(spreadsheet, config);
    ensureDefaultPointCardSetting_(pointCardSettingSheet);
    ensureDefaultLotteryType_(lotteryTypeSheet);
    var lotteryPrizeSheet = getOrCreateLotteryPrizeSheet_(spreadsheet, config);
    var lotteryDrawSheet = getOrCreateLotteryDrawSheet_(spreadsheet, config);
    applyMemberSheetColumnFormats_(memberSheet);
    applyAdminSheetColumnFormats_(adminSheet);
    applyPointTypeSheetColumnFormats_(pointTypeSheet);
    applyPointCampaignSheetColumnFormats_(pointCampaignSheet);
    applyPointRedemptionSheetColumnFormats_(pointRedemptionSheet);
    applyPointCardSettingSheetColumnFormats_(pointCardSettingSheet);
    applyLotteryTypeSheetColumnFormats_(lotteryTypeSheet);
    applyLotteryPrizeSheetColumnFormats_(lotteryPrizeSheet);
    applyLotteryDrawSheetColumnFormats_(lotteryDrawSheet);
    SpreadsheetApp.flush();

    return {
      ok: true,
      spreadsheetId: config.spreadsheetId,
      memberSheetName: memberSheet.getName(),
      adminSheetName: adminSheet.getName(),
      pointTypesSheetName: pointTypeSheet.getName(),
      pointCampaignsSheetName: pointCampaignSheet.getName(),
      pointRedemptionsSheetName: pointRedemptionSheet.getName(),
      pointCardSettingsSheetName: pointCardSettingSheet.getName(),
      lotteryTypesSheetName: lotteryTypeSheet.getName(),
      lotteryPrizesSheetName: lotteryPrizeSheet.getName(),
      lotteryDrawsSheetName: lotteryDrawSheet.getName(),
      memberColumns: MEMBER_HEADERS.length,
      adminColumns: ADMIN_HEADERS.length,
      pointTypeColumns: POINT_TYPE_HEADERS.length,
      pointCampaignColumns: POINT_CAMPAIGN_HEADERS.length,
      pointRedemptionColumns: POINT_REDEMPTION_HEADERS.length,
      pointCardSettingColumns: POINT_CARD_SETTING_HEADERS.length,
      lotteryTypeColumns: LOTTERY_TYPE_HEADERS.length,
      lotteryPrizeColumns: LOTTERY_PRIZE_HEADERS.length,
      lotteryDrawColumns: LOTTERY_DRAW_HEADERS.length,
      approvedAdminCount: countApprovedAdmins_(adminSheet),
      pendingAdminCount: countPendingAdmins_(adminSheet),
    };
  } finally {
    lock.releaseLock();
  }
}

function handleAdminRequest_(request) {
  // Keep this guard here as well as in validateRequestEnvelope_. It prevents a
  // direct/internal call with a member action from reading configuration,
  // contacting LINE, or opening either sheet.
  if (ADMIN_ACTIONS.indexOf(request.action) === -1) {
    throw appError_("UNSUPPORTED_ACTION", "此管理服務不支援該操作。");
  }

  var config = getConfig_();
  var identity = verifyLineIdToken_(request.idToken, config.lineChannelId);

  if (request.action === "adminListMembers") {
    return adminListMembers_(identity, request, config);
  }

  if (request.action === "adminSetMemberAccess") {
    return adminSetMemberAccess_(identity, request, config);
  }

  if (request.action === "adminListPointTypes") {
    return adminListPointTypes_(identity, request, config);
  }

  if (request.action === "adminListPointHistory") {
    return adminListPointHistory_(identity, request, config);
  }

  if (request.action === "adminCreatePointType") {
    return adminCreatePointType_(identity, request, config);
  }

  if (request.action === "adminDeletePointType") {
    return adminDeletePointType_(identity, request, config);
  }

  if (request.action === "adminCreatePointCampaign") {
    return adminCreatePointCampaign_(identity, request, config);
  }

  if (request.action === "adminGetLotteryConfig") {
    return adminGetLotteryConfig_(identity, request, config);
  }

  if (request.action === "adminSavePointCardSetting") {
    return adminSavePointCardSetting_(identity, request, config);
  }

  if (request.action === "adminCreateLotteryType") {
    return adminCreateLotteryType_(identity, request, config);
  }

  if (request.action === "adminDeleteLotteryType") {
    return adminDeleteLotteryType_(identity, request, config);
  }

  if (request.action === "adminSaveLotteryConfig") {
    return adminSaveLotteryConfig_(identity, request, config);
  }

  if (request.action === "adminListLotteryDraws") {
    return adminListLotteryDraws_(identity, request, config);
  }

  throw appError_("UNSUPPORTED_ACTION", "此管理服務不支援該操作。");
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
  var issuedAt = Math.floor(Number(claims && claims.iat));
  if (
    !claims ||
    !/^U[0-9a-f]{32}$/.test(String(claims.sub || "")) ||
    String(claims.aud || "") !== expectedChannelId ||
    Number(claims.exp || 0) <= nowSeconds ||
    issuedAt <= 0 ||
    issuedAt > nowSeconds + 300 ||
    String(claims.iss || "") !== "https://access.line.me"
  ) {
    throw appError_("INVALID_TOKEN", "LINE 登入憑證驗證失敗，請重新登入。");
  }

  return {
    lineUserId: String(claims.sub),
    displayName: limitText_(claims.name || "LINE 管理員", 100),
    pictureUrl: normalizeHttpsUrl_(claims.picture),
    email: limitText_(claims.email || "", 254),
    tokenIssuedAt: issuedAt,
  };
}

function adminListMembers_(adminIdentity, request, config) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    throw appError_("BUSY", "會員資料正在更新，請稍後再試。");
  }

  try {
    var spreadsheet = openSpreadsheet_(config);
    var adminSheet = getOrCreateAdminSheet_(spreadsheet, config);
    requireApprovedAdmin_(adminIdentity, request, adminSheet);

    // Sensitive member data is not read until administrator authorization has
    // completed successfully.
    var memberSheet = getOrCreateMemberSheet_(spreadsheet, config);
    var lastRow = memberSheet.getLastRow();
    var rows =
      lastRow < 2
        ? []
        : memberSheet.getRange(2, 1, lastRow - 1, MEMBER_HEADERS.length).getValues();
    var membersById = Object.create(null);
    var membersByLineUserId = Object.create(null);
    rows = rows.filter(function (row) {
      var memberId = String(row[MEMBER_COLUMN.memberId - 1] || "").trim();
      var lineUserId = String(row[MEMBER_COLUMN.lineUserId - 1] || "").trim();

      // Member deletion clears a row instead of shifting it because this
      // independent GAS cannot share a lock with the member backend.
      if (!memberId && !lineUserId) return false;
      if (
        !/^MBR-[A-Z0-9]{10}$/.test(memberId) ||
        !/^U[0-9a-f]{32}$/.test(lineUserId) ||
        membersById[memberId] ||
        membersByLineUserId[lineUserId]
      ) {
        throw appError_(
          "MEMBER_DATA_CONFLICT",
          "會員資料識別碼缺漏或重複，請先修正試算表。"
        );
      }
      membersById[memberId] = true;
      membersByLineUserId[lineUserId] = true;
      return true;
    });
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
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    throw appError_("BUSY", "會員權限正在更新，請稍後再試。");
  }

  try {
    var spreadsheet = openSpreadsheet_(config);
    var adminSheet = getOrCreateAdminSheet_(spreadsheet, config);
    requireApprovedAdmin_(adminIdentity, request, adminSheet);
    var memberSheet = getOrCreateMemberSheet_(spreadsheet, config);
    var rowNumber = findUniqueMemberRowByMemberId_(memberSheet, request.targetMemberId);
    if (!rowNumber) {
      throw appError_("MEMBER_NOT_FOUND", "找不到指定的會員。");
    }

    var row = memberSheet
      .getRange(rowNumber, 1, 1, MEMBER_HEADERS.length)
      .getValues()[0];
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
    if (
      currentStatus !== request.expectedAccessStatus ||
      currentAccessUpdatedAt !== String(request.expectedAccessUpdatedAt || "")
    ) {
      throw appError_(
        "ACCESS_CONFLICT",
        "會員狀態已由其他管理員更新，請重新整理清單後再試。"
      );
    }

    var now = new Date();
    // These deliberately narrow writes preserve LINE profile/login fields that
    // may be synchronized concurrently by the independent member GAS project.
    memberSheet.getRange(rowNumber, MEMBER_COLUMN.status).setValues([[request.accessStatus]]);
    memberSheet.getRange(rowNumber, MEMBER_COLUMN.updatedAt).setValues([[now]]);
    memberSheet
      .getRange(rowNumber, MEMBER_COLUMN.accessUpdatedAt, 1, 3)
      .setValues([[now, safeSheetText_(adminIdentity.lineUserId), request.requestId]]);
    applyMemberRowFormats_(memberSheet, rowNumber);
    SpreadsheetApp.flush();
    row = memberSheet.getRange(rowNumber, 1, 1, MEMBER_HEADERS.length).getValues()[0];

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

function adminListPointTypes_(adminIdentity, request, config) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    throw appError_("BUSY", "點數類型正在更新，請稍後再試。");
  }

  try {
    var spreadsheet = openSpreadsheet_(config);
    var adminSheet = getOrCreateAdminSheet_(spreadsheet, config);
    requireApprovedAdmin_(adminIdentity, request, adminSheet);
    var pointTypeSheet = getOrCreatePointTypeSheet_(spreadsheet, config);
    var records = readPointTypeRecords_(pointTypeSheet);

    records.sort(function (left, right) {
      if (left.points !== right.points) return left.points - right.points;
      return left.pointTypeId < right.pointTypeId ? -1 : 1;
    });

    return {
      data: {
        pointTypes: records.map(pointTypeResponseFromRecord_),
      },
    };
  } catch (error) {
    if (error && error.appCode) throw error;
    throw appError_("SPREADSHEET_ERROR", "目前無法讀取點數類型，請稍後再試。");
  } finally {
    lock.releaseLock();
  }
}

function adminListPointHistory_(adminIdentity, request, config) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    throw appError_("BUSY", "點數紀錄正在讀取，請稍後再試。");
  }

  try {
    var spreadsheet = openSpreadsheet_(config);
    var adminSheet = getOrCreateAdminSheet_(spreadsheet, config);
    requireApprovedAdmin_(adminIdentity, request, adminSheet);
    var redemptionSheet = getOrCreatePointRedemptionSheet_(spreadsheet, config);
    var history = readAdminPointHistory_(redemptionSheet);

    history.sort(function (left, right) {
      var timeDifference = dateSortValue_(right.redeemedAt) - dateSortValue_(left.redeemedAt);
      return timeDifference || right.rowNumber - left.rowNumber;
    });

    var hasMore = history.length > MAX_POINT_HISTORY_ENTRIES;
    return {
      data: {
        history: history.slice(0, MAX_POINT_HISTORY_ENTRIES).map(function (entry) {
          return {
            redemptionId: entry.redemptionId,
            campaignId: entry.campaignId,
            pointTypeId: entry.pointTypeId,
            memberId: entry.memberId,
            label: pointLabel_(entry.points),
            points: entry.points,
            balanceAfter: entry.balanceAfter,
            redeemedAt: entry.redeemedAt,
            redemptionMode: entry.redemptionMode,
            source: "qr",
          };
        }),
        hasMore: hasMore,
      },
    };
  } catch (error) {
    if (error && error.appCode) throw error;
    throw appError_("SPREADSHEET_ERROR", "目前無法讀取點數使用紀錄，請稍後再試。");
  } finally {
    lock.releaseLock();
  }
}

function readAdminPointHistory_(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var rows = sheet
    .getRange(2, 1, lastRow - 1, POINT_REDEMPTION_HEADERS.length)
    .getValues();
  var redemptionIds = Object.create(null);
  var requestKeys = Object.create(null);
  var campaignModes = Object.create(null);
  var history = [];

  for (var i = 0; i < rows.length; i += 1) {
    var row = rows[i];
    var rowNumber = i + 2;
    var redemptionId = String(row[POINT_REDEMPTION_COLUMN.redemptionId - 1] || "").trim();
    var campaignId = String(row[POINT_REDEMPTION_COLUMN.campaignId - 1] || "").trim();
    var pointTypeId = String(row[POINT_REDEMPTION_COLUMN.pointTypeId - 1] || "").trim();
    var memberId = String(row[POINT_REDEMPTION_COLUMN.memberId - 1] || "").trim();
    var lineUserId = String(row[POINT_REDEMPTION_COLUMN.lineUserId - 1] || "").trim();
    var points = Number(row[POINT_REDEMPTION_COLUMN.points - 1]);
    var balanceAfter = Number(row[POINT_REDEMPTION_COLUMN.balanceAfter - 1]);
    var redeemedDate = row[POINT_REDEMPTION_COLUMN.redeemedAt - 1];
    var redeemedAt = toIsoString_(redeemedDate);
    var requestId = String(row[POINT_REDEMPTION_COLUMN.requestId - 1] || "").trim();
    var redemptionMode = normalizeStoredRedemptionMode_(
      row[POINT_REDEMPTION_COLUMN.redemptionModeSnapshot - 1]
    );
    var requestKey = lineUserId + ":" + requestId;
    var campaignModeKey = lineUserId + ":" + campaignId;

    if (
      !/^RDM-[A-Z0-9]{16}$/.test(redemptionId) ||
      !/^PCG-[A-Z0-9]{10}$/.test(campaignId) ||
      !/^PTY-[A-Z0-9]{10}$/.test(pointTypeId) ||
      !/^MBR-[A-Z0-9]{10}$/.test(memberId) ||
      !/^U[0-9a-f]{32}$/.test(lineUserId) ||
      !Number.isInteger(points) ||
      points < 1 ||
      points > MAX_POINT_VALUE ||
      !Number.isSafeInteger(balanceAfter) ||
      balanceAfter < points ||
      !redeemedAt ||
      !/^[a-zA-Z0-9-]{10,80}$/.test(requestId) ||
      !redemptionMode ||
      redemptionIds[redemptionId] ||
      requestKeys[requestKey] ||
      (campaignModes[campaignModeKey] &&
        (campaignModes[campaignModeKey] !== redemptionMode ||
          redemptionMode !== "repeatable"))
    ) {
      throw appError_(
        "POINT_DATA_CONFLICT",
        "點數使用紀錄第 " + rowNumber + " 列資料不正確，請先修正試算表。"
      );
    }

    redemptionIds[redemptionId] = true;
    requestKeys[requestKey] = true;
    campaignModes[campaignModeKey] = redemptionMode;
    history.push({
      rowNumber: rowNumber,
      redemptionId: redemptionId,
      campaignId: campaignId,
      pointTypeId: pointTypeId,
      memberId: memberId,
      points: points,
      balanceAfter: balanceAfter,
      redeemedAt: redeemedAt,
      redemptionMode: redemptionMode,
    });
  }

  return history;
}

function adminCreatePointType_(adminIdentity, request, config) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    throw appError_("BUSY", "點數類型正在更新，請稍後再試。");
  }

  try {
    var points = normalizePointValue_(request.points);
    var expiryMode = normalizeExpiryMode_(request.expiryMode);
    var redemptionMode = normalizeRedemptionMode_(request.redemptionMode);
    var spreadsheet = openSpreadsheet_(config);
    var adminSheet = getOrCreateAdminSheet_(spreadsheet, config);
    requireApprovedAdmin_(adminIdentity, request, adminSheet);
    var pointTypeSheet = getOrCreatePointTypeSheet_(spreadsheet, config);
    var records = readPointTypeRecords_(pointTypeSheet);
    var requestRowNumber = findUniqueRowByTextColumn_(
      pointTypeSheet,
      POINT_TYPE_COLUMN.lastRequestId,
      request.requestId,
      "POINT_DATA_CONFLICT",
      "點數類型資料有重複請求識別碼，請先修正試算表。"
    );

    if (requestRowNumber) {
      var duplicateRow = pointTypeSheet
        .getRange(requestRowNumber, 1, 1, POINT_TYPE_HEADERS.length)
        .getValues()[0];
      var duplicateRecord = pointTypeRecordFromRow_(duplicateRow, requestRowNumber);
      if (
        duplicateRecord.points !== points ||
        duplicateRecord.expiryMode !== expiryMode ||
        duplicateRecord.redemptionMode !== redemptionMode
      ) {
        throw appError_(
          "REQUEST_ID_CONFLICT",
          "同一請求識別碼不可用於不同的點數類型。"
        );
      }
      return {
        data: {
          pointType: pointTypeResponseFromRecord_(duplicateRecord),
          duplicate: true,
        },
      };
    }

    for (var i = 0; i < records.length; i += 1) {
      if (
        records[i].status === "active" &&
        records[i].points === points &&
        records[i].expiryMode === expiryMode &&
        records[i].redemptionMode === redemptionMode
      ) {
        throw appError_("POINT_TYPE_EXISTS", "相同設定的啟用點數類型已存在。");
      }
    }

    var pointTypeId = generateUniqueEntityId_(
      "PTY-",
      pointTypeSheet,
      POINT_TYPE_COLUMN.pointTypeId,
      "POINT_DATA_CONFLICT"
    );
    var now = new Date();
    pointTypeSheet.appendRow([
      pointTypeId,
      pointLabel_(points),
      points,
      "active",
      now,
      now,
      safeSheetText_(adminIdentity.lineUserId),
      request.requestId,
      expiryMode,
      redemptionMode,
      "",
      "",
    ]);
    var rowNumber = pointTypeSheet.getLastRow();
    applyPointTypeRowFormats_(pointTypeSheet, rowNumber);
    SpreadsheetApp.flush();
    var row = pointTypeSheet
      .getRange(rowNumber, 1, 1, POINT_TYPE_HEADERS.length)
      .getValues()[0];
    var record = pointTypeRecordFromRow_(row, rowNumber);

    return {
      data: {
        pointType: pointTypeResponseFromRecord_(record),
        duplicate: false,
      },
    };
  } catch (error) {
    if (error && error.appCode) throw error;
    throw appError_("SPREADSHEET_ERROR", "目前無法新增點數類型，請稍後再試。");
  } finally {
    lock.releaseLock();
  }
}

function adminDeletePointType_(adminIdentity, request, config) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    throw appError_("BUSY", "點數類型正在更新，請稍後再試。");
  }

  try {
    var pointTypeId = normalizePointTypeId_(request.pointTypeId);
    var spreadsheet = openSpreadsheet_(config);
    var adminSheet = getOrCreateAdminSheet_(spreadsheet, config);
    requireApprovedAdmin_(adminIdentity, request, adminSheet);
    var pointTypeSheet = getOrCreatePointTypeSheet_(spreadsheet, config);
    var records = readPointTypeRecords_(pointTypeSheet);
    var record = null;

    for (var i = 0; i < records.length; i += 1) {
      if (
        records[i].deleteRequestId === request.requestId &&
        records[i].pointTypeId !== pointTypeId
      ) {
        throw appError_(
          "REQUEST_ID_CONFLICT",
          "同一請求識別碼不可用於刪除不同的點數類型。"
        );
      }
      if (records[i].pointTypeId === pointTypeId) record = records[i];
    }

    if (!record) {
      throw appError_("POINT_TYPE_NOT_FOUND", "找不到指定的點數類型。");
    }

    if (record.status !== "active") {
      return {
        data: {
          pointType: pointTypeResponseFromRecord_(record),
          deleted: true,
          duplicate: true,
        },
      };
    }

    var now = new Date();
    pointTypeSheet
      .getRange(record.rowNumber, POINT_TYPE_COLUMN.status)
      .setValues([["inactive"]]);
    pointTypeSheet
      .getRange(record.rowNumber, POINT_TYPE_COLUMN.updatedAt)
      .setValues([[now]]);
    pointTypeSheet
      .getRange(record.rowNumber, POINT_TYPE_COLUMN.deletedBy, 1, 2)
      .setValues([[safeSheetText_(adminIdentity.lineUserId), request.requestId]]);
    applyPointTypeRowFormats_(pointTypeSheet, record.rowNumber);
    SpreadsheetApp.flush();

    var row = pointTypeSheet
      .getRange(record.rowNumber, 1, 1, POINT_TYPE_HEADERS.length)
      .getValues()[0];
    record = pointTypeRecordFromRow_(row, record.rowNumber);

    return {
      data: {
        pointType: pointTypeResponseFromRecord_(record),
        deleted: true,
        duplicate: false,
      },
    };
  } catch (error) {
    if (error && error.appCode) throw error;
    throw appError_("SPREADSHEET_ERROR", "目前無法刪除點數類型，請稍後再試。");
  } finally {
    lock.releaseLock();
  }
}

function adminCreatePointCampaign_(adminIdentity, request, config) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    throw appError_("BUSY", "點數 QR 正在產生，請稍後再試。");
  }

  try {
    var pointTypeId = normalizePointTypeId_(request.pointTypeId);
    var spreadsheet = openSpreadsheet_(config);
    var adminSheet = getOrCreateAdminSheet_(spreadsheet, config);
    requireApprovedAdmin_(adminIdentity, request, adminSheet);
    var pointTypeSheet = getOrCreatePointTypeSheet_(spreadsheet, config);
    var pointCampaignSheet = getOrCreatePointCampaignSheet_(spreadsheet, config);
    readPointCampaignRecords_(pointCampaignSheet);
    var requestRowNumber = findUniqueRowByTextColumn_(
      pointCampaignSheet,
      POINT_CAMPAIGN_COLUMN.lastRequestId,
      request.requestId,
      "POINT_DATA_CONFLICT",
      "點數活動資料有重複請求識別碼，請先修正試算表。"
    );

    if (requestRowNumber) {
      var duplicateRow = pointCampaignSheet
        .getRange(requestRowNumber, 1, 1, POINT_CAMPAIGN_HEADERS.length)
        .getValues()[0];
      var duplicateRecord = pointCampaignRecordFromRow_(duplicateRow, requestRowNumber);
      // A retry can arrive after a limited campaign has expired. Compare the
      // submitted ISO value with the persisted snapshot without reapplying the
      // creation-time "future" window; the original request is already durable.
      var duplicateExpiresAtIso = normalizeCampaignExpiryForComparison_(
        request.expiresAt,
        duplicateRecord.expiryMode
      );
      if (
        duplicateRecord.pointTypeId !== pointTypeId ||
        duplicateRecord.expiresAt !== duplicateExpiresAtIso
      ) {
        throw appError_(
          "REQUEST_ID_CONFLICT",
          "同一請求識別碼不可用於不同的點數 QR。"
        );
      }
      var duplicateClaim = createCampaignClaim_(
        duplicateRecord.campaignId,
        request.requestId,
        config.pointClaimSecret
      );
      if (sha256Hex_(duplicateClaim) !== duplicateRecord.claimHash) {
        throw appError_("POINT_DATA_CONFLICT", "點數活動驗證資料不一致，請先修正試算表。");
      }
      return {
        data: {
          campaign: pointCampaignResponseFromRecord_(duplicateRecord),
          claimUrl: buildPointClaimUrl_(config.memberLiffUrl, duplicateClaim),
          duplicate: true,
        },
      };
    }

    var typeRecords = readPointTypeRecords_(pointTypeSheet);
    var pointType = null;
    for (var i = 0; i < typeRecords.length; i += 1) {
      if (typeRecords[i].pointTypeId === pointTypeId) {
        if (pointType) {
          throw appError_("POINT_DATA_CONFLICT", "點數類型識別碼重複，請先修正試算表。");
        }
        pointType = typeRecords[i];
      }
    }
    if (!pointType) {
      throw appError_("POINT_TYPE_NOT_FOUND", "找不到指定的點數類型。");
    }
    if (pointType.status !== "active") {
      throw appError_("POINT_TYPE_INACTIVE", "這個點數類型目前未啟用。");
    }
    var expiresAt = parseCampaignExpiryForMode_(request.expiresAt, pointType.expiryMode);

    var campaignId = generateUniqueEntityId_(
      "PCG-",
      pointCampaignSheet,
      POINT_CAMPAIGN_COLUMN.campaignId,
      "POINT_DATA_CONFLICT"
    );
    var claim = createCampaignClaim_(
      campaignId,
      request.requestId,
      config.pointClaimSecret
    );
    var now = new Date();
    pointCampaignSheet.appendRow([
      campaignId,
      pointType.pointTypeId,
      pointType.label,
      pointType.points,
      sha256Hex_(claim),
      "active",
      expiresAt || "",
      now,
      safeSheetText_(adminIdentity.lineUserId),
      request.requestId,
      pointType.expiryMode,
      pointType.redemptionMode,
    ]);
    var rowNumber = pointCampaignSheet.getLastRow();
    applyPointCampaignRowFormats_(pointCampaignSheet, rowNumber);
    SpreadsheetApp.flush();
    var row = pointCampaignSheet
      .getRange(rowNumber, 1, 1, POINT_CAMPAIGN_HEADERS.length)
      .getValues()[0];
    var record = pointCampaignRecordFromRow_(row, rowNumber);

    return {
      data: {
        campaign: pointCampaignResponseFromRecord_(record),
        claimUrl: buildPointClaimUrl_(config.memberLiffUrl, claim),
        duplicate: false,
      },
    };
  } catch (error) {
    if (error && error.appCode) throw error;
    throw appError_("SPREADSHEET_ERROR", "目前無法產生點數 QR，請稍後再試。");
  } finally {
    lock.releaseLock();
  }
}

function adminGetLotteryConfig_(adminIdentity, request, config) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    throw appError_("BUSY", "轉盤設定正在讀取，請稍後再試。");
  }

  try {
    var spreadsheet = openSpreadsheet_(config);
    var adminSheet = getOrCreateAdminSheet_(spreadsheet, config);
    requireApprovedAdmin_(adminIdentity, request, adminSheet);
    var pointCardSettingSheet = getOrCreatePointCardSettingSheet_(spreadsheet, config);
    var lotteryTypeSheet = getOrCreateLotteryTypeSheet_(spreadsheet, config);
    var prizeSheet = getOrCreateLotteryPrizeSheet_(spreadsheet, config);
    var configs = readLotteryConfigs_(prizeSheet);
    var pointCardSettings = readPointCardSettings_(pointCardSettingSheet);
    var lotteryTypes = readLotteryTypes_(lotteryTypeSheet).filter(function (type) {
      return type.status === "active";
    });

    return {
      data: {
        pointCardSetting: pointCardSettingResponse_(
          pointCardSettings[pointCardSettings.length - 1]
        ),
        lotteryTypes: lotteryTypes.map(function (type) {
          return lotteryTypeResponse_(
            type,
            findLatestLotteryConfigForType_(configs, type.lotteryTypeId)
          );
        }),
        admin: {
          displayName: adminIdentity.displayName,
          pictureUrl: adminIdentity.pictureUrl,
        },
      },
    };
  } catch (error) {
    if (error && error.appCode) throw error;
    throw appError_("SPREADSHEET_ERROR", "目前無法讀取轉盤設定，請稍後再試。");
  } finally {
    lock.releaseLock();
  }
}

function adminSavePointCardSetting_(adminIdentity, request, config) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    throw appError_("BUSY", "集點卡規則正在儲存，請稍後再試。");
  }

  try {
    var targetPoints = normalizePointCardTarget_(request.pointCardTarget);
    var spreadsheet = openSpreadsheet_(config);
    var adminSheet = getOrCreateAdminSheet_(spreadsheet, config);
    var adminRowNumber = requireApprovedAdmin_(adminIdentity, request, adminSheet);
    var adminId = String(
      adminSheet
        .getRange(adminRowNumber, ADMIN_COLUMN.adminId)
        .getValues()[0][0] || ""
    );
    var settingSheet = getOrCreatePointCardSettingSheet_(spreadsheet, config);
    var settings = readPointCardSettings_(settingSheet);
    var duplicate = settings.filter(function (setting) {
      return setting.lastRequestId === request.requestId;
    });
    if (duplicate.length > 1) {
      throw appError_("POINT_CARD_DATA_ERROR", "集點卡設定請求識別碼重複。");
    }
    if (duplicate.length === 1) {
      if (duplicate[0].targetPoints !== targetPoints) {
        throw appError_("REQUEST_ID_CONFLICT", "同一請求不可用於不同的集點卡規則。");
      }
      return {
        data: {
          pointCardSetting: pointCardSettingResponse_(duplicate[0]),
          duplicate: true,
          changed: true,
        },
      };
    }

    var latest = settings[settings.length - 1];
    if (latest.targetPoints === targetPoints) {
      return {
        data: {
          pointCardSetting: pointCardSettingResponse_(latest),
          duplicate: false,
          changed: false,
        },
      };
    }

    var existingVersions = Object.create(null);
    settings.forEach(function (setting) {
      existingVersions[setting.settingVersion] = true;
    });
    var settingVersion = generateLotteryId_(
      "PCS-",
      12,
      existingVersions,
      "POINT_CARD_DATA_ERROR"
    );
    var now = new Date(
      Math.max(new Date().getTime(), latest.effectiveAtTime + 1)
    );
    settingSheet.appendRow([
      settingVersion,
      targetPoints,
      now,
      adminId,
      request.requestId,
    ]);
    applyPointCardSettingRowFormats_(settingSheet, settingSheet.getLastRow());
    SpreadsheetApp.flush();

    return {
      data: {
        pointCardSetting: pointCardSettingResponse_(
          readPointCardSettings_(settingSheet).slice(-1)[0]
        ),
        duplicate: false,
        changed: true,
      },
    };
  } catch (error) {
    if (error && error.appCode) throw error;
    throw appError_("SPREADSHEET_ERROR", "目前無法儲存集點卡規則，請稍後再試。");
  } finally {
    lock.releaseLock();
  }
}

function adminCreateLotteryType_(adminIdentity, request, config) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    throw appError_("BUSY", "轉盤類型正在新增，請稍後再試。");
  }

  try {
    var name = normalizeLotteryTypeName_(request.lotteryTypeName);
    var spreadsheet = openSpreadsheet_(config);
    var adminSheet = getOrCreateAdminSheet_(spreadsheet, config);
    var adminRowNumber = requireApprovedAdmin_(adminIdentity, request, adminSheet);
    var adminId = String(
      adminSheet
        .getRange(adminRowNumber, ADMIN_COLUMN.adminId)
        .getValues()[0][0] || ""
    );
    var typeSheet = getOrCreateLotteryTypeSheet_(spreadsheet, config);
    var types = readLotteryTypes_(typeSheet);
    var duplicate = types.filter(function (type) {
      return type.lastRequestId === request.requestId;
    });
    if (duplicate.length > 1) {
      throw appError_("LOTTERY_DATA_ERROR", "轉盤類型請求識別碼重複。");
    }
    if (duplicate.length === 1) {
      if (duplicate[0].name !== name || duplicate[0].status !== "active") {
        throw appError_("REQUEST_ID_CONFLICT", "同一請求不可用於不同的轉盤類型。");
      }
      return { data: { lotteryType: lotteryTypeResponse_(duplicate[0], null), duplicate: true } };
    }
    if (
      types.some(function (type) {
        return type.status === "active" && type.name.toLowerCase() === name.toLowerCase();
      })
    ) {
      throw appError_("LOTTERY_TYPE_EXISTS", "已有相同名稱的轉盤類型。");
    }

    var existingIds = Object.create(null);
    types.forEach(function (type) {
      existingIds[type.lotteryTypeId] = true;
    });
    var lotteryTypeId = generateLotteryId_(
      "LTY-",
      10,
      existingIds,
      "LOTTERY_DATA_ERROR"
    );
    var now = new Date();
    typeSheet.appendRow([
      lotteryTypeId,
      safeSheetText_(name),
      "active",
      now,
      now,
      adminId,
      "",
      "",
      request.requestId,
    ]);
    applyLotteryTypeRowFormats_(typeSheet, typeSheet.getLastRow());
    SpreadsheetApp.flush();
    var created = readLotteryTypes_(typeSheet).filter(function (type) {
      return type.lotteryTypeId === lotteryTypeId;
    })[0];
    return { data: { lotteryType: lotteryTypeResponse_(created, null), duplicate: false } };
  } catch (error) {
    if (error && error.appCode) throw error;
    throw appError_("SPREADSHEET_ERROR", "目前無法新增轉盤類型，請稍後再試。");
  } finally {
    lock.releaseLock();
  }
}

function adminDeleteLotteryType_(adminIdentity, request, config) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    throw appError_("BUSY", "轉盤類型正在刪除，請稍後再試。");
  }

  try {
    var lotteryTypeId = normalizeLotteryTypeId_(request.lotteryTypeId);
    var spreadsheet = openSpreadsheet_(config);
    var adminSheet = getOrCreateAdminSheet_(spreadsheet, config);
    var adminRowNumber = requireApprovedAdmin_(adminIdentity, request, adminSheet);
    var adminId = String(
      adminSheet
        .getRange(adminRowNumber, ADMIN_COLUMN.adminId)
        .getValues()[0][0] || ""
    );
    var typeSheet = getOrCreateLotteryTypeSheet_(spreadsheet, config);
    var types = readLotteryTypes_(typeSheet);
    var type = findLotteryType_(types, lotteryTypeId, true);
    if (type.status === "deleted") {
      return { data: { deleted: true, duplicate: true, lotteryTypeId: lotteryTypeId } };
    }
    var now = new Date();
    typeSheet
      .getRange(type.rowNumber, LOTTERY_TYPE_COLUMN.status, 1, 7)
      .setValues([[
        "deleted",
        type.createdAtValue,
        now,
        type.createdBy,
        now,
        adminId,
        type.lastRequestId,
      ]]);
    applyLotteryTypeRowFormats_(typeSheet, type.rowNumber);
    SpreadsheetApp.flush();
    return { data: { deleted: true, duplicate: false, lotteryTypeId: lotteryTypeId } };
  } catch (error) {
    if (error && error.appCode) throw error;
    throw appError_("SPREADSHEET_ERROR", "目前無法刪除轉盤類型，請稍後再試。");
  } finally {
    lock.releaseLock();
  }
}

function adminSaveLotteryConfig_(adminIdentity, request, config) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    throw appError_("BUSY", "轉盤設定正在儲存，請稍後再試。");
  }

  try {
    var lotteryTypeId = normalizeLotteryTypeId_(request.lotteryTypeId);
    var submittedPrizes = normalizeLotteryPrizes_(request.lotteryPrizes);
    var spreadsheet = openSpreadsheet_(config);
    var adminSheet = getOrCreateAdminSheet_(spreadsheet, config);
    var adminRowNumber = requireApprovedAdmin_(adminIdentity, request, adminSheet);
    var adminRow = adminSheet
      .getRange(adminRowNumber, 1, 1, ADMIN_HEADERS.length)
      .getValues()[0];
    var adminId = String(adminRow[ADMIN_COLUMN.adminId - 1] || "");
    if (!/^ADM-[A-Z0-9]{10}$/.test(adminId)) {
      throw appError_("ADMIN_FORBIDDEN", "目前帳號沒有管理員權限。");
    }
    var typeSheet = getOrCreateLotteryTypeSheet_(spreadsheet, config);
    var lotteryType = findLotteryType_(
      readLotteryTypes_(typeSheet),
      lotteryTypeId,
      false
    );

    var prizeSheet = getOrCreateLotteryPrizeSheet_(spreadsheet, config);
    var configs = readLotteryConfigs_(prizeSheet);
    var duplicateConfig = null;
    configs.forEach(function (lotteryConfig) {
      if (lotteryConfig.lastRequestId !== request.requestId) return;
      if (duplicateConfig) {
        throw appError_("LOTTERY_DATA_ERROR", "轉盤設定請求識別碼重複。");
      }
      duplicateConfig = lotteryConfig;
    });

    if (duplicateConfig) {
      if (!lotteryConfigMatchesSubmission_(duplicateConfig, submittedPrizes)) {
        throw appError_(
          "REQUEST_ID_CONFLICT",
          "同一請求識別碼不可用於不同的轉盤設定。"
        );
      }
      if (duplicateConfig.lotteryTypeId !== lotteryType.lotteryTypeId) {
        throw appError_("REQUEST_ID_CONFLICT", "同一請求不可用於不同的轉盤類型。");
      }
      return {
        data: {
          lottery: lotteryConfigResponse_(duplicateConfig),
          duplicate: true,
        },
      };
    }

    var existingConfigVersions = Object.create(null);
    var existingPrizeIds = Object.create(null);
    configs.forEach(function (lotteryConfig) {
      existingConfigVersions[lotteryConfig.configVersion] = true;
      lotteryConfig.prizes.forEach(function (prize) {
        existingPrizeIds[prize.prizeId] = true;
      });
    });
    var configVersion = generateLotteryId_(
      "LCF-",
      12,
      existingConfigVersions,
      "LOTTERY_DATA_ERROR"
    );
    var now = new Date();
    var rows = submittedPrizes.map(function (prize, index) {
      var prizeId = generateLotteryId_(
        "LPR-",
        10,
        existingPrizeIds,
        "LOTTERY_DATA_ERROR"
      );
      existingPrizeIds[prizeId] = true;
      return [
        configVersion,
        prizeId,
        safeSheetText_(prize.label),
        prize.color,
        prize.probabilityBasisPoints,
        index + 1,
        "active",
        now,
        adminId,
        request.requestId,
        lotteryTypeId,
      ];
    });
    var startRow = prizeSheet.getLastRow() + 1;
    prizeSheet
      .getRange(startRow, 1, rows.length, LOTTERY_PRIZE_HEADERS.length)
      .setValues(rows);
    applyLotteryPrizeRowFormats_(prizeSheet, startRow, rows.length);
    SpreadsheetApp.flush();

    configs = readLotteryConfigs_(prizeSheet);
    var savedConfig = configs[configs.length - 1];
    if (!savedConfig || savedConfig.configVersion !== configVersion) {
      throw appError_("LOTTERY_DATA_ERROR", "轉盤設定儲存後無法確認資料。");
    }

    return {
      data: {
        lottery: lotteryConfigResponse_(savedConfig),
        duplicate: false,
      },
    };
  } catch (error) {
    if (error && error.appCode) throw error;
    throw appError_("SPREADSHEET_ERROR", "目前無法儲存轉盤設定，請稍後再試。");
  } finally {
    lock.releaseLock();
  }
}

function adminListLotteryDraws_(adminIdentity, request, config) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    throw appError_("BUSY", "抽獎紀錄正在讀取，請稍後再試。");
  }

  try {
    var spreadsheet = openSpreadsheet_(config);
    var adminSheet = getOrCreateAdminSheet_(spreadsheet, config);
    requireApprovedAdmin_(adminIdentity, request, adminSheet);
    var drawSheet = getOrCreateLotteryDrawSheet_(spreadsheet, config);
    var typeSheet = getOrCreateLotteryTypeSheet_(spreadsheet, config);
    var memberSheet = getOrCreateMemberSheet_(spreadsheet, config);
    var membersById = readMemberNamesById_(memberSheet);
    var lotteryTypeNames = Object.create(null);
    readLotteryTypes_(typeSheet).forEach(function (type) {
      lotteryTypeNames[type.lotteryTypeId] = type.name;
    });
    var draws = readAdminLotteryDraws_(drawSheet);
    draws.sort(function (left, right) {
      return (
        dateSortValue_(right.drawnAt) - dateSortValue_(left.drawnAt) ||
        right.rowNumber - left.rowNumber
      );
    });
    var hasMore = draws.length > MAX_LOTTERY_DRAW_HISTORY_ENTRIES;

    return {
      data: {
        draws: draws
          .slice(0, MAX_LOTTERY_DRAW_HISTORY_ENTRIES)
          .map(function (draw) {
            return {
              drawId: draw.drawId,
              configVersion: draw.configVersion,
              prizeId: draw.prizeId,
              prizeLabel: draw.prizeLabel,
              prizeColor: draw.prizeColor,
              lotteryTypeId: draw.lotteryTypeId,
              lotteryTypeName:
                lotteryTypeNames[draw.lotteryTypeId] || "已刪除轉盤",
              memberId: draw.memberId,
              memberDisplayName: membersById[draw.memberId] || "已刪除會員",
              ticketCost: draw.pointsSpent,
              originalPointBalance: draw.balanceBefore,
              pointBalance: draw.balanceAfter,
              usedCardRound: !draw.legacyDraw,
              drawnAt: draw.drawnAt,
            };
          }),
        hasMore: hasMore,
      },
    };
  } catch (error) {
    if (error && error.appCode) throw error;
    throw appError_("SPREADSHEET_ERROR", "目前無法讀取抽獎紀錄，請稍後再試。");
  } finally {
    lock.releaseLock();
  }
}

function requireApprovedAdmin_(identity, request, adminSheet) {
  var matches = findAdminRows_(adminSheet, identity.lineUserId);

  // Duplicate identities are ambiguous and must never grant access.
  if (matches.length > 1) {
    throw appError_("ADMIN_FORBIDDEN", "目前帳號沒有管理員權限。");
  }

  var now = new Date();
  if (matches.length === 0) {
    adminSheet.appendRow(createPendingAdminRow_(identity, request.requestId, now));
    var createdRowNumber = adminSheet.getLastRow();
    applyAdminRowFormats_(adminSheet, createdRowNumber);
    SpreadsheetApp.flush();
    throw appError_(
      "ADMIN_PENDING",
      "管理員申請已建立，請由試算表管理者核准後再試。"
    );
  }

  var rowNumber = matches[0];
  var row = adminSheet.getRange(rowNumber, 1, 1, ADMIN_HEADERS.length).getValues()[0];
  assertUniqueAdminId_(adminSheet, rowNumber, row);
  var status = strictAdminStatus_(row[ADMIN_COLUMN.status - 1]);

  if (status !== "approved" && status !== "pending") {
    throw appError_("ADMIN_FORBIDDEN", "目前帳號沒有管理員權限。");
  }

  var isDuplicate = String(row[ADMIN_COLUMN.lastRequestId - 1] || "") === request.requestId;
  if (!isDuplicate) {
    var isNewLoginSession =
      Number(row[ADMIN_COLUMN.lastTokenIat - 1] || 0) !== identity.tokenIssuedAt;
    adminSheet
      .getRange(rowNumber, ADMIN_COLUMN.displayName, 1, 3)
      .setValues([
        [
          safeSheetText_(identity.displayName),
          safeSheetText_(identity.pictureUrl),
          safeSheetText_(identity.email),
        ],
      ]);
    adminSheet.getRange(rowNumber, ADMIN_COLUMN.updatedAt).setValues([[now]]);
    if (isNewLoginSession) {
      adminSheet
        .getRange(rowNumber, ADMIN_COLUMN.lastLoginAt, 1, 2)
        .setValues([
          [now, Math.max(0, Number(row[ADMIN_COLUMN.loginCount - 1]) || 0) + 1],
        ]);
    }
    adminSheet
      .getRange(rowNumber, ADMIN_COLUMN.lastTokenIat, 1, 2)
      .setValues([[identity.tokenIssuedAt, request.requestId]]);
    applyAdminRowFormats_(adminSheet, rowNumber);
    SpreadsheetApp.flush();
  }

  // Spreadsheet edits are not covered by LockService. Re-read the status after
  // field-level writes so an owner's manual approval/denial is never overwritten.
  row = adminSheet.getRange(rowNumber, 1, 1, ADMIN_HEADERS.length).getValues()[0];
  var refreshedMatches = findAdminRows_(adminSheet, identity.lineUserId);
  if (refreshedMatches.length !== 1 || refreshedMatches[0] !== rowNumber) {
    throw appError_("ADMIN_FORBIDDEN", "目前帳號沒有管理員權限。");
  }
  assertUniqueAdminId_(adminSheet, rowNumber, row);
  status = strictAdminStatus_(row[ADMIN_COLUMN.status - 1]);

  if (status === "pending") {
    throw appError_("ADMIN_PENDING", "管理員申請仍在等待試算表管理者核准。");
  }
  if (status !== "approved") {
    throw appError_("ADMIN_FORBIDDEN", "目前帳號沒有管理員權限。");
  }

  return rowNumber;
}

function assertUniqueAdminId_(sheet, rowNumber, row) {
  var adminId = String(row[ADMIN_COLUMN.adminId - 1] || "");
  if (!/^ADM-[A-Z0-9]{10}$/.test(adminId)) {
    throw appError_("ADMIN_FORBIDDEN", "目前帳號沒有管理員權限。");
  }

  var lastRow = sheet.getLastRow();
  var values = sheet
    .getRange(2, ADMIN_COLUMN.adminId, Math.max(lastRow - 1, 1), 1)
    .getValues();
  var matchedRow = 0;
  for (var i = 0; i < values.length; i += 1) {
    if (String(values[i][0] || "") !== adminId) continue;
    if (matchedRow !== 0) {
      throw appError_("ADMIN_FORBIDDEN", "目前帳號沒有管理員權限。");
    }
    matchedRow = i + 2;
  }

  if (matchedRow !== rowNumber) {
    throw appError_("ADMIN_FORBIDDEN", "目前帳號沒有管理員權限。");
  }
}

function createPendingAdminRow_(identity, requestId, now) {
  return [
    "ADM-" + Utilities.getUuid().replace(/-/g, "").slice(0, 10).toUpperCase(),
    safeSheetText_(identity.lineUserId),
    safeSheetText_(identity.displayName),
    safeSheetText_(identity.pictureUrl),
    safeSheetText_(identity.email),
    "pending",
    now,
    now,
    now,
    1,
    identity.tokenIssuedAt,
    requestId,
  ];
}

function adminMemberResponseFromRow_(row) {
  return {
    memberId: String(row[MEMBER_COLUMN.memberId - 1] || ""),
    displayName: String(row[MEMBER_COLUMN.displayName - 1] || "LINE 會員"),
    pictureUrl: normalizeHttpsUrl_(row[MEMBER_COLUMN.pictureUrl - 1]),
    phone: memberPhoneFromRow_(row),
    birthday: memberBirthdayFromRow_(row),
    status: normalizeAccessStatus_(row[MEMBER_COLUMN.status - 1]),
    joinedAt: toIsoString_(row[MEMBER_COLUMN.joinedAt - 1]),
    updatedAt: toIsoString_(row[MEMBER_COLUMN.updatedAt - 1]),
    lastLoginAt: toIsoString_(row[MEMBER_COLUMN.lastLoginAt - 1]),
    loginCount: Math.max(0, Number(row[MEMBER_COLUMN.loginCount - 1]) || 0),
    accessUpdatedAt: toIsoString_(row[MEMBER_COLUMN.accessUpdatedAt - 1]),
  };
}

function getConfig_() {
  var properties = PropertiesService.getScriptProperties();
  var lineChannelId = String(properties.getProperty("LINE_CHANNEL_ID") || "").trim();
  var spreadsheetId = String(properties.getProperty("SPREADSHEET_ID") || "").trim();
  var sheetName = String(properties.getProperty("SHEET_NAME") || DEFAULT_SHEET_NAME).trim();
  var adminSheetName = String(
    properties.getProperty("ADMIN_SHEET_NAME") || DEFAULT_ADMIN_SHEET_NAME
  ).trim();
  var pointTypesSheetName = String(
    properties.getProperty("POINT_TYPE_SHEET_NAME") || DEFAULT_POINT_TYPES_SHEET_NAME
  ).trim();
  var pointCampaignsSheetName = String(
    properties.getProperty("POINT_CAMPAIGN_SHEET_NAME") ||
      DEFAULT_POINT_CAMPAIGNS_SHEET_NAME
  ).trim();
  var pointRedemptionsSheetName = String(
    properties.getProperty("POINT_REDEMPTION_SHEET_NAME") ||
      DEFAULT_POINT_REDEMPTIONS_SHEET_NAME
  ).trim();
  var pointCardSettingsSheetName = String(
    properties.getProperty("POINT_CARD_SETTING_SHEET_NAME") ||
      DEFAULT_POINT_CARD_SETTINGS_SHEET_NAME
  ).trim();
  var lotteryTypesSheetName = String(
    properties.getProperty("LOTTERY_TYPE_SHEET_NAME") ||
      DEFAULT_LOTTERY_TYPES_SHEET_NAME
  ).trim();
  var lotteryPrizesSheetName = String(
    properties.getProperty("LOTTERY_PRIZE_SHEET_NAME") ||
      DEFAULT_LOTTERY_PRIZES_SHEET_NAME
  ).trim();
  var lotteryDrawsSheetName = String(
    properties.getProperty("LOTTERY_DRAW_SHEET_NAME") ||
      DEFAULT_LOTTERY_DRAWS_SHEET_NAME
  ).trim();
  var memberLiffUrl = normalizeMemberLiffUrl_(
    properties.getProperty("MEMBER_LIFF_URL") || DEFAULT_MEMBER_LIFF_URL
  );
  var pointClaimSecret = String(properties.getProperty("POINT_CLAIM_SECRET") || "").trim();
  var allowedOrigins = getAllowedOrigins_();
  var sheetNames = [
    sheetName,
    adminSheetName,
    pointTypesSheetName,
    pointCampaignsSheetName,
    pointRedemptionsSheetName,
    pointCardSettingsSheetName,
    lotteryTypesSheetName,
    lotteryPrizesSheetName,
    lotteryDrawsSheetName,
  ];

  if (
    lineChannelId !== REQUIRED_LINE_CHANNEL_ID ||
    !spreadsheetId ||
    !hasUniqueValidSheetNames_(sheetNames) ||
    !memberLiffUrl ||
    !isValidPointClaimSecret_(pointClaimSecret) ||
    allowedOrigins.length === 0
  ) {
    throw appError_(
      "CONFIG_ERROR",
      "管理 GAS 的 LINE、試算表、點數、LIFF 或網站來源設定不完整。"
    );
  }

  return {
    lineChannelId: lineChannelId,
    spreadsheetId: spreadsheetId,
    sheetName: sheetName,
    adminSheetName: adminSheetName,
    pointTypesSheetName: pointTypesSheetName,
    pointCampaignsSheetName: pointCampaignsSheetName,
    pointRedemptionsSheetName: pointRedemptionsSheetName,
    pointCardSettingsSheetName: pointCardSettingsSheetName,
    lotteryTypesSheetName: lotteryTypesSheetName,
    lotteryPrizesSheetName: lotteryPrizesSheetName,
    lotteryDrawsSheetName: lotteryDrawsSheetName,
    memberLiffUrl: memberLiffUrl,
    pointClaimSecret: pointClaimSecret,
    allowedOrigins: allowedOrigins,
  };
}

function ensurePointClaimSecretForSetup_() {
  var properties = PropertiesService.getScriptProperties();
  var secret = String(properties.getProperty("POINT_CLAIM_SECRET") || "").trim();
  if (!secret) {
    secret =
      Utilities.getUuid().replace(/-/g, "") +
      Utilities.getUuid().replace(/-/g, "");
    properties.setProperty("POINT_CLAIM_SECRET", secret);
  }
  if (!isValidPointClaimSecret_(secret)) {
    throw appError_(
      "CONFIG_ERROR",
      "POINT_CLAIM_SECRET 格式不正確，請使用至少 32 個英數、底線或連字號字元。"
    );
  }
  return secret;
}

function hasUniqueValidSheetNames_(names) {
  var normalized = [];
  for (var i = 0; i < names.length; i += 1) {
    var name = String(names[i] || "").trim();
    var lower = name.toLowerCase();
    if (!name || name.length > 80 || normalized.indexOf(lower) !== -1) {
      return false;
    }
    normalized.push(lower);
  }
  return true;
}

function normalizeMemberLiffUrl_(value) {
  var normalized = String(value || "").trim().replace(/\/+$/, "");
  return normalized === DEFAULT_MEMBER_LIFF_URL ? normalized : "";
}

function isValidPointClaimSecret_(value) {
  return /^[A-Za-z0-9_-]{32,256}$/.test(String(value || ""));
}

function openSpreadsheet_(config) {
  try {
    return SpreadsheetApp.openById(config.spreadsheetId);
  } catch (_error) {
    throw appError_("SPREADSHEET_ERROR", "無法開啟試算表，請檢查 SPREADSHEET_ID 與權限。");
  }
}

function getOrCreateMemberSheet_(spreadsheet, config) {
  var sheet = spreadsheet.getSheetByName(config.sheetName);
  if (!sheet) sheet = spreadsheet.insertSheet(config.sheetName);

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, MEMBER_HEADERS.length).setValues([MEMBER_HEADERS]);
    sheet.setFrozenRows(1);
    styleHeader_(sheet, 1, MEMBER_HEADERS.length, "#073b29");
    sheet.autoResizeColumns(1, MEMBER_HEADERS.length);
    applyMemberSheetColumnFormats_(sheet);
    return sheet;
  }

  var lastColumn = sheet.getLastColumn();
  if (
    lastColumn === LEGACY_MEMBER_HEADERS.length ||
    lastColumn === ACCESS_AUDIT_MEMBER_HEADERS.length ||
    lastColumn === PRE_PROFILE_MEMBER_HEADERS.length
  ) {
    var previousHeaders = PRE_PROFILE_MEMBER_HEADERS;
    if (lastColumn === LEGACY_MEMBER_HEADERS.length) {
      previousHeaders = LEGACY_MEMBER_HEADERS;
    } else if (lastColumn === ACCESS_AUDIT_MEMBER_HEADERS.length) {
      previousHeaders = ACCESS_AUDIT_MEMBER_HEADERS;
    }
    assertHeadersMatch_(
      sheet.getRange(1, 1, 1, previousHeaders.length).getDisplayValues()[0],
      previousHeaders,
      "MEMBER_SCHEMA_MISMATCH"
    );
    var appendedHeaders = MEMBER_HEADERS.slice(previousHeaders.length);
    sheet
      .getRange(1, previousHeaders.length + 1, 1, appendedHeaders.length)
      .setValues([appendedHeaders]);
    styleHeader_(sheet, previousHeaders.length + 1, appendedHeaders.length, "#073b29");
    sheet.autoResizeColumns(previousHeaders.length + 1, appendedHeaders.length);
    applyMemberSheetColumnFormats_(sheet);
    SpreadsheetApp.flush();
    return sheet;
  }

  if (lastColumn !== MEMBER_HEADERS.length) {
    throw appError_(
      "MEMBER_SCHEMA_MISMATCH",
      "Members 工作表欄位與管理程式版本不相符，請勿手動調整第一列欄位。"
    );
  }

  assertHeadersMatch_(
    sheet.getRange(1, 1, 1, MEMBER_HEADERS.length).getDisplayValues()[0],
    MEMBER_HEADERS,
    "MEMBER_SCHEMA_MISMATCH"
  );
  return sheet;
}

function getOrCreateAdminSheet_(spreadsheet, config) {
  var sheet = spreadsheet.getSheetByName(config.adminSheetName);
  if (!sheet) sheet = spreadsheet.insertSheet(config.adminSheetName);

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, ADMIN_HEADERS.length).setValues([ADMIN_HEADERS]);
    sheet.setFrozenRows(1);
    styleHeader_(sheet, 1, ADMIN_HEADERS.length, "#172238");
    sheet.autoResizeColumns(1, ADMIN_HEADERS.length);
    applyAdminSheetColumnFormats_(sheet);
    return sheet;
  }

  if (sheet.getLastColumn() !== ADMIN_HEADERS.length) {
    throw appError_(
      "ADMIN_SCHEMA_MISMATCH",
      "Admins 工作表欄位與管理程式版本不相符，請勿手動調整第一列欄位。"
    );
  }

  assertHeadersMatch_(
    sheet.getRange(1, 1, 1, ADMIN_HEADERS.length).getDisplayValues()[0],
    ADMIN_HEADERS,
    "ADMIN_SCHEMA_MISMATCH"
  );
  return sheet;
}

function getOrCreatePointTypeSheet_(spreadsheet, config) {
  return getOrCreateExactPointSheet_(
    spreadsheet,
    config.pointTypesSheetName,
    POINT_TYPE_HEADERS,
    LEGACY_POINT_TYPE_HEADERS,
    ["limited", "once_per_member", "", ""],
    "POINT_TYPE_SCHEMA_MISMATCH",
    "#245c47",
    applyPointTypeSheetColumnFormats_
  );
}

function getOrCreatePointCampaignSheet_(spreadsheet, config) {
  return getOrCreateExactPointSheet_(
    spreadsheet,
    config.pointCampaignsSheetName,
    POINT_CAMPAIGN_HEADERS,
    LEGACY_POINT_CAMPAIGN_HEADERS,
    ["limited", "once_per_member"],
    "POINT_CAMPAIGN_SCHEMA_MISMATCH",
    "#654f22",
    applyPointCampaignSheetColumnFormats_
  );
}

function getOrCreatePointRedemptionSheet_(spreadsheet, config) {
  return getOrCreateExactPointSheet_(
    spreadsheet,
    config.pointRedemptionsSheetName,
    POINT_REDEMPTION_HEADERS,
    LEGACY_POINT_REDEMPTION_HEADERS,
    ["once_per_member"],
    "POINT_REDEMPTION_SCHEMA_MISMATCH",
    "#334d70",
    applyPointRedemptionSheetColumnFormats_
  );
}

function getOrCreatePointCardSettingSheet_(spreadsheet, config) {
  return getOrCreateExactPointSheet_(
    spreadsheet,
    config.pointCardSettingsSheetName,
    POINT_CARD_SETTING_HEADERS,
    [],
    [],
    "POINT_CARD_SCHEMA_MISMATCH",
    "#0f766e",
    applyPointCardSettingSheetColumnFormats_
  );
}

function getOrCreateLotteryTypeSheet_(spreadsheet, config) {
  return getOrCreateExactPointSheet_(
    spreadsheet,
    config.lotteryTypesSheetName,
    LOTTERY_TYPE_HEADERS,
    [],
    [],
    "LOTTERY_SCHEMA_MISMATCH",
    "#365314",
    applyLotteryTypeSheetColumnFormats_
  );
}

function getOrCreateLotteryPrizeSheet_(spreadsheet, config) {
  return getOrCreateExactPointSheet_(
    spreadsheet,
    config.lotteryPrizesSheetName,
    LOTTERY_PRIZE_HEADERS,
    LEGACY_LOTTERY_PRIZE_HEADERS,
    [DEFAULT_LOTTERY_TYPE_ID],
    "LOTTERY_SCHEMA_MISMATCH",
    "#6b3f24",
    applyLotteryPrizeSheetColumnFormats_
  );
}

function getOrCreateLotteryDrawSheet_(spreadsheet, config) {
  return getOrCreateExactPointSheet_(
    spreadsheet,
    config.lotteryDrawsSheetName,
    LOTTERY_DRAW_HEADERS,
    LEGACY_LOTTERY_DRAW_HEADERS,
    ["", "", ""],
    "LOTTERY_SCHEMA_MISMATCH",
    "#43345f",
    applyLotteryDrawSheetColumnFormats_
  );
}

function ensureDefaultPointCardSetting_(sheet) {
  if (sheet.getLastRow() >= 2) return;
  sheet.appendRow([
    DEFAULT_POINT_CARD_SETTING_VERSION,
    DEFAULT_POINT_CARD_TARGET,
    new Date(0),
    "SYSTEM",
    "setup-default-card",
  ]);
  applyPointCardSettingRowFormats_(sheet, sheet.getLastRow());
}

function ensureDefaultLotteryType_(sheet) {
  if (sheet.getLastRow() >= 2) return;
  var epoch = new Date(0);
  sheet.appendRow([
    DEFAULT_LOTTERY_TYPE_ID,
    safeSheetText_(DEFAULT_LOTTERY_TYPE_NAME),
    "active",
    epoch,
    epoch,
    "SYSTEM",
    "",
    "",
    "setup-default-type",
  ]);
  applyLotteryTypeRowFormats_(sheet, sheet.getLastRow());
}

function getOrCreateExactPointSheet_(
  spreadsheet,
  sheetName,
  expectedHeaders,
  legacyHeaders,
  legacyDefaults,
  errorCode,
  background,
  applyFormats
) {
  var sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) sheet = spreadsheet.insertSheet(sheetName);

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, expectedHeaders.length).setValues([expectedHeaders]);
    sheet.setFrozenRows(1);
    styleHeader_(sheet, 1, expectedHeaders.length, background);
    sheet.autoResizeColumns(1, expectedHeaders.length);
    applyFormats(sheet);
    return sheet;
  }

  if (sheet.getLastColumn() === legacyHeaders.length) {
    assertHeadersMatch_(
      sheet.getRange(1, 1, 1, legacyHeaders.length).getDisplayValues()[0],
      legacyHeaders,
      errorCode
    );
    var appendedHeaders = expectedHeaders.slice(legacyHeaders.length);
    sheet
      .getRange(1, legacyHeaders.length + 1, 1, appendedHeaders.length)
      .setValues([appendedHeaders]);
    if (sheet.getLastRow() > 1) {
      var defaultRows = [];
      for (var rowIndex = 2; rowIndex <= sheet.getLastRow(); rowIndex += 1) {
        defaultRows.push(legacyDefaults.slice());
      }
      sheet
        .getRange(2, legacyHeaders.length + 1, defaultRows.length, legacyDefaults.length)
        .setValues(defaultRows);
    }
    applyFormats(sheet);
    SpreadsheetApp.flush();
  }

  if (sheet.getLastColumn() !== expectedHeaders.length) {
    throw appError_(
      errorCode,
      sheetName + " 工作表欄位與管理程式版本不相符，請勿手動調整第一列欄位。"
    );
  }
  assertHeadersMatch_(
    sheet.getRange(1, 1, 1, expectedHeaders.length).getDisplayValues()[0],
    expectedHeaders,
    errorCode
  );
  return sheet;
}

function assertHeadersMatch_(actualHeaders, expectedHeaders, errorCode) {
  for (var i = 0; i < expectedHeaders.length; i += 1) {
    if (actualHeaders[i] !== expectedHeaders[i]) {
      throw appError_(
        errorCode,
        errorCode === "ADMIN_SCHEMA_MISMATCH"
          ? "Admins 工作表欄位與管理程式版本不相符，請勿手動調整第一列欄位。"
          : errorCode === "MEMBER_SCHEMA_MISMATCH"
            ? "Members 工作表欄位與管理程式版本不相符，請勿手動調整第一列欄位。"
            : "點數工作表欄位與管理程式版本不相符，請勿手動調整第一列欄位。"
      );
    }
  }
}

function findAdminRows_(sheet, lineUserId) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var values = sheet
    .getRange(2, ADMIN_COLUMN.lineUserId, lastRow - 1, 1)
    .getValues();
  var rows = [];
  for (var i = 0; i < values.length; i += 1) {
    if (String(values[i][0] || "") === lineUserId) rows.push(i + 2);
  }
  return rows;
}

function findUniqueMemberRowByMemberId_(sheet, memberId) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;

  var values = sheet
    .getRange(2, MEMBER_COLUMN.memberId, lastRow - 1, 1)
    .getValues();
  var rowNumber = 0;
  for (var i = 0; i < values.length; i += 1) {
    if (String(values[i][0] || "") !== memberId) continue;
    if (rowNumber !== 0) {
      throw appError_(
        "MEMBER_DATA_CONFLICT",
        "會員資料有重複識別碼，請先修正試算表。"
      );
    }
    rowNumber = i + 2;
  }
  return rowNumber;
}

function countApprovedAdmins_(sheet) {
  return countAdminsWithStatus_(sheet, "approved");
}

function countPendingAdmins_(sheet) {
  return countAdminsWithStatus_(sheet, "pending");
}

function countAdminsWithStatus_(sheet, expectedStatus) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  return sheet
    .getRange(2, ADMIN_COLUMN.status, lastRow - 1, 1)
    .getValues()
    .reduce(function (count, row) {
      return count + (strictAdminStatus_(row[0]) === expectedStatus ? 1 : 0);
    }, 0);
}

function styleHeader_(sheet, startColumn, columnCount, background) {
  sheet
    .getRange(1, startColumn, 1, columnCount)
    .setBackground(background)
    .setFontColor("#ffffff")
    .setFontWeight("bold");
}

function applyMemberSheetColumnFormats_(sheet) {
  var rowCount = Math.max(sheet.getMaxRows() - 1, 1);
  [
    1, 2, 3, 4, 5, 6, 11, 12, 13, 15, 17, 19, 20, 21,
    MEMBER_COLUMN.phone,
    MEMBER_COLUMN.birthday,
  ].forEach(function (column) {
    sheet.getRange(2, column, rowCount, 1).setNumberFormat("@");
  });
  [7, 8, 9, MEMBER_COLUMN.accessUpdatedAt].forEach(function (column) {
    sheet.getRange(2, column, rowCount, 1).setNumberFormat("yyyy-mm-dd hh:mm:ss");
  });
  sheet.getRange(2, MEMBER_COLUMN.lastTokenIat, rowCount, 1).setNumberFormat("0");
}

function applyMemberRowFormats_(sheet, rowNumber) {
  sheet.getRange(rowNumber, MEMBER_COLUMN.memberId, 1, 6).setNumberFormat("@");
  sheet.getRange(rowNumber, MEMBER_COLUMN.updatedAt).setNumberFormat("yyyy-mm-dd hh:mm:ss");
  sheet.getRange(rowNumber, MEMBER_COLUMN.accessUpdatedAt).setNumberFormat("yyyy-mm-dd hh:mm:ss");
  sheet.getRange(rowNumber, MEMBER_COLUMN.accessUpdatedBy).setNumberFormat("@");
  sheet.getRange(rowNumber, MEMBER_COLUMN.lastAccessRequestId).setNumberFormat("@");
  sheet.getRange(rowNumber, MEMBER_COLUMN.phone, 1, 2).setNumberFormat("@");
}

function applyAdminSheetColumnFormats_(sheet) {
  var rowCount = Math.max(sheet.getMaxRows() - 1, 1);
  [1, 2, 3, 4, 5, 6, 12].forEach(function (column) {
    sheet.getRange(2, column, rowCount, 1).setNumberFormat("@");
  });
  [7, 8, 9].forEach(function (column) {
    sheet.getRange(2, column, rowCount, 1).setNumberFormat("yyyy-mm-dd hh:mm:ss");
  });
  sheet.getRange(2, ADMIN_COLUMN.lastTokenIat, rowCount, 1).setNumberFormat("0");
}

function applyAdminRowFormats_(sheet, rowNumber) {
  sheet.getRange(rowNumber, ADMIN_COLUMN.adminId, 1, 6).setNumberFormat("@");
  sheet.getRange(rowNumber, ADMIN_COLUMN.requestedAt, 1, 3).setNumberFormat("yyyy-mm-dd hh:mm:ss");
  sheet.getRange(rowNumber, ADMIN_COLUMN.lastTokenIat).setNumberFormat("0");
  sheet.getRange(rowNumber, ADMIN_COLUMN.lastRequestId).setNumberFormat("@");
}

function applyPointTypeSheetColumnFormats_(sheet) {
  var rowCount = Math.max(sheet.getMaxRows() - 1, 1);
  [1, 2, 4, 7, 8, 9, 10, 11, 12].forEach(function (column) {
    sheet.getRange(2, column, rowCount, 1).setNumberFormat("@");
  });
  sheet.getRange(2, POINT_TYPE_COLUMN.points, rowCount, 1).setNumberFormat("0");
  sheet
    .getRange(2, POINT_TYPE_COLUMN.createdAt, rowCount, 2)
    .setNumberFormat("yyyy-mm-dd hh:mm:ss");
}

function applyPointTypeRowFormats_(sheet, rowNumber) {
  sheet.getRange(rowNumber, POINT_TYPE_COLUMN.pointTypeId, 1, 2).setNumberFormat("@");
  sheet.getRange(rowNumber, POINT_TYPE_COLUMN.points).setNumberFormat("0");
  sheet.getRange(rowNumber, POINT_TYPE_COLUMN.status).setNumberFormat("@");
  sheet
    .getRange(rowNumber, POINT_TYPE_COLUMN.createdAt, 1, 2)
    .setNumberFormat("yyyy-mm-dd hh:mm:ss");
  sheet
    .getRange(rowNumber, POINT_TYPE_COLUMN.createdBy, 1, 2)
    .setNumberFormat("@");
  sheet
    .getRange(rowNumber, POINT_TYPE_COLUMN.expiryMode, 1, 4)
    .setNumberFormat("@");
}

function applyPointCampaignSheetColumnFormats_(sheet) {
  var rowCount = Math.max(sheet.getMaxRows() - 1, 1);
  [1, 2, 3, 5, 6, 9, 10, 11, 12].forEach(function (column) {
    sheet.getRange(2, column, rowCount, 1).setNumberFormat("@");
  });
  sheet
    .getRange(2, POINT_CAMPAIGN_COLUMN.pointsSnapshot, rowCount, 1)
    .setNumberFormat("0");
  sheet
    .getRange(2, POINT_CAMPAIGN_COLUMN.expiresAt, rowCount, 2)
    .setNumberFormat("yyyy-mm-dd hh:mm:ss");
}

function applyPointCampaignRowFormats_(sheet, rowNumber) {
  sheet
    .getRange(rowNumber, POINT_CAMPAIGN_COLUMN.campaignId, 1, 3)
    .setNumberFormat("@");
  sheet.getRange(rowNumber, POINT_CAMPAIGN_COLUMN.pointsSnapshot).setNumberFormat("0");
  sheet
    .getRange(rowNumber, POINT_CAMPAIGN_COLUMN.claimHash, 1, 2)
    .setNumberFormat("@");
  sheet
    .getRange(rowNumber, POINT_CAMPAIGN_COLUMN.expiresAt, 1, 2)
    .setNumberFormat("yyyy-mm-dd hh:mm:ss");
  sheet
    .getRange(rowNumber, POINT_CAMPAIGN_COLUMN.createdBy, 1, 2)
    .setNumberFormat("@");
  sheet
    .getRange(rowNumber, POINT_CAMPAIGN_COLUMN.expiryModeSnapshot, 1, 2)
    .setNumberFormat("@");
}

function applyPointRedemptionSheetColumnFormats_(sheet) {
  var rowCount = Math.max(sheet.getMaxRows() - 1, 1);
  [1, 2, 3, 4, 5, 9, 10].forEach(function (column) {
    sheet.getRange(2, column, rowCount, 1).setNumberFormat("@");
  });
  sheet.getRange(2, 6, rowCount, 2).setNumberFormat("0");
  sheet.getRange(2, 8, rowCount, 1).setNumberFormat("yyyy-mm-dd hh:mm:ss");
}

function applyPointCardSettingSheetColumnFormats_(sheet) {
  var rowCount = Math.max(sheet.getMaxRows() - 1, 1);
  [1, 4, 5].forEach(function (column) {
    sheet.getRange(2, column, rowCount, 1).setNumberFormat("@");
  });
  sheet
    .getRange(2, POINT_CARD_SETTING_COLUMN.targetPoints, rowCount, 1)
    .setNumberFormat("0");
  sheet
    .getRange(2, POINT_CARD_SETTING_COLUMN.effectiveAt, rowCount, 1)
    .setNumberFormat("yyyy-mm-dd hh:mm:ss");
}

function applyPointCardSettingRowFormats_(sheet, rowNumber) {
  sheet.getRange(rowNumber, 1).setNumberFormat("@");
  sheet.getRange(rowNumber, 2).setNumberFormat("0");
  sheet.getRange(rowNumber, 3).setNumberFormat("yyyy-mm-dd hh:mm:ss");
  sheet.getRange(rowNumber, 4, 1, 2).setNumberFormat("@");
}

function applyLotteryTypeSheetColumnFormats_(sheet) {
  var rowCount = Math.max(sheet.getMaxRows() - 1, 1);
  [1, 2, 3, 6, 8, 9].forEach(function (column) {
    sheet.getRange(2, column, rowCount, 1).setNumberFormat("@");
  });
  sheet
    .getRange(2, LOTTERY_TYPE_COLUMN.createdAt, rowCount, 2)
    .setNumberFormat("yyyy-mm-dd hh:mm:ss");
  sheet
    .getRange(2, LOTTERY_TYPE_COLUMN.deletedAt, rowCount, 1)
    .setNumberFormat("yyyy-mm-dd hh:mm:ss");
}

function applyLotteryTypeRowFormats_(sheet, rowNumber) {
  sheet.getRange(rowNumber, 1, 1, 3).setNumberFormat("@");
  sheet.getRange(rowNumber, 4, 1, 2).setNumberFormat("yyyy-mm-dd hh:mm:ss");
  sheet.getRange(rowNumber, 6).setNumberFormat("@");
  sheet.getRange(rowNumber, 7).setNumberFormat("yyyy-mm-dd hh:mm:ss");
  sheet.getRange(rowNumber, 8, 1, 2).setNumberFormat("@");
}

function applyLotteryPrizeSheetColumnFormats_(sheet) {
  var rowCount = Math.max(sheet.getMaxRows() - 1, 1);
  [1, 2, 3, 4, 7, 9, 10, LOTTERY_PRIZE_COLUMN.lotteryTypeId].forEach(function (column) {
    sheet.getRange(2, column, rowCount, 1).setNumberFormat("@");
  });
  sheet
    .getRange(2, LOTTERY_PRIZE_COLUMN.probabilityBasisPoints, rowCount, 2)
    .setNumberFormat("0");
  sheet
    .getRange(2, LOTTERY_PRIZE_COLUMN.updatedAt, rowCount, 1)
    .setNumberFormat("yyyy-mm-dd hh:mm:ss");
}

function applyLotteryPrizeRowFormats_(sheet, startRow, rowCount) {
  [1, 2, 3, 4, 7, 9, 10, LOTTERY_PRIZE_COLUMN.lotteryTypeId].forEach(function (column) {
    sheet.getRange(startRow, column, rowCount, 1).setNumberFormat("@");
  });
  sheet
    .getRange(
      startRow,
      LOTTERY_PRIZE_COLUMN.probabilityBasisPoints,
      rowCount,
      2
    )
    .setNumberFormat("0");
  sheet
    .getRange(startRow, LOTTERY_PRIZE_COLUMN.updatedAt, rowCount, 1)
    .setNumberFormat("yyyy-mm-dd hh:mm:ss");
}

function applyLotteryDrawSheetColumnFormats_(sheet) {
  var rowCount = Math.max(sheet.getMaxRows() - 1, 1);
  [1, 2, 3, 4, 5, 7, 8, 13, 14, 15, 16].forEach(function (column) {
    sheet.getRange(2, column, rowCount, 1).setNumberFormat("@");
  });
  sheet
    .getRange(
      2,
      LOTTERY_DRAW_COLUMN.probabilityBasisPointsSnapshot,
      rowCount,
      1
    )
    .setNumberFormat("0");
  sheet
    .getRange(2, LOTTERY_DRAW_COLUMN.pointsSpent, rowCount, 3)
    .setNumberFormat("0");
  sheet
    .getRange(2, LOTTERY_DRAW_COLUMN.drawnAt, rowCount, 1)
    .setNumberFormat("yyyy-mm-dd hh:mm:ss");
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
      targetMemberId: String(e.parameter.targetMemberId || "").trim(),
      accessStatus: String(e.parameter.accessStatus || "").trim().toLowerCase(),
      expectedAccessStatus: String(e.parameter.expectedAccessStatus || "").trim().toLowerCase(),
      expectedAccessUpdatedAt: String(e.parameter.expectedAccessUpdatedAt || "").trim(),
      points: optionalNumber_(e.parameter.pointAmount, NaN),
      pointTypeId: String(e.parameter.pointTypeId || "").trim(),
      expiresAt: String(e.parameter.expiresAt || "").trim(),
      expiryMode: String(e.parameter.expiryMode || "").trim().toLowerCase(),
      redemptionMode: String(e.parameter.redemptionMode || "").trim().toLowerCase(),
      pointCardTarget: optionalNumber_(e.parameter.pointCardTarget, NaN),
      lotteryTypeId: String(e.parameter.lotteryTypeId || "").trim(),
      lotteryTypeName: String(e.parameter.lotteryTypeName || "").trim(),
      lotteryPrizes: parseLotteryPrizes_(e.parameter.lotteryPrizes),
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
    targetMemberId: String(parsed.targetMemberId || "").trim(),
    accessStatus: String(parsed.accessStatus || "").trim().toLowerCase(),
    expectedAccessStatus: String(parsed.expectedAccessStatus || "").trim().toLowerCase(),
    expectedAccessUpdatedAt: String(parsed.expectedAccessUpdatedAt || "").trim(),
    points: optionalNumber_(parsed.pointAmount, NaN),
    pointTypeId: String(parsed.pointTypeId || "").trim(),
    expiresAt: String(parsed.expiresAt || "").trim(),
    expiryMode: String(parsed.expiryMode || "").trim().toLowerCase(),
    redemptionMode: String(parsed.redemptionMode || "").trim().toLowerCase(),
    pointCardTarget: optionalNumber_(parsed.pointCardTarget, NaN),
    lotteryTypeId: String(parsed.lotteryTypeId || "").trim(),
    lotteryTypeName: String(parsed.lotteryTypeName || "").trim(),
    lotteryPrizes: parseLotteryPrizes_(parsed.lotteryPrizes),
    page: optionalNumber_(parsed.page, 1),
    pageSize: optionalNumber_(parsed.pageSize, DEFAULT_ADMIN_PAGE_SIZE),
    transport: "fetch",
  };
}

function validateRequestEnvelope_(request) {
  if (!/^[a-zA-Z0-9-]{10,80}$/.test(request.requestId || "")) {
    throw appError_("INVALID_REQUEST_ID", "請求識別碼格式不正確。");
  }

  if (ADMIN_ACTIONS.indexOf(request.action) === -1) {
    throw appError_("UNSUPPORTED_ACTION", "此管理服務不支援該操作。");
  }

  if (
    !request.idToken ||
    request.idToken.length > MAX_ID_TOKEN_LENGTH ||
    !isJwtLike_(request.idToken)
  ) {
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
      request.expectedAccessStatus !== "approved" &&
      request.expectedAccessStatus !== "denied"
    ) {
      throw appError_("INVALID_ACCESS_VERSION", "會員權限版本狀態不正確。");
    }
    if (
      request.expectedAccessUpdatedAt &&
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(request.expectedAccessUpdatedAt)
    ) {
      throw appError_("INVALID_ACCESS_VERSION", "會員權限版本格式不正確。");
    }
  }

  if (request.action === "adminCreatePointType") {
    normalizePointValue_(request.points);
    normalizeExpiryMode_(request.expiryMode);
    normalizeRedemptionMode_(request.redemptionMode);
  }

  if (request.action === "adminDeletePointType") {
    normalizePointTypeId_(request.pointTypeId);
  }

  if (request.action === "adminCreatePointCampaign") {
    normalizePointTypeId_(request.pointTypeId);
  }

  if (request.action === "adminSavePointCardSetting") {
    normalizePointCardTarget_(request.pointCardTarget);
  }

  if (request.action === "adminCreateLotteryType") {
    normalizeLotteryTypeName_(request.lotteryTypeName);
  }

  if (request.action === "adminDeleteLotteryType") {
    normalizeLotteryTypeId_(request.lotteryTypeId);
  }

  if (request.action === "adminSaveLotteryConfig") {
    normalizeLotteryTypeId_(request.lotteryTypeId);
    normalizeLotteryPrizes_(request.lotteryPrizes);
  }
}

function normalizePointValue_(value) {
  var points = Number(value);
  if (
    !isFinite(points) ||
    Math.floor(points) !== points ||
    points < 1 ||
    points > MAX_POINT_VALUE
  ) {
    throw appError_(
      "INVALID_POINTS",
      "點數必須是 1 到 " + MAX_POINT_VALUE + " 的整數。"
    );
  }
  return points;
}

function normalizePointCardTarget_(value) {
  var target = Number(value);
  if (
    !isFinite(target) ||
    Math.floor(target) !== target ||
    target < 1 ||
    target > MAX_POINT_VALUE
  ) {
    throw appError_(
      "INVALID_POINT_CARD_TARGET",
      "集點卡每輪點數必須是 1 到 " + MAX_POINT_VALUE + " 的整數。"
    );
  }
  return target;
}

function normalizeLotteryTypeId_(value) {
  var lotteryTypeId = String(value || "").trim();
  if (!/^LTY-[A-Z0-9]{10}$/.test(lotteryTypeId)) {
    throw appError_("INVALID_LOTTERY_TYPE_ID", "轉盤類型識別碼格式不正確。");
  }
  return lotteryTypeId;
}

function normalizeLotteryTypeName_(value) {
  var name = plainSheetText_(value, 40);
  if (!name) {
    throw appError_("INVALID_LOTTERY_TYPE_NAME", "轉盤類型名稱必須是 1 到 40 個字元。");
  }
  return name;
}

function pointLabel_(points) {
  return String(points) + " 點";
}

function normalizePointTypeId_(value) {
  var pointTypeId = String(value || "").trim();
  if (!/^PTY-[A-Z0-9]{10}$/.test(pointTypeId)) {
    throw appError_("INVALID_POINT_TYPE_ID", "點數類型識別碼格式不正確。");
  }
  return pointTypeId;
}

function normalizeExpiryMode_(value) {
  var mode = String(value || "").trim().toLowerCase();
  if (mode !== "limited" && mode !== "unlimited") {
    throw appError_(
      "INVALID_EXPIRY_MODE",
      "點數期限模式只能設為 limited 或 unlimited。"
    );
  }
  return mode;
}

function normalizeRedemptionMode_(value) {
  var mode = String(value || "").trim().toLowerCase();
  if (
    mode !== "once_per_member" &&
    mode !== "repeatable" &&
    mode !== "single_member"
  ) {
    throw appError_(
      "INVALID_REDEMPTION_MODE",
      "點數領取模式只能設為 once_per_member、repeatable 或 single_member。"
    );
  }
  return mode;
}

function parseLotteryPrizes_(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === "") return [];
  if (typeof value !== "string" || value.length > 12000) {
    throw appError_("INVALID_LOTTERY_PRIZES", "轉盤獎項資料格式不正確。");
  }
  var parsed;
  try {
    parsed = JSON.parse(value);
  } catch (_error) {
    throw appError_("INVALID_LOTTERY_PRIZES", "轉盤獎項資料不是有效的 JSON。");
  }
  if (!Array.isArray(parsed)) {
    throw appError_("INVALID_LOTTERY_PRIZES", "轉盤獎項資料必須是陣列。");
  }
  return parsed;
}

function normalizeLotteryPrizes_(value) {
  var prizes = parseLotteryPrizes_(value);
  if (
    prizes.length < MIN_LOTTERY_PRIZES ||
    prizes.length > MAX_LOTTERY_PRIZES
  ) {
    throw appError_("INVALID_LOTTERY_PRIZES", "轉盤必須設定 2 到 12 個獎項。");
  }

  var labels = Object.create(null);
  var totalBasisPoints = 0;
  var normalized = prizes.map(function (prize) {
    if (!prize || typeof prize !== "object" || Array.isArray(prize)) {
      throw appError_("INVALID_LOTTERY_PRIZES", "每個轉盤獎項都必須是物件。");
    }
    var label = String(prize.label == null ? "" : prize.label).trim();
    var color = String(prize.color || "").trim().toUpperCase();
    var probability = Number(prize.probability);
    var probabilityBasisPoints = Math.round(probability * 100);
    var labelKey = label.toLocaleLowerCase();

    if (!label || label.length > 40 || /[\u0000-\u001F\u007F]/.test(label)) {
      throw appError_("INVALID_LOTTERY_PRIZES", "獎項名稱必須是 1 到 40 個可顯示字元。");
    }
    if (labels[labelKey]) {
      throw appError_("INVALID_LOTTERY_PRIZES", "轉盤獎項名稱不可重複。");
    }
    if (!/^#[0-9A-F]{6}$/.test(color)) {
      throw appError_("INVALID_LOTTERY_COLOR", "獎項顏色必須是 #RRGGBB 格式。");
    }
    if (
      !isFinite(probability) ||
      probability <= 0 ||
      probability >= 100 ||
      Math.abs(probabilityBasisPoints / 100 - probability) > 0.000001
    ) {
      throw appError_(
        "INVALID_LOTTERY_PROBABILITY",
        "每個獎項機率必須介於 0.01% 到 99.99%，且最多兩位小數。"
      );
    }

    labels[labelKey] = true;
    totalBasisPoints += probabilityBasisPoints;
    return {
      label: label,
      color: color,
      probabilityBasisPoints: probabilityBasisPoints,
    };
  });

  if (totalBasisPoints !== 10000) {
    throw appError_("INVALID_LOTTERY_TOTAL", "所有獎項機率合計必須是 100%。");
  }
  return normalized;
}

function parseCampaignExpiryForMode_(value, expiryMode) {
  var mode = normalizeExpiryMode_(expiryMode);
  var raw = String(value || "").trim();
  if (mode === "unlimited") {
    if (raw) {
      throw appError_("INVALID_CAMPAIGN_EXPIRY", "無期限點數 QR 不可設定到期時間。");
    }
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(raw)) {
    throw appError_("INVALID_CAMPAIGN_EXPIRY", "點數 QR 到期時間格式不正確。");
  }
  var expiresAt = new Date(raw);
  if (isNaN(expiresAt.getTime()) || expiresAt.toISOString() !== raw) {
    throw appError_("INVALID_CAMPAIGN_EXPIRY", "點數 QR 到期時間格式不正確。");
  }
  var now = Date.now();
  if (
    expiresAt.getTime() <= now ||
    expiresAt.getTime() > now + MAX_CAMPAIGN_LIFETIME_MS
  ) {
    throw appError_(
      "INVALID_CAMPAIGN_EXPIRY",
      "點數 QR 到期時間必須在未來 366 天內。"
    );
  }
  return expiresAt;
}

function normalizeCampaignExpiryForComparison_(value, expiryMode) {
  var mode = normalizeExpiryMode_(expiryMode);
  var raw = String(value || "").trim();
  if (mode === "unlimited") return raw === "" ? "" : raw;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(raw)) return raw;
  var expiresAt = new Date(raw);
  return isNaN(expiresAt.getTime()) ? raw : expiresAt.toISOString();
}

function readPointTypeRecords_(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var rows = sheet
    .getRange(2, 1, lastRow - 1, POINT_TYPE_HEADERS.length)
    .getValues();
  var records = [];
  var ids = Object.create(null);
  var activeTypes = Object.create(null);
  var requestIds = Object.create(null);
  var deleteRequestIds = Object.create(null);

  for (var i = 0; i < rows.length; i += 1) {
    var record = pointTypeRecordFromRow_(rows[i], i + 2);
    if (ids[record.pointTypeId]) {
      throw appError_("POINT_DATA_CONFLICT", "點數類型識別碼重複，請先修正試算表。");
    }
    ids[record.pointTypeId] = true;
    if (record.status === "active") {
      var typeKey = [
        String(record.points),
        record.expiryMode,
        record.redemptionMode,
      ].join(":");
      if (activeTypes[typeKey]) {
        throw appError_("POINT_DATA_CONFLICT", "啟用中的點數類型設定重複，請先修正試算表。");
      }
      activeTypes[typeKey] = true;
    }
    if (requestIds[record.lastRequestId]) {
      throw appError_("POINT_DATA_CONFLICT", "點數類型請求識別碼重複，請先修正試算表。");
    }
    requestIds[record.lastRequestId] = true;
    if (record.deleteRequestId) {
      if (deleteRequestIds[record.deleteRequestId]) {
        throw appError_("POINT_DATA_CONFLICT", "點數類型刪除請求識別碼重複，請先修正試算表。");
      }
      deleteRequestIds[record.deleteRequestId] = true;
    }
    records.push(record);
  }
  return records;
}

function readPointCampaignRecords_(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var rows = sheet
    .getRange(2, 1, lastRow - 1, POINT_CAMPAIGN_HEADERS.length)
    .getValues();
  var records = [];
  var ids = Object.create(null);
  var hashes = Object.create(null);
  var requestIds = Object.create(null);

  for (var i = 0; i < rows.length; i += 1) {
    var record = pointCampaignRecordFromRow_(rows[i], i + 2);
    if (ids[record.campaignId]) {
      throw appError_("POINT_DATA_CONFLICT", "點數活動識別碼重複，請先修正試算表。");
    }
    if (hashes[record.claimHash]) {
      throw appError_("POINT_DATA_CONFLICT", "點數活動兌換驗證值重複，請先修正試算表。");
    }
    if (requestIds[record.lastRequestId]) {
      throw appError_("POINT_DATA_CONFLICT", "點數活動請求識別碼重複，請先修正試算表。");
    }
    ids[record.campaignId] = true;
    hashes[record.claimHash] = true;
    requestIds[record.lastRequestId] = true;
    records.push(record);
  }
  return records;
}

function readPointCardSettings_(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    throw appError_("POINT_CARD_NOT_CONFIGURED", "尚未設定集點卡每輪點數。");
  }
  var rows = sheet
    .getRange(2, 1, lastRow - 1, POINT_CARD_SETTING_HEADERS.length)
    .getValues();
  var versions = Object.create(null);
  var requests = Object.create(null);
  var settings = rows.map(function (row, index) {
    var settingVersion = plainSheetText_(
      row[POINT_CARD_SETTING_COLUMN.settingVersion - 1],
      100
    );
    var targetPoints = Number(row[POINT_CARD_SETTING_COLUMN.targetPoints - 1]);
    var effectiveAtValue = row[POINT_CARD_SETTING_COLUMN.effectiveAt - 1];
    var effectiveAt = toIsoString_(effectiveAtValue);
    var updatedBy = plainSheetText_(
      row[POINT_CARD_SETTING_COLUMN.updatedBy - 1],
      100
    );
    var lastRequestId = plainSheetText_(
      row[POINT_CARD_SETTING_COLUMN.lastRequestId - 1],
      100
    );
    if (
      !/^PCS-[A-Z0-9]{12}$/.test(settingVersion) ||
      !Number.isInteger(targetPoints) ||
      targetPoints < 1 ||
      targetPoints > MAX_POINT_VALUE ||
      !effectiveAt ||
      (updatedBy !== "SYSTEM" && !/^ADM-[A-Z0-9]{10}$/.test(updatedBy)) ||
      !/^[a-zA-Z0-9-]{10,80}$/.test(lastRequestId) ||
      versions[settingVersion] ||
      requests[lastRequestId]
    ) {
      throw appError_(
        "POINT_CARD_DATA_ERROR",
        "集點卡設定第 " + (index + 2) + " 列資料不正確。"
      );
    }
    versions[settingVersion] = true;
    requests[lastRequestId] = true;
    return {
      rowNumber: index + 2,
      settingVersion: settingVersion,
      targetPoints: targetPoints,
      effectiveAt: effectiveAt,
      effectiveAtTime: new Date(effectiveAt).getTime(),
      effectiveAtValue: effectiveAtValue,
      updatedBy: updatedBy,
      lastRequestId: lastRequestId,
    };
  });
  settings.sort(function (left, right) {
    return left.effectiveAtTime - right.effectiveAtTime || left.rowNumber - right.rowNumber;
  });
  for (var i = 1; i < settings.length; i += 1) {
    if (settings[i].effectiveAtTime <= settings[i - 1].effectiveAtTime) {
      throw appError_("POINT_CARD_DATA_ERROR", "集點卡設定生效時間必須依序增加。");
    }
  }
  return settings;
}

function pointCardSettingResponse_(setting) {
  return {
    settingVersion: setting.settingVersion,
    targetPoints: setting.targetPoints,
    effectiveAt: setting.effectiveAt,
  };
}

function readLotteryTypes_(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    throw appError_("LOTTERY_NOT_CONFIGURED", "尚未建立轉盤類型。");
  }
  var rows = sheet
    .getRange(2, 1, lastRow - 1, LOTTERY_TYPE_HEADERS.length)
    .getValues();
  var ids = Object.create(null);
  var activeNames = Object.create(null);
  return rows.map(function (row, index) {
    var lotteryTypeId = plainSheetText_(row[LOTTERY_TYPE_COLUMN.lotteryTypeId - 1], 100);
    var name = plainSheetText_(row[LOTTERY_TYPE_COLUMN.name - 1], 40);
    var status = String(row[LOTTERY_TYPE_COLUMN.status - 1] || "").trim().toLowerCase();
    var createdAtValue = row[LOTTERY_TYPE_COLUMN.createdAt - 1];
    var createdAt = toIsoString_(createdAtValue);
    var updatedAt = toIsoString_(row[LOTTERY_TYPE_COLUMN.updatedAt - 1]);
    var createdBy = plainSheetText_(row[LOTTERY_TYPE_COLUMN.createdBy - 1], 100);
    var deletedAt = toIsoString_(row[LOTTERY_TYPE_COLUMN.deletedAt - 1]);
    var deletedBy = plainSheetText_(row[LOTTERY_TYPE_COLUMN.deletedBy - 1], 100);
    var lastRequestId = plainSheetText_(row[LOTTERY_TYPE_COLUMN.lastRequestId - 1], 100);
    var deletionValid =
      status === "active"
        ? !deletedAt && !deletedBy
        : status === "deleted" &&
          Boolean(deletedAt) &&
          /^ADM-[A-Z0-9]{10}$/.test(deletedBy);
    if (
      !/^LTY-[A-Z0-9]{10}$/.test(lotteryTypeId) ||
      !name ||
      !createdAt ||
      !updatedAt ||
      (createdBy !== "SYSTEM" && !/^ADM-[A-Z0-9]{10}$/.test(createdBy)) ||
      !/^[a-zA-Z0-9-]{10,80}$/.test(lastRequestId) ||
      !deletionValid ||
      ids[lotteryTypeId] ||
      (status === "active" && activeNames[name.toLowerCase()])
    ) {
      throw appError_(
        "LOTTERY_DATA_ERROR",
        "轉盤類型第 " + (index + 2) + " 列資料不正確。"
      );
    }
    ids[lotteryTypeId] = true;
    if (status === "active") activeNames[name.toLowerCase()] = true;
    return {
      rowNumber: index + 2,
      lotteryTypeId: lotteryTypeId,
      name: name,
      status: status,
      createdAt: createdAt,
      createdAtValue: createdAtValue,
      updatedAt: updatedAt,
      createdBy: createdBy,
      deletedAt: deletedAt,
      deletedBy: deletedBy,
      lastRequestId: lastRequestId,
    };
  });
}

function findLotteryType_(types, lotteryTypeId, includeDeleted) {
  var matches = types.filter(function (type) {
    return type.lotteryTypeId === lotteryTypeId;
  });
  if (matches.length !== 1 || (!includeDeleted && matches[0].status !== "active")) {
    throw appError_("LOTTERY_TYPE_NOT_FOUND", "找不到可使用的轉盤類型。");
  }
  return matches[0];
}

function findLatestLotteryConfigForType_(configs, lotteryTypeId) {
  var matches = configs.filter(function (config) {
    return config.lotteryTypeId === lotteryTypeId;
  });
  return matches.length ? matches[matches.length - 1] : null;
}

function lotteryTypeResponse_(type, lotteryConfig) {
  return {
    lotteryTypeId: type.lotteryTypeId,
    name: type.name,
    status: type.status,
    createdAt: type.createdAt,
    lottery: lotteryConfig
      ? lotteryConfigResponse_(lotteryConfig)
      : {
          lotteryTypeId: type.lotteryTypeId,
          configVersion: "",
          updatedAt: "",
          prizes: [],
        },
  };
}

function readLotteryConfigs_(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var rows = sheet
    .getRange(2, 1, lastRow - 1, LOTTERY_PRIZE_HEADERS.length)
    .getValues();
  var groups = Object.create(null);
  var prizeIds = Object.create(null);
  var requestVersions = Object.create(null);

  rows.forEach(function (row, index) {
    var prize = lotteryPrizeRecordFromRow_(row, index + 2);
    if (prizeIds[prize.prizeId]) {
      throw appError_("LOTTERY_DATA_ERROR", "轉盤獎項識別碼重複。");
    }
    prizeIds[prize.prizeId] = true;
    if (
      requestVersions[prize.lastRequestId] &&
      requestVersions[prize.lastRequestId] !== prize.configVersion
    ) {
      throw appError_("LOTTERY_DATA_ERROR", "轉盤設定請求識別碼重複。");
    }
    requestVersions[prize.lastRequestId] = prize.configVersion;

    if (!groups[prize.configVersion]) {
      groups[prize.configVersion] = {
        configVersion: prize.configVersion,
        updatedAt: prize.updatedAt,
        updatedAtTime: new Date(prize.updatedAt).getTime(),
        updatedBy: prize.updatedBy,
        lastRequestId: prize.lastRequestId,
        lotteryTypeId: prize.lotteryTypeId,
        lastRowNumber: prize.rowNumber,
        prizes: [],
      };
    }
    var group = groups[prize.configVersion];
    if (
      group.updatedAt !== prize.updatedAt ||
      group.updatedBy !== prize.updatedBy ||
      group.lastRequestId !== prize.lastRequestId
      || group.lotteryTypeId !== prize.lotteryTypeId
    ) {
      throw appError_("LOTTERY_DATA_ERROR", "同一版轉盤設定的稽核資料不一致。");
    }
    group.lastRowNumber = Math.max(group.lastRowNumber, prize.rowNumber);
    group.prizes.push(prize);
  });

  var configs = Object.keys(groups).map(function (configVersion) {
    var group = groups[configVersion];
    var orders = Object.create(null);
    var labels = Object.create(null);
    var totalBasisPoints = 0;
    if (
      group.prizes.length < MIN_LOTTERY_PRIZES ||
      group.prizes.length > MAX_LOTTERY_PRIZES
    ) {
      throw appError_("LOTTERY_DATA_ERROR", "每版轉盤必須包含 2 到 12 個獎項。");
    }
    group.prizes.forEach(function (prize) {
      var labelKey = prize.label.toLocaleLowerCase();
      if (orders[prize.sortOrder] || labels[labelKey]) {
        throw appError_("LOTTERY_DATA_ERROR", "同一版轉盤的順序或獎項名稱重複。");
      }
      orders[prize.sortOrder] = true;
      labels[labelKey] = true;
      totalBasisPoints += prize.probabilityBasisPoints;
    });
    if (totalBasisPoints !== 10000) {
      throw appError_("LOTTERY_DATA_ERROR", "轉盤中獎機率合計必須是 100%。");
    }
    group.prizes.sort(function (left, right) {
      return left.sortOrder - right.sortOrder;
    });
    group.prizes.forEach(function (prize, index) {
      if (prize.sortOrder !== index + 1) {
        throw appError_("LOTTERY_DATA_ERROR", "轉盤獎項順序必須從 1 連續編號。");
      }
    });
    return group;
  });

  configs.sort(function (left, right) {
    return (
      left.updatedAtTime - right.updatedAtTime ||
      left.lastRowNumber - right.lastRowNumber
    );
  });
  return configs;
}

function lotteryPrizeRecordFromRow_(row, rowNumber) {
  var configVersion = plainSheetText_(
    row[LOTTERY_PRIZE_COLUMN.configVersion - 1],
    100
  );
  var prizeId = plainSheetText_(row[LOTTERY_PRIZE_COLUMN.prizeId - 1], 100);
  var label = plainSheetText_(row[LOTTERY_PRIZE_COLUMN.label - 1], 40);
  var color = String(row[LOTTERY_PRIZE_COLUMN.color - 1] || "")
    .trim()
    .toUpperCase();
  var probabilityBasisPoints = Number(
    row[LOTTERY_PRIZE_COLUMN.probabilityBasisPoints - 1]
  );
  var sortOrder = Number(row[LOTTERY_PRIZE_COLUMN.sortOrder - 1]);
  var status = String(row[LOTTERY_PRIZE_COLUMN.status - 1] || "")
    .trim()
    .toLowerCase();
  var updatedAt = toIsoString_(row[LOTTERY_PRIZE_COLUMN.updatedAt - 1]);
  var updatedBy = plainSheetText_(row[LOTTERY_PRIZE_COLUMN.updatedBy - 1], 100);
  var lastRequestId = plainSheetText_(
    row[LOTTERY_PRIZE_COLUMN.lastRequestId - 1],
    100
  );
  var lotteryTypeId = plainSheetText_(
    row[LOTTERY_PRIZE_COLUMN.lotteryTypeId - 1],
    100
  );

  if (
    !/^LCF-[A-Z0-9]{12}$/.test(configVersion) ||
    !/^LPR-[A-Z0-9]{10}$/.test(prizeId) ||
    !label ||
    label.length > 40 ||
    !/^#[0-9A-F]{6}$/.test(color) ||
    !Number.isInteger(probabilityBasisPoints) ||
    probabilityBasisPoints < 1 ||
    probabilityBasisPoints > 9999 ||
    !Number.isInteger(sortOrder) ||
    sortOrder < 1 ||
    sortOrder > MAX_LOTTERY_PRIZES ||
    status !== "active" ||
    !updatedAt ||
    !/^ADM-[A-Z0-9]{10}$/.test(updatedBy) ||
    !/^[a-zA-Z0-9-]{10,80}$/.test(lastRequestId)
    || !/^LTY-[A-Z0-9]{10}$/.test(lotteryTypeId)
  ) {
    throw appError_(
      "LOTTERY_DATA_ERROR",
      "轉盤獎項第 " + rowNumber + " 列資料不正確，請先修正試算表。"
    );
  }
  return {
    rowNumber: rowNumber,
    configVersion: configVersion,
    prizeId: prizeId,
    label: label,
    color: color,
    probabilityBasisPoints: probabilityBasisPoints,
    sortOrder: sortOrder,
    updatedAt: updatedAt,
    updatedBy: updatedBy,
    lastRequestId: lastRequestId,
    lotteryTypeId: lotteryTypeId,
  };
}

function lotteryConfigResponse_(lotteryConfig) {
  return {
    lotteryTypeId: lotteryConfig.lotteryTypeId,
    configVersion: lotteryConfig.configVersion,
    updatedAt: lotteryConfig.updatedAt,
    prizes: lotteryConfig.prizes.map(function (prize) {
      return {
        prizeId: prize.prizeId,
        label: prize.label,
        color: prize.color,
        probability: prize.probabilityBasisPoints / 100,
      };
    }),
  };
}

function lotteryConfigMatchesSubmission_(lotteryConfig, submittedPrizes) {
  if (lotteryConfig.prizes.length !== submittedPrizes.length) return false;
  for (var i = 0; i < submittedPrizes.length; i += 1) {
    if (
      lotteryConfig.prizes[i].label !== submittedPrizes[i].label ||
      lotteryConfig.prizes[i].color !== submittedPrizes[i].color ||
      lotteryConfig.prizes[i].probabilityBasisPoints !==
        submittedPrizes[i].probabilityBasisPoints
    ) {
      return false;
    }
  }
  return true;
}

function generateLotteryId_(prefix, length, existing, errorCode) {
  for (var i = 0; i < 8; i += 1) {
    var id =
      prefix +
      Utilities.getUuid().replace(/-/g, "").slice(0, length).toUpperCase();
    if (!existing[id]) return id;
  }
  throw appError_(errorCode, "目前無法產生唯一的轉盤識別碼，請稍後再試。");
}

function lotteryDrawRecordFromRow_(row, rowNumber) {
  var drawId = plainSheetText_(row[LOTTERY_DRAW_COLUMN.drawId - 1], 100);
  var configVersion = plainSheetText_(
    row[LOTTERY_DRAW_COLUMN.configVersion - 1],
    100
  );
  var prizeId = plainSheetText_(row[LOTTERY_DRAW_COLUMN.prizeId - 1], 100);
  var prizeLabel = plainSheetText_(
    row[LOTTERY_DRAW_COLUMN.prizeLabelSnapshot - 1],
    40
  );
  var prizeColor = String(row[LOTTERY_DRAW_COLUMN.prizeColorSnapshot - 1] || "")
    .trim()
    .toUpperCase();
  var probabilityBasisPoints = Number(
    row[LOTTERY_DRAW_COLUMN.probabilityBasisPointsSnapshot - 1]
  );
  var memberId = plainSheetText_(row[LOTTERY_DRAW_COLUMN.memberId - 1], 100);
  var lineUserId = plainSheetText_(row[LOTTERY_DRAW_COLUMN.lineUserId - 1], 128);
  var pointsSpent = Number(row[LOTTERY_DRAW_COLUMN.pointsSpent - 1]);
  var balanceBefore = Number(row[LOTTERY_DRAW_COLUMN.balanceBefore - 1]);
  var balanceAfter = Number(row[LOTTERY_DRAW_COLUMN.balanceAfter - 1]);
  var drawnAt = toIsoString_(row[LOTTERY_DRAW_COLUMN.drawnAt - 1]);
  var requestId = plainSheetText_(row[LOTTERY_DRAW_COLUMN.requestId - 1], 100);
  var lotteryTypeId = plainSheetText_(
    row[LOTTERY_DRAW_COLUMN.lotteryTypeId - 1],
    100
  );
  var cardSettingVersion = plainSheetText_(
    row[LOTTERY_DRAW_COLUMN.cardSettingVersion - 1],
    100
  );
  var cardRoundKey = plainSheetText_(
    row[LOTTERY_DRAW_COLUMN.cardRoundKey - 1],
    100
  );
  var isLegacyDraw =
    pointsSpent === LEGACY_LOTTERY_TICKET_COST &&
    balanceBefore >= LEGACY_LOTTERY_TICKET_COST &&
    balanceAfter === balanceBefore - LEGACY_LOTTERY_TICKET_COST &&
    !lotteryTypeId &&
    !cardSettingVersion &&
    !cardRoundKey;
  var isRoundDraw =
    pointsSpent === 0 &&
    balanceBefore >= 0 &&
    balanceAfter === balanceBefore &&
    /^LTY-[A-Z0-9]{10}$/.test(lotteryTypeId) &&
    /^PCS-[A-Z0-9]{12}$/.test(cardSettingVersion) &&
    cardRoundKey.indexOf(cardSettingVersion + ":") === 0 &&
    /^[1-9]\d*$/.test(cardRoundKey.slice(cardSettingVersion.length + 1));

  if (
    !/^LDW-[A-Z0-9]{16}$/.test(drawId) ||
    !/^LCF-[A-Z0-9]{12}$/.test(configVersion) ||
    !/^LPR-[A-Z0-9]{10}$/.test(prizeId) ||
    !prizeLabel ||
    prizeLabel.length > 40 ||
    !/^#[0-9A-F]{6}$/.test(prizeColor) ||
    !Number.isInteger(probabilityBasisPoints) ||
    probabilityBasisPoints < 1 ||
    probabilityBasisPoints > 9999 ||
    !/^MBR-[A-Z0-9]{10}$/.test(memberId) ||
    !/^U[0-9a-f]{32}$/.test(lineUserId) ||
    !Number.isSafeInteger(balanceBefore) ||
    !Number.isSafeInteger(balanceAfter) ||
    (!isLegacyDraw && !isRoundDraw) ||
    !drawnAt ||
    !/^[a-zA-Z0-9-]{10,80}$/.test(requestId)
  ) {
    throw appError_(
      "LOTTERY_DATA_ERROR",
      "抽獎紀錄第 " + rowNumber + " 列資料不正確，請先修正試算表。"
    );
  }
  return {
    rowNumber: rowNumber,
    drawId: drawId,
    configVersion: configVersion,
    prizeId: prizeId,
    prizeLabel: prizeLabel,
    prizeColor: prizeColor,
    probabilityBasisPoints: probabilityBasisPoints,
    memberId: memberId,
    lineUserId: lineUserId,
    pointsSpent: pointsSpent,
    balanceBefore: balanceBefore,
    balanceAfter: balanceAfter,
    drawnAt: drawnAt,
    requestId: requestId,
    lotteryTypeId: lotteryTypeId || DEFAULT_LOTTERY_TYPE_ID,
    cardSettingVersion: cardSettingVersion,
    cardRoundKey: cardRoundKey,
    legacyDraw: isLegacyDraw,
  };
}

function readAdminLotteryDraws_(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var rows = sheet
    .getRange(2, 1, lastRow - 1, LOTTERY_DRAW_HEADERS.length)
    .getValues();
  var drawIds = Object.create(null);
  var requestKeys = Object.create(null);
  return rows.map(function (row, index) {
    var draw = lotteryDrawRecordFromRow_(row, index + 2);
    var requestKey = draw.lineUserId + ":" + draw.requestId;
    if (drawIds[draw.drawId] || requestKeys[requestKey]) {
      throw appError_("LOTTERY_DATA_ERROR", "抽獎紀錄識別碼或請求識別碼重複。");
    }
    drawIds[draw.drawId] = true;
    requestKeys[requestKey] = true;
    return draw;
  });
}

function readMemberNamesById_(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return Object.create(null);
  var rows = sheet
    .getRange(2, 1, lastRow - 1, MEMBER_HEADERS.length)
    .getValues();
  var members = Object.create(null);
  rows.forEach(function (row) {
    var memberId = String(row[MEMBER_COLUMN.memberId - 1] || "").trim();
    var lineUserId = String(row[MEMBER_COLUMN.lineUserId - 1] || "").trim();
    if (!memberId && !lineUserId) return;
    if (
      !/^MBR-[A-Z0-9]{10}$/.test(memberId) ||
      !/^U[0-9a-f]{32}$/.test(lineUserId) ||
      members[memberId]
    ) {
      throw appError_("MEMBER_DATA_CONFLICT", "會員資料識別碼缺漏或重複。");
    }
    members[memberId] = String(
      row[MEMBER_COLUMN.displayName - 1] || "LINE 會員"
    ).slice(0, 100);
  });
  return members;
}

function pointTypeRecordFromRow_(row, rowNumber) {
  var pointTypeId = String(row[POINT_TYPE_COLUMN.pointTypeId - 1] || "");
  var points = Number(row[POINT_TYPE_COLUMN.points - 1]);
  var label = String(row[POINT_TYPE_COLUMN.label - 1] || "");
  var status = strictPointStatus_(row[POINT_TYPE_COLUMN.status - 1]);
  var createdAt = toIsoString_(row[POINT_TYPE_COLUMN.createdAt - 1]);
  var updatedAt = toIsoString_(row[POINT_TYPE_COLUMN.updatedAt - 1]);
  var createdBy = String(row[POINT_TYPE_COLUMN.createdBy - 1] || "");
  var lastRequestId = String(row[POINT_TYPE_COLUMN.lastRequestId - 1] || "");
  var expiryMode = normalizeStoredExpiryMode_(row[POINT_TYPE_COLUMN.expiryMode - 1]);
  var redemptionMode = normalizeStoredRedemptionMode_(
    row[POINT_TYPE_COLUMN.redemptionMode - 1]
  );
  var deletedBy = String(row[POINT_TYPE_COLUMN.deletedBy - 1] || "");
  var deleteRequestId = String(row[POINT_TYPE_COLUMN.deleteRequestId - 1] || "");
  var hasDeletionAudit = Boolean(deletedBy || deleteRequestId);
  if (
    !/^PTY-[A-Z0-9]{10}$/.test(pointTypeId) ||
    !isFinite(points) ||
    Math.floor(points) !== points ||
    points < 1 ||
    points > MAX_POINT_VALUE ||
    label !== pointLabel_(points) ||
    !status ||
    !createdAt ||
    !updatedAt ||
    !/^U[0-9a-f]{32}$/.test(createdBy) ||
    !/^[a-zA-Z0-9-]{10,80}$/.test(lastRequestId) ||
    !expiryMode ||
    !redemptionMode ||
    (hasDeletionAudit &&
      (!/^U[0-9a-f]{32}$/.test(deletedBy) ||
        !/^[a-zA-Z0-9-]{10,80}$/.test(deleteRequestId))) ||
    (status === "active" && hasDeletionAudit)
  ) {
    throw appError_(
      "POINT_DATA_CONFLICT",
      "點數類型第 " + rowNumber + " 列資料不正確，請先修正試算表。"
    );
  }
  return {
    rowNumber: rowNumber,
    pointTypeId: pointTypeId,
    label: label,
    points: points,
    status: status,
    createdAt: createdAt,
    updatedAt: updatedAt,
    createdBy: createdBy,
    lastRequestId: lastRequestId,
    expiryMode: expiryMode,
    redemptionMode: redemptionMode,
    deletedBy: deletedBy,
    deleteRequestId: deleteRequestId,
  };
}

function pointTypeResponseFromRecord_(record) {
  return {
    pointTypeId: record.pointTypeId,
    label: record.label,
    points: record.points,
    status: record.status,
    expiryMode: record.expiryMode,
    redemptionMode: record.redemptionMode,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function pointCampaignRecordFromRow_(row, rowNumber) {
  var campaignId = String(row[POINT_CAMPAIGN_COLUMN.campaignId - 1] || "");
  var pointTypeId = String(row[POINT_CAMPAIGN_COLUMN.pointTypeId - 1] || "");
  var points = Number(row[POINT_CAMPAIGN_COLUMN.pointsSnapshot - 1]);
  var label = String(row[POINT_CAMPAIGN_COLUMN.labelSnapshot - 1] || "");
  var claimHash = String(row[POINT_CAMPAIGN_COLUMN.claimHash - 1] || "").toLowerCase();
  var status = strictPointStatus_(row[POINT_CAMPAIGN_COLUMN.status - 1]);
  var expiresAt = toIsoString_(row[POINT_CAMPAIGN_COLUMN.expiresAt - 1]);
  var createdAt = toIsoString_(row[POINT_CAMPAIGN_COLUMN.createdAt - 1]);
  var createdBy = String(row[POINT_CAMPAIGN_COLUMN.createdBy - 1] || "");
  var lastRequestId = String(row[POINT_CAMPAIGN_COLUMN.lastRequestId - 1] || "");
  var expiryMode = normalizeStoredExpiryMode_(
    row[POINT_CAMPAIGN_COLUMN.expiryModeSnapshot - 1]
  );
  var redemptionMode = normalizeStoredRedemptionMode_(
    row[POINT_CAMPAIGN_COLUMN.redemptionModeSnapshot - 1]
  );
  if (
    !/^PCG-[A-Z0-9]{10}$/.test(campaignId) ||
    !/^PTY-[A-Z0-9]{10}$/.test(pointTypeId) ||
    !isFinite(points) ||
    Math.floor(points) !== points ||
    points < 1 ||
    points > MAX_POINT_VALUE ||
    label !== pointLabel_(points) ||
    !/^[a-f0-9]{64}$/.test(claimHash) ||
    !status ||
    !expiryMode ||
    !redemptionMode ||
    (expiryMode === "limited" && !expiresAt) ||
    (expiryMode === "unlimited" && Boolean(expiresAt)) ||
    !createdAt ||
    !/^U[0-9a-f]{32}$/.test(createdBy) ||
    !/^[a-zA-Z0-9-]{10,80}$/.test(lastRequestId)
  ) {
    throw appError_(
      "POINT_DATA_CONFLICT",
      "點數活動第 " + rowNumber + " 列資料不正確，請先修正試算表。"
    );
  }
  return {
    rowNumber: rowNumber,
    campaignId: campaignId,
    pointTypeId: pointTypeId,
    label: label,
    points: points,
    claimHash: claimHash,
    status: status,
    expiresAt: expiresAt,
    expiryMode: expiryMode,
    redemptionMode: redemptionMode,
    createdAt: createdAt,
    createdBy: createdBy,
    lastRequestId: lastRequestId,
  };
}

function pointCampaignResponseFromRecord_(record) {
  return {
    campaignId: record.campaignId,
    pointTypeId: record.pointTypeId,
    label: record.label,
    points: record.points,
    status: record.status,
    expiresAt: record.expiresAt,
    expiryMode: record.expiryMode,
    redemptionMode: record.redemptionMode,
    createdAt: record.createdAt,
  };
}

function normalizeStoredExpiryMode_(value) {
  var mode = String(value || "").trim().toLowerCase();
  return mode === "limited" || mode === "unlimited" ? mode : "";
}

function normalizeStoredRedemptionMode_(value) {
  var mode = String(value || "").trim().toLowerCase();
  return mode === "once_per_member" ||
    mode === "repeatable" ||
    mode === "single_member"
    ? mode
    : "";
}

function strictPointStatus_(value) {
  var status = String(value || "").trim().toLowerCase();
  return status === "active" || status === "inactive" ? status : "";
}

function findUniqueRowByTextColumn_(
  sheet,
  column,
  expectedValue,
  conflictCode,
  conflictMessage
) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  var values = sheet.getRange(2, column, lastRow - 1, 1).getValues();
  var rowNumber = 0;
  for (var i = 0; i < values.length; i += 1) {
    if (String(values[i][0] || "") !== expectedValue) continue;
    if (rowNumber) throw appError_(conflictCode, conflictMessage);
    rowNumber = i + 2;
  }
  return rowNumber;
}

function generateUniqueEntityId_(prefix, sheet, idColumn, conflictCode) {
  var lastRow = sheet.getLastRow();
  var existing = Object.create(null);
  if (lastRow >= 2) {
    sheet
      .getRange(2, idColumn, lastRow - 1, 1)
      .getValues()
      .forEach(function (row) {
        existing[String(row[0] || "")] = true;
      });
  }
  for (var i = 0; i < 8; i += 1) {
    var id =
      prefix +
      Utilities.getUuid().replace(/-/g, "").slice(0, 10).toUpperCase();
    if (!existing[id]) return id;
  }
  throw appError_(conflictCode, "目前無法產生唯一識別碼，請稍後再試。");
}

function createCampaignClaim_(campaignId, requestId, secret) {
  if (
    !/^PCG-[A-Z0-9]{10}$/.test(String(campaignId || "")) ||
    !/^[a-zA-Z0-9-]{10,80}$/.test(String(requestId || "")) ||
    !isValidPointClaimSecret_(secret)
  ) {
    throw appError_("CONFIG_ERROR", "點數 QR 安全設定不完整。");
  }
  var bytes = Utilities.computeHmacSha256Signature(
    "point-campaign:v1:" + campaignId + ":" + requestId,
    secret,
    Utilities.Charset.UTF_8
  );
  var claim = Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, "");
  if (!/^[A-Za-z0-9_-]{43}$/.test(claim)) {
    throw appError_("INTERNAL_ERROR", "目前無法產生點數 QR。");
  }
  return claim;
}

function sha256Hex_(value) {
  var bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(value || ""),
    Utilities.Charset.UTF_8
  );
  return bytes
    .map(function (byte) {
      return ((Number(byte) + 256) % 256).toString(16).padStart(2, "0");
    })
    .join("");
}

function buildPointClaimUrl_(memberLiffUrl, claim) {
  var normalizedUrl = normalizeMemberLiffUrl_(memberLiffUrl);
  if (!normalizedUrl || !/^[A-Za-z0-9_-]{43}$/.test(String(claim || ""))) {
    throw appError_("CONFIG_ERROR", "會員 LIFF 或點數 QR 安全設定不完整。");
  }
  return normalizedUrl + "?claim=" + encodeURIComponent(claim);
}

function optionalNumber_(value, fallback) {
  return value === undefined || value === null || value === "" ? fallback : Number(value);
}

function isPositiveInteger_(value) {
  var number = Number(value);
  return number >= 1 && number !== Infinity && Math.floor(number) === number;
}

function isAllowedRequestOrigin_(requestedOrigin) {
  if (!requestedOrigin || !isValidOrigin_(requestedOrigin)) return false;
  return getAllowedOrigins_().indexOf(requestedOrigin) !== -1;
}

function getAllowedOrigins_() {
  var raw = String(
    PropertiesService.getScriptProperties().getProperty("ALLOWED_ORIGINS") || ""
  );
  var origins = [];
  raw
    .split(",")
    .map(normalizeOrigin_)
    .forEach(function (origin) {
      if (origin && isValidOrigin_(origin) && origins.indexOf(origin) === -1) {
        origins.push(origin);
      }
    });
  return origins;
}

function isValidOrigin_(origin) {
  return (
    /^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(origin) ||
    /^http:\/\/(localhost|127\.0\.0\.1)(?::\d+)?$/i.test(origin)
  );
}

function normalizeOrigin_(value) {
  return String(value || "").trim().replace(/\/+$/, "");
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
    var cacheKey = "admin-line-verify-count:" + minuteBucket;
    lock = LockService.getScriptLock();
    acquired = lock.tryLock(1000);

    if (!acquired) {
      throw appError_("BUSY", "管理員驗證請求較多，請稍後再試。");
    }

    var cache = CacheService.getScriptCache();
    var count = Math.max(0, Number(cache.get(cacheKey)) || 0);
    if (count >= limit) {
      throw appError_("LINE_RATE_LIMITED", "管理員驗證請求已達暫時上限，請稍後再試。");
    }
    cache.put(cacheKey, String(count + 1), 120);
  } catch (error) {
    if (error && error.appCode) throw error;
    // Best effort only; identity verification still occurs at LINE.
  } finally {
    if (acquired && lock) lock.releaseLock();
  }
}

function bridgeResponse_(result, request) {
  var targetOrigin = isValidOrigin_(request.callbackOrigin) ? request.callbackOrigin : "";
  var secret = /^[a-f0-9]{48}$/.test(request.requestSecret || "")
    ? request.requestSecret
    : "";

  if (!targetOrigin || !secret) {
    return HtmlService.createHtmlOutput(
      "<!doctype html><meta charset=\"utf-8\"><title>Invalid bridge</title>"
    ).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  var message = {
    type: "MEMBER_GAS_RESPONSE",
    requestId: String(request.requestId || ""),
    requestSecret: secret,
    result: result,
  };
  var html =
    "<!doctype html><html><head><meta charset=\"utf-8\"><title>Admin sync</title></head>" +
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

  // Never log request bodies, ID tokens, or LINE user IDs.
  console.error("Admin API error code: " + code);

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

function memberPhoneFromRow_(row) {
  var phone = String(row[MEMBER_COLUMN.phone - 1] || "").trim().slice(0, 30);
  return /^'[=+\-@]/.test(phone) ? phone.slice(1) : phone;
}

function memberBirthdayFromRow_(row) {
  var birthday = String(row[MEMBER_COLUMN.birthday - 1] || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(birthday) ? birthday : "";
}

function safeSheetText_(value) {
  var text = String(value == null ? "" : value);
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function plainSheetText_(value, maxLength) {
  var text = String(value == null ? "" : value).trim();
  if (/^'[=+\-@]/.test(text)) text = text.slice(1);
  return text.slice(0, maxLength || 200);
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
  if (!status || status === "approved" || status === "active" || status === "pending") {
    return "approved";
  }
  if (status === "denied") return "denied";
  return "pending";
}

function strictAdminStatus_(value) {
  var status = String(value || "").trim().toLowerCase();
  return status === "approved" || status === "pending" || status === "denied"
    ? status
    : "";
}

function dateSortValue_(value) {
  var date = value instanceof Date ? value : new Date(value);
  var timestamp = date.getTime();
  return isNaN(timestamp) ? 0 : timestamp;
}

function toIsoString_(value) {
  if (value === "" || value === null || value === undefined) return "";
  var date = value instanceof Date ? value : new Date(value);
  return isNaN(date.getTime()) ? "" : date.toISOString();
}
