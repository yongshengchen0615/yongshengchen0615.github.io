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
      Date,
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

function workspaceResponse({ available = true } = {}) {
  return {
    ok: true,
    data: {
      access: { allowed: true },
      lotteryTypes: [
        {
          lotteryTypeId: "LTY-A",
          name: "會員轉盤",
          lottery: { lotteryTypeId: "LTY-A", configVersion: "LCF-CURRENT" },
        },
      ],
      card: {
        availableRewards: available ? [ticket("A")] : [],
      },
      totalPoints: 10,
    },
  };
}

test("preparation force-refreshes workspace and never calls drawLottery", async () => {
  const factory = createFactory();
  let resolveWorkspace;
  let requestCalls = 0;
  const loadOptions = [];
  const service = factory.create({
    request() {
      requestCalls += 1;
      throw new Error("preparation must not call request when workspace service exists");
    },
    workspaceService: {
      load(options) {
        loadOptions.push(options);
        return new Promise((resolve) => {
          resolveWorkspace = resolve;
        });
      },
      invalidate() {},
    },
  });

  const first = service.prepare(ticket("A"));
  const second = service.prepare(ticket("A"));
  assert.equal(first, second);
  await Promise.resolve();
  resolveWorkspace(workspaceResponse());
  const result = await first;

  assert.equal(requestCalls, 0);
  assert.equal(loadOptions.length, 1);
  assert.equal(loadOptions[0].force, true);
  assert.equal(result.data.lotteryTypes[0].lottery.configVersion, "LCF-CURRENT");
});

test("an unavailable ticket is rejected before any draw transaction exists", async () => {
  const factory = createFactory();
  const service = factory.create({
    request() {
      throw new Error("draw request must not happen during preparation");
    },
    workspaceService: {
      load() {
        return Promise.resolve(workspaceResponse({ available: false }));
      },
      invalidate() {},
    },
  });

  await assert.rejects(
    service.prepare(ticket("A")),
    (error) => error.code === "LOTTERY_ROUND_NOT_READY"
  );
});

test("a persisted pending draw may prepare even when the ticket was already consumed", async () => {
  const factory = createFactory();
  const service = factory.create({
    workspaceService: {
      load() {
        return Promise.resolve(workspaceResponse({ available: false }));
      },
      invalidate() {},
    },
  });

  const response = await service.prepare(ticket("A"), {
    allowPendingTicket: true,
  });
  assert.equal(response.ok, true);
});

test("a different ticket cannot replace an in-flight preparation", async () => {
  const factory = createFactory();
  let resolveWorkspace;
  const service = factory.create({
    workspaceService: {
      load() {
        return new Promise((resolve) => {
          resolveWorkspace = resolve;
        });
      },
      invalidate() {},
    },
  });

  const first = service.prepare(ticket("A"));
  await assert.rejects(
    service.prepare(ticket("B")),
    (error) => error.code === "LOTTERY_PREPARATION_BUSY"
  );
  resolveWorkspace(workspaceResponse());
  await first;
});
