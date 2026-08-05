(function (root) {
  "use strict";

  function byId(id) {
    return root.document && root.document.getElementById
      ? root.document.getElementById(id)
      : null;
  }

  function setText(id, value) {
    var element = byId(id);
    if (element) element.textContent = String(value == null ? "" : value);
  }

  function setButtonLabel(button, label) {
    if (!button) return;
    var labelElement =
      typeof button.querySelector === "function"
        ? button.querySelector("span")
        : null;
    if (labelElement) labelElement.textContent = label;
    else button.textContent = label;
  }

  function create() {
    function markPreparing() {
      setText(
        "member-lottery-spin-status",
        "正在準備轉盤，確認最新獎項與本次抽獎結果…"
      );
      var button = byId("member-lottery-spin-button");
      if (button) {
        button.disabled = true;
        button.dataset.state = "loading";
        setButtonLabel(button, "載入轉盤");
      }
    }

    function markReady() {
      setText(
        "member-lottery-spin-status",
        "轉盤已就緒，點選中央直接揭曉結果。"
      );
      var button = byId("member-lottery-spin-button");
      if (button) {
        button.disabled = false;
        button.dataset.state = "ready";
        button.setAttribute("aria-busy", "false");
        setButtonLabel(button, "點我抽獎");
      }
    }

    return Object.freeze({
      markPreparing: markPreparing,
      markReady: markReady,
    });
  }

  root.MemberLotteryPreparationView = Object.freeze({
    create: create,
  });
})(window);
