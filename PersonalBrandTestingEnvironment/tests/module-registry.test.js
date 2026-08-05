const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const registrySource = fs.readFileSync(
  path.resolve(__dirname, "../shared/module-registry.js"),
  "utf8"
);

function createRegistry() {
  const window = {};
  window.window = window;
  const context = vm.createContext({ Error, Object, String, window });
  vm.runInContext(registrySource, context, { filename: "module-registry.js" });
  return window.PersonaModules;
}

test("resolves modules lazily regardless of definition order", () => {
  const registry = createRegistry();
  registry.define("feature.controller", ["feature.service"], (service) => ({
    value: service.value + 1,
  }));
  registry.define("feature.service", [], () => ({ value: 41 }));

  assert.equal(registry.get("feature.controller").value, 42);
});

test("returns the same singleton instance for repeated get calls", () => {
  const registry = createRegistry();
  let created = 0;
  registry.define("feature.service", [], () => ({ id: ++created }));

  assert.strictEqual(registry.get("feature.service"), registry.get("feature.service"));
  assert.equal(created, 1);
});

test("rejects duplicate registrations", () => {
  const registry = createRegistry();
  registry.define("feature.service", [], () => ({}));

  assert.throws(
    () => registry.define("feature.service", [], () => ({})),
    (error) => error.code === "DUPLICATE_MODULE"
  );
});

test("reports dependency cycles with a stable error code", () => {
  const registry = createRegistry();
  registry.define("feature.a", ["feature.b"], () => ({}));
  registry.define("feature.b", ["feature.a"], () => ({}));

  assert.throws(
    () => registry.get("feature.a"),
    (error) => error.code === "MODULE_CYCLE"
  );
});
