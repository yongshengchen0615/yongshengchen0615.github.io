const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const loaderCode = fs.readFileSync(
  path.join(__dirname, "..", "client", "member-lottery-loader.js"),
  "utf8"
);

test("a prewarmed Lottery runtime prepares first and only then opens the real controller", async () => {
  let lotteryShowModalCalls = 0;
  let realPrepareCalls = 0;
  let realOpenCalls = 0;
  const scripts = new Map();
  const lotteryDialog = {
    open: false,
    attrs: new Set(["hidden"]),
    setAttribute(name) {
      this.attrs.add(name);
      if (name === "open") this.open = true;
    },
    removeAttribute(name) {
      this.attrs.delete(name);
      if (name === "open") this.open = false;
    },
    hasAttribute(name) {
      return this.attrs.has(name);
    },
    showModal() {
      lotteryShowModalCalls += 1;
      this.open = true;
      this.attrs.add("open");
    },
  };
  const elements = {
    "member-lottery-dialog": lotteryDialog,
    "member-lottery-loading-state": { hidden: true },
    "member-lottery-error-state": { hidden: false },
    "member-lottery-wheel-state": { hidden: false },
    "member-lottery-result-state": { hidden: false },
    "member-lottery-loading-title": { textContent: "" },
    "member-lottery-loading-message": { textContent: "" },
    "member-lottery-dialog-description": { textContent: "" },
    "member-lottery-spin-status": { textContent: "" },
    "member-lottery-ticket-detail": { textContent: "" },
  };
  const realFacade = {
    configure() {},
    prepareForOpen() {
      realPrepareCalls += 1;
      assert.equal(lotteryDialog.open, false);
      return Promise.resolve(true);
    },
    open() {
      realOpenCalls += 1;
      return Promise.resolve(true);
    },
    refreshTickets() {
      return Promise.resolve({});
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
        if (listeners[name]) listeners[name]();
      },
    };
  }

  const document = {
    head: {
      appendChild(script) {
        scripts.set(script.src, script);
        script.parentNode = this;
        queueMicrotask(() => {
          if (script.src === "member-lottery-v2.js") {
            context.MemberLotteryDialog = realFacade;
          }
          script.emit("load");
        });
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
      return elements[id] || null;
    },
  };
  function CustomEvent(name, init) {
    this.type = name;
    this.detail = init && init.detail;
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
      getItem() {
        return null;
      },
      removeItem() {},
    },
    dispatchEvent() {
      return true;
    },
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(loaderCode, context, { filename: "member-lottery-loader.js" });

  const loader = context.MemberLotteryDialog;
  loader.configure({
    liffId: "2000000000-abcdefgh",
    getMemberId: () => "MBR-ABCDEF1234",
    getCurrentCardSummary: () => ({ availableRewards: [] }),
    isDemo: () => false,
    normalizeError: (error) => ({ code: error.code, message: error.message }),
    request() {
      throw new Error("warm handoff must not call GAS from the loader");
    },
    showToast() {},
  });

  assert.equal(await loader.prewarm(), true);
  assert.equal(lotteryShowModalCalls, 0);

  const opened = await loader.open({
    settingVersion: "PCS-ABCDEFGHIJKL",
    cardNumber: 2,
    milestonePoints: 10,
    lotteryTypeId: "LTY-ABCDEFGHIJ",
    cardRoundKey: "PCS-ABCDEFGHIJKL:2:10",
  });

  assert.equal(opened, true);
  assert.equal(realPrepareCalls, 1);
  assert.equal(realOpenCalls, 1);
  assert.equal(lotteryShowModalCalls, 0);
});
