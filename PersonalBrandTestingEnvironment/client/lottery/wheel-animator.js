(function (root) {
  "use strict";

  var registry = root.PersonaModules;
  if (!registry) return;

  registry.define(
    "lottery.wheel-animator",
    ["lottery.contracts"],
    function (contracts) {
      var FULL_SPIN_TURNS = 8;
      var ACCEL_DURATION_MS = 320;
      var CRUISE_DURATION_MS = 760;
      var DECEL_DURATION_MS = 2400;
      var PENDING_ACCEL_DURATION_MS = 320;
      var PENDING_DEGREES_PER_MS = 1.2;
      var PENDING_MIN_EXTRA_TURNS = 5;
      var PENDING_DECEL_BUFFER_DEGREES = 180;
      var REDUCED_MOTION_DELAY_MS = 30;

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
        var animationFrame = 0;
        var animationVersion = 0;
        var pendingSpinActive = false;
        var pendingSpinVelocity = 0;
        var preparedConfigVersion = "";
        var preparedTargets = Object.create(null);

        function performanceNow() {
          return runtime.performance &&
            typeof runtime.performance.now === "function"
            ? runtime.performance.now()
            : Date.now();
        }

        function emitMetric(phase, startedAt) {
          if (
            typeof runtime.dispatchEvent !== "function" ||
            typeof runtime.CustomEvent !== "function"
          ) {
            return;
          }
          try {
            runtime.dispatchEvent(
              new runtime.CustomEvent("persona:lottery-performance", {
                detail: Object.freeze({
                  phase: phase,
                  durationMs: Math.max(
                    0,
                    Math.round((performanceNow() - startedAt) * 10) / 10
                  ),
                  source: "canvas",
                }),
              })
            );
          } catch (_error) {
            // Diagnostics must not affect rendering.
          }
        }

        function prefersReducedMotion() {
          return (
            typeof runtime.matchMedia === "function" &&
            runtime.matchMedia("(prefers-reduced-motion: reduce)").matches
          );
        }

        function setCompositingHint(active) {
          rotor.style.willChange = active ? "transform" : "auto";
        }

        function renderRotation(value) {
          rotor.style.transform = "rotate(" + value + "deg)";
        }

        function draw(prizes) {
          var startedAt = performanceNow();
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
          emitMetric("canvas_draw", startedAt);
          return true;
        }

        function cancelFrameOnly() {
          if (animationFrame) {
            runtime.cancelAnimationFrame(animationFrame);
            animationFrame = 0;
          }
        }

        function stop() {
          cancelFrameOnly();
          pendingSpinActive = false;
          pendingSpinVelocity = 0;
          setCompositingHint(false);
          animationVersion += 1;
        }

        function reset() {
          stop();
          rotation = 0;
          renderRotation(0);
        }

        function prepareLottery(lotteryValue, resetRotation) {
          var startedAt = performanceNow();
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

          if (resetRotation) reset();
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
          emitMetric("wheel_prepare", startedAt);
          return true;
        }

        function prepare(lotteryValue) {
          return prepareLottery(lotteryValue, true);
        }

        function ensureTarget(drawResult, lottery) {
          var configVersion = String(lottery.configVersion || "");
          if (
            preparedConfigVersion !== configVersion ||
            preparedTargets[String(drawResult.prizeId || "")] == null
          ) {
            // The authoritative draw may return a newer active config than the
            // login-time snapshot. Redraw the sectors without resetting motion.
            prepareLottery(lottery, false);
          }
          var desiredModulo = preparedTargets[String(drawResult.prizeId || "")];
          if (desiredModulo == null) {
            throw contracts.createError(
              "INVALID_RESPONSE",
              "找不到抽中的獎項。"
            );
          }
          return desiredModulo;
        }

        function calculateTarget(drawResult, lottery) {
          var desiredModulo = ensureTarget(drawResult, lottery);
          var currentModulo = ((rotation % 360) + 360) % 360;
          var alignment = (desiredModulo - currentModulo + 360) % 360;
          return rotation + 360 * FULL_SPIN_TURNS + alignment;
        }

        function smoothstep(u) {
          return 3 * u * u - 2 * u * u * u;
        }

        // Smoothstep velocity ramp integral. The velocity itself is
        // 3u^2 - 2u^3, so this integral gives continuous position and velocity.
        function rampDistance(u) {
          return u * u * u - 0.5 * u * u * u * u;
        }

        function decelDistance(u) {
          return u - u * u * u + 0.5 * u * u * u * u;
        }

        function startPendingSpin() {
          if (pendingSpinActive) return true;

          stop();
          pendingSpinActive = true;
          pendingSpinVelocity = 0;
          setStatus("正在確認抽獎結果…");

          if (
            prefersReducedMotion() ||
            typeof runtime.requestAnimationFrame !== "function"
          ) {
            return true;
          }

          var currentVersion = animationVersion;
          var startedAt = null;
          var lastTimestamp = null;
          setCompositingHint(true);

          function animate(timestamp) {
            if (currentVersion !== animationVersion || !pendingSpinActive) return;
            if (startedAt === null) startedAt = Number(timestamp);
            if (lastTimestamp === null) lastTimestamp = Number(timestamp);

            var now = Number(timestamp);
            var elapsed = Math.max(0, now - startedAt);
            var deltaMs = Math.max(0, Math.min(64, now - lastTimestamp));
            var progress = Math.min(1, elapsed / PENDING_ACCEL_DURATION_MS);
            pendingSpinVelocity = PENDING_DEGREES_PER_MS * smoothstep(progress);
            rotation += pendingSpinVelocity * deltaMs;
            renderRotation(rotation);
            lastTimestamp = now;
            animationFrame = runtime.requestAnimationFrame(animate);
          }

          animationFrame = runtime.requestAnimationFrame(animate);
          return true;
        }

        function settlePending(drawResult, lotteryValue) {
          var lottery =
            lotteryValue && typeof lotteryValue === "object"
              ? lotteryValue
              : {};

          if (
            prefersReducedMotion() ||
            typeof runtime.requestAnimationFrame !== "function"
          ) {
            pendingSpinActive = false;
            pendingSpinVelocity = 0;
            return spinTo(drawResult, lottery);
          }

          var velocity = pendingSpinVelocity;
          cancelFrameOnly();
          pendingSpinActive = false;

          if (!Number.isFinite(velocity) || velocity < 0.08) {
            pendingSpinVelocity = 0;
            return spinTo(drawResult, lottery);
          }

          var desiredModulo;
          try {
            desiredModulo = ensureTarget(drawResult || {}, lottery);
          } catch (error) {
            pendingSpinVelocity = 0;
            setCompositingHint(false);
            return Promise.reject(error);
          }

          var startRotation = rotation;
          var currentModulo = ((startRotation % 360) + 360) % 360;
          var alignment = (desiredModulo - currentModulo + 360) % 360;
          var decelerationDistance =
            0.5 * velocity * DECEL_DURATION_MS;
          var rotationDelta =
            360 * PENDING_MIN_EXTRA_TURNS + alignment;

          while (
            rotationDelta <
            decelerationDistance + PENDING_DECEL_BUFFER_DEGREES
          ) {
            rotationDelta += 360;
          }

          var targetRotation = startRotation + rotationDelta;
          var cruiseDistance = Math.max(
            0,
            rotationDelta - decelerationDistance
          );
          var cruiseDuration = cruiseDistance / velocity;
          var totalDuration = cruiseDuration + DECEL_DURATION_MS;
          var currentVersion = animationVersion;
          var startedMetricAt = performanceNow();

          pendingSpinVelocity = 0;
          setStatus("正在揭曉抽獎結果…");
          setCompositingHint(true);

          return new Promise(function (resolve) {
            var startedAt = null;

            function animate(timestamp) {
              if (currentVersion !== animationVersion) return;
              if (startedAt === null) startedAt = Number(timestamp);

              var elapsed = Math.max(
                0,
                Math.min(totalDuration, Number(timestamp) - startedAt)
              );
              var travelled;

              if (elapsed <= cruiseDuration) {
                travelled = velocity * elapsed;
              } else {
                var decelElapsed = elapsed - cruiseDuration;
                var progress = Math.min(1, decelElapsed / DECEL_DURATION_MS);
                travelled =
                  cruiseDistance +
                  velocity * DECEL_DURATION_MS * decelDistance(progress);
              }

              rotation = startRotation + travelled;
              renderRotation(rotation);

              if (elapsed < totalDuration) {
                animationFrame = runtime.requestAnimationFrame(animate);
                return;
              }

              animationFrame = 0;
              rotation = targetRotation;
              renderRotation(rotation);
              setCompositingHint(false);
              emitMetric("wheel_reveal", startedMetricAt);
              resolve();
            }

            animationFrame = runtime.requestAnimationFrame(animate);
          });
        }

        function spinTo(drawResult, lotteryValue) {
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
          var startedMetricAt = performanceNow();

          setStatus("正在揭曉抽獎結果…");
          if (
            prefersReducedMotion() ||
            typeof runtime.requestAnimationFrame !== "function"
          ) {
            rotation = targetRotation;
            renderRotation(rotation);
            setCompositingHint(false);
            emitMetric("wheel_reveal", startedMetricAt);
            return new Promise(function (resolve) {
              runtime.setTimeout(function () {
                if (currentVersion === animationVersion) resolve();
              }, REDUCED_MOTION_DELAY_MS);
            });
          }

          var weightedDuration =
            0.5 * ACCEL_DURATION_MS +
            CRUISE_DURATION_MS +
            0.5 * DECEL_DURATION_MS;
          var peakVelocity = rotationDelta / weightedDuration;
          var accelDistance = 0.5 * peakVelocity * ACCEL_DURATION_MS;
          var cruiseDistance = peakVelocity * CRUISE_DURATION_MS;
          var totalDuration =
            ACCEL_DURATION_MS + CRUISE_DURATION_MS + DECEL_DURATION_MS;

          setCompositingHint(true);
          return new Promise(function (resolve) {
            var startedAt = null;

            function animate(timestamp) {
              if (currentVersion !== animationVersion) return;
              if (startedAt === null) startedAt = timestamp;

              var elapsed = Math.max(
                0,
                Math.min(totalDuration, Number(timestamp) - Number(startedAt))
              );
              var travelled;

              if (elapsed <= ACCEL_DURATION_MS) {
                var accelProgress = elapsed / ACCEL_DURATION_MS;
                travelled =
                  peakVelocity *
                  ACCEL_DURATION_MS *
                  rampDistance(accelProgress);
              } else if (elapsed <= ACCEL_DURATION_MS + CRUISE_DURATION_MS) {
                travelled =
                  accelDistance +
                  peakVelocity * (elapsed - ACCEL_DURATION_MS);
              } else {
                var decelElapsed =
                  elapsed - ACCEL_DURATION_MS - CRUISE_DURATION_MS;
                var decelProgress = Math.min(
                  1,
                  decelElapsed / DECEL_DURATION_MS
                );
                travelled =
                  accelDistance +
                  cruiseDistance +
                  peakVelocity *
                    DECEL_DURATION_MS *
                    decelDistance(decelProgress);
              }

              rotation = startRotation + travelled;
              renderRotation(rotation);

              if (elapsed < totalDuration) {
                animationFrame = runtime.requestAnimationFrame(animate);
                return;
              }

              animationFrame = 0;
              rotation = targetRotation;
              renderRotation(rotation);
              setCompositingHint(false);
              emitMetric("wheel_reveal", startedMetricAt);
              resolve();
            }

            animationFrame = runtime.requestAnimationFrame(animate);
          });
        }

        function settle(drawResult, lotteryValue) {
          return pendingSpinActive
            ? settlePending(drawResult, lotteryValue)
            : spinTo(drawResult, lotteryValue);
        }

        function getRotation() {
          return rotation;
        }

        if (typeof runtime.addEventListener === "function") {
          runtime.addEventListener("persona:lottery-draw-start", function () {
            startPendingSpin();
          });
        }

        return Object.freeze({
          draw: draw,
          prepare: prepare,
          startPendingSpin: startPendingSpin,
          spinTo: spinTo,
          reset: reset,
          settle: settle,
          stop: stop,
          getRotation: getRotation,
        });
      }

      return Object.freeze({ create: create });
    }
  );
})(window);
