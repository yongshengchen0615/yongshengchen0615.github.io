(function (global) {
  "use strict";

  var namespace =
    global.MemberLotteryPreparation || Object.create(null);

  function createPendingRequestStore(options) {
    options = options && typeof options === "object" ? options : {};

    var storage = options.storage;
    var getStorageKey = options.getStorageKey;
    var createRequestId = options.createRequestId;
    var normalizeTicket = options.normalizeTicket;

    if (!storage || typeof storage.getItem !== "function") {
      throw createError(
        "INVALID_STORE_CONFIGURATION",
        "PendingRequestStore 需要 sessionStorage 相容介面。"
      );
    }
    if (typeof getStorageKey !== "function") {
      throw createError(
        "INVALID_STORE_CONFIGURATION",
        "PendingRequestStore 需要 getStorageKey()。"
      );
    }
    if (typeof createRequestId !== "function") {
      throw createError(
        "INVALID_STORE_CONFIGURATION",
        "PendingRequestStore 需要 createRequestId()。"
      );
    }
    if (typeof normalizeTicket !== "function") {
      throw createError(
        "INVALID_STORE_CONFIGURATION",
        "PendingRequestStore 需要 normalizeTicket()。"
      );
    }

    function read() {
      var key = storageKey();
      if (!key) return null;

      try {
        var value = JSON.parse(storage.getItem(key) || "null");
        if (
          !value ||
          !/^[a-zA-Z0-9-]{10,80}$/.test(String(value.requestId || ""))
        ) {
          return null;
        }

        var ticket = normalizeTicket(value);
        ticket.requestId = String(value.requestId);
        return ticket;
      } catch (_error) {
        return null;
      }
    }

    function ensure(ticketValue) {
      var ticket = normalizeTicket(ticketValue);
      var existing = read();

      if (existing) {
        if (
          existing.cardRoundKey !== ticket.cardRoundKey ||
          existing.lotteryTypeId !== ticket.lotteryTypeId
        ) {
          throw createError(
            "REQUEST_ID_CONFLICT",
            "請先完成上一次尚未揭曉的抽獎。"
          );
        }
        return existing;
      }

      var key = storageKey();
      if (!key) {
        throw createError(
          "LOTTERY_SESSION_NOT_READY",
          "會員身分尚未準備完成。"
        );
      }

      var request = {
        requestId: String(createRequestId() || ""),
        settingVersion: ticket.settingVersion,
        cardNumber: ticket.cardNumber,
        milestonePoints: ticket.milestonePoints,
        lotteryTypeId: ticket.lotteryTypeId,
        cardRoundKey: ticket.cardRoundKey,
      };

      if (!/^[a-zA-Z0-9-]{10,80}$/.test(request.requestId)) {
        throw createError(
          "INVALID_REQUEST_ID",
          "無法建立安全的抽獎請求識別碼。"
        );
      }

      storage.setItem(key, JSON.stringify(request));
      return request;
    }

    function clear() {
      var key = storageKey();
      if (!key) return;
      try {
        storage.removeItem(key);
      } catch (_error) {
        // Storage failure must not hide the original draw outcome.
      }
    }

    function storageKey() {
      return String(getStorageKey() || "").trim();
    }

    return Object.freeze({
      read: read,
      ensure: ensure,
      clear: clear,
    });
  }

  function createError(code, message) {
    var value = new Error(message);
    value.code = code;
    return value;
  }

  namespace.createPendingRequestStore = createPendingRequestStore;
  global.MemberLotteryPreparation = namespace;
})(window);
