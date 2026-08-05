(function (global) {
  "use strict";

  var namespace =
    global.MemberLotteryPreparation || Object.create(null);

  function createPreparationView(options) {
    options = options && typeof options === "object" ? options : {};

    var documentRef = options.document;
    var showToast =
      typeof options.showToast === "function"
        ? options.showToast
        : function () {};

    if (!documentRef || typeof documentRef.getElementById !== "function") {
      throw createError(
        "INVALID_VIEW_CONFIGURATION",
        "PreparationView 需要 document。"
      );
    }

    function loading() {
      setState("member-lottery-loading-state");
      setBusy(true);
      setStatus(
        "正在準備轉盤資料與抽獎結果，完成後按鈕只播放動畫。"
      );
      setButton(true, "準備轉盤", "loading", true);
      setCloseButtons(true);
    }

    function ready() {
      setState("member-lottery-wheel-state");
      setBusy(false);
      setStatus(
        "轉盤資料已準備完成，點選中央直接播放抽獎動畫。"
      );
      setButton(false, "點我抽獎", "ready", false);
      setCloseButtons(true);
    }

    function fail(reason, retryable) {
      var error = normalizeError(reason);
      setBusy(false);

      if (retryable) {
        setState("member-lottery-wheel-state");
        setStatus(
          "轉盤尚未準備完成，點選中央重新準備；不會重複使用抽獎券。"
        );
        setButton(false, "重新準備", "ready", false);
      } else {
        setState("member-lottery-error-state");
        setText(
          "member-lottery-error-code",
          String(error.code || error.name || "DRAW_ERROR").replace(/_/g, " ")
        );
        setText(
          "member-lottery-error-message",
          error.message || "目前無法準備轉盤。"
        );
        setButton(true, "無法抽獎", "disabled", false);
      }

      setCloseButtons(Boolean(retryable));
      toast(error.message || "目前無法準備轉盤。");
    }

    function toast(message) {
      try {
        showToast(String(message || ""));
      } catch (_error) {
        // UI notification failure must not change draw state.
      }
    }

    function setState(activeId) {
      [
        "member-lottery-loading-state",
        "member-lottery-error-state",
        "member-lottery-wheel-state",
        "member-lottery-result-state",
      ].forEach(function (id) {
        var element = byId(id);
        if (element) element.hidden = id !== activeId;
      });
    }

    function setBusy(value) {
      var dialog = byId("member-lottery-dialog");
      if (dialog) dialog.setAttribute("aria-busy", String(value));
    }

    function setStatus(value) {
      setText("member-lottery-spin-status", value);
    }

    function setText(id, value) {
      var element = byId(id);
      if (element) element.textContent = String(value || "");
    }

    function setButton(disabled, label, stateName, busy) {
      var element = byId("member-lottery-spin-button");
      if (!element) return;

      element.disabled = disabled;
      element.dataset.state = stateName;
      element.setAttribute("aria-busy", String(busy));

      var labelElement = element.querySelector("span");
      if (labelElement) labelElement.textContent = label;
      else element.textContent = label;
    }

    function setCloseButtons(disabled) {
      ["member-lottery-close-button", "member-lottery-return-button"].forEach(
        function (id) {
          var element = byId(id);
          if (!element) return;
          element.disabled = disabled;
          element.setAttribute("aria-disabled", String(disabled));
        }
      );
    }

    function byId(id) {
      return documentRef.getElementById(id);
    }

    return Object.freeze({
      loading: loading,
      ready: ready,
      fail: fail,
      toast: toast,
    });
  }

  function normalizeError(reason) {
    if (reason instanceof Error) return reason;
    var value = new Error(
      reason && reason.message
        ? String(reason.message)
        : "目前無法準備轉盤。"
    );
    value.code =
      reason && (reason.code || reason.name)
        ? String(reason.code || reason.name)
        : "DRAW_ERROR";
    return value;
  }

  function createError(code, message) {
    var value = new Error(message);
    value.code = code;
    return value;
  }

  namespace.createPreparationView = createPreparationView;
  global.MemberLotteryPreparation = namespace;
})(window);
