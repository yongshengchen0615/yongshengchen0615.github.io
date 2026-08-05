(function (root) {
  "use strict";

  var registry = root.PersonaModules;
  if (!registry) {
    throw new Error("PersonaModules must load before member-lottery-v2.js.");
  }

  var controllerFactory = registry.get("lottery.dialog-controller");
  root.MemberLotteryDialog = controllerFactory.create({
    root: root,
    document: root.document,
    memberApi: root.MemberApi,
    wheelRenderer: root.LotteryWheel,
  });
})(window);
