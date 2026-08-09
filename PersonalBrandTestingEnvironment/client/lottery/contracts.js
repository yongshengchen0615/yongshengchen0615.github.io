(function (root) {
  "use strict";

  var registry = root.PersonaModules;
  if (!registry) {
    throw new Error("PersonaModules must load before lottery contracts.");
  }

  registry.define("lottery.contracts", [], function () {
    var REQUEST_ID_PATTERN = /^[A-Za-z0-9-]{10,80}$/;
    var SETTING_VERSION_PATTERN = /^PCS-[A-Z0-9]{12}$/;
    var LOTTERY_TYPE_ID_PATTERN = /^LTY-[A-Z0-9]{10}$/;
    var LOTTERY_RESPONSE_ERROR_CODE = "LOTTERY_RESPONSE_INVALID";

    function emitContractError(message) {
      if (
        typeof root.dispatchEvent !== "function" ||
        typeof root.CustomEvent !== "function"
      ) {
        return;
      }
      try {
        root.dispatchEvent(
          new root.CustomEvent("persona:lottery-contract-error", {
            detail: Object.freeze({
              code: LOTTERY_RESPONSE_ERROR_CODE,
              reason: String(message || "抽獎回應格式不正確。").slice(0, 120),
              source: "client-validator",
            }),
          })
        );
      } catch (_error) {
        // Diagnostics must never affect Lottery behavior.
      }
    }

    function createError(code, message) {
      var normalizedCode = String(code || "LOTTERY_ERROR");
      var error = new Error(message);
      if (normalizedCode === "INVALID_RESPONSE") {
        error.code = LOTTERY_RESPONSE_ERROR_CODE;
        error.originalCode = normalizedCode;
        emitContractError(message);
      } else {
        error.code = normalizedCode;
      }
      return error;
    }

    function normalizeTicket(value) {
      value = value && typeof value === "object" ? value : {};

      var ticket = {
        settingVersion: String(value.settingVersion || "").trim(),
        cardNumber: Number(value.cardNumber),
        milestonePoints: Number(value.milestonePoints),
        lotteryTypeId: String(value.lotteryTypeId || "").trim(),
        cardRoundKey: String(value.cardRoundKey || "").trim(),
      };

      if (
        !SETTING_VERSION_PATTERN.test(ticket.settingVersion) ||
        !Number.isSafeInteger(ticket.cardNumber) ||
        ticket.cardNumber < 1 ||
        !Number.isSafeInteger(ticket.milestonePoints) ||
        ticket.milestonePoints < 1 ||
        ticket.milestonePoints > 9999 ||
        !LOTTERY_TYPE_ID_PATTERN.test(ticket.lotteryTypeId) ||
        ticket.cardRoundKey !==
          ticket.settingVersion +
            ":" +
            ticket.cardNumber +
            ":" +
            ticket.milestonePoints
      ) {
        throw createError(
          "INVALID_LOTTERY_TICKET",
          "抽獎券資料格式不正確。"
        );
      }

      return Object.freeze(ticket);
    }

    function normalizeRequestId(value) {
      var requestId = String(value || "").trim();
      if (!REQUEST_ID_PATTERN.test(requestId)) {
        throw createError(
          "INVALID_REQUEST_ID",
          "無法建立安全的抽獎請求識別碼。"
        );
      }
      return requestId;
    }

    function assertSuccessfulResponse(response) {
      if (response && response.ok === true) return response;
      throw createError(
        response && response.code ? String(response.code) : "BACKEND_ERROR",
        response && response.message
          ? String(response.message)
          : "後台目前無法回應。"
      );
    }

    function isDefinitiveNoDrawError(errorValue) {
      var code = String(
        (errorValue && (errorValue.code || errorValue.name)) || ""
      );
      return (
        code === "LOTTERY_ROUND_NOT_READY" ||
        code === "LOTTERY_TICKET_MISMATCH" ||
        code === "INVALID_LOTTERY_TICKET" ||
        code === "LOTTERY_NOT_CONFIGURED" ||
        code === "LOTTERY_TYPE_NOT_FOUND" ||
        code === "POINT_CARD_NOT_CONFIGURED" ||
        code === "MEMBER_ACCESS_DENIED"
      );
    }

    function isRecoverableResponseError(errorValue) {
      var code = String(
        (errorValue && (errorValue.code || errorValue.name)) || ""
      );
      return (
        code === LOTTERY_RESPONSE_ERROR_CODE ||
        code === "INVALID_RESPONSE" ||
        code === "BACKEND_RESPONSE_MISMATCH"
      );
    }

    return Object.freeze({
      createError: createError,
      normalizeTicket: normalizeTicket,
      normalizeRequestId: normalizeRequestId,
      assertSuccessfulResponse: assertSuccessfulResponse,
      isDefinitiveNoDrawError: isDefinitiveNoDrawError,
      isRecoverableResponseError: isRecoverableResponseError,
      responseErrorCode: LOTTERY_RESPONSE_ERROR_CODE,
    });
  });
})(window);
