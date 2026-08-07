(function (root) {
  "use strict";

  var registry = root.PersonaModules;
  if (!registry) return;

  registry.define(
    "lottery.dialog-controller",
    [
      "lottery.contracts",
      "lottery.pending-request-store",
      "lottery.workspace-service",
      "lottery.preparation-service",
      "lottery.draw-service",
      "lottery.workspace-mapper",
      "lottery.wheel-animator",
      "lottery.dialog-view",
      "lottery.demo-provider",
    ],
    function (
      contracts,
      pendingRequestStoreFactory,
      workspaceServiceFactory,
      preparationServiceFactory,
      drawServiceFactory,
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
        var workspaceService = null;
        var preparationService = null;
        var drawService = null;
        var demoProvider = null;
        var workspace = null;
        var selectedTicket = null;
        var selectedType = null;
        var isPreparing = false;
        var isBusy = false;
        var loadVersion = 0;
        var activeOpenKey = "";
        var activeOpenPromise = null;
        var activeTicketRefresh = null;

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
            // Host UI errors must never alter draw persistence.
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

        function syncLatestWorkspaceSnapshot() {
          if (!workspaceService || typeof workspaceService.peek !== "function") {
            return;
          }
          var response = workspaceService.peek();
          if (!response || !response.data) return;
          try {
            var latestWorkspace = mapper.normalizeWorkspace(response.data);
            safeCardUpdated(latestWorkspace.card, latestWorkspace.totalPoints);
          } catch (_error) {
            // A failed snapshot refresh must not replace the original preparation error.
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
          if (
            !configured ||
            !options ||
            !store ||
            !workspaceService ||
            !preparationService ||
            !drawService
          ) {
            throw contracts.createError(
              "NOT_CONFIGURED",
              "請先設定 MemberLotteryDialog。"
            );
          }
        }

        function ticketKey(ticket) {
          return ticket
            ? ticket.cardRoundKey + "|" + ticket.lotteryTypeId
            : "";
        }

        function getPending() {
          return store ? store.read() : null;
        }

        function canClose() {
          if (!configured) return true;
          return !isPreparing && !isBusy && !getPending();
        }

        function updateControls() {
          if (!configured) return;
          var pending = getPending();
          view.updateControls({
            isPreparing: isPreparing,
            isBusy: isBusy,
            pending: Boolean(pending),
            hasTicket: Boolean(selectedTicket),
            canDraw:
              !isPreparing &&
              !isBusy &&
              Boolean(workspace) &&
              Boolean(selectedType),
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

          store = pendingRequestStoreFactory.create({
            liffId: options.liffId,
            storage: runtime.sessionStorage,
            isDemo: options.isDemo,
            getMemberId: options.getMemberId,
            createRequestId: memberApi.createRequestId,
          });
          workspaceService = workspaceServiceFactory.create({
            request: options.request,
            ttlMs: 5000,
            maxStaleMs: 30000,
          });
          preparationService = preparationServiceFactory.create({
            request: options.request,
            workspaceService: workspaceService,
            selectionMaxAgeMs: 2000,
          });
          drawService = drawServiceFactory.create({
            request: options.request,
            store: store,
            workspaceService: workspaceService,
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
          activeOpenKey = "";
          activeOpenPromise = null;
          activeTicketRefresh = null;
          configured = true;
          updateControls();
          return api;
        }

        function prepareCurrent(expectedVersion, pendingBeforePrepare) {
          var preparePromise = safeIsDemo()
            ? demoProvider.prepare(selectedTicket)
            : preparationService.prepare(selectedTicket, {
                allowPendingTicket: Boolean(pendingBeforePrepare),
              });

          return Promise.resolve(preparePromise)
            .then(function (response) {
              if (expectedVersion !== loadVersion) return false;
              contracts.assertSuccessfulResponse(response);
              var nextWorkspace = mapper.normalizeWorkspace(response.data);
              var nextSelectedType = mapper.findLotteryType(
                nextWorkspace.lotteryTypes,
                selectedTicket.lotteryTypeId
              );
              if (!nextSelectedType) {
                throw contracts.createError(
                  "LOTTERY_TYPE_NOT_FOUND",
                  "這張抽獎券指定的轉盤目前無法使用。"
                );
              }

              workspace = nextWorkspace;
              selectedType = nextSelectedType;
              animator.prepare(selectedType.lottery);
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
              var definitive = preparationService.isDefinitiveNoDrawError(error);
              if (definitive) syncLatestWorkspaceSnapshot();
              view.showError(error, {
                pending: Boolean(getPending()),
                definitive: definitive,
              });
              updateControls();
              return false;
            });
        }

        function open(ticketValue) {
          ensureConfigured();
          var pendingBeforePrepare = store.read();
          var requestedTicket;
          var nextTicket;

          try {
            requestedTicket = contracts.normalizeTicket(ticketValue);
            if (pendingBeforePrepare) {
              nextTicket = contracts.normalizeTicket(pendingBeforePrepare);
              if (ticketKey(nextTicket) !== ticketKey(requestedTicket)) {
                safeShowToast("請先完成上一次尚未確認的抽獎。");
              }
            } else {
              nextTicket = requestedTicket;
            }
          } catch (error) {
            selectedTicket = null;
            workspace = null;
            selectedType = null;
            isPreparing = false;
            view.markPreparing(null, "準備轉盤");
            view.showError(error, { pending: false, definitive: true });
            updateControls();
            return Promise.resolve(false);
          }

          var key = ticketKey(nextTicket);
          if (isBusy) {
            safeShowToast("轉盤正在處理抽獎，請稍候完成。");
            return Promise.resolve(false);
          }
          if (isPreparing && activeOpenPromise) {
            if (activeOpenKey === key) return activeOpenPromise;
            safeShowToast("另一張抽獎券正在準備中，請稍候完成。");
            return Promise.resolve(false);
          }

          selectedTicket = nextTicket;
          var expectedVersion = ++loadVersion;
          workspace = null;
          selectedType = null;
          isPreparing = true;
          isBusy = false;
          animator.reset();
          view.markPreparing(selectedTicket, "準備轉盤");
          updateControls();

          var promise = prepareCurrent(expectedVersion, pendingBeforePrepare).finally(
            function () {
              if (activeOpenPromise === promise) {
                activeOpenPromise = null;
                activeOpenKey = "";
              }
            }
          );
          activeOpenKey = key;
          activeOpenPromise = promise;
          return promise;
        }

        function refreshTickets(refreshOptions) {
          ensureConfigured();
          refreshOptions =
            refreshOptions && typeof refreshOptions === "object"
              ? refreshOptions
              : {};
          if (safeIsDemo()) {
            return Promise.resolve(options.getCurrentCardSummary());
          }
          if (activeTicketRefresh) return activeTicketRefresh;

          var promise = workspaceService
            .load({ force: refreshOptions.force !== false })
            .then(function (response) {
              var nextWorkspace = mapper.normalizeWorkspace(response.data);
              safeCardUpdated(nextWorkspace.card, nextWorkspace.totalPoints);
              return nextWorkspace.card;
            })
            .finally(function () {
              if (activeTicketRefresh === promise) activeTicketRefresh = null;
            });
          activeTicketRefresh = promise;
          return promise;
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

        function performDraw() {
          return safeIsDemo()
            ? demoProvider.draw(selectedTicket, workspace, store)
            : drawService.draw(selectedTicket);
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

          var pendingBeforeDraw = getPending();
          var preparedConfigVersion = selectedType.lottery.configVersion;
          isBusy = true;
          view.setStatus(
            pendingBeforeDraw
              ? "正在使用同一次請求安全重試，不會重複使用抽獎券…"
              : "正在向後端確認本次抽獎結果…"
          );
          updateControls();

          Promise.resolve()
            .then(performDraw)
            .then(function (response) {
              contracts.assertSuccessfulResponse(response);
              var result = mapper.normalizeDrawResult(
                response.data,
                workspace,
                selectedTicket
              );
              if (result.selectedType.lottery.configVersion !== preparedConfigVersion) {
                view.setStatus("獎項設定已更新，正在使用本次開獎的最新版本…");
              }
              return animator
                .settle(result.draw, result.selectedType.lottery)
                .then(function () {
                  return result;
                });
            })
            .then(function (result) {
              drawService.complete();
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
              var definitive = drawService.isDefinitiveNoDrawError(error);
              if (definitive) drawService.clear();
              view.showError(error, {
                pending: Boolean(getPending()),
                definitive: definitive,
              });
              updateControls();
            });
        }

        function retry() {
          if (!selectedTicket || isPreparing || isBusy) return;
          if (getPending() && workspace && selectedType) {
            view.markReady(selectedTicket, selectedType, true);
            updateControls();
            handleSpin();
            return;
          }
          open(selectedTicket);
        }

        function requestClose(closeOptions) {
          ensureConfigured();
          closeOptions =
            closeOptions && typeof closeOptions === "object" ? closeOptions : {};
          if (!canClose()) {
            safeShowToast(
              isPreparing
                ? "轉盤正在準備中，完成前請勿關閉。"
                : isBusy
                  ? "抽獎正在處理中，請稍候完成。"
                  : "抽獎請求尚未確認，請先安全重試完成本次抽獎。"
            );
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
            safeShowToast(
              isPreparing
                ? "轉盤正在準備中，完成前請勿關閉。"
                : isBusy
                  ? "抽獎正在處理中，請稍候完成。"
                  : "抽獎請求尚未確認，請先安全重試完成本次抽獎。"
            );
          },
        });

        var api = Object.freeze({
          configure: configure,
          open: open,
          refreshTickets: refreshTickets,
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
