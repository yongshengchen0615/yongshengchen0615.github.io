const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.resolve(__dirname, "../client/lottery/draw-service.js"),
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
    normalizeTicket(value) {
      return { ...value };
    },
    assertSuccessfulResponse(response) {
      if (!response || response.ok !== true) {
        const error = new Error(response?.message || "backend error");
        error.code = response?.code || "BACKEND_ERROR";
        throw error;
      }
      return response;
    },
    isDefinitiveNoDrawError(error) {
      return [
        "LOTTERY_ROUND_NOT_READY",
        "LOTTERY_TICKET_MISMATCH",
        "MEMBER_ACCESS_DENIED",
      ].includes(error?.code);
    },
  });
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
  return registry.get("lottery.draw-service");
}

function ticket() {
  return {
    lotteryTypeId: "LTY-A",
    cardRoundKey: "ROUND-A",
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

test("draw starts only when draw service is invoked and coalesces rapid repeats", async () => {
  const factory = createFactory();
  const store = createStore();
  let resolveRequest;
  let calls = 0;
  const service = factory.create({
    store,
    request(action, fields, requestId) {
      calls += 1;
      assert.equal(action, "drawLottery");
      assert.equal(fields.lotteryTypeId, "LTY-A");
      assert.equal(fields.cardRoundKey, "ROUND-A");
      assert.equal(requestId, "request-0001");
      return new Promise((resolve) => {
        resolveRequest = resolve;
      });
    },
    workspaceService: { invalidate() {} },
  });

  assert.equal(store.read(), null);
  const first = service.draw(ticket());
  const second = service.draw(ticket());
  assert.equal(first, second);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(calls, 1);
  assert.equal(store.read().requestId, "request-0001");
  assert.equal(typeof resolveRequest, "function");
  resolveRequest(drawResponse());
  await first;
});

test("an ambiguous network failure keeps the same request id for safe retry", async () => {
  const factory = createFactory();
  const store = createStore();
  const requestIds = [];
  let attempt = 0;
  const service = factory.create({
    store,
    request(_action, _fields, requestId) {
      requestIds.push(requestId);
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
  assert.equal(requestIds.length, 2);
  assert.equal(requestIds[0], "request-0001");
  assert.equal(requestIds[1], "request-0001");
});

test("definitive no-draw errors clear the pending transaction", async () => {
  const factory = createFactory();
  const store = createStore();
  const service = factory.create({
    store,
    request() {
      return Promise.resolve({
        ok: false,
        code: "LOTTERY_ROUND_NOT_READY",
        message: "used",
      });
    },
    workspaceService: { invalidate() {} },
  });

  await assert.rejects(
    service.draw(ticket()),
    (error) => error.code === "LOTTERY_ROUND_NOT_READY"
  );
  assert.equal(store.read(), null);
});

test("completion clears pending request and invalidates cached workspace", async () => {
  const factory = createFactory();
  const store = createStore();
  let invalidations = 0;
  const service = factory.create({
    store,
    request() {
      return Promise.resolve(drawResponse());
    },
    workspaceService: {
      invalidate() {
        invalidations += 1;
      },
    },
  });

  await service.draw(ticket());
  assert.notEqual(store.read(), null);
  service.complete();
  assert.equal(store.read(), null);
  assert.equal(invalidations, 1);
});
