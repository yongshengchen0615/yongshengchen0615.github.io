(function (root) {
  "use strict";

  function createBootstrapError(message, cause) {
    var error = new Error(message);
    error.code = "LOTTERY_BOOTSTRAP_ERROR";
    if (cause) error.cause = cause;
    return error;
  }

  function createUnavailableFacade(error) {
    function fail() {
      throw error;
    }
    return Object.freeze({
      configure: fail,
      open: fail,
      restorePending: function () {
        return Promise.reject(error);
      },
      hasPending: function () {
        return false;
      },
      canClose: function () {
        return true;
      },
      requestClose: function () {
        return true;
      },
    });
  }

  var legacy = root.MemberLotteryDialog;
  var registry = root.PersonaModules;

  try {
    if (!registry || typeof registry.get !== "function") {
      throw createBootstrapError("無法載入抽獎模組註冊中心。");
    }
    if (!legacy || typeof legacy.configure !== "function") {
      throw createBootstrapError("無法載入既有轉盤視窗元件。");
    }

    var controllerFactory = registry.get("lottery.preload-controller");
    root.MemberLotteryDialog = controllerFactory.create({
      legacy: legacy,
      memberApi: root.MemberApi,
      document: root.document,
      storage: root.sessionStorage,
    });
  } catch (error) {
    var bootstrapError =
      error && error.code === "LOTTERY_BOOTSTRAP_ERROR"
        ? error
        : createBootstrapError("抽獎模組初始化失敗。", error);
    root.MemberLotteryDialog = createUnavailableFacade(bootstrapError);
    if (root.console && typeof root.console.error === "function") {
      root.console.error(bootstrapError);
    }
  }
})(window);
