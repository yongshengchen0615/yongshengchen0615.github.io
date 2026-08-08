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
  var configuredOptions = null;
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
      // Diagnostics must never affect runtime activation.
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
      "正在準備轉盤：同步最新抽獎設定、確認票券並建立轉盤；完成後才會開啟。";
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
      message || "轉盤準備失敗；目前票券資料仍保留，請確認網路後再試。";
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

  function prewarm() {
    if (realFacade || loadPromise) {
      return ensureLoaded().then(
        function () {
          return true;
        },
        function () {
          return false;
        }
      );
    }
    if (prewarmPromise) return prewarmPromise;

    var scheduledAt = performanceNow();
    var promise = new Promise(function (resolve) {
      function startPrewarm(deadline) {
        var schedulingSource =
          deadline && typeof deadline.timeRemaining === "function" ? "idle" : "task";
        emitMetric("lottery_runtime_prewarm_wait", scheduledAt, schedulingSource);
        ensureLoaded().then(
          function () {
            resolve(true);
          },
          function () {
            // Background prewarm is opportunistic. User-initiated preparation
            // will surface an actionable error if the runtime is unavailable.
            resolve(false);
          }
        );
      }

      if (typeof root.requestIdleCallback === "function") {
        root.requestIdleCallback(startPrewarm, { timeout: 1200 });
        return;
      }
      if (typeof root.setTimeout === "function") {
        root.setTimeout(startPrewarm, 0);
        return;
      }
      Promise.resolve().then(startPrewarm);
    }).finally(function () {
      if (prewarmPromise === promise) prewarmPromise = null;
    });
    prewarmPromise = promise;
    return promise;
  }

  function getPendingStorageKey() {
    if (!configuredOptions) return "";
    var liffId = String(configuredOptions.liffId || "unknown").trim() || "unknown";
    var isDemo = false;
    try {
      isDemo =
        typeof configuredOptions.isDemo === "function" &&
        configuredOptions.isDemo() === true;
    } catch (_error) {
      isDemo = false;
    }
    if (isDemo) return REQUEST_STORAGE_PREFIX + liffId + ":demo";

    var memberId = "";
    try {
      memberId =
        typeof configuredOptions.getMemberId === "function"
          ? String(configuredOptions.getMemberId() || "").trim()
          : "";
    } catch (_error) {
      memberId = "";
    }
    return /^MBR-[A-Z0-9]{10}$/.test(memberId)
      ? REQUEST_STORAGE_PREFIX + liffId + ":" + memberId
      : "";
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
      if (realFacade) return;
      var documentValue = root.document;
      if (!documentValue || typeof documentValue.getElementById !== "function") {
        return;
      }
      var dialog = documentValue.getElementById("member-ticket-dialog");
      var status = documentValue.getElementById("member-ticket-refresh-status");
      if (!dialog || !status || !isDialogOpen(dialog)) return;
      dialog.setAttribute("aria-busy", "true");
      status.textContent =
        "正在載入抽獎元件並背景同步；選擇票券後會先完成準備，再開啟轉盤。";
      status.dataset.tone = "loading";
    }, 0);
  }

  function configure(options) {
    configuredOptions = options && typeof options === "object" ? options : {};
    if (realFacade) realFacade.configure(configuredOptions);
    return facade;
  }

  function open(ticket) {
    var expectedOpenVersion = ++openVersion;
    var preparationDialogShown = showTicketPreparing();

    return ensureLoaded()
      .then(function (controller) {
        if (expectedOpenVersion !== openVersion) return false;
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

        // controller.open() is deliberately local-only. Runtime, authoritative
        // workspace/config, ticket validation, and Canvas preparation are all
        // complete before the Lottery dialog is allowed to appear.
        return realFacade.open(ticket);
      })
      .catch(function (error) {
        if (expectedOpenVersion === openVersion) showLoaderError(error);
        return false;
      });
  }

  function refreshTickets(options) {
    var snapshot =
      configuredOptions &&
      typeof configuredOptions.getCurrentCardSummary === "function"
        ? configuredOptions.getCurrentCardSummary()
        : null;
    scheduleTicketLoadingCopy();
    ensureLoaded()
      .then(function (controller) {
        return controller.refreshTickets(options);
      })
      .catch(function (error) {
        showLoaderError(error);
      });
    return Promise.resolve(snapshot);
  }

  function restorePending() {
    return ensureLoaded()
      .then(function (controller) {
        return controller.restorePending();
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
    open: open,
    refreshTickets: refreshTickets,
    restorePending: restorePending,
    hasPending: hasPending,
    canClose: canClose,
    requestClose: requestClose,
  });

  root.MemberLotteryDialog = facade;
})(window);
