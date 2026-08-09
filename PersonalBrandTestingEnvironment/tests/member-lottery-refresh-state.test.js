const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.resolve(__dirname, "../client/member-lottery-v2.js"),
  "utf8"
);

function createHarness() {
  const listeners = new Map();
  const controller = Object.freeze({
    configure() {},
    prepareForOpen() {},
    open() {},
    refreshTickets() {},
    restorePending() {},
    hasPending() {
      return false;
    },
    canClose() {
      return true;
    },
    requestClose() {
      return true;
    },
  });
  const registry = {
    get(name) {
      assert.equal(name, "lottery.dialog-controller");
      return {
        create(options) {
          assert.equal(options.root, window);
          assert.equal(options.document, window.document);
          return controller;
        },
      };
    },
  };
  const window = {
    PersonaModules: registry,
    document: {},
    MemberApi: {},
    LotteryWheel: {},
    addEventListener(name, callback) {
      listeners.set(name, callback);
    },
  };
  window.window = window;

  vm.runInContext(
    source,
    vm.createContext({
      window,
      Error,
      Object,
    })
  );

  return { window, controller, listeners };
}

test("composition root exposes the existing MemberLotteryDialog controller directly", () => {
  const harness = createHarness();
  assert.equal(harness.window.MemberLotteryDialog, harness.controller);
  assert.equal(typeof harness.window.MemberLotteryDialog.configure, "function");
  assert.equal(typeof harness.window.MemberLotteryDialog.prepareForOpen, "function");
  assert.equal(typeof harness.window.MemberLotteryDialog.open, "function");
});

test("composition root no longer owns workspace refresh UI or prepared-reveal state", () => {
  const harness = createHarness();
  assert.equal(harness.listeners.has("persona:lottery-workspace-state"), false);
  assert.doesNotMatch(source, /ticketRefreshUiVersion|scheduleTicketRefreshUi/);
  assert.doesNotMatch(source, /登入預抽|preparedEntries|sessionStorage/);
});
