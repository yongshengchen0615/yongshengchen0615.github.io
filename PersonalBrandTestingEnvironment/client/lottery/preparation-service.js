(function (root) {
  "use strict";

  var registry = root.PersonaModules;
  if (!registry) return;

  registry.define(
    "lottery.preparation-service",
    ["lottery.contracts"],
    function (contracts) {
      function create(options) {
        options = options && typeof options === "object" ? options : {};

        if (
          typeof options.request !== "function" ||
          !options.store ||
          !options.guard
        ) {
          throw contracts.createError(
            "INVALID_CONFIGURATION",
            "PreparationService 缺少 request、store 或 guard。"
          );
        }

        var workspaceService =
          options.workspaceService &&
          typeof options.workspaceService.load === "function"
            ? options.workspaceService
            : {
                load: function () {
                  return Promise.resolve(
                    options.request("getLotteryConfig", {}, undefined)
                  ).then(contracts.assertSuccessfulResponse);
                },
                prime: function (response) {
                  return response;
                },
                invalidate: function () {},
              };
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
            // Diagnostics must never change draw persistence.
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

        function safeCardUpdated(card, totalPoints) {
          if (typeof options.onCardUpdated !== "function") return;
          try {
            options.onCardUpdated(card, totalPoints);
          } catch (_error) {
            // Host rendering failures must not affect draw persistence.
          }
        }

        function validateWorkspace(response, ticket, pending) {
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
              String(type.lotteryTypeId || "") === ticket.lotteryTypeId
            );
          });

          if (!selectedType || !selectedType.lottery) {
            throw contracts.createError(
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
              throw contracts.createError(
                "LOTTERY_ROUND_NOT_READY",
                "這張抽獎券已使用、已過期或目前無法使用。"
              );
            }
          }

          return response;
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
            String(data.lotteryType.lotteryTypeId || "") !==
              ticket.lotteryTypeId
          ) {
            throw contracts.createError(
              "INVALID_RESPONSE",
              "後台回傳的抽獎結果格式不完整或不一致。"
            );
          }

          return response;
        }

        function mergeAuthoritativeLottery(workspaceResponse, drawResponse, ticket) {
          var workspaceData = workspaceResponse.data;
          var drawData = drawResponse.data;
          var previousType = workspaceData.lotteryTypes.find(function (type) {
            return (
              type &&
              String(type.lotteryTypeId || "") === ticket.lotteryTypeId
            );
          });
          var authoritativeType = Object.assign({}, drawData.lotteryType, {
            lottery: drawData.lottery,
          });
          var nextTypes = workspaceData.lotteryTypes.map(function (type) {
            return String(type && type.lotteryTypeId) === ticket.lotteryTypeId
              ? authoritativeType
              : type;
          });
          var previousVersion = String(
            previousType && previousType.lottery
              ? previousType.lottery.configVersion || ""
              : ""
          );
          var nextVersion = String(drawData.lottery.configVersion || "");
          var mergedResponse = Object.assign({}, workspaceResponse, {
            data: Object.assign({}, workspaceData, {
              lotteryTypes: nextTypes,
            }),
          });

          workspaceService.prime(mergedResponse);
          return Object.freeze({
            workspaceResponse: mergedResponse,
            configurationUpdated:
              Boolean(previousVersion && nextVersion) &&
              previousVersion !== nextVersion,
          });
        }

        function refreshHostCard() {
          workspaceService.invalidate();
          return workspaceService
            .load({ force: true })
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
              // The original definitive error remains the primary error.
            });
        }

        function performPrepare(ticket) {
          var totalStartedAt = performanceNow();
          var pendingBeforeConfig = options.store.read();
          var workspaceResponse;
          var request;

          emitPhase("validating_ticket");
          var workspaceStartedAt = performanceNow();
          return workspaceService
            .load({ allowStale: true })
            .then(function (response) {
              emitMetric("workspace_validation", workspaceStartedAt);
              workspaceResponse = validateWorkspace(
                response,
                ticket,
                pendingBeforeConfig
              );
              request = options.store.ensure(ticket);
              emitPhase("persisting_draw");
              var drawStartedAt = performanceNow();
              return options.request(
                "drawLottery",
                {
                  lotteryTypeId: ticket.lotteryTypeId,
                  cardRoundKey: ticket.cardRoundKey,
                },
                request.requestId
              ).then(function (response) {
                emitMetric("draw_lottery", drawStartedAt);
                return response;
              });
            })
            .then(function (response) {
              var validated = validateDrawResponse(response, ticket);
              options.guard.save(ticket, request, validated);
              emitPhase("rendering_wheel");
              var merged = mergeAuthoritativeLottery(
                workspaceResponse,
                validated,
                ticket
              );
              emitMetric("preparation_service", totalStartedAt);
              return merged;
            })
            .catch(function (error) {
              emitMetric("preparation_service", totalStartedAt);
              if (!contracts.isDefinitiveNoDrawError(error)) throw error;

              options.store.clear();
              options.guard.clear();
              return refreshHostCard().then(function () {
                throw error;
              });
            });
        }

        function prepare(ticketValue) {
          var ticket = options.store.normalizeTicket
            ? options.store.normalizeTicket(ticketValue)
            : contracts.normalizeTicket(ticketValue);
          var key = ticketKey(ticket);

          if (activePromise) {
            if (activeKey === key) return activePromise;
            return Promise.reject(
              contracts.createError(
                "LOTTERY_PREPARATION_BUSY",
                "另一張抽獎券正在準備中，請稍候完成。"
              )
            );
          }

          var promise = performPrepare(ticket).finally(function () {
            if (activePromise === promise) {
              activePromise = null;
              activeKey = "";
            }
          });
          activeKey = key;
          activePromise = promise;
          return promise;
        }

        function resolvePrepared(ticketValue, requestId) {
          var ticket = options.store.normalizeTicket
            ? options.store.normalizeTicket(ticketValue)
            : contracts.normalizeTicket(ticketValue);
          return options.guard.resolve(ticket, requestId);
        }

        function invalidateWorkspace() {
          workspaceService.invalidate();
        }

        return Object.freeze({
          prepare: prepare,
          resolvePrepared: resolvePrepared,
          invalidateWorkspace: invalidateWorkspace,
          isDefinitiveNoDrawError: contracts.isDefinitiveNoDrawError,
        });
      }

      return Object.freeze({ create: create });
    }
  );
})(window);
