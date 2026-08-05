(function (root) {
  "use strict";

  var registry = root.PersonaModules;
  if (!registry) {
    throw new Error("PersonaModules must load before lottery preparation view.");
  }

  registry.define("lottery.preparation-view", [], function () {
    function create(options) {
      options = options && typeof options === "object" ? options : {};
      var documentValue = options.document || null;

      function byId(id) {
        return documentValue && typeof documentValue.getElementById === "function"
          ? documentValue.getElementById(id)
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

      function updateButton(state, label, disabled) {
        var button = byId("member-lottery-spin-button");
        if (!button) return;
        button.disabled = disabled;
        button.dataset.state = state;
        button.setAttribute("aria-busy", String(disabled));
        setButtonLabel(button, label);
      }

      function markPreparing() {
        setText(
          "member-lottery-spin-status",
          "正在準備轉盤，確認最新獎項與本次抽獎結果…"
        );
        updateButton("loading", "載入轉盤", true);
      }

      function markReady() {
        setText(
          "member-lottery-spin-status",
          "轉盤已就緒，點選中央直接揭曉結果。"
        );
        updateButton("ready", "點我抽獎", false);
      }

      return Object.freeze({
        markPreparing: markPreparing,
        markReady: markReady,
      });
    }

    return Object.freeze({ create: create });
  });
})(window);
