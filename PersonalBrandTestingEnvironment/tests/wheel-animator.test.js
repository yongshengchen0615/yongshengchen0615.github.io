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

  assert.equal(animator.getRotation(), 1305);
  assert.equal(rotor.style.transform, "rotate(1305deg)");
  assert.equal(statuses.at(-1), "轉盤旋轉中，請稍候結果…");
});

test("pending spin starts without a prize and settles continuously after the authoritative result", async () => {
  const factory = createFactory();
  const rotor = { style: {} };
  const frames = new Map();
  let nextFrameId = 1;
  const runtime = {
    matchMedia() { return { matches: false }; },
    setTimeout(callback) { callback(); },
    requestAnimationFrame(callback) {
      const id = nextFrameId++;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) {
      frames.delete(id);
    },
  };
  function runFrame(timestamp) {
    const entry = frames.entries().next().value;
    assert.ok(entry, `expected animation frame at ${timestamp}ms`);
    const [id, callback] = entry;
    frames.delete(id);
    callback(timestamp);
  }

  const animator = factory.create({
    root: runtime,
    rotor,
    canvas: {},
    renderer: { draw() { return true; } },
  });
  const lottery = {
    configVersion: "CFG-1",
    prizes: [
      { prizeId: "A" },
      { prizeId: "B" },
      { prizeId: "C" },
      { prizeId: "D" },
    ],
  };

  animator.prepare(lottery);
  assert.equal(typeof animator.startPendingSpin, "function");
  assert.equal(animator.startPendingSpin(), true);
  runFrame(0);
  runFrame(100);

  const pendingRotation = animator.getRotation();
  assert.ok(pendingRotation > 0, "pending spin should move before a prize exists");

  const settlePromise = animator.settle({ prizeId: "B" }, lottery);
  runFrame(100);
  runFrame(1200);
  runFrame(2300);
  runFrame(3400);
  await settlePromise;

  const settledRotation = animator.getRotation();
  assert.ok(settledRotation > pendingRotation, "settlement should continue from the pending rotation");
  assert.equal(((settledRotation % 360) + 360) % 360, 225);
  assert.equal(rotor.style.transform, `rotate(${settledRotation}deg)`);
});

test("authoritative config changes redraw prizes without resetting pending rotation", async () => {
  const factory = createFactory();
  const frames = new Map();
  let nextFrameId = 1;
  let transformValue = "";
  const transformHistory = [];
  const style = {};
  Object.defineProperty(style, "transform", {
    get() {
      return transformValue;
    },
    set(value) {
      transformValue = value;
      transformHistory.push(value);
    },
  });
  const rotor = { style };
  const runtime = {
    matchMedia() { return { matches: false }; },
    setTimeout(callback) { callback(); },
    requestAnimationFrame(callback) {
      const id = nextFrameId++;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) {
      frames.delete(id);
    },
  };
  function runFrame(timestamp) {
    const entry = frames.entries().next().value;
    assert.ok(entry, `expected animation frame at ${timestamp}ms`);
    const [id, callback] = entry;
    frames.delete(id);
    callback(timestamp);
  }

  const animator = factory.create({
    root: runtime,
    rotor,
    canvas: {},
    renderer: { draw() { return true; } },
  });
  const preparedLottery = {
    configVersion: "CFG-1",
    prizes: [
      { prizeId: "A" },
      { prizeId: "B" },
      { prizeId: "C" },
      { prizeId: "D" },
    ],
  };
  const authoritativeLottery = {
    configVersion: "CFG-2",
    prizes: [
      { prizeId: "A" },
      { prizeId: "C" },
      { prizeId: "B" },
      { prizeId: "D" },
    ],
  };

  animator.prepare(preparedLottery);
  animator.startPendingSpin();
  runFrame(0);
  runFrame(100);

  const pendingRotation = animator.getRotation();
  const pendingTransform = rotor.style.transform;
  const historyLengthBeforeSettle = transformHistory.length;
  const settlePromise = animator.settle({ prizeId: "B" }, authoritativeLottery);

  assert.equal(animator.getRotation(), pendingRotation);
  assert.equal(rotor.style.transform, pendingTransform);
  assert.equal(
    transformHistory.slice(historyLengthBeforeSettle).includes("rotate(0deg)"),
    false,
    "authoritative config refresh must not visibly reset the spinning rotor"
  );

  runFrame(100);
  runFrame(1200);
  runFrame(2300);
  runFrame(3400);
  await settlePromise;

  assert.equal(((animator.getRotation() % 360) + 360) % 360, 135);
});

test("pending spin respects reduced motion and does not schedule continuous frames", () => {
  const factory = createFactory();
  let frameCalls = 0;
  const animator = factory.create({
    root: {
      matchMedia() { return { matches: true }; },
      setTimeout(callback) { callback(); },
      requestAnimationFrame() {
        frameCalls += 1;
        return 1;
      },
      cancelAnimationFrame() {},
    },
    rotor: { style: {} },
    canvas: {},
    renderer: { draw() { return true; } },
  });

  assert.equal(animator.startPendingSpin(), false);
  assert.equal(frameCalls, 0);
  assert.equal(animator.getRotation(), 0);
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