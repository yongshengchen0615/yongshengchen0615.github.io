(function (root) {
  "use strict";

  var registry = root.PersonaModules;
  if (!registry) {
    throw new Error("PersonaModules must load before pending request store.");
  }

  registry.define(
    "lottery.pending-request-store",
    ["lottery.contracts"],
    function (contracts) {
      var REQUEST_STORAGE_PREFIX = "persona-member-lottery-round-request:";

      function create(options) {
        options = options && typeof options === "object" ? options : {};

        if (typeof options.createRequestId !== "function") {
          throw contracts.createError(
            "INVALID_CONFIGURATION",
            "PendingRequestStore 需要 createRequestId。"
          );
        }

        var storage = options.storage || null;
        var memoryRequest = null;
        var memoryStorageKey = "";

        function safeIsDemo() {
          try {
            return (
              typeof options.isDemo === "function" && options.isDemo() === true
            );
          } catch (_error) {
            return false;
          }
        }

        function getMemberId() {
          try {
            return typeof options.getMemberId === "function"
              ? String(options.getMemberId() || "").trim()
              : "";
          } catch (_error) {
            return "";
          }
        }

        function getStorageKey() {
          var liffId = String(options.liffId || "unknown").trim() || "unknown";

          if (safeIsDemo()) {
            return REQUEST_STORAGE_PREFIX + liffId + ":demo";
          }

          var memberId = getMemberId();
          return /^MBR-[A-Z0-9]{10}$/.test(memberId)
            ? REQUEST_STORAGE_PREFIX + liffId + ":" + memberId
            : "";
        }

        function toStoredRequest(value) {
          var ticket = contracts.normalizeTicket(value);
          return Object.freeze({
            requestId: contracts.normalizeRequestId(value.requestId),
            settingVersion: ticket.settingVersion,
            cardNumber: ticket.cardNumber,
            milestonePoints: ticket.milestonePoints,
            lotteryTypeId: ticket.lotteryTypeId,
            cardRoundKey: ticket.cardRoundKey,
          });
        }

        function safelyRemove(storageKey) {
          if (!storage || typeof storage.removeItem !== "function" || !storageKey) {
            return;
          }
          try {
            storage.removeItem(storageKey);
          } catch (_error) {
            // Restricted browsers may block sessionStorage.
          }
        }

        function read() {
          var storageKey = getStorageKey();

          if (!storageKey) {
            memoryRequest = null;
            memoryStorageKey = "";
            return null;
          }

          if (memoryStorageKey !== storageKey) {
            memoryRequest = null;
            memoryStorageKey = storageKey;
          }

          if (memoryRequest) return memoryRequest;
          if (!storage || typeof storage.getItem !== "function") return null;

          try {
            var parsed = JSON.parse(storage.getItem(storageKey) || "null");
            if (!parsed) return null;
            memoryRequest = toStoredRequest(parsed);
            return memoryRequest;
          } catch (_error) {
            safelyRemove(storageKey);
            return null;
          }
        }

        function ensure(ticketValue) {
          var storageKey = getStorageKey();
          var ticket = contracts.normalizeTicket(ticketValue);

          if (!storageKey) {
            throw contracts.createError(
              "LOTTERY_SESSION_NOT_READY",
              "會員身分尚未準備完成，請重新開啟抽獎券。"
            );
          }

          var stored = read();
          if (stored) {
            if (
              stored.cardRoundKey !== ticket.cardRoundKey ||
              stored.lotteryTypeId !== ticket.lotteryTypeId
            ) {
              throw contracts.createError(
                "REQUEST_ID_CONFLICT",
                "請先完成上一次尚未揭曉的抽獎。"
              );
            }
            return stored;
          }

          var request = Object.freeze({
            requestId: contracts.normalizeRequestId(options.createRequestId()),
            settingVersion: ticket.settingVersion,
            cardNumber: ticket.cardNumber,
            milestonePoints: ticket.milestonePoints,
            lotteryTypeId: ticket.lotteryTypeId,
            cardRoundKey: ticket.cardRoundKey,
          });

          memoryRequest = request;
          memoryStorageKey = storageKey;

          if (storage && typeof storage.setItem === "function") {
            try {
              storage.setItem(storageKey, JSON.stringify(request));
            } catch (_error) {
              // The in-memory value still prevents duplicate requests in this page.
            }
          }

          return request;
        }

        function clear() {
          var storageKey = memoryStorageKey || getStorageKey();
          memoryRequest = null;
          memoryStorageKey = getStorageKey();
          safelyRemove(storageKey);
        }

        return Object.freeze({
          read: read,
          ensure: ensure,
          clear: clear,
          getStorageKey: getStorageKey,
          normalizeTicket: contracts.normalizeTicket,
        });
      }

      return Object.freeze({ create: create });
    }
  );
})(window);
