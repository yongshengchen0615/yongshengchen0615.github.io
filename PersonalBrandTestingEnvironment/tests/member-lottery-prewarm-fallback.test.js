const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const loaderCode = fs.readFileSync(
  path.join(__dirname, "..", "client", "member-lottery-loader.js"),
  "utf8"
);

test("login Lottery preload starts immediately without an artificial timer", () => {
  const scheduledDelays = [];
  const appended = [];
  const context = {
    console,
    document: {
      head: { appendChild(script) { appended.push(script.src); } },
      documentElement: null,
      createElement() {
        return {
          dataset: {},
          src: "",
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
      throw new Error("config request cannot start before runtime is loaded");
    },
  });

  context.MemberLotteryDialog.prewarm();

  assert.deepEqual(scheduledDelays, []);
  assert.deepEqual(appended, ["../shared/lottery-wheel.js", "../shared/module-registry.js"]);
});
