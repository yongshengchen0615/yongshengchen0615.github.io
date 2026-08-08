const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const loaderCode = fs.readFileSync(
  path.join(__dirname, "..", "client", "member-lottery-loader.js"),
  "utf8"
);

const REGISTRY_SOURCE = "../shared/module-registry.js";
const WHEEL_SOURCE = "../shared/lottery-wheel.js";
const RUNTIME_SOURCES = [
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
const ENTRY_SOURCE = "member-lottery-v2.js";

function createHarness(options = {}) {
  const appendedSources = [];
  const scriptsBySource = new Map();
  const storage = new Map();
  const listeners = new Map();
  const performanceEvents = [];
  let realConfigureCalls = 0;
  let realRefreshCalls = 0;
  let realPrepareCalls = 0;
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
    prepareForOpen() {
      realPrepareCalls += 1;
      return Promise.resolve(true);
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

  function emitScript(source, eventName = "load") {
    const script = scriptsBySource.get(source);
    assert.ok(script, `script was not appended: ${source}`);
    if (source === ENTRY_SOURCE && eventName === "load") {
      context.MemberLotteryDialog = realFacade;
    }
    script.emit(eventName);
  }

  const document = {
    head: {
      appendChild(script) {
        appendedSources.push(script.src);
        scriptsBySource.set(script.src, script);
        script.parentNode = this;
        if (!options.manualLoad) {
          queueMicrotask(() => {
            emitScript(
              script.src,
              options.failSource === script.src ? "error" : "load"
            );
          });
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
    getElementById() {
      return null;
    },
  };

  function CustomEvent(name, init = {}) {
    this.type = name;
    this.detail = init.detail;
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
    CustomEvent,
    performance: { now: () => Date.now() },
    setTimeout,
    clearTimeout,
    queueMicrotask,
    requestIdleCallback(callback) {
      queueMicrotask(() => callback({ didTimeout: false, timeRemaining: () => 50 }));
      return 1;
    },
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
    dispatchEvent(event) {
      if (event.type === "persona:lottery-performance") {
        performanceEvents.push(event.detail);
      }
      return true;
    },
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(loaderCode, context, { filename: "member-lottery-loader.js" });

  return {
    context,
    storage,
    appendedSources,
    performanceEvents,
    realFacade,
    emitScript,
    counts() {
      return {
        realConfigureCalls,
        realRefreshCalls,
        realPrepareCalls,
        realOpenCalls,
        realRestoreCalls,
      };
    },
  };
}

function configResponse() {
  return {
    ok: true,
    data: {
      access: { allowed: true },
      lotteryTypes: [],
      card: { availableRewards: [], availableDraws: 0 },
      totalPoints: 0,
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
    request(action) {
      if (action === "getLotteryConfig") return Promise.resolve(configResponse());
      throw new Error(`unexpected action: ${action}`);
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

test("loader keeps Lottery V2 and wheel off the initial execution path", async () => {
  const harness = createHarness();
  const loader = harness.context.MemberLotteryDialog;
  configure(loader);

  assert.deepEqual(harness.appendedSources, []);
  assert.equal(harness.counts().realConfigureCalls, 0);

  await loader.ensureLoaded();
  assert.deepEqual(harness.appendedSources, [
    WHEEL_SOURCE,
    REGISTRY_SOURCE,
    ...RUNTIME_SOURCES,
    ENTRY_SOURCE,
  ]);
  assert.equal(harness.counts().realConfigureCalls, 1);
  assert.equal(harness.context.MemberLotteryDialog, loader);
  assert.deepEqual(
    harness.performanceEvents.map((event) => event.phase),
    ["lottery_runtime_load"]
  );
});

test("wheel and registry start together, definitions wait for registry, and entry loads last", async () => {
  const harness = createHarness({ manualLoad: true });
  const loader = harness.context.MemberLotteryDialog;
  configure(loader);

  const loading = loader.ensureLoaded();
  assert.deepEqual(harness.appendedSources, [WHEEL_SOURCE, REGISTRY_SOURCE]);

  harness.emitScript(REGISTRY_SOURCE);
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(harness.appendedSources, [
    WHEEL_SOURCE,
    REGISTRY_SOURCE,
    ...RUNTIME_SOURCES,
  ]);
  assert.equal(harness.appendedSources.includes(ENTRY_SOURCE), false);

  RUNTIME_SOURCES.forEach((source) => harness.emitScript(source));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.appendedSources.includes(ENTRY_SOURCE), false);

  harness.emitScript(WHEEL_SOURCE);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.appendedSources.at(-1), ENTRY_SOURCE);

  harness.emitScript(ENTRY_SOURCE);
  assert.equal(await loading, harness.realFacade);
  assert.equal(harness.counts().realConfigureCalls, 1);
});

test("ticket refresh before login preload stays local and does not start Lottery I/O", async () => {
  const harness = createHarness();
  const loader = harness.context.MemberLotteryDialog;
  const summary = configure(loader);

  const returned = await loader.refreshTickets({ force: true });
  assert.equal(returned, summary);
  assert.equal(harness.appendedSources.length, 0);
  assert.equal(harness.counts().realRefreshCalls, 0);
});

test("login prewarm single-flights runtime plus one authoritative config snapshot", async () => {
  const harness = createHarness();
  const loader = harness.context.MemberLotteryDialog;
  let requestCalls = 0;
  configure(loader, {
    request(action) {
      assert.equal(action, "getLotteryConfig");
      requestCalls += 1;
      return Promise.resolve(configResponse());
    },
  });

  const first = loader.prewarm();
  const second = loader.prewarm();
  assert.equal(first, second);
  assert.equal(await first, true);
  assert.equal(requestCalls, 1);
  assert.equal(harness.appendedSources.length, 13);
  assert.equal(harness.counts().realRefreshCalls, 1);
  assert.equal(harness.counts().realPrepareCalls, 0);
  assert.equal(harness.counts().realOpenCalls, 0);
  assert.ok(
    harness.performanceEvents.some((event) => event.phase === "lottery_session_preload")
  );
});

test("pending draw recovery can preload session state before delegating", async () => {
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
  assert.equal(harness.counts().realRefreshCalls, 1);
});

test("opening after login preload prepares locally then delegates open", async () => {
  const harness = createHarness();
  const loader = harness.context.MemberLotteryDialog;
  configure(loader);

  assert.equal(await loader.prewarm(), true);
  assert.equal(await loader.open(createTicket()), true);
  assert.equal(harness.counts().realPrepareCalls, 1);
  assert.equal(harness.counts().realOpenCalls, 1);
});

test("opening before session preload fails closed without starting Lottery I/O", async () => {
  const harness = createHarness();
  const loader = harness.context.MemberLotteryDialog;
  configure(loader);

  assert.equal(await loader.open(createTicket()), false);
  assert.equal(harness.appendedSources.length, 0);
  assert.equal(harness.counts().realConfigureCalls, 0);
  assert.equal(harness.counts().realPrepareCalls, 0);
  assert.equal(harness.counts().realOpenCalls, 0);
});

test("closing after login preload cancels queued preparation and local open delegation", async () => {
  const harness = createHarness();
  const loader = harness.context.MemberLotteryDialog;
  configure(loader);

  assert.equal(await loader.prewarm(), true);
  const opening = loader.open(createTicket());
  assert.equal(loader.requestClose({ returnToTickets: true }), true);
  assert.equal(await opening, false);
  assert.equal(harness.counts().realPrepareCalls, 0);
  assert.equal(harness.counts().realOpenCalls, 0);
});

test("module load failure during login preload fails closed before any config or draw request", async () => {
  const harness = createHarness({ failSource: "lottery/draw-service.js" });
  const loader = harness.context.MemberLotteryDialog;
  let requestCalls = 0;
  configure(loader, {
    request() {
      requestCalls += 1;
      return Promise.resolve(configResponse());
    },
  });

  assert.equal(await loader.prewarm(), false);
  assert.equal(requestCalls, 0);
  assert.equal(harness.counts().realPrepareCalls, 0);
  assert.equal(harness.counts().realOpenCalls, 0);
  assert.equal(harness.counts().realConfigureCalls, 0);
});
