const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const projectRoot = path.resolve(__dirname, "..");
const controllerSource = fs.readFileSync(
  path.join(projectRoot, "client/lottery/dialog-controller.js"),
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
  set(name, instance) {
    this.instances.set(name, instance);
  }
  get(name) {
    if (this.instances.has(name)) return this.instances.get(name);
    const definition = this.definitions.get(name);
    if (!definition) throw new Error(`missing module: ${name}`);
    const instance = definition.factory(
      ...definition.dependencies.map((dependency) => this.get(dependency))
    );
    this.instances.set(name, instance);
    return instance;
  }
}

function createTicket() {
  return {
    settingVersion: "PCS-TEST00000001",
    cardNumber: 1,
    milestonePoints: 10,
    lotteryTypeId: "LTY-TEST000001",
    cardRoundKey: "PCS-TEST00000001:1:10",
  };
}

function createHarness() {
  const registry = new Registry();
  const ticket = createTicket();
  const requestCalls = [];
  const viewEvents = [];
  let handlers;
  let stored = null;
  let prepared = null;
  let requestSequence = 0;

  const contracts = {
    createError(code, message) {
      const error = new Error(message);
      error.code = code;
      return error;
    },
    normalizeTicket(value) {
      if (!value || value.cardRoundKey !== ticket.cardRoundKey) {
        throw this.createError("INVALID_LOTTERY_TICKET", "invalid ticket");
      }
      return { ...ticket };
    },
    assertSuccessfulResponse(response) {
      if (!response || response.ok !== true) {
        throw contracts.createError("BACKEND_ERROR", "backend error");
      }
      return response;
    },
  };

  const guard = {
    save(_ticket, request, response) {
      prepared = { requestId: request.requestId, response };
    },
    resolve(_ticket, requestId) {
      return prepared && prepared.requestId === requestId
        ? Promise.resolve(prepared.response)
        : Promise.reject(
            contracts.createError("LOTTERY_RESULT_NOT_PREPARED", "missing")
          );
    },
    has(_ticket, requestId) {
      return Boolean(prepared && prepared.requestId === requestId);
    },
    clear() {
      prepared = null;
    },
  };

  registry.set("lottery.contracts", contracts);
  registry.set("lottery.pending-request-store", {
    create() {
      return {
        read() {
          return stored;
        },
        ensure() {
          if (!stored) {
            requestSequence += 1;
            stored = {
              ...ticket,
              requestId: `request-${requestSequence.toString().padStart(4, "0")}`,
            };
          }
          return stored;
        },
        clear() {
          stored = null;
        },
      };
    },
  });
  registry.set("lottery.wheel-draw-guard", { create: () => guard });
  registry.set("lottery.preparation-service", {
    create({ request, store, guard: drawGuard }) {
      return {
        async prepare(activeTicket) {
          const workspaceResponse = await request(
            "getLotteryConfig",
            {},
            undefined
          );
          const pending = store.ensure(activeTicket);
          const drawResponse = await request(
            "drawLottery",
            {
              lotteryTypeId: activeTicket.lotteryTypeId,
              cardRoundKey: activeTicket.cardRoundKey,
            },
            pending.requestId
          );
          drawGuard.save(activeTicket, pending, drawResponse);
          return workspaceResponse;
        },
        resolvePrepared(activeTicket, requestId) {
          return drawGuard.resolve(activeTicket, requestId);
        },
        isDefinitiveNoDrawError() {
          return false;
        },
      };
    },
  });

  const workspace = {
    lotteryTypes: [
      {
        lotteryTypeId: ticket.lotteryTypeId,
        name: "測試轉盤",
        lottery: {
          prizes: [
            { prizeId: "LPR-TEST000001" },
            { prizeId: "LPR-TEST000002" },
          ],
        },
      },
    ],
    card: { availableDraws: 1 },
    totalPoints: 12,
  };
  const drawResult = {
    selectedType: workspace.lotteryTypes[0],
    draw: {
      prizeId: "LPR-TEST000001",
      prizeLabel: "會員好禮",
      prizeColor: "#8DCCAA",
      originalPointBalance: 12,
      pointBalance: 12,
    },
    card: { availableDraws: 0 },
    totalPoints: 12,
    lotteryTypes: workspace.lotteryTypes,
  };

  registry.set("lottery.workspace-mapper", {
    normalizeWorkspace() {
      return workspace;
    },
    findLotteryType(types, id) {
      return types.find((type) => type.lotteryTypeId === id) || null;
    },
    normalizeDrawResult() {
      return drawResult;
    },
  });
  registry.set("lottery.wheel-animator", {
    create() {
      return {
        draw() {
          viewEvents.push("draw-wheel");
        },
        reset() {
          viewEvents.push("reset-wheel");
        },
        startWaiting() {
          viewEvents.push("start-waiting");
        },
        settle() {
          viewEvents.push("settle");
          return Promise.resolve();
        },
        stop() {
          viewEvents.push("stop");
        },
      };
    },
  });
  registry.set("lottery.dialog-view", {
    create() {
      return {
        bind(value) {
          handlers = value;
        },
        getRotor() {
          return {};
        },
        getCanvas() {
          return {};
        },
        updateControls(value) {
          viewEvents.push(["controls", value]);
        },
        markPreparing() {
          viewEvents.push("preparing");
        },
        markReady() {
          viewEvents.push("ready");
        },
        showError(error) {
          viewEvents.push(["error", error.code]);
        },
        setStatus(message) {
          viewEvents.push(["status", message]);
        },
        showResult() {
          viewEvents.push("result");
        },
        allowHostClose() {},
        close() {
          viewEvents.push("close");
        },
      };
    },
  });
  registry.set("lottery.demo-provider", {
    create() {
      return {
        prepare() {
          throw new Error("unexpected demo");
        },
      };
    },
  });

  const window = {
    PersonaModules: registry,
    document: {},
    sessionStorage: {},
    MemberApi: {
      createRequestId() {
        return "request-0001";
      },
    },
    LotteryWheel: {
      draw() {
        return true;
      },
    },
    requestAnimationFrame(callback) {
      callback(16);
      return 1;
    },
    cancelAnimationFrame() {},
    setTimeout,
    addEventListener() {},
  };
  window.window = window;

  vm.runInContext(
    controllerSource,
    vm.createContext({
      window,
      Object,
      Array,
      Boolean,
      Error,
      JSON,
      Math,
      Number,
      Promise,
      RegExp,
      String,
    })
  );

  const controller = registry.get("lottery.dialog-controller").create({
    root: window,
    document: window.document,
    memberApi: window.MemberApi,
    wheelRenderer: window.LotteryWheel,
  });
  controller.configure({
    liffId: "liff-test",
    request(action, fields, requestId) {
      requestCalls.push({ action, fields, requestId });
      if (action === "getLotteryConfig") {
        return Promise.resolve({ ok: true, data: {} });
      }
      if (action === "drawLottery") {
        return Promise.resolve({ ok: true, data: {} });
      }
      throw new Error(`unexpected action: ${action}`);
    },
    isDemo() {
      return false;
    },
    getMemberId() {
      return "MBR-AAAAAAAAAA";
    },
    onCardUpdated() {},
    showToast() {},
  });

  return {
    controller,
    handlers: () => handlers,
    requestCalls,
    ticket,
    viewEvents,
  };
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

test("open prepares config and draw before the wheel becomes actionable", async () => {
  const harness = createHarness();

  assert.equal(await harness.controller.open(harness.ticket), true);
  assert.deepEqual(
    harness.requestCalls.map((call) => call.action),
    ["getLotteryConfig", "drawLottery"]
  );
  assert.equal(harness.controller.canClose(), false);
  assert.ok(harness.viewEvents.includes("ready"));
});

test("spin consumes the prepared response without another backend request", async () => {
  const harness = createHarness();
  await harness.controller.open(harness.ticket);
  const callsBeforeSpin = harness.requestCalls.length;

  harness.handlers().onSpin();
  await flush();
  await flush();

  assert.equal(harness.requestCalls.length, callsBeforeSpin);
  assert.ok(harness.viewEvents.includes("settle"));
  assert.ok(harness.viewEvents.includes("result"));
  assert.equal(harness.controller.canClose(), true);
});
