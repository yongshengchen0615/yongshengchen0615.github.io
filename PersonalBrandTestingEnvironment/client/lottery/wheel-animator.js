(function (root) {
  "use strict";

  var registry = root.PersonaModules;
  if (!registry) return;

  registry.define(
    "lottery.wheel-animator",
    ["lottery.contracts"],
    function (contracts) {
      var INITIAL_DEGREES_PER_MS = 1.45;
      var FINAL_SPIN_TURNS = 3;
      var MIN_DURATION_MS = 2200;
      var MAX_DURATION_MS = 3200;

      function create(options) {
        options = options && typeof options === "object" ? options : {};
        var runtime = options.root || root;
        var rotor = options.rotor || null;
        var canvas = options.canvas || null;
        var renderer = options.renderer || null;
        var setStatus =
          typeof options.setStatus === "function"
            ? options.setStatus
            : function () {};

        if (
          !rotor ||
          !canvas ||
          !renderer ||
          typeof renderer.draw !== "function"
        ) {
          throw contracts.createError(
            "INVALID_CONFIGURATION",
            "WheelAnimator 缺少 rotor、canvas 或 renderer。"
          );
        }

        var rotation = 0;
        var waitingFrame = 0;
        var waitingLastTime = 0;
        var settlingFrame = 0;
        var animationVersion = 0;
        var preparedConfigVersion = "";
        var preparedTargets = Object.create(null);

        function prefersReducedMotion() {
          return (
            typeof runtime.matchMedia === "function" &&
            runtime.matchMedia("(prefers-reduced-motion: reduce)").matches
          );
        }

        function renderRotation(value) {
          rotor.style.transform = "rotate(" + value + "deg)";
        }

        function draw(prizes) {
          if (
            !renderer.draw(canvas, prizes, {
              pixelRatio: Number(runtime.devicePixelRatio) || 1,
            })
          ) {
            throw contracts.createError(
              "WHEEL_RENDER_ERROR",
              "目前無法繪製轉盤，請重新開啟後再試。"
            );
          }
          return true;
        }

        function stop() {
          if (waitingFrame) {
            runtime.cancelAnimationFrame(waitingFrame);
            waitingFrame = 0;
          }
          if (settlingFrame) {
            runtime.cancelAnimationFrame(settlingFrame);
            settlingFrame = 0;
          }
          waitingLastTime = 0;
          animationVersion += 1;
        }

        function reset() {
          stop();
          rotation = 0;
          renderRotation(0);
        }

        function prepare(lotteryValue) {
          var lottery =
            lotteryValue && typeof lotteryValue === "object"
              ? lotteryValue
              : {};
          var prizes = Array.isArray(lottery.prizes) ? lottery.prizes : [];
          if (prizes.length < 2) {
            throw contracts.createError(
              "INVALID_RESPONSE",
              "轉盤至少需要兩個獎項。"
            );
          }

          reset();
          draw(prizes);
          var sectorDegrees = 360 / prizes.length;
          var targets = Object.create(null);
          prizes.forEach(function (prize, index) {
            var prizeId = String(prize && prize.prizeId ? prize.prizeId : "");
            if (!prizeId || targets[prizeId] != null) {
              throw contracts.createError(
                "INVALID_RESPONSE",
                "轉盤獎項識別碼不完整。"
              );
            }
            var desiredRotation = -(index + 0.5) * sectorDegrees;
            targets[prizeId] = ((desiredRotation % 360) + 360) % 360;
          });
          preparedTargets = targets;
          preparedConfigVersion = String(lottery.configVersion || "");
          return true;
        }

        function startWaiting(isActive) {
          stop();
          if (prefersReducedMotion()) return;
          waitingLastTime = 0;

          function rotate(timestamp) {
            if (typeof isActive === "function" && !isActive()) {
              stop();
              return;
            }
            if (waitingLastTime) {
              rotation +=
                Math.min(100, timestamp - waitingLastTime) *
                INITIAL_DEGREES_PER_MS;
              renderRotation(rotation);
            }
            waitingLastTime = timestamp;
            waitingFrame = runtime.requestAnimationFrame(rotate);
          }

          waitingFrame = runtime.requestAnimationFrame(rotate);
        }

        function calculateTarget(drawResult, lottery) {
          var configVersion = String(lottery.configVersion || "");
          if (
            preparedConfigVersion !== configVersion ||
            preparedTargets[String(drawResult.prizeId || "")] == null
          ) {
            prepare(lottery);
          }
          var currentModulo = ((rotation % 360) + 360) % 360;
          var desiredModulo =
            preparedTargets[String(drawResult.prizeId || "")];
          if (desiredModulo == null) {
            throw contracts.createError(
              "INVALID_RESPONSE",
              "找不到抽中的獎項。"
            );
          }
          var alignment = (desiredModulo - currentModulo + 360) % 360;
          return rotation + 360 * FINAL_SPIN_TURNS + alignment;
        }

        function settle(drawResult, lotteryValue) {
          var lottery =
            lotteryValue && typeof lotteryValue === "object"
              ? lotteryValue
              : {};
          stop();
          var startRotation = rotation;
          var targetRotation;
          try {
            targetRotation = calculateTarget(drawResult || {}, lottery);
            startRotation = rotation;
          } catch (error) {
            return Promise.reject(error);
          }
          var currentVersion = animationVersion;
          var rotationDelta = targetRotation - startRotation;

          setStatus("轉盤旋轉中，請稍候結果…");
          if (prefersReducedMotion()) {
            rotation = targetRotation;
            renderRotation(rotation);
            return new Promise(function (resolve) {
              runtime.setTimeout(function () {
                if (currentVersion === animationVersion) resolve();
              }, 30);
            });
          }

          var duration = Math.min(
            MAX_DURATION_MS,
            Math.max(
              MIN_DURATION_MS,
              (3 * rotationDelta) / INITIAL_DEGREES_PER_MS
            )
          );
          return new Promise(function (resolve) {
            var startedAt = null;

            function decelerate(timestamp) {
              if (currentVersion !== animationVersion) return;
              if (startedAt === null) startedAt = timestamp;
              var progress = Math.min(1, (timestamp - startedAt) / duration);
              var eased = 1 - Math.pow(1 - progress, 3);
              rotation = startRotation + rotationDelta * eased;
              renderRotation(rotation);

              if (progress < 1) {
                settlingFrame = runtime.requestAnimationFrame(decelerate);
                return;
              }

              settlingFrame = 0;
              rotation = targetRotation;
              renderRotation(rotation);
              resolve();
            }

            settlingFrame = runtime.requestAnimationFrame(decelerate);
          });
        }

        function getRotation() {
          return rotation;
        }

        return Object.freeze({
          draw: draw,
          prepare: prepare,
          reset: reset,
          startWaiting: startWaiting,
          settle: settle,
          stop: stop,
          getRotation: getRotation,
        });
      }

      return Object.freeze({ create: create });
    }
  );
})(window);
