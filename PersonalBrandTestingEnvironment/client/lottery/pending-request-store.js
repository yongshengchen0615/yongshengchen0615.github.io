(function (root) {
  "use strict";

  var REQUEST_STORAGE_PREFIX = "persona-member-lottery-round-request:";

  function createError(code, message) {
    var error = new Error(message);
    error.code = code;
    return error;
  }

  function normalizeTicket(value) {
    value = value && typeof value === "object" ? value : {};

    var ticket = {
      settingVersion: String(value.settingVersion || "").trim(),
      cardNumber: Number(value.cardNumber),
      milestonePoints: Number(value.milestonePoints),
      lotteryTypeId: String(value.lotteryTypeId || "").trim(),
      cardRoundKey: String(value.cardRoundKey || "").trim(),
    };

    if (
      !/^PCS-[A-Z0-9]{12}$/.test(ticket.settingVersion) ||
      !Number.isSafeInteger(ticket.cardNumber) ||
      ticket.cardNumber < 1 ||
      !Number.isSafeInteger(ticket.milestonePoints) ||
      ticket.milestonePoints < 1 ||
      ticket.milestonePoints > 9999 ||
      !/^LTY-[A-Z0-9]{10}$/.test(ticket.lotteryTypeId) ||
      ticket.cardRoundKey !==
        ticket.settingVersion +
          ":" +
          ticket.cardNumber +
          ":" +
          ticket.milestonePoints
    ) {
      throw createError(
        "INVALID_LOTTERY_TICKET",
        "抽獎券資料格式不正確。"
      );
    }

    return ticket;
  }

  function create(options) {
    options = options && typeof options === "object" ? options : {};

    if (typeof options.createRequestId !== "function") {
      throw createError(
        "INVALID_CONFIGURATION",
        "PendingRequestStore 需要 createRequestId。"
      );
    }

    var memoryRequest = null;
    var memoryStorageKey = "";

    function safeIsDemo() {
      try {
        return typeof options.isDemo === "function" && options.isDemo() === true;
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

    function isValidStoredRequest(value) {
      try {
        normalizeTicket(value);
        return /^[A-Za-z0-9-]{10,80}$/.test(String(value.requestId || ""));
      } catch (_error) {
        return false;
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

      if (memoryRequest) {
        return memoryRequest;
      }

      try {
        var parsed = JSON.parse(
          root.sessionStorage.getItem(storageKey) || "null"
        );

        if (parsed && isValidStoredRequest(parsed)) {
          var ticket = normalizeTicket(parsed);
          memoryRequest = {
            requestId: String(parsed.requestId),
            settingVersion: ticket.settingVersion,
            cardNumber: ticket.cardNumber,
            milestonePoints: ticket.milestonePoints,
            lotteryTypeId: ticket.lotteryTypeId,
            cardRoundKey: ticket.cardRoundKey,
          };
          return memoryRequest;
        }

        if (parsed) {
          root.sessionStorage.removeItem(storageKey);
        }
      } catch (_error) {
        // Treat unavailable or invalid sessionStorage as empty.
      }

      return null;
    }

    function ensure(ticketValue) {
      var storageKey = getStorageKey();
      var ticket = normalizeTicket(ticketValue);

      if (!storageKey) {
        throw createError(
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
          throw createError(
            "REQUEST_ID_CONFLICT",
            "請先完成上一次尚未揭曉的抽獎。"
          );
        }
        return stored;
      }

      var request = {
        requestId: String(options.createRequestId()),
        settingVersion: ticket.settingVersion,
        cardNumber: ticket.cardNumber,
        milestonePoints: ticket.milestonePoints,
        lotteryTypeId: ticket.lotteryTypeId,
        cardRoundKey: ticket.cardRoundKey,
      };

      if (!/^[A-Za-z0-9-]{10,80}$/.test(request.requestId)) {
        throw createError(
          "INVALID_REQUEST_ID",
          "無法建立安全的抽獎請求識別碼。"
        );
      }

      memoryRequest = request;
      memoryStorageKey = storageKey;

      try {
        root.sessionStorage.setItem(storageKey, JSON.stringify(request));
      } catch (_error) {
        // In-memory persistence still prevents duplicate requests in this page.
      }

      return request;
    }

    function clear() {
      var storageKey = memoryStorageKey || getStorageKey();
      memoryRequest = null;
      memoryStorageKey = getStorageKey();

      try {
        if (storageKey) {
          root.sessionStorage.removeItem(storageKey);
        }
      } catch (_error) {
        // Ignore unavailable sessionStorage.
      }
    }

    return Object.freeze({
      read: read,
      ensure: ensure,
      clear: clear,
      getStorageKey: getStorageKey,
      normalizeTicket: normalizeTicket,
    });
  }

  root.MemberLotteryPendingRequestStore = Object.freeze({
    create: create,
  });
})(window);
