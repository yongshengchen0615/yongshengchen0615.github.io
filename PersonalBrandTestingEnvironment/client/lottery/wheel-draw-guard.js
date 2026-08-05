(function (global) {
  "use strict";

  var namespace =
    global.MemberLotteryPreparation || Object.create(null);

  function createWheelDrawGuard(options) {
    options = options && typeof options === "object" ? options : {};

    var host = options.global;
    var wheel = options.lotteryWheel;
    var installed = false;
    var suppressNext = false;

    if (!host || !wheel || typeof wheel.draw !== "function") {
      throw createError(
        "INVALID_DRAW_GUARD_CONFIGURATION",
        "WheelDrawGuard 需要 LotteryWheel.draw。"
      );
    }

    function install() {
      if (installed) return true;

      var originalDraw = wheel.draw;
      var replacement = {};
      Object.keys(wheel).forEach(function (key) {
        replacement[key] = wheel[key];
      });

      replacement.draw = function () {
        if (suppressNext) {
          suppressNext = false;
          return true;
        }
        return originalDraw.apply(wheel, arguments);
      };

      try {
        host.LotteryWheel = Object.freeze(replacement);
        installed = host.LotteryWheel.draw === replacement.draw;
      } catch (_error) {
        installed = false;
      }

      return installed;
    }

    function suppressNextDraw() {
      if (installed) suppressNext = true;
    }

    function reset() {
      suppressNext = false;
    }

    return Object.freeze({
      install: install,
      suppressNextDraw: suppressNextDraw,
      reset: reset,
      isInstalled: function () {
        return installed;
      },
    });
  }

  function createError(code, message) {
    var value = new Error(message);
    value.code = code;
    return value;
  }

  namespace.createWheelDrawGuard = createWheelDrawGuard;
  global.MemberLotteryPreparation = namespace;
})(window);
