const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const loaderCode = fs.readFileSync(
  path.join(__dirname, "..", "client", "member-lottery-loader.js"),
  "utf8"
);

function createHarness(options = {}) {
  const appendedSources = [];
  const storage = new Map();
  const listeners = new Map();
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

  const document = {
    head: {
      appendChild(script) {
        appendedSources.push(script.src);
        script.parentNode = this;
        if (script.src === "member-lottery-v2.js") {
          context.MemberLotteryDialog = realFacade;
        }
        queueMicrotask(() => script.emit(options.failSource === script.src ? "error" : "load"));
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
    getElementById() {
      return null;
    },
  };

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
    setTimeout,
    clearTimeout,
    queueMicrotask,
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

test("loader keeps Lottery V2 off the initial execution path", async () => {
  const harness = createHarness();
  const loader = harness.context.MemberLotteryDialog;
  configure(loader);

  assert.deepEqual(harness.appendedSources, []);
  assert.equal(harness.counts().realConfigureCalls, 0);

  await loader.ensureLoaded();
  assert.deepEqual(harness.appendedSources, [
    "../shared/module-registry.js",
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
    "member-lottery-v2.js",
  ]);
  assert.equal(harness.counts().realConfigureCalls, 1);
  assert.equal(harness.context.MemberLotteryDialog, loader);
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
