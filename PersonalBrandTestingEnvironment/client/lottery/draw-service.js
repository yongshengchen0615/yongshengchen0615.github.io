(function (root) {
  "use strict";

  var registry = root.PersonaModules;
  if (!registry) return;

  registry.define(
    "lottery.draw-service",
    ["lottery.contracts"],
    function (contracts) {
      function create(options) {
        options = options && typeof options === "object" ? options : {};
        if (
          typeof options.request !== "function" ||
          !options.store ||
          typeof options.store.ensure !== "function" ||
          typeof options.store.read !== "function" ||
          typeof options.store.clear !== "function"
        ) {
          throw contracts.createError(
            "INVALID_CONFIGURATION",
            "DrawService 缺少 request 或 pending request store。"
          );
        }

        var workspaceService = options.workspaceService || null;
        var activeKey = "";
        var activePromise = null;

        function performanceNow() {
          return root.performance && typeof root.performance.now === "function"
            ? root.performance.now()
            : Date.now();
        }

        function emitMetric(phase, startedAt) {
          if (
            typeof root.dispatchEvent !== "function" ||
            typeof root.CustomEvent !== "function"
          ) {
            return;
          }
          try {
            root.dispatchEvent(
              new root.CustomEvent("persona:lottery-performance", {
                detail: Object.freeze({
                  phase: phase,
                  durationMs: Math.max(
                    0,
                    Math.round((performanceNow() - startedAt) * 10) / 10
                  ),
                  source: "network",
                }),
              })
            );
          } catch (_error) {
            // Diagnostics must never alter draw persistence.
          }
        }

        function validateDrawResponse(response, ticket) {
          contracts.assertSuccessfulResponse(response);
          var data = response.data;
          if (
            !data ||
            !data.draw ||
            !data.lottery ||
            !data.lotteryType ||
            !data.card ||
            String(data.draw.cardRoundKey || "") !== ticket.cardRoundKey ||
            String(data.draw.lotteryTypeId || "") !== ticket.lotteryTypeId ||
            String(data.lottery.lotteryTypeId || "") !== ticket.lotteryTypeId ||
            String(data.lotteryType.lotteryTypeId || "") !== ticket.lotteryTypeId
          ) {
            throw contracts.createError(
              "INVALID_RESPONSE",
              "後台回傳的抽獎結果格式不完整或不一致。"
            );
          }
          return response;
        }

        function draw(ticketValue) {
          var ticket = contracts.normalizeTicket(ticketValue);
          var request = options.store.ensure(ticket);
          var key =
            ticket.cardRoundKey +
            "|" +
            ticket.lotteryTypeId +
            "|" +
            request.requestId;

          if (activePromise) {
            if (activeKey === key) return activePromise;
            return Promise.reject(
              contracts.createError(
                "LOTTERY_DRAW_BUSY",
                "另一筆抽獎請求正在處理中。"
              )
            );
          }

          var startedAt = performanceNow();
          var promise = Promise.resolve()
            .then(function () {
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
              emitMetric("draw_lottery", startedAt);
              return validateDrawResponse(response, ticket);
            })
            .catch(function (error) {
              emitMetric("draw_lottery", startedAt);
              if (contracts.isDefinitiveNoDrawError(error)) {
                clear();
              }
              throw error;
            })
            .finally(function () {
              if (activePromise === promise) {
                activePromise = null;
                activeKey = "";
              }
            });

          activeKey = key;
          activePromise = promise;
          return promise;
        }

        function clear() {
          options.store.clear();
          if (
            workspaceService &&
            typeof workspaceService.invalidate === "function"
          ) {
            workspaceService.invalidate();
          }
        }

        function complete() {
          clear();
        }

        function hasPending() {
          return Boolean(options.store.read());
        }

        function getPending() {
          return options.store.read();
        }

        return Object.freeze({
          draw: draw,
          complete: complete,
          clear: clear,
          hasPending: hasPending,
          getPending: getPending,
          isDefinitiveNoDrawError: contracts.isDefinitiveNoDrawError,
        });
      }

      return Object.freeze({ create: create });
    }
  );
})(window);
