(function (root) {
  "use strict";

  var registry = root.PersonaModules;
  if (!registry) {
    throw new Error("PersonaModules must load before member-api.js.");
  }

  registry.define("member.api", [], function () {
    var ACTION_FIELDS = Object.freeze({
      upsertMember: Object.freeze([]),
      updateMemberProfile: Object.freeze(["phone", "birthday"]),
      listPointHistory: Object.freeze([]),
      getLotteryConfig: Object.freeze([]),
      drawLottery: Object.freeze(["lotteryTypeId", "cardRoundKey"]),
      previewPointCampaign: Object.freeze(["claim"]),
      redeemPointCampaign: Object.freeze(["claim"]),
      deleteMember: Object.freeze([]),
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
          "會員端不支援這個後台操作。"
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
            "會員端請求包含不屬於此操作的欄位。"
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
          createError("CLIENT_LIBRARY_ERROR", "無法載入會員資料連線元件。")
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
