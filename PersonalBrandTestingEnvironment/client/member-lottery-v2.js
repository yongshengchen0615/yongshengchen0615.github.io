(function (root) {
  "use strict";

  var registry = root.PersonaModules;
  if (!registry) {
    throw new Error("PersonaModules must load before member-lottery-v2.js.");
  }

  var ticketRefreshUiVersion = 0;

  function isDialogOpen(dialog) {
    if (!dialog) return false;
    if (dialog.open === true) return true;
    return Boolean(
      typeof dialog.hasAttribute === "function" && dialog.hasAttribute("open")
    );
  }

  function schedule(callback) {
    if (typeof root.setTimeout === "function") {
      root.setTimeout(callback, 0);
      return;
    }
    Promise.resolve().then(callback);
  }

  function scheduleTicketRefreshUi(detail) {
    detail = detail && typeof detail === "object" ? detail : {};
    var state = String(detail.state || "");
    if (state !== "loading" && state !== "ready" && state !== "error") {
      return;
    }
    if (detail.source !== "network" || detail.current === false) return;

    var version = ++ticketRefreshUiVersion;
    schedule(function () {
      if (version !== ticketRefreshUiVersion) return;
      var documentValue = root.document;
      if (!documentValue || typeof documentValue.getElementById !== "function") {
        return;
      }

      var dialog = documentValue.getElementById("member-ticket-dialog");
      var status = documentValue.getElementById("member-ticket-refresh-status");
      if (!dialog || !status || !isDialogOpen(dialog)) return;

      if (state === "loading") {
        dialog.setAttribute("aria-busy", "true");
        status.textContent = "正在背景同步最新抽獎券；目前票券仍可直接選擇。";
        status.dataset.tone = "loading";
        return;
      }

      dialog.setAttribute("aria-busy", "false");
      if (state === "ready") {
        status.textContent = "最新抽獎券狀態已同步，可直接選擇票券。";
        status.dataset.tone = "ready";
        return;
      }

      status.textContent =
        "背景同步暫時失敗；目前票券仍可選擇，開啟轉盤時會再次安全驗證。";
      status.dataset.tone = "warning";
    });
  }

  if (typeof root.addEventListener === "function") {
    root.addEventListener("persona:lottery-workspace-state", function (event) {
      scheduleTicketRefreshUi(event && event.detail);
    });
  }

  var controllerFactory = registry.get("lottery.dialog-controller");
  root.MemberLotteryDialog = controllerFactory.create({
    root: root,
    document: root.document,
    memberApi: root.MemberApi,
    wheelRenderer: root.LotteryWheel,
  });
})(window);
