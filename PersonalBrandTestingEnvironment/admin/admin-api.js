(function (root) {
  "use strict";

  var registry = root.PersonaModules;
  if (!registry) {
    throw new Error("PersonaModules must load before admin-api.js.");
  }

  registry.define("admin.api", [], function () {
    var ACTION_FIELDS = Object.freeze({
      adminListMembers: Object.freeze(["page", "pageSize"]),
      adminSetMemberAccess: Object.freeze([
        "targetMemberId",
        "accessStatus",
        "expectedAccessStatus",
        "expectedAccessUpdatedAt",
      ]),
      adminListPointTypes: Object.freeze([]),
      adminListPointHistory: Object.freeze([]),
      adminCreatePointType: Object.freeze([
        "pointAmount",
        "expiryMode",
        "redemptionMode",
      ]),
      adminDeletePointType: Object.freeze(["pointTypeId"]),
      adminCreatePointCampaign: Object.freeze(["pointTypeId", "expiresAt"]),
      adminGetLotteryConfig: Object.freeze([]),
      adminSavePointCardSetting: Object.freeze([
        "pointCardTarget",
        "pointCardRewards",
        "pointCardExpiryMode",
        "pointCardExpiresOn",
      ]),
      adminCreateLotteryType: Object.freeze(["lotteryTypeName"]),
      adminDeleteLotteryType: Object.freeze(["lotteryTypeId"]),
      adminSaveLotteryConfig: Object.freeze([
        "lotteryTypeId",
        "lotteryTypeName",
        "lotteryPrizes",
      ]),
      adminListLotteryDraws: Object.freeze([]),
    });

    function createError(code, message) {
      var error = new Error(message);
      error.code = code;
      return error;
    }

    function createPayload(actionValue, fieldsValue) {
      var action = String(actionValue || "").trim();
      var allowed = ACTION_FIELDS[action];
      if (!allowed) {
        throw createError(
          "UNSUPPORTED_ACTION",
          "管理端不支援這個後台操作。"
        );
      }

      var fields =
        fieldsValue && typeof fieldsValue === "object" && !Array.isArray(fieldsValue)
          ? fieldsValue
          : {};
      var payload = {};
      Object.keys(fields).forEach(function (name) {
        if (allowed.indexOf(name) === -1) {
          throw createError(
            "INVALID_ACTION_FIELD",
            "管理端請求包含不屬於此操作的欄位。"
          );
        }
        if (fields[name] !== undefined) payload[name] = fields[name];
      });
      return Object.freeze(payload);
    }

    function send(options) {
      options = options || {};
      if (!root.MemberApi || typeof root.MemberApi.sendRequest !== "function") {
        return Promise.reject(
          createError("CLIENT_LIBRARY_ERROR", "無法載入管理資料連線元件。")
        );
      }
      return root.MemberApi.sendRequest({
        gasUrl: options.gasUrl,
        action: options.action,
        idToken: options.idToken,
        context: options.context || {},
        payload: createPayload(options.action, options.fields),
        requestId: options.requestId,
      });
    }

    return Object.freeze({
      actions: Object.freeze(Object.keys(ACTION_FIELDS)),
      createPayload: createPayload,
      send: send,
    });
  });
})(window);
