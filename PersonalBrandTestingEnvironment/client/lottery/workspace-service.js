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
          Number.isFinite(ttlMs) && ttlMs >= 0 && ttlMs <= 30000
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

        function load(loadOptions) {
          loadOptions =
            loadOptions && typeof loadOptions === "object" ? loadOptions : {};
          if (loadOptions.force !== true && isFresh()) {
            return Promise.resolve(cachedResponse);
          }
          if (inFlight) return inFlight;

          var requestGeneration = generation;
          var requestPromise = Promise.resolve()
            .then(function () {
              return options.request("getLotteryConfig", {}, undefined);
            })
            .then(contracts.assertSuccessfulResponse)
            .then(function (response) {
              if (requestGeneration === generation) prime(response);
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
        });
      }

      return Object.freeze({ create: create });
    }
  );
})(window);
