const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const preparationSource = fs.readFileSync(
  path.join(root, "client/lottery/preparation-service.js"),
  "utf8"
);
const drawSource = fs.readFileSync(
  path.join(root, "client/lottery/draw-service.js"),
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

function createContracts() {
  return {
    createError(code, message) {
      const error = new Error(message);
      error.code = code;
      return error;
    },
    normalizeTicket(value) {
      return { ...value };
    },
    assertSuccessfulResponse(response) {
      if (response?.ok === true) return response;
      const error = new Error(response?.message || "backend error");
      error.code = response?.code || "BACKEND_ERROR";
      throw error;
    },
    isDefinitiveNoDrawError(error) {
      return error?.code === "LOTTERY_ROUND_NOT_READY";
    },
  };
}

function loadFactory(source, name) {
  const registry = new Registry();
  registry.set("lottery.contracts", createContracts());
  const window = { PersonaModules: registry };
  window.window = window;
  vm.runInContext(
    source,
    vm.createContext({
      window,
      Array,
      Boolean,
      Date,
      Error,
      Math,
      Number,
      Object,
      Promise,
      String,
    })
  );
  return registry.get(name);
}

function ticket() {
  return { lotteryTypeId: "LTY-A", cardRoundKey: "ROUND-A" };
}

function workspaceResponse(available = true) {
  return {
    ok: true,
    data: {
      access: { allowed: true },
      lotteryTypes: [
        { lotteryTypeId: "LTY-A", lottery: { configVersion: "LCF-A" } },
      ],
      card: { availableRewards: available ? [ticket()] : [] },
      totalPoints: 10,
    },
  };
}

function drawResponse() {
  return {
    ok: true,
    data: {
      draw: { cardRoundKey: "ROUND-A", lotteryTypeId: "LTY-A" },
      lottery: { lotteryTypeId: "LTY-A" },
      lotteryType: { lotteryTypeId: "LTY-A" },
      card: {},
    },
  };
}

function createStore() {
  let pending = null;
  return {
    ensure(value) {
      if (!pending) pending = { ...value, requestId: "request-0001" };
      return pending;
    },
    read() {
      return pending;
    },
    clear() {
      pending = null;
    },
  };
}

test("opening readiness performs only a forced workspace refresh", async () => {
  const factory = loadFactory(preparationSource, "lottery.preparation-service");
  const loads = [];
  let directRequests = 0;
  const service = factory.create({
    request() {
      directRequests += 1;
      throw new Error("unexpected direct request");
    },
    workspaceService: {
      load(options) {
        loads.push(options);
        return Promise.resolve(workspaceResponse(true));
      },
      invalidate() {},
    },
  });

  const response = await service.prepare(ticket());
  assert.equal(response.ok, true);
  assert.equal(loads.length, 1);
  assert.equal(loads[0].force, true);
  assert.equal(directRequests, 0);
});

test("readiness rejection cannot create a pending draw", async () => {
  const factory = loadFactory(preparationSource, "lottery.preparation-service");
  const service = factory.create({
    workspaceService: {
      load() {
        return Promise.resolve(workspaceResponse(false));
      },
      invalidate() {},
    },
  });

  await assert.rejects(
    service.prepare(ticket()),
    (error) => error.code === "LOTTERY_ROUND_NOT_READY"
  );
  assert.doesNotMatch(preparationSource, /\.ensure\(|["']drawLottery["']/);
});

test("draw service creates the request only when formal draw starts", async () => {
  const factory = loadFactory(drawSource, "lottery.draw-service");
  const store = createStore();
  const calls = [];
  const service = factory.create({
    store,
    request(action, fields, requestId) {
      calls.push({ action, fields, requestId });
      return Promise.resolve(drawResponse());
    },
    workspaceService: { invalidate() {} },
  });

  assert.equal(store.read(), null);
  await service.draw(ticket());
  assert.equal(calls.length, 1);
  assert.equal(calls[0].action, "drawLottery");
  assert.equal(calls[0].requestId, "request-0001");
  assert.equal(store.read().requestId, "request-0001");
});

test("transient failure keeps the same persistent request id for retry", async () => {
  const factory = loadFactory(drawSource, "lottery.draw-service");
  const store = createStore();
  const ids = [];
  let attempt = 0;
  const service = factory.create({
    store,
    request(_action, _fields, requestId) {
      ids.push(requestId);
      attempt += 1;
      if (attempt === 1) {
        const error = new Error("timeout");
        error.code = "BACKEND_TIMEOUT";
        return Promise.reject(error);
      }
      return Promise.resolve(drawResponse());
    },
    workspaceService: { invalidate() {} },
  });

  await assert.rejects(service.draw(ticket()), (error) => error.code === "BACKEND_TIMEOUT");
  assert.equal(store.read().requestId, "request-0001");
  await service.draw(ticket());
  assert.equal(ids.length, 2);
  assert.equal(ids[0], "request-0001");
  assert.equal(ids[1], "request-0001");
});

test("definitive no-draw failure clears pending and legacy preload modules stay removed", async () => {
  const factory = loadFactory(drawSource, "lottery.draw-service");
  const store = createStore();
  const service = factory.create({
    store,
    request() {
      return Promise.resolve({
        ok: false,
        code: "LOTTERY_ROUND_NOT_READY",
        message: "already used",
      });
    },
    workspaceService: { invalidate() {} },
  });

  await assert.rejects(
    service.draw(ticket()),
    (error) => error.code === "LOTTERY_ROUND_NOT_READY"
  );
  assert.equal(store.read(), null);
  for (const relativePath of [
    "client/member-lottery-preload.js",
    "client/lottery/preload-controller.js",
    "client/lottery/preparation-view.js",
    "client/lottery/wheel-draw-guard.js",
  ]) {
    assert.equal(fs.existsSync(path.join(root, relativePath)), false);
  }
});
