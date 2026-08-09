(function (root) {
  "use strict";

  var registry = root.PersonaModules;
  if (!registry) {
    throw new Error("PersonaModules must load before member-lottery-v2.js.");
  }

  var controllerFactory = registry.get("lottery.dialog-controller");
  if (!controllerFactory || typeof controllerFactory.create !== "function") {
    throw new Error("lottery.dialog-controller must load before member-lottery-v2.js.");
  }

  // V2 is intentionally a thin composition root. The authenticated loader may
  // preload getLotteryConfig so ticket validation and Canvas preparation are
  // ready before the dialog opens, but it must never pre-execute drawLottery.
  // The persistent draw request id is created by DrawService only after the
  // member presses the central draw button. That click is the transaction
  // boundary that consumes the ticket and creates the authoritative draw.
  root.MemberLotteryDialog = controllerFactory.create({
    root: root,
    document: root.document,
    memberApi: root.MemberApi,
    wheelRenderer: root.LotteryWheel,
  });
})(window);
