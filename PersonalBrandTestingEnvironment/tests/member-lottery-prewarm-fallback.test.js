const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const loaderCode = fs.readFileSync(
  path.join(__dirname, "..", "client", "member-lottery-loader.js"),
  "utf8"
);

test("WebViews without requestIdleCallback enqueue Lottery prewarm on the next task without a fixed delay", () => {
  const scheduledDelays = [];
  const context = {
    console,
    document: {
      head: { appendChild() {} },
      documentElement: null,
      createElement() {
        return {
          dataset: {},
          addEventListener() {},
        };
      },
      querySelector() {
        return null;
      },
    },
    Promise,
    Error,
    JSON,
    Number,
    Object,
    RegExp,
    String,
    Date,
    Math,
    performance: { now: () => 0 },
    setTimeout(_callback, delay) {
      scheduledDelays.push(delay);
      return 1;
    },
    clearTimeout() {},
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

  context.MemberLotteryDialog.configure({
    liffId: "2000000000-abcdefgh",
    getMemberId: () => "MBR-ABCDEF1234",
    isDemo: () => false,
    request() {
      throw new Error("runtime prewarm must not call GAS");
    },
  });

  context.MemberLotteryDialog.prewarm();

  assert.deepEqual(scheduledDelays, [0]);
});
