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
 * - MAX_VERIFY_REQUESTS_PER_MINUTE: defaults to 120 (1-1000)
 *
 * This deployment accepts only member-owned actions. It deliberately does not
 * authorize or implement administrator actions.
 */

var API_VERSION = "1.2.0";
var DEFAULT_SHEET_NAME = "Members";
var DEFAULT_POINT_TYPE_SHEET_NAME = "PointTypes";
var DEFAULT_POINT_CAMPAIGN_SHEET_NAME = "PointCampaigns";
var DEFAULT_POINT_REDEMPTION_SHEET_NAME = "PointRedemptions";
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
    migrateDefaultMemberAccess_(sheet);
    applySheetColumnFormats_(sheet);
    applyPointTypeSheetFormats_(pointTypeSheet);
    applyPointCampaignSheetFormats_(pointCampaignSheet);
    applyPointRedemptionSheetFormats_(pointRedemptionSheet);
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
      ? getMemberPointBalance_(getOrCreatePointRedemptionSheet_(config), identity.lineUserId)
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
      ? getMemberPointBalance_(getOrCreatePointRedemptionSheet_(config), identity.lineUserId)
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
      identity.lineUserId
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
          pointBalance: getMemberPointBalance_(redemptionSheet, identity.lineUserId),
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
          pointBalance: getMemberPointBalance_(redemptionSheet, identity.lineUserId),
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
          pointBalance: getMemberPointBalance_(redemptionSheet, identity.lineUserId),
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
            pointBalance: getMemberPointBalance_(redemptionSheet, identity.lineUserId),
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
            pointBalance: getMemberPointBalance_(redemptionSheet, identity.lineUserId),
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

    var pointBalance = getMemberPointBalance_(redemptionSheet, identity.lineUserId);
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

    rowNumbers.forEach(function (rowNumber) {
      // Keep physical row numbers stable because the administrator backend is
      // a separate GAS project whose ScriptLock cannot coordinate with this
      // one. Clearing prevents a concurrent narrow admin write from shifting
      // onto the next member while still removing all member data.
      sheet
        .getRange(rowNumber, 1, 1, MEMBER_HEADERS.length)
        .setValues([new Array(MEMBER_HEADERS.length).fill("")]);
    });
    if (rowNumbers.length > 0 || deletedRedemptions > 0) SpreadsheetApp.flush();

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
  var allowedOrigins = getAllowedOrigins_();

  if (
    !/^\d{6,}$/.test(lineChannelId) ||
    !spreadsheetId ||
    !sheetName ||
    !pointTypeSheetName ||
    !pointCampaignSheetName ||
    !pointRedemptionSheetName ||
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

function getMemberPointBalance_(sheet, lineUserId) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;

  var rows = sheet
    .getRange(2, 1, lastRow - 1, POINT_REDEMPTION_HEADERS.length)
    .getValues();
  var balance = 0;
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
      isNaN(redeemedDate.getTime()) ||
      !redemptionMode ||
      (campaignModes[campaignId] &&
        (campaignModes[campaignId] !== redemptionMode ||
          redemptionMode !== "repeatable"))
    ) {
      throw appError_("POINT_DATA_ERROR", "會員點數紀錄格式不正確，請聯絡管理員。");
    }
    campaignModes[campaignId] = redemptionMode;
    if (balance > 9007199254740991 - points) {
      throw appError_("POINT_DATA_ERROR", "會員點數資料超出可處理範圍。");
    }
    balance += points;
  });
  return balance;
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
