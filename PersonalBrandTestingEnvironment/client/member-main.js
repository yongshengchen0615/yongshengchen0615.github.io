(function (root) {
  "use strict";

  var registry = root.PersonaModules;
  if (!registry) {
    throw new Error("PersonaModules must load before member-main.js.");
  }

  var controller = registry.get("member.app-controller");
  controller.bind();
  controller.setCurrentYear();
  controller.start();
})(window);
