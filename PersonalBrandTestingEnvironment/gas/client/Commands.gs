/**
 * Member command boundary.
 *
 * Each entry owns the validation and handler for one public action. Keep this
 * registry member-only so a client deployment cannot dispatch administrator
 * commands even when called directly from another Apps Script function.
 */

var MEMBER_COMMAND_REGISTRY_ = null;
var MEMBER_ACTIONS = listMemberCommandNames_();

function getMemberCommandRegistry_() {
  if (!MEMBER_COMMAND_REGISTRY_) {
    MEMBER_COMMAND_REGISTRY_ = {
      upsertMember: memberCommand_(validateMemberCommandWithoutPayload_, function (
        identity,
        request,
        config
      ) {
        return upsertMember_(identity, request, config);
      }),
      updateMemberProfile: memberCommand_(validateUpdateMemberProfileCommand_, function (
        identity,
        request,
        config
      ) {
        return updateMemberProfile_(identity, request, config);
      }),
      listPointHistory: memberCommand_(validateMemberCommandWithoutPayload_, function (
        identity,
        request,
        config
      ) {
        return listPointHistory_(identity, request, config);
      }),
      getLotteryConfig: memberCommand_(validateMemberCommandWithoutPayload_, function (
        identity,
        request,
        config
      ) {
        return getLotteryConfig_(identity, request, config);
      }),
      drawLottery: memberCommand_(validateDrawLotteryCommand_, function (
        identity,
        request,
        config
      ) {
        return drawLottery_(identity, request, config);
      }),
      previewPointCampaign: memberCommand_(validatePointCampaignCommand_, function (
        identity,
        request,
        config
      ) {
        return previewPointCampaign_(identity, request, config);
      }),
      redeemPointCampaign: memberCommand_(validatePointCampaignCommand_, function (
        identity,
        request,
        config
      ) {
        return redeemPointCampaign_(identity, request, config);
      }),
      deleteMember: memberCommand_(validateMemberCommandWithoutPayload_, function (
        identity,
        request,
        config
      ) {
        return deleteMember_(identity, request, config);
      }),
    };
  }
  return MEMBER_COMMAND_REGISTRY_;
}

function memberCommand_(validate, handle) {
  return { validate: validate, handle: handle };
}

function getMemberCommand_(action) {
  var command = getMemberCommandRegistry_()[String(action || "")];
  if (!command) {
    throw appError_("UNSUPPORTED_ACTION", "此會員端後台不支援該操作。");
  }
  return command;
}

function listMemberCommandNames_() {
  return Object.keys(getMemberCommandRegistry_());
}

function validateMemberCommandWithoutPayload_(_request) {}

function validateUpdateMemberProfileCommand_(request) {
  var profile = normalizeRequiredMemberProfile_(
    request.phone,
    request.birthday
  );
  request.phone = profile.phone;
  request.birthday = profile.birthday;
}

function validatePointCampaignCommand_(request) {
  request.claim = normalizePointClaim_(request.claim);
}

function validateDrawLotteryCommand_(request) {
  request.lotteryTypeId = normalizeLotteryTypeId_(request.lotteryTypeId);
  request.cardRoundKey = normalizeOptionalCardRoundKey_(request.cardRoundKey);
}
