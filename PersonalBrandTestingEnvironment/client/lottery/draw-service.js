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

        function emitDrawStart() {
          if (
            typeof root.dispatchEvent !== "function" ||
            typeof root.CustomEvent !== "function"
          ) {
            return;
          }
          try {
            root.dispatchEvent(
              new root.CustomEvent("persona:lottery-draw-start", {
                detail: Object.freeze({ phase: "requesting_result" }),
              })
            );
          } catch (_error) {
            // Motion diagnostics must never block the authoritative draw.
          }
        }

        function normalizeDrawResponseShape(response, ticket) {
          contracts.assertSuccessfulResponse(response);
          var data = response.data;
          var lotteryType =
            data && data.lotteryType && typeof data.lotteryType === "object"
              ? data.lotteryType
              : null;
          var lottery =
            data && data.lottery && typeof data.lottery === "object"
              ? data.lottery
              : lotteryType &&
                  lotteryType.lottery &&
                  typeof lotteryType.lottery === "object"
                ? lotteryType.lottery
                : null;

          if (
            !data ||
            !data.draw ||
            !lottery ||
            !lotteryType ||
            !data.card ||
            String(data.draw.cardRoundKey || "") !== ticket.cardRoundKey ||
            String(data.draw.lotteryTypeId || "") !== ticket.lotteryTypeId ||
            String(lottery.lotteryTypeId || "") !== ticket.lotteryTypeId ||
            String(lotteryType.lotteryTypeId || "") !== ticket.lotteryTypeId
          ) {
            throw contracts.createError(
              "INVALID_RESPONSE",
              "後台回傳的抽獎結果缺少必要欄位，票券已保留，可安全重試。"
            );
          }

          if (!lotteryType.lottery || data.lottery !== lottery) {
            var normalizedLotteryType = Object.assign({}, lotteryType, {
              lottery: lottery,
            });
            return Object.assign({}, response, {
              data: Object.assign({}, data, {
                lottery: lottery,
                lotteryType: normalizedLotteryType,
              }),
            });
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
              // The central button is the transaction boundary. Motion starts
              // immediately, while this same persistent request id is sent to
              // the authoritative backend exactly once/replayed on retry.
              emitDrawStart();
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
              return normalizeDrawResponseShape(response, ticket);
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
