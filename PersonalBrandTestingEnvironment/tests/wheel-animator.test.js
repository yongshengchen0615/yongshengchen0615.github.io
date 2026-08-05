const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.resolve(__dirname, "../client/lottery/wheel-animator.js"),
  "utf8"
);

class Registry {
  constructor() {
    this.definitions = new Map();
    this.instances = new Map();
  }
  define(name, dependencies, factory) {
    this.definitions.set(name, { dependencies, factory });
  }
  set(name, value) {
    this.instances.set(name, value);
  }
  get(name) {
    if (this.instances.has(name)) return this.instances.get(name);
    const definition = this.definitions.get(name);
    const value = definition.factory(
      ...definition.dependencies.map((dependency) => this.get(dependency))
    );
    this.instances.set(name, value);
    return value;
  }
}

function createFactory() {
  const registry = new Registry();
  registry.set("lottery.contracts", {
    createError(code, message) {
      const error = new Error(message);
      error.code = code;
      return error;
    },
  });
  const window = { PersonaModules: registry };
  window.window = window;
  vm.runInContext(source, vm.createContext({
    window,
    Object,
    Array,
    Boolean,
    Error,
    Math,
    Number,
    Promise,
    String,
  }));
  return registry.get("lottery.wheel-animator");
}

test("reduced-motion settlement still aligns the winning sector", async () => {
  const factory = createFactory();
  const rotor = { style: {} };
  const statuses = [];
  const runtime = {
    matchMedia() { return { matches: true }; },
    setTimeout(callback) { callback(); },
    requestAnimationFrame() { throw new Error("unexpected animation frame"); },
    cancelAnimationFrame() {},
  };
  const animator = factory.create({
    root: runtime,
    rotor,
    canvas: {},
    renderer: { draw() { return true; } },
    setStatus(message) { statuses.push(message); },
  });
  const lottery = {
    prizes: [
      { prizeId: "A" },
      { prizeId: "B" },
      { prizeId: "C" },
      { prizeId: "D" },
    ],
  };

  animator.reset();
  await animator.settle({ prizeId: "B" }, lottery);

  assert.equal(animator.getRotation(), 945);
  assert.equal(rotor.style.transform, "rotate(945deg)");
  assert.equal(statuses.at(-1), "轉盤旋轉中，請稍候結果…");
});

test("renderer failure is surfaced as a wheel render error", () => {
  const factory = createFactory();
  const animator = factory.create({
    root: {
      matchMedia() { return { matches: true }; },
      setTimeout,
      requestAnimationFrame() { return 1; },
      cancelAnimationFrame() {},
    },
    rotor: { style: {} },
    canvas: {},
    renderer: { draw() { return false; } },
  });

  assert.throws(
    () => animator.draw([]),
    (error) => error.code === "WHEEL_RENDER_ERROR"
  );
});
