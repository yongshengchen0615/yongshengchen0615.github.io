const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const files = {
  store: "client/lottery/pending-request-store.js",
  service: "client/lottery/preparation-service.js",
  view: "client/lottery/preparation-view.js",
  guard: "client/lottery/wheel-draw-guard.js",
  bootstrap: "client/member-lottery-preload.js",
};
const sources = Object.fromEntries(
  Object.entries(files).map(([name, relativePath]) => [
    name,
    fs.readFileSync(path.join(root, relativePath), "utf8"),
  ])
);

const ticket = Object.freeze({
  settingVersion: "PCS-ABCDEFGHIJKL",
  cardNumber: 1,
  milestonePoints: 100,
  lotteryTypeId: "LTY-ABCDEFGHIJ",
  cardRoundKey: "PCS-ABCDEFGHIJKL:1:100",
});

function createContext(extraWindow = {}) {
  const window = {
    MemberLotteryPreparation: Object.create(null),
    ...extraWindow,
  };
  window.window = window;

  return vm.createContext({
    window,
    globalThis: window,
    console,
    Promise,
    Error,
    Object,
    String,
    Number,
    Boolean,
    Array,
    JSON,
    RegExp,
    Math,
  });
}

function loadCoreModules(extraWindow = {}) {
  const context = createContext(extraWindow);
  for (const name of ["store", "service", "view", "guard"]) {
    new vm.Script(sources[name], { filename: files[name] }).runInContext(
      context
    );
  }
  return context;
}

function createStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

function normalizeTicket(value) {
  if (!value || value.cardRoundKey !== `${value.settingVersion}:${value.cardNumber}:${value.milestonePoints}`) {
    const error = new Error("invalid ticket");
    error.code = "INVALID_LOTTERY_TICKET";
    throw error;
  }
  return {
    settingVersion: String(value.settingVersion),
    cardNumber: Number(value.cardNumber),
    milestonePoints: Number(value.milestonePoints),
    lotteryTypeId: String(value.lotteryTypeId),
    cardRoundKey: String(value.cardRoundKey),
  };
}

test("lottery preparation files are valid JavaScript with explicit responsibility boundaries", () => {
  for (const [name, source] of Object.entries(sources)) {
    new vm.Script(source, { filename: files[name] });
  }

  assert.match(sources.store, /storage\.setItem/);
  assert.doesNotMatch(sources.store, /document|getElementById|drawLottery/);

  assert.match(sources.service, /"drawLottery"/);
  assert.doesNotMatch(sources.service, /sessionStorage|document|getElementById/);

  assert.match(sources.view, /getElementById/);
  assert.doesNotMatch(sources.view, /drawLottery|sessionStorage|createRequestId/);

  assert.match(sources.guard, /createWheelDrawGuard/);
  assert.doesNotMatch(sources.guard, /drawLottery|sessionStorage|getElementById/);

  for (const factory of [
    "createPendingRequestStore",
    "createPreparationService",
    "createPreparationView",
    "createWheelDrawGuard",
  ]) {
    assert.match(sources.bootstrap, new RegExp(`modules\\.${factory}`));
  }
  assert.match(sources.bootstrap, /global\.MemberLotteryDialog = api/);
  assert.doesNotMatch(
    sources.bootstrap,
    /function\s+(?:loading|ready|fail|ensurePending|installWheelDrawGuard)\s*\(/
  );
});

test("pending request store owns request id persistence and rejects ticket conflicts", () => {
  const context = loadCoreModules();
  const storage = createStorage();
  const store = context.window.MemberLotteryPreparation.createPendingRequestStore({
    storage,
    getStorageKey: () => "lottery:test",
    createRequestId: () => "REQ-1234567890",
    normalizeTicket,
  });

  const first = store.ensure(ticket);
  const second = store.ensure(ticket);

  assert.equal(first.requestId, "REQ-1234567890");
  assert.equal(second.requestId, first.requestId);
  assert.equal(store.read().cardRoundKey, ticket.cardRoundKey);

  assert.throws(
    () =>
      store.ensure({
        ...ticket,
        milestonePoints: 200,
        cardRoundKey: "PCS-ABCDEFGHIJKL:1:200",
      }),
    /上一次尚未揭曉/
  );

  store.clear();
  assert.equal(store.read(), null);
});

test("preparation service owns the draw request and exposes one-time result consumption", async () => {
  const context = loadCoreModules();
  const storage = createStorage();
  const namespace = context.window.MemberLotteryPreparation;
  const calls = [];
  const response = {
    ok: true,
    data: { draw: { prizeId: "LPR-ABCDEFGHIJ" } },
  };
  const store = namespace.createPendingRequestStore({
    storage,
    getStorageKey: () => "lottery:test",
    createRequestId: () => "REQ-1234567890",
    normalizeTicket,
  });
  const service = namespace.createPreparationService({
    request(action, fields, requestId) {
      calls.push({ action, fields, requestId });
      return response;
    },
    store,
    normalizeTicket,
    isDefinitiveError: () => false,
  });

  const prepared = await service.prepare(ticket);
  const pending = store.read();

  assert.equal(prepared.ready, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].action, "drawLottery");
  assert.equal(calls[0].requestId, pending.requestId);
  assert.equal(service.hasPrepared(pending.requestId), true);

  const consumed = service.consume(
    {
      lotteryTypeId: ticket.lotteryTypeId,
      cardRoundKey: ticket.cardRoundKey,
    },
    pending.requestId
  );

  assert.equal(consumed, response);
  assert.equal(service.hasPrepared(pending.requestId), false);
  assert.equal(
    service.consume(
      {
        lotteryTypeId: ticket.lotteryTypeId,
        cardRoundKey: ticket.cardRoundKey,
      },
      pending.requestId
    ),
    null
  );
});

test("preparation service clears pending state only for definitive no-draw errors", async () => {
  const context = loadCoreModules();
  const namespace = context.window.MemberLotteryPreparation;

  async function run(code, definitive) {
    let cleared = 0;
    const store = {
      ensure() {
        return { ...ticket, requestId: "REQ-1234567890" };
      },
      read() {
        return { ...ticket, requestId: "REQ-1234567890" };
      },
      clear() {
        cleared += 1;
      },
    };
    const service = namespace.createPreparationService({
      request() {
        const error = new Error(code);
        error.code = code;
        return Promise.reject(error);
      },
      store,
      normalizeTicket,
      isDefinitiveError: (error) => error.code === definitive,
    });

    const result = await service.prepare(ticket);
    return { result, cleared };
  }

  const definitive = await run(
    "LOTTERY_ROUND_NOT_READY",
    "LOTTERY_ROUND_NOT_READY"
  );
  assert.equal(definitive.result.retryable, false);
  assert.equal(definitive.cleared, 1);

  const transient = await run("NETWORK_TIMEOUT", "LOTTERY_ROUND_NOT_READY");
  assert.equal(transient.result.retryable, true);
  assert.equal(transient.cleared, 0);
});

test("wheel draw guard suppresses exactly one redundant canvas draw", () => {
  let drawCount = 0;
  const wheel = {
    draw() {
      drawCount += 1;
      return true;
    },
    textColor: "#111111",
  };
  const host = { LotteryWheel: wheel };
  const context = loadCoreModules();
  const guard = context.window.MemberLotteryPreparation.createWheelDrawGuard({
    global: host,
    lotteryWheel: wheel,
  });

  assert.equal(guard.install(), true);
  guard.suppressNextDraw();
  assert.equal(host.LotteryWheel.draw(), true);
  assert.equal(drawCount, 0);

  assert.equal(host.LotteryWheel.draw(), true);
  assert.equal(drawCount, 1);
});
