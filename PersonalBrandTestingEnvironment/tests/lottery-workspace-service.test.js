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

function createFactory() {
  const registry = new Registry();
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
  const window = { PersonaModules: registry };
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
  return registry.get("lottery.workspace-service");
}

test("concurrent workspace loads share one backend request and reuse a fresh cache", async () => {
  const factory = createFactory();
  let calls = 0;
  let now = 1000;
  let resolveRequest;
  const service = factory.create({
    ttlMs: 5000,
    now: () => now,
    request() {
      calls += 1;
      return new Promise((resolve) => {
        resolveRequest = resolve;
      });
    },
  });

  const first = service.load({ force: true });
  const second = service.load({ force: true });
  assert.equal(first, second);
  assert.equal(calls, 0);
  await Promise.resolve();
  assert.equal(calls, 1);
  resolveRequest({ ok: true, data: { version: 1 } });
  assert.deepEqual(await first, { ok: true, data: { version: 1 } });

  now += 1000;
  assert.deepEqual(await service.load(), { ok: true, data: { version: 1 } });
  assert.equal(calls, 1);
});

test("allowStale is bounded and cannot reuse an indefinitely old workspace", async () => {
  const factory = createFactory();
  let calls = 0;
  let now = 1000;
  const responses = [
    { ok: true, data: { version: 1 } },
    { ok: true, data: { version: 2 } },
  ];
  const service = factory.create({
    ttlMs: 5000,
    maxStaleMs: 30000,
    now: () => now,
    request() {
      const response = responses[calls];
      calls += 1;
      return Promise.resolve(response);
    },
  });

  assert.deepEqual(await service.load({ force: true }), responses[0]);
  now += 10000;
  assert.deepEqual(await service.load({ allowStale: true }), responses[0]);
  assert.equal(calls, 1);

  now += 30000;
  assert.deepEqual(await service.load({ allowStale: true }), responses[1]);
  assert.equal(calls, 2);
});

test("invalidating a workspace prevents a stale request from repopulating the cache", async () => {
  const factory = createFactory();
  let calls = 0;
  const resolvers = [];
  const service = factory.create({
    request() {
      calls += 1;
      return new Promise((resolve) => resolvers.push(resolve));
    },
  });

  const stale = service.load({ force: true });
  await Promise.resolve();
  service.invalidate();
  resolvers[0]({ ok: true, data: { version: 1 } });
  await stale;

  const fresh = service.load();
  await Promise.resolve();
  assert.equal(calls, 2);
  resolvers[1]({ ok: true, data: { version: 2 } });
  assert.deepEqual(await fresh, { ok: true, data: { version: 2 } });
});
