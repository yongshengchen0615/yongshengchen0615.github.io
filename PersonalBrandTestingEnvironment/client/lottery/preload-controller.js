(function (root) {
  "use strict";

  var registry = root.PersonaModules;
  if (!registry) {
    throw new Error("PersonaModules must load before lottery preload controller.");
  }

  registry.define(
    "lottery.preload-controller",
    [
      "lottery.contracts",
      "lottery.pending-request-store",
      "lottery.preparation-service",
      "lottery.preparation-view",
      "lottery.wheel-draw-guard",
    ],
    function (contracts, storeFactory, serviceFactory, viewFactory, guardFactory) {
      function create(options) {
        options = options && typeof options === "object" ? options : {};

        var legacy = options.legacy;
        var memberApi = options.memberApi;
        if (
          !legacy ||
          typeof legacy.configure !== "function" ||
          typeof legacy.open !== "function" ||
          !memberApi ||
          typeof memberApi.createRequestId !== "function"
        ) {
          throw contracts.createError(
            "INVALID_CONFIGURATION",
            "PreloadController 缺少 legacy dialog 或 MemberApi。"
          );
        }

        var configuredOptions = null;
        var store = null;
        var guard = null;
        var service = null;
        var view = null;
        var activeTicket = null;

        function safeIsDemo() {
          try {
            return Boolean(
              configuredOptions &&
                typeof configuredOptions.isDemo === "function" &&
                configuredOptions.isDemo() === true
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

        function ensureConfigured() {
          if (!store || !guard || !service || !view || !configuredOptions) {
            throw contracts.createError(
              "NOT_CONFIGURED",
              "請先設定 MemberLotteryDialog。"
            );
          }
        }

        function configure(value) {
          value = value && typeof value === "object" ? value : {};
          if (typeof value.request !== "function") {
            throw contracts.createError(
              "INVALID_CONFIGURATION",
              "MemberLotteryDialog 需要 request(action, fields, requestId)。"
            );
          }

          configuredOptions = Object.freeze(cloneOptions(value));
          activeTicket = null;
          guard = guardFactory.create();
          view = viewFactory.create({ document: options.document });
          store = storeFactory.create({
            liffId: String(value.liffId || "unknown").trim() || "unknown",
            isDemo: value.isDemo,
            getMemberId: value.getMemberId,
            storage: options.storage,
            createRequestId: function () {
              return memberApi.createRequestId();
            },
          });
          service = serviceFactory.create({
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
          ensureConfigured();
          activeTicket = store.normalizeTicket(ticketValue);
          guard.clear();

          if (!safeIsDemo()) view.markPreparing();

          return Promise.resolve(legacy.open(activeTicket)).then(function (opened) {
            if (opened && !safeIsDemo()) {
              var pending = store.read();
              if (pending && guard.has(activeTicket, pending.requestId)) {
                view.markReady();
              }
            }
            return Boolean(opened);
          });
        }

        function restorePending() {
          ensureConfigured();
          var pending = store.read();
          return pending ? open(pending) : Promise.resolve(false);
        }

        function hasPending() {
          if (!store) {
            return typeof legacy.hasPending === "function"
              ? Boolean(legacy.hasPending())
              : false;
          }
          return Boolean(store.read());
        }

        function canClose() {
          return typeof legacy.canClose === "function" ? legacy.canClose() : true;
        }

        function requestClose(closeOptions) {
          var closed =
            typeof legacy.requestClose === "function"
              ? legacy.requestClose(closeOptions)
              : true;
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

        return api;
      }

      return Object.freeze({ create: create });
    }
  );
})(window);
