(function (root) {
  "use strict";

  var MODULE_SOURCES = [
    "../shared/module-registry.js",
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
    "member-lottery-v2.js",
  ];
  var REQUEST_STORAGE_PREFIX = "persona-member-lottery-round-request:";
  var configuredOptions = null;
  var realFacade = null;
  var loadPromise = null;
  var facade = null;
  var openVersion = 0;

  function createLoaderError(code, message) {
    var error = new Error(message);
    error.code = code;
    return error;
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
      script.async = false;
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

  function showLoaderPreparing(ticket) {
    var documentValue = root.document;
    if (!documentValue || typeof documentValue.getElementById !== "function") {
      return;
    }
    var dialog = documentValue.getElementById("member-lottery-dialog");
    var loading = documentValue.getElementById("member-lottery-loading-state");
    var errorState = documentValue.getElementById("member-lottery-error-state");
    var wheel = documentValue.getElementById("member-lottery-wheel-state");
    var result = documentValue.getElementById("member-lottery-result-state");
    var title = documentValue.getElementById("member-lottery-loading-title");
    var message = documentValue.getElementById("member-lottery-loading-message");
    var description = documentValue.getElementById(
      "member-lottery-dialog-description"
    );
    var status = documentValue.getElementById("member-lottery-spin-status");
    if (!dialog || !loading) return;

    [errorState, wheel, result].forEach(function (section) {
      if (section) section.hidden = true;
    });
    loading.hidden = false;
    if (title) title.textContent = "正在載入轉盤元件";
    if (message) {
      message.textContent =
        "先載入本次需要的轉盤程式；此階段不會使用抽獎券，也不會產生開獎結果。";
    }
    if (description) {
      description.textContent = "正在載入抽獎轉盤元件，尚未正式開獎。";
    }
    if (status) status.textContent = "正在載入轉盤元件…";
    dialog.setAttribute("aria-busy", "true");
    dialog.removeAttribute("hidden");
    if (!isDialogOpen(dialog)) {
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

    if (ticket) {
      var detail = documentValue.getElementById("member-lottery-ticket-detail");
      if (
        detail &&
        Number.isSafeInteger(Number(ticket.cardNumber)) &&
        Number.isSafeInteger(Number(ticket.milestonePoints))
      ) {
        detail.textContent =
          "第 " +
          Number(ticket.cardNumber) +
          " 張集點卡 · " +
          Number(ticket.milestonePoints) +
          " 點節點抽獎券";
      }
    }
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
      message || "抽獎元件暫時載入失敗；目前票券資料仍保留，請確認網路後再試。";
    status.dataset.tone = "warning";
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
      typeof candidate.configure !== "function"
    ) {
      throw createLoaderError(
        "CLIENT_LIBRARY_ERROR",
        "抽獎元件載入後沒有建立控制器，請重新整理後再試。"
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

    var promise = MODULE_SOURCES.reduce(function (chain, source) {
      return chain.then(function () {
        return loadScript(source);
      });
    }, Promise.resolve())
      .then(configureRealFacade)
      .catch(function (error) {
        loadPromise = null;
        root.MemberLotteryDialog = facade;
        throw error;
      });
    loadPromise = promise;
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
        "正在載入抽獎元件並背景同步；目前票券仍可直接選擇。";
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
    showLoaderPreparing(ticket);
    return ensureLoaded()
      .then(function (controller) {
        if (expectedOpenVersion !== openVersion) return false;
        var documentValue = root.document;
        var dialog =
          documentValue && typeof documentValue.getElementById === "function"
            ? documentValue.getElementById("member-lottery-dialog")
            : null;
        if (dialog && !isDialogOpen(dialog)) return false;
        return controller.open(ticket);
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
    if (realFacade) return realFacade.requestClose(options);
    openVersion += 1;
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
    open: open,
    refreshTickets: refreshTickets,
    restorePending: restorePending,
    hasPending: hasPending,
    canClose: canClose,
    requestClose: requestClose,
  });

  root.MemberLotteryDialog = facade;
})(window);
