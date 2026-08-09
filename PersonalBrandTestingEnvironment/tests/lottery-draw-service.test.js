const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.resolve(__dirname, "../client/lottery/draw-service.js"),
  "utf8"
);
const contractsSource = fs.readFileSync(
  path.resolve(__dirname, "../client/lottery/contracts.js"),
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

function createContractsHarness() {
  const registry = new Registry();
  const events = [];
  class CustomEvent {
    constructor(type, options = {}) {
      this.type = type;
      this.detail = options.detail;
    }
  }
  const window = {
    PersonaModules: registry,
    CustomEvent,
    dispatchEvent(event) {
      events.push(event);
    },
  };
  window.window = window;
  vm.runInContext(
    contractsSource,
    vm.createContext({
      window,
      Array,
      Boolean,
      Date,
      Error,
      Math,
      Number,
      Object,
      RegExp,
      String,
    })
  );
  return { contracts: registry.get("lottery.contracts"), events };
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

test("draw response accepts nested lottery config when the duplicate top-level field is absent", async () => {
  const factory = createFactory();
  const store = createStore();
  const service = factory.create({
    store,
    request() {
      const response = drawResponse();
      response.data.lotteryType.lottery = response.data.lottery;
      delete response.data.lottery;
      return Promise.resolve(response);
    },
    workspaceService: { invalidate() {} },
  });

  const response = await service.draw(ticket());
  assert.equal(response.data.lottery.lotteryTypeId, "LTY-A");
  assert.equal(response.data.lotteryType.lottery.lotteryTypeId, "LTY-A");
});

test("draw response accepts top-level lottery config and fills the nested copy", async () => {
  const factory = createFactory();
  const store = createStore();
  const service = factory.create({
    store,
    request() {
      return Promise.resolve(drawResponse());
    },
    workspaceService: { invalidate() {} },
  });

  const response = await service.draw(ticket());
  assert.equal(response.data.lottery.lotteryTypeId, "LTY-A");
  assert.equal(response.data.lotteryType.lottery.lotteryTypeId, "LTY-A");
});

test("an incomplete draw response preserves the pending request for safe retry", async () => {
  const factory = createFactory();
  const store = createStore();
  const service = factory.create({
    store,
    request() {
      const response = drawResponse();
      delete response.data.lottery;
      return Promise.resolve(response);
    },
    workspaceService: { invalidate() {} },
  });

  await assert.rejects(
    service.draw(ticket()),
    (error) =>
      error.code === "INVALID_RESPONSE" &&
      /票券已保留/.test(error.message)
  );
  assert.equal(store.read().requestId, "request-0001");
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

test("lottery contract validation keeps the precise reason and emits a privacy-safe diagnostic", () => {
  const { contracts, events } = createContractsHarness();
  const error = contracts.createError(
    "INVALID_RESPONSE",
    "後台回傳的抽獎結果缺少必要欄位，票券已保留，可安全重試。"
  );

  assert.equal(error.code, "LOTTERY_RESPONSE_INVALID");
  assert.equal(error.originalCode, "INVALID_RESPONSE");
  assert.equal(contracts.isRecoverableResponseError(error), true);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "persona:lottery-contract-error");
  assert.equal(events[0].detail.code, "LOTTERY_RESPONSE_INVALID");
  assert.equal(events[0].detail.source, "client-validator");
  assert.match(events[0].detail.reason, /票券已保留/);
  assert.deepEqual(
    Object.keys(events[0].detail).sort(),
    ["code", "reason", "source"]
  );
});
