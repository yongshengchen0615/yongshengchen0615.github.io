const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const modulePaths = [
  "client/lottery/pending-request-store.js",
  "client/lottery/preparation-service.js",
  "client/lottery/preparation-view.js",
  "client/lottery/wheel-draw-guard.js",
  "client/member-lottery-preload.js",
];

const LIFF_ID = "liff-preload-test";
const MEMBER_ID = "MBR-AAAAAAAAAA";
const SETTING_VERSION = "PCS-TEST00000001";
const LOTTERY_TYPE_ID = "LTY-TEST000001";
const CARD_ROUND_KEY = `${SETTING_VERSION}:1:10`;
const STORAGE_KEY =
  `persona-member-lottery-round-request:${LIFF_ID}:${MEMBER_ID}`;

function createTicket() {
  return {
    settingVersion: SETTING_VERSION,
    cardNumber: 1,
    milestonePoints: 10,
    lotteryTypeId: LOTTERY_TYPE_ID,
    cardRoundKey: CARD_ROUND_KEY,
  };
}

function createWorkspaceResponse({ ticketAvailable = true } = {}) {
  return {
    ok: true,
    data: {
      access: { allowed: true, status: "approved" },
      lotteryTypes: [
        {
          lotteryTypeId: LOTTERY_TYPE_ID,
          name: "測試轉盤",
          lottery: {
            lotteryTypeId: LOTTERY_TYPE_ID,
            configVersion: "LCF-TEST00000001",
            updatedAt: "2026-08-05T00:00:00.000Z",
            prizes: [
              {
                prizeId: "LPR-TEST000001",
                label: "會員好禮",
                color: "#8DCCAA",
                probability: 50,
              },
              {
                prizeId: "LPR-TEST000002",
                label: "本輪頭獎",
                color: "#0B3C2C",
                probability: 50,
              },
            ],
          },
        },
      ],
      card: {
        availableRewards: ticketAvailable ? [createTicket()] : [],
      },
      totalPoints: 12,
    },
  };
}

function createDrawResponse() {
  return {
    ok: true,
    data: {
      lotteryType: { lotteryTypeId: LOTTERY_TYPE_ID },
      lottery: { lotteryTypeId: LOTTERY_TYPE_ID },
      draw: {
        lotteryTypeId: LOTTERY_TYPE_ID,
        cardRoundKey: CARD_ROUND_KEY,
      },
      card: { availableRewards: [] },
      totalPoints: 12,
    },
  };
}

class FakeElement {
  constructor(id) {
    this.id = id;
    this.disabled = false;
    this.dataset = {};
    this.textContent = "";
    this.attributes = new Map();
    this.label = { textContent: "" };
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  querySelector(selector) {
    return selector === "span" ? this.label : null;
  }
}

function createHarness() {
  const elements = {
    "member-lottery-spin-button": new FakeElement(
      "member-lottery-spin-button"
    ),
    "member-lottery-spin-status": new FakeElement(
      "member-lottery-spin-status"
    ),
  };
  const storage = new Map();
  const calls = [];
  const updates = [];
  let requestHandler = () => {
    throw new Error("Unexpected request");
  };
  let nextRequestId = 1;
  let legacyOptions = null;

  const legacyController = {
    configure(options) {
      legacyOptions = options;
      return this;
    },
    open() {
      return Promise.resolve()
        .then(() => legacyOptions.request("getLotteryConfig", {}, undefined))
        .then(() => {
          elements["member-lottery-spin-button"].disabled = false;
          return true;
        })
        .catch(() => false);
    },
    hasPending() {
      return storage.has(STORAGE_KEY);
    },
    canClose() {
      return !storage.has(STORAGE_KEY);
    },
    requestClose() {
      return !storage.has(STORAGE_KEY);
    },
  };

  const window = {
    MemberLotteryDialog: legacyController,
    MemberApi: {
      createRequestId() {
        const id = `request-${String(nextRequestId).padStart(4, "0")}`;
        nextRequestId += 1;
        return id;
      },
    },
    document: {
      getElementById(id) {
        return elements[id] || null;
      },
    },
    sessionStorage: {
      getItem(key) {
        return storage.get(key) || null;
      },
      setItem(key, value) {
        storage.set(key, String(value));
      },
      removeItem(key) {
        storage.delete(key);
      },
    },
  };
  window.window = window;

  const context = vm.createContext({
    Array,
    Boolean,
    Date,
    Error,
    JSON,
    Math,
    Number,
    Object,
    Promise,
    RegExp,
    String,
    window,
  });

  for (const relativePath of modulePaths) {
    const source = fs.readFileSync(path.join(root, relativePath), "utf8");
    vm.runInContext(source, context, { filename: relativePath });
  }

  const controller = window.MemberLotteryDialog;
  controller.configure({
    liffId: LIFF_ID,
    request(action, fields, requestId) {
      calls.push({ action, fields, requestId });
      return requestHandler(action, fields, requestId);
    },
    getMemberId() {
      return MEMBER_ID;
    },
    isDemo() {
      return false;
    },
    onCardUpdated(card, totalPoints) {
      updates.push({ card, totalPoints });
    },
  });

  return {
    calls,
    controller,
    elements,
    legacyOptions() {
      return legacyOptions;
    },
    setRequestHandler(handler) {
      requestHandler = handler;
    },
    storage,
    updates,
    window,
  };
}

function createServiceHarness() {
  const harness = createHarness();
  const store = harness.window.MemberLotteryPendingRequestStore.create({
    liffId: LIFF_ID,
    getMemberId() {
      return MEMBER_ID;
    },
    isDemo() {
      return false;
    },
    createRequestId() {
      return "service-request-0001";
    },
  });
  const guard = harness.window.MemberLotteryWheelDrawGuard.create();
  const serviceCalls = [];
  let handler = () => {
    throw new Error("Unexpected service request");
  };
  const service = harness.window.MemberLotteryPreparationService.create({
    request(action, fields, requestId) {
      serviceCalls.push({ action, fields, requestId });
      return handler(action, fields, requestId);
    },
    store,
    guard,
  });
  return {
    guard,
    service,
    serviceCalls,
    setHandler(nextHandler) {
      handler = nextHandler;
    },
    store,
  };
}

function createError(code, message = code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function waitFor(predicate, message) {
  const deadline = Date.now() + 1000;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      assert.fail(message || "Timed out waiting for condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

test("opening a ticket prepares config and draw before enabling the wheel", async () => {
  const harness = createHarness();
  let resolveDraw;
  const drawPromise = new Promise((resolve) => {
    resolveDraw = resolve;
  });

  harness.setRequestHandler((action) => {
    if (action === "getLotteryConfig") return createWorkspaceResponse();
    if (action === "drawLottery") return drawPromise;
    throw new Error(`Unexpected action: ${action}`);
  });

  const openPromise = harness.controller.open(createTicket());
  await waitFor(
    () => harness.calls.some((call) => call.action === "drawLottery"),
    "draw preparation did not start"
  );

  assert.equal(
    harness.elements["member-lottery-spin-button"].disabled,
    true
  );
  assert.match(
    harness.elements["member-lottery-spin-status"].textContent,
    /正在準備轉盤/
  );

  resolveDraw(createDrawResponse());
  assert.equal(await openPromise, true);
  assert.equal(
    harness.elements["member-lottery-spin-button"].disabled,
    false
  );
  assert.equal(
    harness.elements["member-lottery-spin-button"].dataset.state,
    "ready"
  );
  assert.match(
    harness.elements["member-lottery-spin-status"].textContent,
    /轉盤已就緒/
  );
});

test("wheel animation receives the prepared result without a second draw request", async () => {
  const harness = createHarness();
  harness.setRequestHandler((action) => {
    if (action === "getLotteryConfig") return createWorkspaceResponse();
    if (action === "drawLottery") return createDrawResponse();
    throw new Error(`Unexpected action: ${action}`);
  });

  assert.equal(await harness.controller.open(createTicket()), true);
  const pending = JSON.parse(harness.storage.get(STORAGE_KEY));
  const drawCount = harness.calls.filter(
    (call) => call.action === "drawLottery"
  ).length;

  const preparedResponse = await harness.legacyOptions().request(
    "drawLottery",
    {
      lotteryTypeId: LOTTERY_TYPE_ID,
      cardRoundKey: CARD_ROUND_KEY,
    },
    pending.requestId
  );

  assert.equal(preparedResponse.ok, true);
  assert.equal(
    harness.calls.filter((call) => call.action === "drawLottery").length,
    drawCount
  );
});

test("transient preparation retry reuses the same persisted request id", async () => {
  const harness = createServiceHarness();
  let drawAttempt = 0;

  harness.setHandler((action) => {
    if (action === "getLotteryConfig") return createWorkspaceResponse();
    if (action === "drawLottery") {
      drawAttempt += 1;
      return drawAttempt === 1
        ? Promise.reject(createError("BACKEND_TIMEOUT", "Temporary timeout"))
        : createDrawResponse();
    }
    throw new Error(`Unexpected action: ${action}`);
  });

  await assert.rejects(
    Promise.resolve(harness.service.prepare(createTicket())),
    /Temporary timeout/
  );
  assert.equal(harness.store.read().requestId, "service-request-0001");

  await harness.service.prepare(createTicket());
  const requestIds = harness.serviceCalls
    .filter((call) => call.action === "drawLottery")
    .map((call) => call.requestId);
  assert.deepEqual(requestIds, [
    "service-request-0001",
    "service-request-0001",
  ]);
});

test("definitive no-draw failure releases the stored ticket", async () => {
  const harness = createServiceHarness();
  let configReads = 0;

  harness.setHandler((action) => {
    if (action === "getLotteryConfig") {
      configReads += 1;
      return createWorkspaceResponse({ ticketAvailable: configReads === 1 });
    }
    if (action === "drawLottery") {
      return Promise.reject(
        createError("LOTTERY_ROUND_NOT_READY", "Ticket already used")
      );
    }
    throw new Error(`Unexpected action: ${action}`);
  });

  await assert.rejects(
    Promise.resolve(harness.service.prepare(createTicket())),
    /Ticket already used/
  );
  assert.equal(harness.store.read(), null);
  assert.equal(configReads, 2);
});

test("unprepared wheel draw fails locally", async () => {
  const harness = createServiceHarness();
  const ticket = createTicket();
  const pending = harness.store.ensure(ticket);

  await assert.rejects(
    Promise.resolve(
      harness.service.resolvePrepared(ticket, pending.requestId)
    ),
    /尚未準備完成/
  );
});
