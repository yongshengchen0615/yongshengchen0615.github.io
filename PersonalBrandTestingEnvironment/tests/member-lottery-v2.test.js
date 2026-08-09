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

function createHarness({ initialPending = false, deferDraw = false } = {}) {
  const registry = new Registry();
  const ticket = createTicket();
  const requestCalls = [];
  const viewEvents = [];
  let handlers;
  let stored = initialPending
    ? { ...ticket, requestId: "request-existing" }
    : null;
  let requestSequence = 0;
  let resolveDeferredDraw;

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
        throw contracts.createError(response?.code || "BACKEND_ERROR", "backend error");
      }
      return response;
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

  let workspaceServiceInstance;
  registry.set("lottery.workspace-service", {
    create({ request }) {
      workspaceServiceInstance = {
        load() {
          return request("getLotteryConfig", {}, undefined);
        },
        invalidate() {},
      };
      return workspaceServiceInstance;
    },
  });
  registry.set("lottery.preparation-service", {
    create({ workspaceService }) {
      return {
        prepare() {
          return workspaceService.load({ force: true });
        },
        invalidateWorkspace() {},
        isDefinitiveNoDrawError() {
          return false;
        },
      };
    },
  });
  registry.set("lottery.draw-service", {
    create({ request, store, workspaceService }) {
      return {
        draw(activeTicket) {
          const pending = store.ensure(activeTicket);
          return request(
            "drawLottery",
            {
              lotteryTypeId: activeTicket.lotteryTypeId,
              cardRoundKey: activeTicket.cardRoundKey,
            },
            pending.requestId
          );
        },
        complete() {
          store.clear();
          workspaceService.invalidate();
        },
        clear() {
          store.clear();
          workspaceService.invalidate();
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
          configVersion: "LCF-TEST00000001",
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
        prepare() {
          viewEvents.push("prepare-wheel");
        },
        reset() {
          viewEvents.push("reset-wheel");
        },
        settle() {
          viewEvents.push("reveal-spin");
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
        markReady(_ticket, _type, pending) {
          viewEvents.push(pending ? "ready-pending" : "ready");
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
        draw() {
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
        if (deferDraw) {
          return new Promise((resolve) => {
            resolveDeferredDraw = resolve;
          });
        }
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
    pending: () => stored,
    resolveDeferredDraw() {
      resolveDeferredDraw?.({ ok: true, data: {} });
    },
  };
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

test("prepare-for-open loads the latest config while dialog open stays local-only", async () => {
  const harness = createHarness();

  const preparation = harness.controller.prepareForOpen(harness.ticket);
  assert.equal(harness.controller.canClose(), false);
  assert.equal(await preparation, true);
  assert.deepEqual(
    harness.requestCalls.map((call) => call.action),
    ["getLotteryConfig"]
  );
  assert.equal(harness.pending(), null);
  assert.equal(harness.controller.canClose(), true);
  assert.equal(harness.viewEvents.includes("ready"), false);

  const requestCount = harness.requestCalls.length;
  assert.equal(await harness.controller.open(harness.ticket), true);
  assert.equal(harness.requestCalls.length, requestCount);
  assert.ok(harness.viewEvents.includes("ready"));
});

test("central reveal creates one request id and starts motion only after the prepared result resolves", async () => {
  const harness = createHarness();
  await harness.controller.prepareForOpen(harness.ticket);
  await harness.controller.open(harness.ticket);

  harness.handlers().onSpin();
  assert.equal(harness.requestCalls[1].action, "drawLottery");
  assert.equal(harness.requestCalls[1].requestId, "request-0001");
  assert.equal(harness.viewEvents.includes("reveal-spin"), false);

  await flush();
  await flush();

  assert.deepEqual(
    harness.requestCalls.map((call) => call.action),
    ["getLotteryConfig", "drawLottery"]
  );
  assert.ok(harness.viewEvents.includes("reveal-spin"));
  assert.ok(harness.viewEvents.includes("result"));
  assert.equal(harness.pending(), null);
  assert.equal(harness.controller.canClose(), true);
});

test("a slow prepared-result adapter keeps the wheel stationary until the result is available", async () => {
  const harness = createHarness({ deferDraw: true });
  await harness.controller.prepareForOpen(harness.ticket);
  await harness.controller.open(harness.ticket);

  harness.handlers().onSpin();

  assert.equal(
    harness.requestCalls.filter((call) => call.action === "drawLottery").length,
    1
  );
  assert.equal(harness.pending().requestId, "request-0001");
  assert.equal(harness.viewEvents.includes("reveal-spin"), false);
  assert.equal(harness.viewEvents.includes("result"), false);
  assert.equal(harness.controller.canClose(), false);

  harness.resolveDeferredDraw();
  await flush();
  await flush();

  assert.ok(harness.viewEvents.includes("reveal-spin"));
  assert.ok(harness.viewEvents.includes("result"));
  assert.ok(
    harness.viewEvents.indexOf("reveal-spin") < harness.viewEvents.indexOf("result")
  );
});

test("rapid duplicate reveal clicks cannot create a second prepared-result request", async () => {
  const harness = createHarness({ deferDraw: true });
  await harness.controller.prepareForOpen(harness.ticket);
  await harness.controller.open(harness.ticket);

  harness.handlers().onSpin();
  harness.handlers().onSpin();

  assert.equal(
    harness.requestCalls.filter((call) => call.action === "drawLottery").length,
    1
  );
  assert.equal(harness.viewEvents.includes("reveal-spin"), false);

  harness.resolveDeferredDraw();
  await flush();
  await flush();

  assert.equal(
    harness.viewEvents.filter((event) => event === "reveal-spin").length,
    1
  );
  assert.ok(harness.viewEvents.includes("result"));
});

test("a restored pending reveal reuses its request id and replays the same prepared result", async () => {
  const harness = createHarness({ initialPending: true });
  await harness.controller.restorePending();

  assert.deepEqual(
    harness.requestCalls.map((call) => call.action),
    ["getLotteryConfig"]
  );
  assert.ok(harness.viewEvents.includes("ready-pending"));
  assert.equal(harness.controller.canClose(), false);

  harness.handlers().onSpin();
  assert.equal(harness.viewEvents.includes("reveal-spin"), false);
  await flush();
  await flush();

  assert.equal(harness.requestCalls[1].action, "drawLottery");
  assert.equal(harness.requestCalls[1].requestId, "request-existing");
  assert.ok(harness.viewEvents.includes("reveal-spin"));
  assert.ok(harness.viewEvents.includes("result"));
  assert.equal(harness.pending(), null);
});

test("rapid duplicate preparations share one read-only preparation transaction", async () => {
  const harness = createHarness();
  const first = harness.controller.prepareForOpen(harness.ticket);
  const second = harness.controller.prepareForOpen(harness.ticket);

  assert.equal(first, second);
  assert.equal(await first, true);
  assert.deepEqual(
    harness.requestCalls.map((call) => call.action),
    ["getLotteryConfig"]
  );
  assert.equal(await harness.controller.open(harness.ticket), true);
  assert.equal(harness.requestCalls.length, 1);
});