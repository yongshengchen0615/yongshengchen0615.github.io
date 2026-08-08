const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const loaderCode = fs.readFileSync(
  path.join(__dirname, "..", "client", "member-lottery-loader.js"),
  "utf8"
);

test("login Lottery preload no longer waits for idle scheduling", () => {
  const events = [];
  let idleCallbackCalls = 0;
  const appended = [];

  const document = {
    head: {
      appendChild(script) {
        appended.push(script.src);
      },
    },
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
    performance: { now: () => 100 },
    setTimeout,
    clearTimeout,
    requestIdleCallback() {
      idleCallbackCalls += 1;
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
      throw new Error("config request cannot start before runtime is loaded");
    },
  });

  context.MemberLotteryDialog.prewarm();

  assert.equal(idleCallbackCalls, 0);
  assert.deepEqual(appended, ["../shared/lottery-wheel.js", "../shared/module-registry.js"]);
  assert.equal(
    events.some((event) => event.detail?.phase === "lottery_runtime_prewarm_wait"),
    false
  );
});
