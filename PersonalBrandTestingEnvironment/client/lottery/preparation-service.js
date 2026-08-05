(function (root) {
  "use strict";

  function createError(code, message) {
    var error = new Error(message);
    error.code = code;
    return error;
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
      code === "INVALID_LOTTERY_TICKET"
    );
  }

  function create(options) {
    options = options && typeof options === "object" ? options : {};

    if (
      typeof options.request !== "function" ||
      !options.store ||
      !options.guard
    ) {
      throw createError(
        "INVALID_CONFIGURATION",
        "PreparationService 缺少 request、store 或 guard。"
      );
    }

    function safeCardUpdated(card, totalPoints) {
      if (typeof options.onCardUpdated !== "function") return;
      try {
        options.onCardUpdated(card, totalPoints);
      } catch (_error) {
        // Host rendering failure must not affect draw persistence.
      }
    }

    function validateWorkspace(response, ticket, pending) {
      assertSuccessfulResponse(response);

      var data = response.data;
      if (
        !data ||
        !data.access ||
        data.access.allowed !== true ||
        !Array.isArray(data.lotteryTypes) ||
        !data.card ||
        !Array.isArray(data.card.availableRewards)
      ) {
        throw createError(
          "INVALID_RESPONSE",
          "後台回傳的抽獎資料格式不完整。"
        );
      }

      var selectedType = data.lotteryTypes.find(function (type) {
        return (
          type &&
          String(type.lotteryTypeId || "") === ticket.lotteryTypeId
        );
      });

      if (!selectedType || !selectedType.lottery) {
        throw createError(
          "LOTTERY_TYPE_NOT_FOUND",
          "這張抽獎券指定的轉盤目前無法使用。"
        );
      }

      if (!pending) {
        var available = data.card.availableRewards.some(function (item) {
          return (
            item &&
            String(item.cardRoundKey || "") === ticket.cardRoundKey &&
            String(item.lotteryTypeId || "") === ticket.lotteryTypeId
          );
        });

        if (!available) {
          throw createError(
            "LOTTERY_ROUND_NOT_READY",
            "這張抽獎券已使用或目前無法使用。"
          );
        }
      }

      return response;
    }

    function validateDrawResponse(response, ticket) {
      assertSuccessfulResponse(response);

      var data = response.data;
      if (
        !data ||
        !data.draw ||
        !data.lottery ||
        !data.lotteryType ||
        !data.card ||
        String(data.draw.cardRoundKey || "") !== ticket.cardRoundKey ||
        String(data.draw.lotteryTypeId || "") !== ticket.lotteryTypeId
      ) {
        throw createError(
          "INVALID_RESPONSE",
          "後台回傳的抽獎結果格式不完整或不一致。"
        );
      }

      return response;
    }

    function refreshHostCard() {
      return Promise.resolve()
        .then(function () {
          return options.request("getLotteryConfig", {}, undefined);
        })
        .then(assertSuccessfulResponse)
        .then(function (response) {
          if (response.data && response.data.card) {
            var totalPoints =
              response.data.totalPoints == null
                ? response.data.pointBalance
                : response.data.totalPoints;
            safeCardUpdated(response.data.card, totalPoints);
          }
        })
        .catch(function () {
          // The original definitive error remains the primary user-facing error.
        });
    }

    function prepare(ticketValue) {
      var ticket = options.store.normalizeTicket(ticketValue);
      var pendingBeforeConfig = options.store.read();
      var workspaceResponse;
      var request;

      return Promise.resolve()
        .then(function () {
          return options.request("getLotteryConfig", {}, undefined);
        })
        .then(function (response) {
          workspaceResponse = validateWorkspace(
            response,
            ticket,
            pendingBeforeConfig
          );
          request = options.store.ensure(ticket);
          return options.request(
            "drawLottery",
            {
              lotteryTypeId: ticket.lotteryTypeId,
              cardRoundKey: ticket.cardRoundKey,
            },
            request.requestId
          );
        })
        .then(function (response) {
          var validated = validateDrawResponse(response, ticket);
          options.guard.save(ticket, request, validated);
          return workspaceResponse;
        })
        .catch(function (error) {
          if (!isDefinitiveNoDrawError(error)) {
            throw error;
          }

          options.store.clear();
          options.guard.clear();
          return refreshHostCard().then(function () {
            throw error;
          });
        });
    }

    function resolvePrepared(ticketValue, requestId) {
      var ticket = options.store.normalizeTicket(ticketValue);
      return options.guard.resolve(ticket, requestId);
    }

    return Object.freeze({
      prepare: prepare,
      resolvePrepared: resolvePrepared,
      isDefinitiveNoDrawError: isDefinitiveNoDrawError,
    });
  }

  root.MemberLotteryPreparationService = Object.freeze({
    create: create,
  });
})(window);
