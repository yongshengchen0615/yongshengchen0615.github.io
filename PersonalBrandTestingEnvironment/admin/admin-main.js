(function (root) {
  "use strict";

  var registry = root.PersonaModules;
  if (!registry) {
    throw new Error("PersonaModules must load before admin-main.js.");
  }

  var page = registry.get("admin.page");
  var controller = registry.get("admin.app-controller");
  if (!page || page.name !== controller.page) {
    throw new Error("Administrator page composition does not match the document.");
  }

  controller.bind();
  controller.setCurrentYear();
  controller.start();
})(window);
