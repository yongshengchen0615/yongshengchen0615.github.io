const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const loaderCode = fs.readFileSync(
  path.join(__dirname, "..", "client", "member-lottery-loader.js"),
  "utf8"
);

const registrySource = "../shared/module-registry.js";
const definitionSources = [
  "lottery/contracts.js",
  "lottery/pending-request-store.js",
  "lottery/workspace-service.js",
  "lottery/preparation-service.js",
  "lottery/draw-service.js",
  "lottery/workspace-mapper.js",
  "lottery/wheel-animator.js",
  "lottery/dialog-view.js",
  "lottery/demo-provider.js",
  "lottery/dialog-controller.js",
];
const entrySource = "member-lottery-v2.js";
const allSources = [registrySource, ...definitionSources, entrySource];

function createHarness(options = {}) {
  const appendedSources = [];
  const storage = new Map();
  const listeners = new Map();
  const scriptsBySource = new Map();
  let realConfigureCalls = 0;
  let realRefreshCalls = 0;
  let realOpenCalls = 0;
  let realRestoreCalls = 0;

  const realFacade = {
    configure() {
      realConfigureCalls += 1;
      return realFacade;
    },
    refreshTickets() {
      realRefreshCalls += 1;
      return Promise.resolve({ availableDraws: 2 });
    },
    open() {
      realOpenCalls += 1;
      return Promise.resolve(true);
    },
    restorePending() {
      realRestoreCalls += 1;
      return Promise.resolve(true);
    },
    hasPending() {
      return false;
    },
    canClose() {
      return true;
    },
    requestClose() {
      return true;
    },
  };

  function createScript() {
    const scriptListeners = {};
    return {
      dataset: {},
      src: "",
      async: true,
      parentNode: null,
      addEventListener(name, callback) {
        scriptListeners[name] = callback;
      },
      emit(name) {
        if (scriptListeners[name]) scriptListeners[name]();
      },
    };
  }

  const ticketList = {
    observer: null,
  };

  const document = {
    head: {
      appendChild(script) {
        appendedSources.push(script.src);
        scriptsBySource.set(script.src, script);
        script.parentNode = this;
        if (script.src === entrySource) {
          context.MemberLotteryDialog = realFacade;
        }
        if (!options.manualLoads) {
          queueMicrotask(() =>
            script.emit(options.failSource === script.src ? "error" : "load")
          );
        }
      },
      removeChild() {},
    },
    documentElement: null,
    createElement(tag) {
      assert.equal(tag, "script");
      return createScript();
    },
    querySelector() {
      return null;
    },
    getElementById(id) {
      return id === "member-earned-ticket-list" ? ticketList : null;
    },
  };

  class FakeMutationObserver {
    constructor(callback) {
      this.callback = callback;
    }
    observe(target) {
      target.observer = this;
    }
    disconnect() {
      if (ticketList.observer === this) ticketList.observer = null;
    }
  }

  const context = {
    console,
    document,
    Promise,
    Error,
    JSON,
    Number,
    Object,
    RegExp,
    String,
    Date,
    Math,
    setTimeout,
    clearTimeout,
    queueMicrotask,
    MutationObserver: FakeMutationObserver,
    sessionStorage: {
      getItem(key) {
        return storage.get(key) ?? null;
      },
      setItem(key, value) {
        storage.set(key, String(value));
      },
      removeItem(key) {
        storage.delete(key);
      },
    },
    addEventListener(name, callback) {
      listeners.set(name, callback);
    },
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(loaderCode, context, { filename: "member-lottery-loader.js" });

  return {
    context,
    storage,
    appendedSources,
    realFacade,
    ticketList,
    release(source, event = "load") {
      const script = scriptsBySource.get(source);
      assert.ok(script, `missing script ${source}`);
      script.emit(event);
    },
    counts() {
      return {
        realConfigureCalls,
        realRefreshCalls,
        realOpenCalls,
        realRestoreCalls,
      };
    },
  };
}

function configure(loader, overrides = {}) {
  const summary = { availableDraws: 1, availableRewards: [] };
  loader.configure({
    liffId: "2000000000-abcdefgh",
    getMemberId: () => "MBR-ABCDEF1234",
    getCurrentCardSummary: () => summary,
    isDemo: () => false,
    normalizeError: (error) => ({
      code: error.code || "CLIENT_LIBRARY_ERROR",
      message: error.message,
    }),
    showToast() {},
    request() {
      throw new Error("loader must not call GAS directly");
    },
    ...overrides,
  });
  return summary;
}

function createTicket() {
  return {
    settingVersion: "PCS-ABCDEFGHIJKL",
    cardNumber: 2,
    milestonePoints: 10,
    lotteryTypeId: "LTY-ABCDEFGHIJ",
    cardRoundKey: "PCS-ABCDEFGHIJKL:2:10",
  };
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

test("loader keeps Lottery V2 off the initial execution path", async () => {
  const harness = createHarness();
  const loader = harness.context.MemberLotteryDialog;
  configure(loader);

  assert.deepEqual(harness.appendedSources, []);
  assert.equal(harness.counts().realConfigureCalls, 0);

  await loader.ensureLoaded();
  assert.deepEqual(harness.appendedSources, allSources);
  assert.equal(harness.counts().realConfigureCalls, 1);
  assert.equal(harness.context.MemberLotteryDialog, loader);
});

test("registry loads first, definition downloads start together, and entry loads last", async () => {
  const harness = createHarness({ manualLoads: true });
  const loader = harness.context.MemberLotteryDialog;
  configure(loader);

  const loading = loader.ensureLoaded();
  assert.deepEqual(harness.appendedSources, [registrySource]);

  harness.release(registrySource);
  await flush();
  assert.deepEqual(harness.appendedSources, [registrySource, ...definitionSources]);
  assert.equal(harness.appendedSources.includes(entrySource), false);

  definitionSources.forEach((source) => harness.release(source));
  await flush();
  assert.equal(harness.appendedSources.at(-1), entrySource);

  harness.release(entrySource);
  await loading;
  assert.deepEqual(harness.appendedSources, allSources);
});

test("eligible ticket snapshot opportunistically prewarms runtime without GAS", async () => {
  const harness = createHarness();
  const loader = harness.context.MemberLotteryDialog;
  let requestCalls = 0;
  const summary = {
    availableDraws: 1,
    availableRewards: [createTicket()],
  };

  configure(loader, {
    getCurrentCardSummary: () => summary,
    request() {
      requestCalls += 1;
      return Promise.resolve({ ok: true });
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(harness.appendedSources, allSources);
  assert.equal(harness.counts().realConfigureCalls, 1);
  assert.equal(requestCalls, 0);
});

test("card render mutation starts prewarm only after a ticket becomes available", async () => {
  const harness = createHarness();
  const loader = harness.context.MemberLotteryDialog;
  let summary = { availableDraws: 0, availableRewards: [] };
  configure(loader, { getCurrentCardSummary: () => summary });

  assert.deepEqual(harness.appendedSources, []);
  assert.ok(harness.ticketList.observer);

  summary = { availableDraws: 1, availableRewards: [createTicket()] };
  harness.ticketList.observer.callback();
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.deepEqual(harness.appendedSources, allSources);
  assert.equal(harness.ticketList.observer, null);
});

test("concurrent loader calls share one module load and refresh stays stale-while-revalidate", async () => {
  const harness = createHarness();
  const loader = harness.context.MemberLotteryDialog;
  const summary = configure(loader);

  const first = loader.ensureLoaded();
  const second = loader.ensureLoaded();
  assert.equal(first, second);
  await Promise.all([first, second]);
  assert.equal(harness.appendedSources.length, 12);

  const returned = await loader.refreshTickets({ force: true });
  assert.equal(returned, summary);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(harness.counts().realRefreshCalls, 1);
});

test("pending draw is detectable before modules load and delegates recovery after load", async () => {
  const harness = createHarness();
  const loader = harness.context.MemberLotteryDialog;
  configure(loader);
  const key =
    "persona-member-lottery-round-request:2000000000-abcdefgh:MBR-ABCDEF1234";
  harness.storage.set(
    key,
    JSON.stringify({
      requestId: "request-safe-retry-01",
      settingVersion: "PCS-ABCDEFGHIJKL",
      cardNumber: 2,
      milestonePoints: 10,
      lotteryTypeId: "LTY-ABCDEFGHIJ",
      cardRoundKey: "PCS-ABCDEFGHIJKL:2:10",
    })
  );

  assert.equal(loader.hasPending(), true);
  assert.deepEqual(harness.appendedSources, []);
  assert.equal(await loader.restorePending(), true);
  assert.equal(harness.counts().realRestoreCalls, 1);
  assert.equal(harness.counts().realConfigureCalls, 1);
});

test("closing during lazy load prevents a late real-controller open", async () => {
  const harness = createHarness();
  const loader = harness.context.MemberLotteryDialog;
  configure(loader);

  const opening = loader.open(createTicket());
  assert.equal(loader.requestClose({ returnToTickets: true }), true);
  assert.equal(await opening, false);
  assert.equal(harness.counts().realConfigureCalls, 1);
  assert.equal(harness.counts().realOpenCalls, 0);
});

test("module load failure fails closed without invoking draw or request code", async () => {
  const harness = createHarness({ failSource: "lottery/draw-service.js" });
  const loader = harness.context.MemberLotteryDialog;
  let requestCalls = 0;
  configure(loader, {
    request() {
      requestCalls += 1;
      return Promise.resolve({ ok: true });
    },
  });

  const opened = await loader.open(createTicket());

  assert.equal(opened, false);
  assert.equal(requestCalls, 0);
  assert.equal(harness.counts().realOpenCalls, 0);
  assert.equal(harness.counts().realConfigureCalls, 0);
});
