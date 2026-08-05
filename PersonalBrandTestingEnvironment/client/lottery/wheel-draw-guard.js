(function (root) {
  "use strict";

  function createError(code, message) {
    var error = new Error(message);
    error.code = code;
    return error;
  }

  function create() {
    var prepared = null;

    function save(ticket, request, response) {
      prepared = {
        cardRoundKey: String(ticket.cardRoundKey),
        lotteryTypeId: String(ticket.lotteryTypeId),
        requestId: String(request.requestId),
        response: response,
      };
      return response;
    }

    function resolve(ticket, requestId) {
      if (
        !prepared ||
        prepared.cardRoundKey !== String(ticket.cardRoundKey) ||
        prepared.lotteryTypeId !== String(ticket.lotteryTypeId) ||
        prepared.requestId !== String(requestId || "")
      ) {
        return Promise.reject(
          createError(
            "LOTTERY_RESULT_NOT_PREPARED",
            "抽獎結果尚未準備完成，請重新開啟轉盤。"
          )
        );
      }

      return Promise.resolve(prepared.response);
    }

    function has(ticket, requestId) {
      return Boolean(
        prepared &&
          prepared.cardRoundKey === String(ticket.cardRoundKey) &&
          prepared.lotteryTypeId === String(ticket.lotteryTypeId) &&
          prepared.requestId === String(requestId || "")
      );
    }

    function clear() {
      prepared = null;
    }

    return Object.freeze({
      save: save,
      resolve: resolve,
      has: has,
      clear: clear,
    });
  }

  root.MemberLotteryWheelDrawGuard = Object.freeze({
    create: create,
  });
})(window);
