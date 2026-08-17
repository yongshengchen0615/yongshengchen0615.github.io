(function (root) {
  "use strict";

  var registry = root.PersonaModules;
  if (!registry) {
    throw new Error("PersonaModules must load before members-page.js.");
  }

  registry.define("admin.page", [], function () {
    return Object.freeze({ name: "members" });
  });
})(window);
