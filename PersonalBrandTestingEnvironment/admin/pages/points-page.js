(function (root) {
  "use strict";

  var registry = root.PersonaModules;
  if (!registry) {
    throw new Error("PersonaModules must load before points-page.js.");
  }

  registry.define("admin.page", [], function () {
    return Object.freeze({ name: "points" });
  });
})(window);
