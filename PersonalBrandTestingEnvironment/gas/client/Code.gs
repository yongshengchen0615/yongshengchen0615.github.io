/**
 * PERSONA MEMBERS - client-only Google Apps Script backend
 *
 * Required Script Properties:
 * - LINE_CHANNEL_ID: member LIFF LINE Login channel ID (for example 2010787602)
 * - SPREADSHEET_ID: Google Sheet ID shared with the administrator backend
 * - ALLOWED_ORIGINS: comma-separated frontend origins
 *
 * Optional:
 * - SHEET_NAME: defaults to "Members"
 * - POINT_TYPE_SHEET_NAME: defaults to "PointTypes"
 * - POINT_CAMPAIGN_SHEET_NAME: defaults to "PointCampaigns"
 * - POINT_REDEMPTION_SHEET_NAME: defaults to "PointRedemptions"
 * - POINT_CARD_SETTING_SHEET_NAME: defaults to "PointCardSettings"
 * - LOTTERY_TYPE_SHEET_NAME: defaults to "LotteryTypes"
 * - LOTTERY_PRIZE_SHEET_NAME: defaults to "LotteryPrizes"
 * - LOTTERY_DRAW_SHEET_NAME: defaults to "LotteryDraws"
 * - MAX_VERIFY_REQUESTS_PER_MINUTE: defaults to 120 (1-1000)
 *
 * This deployment accepts only member-owned actions. It deliberately does not
 * authorize or implement administrator actions.
 */

var API_VERSION = "1.6.0";
var DEFAULT_SHEET_NAME = "Members";
var DEFAULT_POINT_TYPE_SHEET_NAME = "PointTypes";
var DEFAULT_POINT_CAMPAIGN_SHEET_NAME = "PointCampaigns";
var DEFAULT_POINT_REDEMPTION_SHEET_NAME = "PointRedemptions";
var DEFAULT_POINT_CARD_SETTING_SHEET_NAME = "PointCardSettings";
var DEFAULT_LOTTERY_TYPE_SHEET_NAME = "LotteryTypes";
var DEFAULT_LOTTERY_PRIZE_SHEET_NAME = "LotteryPrizes";
var DEFAULT_LOTTERY_DRAW_SHEET_NAME = "LotteryDraws";
var MAX_POINT_HISTORY_ENTRIES = 30;
var MAX_POINT_VALUE = 9999;
var DEFAULT_POINT_CARD_TARGET = 5;
var LEGACY_LOTTERY_TICKET_COST = 5;
var DEFAULT_LOTTERY_TYPE_ID = "LTY-DEFAULT001";
var DEFAULT_LOTTERY_TYPE_NAME = "經典轉盤";
var DEFAULT_POINT_CARD_SETTING_VERSION = "PCS-DEFAULT00001";
var MIN_LOTTERY_PRIZES = 2;
var MAX_LOTTERY_PRIZES = 12;
var LINE_VERIFY_URL = "https://api.line.me/oauth2/v2.1/verify";
var MAX_ID_TOKEN_LENGTH = 6000;

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

// Preserve the exact former 21-column schema, then append editable profile
// fields so existing indexes and spreadsheet data never move.
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

var LEGACY_POINT_CARD_SETTING_HEADERS = [
  "setting_version",
  "target_points",
  "effective_at",
  "updated_by",
  "last_request_id",
];
var POINT_CARD_SETTING_HEADERS = LEGACY_POINT_CARD_SETTING_HEADERS.concat([
  "reward_milestones",
]);

var POINT_CARD_SETTING_COLUMN = {
  settingVersion: 1,
  targetPoints: 2,
  effectiveAt: 3,
  updatedBy: 4,
  lastRequestId: 5,
  rewardMilestones: 6,
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
        service: "member-client-api",
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

    // callbackOrigin is only an operational allowlist. The verified LINE ID
    // token remains the identity authority.
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

/** Run once after configuring Script Properties. */
function setup() {
  var config = getConfig_();
  var lock = LockService.getScriptLock();

  if (!lock.tryLock(10000)) {
    throw new Error("Could not acquire setup lock. Try again in a few seconds.");
  }

  try {
    var sheet = getOrCreateMemberSheet_(config);
    var pointTypeSheet = getOrCreatePointTypeSheet_(config);
    var pointCampaignSheet = getOrCreatePointCampaignSheet_(config);
    var pointRedemptionSheet = getOrCreatePointRedemptionSheet_(config);
    var pointCardSettingSheet = getOrCreatePointCardSettingSheet_(config);
    var lotteryTypeSheet = getOrCreateLotteryTypeSheet_(config);
    ensureDefaultPointCardSetting_(pointCardSettingSheet);
    ensureDefaultLotteryType_(lotteryTypeSheet);
    var lotteryPrizeSheet = getOrCreateLotteryPrizeSheet_(config);
    var lotteryDrawSheet = getOrCreateLotteryDrawSheet_(config);
    migrateDefaultMemberAccess_(sheet);
    applySheetColumnFormats_(sheet);
    applyPointTypeSheetFormats_(pointTypeSheet);
    applyPointCampaignSheetFormats_(pointCampaignSheet);
    applyPointRedemptionSheetFormats_(pointRedemptionSheet);
    applyPointCardSettingSheetFormats_(pointCardSettingSheet);
    applyLotteryTypeSheetFormats_(lotteryTypeSheet);
    applyLotteryPrizeSheetFormats_(lotteryPrizeSheet);
    applyLotteryDrawSheetFormats_(lotteryDrawSheet);
    SpreadsheetApp.flush();
    return {
      ok: true,
      spreadsheetId: config.spreadsheetId,
      sheetName: sheet.getName(),
      columns: MEMBER_HEADERS.length,
      accessStatuses: ["approved", "denied"],
      pointTypeSheetName: pointTypeSheet.getName(),
      pointTypeColumns: POINT_TYPE_HEADERS.length,
      pointCampaignSheetName: pointCampaignSheet.getName(),
      pointCampaignColumns: POINT_CAMPAIGN_HEADERS.length,
      pointRedemptionSheetName: pointRedemptionSheet.getName(),
      pointRedemptionColumns: POINT_REDEMPTION_HEADERS.length,
      pointCardSettingSheetName: pointCardSettingSheet.getName(),
      pointCardSettingColumns: POINT_CARD_SETTING_HEADERS.length,
      lotteryTypeSheetName: lotteryTypeSheet.getName(),
      lotteryTypeColumns: LOTTERY_TYPE_HEADERS.length,
      lotteryPrizeSheetName: lotteryPrizeSheet.getName(),
      lotteryPrizeColumns: LOTTERY_PRIZE_HEADERS.length,
      lotteryDrawSheetName: lotteryDrawSheet.getName(),
      lotteryDrawColumns: LOTTERY_DRAW_HEADERS.length,
    };
  } finally {
    lock.releaseLock();
  }
}

function handleMemberRequest_(request) {
  // Keep this guard here as well as in validateRequestEnvelope_ so direct
  // internal calls cannot make an admin request reach config or token checks.
  assertSupportedAction_(request && request.action);

  var config = getConfig_();
  var identity = verifyLineIdToken_(request.idToken, config.lineChannelId);

  if (request.action === "upsertMember") {
    return upsertMember_(identity, request, config);
  }

  if (request.action === "updateMemberProfile") {
    return updateMemberProfile_(identity, request, config);
  }

  if (request.action === "listPointHistory") {
    return listPointHistory_(identity, request, config);
  }

  if (request.action === "getLotteryConfig") {
    return getLotteryConfig_(identity, request, config);
  }

  if (request.action === "drawLottery") {
    return drawLottery_(identity, request, config);
  }

  if (request.action === "previewPointCampaign") {
    return previewPointCampaign_(identity, request, config);
  }

  if (request.action === "redeemPointCampaign") {
    return redeemPointCampaign_(identity, request, config);
  }

  return deleteMember_(identity, request, config);
}

function assertSupportedAction_(action) {
  if (
    action !== "upsertMember" &&
    action !== "updateMemberProfile" &&
    action !== "listPointHistory" &&
    action !== "getLotteryConfig" &&
    action !== "drawLottery" &&
    action !== "previewPointCampaign" &&
    action !== "redeemPointCampaign" &&
    action !== "deleteMember"
  ) {
    throw appError_("UNSUPPORTED_ACTION", "此會員端後台不支援該操作。");
  }
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

        // Deliberately use field-level writes. In particular, legacy email,
        // status, admin_status, phone and birthday are never overwritten here.
        sheet
          .getRange(rowNumber, MEMBER_COLUMN.displayName, 1, 2)
          .setValues([[
            safeSheetText_(identity.displayName),
            safeSheetText_(identity.pictureUrl),
          ]]);
        sheet.getRange(rowNumber, MEMBER_COLUMN.updatedAt).setValues([[now]]);
        if (isNewLoginSession) {
          sheet
            .getRange(rowNumber, MEMBER_COLUMN.lastLoginAt, 1, 2)
            .setValues([[
              now,
              Math.max(0, Number(row[MEMBER_COLUMN.loginCount - 1]) || 0) + 1,
            ]]);
        }
        sheet
          .getRange(rowNumber, MEMBER_COLUMN.contextType, 1, 7)
          .setValues([[
            safeSheetText_(context.type),
            safeSheetText_(context.os),
            safeSheetText_(context.language),
            context.inClient,
            safeSheetText_(context.viewType),
            identity.tokenIssuedAt,
            request.requestId,
          ]]);
        applyMemberRowFormats_(sheet, rowNumber);
      }
    }

    if (created || !isDuplicate) SpreadsheetApp.flush();

    if (!isDuplicate) {
      markRequestProcessed_(
        identity.lineUserId,
        request.action,
        request.requestId,
        created ? "created" : "updated"
      );
    }

    // Re-read so an administrator's Sheet edit is reflected in the response.
    row = sheet.getRange(rowNumber, 1, 1, MEMBER_HEADERS.length).getValues()[0];
    var access = memberAccessFromRow_(row);
    var pointBalance = access.allowed
      ? getMemberPointBalanceForConfig_(config, identity.lineUserId)
      : 0;

    return {
      data: {
        created: responseCreated,
        access: access,
        member: access.allowed
          ? memberResponseFromRow_(row, identity, context, pointBalance)
          : null,
      },
    };
  } catch (error) {
    if (error && error.appCode) throw error;
    throw appError_("SPREADSHEET_ERROR", "會員試算表目前無法使用，請稍後再試。");
  } finally {
    lock.releaseLock();
  }
}

function updateMemberProfile_(identity, request, config) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    throw appError_("BUSY", "會員資料正在更新，請稍後再試。");
  }

  try {
    var phone = normalizeMemberPhone_(request.phone);
    var birthday = normalizeMemberBirthday_(request.birthday);
    var sheet = getOrCreateMemberSheet_(config);
    var rowNumber = findMemberRow_(sheet, identity.lineUserId);
    if (!rowNumber) {
      throw appError_("MEMBER_NOT_FOUND", "找不到會員資料，請重新登入後再試。");
    }

    var row = sheet.getRange(rowNumber, 1, 1, MEMBER_HEADERS.length).getValues()[0];
    var access = memberAccessFromRow_(row);
    if (!access.allowed) {
      throw appError_("MEMBER_ACCESS_DENIED", "目前帳號已停用，無法修改會員資料。");
    }

    var recentOutcome = getRecentRequestOutcome_(
      identity.lineUserId,
      request.action,
      request.requestId
    );
    var isDuplicate =
      String(row[MEMBER_COLUMN.lastRequestId - 1] || "") === request.requestId ||
      Boolean(recentOutcome);

    if (!isDuplicate) {
      var now = new Date();
      sheet.getRange(rowNumber, MEMBER_COLUMN.updatedAt).setValues([[now]]);
      sheet
        .getRange(rowNumber, MEMBER_COLUMN.lastRequestId)
        .setValues([[request.requestId]]);
      sheet
        .getRange(rowNumber, MEMBER_COLUMN.phone, 1, 2)
        .setValues([[safeSheetText_(phone), safeSheetText_(birthday)]]);
      applyMemberRowFormats_(sheet, rowNumber);
      SpreadsheetApp.flush();
      markRequestProcessed_(identity.lineUserId, request.action, request.requestId, "updated");
    }

    // Re-read because the independent administrator GAS can change access at
    // any time. A newly disabled member never receives profile data.
    row = sheet.getRange(rowNumber, 1, 1, MEMBER_HEADERS.length).getValues()[0];
    access = memberAccessFromRow_(row);
    var context = normalizeContext_(request.context);
    var pointBalance = access.allowed
      ? getMemberPointBalanceForConfig_(config, identity.lineUserId)
      : 0;

    return {
      data: {
        access: access,
        member: access.allowed
          ? memberResponseFromRow_(row, identity, context, pointBalance)
          : null,
        duplicate: isDuplicate,
      },
    };
  } catch (error) {
    if (error && error.appCode) throw error;
    throw appError_("SPREADSHEET_ERROR", "目前無法更新會員資料，請稍後再試。");
  } finally {
    lock.releaseLock();
  }
}

function listPointHistory_(identity, request, config) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    throw appError_("BUSY", "點數紀錄正在整理，請稍後再試。");
  }

  try {
    var memberSheet = getOrCreateMemberSheet_(config);
    var memberRowNumber = findMemberRow_(memberSheet, identity.lineUserId);
    if (!memberRowNumber) {
      throw appError_("MEMBER_NOT_FOUND", "找不到會員資料，請重新登入後再試。");
    }

    var memberRow = memberSheet
      .getRange(memberRowNumber, 1, 1, MEMBER_HEADERS.length)
      .getValues()[0];
    var access = memberAccessFromRow_(memberRow);
    if (!access.allowed) {
      throw appError_("MEMBER_ACCESS_DENIED", "目前帳號已停用，無法讀取點數紀錄。");
    }

    var redemptionSheet = getOrCreatePointRedemptionSheet_(config);
    var lotteryDrawSheet = getOrCreateLotteryDrawSheet_(config);
    var pointBalance = getMemberPointBalance_(
      redemptionSheet,
      identity.lineUserId,
      lotteryDrawSheet
    );
    var history = readMemberPointHistory_(redemptionSheet, identity.lineUserId)
      .concat(readMemberLotteryHistory_(lotteryDrawSheet, identity.lineUserId))
      .sort(function (left, right) {
        return new Date(right.redeemedAt).getTime() - new Date(left.redeemedAt).getTime();
      });

    return {
      data: {
        access: access,
        pointBalance: pointBalance,
        history: history.slice(0, MAX_POINT_HISTORY_ENTRIES),
        hasMore: history.length > MAX_POINT_HISTORY_ENTRIES,
      },
    };
  } catch (error) {
    if (error && error.appCode) throw error;
    throw appError_("SPREADSHEET_ERROR", "目前無法讀取點數紀錄，請稍後再試。");
  } finally {
    lock.releaseLock();
  }
}

function readMemberPointHistory_(sheet, lineUserId) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var rows = sheet
    .getRange(2, 1, lastRow - 1, POINT_REDEMPTION_HEADERS.length)
    .getValues();
  var redemptionIds = Object.create(null);
  var requestKeys = Object.create(null);
  var campaignModes = Object.create(null);
  var history = [];

  rows.forEach(function (row, index) {
    var redemptionId = plainSheetText_(
      row[POINT_REDEMPTION_COLUMN.redemptionId - 1],
      100
    );
    var storedLineUserId = plainSheetText_(
      row[POINT_REDEMPTION_COLUMN.lineUserId - 1],
      128
    );
    var requestId = plainSheetText_(row[POINT_REDEMPTION_COLUMN.requestId - 1], 100);
    var requestKey = storedLineUserId + ":" + requestId;
    if (
      !/^RDM-[A-Z0-9]{16}$/.test(redemptionId) ||
      !/^U[0-9a-f]{32}$/.test(storedLineUserId) ||
      !/^[a-zA-Z0-9-]{10,80}$/.test(requestId) ||
      redemptionIds[redemptionId] ||
      requestKeys[requestKey]
    ) {
      throw appError_(
        "POINT_DATA_ERROR",
        "會員點數紀錄格式不正確，請聯絡管理員。"
      );
    }
    redemptionIds[redemptionId] = true;
    requestKeys[requestKey] = true;

    var campaignId = plainSheetText_(
      row[POINT_REDEMPTION_COLUMN.campaignId - 1],
      100
    );
    var pointTypeId = plainSheetText_(
      row[POINT_REDEMPTION_COLUMN.pointTypeId - 1],
      100
    );
    var memberId = plainSheetText_(row[POINT_REDEMPTION_COLUMN.memberId - 1], 100);
    var points = Number(row[POINT_REDEMPTION_COLUMN.points - 1]);
    var balanceAfter = Number(row[POINT_REDEMPTION_COLUMN.balanceAfter - 1]);
    var redemptionMode = normalizeStoredRedemptionMode_(
      row[POINT_REDEMPTION_COLUMN.redemptionModeSnapshot - 1]
    );
    var redeemedAt = row[POINT_REDEMPTION_COLUMN.redeemedAt - 1];
    var redeemedDate =
      redeemedAt instanceof Date ? redeemedAt : new Date(String(redeemedAt || ""));
    if (
      !/^PCG-[A-Z0-9]{10}$/.test(campaignId) ||
      !/^PTY-[A-Z0-9]{10}$/.test(pointTypeId) ||
      !/^MBR-[A-Z0-9]{10}$/.test(memberId) ||
      !Number.isInteger(points) ||
      points < 1 ||
      points > 9999 ||
      !Number.isSafeInteger(balanceAfter) ||
      balanceAfter < points ||
      isNaN(redeemedDate.getTime()) ||
      !redemptionMode ||
      (campaignModes[storedLineUserId + ":" + campaignId] &&
        (campaignModes[storedLineUserId + ":" + campaignId] !== redemptionMode ||
          redemptionMode !== "repeatable"))
    ) {
      throw appError_(
        "POINT_DATA_ERROR",
        "會員點數紀錄格式不正確，請聯絡管理員。"
      );
    }
    campaignModes[storedLineUserId + ":" + campaignId] = redemptionMode;

    if (storedLineUserId === lineUserId) {
      history.push({
        historyId: redemptionId,
        entryType: "earn",
        redemptionId: redemptionId,
        label: String(points) + " 點",
        points: points,
        balanceAfter: balanceAfter,
        redeemedAt: redeemedDate.toISOString(),
        redemptionMode: redemptionMode,
        source: "qr",
        rowNumber: index + 2,
      });
    }
  });

  history.sort(function (left, right) {
    return new Date(right.redeemedAt).getTime() - new Date(left.redeemedAt).getTime();
  });
  return history.map(function (entry) {
    delete entry.rowNumber;
    return entry;
  });
}

function readMemberLotteryHistory_(sheet, lineUserId) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var rows = sheet
    .getRange(2, 1, lastRow - 1, LOTTERY_DRAW_HEADERS.length)
    .getValues();
  var drawIds = Object.create(null);
  var requestKeys = Object.create(null);
  var history = [];

  rows.forEach(function (row) {
    var draw = lotteryDrawRecordFromRow_(row);
    var requestKey = draw.lineUserId + ":" + draw.requestId;
    if (drawIds[draw.drawId] || requestKeys[requestKey]) {
      throw appError_("LOTTERY_DATA_ERROR", "抽獎紀錄識別碼重複，請聯絡管理員。");
    }
    drawIds[draw.drawId] = true;
    requestKeys[requestKey] = true;
    if (draw.lineUserId !== lineUserId) return;
    history.push({
      historyId: draw.drawId,
      entryType: draw.legacyDraw ? "spend" : "draw",
      drawId: draw.drawId,
      label: (draw.legacyDraw ? "5 點抽獎券 · " : "集點卡抽獎 · ") + draw.prizeLabel,
      points: draw.pointsSpent ? -draw.pointsSpent : 0,
      balanceAfter: draw.balanceAfter,
      redeemedAt: draw.drawnAt,
      redemptionMode: "lottery",
      source: "lottery",
      prizeLabel: draw.prizeLabel,
      prizeColor: draw.prizeColor,
      lotteryTypeId: draw.lotteryTypeId,
    });
  });

  return history;
}

function readPointCardSettings_(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    throw appError_("POINT_CARD_NOT_CONFIGURED", "管理員尚未設定集點卡規則。");
  }
  var rows = sheet
    .getRange(2, 1, lastRow - 1, POINT_CARD_SETTING_HEADERS.length)
    .getValues();
  var versions = Object.create(null);
  var requests = Object.create(null);
  var settings = rows.map(function (row) {
    var settingVersion = plainSheetText_(
      row[POINT_CARD_SETTING_COLUMN.settingVersion - 1],
      100
    );
    var targetPoints = Number(row[POINT_CARD_SETTING_COLUMN.targetPoints - 1]);
    var rawEffectiveAt = row[POINT_CARD_SETTING_COLUMN.effectiveAt - 1];
    var effectiveAtDate =
      rawEffectiveAt instanceof Date
        ? rawEffectiveAt
        : new Date(String(rawEffectiveAt || ""));
    var updatedBy = plainSheetText_(
      row[POINT_CARD_SETTING_COLUMN.updatedBy - 1],
      100
    );
    var lastRequestId = plainSheetText_(
      row[POINT_CARD_SETTING_COLUMN.lastRequestId - 1],
      100
    );
    var rewardMilestones = parsePointCardMilestones_(
      row[POINT_CARD_SETTING_COLUMN.rewardMilestones - 1],
      targetPoints
    );
    if (
      !/^PCS-[A-Z0-9]{12}$/.test(settingVersion) ||
      !Number.isInteger(targetPoints) ||
      targetPoints < 1 ||
      targetPoints > MAX_POINT_VALUE ||
      isNaN(effectiveAtDate.getTime()) ||
      (updatedBy !== "SYSTEM" && !/^ADM-[A-Z0-9]{10}$/.test(updatedBy)) ||
      !/^[a-zA-Z0-9-]{10,80}$/.test(lastRequestId) ||
      versions[settingVersion] ||
      requests[lastRequestId]
    ) {
      throw appError_("POINT_CARD_DATA_ERROR", "集點卡規則資料格式不正確。");
    }
    versions[settingVersion] = true;
    requests[lastRequestId] = true;
    return {
      settingVersion: settingVersion,
      targetPoints: targetPoints,
      rewardMilestones: rewardMilestones,
      effectiveAt: effectiveAtDate.toISOString(),
      effectiveAtTime: effectiveAtDate.getTime(),
    };
  });
  settings.sort(function (left, right) {
    return left.effectiveAtTime - right.effectiveAtTime;
  });
  for (var i = 1; i < settings.length; i += 1) {
    if (settings[i].effectiveAtTime <= settings[i - 1].effectiveAtTime) {
      throw appError_("POINT_CARD_DATA_ERROR", "集點卡規則生效時間不正確。");
    }
  }
  return settings;
}

function parsePointCardMilestones_(value, targetPoints) {
  var raw = String(value == null ? "" : value).trim();
  if (!raw) raw = String(targetPoints);
  var parts = raw.split(/[\s,，、]+/);
  var milestones = [];
  for (var i = 0; i < parts.length; i += 1) {
    if (!parts[i]) continue;
    var milestone = Number(parts[i]);
    if (
      !Number.isInteger(milestone) ||
      milestone < 1 ||
      milestone > targetPoints ||
      (milestones.length && milestone <= milestones[milestones.length - 1])
    ) {
      throw appError_("POINT_CARD_DATA_ERROR", "集點卡抽獎節點資料格式不正確。");
    }
    milestones.push(milestone);
  }
  if (
    milestones.length < 1 ||
    milestones.length > 20 ||
    milestones[milestones.length - 1] !== targetPoints
  ) {
    throw appError_("POINT_CARD_DATA_ERROR", "集點卡抽獎節點必須以總點數作為最後一站。");
  }
  return milestones;
}

function readLotteryTypes_(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    throw appError_("LOTTERY_NOT_CONFIGURED", "管理員尚未建立轉盤類型。");
  }
  var rows = sheet
    .getRange(2, 1, lastRow - 1, LOTTERY_TYPE_HEADERS.length)
    .getValues();
  var ids = Object.create(null);
  var activeNames = Object.create(null);
  return rows.map(function (row) {
    var lotteryTypeId = plainSheetText_(row[LOTTERY_TYPE_COLUMN.lotteryTypeId - 1], 100);
    var name = plainSheetText_(row[LOTTERY_TYPE_COLUMN.name - 1], 40);
    var status = String(row[LOTTERY_TYPE_COLUMN.status - 1] || "").trim().toLowerCase();
    var createdAt = toIsoString_(row[LOTTERY_TYPE_COLUMN.createdAt - 1]);
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
      throw appError_("LOTTERY_DATA_ERROR", "轉盤類型資料格式不正確。");
    }
    ids[lotteryTypeId] = true;
    if (status === "active") activeNames[name.toLowerCase()] = true;
    return {
      lotteryTypeId: lotteryTypeId,
      name: name,
      status: status,
      createdAt: createdAt,
      updatedAt: updatedAt,
    };
  });
}

function findActiveLotteryType_(types, lotteryTypeId) {
  var matches = types.filter(function (type) {
    return type.lotteryTypeId === lotteryTypeId;
  });
  if (matches.length !== 1 || matches[0].status !== "active") {
    throw appError_("LOTTERY_TYPE_NOT_FOUND", "找不到可使用的轉盤類型。");
  }
  return matches[0];
}

function findLotteryTypeById_(types, lotteryTypeId) {
  var matches = types.filter(function (type) {
    return type.lotteryTypeId === lotteryTypeId;
  });
  if (matches.length !== 1) {
    throw appError_("LOTTERY_DATA_ERROR", "抽獎紀錄使用了不存在的轉盤類型。");
  }
  return matches[0];
}

function memberLotteryTypeResponse_(type, lotteryConfig) {
  return {
    lotteryTypeId: type.lotteryTypeId,
    name: type.name,
    lottery: lotteryConfigResponse_(lotteryConfig),
  };
}

function getAvailableLotteryTypes_(typeSheet, prizeSheet) {
  var configs = readLotteryConfigs_(prizeSheet);
  var responses = [];
  readLotteryTypes_(typeSheet).forEach(function (type) {
    if (type.status !== "active") return;
    for (var i = 0; i < configs.length; i += 1) {
      if (configs[i].lotteryTypeId !== type.lotteryTypeId) continue;
      responses.push(memberLotteryTypeResponse_(type, configs[i]));
      return;
    }
  });
  if (!responses.length) {
    throw appError_("LOTTERY_NOT_CONFIGURED", "管理員尚未完成任何轉盤獎項設定。");
  }
  return responses;
}

function getMemberPointCardStatus_(
  redemptionSheet,
  drawSheet,
  settingSheet,
  lineUserId
) {
  var ledger = readMemberPointLedger_(redemptionSheet, lineUserId);
  var settings = readPointCardSettings_(settingSheet);
  var pointsBySetting = Object.create(null);
  settings.forEach(function (setting) {
    pointsBySetting[setting.settingVersion] = 0;
  });
  ledger.events.forEach(function (event) {
    var selected = null;
    for (var i = 0; i < settings.length; i += 1) {
      if (settings[i].effectiveAtTime <= event.redeemedAtTime) {
        selected = settings[i];
      } else {
        break;
      }
    }
    if (!selected) {
      throw appError_("POINT_CARD_DATA_ERROR", "點數紀錄早於第一版集點卡規則。");
    }
    pointsBySetting[selected.settingVersion] += event.points;
  });

  var ranges = [];
  var settingsByVersion = Object.create(null);
  var totalCompletedCards = 0;
  var totalEarnedRewards = 0;
  settings.forEach(function (setting) {
    var earned = pointsBySetting[setting.settingVersion];
    var completedCards = Math.floor(earned / setting.targetPoints);
    var currentPoints = earned % setting.targetPoints;
    var reachedMilestones = setting.rewardMilestones.filter(function (milestone) {
      return milestone <= currentPoints;
    });
    var earnedRewards =
      completedCards * setting.rewardMilestones.length +
      reachedMilestones.length;
    if (!Number.isSafeInteger(earnedRewards)) {
      throw appError_("POINT_CARD_DATA_ERROR", "集點卡抽獎資格數量超出可處理範圍。");
    }
    var range = {
      settingVersion: setting.settingVersion,
      targetPoints: setting.targetPoints,
      rewardMilestones: setting.rewardMilestones,
      earnedPoints: earned,
      currentPoints: currentPoints,
      reachedMilestones: reachedMilestones,
      completedCards: completedCards,
      earnedRewards: earnedRewards,
      startOrdinal: totalEarnedRewards + 1,
      endOrdinal: totalEarnedRewards + earnedRewards,
    };
    totalCompletedCards += completedCards;
    totalEarnedRewards += earnedRewards;
    if (
      !Number.isSafeInteger(totalCompletedCards) ||
      !Number.isSafeInteger(totalEarnedRewards)
    ) {
      throw appError_("POINT_CARD_DATA_ERROR", "集點卡累計資料超出可處理範圍。");
    }
    ranges.push(range);
    settingsByVersion[setting.settingVersion] = range;
  });

  var usedOrdinals = Object.create(null);
  var legacyDrawCount = 0;
  var memberDrawCount = 0;
  readAllLotteryDraws_(drawSheet).forEach(function (draw) {
    if (draw.lineUserId !== lineUserId) return;
    memberDrawCount += 1;
    if (draw.legacyDraw) {
      legacyDrawCount += 1;
      return;
    }
    var range = settingsByVersion[draw.cardSettingVersion];
    var keyParts = draw.cardRoundKey
      .slice(draw.cardSettingVersion.length + 1)
      .split(":");
    var cardNumber = Number(keyParts[0]);
    var milestonePoints =
      keyParts.length === 1 ? range && range.targetPoints : Number(keyParts[1]);
    var milestoneIndex = range
      ? range.rewardMilestones.indexOf(milestonePoints)
      : -1;
    var qualificationNumber =
      (cardNumber - 1) * (range ? range.rewardMilestones.length : 0) +
      milestoneIndex +
      1;
    if (
      !range ||
      (keyParts.length !== 1 && keyParts.length !== 2) ||
      !Number.isSafeInteger(cardNumber) ||
      cardNumber < 1 ||
      milestoneIndex < 0 ||
      !Number.isSafeInteger(qualificationNumber) ||
      qualificationNumber < 1 ||
      qualificationNumber > range.earnedRewards
    ) {
      throw appError_("LOTTERY_DATA_ERROR", "抽獎紀錄使用了不存在的集點卡獎勵節點。");
    }
    var usedOrdinal = range.startOrdinal + qualificationNumber - 1;
    if (usedOrdinals[usedOrdinal]) {
      throw appError_("LOTTERY_DATA_ERROR", "同一集點卡獎勵節點被重複抽獎。");
    }
    usedOrdinals[usedOrdinal] = true;
  });
  if (memberDrawCount > totalEarnedRewards) {
    throw appError_("LOTTERY_DATA_ERROR", "抽獎次數超過已取得的集點卡獎勵。");
  }

  var nextOrdinal = 0;
  var legacyRemaining = legacyDrawCount;
  var searchLimit = memberDrawCount + 1;
  for (var ordinal = 1; ordinal <= totalEarnedRewards && ordinal <= searchLimit; ordinal += 1) {
    if (usedOrdinals[ordinal]) continue;
    if (legacyRemaining > 0) {
      legacyRemaining -= 1;
      continue;
    }
    nextOrdinal = ordinal;
    break;
  }
  if (!nextOrdinal && memberDrawCount < totalEarnedRewards) {
    nextOrdinal = searchLimit;
    while (usedOrdinals[nextOrdinal]) nextOrdinal += 1;
  }

  var nextReward = null;
  if (nextOrdinal > 0 && nextOrdinal <= totalEarnedRewards) {
    for (var rangeIndex = 0; rangeIndex < ranges.length; rangeIndex += 1) {
      var candidate = ranges[rangeIndex];
      if (
        nextOrdinal < candidate.startOrdinal ||
        nextOrdinal > candidate.endOrdinal
      ) {
        continue;
      }
      var qualificationIndex = nextOrdinal - candidate.startOrdinal;
      var nextCardNumber =
        Math.floor(qualificationIndex / candidate.rewardMilestones.length) + 1;
      var nextMilestone =
        candidate.rewardMilestones[
          qualificationIndex % candidate.rewardMilestones.length
        ];
      nextReward = {
        settingVersion: candidate.settingVersion,
        cardNumber: nextCardNumber,
        roundNumber: nextCardNumber,
        milestonePoints: nextMilestone,
        cardRoundKey:
          candidate.settingVersion +
          ":" +
          nextCardNumber +
          ":" +
          nextMilestone,
      };
      break;
    }
  }

  var current = ranges[ranges.length - 1];
  var nextMilestonePoints = current.targetPoints;
  for (var milestoneIndex = 0; milestoneIndex < current.rewardMilestones.length; milestoneIndex += 1) {
    if (current.rewardMilestones[milestoneIndex] > current.currentPoints) {
      nextMilestonePoints = current.rewardMilestones[milestoneIndex];
      break;
    }
  }
  return {
    settingVersion: current.settingVersion,
    targetPoints: current.targetPoints,
    rewardMilestones: current.rewardMilestones.slice(),
    reachedMilestones: current.reachedMilestones.slice(),
    currentPoints: current.currentPoints,
    nextMilestonePoints: nextMilestonePoints,
    pointsRemaining: nextMilestonePoints - current.currentPoints,
    pointsToCardComplete: current.targetPoints - current.currentPoints,
    currentCardNumber: current.completedCards + 1,
    currentRound: current.completedCards + 1,
    completedCards: totalCompletedCards,
    completedRounds: totalCompletedCards,
    earnedRewards: totalEarnedRewards,
    drawsUsed: memberDrawCount,
    availableDraws: totalEarnedRewards - memberDrawCount,
    totalPoints: ledger.totalPoints,
    nextReward: nextReward,
    nextRound: nextReward,
  };
}

function pointCardStatusResponse_(status) {
  return {
    settingVersion: status.settingVersion,
    targetPoints: status.targetPoints,
    rewardMilestones: status.rewardMilestones.slice(),
    reachedMilestones: status.reachedMilestones.slice(),
    currentPoints: status.currentPoints,
    nextMilestonePoints: status.nextMilestonePoints,
    pointsRemaining: status.pointsRemaining,
    pointsToCardComplete: status.pointsToCardComplete,
    currentCardNumber: status.currentCardNumber,
    currentRound: status.currentRound,
    completedCards: status.completedCards,
    completedRounds: status.completedRounds,
    earnedRewards: status.earnedRewards,
    drawsUsed: status.drawsUsed,
    availableDraws: status.availableDraws,
    totalPoints: status.totalPoints,
  };
}

function getLotteryConfig_(identity, request, config) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    throw appError_("BUSY", "抽獎設定正在同步，請稍後再試。");
  }

  try {
    var memberSheet = getOrCreateMemberSheet_(config);
    var memberRowNumber = findMemberRow_(memberSheet, identity.lineUserId);
    if (!memberRowNumber) {
      throw appError_("MEMBER_NOT_FOUND", "找不到會員資料，請重新登入後再試。");
    }
    var memberRow = memberSheet
      .getRange(memberRowNumber, 1, 1, MEMBER_HEADERS.length)
      .getValues()[0];
    var access = memberAccessFromRow_(memberRow);
    if (!access.allowed) {
      throw appError_("MEMBER_ACCESS_DENIED", "目前帳號已停用，無法使用抽獎功能。");
    }

    var prizeSheet = getOrCreateLotteryPrizeSheet_(config);
    var drawSheet = getOrCreateLotteryDrawSheet_(config);
    var redemptionSheet = getOrCreatePointRedemptionSheet_(config);
    var settingSheet = getOrCreatePointCardSettingSheet_(config);
    var typeSheet = getOrCreateLotteryTypeSheet_(config);
    var cardStatus = getMemberPointCardStatus_(
      redemptionSheet,
      drawSheet,
      settingSheet,
      identity.lineUserId
    );
    var lotteryTypes = getAvailableLotteryTypes_(typeSheet, prizeSheet);

    return {
      data: {
        access: access,
        lotteryTypes: lotteryTypes,
        card: pointCardStatusResponse_(cardStatus),
        pointBalance: cardStatus.totalPoints,
        totalPoints: cardStatus.totalPoints,
        canDraw: cardStatus.availableDraws > 0,
      },
    };
  } catch (error) {
    if (error && error.appCode) throw error;
    throw appError_("SPREADSHEET_ERROR", "目前無法讀取抽獎設定，請稍後再試。");
  } finally {
    lock.releaseLock();
  }
}

function drawLottery_(identity, request, config) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    throw appError_("BUSY", "抽獎資格正在處理，請稍後再試。");
  }

  try {
    var memberSheet = getOrCreateMemberSheet_(config);
    var memberRowNumber = findMemberRow_(memberSheet, identity.lineUserId);
    if (!memberRowNumber) {
      throw appError_("MEMBER_NOT_FOUND", "找不到會員資料，請重新登入後再試。");
    }
    var memberRow = memberSheet
      .getRange(memberRowNumber, 1, 1, MEMBER_HEADERS.length)
      .getValues()[0];
    var access = memberAccessFromRow_(memberRow);
    if (!access.allowed) {
      throw appError_("MEMBER_ACCESS_DENIED", "目前帳號已停用，無法使用抽獎功能。");
    }

    var drawSheet = getOrCreateLotteryDrawSheet_(config);
    var prizeSheet = getOrCreateLotteryPrizeSheet_(config);
    var typeSheet = getOrCreateLotteryTypeSheet_(config);
    var settingSheet = getOrCreatePointCardSettingSheet_(config);
    var replayedDraw = findLotteryDrawByRequest_(
      drawSheet,
      identity.lineUserId,
      request.requestId
    );
    var redemptionSheet = getOrCreatePointRedemptionSheet_(config);
    if (replayedDraw) {
      if (replayedDraw.lotteryTypeId !== request.lotteryTypeId) {
        throw appError_("REQUEST_ID_CONFLICT", "同一抽獎請求不可更換轉盤類型。");
      }
      var replayCardStatus = getMemberPointCardStatus_(
        redemptionSheet,
        drawSheet,
        settingSheet,
        identity.lineUserId
      );
      return {
        data: {
          access: access,
          duplicate: true,
          draw: lotteryDrawResponse_(replayedDraw),
          lottery: lotteryConfigResponse_(
            readLotteryConfigByVersion_(prizeSheet, replayedDraw.configVersion)
          ),
          lotteryType: memberLotteryTypeResponse_(
            findLotteryTypeById_(
              readLotteryTypes_(typeSheet),
              replayedDraw.lotteryTypeId
            ),
            readLotteryConfigByVersion_(prizeSheet, replayedDraw.configVersion)
          ),
          card: pointCardStatusResponse_(replayCardStatus),
          pointBalance: replayCardStatus.totalPoints,
          totalPoints: replayCardStatus.totalPoints,
        },
      };
    }

    var lotteryType = findActiveLotteryType_(
      readLotteryTypes_(typeSheet),
      request.lotteryTypeId
    );
    var lotteryConfig = readLatestLotteryConfig_(
      prizeSheet,
      lotteryType.lotteryTypeId
    );
    var cardStatus = getMemberPointCardStatus_(
      redemptionSheet,
      drawSheet,
      settingSheet,
      identity.lineUserId
    );
    if (cardStatus.availableDraws < 1 || !cardStatus.nextRound) {
      throw appError_(
        "LOTTERY_ROUND_NOT_READY",
        "尚未到達新的抽獎節點，或已取得的抽獎資格皆已使用。"
      );
    }

    // Re-read access immediately before the append-only draw ledger mutation.
    memberRow = memberSheet
      .getRange(memberRowNumber, 1, 1, MEMBER_HEADERS.length)
      .getValues()[0];
    access = memberAccessFromRow_(memberRow);
    if (!access.allowed) {
      throw appError_("MEMBER_ACCESS_DENIED", "目前帳號已停用，無法使用抽獎功能。");
    }
    replayedDraw = findLotteryDrawByRequest_(
      drawSheet,
      identity.lineUserId,
      request.requestId
    );
    if (replayedDraw) {
      if (replayedDraw.lotteryTypeId !== request.lotteryTypeId) {
        throw appError_("REQUEST_ID_CONFLICT", "同一抽獎請求不可更換轉盤類型。");
      }
      cardStatus = getMemberPointCardStatus_(
        redemptionSheet,
        drawSheet,
        settingSheet,
        identity.lineUserId
      );
      return {
        data: {
          access: access,
          duplicate: true,
          draw: lotteryDrawResponse_(replayedDraw),
          lottery: lotteryConfigResponse_(
            readLotteryConfigByVersion_(prizeSheet, replayedDraw.configVersion)
          ),
          lotteryType: memberLotteryTypeResponse_(
            findLotteryTypeById_(
              readLotteryTypes_(typeSheet),
              replayedDraw.lotteryTypeId
            ),
            readLotteryConfigByVersion_(prizeSheet, replayedDraw.configVersion)
          ),
          card: pointCardStatusResponse_(cardStatus),
          pointBalance: cardStatus.totalPoints,
          totalPoints: cardStatus.totalPoints,
        },
      };
    }

    lotteryType = findActiveLotteryType_(
      readLotteryTypes_(typeSheet),
      request.lotteryTypeId
    );
    lotteryConfig = readLatestLotteryConfig_(
      prizeSheet,
      lotteryType.lotteryTypeId
    );
    cardStatus = getMemberPointCardStatus_(
      redemptionSheet,
      drawSheet,
      settingSheet,
      identity.lineUserId
    );
    if (cardStatus.availableDraws < 1 || !cardStatus.nextRound) {
      throw appError_(
        "LOTTERY_ROUND_NOT_READY",
        "尚未到達新的抽獎節點，或已取得的抽獎資格皆已使用。"
      );
    }

    var prize = pickLotteryPrize_(lotteryConfig.prizes);
    var now = new Date();
    var drawId =
      "LDW-" + Utilities.getUuid().replace(/-/g, "").slice(0, 16).toUpperCase();
    drawSheet.appendRow([
      drawId,
      safeSheetText_(lotteryConfig.configVersion),
      safeSheetText_(prize.prizeId),
      safeSheetText_(prize.label),
      prize.color,
      prize.probabilityBasisPoints,
      safeSheetText_(String(memberRow[MEMBER_COLUMN.memberId - 1] || "")),
      safeSheetText_(identity.lineUserId),
      0,
      cardStatus.totalPoints,
      cardStatus.totalPoints,
      now,
      request.requestId,
      lotteryType.lotteryTypeId,
      cardStatus.nextRound.settingVersion,
      cardStatus.nextRound.cardRoundKey,
    ]);
    applyLotteryDrawRowFormats_(drawSheet, drawSheet.getLastRow());
    SpreadsheetApp.flush();

    var updatedCardStatus = getMemberPointCardStatus_(
      redemptionSheet,
      drawSheet,
      settingSheet,
      identity.lineUserId
    );
    return {
      data: {
        access: access,
        duplicate: false,
        lottery: lotteryConfigResponse_(lotteryConfig),
        lotteryType: memberLotteryTypeResponse_(lotteryType, lotteryConfig),
        draw: {
          drawId: drawId,
          configVersion: lotteryConfig.configVersion,
          prizeId: prize.prizeId,
          prizeLabel: prize.label,
          prizeColor: prize.color,
          lotteryTypeId: lotteryType.lotteryTypeId,
          lotteryTypeName: lotteryType.name,
          ticketCost: 0,
          pointsSpent: 0,
          originalPointBalance: cardStatus.totalPoints,
          pointBalance: cardStatus.totalPoints,
          cardRoundKey: cardStatus.nextRound.cardRoundKey,
          drawnAt: now.toISOString(),
        },
        card: pointCardStatusResponse_(updatedCardStatus),
        pointBalance: updatedCardStatus.totalPoints,
        totalPoints: updatedCardStatus.totalPoints,
      },
    };
  } catch (error) {
    if (error && error.appCode) throw error;
    throw appError_("SPREADSHEET_ERROR", "目前無法完成抽獎，請稍後再試。");
  } finally {
    lock.releaseLock();
  }
}

function readLotteryConfigs_(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var rows = sheet
    .getRange(2, 1, lastRow - 1, LOTTERY_PRIZE_HEADERS.length)
    .getValues();
  var groups = Object.create(null);
  rows.forEach(function (row, index) {
    var prize = lotteryPrizeRecordFromRow_(row, index + 2);
    if (!groups[prize.configVersion]) {
      groups[prize.configVersion] = {
        configVersion: prize.configVersion,
        updatedAt: prize.updatedAt,
        updatedAtTime: new Date(prize.updatedAt).getTime(),
        lotteryTypeId: prize.lotteryTypeId,
        lastRowNumber: prize.rowNumber,
        prizes: [],
      };
    }
    var group = groups[prize.configVersion];
    if (
      group.updatedAt !== prize.updatedAt ||
      group.lotteryTypeId !== prize.lotteryTypeId
    ) {
      throw appError_("LOTTERY_DATA_ERROR", "同一版抽獎設定的更新時間不一致。");
    }
    group.lastRowNumber = Math.max(group.lastRowNumber, prize.rowNumber);
    group.prizes.push(prize);
  });

  var configs = Object.keys(groups).map(function (key) {
    var group = groups[key];
    var prizeIds = Object.create(null);
    var orders = Object.create(null);
    var total = 0;
    if (
      group.prizes.length < MIN_LOTTERY_PRIZES ||
      group.prizes.length > MAX_LOTTERY_PRIZES
    ) {
      throw appError_("LOTTERY_DATA_ERROR", "每版轉盤必須包含 2 到 12 個獎項。");
    }
    group.prizes.forEach(function (prize) {
      if (prizeIds[prize.prizeId] || orders[prize.sortOrder]) {
        throw appError_("LOTTERY_DATA_ERROR", "同一版轉盤的獎項或順序重複。");
      }
      prizeIds[prize.prizeId] = true;
      orders[prize.sortOrder] = true;
      total += prize.probabilityBasisPoints;
    });
    if (total !== 10000) {
      throw appError_("LOTTERY_DATA_ERROR", "轉盤中獎機率合計必須是 100%。");
    }
    group.prizes.sort(function (left, right) {
      return left.sortOrder - right.sortOrder;
    });
    for (var i = 0; i < group.prizes.length; i += 1) {
      if (group.prizes[i].sortOrder !== i + 1) {
        throw appError_("LOTTERY_DATA_ERROR", "轉盤獎項順序必須從 1 連續編號。");
      }
    }
    return group;
  });

  configs.sort(function (left, right) {
    return (
      right.updatedAtTime - left.updatedAtTime ||
      right.lastRowNumber - left.lastRowNumber
    );
  });
  return configs;
}

function readLatestLotteryConfig_(sheet, lotteryTypeId) {
  var configs = readLotteryConfigs_(sheet);
  for (var i = 0; i < configs.length; i += 1) {
    if (configs[i].lotteryTypeId === lotteryTypeId) return configs[i];
  }
  if (!configs.length) {
    throw appError_("LOTTERY_NOT_CONFIGURED", "管理員尚未設定轉盤獎項。");
  }
  throw appError_("LOTTERY_NOT_CONFIGURED", "這個轉盤類型尚未設定獎項。");
}

function readLotteryConfigByVersion_(sheet, configVersion) {
  var configs = readLotteryConfigs_(sheet);
  for (var i = 0; i < configs.length; i += 1) {
    if (configs[i].configVersion === configVersion) return configs[i];
  }
  throw appError_("LOTTERY_DATA_ERROR", "找不到抽獎紀錄所使用的轉盤設定。");
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
  var rawUpdatedAt = row[LOTTERY_PRIZE_COLUMN.updatedAt - 1];
  var updatedAtDate =
    rawUpdatedAt instanceof Date ? rawUpdatedAt : new Date(String(rawUpdatedAt || ""));
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
    isNaN(updatedAtDate.getTime()) ||
    !/^ADM-[A-Z0-9]{10}$/.test(updatedBy) ||
    !/^[a-zA-Z0-9-]{10,80}$/.test(lastRequestId)
    || !/^LTY-[A-Z0-9]{10}$/.test(lotteryTypeId)
  ) {
    throw appError_("LOTTERY_DATA_ERROR", "轉盤獎項資料格式不正確，請聯絡管理員。");
  }
  return {
    configVersion: configVersion,
    prizeId: prizeId,
    label: label,
    color: color,
    probabilityBasisPoints: probabilityBasisPoints,
    sortOrder: sortOrder,
    updatedAt: updatedAtDate.toISOString(),
    updatedBy: updatedBy,
    lastRequestId: lastRequestId,
    lotteryTypeId: lotteryTypeId,
    rowNumber: Number(rowNumber) || 0,
  };
}

function lotteryDrawRecordFromRow_(row) {
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
  var rawDrawnAt = row[LOTTERY_DRAW_COLUMN.drawnAt - 1];
  var drawnAtDate =
    rawDrawnAt instanceof Date ? rawDrawnAt : new Date(String(rawDrawnAt || ""));
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
    /^[1-9]\d*(?::[1-9]\d*)?$/.test(
      cardRoundKey.slice(cardSettingVersion.length + 1)
    );
  if (
    !/^LDW-[A-Z0-9]{16}$/.test(drawId) ||
    !/^LCF-[A-Z0-9]{12}$/.test(configVersion) ||
    !/^LPR-[A-Z0-9]{10}$/.test(prizeId) ||
    !prizeLabel ||
    !/^#[0-9A-F]{6}$/.test(prizeColor) ||
    !Number.isInteger(probabilityBasisPoints) ||
    probabilityBasisPoints < 1 ||
    probabilityBasisPoints > 9999 ||
    !/^MBR-[A-Z0-9]{10}$/.test(memberId) ||
    !/^U[0-9a-f]{32}$/.test(lineUserId) ||
    !Number.isSafeInteger(balanceBefore) ||
    !Number.isSafeInteger(balanceAfter) ||
    (!isLegacyDraw && !isRoundDraw) ||
    isNaN(drawnAtDate.getTime()) ||
    !/^[a-zA-Z0-9-]{10,80}$/.test(requestId)
  ) {
    throw appError_("LOTTERY_DATA_ERROR", "抽獎紀錄格式不正確，請聯絡管理員。");
  }
  return {
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
    drawnAt: drawnAtDate.toISOString(),
    requestId: requestId,
    lotteryTypeId: lotteryTypeId || DEFAULT_LOTTERY_TYPE_ID,
    cardSettingVersion: cardSettingVersion,
    cardRoundKey: cardRoundKey,
    legacyDraw: isLegacyDraw,
  };
}

function findLotteryDrawByRequest_(sheet, lineUserId, requestId) {
  var match = null;
  readAllLotteryDraws_(sheet).forEach(function (draw) {
    if (draw.lineUserId !== lineUserId || draw.requestId !== requestId) return;
    if (match) {
      throw appError_("LOTTERY_DATA_ERROR", "相同抽獎請求出現重複紀錄。");
    }
    match = draw;
  });
  return match;
}

function readAllLotteryDraws_(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var rows = sheet
    .getRange(2, 1, lastRow - 1, LOTTERY_DRAW_HEADERS.length)
    .getValues();
  var drawIds = Object.create(null);
  var requestKeys = Object.create(null);
  return rows.map(function (row) {
    var draw = lotteryDrawRecordFromRow_(row);
    var requestKey = draw.lineUserId + ":" + draw.requestId;
    if (drawIds[draw.drawId] || requestKeys[requestKey]) {
      throw appError_("LOTTERY_DATA_ERROR", "抽獎紀錄識別碼重複，請聯絡管理員。");
    }
    drawIds[draw.drawId] = true;
    requestKeys[requestKey] = true;
    return draw;
  });
}

function pickLotteryPrize_(prizes) {
  var randomHex = Utilities.getUuid().replace(/-/g, "").slice(0, 12);
  var randomValue = parseInt(randomHex, 16) / 281474976710656;
  var target = randomValue * 10000;
  var cumulative = 0;
  for (var i = 0; i < prizes.length; i += 1) {
    cumulative += prizes[i].probabilityBasisPoints;
    if (target < cumulative) return prizes[i];
  }
  return prizes[prizes.length - 1];
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

function lotteryDrawResponse_(draw) {
  return {
    drawId: draw.drawId,
    configVersion: draw.configVersion,
    prizeId: draw.prizeId,
    prizeLabel: draw.prizeLabel,
    prizeColor: draw.prizeColor,
    lotteryTypeId: draw.lotteryTypeId,
    ticketCost: draw.pointsSpent,
    pointsSpent: draw.pointsSpent,
    originalPointBalance: draw.balanceBefore,
    pointBalance: draw.balanceAfter,
    cardRoundKey: draw.cardRoundKey,
    drawnAt: draw.drawnAt,
  };
}

function previewPointCampaign_(identity, request, config) {
  try {
    var memberSheet = getOrCreateMemberSheet_(config);
    var memberRowNumber = findMemberRow_(memberSheet, identity.lineUserId);
    if (!memberRowNumber) {
      throw appError_("MEMBER_NOT_FOUND", "找不到會員資料，請重新登入後再試。");
    }

    var memberRow = memberSheet
      .getRange(memberRowNumber, 1, 1, MEMBER_HEADERS.length)
      .getValues()[0];
    var access = memberAccessFromRow_(memberRow);
    if (!access.allowed) {
      throw appError_("MEMBER_ACCESS_DENIED", "目前帳號已停用，無法領取點數。");
    }

    var campaignSheet = getOrCreatePointCampaignSheet_(config);
    var campaign = findPointCampaignByClaim_(campaignSheet, request.claim);
    assertPointCampaignAvailable_(campaign, new Date());
    var pointBalance = getMemberPointBalance_(
      getOrCreatePointRedemptionSheet_(config),
      identity.lineUserId,
      getOrCreateLotteryDrawSheet_(config)
    );

    return {
      data: {
        access: access,
        campaign: pointCampaignResponse_(campaign),
        pointBalance: pointBalance,
      },
    };
  } catch (error) {
    if (error && error.appCode) throw error;
    throw appError_("SPREADSHEET_ERROR", "目前無法讀取點數活動，請稍後再試。");
  }
}

function redeemPointCampaign_(identity, request, config) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    throw appError_("BUSY", "點數正在處理，請稍後再試。");
  }

  try {
    var memberSheet = getOrCreateMemberSheet_(config);
    var memberRowNumber = findMemberRow_(memberSheet, identity.lineUserId);
    if (!memberRowNumber) {
      throw appError_("MEMBER_NOT_FOUND", "找不到會員資料，請重新登入後再試。");
    }

    var memberRow = memberSheet
      .getRange(memberRowNumber, 1, 1, MEMBER_HEADERS.length)
      .getValues()[0];
    var access = memberAccessFromRow_(memberRow);
    if (!access.allowed) {
      throw appError_("MEMBER_ACCESS_DENIED", "目前帳號已停用，無法領取點數。");
    }

    var campaignSheet = getOrCreatePointCampaignSheet_(config);
    var campaign = findPointCampaignByClaim_(campaignSheet, request.claim);
    var redemptionSheet = getOrCreatePointRedemptionSheet_(config);
    var lotteryDrawSheet = getOrCreateLotteryDrawSheet_(config);
    var replayedRedemption = findPointRedemptionByRequest_(
      redemptionSheet,
      identity.lineUserId,
      request.requestId
    );

    // A transport retry uses the same requestId. It must remain idempotent for
    // both one-time and repeatable campaigns, even after expiry or disabling.
    if (replayedRedemption) {
      assertRedemptionMatchesCampaign_(replayedRedemption, campaign);
      return {
        data: {
          access: access,
          redeemed: false,
          duplicate: true,
          duplicateReason: "request_replay",
          awardedPoints: 0,
          pointBalance: getMemberPointBalance_(
            redemptionSheet,
            identity.lineUserId,
            lotteryDrawSheet
          ),
          campaign: pointCampaignResponse_(campaign),
        },
      };
    }

    var existingRedemption =
      campaign.redemptionMode === "once_per_member"
        ? findPointRedemption_(
            redemptionSheet,
            campaign.campaignId,
            identity.lineUserId
          )
        : campaign.redemptionMode === "single_member"
          ? findPointRedemptionByCampaign_(redemptionSheet, campaign.campaignId)
          : null;
    if (existingRedemption) {
      if (campaign.redemptionMode === "single_member") {
        assertRedemptionMatchesCampaign_(existingRedemption, campaign);
      }
      return {
        data: {
          access: access,
          redeemed: false,
          duplicate: true,
          duplicateReason:
            campaign.redemptionMode === "single_member"
              ? "campaign_redeemed"
              : "already_redeemed",
          awardedPoints: 0,
          pointBalance: getMemberPointBalance_(
            redemptionSheet,
            identity.lineUserId,
            lotteryDrawSheet
          ),
          campaign: pointCampaignResponse_(campaign),
        },
      };
    }

    assertPointCampaignAvailable_(campaign, new Date());

    // Re-read immediately before the sole ledger mutation. Administrator and
    // member GAS projects do not share ScriptLock, so this narrows the window
    // in which a concurrent access change could otherwise be missed.
    memberRow = memberSheet
      .getRange(memberRowNumber, 1, 1, MEMBER_HEADERS.length)
      .getValues()[0];
    access = memberAccessFromRow_(memberRow);
    if (!access.allowed) {
      throw appError_("MEMBER_ACCESS_DENIED", "目前帳號已停用，無法領取點數。");
    }

    // Check the persistent request key again immediately before append. The
    // same request must never award twice, while a repeatable campaign may
    // accept a distinct request.
    replayedRedemption = findPointRedemptionByRequest_(
      redemptionSheet,
      identity.lineUserId,
      request.requestId
    );
    if (replayedRedemption) {
      assertRedemptionMatchesCampaign_(replayedRedemption, campaign);
      return {
        data: {
          access: access,
          redeemed: false,
          duplicate: true,
          duplicateReason: "request_replay",
          awardedPoints: 0,
          pointBalance: getMemberPointBalance_(
            redemptionSheet,
            identity.lineUserId,
            lotteryDrawSheet
          ),
          campaign: pointCampaignResponse_(campaign),
        },
      };
    }

    if (campaign.redemptionMode === "once_per_member") {
      existingRedemption = findPointRedemption_(
        redemptionSheet,
        campaign.campaignId,
        identity.lineUserId
      );
      if (existingRedemption) {
        return {
          data: {
            access: access,
            redeemed: false,
            duplicate: true,
            duplicateReason: "already_redeemed",
            awardedPoints: 0,
            pointBalance: getMemberPointBalance_(
              redemptionSheet,
              identity.lineUserId,
              lotteryDrawSheet
            ),
            campaign: pointCampaignResponse_(campaign),
          },
        };
      }
    } else if (campaign.redemptionMode === "single_member") {
      existingRedemption = findPointRedemptionByCampaign_(
        redemptionSheet,
        campaign.campaignId
      );
      if (existingRedemption) {
        assertRedemptionMatchesCampaign_(existingRedemption, campaign);
        return {
          data: {
            access: access,
            redeemed: false,
            duplicate: true,
            duplicateReason: "campaign_redeemed",
            awardedPoints: 0,
            pointBalance: getMemberPointBalance_(
              redemptionSheet,
              identity.lineUserId,
              lotteryDrawSheet
            ),
            campaign: pointCampaignResponse_(campaign),
          },
        };
      }
    }

    // The spreadsheet owner can disable or edit a campaign outside this GAS
    // lock. Re-read immediately before append, require the previewed snapshot
    // to remain identical and re-check expiry/status.
    var latestCampaign = findPointCampaignByClaim_(campaignSheet, request.claim);
    assertPointCampaignAvailable_(latestCampaign, new Date());
    if (
      latestCampaign.campaignId !== campaign.campaignId ||
      latestCampaign.pointTypeId !== campaign.pointTypeId ||
      latestCampaign.label !== campaign.label ||
      latestCampaign.points !== campaign.points ||
      latestCampaign.expiresAt !== campaign.expiresAt ||
      latestCampaign.expiryMode !== campaign.expiryMode ||
      latestCampaign.redemptionMode !== campaign.redemptionMode
    ) {
      throw appError_(
        "POINT_DATA_ERROR",
        "點數活動在領取期間已異動，請重新掃描後再試。"
      );
    }
    campaign = latestCampaign;

    var pointBalance = getMemberPointBalance_(
      redemptionSheet,
      identity.lineUserId,
      lotteryDrawSheet
    );
    if (pointBalance > 9007199254740991 - campaign.points) {
      throw appError_("POINT_DATA_ERROR", "會員點數資料超出可處理範圍。");
    }
    var balanceAfter = pointBalance + campaign.points;
    var now = new Date();

    redemptionSheet.appendRow([
      "RDM-" + Utilities.getUuid().replace(/-/g, "").slice(0, 16).toUpperCase(),
      safeSheetText_(campaign.campaignId),
      safeSheetText_(campaign.pointTypeId),
      safeSheetText_(String(memberRow[MEMBER_COLUMN.memberId - 1] || "")),
      safeSheetText_(identity.lineUserId),
      campaign.points,
      balanceAfter,
      now,
      request.requestId,
      campaign.redemptionMode,
    ]);
    applyPointRedemptionRowFormats_(redemptionSheet, redemptionSheet.getLastRow());
    SpreadsheetApp.flush();

    return {
      data: {
        access: access,
        redeemed: true,
        duplicate: false,
        duplicateReason: "",
        awardedPoints: campaign.points,
        pointBalance: balanceAfter,
        campaign: pointCampaignResponse_(campaign),
      },
    };
  } catch (error) {
    if (error && error.appCode) throw error;
    throw appError_("SPREADSHEET_ERROR", "目前無法領取點數，請稍後再試。");
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
      return { data: { deleted: true, duplicate: true } };
    }

    var sheet = getOrCreateMemberSheet_(config);
    var rowNumbers = findMemberRows_(sheet, identity.lineUserId);
    var redemptionSheet = getOrCreatePointRedemptionSheet_(config);
    var deletedRedemptions = deletePointRedemptionsForMember_(
      redemptionSheet,
      identity.lineUserId
    );
    var lotteryDrawSheet = getOrCreateLotteryDrawSheet_(config);
    var deletedLotteryDraws = deleteLotteryDrawsForMember_(
      lotteryDrawSheet,
      identity.lineUserId
    );

    rowNumbers.forEach(function (rowNumber) {
      // Keep physical row numbers stable because the administrator backend is
      // a separate GAS project whose ScriptLock cannot coordinate with this
      // one. Clearing prevents a concurrent narrow admin write from shifting
      // onto the next member while still removing all member data.
      sheet
        .getRange(rowNumber, 1, 1, MEMBER_HEADERS.length)
        .setValues([new Array(MEMBER_HEADERS.length).fill("")]);
    });
    if (
      rowNumbers.length > 0 ||
      deletedRedemptions > 0 ||
      deletedLotteryDraws > 0
    ) {
      SpreadsheetApp.flush();
    }

    markMemberDeleted_(identity.lineUserId, identity.tokenIssuedAt);
    markRequestProcessed_(identity.lineUserId, request.action, request.requestId, "deleted");

    return { data: { deleted: rowNumbers.length > 0 } };
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
    "",
    "approved",
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
    "",
    "",
    "",
  ];
}

function memberAccessFromRow_(row) {
  var status = normalizeAccessStatus_(row[MEMBER_COLUMN.status - 1]);
  return { status: status, allowed: status === "approved" };
}

function memberResponseFromRow_(row, identity, context, pointBalance) {
  return {
    memberId: String(row[MEMBER_COLUMN.memberId - 1] || ""),
    displayName: identity.displayName,
    pictureUrl: identity.pictureUrl,
    phone: memberPhoneFromRow_(row),
    birthday: memberBirthdayFromRow_(row),
    pointBalance: normalizePointBalance_(pointBalance),
    totalPoints: normalizePointBalance_(pointBalance),
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
  var pointTypeSheetName = String(
    properties.getProperty("POINT_TYPE_SHEET_NAME") || DEFAULT_POINT_TYPE_SHEET_NAME
  ).trim();
  var pointCampaignSheetName = String(
    properties.getProperty("POINT_CAMPAIGN_SHEET_NAME") || DEFAULT_POINT_CAMPAIGN_SHEET_NAME
  ).trim();
  var pointRedemptionSheetName = String(
    properties.getProperty("POINT_REDEMPTION_SHEET_NAME") ||
      DEFAULT_POINT_REDEMPTION_SHEET_NAME
  ).trim();
  var pointCardSettingSheetName = String(
    properties.getProperty("POINT_CARD_SETTING_SHEET_NAME") ||
      DEFAULT_POINT_CARD_SETTING_SHEET_NAME
  ).trim();
  var lotteryTypeSheetName = String(
    properties.getProperty("LOTTERY_TYPE_SHEET_NAME") ||
      DEFAULT_LOTTERY_TYPE_SHEET_NAME
  ).trim();
  var lotteryPrizeSheetName = String(
    properties.getProperty("LOTTERY_PRIZE_SHEET_NAME") ||
      DEFAULT_LOTTERY_PRIZE_SHEET_NAME
  ).trim();
  var lotteryDrawSheetName = String(
    properties.getProperty("LOTTERY_DRAW_SHEET_NAME") ||
      DEFAULT_LOTTERY_DRAW_SHEET_NAME
  ).trim();
  var allowedOrigins = getAllowedOrigins_();

  if (
    !/^\d{6,}$/.test(lineChannelId) ||
    !spreadsheetId ||
    !sheetName ||
    !pointTypeSheetName ||
    !pointCampaignSheetName ||
    !pointRedemptionSheetName ||
    !pointCardSettingSheetName ||
    !lotteryTypeSheetName ||
    !lotteryPrizeSheetName ||
    !lotteryDrawSheetName ||
    allowedOrigins.length === 0
  ) {
    throw appError_(
      "CONFIG_ERROR",
      "會員端 GAS 尚未完成 LINE、試算表或允許來源設定。"
    );
  }

  var sheetNames = [
    sheetName,
    pointTypeSheetName,
    pointCampaignSheetName,
    pointRedemptionSheetName,
    pointCardSettingSheetName,
    lotteryTypeSheetName,
    lotteryPrizeSheetName,
    lotteryDrawSheetName,
  ].map(function (name) {
    return name.toLowerCase();
  });
  if (
    sheetNames.some(function (name) {
      return name.length > 80;
    }) ||
    new Set(sheetNames).size !== sheetNames.length
  ) {
    throw appError_("CONFIG_ERROR", "會員與點數工作表名稱不可重複，且不可超過 80 個字元。");
  }

  return {
    lineChannelId: lineChannelId,
    spreadsheetId: spreadsheetId,
    sheetName: sheetName.slice(0, 80),
    pointTypeSheetName: pointTypeSheetName.slice(0, 80),
    pointCampaignSheetName: pointCampaignSheetName.slice(0, 80),
    pointRedemptionSheetName: pointRedemptionSheetName.slice(0, 80),
    pointCardSettingSheetName: pointCardSettingSheetName.slice(0, 80),
    lotteryTypeSheetName: lotteryTypeSheetName.slice(0, 80),
    lotteryPrizeSheetName: lotteryPrizeSheetName.slice(0, 80),
    lotteryDrawSheetName: lotteryDrawSheetName.slice(0, 80),
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
  if (!sheet) sheet = spreadsheet.insertSheet(config.sheetName);

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, MEMBER_HEADERS.length).setValues([MEMBER_HEADERS]);
    sheet.setFrozenRows(1);
    styleMemberHeader_(sheet, 1, MEMBER_HEADERS.length);
    sheet.autoResizeColumns(1, MEMBER_HEADERS.length);
    applySheetColumnFormats_(sheet);
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
    var existingPreviousHeaders = sheet
      .getRange(1, 1, 1, previousHeaders.length)
      .getDisplayValues()[0];
    assertMemberHeadersMatch_(existingPreviousHeaders, previousHeaders);

    var appendedHeaders = MEMBER_HEADERS.slice(previousHeaders.length);
    sheet
      .getRange(1, previousHeaders.length + 1, 1, appendedHeaders.length)
      .setValues([appendedHeaders]);
    styleMemberHeader_(sheet, previousHeaders.length + 1, appendedHeaders.length);
    sheet.autoResizeColumns(previousHeaders.length + 1, appendedHeaders.length);
    migrateDefaultMemberAccess_(sheet);
    applySheetColumnFormats_(sheet);
    SpreadsheetApp.flush();
    return sheet;
  }

  if (lastColumn !== MEMBER_HEADERS.length) throwMemberSchemaMismatch_();

  var existingHeaders = sheet.getRange(1, 1, 1, MEMBER_HEADERS.length).getDisplayValues()[0];
  assertMemberHeadersMatch_(existingHeaders, MEMBER_HEADERS);
  return sheet;
}

function getOrCreatePointTypeSheet_(config) {
  return getOrCreatePointDataSheet_(
    config,
    config.pointTypeSheetName || DEFAULT_POINT_TYPE_SHEET_NAME,
    POINT_TYPE_HEADERS,
    LEGACY_POINT_TYPE_HEADERS,
    ["limited", "once_per_member", "", ""]
  );
}

function getOrCreatePointCampaignSheet_(config) {
  return getOrCreatePointDataSheet_(
    config,
    config.pointCampaignSheetName || DEFAULT_POINT_CAMPAIGN_SHEET_NAME,
    POINT_CAMPAIGN_HEADERS,
    LEGACY_POINT_CAMPAIGN_HEADERS,
    ["limited", "once_per_member"]
  );
}

function getOrCreatePointRedemptionSheet_(config) {
  return getOrCreatePointDataSheet_(
    config,
    config.pointRedemptionSheetName || DEFAULT_POINT_REDEMPTION_SHEET_NAME,
    POINT_REDEMPTION_HEADERS,
    LEGACY_POINT_REDEMPTION_HEADERS,
    ["once_per_member"]
  );
}

function getOrCreatePointCardSettingSheet_(config) {
  return getOrCreatePointDataSheet_(
    config,
    config.pointCardSettingSheetName || DEFAULT_POINT_CARD_SETTING_SHEET_NAME,
    POINT_CARD_SETTING_HEADERS,
    LEGACY_POINT_CARD_SETTING_HEADERS,
    [""]
  );
}

function getOrCreateLotteryTypeSheet_(config) {
  return getOrCreatePointDataSheet_(
    config,
    config.lotteryTypeSheetName || DEFAULT_LOTTERY_TYPE_SHEET_NAME,
    LOTTERY_TYPE_HEADERS,
    [],
    []
  );
}

function getOrCreateLotteryPrizeSheet_(config) {
  return getOrCreatePointDataSheet_(
    config,
    config.lotteryPrizeSheetName || DEFAULT_LOTTERY_PRIZE_SHEET_NAME,
    LOTTERY_PRIZE_HEADERS,
    LEGACY_LOTTERY_PRIZE_HEADERS,
    [DEFAULT_LOTTERY_TYPE_ID]
  );
}

function getOrCreateLotteryDrawSheet_(config) {
  return getOrCreatePointDataSheet_(
    config,
    config.lotteryDrawSheetName || DEFAULT_LOTTERY_DRAW_SHEET_NAME,
    LOTTERY_DRAW_HEADERS,
    LEGACY_LOTTERY_DRAW_HEADERS,
    ["", "", ""]
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
    String(DEFAULT_POINT_CARD_TARGET),
  ]);
  applyPointCardSettingSheetFormats_(sheet);
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
  applyLotteryTypeSheetFormats_(sheet);
}

function getOrCreatePointDataSheet_(
  config,
  sheetName,
  expectedHeaders,
  legacyHeaders,
  legacyDefaults
) {
  var spreadsheet;
  try {
    spreadsheet = SpreadsheetApp.openById(config.spreadsheetId);
  } catch (_error) {
    throw appError_("SPREADSHEET_ERROR", "無法開啟點數試算表，請檢查 SPREADSHEET_ID 與權限。");
  }

  var sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) sheet = spreadsheet.insertSheet(sheetName);

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, expectedHeaders.length).setValues([expectedHeaders]);
    sheet.setFrozenRows(1);
    styleMemberHeader_(sheet, 1, expectedHeaders.length);
    sheet.autoResizeColumns(1, expectedHeaders.length);
    return sheet;
  }

  if (sheet.getLastColumn() === legacyHeaders.length) {
    var legacyActualHeaders = sheet
      .getRange(1, 1, 1, legacyHeaders.length)
      .getDisplayValues()[0];
    for (var legacyIndex = 0; legacyIndex < legacyHeaders.length; legacyIndex += 1) {
      if (legacyActualHeaders[legacyIndex] !== legacyHeaders[legacyIndex]) {
        throwPointSchemaMismatch_(sheetName);
      }
    }
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
    SpreadsheetApp.flush();
  }

  if (sheet.getLastColumn() !== expectedHeaders.length) {
    throwPointSchemaMismatch_(sheetName);
  }

  var actualHeaders = sheet
    .getRange(1, 1, 1, expectedHeaders.length)
    .getDisplayValues()[0];
  for (var i = 0; i < expectedHeaders.length; i += 1) {
    if (actualHeaders[i] !== expectedHeaders[i]) {
      throwPointSchemaMismatch_(sheetName);
    }
  }
  return sheet;
}

function throwPointSchemaMismatch_(sheetName) {
  throw appError_(
    "POINT_SCHEMA_MISMATCH",
    String(sheetName || "點數") + " 工作表欄位與程式版本不相符，請勿手動調整第一列欄位。"
  );
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

function migrateDefaultMemberAccess_(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;

  var changed = 0;
  for (var rowNumber = 2; rowNumber <= lastRow; rowNumber += 1) {
    var statusCell = sheet.getRange(rowNumber, MEMBER_COLUMN.status);
    var value = statusCell.getValues()[0][0];
    var status = String(value == null ? "" : value).trim().toLowerCase();

    if (!status || status === "pending") {
      // A single-cell write avoids touching administrator edits in any other
      // row or in admin_status.
      statusCell.setValues([["approved"]]);
      changed += 1;
    }
  }

  return changed;
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
  var textColumns = [
    1, 2, 3, 4, 5, 6, 11, 12, 13, 15, 17, 19, 20, 21,
    MEMBER_COLUMN.phone,
    MEMBER_COLUMN.birthday,
  ];

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
  sheet.getRange(rowNumber, MEMBER_COLUMN.adminStatus).setNumberFormat("@");
  sheet.getRange(rowNumber, MEMBER_COLUMN.phone, 1, 2).setNumberFormat("@");
}

function applyPointTypeSheetFormats_(sheet) {
  var rowCount = Math.max(sheet.getMaxRows() - 1, 1);
  [1, 2, 4, 7, 8, 9, 10, 11, 12].forEach(function (column) {
    sheet.getRange(2, column, rowCount, 1).setNumberFormat("@");
  });
  sheet.getRange(2, POINT_TYPE_COLUMN.points, rowCount, 1).setNumberFormat("0");
  [POINT_TYPE_COLUMN.createdAt, POINT_TYPE_COLUMN.updatedAt].forEach(function (column) {
    sheet.getRange(2, column, rowCount, 1).setNumberFormat("yyyy-mm-dd hh:mm:ss");
  });
}

function applyPointCampaignSheetFormats_(sheet) {
  var rowCount = Math.max(sheet.getMaxRows() - 1, 1);
  [1, 2, 3, 5, 6, 9, 10, 11, 12].forEach(function (column) {
    sheet.getRange(2, column, rowCount, 1).setNumberFormat("@");
  });
  sheet
    .getRange(2, POINT_CAMPAIGN_COLUMN.pointsSnapshot, rowCount, 1)
    .setNumberFormat("0");
  [POINT_CAMPAIGN_COLUMN.expiresAt, POINT_CAMPAIGN_COLUMN.createdAt].forEach(function (column) {
    sheet.getRange(2, column, rowCount, 1).setNumberFormat("yyyy-mm-dd hh:mm:ss");
  });
}

function applyPointRedemptionSheetFormats_(sheet) {
  var rowCount = Math.max(sheet.getMaxRows() - 1, 1);
  [1, 2, 3, 4, 5, 9, 10].forEach(function (column) {
    sheet.getRange(2, column, rowCount, 1).setNumberFormat("@");
  });
  sheet
    .getRange(2, POINT_REDEMPTION_COLUMN.points, rowCount, 2)
    .setNumberFormat("0");
  sheet
    .getRange(2, POINT_REDEMPTION_COLUMN.redeemedAt, rowCount, 1)
    .setNumberFormat("yyyy-mm-dd hh:mm:ss");
}

function applyPointRedemptionRowFormats_(sheet, rowNumber) {
  sheet
    .getRange(rowNumber, POINT_REDEMPTION_COLUMN.redemptionId, 1, 5)
    .setNumberFormat("@");
  sheet
    .getRange(rowNumber, POINT_REDEMPTION_COLUMN.points, 1, 2)
    .setNumberFormat("0");
  sheet
    .getRange(rowNumber, POINT_REDEMPTION_COLUMN.redeemedAt)
    .setNumberFormat("yyyy-mm-dd hh:mm:ss");
  sheet
    .getRange(rowNumber, POINT_REDEMPTION_COLUMN.requestId, 1, 2)
    .setNumberFormat("@");
}

function applyPointCardSettingSheetFormats_(sheet) {
  var rowCount = Math.max(sheet.getMaxRows() - 1, 1);
  [1, 4, 5, 6].forEach(function (column) {
    sheet.getRange(2, column, rowCount, 1).setNumberFormat("@");
  });
  sheet
    .getRange(2, POINT_CARD_SETTING_COLUMN.targetPoints, rowCount, 1)
    .setNumberFormat("0");
  sheet
    .getRange(2, POINT_CARD_SETTING_COLUMN.effectiveAt, rowCount, 1)
    .setNumberFormat("yyyy-mm-dd hh:mm:ss");
}

function applyLotteryTypeSheetFormats_(sheet) {
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

function applyLotteryPrizeSheetFormats_(sheet) {
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

function applyLotteryDrawSheetFormats_(sheet) {
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

function applyLotteryDrawRowFormats_(sheet, rowNumber) {
  sheet
    .getRange(rowNumber, LOTTERY_DRAW_COLUMN.drawId, 1, 5)
    .setNumberFormat("@");
  sheet
    .getRange(rowNumber, LOTTERY_DRAW_COLUMN.probabilityBasisPointsSnapshot)
    .setNumberFormat("0");
  sheet
    .getRange(rowNumber, LOTTERY_DRAW_COLUMN.memberId, 1, 2)
    .setNumberFormat("@");
  sheet
    .getRange(rowNumber, LOTTERY_DRAW_COLUMN.pointsSpent, 1, 3)
    .setNumberFormat("0");
  sheet
    .getRange(rowNumber, LOTTERY_DRAW_COLUMN.drawnAt)
    .setNumberFormat("yyyy-mm-dd hh:mm:ss");
  sheet
    .getRange(rowNumber, LOTTERY_DRAW_COLUMN.requestId, 1, 4)
    .setNumberFormat("@");
}

function findMemberRow_(sheet, lineUserId) {
  var rows = findMemberRows_(sheet, lineUserId);
  if (rows.length > 1) {
    throw appError_(
      "MEMBER_DATA_CONFLICT",
      "會員資料有重複識別碼，請聯絡管理員。"
    );
  }
  return rows.length ? rows[0] : 0;
}

function findMemberRows_(sheet, lineUserId) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var values = sheet
    .getRange(2, MEMBER_COLUMN.lineUserId, lastRow - 1, 1)
    .getValues();
  var rowNumbers = [];
  for (var i = 0; i < values.length; i += 1) {
    if (String(values[i][0] || "") !== lineUserId) continue;
    rowNumbers.push(i + 2);
  }
  return rowNumbers;
}

function findPointCampaignByClaim_(sheet, claim) {
  var claimHash = sha256Hex_(normalizePointClaim_(claim));
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    throw appError_("POINT_CAMPAIGN_NOT_FOUND", "找不到這個點數活動，請確認 QR Code。");
  }

  var rows = sheet
    .getRange(2, 1, lastRow - 1, POINT_CAMPAIGN_HEADERS.length)
    .getValues();
  var matchingRows = rows.filter(function (row) {
    return String(row[POINT_CAMPAIGN_COLUMN.claimHash - 1] || "").trim().toLowerCase() ===
      claimHash;
  });

  if (matchingRows.length === 0) {
    throw appError_("POINT_CAMPAIGN_NOT_FOUND", "找不到這個點數活動，請確認 QR Code。");
  }
  if (matchingRows.length > 1) {
    throw appError_("POINT_DATA_ERROR", "點數活動資料重複，請聯絡管理員。");
  }

  var row = matchingRows[0];
  var campaignId = plainSheetText_(row[POINT_CAMPAIGN_COLUMN.campaignId - 1], 100);
  var pointTypeId = plainSheetText_(row[POINT_CAMPAIGN_COLUMN.pointTypeId - 1], 100);
  var label = plainSheetText_(row[POINT_CAMPAIGN_COLUMN.labelSnapshot - 1], 100);
  var points = Number(row[POINT_CAMPAIGN_COLUMN.pointsSnapshot - 1]);
  var status = String(row[POINT_CAMPAIGN_COLUMN.status - 1] || "").trim().toLowerCase();
  var rawExpiresAt = row[POINT_CAMPAIGN_COLUMN.expiresAt - 1];
  var expiryMode = normalizeStoredExpiryMode_(
    row[POINT_CAMPAIGN_COLUMN.expiryModeSnapshot - 1]
  );
  var redemptionMode = normalizeStoredRedemptionMode_(
    row[POINT_CAMPAIGN_COLUMN.redemptionModeSnapshot - 1]
  );
  var expiresAt = "";
  var expiresAtTime = 0;

  if (
    !/^PCG-[A-Z0-9]{10}$/.test(campaignId) ||
    !/^PTY-[A-Z0-9]{10}$/.test(pointTypeId) ||
    !Number.isInteger(points) ||
    points < 1 ||
    points > 9999 ||
    label !== String(points) + " 點" ||
    !expiryMode ||
    !redemptionMode
  ) {
    throw appError_("POINT_DATA_ERROR", "點數活動資料格式不正確，請聯絡管理員。");
  }

  if (expiryMode === "limited") {
    if (rawExpiresAt === "" || rawExpiresAt == null) {
      throw appError_("POINT_DATA_ERROR", "限時點數活動到期時間不可為空白，請聯絡管理員。");
    }
    var expiresDate =
      rawExpiresAt instanceof Date ? rawExpiresAt : new Date(String(rawExpiresAt));
    if (isNaN(expiresDate.getTime())) {
      throw appError_("POINT_DATA_ERROR", "點數活動到期時間格式不正確，請聯絡管理員。");
    }
    expiresAt = expiresDate.toISOString();
    expiresAtTime = expiresDate.getTime();
  } else if (rawExpiresAt !== "" && rawExpiresAt != null) {
    throw appError_("POINT_DATA_ERROR", "無期限點數活動不可設定到期時間，請聯絡管理員。");
  }

  return {
    campaignId: campaignId,
    pointTypeId: pointTypeId,
    label: label,
    points: points,
    status: status,
    expiresAt: expiresAt,
    expiresAtTime: expiresAtTime,
    expiryMode: expiryMode,
    redemptionMode: redemptionMode,
  };
}

function assertPointCampaignAvailable_(campaign, now) {
  if (!campaign || campaign.status !== "active") {
    throw appError_("POINT_CAMPAIGN_INACTIVE", "這個點數活動目前未開放領取。");
  }
  if (
    campaign.expiryMode === "limited" &&
    campaign.expiresAtTime <= now.getTime()
  ) {
    throw appError_("POINT_CAMPAIGN_EXPIRED", "這個點數活動已經結束。");
  }
}

function pointCampaignResponse_(campaign) {
  return {
    label: campaign.label,
    points: campaign.points,
    expiresAt: campaign.expiresAt,
    expiryMode: campaign.expiryMode,
    redemptionMode: campaign.redemptionMode,
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

function findPointRedemptionByRequest_(sheet, lineUserId, requestId) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;

  var rows = sheet
    .getRange(2, 1, lastRow - 1, POINT_REDEMPTION_HEADERS.length)
    .getValues();
  var match = null;
  for (var i = 0; i < rows.length; i += 1) {
    if (
      plainSheetText_(rows[i][POINT_REDEMPTION_COLUMN.lineUserId - 1], 128) ===
        lineUserId &&
      plainSheetText_(rows[i][POINT_REDEMPTION_COLUMN.requestId - 1], 100) ===
        requestId
    ) {
      if (match) {
        throw appError_(
          "POINT_DATA_ERROR",
          "同一領點請求有重複紀錄，請聯絡管理員。"
        );
      }
      match = rows[i];
    }
  }
  return match;
}

function assertRedemptionMatchesCampaign_(redemptionRow, campaign) {
  var storedCampaignId = plainSheetText_(
    redemptionRow[POINT_REDEMPTION_COLUMN.campaignId - 1],
    100
  );
  var storedMode = normalizeStoredRedemptionMode_(
    redemptionRow[POINT_REDEMPTION_COLUMN.redemptionModeSnapshot - 1]
  );
  if (
    storedCampaignId !== campaign.campaignId ||
    !storedMode ||
    storedMode !== campaign.redemptionMode
  ) {
    throw appError_(
      "REQUEST_ID_CONFLICT",
      "點數領取紀錄與活動規則不一致，請聯絡管理員。"
    );
  }
}

function findPointRedemption_(sheet, campaignId, lineUserId) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;

  var rows = sheet
    .getRange(2, 1, lastRow - 1, POINT_REDEMPTION_HEADERS.length)
    .getValues();
  var match = null;
  for (var i = 0; i < rows.length; i += 1) {
    if (
      plainSheetText_(rows[i][POINT_REDEMPTION_COLUMN.campaignId - 1], 100) ===
        campaignId &&
      plainSheetText_(rows[i][POINT_REDEMPTION_COLUMN.lineUserId - 1], 128) ===
        lineUserId
    ) {
      if (match) {
        throw appError_(
          "POINT_DATA_ERROR",
          "同一會員有重複的點數領取紀錄，請聯絡管理員。"
        );
      }
      match = rows[i];
    }
  }
  return match;
}

function findPointRedemptionByCampaign_(sheet, campaignId) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;

  var rows = sheet
    .getRange(2, 1, lastRow - 1, POINT_REDEMPTION_HEADERS.length)
    .getValues();
  var match = null;
  for (var i = 0; i < rows.length; i += 1) {
    if (
      plainSheetText_(rows[i][POINT_REDEMPTION_COLUMN.campaignId - 1], 100) !==
      campaignId
    ) {
      continue;
    }
    if (match) {
      throw appError_(
        "POINT_DATA_ERROR",
        "同一點數活動有重複領取紀錄，請聯絡管理員。"
      );
    }
    match = rows[i];
  }
  return match;
}

function getMemberPointBalanceForConfig_(config, lineUserId) {
  return getMemberPointBalance_(
    getOrCreatePointRedemptionSheet_(config),
    lineUserId
  );
}

function getMemberPointBalance_(sheet, lineUserId) {
  return readMemberPointLedger_(sheet, lineUserId).totalPoints;
}

function readMemberPointLedger_(sheet, lineUserId) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return { totalPoints: 0, events: [] };

  var rows = sheet
    .getRange(2, 1, lastRow - 1, POINT_REDEMPTION_HEADERS.length)
    .getValues();
  var totalPoints = 0;
  var events = [];
  var redemptionIds = Object.create(null);
  var requestKeys = Object.create(null);
  var campaignModes = Object.create(null);
  rows.forEach(function (row) {
    var redemptionId = plainSheetText_(
      row[POINT_REDEMPTION_COLUMN.redemptionId - 1],
      100
    );
    var storedLineUserId = plainSheetText_(
      row[POINT_REDEMPTION_COLUMN.lineUserId - 1],
      128
    );
    var requestId = plainSheetText_(row[POINT_REDEMPTION_COLUMN.requestId - 1], 100);
    var requestKey = storedLineUserId + ":" + requestId;
    if (
      !/^RDM-[A-Z0-9]{16}$/.test(redemptionId) ||
      !/^U[0-9a-f]{32}$/.test(storedLineUserId) ||
      !/^[a-zA-Z0-9-]{10,80}$/.test(requestId) ||
      redemptionIds[redemptionId] ||
      requestKeys[requestKey]
    ) {
      throw appError_("POINT_DATA_ERROR", "會員點數紀錄格式不正確，請聯絡管理員。");
    }
    redemptionIds[redemptionId] = true;
    requestKeys[requestKey] = true;

    if (
      storedLineUserId !== lineUserId
    ) {
      return;
    }
    var campaignId = plainSheetText_(
      row[POINT_REDEMPTION_COLUMN.campaignId - 1],
      100
    );
    var pointTypeId = plainSheetText_(
      row[POINT_REDEMPTION_COLUMN.pointTypeId - 1],
      100
    );
    var memberId = plainSheetText_(row[POINT_REDEMPTION_COLUMN.memberId - 1], 100);
    var points = Number(row[POINT_REDEMPTION_COLUMN.points - 1]);
    var balanceAfter = Number(row[POINT_REDEMPTION_COLUMN.balanceAfter - 1]);
    var redemptionMode = normalizeStoredRedemptionMode_(
      row[POINT_REDEMPTION_COLUMN.redemptionModeSnapshot - 1]
    );
    var redeemedAt = row[POINT_REDEMPTION_COLUMN.redeemedAt - 1];
    var redeemedDate =
      redeemedAt instanceof Date ? redeemedAt : new Date(String(redeemedAt || ""));
    if (
      !/^PCG-[A-Z0-9]{10}$/.test(campaignId) ||
      !/^PTY-[A-Z0-9]{10}$/.test(pointTypeId) ||
      !/^MBR-[A-Z0-9]{10}$/.test(memberId) ||
      !Number.isInteger(points) ||
      points < 1 ||
      points > 9999 ||
      !Number.isSafeInteger(balanceAfter) ||
      balanceAfter < points ||
      isNaN(redeemedDate.getTime()) ||
      !redemptionMode ||
      (campaignModes[campaignId] &&
        (campaignModes[campaignId] !== redemptionMode ||
          redemptionMode !== "repeatable"))
    ) {
      throw appError_("POINT_DATA_ERROR", "會員點數紀錄格式不正確，請聯絡管理員。");
    }
    campaignModes[campaignId] = redemptionMode;
    if (totalPoints > 9007199254740991 - points) {
      throw appError_("POINT_DATA_ERROR", "會員點數資料超出可處理範圍。");
    }
    totalPoints += points;
    events.push({
      redemptionId: redemptionId,
      points: points,
      redeemedAt: redeemedDate.toISOString(),
      redeemedAtTime: redeemedDate.getTime(),
    });
  });
  events.sort(function (left, right) {
    return left.redeemedAtTime - right.redeemedAtTime;
  });
  return { totalPoints: totalPoints, events: events };
}

function deletePointRedemptionsForMember_(sheet, lineUserId) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;

  var values = sheet
    .getRange(2, POINT_REDEMPTION_COLUMN.lineUserId, lastRow - 1, 1)
    .getValues();
  var deleted = 0;
  for (var i = values.length - 1; i >= 0; i -= 1) {
    if (plainSheetText_(values[i][0], 128) === lineUserId) {
      sheet.deleteRow(i + 2);
      deleted += 1;
    }
  }
  return deleted;
}

function deleteLotteryDrawsForMember_(sheet, lineUserId) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;

  var values = sheet
    .getRange(2, LOTTERY_DRAW_COLUMN.lineUserId, lastRow - 1, 1)
    .getValues();
  var deleted = 0;
  for (var i = values.length - 1; i >= 0; i -= 1) {
    if (plainSheetText_(values[i][0], 128) === lineUserId) {
      sheet.deleteRow(i + 2);
      deleted += 1;
    }
  }
  return deleted;
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
      phone: String(e.parameter.phone || "").trim(),
      birthday: String(e.parameter.birthday || "").trim(),
      claim: String(e.parameter.claim || "").trim(),
      lotteryTypeId: String(e.parameter.lotteryTypeId || "").trim(),
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
    phone: String(parsed.phone || "").trim(),
    birthday: String(parsed.birthday || "").trim(),
    claim: String(parsed.claim || "").trim(),
    lotteryTypeId: String(parsed.lotteryTypeId || "").trim(),
    transport: "fetch",
  };
}

function validateRequestEnvelope_(request) {
  // Reject admin/unknown actions before inspecting their token or parameters.
  assertSupportedAction_(request.action);

  if (!/^[a-zA-Z0-9-]{10,80}$/.test(request.requestId || "")) {
    throw appError_("INVALID_REQUEST_ID", "請求識別碼格式不正確。");
  }
  if (!request.idToken || request.idToken.length > MAX_ID_TOKEN_LENGTH || !isJwtLike_(request.idToken)) {
    throw appError_("INVALID_TOKEN", "LINE 登入憑證缺少或格式不正確。");
  }
  if (request.transport === "bridge" && !/^[a-f0-9]{48}$/.test(request.requestSecret || "")) {
    throw appError_("INVALID_BRIDGE", "安全回應通道格式不正確。");
  }

  if (request.action === "updateMemberProfile") {
    request.phone = normalizeMemberPhone_(request.phone);
    request.birthday = normalizeMemberBirthday_(request.birthday);
  }
  if (
    request.action === "previewPointCampaign" ||
    request.action === "redeemPointCampaign"
  ) {
    request.claim = normalizePointClaim_(request.claim);
  }
  if (request.action === "drawLottery") {
    request.lotteryTypeId = normalizeLotteryTypeId_(request.lotteryTypeId);
  }
}

function normalizeLotteryTypeId_(value) {
  var lotteryTypeId = String(value || "").trim();
  if (!/^LTY-[A-Z0-9]{10}$/.test(lotteryTypeId)) {
    throw appError_("INVALID_LOTTERY_TYPE_ID", "轉盤類型識別碼格式不正確。");
  }
  return lotteryTypeId;
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
  return (
    /^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(origin) ||
    /^http:\/\/(localhost|127\.0\.0\.1)(?::\d+)?$/i.test(origin)
  );
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
    // Best effort. The Sheet deletion remains authoritative.
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
    // last_request_id remains the local idempotency fallback.
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
    // Best-effort rate limiting. LINE still validates identity.
  } finally {
    if (acquired && lock) lock.releaseLock();
  }
}

function bridgeResponse_(result, request) {
  var targetOrigin = isValidOrigin_(request.callbackOrigin) ? request.callbackOrigin : "";
  var secret = /^[a-f0-9]{48}$/.test(request.requestSecret || "") ? request.requestSecret : "";

  if (!targetOrigin || !secret) {
    return HtmlService
      .createHtmlOutput("<!doctype html><meta charset=\"utf-8\"><title>Invalid bridge</title>")
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

  return HtmlService
    .createHtmlOutput(html)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function jsonResponse_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
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

  // Never log request bodies or LINE tokens.
  console.error("Member client API error code: " + code);
  return { ok: false, code: code, message: message };
}

function appError_(code, publicMessage) {
  var error = new Error(publicMessage);
  error.appCode = code;
  error.publicMessage = publicMessage;
  return error;
}

function normalizePointClaim_(value) {
  var claim = String(value == null ? "" : value).trim();
  if (!/^[A-Za-z0-9_-]{43}$/.test(claim)) {
    throw appError_("INVALID_POINT_CLAIM", "QR Code 領點憑證格式不正確。");
  }
  return claim;
}

function sha256Hex_(value) {
  var bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(value),
    Utilities.Charset.UTF_8
  );
  return bytes
    .map(function (byte) {
      return ((byte + 256) % 256).toString(16).padStart(2, "0");
    })
    .join("");
}

function plainSheetText_(value, maxLength) {
  var text = String(value == null ? "" : value).trim();
  if (/^'[=+\-@]/.test(text)) text = text.slice(1);
  return text.slice(0, maxLength || 200);
}

function normalizePointBalance_(value) {
  var balance = Number(value || 0);
  return Number.isInteger(balance) && balance >= 0 && balance <= 9007199254740991
    ? balance
    : 0;
}

function normalizeMemberPhone_(value) {
  var phone = String(value == null ? "" : value).trim();
  if (!phone) return "";

  var digitCount = phone.replace(/\D/g, "").length;
  if (
    phone.length > 30 ||
    !/^[0-9+().\- #xX]+$/.test(phone) ||
    digitCount < 6 ||
    digitCount > 20
  ) {
    throw appError_(
      "INVALID_PHONE",
      "電話格式不正確，請輸入 6 至 20 位數字，可使用空格、+、-、括號或分機符號。"
    );
  }

  return phone;
}

function normalizeMemberBirthday_(value) {
  var birthday = String(value == null ? "" : value).trim();
  if (!birthday) return "";

  var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthday);
  if (!match) {
    throw appError_("INVALID_BIRTHDAY", "生日格式不正確，請使用 YYYY-MM-DD。");
  }

  var year = Number(match[1]);
  var month = Number(match[2]);
  var day = Number(match[3]);
  var date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw appError_("INVALID_BIRTHDAY", "生日不是有效的日期。");
  }

  var today = Utilities.formatDate(new Date(), "Asia/Taipei", "yyyy-MM-dd");
  if (birthday > today) {
    throw appError_("INVALID_BIRTHDAY", "生日不可晚於今天。");
  }

  return birthday;
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

function toIsoString_(value) {
  var date = value instanceof Date ? value : new Date(value);
  return isNaN(date.getTime()) ? "" : date.toISOString();
}
