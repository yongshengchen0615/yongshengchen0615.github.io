const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const loaderCode = fs.readFileSync(
  path.join(__dirname, "..", "client", "member-lottery-loader.js"),
  "utf8"
);

test("Lottery prewarm reports only privacy-safe scheduling wait data", () => {
  const events = [];
  let idleCallback = null;
  let now = 100;

  const document = {
    head: { appendChild() {} },
    documentElement: null,
    createElement() {
      return {
        dataset: {},
        src: "",
        async: true,
        addEventListener() {},
      };
    },
    querySelector() {
      return null;
    },
  };

  function CustomEvent(type, init) {
    this.type = type;
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
    performance: {
      now() {
        return now;
      },
    },
    setTimeout,
    clearTimeout,
    requestIdleCallback(callback) {
      idleCallback = callback;
      return 1;
    },
    sessionStorage: {
      getItem() {
        return null;
      },
      removeItem() {},
    },
    dispatchEvent(event) {
      events.push(event);
      return true;
    },
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(loaderCode, context, { filename: "member-lottery-loader.js" });

  context.MemberLotteryDialog.configure({
    liffId: "2000000000-abcdefgh",
    getMemberId: () => "MBR-ABCDEF1234",
    isDemo: () => false,
    request() {
      throw new Error("runtime prewarm must not call GAS");
    },
  });

  context.MemberLotteryDialog.prewarm();
  assert.equal(typeof idleCallback, "function");

  now = 175;
  idleCallback({ didTimeout: false, timeRemaining: () => 30 });

  assert.equal(events.length, 1);
  assert.equal(events[0].type, "persona:lottery-performance");
  assert.deepEqual(Object.keys(events[0].detail).sort(), [
    "durationMs",
    "phase",
    "source",
  ]);
  assert.equal(events[0].detail.phase, "lottery_runtime_prewarm_wait");
  assert.equal(events[0].detail.durationMs, 75);
  assert.equal(events[0].detail.source, "idle");
  assert.equal(JSON.stringify(events[0].detail).includes("MBR-ABCDEF1234"), false);
  assert.equal(JSON.stringify(events[0].detail).includes("2000000000-abcdefgh"), false);
});
