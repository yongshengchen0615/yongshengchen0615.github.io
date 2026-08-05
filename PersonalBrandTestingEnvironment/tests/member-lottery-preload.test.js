const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const scriptPaths = [
  "client/lottery/pending-request-store.js",
  "client/lottery/preparation-service.js",
  "client/lottery/preparation-view.js",
  "client/lottery/wheel-draw-guard.js",
  "client/member-lottery-preload.js",
];

const LIFF_ID = "liff-preload";
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
  const ticket = createTicket();
  const lottery = {
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
  };

  return {
    ok: true,
    data: {
      access: { allowed: true, status: "approved" },
      lotteryTypes: [
        {
          lotteryTypeId: LOTTERY_TYPE_ID,
          name: "測試轉盤",
          lottery,
        },
      ],
      card: {
        availableRewards: ticketAvailable ? [ticket] : [],
      },
      totalPoints: 12,
    },
  };
}

function createDrawResponse() {
  const workspace = createWorkspaceResponse();
  const lotteryType = workspace.data.lotteryTypes[0];
  const prize = lotteryType.lottery.prizes[0];

  return {
    ok: true,
    data: {
      access: { allowed: true, status: "approved" },
      lotteryType,
      lottery: lotteryType.lottery,
      draw: {
        drawId: "LDW-TEST000000000001",
        configVersion: lotteryType.lottery.configVersion,
        prizeId: prize.prizeId,
        prizeLabel: prize.label,
        prizeColor: prize.color,
        lotteryTypeId: LOTTERY_TYPE_ID,
        cardRoundKey: CARD_ROUND_KEY,
        originalPointBalance: 12,
        pointBalance: 12,
        pointsSpent: 0,
        drawnAt: "2026-08-05T00:00:00.000Z",
      },
      card: { availableRewards: [] },
      totalPoints: 12,
    },
  };
}

class FakeElement {
  constructor() {
    this.disabled = false;
    this.textContent = "";
    this.dataset = {};
    this.attributes = new Map();
  }

  querySelector() {
    return null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }
}

function createHarness() {
  const storage = new Map();
  const elements = {
    "member-lottery-spin-status": new FakeElement(),
    "member-lottery-spin-button": new FakeElement(),
  };
  const originalCalls = [];
  const createdRequestIds = [];
  let requestSequence = 0;
  let configuredOptions = null;
  let activeTicket = null;
  let legacyPending = false;

  const legacy = {
    configure(options) {
      configuredOptions = options;
      return this;
    },
    open(ticket) {
      activeTicket = ticket;
      return Promise.resolve()
        .then(() => configuredOptions.request("getLotteryConfig", {}, undefined))
        .then(() => true);
    },
    hasPending() {
      return legacyPending;
    },
    canClose() {
      return !legacyPending;
    },
    requestClose() {
      if (legacyPending) return false;
      activeTicket = null;
      return true;
    },
  };

  const state = {
    drawAttempts: 0,
    failNextDraw: null,
    ticketAvailable: true,
  };

  const window = {
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
        legacyPending = true;
      },
      removeItem(key) {
        storage.delete(key);
        legacyPending = false;
      },
    },
    MemberApi: {
      createRequestId() {
        requestSequence += 1;
        const id = `preload-request-${String(requestSequence).padStart(4, "0")}`;
        createdRequestIds.push(id);
        return id;
      },
    },
    MemberLotteryDialog: legacy,
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
    clearTimeout,
    console,
    document: window.document,
    setTimeout,
    window,
  });

  for (const relativePath of scriptPaths) {
    vm.runInContext(
      fs.readFileSync(path.join(root, relativePath), "utf8"),
      context,
      { filename: relativePath }
    );
  }

  const api = window.MemberLotteryDialog;
  api.configure({
    liffId: LIFF_ID,
    isDemo() {
      return false;
    },
    getMemberId() {
      return MEMBER_ID;
    },
    onCardUpdated() {},
    request(action, fields, requestId) {
      originalCalls.push({ action, fields, requestId });
      if (action === "getLotteryConfig") {
        return Promise.resolve(
          createWorkspaceResponse({ ticketAvailable: state.ticketAvailable })
        );
      }
      if (action === "drawLottery") {
        state.drawAttempts += 1;
        if (state.failNextDraw) {
          const error = state.failNextDraw;
          state.failNextDraw = null;
          return Promise.reject(error);
        }
        return Promise.resolve(createDrawResponse());
      }
      throw new Error(`Unexpected action: ${action}`);
    },
  });

  return {
    api,
    createdRequestIds,
    elements,
    originalCalls,
    state,
    storage,
    async simulateLegacySpin() {
      const pending = JSON.parse(storage.get(STORAGE_KEY));
      return configuredOptions.request(
        "drawLottery",
        {
          lotteryTypeId: activeTicket.lotteryTypeId,
          cardRoundKey: activeTicket.cardRoundKey,
        },
        pending.requestId
      );
    },
  };
}

function createError(code, message = code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

test("opening a ticket preloads config and draw before enabling the wheel", async () => {
  const harness = createHarness();

  assert.equal(await harness.api.open(createTicket()), true);
  assert.deepEqual(
    harness.originalCalls.map((call) => call.action),
    ["getLotteryConfig", "drawLottery"]
  );
  assert.equal(harness.createdRequestIds.length, 1);
  assert.equal(harness.storage.has(STORAGE_KEY), true);
  assert.equal(harness.elements["member-lottery-spin-button"].disabled, false);
  assert.equal(
    harness.elements["member-lottery-spin-status"].textContent,
    "轉盤已就緒，點選中央直接揭曉結果。"
  );
});

test("pressing the wheel consumes only the prepared in-memory response", async () => {
  const harness = createHarness();

  await harness.api.open(createTicket());
  const callsBeforeSpin = harness.originalCalls.length;
  const response = await harness.simulateLegacySpin();

  assert.equal(response.ok, true);
  assert.equal(harness.originalCalls.length, callsBeforeSpin);
  assert.equal(harness.state.drawAttempts, 1);
});

test("a transient preload failure keeps the same request id for retry", async () => {
  const harness = createHarness();
  harness.state.failNextDraw = createError("CONNECTION_ERROR", "temporary");

  await assert.rejects(
    harness.api.open(createTicket()),
    (error) => error.code === "CONNECTION_ERROR"
  );

  const persistedAfterFailure = JSON.parse(harness.storage.get(STORAGE_KEY));
  assert.equal(harness.createdRequestIds.length, 1);

  assert.equal(await harness.api.open(createTicket()), true);
  const persistedAfterRetry = JSON.parse(harness.storage.get(STORAGE_KEY));

  assert.equal(persistedAfterRetry.requestId, persistedAfterFailure.requestId);
  assert.equal(harness.createdRequestIds.length, 1);
  assert.equal(harness.state.drawAttempts, 2);
});

test("a definitive no-draw failure releases the pending request", async () => {
  const harness = createHarness();
  harness.state.failNextDraw = createError(
    "LOTTERY_ROUND_NOT_READY",
    "already used"
  );

  await assert.rejects(
    harness.api.open(createTicket()),
    (error) => error.code === "LOTTERY_ROUND_NOT_READY"
  );

  assert.equal(harness.storage.has(STORAGE_KEY), false);
  assert.equal(harness.api.hasPending(), false);
});
