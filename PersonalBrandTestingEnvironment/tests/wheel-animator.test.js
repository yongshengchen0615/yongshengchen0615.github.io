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
  vm.runInContext(
    source,
    vm.createContext({
      window,
      Object,
      Array,
      Boolean,
      Error,
      Math,
      Number,
      Promise,
      String,
    })
  );
  return registry.get("lottery.wheel-animator");
}

function normalizedRotation(value) {
  return ((Number(value) % 360) + 360) % 360;
}

function createFrameRuntime() {
  const frames = new Map();
  let nextFrameId = 1;
  return {
    frames,
    runtime: {
      matchMedia() {
        return { matches: false };
      },
      setTimeout(callback) {
        callback();
      },
      requestAnimationFrame(callback) {
        const id = nextFrameId++;
        frames.set(id, callback);
        return id;
      },
      cancelAnimationFrame(id) {
        frames.delete(id);
      },
    },
    runFrame(timestamp) {
      const entry = frames.entries().next().value;
      assert.ok(entry, `expected animation frame at ${timestamp}ms`);
      const [id, callback] = entry;
      frames.delete(id);
      callback(timestamp);
    },
  };
}

test("reduced-motion reveal still aligns the winning sector without scheduling frames", async () => {
  const factory = createFactory();
  const rotor = { style: {} };
  const statuses = [];
  let frameCalls = 0;
  const runtime = {
    matchMedia() {
      return { matches: true };
    },
    setTimeout(callback) {
      callback();
    },
    requestAnimationFrame() {
      frameCalls += 1;
      return 1;
    },
    cancelAnimationFrame() {},
  };
  const animator = factory.create({
    root: runtime,
    rotor,
    canvas: {},
    renderer: {
      draw() {
        return true;
      },
    },
    setStatus(message) {
      statuses.push(message);
    },
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

  assert.equal(frameCalls, 0);
  assert.equal(normalizedRotation(animator.getRotation()), 225);
  assert.equal(animator.getRotation(), 3105);
  assert.equal(rotor.style.transform, "rotate(3105deg)");
  assert.equal(rotor.style.willChange, "auto");
  assert.equal(statuses.at(-1), "正在揭曉抽獎結果…");
});

test("deterministic reveal uses a compositing hint only while motion is active", async () => {
  const factory = createFactory();
  const rotor = { style: {} };
  const frameHarness = createFrameRuntime();
  const animator = factory.create({
    root: frameHarness.runtime,
    rotor,
    canvas: {},
    renderer: {
      draw() {
        return true;
      },
    },
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
  assert.equal(rotor.style.willChange, "auto");
  assert.equal(typeof animator.spinTo, "function");

  const revealPromise = animator.spinTo({ prizeId: "B" }, lottery);
  assert.equal(rotor.style.willChange, "transform");
  assert.equal(animator.getRotation(), 0);

  frameHarness.runFrame(0);
  assert.equal(animator.getRotation(), 0, "first reveal frame starts from rest");
  frameHarness.runFrame(160);
  const accelRotation = animator.getRotation();
  assert.ok(accelRotation > 0, "acceleration phase should begin moving the rotor");

  frameHarness.runFrame(320);
  const accelEndRotation = animator.getRotation();
  assert.ok(accelEndRotation > accelRotation);

  frameHarness.runFrame(1080);
  const cruiseEndRotation = animator.getRotation();
  assert.ok(cruiseEndRotation > accelEndRotation);

  frameHarness.runFrame(2280);
  const decelRotation = animator.getRotation();
  assert.ok(decelRotation > cruiseEndRotation);

  frameHarness.runFrame(3480);
  await revealPromise;

  assert.equal(normalizedRotation(animator.getRotation()), 225);
  assert.equal(rotor.style.transform, `rotate(${animator.getRotation()}deg)`);
  assert.equal(rotor.style.willChange, "auto");
  assert.equal(frameHarness.frames.size, 0);
});

test("prepared config changes redraw prizes before reveal without a visible reset", async () => {
  const factory = createFactory();
  const frameHarness = createFrameRuntime();
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
  let drawCalls = 0;
  const animator = factory.create({
    root: frameHarness.runtime,
    rotor,
    canvas: {},
    renderer: {
      draw() {
        drawCalls += 1;
        return true;
      },
    },
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
  assert.equal(drawCalls, 1);
  const historyLengthBeforeReveal = transformHistory.length;
  const revealPromise = animator.settle({ prizeId: "B" }, authoritativeLottery);

  assert.equal(drawCalls, 2, "new prepared config should redraw once before motion");
  assert.equal(animator.getRotation(), 0);
  assert.equal(
    transformHistory.slice(historyLengthBeforeReveal).includes("rotate(0deg)"),
    false,
    "config redraw must not add a visible reset transform before reveal"
  );

  frameHarness.runFrame(0);
  frameHarness.runFrame(320);
  frameHarness.runFrame(1080);
  frameHarness.runFrame(2280);
  frameHarness.runFrame(3480);
  await revealPromise;

  assert.equal(normalizedRotation(animator.getRotation()), 135);
  assert.equal(rotor.style.willChange, "auto");
});

test("stop cancels an active reveal and releases the compositing hint", () => {
  const factory = createFactory();
  const frameHarness = createFrameRuntime();
  const rotor = { style: {} };
  const animator = factory.create({
    root: frameHarness.runtime,
    rotor,
    canvas: {},
    renderer: {
      draw() {
        return true;
      },
    },
  });
  const lottery = {
    configVersion: "CFG-1",
    prizes: [{ prizeId: "A" }, { prizeId: "B" }],
  };

  animator.prepare(lottery);
  animator.spinTo({ prizeId: "A" }, lottery);
  assert.equal(rotor.style.willChange, "transform");
  assert.equal(frameHarness.frames.size, 1);

  animator.stop();
  assert.equal(frameHarness.frames.size, 0);
  assert.equal(rotor.style.willChange, "auto");
});

test("renderer failure is surfaced as a wheel render error", () => {
  const factory = createFactory();
  const animator = factory.create({
    root: {
      matchMedia() {
        return { matches: true };
      },
      setTimeout,
      requestAnimationFrame() {
        return 1;
      },
      cancelAnimationFrame() {},
    },
    rotor: { style: {} },
    canvas: {},
    renderer: {
      draw() {
        return false;
      },
    },
  });

  assert.throws(
    () => animator.draw([]),
    (error) => error.code === "WHEEL_RENDER_ERROR"
  );
});