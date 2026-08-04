const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const controllerSource = fs.readFileSync(
  path.join(root, "client/member-lottery.js"),
  "utf8"
);

const ELEMENT_IDS = [
  "member-lottery-dialog",
  "member-lottery-loading-state",
  "member-lottery-error-state",
  "member-lottery-wheel-state",
  "member-lottery-result-state",
  "member-lottery-wheel",
  "member-lottery-rotor",
  "member-lottery-spin-button",
  "member-lottery-close-button",
  "member-lottery-retry-button",
  "member-lottery-return-button",
  "member-lottery-confirm-button",
  "member-lottery-dialog-description",
  "member-lottery-name",
  "member-lottery-ticket-detail",
  "member-lottery-spin-status",
  "member-lottery-error-code",
  "member-lottery-error-message",
  "member-lottery-result-prize",
  "member-lottery-result-detail",
  "member-lottery-result-swatch",
  "member-lottery-result-before",
  "member-lottery-result-balance",
];

const LIFF_ID = "liff-runtime";
const MEMBER_A = "MBR-AAAAAAAAAA";
const MEMBER_B = "MBR-BBBBBBBBBB";
const SETTING_VERSION = "PCS-TEST00000001";
const LOTTERY_TYPE_ID = "LTY-TEST000001";
const CARD_ROUND_KEY = `${SETTING_VERSION}:1:10`;
const MEMBER_A_STORAGE_KEY =
  `persona-member-lottery-round-request:${LIFF_ID}:${MEMBER_A}`;
const MEMBER_B_STORAGE_KEY =
  `persona-member-lottery-round-request:${LIFF_ID}:${MEMBER_B}`;
const DEMO_STORAGE_KEY =
  `persona-member-lottery-round-request:${LIFF_ID}:demo`;

function createTicket() {
  return {
    settingVersion: SETTING_VERSION,
    cardNumber: 1,
    milestonePoints: 10,
    lotteryTypeId: LOTTERY_TYPE_ID,
    cardRoundKey: CARD_ROUND_KEY,
  };
}

function createLotteryType() {
  const lottery = {
    lotteryTypeId: LOTTERY_TYPE_ID,
    configVersion: "LCF-TEST00000001",
    updatedAt: "2026-01-01T00:00:00.000Z",
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
    lotteryTypeId: LOTTERY_TYPE_ID,
    name: "測試轉盤",
    lottery,
  };
}

function createCard({ ticketAvailable = true } = {}) {
  return {
    settingVersion: SETTING_VERSION,
    targetPoints: 20,
    expiryMode: "unlimited",
    expiresOn: "",
    rewardMilestones: [5, 10, 15, 20],
    rewardRules: [5, 10, 15, 20].map((points) => ({
      points,
      lotteryTypeId: LOTTERY_TYPE_ID,
    })),
    reachedMilestones: [5, 10],
    currentPoints: 12,
    nextMilestonePoints: 15,
    pointsRemaining: 3,
    pointsToCardComplete: 8,
    currentCardNumber: 1,
    currentRound: 1,
    completedCards: 0,
    completedRounds: 0,
    earnedRewards: 2,
    drawsUsed: ticketAvailable ? 1 : 2,
    availableDraws: ticketAvailable ? 1 : 0,
    availableRewards: ticketAvailable ? [createTicket()] : [],
    totalPoints: 12,
  };
}

function createCardSummary({ ticketAvailable = true } = {}) {
  const card = createCard({ ticketAvailable });
  return {
    settingVersion: card.settingVersion,
    currentPoints: card.currentPoints,
    targetPoints: card.targetPoints,
    currentCardNumber: card.currentCardNumber,
    availableDraws: card.availableDraws,
    rewardRules: card.rewardRules,
    availableRewards: card.availableRewards,
    expiryMode: card.expiryMode,
    expiresOn: card.expiresOn,
  };
}

function createWorkspaceResponse({ ticketAvailable = true } = {}) {
  return {
    ok: true,
    data: {
      access: { allowed: true, status: "approved" },
      lotteryTypes: [createLotteryType()],
      card: createCard({ ticketAvailable }),
      pointBalance: 12,
      totalPoints: 12,
      canDraw: ticketAvailable,
    },
  };
}

function createDrawResponse() {
  const lotteryType = createLotteryType();
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
        ticketCost: 0,
        pointsSpent: 0,
        originalPointBalance: 12,
        pointBalance: 12,
        cardRoundKey: CARD_ROUND_KEY,
        drawnAt: "2026-01-01T00:00:00.000Z",
      },
      card: createCard({ ticketAvailable: false }),
      pointBalance: 12,
      totalPoints: 12,
    },
  };
}

class FakeElement {
  constructor(id) {
    this.id = id;
    this.hidden = false;
    this.open = false;
    this.disabled = false;
    this.dataset = {};
    this.textContent = "";
    this.attributes = new Map();
    this.listeners = new Map();
    this.style = {
      backgroundColor: "",
      transform: "",
      setProperty() {},
    };
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === "open") this.open = true;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
    if (name === "open") this.open = false;
  }

  hasAttribute(name) {
    return this.attributes.has(name);
  }

  querySelector() {
    return null;
  }

  focus() {}

  showModal() {
    this.open = true;
    this.attributes.set("open", "");
  }

  close() {
    this.open = false;
    this.attributes.delete("open");
    this.dispatch("close");
  }

  dispatch(type, event = {}) {
    const listeners = this.listeners.get(type) || [];
    const normalizedEvent = {
      target: this,
      preventDefault() {},
      stopImmediatePropagation() {},
      ...event,
    };
    listeners.forEach((listener) => listener(normalizedEvent));
  }
}

function createHarness({ reducedMotion = true } = {}) {
  const elements = Object.fromEntries(
    ELEMENT_IDS.map((id) => [id, new FakeElement(id)])
  );
  const storage = new Map();
  const state = {
    memberId: MEMBER_A,
    demo: false,
    summary: createCardSummary(),
    totalPoints: 12,
    requestHandler() {
      throw new Error("Unexpected request");
    },
    updates: [],
    toasts: [],
    requestIds: [],
    nextRequestId: 1,
  };
  const beforeUnloadListeners = [];
  let animationTime = 0;

  const window = {
    LotteryWheel: {
      draw() {
        return true;
      },
    },
    MemberApi: {
      createRequestId() {
        const requestId =
          `runtime-request-${String(state.nextRequestId).padStart(4, "0")}`;
        state.nextRequestId += 1;
        return requestId;
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
    addEventListener(type, listener) {
      if (type === "beforeunload") beforeUnloadListeners.push(listener);
    },
    requestAnimationFrame(callback) {
      return setTimeout(() => {
        animationTime += 16;
        callback(animationTime);
      }, 0);
    },
    cancelAnimationFrame(timer) {
      clearTimeout(timer);
    },
    setTimeout(callback, delay) {
      return setTimeout(callback, Math.min(Number(delay) || 0, 5));
    },
    performance: {
      now() {
        return animationTime;
      },
    },
    matchMedia() {
      return { matches: reducedMotion };
    },
  };
  window.window = window;

  const context = vm.createContext({
    Array,
    Boolean,
    Date,
    Error,
    Intl,
    JSON,
    Math,
    Number,
    Object,
    Promise,
    RegExp,
    String,
    clearTimeout,
    document: {
      getElementById(id) {
        return elements[id] || null;
      },
    },
    setTimeout,
    window,
  });
  vm.runInContext(controllerSource, context, {
    filename: "client/member-lottery.js",
  });

  const controller = window.MemberLotteryDialog;
  controller.configure({
    liffId: LIFF_ID,
    request(action, fields, requestId) {
      if (requestId) state.requestIds.push(requestId);
      return state.requestHandler(action, fields, requestId);
    },
    isDemo() {
      return state.demo;
    },
    getCurrentCardSummary() {
      return state.summary;
    },
    getCurrentTotalPoints() {
      return state.totalPoints;
    },
    getMemberId() {
      return state.memberId;
    },
    onCardUpdated(card, totalPoints) {
      state.updates.push({ card, totalPoints });
      state.summary = {
        settingVersion: card.settingVersion,
        currentPoints: card.currentPoints,
        targetPoints: card.targetPoints,
        currentCardNumber: card.currentCardNumber,
        availableDraws: card.availableDraws,
        rewardRules: card.rewardRules,
        availableRewards: card.availableRewards,
        expiryMode: card.expiryMode,
        expiresOn: card.expiresOn,
      };
      state.totalPoints = totalPoints;
    },
    normalizeError(error) {
      return {
        code: String((error && (error.code || error.name)) || "ERROR"),
        message: String((error && error.message) || "Request failed"),
      };
    },
    showToast(message) {
      state.toasts.push(String(message));
    },
  });

  return {
    beforeUnloadListeners,
    controller,
    elements,
    state,
    storage,
    click(id) {
      assert.equal(elements[id].disabled, false, `${id} should be enabled`);
      elements[id].dispatch("click");
    },
  };
}

test("draw data is prepared before the center button starts one smooth animation", async () => {
  const harness = createHarness({ reducedMotion: false });
  const { controller, elements, state } = harness;
  const actions = [];

  state.requestHandler = (action) => {
    actions.push(action);
    if (action === "getLotteryConfig") return createWorkspaceResponse();
    if (action === "drawLottery") return createDrawResponse();
    throw new Error(`Unexpected action: ${action}`);
  };

  assert.equal(await controller.open(createTicket()), true);
  assert.deepEqual(
    actions,
    ["getLotteryConfig", "drawLottery"],
    "opening the wheel must prepare both its display data and draw result"
  );
  assert.equal(
    elements["member-lottery-rotor"].style.transform,
    "rotate(0deg)"
  );

  harness.click("member-lottery-spin-button");
  await waitFor(
    () => elements["member-lottery-result-state"].hidden === false,
    "prepared draw result did not complete its animation"
  );
  assert.deepEqual(actions, ["getLotteryConfig", "drawLottery"]);
  assert.notEqual(
    elements["member-lottery-rotor"].style.transform,
    "rotate(0deg)"
  );
});

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
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test("pending draws are isolated by member and demo scope, then replay for the original member", async () => {
  const harness = createHarness();
  const { controller, state, storage } = harness;
  const transientError = createError("CONNECTION_ERROR", "Temporary timeout");
  let drawAttempt = 0;

  state.requestHandler = (action) => {
    if (action === "getLotteryConfig") return createWorkspaceResponse();
    if (action === "drawLottery") {
      drawAttempt += 1;
      return drawAttempt === 1
        ? Promise.reject(transientError)
        : createDrawResponse();
    }
    throw new Error(`Unexpected action: ${action}`);
  };

  assert.equal(await controller.open(createTicket()), false);

  assert.equal(controller.hasPending(), true);
  assert.equal(controller.canClose(), false);
  assert.equal(storage.has(MEMBER_A_STORAGE_KEY), true);
  assert.equal(state.requestIds.length, 1);
  const originalRequestId = state.requestIds[0];

  state.memberId = MEMBER_B;
  assert.equal(controller.hasPending(), false);
  assert.equal(controller.canClose(), true);
  assert.equal(controller.requestClose(), true);
  assert.equal(storage.has(MEMBER_A_STORAGE_KEY), true);
  assert.equal(storage.has(MEMBER_B_STORAGE_KEY), false);

  state.demo = true;
  assert.equal(controller.hasPending(), false);
  assert.equal(controller.requestClose(), true);
  assert.equal(storage.has(MEMBER_A_STORAGE_KEY), true);
  assert.equal(storage.has(DEMO_STORAGE_KEY), false);

  state.demo = false;
  state.memberId = MEMBER_A;
  assert.equal(controller.hasPending(), true);
  assert.equal(await controller.restorePending(), true);
  harness.click("member-lottery-spin-button");
  await waitFor(
    () =>
      !controller.hasPending() &&
      harness.elements["member-lottery-result-state"].hidden === false,
    "original member did not complete the replayed draw"
  );

  assert.deepEqual(state.requestIds, [
    originalRequestId,
    originalRequestId,
  ]);
  assert.equal(storage.has(MEMBER_A_STORAGE_KEY), false);
  assert.equal(storage.has(MEMBER_B_STORAGE_KEY), false);
  assert.equal(storage.has(DEMO_STORAGE_KEY), false);
});

test("definitive no-draw response clears pending and refreshes the host card", async () => {
  const harness = createHarness();
  const { controller, state, storage } = harness;
  let configReads = 0;

  state.requestHandler = (action) => {
    if (action === "getLotteryConfig") {
      configReads += 1;
      return createWorkspaceResponse({
        ticketAvailable: configReads === 1,
      });
    }
    if (action === "drawLottery") {
      return Promise.reject(
        createError(
          "LOTTERY_ROUND_NOT_READY",
          "This ticket has already been used"
        )
      );
    }
    throw new Error(`Unexpected action: ${action}`);
  };

  assert.equal(await controller.open(createTicket()), false);
  await waitFor(
    () =>
      configReads === 2 &&
      state.updates.length >= 2 &&
      state.updates.at(-1).card.availableDraws === 0,
    "host card was not refreshed after the definitive no-draw response"
  );

  assert.equal(controller.hasPending(), false);
  assert.equal(controller.canClose(), true);
  assert.equal(controller.requestClose(), true);
  assert.equal(storage.has(MEMBER_A_STORAGE_KEY), false);
  assert.equal(configReads, 2);
  assert.equal(
    harness.elements["member-lottery-error-code"].textContent,
    "LOTTERY ROUND NOT READY"
  );
});

test("unknown draw errors retain the pending request and keep the dialog locked", async () => {
  const harness = createHarness();
  const { controller, state, storage } = harness;
  let configReads = 0;

  state.requestHandler = (action) => {
    if (action === "getLotteryConfig") {
      configReads += 1;
      return createWorkspaceResponse();
    }
    if (action === "drawLottery") {
      return Promise.reject(
        createError("CONNECTION_ERROR", "The request timed out")
      );
    }
    throw new Error(`Unexpected action: ${action}`);
  };

  assert.equal(await controller.open(createTicket()), false);

  assert.equal(controller.hasPending(), true);
  assert.equal(controller.canClose(), false);
  assert.equal(controller.requestClose(), false);
  assert.equal(storage.has(MEMBER_A_STORAGE_KEY), true);
  assert.equal(configReads, 1);
  assert.match(
    harness.elements["member-lottery-error-message"].textContent,
    /timed out/
  );
});

test("demo mode opens and completes a deterministic in-place draw", async () => {
  const harness = createHarness();
  const { controller, state, storage } = harness;
  state.demo = true;
  state.requestHandler = () => {
    throw new Error("Demo mode must not call the backend");
  };

  assert.equal(await controller.open(createTicket()), true);
  assert.equal(
    harness.elements["member-lottery-wheel-state"].hidden,
    false
  );
  assert.equal(
    harness.elements["member-lottery-spin-button"].disabled,
    false
  );

  harness.click("member-lottery-spin-button");
  assert.equal(controller.hasPending(), true);
  assert.equal(storage.has(DEMO_STORAGE_KEY), true);
  await waitFor(
    () =>
      !controller.hasPending() &&
      harness.elements["member-lottery-result-state"].hidden === false,
    "demo draw did not reach its result state"
  );

  assert.equal(storage.has(DEMO_STORAGE_KEY), false);
  assert.equal(
    harness.elements["member-lottery-result-before"].textContent,
    "12"
  );
  assert.equal(
    harness.elements["member-lottery-result-balance"].textContent,
    "12"
  );
  assert.notEqual(
    harness.elements["member-lottery-result-prize"].textContent,
    ""
  );
  assert.equal(controller.canClose(), true);
});
