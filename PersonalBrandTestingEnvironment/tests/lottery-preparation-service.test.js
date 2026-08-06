const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.resolve(__dirname, "../client/lottery/preparation-service.js"),
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
      return error?.code === "LOTTERY_ROUND_NOT_READY";
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
      Error,
      Number,
      Object,
      Promise,
      String,
    })
  );
  return registry.get("lottery.preparation-service");
}

function ticket(id = "A") {
  return {
    lotteryTypeId: `LTY-${id}`,
    cardRoundKey: `ROUND-${id}`,
  };
}

function workspaceResponse(version = "LCF-OLD") {
  return {
    ok: true,
    data: {
      access: { allowed: true },
      lotteryTypes: [
        {
          lotteryTypeId: "LTY-A",
          name: "會員轉盤",
          lottery: { lotteryTypeId: "LTY-A", configVersion: version },
        },
      ],
      card: {
        availableRewards: [ticket("A")],
      },
      totalPoints: 10,
    },
  };
}

function drawResponse(version = "LCF-NEW") {
  return {
    ok: true,
    data: {
      draw: {
        cardRoundKey: "ROUND-A",
        lotteryTypeId: "LTY-A",
      },
      lottery: {
        lotteryTypeId: "LTY-A",
        configVersion: version,
      },
      lotteryType: {
        lotteryTypeId: "LTY-A",
        name: "會員轉盤",
      },
      card: { availableRewards: [] },
    },
  };
}

test("same-ticket preparation is coalesced and uses the authoritative draw config", async () => {
  const factory = createFactory();
  let resolveWorkspace;
  let drawCalls = 0;
  let pending = null;
  let prepared = null;
  const cached = [];
  const service = factory.create({
    request(action, _fields, requestId) {
      if (action === "drawLottery") {
        drawCalls += 1;
        assert.equal(requestId, "request-0001");
        return Promise.resolve(drawResponse());
      }
      throw new Error(`unexpected action ${action}`);
    },
    workspaceService: {
      load() {
        return new Promise((resolve) => {
          resolveWorkspace = resolve;
        });
      },
      prime(response) {
        cached.push(response);
        return response;
      },
      invalidate() {},
    },
    store: {
      normalizeTicket(value) {
        return { ...value };
      },
      read() {
        return pending;
      },
      ensure(value) {
        if (!pending) pending = { ...value, requestId: "request-0001" };
        return pending;
      },
      clear() {
        pending = null;
      },
    },
    guard: {
      save(_ticket, request, response) {
        prepared = { request, response };
      },
      resolve() {
        return Promise.resolve(prepared.response);
      },
      clear() {
        prepared = null;
      },
    },
  });

  const first = service.prepare(ticket("A"));
  const second = service.prepare(ticket("A"));
  assert.equal(first, second);
  await Promise.resolve();
  resolveWorkspace(workspaceResponse());
  const result = await first;

  assert.equal(drawCalls, 1);
  assert.equal(result.configurationUpdated, true);
  assert.equal(
    result.workspaceResponse.data.lotteryTypes[0].lottery.configVersion,
    "LCF-NEW"
  );
  assert.equal(cached.length, 1);
});

test("a different ticket cannot replace an in-flight preparation", async () => {
  const factory = createFactory();
  let resolveWorkspace;
  const service = factory.create({
    request() {
      return Promise.resolve(drawResponse());
    },
    workspaceService: {
      load() {
        return new Promise((resolve) => {
          resolveWorkspace = resolve;
        });
      },
      prime(response) {
        return response;
      },
      invalidate() {},
    },
    store: {
      normalizeTicket(value) {
        return { ...value };
      },
      read() {
        return null;
      },
      ensure(value) {
        return { ...value, requestId: "request-0001" };
      },
      clear() {},
    },
    guard: { save() {}, clear() {}, resolve() {} },
  });

  const first = service.prepare(ticket("A"));
  await assert.rejects(
    service.prepare(ticket("B")),
    (error) => error.code === "LOTTERY_PREPARATION_BUSY"
  );
  resolveWorkspace(workspaceResponse());
  await first;
});
