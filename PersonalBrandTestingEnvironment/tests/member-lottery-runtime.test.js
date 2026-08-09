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

test("member-lottery-v2 wraps the existing controller with prepared-reveal orchestration", () => {
  const calls = [];
  const inner = Object.freeze({
    configure() {
      calls.push("configure");
      return inner;
    },
    prepareForOpen() {
      calls.push("prepareForOpen");
      return Promise.resolve(true);
    },
    open() {
      calls.push("open");
      return Promise.resolve(true);
    },
    refreshTickets() {
      calls.push("refreshTickets");
      return Promise.resolve(null);
    },
    restorePending() {
      calls.push("restorePending");
      return Promise.resolve(false);
    },
    hasPending() {
      return false;
    },
    canClose() {
      return true;
    },
    requestClose() {
      calls.push("requestClose");
      return true;
    },
  });
  const registry = {
    get(name) {
      assert.equal(name, "lottery.dialog-controller");
      return {
        create(options) {
          assert.ok(options.root);
          assert.ok(options.document);
          assert.ok(options.memberApi);
          assert.ok(options.wheelRenderer);
          return inner;
        },
      };
    },
  };
  const storage = createStorage();
  const window = {
    PersonaModules: registry,
    document: {},
    MemberApi: { createRequestId() { return "prepared-request-0001"; } },
    LotteryWheel: {},
    sessionStorage: storage,
  };
  window.window = window;

  vm.runInContext(
    bootstrapSource,
    vm.createContext({ window, Error, Object, Promise, JSON, Number, RegExp, String })
  );

  assert.notEqual(window.MemberLotteryDialog, inner);
  assert.equal(typeof window.MemberLotteryDialog.configure, "function");
  assert.equal(typeof window.MemberLotteryDialog.prepareForOpen, "function");
  assert.equal(typeof window.MemberLotteryDialog.open, "function");
  assert.equal(typeof window.MemberLotteryDialog.refreshTickets, "function");
  assert.equal(window.MemberLotteryDialogLegacy, undefined);
  assert.equal(window.MemberLotteryPreparationService, undefined);
  assert.equal(window.MemberLotteryDrawService, undefined);
});

test("prepared reveal performs GAS work during refresh and keeps the click path local", async () => {
  const storage = createStorage();
  let innerOptions = null;
  const inner = {
    configure(value) {
      innerOptions = value;
      return inner;
    },
    prepareForOpen() {
      return Promise.resolve(true);
    },
    open() {
      return Promise.resolve(true);
    },
    refreshTickets() {
      return Promise.resolve(null);
    },
    restorePending() {
      return Promise.resolve(false);
    },
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
  const registry = {
    get() {
      return {
        create() {
          return inner;
        },
      };
    },
  };
  let requestSequence = 0;
  const window = {
    PersonaModules: registry,
    document: {},
    MemberApi: {
      createRequestId() {
        requestSequence += 1;
        return `predraw-request-${String(requestSequence).padStart(4, "0")}`;
      },
    },
    LotteryWheel: {},
    sessionStorage: storage,
  };
  window.window = window;
  vm.runInContext(
    bootstrapSource,
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

  const ticket = createTicket();
  const lotteryType = {
    lotteryTypeId: ticket.lotteryTypeId,
    name: "測試轉盤",
    lottery: {
      lotteryTypeId: ticket.lotteryTypeId,
      configVersion: "LCF-TEST00000001",
      updatedAt: "2026-08-09T00:00:00.000Z",
      prizes: [
        {
          prizeId: "LPR-TEST000001",
          label: "A",
          color: "#112233",
          probability: 50,
        },
        {
          prizeId: "LPR-TEST000002",
          label: "B",
          color: "#445566",
          probability: 50,
        },
      ],
    },
  };
  const card = {
    earnedRewards: 1,
    drawsUsed: 0,
    availableDraws: 1,
    availableRewards: [ticket],
    totalPoints: 12,
  };
  const rawCalls = [];
  let hostCard = card;
  window.MemberLotteryDialog.configure({
    liffId: "liff-runtime",
    getMemberId() {
      return "MBR-AAAAAAAAAA";
    },
    getCurrentCardSummary() {
      return hostCard;
    },
    isDemo() {
      return false;
    },
    onCardUpdated(nextCard) {
      hostCard = nextCard;
    },
    request(action, fields, requestId) {
      rawCalls.push({ action, fields, requestId });
      if (action === "getLotteryConfig") {
        return Promise.resolve({
          ok: true,
          data: {
            access: { allowed: true },
            lotteryTypes: [lotteryType],
            card,
            totalPoints: 12,
          },
        });
      }
      if (action === "drawLottery") {
        return Promise.resolve({
          ok: true,
          data: {
            access: { allowed: true },
            lottery: lotteryType.lottery,
            lotteryType,
            draw: {
              drawId: "LDW-AAAAAAAAAAAAAAAA",
              configVersion: lotteryType.lottery.configVersion,
              prizeId: "LPR-TEST000001",
              prizeLabel: "A",
              prizeColor: "#112233",
              lotteryTypeId: ticket.lotteryTypeId,
              pointsSpent: 0,
              originalPointBalance: 12,
              pointBalance: 12,
              cardRoundKey: ticket.cardRoundKey,
              drawnAt: "2026-08-09T00:00:00.000Z",
            },
            card: {
              ...card,
              drawsUsed: 1,
              availableDraws: 0,
              availableRewards: [],
            },
            totalPoints: 12,
            pointBalance: 12,
          },
        });
      }
      throw new Error(`unexpected action ${action}`);
    },
  });

  await window.MemberLotteryDialog.refreshTickets();
  assert.deepEqual(
    rawCalls.map((call) => call.action),
    ["getLotteryConfig", "drawLottery"]
  );
  assert.equal(hostCard.availableDraws, 1);

  const rawCountBeforeReveal = rawCalls.length;
  const localResult = await innerOptions.request(
    "drawLottery",
    {
      lotteryTypeId: ticket.lotteryTypeId,
      cardRoundKey: ticket.cardRoundKey,
    },
    "reveal-request-0001"
  );
  assert.equal(rawCalls.length, rawCountBeforeReveal);
  assert.equal(localResult.data.draw.prizeId, "LPR-TEST000001");
  assert.equal(localResult.data.card.availableDraws, 0);
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

test("production runtime retains only the lazy V2 path and no legacy implementation", () => {
  const html = fs.readFileSync(path.join(root, "client/index.html"), "utf8");
  const loader = fs.readFileSync(
    path.join(root, "client/member-lottery-loader.js"),
    "utf8"
  );

  assert.match(html, /src=["']member-lottery-loader\.js["']/);
  assert.doesNotMatch(html, /src=["']member-lottery-v2\.js["']/);
  assert.doesNotMatch(html, /src=["']lottery\/draw-service\.js["']/);
  assert.match(loader, /"member-lottery-v2\.js"/);
  assert.match(loader, /"lottery\/draw-service\.js"/);

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
