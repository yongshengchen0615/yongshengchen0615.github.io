const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const bootstrapSource = fs.readFileSync(
  path.join(root, "client/member-lottery-v2.js"),
  "utf8"
);
const storeSource = fs.readFileSync(
  path.join(root, "client/lottery/pending-request-store.js"),
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
    if (!definition) throw new Error(`missing module ${name}`);
    const value = definition.factory(
      ...definition.dependencies.map((dependency) => this.get(dependency))
    );
    this.instances.set(name, value);
    return value;
  }
}

function createContracts() {
  return {
    createError(code, message) {
      const error = new Error(message);
      error.code = code;
      return error;
    },
    normalizeRequestId(value) {
      const requestId = String(value || "");
      if (!/^[A-Za-z0-9-]{10,80}$/.test(requestId)) {
        throw this.createError("INVALID_REQUEST_ID", "bad request id");
      }
      return requestId;
    },
    normalizeTicket(value) {
      const ticket = {
        settingVersion: String(value.settingVersion || ""),
        cardNumber: Number(value.cardNumber),
        milestonePoints: Number(value.milestonePoints),
        lotteryTypeId: String(value.lotteryTypeId || ""),
        cardRoundKey: String(value.cardRoundKey || ""),
      };
      if (
        !/^PCS-[A-Z0-9]{12}$/.test(ticket.settingVersion) ||
        !/^LTY-[A-Z0-9]{10}$/.test(ticket.lotteryTypeId) ||
        ticket.cardRoundKey !==
          `${ticket.settingVersion}:${ticket.cardNumber}:${ticket.milestonePoints}`
      ) {
        throw this.createError("INVALID_LOTTERY_TICKET", "bad ticket");
      }
      return Object.freeze(ticket);
    },
  };
}

function createTicket() {
  return {
    settingVersion: "PCS-TEST00000001",
    cardNumber: 1,
    milestonePoints: 10,
    lotteryTypeId: "LTY-TEST000001",
    cardRoundKey: "PCS-TEST00000001:1:10",
  };
}

function loadStoreFactory() {
  const registry = new Registry();
  registry.set("lottery.contracts", createContracts());
  const window = { PersonaModules: registry };
  window.window = window;
  vm.runInContext(
    storeSource,
    vm.createContext({ window, JSON, Object, RegExp, String })
  );
  return registry.get("lottery.pending-request-store");
}

function createStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.get(key) || null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
    has(key) {
      return values.has(key);
    },
  };
}

test("member-lottery-v2 is a composition root that publishes only the existing facade", () => {
  const facade = Object.freeze({ open() {}, configure() {} });
  const registry = {
    get(name) {
      assert.equal(name, "lottery.dialog-controller");
      return {
        create(options) {
          assert.ok(options.root);
          assert.ok(options.document);
          assert.ok(options.memberApi);
          assert.ok(options.wheelRenderer);
          return facade;
        },
      };
    },
  };
  const window = {
    PersonaModules: registry,
    document: {},
    MemberApi: {},
    LotteryWheel: {},
  };
  window.window = window;

  vm.runInContext(
    bootstrapSource,
    vm.createContext({ window, Error, Object })
  );

  assert.equal(window.MemberLotteryDialog, facade);
  assert.equal(window.MemberLotteryDialogLegacy, undefined);
  assert.equal(window.MemberLotteryPreparationService, undefined);
  assert.equal(window.MemberLotteryDrawService, undefined);
});

test("pending draw request is isolated by member and demo scope", () => {
  const factory = loadStoreFactory();
  const storage = createStorage();
  let memberId = "MBR-AAAAAAAAAA";
  let demo = false;
  let sequence = 0;
  const store = factory.create({
    liffId: "liff-runtime",
    storage,
    isDemo() {
      return demo;
    },
    getMemberId() {
      return memberId;
    },
    createRequestId() {
      sequence += 1;
      return `runtime-request-${String(sequence).padStart(4, "0")}`;
    },
  });

  const memberARequest = store.ensure(createTicket());
  assert.equal(memberARequest.requestId, "runtime-request-0001");
  assert.equal(
    storage.has("persona-member-lottery-round-request:liff-runtime:MBR-AAAAAAAAAA"),
    true
  );

  memberId = "MBR-BBBBBBBBBB";
  assert.equal(store.read(), null);

  demo = true;
  assert.equal(store.read(), null);
  const demoRequest = store.ensure(createTicket());
  assert.equal(demoRequest.requestId, "runtime-request-0002");
  assert.equal(
    storage.has("persona-member-lottery-round-request:liff-runtime:demo"),
    true
  );

  demo = false;
  memberId = "MBR-AAAAAAAAAA";
  assert.equal(store.read().requestId, "runtime-request-0001");
});

test("a new store instance restores the same pending request for reload retry", () => {
  const factory = loadStoreFactory();
  const storage = createStorage();
  const options = {
    liffId: "liff-runtime",
    storage,
    isDemo() {
      return false;
    },
    getMemberId() {
      return "MBR-AAAAAAAAAA";
    },
    createRequestId() {
      return "runtime-request-0001";
    },
  };

  const first = factory.create(options);
  first.ensure(createTicket());
  const reloaded = factory.create({
    ...options,
    createRequestId() {
      throw new Error("reload must reuse persisted request id");
    },
  });

  assert.equal(reloaded.read().requestId, "runtime-request-0001");
  assert.equal(reloaded.ensure(createTicket()).requestId, "runtime-request-0001");
});

test("production runtime no longer includes any legacy lottery implementation", () => {
  const html = fs.readFileSync(path.join(root, "client/index.html"), "utf8");
  assert.match(html, /src=["']member-lottery-v2\.js["']/);
  assert.match(html, /src=["']lottery\/draw-service\.js["']/);
  for (const relativePath of [
    "client/member-lottery.js",
    "client/member-lottery-preload.js",
    "client/lottery.js",
    "client/lottery/preload-controller.js",
    "client/lottery/preparation-view.js",
    "client/lottery/wheel-draw-guard.js",
  ]) {
    assert.equal(fs.existsSync(path.join(root, relativePath)), false, relativePath);
  }
});
