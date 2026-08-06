(function (root) {
  "use strict";

  var registry = root.PersonaModules;
  if (!registry) return;

  registry.define(
    "lottery.workspace-service",
    ["lottery.contracts"],
    function (contracts) {
      var DEFAULT_TTL_MS = 5000;

      function create(options) {
        options = options && typeof options === "object" ? options : {};
        if (typeof options.request !== "function") {
          throw contracts.createError(
            "INVALID_CONFIGURATION",
            "WorkspaceService 缺少 request。"
          );
        }

        var ttlMs = Number(options.ttlMs);
        ttlMs =
          Number.isFinite(ttlMs) && ttlMs >= 0 && ttlMs <= 60000
            ? ttlMs
            : DEFAULT_TTL_MS;
        var now =
          typeof options.now === "function"
            ? options.now
            : function () {
                return Date.now();
              };
        var cachedResponse = null;
        var cachedAt = 0;
        var inFlight = null;
        var generation = 0;

        function performanceNow() {
          return root.performance && typeof root.performance.now === "function"
            ? root.performance.now()
            : Date.now();
        }

        function emit(name, detail) {
          if (
            typeof root.dispatchEvent !== "function" ||
            typeof root.CustomEvent !== "function"
          ) {
            return;
          }
          try {
            root.dispatchEvent(
              new root.CustomEvent(name, {
                detail: Object.freeze(
                  Object.assign(
                    {},
                    detail && typeof detail === "object" ? detail : {}
                  )
                ),
              })
            );
          } catch (_error) {
            // Diagnostics must never change the lottery flow.
          }
        }

        function emitMetric(phase, startedAt, source) {
          emit("persona:lottery-performance", {
            phase: phase,
            durationMs: Math.max(
              0,
              Math.round((performanceNow() - startedAt) * 10) / 10
            ),
            source: source || "network",
          });
        }

        function isFresh() {
          return Boolean(
            cachedResponse && ttlMs > 0 && now() - cachedAt <= ttlMs
          );
        }

        function prime(response) {
          contracts.assertSuccessfulResponse(response);
          cachedResponse = response;
          cachedAt = now();
          return response;
        }

        function invalidate() {
          generation += 1;
          cachedResponse = null;
          cachedAt = 0;
        }

        function peek() {
          return cachedResponse;
        }

        function load(loadOptions) {
          loadOptions =
            loadOptions && typeof loadOptions === "object" ? loadOptions : {};
          var force = loadOptions.force === true;
          var allowStale = loadOptions.allowStale === true;

          if (!force && (isFresh() || (allowStale && cachedResponse))) {
            var cachedStartedAt = performanceNow();
            emitMetric(
              "workspace_load",
              cachedStartedAt,
              isFresh() ? "fresh-cache" : "stale-preview-cache"
            );
            return Promise.resolve(cachedResponse);
          }
          if (inFlight) return inFlight;

          emit("persona:lottery-phase", {
            phase: "loading_workspace",
          });
          var startedAt = performanceNow();
          var requestGeneration = generation;
          var requestPromise = Promise.resolve()
            .then(function () {
              return options.request("getLotteryConfig", {}, undefined);
            })
            .then(contracts.assertSuccessfulResponse)
            .then(function (response) {
              if (requestGeneration === generation) prime(response);
              emitMetric("workspace_load", startedAt, "network");
              return response;
            })
            .finally(function () {
              if (inFlight === requestPromise) inFlight = null;
            });

          inFlight = requestPromise;
          return requestPromise;
        }

        return Object.freeze({
          load: load,
          prime: prime,
          invalidate: invalidate,
          isFresh: isFresh,
          peek: peek,
        });
      }

      return Object.freeze({ create: create });
    }
  );
})(window);
