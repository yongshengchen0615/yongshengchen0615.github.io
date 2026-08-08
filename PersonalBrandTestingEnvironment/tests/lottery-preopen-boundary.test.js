const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.resolve(__dirname, "../client/lottery/dialog-controller.js"),
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
    if (!definition) throw new Error(`missing module: ${name}`);
    const value = definition.factory(
      ...definition.dependencies.map((dependency) => this.get(dependency))
    );
    this.instances.set(name, value);
    return value;
  }
}

function createHarness() {
  const registry = new Registry();
  const requestCalls = [];
  const viewEvents = [];
  const ticket = {
    settingVersion: "PCS-TEST00000001",
    cardNumber: 1,
    milestonePoints: 10,
    lotteryTypeId: "LTY-TEST000001",
    cardRoundKey: "PCS-TEST00000001:1:10",
  };
  const lotteryType = {
    lotteryTypeId: ticket.lotteryTypeId,
    name: "測試轉盤",
    lottery: {
      configVersion: "LCF-TEST00000001",
      prizes: [
        { prizeId: "LPR-TEST000001" },
        { prizeId: "LPR-TEST000002" },
      ],
    },
  };
  const workspace = {
    lotteryTypes: [lotteryType],
    card: { availableDraws: 1, availableRewards: [ticket] },
    totalPoints: 12,
  };

  registry.set("lottery.contracts", {
    createError(code, message) {
      const error = new Error(message);
      error.code = code;
      return error;
    },
    normalizeTicket(value) {
      if (!value || value.cardRoundKey !== ticket.cardRoundKey) {
        const error = new Error("invalid ticket");
        error.code = "INVALID_LOTTERY_TICKET";
        throw error;
      }
      return { ...ticket };
    },
    assertSuccessfulResponse(response) {
      if (!response || response.ok !== true) {
        const error = new Error("backend error");
        error.code = response?.code || "BACKEND_ERROR";
        throw error;
      }
      return response;
    },
    isDefinitiveNoDrawError() {
      return false;
    },
  });

  registry.set("lottery.pending-request-store", {
    create() {
      let pending = null;
      return {
        read() {
          return pending;
        },
        ensure(activeTicket) {
          if (!pending) pending = { ...activeTicket, requestId: "request-0001" };
          return pending;
        },
        clear() {
          pending = null;
        },
      };
    },
  });

  registry.set("lottery.workspace-service", {
    create({ request }) {
      let cached = null;
      return {
        load() {
          return Promise.resolve(request("getLotteryConfig", {}, undefined)).then(
            (response) => {
              cached = response;
              return response;
            }
          );
        },
        invalidate() {
          cached = null;
        },
        peek() {
          return cached;
        },
      };
    },
  });

  registry.set("lottery.preparation-service", {
    create({ workspaceService }) {
      return {
        prepare() {
          return workspaceService.load({ force: true, maxAgeMs: 2000 });
        },
        isDefinitiveNoDrawError() {
          return false;
        },
        invalidateWorkspace() {},
      };
    },
  });

  registry.set("lottery.draw-service", {
    create({ request, store }) {
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
        },
        clear() {
          store.clear();
        },
        isDefinitiveNoDrawError() {
          return false;
        },
      };
    },
  });

  registry.set("lottery.workspace-mapper", {
    normalizeWorkspace() {
      return workspace;
    },
    findLotteryType(types, id) {
      return types.find((type) => type.lotteryTypeId === id) || null;
    },
    normalizeDrawResult() {
      throw new Error("draw result not expected in pre-open tests");
    },
  });

  registry.set("lottery.wheel-animator", {
    create() {
      return {
        prepare() {
          viewEvents.push("canvas-prepared");
        },
        reset() {
          viewEvents.push("reset");
        },
        stop() {
          viewEvents.push("stop");
        },
        startPendingSpin() {
          viewEvents.push("pending-spin");
          return true;
        },
        settle() {
          return Promise.resolve();
        },
      };
    },
  });

  registry.set("lottery.dialog-view", {
    create() {
      return {
        bind() {},
        getRotor() {
          return {};
        },
        getCanvas() {
          return {};
        },
        updateControls() {},
        markPreparing() {
          viewEvents.push("dialog-preparing");
        },
        markReady() {
          viewEvents.push("dialog-ready");
        },
        showError() {
          viewEvents.push("dialog-error");
        },
        setStatus() {},
        showResult() {},
        allowHostClose() {},
        close() {
          viewEvents.push("dialog-close");
        },
      };
    },
  });

  registry.set("lottery.demo-provider", {
    create() {
      return {
        prepare() {
          throw new Error("unexpected demo prepare");
        },
        draw() {
          throw new Error("unexpected demo draw");
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
    requestAnimationFrame() {
      return 1;
    },
    cancelAnimationFrame() {},
    setTimeout,
    addEventListener() {},
  };
  window.window = window;

  vm.runInContext(
    source,
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
        return Promise.resolve({ ok: true, data: workspace });
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

  return { controller, requestCalls, ticket, viewEvents };
}

test("Lottery data and Canvas are prepared before the dialog opens", async () => {
  const harness = createHarness();

  assert.equal(typeof harness.controller.prepareForOpen, "function");
  assert.equal(await harness.controller.prepareForOpen(harness.ticket), true);
  assert.deepEqual(
    harness.requestCalls.map((call) => call.action),
    ["getLotteryConfig"]
  );
  assert.ok(harness.viewEvents.includes("canvas-prepared"));
  assert.equal(harness.viewEvents.includes("dialog-preparing"), false);
  assert.equal(harness.viewEvents.includes("dialog-ready"), false);

  const requestCountBeforeOpen = harness.requestCalls.length;
  assert.equal(await harness.controller.open(harness.ticket), true);
  assert.equal(harness.requestCalls.length, requestCountBeforeOpen);
  assert.ok(harness.viewEvents.includes("dialog-ready"));
});

test("opening without prepared state fails closed and never fetches Lottery config", async () => {
  const harness = createHarness();

  assert.equal(await harness.controller.open(harness.ticket), false);
  assert.equal(harness.requestCalls.length, 0);
  assert.equal(harness.viewEvents.includes("dialog-preparing"), false);
  assert.equal(harness.viewEvents.includes("dialog-ready"), false);
});
