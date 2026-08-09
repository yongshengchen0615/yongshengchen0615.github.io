(function (root) {
  "use strict";

  var REGISTRY_SOURCE = "../shared/module-registry.js";
  var WHEEL_SOURCE = "../shared/lottery-wheel.js";
  var RUNTIME_SOURCES = [
    "lottery/contracts.js",
    "lottery/pending-request-store.js",
    "lottery/workspace-service.js",
    "lottery/preparation-service.js",
    "lottery/draw-service.js",
    "lottery/workspace-mapper.js",
    "lottery/wheel-animator.js",
    "lottery/dialog-view.js",
    "lottery/demo-provider.js",
    "lottery/dialog-controller.js",
  ];
  var ENTRY_SOURCE = "member-lottery-v2.js";
  var REQUEST_STORAGE_PREFIX = "persona-member-lottery-round-request:";
  var MEMBER_ID_PATTERN = /^MBR-[A-Z0-9]{10}$/;

  var configuredOptions = null;
  var rawRequest = null;
  var sessionConfigResponse = null;
  var sessionConfigPromise = null;
  var sessionMemberId = "";
  var sessionPrepared = false;
  var authenticatedPreloadObserver = null;
  var realFacade = null;
  var loadPromise = null;
  var prewarmPromise = null;
  var facade = null;
  var openVersion = 0;

  function createLoaderError(code, message) {
    var error = new Error(message);
    error.code = code;
    return error;
  }

  function performanceNow() {
    return root.performance && typeof root.performance.now === "function"
      ? root.performance.now()
      : Date.now();
  }

  function emitMetric(phase, startedAt, source) {
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
            source: source,
          }),
        })
      );
    } catch (_error) {
      // Diagnostics must never affect Lottery behavior.
    }
  }

  function isDialogOpen(dialog) {
    return Boolean(
      dialog &&
        (dialog.open === true ||
          (typeof dialog.hasAttribute === "function" && dialog.hasAttribute("open")))
    );
  }

  function loadScript(source) {
    return new Promise(function (resolve, reject) {
      var documentValue = root.document;
      if (!documentValue || typeof documentValue.createElement !== "function") {
        reject(
          createLoaderError(
            "CLIENT_LIBRARY_ERROR",
            "目前無法載入抽獎元件，請重新整理後再試。"
          )
        );
        return;
      }

      var selector =
        'script[data-lottery-module="' + source.replace(/"/g, "") + '"]';
      var existing =
        typeof documentValue.querySelector === "function"
          ? documentValue.querySelector(selector)
          : null;
      if (existing && existing.dataset && existing.dataset.loaded === "true") {
        resolve();
        return;
      }
      if (existing && typeof existing.addEventListener === "function") {
        existing.addEventListener("load", resolve, { once: true });
        existing.addEventListener(
          "error",
          function () {
            reject(
              createLoaderError(
                "CLIENT_LIBRARY_ERROR",
                "抽獎元件載入失敗，請確認網路後再試。"
              )
            );
          },
          { once: true }
        );
        return;
      }

      var script = documentValue.createElement("script");
      script.src = source;
      script.async = true;
      script.dataset.lotteryModule = source;
      script.addEventListener(
        "load",
        function () {
          script.dataset.loaded = "true";
          resolve();
        },
        { once: true }
      );
      script.addEventListener(
        "error",
        function () {
          if (script.parentNode) script.parentNode.removeChild(script);
          reject(
            createLoaderError(
              "CLIENT_LIBRARY_ERROR",
              "抽獎元件載入失敗，請確認網路後再試。"
            )
          );
        },
        { once: true }
      );
      (documentValue.head || documentValue.documentElement).appendChild(script);
    });
  }

  function normalizeLoaderError(error) {
    if (
      configuredOptions &&
      typeof configuredOptions.normalizeError === "function"
    ) {
      try {
        return configuredOptions.normalizeError(error);
      } catch (_error) {
        // Fall through to the public-safe loader error below.
      }
    }
    return {
      code: String(
        (error && (error.code || error.name)) || "CLIENT_LIBRARY_ERROR"
      ),
      message: String(
        (error && error.message) ||
          "目前無法載入抽獎元件，請確認網路後再試。"
      ),
    };
  }

  function safeIsDemo() {
    try {
      return Boolean(
        configuredOptions &&
          typeof configuredOptions.isDemo === "function" &&
          configuredOptions.isDemo() === true
      );
    } catch (_error) {
      return false;
    }
  }

  function currentMemberId() {
    if (!configuredOptions || typeof configuredOptions.getMemberId !== "function") {
      return "";
    }
    try {
      var memberId = String(configuredOptions.getMemberId() || "").trim();
      return MEMBER_ID_PATTERN.test(memberId) ? memberId : "";
    } catch (_error) {
      return "";
    }
  }

  function currentCardSummary() {
    if (
      !configuredOptions ||
      typeof configuredOptions.getCurrentCardSummary !== "function"
    ) {
      return null;
    }
    try {
      return configuredOptions.getCurrentCardSummary() || null;
    } catch (_error) {
      return null;
    }
  }

  function currentTotalPoints(fallbackValue) {
    if (
      configuredOptions &&
      typeof configuredOptions.getCurrentTotalPoints === "function"
    ) {
      try {
        var value = Number(configuredOptions.getCurrentTotalPoints());
        if (Number.isSafeInteger(value) && value >= 0) return value;
      } catch (_error) {
        // Fall through to the cached authoritative value.
      }
    }
    return fallbackValue;
  }

  function closeLoaderDialog() {
    var documentValue = root.document;
    if (!documentValue || typeof documentValue.getElementById !== "function") {
      return false;
    }
    var dialog = documentValue.getElementById("member-lottery-dialog");
    if (!isDialogOpen(dialog)) return false;
    dialog.setAttribute("aria-busy", "false");
    if (typeof dialog.close === "function" && dialog.open) {
      try {
        dialog.close();
        return true;
      } catch (_error) {
        // Fall back to removing the open attribute below.
      }
    }
    dialog.removeAttribute("open");
    return true;
  }

  function showTicketPreparing() {
    var documentValue = root.document;
    if (!documentValue || typeof documentValue.getElementById !== "function") {
      return false;
    }
    var dialog = documentValue.getElementById("member-ticket-dialog");
    var status = documentValue.getElementById("member-ticket-refresh-status");
    if (!dialog || !status) return false;

    dialog.setAttribute("aria-busy", "true");
    status.textContent =
      "正在確認登入時預先準備的抽獎結果並建立轉盤；進入轉盤後不會再呼叫後端。";
    status.dataset.tone = "loading";
    if (typeof dialog.querySelectorAll === "function") {
      dialog.querySelectorAll(".lottery-ticket-button").forEach(function (button) {
        button.disabled = true;
      });
    }

    if (!isDialogOpen(dialog)) {
      dialog.removeAttribute("hidden");
      if (typeof dialog.showModal === "function") {
        try {
          dialog.showModal();
        } catch (_error) {
          dialog.setAttribute("open", "");
        }
      } else {
        dialog.setAttribute("open", "");
      }
    }
    return true;
  }

  function closeTicketDialogForLottery() {
    var documentValue = root.document;
    if (!documentValue || typeof documentValue.getElementById !== "function") {
      return false;
    }
    var dialog = documentValue.getElementById("member-ticket-dialog");
    if (!isDialogOpen(dialog)) return false;
    dialog.setAttribute("aria-busy", "false");
    if (typeof dialog.close === "function" && dialog.open) {
      try {
        dialog.close();
        return true;
      } catch (_error) {
        // Fall back to removing the open attribute below.
      }
    }
    dialog.removeAttribute("open");
    return true;
  }

  function showTicketLoadWarning(message) {
    var documentValue = root.document;
    if (!documentValue || typeof documentValue.getElementById !== "function") {
      return;
    }
    var dialog = documentValue.getElementById("member-ticket-dialog");
    var status = documentValue.getElementById("member-ticket-refresh-status");
    if (!dialog || !status || !isDialogOpen(dialog)) return;
    dialog.setAttribute("aria-busy", "false");
    status.textContent =
      message || "登入時的抽獎資料尚未載入完成，請重新整理後再試。";
    status.dataset.tone = "warning";
    if (typeof dialog.querySelectorAll === "function") {
      dialog.querySelectorAll(".lottery-ticket-button").forEach(function (button) {
        button.disabled = false;
      });
    }
  }

  function showLoaderError(error) {
    var normalized = normalizeLoaderError(error);
    openVersion += 1;
    var hadLotteryDialog = closeLoaderDialog();
    showTicketLoadWarning(normalized.message);

    if (
      hadLotteryDialog &&
      configuredOptions &&
      typeof configuredOptions.onReturnToTickets === "function"
    ) {
      try {
        configuredOptions.onReturnToTickets();
      } catch (_error) {
        // Host UI failures must never create a draw transaction.
      }
    }
    if (configuredOptions && typeof configuredOptions.showToast === "function") {
      try {
        configuredOptions.showToast(normalized.message, "error");
      } catch (_error) {
        // Loader UI failure must not affect draw persistence.
      }
    }
  }

  function configureRealFacade() {
    var candidate = root.MemberLotteryDialog;
    if (
      !candidate ||
      candidate === facade ||
      typeof candidate.configure !== "function" ||
      typeof candidate.prepareForOpen !== "function" ||
      typeof candidate.open !== "function"
    ) {
      throw createLoaderError(
        "CLIENT_LIBRARY_ERROR",
        "抽獎元件載入後沒有建立完整控制器，請重新整理後再試。"
      );
    }
    if (!configuredOptions) {
      throw createLoaderError("NOT_CONFIGURED", "會員抽獎尚未完成初始化。");
    }
    realFacade = candidate;
    realFacade.configure(configuredOptions);
    root.MemberLotteryDialog = facade;
    return realFacade;
  }

  function ensureLoaded() {
    if (realFacade) return Promise.resolve(realFacade);
    if (loadPromise) return loadPromise;

    var startedAt = performanceNow();
    var wheelPromise = loadScript(WHEEL_SOURCE);
    var definitionsPromise = loadScript(REGISTRY_SOURCE).then(function () {
      return Promise.all(
        RUNTIME_SOURCES.map(function (source) {
          return loadScript(source);
        })
      );
    });
    var promise = Promise.all([wheelPromise, definitionsPromise])
      .then(function () {
        return loadScript(ENTRY_SOURCE);
      })
      .then(configureRealFacade)
      .then(function (controller) {
        emitMetric("lottery_runtime_load", startedAt, "network");
        return controller;
      })
      .catch(function (error) {
        emitMetric("lottery_runtime_load", startedAt, "network-error");
        loadPromise = null;
        root.MemberLotteryDialog = facade;
        throw error;
      });
    loadPromise = promise;
    return promise;
  }

  function getSessionConfigView() {
    if (!sessionConfigResponse) return null;
    if (!safeIsDemo() && sessionMemberId !== currentMemberId()) return null;

    var data = sessionConfigResponse.data || {};
    var cachedTotal = Number(
      data.totalPoints == null ? data.pointBalance : data.totalPoints
    );
    var totalPoints = currentTotalPoints(cachedTotal);
    var hostCard = currentCardSummary();

    return Object.assign({}, sessionConfigResponse, {
      data: Object.assign({}, data, {
        card: hostCard || data.card,
        totalPoints: totalPoints,
      }),
    });
  }

  function updateSessionConfigFromDraw(response) {
    if (
      !sessionConfigResponse ||
      !response ||
      response.ok !== true ||
      !response.data ||
      !response.data.card ||
      !response.data.lotteryType
    ) {
      return response;
    }

    var previous = sessionConfigResponse.data || {};
    var selectedType = response.data.lotteryType;
    var selectedId = String(selectedType.lotteryTypeId || "");
    var previousTypes = Array.isArray(previous.lotteryTypes)
      ? previous.lotteryTypes
      : [];
    var replaced = false;
    var nextTypes = previousTypes.map(function (type) {
      if (String((type && type.lotteryTypeId) || "") !== selectedId) {
        return type;
      }
      replaced = true;
      return selectedType;
    });
    if (!replaced && selectedId) nextTypes.push(selectedType);

    var nextTotal = Number(
      response.data.totalPoints == null
        ? response.data.pointBalance
        : response.data.totalPoints
    );
    if (!Number.isSafeInteger(nextTotal) || nextTotal < 0) {
      nextTotal = Number(
        previous.totalPoints == null ? previous.pointBalance : previous.totalPoints
      );
    }

    sessionConfigResponse = Object.assign({}, sessionConfigResponse, {
      data: Object.assign({}, previous, {
        lotteryTypes: nextTypes,
        card: response.data.card,
        totalPoints: nextTotal,
      }),
    });
    return response;
  }

  function sessionRequest(action, fields, requestId) {
    if (action === "getLotteryConfig") {
      var snapshot = getSessionConfigView();
      if (snapshot) return Promise.resolve(snapshot);
      if (sessionConfigPromise) {
        return sessionConfigPromise.then(function () {
          var nextSnapshot = getSessionConfigView();
          if (nextSnapshot) return nextSnapshot;
          throw createLoaderError(
            "LOTTERY_SESSION_NOT_READY",
            "登入時的抽獎資料尚未載入完成，請重新整理後再試。"
          );
        });
      }
      return Promise.reject(
        createLoaderError(
          "LOTTERY_SESSION_NOT_READY",
          "登入時的抽獎資料尚未載入完成，請重新整理後再試。"
        )
      );
    }
    if (typeof rawRequest !== "function") {
      return Promise.reject(
        createLoaderError("NOT_CONFIGURED", "會員抽獎尚未完成初始化。")
      );
    }
    return Promise.resolve()
      .then(function () {
        return rawRequest(action, fields, requestId);
      })
      .then(function (response) {
        return action === "drawLottery"
          ? updateSessionConfigFromDraw(response)
          : response;
      });
  }

  function loadSessionConfig() {
    if (safeIsDemo()) return Promise.resolve(null);

    var memberId = currentMemberId();
    if (!memberId) {
      return Promise.reject(
        createLoaderError(
          "LOTTERY_MEMBER_NOT_READY",
          "會員登入尚未完成，無法預載抽獎資料。"
        )
      );
    }

    if (sessionConfigResponse && sessionMemberId === memberId) {
      return Promise.resolve(getSessionConfigView());
    }
    if (sessionConfigPromise && sessionMemberId === memberId) {
      return sessionConfigPromise;
    }
    if (typeof rawRequest !== "function") {
      return Promise.reject(
        createLoaderError("NOT_CONFIGURED", "會員抽獎尚未完成初始化。")
      );
    }

    sessionConfigResponse = null;
    sessionConfigPromise = null;
    sessionMemberId = memberId;
    sessionPrepared = false;

    var startedAt = performanceNow();
    var promise = Promise.resolve()
      .then(function () {
        return rawRequest("getLotteryConfig", {}, undefined);
      })
      .then(function (response) {
        if (!response || response.ok !== true || !response.data) {
          throw createLoaderError(
            "INVALID_RESPONSE",
            "登入時取得的抽獎資料格式不完整。"
          );
        }
        if (currentMemberId() !== memberId) {
          throw createLoaderError(
            "LOTTERY_SESSION_CHANGED",
            "會員狀態已變更，請重新載入抽獎資料。"
          );
        }
        sessionConfigResponse = response;
        emitMetric("lottery_session_preload", startedAt, "network");
        return getSessionConfigView();
      })
      .catch(function (error) {
        if (sessionMemberId === memberId) {
          sessionConfigResponse = null;
          sessionPrepared = false;
        }
        emitMetric("lottery_session_preload", startedAt, "network-error");
        throw error;
      })
      .finally(function () {
        if (sessionConfigPromise === promise) sessionConfigPromise = null;
      });
    sessionConfigPromise = promise;
    return promise;
  }

  function preloadSession() {
    if (prewarmPromise) return prewarmPromise;

    if (safeIsDemo()) {
      var demoPromise = ensureLoaded()
        .then(
          function () {
            return true;
          },
          function () {
            return false;
          }
        )
        .finally(function () {
          if (prewarmPromise === demoPromise) prewarmPromise = null;
        });
      prewarmPromise = demoPromise;
      return demoPromise;
    }

    var memberId = currentMemberId();
    if (sessionPrepared && memberId && sessionMemberId === memberId) {
      return Promise.resolve(true);
    }

    var runtimePromise = ensureLoaded();
    var configPromise = loadSessionConfig();
    var promise = Promise.all([runtimePromise, configPromise])
      .then(function (results) {
        var controller = results[0];
        // Scheme B completes server-authoritative predraws inside this refresh.
        // Only after it resolves is the visible ticket flow fully local-ready.
        return controller.refreshTickets({ force: true });
      })
      .then(
        function () {
          if (currentMemberId() !== memberId) {
            sessionPrepared = false;
            return false;
          }
          sessionPrepared = true;
          return true;
        },
        function () {
          sessionPrepared = false;
          return false;
        }
      )
      .finally(function () {
        if (prewarmPromise === promise) prewarmPromise = null;
      });
    prewarmPromise = promise;
    return promise;
  }

  function prewarm() {
    // Existing host fast-path. The authenticated-session observer below is the
    // general login trigger, including members who currently have zero rewards.
    return preloadSession();
  }

  function stopAuthenticatedPreloadObserver() {
    if (!authenticatedPreloadObserver) return;
    try {
      authenticatedPreloadObserver.disconnect();
    } catch (_error) {
      // Observer cleanup is best-effort only.
    }
    authenticatedPreloadObserver = null;
  }

  function tryAuthenticatedSessionPreload() {
    if (safeIsDemo()) {
      stopAuthenticatedPreloadObserver();
      return false;
    }

    var memberId = currentMemberId();
    if (!memberId) return false;

    stopAuthenticatedPreloadObserver();
    preloadSession().catch(function () {
      // preloadSession resolves false for ordinary preload failures; this catch
      // is defensive and must not interrupt the authenticated host UI.
    });
    return true;
  }

  function armAuthenticatedSessionPreload() {
    stopAuthenticatedPreloadObserver();
    if (tryAuthenticatedSessionPreload()) return;

    var documentValue = root.document;
    var target =
      documentValue && (documentValue.body || documentValue.documentElement);
    if (!target || typeof root.MutationObserver !== "function") {
      return;
    }

    authenticatedPreloadObserver = new root.MutationObserver(function () {
      tryAuthenticatedSessionPreload();
    });
    authenticatedPreloadObserver.observe(target, {
      childList: true,
      subtree: true,
      attributes: true,
    });
  }

  function getPendingStorageKey() {
    if (!configuredOptions) return "";
    var liffId = String(configuredOptions.liffId || "unknown").trim() || "unknown";
    if (safeIsDemo()) return REQUEST_STORAGE_PREFIX + liffId + ":demo";

    var memberId = currentMemberId();
    return memberId ? REQUEST_STORAGE_PREFIX + liffId + ":" + memberId : "";
  }

  function hasStoredPending() {
    var storageKey = getPendingStorageKey();
    if (!storageKey || !root.sessionStorage) return false;
    try {
      var raw = root.sessionStorage.getItem(storageKey);
      if (!raw) return false;
      var parsed = JSON.parse(raw);
      return Boolean(
        parsed &&
          /^[a-zA-Z0-9-]{10,80}$/.test(String(parsed.requestId || "")) &&
          /^PCS-[A-Z0-9]{12}:[1-9]\d{0,15}:[1-9]\d{0,3}$/.test(
            String(parsed.cardRoundKey || "")
          ) &&
          /^LTY-[A-Z0-9]{10}$/.test(String(parsed.lotteryTypeId || ""))
      );
    } catch (_error) {
      try {
        root.sessionStorage.removeItem(storageKey);
      } catch (_storageError) {
        // Restricted browsers may block storage.
      }
      return false;
    }
  }

  function scheduleTicketLoadingCopy() {
    if (typeof root.setTimeout !== "function") return;
    root.setTimeout(function () {
      var documentValue = root.document;
      if (!documentValue || typeof documentValue.getElementById !== "function") {
        return;
      }
      var dialog = documentValue.getElementById("member-ticket-dialog");
      var status = documentValue.getElementById("member-ticket-refresh-status");
      if (!dialog || !status || !isDialogOpen(dialog)) return;

      var ready =
        safeIsDemo() ||
        (sessionPrepared &&
          Boolean(sessionMemberId) &&
          sessionMemberId === currentMemberId());
      dialog.setAttribute("aria-busy", ready ? "false" : "true");
      status.textContent = ready
        ? "抽獎結果已於登入時準備完成，可直接選擇票券。"
        : "正在完成登入預抽獎；完成前會保持票券畫面，不會在抽獎途中連線。";
      status.dataset.tone = ready ? "ready" : "loading";
    }, 0);
  }

  function configure(options) {
    var sourceOptions = options && typeof options === "object" ? options : {};
    rawRequest =
      typeof sourceOptions.request === "function" ? sourceOptions.request : null;
    sessionConfigResponse = null;
    sessionConfigPromise = null;
    sessionMemberId = "";
    sessionPrepared = false;
    configuredOptions = Object.assign({}, sourceOptions, {
      request: sessionRequest,
    });
    if (realFacade) realFacade.configure(configuredOptions);
    armAuthenticatedSessionPreload();
    return facade;
  }

  function open(ticket) {
    var expectedOpenVersion = ++openVersion;
    var demo = safeIsDemo();
    var memberReady = demo || Boolean(currentMemberId());

    // The host currently closes the ticket dialog immediately before calling
    // this facade. Re-enter the preparing state synchronously, in the same JS
    // turn, so the browser never paints an empty gap that looks like the LIFF
    // page was closed.
    var preparationDialogShown = memberReady ? showTicketPreparing() : false;

    var sessionReady = demo
      ? ensureLoaded().then(function () {
          return true;
        })
      : sessionPrepared && sessionMemberId === currentMemberId()
        ? Promise.resolve(true)
        : prewarmPromise
          ? prewarmPromise
          : preloadSession();

    return Promise.resolve(sessionReady)
      .then(function (ready) {
        if (!ready || (!demo && !sessionPrepared)) {
          throw createLoaderError(
            "LOTTERY_SESSION_NOT_READY",
            "登入預抽獎尚未完成，請保持頁面開啟後再試。"
          );
        }
        if (expectedOpenVersion !== openVersion) return null;
        return ensureLoaded();
      })
      .then(function (controller) {
        if (!controller || expectedOpenVersion !== openVersion) return false;
        return controller.prepareForOpen(ticket);
      })
      .then(function (prepared) {
        if (!prepared || expectedOpenVersion !== openVersion) return false;

        if (preparationDialogShown) {
          var documentValue = root.document;
          var ticketDialog =
            documentValue && typeof documentValue.getElementById === "function"
              ? documentValue.getElementById("member-ticket-dialog")
              : null;
          if (!isDialogOpen(ticketDialog)) return false;
          closeTicketDialogForLottery();
        }

        return realFacade.open(ticket);
      })
      .catch(function (error) {
        if (expectedOpenVersion === openVersion) showLoaderError(error);
        return false;
      });
  }

  function refreshTickets() {
    scheduleTicketLoadingCopy();
    return Promise.resolve(currentCardSummary());
  }

  function restorePending() {
    var demo = safeIsDemo();
    var sessionReady = demo
      ? ensureLoaded().then(function () {
          return true;
        })
      : sessionPrepared && sessionMemberId === currentMemberId()
        ? Promise.resolve(true)
        : prewarmPromise
          ? prewarmPromise
          : preloadSession();
    return Promise.resolve(sessionReady)
      .then(function (ready) {
        if (!ready || (!demo && !sessionPrepared)) return false;
        return ensureLoaded();
      })
      .then(function (controller) {
        return controller ? controller.restorePending() : false;
      })
      .catch(function (error) {
        showLoaderError(error);
        return false;
      });
  }

  function hasPending() {
    return realFacade ? realFacade.hasPending() : hasStoredPending();
  }

  function canClose() {
    return realFacade ? realFacade.canClose() : true;
  }

  function requestClose(options) {
    openVersion += 1;
    if (realFacade) return realFacade.requestClose(options);
    closeLoaderDialog();
    if (
      options &&
      options.returnToTickets &&
      configuredOptions &&
      typeof configuredOptions.onReturnToTickets === "function"
    ) {
      try {
        configuredOptions.onReturnToTickets();
      } catch (_error) {
        // Host UI failures must never create a draw transaction.
      }
    }
    return true;
  }

  facade = Object.freeze({
    configure: configure,
    ensureLoaded: ensureLoaded,
    prewarm: prewarm,
    preloadSession: preloadSession,
    open: open,
    refreshTickets: refreshTickets,
    restorePending: restorePending,
    hasPending: hasPending,
    canClose: canClose,
    requestClose: requestClose,
  });

  root.MemberLotteryDialog = facade;
})(window);