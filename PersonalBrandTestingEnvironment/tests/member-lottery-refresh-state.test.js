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
      Error,
      Object,
      Promise,
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

test("composition root preserves the existing MemberLotteryDialog facade", () => {
  const harness = createHarness();
  assert.equal(harness.window.MemberLotteryDialog, harness.controller);
});

test("background loading reasserts truthful sync state after host releases ticket buttons", () => {
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
    "正在背景同步最新抽獎券；目前票券仍可直接選擇。"
  );
  assert.equal(harness.status.dataset.tone, "loading");
});

test("ready and error states settle aria-busy without disabling selection", () => {
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
    "最新抽獎券狀態已同步，可直接選擇票券。"
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
  assert.match(harness.status.textContent, /仍可選擇/);
  assert.match(harness.status.textContent, /再次安全驗證/);
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
    "最新抽獎券狀態已同步，可直接選擇票券。"
  );
  assert.equal(harness.status.dataset.tone, "ready");
});
