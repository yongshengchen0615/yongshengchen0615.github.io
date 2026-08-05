(function (global) {
  "use strict";

  var originalDialog = global.MemberLotteryDialog;
  var modules = global.MemberLotteryPreparation;
  var options = null;
  var request = null;
  var service = null;
  var view = null;
  var wheelDrawGuard = null;
  var interactionsBound = false;
  var opening = false;
  var openVersion = 0;
  var REQUEST_STORAGE_PREFIX =
    "persona-member-lottery-round-request:";

  if (
    !originalDialog ||
    typeof originalDialog.configure !== "function"
  ) {
    return;
  }

  function configure(value) {
    value = value && typeof value === "object" ? value : {};
    request = value.request;
    if (typeof request !== "function") {
      return originalDialog.configure(value);
    }

    assertDependencies();
    options = value;

    var store = modules.createPendingRequestStore({
      storage: getSessionStorage(),
      getStorageKey: getStorageKey,
      createRequestId: function () {
        return global.MemberApi.createRequestId();
      },
      normalizeTicket: normalizeTicket,
    });

    service = modules.createPreparationService({
      request: request,
      store: store,
      normalizeTicket: normalizeTicket,
      isDefinitiveError: isDefinitiveNoDrawError,
    });

    view = modules.createPreparationView({
      document: global.document,
      showToast: safeToast,
    });

    wheelDrawGuard = modules.createWheelDrawGuard({
      global: global,
      lotteryWheel: global.LotteryWheel,
    });
    wheelDrawGuard.install();

    var wrappedOptions = {};
    Object.keys(value).forEach(function (key) {
      wrappedOptions[key] = value[key];
    });
    wrappedOptions.request = requestPrepared;

    originalDialog.configure(wrappedOptions);
    bindInteractions();
    return api;
  }

  function open(ticket) {
    var currentOpen = ++openVersion;
    opening = true;

    return Promise.resolve(originalDialog.open(ticket))
      .then(function (opened) {
        if (currentOpen !== openVersion) return false;
        if (!opened || isDemo()) {
          opening = false;
          return opened;
        }

        return prepare(
          service.getPending() || ticket,
          currentOpen
        );
      })
      .catch(function (error) {
        if (currentOpen !== openVersion) return false;
        opening = false;
        view.fail(error, false);
        return false;
      });
  }

  function restorePending() {
    var currentOpen = ++openVersion;
    opening = true;

    return Promise.resolve(originalDialog.restorePending())
      .then(function (opened) {
        if (currentOpen !== openVersion) return false;
        if (!opened || isDemo()) {
          opening = false;
          return opened;
        }

        var pending = service.getPending();
        if (!pending) {
          opening = false;
          return false;
        }
        return prepare(pending, currentOpen);
      })
      .catch(function (error) {
        if (currentOpen !== openVersion) return false;
        opening = false;
        view.fail(error, false);
        return false;
      });
  }

  function prepare(ticket, expectedOpenVersion) {
    view.loading();

    return service.prepare(ticket).then(function (result) {
      if (expectedOpenVersion !== openVersion || result.stale) {
        return false;
      }

      opening = false;
      if (result.ready) {
        view.ready();
        return true;
      }

      view.fail(result.error, Boolean(result.retryable));
      return false;
    });
  }

  function requestPrepared(action, fields, requestId) {
    if (action !== "drawLottery" || !service) {
      return request(action, fields, requestId);
    }

    var response;
    try {
      response = service.consume(fields, requestId);
    } catch (error) {
      return Promise.reject(error);
    }

    if (response === null) {
      return request(action, fields, requestId);
    }

    wheelDrawGuard.suppressNextDraw();
    return Promise.resolve(response);
  }

  function bindInteractions() {
    if (interactionsBound) return;

    var button = global.document.getElementById(
      "member-lottery-spin-button"
    );
    if (!button) return;

    interactionsBound = true;
    button.addEventListener(
      "click",
      function (event) {
        if (!service || isDemo()) return;

        var pending = service.getPending();
        if (
          !opening &&
          !service.isPreparing() &&
          pending &&
          service.hasPrepared(pending.requestId)
        ) {
          return;
        }

        event.preventDefault();
        event.stopImmediatePropagation();

        if (!opening && !service.isPreparing() && pending) {
          prepare(pending, ++openVersion);
        }
      },
      true
    );
  }

  function canClose() {
    if (!service) return originalDialog.canClose();
    return (
      !opening &&
      !service.isPreparing() &&
      originalDialog.canClose()
    );
  }

  function requestClose(value) {
    if (opening || (service && service.isPreparing())) {
      safeToast("轉盤正在準備，完成前請勿關閉。");
      return false;
    }

    openVersion += 1;
    if (service) service.cancel();
    if (wheelDrawGuard) wheelDrawGuard.reset();
    return originalDialog.requestClose(value);
  }

  function getStorageKey() {
    if (!options) return "";

    var liffId = String(options.liffId || "unknown");
    if (isDemo()) {
      return REQUEST_STORAGE_PREFIX + liffId + ":demo";
    }

    var memberId = "";
    try {
      memberId = String(options.getMemberId() || "").trim();
    } catch (_error) {
      memberId = "";
    }

    return /^MBR-[A-Z0-9]{10}$/.test(memberId)
      ? REQUEST_STORAGE_PREFIX + liffId + ":" + memberId
      : "";
  }

  function normalizeTicket(value) {
    value = value && typeof value === "object" ? value : {};

    var ticket = {
      settingVersion: String(value.settingVersion || "").trim(),
      cardNumber: Number(value.cardNumber),
      milestonePoints: Number(value.milestonePoints),
      lotteryTypeId: String(value.lotteryTypeId || "").trim(),
      cardRoundKey: String(value.cardRoundKey || "").trim(),
    };

    if (
      !/^PCS-[A-Z0-9]{12}$/.test(ticket.settingVersion) ||
      !Number.isSafeInteger(ticket.cardNumber) ||
      ticket.cardNumber < 1 ||
      !Number.isSafeInteger(ticket.milestonePoints) ||
      ticket.milestonePoints < 1 ||
      !/^LTY-[A-Z0-9]{10}$/.test(ticket.lotteryTypeId) ||
      ticket.cardRoundKey !==
        ticket.settingVersion +
          ":" +
          ticket.cardNumber +
          ":" +
          ticket.milestonePoints
    ) {
      throw createError(
        "INVALID_LOTTERY_TICKET",
        "抽獎券資料格式不正確。"
      );
    }

    return ticket;
  }

  function isDefinitiveNoDrawError(reason) {
    var code = String(
      (reason && (reason.code || reason.name)) || ""
    );
    return (
      code === "LOTTERY_ROUND_NOT_READY" ||
      code === "LOTTERY_TICKET_MISMATCH" ||
      code === "INVALID_LOTTERY_TICKET"
    );
  }

  function isDemo() {
    try {
      return options && options.isDemo() === true;
    } catch (_error) {
      return false;
    }
  }

  function safeToast(message) {
    try {
      if (options && typeof options.showToast === "function") {
        options.showToast(String(message || ""));
      }
    } catch (_error) {
      // Toast failures do not affect the lottery state machine.
    }
  }

  function getSessionStorage() {
    try {
      return global.sessionStorage;
    } catch (_error) {
      throw createError(
        "LOTTERY_STORAGE_UNAVAILABLE",
        "瀏覽器無法保存安全的抽獎請求。"
      );
    }
  }

  function assertDependencies() {
    var requiredFactories = [
      "createPendingRequestStore",
      "createPreparationService",
      "createPreparationView",
      "createWheelDrawGuard",
    ];

    if (
      !modules ||
      requiredFactories.some(function (name) {
        return typeof modules[name] !== "function";
      }) ||
      !global.MemberApi ||
      typeof global.MemberApi.createRequestId !== "function" ||
      !global.LotteryWheel ||
      typeof global.LotteryWheel.draw !== "function"
    ) {
      throw createError(
        "CLIENT_LIBRARY_ERROR",
        "無法載入轉盤準備模組。"
      );
    }
  }

  function createError(code, message) {
    var value = new Error(message);
    value.code = code;
    return value;
  }

  var api = Object.freeze({
    configure: configure,
    open: open,
    restorePending: restorePending,
    hasPending: function () {
      return originalDialog.hasPending();
    },
    canClose: canClose,
    requestClose: requestClose,
  });

  global.MemberLotteryDialog = api;
})(window);
