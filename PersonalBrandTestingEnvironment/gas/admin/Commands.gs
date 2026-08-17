/**
 * Administrator command boundary.
 *
 * Validation and dispatch stay in the administrator deployment. Member
 * actions never enter this registry, so direct internal calls remain fail
 * closed before configuration, LINE verification, or spreadsheet access.
 */

var ADMIN_COMMAND_REGISTRY_ = null;
var ADMIN_ACTIONS = listAdminCommandNames_();

function getAdminCommandRegistry_() {
  if (!ADMIN_COMMAND_REGISTRY_) {
    ADMIN_COMMAND_REGISTRY_ = {
      adminListMembers: adminCommand_(validateAdminListMembersCommand_, function (
        identity,
        request,
        config
      ) {
        return adminListMembers_(identity, request, config);
      }),
      adminSetMemberAccess: adminCommand_(validateAdminSetMemberAccessCommand_, function (
        identity,
        request,
        config
      ) {
        return adminSetMemberAccess_(identity, request, config);
      }),
      adminListPointTypes: adminCommand_(validateAdminCommandWithoutPayload_, function (
        identity,
        request,
        config
      ) {
        return adminListPointTypes_(identity, request, config);
      }),
      adminListPointHistory: adminCommand_(validateAdminCommandWithoutPayload_, function (
        identity,
        request,
        config
      ) {
        return adminListPointHistory_(identity, request, config);
      }),
      adminCreatePointType: adminCommand_(validateAdminCreatePointTypeCommand_, function (
        identity,
        request,
        config
      ) {
        return adminCreatePointType_(identity, request, config);
      }),
      adminDeletePointType: adminCommand_(validateAdminDeletePointTypeCommand_, function (
        identity,
        request,
        config
      ) {
        return adminDeletePointType_(identity, request, config);
      }),
      adminCreatePointCampaign: adminCommand_(
        validateAdminCreatePointCampaignCommand_,
        function (identity, request, config) {
          return adminCreatePointCampaign_(identity, request, config);
        }
      ),
      adminGetLotteryConfig: adminCommand_(validateAdminCommandWithoutPayload_, function (
        identity,
        request,
        config
      ) {
        return adminGetLotteryConfig_(identity, request, config);
      }),
      adminSavePointCardSetting: adminCommand_(
        validateAdminSavePointCardSettingCommand_,
        function (identity, request, config) {
          return adminSavePointCardSetting_(identity, request, config);
        }
      ),
      adminCreateLotteryType: adminCommand_(
        validateAdminCreateLotteryTypeCommand_,
        function (identity, request, config) {
          return adminCreateLotteryType_(identity, request, config);
        }
      ),
      adminDeleteLotteryType: adminCommand_(
        validateAdminDeleteLotteryTypeCommand_,
        function (identity, request, config) {
          return adminDeleteLotteryType_(identity, request, config);
        }
      ),
      adminSaveLotteryConfig: adminCommand_(
        validateAdminSaveLotteryConfigCommand_,
        function (identity, request, config) {
          return adminSaveLotteryConfig_(identity, request, config);
        }
      ),
      adminListLotteryDraws: adminCommand_(validateAdminCommandWithoutPayload_, function (
        identity,
        request,
        config
      ) {
        return adminListLotteryDraws_(identity, request, config);
      }),
    };
  }
  return ADMIN_COMMAND_REGISTRY_;
}

function adminCommand_(validate, handle) {
  return { validate: validate, handle: handle };
}

function getAdminCommand_(action) {
  var command = getAdminCommandRegistry_()[String(action || "")];
  if (!command) {
    throw appError_("UNSUPPORTED_ACTION", "此管理服務不支援該操作。");
  }
  return command;
}

function listAdminCommandNames_() {
  return Object.keys(getAdminCommandRegistry_());
}

function validateAdminCommandWithoutPayload_(_request) {}

function validateAdminListMembersCommand_(request) {
  if (!isPositiveInteger_(request.page)) {
    throw appError_("INVALID_PAGE", "頁碼格式不正確。");
  }
  if (
    !isPositiveInteger_(request.pageSize) ||
    request.pageSize > MAX_ADMIN_PAGE_SIZE
  ) {
    throw appError_("INVALID_PAGE_SIZE", "每頁筆數必須介於 1 到 100。");
  }
}

function validateAdminSetMemberAccessCommand_(request) {
  if (!/^MBR-[A-Z0-9]{10}$/.test(request.targetMemberId || "")) {
    throw appError_("INVALID_MEMBER_ID", "會員識別碼格式不正確。");
  }
  if (request.accessStatus !== "approved" && request.accessStatus !== "denied") {
    throw appError_(
      "INVALID_ACCESS_STATUS",
      "會員權限狀態只能設為 approved 或 denied。"
    );
  }
  if (
    request.expectedAccessStatus !== "approved" &&
    request.expectedAccessStatus !== "denied"
  ) {
    throw appError_("INVALID_ACCESS_VERSION", "會員權限版本狀態不正確。");
  }
  if (
    request.expectedAccessUpdatedAt &&
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(
      request.expectedAccessUpdatedAt
    )
  ) {
    throw appError_("INVALID_ACCESS_VERSION", "會員權限版本格式不正確。");
  }
}

function validateAdminCreatePointTypeCommand_(request) {
  normalizePointValue_(request.points);
  normalizeExpiryMode_(request.expiryMode);
  normalizeRedemptionMode_(request.redemptionMode);
}

function validateAdminDeletePointTypeCommand_(request) {
  normalizePointTypeId_(request.pointTypeId);
}

function validateAdminCreatePointCampaignCommand_(request) {
  normalizePointTypeId_(request.pointTypeId);
}

function validateAdminSavePointCardSettingCommand_(request) {
  var pointCardTarget = normalizePointCardTarget_(request.pointCardTarget);
  normalizePointCardExpiry_(
    request.pointCardExpiryMode,
    request.pointCardExpiresOn,
    true
  );
  normalizePointCardRewardRules_(
    request.pointCardRewards,
    request.pointCardMilestones,
    pointCardTarget
  );
}

function validateAdminCreateLotteryTypeCommand_(request) {
  normalizeLotteryTypeName_(request.lotteryTypeName);
}

function validateAdminDeleteLotteryTypeCommand_(request) {
  normalizeLotteryTypeId_(request.lotteryTypeId);
}

function validateAdminSaveLotteryConfigCommand_(request) {
  if (request.lotteryTypeId) normalizeLotteryTypeId_(request.lotteryTypeId);
  if (!request.lotteryTypeId || request.lotteryTypeName) {
    normalizeLotteryTypeName_(request.lotteryTypeName);
  }
  normalizeLotteryPrizes_(request.lotteryPrizes);
}
