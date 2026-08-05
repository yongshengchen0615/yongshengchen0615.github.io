(function () {
  "use strict";

  var original = window.MemberLotteryDialog;
  if (!original || typeof original.configure !== "function") return;

  var options = null;
  var request = null;
  var prepared = Object.create(null);
  var preparing = false;
  var version = 0;
  var bound = false;
  var PREFIX = "persona-member-lottery-round-request:";
  var REVEAL_DELAY_MS = 1250;

  function configure(value) {
    options = value && typeof value === "object" ? value : {};
    request = options.request;
    if (typeof request !== "function") return original.configure(options);

    var wrapped = {};
    Object.keys(options).forEach(function (key) {
      wrapped[key] = options[key];
    });
    wrapped.request = requestPrepared;
    original.configure(wrapped);
    bind();
    return api;
  }

  function open(ticket) {
    var current = ++version;
    return Promise.resolve(original.open(ticket)).then(function (opened) {
      if (!opened || isDemo()) return opened;
      return prepare(readPending() || ticket, current).then(function () {
        return true;
      });
    });
  }

  function restorePending() {
    var current = ++version;
    return Promise.resolve(original.restorePending()).then(function (opened) {
      if (!opened || isDemo()) return opened;
      var pending = readPending();
      return pending
        ? prepare(pending, current).then(function () { return true; })
        : false;
    });
  }

  function requestPrepared(action, fields, requestId) {
    if (action !== "drawLottery" || !requestId || !prepared[requestId]) {
      return request(action, fields, requestId);
    }
    var item = prepared[requestId];
    if (
      String((fields && fields.lotteryTypeId) || "") !== item.lotteryTypeId ||
      String((fields && fields.cardRoundKey) || "") !== item.cardRoundKey
    ) {
      return Promise.reject(error("REQUEST_ID_CONFLICT", "抽獎券與已準備結果不一致。"));
    }
    delete prepared[requestId];
    return new Promise(function (resolve) {
      window.setTimeout(function () { resolve(item.response); }, REVEAL_DELAY_MS);
    });
  }

  function prepare(ticketValue, expectedVersion) {
    var ticket;
    var pending;
    try {
      ticket = normalize(ticketValue);
      pending = ensurePending(ticket);
    } catch (reason) {
      fail(reason, false);
      return Promise.resolve(false);
    }

    preparing = true;
    loading();
    return Promise.resolve(
      request(
        "drawLottery",
        {
          lotteryTypeId: ticket.lotteryTypeId,
          cardRoundKey: ticket.cardRoundKey,
        },
        pending.requestId
      )
    )
      .then(function (response) {
        if (expectedVersion !== version) return false;
        if (!response || response.ok !== true) {
          throw error(
            response && response.code ? response.code : "BACKEND_ERROR",
            response && response.message ? response.message : "後台目前無法準備抽獎結果。"
          );
        }
        prepared[pending.requestId] = {
          response: response,
          lotteryTypeId: ticket.lotteryTypeId,
          cardRoundKey: ticket.cardRoundKey,
        };
        preparing = false;
        ready();
        return true;
      })
      .catch(function (reason) {
        if (expectedVersion !== version) return false;
        preparing = false;
        var definitive = definitiveNoDraw(reason);
        if (definitive) clearPending();
        fail(reason, !definitive);
        return false;
      });
  }

  function bind() {
    if (bound) return;
    var button = byId("member-lottery-spin-button");
    if (!button) return;
    bound = true;
    button.addEventListener("click", function (event) {
      if (isDemo()) return;
      var pending = readPending();
      if (!preparing && pending && prepared[pending.requestId]) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!preparing && pending) prepare(pending, ++version);
    }, true);
  }

  function normalize(value) {
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
      !Number.isSafeInteger(ticket.cardNumber) || ticket.cardNumber < 1 ||
      !Number.isSafeInteger(ticket.milestonePoints) || ticket.milestonePoints < 1 ||
      !/^LTY-[A-Z0-9]{10}$/.test(ticket.lotteryTypeId) ||
      ticket.cardRoundKey !== ticket.settingVersion + ":" + ticket.cardNumber + ":" + ticket.milestonePoints
    ) throw error("INVALID_LOTTERY_TICKET", "抽獎券資料格式不正確。");
    return ticket;
  }

  function ensurePending(ticket) {
    var existing = readPending();
    if (existing) {
      if (existing.cardRoundKey !== ticket.cardRoundKey || existing.lotteryTypeId !== ticket.lotteryTypeId) {
        throw error("REQUEST_ID_CONFLICT", "請先完成上一次尚未揭曉的抽獎。");
      }
      return existing;
    }
    var key = storageKey();
    if (!key) throw error("LOTTERY_SESSION_NOT_READY", "會員身分尚未準備完成。");
    var value = {
      requestId: window.MemberApi.createRequestId(),
      settingVersion: ticket.settingVersion,
      cardNumber: ticket.cardNumber,
      milestonePoints: ticket.milestonePoints,
      lotteryTypeId: ticket.lotteryTypeId,
      cardRoundKey: ticket.cardRoundKey,
    };
    window.sessionStorage.setItem(key, JSON.stringify(value));
    return value;
  }

  function readPending() {
    var key = storageKey();
    if (!key) return null;
    try {
      var value = JSON.parse(window.sessionStorage.getItem(key) || "null");
      if (!value || !/^[a-zA-Z0-9-]{10,80}$/.test(String(value.requestId || ""))) return null;
      var ticket = normalize(value);
      ticket.requestId = String(value.requestId);
      return ticket;
    } catch (_error) {
      return null;
    }
  }

  function clearPending() {
    try { window.sessionStorage.removeItem(storageKey()); } catch (_error) {}
  }

  function storageKey() {
    if (!options) return "";
    var liffId = String(options.liffId || "unknown");
    if (isDemo()) return PREFIX + liffId + ":demo";
    var memberId = "";
    try { memberId = String(options.getMemberId() || "").trim(); } catch (_error) {}
    return /^MBR-[A-Z0-9]{10}$/.test(memberId) ? PREFIX + liffId + ":" + memberId : "";
  }

  function loading() {
    state("member-lottery-loading-state");
    busy(true);
    status("正在安全準備抽獎結果，完成後即可直接旋轉。");
    button(true, "準備結果", "loading");
    closeButtons(true);
  }

  function ready() {
    state("member-lottery-wheel-state");
    busy(false);
    status("轉盤已就緒，點選中央直接揭曉結果。");
    button(false, "點我抽獎", "ready");
    closeButtons(true);
  }

  function fail(reason, retryable) {
    busy(false);
    if (retryable) {
      state("member-lottery-wheel-state");
      status("結果尚未準備完成，點選中央重新準備；不會重複使用抽獎券。");
      button(false, "重新準備", "ready");
    } else {
      state("member-lottery-error-state");
      text("member-lottery-error-code", String((reason && (reason.code || reason.name)) || "DRAW_ERROR").replace(/_/g, " "));
      text("member-lottery-error-message", reason && reason.message ? reason.message : "目前無法準備抽獎結果。");
      button(true, "無法抽獎", "disabled");
    }
    closeButtons(retryable);
    toast(reason && reason.message ? reason.message : "目前無法準備抽獎結果。");
  }

  function state(active) {
    ["member-lottery-loading-state", "member-lottery-error-state", "member-lottery-wheel-state", "member-lottery-result-state"].forEach(function (id) {
      var element = byId(id);
      if (element) element.hidden = id !== active;
    });
  }
  function busy(value) { var dialog = byId("member-lottery-dialog"); if (dialog) dialog.setAttribute("aria-busy", String(value)); }
  function status(value) { text("member-lottery-spin-status", value); }
  function text(id, value) { var element = byId(id); if (element) element.textContent = String(value || ""); }
  function button(disabled, label, stateName) {
    var element = byId("member-lottery-spin-button");
    if (!element) return;
    element.disabled = disabled;
    element.dataset.state = stateName;
    element.setAttribute("aria-busy", String(preparing));
    var labelElement = element.querySelector("span");
    if (labelElement) labelElement.textContent = label; else element.textContent = label;
  }
  function closeButtons(disabled) {
    ["member-lottery-close-button", "member-lottery-return-button"].forEach(function (id) {
      var element = byId(id);
      if (!element) return;
      element.disabled = disabled;
      element.setAttribute("aria-disabled", String(disabled));
    });
  }
  function definitiveNoDraw(reason) {
    var code = String((reason && (reason.code || reason.name)) || "");
    return code === "LOTTERY_ROUND_NOT_READY" || code === "LOTTERY_TICKET_MISMATCH" || code === "INVALID_LOTTERY_TICKET";
  }
  function isDemo() { try { return options && options.isDemo() === true; } catch (_error) { return false; } }
  function toast(message) { try { if (options && typeof options.showToast === "function") options.showToast(String(message || "")); } catch (_error) {} }
  function byId(id) { return document.getElementById(id); }
  function error(code, message) { var value = new Error(message); value.code = code; return value; }

  var api = Object.freeze({
    configure: configure,
    open: open,
    restorePending: restorePending,
    hasPending: function () { return original.hasPending(); },
    canClose: function () { return !preparing && original.canClose(); },
    requestClose: function (value) {
      if (preparing) { toast("抽獎結果正在安全準備，完成前請勿關閉。"); return false; }
      version += 1;
      return original.requestClose(value);
    },
  });

  window.MemberLotteryDialog = api;
})();
