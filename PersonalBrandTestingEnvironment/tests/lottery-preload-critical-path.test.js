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

function createHarness() {
  const scripts = new Map();
  const appendedSources = [];
  let configStarted = false;
  let configResolved = false;
  let resolveConfig;

  const realFacade = {
    configure() {},
    refreshTickets() {
      return Promise.resolve({ availableDraws: 0 });
    },
    prepareForOpen() {
      return Promise.resolve(true);
    },
    open() {
      return Promise.resolve(true);
    },
    restorePending() {
      return Promise.resolve(false);
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

  const context = {
    console,
    Promise,
    Error,
    JSON,
    Number,
    Object,
    RegExp,
    String,
    Date,
    Math,
    performance: { now: () => Date.now() },
    CustomEvent: function CustomEvent(name, init = {}) {
      this.type = name;
      this.detail = init.detail;
    },
    dispatchEvent() {
      return true;
    },
    setTimeout,
    clearTimeout,
    sessionStorage: {
      getItem() {
        return null;
      },
      setItem() {},
      removeItem() {},
    },
  };

  function createScript() {
    const listeners = {};
    return {
      dataset: {},
      src: "",
      async: true,
      parentNode: null,
      addEventListener(name, callback) {
        listeners[name] = callback;
      },
      emit(name) {
        listeners[name]?.();
      },
    };
  }

  context.document = {
    body: null,
    documentElement: null,
    head: {
      appendChild(script) {
        appendedSources.push(script.src);
        scripts.set(script.src, script);
        script.parentNode = this;
      },
      removeChild() {},
    },
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
  context.window = context;
  vm.createContext(context);
  vm.runInContext(loaderCode, context, { filename: "member-lottery-loader.js" });

  const loader = context.MemberLotteryDialog;
  loader.configure({
    liffId: "2000000000-abcdefgh",
    getMemberId: () => "MBR-ABCDEF1234",
    getCurrentCardSummary: () => ({ availableRewards: [], availableDraws: 0 }),
    getCurrentTotalPoints: () => 0,
    isDemo: () => false,
    request(action) {
      assert.equal(action, "getLotteryConfig");
      configStarted = true;
      return new Promise((resolve) => {
        resolveConfig = () => {
          configResolved = true;
          resolve({
            ok: true,
            data: {
              access: { allowed: true },
              lotteryTypes: [],
              card: { availableRewards: [], availableDraws: 0 },
              totalPoints: 0,
            },
          });
        };
      });
    },
    normalizeError: (error) => ({ code: error.code, message: error.message }),
    showToast() {},
  });

  function emit(source) {
    if (source === ENTRY_SOURCE) context.MemberLotteryDialog = realFacade;
    const script = scripts.get(source);
    assert.ok(script, `script was not appended: ${source}`);
    script.emit("load");
  }

  return {
    loader,
    appendedSources,
    get configStarted() {
      return configStarted;
    },
    get configResolved() {
      return configResolved;
    },
    resolveConfig() {
      assert.equal(typeof resolveConfig, "function");
      resolveConfig();
    },
    emit,
  };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}

test("authenticated preload starts authoritative config while runtime scripts are still loading", async () => {
  const harness = createHarness();
  const preload = harness.loader.preloadSession();

  await flush();
  assert.deepEqual(harness.appendedSources, [WHEEL_SOURCE, REGISTRY_SOURCE]);
  assert.equal(
    harness.configStarted,
    true,
    "getLotteryConfig should overlap runtime loading instead of waiting for all scripts"
  );

  harness.emit(REGISTRY_SOURCE);
  await flush();
  RUNTIME_SOURCES.forEach((source) => harness.emit(source));
  harness.emit(WHEEL_SOURCE);
  await flush();
  harness.emit(ENTRY_SOURCE);
  harness.resolveConfig();

  assert.equal(await preload, true);
  assert.equal(harness.configResolved, true);
});
