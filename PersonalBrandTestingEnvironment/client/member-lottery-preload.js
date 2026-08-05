(function (root) {
  "use strict";

  var legacy = root.MemberLotteryDialog;

  if (
    !legacy ||
    typeof legacy.configure !== "function" ||
    typeof legacy.open !== "function" ||
    !root.MemberLotteryPendingRequestStore ||
    !root.MemberLotteryPreparationService ||
    !root.MemberLotteryPreparationView ||
    !root.MemberLotteryWheelDrawGuard
  ) {
    return;
  }

  var originalOptions = null;
  var store = null;
  var guard = null;
  var service = null;
  var view = null;
  var activeTicket = null;

  function safeIsDemo() {
    try {
      return (
        originalOptions &&
        typeof originalOptions.isDemo === "function" &&
        originalOptions.isDemo() === true
      );
    } catch (_error) {
      return false;
    }
  }

  function cloneOptions(value) {
    var cloned = {};
    Object.keys(value).forEach(function (key) {
      cloned[key] = value[key];
    });
    return cloned;
  }

  function configure(value) {
    value = value && typeof value === "object" ? value : {};

    if (typeof value.request !== "function") {
      throw new Error("MemberLotteryDialog 需要 request(action, fields, requestId)。");
    }

    originalOptions = value;
    guard = root.MemberLotteryWheelDrawGuard.create();
    view = root.MemberLotteryPreparationView.create();
    store = root.MemberLotteryPendingRequestStore.create({
      liffId: String(value.liffId || "unknown").trim() || "unknown",
      isDemo: value.isDemo,
      getMemberId: value.getMemberId,
      createRequestId: function () {
        return root.MemberApi.createRequestId();
      },
    });
    service = root.MemberLotteryPreparationService.create({
      request: value.request,
      store: store,
      guard: guard,
      onCardUpdated: value.onCardUpdated,
    });

    var wrappedOptions = cloneOptions(value);
    wrappedOptions.request = function (action, fields, requestId) {
      if (!activeTicket || safeIsDemo()) {
        return value.request(action, fields, requestId);
      }

      if (action === "getLotteryConfig") {
        view.markPreparing();
        return service.prepare(activeTicket);
      }

      if (action === "drawLottery") {
        return service.resolvePrepared(activeTicket, requestId);
      }

      return value.request(action, fields, requestId);
    };

    legacy.configure(wrappedOptions);
    return api;
  }

  function open(ticketValue) {
    if (!store || !service || !guard || !view) {
      throw new Error("請先設定 MemberLotteryDialog。");
    }

    activeTicket = store.normalizeTicket(ticketValue);
    guard.clear();

    if (!safeIsDemo()) {
      view.markPreparing();
    }

    return Promise.resolve(legacy.open(activeTicket)).then(function (opened) {
      if (opened && !safeIsDemo()) {
        var pending = store.read();
        if (
          pending &&
          guard.has(activeTicket, pending.requestId)
        ) {
          view.markReady();
        }
      }
      return Boolean(opened);
    });
  }

  function restorePending() {
    if (!store) return Promise.resolve(false);
    var pending = store.read();
    if (!pending) return Promise.resolve(false);
    return open(pending);
  }

  function hasPending() {
    return store ? Boolean(store.read()) : legacy.hasPending();
  }

  function canClose() {
    return legacy.canClose();
  }

  function requestClose(closeOptions) {
    var closed = legacy.requestClose(closeOptions);
    if (closed) {
      activeTicket = null;
      if (guard) guard.clear();
    }
    return closed;
  }

  var api = Object.freeze({
    configure: configure,
    open: open,
    restorePending: restorePending,
    hasPending: hasPending,
    canClose: canClose,
    requestClose: requestClose,
  });

  root.MemberLotteryDialogLegacy = legacy;
  root.MemberLotteryDialog = api;
})(window);
