const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const legacyLoadedModules = [
  "client/lottery/pending-request-store.js",
  "client/lottery/preparation-service.js",
  "client/lottery/preparation-view.js",
  "client/lottery/wheel-draw-guard.js",
];
const preloadSource = fs.readFileSync(
  path.join(root, "client/member-lottery-preload.js"),
  "utf8"
);

function createContext({ expectsRegistry }) {
  const legacy = {
    configure() {},
    open() {},
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
  };
  const scripts = expectsRegistry
    ? [{ getAttribute(name) {
        return name === "src" ? "../shared/module-registry.js" : null;
      } }]
    : [];
  const window = {
    console: { error() {} },
    document: { scripts },
    MemberLotteryDialog: legacy,
  };
  window.window = window;
  const context = vm.createContext({
    Array,
    Error,
    Object,
    Promise,
    RegExp,
    String,
    window,
  });
  return { context, legacy, window };
}

test("legacy script boundary remains operational until registry activation", () => {
  const harness = createContext({ expectsRegistry: false });

  for (const relativePath of legacyLoadedModules) {
    assert.doesNotThrow(() => {
      vm.runInContext(
        fs.readFileSync(path.join(root, relativePath), "utf8"),
        harness.context,
        { filename: relativePath }
      );
    });
  }

  vm.runInContext(preloadSource, harness.context, {
    filename: "client/member-lottery-preload.js",
  });

  assert.strictEqual(harness.window.MemberLotteryDialog, harness.legacy);
});

test("declared registry load failure does not silently use online draw", () => {
  const harness = createContext({ expectsRegistry: true });

  vm.runInContext(preloadSource, harness.context, {
    filename: "client/member-lottery-preload.js",
  });

  assert.notStrictEqual(harness.window.MemberLotteryDialog, harness.legacy);
  assert.throws(
    () => harness.window.MemberLotteryDialog.configure({}),
    (error) => error.code === "LOTTERY_BOOTSTRAP_ERROR"
  );
});
