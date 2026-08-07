const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.resolve(__dirname, "../client/lottery/workspace-service.js"),
  "utf8"
);

class Registry {
  constructor() {
    this.definitions = new Map();
    this.instances = new Map();
  }
  define(name, dependencies, factory) {
    this.definitions.set(name, { dependencies, factory });
  }
  set(name, value) {
    this.instances.set(name, value);
  }
  get(name) {
    if (this.instances.has(name)) return this.instances.get(name);
    const definition = this.definitions.get(name);
    const value = definition.factory(
      ...definition.dependencies.map((dependency) => this.get(dependency))
    );
    this.instances.set(name, value);
    return value;
  }
}

function createHarness() {
  const registry = new Registry();
  const events = [];
  registry.set("lottery.contracts", {
    createError(code, message) {
      const error = new Error(message);
      error.code = code;
      return error;
    },
    assertSuccessfulResponse(response) {
      if (!response || response.ok !== true) {
        const error = new Error("backend error");
        error.code = "BACKEND_ERROR";
        throw error;
      }
      return response;
    },
  });

  class CustomEvent {
    constructor(type, options = {}) {
      this.type = type;
      this.detail = options.detail;
    }
  }

  const window = {
    PersonaModules: registry,
    CustomEvent,
    dispatchEvent(event) {
      events.push({ type: event.type, detail: event.detail });
      return true;
    },
    performance: {
      now() {
        return 10;
      },
    },
  };
  window.window = window;

  vm.runInContext(
    source,
    vm.createContext({
      window,
      Date,
      Error,
      Math,
      Number,
      Object,
      Promise,
      String,
    })
  );

  return {
    factory: registry.get("lottery.workspace-service"),
    events,
  };
}

function workspaceStates(events) {
  return events
    .filter((event) => event.type === "persona:lottery-workspace-state")
    .map((event) => event.detail);
}

test("network workspace refresh emits loading then ready without business data", async () => {
  const harness = createHarness();
  const service = harness.factory.create({
    request() {
      return Promise.resolve({ ok: true, data: { secretLikeValue: "not-emitted" } });
    },
  });

  await service.load({ force: true });
  const states = workspaceStates(harness.events);

  assert.deepEqual(
    states.map((detail) => detail.state),
    ["loading", "ready"]
  );
  assert.deepEqual(
    states.map((detail) => detail.current),
    [true, true]
  );
  for (const detail of states) {
    assert.deepEqual(Object.keys(detail).sort(), [
      "current",
      "generation",
      "source",
      "state",
    ]);
    assert.equal(detail.source, "network");
    assert.equal("data" in detail, false);
    assert.equal("ticket" in detail, false);
    assert.equal("memberId" in detail, false);
  }
});

test("failed workspace refresh emits error and preserves rejection", async () => {
  const harness = createHarness();
  const service = harness.factory.create({
    request() {
      return Promise.resolve({ ok: false, code: "BACKEND_ERROR" });
    },
  });

  await assert.rejects(service.load({ force: true }), /backend error/);
  assert.deepEqual(
    workspaceStates(harness.events).map((detail) => detail.state),
    ["loading", "error"]
  );
});

test("late response from an invalidated generation is explicitly marked non-current", async () => {
  const harness = createHarness();
  const resolvers = [];
  const service = harness.factory.create({
    request() {
      return new Promise((resolve) => resolvers.push(resolve));
    },
  });

  const first = service.load({ force: true });
  await Promise.resolve();
  service.invalidate();
  const second = service.load({ force: true });
  await Promise.resolve();

  resolvers[0]({ ok: true, data: { version: 1 } });
  await first;
  resolvers[1]({ ok: true, data: { version: 2 } });
  await second;

  const states = workspaceStates(harness.events);
  const readyStates = states.filter((detail) => detail.state === "ready");
  assert.equal(readyStates.length, 2);
  assert.equal(readyStates[0].generation, 0);
  assert.equal(readyStates[0].current, false);
  assert.equal(readyStates[1].generation, 1);
  assert.equal(readyStates[1].current, true);
});
