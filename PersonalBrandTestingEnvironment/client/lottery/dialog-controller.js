(function (root) {
  "use strict";

  var registry = root.PersonaModules;
  if (!registry) return;

  registry.define(
    "lottery.dialog-controller",
    [
      "lottery.contracts",
      "lottery.pending-request-store",
      "lottery.preparation-service",
      "lottery.wheel-draw-guard",
      "lottery.workspace-mapper",
      "lottery.wheel-animator",
      "lottery.dialog-view",
      "lottery.demo-provider",
    ],
    function (
      contracts,
      pendingRequestStoreFactory,
      preparationServiceFactory,
      drawGuardFactory,
      mapper,
      wheelAnimatorFactory,
      dialogViewFactory,
      demoProviderFactory
    ) {
      function create(runtimeOptions) {
        runtimeOptions =
          runtimeOptions && typeof runtimeOptions === "object"
            ? runtimeOptions
            : {};
        var runtime = runtimeOptions.root || root;
        var documentValue = runtimeOptions.document || runtime.document;
        var memberApi = runtimeOptions.memberApi || runtime.MemberApi;
        var wheelRenderer = runtimeOptions.wheelRenderer || runtime.LotteryWheel;

        var options = null;
        var configured = false;
        var store = null;
        var guard = null;
        var preparationService = null;
        var demoProvider = null;
        var workspace = null;
        var selectedTicket = null;
        var selectedType = null;
        var isPreparing = false;
        var isBusy = false;
        var loadVersion = 0;

        function defaultNormalizeError(errorValue) {
          return {
            code: String(
              (errorValue && (errorValue.code || errorValue.name)) ||
                "CONNECTION_ERROR"
            ),
            message: String(
              (errorValue && errorValue.message) ||
                "目前無法載入轉盤，請稍後再試。"
            ),
          };
        }

        function normalizeError(errorValue) {
          var normalized = null;
          try {
            normalized =
              options && typeof options.normalizeError === "function"
                ? options.normalizeError(errorValue)
                : defaultNormalizeError(errorValue);
          } catch (_error) {
            normalized = null;
          }
          normalized =
            normalized && typeof normalized === "object" ? normalized : {};
          return {
            code: String(
              normalized.code ||
                (errorValue && (errorValue.code || errorValue.name)) ||
                "CONNECTION_ERROR"
            ),
            message: String(
              normalized.message ||
                (errorValue && errorValue.message) ||
                "目前無法載入轉盤，請稍後再試。"
            ),
          };
        }

        var view = dialogViewFactory.create({
          root: runtime,
          document: documentValue,
          normalizeError: normalizeError,
        });
        var animator = wheelAnimatorFactory.create({
          root: runtime,
          rotor: view.getRotor(),
          canvas: view.getCanvas(),
          renderer: wheelRenderer,
          setStatus: view.setStatus,
        });

        function safeIsDemo() {
          try {
            return Boolean(options && options.isDemo());
          } catch (_error) {
            return false;
          }
        }

        function safeShowToast(message) {
          try {
            if (options && typeof options.showToast === "function") {
              options.showToast(String(message || ""));
            }
          } catch (_error) {
            // Host UI errors must not change draw persistence.
          }
        }

        function safeCardUpdated(card, totalPoints) {
          try {
            if (options && typeof options.onCardUpdated === "function") {
              options.onCardUpdated(card, totalPoints);
            }
          } catch (error) {
            safeShowToast(normalizeError(error).message);
          }
        }

        function safeReturnToTickets() {
          try {
            if (options && typeof options.onReturnToTickets === "function") {
              options.onReturnToTickets();
            }
          } catch (error) {
            safeShowToast(normalizeError(error).message);
          }
        }

        function delegateAuthorizationError(errorValue) {
          if (!options || typeof options.onAuthorizationError !== "function") {
            return false;
          }
          var normalized = normalizeError(errorValue);
          if (
            normalized.code !== "INVALID_TOKEN" &&
            normalized.code !== "INVALID_ID_TOKEN" &&
            normalized.code !== "MEMBER_ACCESS_DENIED"
          ) {
            return false;
          }
          try {
            view.allowHostClose();
            options.onAuthorizationError(errorValue);
          } catch (error) {
            safeShowToast(normalizeError(error).message);
          }
          return true;
        }

        function ensureConfigured() {
          if (!configured || !options || !store || !guard || !preparationService) {
            throw contracts.createError(
              "NOT_CONFIGURED",
              "請先設定 MemberLotteryDialog。"
            );
          }
        }

        function getPending() {
          return store ? store.read() : null;
        }

        function canClose() {
          if (!configured) return true;
          return !isBusy && !getPending();
        }

        function updateControls() {
          if (!configured) return;
          var pending = getPending();
          var prepared = Boolean(
            pending &&
              selectedTicket &&
              guard.has(selectedTicket, pending.requestId)
          );
          view.updateControls({
            isPreparing: isPreparing,
            isBusy: isBusy,
            pending: Boolean(pending),
            hasTicket: Boolean(selectedTicket),
            canDraw:
              !isPreparing &&
              !isBusy &&
              Boolean(workspace) &&
              Boolean(selectedType) &&
              prepared,
            canClose: canClose(),
          });
        }

        function configure(value) {
          value = value && typeof value === "object" ? value : {};
          if (typeof value.request !== "function") {
            throw contracts.createError(
              "INVALID_CONFIGURATION",
              "MemberLotteryDialog 需要 request(action, fields, requestId)。"
            );
          }
          if (
            !memberApi ||
            typeof memberApi.createRequestId !== "function" ||
            !wheelRenderer ||
            typeof wheelRenderer.draw !== "function"
          ) {
            throw contracts.createError(
              "CLIENT_LIBRARY_ERROR",
              "無法載入會員請求或轉盤繪製元件。"
            );
          }

          options = {
            liffId: String(value.liffId || "unknown").trim() || "unknown",
            request: value.request,
            isDemo:
              typeof value.isDemo === "function"
                ? value.isDemo
                : function () {
                    return false;
                  },
            getCurrentCardSummary:
              typeof value.getCurrentCardSummary === "function"
                ? value.getCurrentCardSummary
                : function () {
                    return null;
                  },
            getCurrentTotalPoints:
              typeof value.getCurrentTotalPoints === "function"
                ? value.getCurrentTotalPoints
                : function () {
                    return 0;
                  },
            getMemberId:
              typeof value.getMemberId === "function"
                ? value.getMemberId
                : function () {
                    return "";
                  },
            onCardUpdated:
              typeof value.onCardUpdated === "function"
                ? value.onCardUpdated
                : function () {},
            onReturnToTickets:
              typeof value.onReturnToTickets === "function"
                ? value.onReturnToTickets
                : function () {},
            onAuthorizationError:
              typeof value.onAuthorizationError === "function"
                ? value.onAuthorizationError
                : null,
            normalizeError:
              typeof value.normalizeError === "function"
                ? value.normalizeError
                : defaultNormalizeError,
            showToast:
              typeof value.showToast === "function"
                ? value.showToast
                : function () {},
          };

          guard = drawGuardFactory.create();
          store = pendingRequestStoreFactory.create({
            liffId: options.liffId,
            storage: runtime.sessionStorage,
            isDemo: options.isDemo,
            getMemberId: options.getMemberId,
            createRequestId: memberApi.createRequestId,
          });
          preparationService = preparationServiceFactory.create({
            request: options.request,
            store: store,
            guard: guard,
            onCardUpdated: options.onCardUpdated,
          });
          demoProvider = demoProviderFactory.create({
            root: runtime,
            getCurrentCardSummary: options.getCurrentCardSummary,
            getCurrentTotalPoints: options.getCurrentTotalPoints,
          });
          workspace = null;
          selectedTicket = null;
          selectedType = null;
          isPreparing = false;
          isBusy = false;
          configured = true;
          updateControls();
          return api;
        }

        function prepareCurrent(expectedVersion, pendingBeforePrepare) {
          var preparePromise = safeIsDemo()
            ? demoProvider.prepare(selectedTicket, store, guard)
            : preparationService.prepare(selectedTicket);

          return Promise.resolve(preparePromise)
            .then(function (response) {
              if (expectedVersion !== loadVersion) return false;
              contracts.assertSuccessfulResponse(response);
              var nextWorkspace = mapper.normalizeWorkspace(response.data);
              var nextSelectedType = mapper.findLotteryType(
                nextWorkspace.lotteryTypes,
                selectedTicket.lotteryTypeId
              );
              var pending = store.read();

              if (!nextSelectedType) {
                throw contracts.createError(
                  "LOTTERY_TYPE_NOT_FOUND",
                  "這張抽獎券指定的轉盤目前無法使用。"
                );
              }
              if (!pending || !guard.has(selectedTicket, pending.requestId)) {
                throw contracts.createError(
                  "LOTTERY_RESULT_NOT_PREPARED",
                  "抽獎結果尚未準備完成，請重新開啟轉盤。"
                );
              }

              workspace = nextWorkspace;
              selectedType = nextSelectedType;
              animator.draw(selectedType.lottery.prizes);
              animator.reset();
              isPreparing = false;
              view.markReady(
                selectedTicket,
                selectedType,
                Boolean(pendingBeforePrepare)
              );
              safeCardUpdated(workspace.card, workspace.totalPoints);
              updateControls();
              return true;
            })
            .catch(function (error) {
              if (expectedVersion !== loadVersion) return false;
              isPreparing = false;
              animator.stop();
              if (delegateAuthorizationError(error)) {
                updateControls();
                return false;
              }
              view.showError(error);
              updateControls();
              return false;
            });
        }

        function open(ticketValue) {
          ensureConfigured();
          var expectedVersion = ++loadVersion;
          var pendingBeforePrepare = store.read();

          try {
            var requestedTicket = contracts.normalizeTicket(ticketValue);
            if (pendingBeforePrepare) {
              selectedTicket = contracts.normalizeTicket(pendingBeforePrepare);
              if (
                selectedTicket.cardRoundKey !== requestedTicket.cardRoundKey ||
                selectedTicket.lotteryTypeId !== requestedTicket.lotteryTypeId
              ) {
                safeShowToast("請先完成上一次尚未確認的抽獎。");
              }
            } else {
              selectedTicket = requestedTicket;
            }
          } catch (error) {
            selectedTicket = null;
            workspace = null;
            selectedType = null;
            isPreparing = false;
            view.markPreparing(null, "準備轉盤");
            view.showError(error);
            updateControls();
            return Promise.resolve(false);
          }

          workspace = null;
          selectedType = null;
          isPreparing = true;
          isBusy = false;
          animator.reset();
          view.markPreparing(selectedTicket, "準備轉盤");
          updateControls();
          return prepareCurrent(expectedVersion, pendingBeforePrepare);
        }

        function restorePending() {
          ensureConfigured();
          var pending = store.read();
          if (!pending) return Promise.resolve(false);
          return open(pending);
        }

        function hasPending() {
          return configured ? Boolean(store.read()) : false;
        }

        function handleSpin() {
          if (
            isBusy ||
            isPreparing ||
            !workspace ||
            !selectedTicket ||
            !selectedType
          ) {
            return;
          }
          var pending = store.read();
          if (!pending || !guard.has(selectedTicket, pending.requestId)) {
            view.setStatus("抽獎結果尚未準備完成，請重新開啟轉盤。");
            updateControls();
            return;
          }

          isBusy = true;
          view.setStatus("轉盤已開始，正在揭曉預先確認的抽獎結果…");
          animator.startWaiting(function () {
            return isBusy;
          });
          updateControls();

          Promise.resolve()
            .then(function () {
              return preparationService.resolvePrepared(
                selectedTicket,
                pending.requestId
              );
            })
            .then(function (response) {
              contracts.assertSuccessfulResponse(response);
              var result = mapper.normalizeDrawResult(
                response.data,
                workspace,
                selectedTicket
              );
              animator.draw(result.selectedType.lottery.prizes);
              return animator
                .settle(result.draw, result.selectedType.lottery)
                .then(function () {
                  return result;
                });
            })
            .then(function (result) {
              store.clear();
              guard.clear();
              workspace = Object.freeze({
                lotteryTypes: result.lotteryTypes,
                card: result.card,
                totalPoints: result.totalPoints,
              });
              selectedType = result.selectedType;
              isBusy = false;
              safeCardUpdated(result.card, result.totalPoints);
              view.showResult(result.draw, result.selectedType);
              updateControls();
            })
            .catch(function (error) {
              isBusy = false;
              animator.stop();
              if (delegateAuthorizationError(error)) {
                view.setStatus("正在更新會員登入狀態…");
                updateControls();
                return;
              }
              if (preparationService.isDefinitiveNoDrawError(error)) {
                store.clear();
                guard.clear();
                view.showError(error);
                updateControls();
                return;
              }
              view.setStatus(
                "尚未確認結果；請重新開啟轉盤並安全重試，不會重複使用抽獎券。"
              );
              safeShowToast(normalizeError(error).message);
              updateControls();
            });
        }

        function retry() {
          if (!selectedTicket || isPreparing || isBusy) return;
          var expectedVersion = ++loadVersion;
          var pendingBeforePrepare = store.read();
          workspace = null;
          selectedType = null;
          isPreparing = true;
          animator.reset();
          view.markPreparing(selectedTicket, "準備轉盤");
          updateControls();
          prepareCurrent(expectedVersion, pendingBeforePrepare);
        }

        function requestClose(closeOptions) {
          ensureConfigured();
          closeOptions =
            closeOptions && typeof closeOptions === "object" ? closeOptions : {};
          if (!canClose()) {
            safeShowToast("抽獎結果尚未確認，請先完成本次抽獎。");
            return false;
          }

          loadVersion += 1;
          isPreparing = false;
          isBusy = false;
          animator.stop();
          view.close();
          workspace = null;
          selectedTicket = null;
          selectedType = null;
          view.setStatus("");
          updateControls();

          if (closeOptions.returnToTickets) safeReturnToTickets();
          return true;
        }

        view.bind({
          onSpin: handleSpin,
          onRetry: retry,
          onClose: requestClose,
          canClose: canClose,
          onBlockedClose: function () {
            safeShowToast("抽獎結果尚未確認，請先完成本次抽獎。");
          },
        });

        var api = Object.freeze({
          configure: configure,
          open: open,
          restorePending: restorePending,
          hasPending: hasPending,
          canClose: canClose,
          requestClose: requestClose,
        });
        return api;
      }

      return Object.freeze({ create: create });
    }
  );
})(window);
