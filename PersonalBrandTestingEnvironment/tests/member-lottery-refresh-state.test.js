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
  const timers = [];
  const attributes = new Map();
  const status = {
    textContent: "",
    dataset: {},
  };
  const dialog = {
    open: true,
    setAttribute(name, value) {
      attributes.set(name, String(value));
    },
    getAttribute(name) {
      return attributes.get(name) || null;
    },
    hasAttribute(name) {
      return name === "open" ? this.open : attributes.has(name);
    },
  };
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
  const document = {
    getElementById(id) {
      if (id === "member-ticket-dialog") return dialog;
      if (id === "member-ticket-refresh-status") return status;
      return null;
    },
  };
  const window = {
    PersonaModules: registry,
    document,
    MemberApi: {},
    LotteryWheel: {},
    sessionStorage: {
      getItem() {
        return null;
      },
      setItem() {},
      removeItem() {},
    },
    addEventListener(name, callback) {
      listeners.set(name, callback);
    },
    setTimeout(callback) {
      timers.push(callback);
      return timers.length;
    },
  };
  window.window = window;

  vm.runInContext(
    source,
    vm.createContext({
      window,
      Array,
      Boolean,
      Error,
      JSON,
      Math,
      Number,
      Object,
      Promise,
      RegExp,
      String,
    })
  );

  function emit(detail) {
    const listener = listeners.get("persona:lottery-workspace-state");
    assert.equal(typeof listener, "function");
    listener({ detail });
  }

  function runTimers() {
    while (timers.length) {
      timers.shift()();
    }
  }

  return {
    window,
    controller,
    dialog,
    status,
    emit,
    runTimers,
  };
}

test("composition root wraps the existing MemberLotteryDialog controller", () => {
  const harness = createHarness();
  assert.notEqual(harness.window.MemberLotteryDialog, harness.controller);
  assert.equal(typeof harness.window.MemberLotteryDialog.configure, "function");
  assert.equal(typeof harness.window.MemberLotteryDialog.prepareForOpen, "function");
  assert.equal(typeof harness.window.MemberLotteryDialog.open, "function");
});

test("background loading reasserts truthful prepared-reveal state after host releases ticket buttons", () => {
  const harness = createHarness();

  harness.emit({
    state: "loading",
    source: "network",
    generation: 0,
    current: true,
  });

  // Host SWR resolves immediately and may write its optimistic copy first.
  harness.dialog.setAttribute("aria-busy", "false");
  harness.status.textContent = "抽獎券已更新，請選擇要使用的票券。";
  harness.status.dataset.tone = "ready";

  harness.runTimers();

  assert.equal(harness.dialog.getAttribute("aria-busy"), "true");
  assert.equal(
    harness.status.textContent,
    "正在整理登入時預載的抽獎資料…"
  );
  assert.equal(harness.status.dataset.tone, "loading");
});

test("ready and error states describe zero-GAS reveal behavior", () => {
  const harness = createHarness();

  harness.emit({
    state: "ready",
    source: "network",
    generation: 0,
    current: true,
  });
  harness.runTimers();
  assert.equal(harness.dialog.getAttribute("aria-busy"), "false");
  assert.equal(
    harness.status.textContent,
    "抽獎資料已完成登入預載；開券與轉盤動畫不會再呼叫後端。"
  );
  assert.equal(harness.status.dataset.tone, "ready");

  harness.emit({
    state: "error",
    source: "network",
    generation: 0,
    current: true,
  });
  harness.runTimers();
  assert.equal(harness.dialog.getAttribute("aria-busy"), "false");
  assert.match(harness.status.textContent, /登入預載暫時失敗/);
  assert.match(harness.status.textContent, /重新整理/);
  assert.equal(harness.status.dataset.tone, "warning");
});

test("stale generation events and closed dialogs cannot overwrite current host UI", () => {
  const harness = createHarness();
  harness.status.textContent = "keep-current";
  harness.status.dataset.tone = "ready";

  harness.emit({
    state: "ready",
    source: "network",
    generation: 0,
    current: false,
  });
  harness.runTimers();
  assert.equal(harness.status.textContent, "keep-current");

  harness.dialog.open = false;
  harness.emit({
    state: "error",
    source: "network",
    generation: 1,
    current: true,
  });
  harness.runTimers();
  assert.equal(harness.status.textContent, "keep-current");
});

test("a fast ready event cancels the queued loading copy to avoid flicker", () => {
  const harness = createHarness();

  harness.emit({
    state: "loading",
    source: "network",
    generation: 0,
    current: true,
  });
  harness.emit({
    state: "ready",
    source: "network",
    generation: 0,
    current: true,
  });
  harness.runTimers();

  assert.equal(harness.dialog.getAttribute("aria-busy"), "false");
  assert.equal(
    harness.status.textContent,
    "抽獎資料已完成登入預載；開券與轉盤動畫不會再呼叫後端。"
  );
  assert.equal(harness.status.dataset.tone, "ready");
});
