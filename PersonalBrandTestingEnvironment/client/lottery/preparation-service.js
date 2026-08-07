(function (root) {
  "use strict";

  var registry = root.PersonaModules;
  if (!registry) return;

  registry.define(
    "lottery.preparation-service",
    ["lottery.contracts"],
    function (contracts) {
      var DEFAULT_SELECTION_MAX_AGE_MS = 2000;

      function create(options) {
        options = options && typeof options === "object" ? options : {};

        var workspaceService =
          options.workspaceService &&
          typeof options.workspaceService.load === "function"
            ? options.workspaceService
            : null;

        if (!workspaceService) {
          if (typeof options.request !== "function") {
            throw contracts.createError(
              "INVALID_CONFIGURATION",
              "PreparationService 缺少 workspaceService 或 request。"
            );
          }
          workspaceService = {
            load: function () {
              return Promise.resolve(
                options.request("getLotteryConfig", {}, undefined)
              ).then(contracts.assertSuccessfulResponse);
            },
            invalidate: function () {},
          };
        }

        var selectionMaxAgeMs = Number(options.selectionMaxAgeMs);
        selectionMaxAgeMs =
          Number.isFinite(selectionMaxAgeMs) &&
          selectionMaxAgeMs >= 0 &&
          selectionMaxAgeMs <= 5000
            ? selectionMaxAgeMs
            : DEFAULT_SELECTION_MAX_AGE_MS;
        var activeKey = "";
        var activePromise = null;

        function performanceNow() {
          return root.performance && typeof root.performance.now === "function"
            ? root.performance.now()
            : Date.now();
        }

        function emit(name, detail) {
          if (
            typeof root.dispatchEvent !== "function" ||
            typeof root.CustomEvent !== "function"
          ) {
            return;
          }
          try {
            root.dispatchEvent(
              new root.CustomEvent(name, {
                detail: Object.freeze(
                  Object.assign(
                    {},
                    detail && typeof detail === "object" ? detail : {}
                  )
                ),
              })
            );
          } catch (_error) {
            // Diagnostics must never alter lottery state.
          }
        }

        function emitPhase(phase) {
          emit("persona:lottery-phase", { phase: phase });
        }

        function emitMetric(phase, startedAt) {
          emit("persona:lottery-performance", {
            phase: phase,
            durationMs: Math.max(
              0,
              Math.round((performanceNow() - startedAt) * 10) / 10
            ),
            source: "client",
          });
        }

        function ticketKey(ticket) {
          return ticket.cardRoundKey + "|" + ticket.lotteryTypeId;
        }

        function validateWorkspace(response, ticket, allowPendingTicket) {
          contracts.assertSuccessfulResponse(response);

          var data = response.data;
          if (
            !data ||
            !data.access ||
            data.access.allowed !== true ||
            !Array.isArray(data.lotteryTypes) ||
            !data.card ||
            !Array.isArray(data.card.availableRewards)
          ) {
            throw contracts.createError(
              "INVALID_RESPONSE",
              "後台回傳的抽獎資料格式不完整。"
            );
          }

          var selectedType = data.lotteryTypes.find(function (type) {
            return (
              type &&
              String(type.lotteryTypeId || "") === ticket.lotteryTypeId &&
              type.lottery
            );
          });
          if (!selectedType) {
            throw contracts.createError(
              "LOTTERY_TYPE_NOT_FOUND",
              "這張抽獎券指定的轉盤目前無法使用。"
            );
          }

          if (!allowPendingTicket) {
            var available = data.card.availableRewards.some(function (item) {
              return (
                item &&
                String(item.cardRoundKey || "") === ticket.cardRoundKey &&
                String(item.lotteryTypeId || "") === ticket.lotteryTypeId
              );
            });
            if (!available) {
              throw contracts.createError(
                "LOTTERY_ROUND_NOT_READY",
                "這張抽獎券已使用、已過期或目前無法使用。"
              );
            }
          }

          return response;
        }

        function performPrepare(ticket, prepareOptions) {
          var startedAt = performanceNow();
          var allowPendingTicket = prepareOptions.allowPendingTicket === true;

          emitPhase("loading_workspace");
          return workspaceService
            .load({ force: true, maxAgeMs: selectionMaxAgeMs })
            .then(function (response) {
              emitPhase("validating_ticket");
              return validateWorkspace(response, ticket, allowPendingTicket);
            })
            .then(function (response) {
              emitMetric("preparation_service", startedAt);
              return response;
            })
            .catch(function (error) {
              emitMetric("preparation_service", startedAt);
              throw error;
            });
        }

        function prepare(ticketValue, prepareOptions) {
          var ticket = contracts.normalizeTicket(ticketValue);
          prepareOptions =
            prepareOptions && typeof prepareOptions === "object"
              ? prepareOptions
              : {};
          var key =
            ticketKey(ticket) +
            (prepareOptions.allowPendingTicket === true ? "|pending" : "|fresh");

          if (activePromise) {
            if (activeKey === key) return activePromise;
            return Promise.reject(
              contracts.createError(
                "LOTTERY_PREPARATION_BUSY",
                "另一張抽獎券正在準備中，請稍候完成。"
              )
            );
          }

          var promise = performPrepare(ticket, prepareOptions).finally(function () {
            if (activePromise === promise) {
              activePromise = null;
              activeKey = "";
            }
          });
          activeKey = key;
          activePromise = promise;
          return promise;
        }

        function invalidateWorkspace() {
          if (workspaceService && typeof workspaceService.invalidate === "function") {
            workspaceService.invalidate();
          }
        }

        return Object.freeze({
          prepare: prepare,
          invalidateWorkspace: invalidateWorkspace,
          isDefinitiveNoDrawError: contracts.isDefinitiveNoDrawError,
        });
      }

      return Object.freeze({ create: create });
    }
  );
})(window);
