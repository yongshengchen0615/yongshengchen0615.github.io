(function (global) {
  "use strict";

  var namespace =
    global.MemberLotteryPreparation || Object.create(null);

  function createPreparationService(options) {
    options = options && typeof options === "object" ? options : {};

    var request = options.request;
    var store = options.store;
    var normalizeTicket = options.normalizeTicket;
    var isDefinitiveError = options.isDefinitiveError;
    var prepared = Object.create(null);
    var generation = 0;
    var preparing = false;

    if (typeof request !== "function") {
      throw createError(
        "INVALID_SERVICE_CONFIGURATION",
        "PreparationService 需要 request()。"
      );
    }
    if (!store || typeof store.ensure !== "function") {
      throw createError(
        "INVALID_SERVICE_CONFIGURATION",
        "PreparationService 需要 PendingRequestStore。"
      );
    }
    if (typeof normalizeTicket !== "function") {
      throw createError(
        "INVALID_SERVICE_CONFIGURATION",
        "PreparationService 需要 normalizeTicket()。"
      );
    }
    if (typeof isDefinitiveError !== "function") {
      throw createError(
        "INVALID_SERVICE_CONFIGURATION",
        "PreparationService 需要 isDefinitiveError()。"
      );
    }

    function prepare(ticketValue) {
      var currentGeneration = ++generation;
      var ticket;
      var pending;

      try {
        ticket = normalizeTicket(ticketValue);
        pending = store.ensure(ticket);
      } catch (error) {
        return Promise.resolve({
          ready: false,
          retryable: false,
          error: normalizeError(error),
        });
      }

      preparing = true;

      return Promise.resolve(
        request(
          "drawLottery",
          {
            lotteryTypeId: ticket.lotteryTypeId,
            cardRoundKey: ticket.cardRoundKey,
          },
          pending.requestId
        )
      )
        .then(function (response) {
          if (currentGeneration !== generation) {
            return { ready: false, stale: true };
          }

          assertSuccessfulResponse(response);
          prepared[pending.requestId] = {
            response: response,
            lotteryTypeId: ticket.lotteryTypeId,
            cardRoundKey: ticket.cardRoundKey,
          };
          preparing = false;

          return {
            ready: true,
            pending: pending,
          };
        })
        .catch(function (reason) {
          if (currentGeneration !== generation) {
            return { ready: false, stale: true };
          }

          preparing = false;
          var error = normalizeError(reason);
          var definitive = isDefinitiveError(error);
          if (definitive) store.clear();

          return {
            ready: false,
            retryable: !definitive,
            error: error,
          };
        });
    }

    function consume(fields, requestId) {
      requestId = String(requestId || "");
      if (!requestId || !prepared[requestId]) return null;

      var item = prepared[requestId];
      if (
        String((fields && fields.lotteryTypeId) || "") !==
          item.lotteryTypeId ||
        String((fields && fields.cardRoundKey) || "") !==
          item.cardRoundKey
      ) {
        throw createError(
          "REQUEST_ID_CONFLICT",
          "抽獎券與已準備結果不一致。"
        );
      }

      delete prepared[requestId];
      return item.response;
    }

    function hasPrepared(requestId) {
      return Boolean(prepared[String(requestId || "")]);
    }

    function getPending() {
      return store.read();
    }

    function cancel() {
      generation += 1;
      preparing = false;
    }

    function isPreparing() {
      return preparing;
    }

    function assertSuccessfulResponse(response) {
      if (!response || response.ok !== true) {
        throw createError(
          response && response.code ? response.code : "BACKEND_ERROR",
          response && response.message
            ? response.message
            : "後台目前無法準備抽獎結果。"
        );
      }
    }

    return Object.freeze({
      prepare: prepare,
      consume: consume,
      hasPrepared: hasPrepared,
      getPending: getPending,
      cancel: cancel,
      isPreparing: isPreparing,
    });
  }

  function normalizeError(reason) {
    if (reason instanceof Error) return reason;
    var error = new Error(
      reason && reason.message
        ? String(reason.message)
        : "目前無法準備抽獎結果。"
    );
    error.code =
      reason && (reason.code || reason.name)
        ? String(reason.code || reason.name)
        : "DRAW_ERROR";
    return error;
  }

  function createError(code, message) {
    var value = new Error(message);
    value.code = code;
    return value;
  }

  namespace.createPreparationService = createPreparationService;
  global.MemberLotteryPreparation = namespace;
})(window);
