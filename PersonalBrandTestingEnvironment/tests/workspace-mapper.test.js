const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const projectRoot = path.resolve(__dirname, "..");
const source = fs.readFileSync(
  path.join(projectRoot, "client/lottery/workspace-mapper.js"),
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
  set(name, instance) {
    this.instances.set(name, instance);
  }
  get(name) {
    if (this.instances.has(name)) return this.instances.get(name);
    const definition = this.definitions.get(name);
    const instance = definition.factory(
      ...definition.dependencies.map((dependency) => this.get(dependency))
    );
    this.instances.set(name, instance);
    return instance;
  }
}

function createHarness() {
  const registry = new Registry();
  registry.set("lottery.contracts", {
    createError(code, message) {
      const error = new Error(message);
      error.code = code;
      return error;
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
        ticket.cardRoundKey !==
        `${ticket.settingVersion}:${ticket.cardNumber}:${ticket.milestonePoints}`
      ) {
        const error = new Error("invalid ticket");
        error.code = "INVALID_LOTTERY_TICKET";
        throw error;
      }
      return Object.freeze(ticket);
    },
  });
  const window = { PersonaModules: registry };
  window.window = window;
  vm.runInContext(source, vm.createContext({
    window,
    Object,
    Array,
    Boolean,
    Date,
    Error,
    JSON,
    Math,
    Number,
    RegExp,
    String,
    Intl,
  }));
  return registry.get("lottery.workspace-mapper");
}

const TYPE_ID = "LTY-TEST000001";
const TICKET = {
  settingVersion: "PCS-TEST00000001",
  cardNumber: 1,
  milestonePoints: 10,
  lotteryTypeId: TYPE_ID,
  cardRoundKey: "PCS-TEST00000001:1:10",
};

function createLotteryType() {
  return {
    lotteryTypeId: TYPE_ID,
    name: "測試轉盤",
    lottery: {
      lotteryTypeId: TYPE_ID,
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
  };
}

function createCard({ available = true } = {}) {
  return {
    settingVersion: TICKET.settingVersion,
    targetPoints: 10,
    expiryMode: "unlimited",
    expiresOn: "",
    rewardMilestones: [10],
    rewardRules: [{ points: 10, lotteryTypeId: TYPE_ID }],
    reachedMilestones: [],
    currentPoints: 0,
    nextMilestonePoints: 10,
    pointsRemaining: 10,
    pointsToCardComplete: 10,
    currentCardNumber: 1,
    currentRound: 1,
    completedCards: 0,
    completedRounds: 0,
    earnedRewards: 1,
    drawsUsed: available ? 0 : 1,
    availableDraws: available ? 1 : 0,
    availableRewards: available ? [TICKET] : [],
    totalPoints: 12,
  };
}

function createWorkspace() {
  return {
    access: { allowed: true, status: "approved" },
    lotteryTypes: [createLotteryType()],
    card: createCard(),
    totalPoints: 12,
  };
}

function createDrawData() {
  const type = createLotteryType();
  return {
    lotteryType: type,
    lottery: type.lottery,
    draw: {
      drawId: "LDW-TEST000000000001",
      configVersion: type.lottery.configVersion,
      prizeId: "LPR-TEST000001",
      prizeLabel: "會員好禮",
      prizeColor: "#8DCCAA",
      lotteryTypeId: TYPE_ID,
      pointsSpent: 0,
      originalPointBalance: 12,
      pointBalance: 12,
      cardRoundKey: TICKET.cardRoundKey,
      drawnAt: "2026-08-05T00:00:00.000Z",
    },
    card: createCard({ available: false }),
    totalPoints: 12,
  };
}

test("normalizes a consistent workspace and draw result", () => {
  const mapper = createHarness();
  const workspace = mapper.normalizeWorkspace(createWorkspace());
  const result = mapper.normalizeDrawResult(createDrawData(), workspace, TICKET);

  assert.equal(workspace.lotteryTypes[0].lotteryTypeId, TYPE_ID);
  assert.equal(result.draw.prizeId, "LPR-TEST000001");
  assert.equal(result.card.availableDraws, 0);
});

test("rejects lottery probabilities that do not total 100 percent", () => {
  const mapper = createHarness();
  const workspace = createWorkspace();
  workspace.lotteryTypes[0].lottery.prizes[1].probability = 40;

  assert.throws(
    () => mapper.normalizeWorkspace(workspace),
    (error) => error.code === "INVALID_RESPONSE"
  );
});

test("rejects a draw result for another card round", () => {
  const mapper = createHarness();
  const workspace = mapper.normalizeWorkspace(createWorkspace());
  const data = createDrawData();
  data.draw.cardRoundKey = "PCS-TEST00000001:2:10";

  assert.throws(
    () => mapper.normalizeDrawResult(data, workspace, TICKET),
    (error) => error.code === "INVALID_RESPONSE"
  );
});
