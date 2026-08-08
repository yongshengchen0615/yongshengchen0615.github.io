const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.join(__dirname, "..", "shared", "gas-api.js"),
  "utf8"
);

test("successful GAS fetch emits privacy-safe transport timing only", async () => {
  const events = [];
  let now = 100;
  const requestId = "request-metric-0001";
  const document = {
    baseURI: "https://example.test/client/",
    head: { appendChild() {} },
    body: { appendChild() {} },
    createElement() {
      return { appendChild() {}, remove() {}, submit() {} };
    },
    querySelector() {
      return null;
    },
  };
  function CustomEvent(type, init) {
    this.type = type;
    this.detail = init && init.detail;
  }
  const window = {
    location: { origin: "https://example.test" },
    performance: {
      now() {
        now += 12.5;
        return now;
      },
    },
    crypto: {
      getRandomValues(bytes) {
        bytes.fill(3);
        return bytes;
      },
    },
    CustomEvent,
    dispatchEvent(event) {
      events.push(event);
      return true;
    },
    fetch() {
      return Promise.resolve({
        ok: true,
        text() {
          return Promise.resolve(JSON.stringify({ ok: true, requestId, data: {} }));
        },
      });
    },
    setTimeout,
    clearTimeout,
    addEventListener() {},
    removeEventListener() {},
  };
  const context = vm.createContext({
    AbortController,
    Promise,
    TypeError,
    URL,
    Uint8Array,
    Object,
    Math,
    Date,
    document,
    setTimeout,
    clearTimeout,
    window,
  });
  vm.runInContext(source, context, { filename: "shared/gas-api.js" });

  const result = await window.MemberApi.sendRequest({
    gasUrl: "https://script.google.com/macros/s/example-deployment/exec",
    action: "getLotteryConfig",
    idToken: "token-value",
    requestId,
    context: { os: "ios" },
  });

  assert.equal(result.ok, true);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "persona:gas-performance");
  assert.deepEqual(Object.keys(events[0].detail).sort(), [
    "durationMs",
    "phase",
    "source",
  ]);
  assert.equal(events[0].detail.phase, "gas_request");
  assert.equal(events[0].detail.source, "fetch");
  assert.equal(typeof events[0].detail.durationMs, "number");
  assert.ok(events[0].detail.durationMs >= 0);
  assert.equal(JSON.stringify(events[0].detail).includes(requestId), false);
  assert.equal(JSON.stringify(events[0].detail).includes("getLotteryConfig"), false);
});
