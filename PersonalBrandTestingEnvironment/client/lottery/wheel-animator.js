(function (root) {
  "use strict";

  var registry = root.PersonaModules;
  if (!registry) return;

  registry.define(
    "lottery.wheel-animator",
    ["lottery.contracts"],
    function (contracts) {
      var SPIN_DEGREES_PER_MS = 1.45;
      var FINAL_SPIN_TURNS = 2;

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

        function prefersReducedMotion() {
          return (
            typeof runtime.matchMedia === "function" &&
            runtime.matchMedia("(prefers-reduced-motion: reduce)").matches
          );
        }

        function draw(prizes) {
          if (!renderer.draw(canvas, prizes)) {
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
          rotor.style.transform = "rotate(0deg)";
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
                SPIN_DEGREES_PER_MS;
              rotor.style.transform = "rotate(" + rotation + "deg)";
            }
            waitingLastTime = timestamp;
            waitingFrame = runtime.requestAnimationFrame(rotate);
          }

          waitingFrame = runtime.requestAnimationFrame(rotate);
        }

        function settle(drawResult, lottery) {
          stop();
          var currentVersion = animationVersion;
          var prizeIndex = lottery.prizes.findIndex(function (prize) {
            return prize.prizeId === drawResult.prizeId;
          });
          if (prizeIndex < 0) {
            return Promise.reject(
              contracts.createError("INVALID_RESPONSE", "找不到抽中的獎項。")
            );
          }

          var sectorDegrees = 360 / lottery.prizes.length;
          var desiredRotation = -(prizeIndex + 0.5) * sectorDegrees;
          var currentModulo = ((rotation % 360) + 360) % 360;
          var desiredModulo = ((desiredRotation % 360) + 360) % 360;
          var alignment = (desiredModulo - currentModulo + 360) % 360;
          var startRotation = rotation;
          var rotationDelta = 360 * FINAL_SPIN_TURNS + alignment;
          var targetRotation = startRotation + rotationDelta;

          setStatus("轉盤旋轉中，請稍候結果…");
          if (prefersReducedMotion()) {
            rotation = targetRotation;
            rotor.style.transform = "rotate(" + rotation + "deg)";
            return new Promise(function (resolve) {
              runtime.setTimeout(function () {
                if (currentVersion === animationVersion) resolve();
              }, 30);
            });
          }

          var duration = (2 * rotationDelta) / SPIN_DEGREES_PER_MS;
          return new Promise(function (resolve) {
            var startedAt =
              runtime.performance &&
              typeof runtime.performance.now === "function"
                ? runtime.performance.now()
                : null;

            function decelerate(timestamp) {
              if (currentVersion !== animationVersion) return;
              if (startedAt === null) startedAt = timestamp;
              var progress = Math.min(1, (timestamp - startedAt) / duration);
              var quadraticEaseOut = 1 - Math.pow(1 - progress, 2);
              var smoothstepCorrection = Math.pow(progress * (1 - progress), 2);
              rotation =
                startRotation +
                rotationDelta * (quadraticEaseOut + smoothstepCorrection);
              rotor.style.transform = "rotate(" + rotation + "deg)";

              if (progress < 1) {
                settlingFrame = runtime.requestAnimationFrame(decelerate);
                return;
              }

              settlingFrame = 0;
              rotation = targetRotation;
              rotor.style.transform = "rotate(" + rotation + "deg)";
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
